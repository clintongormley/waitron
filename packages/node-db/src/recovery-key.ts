import { eq } from "drizzle-orm";
import { now, tableExists, type NodeDatabase, type NodeTransaction } from "@waitron/db";
import { nodeRecoveryKey } from "./schema/node-recovery-key.js";

/**
 * This node's recovery-key verifier and the name of the key in force (`null` when blank), or
 * `null` when the table is absent or has no row for the node.
 */
export async function readRecoveryKey(
  node: NodeDatabase | NodeTransaction,
  nodeId: string,
): Promise<{ verifier: string; keyName: string | null } | null> {
  if (!(await tableExists(node, "node_recovery_key"))) return null;
  const [row] = await node
    .select({ verifier: nodeRecoveryKey.verifier, keyName: nodeRecoveryKey.keyName })
    .from(nodeRecoveryKey)
    .where(eq(nodeRecoveryKey.nodeId, nodeId));
  if (row === undefined) return null;
  return { verifier: row.verifier, keyName: row.keyName.trim() === "" ? null : row.keyName };
}

/** This node's recovery-key verifier, or `null` when the table is absent or has no row for it. */
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
  await tx
    .insert(nodeRecoveryKey)
    .values({ nodeId, verifier, keyName })
    .onConflictDoUpdate({
      target: nodeRecoveryKey.nodeId,
      set: { verifier, keyName, updatedAt: now() },
    });
}
