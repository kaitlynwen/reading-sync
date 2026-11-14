"use client";

/**
 * PlatformClass — reflects the detected platform onto the document root as a
 * `data-platform` attribute (task 14.5, steering §6).
 *
 * The attribute lets platform-scoped CSS key off the live platform without any
 * component having to thread the identifier through props. Its only consumer
 * today is the custom thin-scrollbar rule in `globals.css`, scoped to
 * `[data-platform="win32"]` so Windows builds never show harsh default system
 * scrollbars while macOS/Linux keep their native overlay scrollbars
 * (steering §6, "Desktop Ergonomics").
 *
 * Detection runs once after mount via {@link getPlatform} (which degrades to
 * `"unknown"` outside the Tauri shell), so SSR/static-export output never
 * guesses a platform it cannot yet attribute.
 */

import { useEffect } from "react";
import { getPlatform } from "@/lib/platform";

export default function PlatformClass() {
  useEffect(() => {
    const platform = getPlatform();
    const root = document.documentElement;
    root.setAttribute("data-platform", platform);
    return () => {
      // Leave the attribute in place on unmount; the root lives for the app's
      // lifetime and clearing it would only cause a flash. This component is a
      // singleton mounted at the layout root.
    };
  }, []);

  return null;
}
