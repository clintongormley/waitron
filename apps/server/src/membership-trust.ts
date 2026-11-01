import { AppError } from "@waitron/shared";
import type { NodeDatabase } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import { nodeSigningPublicKey } from "@waitron/credentials";
import { readPinnedPrimaryKey } from "@waitron/node-db";
import {
  verifyMembershipDocument,
  type SignedMembershipDocument,
  type TrustSet,
} from "@waitron/membership";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { readNodeIdentityKey } from "./node-identity.js";

export interface StoredTrustDeps {
  readonly node: NodeDatabase;
  readonly ring: KeyRing;
  readonly nodeId: string;
}

/** A route that signs over the held chart maps this refusal to 409. */
export const HELD_DOCUMENT_REFUSALS: Record<string, ContentfulStatusCode> = {
  "membership.held_untrusted": 409,
};

/**
 * The keys this box stores itself: its own public key, derived from the signing key sealed in
 * node.db, and the main box's key it pinned when there is one. Never the keys venue.db names, which
 * a copied venue.db brings with it.
 */
export async function readStoredTrustSet(deps: StoredTrustDeps): Promise<TrustSet> {
  const own = nodeSigningPublicKey(await readNodeIdentityKey(deps.node, deps.ring, deps.nodeId));
  const pinned = await readPinnedPrimaryKey(deps.node, deps.nodeId);
  return pinned === null
    ? { [deps.nodeId]: own }
    : { [pinned.primaryNodeId]: pinned.publicKey, [deps.nodeId]: own };
}

/**
 * Refuses to sign over a held chart whose signer or signature no stored key vouches for. A null
 * chart passes, and so does a malformed one: the checks after this one refuse it with their own
 * codes. No held chart is passed as the third argument, because the removal rule would refuse a
 * retirement chart signed by the spare it evicts.
 */
export async function assertHeldDocumentTrusted(
  deps: StoredTrustDeps,
  held: SignedMembershipDocument | null,
): Promise<void> {
  if (held === null) return;
  const verdict = verifyMembershipDocument(held, await readStoredTrustSet(deps), null);
  if (verdict.valid || verdict.reason === "malformed") return;
  throw new AppError("membership.held_untrusted", { reason: verdict.reason });
}
