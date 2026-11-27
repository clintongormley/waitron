import { X509Certificate } from "node:crypto";
import forge from "node-forge";
import { describe, expect, it, vi } from "vitest";
import {
  makeAuthority,
  SIN_DATOS_BODY,
  startAnsweringServer,
} from "../test/certificate-fixtures.js";
import {
  EC_CHAIN_CANDIDATE,
  EC_ROOT_PEM,
  EC_SIGNED_CANDIDATE,
  KEY_ONLY_CANDIDATE,
  MAC_ACCENTED_CANDIDATE,
  OPENSSL_AUTHORITY,
  OPENSSL_SIGNED_FINGERPRINT,
  RC2_ACCENTED_CANDIDATE,
  RC2_CANDIDATE,
  RC2_SIGNED_CANDIDATE,
  RC4_CANDIDATE,
} from "../test/openssl-certificates.js";
import { mtlsFetch } from "./aeat-transport.js";
import { openCertificateFile } from "./certificate-file.js";
import { rewriteOldCertificate } from "./certificate-convert.js";
import { answerOpener, openOrRewrite } from "./certificate-open-answer.js";

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

type Asn1 = forge.asn1.Asn1;
const parts = (node: Asn1) => node.value as Asn1[];

/** Each certificate a rewritten file holds, as base64 of the DER it stores; the rewrite leaves its
 * certificates unencrypted. */
function storedCertificates(pfx: Buffer): string[] {
  const content = (info: Asn1) => forge.asn1.fromDer(parts(parts(info)[1]!)[0]!.value as string);
  return parts(content(parts(forge.asn1.fromDer(pfx.toString("binary")))[1]!))
    .flatMap((info) => parts(content(info)))
    .filter((bag) => forge.asn1.derToOid(parts(bag)[0]!.value as string) === forge.pki.oids.certBag)
    .map((bag) =>
      Buffer.from(
        parts(parts(parts(parts(bag)[1]!)[0]!)[1]!)[0]!.value as string,
        "binary",
      ).toString("base64"),
    );
}

const derOf = (pem: string) => new X509Certificate(pem).raw.toString("base64");

/** `RC2_SIGNED_CANDIDATE` without its MAC, so forge reads it after an edit, with `extra`'s key
 * contents added beside its own. */
function rc2With(extra?: Asn1): Buffer {
  const pfx = forge.asn1.fromDer(bytes(RC2_SIGNED_CANDIDATE).toString("binary"));
  parts(pfx).splice(2);
  if (extra !== undefined) {
    const holder = parts(parts(parts(pfx)[1]!)[1]!)[0]!;
    const authSafe = forge.asn1.fromDer(holder.value as string);
    const added = forge.asn1.fromDer(parts(parts(parts(extra)[1]!)[1]!)[0]!.value as string);
    parts(authSafe).push(...parts(added));
    holder.value = forge.asn1.toDer(authSafe).getBytes();
  }
  return Buffer.from(forge.asn1.toDer(pfx).getBytes(), "binary");
}

