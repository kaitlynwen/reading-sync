// Feature: native-desktop-migration, Property 6: Progress type membership
//
// *For any* string submitted as a Reading_Session progress type, it is accepted
// as valid if and only if it is exactly one of the four allowed values:
// "chapters", "pages", "milestones", or "sections" (Req 5.2). Any other value —
// including case variants, surrounding whitespace, prefixes/suffixes, or an
// empty string — is rejected.
//
// Validates: Requirements 5.2

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { PROGRESS_TYPES, isValidProgressType } from "./validation";

const NUM_RUNS = 100;

/**
 * Independent oracle derived straight from the acceptance criterion (Req 5.2):
 * the allow-list is exactly these four values, spelled out here rather than
 * referencing the implementation's `PROGRESS_TYPES` so the property checks
 * behavior against the requirement instead of against itself.
 */
const ALLOWED = ["chapters", "pages", "milestones", "sections"];

function oracleIsValid(value: string): boolean {
  return ALLOWED.includes(value);
}

describe("Property 6: Progress type membership", () => {
  it("accepts a value iff it is one of the four allowed types (arbitrary strings)", () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        expect(isValidProgressType(value)).toBe(oracleIsValid(value));
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("accepts each of the exact allowed progress types", () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALLOWED), (value) => {
        expect(isValidProgressType(value)).toBe(true);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("rejects any string that is not exactly an allowed type", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !ALLOWED.includes(s)),
        (value) => {
          expect(isValidProgressType(value)).toBe(false);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("rejects allowed types with surrounding whitespace", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALLOWED),
        fc.constantFrom(" ", "\t", "\n", "  "),
        (type, ws) => {
          expect(isValidProgressType(`${ws}${type}`)).toBe(false);
          expect(isValidProgressType(`${type}${ws}`)).toBe(false);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("rejects case variants of allowed types that are not the exact lowercase value", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALLOWED),
        (type) => {
          const upper = type.toUpperCase();
          // Upper-casing always changes an all-lowercase allowed value.
          expect(isValidProgressType(upper)).toBe(false);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("rejects allowed types with an extra prefix or suffix", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALLOWED),
        fc.string({ minLength: 1 }).filter((s) => !s.includes(" ")),
        (type, extra) => {
          // A non-empty affix makes the string differ from any allowed value.
          if (!ALLOWED.includes(`${extra}${type}`)) {
            expect(isValidProgressType(`${extra}${type}`)).toBe(false);
          }
          if (!ALLOWED.includes(`${type}${extra}`)) {
            expect(isValidProgressType(`${type}${extra}`)).toBe(false);
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("rejects the empty string", () => {
    expect(isValidProgressType("")).toBe(false);
  });

  it("keeps the implementation allow-list in agreement with the requirement's four values", () => {
    // Guards against the allow-list drifting away from Req 5.2.
    expect([...PROGRESS_TYPES].sort()).toEqual([...ALLOWED].sort());
    expect(PROGRESS_TYPES.length).toBe(4);
  });
});
