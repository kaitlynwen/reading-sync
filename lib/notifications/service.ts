// lib/notifications/service.ts
//
// Notification_Service — native desktop notification permission and subscription
// handling over Tauri's notification plugin (`@tauri-apps/plugin-notification`)
// and the `notification_subscriptions` collection (Req 8.5–8.7).
//
// This module replaces the removed OneSignal integration (`OneSignalProvider`,
// the old `EnableNotificationsButton`, the `/api/notifications/progress` route,
// and the web service worker). The *event evaluation* (fire-once semantics for
// Weekly_Goal_Event / Group_Ready_Event) lives in a PocketBase hook on the
// `progress` collection, not here; this client module is responsible only for:
//
//   - requesting native OS notification permission (Req 8.5, 8.7),
//   - recording a member as subscribed / unsubscribed in
//     `notification_subscriptions` (Req 8.5, 8.6),
//   - reading back whether a member is currently subscribed.
//
// Native delivery (`deliver()`, Req 8.3, 8.4, 8.8) IS implemented here: it turns
// a backend-evaluated event into a native OS notification, retrying at most 3
// times and reporting non-receipt (so the member can be recorded as
// not-received) when every attempt fails. The decision of *when* an event fires
// (the fire-once Weekly_Goal_Event / Group_Ready_Event evaluation) stays in the
// PocketBase hook on the `progress` collection, not here.

