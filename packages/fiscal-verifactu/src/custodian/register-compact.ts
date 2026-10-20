import type {
  KnownRegisterEvidence,
  RegisterHead,
  RegisterPosition,
  RegisterScope,
} from "../register-protocol.js";
import { registerCheckCode, registerHeadTag } from "../register-protocol.js";
import {
  base64,
  encoder,
  fromDer,
  guarded,
  material,
  PRIVATE_PREFIX,
  refuse,
  unhex,
} from "./internal.js";
import type { CustodyKey, CustodyPublic } from "./internal.js";
export { registerHeadTag } from "../register-protocol.js";

export interface CompactRegisterFields {
  readonly referenceKind: "uuid" | "text";
  readonly custodianReference: string | null;
  readonly custodySeed: string;
  readonly sPosition: string;
  readonly pPosition: string;
  readonly sourceHeadTag: string;
  readonly check: string;
}
export interface CompactContext {
  readonly scope: RegisterScope;
  readonly boundCustodianId?: string;
  readonly expected: CustodyPublic;
  readonly known: KnownRegisterEvidence;
}
export interface RecoveredCompactRegister {
  readonly key: CustodyKey;
  readonly position: RegisterPosition;
  readonly sourceHeadTag: string;
  readonly completeHistory: false;
  readonly currentnessRequired: true;
}
export interface NamedNodeKey {
  readonly nodeId: string;
  readonly name: string;
  readonly secret: string;
}
export interface CompactNodeKey {
  readonly nodeKeyFormat: "generated" | "utf8";
  readonly value: string;
  readonly check: string;
}
function grouped(value: unknown): string {
  if (typeof value !== "string") refuse();
  return value.replace(/[\t\n\v\f\r ]/g, "");
}
function b64url(bytes: Uint8Array): string {
  let encoded = "";
  for (let offset = 0; offset < bytes.length; offset += 24576)
    encoded += base64(bytes.subarray(offset, offset + 24576));
  return encoded.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function decode(value: string, min: number, max = min): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) refuse();
  const raw = atob(
    value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4),
  );
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  if (bytes.length < min || bytes.length > max || b64url(bytes) !== value) refuse();
  return bytes;
}
function checkedScope(scope: RegisterScope): RegisterScope {
  if (
    Object.keys(scope).length !== 3 ||
    !/^[A-Z0-9]{9}$/.test(scope.taxpayerNif) ||
    !/^[A-Z0-9]{2}$/.test(scope.softwareId) ||
    !["production", "preproduction"].includes(scope.environment)
  )
    refuse();
  return {
    taxpayerNif: scope.taxpayerNif,
    softwareId: scope.softwareId,
    environment: scope.environment,
  };
}
function position(value: RegisterPosition): void {
  for (const n of [value.sHighWater, value.pHighWater])
    if (!Number.isInteger(n) || n < 0 || n > 999999) refuse();
}
function check(value: string, size: number): string {
  const result = grouped(value);
  if (!new RegExp(`^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{${size}}$`).test(result)) refuse();
  return result;
}
function keyId(value: string): void {
  if (value.length === 0 || value.length > 256 || value.trim() !== value || /\p{Cc}/u.test(value))
    refuse();
}
function uuid(value: string): Uint8Array<ArrayBuffer> | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
    ? unhex(value.replaceAll("-", ""))
    : null;
}
function reference(value: string, kind: CompactRegisterFields["referenceKind"]): string {
  if (kind === "uuid") {
    const h = Array.from(decode(value, 16), (b) => b.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  if (kind !== "text") refuse();
  const id = new TextDecoder("utf-8", { fatal: true }).decode(decode(value, 1, 1024));
  keyId(id);
  if (uuid(id) !== null) refuse();
  return id;
}
async function registerCheck(
  key: CustodyKey,
  scope: RegisterScope,
  p: RegisterPosition,
  tag: string,
): Promise<string> {
  const pem = key.publicKey.replace(/-----[^\n]+-----|\s/g, "");
  const spki = b64url(Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)));
  return registerCheckCode(
    [
      "waitron.paper-compact-check",
      1,
      checkedScope(scope),
      key.scope.custodianId,
      spki,
      p.sHighWater,
      p.pHighWater,
      tag,
    ],
    5,
  );
}
function displayLength(value: string, groupSize: number): number {
  return value.length + (value.length === 0 ? 0 : Math.floor((value.length - 1) / groupSize));
}
export function encodeCompactRegister(
  key: CustodyKey,
  p: RegisterPosition,
  head: RegisterHead,
  omitReference = false,
) {
  return guarded(async () => {
    position(p);
    keyId(key.scope.custodianId);
    const { custodianId, ...scope } = key.scope;
    const bytes = uuid(custodianId),
      tag = await registerHeadTag(head);
    const fields: CompactRegisterFields = {
      referenceKind: bytes === null ? "text" : "uuid",
      custodianReference: omitReference ? null : b64url(bytes ?? encoder.encode(custodianId)),
      custodySeed: b64url(material(key).der.subarray(16)),
      sPosition: String(p.sHighWater).padStart(6, "0"),
      pPosition: String(p.pHighWater).padStart(6, "0"),
      sourceHeadTag: tag,
      check: await registerCheck(key, scope, p, tag),
    };
    const enteredCharacters =
      (fields.custodianReference?.length ?? 0) + fields.custodySeed.length + 12 + 16 + 8;
    const displayedCharacters =
      displayLength(fields.custodianReference ?? "", 5) +
      displayLength(fields.custodySeed, 5) +
      12 +
      displayLength(tag, 4) +
      displayLength(fields.check, 4);
    return { fields, enteredCharacters, displayedCharacters };
  });
}
export function recoverCompactRegister(
  fields: CompactRegisterFields,
  context: CompactContext,
): Promise<RecoveredCompactRegister> {
  return guarded(async () => {
    checkedScope(context.scope);
    if (fields.referenceKind !== "uuid" && fields.referenceKind !== "text") refuse();
    const custodianId =
      fields.custodianReference === null
        ? context.boundCustodianId
        : reference(grouped(fields.custodianReference), fields.referenceKind);
    if (
      custodianId === undefined ||
      (context.boundCustodianId !== undefined && custodianId !== context.boundCustodianId)
    )
      refuse();
    keyId(custodianId);
    const s = grouped(fields.sPosition),
      p = grouped(fields.pPosition);
    if (!/^[0-9]{6}$/.test(s) || !/^[0-9]{6}$/.test(p)) refuse();
    const pos = { sHighWater: Number(s), pHighWater: Number(p) };
    position(pos);
    position(context.known);
    if (pos.sHighWater < context.known.sHighWater || pos.pHighWater < context.known.pHighWater)
      refuse();
    const tag = check(fields.sourceHeadTag, 16);
    const current = context.known.currentHead;
    if (current !== null && (await registerHeadTag(current)) !== tag) refuse();
    for (const old of context.known.retainedHeads)
      if (
        (await registerHeadTag(old)) === tag &&
        (current === null || (await registerHeadTag(current)) !== tag)
      )
        refuse();
    const der = new Uint8Array(48);
    der.set(unhex(PRIVATE_PREFIX));
    der.set(decode(grouped(fields.custodySeed), 32), 16);
    let key: CustodyKey | undefined;
    try {
      key = await fromDer(der, { ...context.scope, custodianId }, "secret-paper", context.expected);
      if ((await registerCheck(key, context.scope, pos, tag)) !== check(fields.check, 8)) refuse();
      return {
        key,
        position: pos,
        sourceHeadTag: tag,
        completeHistory: false,
        currentnessRequired: true,
      };
    } catch {
      key?.dispose();
      return refuse();
    } finally {
      der.fill(0);
    }
  });
}
export function encodeCompactNodeKey(
  node: NamedNodeKey,
  scope: RegisterScope,
  format: CompactNodeKey["nodeKeyFormat"],
) {
  return guarded(async () => {
    checkedScope(scope);
    keyId(node.nodeId);
    keyId(node.name);
    if (typeof node.secret !== "string" || node.secret.length === 0) refuse();
    if (
      (format !== "generated" && format !== "utf8") ||
      (format === "generated" && !/^[A-Za-z0-9_-]{32}$/.test(node.secret))
    )
      refuse();
    const value = format === "generated" ? node.secret : b64url(encoder.encode(node.secret));
    const check = await registerCheckCode(
      ["waitron.node-paper-check", 1, scope, node.nodeId, node.name, node.secret],
      5,
    );
    return {
      nodeKeyFormat: format,
      value,
      check,
      enteredCharacters: value.length + 8,
      displayedCharacters: displayLength(value, 4) + displayLength(check, 4),
    };
  });
}
export function recoverCompactNodeKey(
  fields: CompactNodeKey,
  context: { readonly scope: RegisterScope; readonly nodeId: string; readonly name: string },
): Promise<string> {
  return guarded(async () => {
    checkedScope(context.scope);
    keyId(context.nodeId);
    keyId(context.name);
    const value = grouped(fields.value);
    if (fields.nodeKeyFormat !== "generated" && fields.nodeKeyFormat !== "utf8") refuse();
    if (fields.nodeKeyFormat === "generated" && !/^[A-Za-z0-9_-]{32}$/.test(value)) refuse();
    const secret =
      fields.nodeKeyFormat === "generated"
        ? value
        : new TextDecoder("utf-8", { fatal: true }).decode(
            decode(value, 1, Number.POSITIVE_INFINITY),
          );
    if (
      (await registerCheckCode(
        ["waitron.node-paper-check", 1, context.scope, context.nodeId, context.name, secret],
        5,
      )) !== check(fields.check, 8)
    )
      refuse();
    return secret;
  });
}
