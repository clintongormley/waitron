/** A node's serving standing in the venue (design §3). */
export type NodeStanding = "serving-primary" | "serving-secondary" | "sell-only" | "evicted";

export interface MembershipNode {
  readonly nodeId: string;
  readonly contactUrl: string;
  readonly standing: NodeStanding;
}

/** The signed payload. `term` is the monotonic membership generation (design §3). */
export interface MembershipDocumentBody {
  readonly term: number;
  readonly nodes: readonly MembershipNode[];
}

/** A member key vouched for by an already-trusted node, chaining back to setup (design §4). */
export interface Endorsement {
  readonly nodeId: string;
  readonly publicKey: string; // base64 SPKI DER of the endorsed node's identity key
  readonly endorsedBy: string; // nodeId of the endorser (must itself be trusted)
  readonly signature: string; // base64 Ed25519 over canonicalize({ nodeId, publicKey }) by endorsedBy
}

export interface SignedMembershipDocument {
  readonly body: MembershipDocumentBody;
  readonly signerNodeId: string; // the serving-primary that signed
  readonly signature: string; // base64 Ed25519 over canonicalize(body)
  readonly endorsements: readonly Endorsement[];
}

/** base64 DER: publicKey SPKI, privateKey PKCS8. */
export interface NodeKeyPair {
  readonly publicKey: string;
  readonly privateKey: string;
}

/** nodeId → base64 SPKI public key, the receiver's setup-established trust anchor. */
export type TrustSet = Readonly<Record<string, string>>;

export type VerifyFailure =
  "malformed" | "untrusted_signer" | "bad_signature" | "endorsement_invalid";

export type VerifyResult =
  | {
      readonly valid: true;
      readonly term: number;
      readonly signerNodeId: string;
      readonly nodes: readonly MembershipNode[];
    }
  | { readonly valid: false; readonly reason: VerifyFailure };

export type AcceptResult =
  | { readonly accepted: true; readonly document: SignedMembershipDocument }
  | { readonly accepted: false; readonly reason: "invalid"; readonly failure: VerifyFailure }
  | { readonly accepted: false; readonly reason: "not_newer" };
