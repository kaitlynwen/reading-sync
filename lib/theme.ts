/**
 * Theme resolution (Req 14).
 *
 * Pure, deterministic mapping from a {@link ThemePreference} and the current OS
 * color scheme to the concrete theme that should be applied to the root
 * element. Keeping this free of DOM/React access makes it trivially unit- and
 * property-testable (Property 15, task 12.3) and lets {@link ThemeToggle} and
 * {@link AppShell} share one source of truth for "which theme is active".
 *
 * The applied theme drives the `data-theme` attribute on the document root,
 * which in turn selects the light or dark Design_Tokens declared in
 * `app/globals.css` (task 2.1): `"dark"` sets `[data-theme="dark"]`, `"light"`
 * removes the attribute so the `:root` light tokens apply.
 */

import type { ThemePreference } from "@/lib/backend/config";

/** The concrete theme applied to the root element. */
export type AppliedTheme = "light" | "dark";

/**
 * Resolve the concrete theme to apply from the user's preference and the OS
 * color scheme (Req 14.3, 14.4, 14.5, 14.9, 14.10).
 *
 * - `"light"` / `"dark"` resolve to themselves regardless of the OS.
 * - `"system"` follows the OS: dark when the OS prefers a dark scheme, light
 *   otherwise.
 *
 * @param preference the user's selected Theme_Preference
 * @param osPrefersDark whether the operating system color scheme is dark
 *   (e.g. from `matchMedia("(prefers-color-scheme: dark)").matches`)
 */
export function resolveTheme(
  preference: ThemePreference,
  osPrefersDark: boolean,
): AppliedTheme {
  switch (preference) {
    case "light":
      return "light";
    case "dark":
      return "dark";
    case "system":
    default:
      return osPrefersDark ? "dark" : "light";
  }
}

/** Media query that reports the operating-system dark color scheme. */
export const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

/**
 * Read whether the operating system currently prefers a dark color scheme.
 * Degrades to `false` (light) when `matchMedia` is unavailable (SSR/static
 * export, tests) so callers never crash outside a browser window.
 */
export function osPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(DARK_SCHEME_QUERY).matches;
}

/**
 * Apply an {@link AppliedTheme} to a root element by toggling the
 * `data-theme="dark"` attribute the token stylesheet keys off (task 2.1).
 *
 * `"dark"` sets the attribute; `"light"` removes it so the `:root` light tokens
 * take effect. Synchronous and cheap so it completes well within the 200ms /
 * 1s budgets (Req 14.3, 14.4, 14.5).
 *
 * @param theme the concrete theme to apply
 * @param root the element to mutate; defaults to `document.documentElement`
 */
export function applyTheme(
  theme: AppliedTheme,
  root: HTMLElement | null = typeof document !== "undefined"
    ? document.documentElement
    : null,
): void {
  if (!root) return;
  if (theme === "dark") {
    root.setAttribute("data-theme", "dark");
  } else {
    root.removeAttribute("data-theme");
  }
}
