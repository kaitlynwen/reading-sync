// Feature: native-desktop-migration, Property 1: Completed count is clamped and validated to [0, total]
//
// *For any* reading session total count `T` (integer in 1–100000), any existing
// completed count `E` in `[0, T]`, and any submitted value `S`: if `S` is an
// integer in `[0, T]` then the stored completed count equals `S`; otherwise
// (S < 0, S > T, or S non-integer) the update is rejected, the stored count
// remains `E`, and an out-of-range error is returned.
//
// Validates: Requirements 6.1, 6.2, 6.3, 11.5, 11.6

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { validateProgressRange } from "./progressRange";

const NUM_RUNS = 100;

// Session total `T` is an integer in [1, 100000] per the data model (Req 11.4).
const MIN_TOTAL = 1;
const MAX_TOTAL = 100000;

/**
 * Generate `(total, existing)` where `total` is a valid session total and
 * `existing` is a valid stored count in `[0, total]` (Req 11.5). Chaining keeps
 * `existing` constrained to the session's actual total rather than a fixed
 * upper bound.
 */
const totalAndExisting: fc.Arbitrary<{ total: number; existing: number }> = fc
  .integer({ min: MIN_TOTAL, max: MAX_TOTAL })
  .chain((total) =>
    fc.integer({ min: 0, max: total }).map((existing) => ({ total, existing }))
  );

describe("Property 1: Completed count is clamped and validated to [0, total]", () => {
  // Validates: Requirements 6.1, 6.3, 11.5 — any in-range integer submission is
  // accepted and stored as-is (including values lower than the existing count).
  it("accepts and stores any integer submission within [0, total]", () => {
    fc.assert(
      fc.property(
        totalAndExisting.chain(({ total, existing }) =>
          fc
            .integer({ min: 0, max: total })
            .map((submitted) => ({ total, existing, submitted }))
        ),
        ({ total, existing, submitted }) => {
          const result = validateProgressRange(total, existing, submitted);
          expect(result.accepted).toBe(true);
          expect(result.stored).toBe(submitted);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // Validates: Requirements 6.2, 11.6 — an integer below 0 is rejected, the
  // existing count is retained, and an out-of-range error is returned.
  it("rejects integers below 0, retaining the existing count", () => {
    fc.assert(
      fc.property(
        totalAndExisting,
        fc.integer({ min: 1, max: MAX_TOTAL }),
        ({ total, existing }, belowBy) => {
          const submitted = -belowBy; // strictly negative integer
          const result = validateProgressRange(total, existing, submitted);
          expect(result.accepted).toBe(false);
          expect(result.stored).toBe(existing);
          if (!result.accepted) {
            expect(result.error).toBe("out_of_range");
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // Validates: Requirements 6.2, 11.6 — an integer above the total is rejected,
  // the existing count is retained, and an out-of-range error is returned.
  it("rejects integers above the total, retaining the existing count", () => {
    fc.assert(
      fc.property(
        totalAndExisting,
        fc.integer({ min: 1, max: MAX_TOTAL }),
        ({ total, existing }, aboveBy) => {
          const submitted = total + aboveBy; // strictly greater than total
          const result = validateProgressRange(total, existing, submitted);
          expect(result.accepted).toBe(false);
          expect(result.stored).toBe(existing);
          if (!result.accepted) {
            expect(result.error).toBe("out_of_range");
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // Validates: Requirements 6.2, 11.6 — a non-integer (fractional/NaN/Infinity)
  // submission is rejected, the existing count is retained, and a validation
  // error is returned.
  it("rejects non-integer submissions, retaining the existing count", () => {
    const nonIntegerArb = fc.oneof(
      // Fractional values within and outside the range (never integral).
      fc
        .double({ min: -1000, max: 101000, noNaN: true })
        .filter((n) => !Number.isInteger(n)),
      // Non-finite values.
      fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY)
    );

    fc.assert(
      fc.property(totalAndExisting, nonIntegerArb, ({ total, existing }, submitted) => {
        const result = validateProgressRange(total, existing, submitted);
        expect(result.accepted).toBe(false);
        expect(result.stored).toBe(existing);
        if (!result.accepted) {
          expect(result.error).toBe("not_integer");
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });

  // Validates: Requirements 6.1, 6.2, 6.3, 11.5, 11.6 — the full biconditional
  // against an independent oracle for ANY submitted number: accepted & stored
  // iff integer in [0, T]; otherwise rejected & existing retained.
  it("accepts iff the submission is an integer in [0, total] (independent oracle)", () => {
    const submittedArb = fc.oneof(
      fc.integer({ min: -1000, max: MAX_TOTAL + 1000 }),
      fc.double({ min: -1000, max: MAX_TOTAL + 1000, noNaN: true }),
      fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY)
    );

    fc.assert(
      fc.property(
        totalAndExisting,
        submittedArb,
        ({ total, existing }, submitted) => {
          // Independent oracle restating the acceptance criterion directly.
          const shouldAccept =
            Number.isInteger(submitted) && submitted >= 0 && submitted <= total;

          const result = validateProgressRange(total, existing, submitted);

          expect(result.accepted).toBe(shouldAccept);
          if (shouldAccept) {
            expect(result.stored).toBe(submitted);
          } else {
            // Rejected: existing value retained and an error reported.
            expect(result.stored).toBe(existing);
            if (!result.accepted) {
              expect(result.error).toBeDefined();
            }
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
