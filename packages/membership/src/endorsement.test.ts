import { describe, expect, it } from "vitest";
import { generateNodeKeyPair } from "./crypto.js";
import { endorseKey, resolveSignerKey, verifyEndorsement } from "./endorsement.js";
import type { Endorsement, TrustSet } from "./types.js";

describe("resolveSignerKey", () => {
  it("returns the key when the signer is directly in the trust set", () => {
    const a = generateNodeKeyPair();
    const trust: TrustSet = { A: a.publicKey };
    expect(resolveSignerKey("A", [], trust)).toBe(a.publicKey);
  });

  it("resolves a signer vouched for by a trusted node (one hop)", () => {
    const a = generateNodeKeyPair(); // trusted at setup
    const b = generateNodeKeyPair(); // added later, endorsed by A
    const trust: TrustSet = { A: a.publicKey };
    const e = endorseKey("B", b.publicKey, "A", a.privateKey);
    expect(resolveSignerKey("B", [e], trust)).toBe(b.publicKey);
  });

  it("rejects an endorsement by an untrusted endorser", () => {
    const b = generateNodeKeyPair();
    const rogue = generateNodeKeyPair();
    const e = endorseKey("B", b.publicKey, "R", rogue.privateKey); // R not in trust set
    expect(resolveSignerKey("B", [e], {})).toBeNull();
  });

  it("rejects an endorsement whose signature does not verify", () => {
    const a = generateNodeKeyPair();
    const b = generateNodeKeyPair();
    const trust: TrustSet = { A: a.publicKey };
    const tampered: Endorsement = {
      nodeId: "B",
      publicKey: b.publicKey,
      endorsedBy: "A",
      signature: "AAAA",
    };
    expect(resolveSignerKey("B", [tampered], trust)).toBeNull();
  });

  it("resolves a 2-hop chain given in reverse dependency order (multi-pass fixpoint)", () => {
    // Listed in REVERSE dependency order, so resolving C needs the loop's second pass.
    const a = generateNodeKeyPair();
    const b = generateNodeKeyPair();
    const c = generateNodeKeyPair();
    const trust: TrustSet = { A: a.publicKey };
    const endorsements = [
      endorseKey("C", c.publicKey, "B", b.privateKey),
      endorseKey("B", b.publicKey, "A", a.privateKey),
    ];
    expect(resolveSignerKey("C", endorsements, trust)).toBe(c.publicKey);
  });

  it("does not let an endorsement re-bind a setup-trusted key to a rogue key", () => {
    // A validly-signed self-endorsement must not replace A's setup key.
    const a = generateNodeKeyPair();
    const rogue = generateNodeKeyPair();
    const trust: TrustSet = { A: a.publicKey };
    const attack = endorseKey("A", rogue.publicKey, "A", a.privateKey);
    expect(resolveSignerKey("A", [attack], trust)).toBe(a.publicKey);
  });

  it("does not loop on a cyclic endorsement set", () => {
    const b = generateNodeKeyPair();
    const c = generateNodeKeyPair();
    const eBbyC = endorseKey("B", b.publicKey, "C", c.privateKey);
    const eCbyB = endorseKey("C", c.publicKey, "B", b.privateKey);
    expect(resolveSignerKey("B", [eBbyC, eCbyB], {})).toBeNull(); // neither roots at setup
  });
});

describe("verifyEndorsement", () => {
  it("passes an endorsement signed by the endorser's key", () => {
    const a = generateNodeKeyPair();
    const b = generateNodeKeyPair();
    expect(verifyEndorsement(endorseKey("B", b.publicKey, "A", a.privateKey), a.publicKey)).toBe(
      true,
    );
  });

  it("fails under a key other than the one that signed it", () => {
    const a = generateNodeKeyPair();
    const b = generateNodeKeyPair();
    const other = generateNodeKeyPair();
    expect(
      verifyEndorsement(endorseKey("B", b.publicKey, "A", a.privateKey), other.publicKey),
    ).toBe(false);
  });

  it("fails once the endorsed public key is changed", () => {
    const a = generateNodeKeyPair();
    const b = generateNodeKeyPair();
    const swapped = {
      ...endorseKey("B", b.publicKey, "A", a.privateKey),
      publicKey: generateNodeKeyPair().publicKey,
    };
    expect(verifyEndorsement(swapped, a.publicKey)).toBe(false);
  });

  it("fails once the endorsed node id is changed", () => {
    const a = generateNodeKeyPair();
    const b = generateNodeKeyPair();
    const moved = { ...endorseKey("B", b.publicKey, "A", a.privateKey), nodeId: "C" };
    expect(verifyEndorsement(moved, a.publicKey)).toBe(false);
  });
});
