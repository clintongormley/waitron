import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";

export type ChainHeight = { height: number; lastAt: string | null };

/** The latest fiscal record by chain position, across identities on this node. */
export async function readChainHeight(tx: Transaction, nodeId: string): Promise<ChainHeight> {
  const {
    rows: [row],
  } = await tx.execute<{ secuencia: number; creado_en: string }>(
    sql`select secuencia, creado_en from verifactu_records where node_id = ${nodeId}
        order by secuencia desc limit 1`,
  );
  if (row === undefined) return { height: 0, lastAt: null };
  return { height: row.secuencia, lastAt: new Date(row.creado_en).toISOString() };
}
