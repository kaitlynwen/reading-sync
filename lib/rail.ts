/**
 * Responsive Navigation_Rail layout resolver (Req 13.8, 14.1).
 *
 * Pure, deterministic mapping from the current viewport width to the
 * Navigation_Rail width, its presentation mode, and the companion bento
 * content-column count. Every value is lifted verbatim from the authoritative
 * desktop breakpoints in `.kiro/steering/ui-design.md` §6:
 *
 * - Compact / half-screen (`< 960px`): icon-only rail at 64px, 1 content column.
 * - Standard desktop (`960px–1360px`): compact rail at 72px, 2 content columns.
 * - Wide monitor (`> 1360px`): expanded rail at 220px, 3 content columns.
 *
 * The 1440px maximum content width is a single cap that applies across every
 * breakpoint (steering §6, Req 13.8).
 *
 * Keeping the mapping pure (no DOM, no React) makes it trivially unit-testable
 * and lets the layout components stay thin wrappers around these values.
 */

/** Rail width, in pixels, for an icon-only compact/half-screen viewport. */
export const RAIL_WIDTH_ICON = 64;

/** Rail width, in pixels, for a standard-desktop compact rail. */
export const RAIL_WIDTH_COMPACT = 72;

/** Rail width, in pixels, for a wide-monitor expanded rail. */
export const RAIL_WIDTH_EXPANDED = 220;

/** Upper bound (exclusive) of the compact / half-screen breakpoint. */
export const BREAKPOINT_COMPACT_MAX = 960;

/** Upper bound (inclusive) of the standard-desktop breakpoint. */
export const BREAKPOINT_STANDARD_MAX = 1360;

/** Maximum content width, in pixels, applied at every breakpoint (Req 13.8). */
export const MAX_CONTENT_WIDTH = 1440;

/**
 * How the Navigation_Rail presents itself at a given breakpoint.
 *
 * - `"icon"`     → icon-only, labels hidden (compact / half-screen).
 * - `"compact"`  → narrow rail (standard desktop).
 * - `"expanded"` → full-width rail with labels (wide monitor).
 */
export type RailMode = "icon" | "compact" | "expanded";

/** Resolved Navigation_Rail + content layout for a viewport width. */
export interface RailLayout {
  /** Presentation mode for the rail. */
  mode: RailMode;
  /** Rail width in pixels. */
  railWidth: number;
  /** Number of bento content columns to render alongside the rail. */
  contentColumns: number;
  /** Maximum content width in pixels (constant across breakpoints). */
  maxContentWidth: number;
}

/**
 * Resolves the responsive Navigation_Rail layout for a viewport width.
 *
 * @param viewportWidth the current viewport width in CSS pixels
 * @returns the rail mode, rail width, content-column count, and content cap
 */
export function resolveRailLayout(viewportWidth: number): RailLayout {
  if (viewportWidth < BREAKPOINT_COMPACT_MAX) {
    // Compact / half-screen: icon-only rail, single stacked content column.
    return {
      mode: "icon",
      railWidth: RAIL_WIDTH_ICON,
      contentColumns: 1,
      maxContentWidth: MAX_CONTENT_WIDTH,
    };
  }

  if (viewportWidth <= BREAKPOINT_STANDARD_MAX) {
    // Standard desktop: compact rail + 2-column bento workspace.
    return {
      mode: "compact",
      railWidth: RAIL_WIDTH_COMPACT,
      contentColumns: 2,
      maxContentWidth: MAX_CONTENT_WIDTH,
    };
  }

  // Wide monitor: expanded rail + 3-column bento workspace.
  return {
    mode: "expanded",
    railWidth: RAIL_WIDTH_EXPANDED,
    contentColumns: 3,
    maxContentWidth: MAX_CONTENT_WIDTH,
  };
}
