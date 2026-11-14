// lib/backend/sync.test.ts
//
// Unit tests for `subscribeGroup` (Req 7.1, 7.5). The real subscriptions run
// against PocketBase realtime, so this mocks the Backend_Client collection
// accessors and asserts:
//   - all three collections (progress, reading_sessions, group_members) are
//     subscribed with a group-scoped server-side filter (Req 7.1),
//   - a delivered change invokes the matching handler (which the screen maps to
//     loadGroup, Req 7.2–7.4),
//   - unsubscribe() tears every subscription down, even when a subscription
//     resolves after teardown was requested (Req 7.5).

import { beforeEach, describe, expect, it, vi } from "vitest";

const progressSubscribe = vi.fn();
const sessionSubscribe = vi.fn();
const memberSubscribe = vi.fn();
const connectSubscribe = vi.fn();

// A fake PocketBase realtime surface so `subscribeGroup`'s connection
// monitoring (task 9.2) can be driven from the tests: `onDisconnect` is the
// hook the engine installs, and `connectSubscribe` captures the PB_CONNECT
// callback so we can simulate (re)connections.
const fakeRealtime: {
  isConnected: boolean;
  onDisconnect?: (active: string[]) => void;
  subscribe: typeof connectSubscribe;
} = {
  isConnected: false,
  onDisconnect: undefined,
  subscribe: connectSubscribe,
};

vi.mock("@/lib/backend/client", () => ({
  getBackend: () => ({ realtime: fakeRealtime }),
  progressCollection: () => ({ subscribe: progressSubscribe }),
  readingSessionsCollection: () => ({ subscribe: sessionSubscribe }),
  groupMembersCollection: () => ({ subscribe: memberSubscribe }),
}));

import { subscribeGroup, OFFLINE_THRESHOLD_MS } from "./sync";

function makeHandlers() {
  return {
    onProgressChange: vi.fn(),
    onSessionChange: vi.fn(),
    onMemberChange: vi.fn(),
    onStatus: vi.fn(),
    onReconnect: vi.fn(),
  };
}

beforeEach(() => {
  progressSubscribe.mockReset();
  sessionSubscribe.mockReset();
  memberSubscribe.mockReset();
  connectSubscribe.mockReset();
  fakeRealtime.isConnected = false;
  fakeRealtime.onDisconnect = undefined;
  // PB_CONNECT subscription resolves to a no-op unsubscribe by default.
  connectSubscribe.mockResolvedValue(vi.fn().mockResolvedValue(undefined));
});

