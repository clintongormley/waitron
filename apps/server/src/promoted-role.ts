import {
  readNodeMembership,
  withNodeTransaction,
  type Database,
  type DeploymentMode,
  type NodeDatabase,
  type SingletonRole,
} from "@waitron/db";
import { readNodeMode, setPrimaryRoleTx } from "@waitron/node-db";
import { nodeSigningPublicKey, readNodeSigningKey, type KeyRing } from "@waitron/credentials";
import {
  standingOf,
  verifyMembershipDocument,
  type SignedMembershipDocument,
} from "@waitron/membership";
import type { Logger } from "./logger.js";

export interface FinishPromotedRoleDeps {
  readonly venue: Database;
  readonly node: NodeDatabase;
  readonly ring: KeyRing;
  readonly nodeId: string;
  readonly log: Logger;
}

/** This node's two role axes and the held chart, when the caller has just read them. */
export interface PromotedRoleReads {
  readonly axes: { readonly mode: DeploymentMode; readonly singletonRole: SingletonRole };
  readonly held: SignedMembershipDocument | null;
}

/**
 * Writes primary/primary to node.db when the held chart is one this box signed with its own key
 * naming itself the serving primary: a promotion whose venue save committed and whose role write
 * was lost. Trusting only this box's own key is what keeps this from being a self-promotion: no
 * other box's chart, and no chart merely claiming this box as signer, can move it. A signing key
 * the ring cannot open makes it throw rather than answer "nothing", leaving the mode as it was.
 */
export async function finishPromotedRole(
  deps: FinishPromotedRoleDeps,
  reads?: PromotedRoleReads,
): Promise<"finished" | "nothing"> {
  const axes = reads?.axes ?? (await readNodeMode(deps.node, deps.nodeId));
  if (axes.mode === "primary" && axes.singletonRole === "primary") return "nothing";

  const held = reads === undefined ? await readNodeMembership(deps.venue) : reads.held;
  if (held === null) return "nothing";
  if (held.signerNodeId !== deps.nodeId) return "nothing";
  if (standingOf(held, deps.nodeId) !== "serving-primary") return "nothing";

  const privateKey = await readNodeSigningKey(deps.node, deps.ring, deps.nodeId);
  if (privateKey === null) return "nothing";
  const verified = verifyMembershipDocument(
    held,
    { [deps.nodeId]: nodeSigningPublicKey(privateKey) },
    null,
  );
  if (!verified.valid) return "nothing";

  await withNodeTransaction(deps.node, (tx) => setPrimaryRoleTx(tx, deps.nodeId));
  deps.log("warn", "promotion.role_finished", { term: held.body.term });
  return "finished";
}
