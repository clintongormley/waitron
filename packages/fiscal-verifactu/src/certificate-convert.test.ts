import { X509Certificate } from "node:crypto";
import forge from "node-forge";
import { describe, expect, it, vi } from "vitest";
import { makeAuthority } from "../test/certificate-fixtures.js";
import {
  KEY_ONLY_CANDIDATE,
  MAC_ACCENTED_CANDIDATE,
  OPENSSL_SIGNED_FINGERPRINT,
  RC2_ACCENTED_CANDIDATE,
  RC2_CANDIDATE,
  RC2_SIGNED_CANDIDATE,
  RC4_CANDIDATE,
} from "../test/openssl-certificates.js";
import { openCertificateFile } from "./certificate-file.js";
import { openOrRewrite, rewriteOldCertificate } from "./certificate-convert.js";

vi.mock("./certificate-file.js", { spy: true });

const bytes = (file: { pfxBase64: string }) => Buffer.from(file.pfxBase64, "base64");

/** A rewritten file's key is encrypted from the passphrase's UTF-8 bytes, which forge reads only
 * with its MAC set aside. */
function certificatesIn(pfx: Buffer, passphrase: string, rewritten = false): string[] {
  const parsed = forge.asn1.fromDer(pfx.toString("binary"));
  if (rewritten) (parsed.value as forge.asn1.Asn1[]).splice(2);
  const p12 = forge.pkcs12.pkcs12FromAsn1(
    parsed,
    rewritten ? forge.util.encodeUtf8(passphrase) : passphrase,
  );
  const bags = p12.getBags({ bagType: forge.pki.oids.certBag! })[forge.pki.oids.certBag!]!;
  return bags.map(
    (bag) =>
      new X509Certificate(
        Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(bag.cert!)).getBytes(), "binary"),
      ).fingerprint256,
  );
}

