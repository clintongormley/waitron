import { canonicalize } from "./canonicalize.js";
import type { CanonicalValue } from "./canonicalize.js";
import { signBytes, verifyBytes } from "./crypto.js";
import { resolveSignerKey } from "./endorsement.js";
import { fencedOutNodeIds } from "./fence.js";
import type {
  Endorsement,
  MembershipDocumentBody,
  MembershipNode,
  NodeStanding,
  SignedMembershipDocument,
  TrustSet,
  VerifyResult,
} from "./types.js";

const STANDINGS: readonly NodeStanding[] = [
  "serving-primary",
  "serving-secondary",
  "sell-only",
  "evicted",
];

// Every cap bounds what an adversarial document can make us do (Ed25519 verifications, memory).
// MAX_NODES is exported because it is also the most machines one chart can list.
const MAX_ENDORSEMENTS = 8;

export const MAX_NODES = 8;

/** Revoked ids do not count toward MAX_NODES. */
export const MAX_REVOKED = 256;

export function signDocumentBody(body: MembershipDocumentBody, signerPrivateKey: string): string {
  // signerNodeId is deliberately NOT signed: it only selects the key, and the signature must verify
  // against whichever key it selects, so it is authenticated transitively. Folding it in would
  // change the wire format.
  return signBytes(bodyMessage(body), signerPrivateKey);
}

/** Signs the WHOLE body, so no field added later can pass verification unsigned. */
function bodyMessage(body: MembershipDocumentBody): string {
  return canonicalize(body as unknown as CanonicalValue);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object";
}

// The exact key COUNTS refuse any field beyond the declared ones, at every level — including an
// unsigned one beside `body`, which the signature does not cover.
function isNode(v: unknown): v is MembershipNode {
  if (!isRecord(v)) return false;
  return (
    typeof v.nodeId === "string" &&
    typeof v.contactUrl === "string" &&
    typeof v.standing === "string" &&
    STANDINGS.includes(v.standing as NodeStanding) &&
    Object.keys(v).length === 3
  );
}

/** Present only non-empty, without duplicates, and naming no id `nodes` also lists. */
function isRevokedList(v: unknown, nodes: readonly MembershipNode[]): boolean {
  if (!Array.isArray(v)) return false;
  if (v.length === 0 || v.length > MAX_REVOKED) return false;
  if (!v.every((id) => typeof id === "string")) return false;
  if (new Set(v).size !== v.length) return false;
  return !nodes.some((n) => v.includes(n.nodeId));
}

function isEndorsement(v: unknown): v is Endorsement {
  if (!isRecord(v)) return false;
  return (
    typeof v.nodeId === "string" &&
    typeof v.publicKey === "string" &&
    typeof v.endorsedBy === "string" &&
    typeof v.signature === "string" &&
    Object.keys(v).length === 4
  );
}

export function isMembershipDocument(v: unknown): v is SignedMembershipDocument {
  if (!isRecord(v)) return false;
  if (typeof v.signerNodeId !== "string" || typeof v.signature !== "string") return false;
  if (!Array.isArray(v.endorsements)) return false;
  if (v.endorsements.length > MAX_ENDORSEMENTS) return false;
  if (!v.endorsements.every(isEndorsement)) return false;
  const b = v.body;
  if (!isRecord(b)) return false;
  if (typeof b.term !== "number" || !Number.isInteger(b.term) || b.term < 0) return false;
  if (!Array.isArray(b.nodes)) return false;
  if (b.nodes.length > MAX_NODES) return false;
  if (!b.nodes.every(isNode)) return false;
  const bodyKeys = Object.keys(b).length;
  if ("revoked" in b) {
    if (bodyKeys !== 3 || !isRevokedList(b.revoked, b.nodes)) return false;
  } else if (bodyKeys !== 2) return false;
  if (Object.keys(v).length !== 4) return false;
  return true;
}

/**
 * `held` is the receiver's OWN held chart; omitted or null, nobody is shut out. With it, a chart
 * signed by a node `fencedOutNodeIds(held)` names is refused `signer_removed` — trust anchor or
 * not — and `resolveSignerKey` narrows what that node's key can vouch for.
 */
export function verifyMembershipDocument(
  doc: SignedMembershipDocument,
  trustSet: TrustSet,
  held: SignedMembershipDocument | null = null,
): VerifyResult {
  if (!isMembershipDocument(doc)) return { valid: false, reason: "malformed" };
  const removed = fencedOutNodeIds(held);
  if (removed.has(doc.signerNodeId)) return { valid: false, reason: "signer_removed" };
  const signerKey = resolveSignerKey(doc.signerNodeId, doc.endorsements, trustSet, held, removed);
  if (signerKey === null) {
    return {
      valid: false,
      reason: doc.endorsements.length > 0 ? "endorsement_invalid" : "untrusted_signer",
    };
  }
  if (!verifyBytes(bodyMessage(doc.body), doc.signature, signerKey)) {
    return { valid: false, reason: "bad_signature" };
  }
  return {
    valid: true,
    term: doc.body.term,
    signerNodeId: doc.signerNodeId,
    nodes: doc.body.nodes,
  };
}
