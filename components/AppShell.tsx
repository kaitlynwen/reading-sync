"use client";

/**
 * AppShell — desktop layout host (Req 13.8, 14.1, 15).
 *
 * Hosts the three pieces of the desktop chrome described in the design's "UI
 * composition components" section:
 *
 *   1. the {@link NavigationRail} on the left,
 *   2. the main content region, and
 *   3. titlebar safe-area padding so native window controls never overlap app
 *      UI (Req 15.1–15.3).
 *
 * Responsive rail widths and the companion content-column count come from the
 * authoritative breakpoints in `.kiro/steering/ui-design.md` §6, resolved by
 * {@link resolveRailLayout} against the live viewport width (Req 13.8). Content
 * is capped at 1440px (Req 13.8).
 *
 * ## Titlebar safe areas + draggable header (Req 15)
 *
 * {@link resolveTitlebarSafeArea} drives the platform insets: 76px of LEFT
 * padding on macOS (top header + rail, Req 15.1), 136px of RIGHT padding on
 * Windows (top bar, Req 15.2), and 0 on every other platform (Req 15.3). The
 * macOS inset is threaded into the rail via `safeAreaLeft`; both header insets
 * are applied to the top header below.
 *
 * The top header is marked draggable (`-webkit-app-region: drag`) so its empty
 * regions move the native window (Req 15.4), while the caller's header content
 * is wrapped in a `no-drag` region so interactive controls inside it never
 * initiate a window drag (Req 15.5). The Light/Dark/System {@link ThemeToggle}
 * (task 12.2) fills the rail's reserved footer slot by default; callers may
 * override it via the `themeToggle` prop.
 */

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import NavigationRail, {
  type NavigationRailItem,
} from "@/components/NavigationRail";
import ThemeToggle from "@/components/ThemeToggle";
import {
  MAX_CONTENT_WIDTH,
  resolveRailLayout,
  type RailLayout,
} from "@/lib/rail";
import { getPlatform } from "@/lib/platform";
import { resolveTitlebarSafeArea, type TitlebarSafeArea } from "@/lib/titlebar";

export interface AppShellProps {
  /** Screens / page content rendered in the main region. */
  children: ReactNode;
  /** Navigation destinations handed to the rail. */
  navItems?: NavigationRailItem[];
  /**
   * Override for the rail-footer ThemeToggle (task 12.2). Defaults to the
   * Light/Dark/System {@link ThemeToggle}; pass a custom node (or `null`) to
   * replace or suppress it.
   */
  themeToggle?: ReactNode;
  /** Optional top-header content (title, actions). Rendered above the content. */
  header?: ReactNode;
}

/** Server-safe default so the first render matches a standard desktop. */
const DEFAULT_WIDTH = 1280;

/**
 * `-webkit-app-region` is a non-standard CSS property that controls native
 * window dragging inside Tauri/Electron webviews, so it is absent from the
 * standard `CSSProperties` type. These helpers keep the inline styles typed
 * without leaking `any` or `as` casts into the JSX.
 */
type AppRegionStyle = CSSProperties & { WebkitAppRegion?: "drag" | "no-drag" };

/** Empty header regions drag the native window (Req 15.4). */
const DRAG_REGION: AppRegionStyle = { WebkitAppRegion: "drag" };

/** Interactive header content opts out of dragging (Req 15.5). */
const NO_DRAG_REGION: AppRegionStyle = { WebkitAppRegion: "no-drag" };

/**
 * Tracks the live viewport width so the rail layout re-resolves on resize
 * (Req 13.8). Starts from a standard-desktop default to keep SSR/static-export
 * output deterministic, then syncs to the real width after mount.
 */
function useViewportWidth(): number {
  const [width, setWidth] = useState(DEFAULT_WIDTH);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const sync = () => setWidth(window.innerWidth);
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  return width;
}

/**
 * Resolves the titlebar safe area for the current platform once after mount.
 * Starts at zero so SSR/static output never reserves padding it cannot yet
 * attribute to a platform.
 */
function useTitlebarSafeArea(): TitlebarSafeArea {
  const [safeArea, setSafeArea] = useState<TitlebarSafeArea>(() =>
    resolveTitlebarSafeArea("unknown"),
  );

  useEffect(() => {
    // Platform detection reads a Tauri global that is unavailable during
    // static export/SSR, so it must run after mount. Sync the resolved value
    // into React state the same way the viewport hook does.
    const sync = () => setSafeArea(resolveTitlebarSafeArea(getPlatform()));
    sync();
  }, []);

  return safeArea;
}

export default function AppShell({
  children,
  navItems,
  themeToggle,
  header,
}: AppShellProps) {
  const viewportWidth = useViewportWidth();
  const safeArea = useTitlebarSafeArea();
  const layout: RailLayout = resolveRailLayout(viewportWidth);

  // Default the footer slot to the Light/Dark/System toggle (Req 14.1). An
  // explicit prop (including `null`) overrides it. The toggle shows labels only
  // when the rail is expanded, matching the rail's own label behavior.
  const railFooter =
    themeToggle === undefined ? (
      <ThemeToggle labelled={layout.mode === "expanded"} />
    ) : (
      themeToggle
    );

  return (
    <div className="flex h-screen w-full overflow-hidden bg-bg-app text-text-primary">
      <NavigationRail
        mode={layout.mode}
        width={layout.railWidth}
        items={navItems}
        footer={railFooter}
        safeAreaLeft={safeArea.left}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {header !== undefined && (
          <header
            data-titlebar-drag-region
            // The top header mirrors the rail's macOS left inset and reserves
            // the Windows right inset (Req 15.1, 15.2), and is itself draggable
            // so its empty regions move the native window (Req 15.4).
            style={{
              paddingLeft: safeArea.left || undefined,
              paddingRight: safeArea.right || undefined,
              ...DRAG_REGION,
            }}
            className="flex shrink-0 items-center border-b border-border-subtle px-4 py-3"
          >
            {/*
              Caller header content holds the interactive controls (title
              actions, buttons). Wrapping it in a no-drag region keeps those
              controls from initiating a window drag while the surrounding
              empty header padding stays draggable (Req 15.5).
            */}
            <div
              data-titlebar-no-drag
              style={NO_DRAG_REGION}
              className="flex min-w-0 flex-1 items-center"
            >
              {header}
            </div>
          </header>
        )}

        <main className="flex-1 overflow-y-auto">
          <div
            data-content-columns={layout.contentColumns}
            style={{ maxWidth: MAX_CONTENT_WIDTH }}
            className="mx-auto w-full px-4 py-6"
          >
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
