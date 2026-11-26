import { createPrivateKey, randomBytes, X509Certificate } from "node:crypto";
import { AppError } from "@waitron/shared";
import { certificate, type CertExtension } from "@waitron/server-kit/certificate.js";
import forge from "node-forge";
import "./errors.js";

/** The public root, retained signer and serving identity, all PEM-encoded. */
export interface SelfSignedMaterial {
  /** A setup client trusts THIS to accept the leaf. */
  caCertPem: string;
  /** The intermediate certificate followed by its private key. */
  caKeyPem: string;
  serverCertPem: string;
  serverKeyPem: string;
}

export interface MintOptions {
  /** dNSName SANs on the leaf. At least one required. */
  hostnames: string[];
  /** iPAddress SANs on the leaf. May be empty. */
  ipAddresses: string[];
  now: Date;
  /** Lets a test reuse generated keys across mints. */
  keypair?: () => forge.pki.rsa.KeyPair;
}

const PERMITTED_DNS = ["waitron.local", "localhost"];
const PERMITTED_IPV4_CIDRS: Array<[string, number]> = [
  ["127.0.0.0", 8],
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
];

function ipv4Bytes(addr: string): number[] {
  return addr.split(".").map((o) => Number(o) & 0xff);
}

function ipv4Mask(prefix: number): number[] {
  const bits = 0xffffffff & (prefix === 0 ? 0 : ~0 << (32 - prefix));
  return [(bits >>> 24) & 0xff, (bits >>> 16) & 0xff, (bits >>> 8) & 0xff, bits & 0xff];
}

function ipv4ToInt(ip: string): number | undefined {
  const octets = ip.split(".");
  if (octets.length !== 4) return undefined;
  let value = 0;
  for (const octet of octets) {
    if (!/^\d{1,3}$/.test(octet)) return undefined;
    const n = Number(octet);
    if (n > 255) return undefined;
    value = value * 256 + n;
  }
  return value >>> 0;
}

/**
 * Whether `ip` sits inside one of the CA's permitted IPv4 subtrees. OpenSSL 3.6.3 refused the WHOLE
 * leaf, hostnames included, when any one address was outside them.
 */
export function isPermittedLeafIpv4(ip: string): boolean {
  const ipInt = ipv4ToInt(ip);
  if (ipInt === undefined) return false;
  return PERMITTED_IPV4_CIDRS.some(([addr, prefix]) => {
    const netInt = ipv4ToInt(addr);
    if (netInt === undefined) return false;
    const maskBytes = ipv4Mask(prefix);
    const mask =
      ((maskBytes[0]! << 24) | (maskBytes[1]! << 16) | (maskBytes[2]! << 8) | maskBytes[3]!) >>> 0;
    return (ipInt & mask) === (netInt & mask);
  });
}

/** The iPAddress SANs a box leaf carries: 127.0.0.1 and `listIpv4`'s, less any the CA cannot vouch for. */
export function leafIpv4s(listIpv4: () => string[]): string[] {
  return Array.from(new Set(["127.0.0.1", ...listIpv4()])).filter(isPermittedLeafIpv4);
}

/**
 * A pre-built `nameConstraints` extension (node-forge has no builder for it). The `value` is the DER
 * of `NameConstraints ::= SEQUENCE { permittedSubtrees [0] IMPLICIT SEQUENCE OF GeneralSubtree }`,
 * where a `GeneralSubtree` is `SEQUENCE { base GeneralName }`: dNSName is context `[2]` primitive
 * (IA5String bytes) and an iPAddress constraint is context `[7]` primitive holding address||mask.
 */
function nameConstraintsExtension(): CertExtension {
  const { asn1 } = forge;
  const dnsSubtrees = PERMITTED_DNS.map((name) =>
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.CONTEXT_SPECIFIC, 2, false, name),
    ]),
  );
  const ipSubtrees = PERMITTED_IPV4_CIDRS.map(([addr, prefix]) =>
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(
        asn1.Class.CONTEXT_SPECIFIC,
        7,
        false,
        String.fromCharCode(...ipv4Bytes(addr), ...ipv4Mask(prefix)),
      ),
    ]),
  );
  const permitted = asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
    ...dnsSubtrees,
    ...ipSubtrees,
  ]);
  const nameConstraints = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [permitted]);
  return {
    name: "nameConstraints",
    // The literal OID: node-forge 1.4.0 registers only id→name for 2.5.29.30, so
    // `forge.pki.oids.nameConstraints` is undefined and `setExtensions` would throw.
    id: "2.5.29.30",
    critical: true,
    value: asn1.toDer(nameConstraints).getBytes(),
  };
}

function caWithRole(pem: string, name: string, pathLength: number): forge.pki.Certificate | null {
  let cert: forge.pki.Certificate;
  try {
    cert = forge.pki.certificateFromPem(pem);
  } catch {
    return null;
  }
  const basic = cert.getExtension("basicConstraints") as CertExtension | null;
  const usage = cert.getExtension("keyUsage") as CertExtension | null;
  return cert.subject.getField("CN")?.value === name &&
    basic?.cA === true &&
    basic.pathLenConstraint === pathLength &&
    usage?.keyCertSign === true &&
    cert.getExtension("extKeyUsage") === null
    ? cert
    : null;
}

