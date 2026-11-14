// Feature: native-desktop-migration, Property 5: Group field validity and invite-code uniqueness
//
// *For any* candidate group (name, invite_code) and any set of existing invite
// codes, the group is accepted if and only if name length is 1-200, invite_code
// length is 6-32, and invite_code is not already present; otherwise the
// operation is rejected, an error identifying the invalid or duplicate field is
// returned, and existing group records are unchanged.
//
// Validates: Requirements 11.1, 11.2

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  GROUP_NAME_MAX_LENGTH,
  GROUP_NAME_MIN_LENGTH,
  INVITE_CODE_MAX_LENGTH,
  INVITE_CODE_MIN_LENGTH,
  validateGroupFields,
} from "./groupFields";

const NUM_RUNS = 100;

/**
 * Independent oracle derived straight from the acceptance criteria (Req 11.1,
 * 11.2): a candidate is accepted iff the name length is in [1, 200], the invite
 * code length is in [6, 32], and the invite code is not already present. It
 * shares no code with the implementation, so the property checks behavior
 * against the requirement rather than against itself.
 */
function oracleAccepted(
  name: string,
  inviteCode: string,
  existing: Set<string>
): boolean {
  const nameOk =
    name.length >= GROUP_NAME_MIN_LENGTH &&
    name.length <= GROUP_NAME_MAX_LENGTH;
  const codeLenOk =
    inviteCode.length >= INVITE_CODE_MIN_LENGTH &&
    inviteCode.length <= INVITE_CODE_MAX_LENGTH;
  const codeUnique = !existing.has(inviteCode);
  return nameOk && codeLenOk && codeUnique;
}

// A string of an exact length, used to drive name/code length edge cases.
const stringOfLength = (len: number): fc.Arbitrary<string> =>
  fc.string({ minLength: len, maxLength: len });

// Arbitrary invite-code-shaped string spanning below, within, and above range.
const codeArb: fc.Arbitrary<string> = fc.string({ minLength: 0, maxLength: 40 });
// Arbitrary name-shaped string spanning empty, within, and above the 200 bound.
const nameArb: fc.Arbitrary<string> = fc.string({ minLength: 0, maxLength: 260 });
// A set of already-taken invite codes.
const existingArb: fc.Arbitrary<string[]> = fc.array(
  fc.string({ minLength: 0, maxLength: 40 }),
  { maxLength: 200 }
);

describe("Property 5: Group field validity and invite-code uniqueness", () => {
  it("accepts a candidate iff name 1-200, code 6-32, and code unique (arbitrary inputs)", () => {
    fc.assert(
      fc.property(nameArb, codeArb, existingArb, (name, code, existing) => {
        const existingSet = new Set(existing);
        const result = validateGroupFields(name, code, existingSet);
        expect(result.accepted).toBe(oracleAccepted(name, code, existingSet));
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("accepts any in-range name + in-range, unused code", () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: GROUP_NAME_MIN_LENGTH, max: GROUP_NAME_MAX_LENGTH })
          .chain(stringOfLength),
        fc
          .integer({ min: INVITE_CODE_MIN_LENGTH, max: INVITE_CODE_MAX_LENGTH })
          .chain(stringOfLength),
        existingArb,
        (name, code, existing) => {
          // Ensure the generated code is genuinely absent from the taken set.
          const existingSet = new Set(existing);
          existingSet.delete(code);
          const result = validateGroupFields(name, code, existingSet);
          expect(result.accepted).toBe(true);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("rejects an empty or over-length name with a name_length error", () => {
    const badName = fc.oneof(
      fc.constant(""),
      fc
        .integer({ min: GROUP_NAME_MAX_LENGTH + 1, max: GROUP_NAME_MAX_LENGTH + 60 })
        .chain(stringOfLength)
    );
    fc.assert(
      fc.property(
        badName,
        fc
          .integer({ min: INVITE_CODE_MIN_LENGTH, max: INVITE_CODE_MAX_LENGTH })
          .chain(stringOfLength),
        (name, code) => {
          const result = validateGroupFields(name, code, []);
          expect(result.accepted).toBe(false);
          if (!result.accepted) {
            expect(result.error).toBe("name_length");
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("rejects an out-of-range code length (name valid) with an invite_code_length error", () => {
    const badCode = fc.oneof(
      // Too short: 0 .. 5 chars.
      fc
        .integer({ min: 0, max: INVITE_CODE_MIN_LENGTH - 1 })
        .chain(stringOfLength),
      // Too long: 33 .. 92 chars.
      fc
        .integer({ min: INVITE_CODE_MAX_LENGTH + 1, max: INVITE_CODE_MAX_LENGTH + 60 })
        .chain(stringOfLength)
    );
    fc.assert(
      fc.property(
        fc
          .integer({ min: GROUP_NAME_MIN_LENGTH, max: GROUP_NAME_MAX_LENGTH })
          .chain(stringOfLength),
        badCode,
        (name, code) => {
          const result = validateGroupFields(name, code, []);
          expect(result.accepted).toBe(false);
          if (!result.accepted) {
            expect(result.error).toBe("invite_code_length");
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("rejects a duplicate code (name + code length valid) with an invite_code_duplicate error", () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: GROUP_NAME_MIN_LENGTH, max: GROUP_NAME_MAX_LENGTH })
          .chain(stringOfLength),
        fc
          .integer({ min: INVITE_CODE_MIN_LENGTH, max: INVITE_CODE_MAX_LENGTH })
          .chain(stringOfLength),
        existingArb,
        (name, code, existing) => {
          // Force the candidate code to already be present.
          const existingSet = new Set(existing);
          existingSet.add(code);
          const result = validateGroupFields(name, code, existingSet);
          expect(result.accepted).toBe(false);
          if (!result.accepted) {
            expect(result.error).toBe("invite_code_duplicate");
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("does not mutate the existing-codes set on either path (existing records unchanged)", () => {
    fc.assert(
      fc.property(nameArb, codeArb, existingArb, (name, code, existing) => {
        const existingSet = new Set(existing);
        const before = new Set(existingSet);
        validateGroupFields(name, code, existingSet);
        // Same size and same members after validation.
        expect(existingSet.size).toBe(before.size);
        for (const c of before) {
          expect(existingSet.has(c)).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("checks name length before invite-code length when both are invalid", () => {
    // When both name and code are invalid, the reported field is the name
    // (validated first) so a single deterministic reason is returned.
    const result = validateGroupFields("", "abc", []);
    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.error).toBe("name_length");
    }
  });
});
