// Pure, testable mirror of the PocketBase invite-code generation hook
// (`pocketbase/pb_hooks/invite_code.pb.js`, task 4.2).
//
// The hook runs inside the PocketBase JSVM runtime (using `$security` and the
// collection API), so it cannot be imported into a Node/Vitest test. This
// module re-implements the *pure* generator logic so it can be property-tested
// (Property 4) and reused by any TS caller. The constants and behavior are kept
// in lockstep with the hook: 8 uppercase alphanumeric characters drawn from an
// alphabet that excludes the ambiguous glyphs 0/O/1/I, retried on collision
// until a code not already in use is found (Req 4.2, 11.1).

/** Length of every generated code. Sits inside the schema's 6-32 range. */
export const INVITE_CODE_LENGTH = 8;

/** Lower bound on a well-formed invite code length (schema constraint). */
export const INVITE_CODE_MIN_LENGTH = 6;

/** Upper bound on a well-formed invite code length (schema constraint). */
export const INVITE_CODE_MAX_LENGTH = 32;

/** Alphabet with ambiguous glyphs (0/O, 1/I) removed for readability. */
export const INVITE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Generous retry bound mirroring the hook; collisions are rare in practice. */
export const INVITE_CODE_MAX_ATTEMPTS = 50;

/**
 * Error thrown when the retry budget is exhausted without finding a free code.
 * Mirrors the hook's `BadRequestError` abort rather than persisting a blank or
 * duplicate code.
 */
export class InviteCodeGenerationError extends Error {
  constructor(message = "Could not generate a unique invite code; please retry.") {
    super(message);
    this.name = "InviteCodeGenerationError";
  }
}

/** A source of random floats in [0, 1), injectable for deterministic tests. */
export type RandomSource = () => number;

/**
 * Produce a single candidate code of `length` characters, each picked uniformly
 * from `INVITE_CODE_ALPHABET` using the supplied random source.
 */
function generateCandidate(length: number, random: RandomSource): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    const index = Math.floor(random() * INVITE_CODE_ALPHABET.length);
    // Guard against a random source that returns exactly 1 (or rounding to it).
    const safeIndex = Math.min(index, INVITE_CODE_ALPHABET.length - 1);
    code += INVITE_CODE_ALPHABET[safeIndex];
  }
  return code;
}

/**
 * Generate a well-formed invite code that is not present in `existingCodes`.
 *
 * Mirrors the create hook: draws `INVITE_CODE_LENGTH` characters from the
 * unambiguous alphabet and retries on collision up to `INVITE_CODE_MAX_ATTEMPTS`
 * times. The returned code is always 6-32 characters long and absent from the
 * provided set (Req 4.2, 11.1).
 *
 * @param existingCodes codes already taken by other groups.
 * @param random injectable randomness; defaults to `Math.random`.
 * @throws InviteCodeGenerationError if no free code is found within the budget.
 */
export function generateInviteCode(
  existingCodes: Iterable<string> = [],
  random: RandomSource = Math.random,
): string {
  const taken = existingCodes instanceof Set ? existingCodes : new Set(existingCodes);

  for (let attempt = 0; attempt < INVITE_CODE_MAX_ATTEMPTS; attempt++) {
    const candidate = generateCandidate(INVITE_CODE_LENGTH, random);
    if (!taken.has(candidate)) {
      return candidate;
    }
  }

  throw new InviteCodeGenerationError();
}

/**
 * Whether `code` is well-formed per the schema: length within 6-32 and made up
 * only of characters from the unambiguous alphabet.
 */
export function isWellFormedInviteCode(code: string): boolean {
  if (
    code.length < INVITE_CODE_MIN_LENGTH ||
    code.length > INVITE_CODE_MAX_LENGTH
  ) {
    return false;
  }
  for (const char of code) {
    if (!INVITE_CODE_ALPHABET.includes(char)) {
      return false;
    }
  }
  return true;
}
