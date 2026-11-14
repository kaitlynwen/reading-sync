// Integration test (Task 16.2): end-to-end native notification delivery.
//
// Exercises the FULL native-notification path end to end with the native layers
// mocked, wiring together the three pieces built in tasks 10.1/10.2/10.3:
//
//   1. the fire-once claim (the `notification_events` unique composite index on
//      `(reading_session, event_type, event_key)`), mirrored from the PocketBase
//      hook `pocketbase/pb_hooks/notification_events.pb.js` (task 10.2),
//   2. event-content derivation + `buildNotificationContent` (task 10.1),
//   3. `deliver()` turning an event into a native OS notification via the Tauri
//      `sendNotification` plugin (task 10.1),
//
// gated by the member's `notification_subscriptions` state (task 10.1).
//
// The end-to-end property under test (the task's acceptance criterion):
//
//   A subscribed member + a triggering progress event results in EXACTLY ONE
//   native OS notification firing, with COMPLETE content (member + goal for a
//   Weekly_Goal_Event, or book title + next unit for a Group_Ready_Event), and a
//   SECOND identical trigger does NOT notify again (fire-once via the
//   notification_events unique index / claim logic).
//
// Both native boundaries are mocked:
//   - `@tauri-apps/plugin-notification` — the OS notification plugin; the
//     `sendNotification` spy is the observable "a native OS notification fired"
//     signal, and the permission entry points are stubbed granted.
//   - the PocketBase SDK — through the Backend_Client accessors
//     `notificationEventsCollection` (the fire-once ledger, modelling the unique
//     index exactly as PocketBase would) and `notificationSubscriptionsCollection`
//     (the subscription gate).
//
// Validates: Requirements 8.1, 8.2, 8.3, 8.4

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientResponseError } from "pocketbase";

// ---------------------------------------------------------------------------
// Native OS notification plugin mock (the Desktop_Shell boundary)
// ---------------------------------------------------------------------------
//
// `sendNotification` is synchronous (returns void) in the Tauri plugin; every
// call is one native OS notification fired. Permission is stubbed granted so the
// gate opens on subscription state alone.
const sendNative = vi.fn<(options: { title: string; body?: string }) => void>();

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: () => Promise.resolve(true),
  requestPermission: () => Promise.resolve("granted"),
  sendNotification: (options: { title: string; body?: string }) =>
    sendNative(options),
}));

// ---------------------------------------------------------------------------
// PocketBase SDK mock — notification_events ledger + subscriptions
// ---------------------------------------------------------------------------

type EventType = "weekly_goal" | "group_ready";

interface EventRow {
  id: string;
  reading_session: string;
  event_type: EventType;
  event_key: string;
}

/**
 * Mirror of PocketBase's response when a `create` violates the
 * `(reading_session, event_type, event_key)` unique composite index on
 * `notification_events`. Shape matches the SDK's {@link ClientResponseError}
 * (HTTP 400, per-field index violation) so the claim path cannot tell this mock
 * apart from the real client.
 */
function uniquenessViolation(): ClientResponseError {
  return new ClientResponseError({
    status: 400,
    response: {
      code: 400,
      message: "Failed to create record.",
      data: {
        event_key: {
          code: "validation_not_unique",
          message: "Value must be unique.",
        },
      },
    },
  });
}

/**
 * In-memory `notification_events` RecordService stand-in. Models ONLY the
 * fire-once contract this integration depends on: the unique composite index
 * enforced on write. A `create` whose triple already exists is rejected exactly
 * as PocketBase would (uniqueness error); the store is left unchanged.
 */
class EventsCollection {
  readonly rows: EventRow[] = [];
  private nextId = 0;

  private key(r: { reading_session: string; event_type: EventType; event_key: string }): string {
    return `${r.reading_session.length}:${r.reading_session}\u0000${r.event_type.length}:${r.event_type}\u0000${r.event_key}`;
  }

