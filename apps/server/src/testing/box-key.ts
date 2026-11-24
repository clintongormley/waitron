import type { NodeDatabase } from "@waitron/db";
import { verifySecretAsync } from "@waitron/identity";
import { readRecoveryKeyVerifier } from "@waitron/node-db";

/** Whether node.db holds `secret` as this node's box key; `false` when it holds none. */
export async function boxKeyStored(
  node: NodeDatabase,
  nodeId: string,
  secret: string,
): Promise<boolean> {
  const verifier = await readRecoveryKeyVerifier(node, nodeId);
  return verifier !== null && (await verifySecretAsync(secret, verifier));
}
