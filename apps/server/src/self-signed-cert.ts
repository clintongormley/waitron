import { randomBytes } from "node:crypto";
import { AppError } from "@waitron/shared";
import { certificate, type CertExtension } from "@waitron/server-kit/certificate.js";
import forge from "node-forge";
import "./errors.js";

/**
 * A private CA and the server certificate it signs, both PEM-encoded — everything the box needs to
 * serve setup-mode HTTPS from a self-signed identity it mints on first boot.
 */
export interface SelfSignedMaterial {
  /** The CA certificate, PEM. A setup client trusts THIS to accept the server cert below. */
  caCertPem: string;
  /** The CA private key, PEM. Kept for {@link reissueServerLeaf}. */
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
 * The CA's permitted name space. Loopback + the three RFC1918 ranges are in the set (the box leaf
 * carries `localhost`/`127.0.0.1` SANs and a LAN address); nothing public is, so the root can never
 * vouch for an outside name. Android ignores this extension on a user root (spike §7) — kept anyway
 * because it constrains on desktop and iOS and costs nothing.
 */
const PERMITTED_DNS = ["waitron.local", "localhost"];
const PERMITTED_IPV4_CIDRS: Array<[string, number]> = [
  ["127.0.0.0", 8],
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
];

/** IPv4 dotted-quad → 4 bytes. */
function ipv4Bytes(addr: string): number[] {
  return addr.split(".").map((o) => Number(o) & 0xff);
}

/** A /n prefix length → 4 mask bytes. */
function ipv4Mask(prefix: number): number[] {
  const bits = 0xffffffff & (prefix === 0 ? 0 : ~0 << (32 - prefix));
  return [(bits >>> 24) & 0xff, (bits >>> 16) & 0xff, (bits >>> 8) & 0xff, bits & 0xff];
}

/** A dotted-quad string → its unsigned 32-bit value, or `undefined` when it is not a well-formed IPv4
 * address (an IPv6 literal, a hostname, an out-of-range or malformed octet). */
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
 * Whether `ip` sits inside one of the CA's permitted IPv4 subtrees ({@link PERMITTED_IPV4_CIDRS}).
 * The invariant: a leaf's iPAddress SANs must be a SUBSET of the CA's permitted set, or the CA cannot
 * vouch for the leaf and `ca.verify(leaf)` fails on a permitted-subtree violation — the box then
 * cannot serve HTTPS at all. `box-secrets.ts` filters its candidate IP SANs through this so an
 * out-of-set interface address (a Tailscale 100.64/10 CGNAT address, a 169.254/16 link-local, a
 * public IP, or an IPv6 address) is dropped from the SAN rather than poisoning the whole cert. A
 * non-IPv4 string is never permitted. Loopback (127.0.0.1) is inside 127.0.0.0/8 and so retained.
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
    // The LITERAL OID: node-forge 1.4.0 registers only id→name for 2.5.29.30, so
    // `forge.pki.oids.nameConstraints` is undefined and `setExtensions` would throw "Extension ID
    // not specified." Do not "simplify" this to the oids lookup.
    id: "2.5.29.30",
    critical: true,
    value: asn1.toDer(nameConstraints).getBytes(),
  };
}

const DAY_MS = 86_400_000;
/** ~10 years. The box is a long-lived appliance; a short leaf would strand a running venue. */
const VALIDITY_DAYS = 3650;
/** The CA's subject CN, reused as the leaf's issuer CN so `ca.verify(leaf)` chains. */
const CA_COMMON_NAME = "waitron-setup-ca";

/**
 * A fresh, positive X.509 serial as a hex string. The same CA signs again when a restored box
 * re-issues its leaf ({@link reissueServerLeaf}) — a hardcoded leaf serial would collide with
 * itself the second time that CA signs, which violates X.509 serial uniqueness per issuer. Random
 * (rather than counter-based) sidesteps needing any persisted state to avoid that collision.
 */
function randomSerial(): string {
  const bytes = randomBytes(16);
  bytes[0] &= 0x7f; // clear the high bit so the ASN.1 INTEGER is positive (node-forge would otherwise treat it as negative)
  return bytes.toString("hex");
}

/**
 * The key-pair factory a mint or re-issue uses, after refusing an empty `hostnames`: a leaf with no
 * dNSName SAN authenticates no request, and the refusal comes before any RSA-2048 generation.
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
  // type 2 is dNSName, type 7 is iPAddress, so a client can dial either a hostname or an IP.
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