import {
  isPermissionGranted,
  requestPermission as requestNativePermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

import {
  normalizeError,
  notificationSubscriptionsCollection,
  type NotificationSubscriptionRecord,
} from "@/lib/backend/client";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The native-notification events the service delivers. Declared here so the
 * delivery signature stays anchored to the design (`Notification_Service`
 * interface).
 *
 * - `weekly_goal`: names the member who reached the goal and the goal amount
 *   (Req 8.3).
 * - `group_ready`: names the book title and the next unit the group is ready
 *   for (Req 8.4).
 */
export type NotifEvent =
  | { kind: "weekly_goal"; member: string; goalLabel: string }
  | { kind: "group_ready"; bookTitle: string; nextUnitLabel: string };

/**
 * The outcome of a native permission request (Req 8.5, 8.7). The Tauri plugin
 * can also return an intermediate `"default"` (not yet decided) and, on some
 * platforms, `"prompt"`/`"prompt-with-rationale"`; anything other than an
 * explicit grant is normalized to `"denied"` so callers only branch on a binary
 * granted/denied decision.
 */
export type PermissionResult = "granted" | "denied";

// ---------------------------------------------------------------------------
// Permission (Req 8.5, 8.7)
// ---------------------------------------------------------------------------

/**
 * Request native OS notification permission through the Desktop_Shell (Req 8.5).
 *
 * If permission is already granted, the current grant is returned without
 * re-prompting. Otherwise the native permission dialog is shown and its result
 * is normalized to a binary decision: an explicit grant yields `"granted"`;
 * every other outcome (denied, dismissed, still-default) yields `"denied"` so
 * the caller treats anything short of a grant as "notifications unavailable"
 * and never attempts delivery (Req 8.7).
 */
export async function requestPermission(): Promise<PermissionResult> {
  // Already granted on a previous run — no need to prompt again.
  if (await isPermissionGranted()) {
    return "granted";
  }
  const result = await requestNativePermission();
  return result === "granted" ? "granted" : "denied";
}

// ---------------------------------------------------------------------------
// Subscription state (Req 8.5, 8.6)
// ---------------------------------------------------------------------------

/**
 * Record whether a member is subscribed to native notifications in the
 * `notification_subscriptions` collection (Req 8.5, 8.6).
 *
 * The collection holds at most one row per user (a `subscribed` flag). This
 * upserts that row: it updates the existing subscription record when one is
 * present, or creates it on first use. Enabling (`subscribed = true`) is only
 * reached after permission has been granted (the control gates on
 * {@link requestPermission}); disabling (`subscribed = false`) clears the
 * subscription so no subsequent Native_Notification is delivered to that member
 * (Req 8.6).
 *
 * Backend failures surface as a normalized {@link BackendError} so the calling
 * control can show an error while leaving the toggle in a consistent state.
 */
export async function setSubscribed(
  userId: string,
  subscribed: boolean
): Promise<void> {
  try {
    const collection = notificationSubscriptionsCollection();
    const existing = await findSubscription(userId);
    if (existing) {
      await collection.update(existing.id, { subscribed });
    } else {
      await collection.create({ user: userId, subscribed });
    }
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * Report whether a member is currently subscribed to native notifications
 * (Req 8.6). Returns `false` when no subscription record exists for the user
 * (the default, unsubscribed state) and reflects the stored flag otherwise.
 *
 * Delivery code consults this before attempting any native notification: an
 * unsubscribed member is never delivered to (Req 8.6, and the denied-permission
 * path of Req 8.7, which leaves the member unsubscribed).
 */
export async function isSubscribed(userId: string): Promise<boolean> {
  try {
    const existing = await findSubscription(userId);
    return existing?.subscribed === true;
  } catch (err) {
    throw normalizeError(err);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Fetch the single `notification_subscriptions` record for a user, or `null`
 * when none exists. The collection carries at most one row per user, so the
 * first match (if any) is authoritative. A `not_found` result is treated as
 * "no subscription" rather than an error.
 */
async function findSubscription(
  userId: string
): Promise<NotificationSubscriptionRecord | null> {
  const collection = notificationSubscriptionsCollection();
  try {
    return await collection.getFirstListItem(
      `user = ${JSON.stringify(userId)}`
    );
  } catch (err) {
    if (isNotFound(err)) {
      return null;
    }
    throw err;
  }
}

/**
 * Detect the PocketBase "no matching record" response (HTTP 404), which
 * `getFirstListItem` throws when the filter matches nothing. Checked
 * structurally so the module stays decoupled from importing the SDK's error
 * class directly (the Backend_Client owns that import).
 */
function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    (err as { status?: unknown }).status === 404
  );
}

// ---------------------------------------------------------------------------
// Native delivery (Req 8.3, 8.4, 8.8)
// ---------------------------------------------------------------------------

/** The flat `{ title, body }` content shown in a native OS notification. */
export interface NotificationContent {
  title: string;
  body: string;
}

/** Shared heading for every Reading Sync native notification. */
const NOTIFICATION_TITLE = "Reading Sync";

/**
 * The most times {@link deliver} attempts a native notification before giving
 * up: the first try plus at most 3 retries (Req 8.8). A notification that never
 * succeeds within this bound is reported as not-received rather than retried
 * forever.
 */
export const MAX_DELIVERY_ATTEMPTS = 4; // 1 initial + 3 retries

/**
 * Build the native-notification content for an event, ensuring every event
 * carries the identifying information the requirements call for:
 *
 *   - `weekly_goal` names the member and the goal they reached (Req 8.3), e.g.
 *     "Ada reached the goal: Chapter 12."
 *   - `group_ready` names the book title and the next unit the group is ready
 *     for (Req 8.4), e.g. "Everyone is ready for chapter 5 in Dune."
 *
 * Kept pure (no I/O) so content completeness is unit/property-testable without
 * touching the OS notification plugin.
 */
export function buildNotificationContent(
  event: NotifEvent
): NotificationContent {
  if (event.kind === "weekly_goal") {
    return {
      title: NOTIFICATION_TITLE,
      body: `${event.member} reached the goal: ${event.goalLabel}.`,
    };
  }
  return {
    title: NOTIFICATION_TITLE,
    body: `Everyone is ready for ${event.nextUnitLabel} in ${event.bookTitle}.`,
  };
}

/**
 * Deliver a native OS notification for a backend-evaluated event (Req 8.3, 8.4),
 * retrying on failure up to the {@link MAX_DELIVERY_ATTEMPTS} bound (at most 3
 * retries, Req 8.8).
 *
 * The caller is responsible for the fire-once decision (the PocketBase hook) and
 * for the permission/subscription gate ({@link isSubscribed} /
 * {@link requestPermission}); `deliver` assumes the event should be shown and
 * focuses solely on getting it in front of the user.
 *
 * Returns `true` as soon as a native notification is dispatched, and `false`
 * when every attempt within the bound fails — the signal the caller uses to
 * record the member as not having received that notification (Req 8.8). Never
 * throws: a delivery problem is surfaced as a `false` result, not an exception.
 *
 * `sendNotification` from the Tauri plugin is synchronous and returns `void`;
 * each attempt is treated as successful unless it throws, in which case the next
 * retry is attempted until the bound is reached.
 */
export async function deliver(event: NotifEvent): Promise<boolean> {
  const content = buildNotificationContent(event);

  for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt++) {
    try {
      sendNotification({ title: content.title, body: content.body });
      return true;
    } catch {
      // Swallow and retry; the final failure falls through to the not-received
      // result below. No delay is introduced so delivery stays well within the
      // 10-second bound (Req 8.3, 8.4) even across the full retry budget.
      if (attempt >= MAX_DELIVERY_ATTEMPTS) {
        return false;
      }
    }
  }

  // Unreachable in practice (the loop returns on success or on the final
  // attempt), but keeps the function total.
  return false;
}
