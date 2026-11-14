// lib/backend/client.ts
//
// Backend_Client — the single seam wrapping the PocketBase JS SDK (Req 11).
//
// This is the ONLY module in the app that imports `pocketbase`; every other
// module talks to the backend through the accessors exported here. It mirrors
// the old `createClient()` Supabase seam so the transport layer stays swappable
// and testable.
//
// Responsibilities:
//   - Own the single `PocketBase` instance bound to the configured
//     Backend_Endpoint (`initBackend`/`getBackend`).
//   - Expose typed collection accessors for the six application collections.
//   - Normalize PocketBase errors into a uniform
//     `BackendError { kind, message, fieldErrors }` shape (Req 11.3) so screens
//     can surface validation and offline messaging consistently.
//   - Map PocketBase records (relation ids + `expand`) into the existing
//     `app/group/[id]/types.ts` shapes WITHOUT changing those shapes (Req 11.4,
//     11.5), so the React component tree needs no changes.

import PocketBase, {
  ClientResponseError,
  type BaseAuthStore,
  type RecordModel,
  type RecordService,
} from "pocketbase";

import type {
  Group,
  Member,
  ProgressRow,
  ReadingSession,
  ReadingUnit,
} from "@/app/group/[id]/types";

// ---------------------------------------------------------------------------
// Collection names
// ---------------------------------------------------------------------------

/**
 * The application collections owned by PocketBase (Req 11.1–11.7). Centralized
 * here so collection names live in exactly one place.
 */
export const COLLECTIONS = {
  users: "users",
  groups: "groups",
  groupMembers: "group_members",
  readingSessions: "reading_sessions",
  progress: "progress",
  notificationSubscriptions: "notification_subscriptions",
  notificationEvents: "notification_events",
} as const;

// ---------------------------------------------------------------------------
// PocketBase record shapes
// ---------------------------------------------------------------------------
//
// These describe the raw records as PocketBase stores them (relations are ids,
// nested data arrives under `expand`). They are intentionally distinct from the
// client-facing `types.ts` shapes; the mapping functions below bridge the two.

/** Raw `groups` record (Req 11.1, 11.2). */
export interface GroupRecord extends RecordModel {
  name: string;
  invite_code: string;
}

/** Raw `group_members` record (Req 11.3). `user`/`group` are relation ids. */
export interface GroupMemberRecord extends RecordModel {
  user: string;
  group: string;
  display_name: string;
}

/**
 * Raw `reading_sessions` record (Req 11.4). `reading_units` is stored inline as
 * an ordered JSON array preserving `order_index`.
 */
export interface ReadingSessionRecord extends RecordModel {
  group: string;
  book_title: string;
  total_chapters: number;
  progress_type: string;
  is_active: boolean;
  cover_url: string | null;
  goal_type: string | null;
  goal_amount: number | null;
  goal_unit: string | null;
  reading_units: ReadingUnit[] | null;
  created_at: string;
}

/** Raw `progress` record (Req 11.5–11.7). `user`/`reading_session` are ids. */
export interface ProgressRecord extends RecordModel {
  reading_session: string;
  user: string;
  chapter_completed: number;
}

/** Raw `notification_subscriptions` record (Req 8.5, 8.6). */
export interface NotificationSubscriptionRecord extends RecordModel {
  user: string;
  subscribed: boolean;
}

/** Raw `notification_events` record — the fire-once ledger (Req 8.1, 8.2). */
export interface NotificationEventRecord extends RecordModel {
  reading_session: string;
  event_type: "weekly_goal" | "group_ready";
  event_key: string;
}

// ---------------------------------------------------------------------------
// BackendError normalization (Req 11.3)
// ---------------------------------------------------------------------------

/**
 * Discriminates the categories of failure the rest of the app branches on:
 *   - `not_configured`: no Backend_Endpoint has been set (Req 9.3).
 *   - `validation`: the backend rejected a field (bad/duplicate value).
 *   - `not_found`: the requested record does not exist.
 *   - `auth`: authentication/authorization failure.
 *   - `network`: the backend could not be reached (offline, Req 10).
 *   - `unknown`: anything else.
 */
export type BackendErrorKind =
  | "not_configured"
  | "validation"
  | "not_found"
  | "auth"
  | "network"
  | "unknown";

/**
 * The uniform error shape every screen receives from the backend seam
 * (Req 11.3). `fieldErrors` maps a field name to a human-readable message when
 * the backend reports per-field validation failures, so forms can highlight the
 * offending input while retaining the user's entered values.
 */
export class BackendError extends Error {
  readonly kind: BackendErrorKind;
  readonly fieldErrors: Record<string, string>;
  /** The original thrown value, retained for debugging/logging. */
  readonly cause?: unknown;

  constructor(
    kind: BackendErrorKind,
    message: string,
    fieldErrors: Record<string, string> = {},
    cause?: unknown
  ) {
    super(message);
    this.name = "BackendError";
    this.kind = kind;
    this.fieldErrors = fieldErrors;
    this.cause = cause;
    // Restore the prototype chain so `instanceof BackendError` works across
    // transpilation targets (matches the pattern in config.ts).
    Object.setPrototypeOf(this, BackendError.prototype);
  }
}

