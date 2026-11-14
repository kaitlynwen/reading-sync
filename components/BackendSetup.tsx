"use client";

/**
 * Backend Setup gate (Req 9.3, 9.5).
 *
 * Wraps the authenticated surface of the app. On mount it reads the persisted
 * configuration:
 *
 * - WHERE no Backend_Endpoint is present, it renders a setup prompt and blocks
 *   its children — the authenticated operations — until a valid endpoint is
 *   persisted (Req 9.3). Children never mount while the gate is open, so no
 *   authenticated request can be issued before an endpoint exists.
 * - WHEN a user submits an endpoint, it is validated as an http/https URL and,
 *   if valid, probed with a 10-second connection check. A connection failure
 *   surfaces an unreachable-backend message and the endpoint is NOT persisted,
 *   so the previously persisted value (if any) is retained (Req 9.5).
 * - A syntactically valid, reachable endpoint is persisted so later launches
 *   read it without re-prompting, and the gate reveals its children.
 *
 * The endpoint persistence and validation themselves live in
 * `lib/backend/config.ts`; this component is the UI that drives them.
 */

import { useEffect, useState } from "react";
import {
  loadConfig,
  setBackendEndpoint,
  isValidEndpoint,
  pingBackend,
  ConfigValidationError,
} from "@/lib/backend/config";

type GatePhase = "loading" | "needs-setup" | "ready";

export default function BackendSetup({
  children,
}: {
  children: React.ReactNode;
}) {
  const [phase, setPhase] = useState<GatePhase>("loading");

  useEffect(() => {
    let active = true;
    loadConfig()
      .then((config) => {
        if (!active) return;
        setPhase(config.backendEndpoint ? "ready" : "needs-setup");
      })
      .catch(() => {
        // Treat an unreadable config the same as an absent endpoint: prompt
        // for setup rather than letting authenticated screens mount.
        if (active) setPhase("needs-setup");
      });
    return () => {
      active = false;
    };
  }, []);

  if (phase === "loading") {
    return <SetupShell>Checking backend configuration…</SetupShell>;
  }

  if (phase === "needs-setup") {
    return <BackendSetupForm onConfigured={() => setPhase("ready")} />;
  }

  return <>{children}</>;
}

function BackendSetupForm({ onConfigured }: { onConfigured: () => void }) {
  const [endpoint, setEndpoint] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const value = endpoint.trim();
    setError(null);

    // Client-side format gate first so an obviously bad value never triggers a
    // 10-second connection wait (Req 9.2).
    if (!isValidEndpoint(value)) {
      setError("Enter a valid http:// or https:// URL.");
      return;
    }

    setChecking(true);
    try {
      // Confirm the server answers within the connection timeout before we
      // commit the value (Req 9.5). A failure leaves nothing persisted.
      const reachable = await pingBackend(value);
      if (!reachable) {
        setError(
          "Could not reach the backend at this address within 10 seconds. The server appears to be unreachable. Please check the address and that the server is running."
        );
        return;
      }

      // Reachable and valid: persist so later launches skip this prompt
      // (Req 9.4). setBackendEndpoint re-validates and throws on a bad value,
      // retaining any previously persisted endpoint (Req 9.2).
      await setBackendEndpoint(value);
      onConfigured();
    } catch (err) {
      if (err instanceof ConfigValidationError) {
        setError(err.fieldErrors.backendEndpoint ?? err.message);
      } else {
        setError("Could not save the backend endpoint. Please try again.");
      }
    } finally {
      setChecking(false);
    }
  }

  return (
    <SetupShell>
      <form
        className="flex w-full max-w-md flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!checking) void submit();
        }}
      >
        <div className="flex flex-col gap-1">
          <h1 className="font-serif text-2xl font-semibold text-text-primary">
            Connect your backend
          </h1>
          <p className="text-sm text-text-secondary">
            Reading Sync needs the address of your self-hosted PocketBase server
            before you can sign in. Enter it below to continue.
          </p>
        </div>

        <label className="flex flex-col gap-1 text-sm text-text-secondary">
          Backend endpoint
          <input
            type="url"
            inputMode="url"
            autoFocus
            placeholder="https://pocketbase.example.com"
            className="rounded-[var(--radius-inner)] border border-border-strong bg-bg-surface p-3 text-text-primary"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "backend-endpoint-error" : undefined}
            disabled={checking}
          />
        </label>

        <button
          type="submit"
          disabled={checking}
          className="rounded-[var(--radius-pill)] bg-text-primary p-3 font-medium text-text-on-dark disabled:opacity-60"
        >
          {checking ? "Connecting…" : "Connect"}
        </button>

        {error && (
          <p
            id="backend-endpoint-error"
            role="alert"
            className="text-center text-sm text-red-600"
          >
            {error}
          </p>
        )}
      </form>
    </SetupShell>
  );
}

/** Centered surface used for both the loading and the setup states. */
function SetupShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg-app p-6 text-text-primary">
      {children}
    </main>
  );
}