function pemBlocks(pem: string) {
  try {
    return forge.pem.decode(pem);
  } catch {
    return [];
  }
}

export function boxCertCurrent(cert: X509Certificate, now: Date): boolean {
  return cert.validFromDate <= now && now < cert.validToDate;
}

export function boxRoot(pem: string): X509Certificate | null {
  const blocks = pemBlocks(pem);
  if (blocks.length !== 1 || blocks[0]?.type !== "CERTIFICATE") return null;
  const root = new X509Certificate(pem);
  return root.checkIssued(root) &&
    root.verify(root.publicKey) &&
    caWithRole(pem, CA_COMMON_NAME, 1) !== null
    ? root
    : null;
}

function signerCertificate(block: forge.pem.ObjectPEM, root: X509Certificate) {
  if (block.type !== "CERTIFICATE") return null;
  const pem = forge.pem.encode(block);
  const cert = new X509Certificate(pem);
  const signer = caWithRole(pem, SIGNER_COMMON_NAME, 0);
  const constraints = signer?.getExtension("nameConstraints") as CertExtension | null;
  if (
    !cert.checkIssued(root) ||
    !cert.verify(root.publicKey) ||
    cert.publicKey.equals(root.publicKey) ||
    constraints?.critical !== true ||
    constraints.value !== nameConstraintsExtension().value
  )
    return null;
  return { cert, pem };
}

export function boxSigner(pem: string, root: X509Certificate) {
  const [certBlock, keyBlock, extra] = pemBlocks(pem);
  if (!certBlock || !keyBlock || extra || !/^(RSA )?PRIVATE KEY$/.test(keyBlock.type)) return null;
  const signer = signerCertificate(certBlock, root);
  const keyPem = forge.pem.encode(keyBlock);
  return signer?.cert.checkPrivateKey(createPrivateKey(keyPem)) ? { ...signer, keyPem } : null;
}

export function boxLeafChain(pem: string, root: X509Certificate, role: "server" | "client") {
  const [leafBlock, signerBlock, ...rest] = pemBlocks(pem);
  if (leafBlock?.type !== "CERTIFICATE" || !signerBlock || rest.length > 1) return null;
  if (rest.length === 1 && !/^(RSA )?PRIVATE KEY$/.test(rest[0]!.type)) return null;
  const signer = signerCertificate(signerBlock, root);
  if (!signer) return null;
  const leaf = new X509Certificate(forge.pem.encode(leafBlock));
  const usage = role === "server" ? "1.3.6.1.5.5.7.3.1" : "1.3.6.1.5.5.7.3.2";
  return !leaf.ca &&
    leaf.checkIssued(signer.cert) &&
    leaf.verify(signer.cert.publicKey) &&
    leaf.keyUsage?.includes(usage)
    ? { leaf, signer: signer.cert }
    : null;
}

function signerFor(rootPem: string, signerPem: string, now: Date) {
  const root = boxRoot(rootPem);
  const signer = root && boxSigner(signerPem, root);
  if (!root || !signer || !boxCertCurrent(root, now) || !boxCertCurrent(signer.cert, now)) {
    throw new AppError("setup.not_ready", {});
  }
  return {
    pem: signer.pem,
    key: forge.pki.privateKeyFromPem(signer.keyPem),
    validity: validityFrom(
      now,
      Math.min(root.validToDate.getTime(), signer.cert.validToDate.getTime()),
    ),
  };
}

const DAY_MS = 86_400_000;
/** The box is a long-lived appliance; a short leaf would strand a running venue. */
const VALIDITY_DAYS = 3650;
const CA_COMMON_NAME = "waitron-setup-ca";
const SIGNER_COMMON_NAME = "waitron-box-signer";

/**
 * Random rather than fixed: the same CA signs again on every re-issue, and X.509 serials must be
 * unique per issuer.
 */
function randomSerial(): string {
  const bytes = randomBytes(16);
  // Top byte 0x40–0x7f: positive and minimally encoded, because OpenSSL refuses a padded INTEGER.
  bytes[0] = (bytes[0]! & 0x3f) | 0x40;
  return bytes.toString("hex");
}

/** Refuses an empty `hostnames` before any RSA-2048 generation. */
function keypairFor(
  hostnames: string[],
  keypair: (() => forge.pki.rsa.KeyPair) | undefined,
): () => forge.pki.rsa.KeyPair {
  if (hostnames.length === 0) throw new AppError("setup.cert_hostnames_empty", {});
  return keypair ?? (() => forge.pki.rsa.generateKeyPair(2048));
}

