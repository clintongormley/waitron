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

// Structural cap on how many endorsements a document may carry. Spec §2 caps the topology at 3
// nodes (2 local + 1 cloud), so a legitimate document needs only a couple of endorsements; 8 is
// generous headroom. The bound stops an adversarial document from the (future) network surface
// forcing an unbounded number of Ed25519 verifications. Raising it later is a widen, not a
// breaking change.
const MAX_ENDORSEMENTS = 8;

export function signDocumentBody(body: MembershipDocumentBody, signerPrivateKey: string): string {
  // signerNodeId is deliberately NOT part of the signed bytes (bodyMessage covers the whole body —
  // term + nodes — and nothing else): it merely selects which trusted key to verify against. A
  // mutated signerNodeId is always rejected — as untrusted_signer or endorsement_invalid if it
  // resolves to no trusted key, or as bad_signature if it resolves to a DIFFERENT trusted key —
  // because the signature must still verify against whichever key it selects; it is authenticated
  // TRANSITIVELY, not directly. Do not "fix" this by folding signerNodeId (or, for endorsements,
  // endorsedBy) into the signed payload; that would change the wire format.
  return signBytes(bodyMessage(body), signerPrivateKey);
}

/**
 * The exact bytes a document signature covers: the canonicalized WHOLE body (spec §3). The strict
 * key-count guards in isNode/isDocument guarantee a verified body carries only its declared fields,
 * so signing `body` directly is byte-identical to the old hand-picked projection for any valid body
 * while making it impossible for a future-added, unsigned field to slip through verify unsigned.
 */
function bodyMessage(body: MembershipDocumentBody): string {
  return canonicalize(body as unknown as CanonicalValue);
}

// Note: typeof [] === "object", so isRecord([]) is true — the per-field checks below (and the
// Array.isArray guards on nodes/endorsements) do the array-vs-plain-object discrimination.
function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object";
}

// Each guard also asserts an exact own-key COUNT after the required fields check, so an object
// carrying an EXTRA (unsigned) field is rejected as malformed. This is what makes "a verified
// document IS exactly its signed content" true: bodyMessage signs the whole body, and these guards
// guarantee the body (and its nodes) hold nothing beyond the fields that were signed. Object.keys
// returns only own enumerable keys, which is exactly the shape of JSON-parsed wire input.
function isNode(v: unknown): v is MembershipNode {
  if (!isRecord(v)) return false;
  return (
    typeof v.nodeId === "string" &&
    typeof v.contactUrl === "string" &&
    typeof v.standing === "string" &&
    STANDINGS.includes(v.standing as NodeStanding) &&
    Object.keys(v).length === 3 // nodeId, contactUrl, standing — no extra keys
  );
}

function isEndorsement(v: unknown): v is Endorsement {
  if (!isRecord(v)) return false;
  return (
    typeof v.nodeId === "string" &&
    typeof v.publicKey === "string" &&
    typeof v.endorsedBy === "string" &&
    typeof v.signature === "string" &&
    Object.keys(v).length === 4 // nodeId, publicKey, endorsedBy, signature — no extra keys
  );
}

function isDocument(v: unknown): v is SignedMembershipDocument {
  if (!isRecord(v)) return false;
  if (typeof v.signerNodeId !== "string" || typeof v.signature !== "string") return false;
  if (!Array.isArray(v.endorsements) || !v.endorsements.every(isEndorsement)) return false;
  if (v.endorsements.length > MAX_ENDORSEMENTS) return false;
  const b = v.body;
  // typeof undefined !== "object", so isRecord also rejects a missing body — no separate
  // `=== undefined` arm needed.
  if (!isRecord(b)) return false;
  if (typeof b.term !== "number" || !Number.isInteger(b.term)) return false;
  // Unlike `endorsements` (capped at MAX_ENDORSEMENTS above), `nodes.length` is intentionally NOT
  // capped in Slice 1. Spec §2 is a 3-node topology, but the exact bound DURING a node-replacement
  // transition (old + new + cloud simultaneously) is a Slice-2/3 design question — deferred
  // deliberately rather than guessed at here.
  if (!Array.isArray(b.nodes) || !b.nodes.every(isNode)) return false;
  if (Object.keys(b).length !== 2) return false; // body: term, nodes — no extra keys
  if (Object.keys(v).length !== 4) return false; // document: body, signerNodeId, signature, endorsements
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
