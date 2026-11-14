// Feature: native-desktop-migration, Property 4: Generated invite codes are unique and well-formed
//
// *For any* set of already-existing invite codes, the invite-code generator
// returns a code that is 6-32 characters long and is not present in that set.
//
// Validates: Requirements 4.2, 11.1

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  INVITE_CODE_MAX_LENGTH,
  INVITE_CODE_MIN_LENGTH,
  generateInviteCode,
  isWellFormedInviteCode,
} from "./invite-code";

const NUM_RUNS = 100;

/**
 * A seeded, uniform random source in [0, 1) so each property case is
 * deterministic and reproducible from fast-check's reported counterexample.
 * mulberry32 is a small, well-distributed 32-bit PRNG.
 */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Arbitrary well-formed invite code (same shape the generator produces). */
const inviteCodeArb: fc.Arbitrary<string> = fc
  .integer({ min: INVITE_CODE_MIN_LENGTH, max: INVITE_CODE_MAX_LENGTH })
  .chain((len) =>
    fc.stringOf(fc.constantFrom(...INVITE_CODE_ALPHABET.split("")), {
      minLength: len,
      maxLength: len,
    }),
  );

describe("Property 4: Generated invite codes are unique and well-formed", () => {
  it("returns a 6-32 char code absent from any set of existing codes", () => {
    fc.assert(
      fc.property(
        fc.array(inviteCodeArb, { maxLength: 200 }),
        fc.integer({ min: 0, max: 0xffffffff }),
        (existing, seed) => {
          const existingSet = new Set(existing);
          const code = generateInviteCode(existingSet, seededRandom(seed));

          // Well-formed: within the 6-32 length bound (Req 11.1).
          expect(code.length).toBeGreaterThanOrEqual(INVITE_CODE_MIN_LENGTH);
          expect(code.length).toBeLessThanOrEqual(INVITE_CODE_MAX_LENGTH);
          expect(isWellFormedInviteCode(code)).toBe(true);

          // Unique: not present among the already-existing codes (Req 4.2).
          expect(existingSet.has(code)).toBe(false);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("avoids a dense set of codes that overlaps the generator's own space", () => {
    // Pre-fill the taken set with many codes of exactly the generator's length
    // and alphabet so collisions are plausible and the retry loop is exercised,
    // then assert the returned code still escapes the set (Req 4.2).
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.stringOf(fc.constantFrom(...INVITE_CODE_ALPHABET.split("")), {
            minLength: INVITE_CODE_LENGTH,
            maxLength: INVITE_CODE_LENGTH,
          }),
          { maxLength: 500 },
        ),
        fc.integer({ min: 0, max: 0xffffffff }),
        (existing, seed) => {
          const existingSet = new Set(existing);
          const code = generateInviteCode(existingSet, seededRandom(seed));

          expect(isWellFormedInviteCode(code)).toBe(true);
          expect(existingSet.has(code)).toBe(false);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("returns a well-formed unique code using the default randomness", () => {
    // Exercises the real Math.random path (no injected source) to confirm the
    // default generator also honors the property.
    fc.assert(
      fc.property(fc.array(inviteCodeArb, { maxLength: 200 }), (existing) => {
        const existingSet = new Set(existing);
        const code = generateInviteCode(existingSet);

        expect(isWellFormedInviteCode(code)).toBe(true);
        expect(existingSet.has(code)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("handles an empty existing set", () => {
    const code = generateInviteCode([]);
    expect(code).toHaveLength(INVITE_CODE_LENGTH);
    expect(isWellFormedInviteCode(code)).toBe(true);
  });
});
