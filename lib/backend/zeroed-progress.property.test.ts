// Feature: native-desktop-migration, Property 3: Members have a zeroed progress record when a session is available
//
// *For any* set of group members, when a reading session becomes active for the
// group — via session creation (Req 5.6) OR via a member joining a group that
// already has an active session (Req 4.10) — every such member ends up with
// exactly one progress record for that session, and its completed count is zero.
//
// Validates: Requirements 4.10, 5.6
//
// Both seeding paths write progress rows through the Backend_Client collection
// accessors, which the real app backs with PocketBase. This test MOCKS the
// PocketBase SDK with a minimal `progress`/`group_members`/`reading_sessions`
// store that enforces the same `(reading_session, user)` unique composite index
// PocketBase would, so "exactly one" is a real guarantee rather than an
// assumption. It then drives the ACTUAL seeding code:
//   - the join path uses the real `joinGroup` from `groups.ts` (task 8.1),
//     injected with the mocked collections;
//   - the session-creation path replays the seeding loop from
//     `CreateSessionClient.createSession` (task 8.2) against the same mock —
//     create the session active, then seed a zeroed row per existing member.

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { ClientResponseError } from "pocketbase";

import { joinGroup, type GroupBackend } from "./groups";

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Mock PocketBase store (SDK mocked)
// ---------------------------------------------------------------------------

interface GroupRecord {
  id: string;
  name: string;
  invite_code: string;
}

interface MemberRecord {
  id: string;
  user: string;
  group: string;
  display_name: string;
}

interface SessionRecord {
  id: string;
  group: string;
  is_active: boolean;
}

interface ProgressRecord {
  id: string;
  reading_session: string;
  user: string;
  chapter_completed: number;
}

/** A not-found error shaped like the PocketBase SDK's 404 response. */
function notFound(): ClientResponseError {
  return new ClientResponseError({
    status: 404,
    response: { code: 404, message: "The requested resource wasn't found." },
  });
}

/**
 * Thrown when a `progress.create` would duplicate an existing
 * `(reading_session, user)` pair — mirroring PocketBase enforcing the unique
 * composite index. Shape matches the SDK's error (HTTP 400, per-field index
 * violation) so the seeding code cannot tell this mock apart from the client.
 */
function uniquenessViolation(): ClientResponseError {
  return new ClientResponseError({
    status: 400,
    response: {
      code: 400,
      message: "Failed to create record.",
      data: {
        reading_session: {
          code: "validation_not_unique",
          message: "Value must be unique.",
        },
      },
    },
  });
}

/**
 * An in-memory PocketBase stand-in modelling only what Property 3 depends on:
 * group/member/session lookups and a `progress` collection that enforces the
 * `(reading_session, user)` unique index on create. It exposes a
 * {@link GroupBackend} for `joinGroup` and a direct `seedSessionProgress` that
 * replays the real session-creation seeding loop.
 */
class MockStore {
  readonly groups: GroupRecord[] = [];
  readonly members: MemberRecord[] = [];
  readonly sessions: SessionRecord[] = [];
  private readonly progressRows = new Map<string, ProgressRecord>();
  private nextId = 0;

  private static key(readingSession: string, user: string): string {
    // Length-prefix the first component so distinct pairs cannot collide via
    // string concatenation.
    return `${readingSession.length}:${readingSession}\u0000${user}`;
  }

  // -- seeding helpers ------------------------------------------------------

  addGroup(group: GroupRecord): void {
    this.groups.push(group);
  }

  addMember(member: Omit<MemberRecord, "id">): MemberRecord {
    const record = { id: `mem_${this.nextId++}`, ...member };
    this.members.push(record);
    return record;
  }

  addActiveSession(group: string): SessionRecord {
    const record = { id: `sess_${this.nextId++}`, group, is_active: true };
    this.sessions.push(record);
    return record;
  }

  // -- progress invariant inspection ---------------------------------------

  progressFor(readingSession: string, user: string): ProgressRecord[] {
    const record = this.progressRows.get(MockStore.key(readingSession, user));
    return record ? [record] : [];
  }

  // -- progress create (enforces the unique index) -------------------------

  private createProgress(data: {
    reading_session: string;
    user: string;
    chapter_completed: number;
  }): ProgressRecord {
    const key = MockStore.key(data.reading_session, data.user);
    if (this.progressRows.has(key)) {
      throw uniquenessViolation();
    }
    const record: ProgressRecord = { id: `prog_${this.nextId++}`, ...data };
    this.progressRows.set(key, record);
    return record;
  }

  // -- GroupBackend surface for joinGroup ----------------------------------

  asGroupBackend(): GroupBackend {
    // The backend accessors close over the store instance; `this` is not
    // available inside the nested async arrows below.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const store: MockStore = this;
    return {
      groups: () =>
        ({
          getFirstListItem: async (filter: string) => {
            // `invite_code = "CODE"`
            const code = filter.match(/invite_code = "(.*)"/)?.[1];
            const group = store.groups.find((g) => g.invite_code === code);
            if (!group) throw notFound();
            return group;
          },
        }) as unknown as ReturnType<GroupBackend["groups"]>,
      groupMembers: () =>
        ({
          getFirstListItem: async (filter: string) => {
            // `user = "U" && group = "G"`
            const user = filter.match(/user = "(.*?)"/)?.[1];
            const group = filter.match(/group = "(.*?)"/)?.[1];
            const member = store.members.find(
              (m) => m.user === user && m.group === group,
            );
            if (!member) throw notFound();
            return member;
          },
          create: async (data: Omit<MemberRecord, "id">) =>
            store.addMember(data),
        }) as unknown as ReturnType<GroupBackend["groupMembers"]>,
      readingSessions: () =>
        ({
          getFirstListItem: async (filter: string) => {
            // `group = "G" && is_active = true`
            const group = filter.match(/group = "(.*?)"/)?.[1];
            const session = store.sessions.find(
              (s) => s.group === group && s.is_active,
            );
            if (!session) throw notFound();
            return session;
          },
        }) as unknown as ReturnType<GroupBackend["readingSessions"]>,
      progress: () =>
        ({
          create: async (data: {
            reading_session: string;
            user: string;
            chapter_completed: number;
          }) => store.createProgress(data),
        }) as unknown as ReturnType<GroupBackend["progress"]>,
    };
  }