describe("rewriting a file Node refuses that node-forge reads", () => {
  it.each([
    ["an RC2 file", RC2_SIGNED_CANDIDATE],
    ["an RC2 file under a passphrase outside ASCII", RC2_ACCENTED_CANDIDATE],
  ])("opens %s once rewritten, with the same certificate and chain", async (_label, file) => {
    const original = bytes(file);
    expect(openCertificateFile(original, file.passphrase)).toEqual({
      ok: false,
      reason: "old_encryption",
    });
    const opened = await openOrRewrite(original, file.passphrase);
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

  it("opens a macOS export under a passphrase outside ASCII, rewritten under the typed one", async () => {
    const original = bytes(MAC_ACCENTED_CANDIDATE);
    const { passphrase } = MAC_ACCENTED_CANDIDATE;
    expect(openCertificateFile(original, passphrase)).toEqual({
      ok: false,
      reason: "passphrase_wrong",
    });
    const opened = await openOrRewrite(original, passphrase);
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

  it("keeps passphrase_wrong for a wrong passphrase outside ASCII", async () => {
    for (const file of [MAC_ACCENTED_CANDIDATE, RC2_ACCENTED_CANDIDATE]) {
      expect(await openOrRewrite(bytes(file), "contraseña-ñandu")).toEqual({
        ok: false,
        reason: "passphrase_wrong",
      });
    }
  });

  it("does not ask node-forge for a wrong passphrase in plain ASCII, or another refusal", async () => {
    const read = vi.spyOn(forge.pkcs12, "pkcs12FromAsn1");
    try {
      expect(await openOrRewrite(bytes(RC2_ACCENTED_CANDIDATE), "contrasena-nandu")).toEqual({
        ok: false,
        reason: "passphrase_wrong",
      });
      const keyless = makeAuthority().issue({ withKey: false, passphrase: "contraseña-ñandú" });
      expect(await openOrRewrite(keyless.pfx, keyless.passphrase)).toEqual({
        ok: false,
        reason: "no_private_key",
      });
      expect(read).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
  });

  it.each([
    ["an RSA intermediate signed by an EC root", EC_CHAIN_CANDIDATE],
    ["a leaf signed by an EC root", EC_SIGNED_CANDIDATE],
  ])("keeps every certificate as stored when forge cannot read one: %s", async (_label, file) => {
    const original = bytes(file);
    expect(openCertificateFile(original, file.passphrase)).toEqual({
      ok: false,
      reason: "old_encryption",
    });
    const opened = await openOrRewrite(original, file.passphrase);
    if (!opened.ok || opened.rewritten === undefined) throw new Error("not rewritten");
    const leaf = new X509Certificate(file.certificatePems[0]!);
    expect(opened.details.fingerprint).toBe(leaf.fingerprint256);
    expect(storedCertificates(opened.rewritten)).toEqual(file.certificatePems.map(derOf));
    const server = await startAnsweringServer(
      { ...OPENSSL_AUTHORITY, caPem: EC_ROOT_PEM },
      { status: 200, body: SIN_DATOS_BODY },
    );
    const transport = mtlsFetch(
      { pfx: opened.rewritten, passphrase: file.passphrase, certKind: "sello" },
      OPENSSL_AUTHORITY.caPem,
    );
    try {
      expect((await transport.fetch(server.origin, { method: "POST", body: "" })).status).toBe(200);
      expect(server.sawClientCn()).toBe(leaf.subject.match(/^CN=(.*)$/m)![1]);
    } finally {
      await transport.close();
      await server.close();
    }
  });

  it("puts the key's certificate first and keeps the others in the file's order", () => {
    const authority = makeAuthority();
    const p12 = forge.pkcs12.pkcs12FromAsn1(
      forge.asn1.fromDer(bytes(RC2_SIGNED_CANDIDATE).toString("binary")),
      RC2_SIGNED_CANDIDATE.passphrase,
    );
    const key = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag! })[
      forge.pki.oids.pkcs8ShroudedKeyBag!
    ]![0]!.key!;
    const [leaf] = p12.getBags({ bagType: forge.pki.oids.certBag! })[forge.pki.oids.certBag!]!;
    const chain = [
      forge.pki.certificateFromPem(authority.caPem),
      forge.pki.certificateFromPem(OPENSSL_AUTHORITY.caPem),
      leaf!.cert!,
    ];
    const reordered = Buffer.from(
      forge.asn1
        .toDer(forge.pkcs12.toPkcs12Asn1(key, chain, "cert-pass-9", { algorithm: "3des" }))
        .getBytes(),
      "binary",
    );
    expect(storedCertificates(rewriteOldCertificate(reordered, "cert-pass-9")!)).toEqual(
      [chain[2]!, chain[0]!, chain[1]!].map((certificate) =>
        derOf(forge.pki.certificateToPem(certificate)),
      ),
    );
  });

  it("refuses a file holding a certificate bag Node cannot parse", () => {
    const { asn1, pki } = forge;
    const node = (type: number, value: string) =>
      asn1.create(asn1.Class.UNIVERSAL, type, false, value);
    const tagged = (value: Asn1) => asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [value]);
    const oid = (id: string) => node(asn1.Type.OID, asn1.oidToDer(id).getBytes());
    const sequence = (...value: Asn1[]) =>
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, value);
    const data = (value: Asn1) =>
      sequence(
        oid(pki.oids.data!),
        tagged(node(asn1.Type.OCTETSTRING, asn1.toDer(value).getBytes())),
      );
    const notACertificate = sequence(node(asn1.Type.INTEGER, "\x01"));
    const bag = (certificate: Asn1) =>
      sequence(
        oid(pki.oids.certBag!),
        tagged(
          sequence(
            oid(pki.oids.x509Certificate!),
            tagged(node(asn1.Type.OCTETSTRING, asn1.toDer(certificate).getBytes())),
          ),
        ),
      );
    const holding = (certificate: Asn1) =>
      sequence(node(asn1.Type.INTEGER, "\x03"), data(sequence(data(sequence(bag(certificate))))));
    const { passphrase } = RC2_SIGNED_CANDIDATE;
    const ca = forge.pki.certificateToAsn1(forge.pki.certificateFromPem(OPENSSL_AUTHORITY.caPem));
    expect(
      storedCertificates(rewriteOldCertificate(rc2With(holding(ca)), passphrase)!),
    ).toHaveLength(3);
    expect(rewriteOldCertificate(rc2With(holding(notACertificate)), passphrase)).toBeNull();
  });

  it("refuses a file holding a second key, shrouded or plain", async () => {
    const other = forge.pki.privateKeyFromPem(OPENSSL_AUTHORITY.serverKeyPem);
    const { passphrase } = RC2_SIGNED_CANDIDATE;
    expect(rewriteOldCertificate(rc2With(), passphrase)).not.toBeNull();
    for (const password of [passphrase, null]) {
      const twoKeys = rc2With(
        forge.pkcs12.toPkcs12Asn1(other, [], password, {
          algorithm: "3des",
          useMac: false,
          generateLocalKeyId: false,
        }),
      );
      expect(rewriteOldCertificate(twoKeys, passphrase)).toBeNull();
      expect(await openOrRewrite(twoKeys, passphrase)).toEqual({
        ok: false,
        reason: "old_encryption",
      });
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

  it("keeps old_encryption for a file node-forge cannot read either", async () => {
    expect(rewriteOldCertificate(bytes(RC4_CANDIDATE), RC4_CANDIDATE.passphrase)).toBeNull();
    expect(await openOrRewrite(bytes(RC4_CANDIDATE), RC4_CANDIDATE.passphrase)).toEqual({
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

  it("keeps old_encryption when Node refuses the rewritten file too", async () => {
    vi.mocked(openCertificateFile).mockClear();
    vi.mocked(openCertificateFile)
      .mockReturnValueOnce({ ok: false, reason: "old_encryption" })
      .mockReturnValueOnce({ ok: false, reason: "unreadable" });
    expect(
      await openOrRewrite(bytes(RC2_SIGNED_CANDIDATE), RC2_SIGNED_CANDIDATE.passphrase),
    ).toEqual({
      ok: false,
      reason: "old_encryption",
    });
    expect(openCertificateFile).toHaveBeenCalledTimes(2);
  });

  it("leaves a file Node opens, or refuses for another reason, as it is", async () => {
    const candidate = makeAuthority().issue();
    expect(await openOrRewrite(candidate.pfx, candidate.passphrase)).toEqual(
      openCertificateFile(candidate.pfx, candidate.passphrase),
    );
    expect(await openOrRewrite(bytes(RC2_SIGNED_CANDIDATE), "not-the-pass")).toEqual({
      ok: false,
      reason: "passphrase_wrong",
    });
  });
});

describe("the opener child's answer", () => {
  const ask = async (pfx: Buffer, passphrase: string, rewriteOld: boolean) =>
    JSON.parse(
      await answerOpener(JSON.stringify({ pfx: pfx.toString("base64"), passphrase, rewriteOld })),
    ) as Record<string, unknown>;

  it("opens with plain Node unless asked to rewrite", async () => {
    expect(await ask(bytes(RC2_SIGNED_CANDIDATE), RC2_SIGNED_CANDIDATE.passphrase, false)).toEqual({
      ok: false,
      reason: "old_encryption",
    });
  });

  it("sends a rewritten file as base64 beside its details", async () => {
    const { passphrase } = RC2_SIGNED_CANDIDATE;
    const answer = await ask(bytes(RC2_SIGNED_CANDIDATE), passphrase, true);
    expect(answer).toMatchObject({
      ok: true,
      details: { fingerprint: OPENSSL_SIGNED_FINGERPRINT },
    });
    expect(
      openCertificateFile(Buffer.from(answer.rewritten as string, "base64"), passphrase),
    ).toMatchObject({ ok: true, details: { fingerprint: OPENSSL_SIGNED_FINGERPRINT } });
  });

  it("sends no rewritten file for one Node opens", async () => {
    const candidate = makeAuthority().issue();
    const answer = await ask(candidate.pfx, candidate.passphrase, true);
    expect(answer).toMatchObject({ ok: true });
    expect(answer).not.toHaveProperty("rewritten");
  });
});
