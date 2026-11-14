"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import LogoutButton from "@/components/LogoutButton";
import EnableNotificationsButton from "@/components/EnableNotificationsButton";
import { currentUser } from "@/lib/backend/auth";
import {
  groupMembersCollection,
  groupsCollection,
  normalizeError,
  type GroupRecord,
  type ReadingSessionRecord,
} from "@/lib/backend/client";

type ProgressRow = {
  user_id: string;
  chapter_completed: number;
};

type ReadingSession = {
  id: string;
  book_title: string;
  total_chapters: number;
  progress_type: string;
  is_active: boolean;
  progress: ProgressRow[];
};

type GroupCard = {
  groupId: string;
  name: string;
  inviteCode: string;
  isOwner: boolean;
  readingSessions: ReadingSession[];
};

export default function DashboardPage() {
  // Restrict the dashboard to an authenticated session, routing to /login
  // otherwise (Req 3.9).
  return (
    <AuthGuard>
      <Dashboard />
    </AuthGuard>
  );
}

function Dashboard() {
  const router = useRouter();

  const [groups, setGroups] = useState<GroupCard[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    /**
     * Treat the earliest-created member of a group as its owner. The creator is
     * recorded as the first member when the group is created, so the first
     * `group_members` row (by creation time) identifies the owner in the
     * absence of a dedicated `created_by` field.
     */
    async function isGroupOwner(groupId: string, userId: string) {
      try {
        const firstMember = await groupMembersCollection().getFirstListItem(
          `group = "${groupId}"`,
          { sort: "created" }
        );
        return firstMember.user === userId;
      } catch {
        return false;
      }
    }

    async function loadGroups() {
      // Resolve the authenticated identity from the Auth_Service (Req 3.9).
      const { userId } = currentUser();

      if (!userId) {
        router.push("/login");
        return;
      }

      setCurrentUserId(userId);

      try {
        // The groups a user belongs to are their `group_members` rows; expand
        // each row's `group` and that group's reading sessions + progress so
        // the dashboard can show the active book and personal progress.
        const memberships = await groupMembersCollection().getFullList({
          filter: `user = "${userId}"`,
          expand: `group.reading_sessions_via_group.progress_via_reading_session`,
        });

        const cards: GroupCard[] = [];

        for (const membership of memberships) {
          const group = membership.expand?.group as GroupRecord | undefined;
          if (!group) continue;

          const sessionRecords =
            (group.expand?.reading_sessions_via_group as
              | ReadingSessionRecord[]
              | undefined) ?? [];

          const readingSessions: ReadingSession[] = sessionRecords.map(
            (session) => {
              const progressRecords =
                (session.expand?.progress_via_reading_session as
                  | { user: string; chapter_completed: number }[]
                  | undefined) ?? [];

              return {
                id: session.id,
                book_title: session.book_title,
                total_chapters: session.total_chapters,
                progress_type: session.progress_type,
                is_active: session.is_active,
                progress: progressRecords.map((row) => ({
                  user_id: row.user,
                  chapter_completed: row.chapter_completed,
                })),
              };
            }
          );

          // Ownership is the earliest member of the group — the creator, who is
          // added first at group creation (the `created_by` column is dropped
          // in the PocketBase schema). Derive it from the group's members
          // ordered by creation time.
          const isOwner = await isGroupOwner(group.id, userId);

          cards.push({
            groupId: group.id,
            name: group.name,
            inviteCode: group.invite_code,
            isOwner,
            readingSessions,
          });
        }

        setGroups(cards);
      } catch (err) {
        console.error(normalizeError(err));
      }

      setLoading(false);
    }

    loadGroups();
  }, [router]);

  async function deleteGroup(groupId: string) {
    const confirmed = window.confirm(
      "Delete this group permanently? This will remove the book, all members, and everyone's progress. This cannot be undone."
    );

    if (!confirmed) return;

    try {
      await groupsCollection().delete(groupId);
    } catch (err) {
      const backendError = normalizeError(err);
      console.error(backendError);
      alert(backendError.message);
      return;
    }

    setGroups((prev) => prev.filter((card) => card.groupId !== groupId));
  }

  async function leaveGroup(groupId: string) {
    if (!currentUserId) return;

    const confirmed = window.confirm("Leave this group?");
    if (!confirmed) return;

    try {
      // Find this user's membership row for the group and delete it.
      const membership = await groupMembersCollection().getFirstListItem(
        `group = "${groupId}" && user = "${currentUserId}"`
      );
      await groupMembersCollection().delete(membership.id);
    } catch (err) {
      const backendError = normalizeError(err);
      console.error(backendError);
      alert(backendError.message);
      return;
    }

    setGroups((prev) => prev.filter((card) => card.groupId !== groupId));
  }

  function getActiveSession(card: GroupCard) {
    return card.readingSessions.find((session) => session.is_active);
  }

  function getMyProgress(session: ReadingSession | undefined) {
    if (!session || !currentUserId) return 0;

    return (
      session.progress.find((row) => row.user_id === currentUserId)
        ?.chapter_completed ?? 0
    );
  }

  return (
    <main className="min-h-screen p-6">
      <div className="mx-auto max-w-xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-3xl font-bold">All Groups</h1>
          <LogoutButton />
        </div>

        <div className="mb-6 flex gap-3">
          <Link
            href="/create-group"
            className="rounded-lg bg-black px-4 py-2 text-white"
          >
            Create Group
          </Link>

          <Link href="/join-group" className="rounded-lg border px-4 py-2">
            Join Group
          </Link>

          <EnableNotificationsButton />
        </div>

        <section>
          {loading ? (
            <p className="text-gray-600">Loading groups...</p>
          ) : groups.length > 0 ? (
            <div className="divide-y">
              {groups.map((card) => {
                const session = getActiveSession(card);
                const myProgress = getMyProgress(session);
                const percent = session
                  ? (myProgress / session.total_chapters) * 100
                  : 0;

                return (
                  <div key={card.groupId} className="py-5">
                    <Link href={`/group/${card.groupId}`} className="block">
                      <h2 className="text-xl font-semibold">{card.name}</h2>

                      {session ? (
                        <div className="mt-3">
                          <p className="font-medium">📖 {session.book_title}</p>

                          <div className="mt-3 h-2 rounded-full bg-gray-200">
                            <div
                              className="h-2 rounded-full bg-black"
                              style={{ width: `${percent}%` }}
                            />
                          </div>

                          <p className="mt-2 text-sm text-gray-600">
                            Your progress: {myProgress} /{" "}
                            {session.total_chapters}
                          </p>
                        </div>
                      ) : (
                        <p className="mt-2 text-sm text-gray-600">
                          No active book
                        </p>
                      )}
                    </Link>

                    {card.isOwner ? (
                      <button
                        onClick={() => deleteGroup(card.groupId)}
                        className="mt-3 text-sm text-red-600 underline"
                      >
                        Delete Group
                      </button>
                    ) : (
                      <button
                        onClick={() => leaveGroup(card.groupId)}
                        className="mt-3 text-sm text-gray-500 underline"
                      >
                        Leave Group
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-gray-600">No groups yet.</p>
          )}
        </section>
      </div>
    </main>
  );
}
