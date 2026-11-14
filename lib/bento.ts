/**
 * Pure geometry + token helpers for the Warm Editorial Bento primitives
 * (Req 13.1).
 *
 * The React primitives under `components/bento/` are thin wrappers; every value
 * that can be computed without the DOM lives here so it stays trivially
 * unit- and property-testable under the project's node test environment.
 *
 * Every constant is lifted verbatim from the authoritative design system:
 *   - Radii / borders / gaps / padding / shadows: `.kiro/steering/ui-design.md` §4, §5
 *   - The matching Design_Tokens: `app/globals.css` (task 2.1)
 *
 * IMPORTANT (steering §12 — Implementation Hygiene): components must never
 * hardcode hex colors. These helpers emit `var(--token)` references or the
 * steering's non-color geometry (radii, aspect ratios, shadow offsets) only.
 */

/** The accent palette usable for pastel bento tiles and monogram avatars. */
export type BentoAccent =
  | "peach"
  | "sage"
  | "lavender"
  | "butter"
  | "sky";

/** Ordered accent list used for deterministic monogram selection (steering §10). */
export const MONOGRAM_ACCENTS: readonly BentoAccent[] = [
  "peach",
  "sage",
  "lavender",
  "butter",
] as const;

/** Maps a {@link BentoAccent} to its Design_Token background variable. */
export function accentVar(accent: BentoAccent): string {
  return `var(--accent-${accent})`;
}

/* -------------------------------------------------------------------------- */
/* Radii (steering §4 → globals.css)                                          */
/* -------------------------------------------------------------------------- */

/** 18px — primary bento cards (`--radius-card`). */
export const RADIUS_CARD = "var(--radius-card)";
/** 12px — inner sub-cards / thumbnails (`--radius-inner`). */
export const RADIUS_INNER = "var(--radius-inner)";
/** 9999px — pills, chips, badges, primary CTAs (`--radius-pill`). */
export const RADIUS_PILL = "var(--radius-pill)";

/**
 * Book-cover corner radius. The steering §5 specifies a `6px–8px` radius for
 * book covers specifically (distinct from the 12px inner-card radius); we use
 * the midpoint `7px` so covers read as covers, not generic thumbnails.
 */
export const RADIUS_BOOK_COVER = "7px";

/* -------------------------------------------------------------------------- */
/* Borders (steering §4 → globals.css)                                        */
/* -------------------------------------------------------------------------- */

/** 1px hairline card outline / divider (`--border-subtle`). */
export const BORDER_HAIRLINE = "1px solid var(--border-subtle)";
/** 1px stronger outline for active / focused surfaces (`--border-strong`). */
export const BORDER_STRONG = "1px solid var(--border-strong)";

/* -------------------------------------------------------------------------- */
/* Grid rhythm & padding (steering §4 → globals.css)                          */
/* -------------------------------------------------------------------------- */

/** Minimum bento grid gap: 16px (`--space-grid-gap-min`). */
export const GRID_GAP_MIN = "var(--space-grid-gap-min)";
/** Maximum bento grid gap: 20px (`--space-grid-gap-max`). */
export const GRID_GAP_MAX = "var(--space-grid-gap-max)";
/** Minimum internal card padding: 20px (`--space-card-padding-min`). */
export const CARD_PADDING_MIN = "var(--space-card-padding-min)";
/** Maximum internal card padding: 24px (`--space-card-padding-max`). */
export const CARD_PADDING_MAX = "var(--space-card-padding-max)";

/* -------------------------------------------------------------------------- */
/* Elevation (steering §4, §5 → globals.css)                                  */
/* -------------------------------------------------------------------------- */

/** Soft float shadow for popovers/modals (`--shadow-float`). */
export const SHADOW_FLOAT = "var(--shadow-float)";
/** Book-spine shadow for covers (`--shadow-spine`). */
export const SHADOW_SPINE = "var(--shadow-spine)";

/* -------------------------------------------------------------------------- */
/* Book cover geometry (steering §5)                                          */
/* -------------------------------------------------------------------------- */

/** Authentic book-cover aspect ratio: width:height = 2:3 (steering §5). */
export const BOOK_COVER_ASPECT = "2 / 3";

/* -------------------------------------------------------------------------- */
/* Avatars (steering §5, §10)                                                 */
/* -------------------------------------------------------------------------- */

/** Friend avatar diameter on the shared progress track: 28px (steering §5). */
export const AVATAR_SIZE = 28;
/** 2px ring around overlapping avatars so they separate cleanly (steering §10). */
export const AVATAR_RING = "2px solid var(--bg-surface)";

/**
 * Derives up to two uppercase initials from a display name (steering §10).
 *
 * - Uses the first letter of the first and last whitespace-separated words.
 * - Falls back to the first two characters of a single word.
 * - Returns an empty string when no alphanumeric content is present.
 */
export function initialsFromName(displayName: string): string {
  const words = displayName
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);

  if (words.length === 0) return "";

  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }

  const first = words[0][0];
  const last = words[words.length - 1][0];
  return (first + last).toUpperCase();
}

/**
 * Deterministically selects a monogram accent for a key (steering §10).
 *
 * The same key always maps to the same accent so a member keeps a stable
 * color across renders and sessions. Uses a simple, stable string hash over
 * {@link MONOGRAM_ACCENTS}.
 */
export function monogramAccent(key: string): BentoAccent {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    // djb2-style rolling hash kept in the 32-bit range.
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % MONOGRAM_ACCENTS.length;
  return MONOGRAM_ACCENTS[index];
}

/* -------------------------------------------------------------------------- */
/* Progress track (steering §5)                                               */
/* -------------------------------------------------------------------------- */

/**
 * Clamps a raw fraction (completed / goal) to a `0–100` percent for positioning
 * avatars and fills on the shared progress track. Non-finite, negative, and
 * over-goal values are clamped so avatars never escape the track.
 */
export function toTrackPercent(completed: number, goal: number): number {
  if (!Number.isFinite(completed) || !Number.isFinite(goal) || goal <= 0) {
    return 0;
  }
  const pct = (completed / goal) * 100;
  if (pct < 0) return 0;
  if (pct > 100) return 100;
  return pct;
}
