/**
 * Titlebar safe-area resolver (Req 15.1, 15.2, 15.3).
 *
 * Pure, deterministic mapping from a platform identifier to the reserved
 * padding that keeps native window controls from overlapping application UI:
 *
 * - macOS (`darwin`):  76px of LEFT padding (top header + Navigation Rail)
 *   so the traffic-light controls never overlap app UI.
 * - Windows (`win32`): 136px of RIGHT padding in the top bar so the
 *   minimize/maximize/close controls never overlap app UI.
 * - every other platform: 0px on every edge.
 *
 * This module holds no platform-detection logic of its own; callers pass the
 * identifier produced by {@link ./platform.getPlatform}. Keeping it pure makes
 * it trivially unit- and property-testable.
 */

import type { PlatformId } from "./platform";

/** Exact macOS left padding in pixels (Req 15.1). */
export const MACOS_SAFE_AREA_LEFT = 76;

/** Exact Windows right padding in pixels (Req 15.2). */
export const WINDOWS_SAFE_AREA_RIGHT = 136;

/** Reserved padding, in pixels, for each edge of the app chrome. */
export interface TitlebarSafeArea {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const ZERO_SAFE_AREA: TitlebarSafeArea = {
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
};

/**
 * Resolves the Titlebar_Safe_Area padding for a given platform.
 *
 * @param platform canonical platform identifier (see {@link PlatformId})
 * @returns the reserved padding on each edge
 */
export function resolveTitlebarSafeArea(
  platform: PlatformId,
): TitlebarSafeArea {
  switch (platform) {
    case "darwin":
      return { ...ZERO_SAFE_AREA, left: MACOS_SAFE_AREA_LEFT };
    case "win32":
      return { ...ZERO_SAFE_AREA, right: WINDOWS_SAFE_AREA_RIGHT };
    default:
      return { ...ZERO_SAFE_AREA };
  }
}
