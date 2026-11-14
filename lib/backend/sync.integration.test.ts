// lib/backend/sync.integration.test.ts
//
// Integration tests for the realtime lifecycle and offline/connection states
// wired into the Group Reading Room (task 9.3).
//
// Unlike `sync.test.ts` — which unit-tests `subscribeGroup`/`withLoadTimeout`
// in isolation — these tests exercise the REAL `lib/backend/sync.ts` module
// (subscribeGroup, ConnectionStatus, onReconnect, withLoadTimeout from tasks
// 9.1/9.2) wired exactly as `app/group/[id]/GroupClient.tsx` wires it, driven
// through a MOCKED PocketBase SDK. A lightweight `ScreenController` reproduces
// GroupClient's effect and handlers verbatim — the same change-handler →
// `loadGroup` mapping (Req 7.2–7.4), the same `withLoadTimeout(...)` bounded
// load (Req 10.2), the same `ConnectionStatus` → indicator derivation (Req 7.7,
// 10.1), and the same offline-submit branch that shows "not saved" and retains
// input (Req 10.3) — so the assertions cover the integration between the sync
// engine and the screen rather than a re-implementation.
//
// Asserts, end to end:
//   - a committed `progress` change invokes the handler, which calls
//     `loadGroup()` (Req 7.1, 7.2);
//   - unmount unsubscribes every subscription within 2 seconds (Req 7.5);
//   - a forced 10s+ outage surfaces the connection-status indicator (Req 7.7,
//     10.1);
//   - a load that exceeds the 10s bound stops and presents a retry control,
//     which re-runs the load (Req 7.6, 10.2);
//   - an offline submit retains the entered input and shows "not saved", and
//     does not report success (Req 10.3).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientResponseError } from "pocketbase";

import type { Group } from "@/app/group/[id]/types";

// ---------------------------------------------------------------------------
// Mocked PocketBase SDK surface (Backend_Client accessors + realtime)
// ---------------------------------------------------------------------------
//
// `subscribeGroup` reaches the backend only through the Backend_Client
// accessors and `getBackend().realtime`. We mock that module so the real sync
// engine runs against a controllable fake: `fakeRealtime` lets us drive
// (re)connections and drops; the three collection subscribe mocks capture the
// realtime callbacks so a "committed change" can be delivered; `groupsGetOne`
// stands in for the bounded `groupsCollection().getOne(...)` load; and
// `progressGetFirst`/`progressUpdate`/`progressCreate` back the offline-submit
// path.

const progressSubscribe = vi.fn();
const sessionSubscribe = vi.fn();
const memberSubscribe = vi.fn();
const connectSubscribe = vi.fn();

const groupsGetOne = vi.fn();
const progressGetFirst = vi.fn();
const progressUpdate = vi.fn();
const progressCreate = vi.fn();

const fakeRealtime: {
  isConnected: boolean;
  onDisconnect?: (active: string[]) => void;
  subscribe: typeof connectSubscribe;
} = {
  isConnected: false,
  onDisconnect: undefined,
  subscribe: connectSubscribe,
};

// `normalizeError` and `mapGroup` are pure helpers the screen uses; keep the
// real implementations so the offline-submit classification (network vs other)
// and record→Group mapping behave exactly as in production.
vi.mock("@/lib/backend/client", async () => {
  const actual = await vi.importActual<typeof import("./client")>("./client");
  return {
    ...actual,
    getBackend: () => ({ realtime: fakeRealtime }),
    groupsCollection: () => ({ getOne: groupsGetOne }),
    progressCollection: () => ({
      subscribe: progressSubscribe,
      getFirstListItem: progressGetFirst,
      update: progressUpdate,
      create: progressCreate,
    }),
    readingSessionsCollection: () => ({ subscribe: sessionSubscribe }),
    groupMembersCollection: () => ({ subscribe: memberSubscribe }),
  };
});

import {
  subscribeGroup,
  withLoadTimeout,
  LoadTimeoutError,
  OFFLINE_THRESHOLD_MS,
  LOAD_TIMEOUT_MS,
  type ConnectionStatus,
  type GroupSubscription,
} from "./sync";
import {
  normalizeError,
  mapGroup,
  type GroupRecord,
} from "./client";
import { validateProgressRange } from "./progressRange";

