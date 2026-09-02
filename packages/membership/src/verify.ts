import { canonicalize } from "./canonicalize.js";
import type { CanonicalValue } from "./canonicalize.js";
import { signBytes, verifyBytes } from "./crypto.js";
import { resolveSignerKey } from "./endorsement.js";
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

export function signDocumentBody(body: MembershipDocumentBody, signerPrivateKey: string): string {
  return signBytes(bodyMessage(body), signerPrivateKey);
}

/** The exact bytes a document signature covers. */
function bodyMessage(body: MembershipDocumentBody): string {
  return canonicalize(bodyToCanonical(body));
}

function bodyToCanonical(body: MembershipDocumentBody): CanonicalValue {
  return {
    term: body.term,
    nodes: body.nodes.map((n) => ({
      nodeId: n.nodeId,
      contactUrl: n.contactUrl,
      standing: n.standing,
    })),
  };
}

function isNode(v: unknown): v is MembershipNode {
  if (v === null || typeof v !== "object") return false;
  const n = v as Record<string, unknown>;
  return (
    typeof n.nodeId === "string" &&
    typeof n.contactUrl === "string" &&
    typeof n.standing === "string" &&
    STANDINGS.includes(n.standing as NodeStanding)
  );
}

function isEndorsement(v: unknown): v is Endorsement {
  if (v === null || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.nodeId === "string" &&
    typeof e.publicKey === "string" &&
    typeof e.endorsedBy === "string" &&
    typeof e.signature === "string"
  );
}

function isDocument(v: unknown): v is SignedMembershipDocument {
  if (v === null || typeof v !== "object") return false;
  const d = v as Record<string, unknown>;
  if (typeof d.signerNodeId !== "string" || typeof d.signature !== "string") return false;
  if (!Array.isArray(d.endorsements) || !d.endorsements.every(isEndorsement)) return false;
  const b = d.body as Record<string, unknown> | undefined;
  if (b === undefined || typeof b !== "object" || b === null) return false;
  if (typeof b.term !== "number" || !Number.isInteger(b.term)) return false;
  if (!Array.isArray(b.nodes) || !b.nodes.every(isNode)) return false;
  return true;
}

export function verifyMembershipDocument(
  doc: SignedMembershipDocument,
  trustSet: TrustSet,
): VerifyResult {
  if (!isDocument(doc)) return { valid: false, reason: "malformed" };
  const signerKey = resolveSignerKey(doc.signerNodeId, doc.endorsements, trustSet);
  if (signerKey === null) {
    // Either the signer is unknown, or an endorsement it relied on failed to chain/verify.
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
