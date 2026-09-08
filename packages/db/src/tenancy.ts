import type { Database, Transaction } from "./client.js";

/**
 * Runs the caller's work in one transaction. One tenant per database is the isolation boundary
 * (row-level security is gone), so the tenant needs no per-transaction binding: `tenantId` sets no
 * GUC and is not read here. It is retained deliberately as a stable, explicit write-path parameter —
 * the call surface every write path already threads.
 */
export async function withTenant<T>(
  db: Database,
  tenantId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  void tenantId;
  return db.transaction((tx) => fn(tx));
}
