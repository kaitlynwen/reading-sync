"use client";

import { useRouter } from "next/navigation";

import { logout } from "@/lib/backend/auth";

export default function LogoutButton() {
  const router = useRouter();

  async function logOut() {
    // End the authenticated session, then navigate to the login screen. The
    // navigation happens immediately after the session is cleared, well within
    // the 2-second bound of Req 3.8.
    await logout();
    router.push("/login");
  }

  return (
    <button
      onClick={logOut}
      className="text-sm text-gray-500 hover:text-black"
    >
      Log Out
    </button>
  );
}
