import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { isPairingUuid } from "./pairing-proof.js";
import {
  invalid,
  decode,
  publicKey,
  originValid,
  dateValid,
  envelope,
  type SignedEnvelope,
} from "./installation-proof.js";
export interface LeaseInput {
  origin: string;
  leaseId: string;
  installationId: string;
  venueId: string;
  environment: "test" | "production";
  publicKey: string;
  issuedAt: number;
  expiresAt: number;
}
export interface LeaseClaims extends LeaseInput {
  keyId: string;
  audience: "control";
}
function encodeLease(c: LeaseClaims): Buffer {
  return Buffer.from(
    JSON.stringify([
      "waitron-cloud-access-v1",
      c.origin,
      c.keyId,
      c.leaseId,
      c.installationId,
      c.venueId,
      c.environment,
      c.publicKey,
      c.issuedAt,
      c.expiresAt,
      c.audience,
    ]),
  );
}
function validateLease(c: LeaseClaims): void {
  if (
    !originValid(c.origin) ||
    !/^[A-Za-z0-9_-]{43}$/.test(c.keyId) ||
    ![c.leaseId, c.installationId, c.venueId].every(isPairingUuid) ||
    !["test", "production"].includes(c.environment) ||
    !dateValid(c.issuedAt) ||
    !dateValid(c.expiresAt) ||
    c.expiresAt <= c.issuedAt ||
    c.expiresAt - c.issuedAt > 3600000 ||
    c.audience !== "control"
  )
    invalid();
  publicKey(c.publicKey);
}
export function createLeaseIssuer(encoded: string) {
  const bytes = decode(encoded, 256),
    key = createPrivateKey({ key: bytes, type: "pkcs8", format: "der" });
  if (
    key.asymmetricKeyType !== "ed25519" ||
    !key.export({ type: "pkcs8", format: "der" }).equals(bytes)
  )
    return invalid();
  const pub = createPublicKey(key).export({ type: "spki", format: "der" }),
    keyId = createHash("sha256").update(pub).digest("base64url");
  return {
    keyId,
    publicKey: pub.toString("base64url"),
    issue(input: LeaseInput): SignedEnvelope {
      const c: LeaseClaims = { ...input, keyId, audience: "control" };
      validateLease(c);
      const payload = encodeLease(c);
      return {
        payload: payload.toString("base64url"),
        signature: sign(null, payload, key).toString("base64url"),
      };
    },
  };
}
export type LeaseIssuer = ReturnType<typeof createLeaseIssuer>;
export function verifyLease(
  value: unknown,
  trusted: ReadonlyMap<string, string>,
  origin: string,
  now = Date.now(),
): LeaseClaims {
  try {
    const e = envelope(value),
      v = e.values;
    if (v.length !== 11 || v[0] !== "waitron-cloud-access-v1") return invalid();
    const c: LeaseClaims = {
      origin: v[1] as string,
      keyId: v[2] as string,
      leaseId: v[3] as string,
      installationId: v[4] as string,
      venueId: v[5] as string,
      environment: v[6] as LeaseClaims["environment"],
      publicKey: v[7] as string,
      issuedAt: v[8] as number,
      expiresAt: v[9] as number,
      audience: v[10] as "control",
    };
    validateLease(c);
    const key = trusted.get(c.keyId);
    if (
      !key ||
      c.origin !== origin ||
      c.issuedAt > now + 60000 ||
      c.expiresAt <= now ||
      !verify(null, e.bytes, publicKey(key), e.signature)
    )
      return invalid();
    return c;
  } catch {
    return invalid();
  }
}
