/// <reference path="../pb_data/types.d.ts" />
//
// PocketBase migration: Reading Sync application collections (Req 11.1-11.7).
//
// Defines the six application collections that replace the former Supabase
// schema, mapping the existing model one-to-one and preserving field names for
// migration fidelity (Req 11). Runs in a transaction on `serve`/`migrate up`.
//
// Collections created here:
//   - groups                     (Req 11.1, 11.2)
//   - group_members              (Req 11.3)
//   - reading_sessions           (Req 11.4)
//   - progress                   (Req 11.5-11.7)
//   - notification_subscriptions (Req 8.5, 8.6)
//   - notification_events        (Req 8.1, 8.2 fire-once ledger)
//
// Field types/ranges come directly from design.md "PocketBase collection
// schema". Unique indexes enforce invite-code uniqueness, one membership per
// (user, group), one progress record per (reading_session, user), and the
// fire-once (reading_session, event_type, event_key) ledger key.
//
// The `users` auth collection is PocketBase's built-in system collection and is
// not (re)created here; relations reference it by id (`_pb_users_auth_`).

migrate(
  (app) => {
    // The built-in auth collection id. Resolve it by name so the relation
    // targets stay correct even if the default id ever changes.
    const usersCollectionId = app.findCollectionByNameOrId("users").id;

    // ---------------------------------------------------------------------
    // groups (Req 11.1, 11.2)
    // ---------------------------------------------------------------------
    const groups = new Collection({
      type: "base",
      name: "groups",
      fields: [
        {
          type: "text",
          name: "name",
          required: true,
          min: 1,
          max: 200,
        },
        {
          // invite_code is required and globally unique (unique index below).
          // Values are 6-32 chars; generation/retry is handled by the
          // invite-code create hook (Req 4.2, 11.1).
          type: "text",
          name: "invite_code",
          required: true,
          min: 6,
          max: 32,
        },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_groups_invite_code ON groups (invite_code)",
      ],
    });
    app.save(groups);
    const groupsCollectionId = app.findCollectionByNameOrId("groups").id;

    // ---------------------------------------------------------------------
    // group_members (Member, Req 11.3)
    // ---------------------------------------------------------------------
    const groupMembers = new Collection({
      type: "base",
      name: "group_members",
      fields: [
        {
          type: "relation",
          name: "user",
          required: true,
          maxSelect: 1,
          collectionId: usersCollectionId,
          cascadeDelete: true,
        },
        {
          type: "relation",
          name: "group",
          required: true,
          maxSelect: 1,
          collectionId: groupsCollectionId,
          cascadeDelete: true,
        },
        {
          type: "text",
          name: "display_name",
          required: true,
          min: 1,
          max: 100,
        },
      ],
      indexes: [
        // One membership per (user, group); supports Req 4.9 / 11.7.
        "CREATE UNIQUE INDEX idx_group_members_user_group ON group_members (user, group)",
      ],
    });
    app.save(groupMembers);

    // ---------------------------------------------------------------------
    // reading_sessions (Reading_Session, Req 11.4)
    // ---------------------------------------------------------------------
    const readingSessions = new Collection({
      type: "base",
      name: "reading_sessions",
      fields: [
        {
          type: "relation",
          name: "group",
          required: true,
          maxSelect: 1,
          collectionId: groupsCollectionId,
          cascadeDelete: true,
        },
        {
          type: "text",
          name: "book_title",
          required: true,
          min: 1,
          max: 300,
        },
        {
          // Generic total count across all progress types (1-100000).
          type: "number",
          name: "total_chapters",
          required: true,
          onlyInt: true,
          min: 1,
          max: 100000,
        },
        {
          type: "select",
          name: "progress_type",
          required: true,
          maxSelect: 1,
          values: ["chapters", "pages", "milestones", "sections"],
        },
        {
          type: "bool",
          name: "is_active",
          // bool fields are effectively required with a false default; the
          // create flow sets this explicitly (Req 5.6).
        },
        {
          type: "text",
          name: "cover_url",
          required: false,
        },
        {
          type: "text",
          name: "goal_type",
          required: false,
        },
        {
          type: "number",
          name: "goal_amount",
          required: false,
          onlyInt: true,
          min: 1,
          max: 100000,
        },
        {
          type: "text",
          name: "goal_unit",
          required: false,
        },
        {
          // Ordered JSON array of { label, order_index }; order preserved by
          // the client mapper's sort on order_index (Req 5.3, 11.4).
          type: "json",
          name: "reading_units",
          required: false,
          // Generous bound covering up to 10000 entries of small objects.
          maxSize: 2000000,
        },
        {
          type: "autodate",
          name: "created_at",
          onCreate: true,
          onUpdate: false,
        },
      ],
    });
    app.save(readingSessions);
    const readingSessionsCollectionId =
      app.findCollectionByNameOrId("reading_sessions").id;

    // ---------------------------------------------------------------------
    // progress (Progress_Record, Req 11.5-11.7)
    // ---------------------------------------------------------------------
    const progress = new Collection({
      type: "base",
      name: "progress",
      fields: [
        {
          type: "relation",
          name: "reading_session",
          required: true,
          maxSelect: 1,
          collectionId: readingSessionsCollectionId,
          cascadeDelete: true,
        },
        {
          type: "relation",
          name: "user",
          required: true,
          maxSelect: 1,
          collectionId: usersCollectionId,
          cascadeDelete: true,
        },
        {
          // Generic completed count. Hard range [0, 100000] here; the
          // per-session upper bound (<= total_chapters) and integer rejection
          // are enforced by the progress validation hook (Req 6.2, 11.6).
          type: "number",
          name: "chapter_completed",
          required: true,
          onlyInt: true,
          min: 0,
          max: 100000,
        },
        {
          type: "autodate",
          name: "last_completed_at",
          onCreate: true,
          onUpdate: true,
        },
      ],
      indexes: [
        // At most one progress record per (reading_session, user); supports the
        // former upsert onConflict and Req 11.7.
        "CREATE UNIQUE INDEX idx_progress_session_user ON progress (reading_session, user)",
      ],
    });
    app.save(progress);

    // ---------------------------------------------------------------------
    // notification_subscriptions (Req 8.5, 8.6)
    // ---------------------------------------------------------------------
    const notificationSubscriptions = new Collection({
      type: "base",
      name: "notification_subscriptions",
      fields: [
        {
          type: "relation",
          name: "user",
          required: true,
          maxSelect: 1,
          collectionId: usersCollectionId,
          cascadeDelete: true,
        },
        {
          type: "bool",
          name: "subscribed",
        },
      ],
      indexes: [
        // One subscription row per user.
        "CREATE UNIQUE INDEX idx_notification_subscriptions_user ON notification_subscriptions (user)",
      ],
    });
    app.save(notificationSubscriptions);

    // ---------------------------------------------------------------------
    // notification_events (fire-once ledger, Req 8.1, 8.2)
    // ---------------------------------------------------------------------
    const notificationEvents = new Collection({
      type: "base",
      name: "notification_events",
      fields: [
        {
          type: "relation",
          name: "reading_session",
          required: true,
          maxSelect: 1,
          collectionId: readingSessionsCollectionId,
          cascadeDelete: true,
        },
        {
          type: "select",
          name: "event_type",
          required: true,
          maxSelect: 1,
          values: ["weekly_goal", "group_ready"],
        },
        {
          type: "text",
          name: "event_key",
          required: true,
          min: 1,
          max: 200,
        },
      ],
      indexes: [
        // The claim-once key: each (reading_session, event_type, event_key)
        // fires exactly once (Req 8.1, 8.2).
        "CREATE UNIQUE INDEX idx_notification_events_key ON notification_events (reading_session, event_type, event_key)",
      ],
    });
    app.save(notificationEvents);
  },

  // Down migration: drop in reverse dependency order so relations unwind cleanly.
  (app) => {
    const names = [
      "notification_events",
      "notification_subscriptions",
      "progress",
      "reading_sessions",
      "group_members",
      "groups",
    ];
    for (const name of names) {
      try {
        const collection = app.findCollectionByNameOrId(name);
        app.delete(collection);
      } catch {
        // Already removed; nothing to revert.
      }
    }
  }
);
