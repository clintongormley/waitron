import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";

/**
 * This node's fiscal-chain head: `height` is `cadenas.secuencia`, the monotonic chain height that is
 * never reset, and `lastAt` is `cadenas.actualizado_en` (when the head last advanced) as an ISO
 * string. `{ height: 0, lastAt: null }` when no `cadenas` row exists yet — a freshly provisioned node
 * before its first sale.
 */
export type ChainHeight = { height: number; lastAt: string | null };

/**
 * Read this node's chain head under the AMBIENT tenant. The caller supplies a `tx` already inside
 * `withTenant` + `asAppUser`, so `cadenas`'s RLS/FORCE-RLS scopes the read to this tenant; the
 * `node_id` predicate narrows it to this SIF's chain.
 */
export async function readChainHeight(tx: Transaction, nodeId: string): Promise<ChainHeight> {
  const result = await tx.execute<{ secuencia: number; actualizado_en: string }>(
    sql`select secuencia, actualizado_en from cadenas where node_id = ${nodeId}`,
  );
  const row = result.rows[0];
  if (row === undefined) return { height: 0, lastAt: null };
  return { height: row.secuencia, lastAt: new Date(row.actualizado_en).toISOString() };
}
