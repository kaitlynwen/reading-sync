// Unit tests for the reading-goal update orchestration (Req 6.5, 6.6).
//
// These exercise the authentication gate in `goals.ts` against a fake
// `currentUser` lookup and a fake `reading_sessions` collection accessor, so
// the unauthenticated-rejection path (Req 6.6) is verified without a live
// PocketBase connection or a React/DOM harness. The core assertion for Req 6.6
// is that an unauthenticated goal update issues NO write — the session
// `update` is never called — so the existing goal configuration is retained,
// and an auth-required error is returned.

import { describe, expect, it, vi } from "vitest";

import { updateGoal, type GoalBackend } from "./goals";
import type { AuthState } from "./auth";

/**
 * Build a {@link GoalBackend} from a chosen auth state and an optional session
 * `update` spy. `readingSessions().update` defaults to a spy so a test can
 * assert whether (and how) the write was attempted; the unused `getFirstListItem`
 * throws so an unexpected call fails loudly.
 */
function makeBackend(
  authState: AuthState,
  update: ReturnType<typeof vi.fn> = vi.fn(async () => ({ id: "sess_1" })),
): { backend: GoalBackend; update: ReturnType<typeof vi.fn> } {
  const backend: GoalBackend = {
    currentUser: () => authState,
    readingSessions: () =>
      ({
        update,
        getFirstListItem: () => {
          throw new Error("unexpected call: readingSessions.getFirstListItem");
        },
      }) as unknown as ReturnType<GoalBackend["readingSessions"]>,
  };
  return { backend, update };
}

const UNAUTHENTICATED: AuthState = { userId: null, email: null };
const AUTHENTICATED: AuthState = { userId: "usr_1", email: "reader@example.com" };

describe("updateGoal — unauthenticated rejection (Req 6.6)", () => {
  it("rejects an unauthenticated goal update, issues no write, and returns an auth-required error", async () => {
    const { backend, update } = makeBackend(UNAUTHENTICATED);

    const result = await updateGoal("sess_1", "pages", 120, "pages", backend);

    // The update is rejected and flagged as auth-required (Req 6.6)...
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.authRequired).toBe(true);
      expect(result.message).not.toBe("");
    }

    // ...and NO write is issued, so the existing goal configuration is retained
    // untouched (Req 6.6).
    expect(update).not.toHaveBeenCalled();
  });

  it("retains the existing configuration regardless of the submitted goal values", async () => {
    // Even a full, well-formed goal payload must not be written when
    // unauthenticated — the gate runs before any backend interaction (Req 6.6).
    const { backend, update } = makeBackend(UNAUTHENTICATED);

    const result = await updateGoal("sess_1", "chapters", 10, "chapters", backend);

    expect(result.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("updateGoal — authenticated write (Req 6.5)", () => {
  it("stores the submitted goal type, amount, and unit for an authenticated member", async () => {
    const { backend, update } = makeBackend(AUTHENTICATED);

    const result = await updateGoal("sess_1", "pages", 120, "pages", backend);

    expect(result).toEqual({ ok: true });
    // The write targets the active session with exactly the submitted config.
    expect(update).toHaveBeenCalledWith("sess_1", {
      goal_type: "pages",
      goal_amount: 120,
      goal_unit: "pages",
    });
  });
});
