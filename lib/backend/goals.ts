// lib/backend/goals.ts
//
// Reading-goal update orchestration over the Backend_Client collection
// accessors and the Auth_Service (Req 6.5, 6.6). The Group_Reading_Room screen
// owns only its form state, message surface, and reload; the authentication
// gate and the backend write for a goal update live here so the branching
// behavior — especially the unauthenticated-rejection path (Req 6.6) — is
// unit-testable without a React/DOM harness.
//
// Mirrors the structure of `groups.ts`: a dependency bundle lets tests supply
// fakes for both the authenticated-identity lookup and the collection
// accessor, and the function returns a structured result describing what the
// screen should do next (reload, or show a message) rather than touching the
// Next.js router or UI directly.

import { currentUser } from "@/lib/backend/auth";
import {
  readingSessionsCollection,
  normalizeError,
} from "@/lib/backend/client";

/**
 * A dependency bundle so tests can supply fakes for the authenticated-identity
 * lookup and the `reading_sessions` collection accessor. Defaults wire to the
 * live Auth_Service and Backend_Client.
 */
export interface GoalBackend {
  /** Resolve the authenticated identity (Req 6.6). */
  currentUser: typeof currentUser;
  /** The `reading_sessions` collection accessor (Req 6.5). */
  readingSessions: () => ReturnType<typeof readingSessionsCollection>;
}

/** The live wiring used by the Group_Reading_Room screen. */
export const liveGoalBackend: GoalBackend = {
  currentUser,
  readingSessions: readingSessionsCollection,
};

/**
 * The outcome of a goal update. `authRequired` marks the unauthenticated
 * rejection (Req 6.6) so the caller can distinguish it from a backend failure;
 * the existing goal configuration is retained in both failure cases because no
 * write is issued (auth) or the write did not commit (backend error).
 */
export type GoalUpdateResult =
  | { ok: true }
  | { ok: false; authRequired: true; message: string }
  | { ok: false; authRequired: false; message: string };

/**
 * Store the active Reading_Session's goal configuration for an authenticated
 * member (Req 6.5), or reject the update when the requester is unauthenticated
 * (Req 6.6).
 *
 * Authentication is checked FIRST: when {@link GoalBackend.currentUser} reports
 * no `userId`, this returns an auth-required failure and issues NO write, so the
 * existing goal configuration is retained untouched (Req 6.6). Only an
 * authenticated requester reaches the `reading_sessions` update (Req 6.5); a
 * backend rejection there surfaces as a non-auth failure with the existing
 * configuration left as the backend last committed it.
 *
 * @param sessionId the active Reading_Session whose goal is being updated
 * @param goalType  the goal type to store
 * @param goalAmount the goal amount to store (or `null` to clear)
 * @param goalUnit  the goal unit to store (or `null` to clear)
 */
export async function updateGoal(
  sessionId: string,
  goalType: string,
  goalAmount: number | null,
  goalUnit: string | null,
  backend: GoalBackend = liveGoalBackend,
): Promise<GoalUpdateResult> {
  // Reject unauthenticated goal updates, retaining the existing configuration
  // (Req 6.6). No write is attempted, so nothing can change.
  const { userId } = backend.currentUser();
  if (!userId) {
    return {
      ok: false,
      authRequired: true,
      message: "You must be logged in to update the goal.",
    };
  }

  try {
    await backend.readingSessions().update(sessionId, {
      goal_type: goalType,
      goal_amount: goalAmount,
      goal_unit: goalUnit,
    });
  } catch (err) {
    return {
      ok: false,
      authRequired: false,
      message: normalizeError(err).message || "Could not update the goal.",
    };
  }

  return { ok: true };
}
