// lib/backend/sync.ts
//
// Sync_Engine — realtime subscriptions for the Group Reading Room (Req 7).
//
// This module replaces the three Supabase realtime channels that previously
// lived inline in the Group screen. PocketBase realtime subscribes per
// collection with a server-side filter scoped to the current group; any change
// to `progress`, `reading_sessions`, or `group_members` for that group triggers
// a `loadGroup()` reload on the screen, preserving the existing "reload on any
// change" model so delivered state always matches the backend (Req 7.1–7.4).
//
// On unmount the screen calls `unsubscribe()`, which tears every subscription
// down within 2 seconds (Req 7.5) — a direct port of the old `removeChannel`
// cleanup.
//
// Connection-status/offline handling (reconnect-reload, the `offline`/`stale`
// indicator, the 10-second bound, and the load-timeout helper) lives here
// (task 9.2). `subscribeGroup` watches the shared PocketBase realtime
// connection: a drop flips status to `reconnecting` and, if the connection is
// not re-established within 10 seconds, to `offline`; a (re)connect reissues
// `loadGroup()` via `onReconnect` to re-sync within 5 seconds (Req 7.6, 10.4)
// and emits `stale` until that reload lands, then `connected`. The
// {@link withLoadTimeout} helper bounds a load to 10 seconds so a stuck load
// stops and the screen can present a retry control (Req 10.2).

import {
  getBackend,
  groupMembersCollection,
  progressCollection,
  readingSessionsCollection,
} from "@/lib/backend/client";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The realtime connection states the Group screen branches on (Req 7.7, 10.1).
 *   - `connected`: realtime is live and delivering changes.
 *   - `reconnecting`: the connection dropped and is being re-established.
 *   - `offline`: no connection could be (re)established within the bound.
 *   - `stale`: connected again but the view may not yet reflect the backend.
 */
export type ConnectionStatus =
  | "connected"
  | "reconnecting"
  | "offline"
  | "stale";

/**
 * Handlers invoked by {@link subscribeGroup}. Each change handler is called on
 * any realtime event for its collection scoped to the current group; the Group
 * screen maps all three to a single `loadGroup()` reload (Req 7.2–7.4).
 *
 * `onStatus` reports connection transitions so the screen can show a
 * connection-status indicator and retain the last loaded state (Req 7.7, 10.1).
 *
 * `onReconnect` is invoked when realtime is (re)established after an
 * interruption; the screen reissues `loadGroup()` so the view re-syncs to the
 * latest backend state (Req 7.6, 10.4). It is NOT called for the very first
 * connection on mount — the screen already loads once on mount — only for
 * subsequent reconnections.
 */
export interface GroupSubscriptionHandlers {
  onProgressChange(): void;
  onSessionChange(): void;
  onMemberChange(): void;
  onStatus(status: ConnectionStatus): void;
  onReconnect(): void;
}

// ---------------------------------------------------------------------------
// Timing bounds (Req 7.6, 7.7, 10.2, 10.4)
// ---------------------------------------------------------------------------

/**
 * How long a lost connection may stay down before the screen declares realtime
 * unavailable (Req 7.7, 10.1). If the connection is not re-established within
 * this window the engine emits `offline`; a faster recovery emits `stale` and
 * then `connected` without ever surfacing the indicator.
 */
export const OFFLINE_THRESHOLD_MS = 10_000;

/**
 * The maximum time a single group load may run before it is abandoned so the
 * screen can present a retry control (Req 10.2). Used by {@link withLoadTimeout}.
 */
export const LOAD_TIMEOUT_MS = 10_000;

/**
 * The handle returned by {@link subscribeGroup}. Calling `unsubscribe()` tears
 * down every underlying realtime subscription; it resolves once all are torn
 * down (well within the 2-second unmount bound, Req 7.5) and is safe to call
 * more than once.
 */
export interface GroupSubscription {
  unsubscribe(): Promise<void>;
}

// A PocketBase realtime unsubscribe function: () => Promise<void>.
type UnsubscribeFunc = () => Promise<void>;

// ---------------------------------------------------------------------------
// subscribeGroup (Req 7.1–7.5)
// ---------------------------------------------------------------------------

