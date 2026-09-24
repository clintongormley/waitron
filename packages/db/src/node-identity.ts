import { eq } from "drizzle-orm";
import type { TrustSet } from "@waitron/membership";
import type { Database, Transaction } from "./client.js";
import { nodes } from "./schema/nodes.js";
import { withTransaction } from "./tenancy.js";

export async function setNodePublicKeyTx(
  tx: Transaction,
  nodeId: string,
  publicKey: string,
): Promise<void> {
  await tx.update(nodes).set({ publicKey }).where(eq(nodes.id, nodeId));
}

/**
 * Stamp a node's membership identity PUBLIC key in a transaction of its own. A caller that must
 * stamp atomically alongside another write uses `setNodePublicKeyTx` inside one shared
 * `withTransaction` instead.
 */
export function setNodePublicKey(db: Database, nodeId: string, publicKey: string): Promise<void> {
  return withTransaction(db, (tx) => setNodePublicKeyTx(tx, nodeId, publicKey));
}

/**
 * The node's membership trust anchors: every `nodes` row's `{ id → public_key }`, skipping the
 * keyless ones. A cloud mirror gets an EMPTY set, because nothing creates a `nodes` row on it
 * today: `adoptFromPrimary` inserts no venue rows (`apps/server/src/adopt.ts`), and the standby's
 * OWN row cannot be inserted without the venue's `locations` row it foreign-keys to.
 */
export function readMembershipTrustSet(db: Database): Promise<TrustSet> {
  return withTransaction(db, async (tx) => {
    const rows = await tx.select({ id: nodes.id, publicKey: nodes.publicKey }).from(nodes);
    const trust: Record<string, string> = {};
    for (const r of rows) if (r.publicKey !== null) trust[r.id] = r.publicKey;
    return trust;
  });
}