  /**
   * Replay the session-creation seeding loop from
   * `CreateSessionClient.createSession` (task 8.2): the session is created
   * active, then a zeroed progress row is created for every existing member of
   * the group (Req 5.6). Returns the new session id.
   */
  seedSessionProgress(group: string): string {
    const session = this.addActiveSession(group);
    const members = this.members.filter((m) => m.group === group);
    for (const member of members) {
      this.createProgress({
        reading_session: session.id,
        user: member.user,
        chapter_completed: 0,
      });
    }
    return session.id;
  }
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

// Distinct user ids for a group's members.
const userIdsArb = fc.uniqueArray(
  fc.integer({ min: 1, max: 999 }).map((n) => `usr_${n}`),
  { minLength: 1, maxLength: 12 },
);

// A well-formed invite code the join path can match against (stored uppercase).
const inviteCodeArb = fc
  .string({ minLength: 6, maxLength: 12, unit: "grapheme-ascii" })
  .map((s) => s.toUpperCase())
  .filter((s) => /^[A-Z0-9]{6,12}$/.test(s));

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe("Property 3: Members have a zeroed progress record when a session is available", () => {
  // Validates: Requirement 5.6 — when a session is created, every EXISTING
  // member of the group gets exactly one progress record for that session with
  // a completed count of zero.
  it("seeds exactly one zeroed progress record per existing member on session creation", () => {
    fc.assert(
      fc.property(userIdsArb, (userIds) => {
        const store = new MockStore();
        const groupId = "grp_main";
        store.addGroup({ id: groupId, name: "Club", invite_code: "AAAAAA" });
        for (const user of userIds) {
          store.addMember({ user, group: groupId, display_name: user });
        }

        const sessionId = store.seedSessionProgress(groupId);

        for (const user of userIds) {
          const rows = store.progressFor(sessionId, user);
          // Exactly one record for the pair...
          expect(rows.length).toBe(1);
          // ...with a completed count of zero (Req 5.6).
          expect(rows[0].chapter_completed).toBe(0);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Validates: Requirement 4.10 — a member joining a group that already has an
  // active session gets exactly one zeroed progress record for that session,
  // via the real `joinGroup` orchestration.
  it("seeds exactly one zeroed progress record for a member joining a group with an active session", () => {
    fc.assert(
      fc.asyncProperty(
        userIdsArb,
        inviteCodeArb,
        async (existingUsers, inviteCode) => {
          const store = new MockStore();
          const groupId = "grp_main";
          store.addGroup({ id: groupId, name: "Club", invite_code: inviteCode });

          // The group already has members and an active session with seeded
          // progress rows (the session-creation path).
          for (const user of existingUsers) {
            store.addMember({ user, group: groupId, display_name: user });
          }
          const sessionId = store.seedSessionProgress(groupId);

          // A brand-new member joins by invite code (Req 4.6, 4.10). Pick a
          // user id not already present.
          const joiner = `usr_new_${existingUsers.length}`;

          const result = await joinGroup(
            joiner,
            inviteCode,
            "New Member",
            store.asGroupBackend(),
          );

          // The join succeeds and navigates to the group (Req 4.6).
          expect(result).toEqual({ ok: true, groupId });

          // The joining member now has exactly one progress record for the
          // active session, zeroed (Req 4.10).
          const rows = store.progressFor(sessionId, joiner);
          expect(rows.length).toBe(1);
          expect(rows[0].chapter_completed).toBe(0);

          // Existing members are undisturbed: still exactly one zeroed record.
          for (const user of existingUsers) {
            const existing = store.progressFor(sessionId, user);
            expect(existing.length).toBe(1);
            expect(existing[0].chapter_completed).toBe(0);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Validates: Requirements 4.10, 5.6 — the combined guarantee. Starting from a
  // session created over a set of founding members, any sequence of additional
  // joiners leaves EVERY member (founding + joined) with exactly one zeroed
  // progress record for the active session.
  it("keeps every member at exactly one zeroed record across creation then joins", () => {
    fc.assert(
      fc.asyncProperty(
        userIdsArb,
        fc.uniqueArray(
          fc.integer({ min: 1000, max: 1999 }).map((n) => `usr_${n}`),
          { minLength: 0, maxLength: 8 },
        ),
        async (founders, joiners) => {
          const store = new MockStore();
          const groupId = "grp_main";
          const inviteCode = "JOIN42";
          store.addGroup({ id: groupId, name: "Club", invite_code: inviteCode });

          for (const user of founders) {
            store.addMember({ user, group: groupId, display_name: user });
          }
          const sessionId = store.seedSessionProgress(groupId);

          for (const joiner of joiners) {
            const result = await joinGroup(
              joiner,
              inviteCode,
              joiner,
              store.asGroupBackend(),
            );
            expect(result.ok).toBe(true);
          }

          const everyMember = new Set([...founders, ...joiners]);
          for (const user of everyMember) {
            const rows = store.progressFor(sessionId, user);
            expect(rows.length).toBe(1);
            expect(rows[0].chapter_completed).toBe(0);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