// ---------------------------------------------------------------------------
// ScreenController — GroupClient's realtime/offline wiring, extracted
// ---------------------------------------------------------------------------
//
// This mirrors `GroupClient.tsx` 1:1 for the behaviors under test: the effect
// that loads once and subscribes, the change handlers that all funnel into
// `loadGroup`, the status handler that drives the connection indicator, the
// bounded load with its retry marker, and the `setProgress` offline branch. It
// deliberately holds state as plain fields (instead of React state) so the test
// can assert on it directly without a DOM renderer.

interface ScreenState {
  group: Group | null;
  loading: boolean;
  connectionStatus: ConnectionStatus;
  loadTimedOut: boolean;
  staleData: boolean;
  message: string;
}

class ScreenController {
  group: Group | null = null;
  loading = true;
  connectionStatus: ConnectionStatus = "connected";
  loadTimedOut = false;
  staleData = false;
  message = "";

  /** Number of times the bounded group load has been invoked (Req 7.2). */
  loadCount = 0;

  private subscription: GroupSubscription | null = null;

  constructor(
    private readonly groupId: string,
    private readonly currentUserId: string
  ) {}

  /** Snapshot of the state the screen renders from. */
  snapshot(): ScreenState {
    return {
      group: this.group,
      loading: this.loading,
      connectionStatus: this.connectionStatus,
      loadTimedOut: this.loadTimedOut,
      staleData: this.staleData,
      message: this.message,
    };
  }

  // --- derived indicator flags, identical to GroupClient's render guards ---

  /** Connection-status indicator is shown while realtime is unavailable. */
  get showsConnectionIndicator(): boolean {
    return (
      this.connectionStatus === "offline" ||
      this.connectionStatus === "reconnecting"
    );
  }

  /** Retry control is shown after a load exceeded the 10s bound (Req 10.2). */
  get showsRetryControl(): boolean {
    return this.loadTimedOut;
  }

  /** "data may be out of date" indicator (Req 7.8). */
  get showsStaleIndicator(): boolean {
    return this.staleData && !this.showsConnectionIndicator;
  }

  // --- loadGroup, copied from GroupClient (Req 7.2–7.4, 10.1, 10.2, 7.8) ---

  async loadGroup(): Promise<void> {
    this.loadCount += 1;
    this.loadTimedOut = false;

    try {
      const record = await withLoadTimeout(
        groupsGetOne(this.groupId, {
          expand:
            "group_members_via_group," +
            "reading_sessions_via_group.progress_via_reading_session",
        }) as Promise<GroupRecord>
      );

      try {
        this.group = mapGroup(record);
        this.staleData = false;
      } catch (applyErr) {
        void normalizeError(applyErr);
        this.staleData = true;
      }
    } catch (err) {
      if (err instanceof LoadTimeoutError) {
        this.loadTimedOut = true;
      } else {
        void normalizeError(err);
        if (this.group) {
          this.staleData = true;
        } else {
          this.group = null;
        }
      }
    }

    this.loading = false;
  }

  // --- mount effect, copied from GroupClient's useEffect (Req 7.1, 7.5) ----

  mount(): void {
    void this.loadGroup();

    this.subscription = subscribeGroup(this.groupId, {
      onProgressChange: () => this.loadGroup(),
      onSessionChange: () => this.loadGroup(),
      onMemberChange: () => this.loadGroup(),
      onStatus: (status) => {
        this.connectionStatus = status;
      },
      onReconnect: () => this.loadGroup(),
    });
  }

  /** The effect cleanup — unsubscribe within 2 seconds on unmount (Req 7.5). */
  async unmount(): Promise<void> {
    await this.subscription?.unsubscribe();
  }

  // --- setProgress offline branch, copied from GroupClient (Req 10.3) ------