/**
 * Subscribe to realtime changes for a single group's `progress`,
 * `reading_sessions`, and `group_members` records, filtered server-side to the
 * given `groupId` (Req 7.1). Every delivered change invokes the matching
 * handler, which the Group screen turns into a `loadGroup()` reload so the view
 * re-syncs to the backend (Req 7.2–7.4).
 *
 * Subscriptions are set up on all three collections with the wildcard topic
 * `"*"` (every record in the collection) narrowed by a `filter` so the backend
 * only pushes events for records belonging to this group:
 *   - `group_members`: `group = "{groupId}"` — direct relation to the group.
 *   - `reading_sessions`: `group = "{groupId}"` — direct relation to the group.
 *   - `progress`: `reading_session.group = "{groupId}"` — progress rows relate
 *     to the group through their reading session, so the filter traverses that
 *     relation.
 *
 * Setup is asynchronous (PocketBase returns a promise per `subscribe`), but the
 * call returns a {@link GroupSubscription} synchronously so the caller can wire
 * cleanup immediately. If the screen unmounts before setup completes,
 * `unsubscribe()` awaits the in-flight setup and then tears down whatever was
 * established, so no subscription is ever leaked (Req 7.5).
 *
 * @param groupId the id of the group whose records to watch
 * @param handlers change + status callbacks (see {@link GroupSubscriptionHandlers})
 * @returns a {@link GroupSubscription} whose `unsubscribe()` removes every
 *   subscription within the unmount bound (Req 7.5)
 */