describe("rewriting a file Node refuses that node-forge reads", () => {
  it.each([
    ["an RC2 file", RC2_SIGNED_CANDIDATE],
    ["an RC2 file under a passphrase outside ASCII", RC2_ACCENTED_CANDIDATE],
  ])("opens %s once rewritten, with the same certificate and chain", (_label, file) => {
    const original = bytes(file);
    expect(openCertificateFile(original, file.passphrase)).toEqual({
      ok: false,
      reason: "old_encryption",
    });
    const opened = openOrRewrite(original, file.passphrase);
    if (!opened.ok || opened.rewritten === undefined) throw new Error("not rewritten");
    expect(opened.details.fingerprint).toBe(OPENSSL_SIGNED_FINGERPRINT);
    expect(opened.details).toMatchObject({ organisation: "WAITRON SL", taxId: "89890001K" });
    expect(openCertificateFile(opened.rewritten, file.passphrase)).toEqual({
      ok: true,
      details: opened.details,
    });
    const chain = certificatesIn(original, file.passphrase);
    expect(chain).toHaveLength(2);
    expect(certificatesIn(opened.rewritten, file.passphrase, true)).toEqual(chain);
  });

  it("opens a macOS export under a passphrase outside ASCII, rewritten under the typed one", () => {
    const original = bytes(MAC_ACCENTED_CANDIDATE);
    const { passphrase } = MAC_ACCENTED_CANDIDATE;
    expect(openCertificateFile(original, passphrase)).toEqual({
      ok: false,
      reason: "passphrase_wrong",
    });
    const opened = openOrRewrite(original, passphrase);
    if (!opened.ok || opened.rewritten === undefined) throw new Error("not rewritten");
    expect(opened.details.fingerprint).toBe(OPENSSL_SIGNED_FINGERPRINT);
    expect(openCertificateFile(opened.rewritten, passphrase)).toEqual({
      ok: true,
      details: opened.details,
    });
    expect(certificatesIn(opened.rewritten, passphrase, true)).toEqual(
      certificatesIn(bytes(RC2_SIGNED_CANDIDATE), RC2_SIGNED_CANDIDATE.passphrase),
    );
  });

  it("keeps passphrase_wrong for a wrong passphrase outside ASCII", () => {
    for (const file of [MAC_ACCENTED_CANDIDATE, RC2_ACCENTED_CANDIDATE]) {
      expect(openOrRewrite(bytes(file), "contraseña-ñandu")).toEqual({
        ok: false,
        reason: "passphrase_wrong",
      });
    }
  });

  it("does not ask node-forge again for a wrong passphrase in plain ASCII", () => {
    const read = vi.spyOn(forge.pkcs12, "pkcs12FromAsn1");
    try {
      expect(openOrRewrite(bytes(RC2_ACCENTED_CANDIDATE), "contrasena-nandu")).toEqual({
        ok: false,
        reason: "passphrase_wrong",
      });
      expect(read).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
  });

  it("rewrites a self-signed RC2 file", () => {
    const rewritten = rewriteOldCertificate(bytes(RC2_CANDIDATE), RC2_CANDIDATE.passphrase);
    expect(rewritten).not.toBeNull();
    expect(openCertificateFile(rewritten!, RC2_CANDIDATE.passphrase)).toMatchObject({ ok: true });
  });

  it("treats a rewrite over the size limit as not rewritten", () => {
    const file = bytes(RC2_SIGNED_CANDIDATE);
    const { passphrase } = RC2_SIGNED_CANDIDATE;
    const size = rewriteOldCertificate(file, passphrase)!.length;
    expect(rewriteOldCertificate(file, passphrase, { maxBytes: size })).toHaveLength(size);
    expect(rewriteOldCertificate(file, passphrase, { maxBytes: size - 1 })).toBeNull();
  });

  it("keeps old_encryption for a file node-forge cannot read either", () => {
    expect(rewriteOldCertificate(bytes(RC4_CANDIDATE), RC4_CANDIDATE.passphrase)).toBeNull();
    expect(openOrRewrite(bytes(RC4_CANDIDATE), RC4_CANDIDATE.passphrase)).toEqual({
      ok: false,
      reason: "old_encryption",
    });
  });

  it("refuses a file with no certificate for its key", () => {
    const authority = makeAuthority();
    const p12 = forge.pkcs12.pkcs12FromAsn1(
      forge.asn1.fromDer(bytes(RC2_SIGNED_CANDIDATE).toString("binary")),
      RC2_SIGNED_CANDIDATE.passphrase,
    );
    const key = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag! })[
      forge.pki.oids.pkcs8ShroudedKeyBag!
    ]![0]!.key!;
    const stranger = forge.pki.certificateFromPem(authority.caPem);
    const mismatched = Buffer.from(
      forge.asn1
        .toDer(forge.pkcs12.toPkcs12Asn1(key, [stranger], "cert-pass-9", { algorithm: "3des" }))
        .getBytes(),
      "binary",
    );
    expect(rewriteOldCertificate(mismatched, "cert-pass-9")).toBeNull();
  });

  it("refuses a file with no key, or a key with no certificate", () => {
    const certificateOnly = makeAuthority().issue({ withKey: false, algorithm: "3des" });
    expect(rewriteOldCertificate(certificateOnly.pfx, certificateOnly.passphrase)).toBeNull();
    expect(
      rewriteOldCertificate(bytes(KEY_ONLY_CANDIDATE), KEY_ONLY_CANDIDATE.passphrase),
    ).toBeNull();
  });

  it("keeps old_encryption when Node refuses the rewritten file too", () => {
    vi.mocked(openCertificateFile).mockClear();
    vi.mocked(openCertificateFile)
      .mockReturnValueOnce({ ok: false, reason: "old_encryption" })
      .mockReturnValueOnce({ ok: false, reason: "unreadable" });
    expect(openOrRewrite(bytes(RC2_SIGNED_CANDIDATE), RC2_SIGNED_CANDIDATE.passphrase)).toEqual({
      ok: false,
      reason: "old_encryption",
    });
    expect(openCertificateFile).toHaveBeenCalledTimes(2);
  });

  it("leaves a file Node opens, or refuses for another reason, as it is", () => {
    const candidate = makeAuthority().issue();
    expect(openOrRewrite(candidate.pfx, candidate.passphrase)).toEqual(
      openCertificateFile(candidate.pfx, candidate.passphrase),
    );
    expect(openOrRewrite(bytes(RC2_SIGNED_CANDIDATE), "not-the-pass")).toEqual({
      ok: false,
      reason: "passphrase_wrong",
    });
  });
});
