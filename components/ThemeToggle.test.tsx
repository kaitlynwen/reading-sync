// @vitest-environment jsdom
//
// UI tests for the Light / Dark / System theme toggle (task 12.4).
//
// Exercises ThemeToggle end-to-end against the real `lib/theme` helpers so the
// assertions observe the actual `data-theme` attribute the token stylesheet
// (task 2.1) keys off, while the two side-effecting seams are mocked:
//
//   - `@/lib/backend/config` — `loadConfig` (persisted preference read on start)
//     and `setThemePreference` (persist on selection) are stubbed so no Tauri
//     store is touched.
//   - `window.matchMedia` — replaced with a controllable fake whose `matches`
//     we flip and whose `change` listeners we fire, standing in for the OS
//     color scheme and its live changes.
//
// Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5, 14.8, 14.9
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { AppConfig, ThemePreference } from "@/lib/backend/config";

// --- Mock the config seam -------------------------------------------------
// Default: no persisted preference -> loadConfig resolves "system" (the store's
// own normalization, Req 14.9). Individual tests override loadConfig to model a
// persisted preference, and inspect setThemePreference to assert persistence.
const loadConfig = vi.fn<() => Promise<AppConfig>>();
const setThemePreference = vi.fn<(p: ThemePreference) => Promise<void>>();

vi.mock("@/lib/backend/config", () => ({
  loadConfig: () => loadConfig(),
  setThemePreference: (p: ThemePreference) => setThemePreference(p),
}));

// Import after the mock is registered. `lib/theme` is intentionally NOT mocked:
// the test asserts against the real data-theme toggling it performs.
import ThemeToggle from "./ThemeToggle";

// --- Controllable matchMedia fake ----------------------------------------
// `osDark` is the single source of truth for the simulated OS scheme. Every
// MediaQueryList the component creates reads it live and is registered so we can
// broadcast a `change` to all of them (as a real OS scheme flip would).
let osDark = false;
let mediaLists: Array<{
  mql: MediaQueryList;
  listeners: Set<(e: MediaQueryListEvent) => void>;
}>;

function installMatchMedia() {
  mediaLists = [];
  const factory = (query: string): MediaQueryList => {
    const listeners = new Set<(e: MediaQueryListEvent) => void>();
    const mql = {
      media: query,
      get matches() {
        // Only the dark-scheme query tracks `osDark`; anything else is false.
        return query.includes("dark") ? osDark : false;
      },
      onchange: null,
      addEventListener: (_type: string, cb: (e: MediaQueryListEvent) => void) => {
        listeners.add(cb);
      },
      removeEventListener: (
        _type: string,
        cb: (e: MediaQueryListEvent) => void,
      ) => {
        listeners.delete(cb);
      },
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    } as unknown as MediaQueryList;
    mediaLists.push({ mql, listeners });
    return mql;
  };
  vi.stubGlobal("matchMedia", factory);
  // Also expose on window for code paths that reference window.matchMedia.
  window.matchMedia = factory as typeof window.matchMedia;
}

/** Flip the simulated OS scheme and broadcast a `change` to every listener. */
function setOsDark(next: boolean) {
  osDark = next;
  act(() => {
    for (const { mql, listeners } of mediaLists) {
      for (const cb of listeners) {
        cb({ matches: mql.matches, media: mql.media } as MediaQueryListEvent);
      }
    }
  });
}

/** The concrete theme currently applied to the document root. */
function appliedTheme(): "light" | "dark" {
  return document.documentElement.getAttribute("data-theme") === "dark"
    ? "dark"
    : "light";
}

/** The option button for a given preference, by its accessible label. */
function optionButton(label: "Light" | "Dark" | "System"): HTMLButtonElement {
  return screen.getByRole("radio", { name: label }) as HTMLButtonElement;
}

/**
 * Render ThemeToggle and flush the on-mount `loadConfig().then(...)` microtask
 * so the start-up effect (Req 14.8/14.9) has applied its theme before asserting.
 */
async function renderToggle() {
  const utils = render(<ThemeToggle />);
  await act(async () => {
    await Promise.resolve();
  });
  return utils;
}

beforeEach(() => {
  osDark = false;
  installMatchMedia();
  loadConfig.mockReset();
  setThemePreference.mockReset();
  // Default: nothing persisted -> store normalizes to "system".
  loadConfig.mockResolvedValue({
    backendEndpoint: null,
    themePreference: "system",
  });
  setThemePreference.mockResolvedValue(undefined);
  // Start each test from a clean root (no data-theme).
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-theme");
});

