import type { RegisterDocument, RegisterScope } from "./paper-register-protocol.js";

export const REGISTER_ATTACHMENT = "waitron-register-v2.json";
export const MAX_REGISTER_ATTACHMENT = 8 * 1024 * 1024;
export const MAX_REGISTER_PDF = 64 * 1024 * 1024;
export function refuseRegister(): never {
  throw new Error("Register PDF refused");
}
export function registerDocumentBytes(value: unknown): Uint8Array<ArrayBuffer> {
  let nodes = 0;
  function canonical(v: unknown, depth: number): string {
    if (++nodes > 1000000 || depth > 32) refuseRegister();
    if (v === null || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
    if (typeof v === "number" && Number.isFinite(v)) return JSON.stringify(v);
    if (Array.isArray(v) && Object.keys(v).length === v.length)
      return `[${v.map((x) => canonical(x, depth + 1)).join(",")}]`;
    if (
      typeof v === "object" &&
      v !== null &&
      Object.getPrototypeOf(v) === Object.prototype &&
      Reflect.ownKeys(v).length === Object.keys(v).length
    )
      return `{${Object.keys(v)
        .sort()
        .map(
          (k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k], depth + 1)}`,
        )
        .join(",")}}`;
    return refuseRegister();
  }
  const bytes = new TextEncoder().encode(canonical(value, 0));
  if (bytes.length > MAX_REGISTER_ATTACHMENT) refuseRegister();
  return bytes;
}
function object(value: unknown): value is Record<string, unknown> {
  return (
    value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype
  );
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    object(value) &&
    Reflect.ownKeys(value).length === keys.length &&
    keys.every((k) => Object.hasOwn(value, k))
  );
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
export function registerScope(value: unknown): RegisterScope {
  if (
    !exact(value, ["taxpayerNif", "softwareId", "environment"]) ||
    typeof value.taxpayerNif !== "string" ||
    !/^[A-Z0-9]{9}$/.test(value.taxpayerNif) ||
    typeof value.softwareId !== "string" ||
    !/^[A-Z0-9]{2}$/.test(value.softwareId) ||
    !["production", "preproduction"].includes(value.environment as string)
  )
    return refuseRegister();
  return value as unknown as RegisterScope;
}
export function originalBytes(value: unknown): Uint8Array<ArrayBuffer> {
  if (
    !exact(value, ["kind", "bytesBase64url", "digest"]) ||
    !["signed-paper", "cloud-receipt", "declared-paper-history"].includes(value.kind as string) ||
    typeof value.bytesBase64url !== "string" ||
    !/^[A-Za-z0-9_-]+$/.test(value.bytesBase64url) ||
    typeof value.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.digest)
  )
    return refuseRegister();
  const decoded = Uint8Array.from(
    atob(value.bytesBase64url.replaceAll("-", "+").replaceAll("_", "/")),
    (c) => c.charCodeAt(0),
  );
  let binary = "";
  for (const b of decoded) binary += String.fromCharCode(b);
  if (
    btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "") !==
    value.bytesBase64url
  )
    refuseRegister();
  return decoded;
}
export async function digestRegister(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (v) =>
    v.toString(16).padStart(2, "0"),
  ).join("");
}

// Carrier validity alone must never authorise an allocation.
export async function parseRegisterDocument(value: unknown): Promise<RegisterDocument> {
  registerDocumentBytes(value);
  value = structuredClone(value);
  if (
    !exact(value, ["version", "kind", "route", "paper", "cloudOriginals", "nodeKeys"]) ||
    value.version !== 2 ||
    value.kind !== "waitron-register-document" ||
    !["paper", "cloud"].includes(value.route as string) ||
    !Array.isArray(value.cloudOriginals) ||
    !Array.isArray(value.nodeKeys)
  )
    return refuseRegister();
  const originals: unknown[] = [...value.cloudOriginals];
  if (
    value.cloudOriginals.some((x) => !object(x) || x.kind !== "cloud-receipt") ||
    (value.route === "cloud" && value.cloudOriginals.length === 0)
  )
    refuseRegister();
  if (value.paper === null) {
    if (value.route !== "cloud") refuseRegister();
  } else {
    const p = value.paper;
    if (
      !object(p) ||
      !exact(p, [
        "format",
        "version",
        "integrity",
        "registerId",
        "scope",
        "mode",
        "revisions",
        "originals",
        ...(p.mode === "checkpoint" ? ["checkpoint"] : []),
      ]) ||
      p.format !== "waitron-paper-register" ||
      p.version !== 2 ||
      p.integrity !== "owner-declared" ||
      !text(p.registerId) ||
      !["complete", "checkpoint"].includes(p.mode as string) ||
      !Array.isArray(p.revisions) ||
      !Array.isArray(p.originals)
    )
      return refuseRegister();
    registerScope(p.scope);
    originals.push(...p.originals);
    for (const revision of p.revisions) {
      if (
        !exact(revision, [
          "version",
          "registerId",
          "scope",
          "revision",
          "previousDigest",
          "createdAt",
          "sHighWater",
          "pHighWater",
          "events",
        ]) ||
        !Array.isArray(revision.events)
      )
        refuseRegister();
      for (const event of revision.events) {
        if (!object(event)) refuseRegister();
        if (event.kind === "reserve") {
          if (
            !exact(event, ["kind", "allocation", "recipientVenueId", "binding", "reservedAt"]) ||
            !exact(event.binding, ["module", "action", "eventId", "sourceId", "targetNodeId"]) ||
            !exact(event.allocation, [
              "version",
              "allocationId",
              "taxpayerNif",
              "softwareId",
              "environment",
              "installationIdentity",
              "series",
              "source",
              "issuedAt",
            ]) ||
            !Array.isArray(event.allocation.series)
          )
            refuseRegister();
          for (const series of event.allocation.series)
            if (!exact(series, ["code", "purpose"])) refuseRegister();
        } else if (event.kind === "consume") {
          if (
            !exact(event, [
              "kind",
              "allocationId",
              "reservationDigest",
              "eventId",
              "operatorId",
              "sourceId",
              "targetNodeId",
              "incidentEvidence",
              "consumedAt",
            ])
          )
            refuseRegister();
        } else if (
          !["retire", "abandon", "uncertain"].includes(event.kind as string) ||
          !exact(event, ["kind", "allocationId", "eventId", "reason", "createdAt"])
        )
          refuseRegister();
      }
    }
    if (p.mode === "complete" && p.revisions.length === 0) refuseRegister();
    if (
      p.mode === "checkpoint" &&
      (!exact(p.checkpoint, [
        "version",
        "kind",
        "checkpointId",
        "scope",
        "sHighWater",
        "pHighWater",
        "current",
        "completeHistoryUnavailable",
        "burnAllPrior",
        "createdAt",
      ]) ||
        p.checkpoint.completeHistoryUnavailable !== true ||
        p.checkpoint.burnAllPrior !== true)
    )
      refuseRegister();
  }
  for (const original of originals) {
    const data = originalBytes(original);
    if ((await digestRegister(data)) !== (original as { digest: string }).digest) refuseRegister();
  }
  const ids = new Set<string>();
  for (const key of value.nodeKeys) {
    if (
      !exact(key, ["nodeId", "name", "secret"]) ||
      !text(key.nodeId) ||
      !text(key.name) ||
      !text(key.secret) ||
      ids.has(JSON.stringify([key.nodeId, key.name]))
    )
      refuseRegister();
    ids.add(JSON.stringify([key.nodeId, key.name]));
  }
  const document = value as unknown as RegisterDocument;
  documentScope(document);
  return structuredClone(document);
}
export function documentScope(document: RegisterDocument): RegisterScope {
  if (document.paper) return registerScope(document.paper.scope);
  const original = document.cloudOriginals[0];
  if (!original) return refuseRegister();
  const receipt: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(originalBytes(original)),
  );
  if (!object(receipt) || !object(receipt.payload) || !object(receipt.payload.allocation))
    return refuseRegister();
  const allocation = receipt.payload.allocation;
  return registerScope({
    taxpayerNif: allocation.taxpayerNif,
    softwareId: allocation.softwareId,
    environment: allocation.environment,
  });
}
