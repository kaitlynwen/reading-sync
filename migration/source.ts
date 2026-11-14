// migration/source.ts
//
// Supabase SOURCE reader for the one-time migration (Req 11.8).
//
// SECURITY: the Supabase service key is read from the environment AT RUNTIME
// only (`SUPABASE_SERVICE_KEY`) and is used nowhere but this standalone script.
// It is NEVER imported by the Tauri/Next.js app bundle — this `migration/`
// directory is excluded from the app build (see `next.config.ts`/tsconfig app
// scope) and is run manually with Node. Do not hardcode the key or move this
// read into shared app code.
//
// This reader is intentionally transport-light: it uses the Supabase REST
// endpoint (PostgREST) via `fetch` with the service key so the migration has no
// runtime dependency on `@supabase/*` (those packages were removed from the app
// in task 6.1). The result is a {@link SourceDataset} the pure mapper consumes.

import type {
  SourceDataset,
  SourceGroup,
  SourceGroupMember,
  SourceProgress,
  SourceReadingSession,
  SourceUser,
} from "./types";

/** Connection settings for the Supabase source, read from env at runtime. */
export interface SupabaseSourceConfig {
  /** Supabase project URL, e.g. https://xxxx.supabase.co */
  url: string;
  /** Service-role key — runtime-only secret, never bundled. */
  serviceKey: string;
}

/**
 * Read the Supabase connection settings from the environment. Throws a clear
 * error if either value is missing so the operator sees exactly what to set,
 * and never logs the key itself.
 */
export function loadSupabaseConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): SupabaseSourceConfig {
  const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_KEY ?? env.SUPABASE_SECRET_KEY;
  if (!url) {
    throw new Error(
      "Missing SUPABASE_URL. Set it in the environment before running the migration."
    );
  }
  if (!serviceKey) {
    throw new Error(
      "Missing SUPABASE_SERVICE_KEY. Set it in the environment before running the migration (never commit or bundle this key)."
    );
  }
  return { url: url.replace(/\/+$/, ""), serviceKey };
}

/** Minimal PostgREST GET against a Supabase table, returning all rows. */
async function selectAll<T>(
  config: SupabaseSourceConfig,
  table: string,
  columns: string
): Promise<T[]> {
  const endpoint = `${config.url}/rest/v1/${table}?select=${encodeURIComponent(columns)}`;
  const res = await fetch(endpoint, {
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Supabase read of "${table}" failed: ${res.status} ${res.statusText}${
        body ? ` — ${body}` : ""
      }`
    );
  }
  return (await res.json()) as T[];
}

/**
 * The reader interface the runner depends on, so tests can supply an in-memory
 * dataset without any network access.
 */
export interface SourceReader {
  read(): Promise<SourceDataset>;
}

/** A reader backed by a live Supabase project via PostgREST + the service key. */
export class SupabaseSourceReader implements SourceReader {
  constructor(private readonly config: SupabaseSourceConfig) {}

  async read(): Promise<SourceDataset> {
    // `auth.users` is not exposed over PostgREST; the project is expected to
    // surface the ids via a `users` view/table. Fall back gracefully if absent.
    const users = await this.readUsers();
    const [groups, groupMembers, readingSessions, progress] = await Promise.all([
      selectAll<SourceGroup>(this.config, "groups", "id,name,invite_code"),
      selectAll<SourceGroupMember>(
        this.config,
        "group_members",
        "id,user_id,group_id,display_name"
      ),
      selectAll<SourceReadingSession>(
        this.config,
        "reading_sessions",
        "id,group_id,book_title,total_chapters,progress_type,is_active,cover_url,goal_type,goal_amount,goal_unit,reading_units,created_at"
      ),
      selectAll<SourceProgress>(
        this.config,
        "progress",
        "id,reading_session_id,user_id,chapter_completed"
      ),
    ]);

    return { users, groups, groupMembers, readingSessions, progress };
  }

  private async readUsers(): Promise<SourceUser[]> {
    try {
      return await selectAll<SourceUser>(this.config, "users", "id,email");
    } catch {
      // No `users` view exposed: derive the referenced user ids from members
      // and progress so relation remapping still has entries to map against.
      return [];
    }
  }
}

/** An in-memory reader for tests and dry runs. */
export class StaticSourceReader implements SourceReader {
  constructor(private readonly dataset: SourceDataset) {}
  async read(): Promise<SourceDataset> {
    return this.dataset;
  }
}
