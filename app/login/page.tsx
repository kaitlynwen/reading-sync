"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { login as loginBackend } from "@/lib/backend/auth";
import { normalizeError } from "@/lib/backend/client";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  async function logIn() {
    // Required-field gate: block the backend call until both fields are filled.
    if (!email.trim() || !password) {
      setMessage("Enter your email and password.");
      return;
    }

    try {
      await loginBackend(email.trim(), password);
    } catch (err) {
      // On a backend rejection of the credentials (Req 3.7) show an
      // authentication error and retain the entered email value in the form.
      setMessage(normalizeError(err).message);
      return;
    }

    router.push("/dashboard");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-3xl font-bold">Log in</h1>

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

      <button
        onClick={logIn}
        className="w-full max-w-sm rounded-lg bg-black p-3 text-white"
      >
        Log in
      </button>

      <p className="text-sm text-gray-600">
        Don&apos;t have an account?{" "}
        <Link href="/create-account" className="underline">
          Create one
        </Link>
      </p>

      {message && <p className="max-w-sm text-center text-sm text-red-600">{message}</p>}
    </main>
  );
}
