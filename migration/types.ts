// migration/types.ts
//
// Shared types for the one-time Supabase -> PocketBase migration (Req 11.8, 11.9).
//
// These describe the SOURCE (Supabase) and TARGET (PocketBase) record shapes the
// migration bridges, plus the id-remap table that makes the script re-runnable
// (idempotent) and the structured outcomes (`Halt`, `MigrationReport`) used for
// halt-on-unmappable reporting.
//
// This module is runtime-free on purpose: it is imported by the pure mapping
// core (`mapping.ts`), the runner (`index.ts`), and the property test (task
// 15.2), none of which should pull in a Supabase or PocketBase client just to
// reference a type.

import type { ReadingUnit } from "@/app/group/[id]/types";

// ---------------------------------------------------------------------------
// Source (Supabase) record shapes
// ---------------------------------------------------------------------------
//
// Column names mirror the existing Supabase schema: snake_case with `_id`
// relation columns (e.g. `user_id`, `group_id`). The mapper remaps these ids to
// PocketBase ids via the id-remap table.

/** Supabase `auth.users` row — only the stable id is carried over. */
export interface SourceUser {
  id: string;
  email: string | null;
}

/** Supabase `groups` row (maps to PocketBase `groups`, Req 11.1). */
export interface SourceGroup {
  id: string;
  name: string | null;
  invite_code: string | null;
}

/** Supabase `group_members` row (maps to PocketBase `group_members`, Req 11.3). */
export interface SourceGroupMember {
  id: string;
  user_id: string | null;
  group_id: string | null;
  display_name: string | null;
}

/**
 * Supabase `reading_sessions` row (maps to PocketBase `reading_sessions`,
 * Req 11.4). `reading_units` arrives as a collapsed ordered array; the source
 * may store it inline as JSON or as separate rows already flattened by the
 * reader. `order_index` is preserved exactly.
 */
export interface SourceReadingSession {
  id: string;
  group_id: string | null;
  book_title: string | null;
  total_chapters: number | null;
  progress_type: string | null;
  is_active: boolean | null;
  cover_url: string | null;
  goal_type: string | null;
  goal_amount: number | null;
  goal_unit: string | null;
  reading_units: ReadingUnit[] | null;
  created_at: string | null;
}

/** Supabase `progress` row (maps to PocketBase `progress`, Req 11.5). */
export interface SourceProgress {
  id: string;
  reading_session_id: string | null;
  user_id: string | null;
  chapter_completed: number | null;
}

/** The full source dataset read from Supabase. */
export interface SourceDataset {
  users: SourceUser[];
  groups: SourceGroup[];
  groupMembers: SourceGroupMember[];
  readingSessions: SourceReadingSession[];
  progress: SourceProgress[];
}

// ---------------------------------------------------------------------------
// Target (PocketBase) record payloads
// ---------------------------------------------------------------------------
//
// The shapes written to PocketBase via the admin API. Relation fields hold
// PocketBase ids (remapped from source ids), matching the collection schema in
// `pocketbase/pb_migrations/1750000000_init_collections.js`.

export interface TargetGroup {
  name: string;
  invite_code: string;
}

export interface TargetGroupMember {
  user: string;
  group: string;
  display_name: string;
}

export interface TargetReadingSession {
  group: string;
  book_title: string;
  total_chapters: number;
  progress_type: string;
  is_active: boolean;
  cover_url: string | null;
  goal_type: string | null;
  goal_amount: number | null;
  goal_unit: string | null;
  reading_units: ReadingUnit[];
}

export interface TargetProgress {
  reading_session: string;
  user: string;
  chapter_completed: number;
}

// ---------------------------------------------------------------------------
// id-remap table (idempotency, Req 11.9)
// ---------------------------------------------------------------------------
//
// Maps a source id to the PocketBase id it was written as, per collection. The
// runner persists this table between runs so re-running the migration reuses the
// existing target records instead of duplicating them, and so referential
// relationships (member.user, session.group, progress.reading_session, ...) can
// be remapped from source ids to target ids.

/** The collections the migration remaps ids for. */
export type RemapCollection =
  | "users"
  | "groups"
  | "group_members"
  | "reading_sessions"
  | "progress";

/** A single source-id -> target-id entry. */
export interface RemapEntry {
  collection: RemapCollection;
  sourceId: string;
  targetId: string;
}

/**
 * The id-remap table: for each collection, a map from source id to the already
 * written PocketBase id. Empty on a first run; populated as records migrate so a
 * re-run is idempotent (a source id already present is skipped, not duplicated).
 */
export type RemapTable = {
  [C in RemapCollection]: Map<string, string>;
};

/** Create an empty remap table. */
export function createRemapTable(): RemapTable {
  return {
    users: new Map(),
    groups: new Map(),
    group_members: new Map(),
    reading_sessions: new Map(),
    progress: new Map(),
  };
}

// ---------------------------------------------------------------------------
// Outcomes & reporting (Req 11.9)
// ---------------------------------------------------------------------------

/**
 * A halt for a single unmappable record: the migration of THIS record stops and
 * is reported with the offending field, while every already-migrated record
 * stays intact (Req 11.9). `collection` + `sourceId` identify the record;
 * `field` names the missing/invalid required field; `reason` is human-readable.
 */
export interface Halt {
  collection: RemapCollection;
  sourceId: string;
  field: string;
  reason: string;
}

/** A thrown form of {@link Halt} so the mapper can signal per-record halts. */
export class RecordHaltError extends Error {
  readonly halt: Halt;
  constructor(halt: Halt) {
    super(
      `Migration halted for ${halt.collection} ${halt.sourceId}: ` +
        `field "${halt.field}" — ${halt.reason}`
    );
    this.name = "RecordHaltError";
    this.halt = halt;
    Object.setPrototypeOf(this, RecordHaltError.prototype);
  }
}

/** Per-collection counts of records migrated vs. halted. */
export interface CollectionResult {
  migrated: number;
  halted: number;
}

/** The final report produced by a migration run. */
export interface MigrationReport {
  byCollection: Record<RemapCollection, CollectionResult>;
  halts: Halt[];
  /** Total records written to PocketBase this run (excludes idempotent skips). */
  totalMigrated: number;
  /** Total records reused from a prior run (idempotent skips). */
  totalSkipped: number;
}

/** Create an empty migration report. */
export function createReport(): MigrationReport {
  const empty = (): CollectionResult => ({ migrated: 0, halted: 0 });
  return {
    byCollection: {
      users: empty(),
      groups: empty(),
      group_members: empty(),
      reading_sessions: empty(),
      progress: empty(),
    },
    halts: [],
    totalMigrated: 0,
    totalSkipped: 0,
  };
}
