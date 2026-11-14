// lib/backend/progressRange.ts
//
// Pure, testable mirror of the PocketBase `progress` range-validation hook
// (`pocketbase/pb_hooks/progress_range.pb.js`, task 4.2).
//
// The hook rejects/accepts a submitted `chapter_completed` (the generic
// completed count) against the related session's `total_chapters`. This module
// re-implements that exact decision as a pure function so it can be exercised
// directly in a Node test environment — the hook itself runs inside the
// PocketBase JSVM and cannot be imported here.
//
// Decision mirrored from the hook (Req 6.1, 6.2, 6.3, 11.5, 11.6):
//   - a submitted value that is an integer in `[0, total]` is ACCEPTED and
//     stored as-is (including values lower than the existing count, Req 6.3);
//   - any other submission (< 0, > total, or non-integer) is REJECTED with an
//     out-of-range error, leaving the existing stored count unchanged
//     (Req 6.2, 11.6).

/** Why a progress submission was rejected. Mirrors the hook's error codes. */
export type ProgressRangeErrorCode = "not_integer" | "out_of_range";

/**
 * Outcome of validating a submitted completed count against a session total.
 *
 *   - `accepted: true`  → the submission is valid; `stored` is the new count.
 *   - `accepted: false` → the submission is rejected; `stored` is the retained
 *     existing count and `error` describes the out-of-range failure.
 */
export type ProgressRangeResult =
  | { accepted: true; stored: number }
  | { accepted: false; stored: number; error: ProgressRangeErrorCode };

/**
 * Validate a submitted completed count `submitted` for a progress record whose
 * session has `total` chapters/units and whose currently stored count is
 * `existing`.
 *
 * Returns the stored count after the decision: the submitted value when
 * accepted, or the retained existing value when rejected. This is the single
 * source of truth the property test checks, kept behaviorally identical to the
 * hook so the two cannot drift.
 *
 * @param total    The session total count (`total_chapters`), an integer in
 *                 `[1, 100000]` per the data model (Req 11.4).
 * @param existing The currently stored completed count, in `[0, total]`.
 * @param submitted The value the member submitted (may be any number).
 */
export function validateProgressRange(
  total: number,
  existing: number,
  submitted: number
): ProgressRangeResult {
  // Reject non-numeric / non-integer submissions outright (Req 11.6), retaining
  // the existing value. Mirrors the hook's `Number.isFinite`/`isInteger` guard.
  if (!Number.isFinite(submitted) || !Number.isInteger(submitted)) {
    return { accepted: false, stored: existing, error: "not_integer" };
  }

  // Enforce the [0, total] range (Req 6.2, 11.6). Out-of-range values are
  // rejected rather than clamped, so the existing record is left unchanged.
  if (submitted < 0 || submitted > total) {
    return { accepted: false, stored: existing, error: "out_of_range" };
  }

  // In-range integer: accepted and stored as-is, including lower values than
  // the existing count (Req 6.1, 6.3).
  return { accepted: true, stored: submitted };
}
