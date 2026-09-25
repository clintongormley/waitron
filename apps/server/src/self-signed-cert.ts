import { randomBytes } from "node:crypto";
import { AppError } from "@waitron/shared";
import { certificate, type CertExtension } from "@waitron/server-kit/certificate.js";
import forge from "node-forge";
import "./errors.js";

/** A private CA and the leaf server certificate it signs, all PEM-encoded. */
export interface SelfSignedMaterial {
  /** A setup client trusts THIS to accept the leaf. */
  caCertPem: string;
  /** Kept for {@link reissueServerLeaf}. */
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
  /** Lets a test reuse one keypair instead of paying RSA-2048 generation twice per mint. */
  keypair?: () => forge.pki.rsa.KeyPair;
}

/**
 * The CA's permitted name space: `waitron.local`, `localhost`, loopback and the three RFC1918
 * ranges. Nothing public is in it, so the root can never vouch for an outside name.
 */
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
 * Whether `ip` sits inside one of the CA's permitted IPv4 subtrees. A leaf's iPAddress SANs must
 * be a subset of that set, or `ca.verify(leaf)` fails and the box serves no HTTPS at all, so an
 * address outside it is dropped from the SAN list rather than added.
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

const DAY_MS = 86_400_000;
/** The box is a long-lived appliance; a short leaf would strand a running venue. */
const VALIDITY_DAYS = 3650;
/** The CA's subject CN, reused as the leaf's issuer CN so `ca.verify(leaf)` chains. */
const CA_COMMON_NAME = "waitron-setup-ca";

/**
 * Random rather than fixed: the same CA signs again on every re-issue, and X.509 serials must be
 * unique per issuer.
 */
function randomSerial(): string {
  const bytes = randomBytes(16);
  bytes[0] &= 0x7f; // keeps the ASN.1 INTEGER positive
  return bytes.toString("hex");
}

/**
 * Refuses an empty `hostnames` before any RSA-2048 generation: a leaf with no dNSName SAN
 * authenticates no request.
 */
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
    { cn: CA_COMMON_NAME, key: caKey },
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

/**
 * Mint a private CA and a leaf server certificate signed by it. The leaf's CN is `hostnames[0]`.
 * Throws `setup.cert_hostnames_empty` when `hostnames` is empty.
 */
export function mintSelfSignedServerCert(opts: MintOptions): SelfSignedMaterial {
  const { hostnames, ipAddresses, now } = opts;
  const makeKeypair = keypairFor(hostnames, opts.keypair);
  const validity = validityFrom(now);

  const caKeys = makeKeypair();
  const caCert = certificate(
    CA_COMMON_NAME,
    caKeys,
    { cn: CA_COMMON_NAME, key: caKeys.privateKey },
    randomSerial(),
    validity,
    [
      { name: "basicConstraints", cA: true, pathLenConstraint: 0 },
      { name: "keyUsage", keyCertSign: true, cRLSign: true, digitalSignature: true },
      nameConstraintsExtension(),
    ],
  );

  const serverKeys = makeKeypair();
  const serverCert = signLeaf(caKeys.privateKey, serverKeys, hostnames, ipAddresses, validity);

  return {
    caCertPem: forge.pki.certificateToPem(caCert),
    caKeyPem: forge.pki.privateKeyToPem(caKeys.privateKey),
    serverCertPem: forge.pki.certificateToPem(serverCert),
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
  const caCert = forge.pki.certificateFromPem(opts.caCertPem);
  const caKey = forge.pki.privateKeyFromPem(opts.caKeyPem) as forge.pki.rsa.PrivateKey;
  const serverKeys = makeKeypair();
  const leaf = signLeaf(
    caKey,
    serverKeys,
    opts.hostnames,
    opts.ipAddresses,
    validityFrom(opts.now, caCert.validity.notAfter.getTime()),
  );
  return {
    serverCertPem: forge.pki.certificateToPem(leaf),
    serverKeyPem: forge.pki.privateKeyToPem(serverKeys.privateKey),
  };
}