/** Error thrown by `getBackend()` before an endpoint has been configured. */
export class BackendNotConfiguredError extends BackendError {
  constructor() {
    super(
      "not_configured",
      "The backend endpoint has not been configured yet."
    );
    this.name = "BackendNotConfiguredError";
    Object.setPrototypeOf(this, BackendNotConfiguredError.prototype);
  }
}

/**
 * Normalize any thrown value into a {@link BackendError}. PocketBase throws
 * {@link ClientResponseError} whose `data` has the shape
 * `{ code, message, data: { [field]: { code, message } } }`; this extracts the
 * per-field messages into `fieldErrors` and classifies the error by HTTP status
 * so callers can branch on `kind` rather than parsing messages (Req 11.3).
 */
export function normalizeError(err: unknown): BackendError {
  if (err instanceof BackendError) {
    return err;
  }

  if (err instanceof ClientResponseError) {
    // A status of 0 (or an abort) means the request never reached the backend:
    // treat it as a network/offline failure (Req 10.3).
    if (err.isAbort || err.status === 0) {
      return new BackendError(
        "network",
        err.message || "The backend could not be reached.",
        {},
        err
      );
    }

    const fieldErrors = extractFieldErrors(err.response);
    const kind = statusToKind(err.status, fieldErrors);
    const message =
      (typeof err.response?.message === "string" && err.response.message) ||
      err.message ||
      "The backend request failed.";

    return new BackendError(kind, message, fieldErrors, err);
  }

  if (err instanceof Error) {
    return new BackendError("unknown", err.message, {}, err);
  }

  return new BackendError("unknown", "An unexpected error occurred.", {}, err);
}

/**
 * Pull per-field validation messages out of a PocketBase error response. The
 * SDK nests them under `response.data` as `{ [field]: { code, message } }`.
 */
function extractFieldErrors(
  response: Record<string, unknown> | undefined
): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  const data = response?.data;
  if (data && typeof data === "object") {
    for (const [field, detail] of Object.entries(data as Record<string, unknown>)) {
      if (detail && typeof detail === "object" && "message" in detail) {
        const message = (detail as { message?: unknown }).message;
        if (typeof message === "string") {
          fieldErrors[field] = message;
        }
      }
    }
  }
  return fieldErrors;
}

