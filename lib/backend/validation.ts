// lib/backend/validation.ts
//
// Pure, UI-agnostic input validators used by the auth screens before a request
// is submitted to the PocketBase_Backend (Req 3.2–3.4).
//
// These helpers contain no side effects and never touch the backend or the
// Tauri shell, so they are trivially unit- and property-testable and can be
// shared between the create-account and login screens.

/**
 * Decide whether `email` is a valid email address per Req 3.3: it must contain
 * a single "@" separator with a non-empty local part (before the "@") and a
 * non-empty domain part (after the "@").
 *
 * The check is intentionally structural rather than a full RFC 5322 parse — the
 * requirement defines validity solely in terms of the single-"@"/non-empty-parts
 * rule, and the PocketBase_Backend performs its own authoritative validation on
 * submission (Req 3.1). This gate exists to block obviously malformed addresses
 * client-side and show a validation message without a backend round-trip.
 *
 * Validity rule (Req 3.3): valid iff the string contains exactly one "@" and
 * both the substring before it and the substring after it are non-empty.
 *
 * @param email the candidate address exactly as entered (not trimmed here;
 *   callers decide whether to trim before validating)
 * @returns `true` iff `email` satisfies the single-"@"/non-empty-parts rule
 */
export function isValidEmail(email: string): boolean {
  const atIndex = email.indexOf("@");

  // Must contain an "@" at all.
  if (atIndex === -1) return false;

  // Must contain exactly one "@": the last occurrence must be the first one.
  if (email.lastIndexOf("@") !== atIndex) return false;

  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);

  // Both the local and domain parts must be non-empty.
  return local.length > 0 && domain.length > 0;
}

/**
 * Decide whether the password and its confirmation entry match exactly (Req
 * 3.4). The comparison is literal and case-/whitespace-sensitive: the two
 * entries must be the identical string. No trimming or normalization is applied
 * because a password's surrounding whitespace is significant.
 *
 * @param password the password as entered
 * @param confirmation the confirmation entry as entered
 * @returns `true` iff the two strings are exactly equal
 */
export function passwordsMatch(
  password: string,
  confirmation: string,
): boolean {
  return password === confirmation;
}

/**
 * The outcome of gating a create-account submission client-side, before any
 * request reaches the PocketBase_Backend (Req 3.2–3.4). When `ok` is `false`,
 * the screen shows `message` and performs no backend call; when `ok` is `true`,
 * the inputs have passed every client-side gate and the backend call may run.
 */
export interface CreateAccountGate {
  /** `true` iff submission may proceed to the backend. */
  ok: boolean;
  /** The validation message to display when `ok` is `false`; empty otherwise. */
  message: string;
}

/**
 * Gate a create-account submission against the client-side rules that must hold
 * before any request is sent to the PocketBase_Backend (Req 3.2–3.4):
 *
 *   1. all required fields are non-empty (the email is trimmed first) (Req 3.2);
 *   2. the email has a single "@" with non-empty parts (Req 3.3);
 *   3. the password and confirmation match exactly (Req 3.4).
 *
 * This is the single source of truth for whether the create-account screen is
 * allowed to call `createAccount`. Returning a structured result (rather than
 * throwing) keeps the helper pure and lets the screen both block the backend
 * call and render the right message. A `false` result means the screen MUST NOT
 * submit to the backend.
 *
 * @param email the email as entered (trimmed internally for the empty check)
 * @param password the password as entered
 * @param confirmation the confirmation entry as entered
 * @returns a {@link CreateAccountGate} describing whether to proceed
 */
export function gateCreateAccount(
  email: string,
  password: string,
  confirmation: string,
): CreateAccountGate {
  if (!email.trim() || !password || !confirmation) {
    return { ok: false, message: "Fill out all fields." };
  }

  if (!isValidEmail(email.trim())) {
    return { ok: false, message: "Enter a valid email address." };
  }

  if (!passwordsMatch(password, confirmation)) {
    return { ok: false, message: "Passwords do not match." };
  }

  return { ok: true, message: "" };
}

