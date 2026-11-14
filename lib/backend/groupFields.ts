// lib/backend/groupFields.ts
//
// Pure, testable mirror of the PocketBase `groups` field-validation and
// invite-code-uniqueness constraints (schema + hook from task 4.2).
//
// The `groups` collection enforces, via field constraints and a unique index on
// `invite_code`, that a group is persisted only when its `name` is 1-200 chars,
// its `invite_code` is 6-32 chars, and its `invite_code` does not duplicate an
// existing group's code. Those constraints run inside PocketBase and cannot be
// imported into a Node/Vitest test, so this module re-implements the *pure*
// accept/reject decision so it can be property-tested (Property 5) and reused by
// any TS caller (e.g. client-side pre-validation before a create/update call).
//
// Decision mirrored from the schema/hook (Req 11.1, 11.2):
//   - a candidate `(name, invite_code)` is ACCEPTED iff `name` length is in
//     [1, 200], `invite_code` length is in [6, 32], and `invite_code` is not
//     already present among the existing codes;
//   - otherwise the operation is REJECTED with an error identifying the invalid
//     or duplicate field, and existing group records are left unchanged
//     (this module is pure and never mutates the provided existing-codes set).

/** Inclusive lower bound on a valid group name length (Req 11.1). */
export const GROUP_NAME_MIN_LENGTH = 1;

/** Inclusive upper bound on a valid group name length (Req 11.1). */
export const GROUP_NAME_MAX_LENGTH = 200;

/** Inclusive lower bound on a valid invite-code length (Req 11.1). */
export const INVITE_CODE_MIN_LENGTH = 6;

/** Inclusive upper bound on a valid invite-code length (Req 11.1). */
export const INVITE_CODE_MAX_LENGTH = 32;

/**
 * Why a group create/update was rejected, identifying the invalid or duplicate
 * field (Req 11.2). The field is validated in a fixed order so a single,
 * deterministic reason is reported per rejection:
 *   - `name_length`         → `name` is empty or exceeds 200 chars.
 *   - `invite_code_length`  → `invite_code` is outside the 6-32 range.
 *   - `invite_code_duplicate` → `invite_code` duplicates an existing code.
 */
export type GroupFieldErrorCode =
  | "name_length"
  | "invite_code_length"
  | "invite_code_duplicate";

/**
 * Outcome of validating a candidate group against the field constraints and the
 * invite-code uniqueness index.
 *
 *   - `accepted: true`  → the candidate satisfies every constraint and would be
 *     persisted.
 *   - `accepted: false` → the candidate is rejected; `error` identifies the
 *     invalid or duplicate field and existing records are unchanged (Req 11.2).
 */
export type GroupFieldResult =
  | { accepted: true }
  | { accepted: false; error: GroupFieldErrorCode };

/** Whether a group `name` length is within the schema's [1, 200] range. */
export function isValidGroupName(name: string): boolean {
  return (
    name.length >= GROUP_NAME_MIN_LENGTH && name.length <= GROUP_NAME_MAX_LENGTH
  );
}

/** Whether an `invite_code` length is within the schema's [6, 32] range. */
export function isValidInviteCodeLength(inviteCode: string): boolean {
  return (
    inviteCode.length >= INVITE_CODE_MIN_LENGTH &&
    inviteCode.length <= INVITE_CODE_MAX_LENGTH
  );
}

/**
 * Validate a candidate group `(name, inviteCode)` against the `groups` field
 * constraints and the `invite_code` uniqueness index (Req 11.1, 11.2).
 *
 * Returns `{ accepted: true }` iff the name length is in [1, 200], the invite
 * code length is in [6, 32], and the invite code is not already present in
 * `existingCodes`. Otherwise returns `{ accepted: false, error }` identifying
 * the first offending field. The function is pure and never mutates
 * `existingCodes`, so "existing group records are unchanged" holds trivially
 * on the rejection path.
 *
 * @param name          the candidate group name exactly as submitted.
 * @param inviteCode    the candidate invite code exactly as submitted.
 * @param existingCodes invite codes already taken by other groups.
 */
export function validateGroupFields(
  name: string,
  inviteCode: string,
  existingCodes: Iterable<string> = []
): GroupFieldResult {
  // Name length constraint (Req 11.1, 11.2).
  if (!isValidGroupName(name)) {
    return { accepted: false, error: "name_length" };
  }

  // Invite-code length constraint (Req 11.1, 11.2).
  if (!isValidInviteCodeLength(inviteCode)) {
    return { accepted: false, error: "invite_code_length" };
  }

  // Invite-code uniqueness — the collection's unique index (Req 11.1, 11.2).
  const taken =
    existingCodes instanceof Set ? existingCodes : new Set(existingCodes);
  if (taken.has(inviteCode)) {
    return { accepted: false, error: "invite_code_duplicate" };
  }

  return { accepted: true };
}
