import "./errors.js";
import { createHash } from "node:crypto";
import { AppError } from "@waitron/shared";
import type { OperationBinding } from "@waitron/module";
import { parseAllocationOperator } from "./allocation-operator.js";
import { parsePaperAllocation, parsePaperBlock, parsePaperConsumption } from "./paper-protocol.js";
import type { PaperAllocation } from "./paper-protocol.js";
import type {
  RegisterScope,
  RegisterHead,
  PublicOriginal,
  DeclaredRegisterHistory,
  DeclaredReservation,
  DeclaredRegisterOccupied,
  KnownRegisterEvidence,
  RegisterProjection,
} from "./paper-register-protocol.js";
export type * from "./paper-register-protocol.js";

function refuse(): never {
  throw new AppError("sif.allocation_invalid", { reason: "reservation_mismatch" });
}
function record(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && Object.getPrototypeOf(v) === Object.prototype;
}
function exact(v: unknown, keys: readonly string[]): v is Record<string, unknown> {
  return (
    record(v) && Reflect.ownKeys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k))
  );
}
function text(v: unknown): v is string {
  return (
    typeof v === "string" && v.length > 0 && v.length <= 256 && v.trim() === v && !/\p{Cc}/u.test(v)
  );
}
function timestamp(v: unknown): boolean {
  return (
    typeof v === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) &&
    Number.isFinite(Date.parse(v)) &&
    new Date(v).toISOString() === v
  );
}
function floor(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 999999;
}
function hex(v: unknown): v is string {
  return typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
}
function scope(v: unknown): v is RegisterScope {
  return (
    exact(v, ["taxpayerNif", "softwareId", "environment"]) &&
    typeof v.taxpayerNif === "string" &&
    /^[A-Z0-9]{9}$/.test(v.taxpayerNif) &&
    typeof v.softwareId === "string" &&
    /^[A-Z0-9]{2}$/.test(v.softwareId) &&
    (v.environment === "production" || v.environment === "preproduction")
  );
}
function binding(v: unknown): v is OperationBinding {
  return (
    exact(v, ["module", "action", "eventId", "sourceId", "targetNodeId"]) &&
    Object.values(v).every(text)
  );
}
function head(v: unknown): v is RegisterHead {
  return (
    exact(v, ["registerId", "revision", "digest"]) &&
    text(v.registerId) &&
    typeof v.revision === "string" &&
    /^(0|[1-9][0-9]{0,19})$/.test(v.revision) &&
    hex(v.digest)
  );
}
export function declaredHistoryBytes(value: unknown): Uint8Array<ArrayBuffer> {
  let nodes = 0;
  function canonical(v: unknown, depth: number): string {
    if (depth > 32 || ++nodes > 1000000) refuse();
    if (v === null || typeof v === "string" || typeof v === "boolean") return JSON.stringify(v);
    if (typeof v === "number" && Number.isFinite(v)) return JSON.stringify(v);
    if (Array.isArray(v)) {
      if (Object.keys(v).length !== v.length) refuse();
      return `[${v.map((x) => canonical(x, depth + 1)).join(",")}]`;
    }
    if (record(v) && Reflect.ownKeys(v).length === Object.keys(v).length)
      return `{${Object.keys(v)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${canonical(v[k], depth + 1)}`)
        .join(",")}}`;
    return refuse();
  }
  const bytes = new TextEncoder().encode(canonical(value, 0));
  if (bytes.length > 8 * 1024 * 1024) refuse();
  return bytes;
}
function digest(v: unknown): string {
  return createHash("sha256").update(declaredHistoryBytes(v)).digest("hex");
}
function equal(a: unknown, b: unknown): boolean {
  return digest(a) === digest(b);
}
function freeze<T>(v: T): T {
  if (v !== null && typeof v === "object") {
    for (const x of Object.values(v)) freeze(x);
    Object.freeze(v);
  }
  return v;
}
function event(v: unknown): boolean {
  if (!record(v)) return false;
  if (v.kind === "reserve")
    return (
      exact(v, ["kind", "allocation", "recipientVenueId", "binding", "reservedAt"]) &&
      parsePaperAllocation(v.allocation) !== null &&
      text(v.recipientVenueId) &&
      binding(v.binding) &&
      timestamp(v.reservedAt)
    );
  if (v.kind === "consume") {
    if (
      !exact(v, [
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
      return false;
    const op = parseAllocationOperator(v.operatorId);
    return (
      [v.allocationId, v.eventId, v.sourceId, v.targetNodeId, v.incidentEvidence].every(text) &&
      hex(v.reservationDigest) &&
      timestamp(v.consumedAt) &&
      op !== null &&
      (typeof op === "string" || (op.nodeId === v.targetNodeId && op.eventId === v.eventId))
    );
  }
  return (
    exact(v, ["kind", "allocationId", "eventId", "reason", "createdAt"]) &&
    ["retire", "abandon", "uncertain"].includes(v.kind as string) &&
    [v.allocationId, v.eventId, v.reason].every(text) &&
    timestamp(v.createdAt)
  );
}
function original(v: unknown, depth: number): v is PublicOriginal {
  if (
    !exact(v, ["kind", "bytesBase64url", "digest"]) ||
    !["signed-paper", "cloud-receipt", "declared-paper-history"].includes(v.kind as string) ||
    typeof v.bytesBase64url !== "string" ||
    !/^[A-Za-z0-9_-]+$/.test(v.bytesBase64url) ||
    !hex(v.digest)
  )
    return false;
  const bytes = Buffer.from(v.bytesBase64url, "base64url");
  if (
    bytes.toString("base64url") !== v.bytesBase64url ||
    createHash("sha256").update(bytes).digest("hex") !== v.digest
  )
    return false;
  const decoded: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (v.kind === "declared-paper-history") {
    parseHistory(decoded, depth + 1);
    return Buffer.from(declaredHistoryBytes(decoded)).equals(bytes);
  }
  // Originals retain their bytes; this carrier grants no signature or allocation authority.
  if (v.kind === "signed-paper")
    return (
      exact(decoded, ["payload", "signature"]) &&
      typeof decoded.signature === "string" &&
      /^[A-Za-z0-9_-]{86}$/.test(decoded.signature) &&
      (parsePaperBlock(decoded.payload) !== null || parsePaperConsumption(decoded.payload) !== null)
    );
  return (
    exact(decoded, ["payload", "keyId", "signature"]) &&
    record(decoded.payload) &&
    hex(decoded.keyId) &&
    typeof decoded.signature === "string" &&
    /^[A-Za-z0-9_-]{86}$/.test(decoded.signature)
  );
}
function parseHistory(value: unknown, depth: number): DeclaredRegisterHistory {
  if (depth > 8 || !record(value)) refuse();
  declaredHistoryBytes(value);
  const keys = [
    "format",
    "version",
    "integrity",
    "scope",
    "registerId",
    "mode",
    "revisions",
    "originals",
  ];
  if (value.mode === "checkpoint") keys.push("checkpoint");
  if (
    !exact(value, keys) ||
    value.format !== "waitron-paper-register" ||
    value.version !== 2 ||
    value.integrity !== "owner-declared" ||
    !scope(value.scope) ||
    !text(value.registerId) ||
    !["complete", "checkpoint"].includes(value.mode as string) ||
    !Array.isArray(value.revisions) ||
    value.revisions.length > 10000 ||
    (value.mode === "complete" && value.revisions.length === 0) ||
    !Array.isArray(value.originals) ||
    value.originals.length > 10000 ||
    !value.originals.every((x) => original(x, depth))
  )
    refuse();
  if (value.mode === "checkpoint") {
    const c = value.checkpoint;
    if (
      !exact(c, [
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
      c.version !== 2 ||
      c.kind !== "declared-burn-checkpoint" ||
      !text(c.checkpointId) ||
      !scope(c.scope) ||
      !equal(c.scope, value.scope) ||
      !floor(c.sHighWater) ||
      !floor(c.pHighWater) ||
      c.completeHistoryUnavailable !== true ||
      c.burnAllPrior !== true ||
      !timestamp(c.createdAt) ||
      !exact(c.current, ["currentRegisterConfirmed", "noParallelPaperAllocation", "confirmedAt"]) ||
      c.current.currentRegisterConfirmed !== true ||
      c.current.noParallelPaperAllocation !== true ||
      !timestamp(c.current.confirmedAt)
    )
      refuse();
  }
  for (const r of value.revisions) {
    if (
      !exact(r, [
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
      r.version !== 2 ||
      !text(r.registerId) ||
      !scope(r.scope) ||
      typeof r.revision !== "string" ||
      !/^[1-9][0-9]{0,19}$/.test(r.revision) ||
      !hex(r.previousDigest) ||
      !timestamp(r.createdAt) ||
      !floor(r.sHighWater) ||
      !floor(r.pHighWater) ||
      !Array.isArray(r.events) ||
      r.events.length > 10000 ||
      !r.events.every(event)
    )
      refuse();
  }
  return freeze(structuredClone(value)) as unknown as DeclaredRegisterHistory;
}
export function parseDeclaredHistory(value: unknown): DeclaredRegisterHistory {
  try {
    return parseHistory(value, 0);
  } catch {
    return refuse();
  }
}
function emptyKnown(scope: RegisterScope): KnownRegisterEvidence {
  return {
    scope,
    sHighWater: 0,
    pHighWater: 0,
    sBurnFloor: 0,
    pBurnFloor: 0,
    currentHead: null,
    retainedHeads: [],
    originals: [],
    retiredBindings: [],
  };
}
export function projectDeclaredHistory(
  input: DeclaredRegisterHistory,
  known: KnownRegisterEvidence,
): RegisterProjection {
  try {
    const history = parseDeclaredHistory(input);
    if (
      !scope(known.scope) ||
      !equal(history.scope, known.scope) ||
      ![known.sHighWater, known.pHighWater, known.sBurnFloor, known.pBurnFloor].every(floor) ||
      (known.currentHead !== null && !head(known.currentHead)) ||
      !known.retainedHeads.every(head) ||
      !known.originals.every((x) => original(x, 0)) ||
      !known.retiredBindings.every(binding)
    )
      refuse();
    let sHighWater = 0,
      pHighWater = 0,
      previous = "0".repeat(64),
      revisionNumber = 0n;
    let sBurnFloor = known.sBurnFloor,
      pBurnFloor = known.pBurnFloor;
    const heads: RegisterHead[] = [],
      occupied = new Map<string, DeclaredRegisterOccupied>(),
      reservations = new Map<string, DeclaredReservation>(),
      names = new Set<string>(),
      eventIds = new Set<string>();
    if (history.mode === "checkpoint") {
      sHighWater = history.checkpoint.sHighWater;
      pHighWater = history.checkpoint.pHighWater;
      sBurnFloor = Math.max(sBurnFloor, sHighWater);
      pBurnFloor = Math.max(pBurnFloor, pHighWater);
      previous = digest(history.checkpoint);
    }
    heads.push({ registerId: history.registerId, revision: "0", digest: previous });
    for (const r of history.revisions) {
      if (
        r.registerId !== history.registerId ||
        !equal(r.scope, history.scope) ||
        BigInt(r.revision) !== revisionNumber + 1n ||
        r.previousDigest !== previous ||
        r.sHighWater < sHighWater ||
        r.pHighWater < pHighWater
      )
        refuse();
      for (const e of r.events) {
        if (e.kind === "reserve") {
          const a = e.allocation,
            initial = a.source === "initial-paper",
            serial = Number(a.installationIdentity.slice(1));
          if (
            !equal(
              { taxpayerNif: a.taxpayerNif, softwareId: a.softwareId, environment: a.environment },
              history.scope,
            ) ||
            occupied.has(a.allocationId) ||
            names.has(a.installationIdentity) ||
            serial <= (initial ? sHighWater : pHighWater) ||
            serial > (initial ? r.sHighWater : r.pHighWater)
          )
            refuse();
          occupied.set(a.allocationId, {
            allocation: a,
            recipientVenueId: e.recipientVenueId,
            binding: e.binding,
            state: "reserved",
          });
          reservations.set(a.allocationId, e);
          names.add(a.installationIdentity);
        } else {
          const item = occupied.get(e.allocationId),
            reservation = reservations.get(e.allocationId);
          if (
            item === undefined ||
            reservation === undefined ||
            item.state !== "reserved" ||
            eventIds.has(e.eventId)
          )
            refuse();
          eventIds.add(e.eventId);
          if (
            e.kind === "consume" &&
            (e.reservationDigest !== digest(reservation) ||
              e.eventId !== reservation.binding.eventId ||
              e.sourceId !== reservation.binding.sourceId ||
              e.targetNodeId !== reservation.binding.targetNodeId)
          )
            refuse();
          occupied.set(e.allocationId, {
            ...item,
            state:
              e.kind === "consume"
                ? "consumed"
                : e.kind === "retire"
                  ? "retired"
                  : e.kind === "abandon"
                    ? "abandoned"
                    : "uncertain",
          });
        }
      }
      sHighWater = r.sHighWater;
      pHighWater = r.pHighWater;
      previous = digest(r);
      revisionNumber++;
      heads.push({ registerId: history.registerId, revision: r.revision, digest: previous });
    }
    if (history.mode === "complete" && (sBurnFloor > 0 || pBurnFloor > 0)) refuse();
    if (
      sHighWater < Math.max(known.sHighWater, sBurnFloor) ||
      pHighWater < Math.max(known.pHighWater, pBurnFloor)
    )
      refuse();
    if (
      known.currentHead !== null &&
      (history.mode === "complete" || history.registerId === known.currentHead.registerId) &&
      !heads.some((h) => equal(h, known.currentHead))
    )
      refuse();
    for (const h of known.retainedHeads) {
      const match = heads.find((x) => x.registerId === h.registerId && x.revision === h.revision);
      if (match !== undefined && !equal(match, h)) refuse();
    }
    const originals: PublicOriginal[] = [];
    function retain(o: PublicOriginal) {
      if (!originals.some((x) => equal(x, o))) originals.push(o);
    }
    for (const o of [...known.originals, ...history.originals]) retain(o);
    if (known.history !== undefined) {
      const supplied = parseDeclaredHistory(known.history);
      const prior = projectDeclaredHistory(supplied, emptyKnown(history.scope));
      if (
        sHighWater < prior.sHighWater ||
        pHighWater < prior.pHighWater ||
        sBurnFloor < prior.sBurnFloor ||
        pBurnFloor < prior.pBurnFloor
      )
        refuse();
      for (const o of prior.originals) retain(o);
      const contains = heads.some((h) => equal(h, prior.head));
      if (!contains) {
        if (history.mode !== "checkpoint") refuse();
        retain({
          kind: "declared-paper-history",
          bytesBase64url: Buffer.from(declaredHistoryBytes(supplied)).toString("base64url"),
          digest: digest(supplied),
        });
      }
    }
    for (const o of originals) {
      if (o.kind === "signed-paper") {
        const value: unknown = JSON.parse(
          Buffer.from(o.bytesBase64url, "base64url").toString("utf8"),
        );
        const block = record(value) ? parsePaperBlock(value.payload) : null;
        if (
          block !== null &&
          block.allocations.some(
            (a) =>
              !equal(
                {
                  taxpayerNif: a.taxpayerNif,
                  softwareId: a.softwareId,
                  environment: a.environment,
                },
                history.scope,
              ) ||
              Number(a.installationIdentity.slice(1)) >
                (a.source === "initial-paper" ? sHighWater : pHighWater),
          )
        )
          refuse();
      }
      if (o.kind !== "declared-paper-history") continue;
      const originalHistory = parseDeclaredHistory(
        JSON.parse(Buffer.from(o.bytesBase64url, "base64url").toString("utf8")),
      );
      const prior = projectDeclaredHistory(originalHistory, emptyKnown(history.scope));
      if (
        prior.sHighWater > sHighWater ||
        prior.pHighWater > pHighWater ||
        prior.sBurnFloor > sBurnFloor ||
        prior.pBurnFloor > pBurnFloor
      )
        refuse();
    }
    const held = parseDeclaredHistory({ ...history, originals });
    return freeze({
      mode: held.mode,
      scope: held.scope,
      head: heads.at(-1)!,
      heads,
      sHighWater,
      pHighWater,
      sBurnFloor,
      pBurnFloor,
      occupied: [...occupied.values()],
      originals,
      retiredBindings: structuredClone(known.retiredBindings),
      nextS: sHighWater === 999999 ? null : sHighWater + 1,
      nextP: pHighWater === 999999 ? null : pHighWater + 1,
      completeHistory: held.mode === "complete",
      currentnessRequired: true,
      history: held,
    });
  } catch {
    return refuse();
  }
}
export function assertPaperFloorAllows(
  projection: RegisterProjection,
  input: PaperAllocation,
  purpose: "initial-setup" | "recovery",
): void {
  const a = parsePaperAllocation(input);
  if (
    a === null ||
    !["initial-setup", "recovery"].includes(purpose) ||
    !equal(
      { taxpayerNif: a.taxpayerNif, softwareId: a.softwareId, environment: a.environment },
      projection.scope,
    ) ||
    a.source !== (purpose === "initial-setup" ? "initial-paper" : "paper")
  )
    refuse();
  const initial = purpose === "initial-setup",
    serial = Number(a.installationIdentity.slice(1));
  if (serial <= (initial ? projection.sBurnFloor : projection.pBurnFloor)) refuse();
  const existing = projection.occupied.find(
    (x) =>
      x.allocation.allocationId === a.allocationId ||
      x.allocation.installationIdentity === a.installationIdentity,
  );
  if (existing !== undefined) {
    if (
      existing.state !== "reserved" ||
      !equal(existing.allocation, a) ||
      projection.retiredBindings.some((x) => equal(x, existing.binding))
    )
      refuse();
  } else if (serial <= (initial ? projection.sHighWater : projection.pHighWater)) refuse();
}
