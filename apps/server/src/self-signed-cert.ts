import { randomBytes } from "node:crypto";
import { AppError } from "@waitron/shared";
import forge from "node-forge";
import "./errors.js";

/**
 * A private CA and the server certificate it signs, both PEM-encoded — everything the box needs to
 * serve setup-mode HTTPS from a self-signed identity it mints on first boot (onboarding slice 2a).
 * This is the productised, server-cert-only counterpart of `testing/tls.ts`'s `mintMtlsMaterial`,
 * which also mints a CLIENT certificate and a PKCS#12 bundle for the mTLS suite — a different shape
 * this module deliberately does not carry.
 */
export interface SelfSignedMaterial {
  /** The CA certificate, PEM. A setup client trusts THIS to accept the server cert below. */
  caCertPem: string;
  /** The CA private key, PEM. Kept so the same CA can later re-sign a rotated leaf. */
  caKeyPem: string;
  /** The leaf server certificate, PEM. Served as `cert` to `node:https`. */
  serverCertPem: string;
  /** The leaf's private key, PEM. Served as `key` to `node:https`. */
  serverKeyPem: string;
}

export interface MintOptions {
  /** dNSName SANs on the leaf, e.g. ["waitron.local", "localhost"]. At least one required. */
  hostnames: string[];
  /** iPAddress SANs on the leaf, e.g. ["127.0.0.1", "192.168.1.50"]. May be empty. */
  ipAddresses: string[];
  /** Clock, injected so the validity window is deterministic in tests. */
  now: Date;
  /**
   * Keypair factory, injected so a test can reuse one keypair instead of paying RSA-2048 generation
   * twice per mint. Defaults to `forge.pki.rsa.generateKeyPair(2048)`.
   */
  keypair?: () => forge.pki.rsa.KeyPair;
}

/**
 * The shape `forge.pki.Certificate#setExtensions` actually accepts. The installed `@types/node-forge`
 * types that parameter as `any[]` and exports no `CertificateExtension` — so this is this file's own,
 * narrower stand-in for the extension shapes the two certs below construct, the same idiom
 * `testing/tls.ts` uses. It carries only the fields used here (`cRLSign`, present for the CA, is the
 * one addition over that file's copy; `clientAuth` is dropped — no client cert is minted).
 */
interface CertExtension {
  name: string;
  cA?: boolean;
  keyCertSign?: boolean;
  cRLSign?: boolean;
  digitalSignature?: boolean;
  keyEncipherment?: boolean;
  serverAuth?: boolean;
  altNames?: Array<{ type: number; value?: string; ip?: string }>;
}

const DAY_MS = 86_400_000;
/** ~10 years. The box is a long-lived appliance; a short leaf would strand a running venue. */
const VALIDITY_DAYS = 3650;
/** The CA's subject CN, reused as the leaf's issuer CN so `ca.verify(leaf)` chains. */
const CA_COMMON_NAME = "waitron-setup-ca";

/**
 * A fresh, positive X.509 serial as a hex string. The CA key is kept (see `caKeyPem` above) so the
 * same CA can re-sign a rotated leaf in a later slice — a hardcoded leaf serial would collide with
 * itself the second time that CA signs, which violates X.509 serial uniqueness per issuer. Random
 * (rather than counter-based) sidesteps needing any persisted state to avoid that collision.
 */
function randomSerial(): string {
  const bytes = randomBytes(16);
  bytes[0] &= 0x7f; // clear the high bit so the ASN.1 INTEGER is positive (node-forge would otherwise treat it as negative)
  return bytes.toString("hex");
}

function certificate(
  subjectCn: string,
  subjectKeys: forge.pki.rsa.KeyPair,
  issuer: { cn: string; key: forge.pki.rsa.PrivateKey },
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

/**
 * Mint a private CA and a leaf server certificate signed by it, for the box to serve setup-mode
 * HTTPS. The leaf carries every `hostnames` entry as a `dNSName` SAN and every `ipAddresses` entry
 * as an `iPAddress` SAN, its CN is `hostnames[0]`, and it is `serverAuth`-only; the CA is a
 * `cA:true` signer. Both are valid from a day before `now` (clock-skew slack) to `VALIDITY_DAYS`
 * after it, and carry distinct, cryptographically random serials (see `randomSerial` below).
 *
 * Throws `setup.cert_hostnames_empty` when `hostnames` is empty — a leaf with no `dNSName`
 * authenticates no request, so it is refused BEFORE any keypair is generated (the guard costs no
 * RSA keygen).
 */
export function mintSelfSignedServerCert(opts: MintOptions): SelfSignedMaterial {
  const { hostnames, ipAddresses, now } = opts;

  // Validate before generating any keypair: the empty-hostnames path must not pay for RSA-2048
  // generation just to throw, and a leaf with no dNSName SAN is useless regardless.
  if (hostnames.length === 0) {
    throw new AppError("setup.cert_hostnames_empty", {});
  }

  const makeKeypair = opts.keypair ?? (() => forge.pki.rsa.generateKeyPair(2048));
  const validity = {
    notBefore: new Date(now.getTime() - DAY_MS),
    notAfter: new Date(now.getTime() + VALIDITY_DAYS * DAY_MS),
  };

  const caKeys = makeKeypair();
  const caCert = certificate(
    CA_COMMON_NAME,
    caKeys,
    { cn: CA_COMMON_NAME, key: caKeys.privateKey },
    randomSerial(),
    validity,
    [
      { name: "basicConstraints", cA: true },
      { name: "keyUsage", keyCertSign: true, cRLSign: true, digitalSignature: true },
    ],
  );

  const serverKeys = makeKeypair();
  // type 2 is dNSName, type 7 is iPAddress — the same encoding `testing/tls.ts` uses, so a client
  // can dial either a hostname or an IP the leaf carries.
  const altNames = [
    ...hostnames.map((value) => ({ type: 2, value })),
    ...ipAddresses.map((ip) => ({ type: 7, ip })),
  ];
  const serverCert = certificate(
    hostnames[0],
    serverKeys,
    { cn: CA_COMMON_NAME, key: caKeys.privateKey },
    randomSerial(),
    validity,
    [
      { name: "basicConstraints", cA: false },
      { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
      { name: "extKeyUsage", serverAuth: true },
      { name: "subjectAltName", altNames },
    ],
  );

  return {
    caCertPem: forge.pki.certificateToPem(caCert),
    caKeyPem: forge.pki.privateKeyToPem(caKeys.privateKey),
    serverCertPem: forge.pki.certificateToPem(serverCert),
    serverKeyPem: forge.pki.privateKeyToPem(serverKeys.privateKey),
  };
}