  create(data: {
    reading_session: string;
    event_type: EventType;
    event_key: string;
  }): Promise<EventRow> {
    const k = this.key(data);
    if (this.rows.some((row) => this.key(row) === k)) {
      return Promise.reject(uniquenessViolation());
    }
    const record: EventRow = { id: `evt_${this.nextId++}`, ...data };
    this.rows.push(record);
    return Promise.resolve(record);
  }
}

type SubRow = { id: string; user: string; subscribed: boolean };

class NotFoundError extends Error {
  status = 404;
}

/**
 * In-memory `notification_subscriptions` RecordService stand-in: at most one row
 * per user, matching `getFirstListItem` (throws 404 when absent) / `create` /
 * `update` semantics the service's subscription helpers rely on.
 */
class SubscriptionsCollection {
  private readonly rows = new Map<string, SubRow>();
  private nextId = 1;

  getFirstListItem(filter: string): Promise<SubRow> {
    const match = filter.match(/"(.*)"/);
    const userId = match ? JSON.parse(`"${match[1]}"`) : "";
    const row = this.rows.get(userId);
    if (!row) return Promise.reject(new NotFoundError("no rows"));
    return Promise.resolve(row);
  }

  create(data: { user: string; subscribed: boolean }): Promise<SubRow> {
    const row: SubRow = { id: `sub${this.nextId++}`, ...data };
    this.rows.set(data.user, row);
    return Promise.resolve(row);
  }

  update(id: string, data: { subscribed: boolean }): Promise<SubRow> {
    for (const row of this.rows.values()) {
      if (row.id === id) {
        row.subscribed = data.subscribed;
        return Promise.resolve(row);
      }
    }
    return Promise.reject(new NotFoundError("no such id"));
  }
}

const eventsCollection = new EventsCollection();
const subscriptionsCollection = new SubscriptionsCollection();

vi.mock("@/lib/backend/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/backend/client")>(
    "@/lib/backend/client"
  );
  return {
    ...actual,
    notificationEventsCollection: () => eventsCollection,
    notificationSubscriptionsCollection: () => subscriptionsCollection,
  };
});

import {
  buildNotificationContent,
  deliver,
  isSubscribed,
  setSubscribed,
  type NotifEvent,
} from "./service";
import {
  notificationEventsCollection,
  type NotificationEventRecord,
} from "@/lib/backend/client";

// ---------------------------------------------------------------------------
// The wiring under test — the end-to-end native notification path
// ---------------------------------------------------------------------------
//
// This mirrors the real flow: the backend hook claims an event via the unique
// index and streams it to subscribed clients, which then render + deliver it as
// a native OS notification. Here we exercise that same claim -> content ->
// deliver path through the real `deliver()` / `buildNotificationContent`, with
// the subscription gate the client applies before delivering.

type GoalLabelSource = {
  progressType: "chapters" | "pages" | "milestones" | "sections";
  readingUnits?: { order_index: number; label: string }[];
};

/**
 * The human-readable goal label, mirroring `getGoalLabel` in the hook: pages ->
 * "Page N"; milestones/sections -> the custom unit label at `order_index === N`
 * (falling back to "Milestone N"/"Section N"); chapters -> "Chapter N".
 */
function goalLabel(amount: number, src: GoalLabelSource): string {
  if (src.progressType === "pages") return `Page ${amount}`;
  if (src.progressType === "milestones" || src.progressType === "sections") {
    const unit = (src.readingUnits ?? []).find(
      (u) => Number(u.order_index) === Number(amount)
    );
    if (unit) return unit.label;
    return `${src.progressType === "sections" ? "Section" : "Milestone"} ${amount}`;
  }
  return `Chapter ${amount}`;
}

/** The next-unit noun, mirroring `getProgressNoun` in the hook. */
function progressNoun(progressType: GoalLabelSource["progressType"]): string {
  if (progressType === "pages") return "page";
  if (progressType === "milestones") return "milestone";
  if (progressType === "sections") return "section";
  return "chapter";
}

