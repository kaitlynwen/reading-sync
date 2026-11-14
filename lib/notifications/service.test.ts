import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as service from "./service";

/*
 * Unit tests for Notification_Service permission + subscription handling
 * (Req 8.5–8.7).
 *
 * Two native layers are mocked:
 *   - `@tauri-apps/plugin-notification` — the OS permission API. In a plain Node
 *     test environment the native plugin is unavailable, so `isPermissionGranted`
 *     and `requestPermission` are controllable mocks that let us drive the
 *     granted / denied branches (Req 8.5, 8.7).
 *   - the `notification_subscriptions` collection — mocked through the
 *     Backend_Client accessor with an in-memory single-row-per-user store that
 *     mirrors PocketBase's `getFirstListItem` (throws a 404 when absent),
 *     `create`, and `update` semantics. This exercises the upsert that records a
 *     member as subscribed / unsubscribed (Req 8.5, 8.6).
 */

// --- Native permission plugin mock -----------------------------------------
const permissionGranted = vi.fn(() => Promise.resolve(false));
const requestNative = vi.fn(() => Promise.resolve("denied"));
// `sendNotification` is synchronous (returns void) in the Tauri plugin; the
// delivery tests (Req 8.3, 8.4, 8.8) drive its success/throw behavior here.
const sendNative = vi.fn<(options: { title: string; body?: string }) => void>();

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: () => permissionGranted(),
  requestPermission: () => requestNative(),
  sendNotification: (options: { title: string; body?: string }) =>
    sendNative(options),
}));

// --- notification_subscriptions collection mock ----------------------------
type SubRow = { id: string; user: string; subscribed: boolean };

// In-memory backing: at most one row per user, matching the collection's
// single-subscription-per-user shape.
const rows = new Map<string, SubRow>();
let nextId = 1;

class NotFoundError extends Error {
  status = 404;
}

const collection = {
  async getFirstListItem(filter: string): Promise<SubRow> {
    // The service builds the filter as `user = "<id>"`; extract the quoted id.
    const match = filter.match(/"(.*)"/);
    const userId = match ? JSON.parse(`"${match[1]}"`) : "";
    const row = rows.get(userId);
    if (!row) throw new NotFoundError("no rows");
    return row;
  },
  async create(data: { user: string; subscribed: boolean }): Promise<SubRow> {
    const row: SubRow = { id: `sub${nextId++}`, ...data };
    rows.set(data.user, row);
    return row;
  },
  async update(id: string, data: { subscribed: boolean }): Promise<SubRow> {
    for (const row of rows.values()) {
      if (row.id === id) {
        row.subscribed = data.subscribed;
        return row;
      }
    }
    throw new NotFoundError("no such id");
  },
};

vi.mock("@/lib/backend/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/backend/client")>(
    "@/lib/backend/client"
  );
  return {
    ...actual,
    notificationSubscriptionsCollection: () => collection,
  };
});

import {
  buildNotificationContent,
  deliver,
  isSubscribed,
  MAX_DELIVERY_ATTEMPTS,
  requestPermission,
  setSubscribed,
  type NotifEvent,
} from "./service";