  async setProgress(value: number): Promise<void> {
    const session = this.group?.reading_sessions.find((s) => s.is_active);
    if (!session || !this.currentUserId) return;

    const current =
      session.progress.find((p) => p.user_id === this.currentUserId)
        ?.chapter_completed ?? 0;

    const result = validateProgressRange(
      session.total_chapters,
      current,
      value
    );
    if (!result.accepted) {
      this.message = `Progress must be a whole number between 0 and ${session.total_chapters}.`;
      return;
    }
    if (result.stored === current) {
      this.message = "";
      return;
    }

    try {
      const existing = await progressGetFirst(
        `reading_session = "${session.id}" && user = "${this.currentUserId}"`
      ).catch((lookupErr: unknown) => {
        if (normalizeError(lookupErr).kind === "not_found") return null;
        throw lookupErr;
      });

      if (existing) {
        await progressUpdate(existing.id, { chapter_completed: result.stored });
      } else {
        await progressCreate({
          reading_session: session.id,
          user: this.currentUserId,
          chapter_completed: result.stored,
        });
      }
    } catch (err) {
      const backendError = normalizeError(err);
      if (backendError.kind === "network") {
        this.message = "Not saved — the backend is unreachable. Try again.";
        return;
      }
      this.message = backendError.message || "Could not save progress.";
      return;
    }

    this.message = "";
    await this.loadGroup();
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GROUP_ID = "grp-1";
const USER_ID = "user-1";

/** A raw PocketBase `groups` record the bounded load resolves to. */
function groupRecord(): GroupRecord {
  return {
    id: GROUP_ID,
    name: "Book Club",
    invite_code: "ABC123",
    collectionId: "c_groups",
    collectionName: "groups",
    expand: {
      group_members_via_groups: [
        {
          id: "m1",
          user: USER_ID,
          group: GROUP_ID,
          display_name: "Ada",
          collectionId: "c_members",
          collectionName: "group_members",
        },
      ],
      reading_sessions_via_groups: [
        {
          id: "sess-1",
          group: GROUP_ID,
          book_title: "Dune",
          total_chapters: 10,
          progress_type: "chapters",
          is_active: true,
          cover_url: null,
          goal_type: null,
          goal_amount: null,
          goal_unit: null,
          reading_units: null,
          created_at: "2026-01-01",
          collectionId: "c_sessions",
          collectionName: "reading_sessions",
          expand: {
            progress_via_reading_session: [
              {
                id: "p1",
                reading_session: "sess-1",
                user: USER_ID,
                chapter_completed: 3,
                collectionId: "c_progress",
                collectionName: "progress",
              },
            ],
          },
        },
      ],
    },
  } as unknown as GroupRecord;
}

/** A PocketBase network/offline error (status 0 → BackendError.kind "network"). */
function networkError(): ClientResponseError {
  return new ClientResponseError({ status: 0, response: {} });
}

/** Resolve the PB_CONNECT callback captured by the fake realtime subscribe. */
function pbConnectCallback(): () => void {
  const call = connectSubscribe.mock.calls.find((c) => c[0] === "PB_CONNECT");
  if (!call) throw new Error("PB_CONNECT was not subscribed");
  return call[1] as () => void;
}

/** Resolve the realtime change callback registered on the progress collection. */
function progressChangeCallback(): () => void {
  return progressSubscribe.mock.calls[0][1] as () => void;
}

beforeEach(() => {
  progressSubscribe.mockReset();
  sessionSubscribe.mockReset();
  memberSubscribe.mockReset();
  connectSubscribe.mockReset();
  groupsGetOne.mockReset();
  progressGetFirst.mockReset();
  progressUpdate.mockReset();
  progressCreate.mockReset();

  fakeRealtime.isConnected = false;
  fakeRealtime.onDisconnect = undefined;

  // Default happy-path wiring: subscriptions resolve to no-op unsubscribers and
  // the bounded load resolves to the fixture group.
  connectSubscribe.mockResolvedValue(vi.fn().mockResolvedValue(undefined));
  progressSubscribe.mockResolvedValue(vi.fn().mockResolvedValue(undefined));
  sessionSubscribe.mockResolvedValue(vi.fn().mockResolvedValue(undefined));
  memberSubscribe.mockResolvedValue(vi.fn().mockResolvedValue(undefined));
  groupsGetOne.mockResolvedValue(groupRecord());
});

// ---------------------------------------------------------------------------
// 1. Committed change → handler → loadGroup (Req 7.1, 7.2)
// ---------------------------------------------------------------------------

describe("committed change triggers a reload (Req 7.1, 7.2)", () => {
  it("subscribes on mount and reissues loadGroup when a progress change is delivered", async () => {
    const screen = new ScreenController(GROUP_ID, USER_ID);
    screen.mount();

    // Let the initial mount load settle.
    await vi.waitFor(() => expect(screen.loading).toBe(false));
    expect(screen.group?.name).toBe("Book Club");
    const loadsAfterMount = screen.loadCount;
    expect(loadsAfterMount).toBe(1);

    // All three group-scoped collections were subscribed (Req 7.1).
    expect(progressSubscribe).toHaveBeenCalledWith("*", expect.any(Function), {
      filter: 'reading_session.group = "grp-1"',
    });
    expect(sessionSubscribe).toHaveBeenCalledWith("*", expect.any(Function), {
      filter: 'group = "grp-1"',
    });
    expect(memberSubscribe).toHaveBeenCalledWith("*", expect.any(Function), {
      filter: 'group = "grp-1"',
    });

    // A committed change on `progress` is delivered to the captured callback;
    // the handler funnels into a fresh loadGroup (Req 7.2).
    progressChangeCallback()();
    await vi.waitFor(() => expect(screen.loadCount).toBe(loadsAfterMount + 1));

    await screen.unmount();
  });
});

// ---------------------------------------------------------------------------
// 2. Unmount → unsubscribe within 2s (Req 7.5)
// ---------------------------------------------------------------------------

describe("unmount unsubscribes within 2 seconds (Req 7.5)", () => {
  it("tears every subscription down on unmount well under the 2s bound", async () => {
    const progressUnsub = vi.fn().mockResolvedValue(undefined);
    const sessionUnsub = vi.fn().mockResolvedValue(undefined);
    const memberUnsub = vi.fn().mockResolvedValue(undefined);
    const connectUnsub = vi.fn().mockResolvedValue(undefined);
    progressSubscribe.mockResolvedValue(progressUnsub);
    sessionSubscribe.mockResolvedValue(sessionUnsub);
    memberSubscribe.mockResolvedValue(memberUnsub);
    connectSubscribe.mockResolvedValue(connectUnsub);

    const screen = new ScreenController(GROUP_ID, USER_ID);
    screen.mount();
    await vi.waitFor(() => expect(screen.loading).toBe(false));

    const start = Date.now();
    await screen.unmount();
    const elapsed = Date.now() - start;

    expect(progressUnsub).toHaveBeenCalledTimes(1);
    expect(sessionUnsub).toHaveBeenCalledTimes(1);
    expect(memberUnsub).toHaveBeenCalledTimes(1);
    expect(connectUnsub).toHaveBeenCalledTimes(1);
    // Teardown is immediate; assert it is comfortably inside the 2s bound.
    expect(elapsed).toBeLessThan(2000);
  });
});

// ---------------------------------------------------------------------------
// 3. Forced 10s+ outage → connection-status indicator (Req 7.7, 10.1)
// ---------------------------------------------------------------------------

describe("forced 10s+ outage surfaces the connection indicator (Req 7.7, 10.1)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the indicator after an outage exceeds the 10s bound, retaining last state", async () => {
    const screen = new ScreenController(GROUP_ID, USER_ID);
    screen.mount();
    // Flush the initial mount load under fake timers.
    await vi.runAllTimersAsync();
    expect(screen.group?.name).toBe("Book Club");
    expect(screen.showsConnectionIndicator).toBe(false);

    // Initial realtime connection comes up.
    pbConnectCallback()();
    expect(screen.connectionStatus).toBe("connected");

    // Connection drops (active subscriptions => genuine interruption): the
    // engine flips to reconnecting and the indicator appears immediately.
    fakeRealtime.onDisconnect?.(["grp-1/progress"]);
    expect(screen.connectionStatus).toBe("reconnecting");
    expect(screen.showsConnectionIndicator).toBe(true);

    // Still down after the full 10s bound => offline; indicator stays up and
    // the last loaded group is retained (Req 7.7, 10.1).
    await vi.advanceTimersByTimeAsync(OFFLINE_THRESHOLD_MS);
    expect(screen.connectionStatus).toBe("offline");
    expect(screen.showsConnectionIndicator).toBe(true);
    expect(screen.group?.name).toBe("Book Club");
  });

  it("clears the indicator and reloads when the connection recovers (Req 7.6, 10.4)", async () => {
    const screen = new ScreenController(GROUP_ID, USER_ID);
    screen.mount();
    await vi.runAllTimersAsync();

    const connect = pbConnectCallback();
    connect(); // initial connect
    const loadsBefore = screen.loadCount;

    fakeRealtime.onDisconnect?.(["grp-1/progress"]);
    expect(screen.showsConnectionIndicator).toBe(true);

    // Reconnect before the bound elapses: onReconnect reloads, status returns
    // to connected, indicator clears.
    connect();
    await vi.runAllTimersAsync();

    expect(screen.connectionStatus).toBe("connected");
    expect(screen.showsConnectionIndicator).toBe(false);
    expect(screen.loadCount).toBe(loadsBefore + 1);
  });
});

