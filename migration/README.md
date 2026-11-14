# Supabase → PocketBase migration (one-time)

A standalone, **offline** Node script that migrates the existing Supabase
dataset into the self-hosted PocketBase backend (Req 11.8, 11.9). It runs
**outside** the Tauri/Next.js app runtime and is **never** bundled into a shipped
app artifact.

## Security

All secrets are read from the **environment at runtime** by this script only:

- `SUPABASE_SERVICE_KEY` — Supabase service-role key, used solely to read the
  source dataset. It is **never** imported by app code and **never** bundled.
- `POCKETBASE_ADMIN_PASSWORD` — PocketBase superuser password, used to write via
  the admin API.

Nothing under `migration/` is imported from `app/`, so the Next.js static export
does not include it. Do not move secret reads into shared app code.

## What it does

Migrates, in dependency order, preserving fields and referential relationships:

| Source (Supabase) | Target (PocketBase) | Notes |
| --- | --- | --- |
| `auth.users` ids | `users` relations | remapped via the id-remap table |
| `groups` | `groups` | `name` (1–200), `invite_code` (6–32) |
| `group_members` | `group_members` | `(user, group, display_name)` with relation remap |
| `reading_sessions` | `reading_sessions` | `reading_units` → ordered JSON preserving `order_index` |
| `progress` | `progress` | `chapter_completed` validated to `[0, total_chapters]` |

Field names are kept identical (`total_chapters`, `chapter_completed`) for
migration fidelity.

### Idempotency (re-runnable)

The script keeps an **id-remap table** (`source id → PocketBase id` per
collection), persisted to `migration/.remap.json`. Re-running reuses
already-migrated records instead of duplicating them.

### Halt on unmappable record (Req 11.9)

If a source record is missing or has an invalid **required** field (criteria
11.1–11.5), the migration of **that record** halts: the report names the record
(collection + source id) and the offending field, and **every already-migrated
record stays intact**. The run continues with the remaining records and exits
non-zero if any record halted.

## Running

```bash
SUPABASE_URL="https://xxxx.supabase.co" \
SUPABASE_SERVICE_KEY="…" \
POCKETBASE_URL="http://127.0.0.1:8090" \
POCKETBASE_ADMIN_EMAIL="admin@example.com" \
POCKETBASE_ADMIN_PASSWORD="…" \
node --experimental-strip-types migration/index.ts
```

Flags:

- `--dry-run` — read the source and run all mapping/validation against an
  in-memory sink without writing to PocketBase (useful to preview halts).
- `--remap <path>` — path to the id-remap file (default `migration/.remap.json`).

## Files

- `types.ts` — source/target shapes, id-remap table, report/halt types.
- `mapping.ts` — pure field-preservation + validation; throws a per-record halt
  identifying the record and field. (Exercised by Property 18, task 15.2.)
- `source.ts` — Supabase reader (PostgREST + service key).
- `sink.ts` — PocketBase admin-API writer, plus an in-memory sink.
- `remap-store.ts` — load/save the id-remap table for idempotency.
- `runner.ts` — sequences collections, remaps ids, handles halts, builds the report.
- `index.ts` — CLI entrypoint.
