// migration/mapping.ts
//
// Pure mapping + validation core for the Supabase -> PocketBase migration
// (Req 11.8, 11.9). This module has NO side effects and imports no backend
// client: every function takes source records (+ the id-remap table) and returns
// either a target payload or throws a {@link RecordHaltError} identifying the
// offending record and field. Keeping it pure makes it directly exercisable by
// the Property 18 test (task 15.2) and keeps the field-preservation /
// halt-on-unmappable logic in one auditable place.
//
// Field preservation follows the data model in design.md ("Data Models") and
// the collection schema in `pocketbase/pb_migrations/1750000000_init_collections.js`:
// names are kept identical (`total_chapters`, `chapter_completed`) for migration
// fidelity, and `reading_units` is a JSON array preserving `order_index`.

import type { ReadingUnit } from "@/app/group/[id]/types";
import {
  RecordHaltError,
  type RemapCollection,
  type RemapTable,
  type SourceGroup,
  type SourceGroupMember,
  type SourceProgress,
  type SourceReadingSession,
  type TargetGroup,
  type TargetGroupMember,
  type TargetProgress,
  type TargetReadingSession,
} from "./types";

// ---------------------------------------------------------------------------
// Field constraints (mirrors the PocketBase schema and Req 11.1–11.5)
// ---------------------------------------------------------------------------

const GROUP_NAME_MIN = 1;
const GROUP_NAME_MAX = 200;
const INVITE_CODE_MIN = 6;
const INVITE_CODE_MAX = 32;
const DISPLAY_NAME_MIN = 1;
const DISPLAY_NAME_MAX = 100;
const BOOK_TITLE_MIN = 1;
const BOOK_TITLE_MAX = 300;
const TOTAL_MIN = 1;
const TOTAL_MAX = 100000;
const GOAL_AMOUNT_MIN = 1;
const GOAL_AMOUNT_MAX = 100000;
const READING_UNITS_MAX = 10000;
const PROGRESS_TYPES = ["chapters", "pages", "milestones", "sections"] as const;

// ---------------------------------------------------------------------------
// Halt helpers (Req 11.9)
// ---------------------------------------------------------------------------

/** Throw a per-record halt identifying the collection, source id, and field. */
function halt(
  collection: RemapCollection,
  sourceId: string,
  field: string,
  reason: string
): never {
  throw new RecordHaltError({ collection, sourceId, field, reason });
}

/** A required string must be present and non-empty (after trimming). */
function requireText(
  collection: RemapCollection,
  sourceId: string,
  field: string,
  value: unknown,
  min: number,
  max: number
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    halt(collection, sourceId, field, "required field is missing or empty");
  }
  const len = (value as string).length;
  if (len < min || len > max) {
    halt(
      collection,
      sourceId,
      field,
      `length ${len} is outside the allowed range ${min}-${max}`
    );
  }
  return value as string;
}

/** A required id (relation source id) must be present and non-empty. */
function requireId(
  collection: RemapCollection,
  sourceId: string,
  field: string,
  value: unknown
): string {
  if (typeof value !== "string" || value.length === 0) {
    halt(collection, sourceId, field, "required relation id is missing");
  }
  return value as string;
}

/** A required integer within [min, max]. */
function requireInt(
  collection: RemapCollection,
  sourceId: string,
  field: string,
  value: unknown,
  min: number,
  max: number
): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    halt(collection, sourceId, field, "required whole number is missing or non-integer");
  }
  const n = value as number;
  if (n < min || n > max) {
    halt(
      collection,
      sourceId,
      field,
      `value ${n} is outside the allowed range ${min}-${max}`
    );
  }
  return n;
}

/**
 * Remap a source relation id to its PocketBase target id via the remap table. A
 * source record that references a related record which was never migrated (e.g.
 * its own required field was missing and it halted) cannot preserve the
 * referential relationship, so this halts too (Req 11.8, 11.9).
 */
function remapRelation(
  table: RemapTable,
  relatedCollection: RemapCollection,
  owningCollection: RemapCollection,
  sourceId: string,
  field: string,
  sourceRelationId: string
): string {
  const targetId = table[relatedCollection].get(sourceRelationId);
  if (!targetId) {
    halt(
      owningCollection,
      sourceId,
      field,
      `referenced ${relatedCollection} "${sourceRelationId}" has no migrated record`
    );
  }
  return targetId;
}

// ---------------------------------------------------------------------------
// Per-collection mappers (field preservation, Req 11.1–11.5)
// ---------------------------------------------------------------------------

/** Map a Supabase group to a PocketBase `groups` payload (Req 11.1). */
export function mapGroup(source: SourceGroup): TargetGroup {
  return {
    name: requireText("groups", source.id, "name", source.name, GROUP_NAME_MIN, GROUP_NAME_MAX),
    invite_code: requireText(
      "groups",
      source.id,
      "invite_code",
      source.invite_code,
      INVITE_CODE_MIN,
      INVITE_CODE_MAX
    ),
  };
}

