import { createPublicKey, verify } from "node:crypto";
export type PairingAction = "start" | "status" | "complete";
export interface PairingClaims {
  origin: string;
  action: PairingAction;
  requestId: string;
  publicKey: string;
  venueId: string;
  environment: "test" | "production";
  code: string;
  organisationId: string;
  legalBusinessId: string;
  issuedAt: number;
  venueName: string;
}
export const PAIRING_VENUE_NAME_MAX = 120;
export const pairingVenueName = (raw: string): string =>
  [...raw.trim()].slice(0, PAIRING_VENUE_NAME_MAX).join("").trim();
export class PairingError extends Error {
  readonly code:
    | "invalid_proof"
    | "pairing_unavailable"
    | "binding_conflict"
    | "approval_required"
    | "permission_denied";
  constructor(code: PairingError["code"]) {
    super(code);
    this.code = code;
  }
}
export const isPairingUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
export function pairingPayload(c: PairingClaims): Buffer {
  return Buffer.from(
    JSON.stringify([
      "waitron-cloud-pair-v3",
      c.origin,
      c.action,
      c.requestId,
      c.publicKey,
      c.venueId,
      c.environment,
      c.code,
      c.organisationId,
      c.legalBusinessId,
      c.issuedAt,
      c.venueName,
    ]),
  );
}
function decode(value: string, max: number): Buffer {
  if (
    typeof value !== "string" ||
    value.length > max ||
    !value.length ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  )
    throw new PairingError("invalid_proof");
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value) throw new PairingError("invalid_proof");
  return bytes;
}
function verifySignature(bytes: Buffer, publicKey: string, signature: string): boolean {
  const keyBytes = decode(publicKey, 128);
  const key = createPublicKey({ key: keyBytes, type: "spki", format: "der" });
  return (
    key.asymmetricKeyType === "ed25519" &&
    key.export({ type: "spki", format: "der" }).equals(keyBytes) &&
    verify(null, bytes, key, decode(signature, 86))
  );
}
export function verifyPairingProof(
  payload: string,
  signature: string,
  origin: string,
  action: string,
  now = Date.now(),
): PairingClaims {
  try {
    const bytes = decode(payload, 4096);
    const values: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (
      !Array.isArray(values) ||
      values.length !== 12 ||
      values[0] !== "waitron-cloud-pair-v3" ||
      values.slice(0, 10).some((v) => typeof v !== "string") ||
      typeof values[11] !== "string"
    )
      throw new Error();
    const [
      ,
      audience,
      operation,
      requestId,
      publicKey,
      venueId,
      environment,
      code,
      organisationId,
      legalBusinessId,
      issuedAt,
      venueName,
    ] = values;
    if (
      audience !== origin ||
      operation !== action ||
      !["start", "status", "complete"].includes(operation) ||
      !isPairingUuid(requestId) ||
      (venueId !== "" && !isPairingUuid(venueId)) ||
      !["test", "production"].includes(environment) ||
      !Number.isSafeInteger(issuedAt) ||
      Math.abs(now - issuedAt) > 60000 ||
      venueName !== pairingVenueName(venueName) ||
      (operation !== "start" && venueName !== "")
    )
      throw new Error();
    if (
      operation === "start"
        ? !/^\d{8}$/.test(code) || organisationId !== "" || legalBusinessId !== ""
        : operation === "status"
          ? code !== "" || organisationId !== "" || legalBusinessId !== ""
          : code !== "" || !isPairingUuid(organisationId) || !isPairingUuid(legalBusinessId)
    )
      throw new Error();
    const c: PairingClaims = {
      origin: audience,
      action: operation,
      requestId,
      publicKey,
      venueId,
      environment,
      code,
      organisationId,
      legalBusinessId,
      issuedAt,
      venueName,
    };
    if (!pairingPayload(c).equals(bytes) || !verifySignature(bytes, publicKey, signature))
      throw new Error();
    return c;
  } catch {
    throw new PairingError("invalid_proof");
  }
}

type PairingV4Arguments = {
  start: readonly [redirectUri: string, state: string, codeChallenge: string];
  redeem: readonly [code: string, codeVerifier: string];
  status: readonly [];
  complete: readonly [
    countryCode: string,
    venueName: string,
    address: readonly [
      addressLine1: string,
      addressLine2: string,
      postalCode: string,
      city: string,
      province: string,
    ],
    taxNumber: string,
    legalName: string,
  ];
};
export type PairingV4Action = keyof PairingV4Arguments;
export type PairingV4Operation = {
  [Action in PairingV4Action]: { action: Action; args: PairingV4Arguments[Action] };
}[PairingV4Action];
export type PairingV4Claims = {
  origin: string;
  requestId: string;
  publicKey: string;
  issuedAt: number;
} & PairingV4Operation;

