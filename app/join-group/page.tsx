"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { currentUser } from "@/lib/backend/auth";
import { gateJoinGroup } from "@/lib/backend/validation";
import { joinGroup as joinGroupOp } from "@/lib/backend/groups";

export default function JoinGroupPage() {
  // Gate joining a group behind an authenticated session (Req 3.9).
  return (
    <AuthGuard>
      <JoinGroup />
    </AuthGuard>
  );
}

function JoinGroup() {
  const router = useRouter();

  const [inviteCode, setInviteCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState("");

  async function joinGroup() {
    // Client-side gate (Req 4.7): block submission when the trimmed invite code
    // or display name is empty, without a backend round-trip.
    const gate = gateJoinGroup(inviteCode, displayName);
    if (!gate.ok) {
      setMessage(gate.message);
      return;
    }

    setMessage("Joining group...");

    // Resolve the authenticated identity from the Auth_Service (Req 4.6).
    const { userId } = currentUser();
    if (!userId) {
      setMessage("You need to be logged in first.");
      return;
    }

    // Join via the orchestration helper. It looks up the group by code (no
    // match → message, Req 4.8), avoids a duplicate membership while still
    // navigating when already a member (Req 4.9), adds membership otherwise
    // (Req 4.6), and seeds a zeroed progress record when a session is active
    // (Req 4.10). On success navigate; on failure show the message.
    const result = await joinGroupOp(userId, inviteCode, displayName);
    if (result.ok) {
      router.push(`/group/${result.groupId}`);
    } else {
      setMessage(result.message);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <Link
          href="/dashboard"
          className="mb-6 inline-flex text-sm text-gray-500 hover:text-black"
        >
          ← Dashboard
        </Link>

        <div className="flex flex-col gap-4">
          <h1 className="text-3xl font-bold">Join Group</h1>

          <input
            placeholder="Invite code"
            className="w-full rounded-lg border p-3 uppercase"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
          />

          <input
            placeholder="Your display name"
            className="w-full rounded-lg border p-3"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />

          <button
            onClick={joinGroup}
            className="w-full rounded-lg bg-black p-3 text-white"
          >
            Join Group
          </button>

          {message && (
            <p className="text-center text-sm text-red-600">{message}</p>
          )}
        </div>
      </div>
    </main>
  );
}
