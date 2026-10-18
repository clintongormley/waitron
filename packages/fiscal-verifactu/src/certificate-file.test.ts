import { randomBytes } from "node:crypto";
import { makeAuthority } from "../test/certificate-fixtures.js";
import { KEY_ONLY_CANDIDATE, RC2_CANDIDATE } from "../test/openssl-certificates.js";
import { normaliseTaxId, openCertificateFile } from "./certificate-file.js";

const authority = makeAuthority();
const candidate = authority.issue();
const rc2 = Buffer.from(RC2_CANDIDATE.pfxBase64, "base64");
const keyOnly = Buffer.from(KEY_ONLY_CANDIDATE.pfxBase64, "base64");
const noKey = authority.issue({ withKey: false });

describe("openCertificateFile", () => {
  it("opens a valid file and reads organisation, tax ID, issuer, dates and fingerprint", () => {
    expect(openCertificateFile(candidate.pfx, candidate.passphrase)).toEqual({
      ok: true,
      details: {
        organisation: "WAITRON SL",
        taxId: "89890001K",
        issuer: "Waitron test FNMT (Test FNMT)",
        validFrom: new Date("2026-01-01T00:00:00Z"),
        validUntil: new Date("2030-01-01T00:00:00Z"),
        fingerprint: candidate.fingerprint,
      },
    });
  });

  it("opens the same certificate re-packed with 3DES", () => {
    const repacked = authority.repack(candidate, "3des");
    expect(repacked.pfx.equals(candidate.pfx)).toBe(false);
    const result = openCertificateFile(repacked.pfx, repacked.passphrase);
    expect(result).toMatchObject({ ok: true, details: { fingerprint: candidate.fingerprint } });
  });

  it("refuses a wrong passphrase as passphrase_wrong", () => {
    expect(openCertificateFile(candidate.pfx, "not-the-pass")).toEqual({
      ok: false,
      reason: "passphrase_wrong",
    });
  });

  it("refuses the RC2 file with the right passphrase as old_encryption", () => {
    expect(openCertificateFile(rc2, RC2_CANDIDATE.passphrase)).toEqual({
      ok: false,
      reason: "old_encryption",
    });
  });

  it("refuses the RC2 file with a wrong passphrase as passphrase_wrong", () => {
    expect(openCertificateFile(rc2, "not-the-pass")).toEqual({
      ok: false,
      reason: "passphrase_wrong",
    });
  });

  it("refuses a file without a private key as no_private_key", () => {
    expect(openCertificateFile(noKey.pfx, noKey.passphrase)).toEqual({
      ok: false,
      reason: "no_private_key",
    });
  });

  it("refuses a file with a key and no certificate as unreadable", () => {
    expect(openCertificateFile(keyOnly, KEY_ONLY_CANDIDATE.passphrase)).toEqual({
      ok: false,
      reason: "unreadable",
    });
  });

  it("refuses 600 random bytes as unreadable", () => {
    expect(openCertificateFile(randomBytes(600), "cert-pass-9")).toEqual({
      ok: false,
      reason: "unreadable",
    });
  });

  it("refuses an empty buffer as unreadable", () => {
    expect(openCertificateFile(Buffer.alloc(0), "cert-pass-9")).toEqual({
      ok: false,
      reason: "unreadable",
    });
  });

  it("never throws", () => {
    const bad: Array<[Buffer, string]> = [
      [candidate.pfx, "not-the-pass"],
      [rc2, RC2_CANDIDATE.passphrase],
      [rc2, "not-the-pass"],
      [noKey.pfx, noKey.passphrase],
      [keyOnly, KEY_ONLY_CANDIDATE.passphrase],
      [randomBytes(600), "cert-pass-9"],
      [Buffer.alloc(0), "cert-pass-9"],
    ];
    for (const [pfx, passphrase] of bad) {
      expect(() => openCertificateFile(pfx, passphrase)).not.toThrow();
    }
  });

  it('keeps the passphrase exactly: " cert pass 9 " opens, "cert pass 9" does not', () => {
    const spaced = authority.issue({ passphrase: " cert pass 9 " });
    expect(openCertificateFile(spaced.pfx, " cert pass 9 ")).toMatchObject({ ok: true });
    expect(openCertificateFile(spaced.pfx, "cert pass 9")).toEqual({
      ok: false,
      reason: "passphrase_wrong",
    });
  });

  it("reads no tax ID and no organisation when the certificate carries neither", () => {
    const bare = authority.issue({ organisation: null, organizationIdentifier: null });
    expect(openCertificateFile(bare.pfx, bare.passphrase)).toMatchObject({
      ok: true,
      details: { taxId: null, organisation: null, fingerprint: bare.fingerprint },
    });
  });

  it("strips a VATES- prefix and ignores case, spaces and hyphens", () => {
    const messy = authority.issue({ organizationIdentifier: "vates-b 1234-5678" });
    expect(openCertificateFile(messy.pfx, messy.passphrase)).toMatchObject({
      ok: true,
      details: { taxId: "B12345678" },
    });
    expect(normaliseTaxId(" b-1234 5678 ")).toBe("B12345678");
  });

  it("never returns the subject's CN or serialNumber", () => {
    const text = JSON.stringify(openCertificateFile(candidate.pfx, candidate.passphrase));
    expect(text).not.toContain("ANA GARCIA");
    expect(text).not.toContain("12345678Z");
  });
});
