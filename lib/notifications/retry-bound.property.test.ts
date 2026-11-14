// Feature: native-desktop-migration, Property 12: Notification delivery retry bound
//
// *For any* sequence of per-attempt outcomes from the native send, `deliver`
// attempts a native notification at most 4 times (1 initial + at most 3
// retries); it returns `true` and stops retrying as soon as an attempt
// succeeds, and returns `false` (so the member is recorded as not-received)
// only when every attempt within the bound fails.
//
// Validates: Requirements 8.8

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";

// --- Native send plugin mock -----------------------------------------------
// `sendNotification` is synchronous (returns void) in the Tauri plugin; the
// retry-bound test drives its per-attempt success/throw behavior from a
// generated outcome pattern. Only `sendNotification` is exercised here, but the
// permission entry points are stubbed so the module imports cleanly in a plain
// Node test environment where the native plugin is unavailable.
const sendNative = vi.fn<(options: { title: string; body?: string }) => void>();

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: () => Promise.resolve(true),
  requestPermission: () => Promise.resolve("granted"),
  sendNotification: (options: { title: string; body?: string }) =>
    sendNative(options),
}));

// The Backend_Client accessor is unused by `deliver`, but the service module
// imports it at load time; stub it so the module resolves without a configured
// backend.
vi.mock("@/lib/backend/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/backend/client")>(
    "@/lib/backend/client"
  );
  return {
    ...actual,
    notificationSubscriptionsCollection: () => ({}),
  };
});

import { deliver, MAX_DELIVERY_ATTEMPTS, type NotifEvent } from "./service";

const NUM_RUNS = 100;

beforeEach(() => {
  sendNative.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Drive `sendNative` from a generated boolean pattern: `pattern[i] === true`
 * means the i-th attempt succeeds, `false` means it throws (delivery failure).
 * Attempts beyond the pattern length default to a failure so a short pattern
 * still models "every attempt fails".
 */
function programAttempts(pattern: boolean[]): void {
  let i = 0;
  sendNative.mockImplementation(() => {
    const succeeds = pattern[i] === true;
    i += 1;
    if (!succeeds) {
      throw new Error("native send failed");
    }
  });
}

/** Index (0-based) of the first succeeding attempt, or -1 if none succeed. */
function firstSuccessIndex(pattern: boolean[]): number {
  return pattern.findIndex((ok) => ok === true);
}

// Events are generated too, to confirm the bound holds regardless of the
// event kind / content being delivered.
const eventArb: fc.Arbitrary<NotifEvent> = fc.oneof(
  fc.record({
    kind: fc.constant("weekly_goal" as const),
    member: fc.string(),
    goalLabel: fc.string(),
  }),
  fc.record({
    kind: fc.constant("group_ready" as const),
    bookTitle: fc.string(),
    nextUnitLabel: fc.string(),
  })
);

// Outcome patterns up to and beyond the bound so we exercise short all-fail
// runs, patterns where success lands on each possible attempt, and patterns
// longer than the bound (whose tail must never be reached).
const patternArb = fc.array(fc.boolean(), { minLength: 0, maxLength: 8 });

describe("Property 12: Notification delivery retry bound", () => {
  it("never exceeds MAX_DELIVERY_ATTEMPTS (1 initial + at most 3 retries)", async () => {
    await fc.assert(
      fc.asyncProperty(eventArb, patternArb, async (event, pattern) => {
        sendNative.mockReset();
        programAttempts(pattern);

        await deliver(event);

        expect(sendNative.mock.calls.length).toBeLessThanOrEqual(
          MAX_DELIVERY_ATTEMPTS
        );
        expect(MAX_DELIVERY_ATTEMPTS).toBe(4);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("returns true and stops at the first succeeding attempt within the bound", async () => {
    await fc.assert(
      fc.asyncProperty(eventArb, patternArb, async (event, pattern) => {
        sendNative.mockReset();
        programAttempts(pattern);

        const received = await deliver(event);

        const successIdx = firstSuccessIndex(pattern);
        const successWithinBound =
          successIdx !== -1 && successIdx < MAX_DELIVERY_ATTEMPTS;

        if (successWithinBound) {
          // Succeeded: receipt reported and no attempt made past the first
          // success (attempts are 1-based => successIdx + 1 total).
          expect(received).toBe(true);
          expect(sendNative.mock.calls.length).toBe(successIdx + 1);
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("returns false and uses the full attempt budget when every attempt fails", async () => {
    await fc.assert(
      fc.asyncProperty(
        eventArb,
        // All-fail patterns (including the empty pattern, which defaults every
        // attempt to a failure).
        fc.array(fc.constant(false), { minLength: 0, maxLength: 8 }),
        async (event, pattern) => {
          sendNative.mockReset();
          programAttempts(pattern);

          const received = await deliver(event);

          // false is the signal the caller uses to record not-received (Req 8.8),
          expect(received).toBe(false);
          // and total failure exhausts exactly the bounded attempt budget.
          expect(sendNative.mock.calls.length).toBe(MAX_DELIVERY_ATTEMPTS);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
