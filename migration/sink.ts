// migration/sink.ts
//
// PocketBase SINK writer for the one-time migration (Req 11.8).
//
// Writes migrated records to the target PocketBase instance via the admin API
// (superuser auth), using the `pocketbase` SDK the app already depends on. Like
// the source reader, admin credentials are read from the environment AT RUNTIME
// only and are never bundled into the app.
//
// The sink is kept behind a small {@link Sink} interface so the runner — and
// the Property 18 test (task 15.2) — can drive the migration against an
// in-memory sink that records what WOULD be written, with no live backend.

import PocketBase from "pocketbase";

import type {
  RemapCollection,
  TargetGroup,
  TargetGroupMember,
  TargetProgress,
  TargetReadingSession,
} from "./types";

/** Admin connection settings for the PocketBase target, read from env. */
export interface PocketBaseAdminConfig {
  /** PocketBase URL, e.g. http://127.0.0.1:8090 */
  url: string;
  /** Superuser email — runtime-only, never bundled. */
  adminEmail: string;
  /** Superuser password — runtime-only, never bundled. */
  adminPassword: string;
}

/**
 * Read the PocketBase admin settings from the environment. Throws a clear error
 * naming any missing variable; never logs the password.
 */
export function loadPocketBaseConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): PocketBaseAdminConfig {
  const url = env.POCKETBASE_URL;
  const adminEmail = env.POCKETBASE_ADMIN_EMAIL;
  const adminPassword = env.POCKETBASE_ADMIN_PASSWORD;
  if (!url) throw new Error("Missing POCKETBASE_URL.");
  if (!adminEmail) throw new Error("Missing POCKETBASE_ADMIN_EMAIL.");
  if (!adminPassword) throw new Error("Missing POCKETBASE_ADMIN_PASSWORD.");
  return { url: url.replace(/\/+$/, ""), adminEmail, adminPassword };
}

/**
 * The write surface the runner uses. Each `create*` returns the PocketBase id
 * assigned to the new record so the runner can record it in the id-remap table.
 * `findExisting` lets the runner reuse a record written by a prior run for
 * idempotency without duplicating it (Req 11.9).
 */
export interface Sink {
  createGroup(payload: TargetGroup): Promise<string>;
  createGroupMember(payload: TargetGroupMember): Promise<string>;
  createReadingSession(payload: TargetReadingSession): Promise<string>;
  createProgress(payload: TargetProgress): Promise<string>;
}

/** PocketBase-backed sink using the admin API. */
export class PocketBaseSink implements Sink {
  private readonly pb: PocketBase;

  constructor(private readonly config: PocketBaseAdminConfig) {
    this.pb = new PocketBase(config.url);
  }

  /** Authenticate as a PocketBase superuser before writing. */
  async authenticate(): Promise<void> {
    await this.pb
      .collection("_superusers")
      .authWithPassword(this.config.adminEmail, this.config.adminPassword);
  }

  async createGroup(payload: TargetGroup): Promise<string> {
    const record = await this.pb.collection("groups").create(payload);
    return record.id;
  }

  async createGroupMember(payload: TargetGroupMember): Promise<string> {
    const record = await this.pb.collection("group_members").create(payload);
    return record.id;
  }

  async createReadingSession(payload: TargetReadingSession): Promise<string> {
    const record = await this.pb.collection("reading_sessions").create(payload);
    return record.id;
  }

  async createProgress(payload: TargetProgress): Promise<string> {
    const record = await this.pb.collection("progress").create(payload);
    return record.id;
  }
}

/**
 * An in-memory sink that records writes instead of hitting a backend. Used by
 * tests, the Property 18 test, and `--dry-run`. Assigns deterministic synthetic
 * target ids (`<collection>_<n>`) so relationship remapping can be asserted.
 */
export class InMemorySink implements Sink {
  readonly created: Record<RemapCollection, unknown[]> = {
    users: [],
    groups: [],
    group_members: [],
    reading_sessions: [],
    progress: [],
  };
  private counters: Record<string, number> = {};

  private nextId(collection: string): string {
    const n = (this.counters[collection] ?? 0) + 1;
    this.counters[collection] = n;
    return `${collection}_${n}`;
  }

  async createGroup(payload: TargetGroup): Promise<string> {
    const id = this.nextId("groups");
    this.created.groups.push({ id, ...payload });
    return id;
  }
  async createGroupMember(payload: TargetGroupMember): Promise<string> {
    const id = this.nextId("group_members");
    this.created.group_members.push({ id, ...payload });
    return id;
  }
  async createReadingSession(payload: TargetReadingSession): Promise<string> {
    const id = this.nextId("reading_sessions");
    this.created.reading_sessions.push({ id, ...payload });
    return id;
  }
  async createProgress(payload: TargetProgress): Promise<string> {
    const id = this.nextId("progress");
    this.created.progress.push({ id, ...payload });
    return id;
  }
}
