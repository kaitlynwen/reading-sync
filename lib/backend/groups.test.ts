// Unit tests for the group create/join orchestration (Req 4.1–4.10).
//
// These exercise the multi-step backend sequencing in `groups.ts` against fake
// collection accessors, so the branching behavior — especially the
// duplicate-membership path (Req 4.9) — is verified without a live PocketBase
// connection. Each fake models only the behavior the orchestration relies on:
// `getFirstListItem` resolves/rejects (with a not-found `ClientResponseError`),
// and `create` records the attempt.

import { describe, expect, it, vi } from "vitest";
import { ClientResponseError } from "pocketbase";

import { createGroup, joinGroup, type GroupBackend } from "./groups";

/** A not-found error shaped like the PocketBase SDK's 404 response. */
function notFound(): ClientResponseError {
  return new ClientResponseError({
    status: 404,
    response: { code: 404, message: "The requested resource wasn't found." },
  });
}

/**
 * Build a {@link GroupBackend} from per-collection method overrides. Any method
 * left unspecified throws, so a test that reaches an unexpected call fails
 * loudly rather than silently passing.
 */
function makeBackend(overrides: {
  groups?: Partial<{ create: unknown; getFirstListItem: unknown }>;
  groupMembers?: Partial<{ create: unknown; getFirstListItem: unknown }>;
  readingSessions?: Partial<{ getFirstListItem: unknown }>;
  progress?: Partial<{ create: unknown }>;
}): GroupBackend {
  const notImpl = (name: string) => () => {
    throw new Error(`unexpected call: ${name}`);
  };
  return {
    groups: () =>
      ({
        create: overrides.groups?.create ?? notImpl("groups.create"),
        getFirstListItem:
          overrides.groups?.getFirstListItem ??
          notImpl("groups.getFirstListItem"),
      }) as unknown as ReturnType<GroupBackend["groups"]>,
    groupMembers: () =>
      ({
        create: overrides.groupMembers?.create ?? notImpl("members.create"),
        getFirstListItem:
          overrides.groupMembers?.getFirstListItem ??
          notImpl("members.getFirstListItem"),
      }) as unknown as ReturnType<GroupBackend["groupMembers"]>,
    readingSessions: () =>
      ({
        getFirstListItem:
          overrides.readingSessions?.getFirstListItem ??
          notImpl("sessions.getFirstListItem"),
      }) as unknown as ReturnType<GroupBackend["readingSessions"]>,
    progress: () =>
      ({
        create: overrides.progress?.create ?? notImpl("progress.create"),
      }) as unknown as ReturnType<GroupBackend["progress"]>,
  };
}

describe("createGroup (Req 4.1–4.5)", () => {
  it("creates the group + creator membership and returns the new group id", async () => {
    const groupsCreate = vi.fn(async () => ({ id: "grp_1" }));
    const membersCreate = vi.fn(async () => ({ id: "mem_1" }));
    const backend = makeBackend({
      groups: { create: groupsCreate },
      groupMembers: { create: membersCreate },
    });

    const result = await createGroup("usr_1", "  Book Club  ", "  Kaitlyn  ", backend);

    expect(result).toEqual({ ok: true, groupId: "grp_1" });
    // Client never supplies the invite code — only the trimmed name (Req 4.2).
    expect(groupsCreate).toHaveBeenCalledWith({ name: "Book Club" });
    expect(membersCreate).toHaveBeenCalledWith({
      user: "usr_1",
      group: "grp_1",
      display_name: "Kaitlyn",
    });
  });

  it("returns a failure message and no group id when the backend rejects (Req 4.3)", async () => {
    const backend = makeBackend({
      groups: {
        create: vi.fn(async () => {
          throw new ClientResponseError({
            status: 400,
            response: { code: 400, message: "boom" },
          });
        }),
      },
    });

    const result = await createGroup("usr_1", "Book Club", "Kaitlyn", backend);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).not.toBe("");
  });
});

describe("joinGroup (Req 4.6–4.10)", () => {
  it("returns a no-group-found message when the invite code matches nothing (Req 4.8)", async () => {
    const membersCreate = vi.fn();
    const backend = makeBackend({
      groups: {
        getFirstListItem: vi.fn(async () => {
          throw notFound();
        }),
      },
      groupMembers: { create: membersCreate },
    });

    const result = await joinGroup("usr_1", "NOPE12", "Kaitlyn", backend);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/no group found/i);
    // No membership is created when no group matches (Req 4.8).
    expect(membersCreate).not.toHaveBeenCalled();
  });

  it("does NOT create a duplicate membership and still navigates when already a member (Req 4.9)", async () => {
    const membersCreate = vi.fn();
    const progressCreate = vi.fn();
    const backend = makeBackend({
      groups: {
        getFirstListItem: vi.fn(async () => ({ id: "grp_1" })),
      },
      groupMembers: {
        // An existing membership is found for this (user, group).
        getFirstListItem: vi.fn(async () => ({ id: "mem_existing" })),
        create: membersCreate,
      },
      progress: { create: progressCreate },
    });

    const result = await joinGroup("usr_1", "ABC123", "Kaitlyn", backend);

    // Still navigates to the group (Req 4.9)...
    expect(result).toEqual({ ok: true, groupId: "grp_1" });
    // ...without creating a duplicate membership or re-seeding progress.
    expect(membersCreate).not.toHaveBeenCalled();
    expect(progressCreate).not.toHaveBeenCalled();
  });

  it("adds membership and seeds zeroed progress when a session is active (Req 4.6, 4.10)", async () => {
    const membersCreate = vi.fn(async () => ({ id: "mem_1" }));
    const progressCreate = vi.fn(async () => ({ id: "prog_1" }));
    const backend = makeBackend({
      groups: {
        getFirstListItem: vi.fn(async () => ({ id: "grp_1" })),
      },
      groupMembers: {
        // No existing membership.
        getFirstListItem: vi.fn(async () => {
          throw notFound();
        }),
        create: membersCreate,
      },
      readingSessions: {
        getFirstListItem: vi.fn(async () => ({ id: "sess_1" })),
      },
      progress: { create: progressCreate },
    });

    const result = await joinGroup("usr_1", "abc123", "Kaitlyn", backend);

    expect(result).toEqual({ ok: true, groupId: "grp_1" });
    expect(membersCreate).toHaveBeenCalledWith({
      user: "usr_1",
      group: "grp_1",
      display_name: "Kaitlyn",
    });
    expect(progressCreate).toHaveBeenCalledWith({
      reading_session: "sess_1",
      user: "usr_1",
      chapter_completed: 0,
    });
  });

  it("adds membership without seeding progress when no session is active (Req 4.6)", async () => {
    const membersCreate = vi.fn(async () => ({ id: "mem_1" }));
    const progressCreate = vi.fn();
    const backend = makeBackend({
      groups: {
        getFirstListItem: vi.fn(async () => ({ id: "grp_1" })),
      },
      groupMembers: {
        getFirstListItem: vi.fn(async () => {
          throw notFound();
        }),
        create: membersCreate,
      },
      readingSessions: {
        getFirstListItem: vi.fn(async () => {
          throw notFound();
        }),
      },
      progress: { create: progressCreate },
    });

    const result = await joinGroup("usr_1", "ABC123", "Kaitlyn", backend);

    expect(result).toEqual({ ok: true, groupId: "grp_1" });
    expect(membersCreate).toHaveBeenCalledTimes(1);
    expect(progressCreate).not.toHaveBeenCalled();
  });
});
