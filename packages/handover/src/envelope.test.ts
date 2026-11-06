import { createHash } from "node:crypto";
import { generateNodeKeyPair } from "@waitron/membership";
import { AppError } from "@waitron/shared";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  HANDOVER_KINDS,
  type HandoverKind,
  envelopeDigest,
  isSha256Hex,
  sha256Hex,
  signEnvelope,
  verifyEnvelope,
} from "./envelope.js";

const m1 = { nodeId: "node-m1", ...generateNodeKeyPair() };
const m2 = { nodeId: "node-m2", ...generateNodeKeyPair() };
const keys = new Map([
  [m1.nodeId, m1.publicKey],
  [m2.nodeId, m2.publicKey],
]);
const publicKeyOf = (nodeId: string) => keys.get(nodeId);

const body = { operationId: "op-1", count: 3, nested: { b: true, a: null }, list: ["x", 1] };

function json(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe("signEnvelope", () => {
  it("names the kind's purpose and the signer beside the body", () => {
    const envelope = signEnvelope("acceptance", body, m2);
    expect(envelope.purpose).toBe("waitron.handover.acceptance.v1");
    expect(envelope.signerNodeId).toBe("node-m2");
    expect(envelope.body).toBe(body);
    expect(Object.keys(envelope).sort()).toEqual(["body", "purpose", "signature", "signerNodeId"]);
  });

  it("throws a fault, not a refusal, for a body holding a number JSON cannot carry, at any depth", () => {
    const cases: [unknown, string][] = [
      [{ n: Number.NaN }, "body.n"],
      [{ a: { b: Number.POSITIVE_INFINITY } }, "body.a.b"],
      [{ list: [1, Number.NEGATIVE_INFINITY] }, "body.list.1"],
    ];
    for (const [bad, field] of cases) {
      let thrown: unknown;
      try {
        signEnvelope("status", bad as never, m1);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, field).toBeInstanceOf(Error);
      expect(thrown, field).not.toBeInstanceOf(AppError);
      expect((thrown as Error).message, field).toBe(
        `a handover body holds a non-finite number at ${field}`,
      );
    }
    expect(signEnvelope("status", { n: 1.5, z: -0, list: [0] }, m1).body).toEqual({
      n: 1.5,
      z: -0,
      list: [0],
    });
  });

  it("lists the ten kinds", () => {
    expect(HANDOVER_KINDS).toEqual([
      "query",
      "status",
      "stepdown",
      "final-state",
      "acceptance",
      "relinquishment",
      "declaration",
      "return-batch",
      "return-receipt",
      "health",
    ]);
  });

  it("lists every kind the shared type names, and no other", () => {
    expectTypeOf<(typeof HANDOVER_KINDS)[number]>().toEqualTypeOf<HandoverKind>();
  });
});

describe("verifyEnvelope", () => {
  it("a signed envelope verifies with the signer's key", () => {
    const raw = json(signEnvelope("final-state", body, m1));
    expect(verifyEnvelope(raw, "final-state", publicKeyOf)).toEqual({
      valid: true,
      body,
      signerNodeId: "node-m1",
    });
  });

  it("verifies every kind under its own purpose", () => {
    for (const kind of HANDOVER_KINDS) {
      const raw = json(signEnvelope(kind, body, m1));
      expect(verifyEnvelope(raw, kind, publicKeyOf).valid, kind).toBe(true);
    }
  });

  it("an acceptance never verifies as a relinquishment", () => {
    const raw = json(signEnvelope("acceptance", body, m2));
    expect(verifyEnvelope(raw, "relinquishment", publicKeyOf)).toEqual({
      valid: false,
      reason: "wrong_purpose",
    });
  });

  it("the purpose is signed: an acceptance re-labelled as a relinquishment is refused", () => {
    const envelope = signEnvelope("acceptance", body, m2);
    const raw = json({ ...envelope, purpose: "waitron.handover.relinquishment.v1" });
    expect(verifyEnvelope(raw, "relinquishment", publicKeyOf)).toEqual({
      valid: false,
      reason: "bad_signature",
    });
  });

  it("a body changed after signing is refused", () => {
    const envelope = signEnvelope("acceptance", body, m2);
    const raw = json({ ...envelope, body: { ...body, count: 4 } });
    expect(verifyEnvelope(raw, "acceptance", publicKeyOf)).toEqual({
      valid: false,
      reason: "bad_signature",
    });
  });

  it("the signer id is signed: the same body re-labelled with another node id is refused", () => {
    // Both ids resolve to m2's key, so only the signed bytes can tell them apart.
    const sameKey = (nodeId: string) =>
      nodeId === "node-m2" || nodeId === "node-m2-alias" ? m2.publicKey : undefined;
    const envelope = signEnvelope("acceptance", body, m2);
    expect(verifyEnvelope(json(envelope), "acceptance", sameKey).valid).toBe(true);
    const raw = json({ ...envelope, signerNodeId: "node-m2-alias" });
    expect(verifyEnvelope(raw, "acceptance", sameKey)).toEqual({
      valid: false,
      reason: "bad_signature",
    });
  });

  it("an unknown signer is refused", () => {
    const stranger = { nodeId: "node-stranger", ...generateNodeKeyPair() };
    const raw = json(signEnvelope("status", body, stranger));
    const asked: string[] = [];
    const result = verifyEnvelope(raw, "status", (nodeId) => {
      asked.push(nodeId);
      return keys.get(nodeId);
    });
    expect(result).toEqual({ valid: false, reason: "unknown_signer" });
    expect(asked).toEqual(["node-stranger"]);
  });

  it("a non-object, a missing field or an extra top-level field is `malformed`", () => {
    const good = json(signEnvelope("query", body, m1)) as Record<string, unknown>;
    const withoutField = (field: string) =>
      Object.fromEntries(Object.entries(good).filter(([key]) => key !== field));
    const cases: unknown[] = [
      null,
      undefined,
      "envelope",
      42,
      [good],
      withoutField("purpose"),
      withoutField("signerNodeId"),
      withoutField("body"),
      withoutField("signature"),
      { ...good, extra: 1 },
      { ...withoutField("body"), extra: 1 },
      { ...good, purpose: 1 },
      { ...good, signerNodeId: 1 },
      { ...good, signature: 1 },
    ];
    for (const raw of cases) {
      expect(verifyEnvelope(raw, "query", publicKeyOf), JSON.stringify(raw)).toEqual({
        valid: false,
        reason: "malformed",
      });
    }
  });

  it("a body the signed form cannot spell is `malformed`", () => {
    const good = json(signEnvelope("query", body, m1)) as Record<string, unknown>;
    expect(verifyEnvelope({ ...good, body: { n: 1n } }, "query", publicKeyOf)).toEqual({
      valid: false,
      reason: "malformed",
    });
  });

  it("a signature spelled other than as the signer wrote it is `malformed`, so evidence keeps one digest", () => {
    const good = json(signEnvelope("query", body, m1)) as Record<string, string>;
    const signature = good.signature!;
    expect(signature).toMatch(/^[A-Za-z0-9+/]{86}==$/);
    // The same 64 bytes: the last character before the padding carries four bits base64 ignores.
    const lastIndex = 85;
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const lastValue = alphabet.indexOf(signature[lastIndex]!);
    const sameBytes =
      signature.slice(0, lastIndex) +
      alphabet[lastValue ^ 0b0001]! +
      signature.slice(lastIndex + 1);
    expect(Buffer.from(sameBytes, "base64")).toEqual(Buffer.from(signature, "base64"));
    const respellings = [
      `${signature}!`,
      signature.slice(0, -2),
      sameBytes,
      signature.replace(/\+/g, "-").replace(/\//g, "_"),
      ` ${signature}`,
    ].filter((spelling) => spelling !== signature);
    expect(respellings.length).toBeGreaterThanOrEqual(4);
    expect(verifyEnvelope(good, "query", publicKeyOf).valid).toBe(true);
    for (const spelling of respellings) {
      expect(
        verifyEnvelope({ ...good, signature: spelling }, "query", publicKeyOf),
        spelling,
      ).toEqual({
        valid: false,
        reason: "malformed",
      });
    }
  });

  it("a signature of the right spelling but not 64 bytes is `malformed`", () => {
    const good = json(signEnvelope("query", body, m1)) as Record<string, string>;
    const short = Buffer.alloc(63, 1).toString("base64");
    expect(verifyEnvelope({ ...good, signature: short }, "query", publicKeyOf)).toEqual({
      valid: false,
      reason: "malformed",
    });
  });

  it("a signature that is not the signer's is refused", () => {
    const envelope = signEnvelope("health", body, m1);
    const forged = signEnvelope("health", body, { nodeId: m1.nodeId, privateKey: m2.privateKey });
    expect(verifyEnvelope(json(envelope), "health", publicKeyOf).valid).toBe(true);
    expect(verifyEnvelope(json(forged), "health", publicKeyOf)).toEqual({
      valid: false,
      reason: "bad_signature",
    });
  });
});

describe("envelopeDigest", () => {
  it("the digest is stable under key order", () => {
    const first = signEnvelope("final-state", { a: 1, b: { c: 2, d: 3 } }, m1);
    const second = signEnvelope("final-state", { b: { d: 3, c: 2 }, a: 1 }, m1);
    expect(envelopeDigest(second)).toBe(envelopeDigest(first));
  });

  it("is the SHA-256 of the envelope's canonical form", () => {
    const envelope = signEnvelope("stepdown", { z: "é", a: [2, 1] }, m1);
    const canonical =
      `{"body":{"a":[2,1],"z":"é"},"purpose":"waitron.handover.stepdown.v1",` +
      `"signature":${JSON.stringify(envelope.signature)},"signerNodeId":"node-m1"}`;
    expect(envelopeDigest(envelope)).toBe(
      createHash("sha256").update(Buffer.from(canonical, "utf8")).digest("hex"),
    );
  });

  it("differs when the body differs", () => {
    expect(envelopeDigest(signEnvelope("stepdown", { a: 1 }, m1))).not.toBe(
      envelopeDigest(signEnvelope("stepdown", { a: 2 }, m1)),
    );
  });
});

describe("isSha256Hex", () => {
  it("takes what `sha256Hex` answers", () => {
    expect(isSha256Hex(sha256Hex("abc"))).toBe(true);
  });

  it.each([
    ["one character short", "a".repeat(63)],
    ["one character long", "a".repeat(65)],
    ["upper case", "A".repeat(64)],
    ["not hex", "g".repeat(64)],
    ["a leading character", `x${"a".repeat(64)}`],
    ["a trailing line", `${"a".repeat(64)}\n`],
    ["no characters", ""],
    ["not text", 1],
    ["nothing", undefined],
  ])("refuses %s", (_name, value) => {
    expect(isSha256Hex(value)).toBe(false);
  });
});

describe("sha256Hex", () => {
  it("is lower-case hex of the UTF-8 bytes of a string", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex("é")).toBe(sha256Hex(new Uint8Array([0xc3, 0xa9])));
  });

  it("hashes bytes as given", () => {
    expect(sha256Hex(new Uint8Array([]))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});
