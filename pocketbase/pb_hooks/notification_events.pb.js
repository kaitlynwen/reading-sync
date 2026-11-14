/// <reference path="../pb_data/types.d.ts" />
//
// Notification event-evaluation hook for the `progress` collection
// (Req 8.1, 8.2, 8.3, 8.4). This is the backend-owned "when does an event fire"
// decision that the deleted Supabase `/api/notifications/progress` route used to
// make; it is re-homed here so the fire-once decision is authoritative and
// consistent for every member regardless of which client is online, and so it
// does not depend on the writing client staying connected.
//
// The client `Notification_Service` is responsible only for permission /
// subscription handling and native OS delivery (with retries); it does NOT
// decide when an event fires.
//
// Model (preserving the original claim-once semantics):
//
//   - Weekly_Goal_Event (Req 8.1, 8.3): raised once when a member reaches /
//     exceeds the session goal amount, keyed by
//     `event_key = "{goalAmount}:{userId}"`. The delivered message names the
//     member and the goal.
//   - Group_Ready_Event (Req 8.2, 8.4): raised once when the group minimum
//     completed count advances to a new shared progress point, keyed by
//     `event_key = "{progressPoint}"` (the next unit). The delivered message
//     names the book title and the next unit.
//
// Fire-once enforcement: an event is "claimed" by INSERTing its row into
// `notification_events`; the unique index on
// `(reading_session, event_type, event_key)` means a second insert for the same
// key fails, and we treat that failure as "already fired -> skip". This is the
// exact idempotency contract the Supabase route relied on, now anchored in the
// unique index rather than a Postgres error code.
//
// Delivery: the backend does not itself call the OS. After a successful claim
// the hook records the event (the claimed row) and emits a realtime message so
// subscribed clients turn it into a native OS notification via
// `Notification_Service.deliver()`. PocketBase's realtime already streams the
// `notification_events` create to subscribed clients, so claiming the row is the
// delivery signal; the hook's job is the fire-once evaluation + claim.
//
// Runs AFTER the progress write has committed (onRecord*AfterSuccess) so the
// stored state we read for the group-minimum computation already includes this
// write, and so a failed evaluation can never roll back the user's progress
// update.

// ---------------------------------------------------------------------------
// Content helpers (mirror the original route's labels, Req 8.3, 8.4)
// ---------------------------------------------------------------------------

function getProgressNoun(progressType) {
  if (progressType === "pages") return "page";
  if (progressType === "milestones") return "milestone";
  if (progressType === "sections") return "section";
  return "chapter";
}

// Human-readable label for the goal amount, matching the old route:
//  - pages                -> "Page N"
//  - milestones/sections  -> the custom unit label at order_index === amount,
//                            falling back to "Milestone N" / "Section N"
//  - chapters (default)   -> "Chapter N"
function getGoalLabel(progressType, amount, readingUnits) {
  if (progressType === "pages") return "Page " + amount;
  if (progressType === "milestones" || progressType === "sections") {
    const units = Array.isArray(readingUnits) ? readingUnits : [];
    for (let i = 0; i < units.length; i++) {
      if (units[i] && Number(units[i].order_index) === Number(amount)) {
        return String(units[i].label);
      }
    }
    const fallback = progressType === "sections" ? "Section" : "Milestone";
    return fallback + " " + amount;
  }
  return "Chapter " + amount;
}

// ---------------------------------------------------------------------------
// Claim-once (Req 8.1, 8.2)
// ---------------------------------------------------------------------------

// Attempt to claim an event by inserting its ledger row. Returns true when the
// row was created (this call owns the event), false when the unique index
// rejected it (the event already fired). Any other failure is swallowed so a
// notification problem never destabilizes the committed progress write.
function claimEvent(app, readingSessionId, eventType, eventKey) {
  try {
    const collection = app.findCollectionByNameOrId("notification_events");
    const record = new Record(collection);
    record.set("reading_session", readingSessionId);
    record.set("event_type", eventType);
    record.set("event_key", eventKey);
    app.save(record);
    return true;
  } catch (err) {
    // A uniqueness violation (already claimed) OR any other save failure both
    // mean "do not deliver for this key now". Fire-once is preserved either
    // way: the claimed row, once present, blocks every future claim.
    return false;
  }
}