describe("subscribeGroup (Req 7.1, 7.5)", () => {
  it("subscribes to all three collections filtered to the group", async () => {
    progressSubscribe.mockResolvedValue(vi.fn());
    sessionSubscribe.mockResolvedValue(vi.fn());
    memberSubscribe.mockResolvedValue(vi.fn());

    const subscription = subscribeGroup("grp-1", makeHandlers());
    // Let the setup promises resolve.
    await subscription.unsubscribe();

    // progress is related to the group through reading_session.group.
    expect(progressSubscribe).toHaveBeenCalledWith("*", expect.any(Function), {
      filter: 'reading_session.group = "grp-1"',
    });
    // reading_sessions and group_members relate directly to the group.
    expect(sessionSubscribe).toHaveBeenCalledWith("*", expect.any(Function), {
      filter: 'group = "grp-1"',
    });
    expect(memberSubscribe).toHaveBeenCalledWith("*", expect.any(Function), {
      filter: 'group = "grp-1"',
    });
  });

  it("invokes the matching handler on a delivered change", async () => {
    progressSubscribe.mockResolvedValue(vi.fn());
    sessionSubscribe.mockResolvedValue(vi.fn());
    memberSubscribe.mockResolvedValue(vi.fn());

    const handlers = makeHandlers();
    const subscription = subscribeGroup("grp-1", handlers);

    // The second argument passed to each subscribe is the realtime callback.
    const progressCb = progressSubscribe.mock.calls[0][1] as () => void;
    const sessionCb = sessionSubscribe.mock.calls[0][1] as () => void;
    const memberCb = memberSubscribe.mock.calls[0][1] as () => void;

    progressCb();
    sessionCb();
    memberCb();

    expect(handlers.onProgressChange).toHaveBeenCalledTimes(1);
    expect(handlers.onSessionChange).toHaveBeenCalledTimes(1);
    expect(handlers.onMemberChange).toHaveBeenCalledTimes(1);

    await subscription.unsubscribe();
  });

  it("tears down every subscription on unsubscribe (Req 7.5)", async () => {
    const progressUnsub = vi.fn().mockResolvedValue(undefined);
    const sessionUnsub = vi.fn().mockResolvedValue(undefined);
    const memberUnsub = vi.fn().mockResolvedValue(undefined);
    progressSubscribe.mockResolvedValue(progressUnsub);
    sessionSubscribe.mockResolvedValue(sessionUnsub);
    memberSubscribe.mockResolvedValue(memberUnsub);

    const subscription = subscribeGroup("grp-1", makeHandlers());
    await subscription.unsubscribe();

    expect(progressUnsub).toHaveBeenCalledTimes(1);
    expect(sessionUnsub).toHaveBeenCalledTimes(1);
    expect(memberUnsub).toHaveBeenCalledTimes(1);
  });

  it("tears down a subscription that resolves after unsubscribe was requested", async () => {
    const lateUnsub = vi.fn().mockResolvedValue(undefined);
    // progress resolves immediately; sessions/members resolve on the next tick,
    // after unsubscribe() has already been invoked — they must still be torn
    // down so no subscription leaks (Req 7.5).
    progressSubscribe.mockResolvedValue(vi.fn().mockResolvedValue(undefined));
    sessionSubscribe.mockResolvedValue(lateUnsub);
    memberSubscribe.mockResolvedValue(lateUnsub);

    const subscription = subscribeGroup("grp-1", makeHandlers());
    await subscription.unsubscribe();

    // Both late-resolving subscriptions were torn down.
    expect(lateUnsub).toHaveBeenCalledTimes(2);
  });

  it("is safe to call unsubscribe more than once", async () => {
    const progressUnsub = vi.fn().mockResolvedValue(undefined);
    progressSubscribe.mockResolvedValue(progressUnsub);
    sessionSubscribe.mockResolvedValue(vi.fn().mockResolvedValue(undefined));
    memberSubscribe.mockResolvedValue(vi.fn().mockResolvedValue(undefined));

    const subscription = subscribeGroup("grp-1", makeHandlers());
    await subscription.unsubscribe();
    await subscription.unsubscribe();

    // The second call finds nothing left to remove.
    expect(progressUnsub).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Connection status, reconnect-reload, offline threshold (Req 7.6, 7.7, 10.1, 10.4)
// ---------------------------------------------------------------------------

import { afterEach } from "vitest";
import { withLoadTimeout, LoadTimeoutError, LOAD_TIMEOUT_MS } from "./sync";

// Resolve the PB_CONNECT callback captured by the fake realtime subscribe mock.
function pbConnectCallback(): () => void {
  const call = connectSubscribe.mock.calls.find((c) => c[0] === "PB_CONNECT");
  if (!call) throw new Error("PB_CONNECT was not subscribed");
  return call[1] as () => void;
}

describe("connection status + reconnect-reload (Req 7.6, 7.7, 10.1, 10.4)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    progressSubscribe.mockResolvedValue(vi.fn().mockResolvedValue(undefined));
    sessionSubscribe.mockResolvedValue(vi.fn().mockResolvedValue(undefined));
    memberSubscribe.mockResolvedValue(vi.fn().mockResolvedValue(undefined));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("subscribes to PB_CONNECT to monitor the realtime connection", () => {
    subscribeGroup("grp-1", makeHandlers());

    expect(connectSubscribe).toHaveBeenCalledWith(
      "PB_CONNECT",
      expect.any(Function)
    );
  });

  it("reports connected on first connect without reloading (Req 7.6)", () => {
    const handlers = makeHandlers();
    subscribeGroup("grp-1", handlers);

    // First PB_CONNECT is the initial mount connection: status connected, but
    // no reload — the screen already loads once on mount.
    pbConnectCallback()();

    expect(handlers.onStatus).toHaveBeenCalledWith("connected");
    expect(handlers.onReconnect).not.toHaveBeenCalled();
  });

  it("on reconnect emits stale, reloads, then connected (Req 7.6, 10.4)", () => {
    const handlers = makeHandlers();
    subscribeGroup("grp-1", handlers);

    const connect = pbConnectCallback();
    connect(); // initial mount connect
    handlers.onStatus.mockClear();

    // A drop with active subscriptions, then a reconnect.
    fakeRealtime.onDisconnect?.(["grp-1/progress"]);
    connect();

    expect(handlers.onReconnect).toHaveBeenCalledTimes(1);
    const statuses = handlers.onStatus.mock.calls.map((c) => c[0]);
    expect(statuses).toEqual(["reconnecting", "stale", "connected"]);
  });

  it("emits offline when a drop is not recovered within the bound (Req 7.7)", () => {
    const handlers = makeHandlers();
    subscribeGroup("grp-1", handlers);
    pbConnectCallback()(); // initial connect
    handlers.onStatus.mockClear();

    // Connection drops (active subscriptions => network interruption).
    fakeRealtime.onDisconnect?.(["grp-1/progress"]);
    expect(handlers.onStatus).toHaveBeenCalledWith("reconnecting");

    // Not recovered within the threshold => offline.
    vi.advanceTimersByTime(OFFLINE_THRESHOLD_MS);
    expect(handlers.onStatus).toHaveBeenCalledWith("offline");
  });

  it("does not emit offline if recovery happens before the bound (Req 7.6)", () => {
    const handlers = makeHandlers();
    subscribeGroup("grp-1", handlers);
    const connect = pbConnectCallback();
    connect(); // initial connect
    handlers.onStatus.mockClear();

    fakeRealtime.onDisconnect?.(["grp-1/progress"]);
    vi.advanceTimersByTime(OFFLINE_THRESHOLD_MS - 1);
    connect(); // reconnect just in time
    vi.advanceTimersByTime(1000);

    const statuses = handlers.onStatus.mock.calls.map((c) => c[0]);
    expect(statuses).not.toContain("offline");
  });

  it("ignores a clean disconnect (no active subscriptions)", () => {
    const handlers = makeHandlers();
    subscribeGroup("grp-1", handlers);
    pbConnectCallback()();
    handlers.onStatus.mockClear();

    // activeSubscriptions.length === 0 means our own teardown, not a drop.
    fakeRealtime.onDisconnect?.([]);

    expect(handlers.onStatus).not.toHaveBeenCalled();
  });

  it("stops status updates and restores the disconnect hook after unsubscribe", async () => {
    const previous = vi.fn();
    fakeRealtime.onDisconnect = previous;

    const handlers = makeHandlers();
    const subscription = subscribeGroup("grp-1", handlers);
    pbConnectCallback()();

    await subscription.unsubscribe();
    vi.runAllTimers();

    // The engine restored the prior onDisconnect hook on teardown.
    expect(fakeRealtime.onDisconnect).toBe(previous);
  });
});

// ---------------------------------------------------------------------------
// withLoadTimeout (Req 10.2)
// ---------------------------------------------------------------------------

describe("withLoadTimeout (Req 10.2)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes through a load that settles before the bound", async () => {
    const result = withLoadTimeout(Promise.resolve("ok"), LOAD_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toBe("ok");
  });

  it("rejects with LoadTimeoutError when the bound elapses (Req 10.2)", async () => {
    // A load that never settles.
    const result = withLoadTimeout(new Promise(() => {}), LOAD_TIMEOUT_MS);
    const assertion = expect(result).rejects.toBeInstanceOf(LoadTimeoutError);
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS);
    await assertion;
  });

  it("propagates a load rejection unchanged", async () => {
    const boom = new Error("boom");
    // A deferred so the underlying load has no rejection pending until
    // withLoadTimeout has already attached its handler — avoids a transient
    // unhandled-rejection warning under fake timers.
    let rejectLoad!: (err: unknown) => void;
    const load = new Promise<never>((_, reject) => {
      rejectLoad = reject;
    });
    const result = withLoadTimeout(load, LOAD_TIMEOUT_MS);
    const assertion = expect(result).rejects.toBe(boom);
    rejectLoad(boom);
    await vi.advanceTimersByTimeAsync(0);
    await assertion;
  });
});
