import forge from "node-forge";
import { describe, expect, it } from "vitest";
import { certificate } from "./certificate.js";

// 1024-bit keys: these tests check what the builder writes, not key strength.
const caKeys = forge.pki.rsa.generateKeyPair(1024);
const leafKeys = forge.pki.rsa.generateKeyPair(1024);
const validity = {
  notBefore: new Date("2026-02-03T04:05:06Z"),
  notAfter: new Date("2027-02-03T04:05:06Z"),
};

describe("certificate", () => {
  it("writes the subject, issuer, serial, validity and subject key it is given, signed by the issuer", () => {
    const ca = certificate(
      "test-ca",
      caKeys,
      { cn: "test-ca", key: caKeys.privateKey },
      "0a",
      validity,
      [{ name: "basicConstraints", cA: true }],
    );
    const leaf = certificate(
      "leaf.example",
      leafKeys,
      { cn: "test-ca", key: caKeys.privateKey },
      "7f01",
      validity,
      [{ name: "basicConstraints", cA: false }],
    );

    // Round-trip through PEM so the assertions read the encoded certificate, not forge's in-memory object.
    const parsed = forge.pki.certificateFromPem(forge.pki.certificateToPem(leaf));
    expect(parsed.subject.getField("CN").value).toBe("leaf.example");
    expect(parsed.subject.attributes).toHaveLength(1);
    expect(parsed.issuer.getField("CN").value).toBe("test-ca");
    expect(parsed.issuer.attributes).toHaveLength(1);
    expect(parsed.serialNumber).toBe("7f01");
    expect(parsed.validity.notBefore.toISOString()).toBe("2026-02-03T04:05:06.000Z");
    expect(parsed.validity.notAfter.toISOString()).toBe("2027-02-03T04:05:06.000Z");
    expect(parsed.siginfo.algorithmOid).toBe(forge.pki.oids.sha256WithRSAEncryption);
    expect((parsed.publicKey as forge.pki.rsa.PublicKey).n.equals(leafKeys.publicKey.n)).toBe(true);
    // `verify` checks the signature against the CA's public key, so this fails if the subject key signed.
    expect(ca.verify(parsed)).toBe(true);
  });

  it("emits built extensions and a raw pre-built extension with its OID, criticality and bytes", () => {
    const rawValue = forge.asn1
      .toDer(forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, []))
      .getBytes();
    const cert = certificate(
      "self",
      caKeys,
      { cn: "self", key: caKeys.privateKey },
      "01",
      validity,
      [
        { name: "basicConstraints", cA: true, pathLenConstraint: 0 },
        { name: "keyUsage", keyCertSign: true, cRLSign: true },
        { name: "extKeyUsage", serverAuth: true, clientAuth: true },
        {
          name: "subjectAltName",
          altNames: [
            { type: 2, value: "self.example" },
            { type: 7, ip: "10.0.0.1" },
          ],
        },
        { name: "nameConstraints", id: "2.5.29.30", critical: true, value: rawValue },
      ],
    );

    const parsed = forge.pki.certificateFromPem(forge.pki.certificateToPem(cert));
    const byName = (name: string) => parsed.getExtension(name) as Record<string, unknown>;
    expect(byName("basicConstraints")).toMatchObject({
      cA: true,
      pathLenConstraint: 0,
      critical: false,
    });
    expect(byName("keyUsage")).toMatchObject({
      keyCertSign: true,
      cRLSign: true,
      digitalSignature: false,
    });
    expect(byName("extKeyUsage")).toMatchObject({ serverAuth: true, clientAuth: true });
    expect(byName("subjectAltName").altNames).toEqual([
      expect.objectContaining({ type: 2, value: "self.example" }),
      expect.objectContaining({ type: 7, ip: "10.0.0.1" }),
    ]);
    const raw = (parsed.extensions as Array<{ id: string }>).find((e) => e.id === "2.5.29.30");
    expect(raw).toMatchObject({
      critical: true,
      value: rawValue,
    });
  });
});
