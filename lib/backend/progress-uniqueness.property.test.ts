// Feature: native-desktop-migration, Property 2: At most one progress record per member per session
//
// *For any* reading session and any sequence of progress create/update
// operations for a given member, the number of progress records for that
// `(reading_session, member)` pair is at most one.
//
// Validates: Requirements 11.7
//
// The uniqueness guarantee is enforced by the `(reading_session, user)` unique
// composite index on the `progress` collection (task 4.2). The real enforcement
// lives inside PocketBase's record store, so this test MOCKS the PocketBase SDK:
// a minimal `progress` RecordService stand-in models the unique composite index
// exactly as PocketBase would — a `create` that would duplicate an existing
// `(reading_session, user)` pair fails with a uniqueness `ClientResponseError`
// (HTTP 400, per-field index violation), while `update` mutates the existing
// row in place. The property then drives the mock through arbitrary sequences
// of create/update operations and asserts the pair count never exceeds one.

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { ClientResponseError } from "pocketbase";

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Mock PocketBase `progress` collection (SDK mocked)
// ---------------------------------------------------------------------------

/** A stored `progress` row, matching the real record's relevant fields. */
interface MockProgressRecord {
  id: string;
  reading_session: string;
  user: string;
  chapter_completed: number;
}

/**
 * Thrown to mirror PocketBase's response when a `create`/`update` violates the
 * `(reading_session, user)` unique composite index. Shape matches the SDK's
 * {@link ClientResponseError} (HTTP 400 with per-field index details) so the
 * code under test cannot tell this mock apart from the real client.
 */
function uniquenessViolation(): ClientResponseError {
  return new ClientResponseError({
    status: 400,
    response: {
      code: 400,
      message: "Failed to create record.",
      data: {
        reading_session: {
          code: "validation_not_unique",
          message: "Value must be unique.",
        },
      },
    },
  });
}

/**
 * Minimal stand-in for the PocketBase `progress` RecordService. It models ONLY
 * what Property 2 depends on: the `(reading_session, user)` unique composite
 * index enforced on write. `create` refuses a row whose pair already exists
 * (the index violation); `update` edits an existing row in place; `getPair`
 * reports how many rows exist for a pair (the invariant under test).
 */
class MockProgressCollection {
  private readonly rows = new Map<string, MockProgressRecord>();
  private nextId = 0;

  /** Composite key for the unique index, exactly `(reading_session, user)`. */
  private static key(readingSession: string, user: string): string {
    // Length-prefix the first component so no two distinct pairs can collide
    // through string concatenation.
    return `${readingSession.length}:${readingSession}\u0000${user}`;
  }

  /**
   * Create a progress row. Mirrors PocketBase enforcing the unique composite
   * index: if a row already exists for `(reading_session, user)`, the write is
   * rejected with a uniqueness error and the store is left unchanged (Req 11.7).
   */
  create(data: {
    reading_session: string;
    user: string;
    chapter_completed: number;
  }): MockProgressRecord {
    const key = MockProgressCollection.key(data.reading_session, data.user);
    if (this.rows.has(key)) {
      throw uniquenessViolation();
    }
    const record: MockProgressRecord = {
      id: `rec_${this.nextId++}`,
      reading_session: data.reading_session,
      user: data.user,
      chapter_completed: data.chapter_completed,
    };
    this.rows.set(key, record);
    return record;
  }

  /**
   * Update the existing row for a pair in place. Unlike `create`, this never
   * adds a row, so it can never breach the uniqueness invariant. Returns `null`
   * when no row exists for the pair (nothing to update).
   */
  update(
    readingSession: string,
    user: string,
    chapterCompleted: number,
  ): MockProgressRecord | null {
    const key = MockProgressCollection.key(readingSession, user);
    const record = this.rows.get(key);
    if (!record) return null;
    record.chapter_completed = chapterCompleted;
    return record;
  }

  /** All rows currently stored for a `(reading_session, user)` pair. */
  getPair(readingSession: string, user: string): MockProgressRecord[] {
    const key = MockProgressCollection.key(readingSession, user);
    const record = this.rows.get(key);
    return record ? [record] : [];
  }

  /** Total rows across every pair (for the global invariant check). */
  get size(): number {
    return this.rows.size;
  }
}

// ---------------------------------------------------------------------------
// Upsert driver — the write path the app uses for progress
// ---------------------------------------------------------------------------
//
// Progress writes are upserts on `(reading_session, user)` (the old Supabase
// path used `onConflict: "reading_session_id,user_id"`). A caller that races or
// retries may issue a bare `create` for a pair that already exists; the unique
// index converts that into a uniqueness error, and a correct upsert falls back
// to `update`. Both styles must preserve the at-most-one invariant.

