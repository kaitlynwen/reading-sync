// lib/backend/auth.ts
//
// Auth_Service — account creation, login, logout, and session handling over the
// PocketBase `authStore` (Req 3).
//
// This module wraps the PocketBase users collection and `authStore`, exposing a
// small, screen-friendly surface. It is the single place the app reaches for
// authentication concerns; screens and the AuthGuard (task 5.2) consume
// `currentUser`, `onAuthChange`, `restoreSession`, and the action methods below.
//
// Session persistence (Req 3.10):
//   The PocketBase `authStore` is backed by an `AsyncAuthStore` whose state is
//   persisted to the Tauri persistent store (the same plugin the config store
//   uses) rather than browser `localStorage`. The serialized token+record is
//   written on every auth change and cleared on logout, so the session survives
//   application restarts until the token expires or the user logs out.
//   `restoreSession()` hydrates `authStore` from that persisted state on boot.

import { AsyncAuthStore, type AuthRecord } from "pocketbase";
import { LazyStore } from "@tauri-apps/plugin-store";

import {
  COLLECTIONS,
  getBackend,
  initBackend,
  normalizeError,
} from "@/lib/backend/client";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The minimal view of the authenticated identity the rest of the app branches
 * on. Both fields are `null` when no session exists (unauthenticated).
 */
export interface AuthState {
  userId: string | null;
  email: string | null;
}

// ---------------------------------------------------------------------------
// Persistent auth store (Req 3.10)
// ---------------------------------------------------------------------------
//
// The token+record is stored under a single key in a dedicated store file so it
// is isolated from the app config. `AsyncAuthStore` serializes the full auth
// payload into one string; we persist that string verbatim and hand it back as
// the `initial` value on boot so PocketBase can rehydrate the session.

const AUTH_STORE_FILE = "auth.json";
const KEY_PB_AUTH = "pb_auth";

/**
 * Single reusable handle to the persistent auth store. `LazyStore` defers the
 * file load until first access and persists on write by default.
 */
const tauriStore = new LazyStore(AUTH_STORE_FILE);

/**
 * Read the serialized auth payload persisted on a previous run, if any. Used as
 * the `initial` seed for the {@link AsyncAuthStore} so the session is restored
 * on boot. Returns an empty string when nothing is stored (PocketBase treats an
 * empty/invalid payload as "no session").
 */
async function readPersistedAuth(): Promise<string> {
  const stored = await tauriStore.get<string>(KEY_PB_AUTH);
  return typeof stored === "string" ? stored : "";
}

/**
 * Tracks the in-flight load of the persisted auth payload for the active store.
 * `AsyncAuthStore` applies its `initial` seed to the in-memory session as soon
 * as that promise resolves (synchronously, before persisting). `restoreSession`
 * awaits this same promise so the restored token is observable before it reads
 * the store — avoiding a race where the boot read has not yet been applied.
 */
let initialLoad: Promise<string> = Promise.resolve("");

/**
 * Build an {@link AsyncAuthStore} whose state is persisted to the Tauri store.
 * `save` writes the serialized payload on every auth change; `clear` removes it
 * on logout (and on token invalidation). The `initial` promise seeds the store
 * with whatever was persisted on the previous run so the session survives
 * restarts (Req 3.10). The exact `initial` promise is retained in
 * {@link initialLoad} for {@link restoreSession} to await.
 */
function createPersistentAuthStore(): AsyncAuthStore {
  initialLoad = readPersistedAuth();
  return new AsyncAuthStore({
    save: async (serialized: string) => {
      await tauriStore.set(KEY_PB_AUTH, serialized);
      await tauriStore.save();
    },
    clear: async () => {
      await tauriStore.delete(KEY_PB_AUTH);
      await tauriStore.save();
    },
    initial: initialLoad,
  });
}

// ---------------------------------------------------------------------------
// Backend initialization helper
// ---------------------------------------------------------------------------
//
// The Auth_Service owns the Tauri-backed auth store, so it is responsible for
// initializing the Backend_Client with that store attached. Call this once on
// boot (from the app bootstrap, after the Backend_Endpoint is known) before
// `restoreSession`. Keeping it here means client.ts stays unaware of Tauri.

/**
 * Initialize the Backend_Client against `endpoint` with the Tauri-backed
 * persistent auth store attached (Req 3.10, 9.1). Returns the created
 * {@link AsyncAuthStore} for callers that want to retain a reference; most
 * callers can ignore it and use {@link restoreSession}/{@link currentUser}.
 */
