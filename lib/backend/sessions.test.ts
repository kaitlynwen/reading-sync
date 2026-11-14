// lib/backend/sessions.test.ts
//
// Unit tests for `deleteSessionWithProgress` (Req 5.9). The real deletion runs
// against PocketBase, so this mocks the Backend_Client collection accessors and
// asserts the operation deletes every progress record for the session and then
// deletes the session itself, in that order.

import { beforeEach, describe, expect, it, vi } from "vitest";

const getFullList = vi.fn();
const progressDelete = vi.fn();
const sessionDelete = vi.fn();

vi.mock("@/lib/backend/client", () => ({
  progressCollection: () => ({
    getFullList,
    delete: progressDelete,
  }),
  readingSessionsCollection: () => ({
    delete: sessionDelete,
  }),
}));

import { deleteSessionWithProgress } from "./sessions";

beforeEach(() => {
  getFullList.mockReset();
  progressDelete.mockReset();
  sessionDelete.mockReset();
  progressDelete.mockResolvedValue(true);
  sessionDelete.mockResolvedValue(true);
});

describe("deleteSessionWithProgress (Req 5.9)", () => {
  it("deletes every progress record for the session, then the session", async () => {
    getFullList.mockResolvedValue([
      { id: "p1" },
      { id: "p2" },
      { id: "p3" },
    ]);

    await deleteSessionWithProgress("sess-1");

    // Progress rows are fetched filtered to this session.
    expect(getFullList).toHaveBeenCalledWith({
      filter: 'reading_session = "sess-1"',
    });

    // Every progress record is deleted.
    expect(progressDelete).toHaveBeenCalledTimes(3);
    expect(progressDelete).toHaveBeenCalledWith("p1");
    expect(progressDelete).toHaveBeenCalledWith("p2");
    expect(progressDelete).toHaveBeenCalledWith("p3");

    // The session itself is deleted.
    expect(sessionDelete).toHaveBeenCalledTimes(1);
    expect(sessionDelete).toHaveBeenCalledWith("sess-1");

    // Progress rows are removed before the session (no orphaned records).
    const lastProgressOrder = progressDelete.mock.invocationCallOrder.at(-1)!;
    const sessionOrder = sessionDelete.mock.invocationCallOrder[0];
    expect(lastProgressOrder).toBeLessThan(sessionOrder);
  });

  it("still deletes the session when it has no progress records", async () => {
    getFullList.mockResolvedValue([]);

    await deleteSessionWithProgress("sess-2");

    expect(progressDelete).not.toHaveBeenCalled();
    expect(sessionDelete).toHaveBeenCalledWith("sess-2");
  });

  it("does not delete the session if listing progress fails", async () => {
    getFullList.mockRejectedValue(new Error("offline"));

    await expect(deleteSessionWithProgress("sess-3")).rejects.toThrow(
      "offline",
    );
    expect(sessionDelete).not.toHaveBeenCalled();
  });
});
