import { eq } from "drizzle-orm";
import { type NodeDatabase, type NodeTransaction } from "@waitron/db";
import { box } from "./schema/box.js";
import { writeBoxRecoveryKeyTx } from "./box.js";

/**
 * This node's recovery-key verifier and the name of the key in force (`null` when blank), or
 * `null` when the node has no recovery-key group.
 */
export async function readRecoveryKey(
  node: NodeDatabase | NodeTransaction,
  nodeId: string,
): Promise<{ verifier: string; keyName: string | null } | null> {
  const [row] = await node
    .select({ verifier: box.recoveryKeyVerifier, keyName: box.recoveryKeyName })
    .from(box)
    .where(eq(box.nodeId, nodeId));
  if (row?.verifier == null) return null;
  return { verifier: row.verifier, keyName: row.keyName!.trim() === "" ? null : row.keyName! };
}

/** This node's recovery-key verifier, or `null` when the node has no recovery-key group. */
export async function readRecoveryKeyVerifier(
  node: NodeDatabase | NodeTransaction,
  nodeId: string,
): Promise<string | null> {
  return (await readRecoveryKey(node, nodeId))?.verifier ?? null;
}

/** The name of this node's recovery key in force, or `null` when there is none or it is blank. */
export async function readRecoveryKeyName(
  node: NodeDatabase | NodeTransaction,
  nodeId: string,
): Promise<string | null> {
  return (await readRecoveryKey(node, nodeId))?.keyName ?? null;
}

/**
 * Upserts this node's recovery-key verifier and name on a caller's node transaction, so an earlier
 * key stops verifying.
 */
export async function setRecoveryKeyTx(
  tx: NodeTransaction,
  nodeId: string,
  verifier: string,
  keyName: string,
): Promise<void> {
  await writeBoxRecoveryKeyTx(tx, nodeId, { verifier, keyName });
}