type PairingProofVersion = "waitron-cloud-pair-v4" | "waitron-cloud-pair-v5";

export function pairingV4Payload(c: PairingV4Claims): Buffer {
  return pairingVersionPayload(c, "waitron-cloud-pair-v4");
}

export function pairingV5Payload(c: PairingV4Claims): Buffer {
  return pairingVersionPayload(c, "waitron-cloud-pair-v5");
}

function pairingVersionPayload(c: PairingV4Claims, version: PairingProofVersion): Buffer {
  return Buffer.from(
    JSON.stringify([
      version,
      c.origin,
      c.action,
      c.requestId,
      c.publicKey,
      "test",
      c.issuedAt,
      c.args,
    ]),
  );
}

function singleLine(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    !/[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u.test(value)
  );
}

function codePointsWithin(value: unknown, maximum: number): boolean {
  return singleLine(value) && [...value].length <= maximum;
}

function isPairingToken(value: unknown): boolean {
  return typeof value === "string" && decode(value, 43).length === 32;
}

function validV4Operation(request: {
  action: string;
  args: unknown;
}): request is PairingV4Operation {
  const { action, args } = request;
  if (!Array.isArray(args)) return false;
  switch (action) {
    case "start":
      return (
        args.length === 3 &&
        singleLine(args[0]) &&
        args[0].length > 0 &&
        isPairingToken(args[1]) &&
        isPairingToken(args[2])
      );
    case "redeem":
      return args.length === 2 && isPairingToken(args[0]) && isPairingToken(args[1]);
    case "status":
      return args.length === 0;
    case "complete": {
      const [countryCode, venueName, address, taxNumber, legalName] = args;
      const addressLimits = [200, 200, 20, 200, 100];
      return (
        args.length === 5 &&
        typeof countryCode === "string" &&
        /^[A-Z]{2}$/.test(countryCode) &&
        venueName !== "" &&
        codePointsWithin(venueName, PAIRING_VENUE_NAME_MAX) &&
        Array.isArray(address) &&
        address.length === addressLimits.length &&
        addressLimits.every((limit, index) => codePointsWithin(address[index], limit)) &&
        singleLine(taxNumber) &&
        taxNumber.length <= 32 &&
        singleLine(legalName) &&
        legalName.length > 0 &&
        legalName.length <= 200
      );
    }
    default:
      return false;
  }
}

export function isPairingV4Profile(args: unknown): args is PairingV4Arguments["complete"] {
  return validV4Operation({ action: "complete", args });
}

export function verifyPairingV4Proof(
  payload: string,
  signature: string,
  origin: string,
  action: string,
  now = Date.now(),
): PairingV4Claims {
  return verifyPairingVersionProof(
    payload,
    signature,
    origin,
    action,
    now,
    "waitron-cloud-pair-v4",
  );
}

export function verifyPairingV5Proof(
  payload: string,
  signature: string,
  origin: string,
  action: string,
  now = Date.now(),
): PairingV4Claims {
  return verifyPairingVersionProof(
    payload,
    signature,
    origin,
    action,
    now,
    "waitron-cloud-pair-v5",
  );
}

function verifyPairingVersionProof(
  payload: string,
  signature: string,
  origin: string,
  action: string,
  now: number,
  expectedVersion: PairingProofVersion,
): PairingV4Claims {
  try {
    const bytes = decode(payload, 8192);
    const values: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!Array.isArray(values) || values.length !== 8) throw new Error();
    const [version, audience, operation, requestId, publicKey, environment, issuedAt, args] =
      values;
    const request = { action, args };
    if (
      version !== expectedVersion ||
      audience !== origin ||
      operation !== action ||
      !isPairingUuid(requestId) ||
      typeof publicKey !== "string" ||
      environment !== "test" ||
      !Number.isSafeInteger(issuedAt) ||
      Math.abs(now - issuedAt) > 60000 ||
      !validV4Operation(request)
    )
      throw new Error();
    const claims = { origin, requestId, publicKey, issuedAt, ...request };
    if (
      !pairingVersionPayload(claims, expectedVersion).equals(bytes) ||
      !verifySignature(bytes, publicKey, signature)
    )
      throw new Error();
    return claims;
  } catch {
    throw new PairingError("invalid_proof");
  }
}