export function subscribeGroup(
  groupId: string,
  handlers: GroupSubscriptionHandlers
): GroupSubscription {
  // Collected teardown functions, one per successful `subscribe`. Populated as
  // the setup promises resolve; drained by `unsubscribe()`.
  const unsubscribers: UnsubscribeFunc[] = [];

  // True once `unsubscribe()` has been called. If the screen unmounts before
  // setup finishes, any subscription that resolves afterward is torn down
  // immediately so it is never left dangling (Req 7.5).
  let cancelled = false;

  // --- Connection monitoring (Req 7.6, 7.7, 10.1, 10.4) -------------------
  //
  // PocketBase drives a single shared realtime (SSE) connection for every
  // subscription. We hook `realtime.onDisconnect` to notice interruptions and
  // the `PB_CONNECT` realtime event to notice (re)connection, mapping both to
  // the `ConnectionStatus` the screen branches on.
  const pb = getBackend();

  // Pending timer that flips the status to `offline` once a drop has lasted
  // `OFFLINE_THRESHOLD_MS` (Req 7.7). Cleared on reconnect or teardown.
  let offlineTimer: ReturnType<typeof setTimeout> | null = null;

  // Whether we have already seen the connection come up once. The first
  // `PB_CONNECT` is the initial mount connection — the screen loads on mount on
  // its own, so we only reload on *subsequent* reconnects (Req 7.6).
  let connectedOnce = false;

  // Whether the connection is currently considered down. Guards against
  // duplicate disconnect notifications restarting the offline timer.
  let down = false;

  // The previously saved PocketBase onDisconnect hook, restored on teardown so
  // we do not clobber another consumer's handler.
  const previousOnDisconnect = pb.realtime.onDisconnect;

  function clearOfflineTimer(): void {
    if (offlineTimer !== null) {
      clearTimeout(offlineTimer);
      offlineTimer = null;
    }
  }

  // A drop with active subscriptions means a network/server interruption (per
  // the SDK contract); a drop with none is our own teardown and is ignored.
  pb.realtime.onDisconnect = (activeSubscriptions) => {
    // Chain to any previously registered handler first.
    previousOnDisconnect?.(activeSubscriptions);

    if (cancelled || activeSubscriptions.length === 0) {
      return;
    }

    if (!down) {
      down = true;
      // The connection dropped: we are attempting to reconnect (Req 7.6). If it
      // does not come back within the bound, declare realtime unavailable
      // (Req 7.7) while retaining the last loaded state on the screen.
      handlers.onStatus("reconnecting");
      clearOfflineTimer();
      offlineTimer = setTimeout(() => {
        if (!cancelled) handlers.onStatus("offline");
      }, OFFLINE_THRESHOLD_MS);
    }
  };

  // `PB_CONNECT` fires on every (re)establishment of the realtime connection.
  // Subscribing to it also kicks the SSE connection open. On a *reconnect* we
  // flip to `stale` (connected again but the view may lag) and ask the screen
  // to reload so it re-syncs within 5 seconds (Req 7.6, 10.4), then report
  // `connected`.
  const connectSetup = pb.realtime
    .subscribe("PB_CONNECT", () => {
      if (cancelled) return;
      clearOfflineTimer();

      if (!connectedOnce) {
        // First connection on mount: the screen already loads once itself.
        connectedOnce = true;
        down = false;
        handlers.onStatus("connected");
        return;
      }

      // A genuine reconnect after an interruption.
      down = false;
      handlers.onStatus("stale");
      handlers.onReconnect();
      handlers.onStatus("connected");
    })
    .then(register);

  /**
   * Register a resolved unsubscribe function, or — if teardown already ran —
   * immediately unsubscribe so a late-arriving subscription does not leak.
   */
  function register(unsub: UnsubscribeFunc): void {
    if (cancelled) {
      // Fire-and-forget: teardown already happened, so drop this subscription.
      void unsub();
      return;
    }
    unsubscribers.push(unsub);
  }

  // progress — related to the group through reading_session.group (Req 7.1).
  const progressSetup = progressCollection()
    .subscribe("*", () => handlers.onProgressChange(), {
      filter: `reading_session.group = "${groupId}"`,
    })
    .then(register);

  // reading_sessions — directly related to the group (Req 7.1).
  const sessionSetup = readingSessionsCollection()
    .subscribe("*", () => handlers.onSessionChange(), {
      filter: `group = "${groupId}"`,
    })
    .then(register);

  // group_members — directly related to the group (Req 7.1).
  const memberSetup = groupMembersCollection()
    .subscribe("*", () => handlers.onMemberChange(), {
      filter: `group = "${groupId}"`,
    })
    .then(register);

  // All setup promises (the three collection subscriptions plus the PB_CONNECT
  // status subscription); `unsubscribe()` awaits these so a teardown that races
  // an in-flight setup still catches every subscription (Req 7.5).
  const setup = Promise.allSettled([
    progressSetup,
    sessionSetup,
    memberSetup,
    connectSetup,
  ]);

  return {
    async unsubscribe(): Promise<void> {
      cancelled = true;
      // Stop the offline timer and restore the realtime disconnect hook so the
      // teardown does not leak a timer or clobber another consumer's handler.
      clearOfflineTimer();
      pb.realtime.onDisconnect = previousOnDisconnect;
      // Wait for any in-flight setup to resolve so every subscription that will
      // exist has been registered before we drain the list.
      await setup;
      // Tear every subscription down. Draining the array as we go keeps the
      // call idempotent: a second `unsubscribe()` finds nothing left to remove.
      const pending = unsubscribers.splice(0, unsubscribers.length);
      await Promise.allSettled(pending.map((unsub) => unsub()));
    },
  };
}

// ---------------------------------------------------------------------------
// withLoadTimeout (Req 10.2)
// ---------------------------------------------------------------------------

/**
 * Thrown by {@link withLoadTimeout} when a load does not settle within the
 * bound. The screen catches this to stop waiting and present a retry control
 * (Req 10.2), distinguishing a timed-out load from an outright error.
 */
export class LoadTimeoutError extends Error {
  constructor(message = "The load took too long and was stopped.") {
    super(message);
    this.name = "LoadTimeoutError";
    Object.setPrototypeOf(this, LoadTimeoutError.prototype);
  }
}

/**
 * Race a load promise against a timeout. If `load` settles first its result (or
 * rejection) is passed through unchanged. If the timeout wins, the returned
 * promise rejects with a {@link LoadTimeoutError} so the caller can stop the
 * load attempt and surface a retry control (Req 10.2). The underlying `load`
 * promise is not cancelled — callers guard against applying a late result by
 * checking they are still mounted — but the timer is always cleared so it never
 * leaks.
 *
 * @param load the in-flight load promise
 * @param timeoutMs the bound in milliseconds (defaults to {@link LOAD_TIMEOUT_MS})
 */
export function withLoadTimeout<T>(
  load: Promise<T>,
  timeoutMs: number = LOAD_TIMEOUT_MS
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new LoadTimeoutError());
    }, timeoutMs);

    load.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}