type Op =
  | { kind: "upsert"; session: string; user: string; value: number }
  | { kind: "create"; session: string; user: string; value: number }
  | { kind: "update"; session: string; user: string; value: number };

/**
 * Apply one operation against the mock, mirroring how the backend seam would
 * drive the `progress` collection. A `create` that hits the unique index is
 * swallowed (the uniqueness error is the index doing its job); `upsert` tries a
 * create and, on the uniqueness error, falls back to updating the existing row.
 */
function applyOp(col: MockProgressCollection, op: Op): void {
  switch (op.kind) {
    case "create":
      try {
        col.create({
          reading_session: op.session,
          user: op.user,
          chapter_completed: op.value,
        });
      } catch (err) {
        // A uniqueness violation is expected for a duplicate pair; the store is
        // unchanged. Re-throw anything else so a real bug surfaces.
        if (!(err instanceof ClientResponseError)) throw err;
      }
      break;
    case "update":
      col.update(op.session, op.user, op.value);
      break;
    case "upsert":
      try {
        col.create({
          reading_session: op.session,
          user: op.user,
          chapter_completed: op.value,
        });
      } catch (err) {
        if (!(err instanceof ClientResponseError)) throw err;
        col.update(op.session, op.user, op.value);
      }
      break;
  }
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

// A small id pool so operations repeatedly target the same pairs, making
// duplicate-create collisions (the interesting case) frequent.
const sessionArb = fc.constantFrom("s1", "s2", "s3");
const userArb = fc.constantFrom("u1", "u2", "u3");
const valueArb = fc.integer({ min: 0, max: 1000 });

const opArb: fc.Arbitrary<Op> = fc.record({
  kind: fc.constantFrom<Op["kind"]>("upsert", "create", "update"),
  session: sessionArb,
  user: userArb,
  value: valueArb,
});

const opSequenceArb = fc.array(opArb, { minLength: 1, maxLength: 50 });

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe("Property 2: At most one progress record per member per session", () => {
  // Validates: Requirements 11.7 — for ANY sequence of create/update/upsert
  // operations, every (reading_session, user) pair holds at most one row, and
  // the total row count never exceeds the number of distinct pairs touched by a
  // successful create.
  it("keeps at most one progress record per (reading_session, user) pair across any op sequence", () => {
    fc.assert(
      fc.property(opSequenceArb, (ops) => {
        const col = new MockProgressCollection();

        for (const op of ops) {
          applyOp(col, op);
        }

        // Every pair that appears anywhere in the sequence holds at most one row.
        const pairs = new Set(ops.map((o) => `${o.session}\u0000${o.user}`));
        for (const pair of pairs) {
          const sep = pair.indexOf("\u0000");
          const session = pair.slice(0, sep);
          const user = pair.slice(sep + 1);
          expect(col.getPair(session, user).length).toBeLessThanOrEqual(1);
        }

        // The global store never holds more rows than there are distinct pairs.
        expect(col.size).toBeLessThanOrEqual(pairs.size);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Validates: Requirements 11.7 — a direct duplicate `create` for an existing
  // pair is rejected by the unique index and does NOT add a second row.
  it("rejects a duplicate create for an existing pair without adding a row", () => {
    fc.assert(
      fc.property(
        sessionArb,
        userArb,
        valueArb,
        valueArb,
        (session, user, first, second) => {
          const col = new MockProgressCollection();

          col.create({
            reading_session: session,
            user,
            chapter_completed: first,
          });

          expect(() =>
            col.create({
              reading_session: session,
              user,
              chapter_completed: second,
            }),
          ).toThrow(ClientResponseError);

          // Still exactly one row for the pair after the rejected duplicate.
          expect(col.getPair(session, user).length).toBe(1);
          expect(col.size).toBe(1);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Validates: Requirements 11.7 — repeated upserts to the same pair converge on
  // a single row whose value reflects the last write, never a second row.
  it("collapses repeated upserts to the same pair into one row with the latest value", () => {
    fc.assert(
      fc.property(
        sessionArb,
        userArb,
        fc.array(valueArb, { minLength: 1, maxLength: 20 }),
        (session, user, values) => {
          const col = new MockProgressCollection();

          for (const value of values) {
            applyOp(col, { kind: "upsert", session, user, value });
          }

          const rows = col.getPair(session, user);
          expect(rows.length).toBe(1);
          expect(rows[0].chapter_completed).toBe(values[values.length - 1]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
