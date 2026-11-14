// Unit test for password/confirmation mismatch gating on create-account.
//
// Req 3.4: IF a user submits a create-account form where the password and
// confirmation do not match, THEN the app SHALL display a mismatch message and
// SHALL NOT submit the request to the PocketBase_Backend.
//
// The create-account gate (`gateCreateAccount` in validation.ts) is the single
// client-side decision point for whether a submission may reach the backend. We
// verify two complementary things:
//
//   1. The pure gate itself blocks a mismatch (and only a mismatch, given
//      otherwise-valid inputs) and surfaces the mismatch message.
//   2. When that gate drives a submit flow, a mismatch means `createAccount`
//      (the only backend call in lib/backend/auth.ts) is never invoked, while a
//      match lets exactly one backend call through. This pins down the "no
//      backend call on mismatch" behavior end-to-end, independent of the
//      screen's rendering.
//
// The Auth_Service is mocked so the test exercises the gating decision without a
// real PocketBase connection; the spy lets us assert the call was/was not made.

import { afterEach, describe, expect, it, vi } from "vitest";

import { gateCreateAccount, passwordsMatch } from "./validation";

// Mock the Auth_Service: `createAccount` is the single backend-reaching call the
// create-account screen makes. A spy records whether gating let it through.
vi.mock("./auth", () => ({
  createAccount: vi.fn(async () => {}),
}));

import { createAccount } from "./auth";

const mockedCreateAccount = vi.mocked(createAccount);

/**
 * A minimal stand-in for the create-account screen's submit handler: it runs the
 * shared gate and only calls the backend when the gate says `ok`. This mirrors
 * exactly how the screen is specified to behave (gate first, submit second) so
 * the test asserts the gating contract rather than any particular markup.
 *
 * @returns the message the screen would display ("" when submission proceeds)
 */
async function submitCreateAccount(
  email: string,
  password: string,
  confirmation: string,
): Promise<string> {
  const gate = gateCreateAccount(email, password, confirmation);
  if (!gate.ok) {
    return gate.message; // blocked: no backend call
  }
  await createAccount(email.trim(), password);
  return "";
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("password mismatch gating (Req 3.4)", () => {
  it("passwordsMatch is true only for identical strings", () => {
    expect(passwordsMatch("hunter2hunter2", "hunter2hunter2")).toBe(true);
    expect(passwordsMatch("hunter2hunter2", "hunter2hunter3")).toBe(false);
    // Whitespace is significant in a password, so it must not be ignored.
    expect(passwordsMatch("password ", "password")).toBe(false);
    // Case is significant.
    expect(passwordsMatch("Password1", "password1")).toBe(false);
  });

  it("gates out a mismatch with the mismatch message, given otherwise-valid input", () => {
    const gate = gateCreateAccount(
      "reader@example.com",
      "correct-horse",
      "correct-zebra",
    );

    expect(gate.ok).toBe(false);
    expect(gate.message).toBe("Passwords do not match.");
  });

  it("allows submission when the password and confirmation match", () => {
    const gate = gateCreateAccount(
      "reader@example.com",
      "correct-horse",
      "correct-horse",
    );

    expect(gate.ok).toBe(true);
    expect(gate.message).toBe("");
  });

  it("does NOT call the backend when the password and confirmation differ", async () => {
    const message = await submitCreateAccount(
      "reader@example.com",
      "correct-horse",
      "correct-zebra",
    );

    // The mismatch message is shown and no request reaches the backend.
    expect(message).toBe("Passwords do not match.");
    expect(mockedCreateAccount).not.toHaveBeenCalled();
  });

  it("calls the backend exactly once when the passwords match", async () => {
    const message = await submitCreateAccount(
      "reader@example.com",
      "correct-horse",
      "correct-horse",
    );

    expect(message).toBe("");
    expect(mockedCreateAccount).toHaveBeenCalledTimes(1);
    expect(mockedCreateAccount).toHaveBeenCalledWith(
      "reader@example.com",
      "correct-horse",
    );
  });

  it("blocks a mismatch even when the mismatch is only trailing whitespace", async () => {
    const message = await submitCreateAccount(
      "reader@example.com",
      "secretpass",
      "secretpass ",
    );

    expect(message).toBe("Passwords do not match.");
    expect(mockedCreateAccount).not.toHaveBeenCalled();
  });
});
