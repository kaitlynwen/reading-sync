// Feature: native-desktop-migration, Property 7: Session numeric total validity
//
// *For any* submitted total count when the progress type is `chapters` or
// `pages`, the session is accepted only if the count is a whole number greater
// than or equal to one; any other value is rejected with a positive-whole-number
// validation message and no session is created.
//
// Validates: Requirements 5.4

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { gateCreateSession, isPositiveWholeNumber } from "./validation";

const NUM_RUNS = 100;

// The two numeric progress types this property is scoped to (Req 5.4).
const numericProgressType = fc.constantFrom("chapters", "pages");

// A book title that passes the earlier title gate so validation reaches the
// numeric-total check (non-blank after trimming).
const validBookTitle = fc
  .string({ minLength: 1 })
  .filter((s) => s.trim().length > 0);

/**
 * Independent oracle derived straight from the acceptance criterion (Req 5.4):
 * a total count is valid iff it parses to a whole number that is at least one.
 * Deliberately shares no logic with the implementation so the property checks
 * behavior against the requirement rather than against itself.
 */
function oracleValidTotal(value: string | number): boolean {
  const n = typeof value === "string" ? Number(value.trim() === "" ? NaN : value) : value;
  return Number.isInteger(n) && n >= 1;
}

describe("Property 7: Session numeric total validity", () => {
  it("isPositiveWholeNumber matches the requirement oracle for arbitrary numbers", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer(),
          fc.double(),
          fc.double({ min: -1e6, max: 1e6 }),
        ),
        (n) => {
          expect(isPositiveWholeNumber(n)).toBe(oracleValidTotal(n));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("isPositiveWholeNumber matches the requirement oracle for arbitrary strings", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(isPositiveWholeNumber(s)).toBe(oracleValidTotal(s));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("accepts chapters/pages sessions exactly when the total is a whole number >= 1", () => {
    fc.assert(
      fc.property(
        validBookTitle,
        numericProgressType,
        fc.integer({ min: 1, max: 1_000_000 }),
        (title, progressType, total) => {
          const result = gateCreateSession(title, progressType, String(total), []);
          expect(result.ok).toBe(true);
          expect(result.totalCount).toBe(total);
          expect(result.readingUnits).toEqual([]);
          expect(result.message).toBe("");
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("also accepts a numeric (non-string) whole total >= 1", () => {
    fc.assert(
      fc.property(
        validBookTitle,
        numericProgressType,
        fc.integer({ min: 1, max: 1_000_000 }),
        (title, progressType, total) => {
          const result = gateCreateSession(title, progressType, total, []);
          expect(result.ok).toBe(true);
          expect(result.totalCount).toBe(total);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects non-positive whole totals (zero and negatives) with a positive-whole-number message and no session", () => {
    fc.assert(
      fc.property(
        validBookTitle,
        numericProgressType,
        fc.integer({ min: -1_000_000, max: 0 }),
        (title, progressType, total) => {
          const result = gateCreateSession(title, progressType, String(total), []);
          expect(result.ok).toBe(false);
          expect(result.message).toMatch(/positive whole number/i);
          // No session configuration is produced on rejection (Req 5.4).
          expect(result.totalCount).toBe(0);
          expect(result.readingUnits).toEqual([]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects fractional totals with a positive-whole-number message and no session", () => {
    const fractional = fc
      .double({ min: -1_000_000, max: 1_000_000, noNaN: true })
      .filter((n) => !Number.isInteger(n));
    fc.assert(
      fc.property(validBookTitle, numericProgressType, fractional, (title, progressType, total) => {
        const result = gateCreateSession(title, progressType, String(total), []);
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/positive whole number/i);
        expect(result.totalCount).toBe(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects blank and non-numeric totals with a positive-whole-number message and no session", () => {
    const nonNumeric = fc
      .string()
      .filter((s) => s.trim() === "" || Number.isNaN(Number(s)));
    fc.assert(
      fc.property(validBookTitle, numericProgressType, nonNumeric, (title, progressType, total) => {
        const result = gateCreateSession(title, progressType, total, []);
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/positive whole number/i);
        expect(result.totalCount).toBe(0);
        expect(result.readingUnits).toEqual([]);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
