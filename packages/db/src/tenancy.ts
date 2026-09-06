import { sql } from "drizzle-orm";
import type { Database, Transaction } from "./client.js";

/** The producing node is recorded by the sync capture triggers. */
export interface TenantTxOptions {
  nodeId?: string;
}

/**
 * Runs the caller's work in one transaction. One tenant per database is the isolation boundary
 * (row-level security is gone), so the tenant needs no per-transaction binding: `tenantId` sets no
 * GUC and is not read here. It is retained deliberately as a stable, explicit write-path parameter —
 * the call surface every write path already threads. The optional `nodeId` sets the
 * transaction-local `app.node_id` the sync capture triggers read, bound through set_config because
 * SET utility statements do not accept bound parameters.
 */
export async function withTenant<T>(
  db: Database,
  tenantId: string,
  fn: (tx: Transaction) => Promise<T>,
  opts?: TenantTxOptions,
): Promise<T> {
  void tenantId;
  return db.transaction(async (tx) => {
    if (opts?.nodeId !== undefined) {
      await tx.execute(sql`select set_config('app.node_id', ${opts.nodeId}, true)`);
    }
    return fn(tx);
  });
}
