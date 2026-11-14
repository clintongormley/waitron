import { createHash } from "node:crypto";
import { canonicalize, signBytes, verifyBytes } from "@waitron/membership";
import type { CanonicalValue } from "@waitron/membership";
import type { HandoverKind, HandoverPurpose, SignedHandoverEnvelope } from "@waitron/shared";

export const HANDOVER_KINDS = [
  "query",
  "status",
  "stepdown",
  "final-state",
  "acceptance",
  "relinquishment",
  "declaration",
  "return-batch",
  "return-receipt",
  "return-clash-acceptance",
  "health",
  "backup-settings",
] as const satisfies readonly HandoverKind[];

export type { HandoverKind, HandoverPurpose, SignedHandoverEnvelope };

export type VerifyEnvelopeResult<B> =
  | { valid: true; body: B; signerNodeId: string }
  | { valid: false; reason: "malformed" | "wrong_purpose" | "unknown_signer" | "bad_signature" };

const ENVELOPE_KEYS = ["body", "purpose", "signature", "signerNodeId"];

function purposeOf(kind: HandoverKind): HandoverPurpose {
  return `waitron.handover.${kind}.v1`;
}

/** The purpose and signer are inside the signed bytes, so a signature binds both to the body. */
function signedMessage(purpose: string, signerNodeId: string, body: unknown): string {
  return canonicalize({ purpose, signerNodeId, body: body as CanonicalValue });
}

// The signed form spells a non-finite number as `null`, so one signature would cover both bodies.
function refuseNonFinite(value: unknown, field: string): void {
  if (typeof value === "number") {
    // A fault in Waitron: only bodies this box built are signed, and JSON from a peer cannot hold one.
    if (!Number.isFinite(value)) {
      throw new Error(`a handover body holds a non-finite number at ${field}`);
    }
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) refuseNonFinite(child, `${field}.${key}`);
}

/** Ed25519 signatures are 64 bytes; one spelling each, so an envelope's digest cannot be changed. */
function isCanonicalSignature(signature: string): boolean {
  const bytes = Buffer.from(signature, "base64");
  return bytes.length === 64 && bytes.toString("base64") === signature;
}

export function signEnvelope<B extends CanonicalValue>(
  kind: HandoverKind,
  body: B,
  signer: { nodeId: string; privateKey: string },
): SignedHandoverEnvelope<B> {
  refuseNonFinite(body, "body");
  const purpose = purposeOf(kind);
  return {
    purpose,
    signerNodeId: signer.nodeId,
    body,
    signature: signBytes(signedMessage(purpose, signer.nodeId, body), signer.privateKey),
  };
}

export function verifyEnvelope<B>(
  raw: unknown,
  kind: HandoverKind,
  publicKeyOf: (nodeId: string) => string | undefined,
): VerifyEnvelopeResult<B> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { valid: false, reason: "malformed" };
  }
  const envelope = raw as Record<string, unknown>;
  const { purpose, signerNodeId, body, signature } = envelope;
  if (
    Object.keys(envelope).sort().join() !== ENVELOPE_KEYS.join() ||
    typeof purpose !== "string" ||
    typeof signerNodeId !== "string" ||
    typeof signature !== "string" ||
    !isCanonicalSignature(signature)
  ) {
    return { valid: false, reason: "malformed" };
  }
  let message: string;
  try {
    message = signedMessage(purpose, signerNodeId, body);
  } catch {
    return { valid: false, reason: "malformed" };
  }
  if (purpose !== purposeOf(kind)) return { valid: false, reason: "wrong_purpose" };
  const publicKey = publicKeyOf(signerNodeId);
  if (publicKey === undefined) return { valid: false, reason: "unknown_signer" };
  if (!verifyBytes(message, signature, publicKey)) return { valid: false, reason: "bad_signature" };
  return { valid: true, body: body as B, signerNodeId };
}

/** Lower-case hex SHA-256; a string is hashed as its UTF-8 bytes. */
export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Whether `value` is what `sha256Hex` answers. */
export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export function envelopeDigest(envelope: SignedHandoverEnvelope<unknown>): string {
  return sha256Hex(canonicalize(envelope as unknown as CanonicalValue));
}
