import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";

/**
 * This node's fiscal-chain head: `height` is `cadenas.secuencia`, the monotonic chain height that is
 * never reset, and `lastAt` is `cadenas.actualizado_en` (when the head last advanced) as an ISO
 * string. `{ height: 0, lastAt: null }` when this node has no `cadenas` row at all — an unrecognised
 * `node_id`; a provisioned node always has one, seeded at secuencia 0 by `registerSif`.
 */
export type ChainHeight = { height: number; lastAt: string | null };

/**
 * The deployment holds one tenant per database. Read this node's chain head. The caller supplies
 * a `tx` inside `withTransaction`. The read filters by `node_id` for this SIF's chain.
 */
export async function readChainHeight(tx: Transaction, nodeId: string): Promise<ChainHeight> {
  // A raw `.execute()` bypasses the column's own read mapping, so `actualizado_en` arrives as the
  // stored TEXT rather than as a `Date`. Measured on this tree, through this exact
  // `withTransaction` + `tx.execute` path: a `text` column comes back with `typeof === "string"` and
  // the stored bytes unchanged, an `integer` column with `typeof === "number"`. `new Date(…)
  // .toISOString()` normalises whatever spelling the writer stored into a proper ISO string, and
  // stays correct if the value ever arrives as a `Date` instead.
  const result = await tx.execute<{ secuencia: number; actualizado_en: string }>(
    sql`select secuencia, actualizado_en from cadenas where node_id = ${nodeId}`,
  );
  const row = result.rows[0];
  if (row === undefined) return { height: 0, lastAt: null };
  return { height: row.secuencia, lastAt: new Date(row.actualizado_en).toISOString() };
}