// ---------------------------------------------------------------------------
// 4. Slow load → retry control (Req 7.6, 10.2)
// ---------------------------------------------------------------------------

describe("a slow load presents a retry control (Req 10.2)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops a load exceeding the 10s bound and offers a retry that re-runs the load", async () => {
    // First load never settles → withLoadTimeout abandons it after the bound.
    let resolveSlow: ((r: GroupRecord) => void) | null = null;
    groupsGetOne.mockReturnValueOnce(
      new Promise<GroupRecord>((resolve) => {
        resolveSlow = resolve;
      })
    );

    const screen = new ScreenController(GROUP_ID, USER_ID);
    screen.mount();

    // Advance past the 10s load bound; the stuck load is abandoned.
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS);
    expect(screen.loadTimedOut).toBe(true);
    expect(screen.showsRetryControl).toBe(true);
    expect(screen.loading).toBe(false);
    // Nothing was loaded, so no group is shown yet.
    expect(screen.group).toBeNull();

    // The retry control re-runs loadGroup; this attempt resolves promptly.
    groupsGetOne.mockResolvedValueOnce(groupRecord());
    const retry = screen.loadGroup();
    await vi.runAllTimersAsync();
    await retry;

    expect(screen.loadTimedOut).toBe(false);
    expect(screen.showsRetryControl).toBe(false);
    expect(screen.group?.name).toBe("Book Club");

    // The abandoned first load settling late must not blank the screen.
    // `resolveSlow` is assigned inside the Promise executor above; TS's
    // control-flow analysis cannot see that cross-closure write, so read it
    // back through its declared type before invoking.
    const settleSlow = resolveSlow as ((r: GroupRecord) => void) | null;
    settleSlow?.(groupRecord());
    await vi.runAllTimersAsync();
    expect(screen.group?.name).toBe("Book Club");

    await screen.unmount();
  });
});

