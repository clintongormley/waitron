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
 * Read this node's chain head under the AMBIENT tenant. The caller supplies a `tx` already inside
 * `withTenant` + `asAppUser`, so `cadenas`'s RLS/FORCE-RLS scopes the read to this tenant; the
 * `node_id` predicate narrows it to this SIF's chain.
 */
export async function readChainHeight(tx: Transaction, nodeId: string): Promise<ChainHeight> {
  // Drizzle's node-postgres `.execute()` returns `actualizado_en` as a STRING, not a `Date` — verified
  // 2026-08-29: this select yields `"2026-08-29 10:00:00+00"` (pg's space-separated timestamptz form,
  // not ISO-8601). `new Date(...).toISOString()` normalises that into a proper ISO string.
  const result = await tx.execute<{ secuencia: number; actualizado_en: string }>(
    sql`select secuencia, actualizado_en from cadenas where node_id = ${nodeId}`,
  );
  const row = result.rows[0];
  if (row === undefined) return { height: 0, lastAt: null };
  return { height: row.secuencia, lastAt: new Date(row.actualizado_en).toISOString() };
}