describe("ThemeToggle (Req 14)", () => {
  // Req 14.1 — exactly three mutually-exclusive options {Light, Dark, System}.
  it("presents exactly the three theme options as a single-select radiogroup", async () => {
    await renderToggle();

    const group = screen.getByRole("radiogroup", { name: "Theme" });
    expect(group).toBeDefined();

    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("aria-label"))).toEqual([
      "Light",
      "Dark",
      "System",
    ]);
  });

  // Req 14.2 — the control indicates which single option is selected.
  it("marks exactly one option selected via aria-checked", async () => {
    await renderToggle();

    const checked = screen
      .getAllByRole("radio")
      .filter((r) => r.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    // Default (no persisted preference) is System (Req 14.9).
    expect(checked[0].getAttribute("aria-label")).toBe("System");
  });

  // Req 14.9 — no persisted preference on start -> System, and because the OS is
  // light here, the applied theme is light (data-theme absent).
  it("defaults to System when no preference is persisted", async () => {
    await renderToggle();

    expect(optionButton("System").getAttribute("aria-checked")).toBe("true");
    expect(appliedTheme()).toBe("light");
  });

  // Req 14.3 — selecting Light applies the light tokens (data-theme removed).
  it("applies the light theme when Light is selected", async () => {
    // Start dark so the switch to Light is observable.
    osDark = true;
    await renderToggle();
    expect(appliedTheme()).toBe("dark"); // System + dark OS

    const start = performance.now();
    await act(async () => {
      fireEvent.click(optionButton("Light"));
    });
    const elapsed = performance.now() - start;

    expect(appliedTheme()).toBe("light");
    expect(optionButton("Light").getAttribute("aria-checked")).toBe("true");
    // Req 14.3 — applied within 200ms (synchronous apply; comfortably under).
    expect(elapsed).toBeLessThan(200);
  });

  // Req 14.3 — selecting Dark applies the dark tokens (data-theme="dark").
  it("applies the dark theme when Dark is selected", async () => {
    await renderToggle();
    expect(appliedTheme()).toBe("light");

    const start = performance.now();
    await act(async () => {
      fireEvent.click(optionButton("Dark"));
    });
    const elapsed = performance.now() - start;

    expect(appliedTheme()).toBe("dark");
    expect(optionButton("Dark").getAttribute("aria-checked")).toBe("true");
    expect(elapsed).toBeLessThan(200);
  });

  // Req 14.4 — selecting System applies the theme matching the current OS scheme.
  it("matches the OS scheme when System is selected", async () => {
    // Begin on an explicit Light preference over a dark OS, so selecting System
    // must flip the applied theme to dark to match the OS.
    loadConfig.mockResolvedValue({
      backendEndpoint: null,
      themePreference: "light",
    });
    osDark = true;
    await renderToggle();
    expect(appliedTheme()).toBe("light"); // explicit light overrides OS

    const start = performance.now();
    await act(async () => {
      fireEvent.click(optionButton("System"));
    });
    const elapsed = performance.now() - start;

    // System matches the dark OS.
    expect(appliedTheme()).toBe("dark");
    expect(elapsed).toBeLessThan(200);
  });

  // Req 14.5 — while System is selected, a live OS scheme change is reflected
  // without a restart.
  it("follows live OS color-scheme changes while System is selected", async () => {
    await renderToggle(); // System, OS light -> light
    expect(appliedTheme()).toBe("light");

    // OS flips to dark.
    setOsDark(true);
    expect(appliedTheme()).toBe("dark");

    // OS flips back to light.
    setOsDark(false);
    expect(appliedTheme()).toBe("light");
  });

  // Req 14.5 (negative) — an explicit Light/Dark preference does NOT follow the
  // OS; a live scheme change must not override the user's explicit choice.
  it("ignores live OS changes when an explicit preference is selected", async () => {
    await renderToggle();
    await act(async () => {
      fireEvent.click(optionButton("Light"));
    });
    expect(appliedTheme()).toBe("light");

    // OS goes dark — explicit Light must win.
    setOsDark(true);
    expect(appliedTheme()).toBe("light");
  });

  // Req 14.8 — a persisted preference is read and applied on start.
  it("applies a persisted Dark preference on start", async () => {
    loadConfig.mockResolvedValue({
      backendEndpoint: null,
      themePreference: "dark",
    });

    await renderToggle();

    expect(appliedTheme()).toBe("dark");
    expect(optionButton("Dark").getAttribute("aria-checked")).toBe("true");
  });

  // Req 14.8 — a persisted System preference on start resolves against the OS.
  it("applies a persisted System preference against the OS scheme on start", async () => {
    loadConfig.mockResolvedValue({
      backendEndpoint: null,
      themePreference: "system",
    });
    osDark = true;

    await renderToggle();

    expect(optionButton("System").getAttribute("aria-checked")).toBe("true");
    expect(appliedTheme()).toBe("dark");
  });

  // Req 14.6 (supporting) — selecting a preference persists it via the config
  // seam so it is retained for the next start (the read-back path of Req 14.8).
  it("persists the selected preference through setThemePreference", async () => {
    await renderToggle();

    await act(async () => {
      fireEvent.click(optionButton("Dark"));
    });

    expect(setThemePreference).toHaveBeenCalledWith("dark");
  });
});
