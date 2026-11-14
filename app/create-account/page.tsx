"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { createAccount as createAccountBackend } from "@/lib/backend/auth";
import { gateCreateAccount } from "@/lib/backend/validation";
import { normalizeError } from "@/lib/backend/client";

export default function CreateAccountPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");

  async function createAccount() {
    // Client-side gate (Req 3.2–3.4): required fields, single-"@" email, and
    // password/confirmation match are all enforced by the shared validation
    // helper before any request reaches the backend. A failed gate shows the
    // message and performs no backend call.
    const gate = gateCreateAccount(email, password, confirmPassword);
    if (!gate.ok) {
      setMessage(gate.message);
      return;
    }

    try {
      await createAccountBackend(email.trim(), password);
    } catch (err) {
      // On backend rejection (e.g. email already in use, Req 3.5) show the
      // error and retain the entered email and password values in the form.
      setMessage(normalizeError(err).message);
      return;
    }

    setMessage("Account created. You can log in now.");

    setTimeout(() => {
      router.push("/login");
    }, 1000);
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-3xl font-bold">Create Account</h1>

      <input
        type="email"
        placeholder="Email"
        className="w-full max-w-sm rounded-lg border p-3"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <input
        type="password"
        placeholder="Password"
        className="w-full max-w-sm rounded-lg border p-3"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      <input
        type="password"
        placeholder="Confirm password"
        className="w-full max-w-sm rounded-lg border p-3"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
      />

      <button
        onClick={createAccount}
        className="w-full max-w-sm rounded-lg bg-black p-3 text-white"
      >
        Create Account
      </button>

      <p className="text-sm text-gray-600">
        Already have an account?{" "}
        <Link href="/login" className="underline">
          Log in
        </Link>
      </p>

      {message && <p className="max-w-sm text-center text-sm text-red-600">{message}</p>}
    </main>
  );
}