// ---------------------------------------------------------------------------
// Group operation gates (Req 4.1–4.9)
// ---------------------------------------------------------------------------
//
// Like the auth gates above, these are pure client-side decisions made before
// any request reaches the PocketBase_Backend. They mirror the group-creation
// (Req 4.4) and group-join (Req 4.7) validation rules: a submission is blocked
// with a message when a required name is empty after trimming surrounding
// whitespace, and allowed otherwise.

/**
 * The outcome of gating a group-operation submission client-side, before any
 * request reaches the PocketBase_Backend. When `ok` is `false`, the screen
 * shows `message` and performs no backend call; when `ok` is `true`, the inputs
 * have passed every client-side gate and the backend call may run.
 */
export interface GroupGate {
  /** `true` iff submission may proceed to the backend. */
  ok: boolean;
  /** The validation message to display when `ok` is `false`; empty otherwise. */
  message: string;
}

/**
 * Gate a create-group submission (Req 4.4): both the group name and the display
 * name must be non-empty after trimming surrounding whitespace. A `false`
 * result means the create-group screen MUST NOT submit to the backend.
 *
 * @param groupName the group name as entered (trimmed internally)
 * @param displayName the display name as entered (trimmed internally)
 * @returns a {@link GroupGate} describing whether to proceed
 */
export function gateCreateGroup(
  groupName: string,
  displayName: string,
): GroupGate {
  if (!groupName.trim() || !displayName.trim()) {
    return { ok: false, message: "Enter a group name and your display name." };
  }

  return { ok: true, message: "" };
}

/**
 * Gate a join-group submission (Req 4.7, 4.8): an invite code must be entered
 * so the backend can be queried for a matching group, and the display name must
 * be non-empty after trimming surrounding whitespace. A `false` result means
 * the join-group screen MUST NOT submit to the backend.
 *
 * The invite code is only checked for presence here; whether it matches an
 * existing group (Req 4.8) is an authoritative backend lookup, not a
 * client-side rule.
 *
 * @param inviteCode the invite code as entered (trimmed internally)
 * @param displayName the display name as entered (trimmed internally)
 * @returns a {@link GroupGate} describing whether to proceed
 */
export function gateJoinGroup(
  inviteCode: string,
  displayName: string,
): GroupGate {
  if (!inviteCode.trim() || !displayName.trim()) {
    return { ok: false, message: "Enter an invite code and display name." };
  }

  return { ok: true, message: "" };
}

// ---------------------------------------------------------------------------
// Reading-session validation (Req 5.1–5.5)
// ---------------------------------------------------------------------------
//
// Pure, UI- and backend-agnostic validators for the create reading-session
// form. The create-session screen gates on these before touching the backend,
// and they are the single source of truth for what a valid session
// configuration is, so the rules are unit- and property-testable in isolation.

import type { ReadingUnit } from "@/app/group/[id]/types";

/**
 * The exact set of progress types a Reading_Session may use (Req 5.2). This is
 * the authoritative allow-list: a submitted progress type is valid if and only
 * if it is one of these four values.
 */
export const PROGRESS_TYPES = [
  "chapters",
  "pages",
  "milestones",
  "sections",
] as const;

/** A progress type known to be one of the four allowed values (Req 5.2). */
export type ProgressType = (typeof PROGRESS_TYPES)[number];

/**
 * Decide whether `value` is one of the four allowed progress types (Req 5.2).
 * Any value outside {chapters, pages, milestones, sections} is rejected. Acts
 * as a type guard so callers can narrow a raw string to {@link ProgressType}.
 */
export function isValidProgressType(value: string): value is ProgressType {
  return (PROGRESS_TYPES as readonly string[]).includes(value);
}

/**
 * The `milestones` and `sections` progress types track progress by a list of
 * custom unit labels rather than a numeric count (Req 5.3, 5.5); `chapters` and
 * `pages` track progress by a numeric total count (Req 5.4).
 */
export function usesCustomUnits(progressType: ProgressType): boolean {
  return progressType === "milestones" || progressType === "sections";
}

/**
 * Decide whether `value` is a positive whole number — the rule for the
 * chapters/pages total count (Req 5.4). Accepts a raw form string (as entered)
 * or a number; a value is valid iff it parses to an integer that is at least 1.
 * Blank, non-numeric, fractional, zero, and negative inputs are all rejected.
 */
