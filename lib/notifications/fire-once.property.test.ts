// Feature: native-desktop-migration, Property 10: Notification events fire at most once per key
//
// *For any* reading session, event type, and event key, and *for any* sequence
// of progress updates (including repeated crossings and oscillation for
// weekly-goal, and any interleaving of member updates for group-ready), the
// event is claimed — and therefore delivered — at most once for that
// `(reading_session, event_type, event_key)`.
//
// Validates: Requirements 8.1, 8.2
//
// -----------------------------------------------------------------------------
// What this test models
// -----------------------------------------------------------------------------
//
// The fire-once decision lives in the PocketBase hook on the `progress`
// collection (`pocketbase/pb_hooks/notification_events.pb.js`, task 10.2). The
// real enforcement is a unique composite index on
// `(reading_session, event_type, event_key)` in the `notification_events`
// collection (task 4.2): an event is "claimed" by INSERTing its row, and a
// second insert for the same key fails the unique index, which the hook treats
// as "already fired -> skip".
//
// Because the real claim runs inside PocketBase's record store, this test MOCKS
// the PocketBase SDK: `MockNotificationEventsCollection` is a minimal
// `notification_events` RecordService stand-in that models the unique composite
// index exactly as PocketBase would — a `create` that would duplicate an
// existing `(reading_session, event_type, event_key)` triple fails with a
// uniqueness `ClientResponseError` (HTTP 400, per-field index violation), which
// the claim path converts into "do not fire now".
//
// The hook's event-key derivation and claim-via-unique-index are re-implemented
// here as testable TS (`evaluateProgressWrite`), mirroring the hook:
//   - Weekly_Goal_Event (Req 8.1): fires when the actor's completed count
//     reaches/exceeds a positive `target` goal amount; keyed
//     `event_key = "{goalAmount}:{userId}"`.
//   - Group_Ready_Event (Req 8.2): fires when the group minimum completed count
//     is > 0; keyed `event_key = "{groupMin + 1}"` (the next progress point).
// A claim records a "fire" only when the unique index accepts the row, so the
// number of fires per key is exactly the number of successful claims.
//
// The property drives arbitrary sequences of progress writes (repeated
// crossings, oscillation, interleaved members) and asserts every distinct
// `(reading_session, event_type, event_key)` fires at most once.

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { ClientResponseError } from "pocketbase";

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Mock PocketBase `notification_events` collection (SDK mocked)
// ---------------------------------------------------------------------------

type EventType = "weekly_goal" | "group_ready";

/** A stored `notification_events` row (the fire-once ledger). */
interface MockNotificationEventRecord {
  id: string;
  reading_session: string;
  event_type: EventType;
  event_key: string;
}

/**
 * Thrown to mirror PocketBase's response when a `create` violates the
 * `(reading_session, event_type, event_key)` unique composite index. Shape
 * matches the SDK's {@link ClientResponseError} (HTTP 400 with per-field index
 * details) so the claim path cannot tell this mock apart from the real client.
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
 * Minimal stand-in for the PocketBase `notification_events` RecordService. It
 * models ONLY what Property 10 depends on: the
 * `(reading_session, event_type, event_key)` unique composite index enforced on
 * write. `create` refuses a row whose triple already exists (the index
 * violation); `count` reports how many rows exist for a triple (the invariant
 * under test — it must never exceed one).
 */
class MockNotificationEventsCollection {
  private readonly rows = new Map<string, MockNotificationEventRecord>();
  private nextId = 0;

  /** Composite key for the unique index: `(reading_session, event_type, event_key)`. */
  private static key(
    readingSession: string,
    eventType: EventType,
    eventKey: string
  ): string {
    // Length-prefix each leading component so no two distinct triples can
    // collide through string concatenation.
    return (
      `${readingSession.length}:${readingSession}\u0000` +
      `${eventType.length}:${eventType}\u0000` +
      eventKey
    );
  }

  /**
   * Claim an event by creating its ledger row. Mirrors PocketBase enforcing the
   * unique composite index: if a row already exists for the triple, the write
   * is rejected with a uniqueness error and the store is left unchanged
   * (Req 8.1, 8.2).
   */
  create(data: {
    reading_session: string;
    event_type: EventType;
    event_key: string;
  }): MockNotificationEventRecord {
    const key = MockNotificationEventsCollection.key(
      data.reading_session,
      data.event_type,
      data.event_key
    );
    if (this.rows.has(key)) {
      throw uniquenessViolation();
    }
    const record: MockNotificationEventRecord = {
      id: `evt_${this.nextId++}`,
      reading_session: data.reading_session,
      event_type: data.event_type,
      event_key: data.event_key,
    };
    this.rows.set(key, record);
    return record;
  }

