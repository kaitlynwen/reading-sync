// @vitest-environment jsdom
//
// UI tests for cross-platform titlebar safe areas + draggable header (task 13.2).
//
// Covers the drag/no-drag region markup and the per-platform safe-area padding
// applied by AppShell and NavigationRail (task 13.1), end-to-end against the
// real `lib/titlebar` + `lib/rail` resolvers so the assertions observe the
// actual pixel values the resolvers produce. Three side-effecting seams are
// mocked:
//
//   - `@/lib/platform` — `getPlatform()` is stubbed so each test drives
//     AppShell's platform-dependent safe area without a real Tauri shell.
//   - `@/lib/backend/config` — AppShell defaults its rail footer to the real
//     ThemeToggle, which reads/persists the Theme_Preference on mount; both
//     calls are stubbed so no Tauri store is touched.
//   - `window.matchMedia` — ThemeToggle subscribes to the OS color scheme on
//     mount; a minimal no-op fake stands in for it.
//
// Validates: Requirements 15.4, 15.5, 15.6
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import type { PlatformId } from "@/lib/platform";
import {
  MACOS_SAFE_AREA_LEFT,
  WINDOWS_SAFE_AREA_RIGHT,
} from "@/lib/titlebar";

// --- Mock the platform seam ----------------------------------------------
// AppShell resolves its titlebar safe area from getPlatform() on mount. Each
// test sets `platform`; the mock returns it so the macOS/Windows/other branches
// of resolveTitlebarSafeArea are all exercised through the real component.
let platform: PlatformId = "unknown";
const getPlatform = vi.fn<() => PlatformId>(() => platform);
vi.mock("@/lib/platform", () => ({
  getPlatform: () => getPlatform(),
}));

// --- Mock the config seam (used by the default ThemeToggle footer) --------
// AppShell's default rail footer is the real ThemeToggle, which calls these on
// mount. Stub them so rendering AppShell touches no Tauri persistent store.
vi.mock("@/lib/backend/config", () => ({
  loadConfig: () =>
    Promise.resolve({ backendEndpoint: null, themePreference: "system" }),
  setThemePreference: () => Promise.resolve(),
}));

// Import after the mocks are registered.
import AppShell from "./AppShell";
import NavigationRail from "./NavigationRail";

// --- Minimal matchMedia fake ---------------------------------------------
// ThemeToggle subscribes to the dark-scheme media query on mount. A no-op list
// (matches: false, inert listeners) is enough — these tests never flip the OS
// scheme; they only care about drag regions and safe-area padding.
function installMatchMedia() {
  const factory = (query: string): MediaQueryList =>
    ({
      media: query,
      matches: false,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    }) as unknown as MediaQueryList;
  vi.stubGlobal("matchMedia", factory);
  window.matchMedia = factory as typeof window.matchMedia;
}

/**
 * The `-webkit-app-region` value React wrote onto an element's inline style.
 *
 * React sets the non-standard property via its camelCase key
 * (`style.WebkitAppRegion`), which is how jsdom exposes it; the hyphenated
 * `getPropertyValue("-webkit-app-region")` lookup returns empty in jsdom, so we
 * read the camelCase accessor (falling back to the hyphenated form for safety).
 */
function appRegion(el: Element): string {
  const style = (el as HTMLElement).style as CSSStyleDeclaration & {
    WebkitAppRegion?: string;
  };
  return (
    style.WebkitAppRegion ?? style.getPropertyValue("-webkit-app-region") ?? ""
  );
}

/**
 * Render AppShell for `plat` and flush the mount effects:
 *   - the titlebar safe-area effect (reads getPlatform()),
 *   - ThemeToggle's `loadConfig().then(...)` microtask.
 * so the platform-driven padding is applied before asserting.
 */
