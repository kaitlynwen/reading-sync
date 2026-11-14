/// <reference path="../pb_data/types.d.ts" />
//
// Invite-code generation hook for the `groups` collection (Req 4.2, 11.1).
//
// On create, if a group record arrives without an `invite_code` (or with a
// placeholder the client did not fill), the hook generates a well-formed code
// and retries on collision until it finds one not already present, so every
// created group gets a unique code without the client having to guess one.
//
// Generated codes are 8 uppercase alphanumeric characters, which sits inside
// the required 6-32 length range enforced by the collection schema. Ambiguous
// glyphs (0/O, 1/I) are excluded so codes are easy to read and share.
//
// A client MAY still supply its own `invite_code`; in that case this hook
// leaves it untouched and the collection's unique index + length validation
// decide whether it is accepted (Req 11.2).

onRecordCreate((e) => {
  const CODE_LENGTH = 8; // within the schema's 6-32 range
  const MAX_ATTEMPTS = 50; // generous retry bound; collisions are rare
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

  // Respect a code the client already provided; only generate when absent.
  const existing = e.record.get("invite_code");
  if (existing && String(existing).length > 0) {
    e.next();
    return;
  }

  const generateCode = () => {
    // Cryptographically random pick of CODE_LENGTH chars from ALPHABET.
    return $security.randomStringWithAlphabet(CODE_LENGTH, ALPHABET);
  };

  const isTaken = (code) => {
    try {
      e.app.findFirstRecordByFilter("groups", "invite_code = {:code}", {
        code: code,
      });
      return true; // a record was found -> collision
    } catch {
      return false; // not found -> available
    }
  };

  let code = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = generateCode();
    if (!isTaken(candidate)) {
      code = candidate;
      break;
    }
  }

  if (!code) {
    // Exhausted the retry budget without finding a free code. Abort the create
    // with a clear error rather than persisting a blank/duplicate code.
    throw new BadRequestError(
      "Could not generate a unique invite code; please retry."
    );
  }

  e.record.set("invite_code", code);
  e.next();
}, "groups");
