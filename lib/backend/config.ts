// lib/backend/config.ts
//
// Config store for Backend_Endpoint and Theme_Preference (Req 9, 14).
//
// Backed by the Tauri persistent store plugin (`@tauri-apps/plugin-store`),
// which writes to a JSON file in the OS app-data directory so values survive
// restarts. A single `LazyStore` handle is reused across the module; the plugin
// persists automatically on every `set` (autoSave default), so valid values are
// read back without re-prompting on subsequent launches (Req 9.4, 14.8).

import { LazyStore } from "@tauri-apps/plugin-store";

export type ThemePreference = "light" | "dark" | "system";

export interface AppConfig {
  backendEndpoint: string | null; // Req 9
  themePreference: ThemePreference; // Req 14
}

/**
 * Error raised when a user-supplied value fails client-side format validation.
 * Mirrors the `BackendError { kind, message, fieldErrors }` shape the rest of
 * the backend seam uses so screens can surface it as a uniform inline message.
 */
export class ConfigValidationError extends Error {
  readonly kind = "validation" as const;
  readonly fieldErrors: Record<string, string>;

  constructor(message: string, fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = "ConfigValidationError";
    this.fieldErrors = fieldErrors;
    // Restore prototype chain for `instanceof` across transpilation targets.
    Object.setPrototypeOf(this, ConfigValidationError.prototype);
  }
}

/**
 * Error raised when the configured Backend_Endpoint cannot be reached within
 * the connection timeout (Req 9.5). The offending endpoint is attached so the
 * caller can show an unreachable-backend message while keeping it configured —
 * a connection failure never clears the persisted value.
 */
export class BackendUnreachableError extends Error {
  readonly kind = "unreachable" as const;
  readonly endpoint: string;

  constructor(endpoint: string, message?: string) {
    super(
      message ??
        `Could not reach the backend at ${endpoint}. Check that the server is running and the endpoint is correct.`
    );
    this.name = "BackendUnreachableError";
    this.endpoint = endpoint;
    Object.setPrototypeOf(this, BackendUnreachableError.prototype);
  }
}

const STORE_FILE = "config.json";
const KEY_BACKEND_ENDPOINT = "backendEndpoint";
const KEY_THEME_PREFERENCE = "themePreference";

const DEFAULT_THEME: ThemePreference = "system";
const THEME_PREFERENCES: readonly ThemePreference[] = ["light", "dark", "system"];

/** Maximum time to wait for the backend health probe before giving up (Req 9.5). */
export const CONNECT_TIMEOUT_MS = 10_000;

/** PocketBase exposes a public, unauthenticated liveness route at `/api/health`. */
const HEALTH_PATH = "/api/health";

/**
 * Single reusable handle to the persistent store. `LazyStore` defers the actual
 * file load until the first `get`/`set`, and persists on write by default.
 */
const store = new LazyStore(STORE_FILE);

/**
 * Syntactic validity check for a Backend_Endpoint: a well-formed URL using the
 * `http` or `https` scheme (Req 9.2). Pure and side-effect free so it can back
 * both `setBackendEndpoint` and UI-level live validation.
 */
