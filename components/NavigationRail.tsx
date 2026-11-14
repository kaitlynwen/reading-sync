"use client";

/**
 * Navigation_Rail (Req 13.8, 14.1).
 *
 * The left rail of the desktop shell. Its width and presentation mode are
 * driven entirely by the responsive breakpoints in `.kiro/steering/ui-design.md`
 * §6, resolved by {@link resolveRailLayout}:
 *
 * - `< 960px`  → icon-only, 64px
 * - `960–1360` → compact, 72px
 * - `> 1360px` → expanded with labels, 220px
 *
 * The rail footer reserves a slot for the Light/Dark/System `ThemeToggle`
 * (Req 14.1). That control is implemented by task 12.2; this component only
 * hosts it via the `footer` prop so the structure exists ahead of time.
 *
 * Titlebar safe-area padding (the 76px macOS left inset applied to the rail,
 * Req 15.1) is owned by {@link AppShell} and threaded in through the
 * `safeAreaLeft` prop; this component does not detect the platform itself.
 *
 * The rail surface is marked draggable (`-webkit-app-region: drag`) so its
 * empty regions — including the macOS left inset beside the traffic lights —
 * move the native window (Req 15.4), while the nav links and footer controls
 * opt out with `no-drag` so activating them never starts a drag (Req 15.5).
 */

import type { CSSProperties, ReactNode } from "react";
import { type RailMode } from "@/lib/rail";

export interface NavigationRailItem {
  /** Stable key / identifier for the destination. */
  id: string;
  /** Accessible label; shown as text in expanded mode, as tooltip otherwise. */
  label: string;
  /** Icon element (icon-only and compact modes rely on this). */
  icon: ReactNode;
  /** Target route; rendered as a plain anchor to stay router-agnostic. */
  href: string;
  /** Marks the destination as the current location for active styling. */
  active?: boolean;
}

export interface NavigationRailProps {
  /** Resolved presentation mode for the rail. */
  mode: RailMode;
  /** Resolved rail width in pixels. */
  width: number;
  /** Navigation destinations rendered in the rail body. */
  items?: NavigationRailItem[];
  /**
   * Footer content — reserved for the Light/Dark/System ThemeToggle (task
   * 12.2). Left empty here so the slot exists without the control.
   */
  footer?: ReactNode;
  /**
   * Left titlebar safe-area padding in pixels (Req 15.1). Supplied by AppShell;
   * 0 off macOS / outside the native shell.
   */
  safeAreaLeft?: number;
}

/**
 * `-webkit-app-region` is a non-standard CSS property (native window drag
 * control in Tauri/Electron webviews) and is absent from `CSSProperties`.
 */
type AppRegionStyle = CSSProperties & { WebkitAppRegion?: "drag" | "no-drag" };

/** Interactive rail controls opt out of window dragging (Req 15.5). */
const NO_DRAG_REGION: AppRegionStyle = { WebkitAppRegion: "no-drag" };

/** Whether labels are shown (expanded) or hidden in favor of icons/tooltips. */
function showsLabels(mode: RailMode): boolean {
  return mode === "expanded";
}

export default function NavigationRail({
  mode,
  width,
  items = [],
  footer,
  safeAreaLeft = 0,
}: NavigationRailProps) {
  const labelled = showsLabels(mode);

  const style: AppRegionStyle = {
    width,
    // macOS reserves 76px of left padding in the rail so the traffic-light
    // controls never overlap rail UI (Req 15.1). 0 everywhere else.
    paddingLeft: safeAreaLeft || undefined,
    // The rail surface is draggable so its empty regions (incl. the macOS left
    // inset) move the native window (Req 15.4); controls below opt out.
    WebkitAppRegion: "drag",
  };

  return (
    <nav
      aria-label="Primary"
      data-rail-mode={mode}
      style={style}
      className="flex h-full shrink-0 flex-col gap-2 bg-bg-rail py-4 text-text-on-dark"
    >
      <ul className="flex flex-1 flex-col gap-1 px-2">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={item.href}
              aria-label={item.label}
              aria-current={item.active ? "page" : undefined}
              title={labelled ? undefined : item.label}
              // Interactive nav link — never starts a window drag (Req 15.5).
              style={NO_DRAG_REGION}
              className={[
                "flex items-center gap-3 rounded-[var(--radius-pill)] px-3 py-2",
                "transition-colors duration-150",
                labelled ? "justify-start" : "justify-center",
                item.active
                  ? "bg-text-on-dark/15 font-medium"
                  : "hover:bg-text-on-dark/10",
              ].join(" ")}
            >
              <span aria-hidden className="flex h-6 w-6 items-center justify-center">
                {item.icon}
              </span>
              {labelled && <span className="truncate text-sm">{item.label}</span>}
            </a>
          </li>
        ))}
      </ul>

      {/*
        Footer slot for the Light/Dark/System ThemeToggle (Req 14.1). The toggle
        itself ships with task 12.2; keeping the slot here fixes its placement
        in the rail footer ahead of that work.
      */}
      <div
        data-rail-footer
        // The footer hosts the interactive ThemeToggle — non-draggable so
        // activating it never initiates a window drag (Req 15.5).
        style={NO_DRAG_REGION}
        className={[
          "mt-auto flex px-2 pt-2",
          labelled ? "justify-start" : "justify-center",
        ].join(" ")}
      >
        {footer}
      </div>
    </nav>
  );
}