beforeEach(() => {
  rows.clear();
  nextId = 1;
  permissionGranted.mockReset();
  requestNative.mockReset();
  sendNative.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("requestPermission (Req 8.5, 8.7)", () => {
  it("returns granted without prompting when permission is already granted", async () => {
    permissionGranted.mockResolvedValue(true);

    const result = await requestPermission();

    expect(result).toBe("granted");
    expect(requestNative).not.toHaveBeenCalled();
  });

  it("returns granted when the native prompt grants permission", async () => {
    permissionGranted.mockResolvedValue(false);
    requestNative.mockResolvedValue("granted");

    const result = await requestPermission();

    expect(result).toBe("granted");
    expect(requestNative).toHaveBeenCalledOnce();
  });

  it("normalizes a denied prompt to denied (Req 8.7)", async () => {
    permissionGranted.mockResolvedValue(false);
    requestNative.mockResolvedValue("denied");

    expect(await requestPermission()).toBe("denied");
  });

  it("normalizes any non-granted outcome to denied", async () => {
    permissionGranted.mockResolvedValue(false);
    requestNative.mockResolvedValue("default");

    expect(await requestPermission()).toBe("denied");
  });
});

describe("setSubscribed / isSubscribed (Req 8.5, 8.6)", () => {
  it("defaults to not subscribed when no record exists", async () => {
    expect(await isSubscribed("user1")).toBe(false);
  });

  it("creates a subscription record on first enable and reads it back", async () => {
    await setSubscribed("user1", true);

    expect(await isSubscribed("user1")).toBe(true);
    expect(rows.size).toBe(1);
  });

  it("clears the subscription on disable so the member reads as unsubscribed (Req 8.6)", async () => {
    await setSubscribed("user1", true);
    await setSubscribed("user1", false);

    expect(await isSubscribed("user1")).toBe(false);
    // Still a single row — the existing record is updated, not duplicated.
    expect(rows.size).toBe(1);
  });

  it("updates the existing record instead of creating a duplicate", async () => {
    await setSubscribed("user1", true);
    await setSubscribed("user1", true);

    expect(rows.size).toBe(1);
    expect(await isSubscribed("user1")).toBe(true);
  });

  it("tracks subscriptions independently per user", async () => {
    await setSubscribed("user1", true);

    expect(await isSubscribed("user1")).toBe(true);
    expect(await isSubscribed("user2")).toBe(false);
  });
});

describe("buildNotificationContent (Req 8.3, 8.4)", () => {
  it("names the member and the goal for a weekly_goal event (Req 8.3)", () => {
    const event: NotifEvent = {
      kind: "weekly_goal",
      member: "Ada",
      goalLabel: "Chapter 12",
    };

    const content = buildNotificationContent(event);

    // Content must identify both the member and the goal they reached.
    expect(content.body).toContain("Ada");
    expect(content.body).toContain("Chapter 12");
    expect(content.title).not.toBe("");
  });

  it("names the book title and next unit for a group_ready event (Req 8.4)", () => {
    const event: NotifEvent = {
      kind: "group_ready",
      bookTitle: "Dune",
      nextUnitLabel: "chapter 5",
    };

    const content = buildNotificationContent(event);

    // Content must identify both the book and the next unit the group is ready for.
    expect(content.body).toContain("Dune");
    expect(content.body).toContain("chapter 5");
    expect(content.title).not.toBe("");
  });
});

describe("deliver (Req 8.3, 8.4, 8.8)", () => {
  const WEEKLY: NotifEvent = {
    kind: "weekly_goal",
    member: "Ada",
    goalLabel: "Chapter 12",
  };

  it("dispatches a single native notification on first success", async () => {
    sendNative.mockImplementation(() => {});

    const received = await deliver(WEEKLY);

    expect(received).toBe(true);
    expect(sendNative).toHaveBeenCalledOnce();
    // The dispatched content carries the identifying body (Req 8.3).
    const options = sendNative.mock.calls[0][0];
    expect(options.body).toContain("Ada");
    expect(options.body).toContain("Chapter 12");
  });

  it("retries after a failure and reports receipt once an attempt succeeds (Req 8.8)", async () => {
    // Fail the first two attempts, then succeed on the third.
    sendNative
      .mockImplementationOnce(() => {
        throw new Error("os busy");
      })
      .mockImplementationOnce(() => {
        throw new Error("os busy");
      })
      .mockImplementationOnce(() => {});

    const received = await deliver(WEEKLY);

    expect(received).toBe(true);
    expect(sendNative).toHaveBeenCalledTimes(3);
  });

  it("gives up after at most 3 retries and reports not-received on total failure (Req 8.8)", async () => {
    sendNative.mockImplementation(() => {
      throw new Error("os unavailable");
    });

    const received = await deliver(WEEKLY);

    // false is the signal the caller uses to record the member as not-received.
    expect(received).toBe(false);
    // 1 initial attempt + at most 3 retries = the bounded attempt count.
    expect(sendNative).toHaveBeenCalledTimes(MAX_DELIVERY_ATTEMPTS);
    expect(MAX_DELIVERY_ATTEMPTS).toBe(4);
  });
});

/*
 * Permission + subscription gating (Task 10.6, Req 8.5–8.7).
 *
 * The specific cases the gate must enforce end to end:
 *   - Granted  -> the member is recorded subscribed (Req 8.5).
 *   - Denied   -> "notifications unavailable" and NO delivery is attempted to
 *                 that member (Req 8.7).
 *   - Unsubscribed member -> `deliver()` is never called for them (Req 8.6).
 *
 * `requestPermission` / `setSubscribed` / `isSubscribed` are the primitives
 * exercised above. These tests model the realistic send path a caller uses —
 * "only deliver to a member who is subscribed" — and assert the gate decides
 * whether `deliver()` runs at all. `deliver` is spied on the module object so a
 * single real implementation is shared with the gate helper below; the spy lets
 * us assert call-count without dispatching to the (mocked) native plugin.
 */
describe("permission + subscription gating (Req 8.5, 8.6, 8.7)", () => {
  // The send path a caller runs per member: consult the stored subscription and
  // only hand the event to `deliver()` when the member is subscribed. Returns
  // true when a notification was actually dispatched, false when the member was
  // gated out (unsubscribed / permission never granted).
  async function deliverIfSubscribed(
    userId: string,
    event: service.NotifEvent
  ): Promise<boolean> {
    if (!(await service.isSubscribed(userId))) {
      return false;
    }
    return service.deliver(event);
  }

  const GOAL_EVENT: service.NotifEvent = {
    kind: "weekly_goal",
    member: "Ada",
    goalLabel: "Chapter 12",
  };

  it("granted permission records the member as subscribed (Req 8.5)", async () => {
    // Enabling only reaches setSubscribed(true) after a grant; model that flow.
    permissionGranted.mockResolvedValue(false);
    requestNative.mockResolvedValue("granted");

    const permission = await requestPermission();
    expect(permission).toBe("granted");

    // Granted -> the member is recorded subscribed.
    await setSubscribed("user1", true);
    expect(await isSubscribed("user1")).toBe(true);
  });

  it("denied permission leaves the member unsubscribed and never delivers (Req 8.7)", async () => {
    permissionGranted.mockResolvedValue(false);
    requestNative.mockResolvedValue("denied");

    const deliverSpy = vi.spyOn(service, "deliver");
    sendNative.mockImplementation(() => {});

    const permission = await requestPermission();
    // Denied surfaces "notifications unavailable" (caller's gate) and leaves the
    // member unsubscribed — no setSubscribed(true) is reached.
    expect(permission).toBe("denied");
    expect(await isSubscribed("user1")).toBe(false);

    // With the member unsubscribed, the send path must not deliver to them.
    const dispatched = await deliverIfSubscribed("user1", GOAL_EVENT);
    expect(dispatched).toBe(false);
    expect(deliverSpy).not.toHaveBeenCalled();
    expect(sendNative).not.toHaveBeenCalled();
  });

  it("does not call deliver() for an unsubscribed member (Req 8.6)", async () => {
    const deliverSpy = vi.spyOn(service, "deliver");
    sendNative.mockImplementation(() => {});

    // No subscription record exists -> the member reads as unsubscribed.
    const dispatched = await deliverIfSubscribed("user1", GOAL_EVENT);

    expect(dispatched).toBe(false);
    expect(deliverSpy).not.toHaveBeenCalled();
    expect(sendNative).not.toHaveBeenCalled();
  });

  it("does not deliver after a member disables notifications (Req 8.6)", async () => {
    const deliverSpy = vi.spyOn(service, "deliver");
    sendNative.mockImplementation(() => {});

    // Subscribed, then disabled — the member must stop receiving notifications.
    await setSubscribed("user1", true);
    await setSubscribed("user1", false);

    const dispatched = await deliverIfSubscribed("user1", GOAL_EVENT);

    expect(dispatched).toBe(false);
    expect(deliverSpy).not.toHaveBeenCalled();
    expect(sendNative).not.toHaveBeenCalled();
  });

  it("delivers to a subscribed member (gate open contrast case)", async () => {
    const deliverSpy = vi.spyOn(service, "deliver");
    sendNative.mockImplementation(() => {});

    await setSubscribed("user1", true);

    const dispatched = await deliverIfSubscribed("user1", GOAL_EVENT);

    // Gate open: the subscribed member is delivered to exactly once.
    expect(dispatched).toBe(true);
    expect(deliverSpy).toHaveBeenCalledOnce();
    expect(sendNative).toHaveBeenCalledOnce();
  });
});
