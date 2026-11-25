import { encodeNodeKey } from "./paper-register-compact.js";
import type { RegisterScope, NamedNodeKey } from "./paper-register-protocol.js";
import type { ServerKeyHolder } from "@waitron/recovery-pack/src/pack-file.js";

export type RecoveryDocument = {
  kind: "waitron-recovery-document";
  version: 1;
  scope: RegisterScope;
  taxpayerName: string;
  venueName: string;
  createdAt: string;
  nodeKey: Pick<NamedNodeKey, "nodeId" | "name">;
};
export type RecoveryDocumentPublic = RecoveryDocument;
/** The key file the box-key reader and pages read; the document setup delivers never has it. */
export type RecoveryKeyDocument = Omit<RecoveryDocument, "nodeKey"> & { nodeKey: NamedNodeKey };
export const RECOVERY_ATTACHMENT = "waitron-recovery-key-v1.json";
export const MAX_RECOVERY_ATTACHMENT = 8192;
export const MAX_RECOVERY_PDF = 8 * 1024 * 1024;
/** A valid recovery pack that does not hold the server key; it says where the key is. */
export class RecoveryPackWithoutKeyError extends Error {
  constructor(
    readonly serverKeyName: string | null,
    readonly heldBy: ServerKeyHolder | null,
  ) {
    super("This recovery pack does not hold the server key");
    this.name = "RecoveryPackWithoutKeyError";
  }
}
export function refuseRecovery(): never {
  throw new Error("Recovery PDF refused");
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).length === keys.length &&
    keys.every((k) => Object.hasOwn(value, k))
  );
}
function label(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    value.trim() === value &&
    !/\p{Cc}/u.test(value)
  );
}
function checked(value: unknown, secret: boolean): RecoveryDocument | RecoveryKeyDocument {
  if (
    !exact(value, [
      "kind",
      "version",
      "scope",
      "taxpayerName",
      "venueName",
      "createdAt",
      "nodeKey",
    ]) ||
    value.kind !== "waitron-recovery-document" ||
    value.version !== 1 ||
    !exact(value.scope, ["taxpayerNif", "softwareId", "environment"]) ||
    typeof value.scope.taxpayerNif !== "string" ||
    !/^[A-Z0-9]{9}$/.test(value.scope.taxpayerNif) ||
    typeof value.scope.softwareId !== "string" ||
    !/^[A-Z0-9]{2}$/.test(value.scope.softwareId) ||
    !["production", "preproduction"].includes(value.scope.environment as string) ||
    !label(value.taxpayerName) ||
    !label(value.venueName) ||
    typeof value.createdAt !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.createdAt) ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    new Date(value.createdAt).toISOString() !== value.createdAt ||
    !exact(value.nodeKey, secret ? ["nodeId", "name", "secret"] : ["nodeId", "name"]) ||
    !label(value.nodeKey.nodeId) ||
    !label(value.nodeKey.name) ||
    (secret &&
      (typeof value.nodeKey.secret !== "string" ||
        !/^[A-Za-z0-9_-]{32}$/.test(value.nodeKey.secret)))
  )
    refuseRecovery();
  return structuredClone(value) as RecoveryDocument | RecoveryKeyDocument;
}
export function parseRecoveryDocumentPublic(value: unknown): RecoveryDocumentPublic {
  return checked(value, false);
}
export async function parseRecoveryDocument(value: unknown): Promise<RecoveryDocument> {
  return checked(value, false);
}
export async function parseRecoveryKeyDocument(value: unknown): Promise<RecoveryKeyDocument> {
  const document = checked(value, true) as RecoveryKeyDocument;
  await encodeNodeKey(document.nodeKey, document.scope, "raw192");
  return document;
}
export function recoveryDocumentPublic(value: RecoveryDocument): RecoveryDocumentPublic {
  return checked(value, false);
}
export function recoveryDocumentBytes(
  value: RecoveryDocument | RecoveryKeyDocument,
): Uint8Array<ArrayBuffer> {
  const document = checked(value, "secret" in value.nodeKey);
  function canonical(v: unknown): string {
    if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
    if (typeof v !== "object" || v === null) return JSON.stringify(v);
    const object = v as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(object[k])}`)
      .join(",")}}`;
  }
  const bytes = new TextEncoder().encode(canonical(document));
  if (bytes.length > MAX_RECOVERY_ATTACHMENT) refuseRecovery();
  return bytes;
}
