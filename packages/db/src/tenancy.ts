import type { Database, Transaction } from "./client.js";

/**
 * Runs the caller's work in one transaction. One tenant per database, so there is no tenant to bind:
 * a write path takes the `tx` this opens and never opens its own (CLAUDE.md §3). Renamed from
 * `withTenant` when the tenant column was dropped (2026-09-14).
 */
export async function withTransaction<T>(
  db: Database,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction((tx) => fn(tx));
}