/** Map a Supabase group member to a `group_members` payload (Req 11.3). */
export function mapGroupMember(
  source: SourceGroupMember,
  table: RemapTable
): TargetGroupMember {
  const userSourceId = requireId("group_members", source.id, "user_id", source.user_id);
  const groupSourceId = requireId("group_members", source.id, "group_id", source.group_id);
  return {
    user: remapRelation(table, "users", "group_members", source.id, "user_id", userSourceId),
    group: remapRelation(table, "groups", "group_members", source.id, "group_id", groupSourceId),
    display_name: requireText(
      "group_members",
      source.id,
      "display_name",
      source.display_name,
      DISPLAY_NAME_MIN,
      DISPLAY_NAME_MAX
    ),
  };
}

/**
 * Normalize + validate the ordered `reading_units` list, preserving
 * `order_index` exactly (Req 5.3, 11.4). Each entry must have a string `label`
 * and an integer `order_index`; the returned array is sorted by `order_index`
 * so the stored JSON reads in order, matching how the client mapper reads it.
 */
function mapReadingUnits(
  source: SourceReadingSession
): ReadingUnit[] {
  const raw = source.reading_units;
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    halt("reading_sessions", source.id, "reading_units", "expected an ordered list");
  }
  if (raw.length > READING_UNITS_MAX) {
    halt(
      "reading_sessions",
      source.id,
      "reading_units",
      `${raw.length} entries exceeds the maximum of ${READING_UNITS_MAX}`
    );
  }
  const units: ReadingUnit[] = raw.map((unit, i) => {
    if (!unit || typeof unit !== "object") {
      halt("reading_sessions", source.id, `reading_units[${i}]`, "entry is not an object");
    }
    const label = (unit as ReadingUnit).label;
    const orderIndex = (unit as ReadingUnit).order_index;
    if (typeof label !== "string") {
      halt("reading_sessions", source.id, `reading_units[${i}].label`, "missing label");
    }
    if (typeof orderIndex !== "number" || !Number.isInteger(orderIndex)) {
      halt(
        "reading_sessions",
        source.id,
        `reading_units[${i}].order_index`,
        "missing or non-integer order_index"
      );
    }
    return { label, order_index: orderIndex };
  });
  // Preserve order by sorting on the source order_index values.
  return units.sort((a, b) => a.order_index - b.order_index);
}

/** Map a Supabase reading session to a `reading_sessions` payload (Req 11.4). */
export function mapReadingSession(
  source: SourceReadingSession,
  table: RemapTable
): TargetReadingSession {
  const groupSourceId = requireId("reading_sessions", source.id, "group_id", source.group_id);
  const group = remapRelation(
    table,
    "groups",
    "reading_sessions",
    source.id,
    "group_id",
    groupSourceId
  );

  const book_title = requireText(
    "reading_sessions",
    source.id,
    "book_title",
    source.book_title,
    BOOK_TITLE_MIN,
    BOOK_TITLE_MAX
  );
  const total_chapters = requireInt(
    "reading_sessions",
    source.id,
    "total_chapters",
    source.total_chapters,
    TOTAL_MIN,
    TOTAL_MAX
  );

  const progress_type = source.progress_type;
  if (
    typeof progress_type !== "string" ||
    !(PROGRESS_TYPES as readonly string[]).includes(progress_type)
  ) {
    halt(
      "reading_sessions",
      source.id,
      "progress_type",
      `must be one of ${PROGRESS_TYPES.join(", ")}`
    );
  }

  if (typeof source.is_active !== "boolean") {
    halt("reading_sessions", source.id, "is_active", "required active flag is missing");
  }

  // Optional goal amount: when present it must be a valid integer in range.
  let goal_amount: number | null = null;
  if (source.goal_amount != null) {
    goal_amount = requireInt(
      "reading_sessions",
      source.id,
      "goal_amount",
      source.goal_amount,
      GOAL_AMOUNT_MIN,
      GOAL_AMOUNT_MAX
    );
  }

  return {
    group,
    book_title,
    total_chapters,
    progress_type,
    is_active: source.is_active,
    cover_url: source.cover_url ?? null,
    goal_type: source.goal_type ?? null,
    goal_amount,
    goal_unit: source.goal_unit ?? null,
    reading_units: mapReadingUnits(source),
  };
}

/**
 * Map a Supabase progress record to a `progress` payload (Req 11.5). The
 * completed count must be an integer within `[0, total_chapters]` of the
 * referenced session; `sessionTotals` provides each migrated session's total so
 * the upper bound can be validated during mapping.
 */
export function mapProgress(
  source: SourceProgress,
  table: RemapTable,
  sessionTotals: Map<string, number>
): TargetProgress {
  const sessionSourceId = requireId(
    "progress",
    source.id,
    "reading_session_id",
    source.reading_session_id
  );
  const userSourceId = requireId("progress", source.id, "user_id", source.user_id);

  const reading_session = remapRelation(
    table,
    "reading_sessions",
    "progress",
    source.id,
    "reading_session_id",
    sessionSourceId
  );
  const user = remapRelation(table, "users", "progress", source.id, "user_id", userSourceId);

  // Upper bound is the referenced session's total count (Req 11.5).
  const total = sessionTotals.get(sessionSourceId);
  const max = typeof total === "number" ? total : TOTAL_MAX;
  const chapter_completed = requireInt(
    "progress",
    source.id,
    "chapter_completed",
    source.chapter_completed,
    0,
    max
  );

  return { reading_session, user, chapter_completed };
}
