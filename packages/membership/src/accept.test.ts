import { describe, expect, it } from "vitest";
import { generateNodeKeyPair } from "./crypto.js";
import { sampleBody, signDoc } from "./document-fixtures.js";
import { acceptMembershipDocument } from "./accept.js";
import { endorseKey } from "./endorsement.js";
import { signDocumentBody } from "./verify.js";
import type { MembershipDocumentBody, SignedMembershipDocument, TrustSet } from "./types.js";

describe("acceptMembershipDocument", () => {
  const a = generateNodeKeyPair();
  const trust: TrustSet = { A: a.publicKey };

  it("accepts a valid, strictly-newer document", () => {
    const r = acceptMembershipDocument(signDoc(sampleBody(2), "A", a.privateKey), 1, trust);
    expect(r.accepted).toBe(true);
  });
  it("accepts a valid document when none is held yet (null current)", () => {
    const r = acceptMembershipDocument(signDoc(sampleBody(0), "A", a.privateKey), null, trust);
    expect(r.accepted).toBe(true);
  });
  it("rejects an equal term as not_newer", () => {
    expect(acceptMembershipDocument(signDoc(sampleBody(2), "A", a.privateKey), 2, trust)).toEqual({
      accepted: false,
      reason: "not_newer",
    });
  });
  it("rejects a lower term as not_newer", () => {
    expect(acceptMembershipDocument(signDoc(sampleBody(1), "A", a.privateKey), 2, trust)).toEqual({
      accepted: false,
      reason: "not_newer",
    });
  });
  it("treats a held term of 0 as held, not as nothing held (=== null, not falsy)", () => {
    expect(acceptMembershipDocument(signDoc(sampleBody(0), "A", a.privateKey), 0, trust)).toEqual({
      accepted: false,
      reason: "not_newer",
    });
  });
  it("rejects an untrusted document as invalid, carrying the verify failure", () => {
    expect(acceptMembershipDocument(signDoc(sampleBody(9), "A", a.privateKey), 1, {})).toEqual({
      accepted: false,
      reason: "invalid",
      failure: "untrusted_signer",
    });
  });
});