export function initAuthBackend(endpoint: string): AsyncAuthStore {
  const authStore = createPersistentAuthStore();
  initBackend(endpoint, authStore);
  return authStore;
}

// ---------------------------------------------------------------------------
// State mapping
// ---------------------------------------------------------------------------

/**
 * Project a PocketBase auth record into an {@link AuthState}. An absent or
 * invalid record yields the unauthenticated state (both fields `null`). The
 * email is read off the auth record, which PocketBase populates for the users
 * (auth) collection.
 */
function toAuthState(record: AuthRecord, isValid: boolean): AuthState {
  if (!record || !isValid) {
    return { userId: null, email: null };
  }
  const email = typeof record.email === "string" ? record.email : null;
  return { userId: record.id, email };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a new account in the users collection and establish an authenticated
 * session (Req 3.1). On success the PocketBase `authStore` holds the new
 * session, which is persisted automatically via the Tauri-backed store.
 *
 * Screen-level validation (required fields, email shape, password confirmation)
 * runs before this call (Req 3.2–3.4); this method assumes the inputs are
 * already well-formed and surfaces any backend rejection (e.g. email already in
 * use, Req 3.5) as a normalized {@link BackendError}.
 */
export async function createAccount(
  email: string,
  password: string
): Promise<void> {
  try {
    const users = getBackend().collection(COLLECTIONS.users);
    // PocketBase requires the confirmation field on creation; the screen has
    // already verified the two entries match (Req 3.4).
    await users.create({
      email,
      password,
      passwordConfirm: password,
    });
    // Immediately authenticate so account creation establishes a session
    // (Req 3.1) rather than requiring a separate login.
    await users.authWithPassword(email, password);
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * Authenticate an existing user and establish a session (Req 3.6). Backend
 * rejection of the credentials surfaces as a normalized {@link BackendError}
 * so the login screen can show an authentication error while retaining the
 * entered email (Req 3.7).
 */
export async function login(email: string, password: string): Promise<void> {
  try {
    await getBackend().collection(COLLECTIONS.users).authWithPassword(email, password);
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * End the authenticated session (Req 3.8). Clearing the `authStore` triggers
 * the Tauri-backed store's `clear`, removing the persisted token so the session
 * does not survive the next restart. Synchronous and never throws; the screen
 * navigates to login afterward.
 */
export async function logout(): Promise<void> {
  getBackend().authStore.clear();
}

/**
 * The current authenticated identity derived from the PocketBase `authStore`
 * (both fields `null` when no valid session exists). Pure read — safe to call
 * from the AuthGuard on every render.
 */
export function currentUser(): AuthState {
  const { authStore } = getBackend();
  return toAuthState(authStore.record, authStore.isValid);
}

/**
 * Subscribe to authentication changes (login, logout, token refresh/expiry).
 * The callback fires immediately with the current state and again on every
 * change. Returns an unsubscribe function. Screens and the AuthGuard use this
 * to react to session transitions (e.g. redirect to login on logout).
 */
export function onAuthChange(cb: (s: AuthState) => void): () => void {
  const { authStore } = getBackend();
  return authStore.onChange((_token, record) => {
    cb(toAuthState(record, authStore.isValid));
  }, true);
}

/**
 * Hydrate the session from the persisted Tauri store on boot and return the
 * resulting {@link AuthState} (Req 3.10).
 *
 * The {@link AsyncAuthStore} loads its `initial` payload asynchronously, so a
 * token persisted on a previous run may not yet be present in `authStore` the
 * instant the client is constructed. This awaits the store's internal load
 * queue (via a no-op save enqueue) so the restored token is observable before
 * resolving. An expired token resolves to the unauthenticated state, matching
 * the "until the session expires" boundary of Req 3.10.
 */
export async function restoreSession(): Promise<AuthState> {
  const { authStore } = getBackend();

  // The AsyncAuthStore applies its `initial` seed to the in-memory session the
  // moment that promise resolves (and before the async re-persist). Await the
  // same promise, then yield one microtask so the store's load callback — which
  // runs synchronously after the awaited `initial` — has applied the token.
  await initialLoad;
  await Promise.resolve();

  return toAuthState(authStore.record, authStore.isValid);
}
