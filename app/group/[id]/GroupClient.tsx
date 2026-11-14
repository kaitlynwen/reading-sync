"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import LogoutButton from "@/components/LogoutButton";
import { deleteSessionWithProgress } from "@/lib/backend/sessions";
import { currentUser } from "@/lib/backend/auth";
import { updateGoal as updateGoalBackend } from "@/lib/backend/goals";
import {
  subscribeGroup,
  withLoadTimeout,
  LoadTimeoutError,
  type ConnectionStatus,
} from "@/lib/backend/sync";
import {
  groupsCollection,
  progressCollection,
  normalizeError,
  mapGroup,
} from "@/lib/backend/client";
import { validateProgressRange } from "@/lib/backend/progressRange";

import type { Group } from "./types";
import GroupHeader from "./components/GroupHeader";
import CurrentBook from "./components/CurrentBook";
import ProgressList from "./components/ProgressList";
import ReadingGoal from "./components/ReadingGoal";
import AppShell from "@/components/AppShell";
import { BentoCard, PillButton } from "@/components/bento";

export default function GroupClient() {
  const params = useParams();
  const router = useRouter();
  const groupId = params.id as string;

  const [group, setGroup] = useState<Group | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  // Realtime connection status driving the connection-status indicator
  // (Req 7.7, 10.1). `connected`/`stale` are live states; `reconnecting` and
  // `offline` mean realtime updates are currently unavailable and the last
  // loaded state is being retained.
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connected");

  // Set when the last load exceeded the 10s bound and was stopped (Req 10.2),
  // so the screen offers a retry control instead of spinning forever.
  const [loadTimedOut, setLoadTimedOut] = useState(false);

  // Set when the displayed data may no longer match the backend — either a
  // delivered change failed to apply (Req 7.8) or a reload after reconnect
  // failed. The last good state is retained and this flag surfaces a
  // "data may be out of date" indicator.
  const [staleData, setStaleData] = useState(false);

  // Load the group and its members, reading sessions, and per-member progress
  // over the Backend_Client (Req 11.4). This is the single reload invoked both
  // on mount and on any realtime change (Req 7.2–7.4), so delivered state
  // always matches the backend — the same "reload on any change" model the
  // Supabase channels drove previously.
  async function loadGroup() {
    // Resolve the authenticated identity from the Auth_Service (Req 3.9).
    const { userId } = currentUser();

    if (!userId) {
      router.push("/login");
      return;
    }

    setCurrentUserId(userId);

    // Starting a fresh load attempt: clear any prior timed-out marker so the
    // retry control reflects only this attempt (Req 10.2).
    setLoadTimedOut(false);

    try {
      // Fetch the group with its members, sessions, each session's progress,
      // expanded via PocketBase back-relation keys, then map the raw record
      // into the existing `Group` shape (Req 11.4) so the components below need
      // no changes. The load is bounded to 10 seconds: if the backend is
      // unreachable for longer, the attempt is stopped and a retry control is
      // shown instead of spinning indefinitely (Req 10.2).
      const record = await withLoadTimeout(
        groupsCollection().getOne(groupId, {
          expand:
            "group_members_via_group," +
            "reading_sessions_via_group.progress_via_reading_session",
        })
      );

      try {
        // Apply the delivered state to the view. If mapping/applying fails,
        // keep the last good state and flag the view as possibly out of date
        // (Req 7.8) rather than blanking the screen.
        setGroup(mapGroup(record));
        setStaleData(false);
      } catch (applyErr) {
        console.error(normalizeError(applyErr));
        setStaleData(true);
      }
    } catch (err) {
      if (err instanceof LoadTimeoutError) {
        // The load exceeded the 10s bound. Retain any previously loaded state
        // in view and present a retry control (Req 10.2, 10.1).
        setLoadTimedOut(true);
      } else {
        const backendError = normalizeError(err);
        console.error(backendError);

        if (group) {
          // A previously loaded group is retained in view; mark it as possibly
          // stale so the user knows updates may be unavailable (Req 10.1).
          setStaleData(true);
        } else {
          // Nothing loaded yet — surface the not-found/error state.
          setGroup(null);
        }
      }
    }

    setLoading(false);
  }

  useEffect(() => {
    // Initial async data load on mount. `loadGroup` only calls setState after
    // awaiting the backend, so this is the external-system fetch the effect
    // rule is meant to allow, not a synchronous cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadGroup();

    // Subscribe to realtime changes for this group's progress, reading
    // sessions, and members (Req 7.1). Every delivered change reloads the group
    // so the view re-syncs to the backend (Req 7.2–7.4), preserving the former
    // reload-on-any-change model. The connection-status handler is wired here
    // for task 9.2; task 9.1 only establishes the subscriptions and lifecycle.
    const subscription = subscribeGroup(groupId, {
      onProgressChange: () => loadGroup(),
      onSessionChange: () => loadGroup(),
      onMemberChange: () => loadGroup(),
      // Surface connection transitions so the screen can show a
      // connection-status indicator and retain the last loaded state
      // (Req 7.7, 10.1).
      onStatus: (status) => setConnectionStatus(status),
      // On reconnect after an interruption, reload so the view re-syncs to the
      // latest backend state within 5 seconds (Req 7.6, 10.4).
      onReconnect: () => loadGroup(),
    });

    // On unmount, tear down every subscription within 2 seconds (Req 7.5).
    return () => {
      void subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, router]);

  const currentSession = group?.reading_sessions.find(
    (session) => session.is_active
  );

  function getMemberProgress(userId: string) {
    if (!currentSession) return 0;

    const row = currentSession.progress.find(
      (progress) => progress.user_id === userId
    );

    return row?.chapter_completed ?? 0;
  }

  // Update the current member's completed count (Req 6.1, 6.2, 6.3) over the
  // Backend_Client. The submitted value is first screened against the
  // [0, total] integer rule shared with the PocketBase hook (task 4.5/4.2): an
  // out-of-range or non-integer value is rejected locally, the existing count
  // is retained, and an out-of-range message is shown — so the UI matches the
  // backend decision without a round-trip. An in-range value (including a lower
  // one, Req 6.3) is written to the member's progress record.
  async function setProgress(value: number) {
    if (!currentSession || !currentUserId) return;

    const currentProgress = getMemberProgress(currentUserId);

    // Mirror the backend hook's range decision (Req 6.2, 11.6): reject
    // out-of-range / non-integer submissions and retain the existing value.
    const result = validateProgressRange(
      currentSession.total_chapters,
      currentProgress,
      value
    );

    if (!result.accepted) {
      setMessage(
        `Progress must be a whole number between 0 and ${currentSession.total_chapters}.`
      );
      return;
    }

    // No-op when the value is unchanged: avoid a needless write.
    if (result.stored === currentProgress) {
      setMessage("");
      return;
    }

    try {
      // At most one progress record exists per member per session (unique
      // index on `(reading_session, user)`, Req 11.7). Find it and update the
      // completed count; seed a zeroed-then-updated record if one is somehow
      // missing (e.g. a member who predates the active session, Req 4.10).
      const existing = await progressCollection()
        .getFirstListItem(
          `reading_session = "${currentSession.id}" && user = "${currentUserId}"`
        )
        .catch((lookupErr) => {
          if (normalizeError(lookupErr).kind === "not_found") {
            return null;
          }
          throw lookupErr;
        });

      if (existing) {
        await progressCollection().update(existing.id, {
          chapter_completed: result.stored,
        });
      } else {
        await progressCollection().create({
          reading_session: currentSession.id,
          user: currentUserId,
          chapter_completed: result.stored,
        });
      }
    } catch (err) {
      const backendError = normalizeError(err);

      if (backendError.kind === "network") {
        // The backend was unreachable: the change was NOT saved. Show a
        // "not saved" message, do not report success, and retain the member's
        // submitted input — the stored progress state is left untouched so the
        // stepper keeps showing what the user entered (Req 10.3).
        setMessage("Not saved — the backend is unreachable. Try again.");
        return;
      }

      // On any other backend rejection (including the hook's out-of-range
      // error) the stored value is left unchanged; surface the message and
      // retain state.
      setMessage(backendError.message || "Could not save progress.");
      return;
    }

    setMessage("");
    await loadGroup();
  }

  // Store the active session's goal configuration (Req 6.5, 6.6) over the
  // Backend_Client. Goal updates require an authenticated member: without a
  // session the request is rejected and the existing goal config is retained
  // (Req 6.6). The backend also enforces this via its auth rules.
  async function updateGoal(
    goalType: string,
    goalAmount: number | null,
    goalUnit: string | null
  ) {
    if (!currentSession) return;

    // Delegate to the goal-update orchestration (Req 6.5, 6.6): it gates on the
    // authenticated identity first (rejecting an unauthenticated requester and
    // retaining the existing configuration, Req 6.6) before writing the new
    // goal via the Backend_Client.
    const result = await updateGoalBackend(
      currentSession.id,
      goalType,
      goalAmount,
      goalUnit
    );

    if (!result.ok) {
      setMessage(result.message);
      return;
    }

    setMessage("");
    await loadGroup();
  }

  async function completeNextChapter() {
    if (!currentSession || !currentUserId) return;

    const currentProgress = getMemberProgress(currentUserId);

    if (currentProgress >= currentSession.total_chapters) {
      setMessage("You already finished the book.");
      return;
    }

    await setProgress(currentProgress + 1);
  }

  async function undoLastChapter() {
    if (!currentSession || !currentUserId) return;

    const currentProgress = getMemberProgress(currentUserId);

    if (currentProgress <= 0) {
      setMessage("You are already at 0.");
      return;
    }

    await setProgress(currentProgress - 1);
  }

  async function deleteCurrentBook() {
    if (!currentSession) return;

    const confirmed = window.confirm(
      "Delete this book and all progress? This cannot be undone."
    );

    if (!confirmed) return;

    try {
      // Deleting the active session also deletes its progress records (Req 5.9).
      // Remove the per-member progress rows first, then the session itself, via
      // the Backend_Client collection accessors.
      await deleteSessionWithProgress(currentSession.id);
    } catch (err) {
      const backendError = normalizeError(err);
      console.error(backendError);

      if (backendError.kind === "network") {
        // Backend unreachable: the delete was NOT saved. Report "not saved"
        // and do not claim success (Req 10.3).
        setMessage("Not saved — the backend is unreachable. Try again.");
        return;
      }

      setMessage(backendError.message || "Could not delete the book.");
      return;
    }

    setMessage("");
    await loadGroup();
  }

  // realtime updates are unavailable while the connection is down or has not
  // been re-established within the bound (Req 7.7, 10.1).
  const realtimeUnavailable =
    connectionStatus === "offline" || connectionStatus === "reconnecting";

  if (loading) {
    return (
      <AppShell header={<GroupTopBar />}>
        <div className="flex flex-col gap-4">
          <p className="font-sans text-text-secondary">Loading...</p>

          {/* A load that exceeded the 10s bound was stopped; offer a retry
              control so the member can reinitiate it (Req 10.2). */}
          {loadTimedOut && (
            <BentoCard
              role="alert"
              accent="butter"
              className="flex flex-col items-start gap-3"
            >
              <p className="font-sans text-sm text-text-primary">
                Loading is taking longer than expected.
              </p>
              <PillButton onClick={() => loadGroup()}>Retry</PillButton>
            </BentoCard>
          )}
        </div>
      </AppShell>
    );
  }

  if (!group) {
    return (
      <AppShell header={<GroupTopBar />}>
        <div className="flex flex-col items-start gap-4">
          <p className="font-sans text-text-secondary">Group not found.</p>

          {/* A stopped load (10s+ bound) retains any previously loaded state;
              with no prior state, present a retry control (Req 10.2, 10.1). */}
          {loadTimedOut && (
            <PillButton onClick={() => loadGroup()}>Retry</PillButton>
          )}
        </div>
      </AppShell>
    );
  }

  const myProgress = currentUserId ? getMemberProgress(currentUserId) : 0;

  return (
    <AppShell header={<GroupTopBar />}>
      {/* Bento-grid Group Reading Room: the hero CurrentBook card spans the
          full row, with the goal + per-member list beside it on wider
          viewports. Gaps use the steering grid rhythm token (Req 13.1, 13.8).
          AppShell owns the responsive rail widths and the 1440px content cap. */}
      <div
        className="grid grid-cols-1 lg:grid-cols-3"
        style={{ gap: "var(--space-grid-gap-max)" }}
      >
        <div className="flex flex-col lg:col-span-2" style={{ gap: "var(--space-grid-gap-max)" }}>
          {/* Connection-status indicator: realtime updates are unavailable
              while the connection is down or not re-established within 10s. The
              last successfully loaded state stays on screen (Req 7.7, 10.1). */}
          {realtimeUnavailable && (
            <BentoCard role="status" accent="butter" padding="compact">
              <p className="font-sans text-sm text-text-primary">
                {connectionStatus === "offline"
                  ? "Realtime updates are unavailable. Showing the last loaded data."
                  : "Reconnecting… showing the last loaded data."}
              </p>
            </BentoCard>
          )}

          {/* "Data may be out of date" indicator: a delivered change or reload
              failed to apply, so the last good state is retained (Req 7.8). */}
          {staleData && !realtimeUnavailable && (
            <BentoCard role="status" accent="butter" padding="compact">
              <p className="font-sans text-sm text-text-primary">
                The displayed data may be out of date.
              </p>
            </BentoCard>
          )}

          <GroupHeader
            name={group.name}
            inviteCode={group.invite_code}
            onCopyInvite={() => {
              navigator.clipboard.writeText(group.invite_code);
            }}
          />

          <CurrentBook
            groupId={group.id}
            members={group.group_members}
            currentSession={currentSession}
            myProgress={myProgress}
            message={message}
            getMemberProgress={getMemberProgress}
            onCompleteChapter={completeNextChapter}
            onUndoChapter={undoLastChapter}
            onSetProgress={setProgress}
            onDeleteBook={deleteCurrentBook}
          />
        </div>

        <div className="flex flex-col" style={{ gap: "var(--space-grid-gap-max)" }}>
          <ReadingGoal
            currentSession={currentSession}
            myProgress={myProgress}
            onUpdateGoal={updateGoal}
          />

          <ProgressList
            members={group.group_members}
            currentSession={currentSession}
            getMemberProgress={getMemberProgress}
          />
        </div>
      </div>
    </AppShell>
  );
}

/**
 * Top-bar content for the Group Reading Room, hosted inside the AppShell header
 * (which owns titlebar safe-area padding and drag regions, Req 13.8, 15). The
 * back link and logout control are the interactive chrome of the screen; their
 * existing behavior is preserved (Req 13.7).
 */
function GroupTopBar() {
  return (
    <div className="flex w-full items-center justify-between">
      <Link
        href="/dashboard"
        className="inline-flex font-sans text-sm text-text-secondary transition-colors hover:text-text-primary"
      >
        ← All Groups
      </Link>

      <LogoutButton />
    </div>
  );
}
