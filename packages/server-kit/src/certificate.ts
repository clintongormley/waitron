import forge from "node-forge";

/**
 * The extension shapes `forge.pki.Certificate#setExtensions` accepts. `@types/node-forge` types that
 * parameter as `any[]` and exports no extension type, so this is a narrower stand-in covering the
 * fields Waitron's certificates use.
 */
export interface CertExtension {
  name: string;
  cA?: boolean;
  pathLenConstraint?: number;
  keyCertSign?: boolean;
  cRLSign?: boolean;
  digitalSignature?: boolean;
  keyEncipherment?: boolean;
  serverAuth?: boolean;
  clientAuth?: boolean;
  /** `type` 2 is a dNSName (`value`), 7 an iPAddress (`ip`). */
  altNames?: Array<{ type: number; value?: string; ip?: string }>;
  /**
   * A pre-built extension node-forge has no builder for: the literal OID, its criticality, and the
   * raw DER bytes emitted verbatim.
   */
  id?: string;
  critical?: boolean;
  value?: string;
}

interface CertificateIssuer {
  cn: string;
  key: forge.pki.rsa.PrivateKey;
}

/**
 * An X.509 certificate with a single-CN subject and issuer, signed SHA-256 by `issuer.key`. A
 * self-signed certificate passes its own CN and private key as the issuer.
 */
export function certificate(
  subjectCn: string,
  subjectKeys: forge.pki.rsa.KeyPair,
  issuer: CertificateIssuer,
  serialNumber: string,
  validity: { notBefore: Date; notAfter: Date },
  extensions: CertExtension[],
): forge.pki.Certificate {
  const cert = forge.pki.createCertificate();
  cert.publicKey = subjectKeys.publicKey;
  cert.serialNumber = serialNumber;
  cert.validity.notBefore = validity.notBefore;
  cert.validity.notAfter = validity.notAfter;
  cert.setSubject([{ name: "commonName", value: subjectCn }]);
  cert.setIssuer([{ name: "commonName", value: issuer.cn }]);
  cert.setExtensions(extensions);
  cert.sign(issuer.key, forge.md.sha256.create());
  return cert;
}