/** From a day before `now` (clock-skew slack) to `VALIDITY_DAYS` after it, or `cap` if earlier. */
function validityFrom(now: Date, cap = Infinity): { notBefore: Date; notAfter: Date } {
  return {
    notBefore: new Date(now.getTime() - DAY_MS),
    notAfter: new Date(Math.min(now.getTime() + VALIDITY_DAYS * DAY_MS, cap)),
  };
}

/** The leaf's extensions and SANs, shared by minting and re-issuing so the two cannot drift. */
function signLeaf(
  caKey: forge.pki.rsa.PrivateKey,
  serverKeys: forge.pki.rsa.KeyPair,
  hostnames: string[],
  ipAddresses: string[],
  validity: { notBefore: Date; notAfter: Date },
): forge.pki.Certificate {
  // type 2 is dNSName, type 7 is iPAddress.
  const altNames = [
    ...hostnames.map((value) => ({ type: 2, value })),
    ...ipAddresses.map((ip) => ({ type: 7, ip })),
  ];
  return certificate(
    hostnames[0],
    serverKeys,
    { cn: SIGNER_COMMON_NAME, key: caKey },
    randomSerial(),
    validity,
    [
      { name: "basicConstraints", cA: false },
      { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
      { name: "extKeyUsage", serverAuth: true },
      { name: "subjectAltName", altNames },
    ],
  );
}

export function mintSelfSignedServerCert(opts: MintOptions): SelfSignedMaterial {
  const { hostnames, ipAddresses, now } = opts;
  const makeKeypair = keypairFor(hostnames, opts.keypair);
  const validity = validityFrom(now);
  const rootKeys = makeKeypair();
  const rootIssuer = { cn: CA_COMMON_NAME, key: rootKeys.privateKey };
  const caUsage = { name: "keyUsage", keyCertSign: true, cRLSign: true, digitalSignature: true };
  const root = certificate(CA_COMMON_NAME, rootKeys, rootIssuer, randomSerial(), validity, [
    { name: "basicConstraints", cA: true, pathLenConstraint: 1 },
    caUsage,
  ]);
  const signerKeys = makeKeypair();
  const signer = certificate(SIGNER_COMMON_NAME, signerKeys, rootIssuer, randomSerial(), validity, [
    { name: "basicConstraints", cA: true, pathLenConstraint: 0 },
    caUsage,
    nameConstraintsExtension(),
  ]);
  const signerPem = forge.pki.certificateToPem(signer);
  const serverKeys = makeKeypair();
  const serverCert = signLeaf(signerKeys.privateKey, serverKeys, hostnames, ipAddresses, validity);

  return {
    caCertPem: forge.pki.certificateToPem(root),
    caKeyPem: signerPem + forge.pki.privateKeyToPem(signerKeys.privateKey),
    serverCertPem: forge.pki.certificateToPem(serverCert) + signerPem,
    serverKeyPem: forge.pki.privateKeyToPem(serverKeys.privateKey),
  };
}

/**
 * A new leaf, with a new key pair, signed by an EXISTING authority. Devices trust the authority,
 * not the leaf, so they accept it without a new trust step. The leaf never outlives its authority.
 */
export function reissueServerLeaf(opts: {
  caCertPem: string;
  caKeyPem: string;
  hostnames: string[];
  ipAddresses: string[];
  now: Date;
  keypair?: () => forge.pki.rsa.KeyPair;
}): { serverCertPem: string; serverKeyPem: string } {
  const makeKeypair = keypairFor(opts.hostnames, opts.keypair);
  const signer = signerFor(opts.caCertPem, opts.caKeyPem, opts.now);
  const serverKeys = makeKeypair();
  const leaf = signLeaf(signer.key, serverKeys, opts.hostnames, opts.ipAddresses, signer.validity);
  return {
    serverCertPem: forge.pki.certificateToPem(leaf) + signer.pem,
    serverKeyPem: forge.pki.privateKeyToPem(serverKeys.privateKey),
  };
}

/**
 * A client certificate for `hostname`, signed by an existing authority: `clientAuth` only, so it
 * cannot serve as a server leaf, and the box's server leaf cannot stand in for it. It never
 * outlives its authority.
 */
export function issueClientCert(opts: {
  caCertPem: string;
  caKeyPem: string;
  hostname: string;
  now: Date;
  keypair?: () => forge.pki.rsa.KeyPair;
}): { clientCertPem: string; clientKeyPem: string } {
  const makeKeypair = keypairFor([opts.hostname], opts.keypair);
  const signer = signerFor(opts.caCertPem, opts.caKeyPem, opts.now);
  const keys = makeKeypair();
  const cert = certificate(
    opts.hostname,
    keys,
    { cn: SIGNER_COMMON_NAME, key: signer.key },
    randomSerial(),
    signer.validity,
    [
      { name: "basicConstraints", cA: false },
      { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
      { name: "extKeyUsage", clientAuth: true },
      { name: "subjectAltName", altNames: [{ type: 2, value: opts.hostname }] },
    ],
  );
  return {
    clientCertPem: forge.pki.certificateToPem(cert) + signer.pem,
    clientKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
}