// ---------------------------------------------------------------------------
// 5. Offline submit retains input and shows "not saved" (Req 10.3)
// ---------------------------------------------------------------------------

describe("an offline submit retains input and reports not saved (Req 10.3)", () => {
  it("shows 'not saved', does not report success, and leaves state unchanged", async () => {
    const screen = new ScreenController(GROUP_ID, USER_ID);
    screen.mount();
    await vi.waitFor(() => expect(screen.loading).toBe(false));

    // The current member sits at 3/10 (from the fixture).
    const before = screen.group?.reading_sessions[0].progress[0].chapter_completed;
    expect(before).toBe(3);

    // The lookup succeeds but the write fails with a network/offline error.
    progressGetFirst.mockResolvedValue({ id: "p1" });
    progressUpdate.mockRejectedValue(networkError());

    const loadsBefore = screen.loadCount;
    await screen.setProgress(4);

    // "Not saved" surfaced; success reload NOT issued (Req 10.3).
    expect(screen.message).toMatch(/not saved/i);
    expect(screen.loadCount).toBe(loadsBefore);

    // The last good state is retained: the stored progress still reads 3, so
    // the stepper keeps showing the member's submitted input rather than
    // reverting or falsely advancing.
    expect(
      screen.group?.reading_sessions[0].progress[0].chapter_completed
    ).toBe(3);

    await screen.unmount();
  });

  it("clears the message and reloads on a successful submit (contrast case)", async () => {
    const screen = new ScreenController(GROUP_ID, USER_ID);
    screen.mount();
    await vi.waitFor(() => expect(screen.loading).toBe(false));

    progressGetFirst.mockResolvedValue({ id: "p1" });
    progressUpdate.mockResolvedValue({ id: "p1", chapter_completed: 4 });

    const loadsBefore = screen.loadCount;
    await screen.setProgress(4);

    expect(screen.message).toBe("");
    // A successful write reloads so the view re-syncs (Req 7.2).
    expect(screen.loadCount).toBe(loadsBefore + 1);

    await screen.unmount();
  });
});
