import { AppError } from "@waitron/shared";
import type { NodeDatabase } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import { nodeSigningPublicKey } from "@waitron/credentials";
import { readPinnedPrimaryKey } from "@waitron/node-db";
import {
  MAX_NODES,
  MAX_REVOKED,
  verifyDocumentSigner,
  type SignedMembershipDocument,
  type TrustSet,
} from "@waitron/membership";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { readNodeIdentityKey } from "./node-identity.js";
import "./errors.js";

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
 * Refuses to sign over a held chart whose signer or signature no stored key vouches for, whatever
 * its shape, and one too broken to tell (`reason: "malformed"`). A null chart passes, and so does a
 * malformed one a stored key signed: the checks after this one refuse it with their own codes. The
 * removal rule is not applied, because it would refuse a retirement chart signed by the spare it
 * evicts.
 */
export async function assertHeldDocumentTrusted(
  deps: StoredTrustDeps,
  held: SignedMembershipDocument | null,
): Promise<void> {
  if (held === null) return;
  const verdict = verifyDocumentSigner(held, await readStoredTrustSet(deps));
  if (verdict.trusted) return;
  throw new AppError("membership.held_untrusted", { reason: verdict.reason });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isReadableNode(v: unknown): boolean {
  return (
    isRecord(v) &&
    typeof v.nodeId === "string" &&
    typeof v.contactUrl === "string" &&
    typeof v.standing === "string"
  );
}

function isReadableChart(held: unknown): boolean {
  if (!isRecord(held) || !isRecord(held.body)) return false;
  const { term, nodes, revoked } = held.body;
  if (typeof term !== "number" || !Number.isInteger(term) || term < 0) return false;
  if (!Array.isArray(nodes) || nodes.length > MAX_NODES || !nodes.every(isReadableNode))
    return false;
  if (revoked === undefined) return true;
  return (
    Array.isArray(revoked) &&
    revoked.length <= MAX_REVOKED &&
    revoked.every((id) => typeof id === "string")
  );
}

/**
 * Refuses a held chart whose body cannot be read as a membership chart (`reason: "malformed"`),
 * before anything reads it. Duplicate ids and fields beyond the declared ones still pass, so a chart
 * a stored key signed keeps the code the checks after this one give it.
 */
export function assertHeldDocumentReadable(held: SignedMembershipDocument | null): void {
  if (held === null || isReadableChart(held)) return;
  throw new AppError("membership.held_untrusted", { reason: "malformed" });
}
