"use client";

/**
 * Client-side route guard (Req 3.9).
 *
 * Replaces the deleted `proxy.ts` server middleware. Under a static Tauri SPA
 * there is no server to intercept navigations, so protection becomes a client
 * component wrapped around the dashboard, group, create-group, and join-group
 * screens. It consumes the Auth_Service rather than the backend SDK directly.
 *
 * Behavior:
 * - On mount it reads the current session via `currentUser()` and subscribes to
 *   `onAuthChange()` (which fires immediately with the current state and again
 *   on every login/logout/token-expiry). WHILE no authenticated session exists,
 *   the user is routed to `/login` and the protected children never render.
 * - Until the first auth signal resolves, a neutral checking state is shown so
 *   protected content is never flashed before the session is known.
 * - If the backend is not yet configured (`currentUser()` throws), that is
 *   treated as "no session": redirect to `/login` rather than surfacing an
 *   error, matching the guard's role of gating unauthenticated access.
 *
 * The backend still enforces authorization on every request (Req 6.6); this
 * guard is the client-side access restriction Req 3.9 calls for, not the only
 * line of defense.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { currentUser, onAuthChange, type AuthState } from "@/lib/backend/auth";

type GuardPhase = "checking" | "authenticated" | "redirecting";

/**
 * Read the current auth state, treating an unconfigured backend (or any other
 * read failure) as the unauthenticated state so the guard redirects rather than
 * throwing out of render.
 */
function readAuthState(): AuthState {
  try {
    return currentUser();
  } catch {
    return { userId: null, email: null };
  }
}

export default function AuthGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<GuardPhase>("checking");

  useEffect(() => {
    // Apply an auth state: authenticated children render; an absent session
    // routes to login and keeps children unmounted (Req 3.9).
    function apply(state: AuthState) {
      if (state.userId) {
        setPhase("authenticated");
      } else {
        setPhase("redirecting");
        router.replace("/login");
      }
    }

    // Subscribe first so transitions (logout, token expiry) are caught; the
    // callback fires immediately with the current state, covering the initial
    // check. If subscribing fails (backend unconfigured), fall back to a direct
    // read so an absent session still redirects.
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = onAuthChange(apply);
    } catch {
      apply(readAuthState());
    }

    return () => {
      unsubscribe?.();
    };
  }, [router]);

  if (phase === "authenticated") {
    return <>{children}</>;
  }

  // "checking" and "redirecting" both withhold the protected content. A minimal
  // neutral surface avoids flashing the guarded screen before the session is
  // known or while the redirect to /login is in flight.
  return (
    <main
      aria-busy="true"
      className="flex min-h-screen flex-col items-center justify-center p-6 text-text-secondary"
    >
      <p className="text-sm">Loading…</p>
    </main>
  );
}
