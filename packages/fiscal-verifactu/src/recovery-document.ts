import type { RegisterScope, NamedNodeKey } from "./paper-register-protocol.js";

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
function checked(value: unknown): RecoveryDocument {
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
    !exact(value.nodeKey, ["nodeId", "name"]) ||
    !label(value.nodeKey.nodeId) ||
    !label(value.nodeKey.name)
  )
    refuseRecovery();
  return structuredClone(value) as RecoveryDocument;
}
export function parseRecoveryDocumentPublic(value: unknown): RecoveryDocumentPublic {
  return checked(value);
}
export async function parseRecoveryDocument(value: unknown): Promise<RecoveryDocument> {
  return checked(value);
}
export function recoveryDocumentPublic(value: RecoveryDocument): RecoveryDocumentPublic {
  return checked(value);
}
