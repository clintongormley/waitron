import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { isPairingUuid } from "./pairing-proof.js";

export type MachineAction =
  | "billing-display"
  | "renew"
  | "configuration"
  | "report"
  | "revoke"
  | "backup-reserve"
  | "backup-publish"
  | "guest-menu-publish"
  | "guest-menu-status"
  | "guest-menu-withdraw"
  | "backup-stream-configure"
  | "backup-stream-observe"
  | "staff-certificate-submit"
  | "staff-certificate-status"
  | "email-submit"
  | "email-status"
  | "email-cancel"
  | "translation-submit"
  | "translation-status"
  | "translation-collect"
  | "translation-release"
  | "address-lookup"
  | "tunnel-provision"
  | "error-report"
  | "release-held"
  | "staff-report"
  | "staff-description";
export interface SignedEnvelope {
  payload: string;
  signature: string;
}
export interface MachineClaims {
  origin: string;
  action: MachineAction;
  installationId: string;
  operationId: string;
  issuedAt: number;
  lease: string;
  body: string;
}
export class InstallationError extends Error {
  readonly code: "invalid_proof" | "unavailable" | "revoked" | "conflict" | "permission_denied";
  constructor(code: InstallationError["code"]) {
    super(code);
    this.code = code;
  }
}
export function invalid(): never {
  throw new InstallationError("invalid_proof");
}
export function decode(value: unknown, max: number): Buffer {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > max ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  )
    return invalid();
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value) return invalid();
  return bytes;
}
export function publicKey(value: string): KeyObject {
  const bytes = decode(value, 128),
    key = createPublicKey({ key: bytes, type: "spki", format: "der" });
  if (
    key.asymmetricKeyType !== "ed25519" ||
    !key.export({ type: "spki", format: "der" }).equals(bytes)
  )
    return invalid();
  return key;
}
export function originValid(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 256) return false;
  try {
    const url = new URL(value);
    return url.origin === value && ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}
export function dateValid(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
export function envelope(value: unknown): { bytes: Buffer; signature: Buffer; values: unknown[] } {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "payload,signature"
  )
    return invalid();
  const e = value as SignedEnvelope,
    bytes = decode(e.payload, 12000),
    signature = decode(e.signature, 86);
  const values: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (
    signature.length !== 64 ||
    !Array.isArray(values) ||
    !Buffer.from(JSON.stringify(values)).equals(bytes)
  )
    return invalid();
  return { bytes, signature, values };
}
export function encodeMachine(
  c: Omit<MachineClaims, "action" | "installationId"> & {
    action: string;
    installationId: string | undefined;
  },
): Buffer {
  return Buffer.from(
    JSON.stringify([
      "waitron-cloud-machine-v1",
      c.origin,
      c.action,
      c.installationId,
      c.operationId,
      c.issuedAt,
      c.lease,
      c.body,
    ]),
  );
}
/** Parses routing fields only. Call verifyMachine with the stored installation key before using any claim. */
export function readMachineClaims(value: unknown): MachineClaims {
  try {
    const { values: v } = envelope(value);
    if (
      v.length !== 8 ||
      v[0] !== "waitron-cloud-machine-v1" ||
      !originValid(v[1]) ||
      ![
        "billing-display",
        "renew",
        "configuration",
        "report",
        "revoke",
        "backup-reserve",
        "backup-publish",
        "guest-menu-publish",
        "guest-menu-status",
        "guest-menu-withdraw",
        "backup-stream-configure",
        "backup-stream-observe",
        "staff-certificate-submit",
        "staff-certificate-status",
        "email-submit",
        "email-status",
        "email-cancel",
        "translation-submit",
        "translation-status",
        "translation-collect",
        "translation-release",
        "address-lookup",
        "tunnel-provision",
        "error-report",
        "release-held",
        "staff-report",
        "staff-description",
      ].includes(v[2] as string) ||
      !isPairingUuid(v[3]) ||
      !isPairingUuid(v[4]) ||
      !dateValid(v[5]) ||
      typeof v[6] !== "string" ||
      v[6].length > 4096 ||
      typeof v[7] !== "string" ||
      v[7].length > 4096
    )
      return invalid();
    return {
      origin: v[1],
      action: v[2] as MachineAction,
      installationId: v[3],
      operationId: v[4],
      issuedAt: v[5],
      lease: v[6],
      body: v[7],
    };
  } catch {
    return invalid();
  }
}
export function verifyMachine(
  value: unknown,
  key: string,
  origin: string,
  action: MachineAction,
  now = Date.now(),
): MachineClaims {
  try {
    const c = readMachineClaims(value),
      e = envelope(value);
    if (
      c.origin !== origin ||
      c.action !== action ||
      Math.abs(now - c.issuedAt) > 60000 ||
      !verify(null, e.bytes, publicKey(key), e.signature)
    )
      return invalid();
    return c;
  } catch {
    return invalid();
  }
}
