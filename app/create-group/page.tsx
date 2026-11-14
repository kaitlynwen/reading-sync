"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { currentUser } from "@/lib/backend/auth";
import { gateCreateGroup } from "@/lib/backend/validation";
import { createGroup as createGroupOp } from "@/lib/backend/groups";

export default function CreateGroupPage() {
  // Gate group creation behind an authenticated session (Req 3.9).
  return (
    <AuthGuard>
      <CreateGroup />
    </AuthGuard>
  );
}

function CreateGroup() {
  const router = useRouter();

  const [groupName, setGroupName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState("");

  async function createGroup() {
    // Client-side gate (Req 4.4): block submission when the trimmed group name
    // or display name is empty, without a backend round-trip.
    const gate = gateCreateGroup(groupName, displayName);
    if (!gate.ok) {
      setMessage(gate.message);
      return;
    }

    setMessage("Creating group...");

    // Resolve the authenticated identity from the Auth_Service (Req 4.1). An
    // absent session should not normally reach here (AuthGuard gates the
    // screen), but guard defensively and surface a message rather than throw.
    const { userId } = currentUser();
    if (!userId) {
      setMessage("You need to be logged in first.");
      return;
    }

    // Create the group + creator membership via the orchestration helper. The
    // invite code is backend-generated (Req 4.2); on success navigate to the
    // group (Req 4.5), on failure show the error and do not navigate (Req 4.3).
    const result = await createGroupOp(userId, groupName, displayName);
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
          <h1 className="text-3xl font-bold">Create Group</h1>

          <input
            placeholder="Group name"
            className="w-full rounded-lg border p-3"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
          />

          <input
            placeholder="Your display name"
            className="w-full rounded-lg border p-3"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />

          <button
            onClick={createGroup}
            className="w-full rounded-lg bg-black p-3 text-white"
          >
            Create Group
          </button>

          {message && (
            <p className="text-center text-sm text-red-600">{message}</p>
          )}
        </div>
      </div>
    </main>
  );
}
