/// <reference path="../pb_data/types.d.ts" />
//
// Progress range validation hook for the `progress` collection
// (Req 6.1, 6.2, 6.3, 11.5, 11.6).
//
// `chapter_completed` is the generic completed count and must be an integer in
// `[0, total_chapters]` where `total_chapters` is read from the related
// reading session. This hook fires on both create and update (so the invariant
// holds on every persistence path, including seeded zeroed records):
//
//   - an integer in [0, total_chapters]  -> accepted (including lower values,
//     Req 6.3)
//   - < 0, > total_chapters, or non-integer -> the save is aborted with an
//     out-of-range error, leaving the existing record unchanged (Req 6.2, 11.6)
//
// Throwing before e.next() aborts the transaction, so a rejected update never
// mutates the stored record.

function validateProgressRange(e) {
  const raw = e.record.get("chapter_completed");
  const value = Number(raw);

  // Reject non-numeric / non-integer submissions outright (Req 11.6).
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new BadRequestError("chapter_completed must be a whole number.", {
      chapter_completed: new ValidationError(
        "not_integer",
        "Completed count must be a whole number."
      ),
    });
  }

  // Resolve the session total. The relation is a single id.
  const sessionId = e.record.get("reading_session");
  if (!sessionId) {
    throw new BadRequestError("A reading session is required.", {
      reading_session: new ValidationError(
        "required",
        "A reading session is required."
      ),
    });
  }

  let session;
  try {
    session = e.app.findRecordById("reading_sessions", String(sessionId));
  } catch {
    throw new BadRequestError("The referenced reading session was not found.", {
      reading_session: new ValidationError(
        "not_found",
        "The referenced reading session was not found."
      ),
    });
  }

  const total = Number(session.get("total_chapters"));

  // Enforce the [0, total] range (Req 6.2, 11.6). Out-of-range values are
  // rejected rather than clamped so the existing record is left unchanged.
  if (value < 0 || value > total) {
    throw new BadRequestError(
      "Completed count is out of range for this session.",
      {
        chapter_completed: new ValidationError(
          "out_of_range",
          "Completed count must be between 0 and " + total + "."
        ),
      }
    );
  }

  e.next();
}

onRecordCreate(validateProgressRange, "progress");
onRecordUpdate(validateProgressRange, "progress");
