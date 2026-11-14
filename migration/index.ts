// migration/index.ts
//
// CLI entrypoint for the one-time Supabase -> PocketBase migration
// (Req 11.8, 11.9). Run OUTSIDE the app runtime with Node:
//
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \
//   POCKETBASE_URL=... POCKETBASE_ADMIN_EMAIL=... POCKETBASE_ADMIN_PASSWORD=... \
//   node --experimental-strip-types migration/index.ts [--dry-run] [--remap <path>]
//
// SECURITY: all secrets (the Supabase service key, the PocketBase admin
// password) are read from the environment at runtime by this script only. This
// directory is excluded from the Tauri/Next.js app build, so no secret is ever
// bundled into a shipped artifact.
//
// Idempotency: the id-remap table is persisted to `--remap <path>` (default
// `migration/.remap.json`). Re-running reuses already-migrated records instead
// of duplicating them. A record missing a required field halts only that
// record; already-migrated records stay intact (Req 11.9).

import {
  loadPocketBaseConfigFromEnv,
  PocketBaseSink,
  InMemorySink,
  type Sink,
} from "./sink";
import {
  loadSupabaseConfigFromEnv,
  SupabaseSourceReader,
  type SourceReader,
} from "./source";
import { loadRemap, saveRemap } from "./remap-store";
import { runMigration } from "./runner";
import type { MigrationReport } from "./types";

interface CliOptions {
  dryRun: boolean;
  remapPath: string;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { dryRun: false, remapPath: "migration/.remap.json" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--remap") opts.remapPath = argv[++i] ?? opts.remapPath;
  }
  return opts;
}

/** Print the migration report in a human-readable form (Req 11.9). */
export function printReport(report: MigrationReport, log = console.log): void {
  log("\n=== Migration report ===");
  for (const [collection, result] of Object.entries(report.byCollection)) {
    log(`  ${collection.padEnd(18)} migrated=${result.migrated}  halted=${result.halted}`);
  }
  log(`  total migrated: ${report.totalMigrated}`);
  log(`  total skipped (idempotent): ${report.totalSkipped}`);
  if (report.halts.length > 0) {
    log(`\n  Halted records (${report.halts.length}):`);
    for (const h of report.halts) {
      log(`    - ${h.collection} ${h.sourceId}: field "${h.field}" — ${h.reason}`);
    }
  } else {
    log("\n  No halted records.");
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  // SOURCE: live Supabase read with the runtime-only service key.
  const supabaseConfig = loadSupabaseConfigFromEnv();
  const reader: SourceReader = new SupabaseSourceReader(supabaseConfig);

  // SINK: PocketBase admin API, or an in-memory sink for a dry run.
  let sink: Sink;
  if (opts.dryRun) {
    sink = new InMemorySink();
    console.log("Dry run: no writes will be sent to PocketBase.");
  } else {
    const pbConfig = loadPocketBaseConfigFromEnv();
    const pbSink = new PocketBaseSink(pbConfig);
    await pbSink.authenticate();
    sink = pbSink;
  }

  const dataset = await reader.read();
  const remap = await loadRemap(opts.remapPath);

  const { report, remap: updatedRemap } = await runMigration(dataset, sink, { remap });

  // Persist the remap table so the next run is idempotent (even for dry runs,
  // persisting is harmless and keeps the two modes consistent — but skip it on
  // dry runs so a dry run never affects a real run's state).
  if (!opts.dryRun) {
    await saveRemap(opts.remapPath, updatedRemap);
  }

  printReport(report);

  // Non-zero exit if any record halted, so CI/operators notice unmapped data
  // without losing the already-migrated records (Req 11.9).
  if (report.halts.length > 0) {
    process.exitCode = 1;
  }
}

// Only run when invoked directly, not when imported by tests.
const isDirectRun =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  /migration[\\/](index)\.(ts|js|mjs)$/.test(process.argv[1] ?? "");

if (isDirectRun) {
  main().catch((err) => {
    console.error("Migration failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}

// Re-export the building blocks so the Property 18 test (task 15.2) and other
// tooling can drive the migration programmatically against in-memory sinks.
export { runMigration } from "./runner";
export { StaticSourceReader } from "./source";
export { InMemorySink } from "./sink";
