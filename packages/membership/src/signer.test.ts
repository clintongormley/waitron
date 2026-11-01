import { describe, expect, it } from "vitest";
import { generateNodeKeyPair } from "./crypto.js";
import { sampleBody, signDoc } from "./document-fixtures.js";
import { endorseKey } from "./endorsement.js";
import { MAX_NODES, MAX_REVOKED, signDocumentBody, verifyDocumentSigner } from "./verify.js";

const a = generateNodeKeyPair();
const b = generateNodeKeyPair();
const trust = { A: a.publicKey };

/** Malformed in a way the signature does not cover: one field beside `body`. */
function withUnsignedField(doc: object): unknown {
  return { ...doc, note: "x" };
}

describe("verifyDocumentSigner", () => {
  it("trusts a well-formed chart a trusted key signed", () => {
    expect(verifyDocumentSigner(signDoc(sampleBody(1), "A", a.privateKey), trust)).toEqual({
      trusted: true,
      signerNodeId: "A",
    });
  });

  it("trusts a malformed chart a trusted key signed, leaving its shape to later checks", () => {
    const doc = withUnsignedField(signDoc(sampleBody(1), "A", a.privateKey));
    expect(verifyDocumentSigner(doc, trust)).toEqual({ trusted: true, signerNodeId: "A" });
  });

  it("trusts a chart whose signed revoked list is malformed when a trusted key signed it", () => {
    const body = { ...sampleBody(1), revoked: ["gone", "gone"] };
    expect(verifyDocumentSigner(signDoc(body, "A", a.privateKey), trust)).toEqual({
      trusted: true,
      signerNodeId: "A",
    });
  });

  it("refuses a malformed chart signed by a key nobody trusts as untrusted_signer", () => {
    const doc = withUnsignedField(signDoc(sampleBody(1), "B", b.privateKey));
    expect(verifyDocumentSigner(doc, trust)).toEqual({
      trusted: false,
      reason: "untrusted_signer",
    });
  });

  it("refuses a malformed chart whose body was changed after a trusted key signed it", () => {
    const signed = signDoc(sampleBody(1), "A", a.privateKey);
    const doc = { ...signed, body: { ...sampleBody(2), extra: 1 } };
    expect(verifyDocumentSigner(doc, trust)).toEqual({ trusted: false, reason: "bad_signature" });
  });

  it("trusts a malformed chart signed by a key a trusted node endorsed", () => {
    const doc = withUnsignedField({
      body: sampleBody(2),
      signerNodeId: "B",
      signature: signDocumentBody(sampleBody(2), b.privateKey),
      endorsements: [endorseKey("B", b.publicKey, "A", a.privateKey)],
    });
    expect(verifyDocumentSigner(doc, trust)).toEqual({ trusted: true, signerNodeId: "B" });
  });

  it("refuses a malformed chart whose endorsement nobody trusted signed as endorsement_invalid", () => {
    const c = generateNodeKeyPair();
    const doc = withUnsignedField({
      body: sampleBody(2),
      signerNodeId: "B",
      signature: signDocumentBody(sampleBody(2), b.privateKey),
      endorsements: [endorseKey("B", b.publicKey, "C", c.privateKey)],
    });
    expect(verifyDocumentSigner(doc, trust)).toEqual({
      trusted: false,
      reason: "endorsement_invalid",
    });
  });

  it("skips an endorsement whose fields are not all text, which can only withhold trust", () => {
    const endorsement = endorseKey("B", b.publicKey, "A", a.privateKey);
    const doc = {
      body: sampleBody(2),
      signerNodeId: "B",
      signature: signDocumentBody(sampleBody(2), b.privateKey),
      endorsements: [{ ...endorsement, endorsedBy: 7 }, "junk", null],
    };
    expect(verifyDocumentSigner(doc, trust)).toEqual({
      trusted: false,
      reason: "endorsement_invalid",
    });
  });

  it("reads an endorsement carrying an extra key by its four signed fields", () => {
    const doc = {
      body: sampleBody(2),
      signerNodeId: "B",
      signature: signDocumentBody(sampleBody(2), b.privateKey),
      endorsements: [{ ...endorseKey("B", b.publicKey, "A", a.privateKey), note: "x" }],
    };
    expect(verifyDocumentSigner(doc, trust)).toEqual({ trusted: true, signerNodeId: "B" });
  });

  describe("refuses as malformed a chart too broken to name its signer or to verify", () => {
    const signed = signDoc(sampleBody(1), "A", a.privateKey);
    const cases: [string, unknown][] = [
      ["not an object", "chart"],
      ["null", null],
      ["no signer", { ...signed, signerNodeId: undefined }],
      ["a signer that is not text", { ...signed, signerNodeId: 1 }],
      ["no signature", { ...signed, signature: undefined }],
      ["a signature that is not text", { ...signed, signature: ["s"] }],
      ["no body", { ...signed, body: undefined }],
      ["a body that is not an object", { ...signed, body: "body" }],
      ["a body that is a list", { ...signed, body: [sampleBody(1)] }],
      ["no endorsement list", { ...signed, endorsements: undefined }],
      ["an endorsement list that is not a list", { ...signed, endorsements: {} }],
      [
        "more endorsements than any chart may carry",
        {
          ...signed,
          endorsements: Array.from({ length: 9 }, () =>
            endorseKey("B", b.publicKey, "A", a.privateKey),
          ),
        },
      ],
    ];
    it.each(cases)("%s", (_, doc) => {
      expect(verifyDocumentSigner(doc, trust)).toEqual({ trusted: false, reason: "malformed" });
    });
  });

  describe("refuses as malformed a body larger or deeper than any chart, whoever signed it", () => {
    const node = (i: number) => ({ nodeId: `n${i}`, contactUrl: "", standing: "sell-only" });
    let deep: unknown = [];
    for (let i = 0; i < 20_000; i += 1) deep = [deep];
    const cases: [string, Record<string, unknown>][] = [
      ["nodes nested 20,000 lists deep", { term: 1, nodes: deep }],
      ["a node holding a list", { term: 1, nodes: [{ ...node(0), extra: [] }] }],
      [
        "more nodes than a chart may list",
        { term: 1, nodes: Array.from({ length: MAX_NODES + 1 }, (_, i) => node(i)) },
      ],
      [
        "more cleared ids than a chart may list",
        { term: 1, nodes: [], revoked: Array.from({ length: MAX_REVOKED + 1 }, String) },
      ],
      [
        "a field beyond the declared ones holding more values than a chart can",
        { term: 1, nodes: [], note: Array.from({ length: 300 }, String) },
      ],
    ];
    it.each(cases)("%s", (_, body) => {
      // Too deep for the signer as well, so that body carries another chart's signature.
      const signature =
        body.nodes === deep
          ? signDocumentBody(sampleBody(1), a.privateKey)
          : signDocumentBody(body as never, a.privateKey);
      const doc = { body, signerNodeId: "A", signature, endorsements: [] };
      expect(verifyDocumentSigner(doc, trust)).toEqual({ trusted: false, reason: "malformed" });
    });

    it("still trusts the largest chart a trusted key can sign", () => {
      const body = {
        term: 1,
        nodes: Array.from({ length: MAX_NODES }, (_, i) => node(i)),
        revoked: Array.from({ length: MAX_REVOKED }, String),
      };
      expect(verifyDocumentSigner(signDoc(body as never, "A", a.privateKey), trust)).toEqual({
        trusted: true,
        signerNodeId: "A",
      });
    });
  });

  it("still verifies a chart carrying exactly as many endorsements as a chart may carry", () => {
    const doc = {
      ...signDoc(sampleBody(1), "A", a.privateKey),
      endorsements: Array.from({ length: 8 }, () =>
        endorseKey("B", b.publicKey, "A", a.privateKey),
      ),
    };
    expect(verifyDocumentSigner(doc, trust)).toEqual({ trusted: true, signerNodeId: "A" });
  });
});
