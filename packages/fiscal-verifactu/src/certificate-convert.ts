import forge from "node-forge";
import {
  openCertificateFile,
  type CertificateDetails,
  type OpenResult,
} from "./certificate-file.js";
import { CERTIFICATE_MAX_BYTES } from "./certificate-limits.js";

export type RewrittenResult =
  { ok: true; details: CertificateDetails; rewritten?: Buffer } | Exclude<OpenResult, { ok: true }>;

const { asn1, pki } = forge;
const MAC_ITERATIONS = 2048;
// node-forge exports RFC 7292 B.2's derivation here; its types leave it out.
const { generateKey } = forge.pkcs12 as unknown as {
  generateKey(
    password: string,
    salt: forge.util.ByteStringBuffer,
    id: number,
    iterations: number,
    length: number,
    md: forge.md.MessageDigest,
  ): forge.util.ByteStringBuffer;
};

function seq(...value: forge.asn1.Asn1[]): forge.asn1.Asn1 {
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, value);
}

function octets(value: string): forge.asn1.Asn1 {
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, value);
}

/**
 * The PKCS#12 MAC key comes from the passphrase as UTF-16 (RFC 7292 B.1), but PBES2 key encryption
 * from its UTF-8 bytes, as OpenSSL reads both. node-forge feeds one string to both, so the key is
 * encrypted with forge and the MAC added here.
 */
function withMac(pfx: forge.asn1.Asn1, passphrase: string): forge.asn1.Asn1 {
  const content = (pfx.value as forge.asn1.Asn1[])[1]!;
  const safe = ((content.value as forge.asn1.Asn1[])[1]!.value as forge.asn1.Asn1[])[0]!
    .value as string;
  const salt = forge.random.getBytesSync(16);
  const key = generateKey(
    passphrase,
    new forge.util.ByteStringBuffer(salt),
    3,
    MAC_ITERATIONS,
    32,
    forge.md.sha256.create(),
  );
  const mac = forge.hmac.create();
  mac.start(forge.md.sha256.create(), key.getBytes());
  mac.update(safe);
  const macData = seq(
    seq(
      seq(
        asn1.create(
          asn1.Class.UNIVERSAL,
          asn1.Type.OID,
          false,
          asn1.oidToDer(pki.oids.sha256!).getBytes(),
        ),
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ""),
      ),
      octets(mac.digest().getBytes()),
    ),
    octets(salt),
    asn1.create(
      asn1.Class.UNIVERSAL,
      asn1.Type.INTEGER,
      false,
      asn1.integerToDer(MAC_ITERATIONS).getBytes(),
    ),
  );
  (pfx.value as forge.asn1.Asn1[]).push(macData);
  return pfx;
}

/**
 * Reads a PKCS#12 file node-forge understands (40-bit RC2 among them) and writes it again with its
 * key under AES-256 and the same passphrase. `readAs` is the passphrase's spelling forge reads the
 * file with. `null` when forge cannot read it, it holds no RSA key with a certificate for it, or
 * the rewrite is larger than `maxBytes`, which every later reader refuses.
 */
export function rewriteOldCertificate(
  pfx: Buffer,
  passphrase: string,
  {
    readAs = passphrase,
    maxBytes = CERTIFICATE_MAX_BYTES,
  }: { readAs?: string; maxBytes?: number } = {},
): Buffer | null {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1.fromDer(pfx.toString("binary")), readAs);
  } catch {
    return null;
  }
  const keyBag = pki.oids.pkcs8ShroudedKeyBag!;
  const key = p12.getBags({ bagType: keyBag })[keyBag]![0]?.key as
    forge.pki.rsa.PrivateKey | undefined;
  if (key?.n === undefined) return null;
  const certBag = pki.oids.certBag!;
  const certBags = p12.getBags({ bagType: certBag })[certBag]!;
  const certificates = certBags
    .map((bag) => bag.cert)
    .filter((cert): cert is forge.pki.Certificate => cert != null);
  const own = certificates.find((cert) =>
    (cert.publicKey as forge.pki.rsa.PublicKey).n.equals(key.n),
  );
  if (own === undefined) return null;
  const written = forge.pkcs12.toPkcs12Asn1(
    key,
    [own, ...certificates.filter((cert) => cert !== own)],
    forge.util.encodeUtf8(passphrase),
    { algorithm: "aes256", useMac: false },
  );
  const rewritten = Buffer.from(asn1.toDer(withMac(written, passphrase)).getBytes(), "binary");
  return rewritten.length > maxBytes ? null : rewritten;
}

/**
 * macOS's export derives every key from the passphrase's UTF-8 bytes taken one character each, as
 * OpenSSL 1.0 did, so Node calls a passphrase outside ASCII wrong; forge reads that spelling.
 */
function readSpelling(reason: string, passphrase: string): string | null {
  if (reason === "old_encryption") return passphrase;
  if (reason !== "passphrase_wrong") return null;
  const spelling = forge.util.encodeUtf8(passphrase);
  return spelling === passphrase ? null : spelling;
}

/**
 * Opens the file; one Node refuses as old encryption, or a macOS export under a passphrase outside
 * ASCII, is opened again once rewritten under the passphrase as typed.
 */
export function openOrRewrite(pfx: Buffer, passphrase: string): RewrittenResult {
  const opened = openCertificateFile(pfx, passphrase);
  if (opened.ok) return opened;
  const readAs = readSpelling(opened.reason, passphrase);
  if (readAs === null) return opened;
  const rewritten = rewriteOldCertificate(pfx, passphrase, { readAs });
  if (rewritten === null) return opened;
  const again = openCertificateFile(rewritten, passphrase);
  return again.ok ? { ...again, rewritten } : opened;
}
