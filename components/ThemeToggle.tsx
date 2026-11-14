"use client";

/**
 * ThemeToggle — Light / Dark / System segmented control (Req 14).
 *
 * Lives in the Navigation_Rail footer (via {@link AppShell} → NavigationRail
 * `footer` slot). It is the single UI control for the user's Theme_Preference
 * and the owner of applying the resolved Design_Tokens to the document root:
 *
 * - Presents exactly three mutually-exclusive options and marks the selected
 *   one (Req 14.1, 14.2).
 * - Applying a selection toggles `data-theme` on the root element synchronously
 *   via {@link applyTheme}, so Light/Dark/System tokens take effect immediately,
 *   well within the 200ms budget (Req 14.3, 14.4).
 * - While `System` is selected, a `matchMedia` listener re-resolves and reapplies
 *   on live OS color-scheme changes without a restart, inside the 1s budget
 *   (Req 14.5).
 * - On selection it persists the preference through `setThemePreference`
 *   (Req 14.6); the persisted value is read back by {@link loadConfig} on start
 *   and applied (Req 14.8, 14.9, 14.10).
 * - If persisting fails, it keeps applying the already-resolved tokens for the
 *   session and surfaces a "couldn’t save" indication rather than reverting
 *   (Req 14.7).
 *
 * Theme resolution itself (preference + OS → applied theme) is the pure
 * {@link resolveTheme} in `lib/theme.ts`, shared with the property test
 * (task 12.3).
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  loadConfig,
  setThemePreference,
  type ThemePreference,
} from "@/lib/backend/config";
import {
  DARK_SCHEME_QUERY,
  applyTheme,
  osPrefersDark,
  resolveTheme,
} from "@/lib/theme";

/** The three selectable options, in display order (Req 14.1). */
const OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

export interface ThemeToggleProps {
  /**
   * Whether the hosting rail shows labels (expanded mode). When false the
   * segmented control stays compact; the accessible labels are retained either
   * way. Defaults to showing labels.
   */
  labelled?: boolean;
}

export default function ThemeToggle({ labelled = true }: ThemeToggleProps) {
  // The default mirrors the config store's default so the very first paint
  // (before loadConfig resolves) matches "System" (Req 14.9).
  const [preference, setPreference] = useState<ThemePreference>("system");
  // Set only when a persist attempt fails, to surface the "couldn’t save"
  // indication (Req 14.7).
  const [saveFailed, setSaveFailed] = useState(false);

  // Keep the latest preference in a ref so the long-lived matchMedia listener
  // always reads the current value without re-subscribing on every change.
  // The ref is synced in an effect (not during render) to satisfy React's
  // rule against mutating refs while rendering.
  const preferenceRef = useRef<ThemePreference>(preference);
  useEffect(() => {
    preferenceRef.current = preference;
  }, [preference]);

  /** Resolve `preference` against the live OS scheme and apply it to the root. */
  const applyPreference = useCallback((p: ThemePreference) => {
    applyTheme(resolveTheme(p, osPrefersDark()));
  }, []);

  // On start: read the persisted preference and apply it (Req 14.8, 14.9,
  // 14.10). `loadConfig` already normalizes a missing/invalid value to
  // "system", so this also covers the no-preference-persisted case.
  useEffect(() => {
    let cancelled = false;
    loadConfig()
      .then((config) => {
        if (cancelled) return;
        setPreference(config.themePreference);
        applyPreference(config.themePreference);
      })
      .catch(() => {
        // Config read failed — fall back to applying the default so the app is
        // never left unthemed.
        if (cancelled) return;
        applyPreference("system");
      });
    return () => {
      cancelled = true;
    };
  }, [applyPreference]);

  // Follow live OS color-scheme changes while (and only while) the preference
  // is "system" (Req 14.5). The listener is always mounted but is a no-op for
  // explicit Light/Dark, so toggling preference never needs to re-subscribe.
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mql = window.matchMedia(DARK_SCHEME_QUERY);
    const onChange = () => {
      if (preferenceRef.current === "system") {
        applyPreference("system");
      }
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [applyPreference]);

  /** Handle a user selecting one of the three options. */
  const select = useCallback(
    async (next: ThemePreference) => {
      // Apply the tokens immediately so the change is visible within 200ms,
      // independent of how long persistence takes (Req 14.3, 14.4).
      setPreference(next);
      applyPreference(next);

      // Persist the choice. On failure, keep the just-applied tokens and show
      // the "couldn’t save" indication rather than reverting (Req 14.6, 14.7).
      try {
        await setThemePreference(next);
        setSaveFailed(false);
      } catch {
        setSaveFailed(true);
      }
    },
    [applyPreference],
  );

  return (
    <div className="flex w-full flex-col gap-1">
      <div
        role="radiogroup"
        aria-label="Theme"
        className={[
          "flex items-center gap-0.5 rounded-[var(--radius-pill)]",
          "bg-text-on-dark/10 p-0.5",
          labelled ? "w-full" : "flex-col",
        ].join(" ")}
      >
        {OPTIONS.map((option) => {
          const selected = preference === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={option.label}
              title={option.label}
              onClick={() => void select(option.value)}
              className={[
                "flex-1 rounded-[var(--radius-pill)] px-2 py-1 text-xs",
                "transition-colors duration-150",
                "focus-visible:outline focus-visible:outline-2",
                selected
                  ? "bg-text-on-dark/20 font-medium text-text-on-dark"
                  : "text-text-on-dark/70 hover:text-text-on-dark",
              ].join(" ")}
            >
              {labelled ? option.label : option.label.charAt(0)}
            </button>
          );
        })}
      </div>

      {saveFailed && (
        <p role="status" className="px-1 text-[11px] text-text-on-dark/70">
          Couldn’t save your theme preference.
        </p>
      )}
    </div>
  );
}
