import { fileURLToPath } from "node:url";

/**
 * This package's migration set — the commercial-lane sync outbox (sync_log, sync_cursor,
 * sync_capture, and the 17 capture triggers). Exported as data rather than a function because
 * ordering across packages is the RUNTIME's responsibility, and this set must run LAST: its capture
 * triggers attach to tables owned by @waitron/db and @waitron/payments, so every enrolled table has
 * to exist first (migrations.manifest.json places `sync` after `payments`/`credentials`). A
 * descriptor makes the caller state that order out loud.
 *
 * Cloned from packages/credentials/src/migrations.ts. The migrator reads only `meta/_journal.json`
 * plus each `<tag>.sql`, so the drizzle folder needs the journal + 0000_sync_outbox.sql; the
 * snapshot JSON is repo convention and is never read at runtime.
 */
export const SYNC_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_sync",
} as const;
