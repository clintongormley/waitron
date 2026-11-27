import { createHash, createPrivateKey, X509Certificate } from "node:crypto";
import forge from "node-forge";
import { CERTIFICATE_MAX_BYTES } from "./certificate-limits.js";

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

// node-forge exports the cipher its PKCS#12 reader decrypts with here; its types leave it out.
const { getCipher } = (
  pki as unknown as {
    pbe: {
      getCipher(oid: string, params: forge.asn1.Asn1, password: string): forge.cipher.BlockCipher;
    };
  }
).pbe;

type Asn1 = forge.asn1.Asn1;

const parts = (node: Asn1) => node.value as Asn1[];
const oidOf = (node: Asn1) => asn1.derToOid(node.value as string);

function seq(...value: Asn1[]): Asn1 {
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, value);
}

function set(...value: Asn1[]): Asn1 {
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, value);
}

function octets(value: string): Asn1 {
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, value);
}

function oid(id: string): Asn1 {
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(id).getBytes());
}

function explicit(value: Asn1): Asn1 {
  return asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [value]);
}

/** A PKCS#7 data ContentInfo holding `value`. */
function data(value: Asn1): Asn1 {
  return seq(oid(pki.oids.data!), explicit(octets(asn1.toDer(value).getBytes())));
}

/** An OCTET STRING's bytes, BER's chunked form included. */
function octetBytes(node: Asn1): string {
  return node.constructed ? parts(node).map(octetBytes).join("") : (node.value as string);
}

function decrypted(encryptedData: Asn1, password: string): string {
  const [, algorithm, content] = parts(parts(encryptedData)[1]!);
  const [id, params] = parts(algorithm!);
  const cipher = getCipher(oidOf(id!), params!, password);
  cipher.update(forge.util.createBuffer(octetBytes(content!)));
  // pkcs12FromAsn1 has already decrypted these bytes with this password.
  cipher.finish();
  return cipher.output.getBytes();
}

/**
 * Every certificate bag's certificate as the file stores it, in the file's order. forge's own
 * reading drops those it cannot parse, any signed with ECDSA among them.
 */
function storedCertificates(pfx: Asn1, password: string): Buffer[] {
  const authSafe = asn1.fromDer(octetBytes(parts(parts(parts(pfx)[1]!)[1]!)[0]!));
  return parts(authSafe).flatMap((info) => {
    const [type, content] = parts(info);
    const body = parts(content!)[0]!;
    const safeContents =
      oidOf(type!) === pki.oids.data ? octetBytes(body) : decrypted(body, password);
    return parts(asn1.fromDer(safeContents))
      .filter((bag) => oidOf(parts(bag)[0]!) === pki.oids.certBag)
      .map((bag) => {
        const certificate = parts(parts(parts(parts(bag)[1]!)[0]!)[1]!)[0]!;
        return Buffer.from(octetBytes(certificate), "binary");
      });
  });
}

/**
 * The PKCS#12 MAC key comes from the passphrase as UTF-16 (RFC 7292 B.1), but PBES2 key encryption
 * from its UTF-8 bytes, as OpenSSL reads both. node-forge feeds one string to both, so the key is
 * encrypted with forge and the MAC added here.
 */
function withMac(pfx: Asn1, passphrase: string): Asn1 {
  const safe = parts(parts(parts(pfx)[1]!)[1]!)[0]!.value as string;
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
      seq(oid(pki.oids.sha256!), asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, "")),
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
  parts(pfx).push(macData);
  return pfx;
}

/**
 * The file's one RSA key, the certificate for it and the others it stores, or `null`, which a
 * certificate Node cannot parse also gives.
 */
function readOld(
  pfx: Buffer,
  password: string,
): { key: forge.pki.rsa.PrivateKey; own: Buffer; others: Buffer[] } | null {
  try {
    const p12 = forge.pkcs12.pkcs12FromAsn1(asn1.fromDer(pfx.toString("binary")), password);
    const keys = [pki.oids.pkcs8ShroudedKeyBag!, pki.oids.keyBag!].flatMap(
      (bagType) => p12.getBags({ bagType })[bagType]!,
    );
    const key = keys.length === 1 ? (keys[0]!.key as forge.pki.rsa.PrivateKey | null) : null;
    if (key?.n === undefined) return null;
    const stored = storedCertificates(asn1.fromDer(pfx.toString("binary")), password);
    const privateKey = createPrivateKey(pki.privateKeyToPem(key));
    const ownIndex = stored
      .map((der) => new X509Certificate(der))
      .findIndex((certificate) => certificate.checkPrivateKey(privateKey));
    if (ownIndex === -1) return null;
    return { key, own: stored[ownIndex]!, others: stored.filter((_, index) => index !== ownIndex) };
  } catch {
    return null;
  }
}

/**
 * Reads a PKCS#12 file node-forge understands (40-bit RC2 among them) and writes it again with its
 * key under AES-256 and the same passphrase, beside every certificate it holds, each as stored, the
 * key's own first. `readAs` is the passphrase's spelling forge reads the file with. `null` when
 * forge cannot read it, it holds other than one key, that key is not RSA, no certificate is its own
 * or Node cannot parse one, or the rewrite is larger than `maxBytes`, which every later reader refuses.
 */
export function rewriteOldCertificate(
  pfx: Buffer,
  passphrase: string,
  {
    readAs = passphrase,
    maxBytes = CERTIFICATE_MAX_BYTES,
  }: { readAs?: string; maxBytes?: number } = {},
): Buffer | null {
  const read = readOld(pfx, readAs);
  if (read === null) return null;
  const { key, own, others } = read;
  const keyId = set(
    seq(oid(pki.oids.localKeyId!), set(octets(createHash("sha1").update(own).digest("binary")))),
  );
  const certificateBags = [own, ...others].map((der, index) =>
    seq(
      oid(pki.oids.certBag!),
      explicit(seq(oid(pki.oids.x509Certificate!), explicit(octets(der.toString("binary"))))),
      ...(index === 0 ? [keyId] : []),
    ),
  );
  const keyBag = seq(
    oid(pki.oids.pkcs8ShroudedKeyBag!),
    explicit(
      pki.encryptPrivateKeyInfo(
        pki.wrapRsaPrivateKey(pki.privateKeyToAsn1(key)),
        forge.util.encodeUtf8(passphrase),
        { algorithm: "aes256" },
      ),
    ),
    keyId,
  );
  const written = seq(
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, asn1.integerToDer(3).getBytes()),
    data(seq(data(seq(...certificateBags)), data(seq(keyBag)))),
  );
  const rewritten = Buffer.from(asn1.toDer(withMac(written, passphrase)).getBytes(), "binary");
  return rewritten.length > maxBytes ? null : rewritten;
}
