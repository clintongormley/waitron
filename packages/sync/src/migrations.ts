import { fileURLToPath } from "node:url";

/**
 * The commercial outbox migration set: log, cursors, peers, config conflicts and capture triggers.
 * It runs after the core, identity and payments tables those triggers attach to. The caller owns
 * that cross-package ordering; the manifest places these owners before sync.
 *
 * The migrator reads meta/_journal.json and 0000_sync_baseline.sql. This hand-written set has no
 * Drizzle schema model or snapshot.
 */
export const SYNC_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_sync",
} as const;