/**
 * Claim an event via the `notification_events` unique index, mirroring
 * `claimEvent` in the hook: returns true when this call created the ledger row
 * (the event fires), false when the unique index rejected it (already fired) or
 * on any other failure (so a problem never fires a duplicate).
 */
async function claimEvent(
  readingSession: string,
  eventType: EventType,
  eventKey: string
): Promise<boolean> {
  try {
    const col = notificationEventsCollection();
    await col.create({
      reading_session: readingSession,
      event_type: eventType,
      event_key: eventKey,
    } as Partial<NotificationEventRecord>);
    return true;
  } catch {
    return false;
  }
}

/**
 * The full end-to-end path for a single subscribed recipient reacting to a
 * triggering event: claim it fire-once via the unique index, and only on a
 * successful (first) claim derive its content and deliver a native OS
 * notification — gated on the recipient's subscription state. Returns true when
 * a native notification was actually dispatched.
 */
async function processEvent(args: {
  recipientId: string;
  readingSession: string;
  eventType: EventType;
  eventKey: string;
  event: NotifEvent;
}): Promise<boolean> {
  // Gate: never deliver to an unsubscribed member (Req 8.6 context).
  if (!(await isSubscribed(args.recipientId))) return false;

  // Fire-once: a second identical trigger loses the claim and never delivers.
  const claimed = await claimEvent(
    args.readingSession,
    args.eventType,
    args.eventKey
  );
  if (!claimed) return false;

  return deliver(args.event);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SESSION = "session_1";
const MEMBER_ID = "user_ada";
const MEMBER_NAME = "Ada";
const GOAL_AMOUNT = 12;
const BOOK_TITLE = "Dune";

beforeEach(async () => {
  eventsCollection.rows.length = 0;
  sendNative.mockReset();
  sendNative.mockImplementation(() => {});
  // A subscribed recipient (permission granted path leads here).
  await setSubscribed(MEMBER_ID, true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("end-to-end native notification delivery (Req 8.1, 8.2, 8.3, 8.4)", () => {
  it("fires exactly one weekly-goal notification with complete content, and a second identical trigger does not notify again (Req 8.1, 8.3)", async () => {
    // A subscribed member reaches the goal — the triggering progress event.
    const eventKey = `${GOAL_AMOUNT}:${MEMBER_ID}`;
    const event: NotifEvent = {
      kind: "weekly_goal",
      member: MEMBER_NAME,
      goalLabel: goalLabel(GOAL_AMOUNT, { progressType: "chapters" }),
    };
    const trigger = () =>
      processEvent({
        recipientId: MEMBER_ID,
        readingSession: SESSION,
        eventType: "weekly_goal",
        eventKey,
        event,
      });

    // First trigger: fires once.
    const first = await trigger();
    // Second IDENTICAL trigger: the unique index rejects the re-claim, so no
    // further notification fires (fire-once, Req 8.1).
    const second = await trigger();

    expect(first).toBe(true);
    expect(second).toBe(false);

    // Exactly one native OS notification fired across BOTH triggers.
    expect(sendNative).toHaveBeenCalledTimes(1);

    // Complete content: it identifies the member and the goal amount (Req 8.3).
    const options = sendNative.mock.calls[0][0];
    expect(options.title).not.toBe("");
    expect(options.body).toContain(MEMBER_NAME);
    expect(options.body).toContain("Chapter 12");
    // And the delivered content matches what buildNotificationContent produces.
    expect(options).toEqual(buildNotificationContent(event));

    // The ledger holds exactly one claimed row for this key.
    expect(eventsCollection.rows).toHaveLength(1);
  });

  it("fires exactly one group-ready notification with complete content, and a second identical trigger does not notify again (Req 8.2, 8.4)", async () => {
    // Every member has reached a shared progress point -> next unit is chapter 5.
    const nextPoint = 5;
    const eventKey = String(nextPoint);
    const event: NotifEvent = {
      kind: "group_ready",
      bookTitle: BOOK_TITLE,
      nextUnitLabel: `${progressNoun("chapters")} ${nextPoint}`,
    };
    const trigger = () =>
      processEvent({
        recipientId: MEMBER_ID,
        readingSession: SESSION,
        eventType: "group_ready",
        eventKey,
        event,
      });

    const first = await trigger();
    const second = await trigger();

    expect(first).toBe(true);
    expect(second).toBe(false);

    // Exactly one native OS notification across both identical triggers.
    expect(sendNative).toHaveBeenCalledTimes(1);

    // Complete content: book title + next unit (Req 8.4).
    const options = sendNative.mock.calls[0][0];
    expect(options.title).not.toBe("");
    expect(options.body).toContain(BOOK_TITLE);
    expect(options.body).toContain("chapter 5");
    expect(options).toEqual(buildNotificationContent(event));

    expect(eventsCollection.rows).toHaveLength(1);
  });

  it("delivers one weekly-goal AND one group-ready notification end to end, each fire-once (Req 8.1-8.4)", async () => {
    const weekly: NotifEvent = {
      kind: "weekly_goal",
      member: MEMBER_NAME,
      goalLabel: goalLabel(GOAL_AMOUNT, { progressType: "chapters" }),
    };
    const groupReady: NotifEvent = {
      kind: "group_ready",
      bookTitle: BOOK_TITLE,
      nextUnitLabel: `${progressNoun("chapters")} 5`,
    };

    // Fire both distinct events, then re-fire both identically.
    const w1 = await processEvent({
      recipientId: MEMBER_ID,
      readingSession: SESSION,
      eventType: "weekly_goal",
      eventKey: `${GOAL_AMOUNT}:${MEMBER_ID}`,
      event: weekly,
    });
    const g1 = await processEvent({
      recipientId: MEMBER_ID,
      readingSession: SESSION,
      eventType: "group_ready",
      eventKey: "5",
      event: groupReady,
    });
    const w2 = await processEvent({
      recipientId: MEMBER_ID,
      readingSession: SESSION,
      eventType: "weekly_goal",
      eventKey: `${GOAL_AMOUNT}:${MEMBER_ID}`,
      event: weekly,
    });
    const g2 = await processEvent({
      recipientId: MEMBER_ID,
      readingSession: SESSION,
      eventType: "group_ready",
      eventKey: "5",
      event: groupReady,
    });

    expect([w1, g1]).toEqual([true, true]);
    expect([w2, g2]).toEqual([false, false]);

    // Two distinct notifications fired total: one per distinct event key.
    expect(sendNative).toHaveBeenCalledTimes(2);
    const bodies = sendNative.mock.calls.map((c) => c[0].body ?? "");
    expect(bodies.some((b) => b.includes(MEMBER_NAME) && b.includes("Chapter 12"))).toBe(true);
    expect(bodies.some((b) => b.includes(BOOK_TITLE) && b.includes("chapter 5"))).toBe(true);
    expect(eventsCollection.rows).toHaveLength(2);
  });

  it("does not fire a native notification for an unsubscribed recipient even on a triggering event (Req 8.3, 8.4 gate)", async () => {
    await setSubscribed(MEMBER_ID, false);

    const fired = await processEvent({
      recipientId: MEMBER_ID,
      readingSession: SESSION,
      eventType: "weekly_goal",
      eventKey: `${GOAL_AMOUNT}:${MEMBER_ID}`,
      event: {
        kind: "weekly_goal",
        member: MEMBER_NAME,
        goalLabel: "Chapter 12",
      },
    });

    expect(fired).toBe(false);
    expect(sendNative).not.toHaveBeenCalled();
    // The gate short-circuits before any claim is attempted.
    expect(eventsCollection.rows).toHaveLength(0);
  });
});