  /** Rows stored for a `(reading_session, event_type, event_key)` triple. */
  count(
    readingSession: string,
    eventType: EventType,
    eventKey: string
  ): number {
    const key = MockNotificationEventsCollection.key(
      readingSession,
      eventType,
      eventKey
    );
    return this.rows.has(key) ? 1 : 0;
  }

  /** Total rows across every triple (for the global invariant check). */
  get size(): number {
    return this.rows.size;
  }
}

// ---------------------------------------------------------------------------
// Claim-once — mirrors `claimEvent` in notification_events.pb.js
// ---------------------------------------------------------------------------

/**
 * Attempt to claim an event by inserting its ledger row, mirroring the hook's
 * `claimEvent`. Returns `true` when the row was created (this call owns the
 * event and it fires), `false` when the unique index rejected it (already
 * fired) — or on any other failure, so a notification problem never fires a
 * duplicate.
 */
function claimEvent(
  col: MockNotificationEventsCollection,
  readingSession: string,
  eventType: EventType,
  eventKey: string
): boolean {
  try {
    col.create({
      reading_session: readingSession,
      event_type: eventType,
      event_key: eventKey,
    });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Event-key derivation + evaluation — mirrors evaluateNotifications in the hook
// ---------------------------------------------------------------------------

/** A single progress write: a member sets their completed count. */
interface ProgressWrite {
  session: string;
  user: string;
  value: number;
}

/** A reading session's goal configuration, as the hook reads from the session. */
interface SessionGoal {
  goalType: "target" | "none";
  goalAmount: number;
}

/**
 * Evaluate one committed progress write against the current per-session
 * completed counts, mirroring `evaluateNotifications` in
 * `notification_events.pb.js`. Mutates `progressByUser` to reflect the write
 * (the hook runs after the write commits), then evaluates both events, claiming
 * each via the unique index. A claim that succeeds is a "fire"; this records the
 * fired `(event_type, event_key)` so the caller can count fires per key.
 *
 * - Weekly_Goal_Event (Req 8.1): fires when the actor reaches/exceeds a positive
 *   `target` goal amount; `event_key = "{goalAmount}:{userId}"`.
 * - Group_Ready_Event (Req 8.2): fires when the group minimum completed count is
 *   > 0; `event_key = "{groupMin + 1}"`.
 */
function evaluateProgressWrite(
  col: MockNotificationEventsCollection,
  write: ProgressWrite,
  goal: SessionGoal,
  memberIds: readonly string[],
  progressByUser: Map<string, number>,
  onFire: (eventType: EventType, eventKey: string) => void
): void {
  // The write has committed; reflect it before reading session state.
  progressByUser.set(write.user, write.value);

  // ----- Weekly_Goal_Event (Req 8.1) -----
  if (goal.goalType === "target" && Number.isFinite(goal.goalAmount) && goal.goalAmount > 0) {
    const actorProgress = progressByUser.get(write.user) ?? 0;
    if (actorProgress >= goal.goalAmount) {
      const eventKey = `${goal.goalAmount}:${write.user}`;
      if (claimEvent(col, write.session, "weekly_goal", eventKey)) {
        onFire("weekly_goal", eventKey);
      }
    }
  }

  // ----- Group_Ready_Event (Req 8.2) -----
  if (memberIds.length > 0) {
    let groupMin = Infinity;
    for (const id of memberIds) {
      const value = progressByUser.get(id) ?? 0;
      if (value < groupMin) groupMin = value;
    }
    if (Number.isFinite(groupMin) && groupMin > 0) {
      const nextPoint = groupMin + 1;
      const eventKey = String(nextPoint);
      if (claimEvent(col, write.session, "group_ready", eventKey)) {
        onFire("group_ready", eventKey);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

// A small member pool so writes repeatedly target the same members, making
// repeated goal crossings and shared group-ready points (the interesting cases)
// frequent.
const MEMBER_POOL = ["u1", "u2", "u3"] as const;
const SESSION = "s1";

const memberArb = fc.constantFrom(...MEMBER_POOL);
// Values span below, at, and above plausible goal amounts so the actor
// oscillates across the goal threshold and the group minimum advances and
// retreats across progress points.
const valueArb = fc.integer({ min: 0, max: 8 });

const writeArb: fc.Arbitrary<ProgressWrite> = fc.record({
  session: fc.constant(SESSION),
  user: memberArb,
  value: valueArb,
});

const writeSequenceArb = fc.array(writeArb, { minLength: 1, maxLength: 60 });

const goalArb: fc.Arbitrary<SessionGoal> = fc.record({
  goalType: fc.constantFrom<SessionGoal["goalType"]>("target", "none"),
  goalAmount: fc.integer({ min: 0, max: 8 }),
});

// The population of members in the group (the completed-count population for the
// group-ready minimum). Always a non-empty subset of the pool.
const membersArb = fc
  .subarray([...MEMBER_POOL], { minLength: 1 })
  .map((m) => (m.length > 0 ? m : [MEMBER_POOL[0]]));

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe("Property 10: Notification events fire at most once per key", () => {
  // Validates: Requirements 8.1, 8.2 — for ANY sequence of progress writes
  // (repeated goal crossings, oscillation, interleaved members), every distinct
  // (reading_session, event_type, event_key) fires at most once.
  it("fires each (reading_session, event_type, event_key) at most once across any write sequence", () => {
    fc.assert(
      fc.property(
        writeSequenceArb,
        goalArb,
        membersArb,
        (writes, goal, members) => {
          const col = new MockNotificationEventsCollection();
          const progressByUser = new Map<string, number>();
          const fireCounts = new Map<string, number>();

          const record = (eventType: EventType, eventKey: string) => {
            const key = `${eventType}\u0000${eventKey}`;
            fireCounts.set(key, (fireCounts.get(key) ?? 0) + 1);
          };

          for (const write of writes) {
            evaluateProgressWrite(
              col,
              write,
              goal,
              members,
              progressByUser,
              record
            );
          }

          // No (event_type, event_key) ever fired more than once.
          for (const fires of fireCounts.values()) {
            expect(fires).toBeLessThanOrEqual(1);
          }

          // The ledger holds exactly one row per fired key and never more rows
          // than distinct keys fired — the unique index is the enforcement.
          expect(col.size).toBe(fireCounts.size);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // Validates: Requirement 8.1 — a member repeatedly crossing (and oscillating
  // across) the goal threshold raises the Weekly_Goal_Event for
  // "{goalAmount}:{userId}" exactly once.
  it("raises Weekly_Goal_Event once per (goalAmount, member) despite repeated crossings and oscillation", () => {
    fc.assert(
      fc.property(
        memberArb,
        fc.integer({ min: 1, max: 8 }),
        fc.array(valueArb, { minLength: 1, maxLength: 30 }),
        (user, goalAmount, values) => {
          const col = new MockNotificationEventsCollection();
          const progressByUser = new Map<string, number>();
          let fires = 0;
          const eventKey = `${goalAmount}:${user}`;

          // At least one write must reach the goal for a fire to be possible.
          const reachesGoal = values.some((v) => v >= goalAmount);

          for (const value of values) {
            evaluateProgressWrite(
              col,
              { session: SESSION, user, value },
              { goalType: "target", goalAmount },
              [user],
              progressByUser,
              (eventType, key) => {
                if (eventType === "weekly_goal" && key === eventKey) fires++;
              }
            );
          }

          expect(fires).toBe(reachesGoal ? 1 : 0);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // Validates: Requirement 8.2 — once every member has advanced past a shared
  // progress point, that Group_Ready_Event key fires exactly once regardless of
  // the interleaving of member updates that got them there.
  it("raises Group_Ready_Event once per shared progress point across any member interleaving", () => {
    fc.assert(
      fc.property(
        fc.array(writeArb, { minLength: 1, maxLength: 60 }),
        (writes) => {
          const members = [...MEMBER_POOL];
          const col = new MockNotificationEventsCollection();
          const progressByUser = new Map<string, number>();
          const groupReadyFires = new Map<string, number>();

          for (const write of writes) {
            evaluateProgressWrite(
              col,
              write,
              { goalType: "none", goalAmount: 0 },
              members,
              progressByUser,
              (eventType, key) => {
                if (eventType === "group_ready") {
                  groupReadyFires.set(key, (groupReadyFires.get(key) ?? 0) + 1);
                }
              }
            );
          }

          for (const fires of groupReadyFires.values()) {
            expect(fires).toBe(1);
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
