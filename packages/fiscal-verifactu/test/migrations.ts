import { manifestSets, migrationOptionsFor } from "@waitron/migrations";

/**
 * The migration sets every @waitron/fiscal-verifactu test database applies, in production manifest
 * order (fiscal last).
 *
 * SP-3a's `0014_fiscal_sync_capture.sql` installs `sync_capture()` triggers on fiscal's own tables,
 * and that function is defined by @waitron/sync's `0000_sync_outbox.sql`. So the fiscal set no longer
 * migrates on top of CORE alone — sync, and sync's own prerequisites (identity + payments), must run
 * first. Rather than hand-list that dependency chain — a cross-package list that goes stale the
 * moment the graph changes (CLAUDE.md §2) — this is the WHOLE manifest, which the resolver orders
 * with sync before fiscal, exactly as apps/server and @waitron/sync migrate in their own harnesses.
 * `root: null` resolves each set's folder from source (this repo's checkout), the shape those two
 * harnesses use. PGlite runs it fine — it is real PostgreSQL compiled to WASM.
 */
export const TEST_MIGRATIONS = migrationOptionsFor(manifestSets(), null);