export function isValidEndpoint(url: string): boolean {
  if (typeof url !== "string" || url.trim().length === 0) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

function normalizeThemePreference(value: unknown): ThemePreference {
  // Default to "system" when absent or not one of the known preferences
  // (Req 14.9, 14.10).
  return THEME_PREFERENCES.includes(value as ThemePreference)
    ? (value as ThemePreference)
    : DEFAULT_THEME;
}

/**
 * Read the persisted application configuration (Req 9.1, 14.8).
 *
 * A missing `backendEndpoint` resolves to `null` so the caller can render the
 * Backend Setup prompt and block authenticated operations (Req 9.3). An absent
 * or invalid `themePreference` resolves to `"system"` (Req 14.9, 14.10).
 */
export async function loadConfig(): Promise<AppConfig> {
  const storedEndpoint = await store.get<string>(KEY_BACKEND_ENDPOINT);
  const storedTheme = await store.get<string>(KEY_THEME_PREFERENCE);

  const backendEndpoint =
    typeof storedEndpoint === "string" && isValidEndpoint(storedEndpoint)
      ? storedEndpoint.trim()
      : null;

  return {
    backendEndpoint,
    themePreference: normalizeThemePreference(storedTheme),
  };
}

/**
 * Validate and persist a Backend_Endpoint (Req 9.2, 9.4).
 *
 * Rejects any value that is not a syntactically valid `http`/`https` URL with a
 * {@link ConfigValidationError}; the previously persisted value is left
 * untouched so it is retained (Req 9.2). A valid endpoint is stored (trimmed) so
 * subsequent launches read it without re-prompting (Req 9.4).
 */
export async function setBackendEndpoint(url: string): Promise<void> {
  if (!isValidEndpoint(url)) {
    throw new ConfigValidationError(
      "The backend endpoint must be a valid http or https URL.",
      { backendEndpoint: "Enter a valid http:// or https:// URL." }
    );
  }
  await store.set(KEY_BACKEND_ENDPOINT, url.trim());
  await store.save();
}

/**
 * Persist the user's Theme_Preference (Req 14.8).
 *
 * Rejects a value outside `{light, dark, system}` with a
 * {@link ConfigValidationError}, retaining the previously persisted preference.
 */
export async function setThemePreference(p: ThemePreference): Promise<void> {
  if (!THEME_PREFERENCES.includes(p)) {
    throw new ConfigValidationError(
      "The theme preference must be one of light, dark, or system.",
      { themePreference: "Choose light, dark, or system." }
    );
  }
  await store.set(KEY_THEME_PREFERENCE, p);
  await store.save();
}

/**
 * Build the health-probe URL for a Backend_Endpoint by resolving
 * {@link HEALTH_PATH} against it. The endpoint is assumed already validated by
 * {@link isValidEndpoint}; any trailing path on the endpoint is replaced.
 */
function healthUrl(endpoint: string): string {
  return new URL(HEALTH_PATH, endpoint.trim()).toString();
}

/**
 * Health probe for the configured Backend_Endpoint (Req 9.5).
 *
 * Issues a lightweight request to the PocketBase liveness route and resolves
 * `true` when the server answers. The probe is bounded to
 * {@link CONNECT_TIMEOUT_MS}; if a connection cannot be established within that
 * window — or any network error occurs — the probe resolves `false` rather than
 * throwing, so callers can translate a `false` into an unreachable-backend
 * message (via {@link BackendUnreachableError}) while leaving the persisted
 * endpoint untouched (Req 9.5).
 *
 * A caller-supplied `signal` is honored alongside the internal timeout so an
 * unmounting screen can abort the probe early; an external abort also resolves
 * `false`.
 *
 * Reachability is defined as "the server responded" — any HTTP status counts,
 * since a reachable-but-erroring server is still reachable for the purpose of
 * the connection check. Only a failure to establish a connection (or a timeout)
 * is treated as unreachable.
 *
 * Note: this probe lives in the config module because it has no dependency on
 * the PocketBase SDK; `Backend_Client` re-exports it as `pingBackend` so the
 * rest of the app uses it through the client seam (see design, Backend_Client).
 */
export async function pingBackend(
  endpoint: string,
  signal?: AbortSignal
): Promise<boolean> {
  if (!isValidEndpoint(endpoint)) {
    return false;
  }

  // Abort either when the external signal fires or the timeout elapses.
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      return false;
    }
    signal.addEventListener("abort", onExternalAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);

  try {
    const response = await fetch(healthUrl(endpoint), {
      method: "GET",
      signal: controller.signal,
    });
    // Any response — even a 4xx/5xx — proves the connection was established.
    return response.ok || response.status > 0;
  } catch {
    // AbortError (timeout/external abort) or a network error: unreachable.
    return false;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}

/**
 * Convenience wrapper that probes the endpoint and throws a
 * {@link BackendUnreachableError} when it is unreachable (Req 9.5). Callers that
 * prefer an exception-based flow (e.g. a setup form awaiting a connection check)
 * use this; those that want a boolean use {@link pingBackend} directly. Either
 * way the configured endpoint is retained — this function never clears it.
 */
export async function assertBackendReachable(
  endpoint: string,
  signal?: AbortSignal
): Promise<void> {
  const reachable = await pingBackend(endpoint, signal);
  if (!reachable) {
    throw new BackendUnreachableError(endpoint);
  }
}
