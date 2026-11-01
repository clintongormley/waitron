import { sealNodeSigningKeyTx, type KeyRing } from "@waitron/credentials";
import { withNodeTransaction, type NodeDatabase } from "@waitron/db";
import type { StandbyIdentity } from "../reserved-identity.js";

/** Seals a standby's signing key in its node.db, as `adoptFromPrimary` does at adopt. */
export async function sealAdoptedStandbyKey(
  node: NodeDatabase,
  ring: KeyRing,
  standby: StandbyIdentity,
): Promise<void> {
  await withNodeTransaction(node, (tx) =>
    sealNodeSigningKeyTx(tx, ring, standby.nodeId, standby.privateKey),
  );
}