async function renderShell(plat: PlatformId, header: React.ReactNode) {
  platform = plat;
  const utils = render(
    <AppShell header={header}>
      <div>content</div>
    </AppShell>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  return utils;
}

beforeEach(() => {
  installMatchMedia();
  getPlatform.mockClear();
  platform = "unknown";
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-theme");
});

describe("AppShell titlebar — drag regions (Req 15.4, 15.5)", () => {
  // Req 15.4 — the top header's empty non-interactive region is draggable.
  it("marks the top header as a draggable region", async () => {
    const { container } = await renderShell(
      "unknown",
      <button type="button">Settings</button>,
    );

    const header = container.querySelector("[data-titlebar-drag-region]");
    expect(header).not.toBeNull();
    expect(header!.tagName.toLowerCase()).toBe("header");
    expect(appRegion(header!)).toBe("drag");
  });

  // Req 15.5 — the interactive header content is wrapped in a non-draggable
  // region so activating a control never starts a window drag.
  it("wraps interactive header content in a non-draggable region", async () => {
    const { container, getByRole } = await renderShell(
      "unknown",
      <button type="button">Settings</button>,
    );

    const noDrag = container.querySelector("[data-titlebar-no-drag]");
    expect(noDrag).not.toBeNull();
    expect(appRegion(noDrag!)).toBe("no-drag");

    // The caller's interactive control lives inside the no-drag region.
    const button = getByRole("button", { name: "Settings" });
    expect(noDrag!.contains(button)).toBe(true);
  });

  // Req 15.4 — the Navigation_Rail surface is itself draggable so its empty
  // regions (incl. the macOS left inset) move the window.
  it("marks the navigation rail surface as a draggable region", async () => {
    const { container } = await renderShell("unknown", null);

    const rail = container.querySelector('nav[aria-label="Primary"]');
    expect(rail).not.toBeNull();
    expect(appRegion(rail!)).toBe("drag");
  });
});

describe("AppShell titlebar — safe-area padding per platform (Req 15.6)", () => {
  // Req 15.6 (macOS) — 76px LEFT padding in the top header, 0 right.
  it("applies 76px left header padding on macOS", async () => {
    const { container } = await renderShell(
      "darwin",
      <button type="button">Settings</button>,
    );

    const header = container.querySelector(
      "[data-titlebar-drag-region]",
    ) as HTMLElement;
    expect(header.style.paddingLeft).toBe(`${MACOS_SAFE_AREA_LEFT}px`);
    expect(header.style.paddingRight).toBe("");
  });

  // Req 15.1/15.6 (macOS) — the rail mirrors the 76px left inset.
  it("applies 76px left rail padding on macOS", async () => {
    const { container } = await renderShell("darwin", null);

    const rail = container.querySelector(
      'nav[aria-label="Primary"]',
    ) as HTMLElement;
    expect(rail.style.paddingLeft).toBe(`${MACOS_SAFE_AREA_LEFT}px`);
  });

  // Req 15.6 (Windows) — 136px RIGHT padding in the top bar, 0 left; the rail
  // gets no left inset on Windows.
  it("applies 136px right header padding on Windows", async () => {
    const { container } = await renderShell(
      "win32",
      <button type="button">Settings</button>,
    );

    const header = container.querySelector(
      "[data-titlebar-drag-region]",
    ) as HTMLElement;
    expect(header.style.paddingRight).toBe(`${WINDOWS_SAFE_AREA_RIGHT}px`);
    expect(header.style.paddingLeft).toBe("");

    const rail = container.querySelector(
      'nav[aria-label="Primary"]',
    ) as HTMLElement;
    expect(rail.style.paddingLeft).toBe("");
  });

  // Req 15.3/15.6 (other platforms) — 0 padding on every edge of header + rail.
  it("applies no safe-area padding on other platforms", async () => {
    const { container } = await renderShell(
      "linux",
      <button type="button">Settings</button>,
    );

    const header = container.querySelector(
      "[data-titlebar-drag-region]",
    ) as HTMLElement;
    expect(header.style.paddingLeft).toBe("");
    expect(header.style.paddingRight).toBe("");

    const rail = container.querySelector(
      'nav[aria-label="Primary"]',
    ) as HTMLElement;
    expect(rail.style.paddingLeft).toBe("");
  });
});

describe("NavigationRail — drag regions and safe-area inset (Req 15.4, 15.5)", () => {
  // Req 15.4 — the rail surface is draggable regardless of the inset.
  it("marks the rail surface draggable", () => {
    const { container } = render(
      <NavigationRail mode="expanded" width={220} />,
    );

    const rail = container.querySelector('nav[aria-label="Primary"]');
    expect(rail).not.toBeNull();
    expect(appRegion(rail!)).toBe("drag");
  });

  // Req 15.5 — interactive nav links opt out of dragging.
  it("marks nav links as non-draggable", () => {
    const { getByRole } = render(
      <NavigationRail
        mode="expanded"
        width={220}
        items={[
          {
            id: "dash",
            label: "Dashboard",
            href: "/dashboard",
            icon: <span>D</span>,
            active: true,
          },
        ]}
      />,
    );

    const link = getByRole("link", { name: "Dashboard" });
    expect(appRegion(link)).toBe("no-drag");
  });

  // Req 15.5 — the footer slot (hosts the interactive ThemeToggle) is
  // non-draggable.
  it("marks the footer slot as non-draggable", () => {
    const { container } = render(
      <NavigationRail
        mode="expanded"
        width={220}
        footer={<button type="button">Theme</button>}
      />,
    );

    const footer = container.querySelector("[data-rail-footer]");
    expect(footer).not.toBeNull();
    expect(appRegion(footer!)).toBe("no-drag");
  });

  // Req 15.1 — the rail honors the macOS left inset threaded in by AppShell.
  it("applies the supplied left safe-area inset", () => {
    const { container } = render(
      <NavigationRail
        mode="expanded"
        width={220}
        safeAreaLeft={MACOS_SAFE_AREA_LEFT}
      />,
    );

    const rail = container.querySelector(
      'nav[aria-label="Primary"]',
    ) as HTMLElement;
    expect(rail.style.paddingLeft).toBe(`${MACOS_SAFE_AREA_LEFT}px`);
  });

  // Req 15.3 — a 0 inset reserves no left padding.
  it("reserves no left padding when the inset is 0", () => {
    const { container } = render(
      <NavigationRail mode="expanded" width={220} safeAreaLeft={0} />,
    );

    const rail = container.querySelector(
      'nav[aria-label="Primary"]',
    ) as HTMLElement;
    expect(rail.style.paddingLeft).toBe("");
  });
});
