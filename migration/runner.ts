// migration/runner.ts
//
// Orchestrates the Supabase -> PocketBase migration (Req 11.8, 11.9).
//
// Given a source dataset, a {@link Sink}, and a (possibly pre-populated)
// {@link RemapTable}, the runner:
//   1. Migrates each collection in dependency order (users -> groups ->
//      group_members -> reading_sessions -> progress) so relation remapping
//      always has the related target id available.
//   2. Is re-runnable / idempotent: a source id already present in the remap
//      table is reused (counted as skipped), never re-created (Req 11.9).
//   3. Halts an individual record on a missing/invalid required field, records
//      the offending record + field in the report, and CONTINUES with the rest
//      so every already-migrated record stays intact (Req 11.9).
//
// All field preservation / validation lives in the pure `mapping.ts`; the runner
// only sequences, remaps ids, handles halts, and talks to the sink.

import {
  mapGroup,
  mapGroupMember,
  mapProgress,
  mapReadingSession,
} from "./mapping";
import type { Sink } from "./sink";
import {
  RecordHaltError,
  createRemapTable,
  createReport,
  type MigrationReport,
  type RemapCollection,
  type RemapTable,
  type SourceDataset,
} from "./types";

export interface RunOptions {
  /** Reuse/extend an existing remap table (for a re-run). Defaults to empty. */
  remap?: RemapTable;
}

export interface RunResult {
  report: MigrationReport;
  /** The remap table after the run, to persist for the next (idempotent) run. */
  remap: RemapTable;
}

/**
 * Run the migration. `users` ids are seeded into the remap table as identity
 * mappings (PocketBase `users` are migrated/kept by their own auth import step;
 * this script remaps relations against those ids). If a prior run's remap table
 * is supplied, already-migrated source ids are skipped rather than re-created.
 */
export async function runMigration(
  dataset: SourceDataset,
  sink: Sink,
  options: RunOptions = {}
): Promise<RunResult> {
  const remap = options.remap ?? createRemapTable();
  const report = createReport();

  // --- users: identity remap ------------------------------------------------
  // The `users` auth collection is migrated separately (auth import); here we
  // only need source-id -> target-id entries so member/progress relations can
  // be remapped. Absent an explicit mapping, the source id is treated as the
  // target id (PocketBase can import users preserving ids).
  for (const user of dataset.users) {
    if (!remap.users.has(user.id)) {
      remap.users.set(user.id, user.id);
    }
  }
  // Also seed any user ids only referenced by members/progress, so relations to
  // existing PocketBase users resolve even without a `users` view.
  for (const m of dataset.groupMembers) {
    if (m.user_id && !remap.users.has(m.user_id)) remap.users.set(m.user_id, m.user_id);
  }
  for (const p of dataset.progress) {
    if (p.user_id && !remap.users.has(p.user_id)) remap.users.set(p.user_id, p.user_id);
  }

  // --- groups ---------------------------------------------------------------
  for (const group of dataset.groups) {
    await migrateRecord(report, remap, "groups", group.id, async () => {
      const payload = mapGroup(group);
      return sink.createGroup(payload);
    });
  }

  // --- group_members --------------------------------------------------------
  for (const member of dataset.groupMembers) {
    await migrateRecord(report, remap, "group_members", member.id, async () => {
      const payload = mapGroupMember(member, remap);
      return sink.createGroupMember(payload);
    });
  }

  // --- reading_sessions -----------------------------------------------------
  // Track each migrated session's total so progress upper-bounds validate.
  const sessionTotals = new Map<string, number>();
  for (const session of dataset.readingSessions) {
    await migrateRecord(report, remap, "reading_sessions", session.id, async () => {
      const payload = mapReadingSession(session, remap);
      const id = await sink.createReadingSession(payload);
      sessionTotals.set(session.id, payload.total_chapters);
      return id;
    });
    // For a re-run where the session was already migrated, still record its
    // total so progress for it can be bounded.
    if (!sessionTotals.has(session.id) && remap.reading_sessions.has(session.id)) {
      if (typeof session.total_chapters === "number") {
        sessionTotals.set(session.id, session.total_chapters);
      }
    }
  }

  // --- progress -------------------------------------------------------------
  for (const prog of dataset.progress) {
    await migrateRecord(report, remap, "progress", prog.id, async () => {
      const payload = mapProgress(prog, remap, sessionTotals);
      return sink.createProgress(payload);
    });
  }

  return { report, remap };
}

/**
 * Migrate a single record with idempotency + halt handling (Req 11.9):
 *   - If the source id is already in the remap table, skip (count as skipped).
 *   - Otherwise map + write; on success record the target id in the remap table
 *     and count as migrated.
 *   - On a {@link RecordHaltError}, record the halt and CONTINUE — leaving every
 *     already-migrated record intact. Any other error aborts the run (the
 *     dataset/backend is in an unexpected state, not a per-record issue).
 */
async function migrateRecord(
  report: MigrationReport,
  remap: RemapTable,
  collection: Exclude<RemapCollection, "users">,
  sourceId: string,
  write: () => Promise<string>
): Promise<void> {
  if (remap[collection].has(sourceId)) {
    report.totalSkipped += 1;
    return;
  }
  try {
    const targetId = await write();
    remap[collection].set(sourceId, targetId);
    report.byCollection[collection].migrated += 1;
    report.totalMigrated += 1;
  } catch (err) {
    if (err instanceof RecordHaltError) {
      report.halts.push(err.halt);
      report.byCollection[collection].halted += 1;
      return;
    }
    throw err;
  }
}
