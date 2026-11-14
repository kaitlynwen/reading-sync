// Feature: native-desktop-migration, Property 13: Email validity
//
// *For any* string submitted as an email on the create-account screen, it is
// accepted as valid if and only if it contains a single "@" with a non-empty
// local part (before the "@") and a non-empty domain part (after the "@").
//
// Validates: Requirements 3.3

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { isValidEmail } from "./validation";

const NUM_RUNS = 100;

/**
 * Independent oracle derived straight from the acceptance criterion (Req 3.3):
 * a value is valid iff it contains exactly one "@" and both the part before and
 * the part after that "@" are non-empty. Deliberately shares no code with the
 * implementation so the property checks behavior against the requirement rather
 * than against itself.
 */
function oracleIsValid(value: string): boolean {
  const parts = value.split("@");
  // Exactly one "@" => split yields exactly two parts.
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  return local.length > 0 && domain.length > 0;
}

// A generator for "atom" characters that never include "@", so composed parts
// have a controlled number of separators.
const noAt = fc.string().filter((s) => !s.includes("@"));
const noAtNonEmpty = fc
  .string({ minLength: 1 })
  .filter((s) => !s.includes("@"));

describe("Property 13: Email validity", () => {
  it("accepts a value iff it has a single '@' with non-empty parts (arbitrary strings)", () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        expect(isValidEmail(value)).toBe(oracleIsValid(value));
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("accepts any local@domain with non-empty, '@'-free parts", () => {
    fc.assert(
      fc.property(noAtNonEmpty, noAtNonEmpty, (local, domain) => {
        expect(isValidEmail(`${local}@${domain}`)).toBe(true);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("rejects strings that contain no '@'", () => {
    fc.assert(
      fc.property(noAt, (value) => {
        expect(isValidEmail(value)).toBe(false);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("rejects strings with two or more '@' separators", () => {
    fc.assert(
      fc.property(
        fc.array(noAt, { minLength: 3, maxLength: 6 }),
        (parts) => {
          // Joining N>=3 parts with "@" yields N-1 >= 2 separators.
          expect(isValidEmail(parts.join("@"))).toBe(false);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("rejects a single '@' with an empty local part", () => {
    fc.assert(
      fc.property(noAtNonEmpty, (domain) => {
        expect(isValidEmail(`@${domain}`)).toBe(false);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("rejects a single '@' with an empty domain part", () => {
    fc.assert(
      fc.property(noAtNonEmpty, (local) => {
        expect(isValidEmail(`${local}@`)).toBe(false);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("rejects a lone '@' (both parts empty)", () => {
    expect(isValidEmail("@")).toBe(false);
  });
});
