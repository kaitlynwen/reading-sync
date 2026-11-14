# PocketBase backend (self-hosted)

This directory holds the self-hosted PocketBase configuration for Reading Sync:
the collection schema and the server-side validation/generation hooks that back
the native desktop app. These files run inside PocketBase's embedded JavaScript
runtime (JSVM), **not** in the Next.js/Tauri app bundle.

```
pocketbase/
  pb_migrations/   # versioned DB schema (collections, fields, unique indexes)
  pb_hooks/        # server-side event hooks (invite-code gen, progress range)
```

## Running

Place these two directories next to the PocketBase executable (or mount them
into the container) and start the server:

```bash
./pocketbase serve
```

On `serve` PocketBase applies any unapplied migration in `pb_migrations/`
automatically (in a transaction) and loads every `*.pb.js` file in `pb_hooks/`.

## Collections (Req 11.1–11.7)

Defined in `pb_migrations/1750000000_init_collections.js`:

| Collection | Key fields | Unique index |
| --- | --- | --- |
| `groups` | `name` (1–200), `invite_code` (6–32) | `invite_code` |
| `group_members` | `user`, `group`, `display_name` (1–100) | `(user, group)` |
| `reading_sessions` | `book_title`, `total_chapters` (1–100000, int), `progress_type` ∈ {chapters, pages, milestones, sections}, `reading_units` (ordered JSON) | — |
| `progress` | `reading_session`, `user`, `chapter_completed` (int) | `(reading_session, user)` |
| `notification_subscriptions` | `user`, `subscribed` | `(user)` |
| `notification_events` | `reading_session`, `event_type`, `event_key` | `(reading_session, event_type, event_key)` |

`users` is PocketBase's built-in auth collection and is not recreated here;
relations reference it by id.

`reading_units` is stored as an ordered JSON array of `{ label, order_index }`
so the ordered list stays atomic with its session; the client sorts by
`order_index` when reading (Req 5.3, 11.4).

## Hooks

- **`pb_hooks/invite_code.pb.js`** (Req 4.2, 11.1) — on `groups` create, when no
  `invite_code` is supplied, generates an 8-char uppercase alphanumeric code
  (within the 6–32 range, ambiguous glyphs excluded) and retries on collision
  until the code is unique.
- **`pb_hooks/progress_range.pb.js`** (Req 6.1–6.3, 11.5, 11.6) — on `progress`
  create/update, rejects `chapter_completed` values that are non-integer, `< 0`,
  or `> total_chapters` (read from the related session) with an out-of-range
  error, leaving the existing record unchanged; in-range values (including lower
  ones) are accepted.
- **`pb_hooks/notification_events.pb.js`** (Req 8.1–8.4) — after a `progress`
  write commits, evaluates the fire-once notification events and claims each by
  inserting a `notification_events` row (the unique
  `(reading_session, event_type, event_key)` index enforcing fire-once):
  - **Weekly_Goal_Event** once per `(reading_session, goalAmount, memberId)`
    (`event_key = "{goalAmount}:{userId}"`) when the member reaches/exceeds a
    numeric `target` goal — identifying the member and the goal.
  - **Group_Ready_Event** once per `(reading_session, progressPoint)`
    (`event_key = "{progressPoint}"`) when the group minimum completed count
    advances — identifying the book title and the next unit.

  The claimed row is the delivery signal: PocketBase realtime streams the
  `notification_events` create to subscribed clients, which turn it into a
  native OS notification via `Notification_Service.deliver()`. Evaluation
  failures are logged, never rolling back the committed progress write.
