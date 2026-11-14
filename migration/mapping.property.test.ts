// Feature: native-desktop-migration, Property 18: Migration preserves fields and relationships
//
// *For any* valid source dataset of Supabase groups, members, reading sessions,
// reading units, and progress records, migrating it produces PocketBase records
// whose mapped fields (criteria 11.1–11.5) equal the source values and whose
// referential relationships are preserved; and if a source record is missing a
// required field, that record's migration halts with an error identifying the
// record and field while every already-migrated record remains intact.
//
// Validates: Requirements 11.8, 11.9
//
// -----------------------------------------------------------------------------
// What this test exercises
// -----------------------------------------------------------------------------
//
// The field-preservation and halt-on-unmappable logic lives in the pure mapping
// core (`migration/mapping.ts`, task 15.1): each `map*` function takes a source
// record (+ the id-remap table) and either returns the PocketBase payload with
// field values preserved and relation ids remapped, or throws a
// `RecordHaltError` naming the offending record and field. The runner
// (`migration/runner.ts`) sequences those mappers, remaps ids, and — on a halt —
// records it and CONTINUES so already-migrated records stay intact.
//
// This test drives the pure core through `runMigration` against the
// `InMemorySink` (no live backend). `InMemorySink` assigns deterministic
// synthetic target ids (`<collection>_<n>`) and records every payload written,
// so both field values AND the remapped relationship ids can be asserted
// directly.
//
// Two properties:
//   1. Preservation — a VALID dataset migrates with zero halts; every target
//      record preserves its source field values (11.1–11.5) and every relation
//      resolves, via the id-remap table, to the target id of the correct source
//      record (referential integrity).
//   2. Halt-on-unmappable — blanking one required field on one record halts
//      exactly that record (reported with collection + sourceId + field), while
//      every other (valid) record still migrates and the already-written
//      records are left intact.

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { runMigration, InMemorySink } from "./index";
import type {
  SourceDataset,
  SourceGroup,
  SourceGroupMember,
  SourceProgress,
  SourceReadingSession,
  SourceUser,
  TargetGroup,
  TargetGroupMember,
  TargetProgress,
  TargetReadingSession,
} from "./types";

const NUM_RUNS = 100;

const PROGRESS_TYPES = ["chapters", "pages", "milestones", "sections"] as const;

// ---------------------------------------------------------------------------
// Target record shapes as stored by InMemorySink (payload + synthetic id)
// ---------------------------------------------------------------------------

type StoredGroup = TargetGroup & { id: string };
type StoredGroupMember = TargetGroupMember & { id: string };
type StoredReadingSession = TargetReadingSession & { id: string };
type StoredProgress = TargetProgress & { id: string };

// ---------------------------------------------------------------------------
// Arbitraries — generate a consistent, VALID source dataset
// ---------------------------------------------------------------------------
//
// Ids are made unique per collection by suffixing a running index, so relation
// references always resolve to exactly one record. Field values are generated
// strictly within the ranges the mapper enforces (Req 11.1–11.5) so a baseline
// dataset migrates with zero halts; individual required fields are blanked only
// in the halt property.

/** A non-empty string whose trimmed, raw length both fall within [min, max]. */
function textArb(min: number, max: number): fc.Arbitrary<string> {
  return fc
    .string({ minLength: min, maxLength: max })
    .map((s) => {
      // Ensure at least one non-whitespace char and keep within bounds.
      const base = s.replace(/\s/g, "x");
      const filled = base.length >= min ? base : base.padEnd(min, "x");
      return filled.slice(0, max);
    })
    .filter((s) => s.trim().length > 0 && s.length >= min && s.length <= max);
}

const inviteCodeArb = textArb(6, 32);

const readingUnitArb = (orderIndex: number) =>
  fc.record({
    label: fc.string({ minLength: 1, maxLength: 40 }),
    order_index: fc.constant(orderIndex),
  });

