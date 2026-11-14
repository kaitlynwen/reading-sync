// lib/backend/sessions.ts
//
// Reading-session operations layered over the Backend_Client collection
// accessors (Req 5). Centralizes the multi-step backend sequences so the
// screens stay thin and the logic is testable with a mocked SDK.

import {
  progressCollection,
  readingSessionsCollection,
} from "@/lib/backend/client";

/**
 * Delete an active Reading_Session together with every Progress_Record that
 * references it (Req 5.9).
 *
 * PocketBase does not delete related `progress` rows implicitly, so this
 * removes them explicitly: fetch the session's progress records, delete each
 * one, then delete the session itself. The progress rows are removed before the
 * session so no progress record is ever left orphaned pointing at a deleted
 * session, even if the session delete were to fail.
 *
 * @param sessionId the id of the Reading_Session to delete
 */
export async function deleteSessionWithProgress(
  sessionId: string,
): Promise<void> {
  // All progress records for this session (Req 5.9). The unique
  // `(reading_session, user)` index means this is at most one row per member.
  const progressRecords = await progressCollection().getFullList({
    filter: `reading_session = "${sessionId}"`,
  });

  for (const record of progressRecords) {
    await progressCollection().delete(record.id);
  }

  await readingSessionsCollection().delete(sessionId);
}
