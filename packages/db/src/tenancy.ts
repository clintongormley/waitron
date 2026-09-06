import { sql } from "drizzle-orm";
import type { Database, Transaction } from "./client.js";

/** The producing node is recorded by the sync capture triggers. */
export interface TenantTxOptions {
  nodeId?: string;
}

/**
 * Runs the caller's work in one transaction. The tenant parameter keeps write paths explicit.
 * The optional node setting is transaction-local and bound through set_config, because SET
 * utility statements do not accept bound parameters.
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
