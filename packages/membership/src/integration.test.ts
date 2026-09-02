import { describe, expect, it } from "vitest";
import {
  acceptMembershipDocument,
  endorseKey,
  generateNodeKeyPair,
  signDocumentBody,
  type MembershipDocumentBody,
  type SignedMembershipDocument,
  type TrustSet,
} from "./index.js";

function build(
  term: number,
  signerNodeId: string,
  priv: string,
  endorsements: SignedMembershipDocument["endorsements"] = [],
): SignedMembershipDocument {
  const body: MembershipDocumentBody = {
    term,
    nodes: [
      { nodeId: "server-1", contactUrl: "https://s1", standing: "serving-secondary" },
      { nodeId: "server-2", contactUrl: "https://s2", standing: "serving-primary" },
    ],
  };
  return { body, signerNodeId, signature: signDocumentBody(body, priv), endorsements };
}

describe("membership end-to-end", () => {
  it("promotes across a failover, rejects a replay, and rejects a forgery", () => {
    // Setup: server-1 is the original primary, its key trusted by everyone.
    const s1 = generateNodeKeyPair();
    const s2 = generateNodeKeyPair();
    const trust: TrustSet = { "server-1": s1.publicKey };

    // term 0: server-1 issues the setup document, endorsing server-2's key into the trust set.
    const setupDoc = build(0, "server-1", s1.privateKey, [
      endorseKey("server-2", s2.publicKey, "server-1", s1.privateKey),
    ]);
    const atSetup = acceptMembershipDocument(setupDoc, null, trust);
    expect(atSetup.accepted).toBe(true);

    // Failover: server-2 is promoted and issues term 1, signed by its own (now-endorsed) key.
    const promoteDoc = build(1, "server-2", s2.privateKey, [
      endorseKey("server-2", s2.publicKey, "server-1", s1.privateKey),
    ]);
    const afterPromote = acceptMembershipDocument(promoteDoc, 0, trust);
    expect(afterPromote.accepted).toBe(true);

    // A returning server-1 replays its old term-0 document — rejected as not newer.
    expect(acceptMembershipDocument(setupDoc, 1, trust)).toEqual({
      accepted: false,
      reason: "not_newer",
    });

    // A rogue node forges a higher term with a key nobody trusts — rejected as invalid.
    const rogue = generateNodeKeyPair();
    const forged = build(9, "rogue", rogue.privateKey);
    expect(acceptMembershipDocument(forged, 1, trust)).toEqual({
      accepted: false,
      reason: "invalid",
      failure: "untrusted_signer",
    });
  });
});
