// migration/remap-store.ts
//
// Persistence for the id-remap table so the migration is re-runnable /
// idempotent across invocations (Req 11.9). Between runs the table is written to
// a JSON file; on the next run it is loaded so already-migrated source ids are
// skipped instead of duplicated.
//
// `Map` is not directly JSON-serializable, so entries are stored as plain
// objects of `{ [sourceId]: targetId }` per collection and rehydrated on load.

import { readFile, writeFile } from "node:fs/promises";

import {
  createRemapTable,
  type RemapCollection,
  type RemapTable,
} from "./types";

type SerializedRemap = Record<RemapCollection, Record<string, string>>;

const COLLECTIONS: RemapCollection[] = [
  "users",
  "groups",
  "group_members",
  "reading_sessions",
  "progress",
];

/** Serialize a remap table to a plain JSON-safe object. */
export function serializeRemap(table: RemapTable): SerializedRemap {
  const out = {} as SerializedRemap;
  for (const c of COLLECTIONS) {
    out[c] = Object.fromEntries(table[c]);
  }
  return out;
}

/** Rehydrate a remap table from its serialized form. */
export function deserializeRemap(data: Partial<SerializedRemap>): RemapTable {
  const table = createRemapTable();
  for (const c of COLLECTIONS) {
    const entries = data[c];
    if (entries) {
      for (const [sourceId, targetId] of Object.entries(entries)) {
        table[c].set(sourceId, targetId);
      }
    }
  }
  return table;
}

/**
 * Load a persisted remap table from `path`. Returns an empty table if the file
 * does not exist (a first run), so callers never branch on "first run".
 */
export async function loadRemap(path: string): Promise<RemapTable> {
  try {
    const raw = await readFile(path, "utf8");
    return deserializeRemap(JSON.parse(raw) as Partial<SerializedRemap>);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return createRemapTable();
    }
    throw err;
  }
}

/** Persist a remap table to `path` as pretty JSON. */
export async function saveRemap(path: string, table: RemapTable): Promise<void> {
  await writeFile(path, JSON.stringify(serializeRemap(table), null, 2), "utf8");
}
