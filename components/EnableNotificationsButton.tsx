"use client";

import { useEffect, useState } from "react";

import { currentUser } from "@/lib/backend/auth";
import {
  isSubscribed,
  requestPermission,
  setSubscribed,
} from "@/lib/notifications/service";

// Native-notification control (Req 8.5–8.7).
//
// Replaces the removed OneSignal `EnableNotificationsButton`. It drives the
// client side of the Notification_Service:
//   - Enabling requests native OS permission; on grant the member is recorded
//     as subscribed in `notification_subscriptions` (Req 8.5).
//   - Denied permission surfaces a "notifications unavailable" indication and
//     leaves the member unsubscribed so no notification is ever delivered
//     (Req 8.7).
//   - Disabling clears the subscription so no subsequent notification reaches
//     the member (Req 8.6).
//
// Event evaluation and native delivery live elsewhere (PocketBase hook +
// task 10.2 `deliver()`); this control only toggles permission/subscription.

type Status =
  | "loading" // reading the current subscription state on mount
  | "subscribed" // member is subscribed; notifications on
  | "unsubscribed" // member is not subscribed; notifications off
  | "unavailable" // native permission denied — notifications cannot be used
  | "error"; // a backend operation failed

export default function EnableNotificationsButton() {
  const [status, setStatus] = useState<Status>("loading");
  const [busy, setBusy] = useState(false);

  // Read the member's current subscription state on mount so the control
  // reflects the stored flag (Req 8.6) instead of assuming a default.
  useEffect(() => {
    let cancelled = false;

    async function loadSubscription() {
      const userId = currentUser().userId;
      if (!userId) {
        // No authenticated session — nothing to subscribe. Treat as off.
        if (!cancelled) setStatus("unsubscribed");
        return;
      }
      try {
        const subscribed = await isSubscribed(userId);
        if (!cancelled) setStatus(subscribed ? "subscribed" : "unsubscribed");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    loadSubscription();
    return () => {
      cancelled = true;
    };
  }, []);

  // Enable notifications: request native permission, then record the member as
  // subscribed only if permission is granted (Req 8.5). A denial switches the
  // control to the "notifications unavailable" state and leaves the member
  // unsubscribed (Req 8.7).
  async function enable() {
    const userId = currentUser().userId;
    if (!userId) return;

    setBusy(true);
    try {
      const permission = await requestPermission();
      if (permission !== "granted") {
        setStatus("unavailable");
        return;
      }
      await setSubscribed(userId, true);
      setStatus("subscribed");
    } catch {
      setStatus("error");
    } finally {
      setBusy(false);
    }
  }

  // Disable notifications: clear the subscription so no subsequent native
  // notification is delivered to the member (Req 8.6).
  async function disable() {
    const userId = currentUser().userId;
    if (!userId) return;

    setBusy(true);
    try {
      await setSubscribed(userId, false);
      setStatus("unsubscribed");
    } catch {
      setStatus("error");
    } finally {
      setBusy(false);
    }
  }

  if (status === "loading") {
    return (
      <button
        type="button"
        disabled
        className="rounded-lg border px-4 py-2 text-gray-400"
      >
        Notifications...
      </button>
    );
  }

  // Permission was denied by the OS — notifications are unavailable and cannot
  // be re-enabled from here (Req 8.7).
  if (status === "unavailable") {
    return (
      <span
        role="status"
        className="rounded-lg border px-4 py-2 text-gray-500"
      >
        Notifications unavailable
      </span>
    );
  }

  const isOn = status === "subscribed";

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={isOn ? disable : enable}
        disabled={busy}
        className="rounded-lg border px-4 py-2 disabled:opacity-50"
      >
        {isOn ? "Disable notifications" : "Enable notifications"}
      </button>
      {status === "error" && (
        <span role="alert" className="text-sm text-red-600">
          Could not update notifications. Try again.
        </span>
      )}
    </div>
  );
}