describe("acceptMembershipDocument with the receiver's held chart", () => {
  const primary = generateNodeKeyPair();
  const removed = generateNodeKeyPair();
  const trust: TrustSet = { P: primary.publicKey };
  const heldBody = (standingOfR: "evicted" | "serving-secondary"): MembershipDocumentBody => ({
    term: 1,
    nodes: [
      { nodeId: "P", contactUrl: "https://p", standing: "serving-primary" },
      { nodeId: "R", contactUrl: "https://r", standing: standingOfR },
    ],
  });
  // R promotes itself on the key P vouched for when it joined.
  const selfPromotion = (): SignedMembershipDocument => {
    const body: MembershipDocumentBody = {
      term: 2,
      nodes: [
        { nodeId: "P", contactUrl: "https://p", standing: "sell-only" },
        { nodeId: "R", contactUrl: "https://r", standing: "serving-primary" },
      ],
    };
    return {
      body,
      signerNodeId: "R",
      signature: signDocumentBody(body, removed.privateKey),
      endorsements: [endorseKey("R", removed.publicKey, "P", primary.privateKey)],
    };
  };

  const refused = (failure: string) => ({ accepted: false, reason: "invalid", failure });

  it("refuses a newer chart signed by a node the held chart lists evicted, despite its endorsement", () => {
    const held = signDoc(heldBody("evicted"), "P", primary.privateKey);
    expect(acceptMembershipDocument(selfPromotion(), 1, trust, held)).toEqual(
      refused("signer_removed"),
    );
  });

  it("refuses a newer chart signed by a node the held chart has revoked", () => {
    const held = signDoc(
      {
        term: 1,
        nodes: [{ nodeId: "P", contactUrl: "https://p", standing: "serving-primary" }],
        revoked: ["R"],
      },
      "P",
      primary.privateKey,
    );
    expect(acceptMembershipDocument(selfPromotion(), 1, trust, held)).toEqual(
      refused("signer_removed"),
    );
  });

  it("accepts that same chart when no held chart is passed, or nothing is held", () => {
    expect(acceptMembershipDocument(selfPromotion(), 1, trust).accepted).toBe(true);
    expect(acceptMembershipDocument(selfPromotion(), 1, trust, null).accepted).toBe(true);
  });

  it("accepts that same chart while the held chart lists its signer in good standing", () => {
    const held = signDoc(heldBody("serving-secondary"), "P", primary.privateKey);
    expect(acceptMembershipDocument(selfPromotion(), 1, trust, held).accepted).toBe(true);
  });

  // R, removed, vouches for key F; P vouched for R's key when R joined.
  const signedByVouchedKey = (fId: string, nodes: MembershipDocumentBody["nodes"]) => {
    const f = generateNodeKeyPair();
    const body: MembershipDocumentBody = { term: 2, nodes };
    return {
      body,
      signerNodeId: fId,
      signature: signDocumentBody(body, f.privateKey),
      endorsements: [
        endorseKey("R", removed.publicKey, "P", primary.privateKey),
        endorseKey(fId, f.publicKey, "R", removed.privateKey),
      ],
    } satisfies SignedMembershipDocument;
  };

  it("does not trust a fresh key vouched for by a removed node", () => {
    const held = signDoc(heldBody("evicted"), "P", primary.privateKey);
    const doc = signedByVouchedKey("F", [
      { nodeId: "F", contactUrl: "https://f", standing: "serving-primary" },
    ]);
    expect(acceptMembershipDocument(doc, 1, trust, held)).toEqual(refused("endorsement_invalid"));
  });

  it("does not trust a removed non-anchor node's key even for a node in good standing", () => {
    const held = signDoc(
      {
        term: 1,
        nodes: [
          { nodeId: "P", contactUrl: "https://p", standing: "serving-primary" },
          { nodeId: "R", contactUrl: "https://r", standing: "evicted" },
          { nodeId: "S", contactUrl: "https://s", standing: "serving-secondary" },
        ],
      },
      "P",
      primary.privateKey,
    );
    const doc = signedByVouchedKey("S", [
      { nodeId: "S", contactUrl: "https://s", standing: "serving-primary" },
    ]);
    expect(acceptMembershipDocument(doc, 1, trust, held)).toEqual(refused("endorsement_invalid"));
  });

  it("does not honour a removed ANCHOR's endorsement of an id the held chart does not list", () => {
    // R is in the receiver's trust set, so no endorsement is needed to trust R's own key.
    const anchoredTrust: TrustSet = { P: primary.publicKey, R: removed.publicKey };
    const held = signDoc(heldBody("evicted"), "P", primary.privateKey);
    const f = generateNodeKeyPair();
    const body: MembershipDocumentBody = {
      term: 2,
      nodes: [{ nodeId: "F", contactUrl: "https://f", standing: "serving-primary" }],
    };
    const doc: SignedMembershipDocument = {
      body,
      signerNodeId: "F",
      signature: signDocumentBody(body, f.privateKey),
      endorsements: [endorseKey("F", f.publicKey, "R", removed.privateKey)],
    };
    expect(acceptMembershipDocument(doc, 1, anchoredTrust, held)).toEqual(
      refused("endorsement_invalid"),
    );
  });

  it("does not let a removed ANCHOR get a fresh key trusted through a key it vouched for", () => {
    // R vouches a forged key for S (in good standing), then that forged key vouches for F.
    const anchoredTrust: TrustSet = { P: primary.publicKey, R: removed.publicKey };
    const held = signDoc(
      {
        term: 1,
        nodes: [
          { nodeId: "P", contactUrl: "https://p", standing: "serving-primary" },
          { nodeId: "R", contactUrl: "https://r", standing: "evicted" },
          { nodeId: "S", contactUrl: "https://s", standing: "serving-secondary" },
        ],
      },
      "P",
      primary.privateKey,
    );
    const forgedS = generateNodeKeyPair();
    const f = generateNodeKeyPair();
    const body: MembershipDocumentBody = {
      term: 2,
      nodes: [{ nodeId: "F", contactUrl: "https://f", standing: "serving-primary" }],
    };
    const doc: SignedMembershipDocument = {
      body,
      signerNodeId: "F",
      signature: signDocumentBody(body, f.privateKey),
      endorsements: [
        endorseKey("S", forgedS.publicKey, "R", removed.privateKey),
        endorseKey("F", f.publicKey, "S", forgedS.privateKey),
      ],
    };
    expect(acceptMembershipDocument(doc, 1, anchoredTrust, held)).toEqual(
      refused("endorsement_invalid"),
    );
  });

  it("accepts a retirement chart, signed by the node it evicts while the held chart lists it sell-only", () => {
    const retiring = generateNodeKeyPair();
    const held = signDoc(
      {
        term: 4,
        nodes: [
          { nodeId: "P", contactUrl: "https://p", standing: "serving-primary" },
          { nodeId: "T", contactUrl: "https://t", standing: "sell-only" },
        ],
      },
      "P",
      primary.privateKey,
    );
    const body: MembershipDocumentBody = {
      term: 5,
      nodes: [
        { nodeId: "P", contactUrl: "https://p", standing: "serving-primary" },
        { nodeId: "T", contactUrl: "https://t", standing: "evicted" },
      ],
    };
    const doc: SignedMembershipDocument = {
      body,
      signerNodeId: "T",
      signature: signDocumentBody(body, retiring.privateKey),
      endorsements: [endorseKey("T", retiring.publicKey, "P", primary.privateKey)],
    };
    expect(acceptMembershipDocument(doc, 4, trust, held).accepted).toBe(true);
  });

  it("accepts a promoted primary vouched for by an anchor the held chart has since evicted", () => {
    // P was the setup primary (an anchor) and has since been evicted; N was promoted on P's word.
    const promoted = generateNodeKeyPair();
    const held = signDoc(
      {
        term: 6,
        nodes: [
          { nodeId: "P", contactUrl: "https://p", standing: "evicted" },
          { nodeId: "N", contactUrl: "https://n", standing: "serving-primary" },
        ],
      },
      "N",
      promoted.privateKey,
    );
    const body: MembershipDocumentBody = {
      term: 7,
      nodes: [
        { nodeId: "P", contactUrl: "https://p", standing: "evicted" },
        { nodeId: "N", contactUrl: "https://n", standing: "serving-primary" },
      ],
    };
    const doc: SignedMembershipDocument = {
      body,
      signerNodeId: "N",
      signature: signDocumentBody(body, promoted.privateKey),
      endorsements: [endorseKey("N", promoted.publicKey, "P", primary.privateKey)],
    };
    expect(acceptMembershipDocument(doc, 6, trust, held).accepted).toBe(true);
  });

  // P, the removed setup primary and an anchor, vouched for N's key when N joined; N signs the held
  // chart with that key and carries P's endorsement of it.
  const promoted = generateNodeKeyPair();
  const signedAsN = (
    term: number,
    key: string,
    endorsements: SignedMembershipDocument["endorsements"],
  ) => {
    const body: MembershipDocumentBody = {
      term,
      nodes: [{ nodeId: "N", contactUrl: "https://n", standing: "serving-primary" }],
      revoked: ["P"],
    };
    return {
      body,
      signerNodeId: "N",
      signature: signDocumentBody(body, key),
      endorsements,
    } satisfies SignedMembershipDocument;
  };
  const vouchedByP = (key: string) => endorseKey("N", key, "P", primary.privateKey);

  it("does not let a removed ANCHOR vouch a new key for the node that signed the held chart", () => {
    const held = signedAsN(6, promoted.privateKey, [vouchedByP(promoted.publicKey)]);
    const forged = generateNodeKeyPair();
    const doc = signedAsN(7, forged.privateKey, [vouchedByP(forged.publicKey)]);
    expect(acceptMembershipDocument(doc, 6, trust, held)).toEqual(refused("endorsement_invalid"));
  });

  it("binds the held chart's signer to the key its signature verifies under, not to a planted endorsement", () => {
    // Endorsements sit outside the signed body, so a relayed copy of the held chart can carry one
    // for another key, validly signed by P.
    const planted = generateNodeKeyPair();
    const held = signedAsN(6, promoted.privateKey, [
      vouchedByP(planted.publicKey),
      vouchedByP(promoted.publicKey),
    ]);
    const genuine = signedAsN(7, promoted.privateKey, [vouchedByP(promoted.publicKey)]);
    expect(acceptMembershipDocument(genuine, 6, trust, held).accepted).toBe(true);
    const impostor = signedAsN(7, planted.privateKey, [vouchedByP(planted.publicKey)]);
    expect(acceptMembershipDocument(impostor, 6, trust, held)).toEqual(
      refused("endorsement_invalid"),
    );
  });
});
