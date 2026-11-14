"use client";

/**
 * Launch watchdog for the React root (Req 1.6, 1.7).
 *
 * At window creation a 5-second timer starts. Once the root has mounted and
 * painted its first meaningful frame, it signals the Tauri shell (`ui_ready`)
 * so the native-side watchdog stands down. If boot has not completed within the
 * timeout — or the shell reports the launch stalled — a retry fallback is
 * rendered instead of a blank window. The Tauri shell shows a native error
 * dialog as the backstop when the webview never signals ready.
 */

import { useEffect, useState } from "react";
import { isTauri } from "@/lib/platform";

/** Matches the shell-side watchdog window (`LAUNCH_WATCHDOG_MS`). */
const LAUNCH_WATCHDOG_MS = 5_000;

type BootPhase = "booting" | "stalled";

async function signalReady(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("ui_ready");
  } catch {
    // The shell also has a time-based watchdog, so a failed signal still
    // resolves safely; swallow so a missing command never blanks the UI.
  }
}

function LaunchFallback({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1rem",
        minHeight: "100vh",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>
        Reading Sync is taking too long to start
      </h1>
      <p style={{ maxWidth: "28rem", opacity: 0.8 }}>
        The app could not finish loading. Please try again, and check that your
        backend is reachable if the problem continues.
      </p>
      <button
        type="button"
        onClick={onRetry}
        style={{
          padding: "0.5rem 1.25rem",
          borderRadius: "0.5rem",
          border: "1px solid currentColor",
          cursor: "pointer",
          fontWeight: 600,
        }}
      >
        Retry
      </button>
    </div>
  );
}

export default function AppBootstrap({
  children,
}: {
  children: React.ReactNode;
}) {
  const [phase, setPhase] = useState<BootPhase>("booting");

  useEffect(() => {
    let painted = false;

    // The effect running means React mounted; confirm a real paint on the next
    // animation frame, then tell the shell the UI is alive (Req 1.6).
    const raf = window.requestAnimationFrame(() => {
      painted = true;
      void signalReady();
    });

    // Watchdog: if the root never paints within the window, show the retry
    // fallback rather than leaving a blank window (Req 1.7). Runs only from the
    // timer callback, never synchronously during this effect.
    const timer = window.setTimeout(() => {
      if (!painted) {
        setPhase("stalled");
      }
    }, LAUNCH_WATCHDOG_MS);

    // The shell emits this if its own watchdog fires before the webview
    // signalled ready; mirror it in-app so the user sees the retry fallback.
    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      void import("@tauri-apps/api/event")
        .then(({ listen }) =>
          listen("launch-stalled", () => setPhase("stalled"))
        )
        .then((fn) => {
          unlisten = fn;
        })
        .catch(() => {
          // Non-fatal: the local timer still protects against a stalled boot.
        });
    }

    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      unlisten?.();
    };
  }, []);

  if (phase === "stalled") {
    return <LaunchFallback onRetry={() => window.location.reload()} />;
  }

  return <>{children}</>;
}