export function isPositiveWholeNumber(value: string | number): boolean {
  if (typeof value === "string") {
    if (value.trim() === "") return false;
  }
  const n = Number(value);
  return Number.isInteger(n) && n >= 1;
}

/**
 * Normalize raw custom-unit text (one label per line, as entered in the
 * textarea) into the non-blank labels in submitted order (Req 5.3, 5.5). Each
 * line is trimmed and blank lines are dropped, but the relative order of the
 * remaining labels is preserved exactly.
 */
export function parseCustomUnitLabels(text: string): string[] {
  return text
    .split("\n")
    .map((label) => label.trim())
    .filter((label) => label.length > 0);
}

/**
 * Turn an ordered list of custom unit labels into the ordered `reading_units`
 * JSON array stored on the session, assigning a 1-based `order_index` in
 * submitted order so the order is preserved exactly (Req 5.3). The input is
 * assumed already normalized (non-blank, in submitted order) by
 * {@link parseCustomUnitLabels}.
 */
export function toReadingUnits(labels: string[]): ReadingUnit[] {
  return labels.map((label, index) => ({
    label,
    order_index: index + 1,
  }));
}

/**
 * The resolved outcome of validating a reading-session form client-side before
 * any request reaches the PocketBase_Backend (Req 5.2–5.5). When `ok` is
 * `false`, the screen shows `message` and performs no backend call. When `ok`
 * is `true`, `totalCount` is the generic completed-count ceiling to store on
 * the session (the numeric total for chapters/pages, or the number of custom
 * units for milestones/sections, Req 5.6) and `readingUnits` is the ordered
 * custom-unit array (empty for chapters/pages).
 */
export interface SessionConfig {
  ok: boolean;
  message: string;
  totalCount: number;
  readingUnits: ReadingUnit[];
}

/**
 * Validate a reading-session submission against the client-side rules that must
 * hold before the session is created (Req 5.1–5.5):
 *
 *   1. the book title is non-empty after trimming (Req 5.1);
 *   2. the progress type is one of the four allowed values (Req 5.2);
 *   3. for chapters/pages, the total count is a positive whole number (Req 5.4);
 *   4. for milestones/sections, at least one non-blank unit label is provided,
 *      and the labels are stored preserving their submitted order (Req 5.3, 5.5).
 *
 * This is the single source of truth for whether the create-session screen may
 * call the backend. Returning a structured result (rather than throwing) keeps
 * the helper pure and lets the screen both block the backend call and render
 * the right message.
 *
 * @param bookTitle the book title as entered (trimmed internally for the check)
 * @param progressType the raw progress type as selected
 * @param totalCountInput the numeric total as entered (used for chapters/pages)
 * @param customUnitLabels the non-blank custom unit labels in submitted order
 *   (used for milestones/sections; typically {@link parseCustomUnitLabels})
 */
export function gateCreateSession(
  bookTitle: string,
  progressType: string,
  totalCountInput: string | number,
  customUnitLabels: string[],
): SessionConfig {
  const fail = (message: string): SessionConfig => ({
    ok: false,
    message,
    totalCount: 0,
    readingUnits: [],
  });

  if (!bookTitle.trim()) {
    return fail("Please enter a book title.");
  }

  if (!isValidProgressType(progressType)) {
    return fail("Choose a valid progress type.");
  }

  if (usesCustomUnits(progressType)) {
    const unitName = progressType === "sections" ? "section" : "milestone";
    if (customUnitLabels.length < 1) {
      return fail(`Please enter at least one ${unitName}.`);
    }
    return {
      ok: true,
      message: "",
      totalCount: customUnitLabels.length,
      readingUnits: toReadingUnits(customUnitLabels),
    };
  }

  // chapters / pages: a positive whole total count is required (Req 5.4).
  if (!isPositiveWholeNumber(totalCountInput)) {
    return fail("Progress count must be a positive whole number.");
  }

  return {
    ok: true,
    message: "",
    totalCount: Number(totalCountInput),
    readingUnits: [],
  };
}