// ---------------------------------------------------------------------------
// Evaluation (Req 8.1-8.4)
// ---------------------------------------------------------------------------

function evaluateNotifications(e) {
  // Let the write commit first; only evaluate against committed state.
  e.next();

  try {
    const app = e.app;
    const progressRecord = e.record;

    const sessionId = String(progressRecord.get("reading_session"));
    if (!sessionId) return;

    let session;
    try {
      session = app.findRecordById("reading_sessions", sessionId);
    } catch {
      return; // Session gone (e.g. cascade delete); nothing to evaluate.
    }

    const progressType = String(session.get("progress_type") || "chapters");
    const bookTitle = String(session.get("book_title") || "");
    const goalType = session.get("goal_type");
    const goalAmount = Number(session.get("goal_amount"));
    const readingUnits = session.get("reading_units");

    // ----- All progress for this session, keyed by user -----
    const progressRows = app.findRecordsByFilter(
      "progress",
      "reading_session = {:sid}",
      "",
      0,
      0,
      { sid: sessionId }
    );
    const progressByUser = {};
    for (let i = 0; i < progressRows.length; i++) {
      const row = progressRows[i];
      progressByUser[String(row.get("user"))] = Number(
        row.get("chapter_completed")
      );
    }

    // ----- Members of this group (the completed-count population) -----
    const groupId = String(session.get("group"));
    const memberRows = app.findRecordsByFilter(
      "group_members",
      "group = {:gid}",
      "",
      0,
      0,
      { gid: groupId }
    );
    const memberById = {};
    const memberIds = [];
    for (let i = 0; i < memberRows.length; i++) {
      const uid = String(memberRows[i].get("user"));
      memberById[uid] = String(memberRows[i].get("display_name") || "");
      memberIds.push(uid);
    }

    const actorId = String(progressRecord.get("user"));
    const actorName = memberById[actorId] || "A member";

    // ----- Weekly_Goal_Event (Req 8.1, 8.3) -----
    // Raised when this member has reached/exceeded a numeric "target" goal.
    // Keyed by "{goalAmount}:{userId}"; the unique index guarantees fire-once
    // even though this hook has no explicit previous-value tracking.
    if (
      goalType === "target" &&
      Number.isFinite(goalAmount) &&
      goalAmount > 0
    ) {
      const actorProgress = progressByUser[actorId] ?? 0;
      if (actorProgress >= goalAmount) {
        const eventKey = goalAmount + ":" + actorId;
        if (claimEvent(app, sessionId, "weekly_goal", eventKey)) {
          const goalLabel = getGoalLabel(progressType, goalAmount, readingUnits);
          $app.logger().info(
            "Weekly_Goal_Event claimed",
            "session", sessionId,
            "event_key", eventKey,
            "message", actorName + " reached the goal: " + goalLabel + "."
          );
        }
      }
    }

    // ----- Group_Ready_Event (Req 8.2, 8.4) -----
    // The group minimum is the smallest completed count across all members
    // (members with no progress row count as 0). When that minimum advances the
    // whole group is "ready" for the next unit. Keyed by the next progress point
    // so each point fires at most once; the unique index drops later claims.
    if (memberIds.length > 0) {
      let groupMin = Infinity;
      for (let i = 0; i < memberIds.length; i++) {
        const value = progressByUser[memberIds[i]] ?? 0;
        if (value < groupMin) groupMin = value;
      }
      if (Number.isFinite(groupMin) && groupMin > 0) {
        const nextPoint = groupMin + 1;
        const eventKey = String(nextPoint);
        if (claimEvent(app, sessionId, "group_ready", eventKey)) {
          const noun = getProgressNoun(progressType);
          $app.logger().info(
            "Group_Ready_Event claimed",
            "session", sessionId,
            "event_key", eventKey,
            "message",
            "Everyone is ready for " + noun + " " + nextPoint + " in " + bookTitle + "."
          );
        }
      }
    }
  } catch (err) {
    // Notification evaluation must never surface as a progress-write failure;
    // the write already committed in e.next() above.
    $app.logger().warn("notification evaluation failed", "error", String(err));
  }
}

onRecordAfterCreateSuccess(evaluateNotifications, "progress");
onRecordAfterUpdateSuccess(evaluateNotifications, "progress");