/** Classify a PocketBase HTTP status into a {@link BackendErrorKind}. */
function statusToKind(
  status: number,
  fieldErrors: Record<string, string>
): BackendErrorKind {
  if (status === 400) {
    // 400 with per-field details is a validation failure; otherwise generic.
    return Object.keys(fieldErrors).length > 0 ? "validation" : "unknown";
  }
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Client lifecycle (Req 9, 11)
// ---------------------------------------------------------------------------

let pb: PocketBase | null = null;

/**
 * Initialize (or replace) the single PocketBase client against the persisted
 * Backend_Endpoint (Req 9.1, 9.4). Returns the instance so callers can chain if
 * needed; subsequent calls rebind the client to the new endpoint.
 *
 * An optional `authStore` lets the caller back the session with a custom
 * persistence layer instead of the default browser `localStorage`. The
 * Auth_Service passes a Tauri-store-backed `AsyncAuthStore` here so the session
 * survives application restarts until it expires or the user logs out (Req 3.10).
 */
export function initBackend(
  endpoint: string,
  authStore?: BaseAuthStore
): PocketBase {
  pb = new PocketBase(endpoint, authStore);
  return pb;
}

/**
 * Return the active PocketBase client, or throw {@link BackendNotConfiguredError}
 * when no endpoint has been configured yet (Req 9.3). Screens that need the
 * backend call this; the Backend Setup prompt blocks until `initBackend` has run.
 */
export function getBackend(): PocketBase {
  if (!pb) {
    throw new BackendNotConfiguredError();
  }
  return pb;
}

/** Reset the client to its unconfigured state. Primarily for tests. */
export function resetBackend(): void {
  pb = null;
}

/**
 * Lightweight health probe used for connection-error handling (Req 9.5). Returns
 * `true` when the backend responds to its health endpoint, `false` on any
 * failure (unreachable, timeout, not configured). Never throws, so callers can
 * use it as a simple reachability check. Pass an `AbortSignal` to bound the wait
 * (the config layer uses a 10-second timeout).
 */
export async function pingBackend(signal?: AbortSignal): Promise<boolean> {
  if (!pb) return false;
  try {
    await pb.health.check({ signal });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Typed collection accessors (Req 11)
// ---------------------------------------------------------------------------
//
// Each accessor returns the PocketBase `RecordService` typed to the matching
// raw record shape, so callers get autocomplete and type-checking on fields
// without re-stating the collection name at every call site.

export function groupsCollection(): RecordService<GroupRecord> {
  return getBackend().collection<GroupRecord>(COLLECTIONS.groups);
}

export function groupMembersCollection(): RecordService<GroupMemberRecord> {
  return getBackend().collection<GroupMemberRecord>(COLLECTIONS.groupMembers);
}

export function readingSessionsCollection(): RecordService<ReadingSessionRecord> {
  return getBackend().collection<ReadingSessionRecord>(
    COLLECTIONS.readingSessions
  );
}

export function progressCollection(): RecordService<ProgressRecord> {
  return getBackend().collection<ProgressRecord>(COLLECTIONS.progress);
}

export function notificationSubscriptionsCollection(): RecordService<NotificationSubscriptionRecord> {
  return getBackend().collection<NotificationSubscriptionRecord>(
    COLLECTIONS.notificationSubscriptions
  );
}

export function notificationEventsCollection(): RecordService<NotificationEventRecord> {
  return getBackend().collection<NotificationEventRecord>(
    COLLECTIONS.notificationEvents
  );
}

// ---------------------------------------------------------------------------
// Record → client-type mapping (Req 11.4, 11.5)
// ---------------------------------------------------------------------------
//
// These functions translate raw PocketBase records (relation ids, `expand`)
// into the existing `types.ts` shapes. They never mutate those shapes, so the
// React components and the `getMemberProgress`/`currentSession`/goal-label
// helpers keep working unchanged.

/** Map a `group_members` record into a {@link Member} (`user` id → `user_id`). */
export function mapMember(record: GroupMemberRecord): Member {
  return {
    user_id: record.user,
    display_name: record.display_name,
  };
}

/** Map a `progress` record into a {@link ProgressRow}. */
export function mapProgressRow(record: ProgressRecord): ProgressRow {
  return {
    user_id: record.user,
    chapter_completed: record.chapter_completed,
  };
}

/**
 * Map a `reading_sessions` record into a {@link ReadingSession}. `reading_units`
 * is returned sorted by `order_index` so the ordered list reads exactly as the
 * UI expects (Req 5.3, 11.4). Nested `progress` rows are read from `expand` when
 * present (the relation is expanded via a back-relation key).
 */
export function mapReadingSession(record: ReadingSessionRecord): ReadingSession {
  // PocketBase names a back-relation `<collection>_via_<relatingField>`. The
  // `progress` record relates to a session through its `reading_session` field,
  // so the key is `progress_via_reading_session` (the field name, not the
  // collection name). A plain `progress` fallback is accepted too.
  const progressRecords = readExpandList<ProgressRecord>(
    record,
    `${COLLECTIONS.progress}_via_reading_session`,
    COLLECTIONS.progress
  );

  const readingUnits: ReadingUnit[] = Array.isArray(record.reading_units)
    ? [...record.reading_units].sort((a, b) => a.order_index - b.order_index)
    : [];

  return {
    id: record.id,
    book_title: record.book_title,
    total_chapters: record.total_chapters,
    created_at: record.created_at,
    is_active: record.is_active,
    cover_url: record.cover_url ?? null,
    progress_type: record.progress_type,
    goal_type: record.goal_type ?? null,
    goal_amount: record.goal_amount ?? null,
    goal_unit: record.goal_unit ?? null,
    reading_units: readingUnits,
    progress: progressRecords.map(mapProgressRow),
  };
}

/**
 * Map a `groups` record (with its members and sessions available via `expand`)
 * into the existing {@link Group} shape (Req 11.4). Members and sessions are
 * read from the record's `expand` under the standard PocketBase back-relation
 * keys; a simple key is accepted as a fallback so callers can expand with either
 * naming convention.
 */
export function mapGroup(record: GroupRecord): Group {
  const memberRecords = readExpandList<GroupMemberRecord>(
    record,
    `${COLLECTIONS.groupMembers}_via_${COLLECTIONS.groups}`,
    COLLECTIONS.groupMembers
  );
  const sessionRecords = readExpandList<ReadingSessionRecord>(
    record,
    `${COLLECTIONS.readingSessions}_via_${COLLECTIONS.groups}`,
    COLLECTIONS.readingSessions
  );

  return {
    id: record.id,
    name: record.name,
    invite_code: record.invite_code,
    group_members: memberRecords.map(mapMember),
    reading_sessions: sessionRecords.map(mapReadingSession),
  };
}

/**
 * Read an expanded relation list off a record's `expand`, tolerating PocketBase
 * returning either a single record or an array, and accepting the canonical
 * back-relation key (`<collection>_via_<field>`) or a plain fallback key. Absent
 * expands yield an empty array so mapping stays total.
 */
function readExpandList<T extends RecordModel>(
  record: RecordModel,
  primaryKey: string,
  fallbackKey: string
): T[] {
  const expand = record.expand;
  if (!expand) return [];
  const raw = expand[primaryKey] ?? expand[fallbackKey];
  if (raw == null) return [];
  return (Array.isArray(raw) ? raw : [raw]) as T[];
}