/**
 * A full valid source dataset. Each collection's ids are generated independently
 * and then wired so every relation points at a real record:
 *   - members reference a real user + group
 *   - sessions reference a real group
 *   - progress references a real session + user, with completed <= session total
 */
const datasetArb: fc.Arbitrary<SourceDataset> = fc
  .record({
    userCount: fc.integer({ min: 1, max: 4 }),
    groupCount: fc.integer({ min: 1, max: 3 }),
  })
  .chain(({ userCount, groupCount }) => {
    const users: SourceUser[] = Array.from({ length: userCount }, (_, i) => ({
      id: `user-${i}`,
      email: `u${i}@example.com`,
    }));
    const userIds = users.map((u) => u.id);

    const groupsArb = fc.tuple(
      ...Array.from({ length: groupCount }, (_, i) =>
        fc.record({
          id: fc.constant(`group-${i}`),
          name: textArb(1, 200),
          invite_code: inviteCodeArb,
        })
      )
    ) as fc.Arbitrary<SourceGroup[]>;

    return groupsArb.chain((groups) => {
      const groupIds = groups.map((g) => g.id);

      // Members: 0..2 per group, each with a real user.
      const membersArb = fc
        .array(
          fc.record({
            userIndex: fc.integer({ min: 0, max: userCount - 1 }),
            groupIndex: fc.integer({ min: 0, max: groupCount - 1 }),
            display_name: textArb(1, 100),
          }),
          { minLength: 0, maxLength: 6 }
        )
        .map((rows) =>
          rows.map(
            (r, i): SourceGroupMember => ({
              id: `member-${i}`,
              user_id: userIds[r.userIndex],
              group_id: groupIds[r.groupIndex],
              display_name: r.display_name,
            })
          )
        );

      // Sessions: 0..3, each in a real group, with ordered reading units.
      const sessionsArb = fc
        .array(
          fc.record({
            groupIndex: fc.integer({ min: 0, max: groupCount - 1 }),
            book_title: textArb(1, 300),
            total_chapters: fc.integer({ min: 1, max: 100000 }),
            progress_type: fc.constantFrom(...PROGRESS_TYPES),
            is_active: fc.boolean(),
            cover_url: fc.option(fc.webUrl(), { nil: null }),
            goal_type: fc.option(fc.constantFrom("target", "pace"), { nil: null }),
            goal_amount: fc.option(fc.integer({ min: 1, max: 100000 }), { nil: null }),
            goal_unit: fc.option(fc.string({ maxLength: 20 }), { nil: null }),
            unitCount: fc.integer({ min: 0, max: 5 }),
          }),
          { minLength: 0, maxLength: 4 }
        )
        .chain((rows) =>
          fc
            .tuple(
              ...rows.map((r) =>
                fc.tuple(
                  ...Array.from({ length: r.unitCount }, (_, k) => readingUnitArb(k))
                )
              )
            )
            .map((unitArrays) =>
              rows.map(
                (r, i): SourceReadingSession => ({
                  id: `session-${i}`,
                  group_id: groupIds[r.groupIndex],
                  book_title: r.book_title,
                  total_chapters: r.total_chapters,
                  progress_type: r.progress_type,
                  is_active: r.is_active,
                  cover_url: r.cover_url,
                  goal_type: r.goal_type,
                  goal_amount: r.goal_amount,
                  goal_unit: r.goal_unit,
                  reading_units: unitArrays[i],
                  created_at: "2026-01-01T00:00:00Z",
                })
              )
            )
        );

      return fc.tuple(membersArb, sessionsArb).chain(([groupMembers, readingSessions]) => {
        // Progress: references a real session + user, completed within range.
        const sessionCount = readingSessions.length;
        const progressArb =
          sessionCount === 0
            ? fc.constant([] as SourceProgress[])
            : fc
                .array(
                  fc.record({
                    sessionIndex: fc.integer({ min: 0, max: sessionCount - 1 }),
                    userIndex: fc.integer({ min: 0, max: userCount - 1 }),
                    frac: fc.double({ min: 0, max: 1, noNaN: true }),
                  }),
                  { minLength: 0, maxLength: 8 }
                )
                .map((rows) => {
                  // Ensure at most one progress row per (session, user) so the
                  // generated data mirrors the real uniqueness constraint and
                  // relation assertions are unambiguous.
                  const seen = new Set<string>();
                  const out: SourceProgress[] = [];
                  rows.forEach((r, i) => {
                    const session = readingSessions[r.sessionIndex];
                    const user = users[r.userIndex];
                    const key = `${session.id}\u0000${user.id}`;
                    if (seen.has(key)) return;
                    seen.add(key);
                    const total = session.total_chapters ?? 0;
                    const completed = Math.min(
                      total,
                      Math.round(r.frac * total)
                    );
                    out.push({
                      id: `progress-${i}`,
                      reading_session_id: session.id,
                      user_id: user.id,
                      chapter_completed: completed,
                    });
                  });
                  return out;
                });

        return progressArb.map(
          (progress): SourceDataset => ({
            users,
            groups,
            groupMembers,
            readingSessions,
            progress,
          })
        );
      });
    });
  });

