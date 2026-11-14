/**
 * Platform detection over the Tauri OS plugin (Req 1.6, 1.7, 15.x).
 *
 * The Tauri OS plugin reports platforms as `"macos" | "windows" | "linux" | …`.
 * The rest of the app (notably the titlebar safe-area resolver) reasons in the
 * Node-style identifiers `darwin`/`win32`, matching the design. This module is
 * the single seam that reads the native platform and normalizes it, so callers
 * never touch the plugin directly.
 */

import { platform as tauriPlatform } from "@tauri-apps/plugin-os";

/**
 * Canonical platform identifier used across the app.
 *
 * - `"darwin"`  → macOS
 * - `"win32"`   → Windows
 * - `"linux"`   → Linux
 * - `"unknown"` → not running inside the Tauri shell (web dev, SSR/export,
 *   tests) or an unrecognized platform.
 */
export type PlatformId = "darwin" | "win32" | "linux" | "unknown";

/** Maps a raw Tauri OS platform string to a canonical {@link PlatformId}. */
export function normalizePlatform(raw: string): PlatformId {
  switch (raw) {
    case "macos":
      return "darwin";
    case "windows":
      return "win32";
    case "linux":
      return "linux";
    default:
      return "unknown";
  }
}

/** True when running inside the Tauri desktop shell. */
export function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    // Tauri injects this global into the webview at runtime.
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

/**
 * Returns the current platform identifier. Degrades to `"unknown"` when the
 * Tauri OS plugin is unavailable (web dev, static-export build, tests) so the
 * UI never crashes outside the native shell.
 */
export function getPlatform(): PlatformId {
  if (!isTauri()) {
    return "unknown";
  }
  try {
    return normalizePlatform(tauriPlatform());
  } catch {
    return "unknown";
  }
}