// ---------------------------------------------------------------------------
// Property 1 — Preservation: fields + referential relationships (Req 11.8)
// ---------------------------------------------------------------------------

describe("Property 18: Migration preserves fields and relationships", () => {
  // Validates: Requirement 11.8 — every mappable record migrates with no loss:
  // field values equal the source (11.1–11.5) and relations resolve, via the
  // id-remap table, to the target id of the correct source record.
  it("preserves every field value and referential relationship for a valid dataset", () => {
    return fc.assert(
      fc.asyncProperty(datasetArb, async (dataset) => {
        const sink = new InMemorySink();
        const { report, remap } = await runMigration(dataset, sink);
        {
          // A fully valid dataset migrates with zero halts.
          expect(report.halts).toEqual([]);

          const storedGroups = sink.created.groups as StoredGroup[];
          const storedMembers = sink.created.group_members as StoredGroupMember[];
          const storedSessions = sink.created.reading_sessions as StoredReadingSession[];
          const storedProgress = sink.created.progress as StoredProgress[];

          // Exactly one target record per source record, in source order.
          expect(storedGroups.length).toBe(dataset.groups.length);
          expect(storedMembers.length).toBe(dataset.groupMembers.length);
          expect(storedSessions.length).toBe(dataset.readingSessions.length);
          expect(storedProgress.length).toBe(dataset.progress.length);

          // The remap table maps each source id to the written target id.
          dataset.groups.forEach((g, i) => {
            expect(remap.groups.get(g.id)).toBe(storedGroups[i].id);
          });
          dataset.readingSessions.forEach((s, i) => {
            expect(remap.reading_sessions.get(s.id)).toBe(storedSessions[i].id);
          });

          // --- groups: field preservation (Req 11.1) ---
          dataset.groups.forEach((source, i) => {
            const target = storedGroups[i];
            expect(target.name).toBe(source.name);
            expect(target.invite_code).toBe(source.invite_code);
          });

          // --- members: field + relation preservation (Req 11.3) ---
          dataset.groupMembers.forEach((source, i) => {
            const target = storedMembers[i];
            expect(target.display_name).toBe(source.display_name);
            // Relation ids remapped to the matching target ids.
            expect(target.user).toBe(remap.users.get(source.user_id!));
            expect(target.group).toBe(remap.groups.get(source.group_id!));
          });

          // --- sessions: field + relation + ordered units (Req 11.4) ---
          dataset.readingSessions.forEach((source, i) => {
            const target = storedSessions[i];
            expect(target.group).toBe(remap.groups.get(source.group_id!));
            expect(target.book_title).toBe(source.book_title);
            expect(target.total_chapters).toBe(source.total_chapters);
            expect(target.progress_type).toBe(source.progress_type);
            expect(target.is_active).toBe(source.is_active);
            expect(target.cover_url).toBe(source.cover_url ?? null);
            expect(target.goal_type).toBe(source.goal_type ?? null);
            expect(target.goal_amount).toBe(source.goal_amount ?? null);
            expect(target.goal_unit).toBe(source.goal_unit ?? null);

            // reading_units preserve order_index exactly, sorted ascending.
            const expectedUnits = [...(source.reading_units ?? [])].sort(
              (a, b) => a.order_index - b.order_index
            );
            expect(target.reading_units).toEqual(expectedUnits);
            target.reading_units.forEach((u, k) => {
              if (k > 0) {
                expect(u.order_index).toBeGreaterThanOrEqual(
                  target.reading_units[k - 1].order_index
                );
              }
            });
          });

          // --- progress: field + relation preservation (Req 11.5) ---
          dataset.progress.forEach((source, i) => {
            const target = storedProgress[i];
            expect(target.chapter_completed).toBe(source.chapter_completed);
            expect(target.reading_session).toBe(
              remap.reading_sessions.get(source.reading_session_id!)
            );
            expect(target.user).toBe(remap.users.get(source.user_id!));
          });
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });

  // Validates: Requirement 11.9 — a record missing a required field halts only
  // that record (reported with collection + sourceId + field), while every
  // other record still migrates and the already-written records stay intact.
  it("halts an unmappable record naming the record and field, leaving migrated records intact", () => {
    // Each case: a dataset with at least one group, plus which group to break
    // and which required field to blank on it.
    const brokenCaseArb = datasetArb
      .filter((d) => d.groups.length >= 1)
      .chain((dataset) =>
        fc.record({
          dataset: fc.constant(dataset),
          groupIndex: fc.integer({ min: 0, max: dataset.groups.length - 1 }),
          field: fc.constantFrom<"name" | "invite_code">("name", "invite_code"),
        })
      );

    return fc.assert(
      fc.asyncProperty(brokenCaseArb, async ({ dataset, groupIndex, field }) => {
        // Clone and blank one required field on the chosen group.
        const brokenGroups = dataset.groups.map((g) => ({ ...g }));
        const brokenId = brokenGroups[groupIndex].id;
        brokenGroups[groupIndex] = { ...brokenGroups[groupIndex], [field]: "" };

        const broken: SourceDataset = { ...dataset, groups: brokenGroups };

        const sink = new InMemorySink();
        const { report, remap } = await runMigration(broken, sink);

        // The broken group is reported as a halt naming the record + field.
        const groupHalts = report.halts.filter(
          (h) => h.collection === "groups" && h.sourceId === brokenId
        );
        expect(groupHalts.length).toBe(1);
        expect(groupHalts[0].field).toBe(field);
        expect(typeof groupHalts[0].reason).toBe("string");
        expect(groupHalts[0].reason.length).toBeGreaterThan(0);

        // The halted group was NOT written and has no remap entry.
        const storedGroups = sink.created.groups as StoredGroup[];
        expect(remap.groups.has(brokenId)).toBe(false);
        expect(storedGroups.length).toBe(dataset.groups.length - 1);

        // Every OTHER group migrated intact — present in the remap table, with
        // its field values preserved in the sink.
        dataset.groups.forEach((source, i) => {
          if (i === groupIndex) return;
          const targetId = remap.groups.get(source.id);
          expect(targetId).toBeTruthy();
          const written = storedGroups.find((g) => g.id === targetId);
          expect(written).toBeTruthy();
          expect(written!.name).toBe(source.name);
          expect(written!.invite_code).toBe(source.invite_code);
        });

        // Records that depended on the halted group (sessions/members in it)
        // cannot preserve their relationship and halt too, but anything whose
        // relations all resolved still migrated — already-migrated records are
        // never rolled back. Verify the halted group never produced a target.
        const sessionsInBrokenGroup = broken.readingSessions.filter(
          (s) => s.group_id === brokenId
        );
        sessionsInBrokenGroup.forEach((s) => {
          expect(remap.reading_sessions.has(s.id)).toBe(false);
        });
      }),
      { numRuns: NUM_RUNS }
    );
  });
});
