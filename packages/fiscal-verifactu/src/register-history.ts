import "./errors.js";
import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";
import { AppError } from "@waitron/shared";
import {
  parsePaperBlock,
  parsePaperConsumption,
  paperBlockBytes,
  paperConsumptionBytes,
} from "./paper-protocol.js";
import type { SignedPaperValue, PaperBlock } from "./paper-protocol.js";
import type { CustodyPublic } from "./custodian/key-codec.js";
import {
  canonicalRegisterBytes,
  paperBurnCheckpointBytes,
  registerRevisionBytes,
  registerHeadTag,
} from "./register-protocol.js";
import type {
  RegisterHistory,
  RegisterScope,
  RegisterHead,
  RegisterOriginal,
  RegisterOccupied,
  RegisterProjection,
  KnownRegisterEvidence,
} from "./register-protocol.js";
export type * from "./register-protocol.js";

function refuse(): never {
  throw new AppError("sif.allocation_invalid", { reason: "reservation_mismatch" });
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    record(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((k) => Object.hasOwn(value, k))
  );
}
function text(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    value.trim() === value &&
    !/\p{Cc}/u.test(value)
  );
}
function hex(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function timestamp(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value))
    return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}
function floor(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 999999;
}
function scope(value: unknown): value is RegisterScope {
  return (
    exact(value, ["taxpayerNif", "softwareId", "environment"]) &&
    typeof value.taxpayerNif === "string" &&
    /^[A-Z0-9]{9}$/.test(value.taxpayerNif) &&
    typeof value.softwareId === "string" &&
    /^[A-Z0-9]{2}$/.test(value.softwareId) &&
    (value.environment === "production" || value.environment === "preproduction")
  );
}
function signed(value: unknown): value is SignedPaperValue<Record<string, unknown>> {
  return (
    exact(value, ["payload", "signature"]) &&
    record(value.payload) &&
    typeof value.signature === "string" &&
    /^[A-Za-z0-9_-]{86}$/.test(value.signature) &&
    Buffer.from(value.signature, "base64url").toString("base64url") === value.signature
  );
}
function original(value: unknown): value is RegisterOriginal {
  return (
    signed(value) &&
    (parsePaperBlock(value.payload) !== null || parsePaperConsumption(value.payload) !== null)
  );
}
function freeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
function digest(value: unknown): string {
  return createHash("sha256").update(canonicalRegisterBytes(value)).digest("hex");
}
function equal(a: unknown, b: unknown): boolean {
  return digest(a) === digest(b);
}
function head(value: unknown): value is RegisterHead {
  return (
    exact(value, ["registerId", "revision", "digest"]) &&
    text(value.registerId) &&
    typeof value.revision === "string" &&
    /^(0|[1-9][0-9]{0,19})$/.test(value.revision) &&
    hex(value.digest)
  );
}
export function parseRegisterHistory(value: unknown): RegisterHistory {
  try {
    if (!record(value) || canonicalRegisterBytes(value).length > 8 * 1024 * 1024) refuse();
    const identity = [
      "version",
      "mode",
      "scope",
      "registerId",
      "custodianId",
      "fingerprint",
      "custodyVersion",
      "revisions",
    ];
    if (value.mode === "checkpoint") identity.push("checkpoint", "retainedOriginals");
    if (
      !exact(value, identity) ||
      value.version !== 1 ||
      !["complete", "checkpoint"].includes(value.mode as string) ||
      !scope(value.scope) ||
      !text(value.registerId) ||
      !text(value.custodianId) ||
      !hex(value.fingerprint) ||
      !(
        (value.mode === "checkpoint" && value.custodyVersion === null) ||
        (Number.isSafeInteger(value.custodyVersion) && (value.custodyVersion as number) > 0)
      ) ||
      !Array.isArray(value.revisions) ||
      value.revisions.length > 10000 ||
      (value.mode === "complete" && value.revisions.length === 0)
    )
      refuse();
    if (value.mode === "checkpoint") {
      if (
        !signed(value.checkpoint) ||
        !Array.isArray(value.retainedOriginals) ||
        !value.retainedOriginals.every(original)
      )
        refuse();
      const c = value.checkpoint.payload;
      if (
        !exact(c, [
          "version",
          "kind",
          "checkpointId",
          "scope",
          "custodianId",
          "fingerprint",
          "sHighWater",
          "pHighWater",
          "sourceHeadTag",
          "currentOriginalConfirmed",
          "noParallelPaperAllocation",
          "completeHistoryUnavailable",
          "burnAllPrior",
          "createdAt",
        ]) ||
        c.version !== 1 ||
        c.kind !== "paper-burn-checkpoint" ||
        !text(c.checkpointId) ||
        !scope(c.scope) ||
        !text(c.custodianId) ||
        !hex(c.fingerprint) ||
        !floor(c.sHighWater) ||
        !floor(c.pHighWater) ||
        typeof c.sourceHeadTag !== "string" ||
        !/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{16}$/.test(c.sourceHeadTag) ||
        c.currentOriginalConfirmed !== true ||
        c.noParallelPaperAllocation !== true ||
        c.completeHistoryUnavailable !== true ||
        c.burnAllPrior !== true ||
        !timestamp(c.createdAt)
      )
        refuse();
    }
    for (const revision of value.revisions) {
      if (!signed(revision)) refuse();
      const r = revision.payload;
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
        r.version !== 1 ||
        !text(r.registerId) ||
        !scope(r.scope) ||
        typeof r.revision !== "string" ||
        !/^[1-9][0-9]{0,19}$/.test(r.revision) ||
        !hex(r.previousDigest) ||
        !timestamp(r.createdAt) ||
        !floor(r.sHighWater) ||
        !floor(r.pHighWater) ||
        !Array.isArray(r.events) ||
        r.events.length > 10000
      )
        refuse();
      for (const e of r.events) {
        if (!record(e)) refuse();
        if (e.kind === "reserve") {
          if (
            !exact(e, ["kind", "block"]) ||
            !signed(e.block) ||
            parsePaperBlock(e.block.payload) === null
          )
            refuse();
        } else if (e.kind === "consume") {
          if (
            !exact(e, ["kind", "consumption"]) ||
            !signed(e.consumption) ||
            parsePaperConsumption(e.consumption.payload) === null
          )
            refuse();
        } else if (
          !exact(e, ["kind", "allocationId", "eventId"]) ||
          !["retire", "uncertain"].includes(e.kind as string) ||
          !text(e.allocationId) ||
          !text(e.eventId)
        )
          refuse();
      }
    }
    return freeze(structuredClone(value)) as unknown as RegisterHistory;
  } catch {
    return refuse();
  }
}
function checkSignature(key: KeyObject, value: SignedPaperValue<unknown>, bytes: Uint8Array): void {
  if (!verify(null, bytes, key, Buffer.from(value.signature, "base64url"))) refuse();
}
function checkOriginal(key: KeyObject, value: RegisterOriginal, history: RegisterHistory): void {
  const b = parsePaperBlock(value.payload);
  if (b !== null) {
    if (
      b.custodianId !== history.custodianId ||
      b.allocations.some(
        (a) =>
          !equal(
            { taxpayerNif: a.taxpayerNif, softwareId: a.softwareId, environment: a.environment },
            history.scope,
          ),
      )
    )
      refuse();
    checkSignature(key, value, paperBlockBytes(b));
  } else {
    const c = parsePaperConsumption(value.payload);
    if (c === null || c.custodianId !== history.custodianId) refuse();
    checkSignature(key, value, paperConsumptionBytes(c));
  }
}
export async function verifyRegisterHistory(
  input: RegisterHistory,
  trust: CustodyPublic,
  known: KnownRegisterEvidence,
): Promise<RegisterProjection> {
  try {
    const history = parseRegisterHistory(input);
    const { custodianId, ...trustedScope } = trust.scope;
    const key = createPublicKey(trust.publicKey);
    if (
      key.asymmetricKeyType !== "ed25519" ||
      history.custodianId !== custodianId ||
      !equal(history.scope, trustedScope) ||
      createHash("sha256")
        .update(key.export({ type: "spki", format: "der" }))
        .digest("hex") !== trust.fingerprint ||
      history.fingerprint !== trust.fingerprint ||
      (known.custodyVersion !== undefined &&
        (!Number.isSafeInteger(known.custodyVersion) ||
          known.custodyVersion < 1 ||
          (history.custodyVersion !== null && history.custodyVersion !== known.custodyVersion))) ||
      !floor(known.sHighWater) ||
      !floor(known.pHighWater) ||
      (known.currentHead !== null && !head(known.currentHead)) ||
      !known.retainedHeads.every(head)
    )
      refuse();
    let sHighWater = 0,
      pHighWater = 0,
      previous = "0".repeat(64),
      revisionNumber = 0n;
    const occupied = new Map<string, RegisterOccupied>();
    const names = new Set<string>(),
      blockIds = new Set<string>(),
      eventIds = new Set<string>();
    const allocations = new Map<string, { block: PaperBlock; digest: string }>();
    const originals: RegisterOriginal[] = [];
    const heads: RegisterHead[] = [];
    if (history.mode === "checkpoint") {
      const c = history.checkpoint.payload;
      if (
        c.custodianId !== history.custodianId ||
        c.fingerprint !== history.fingerprint ||
        !equal(c.scope, history.scope)
      )
        refuse();
      checkSignature(key, history.checkpoint, paperBurnCheckpointBytes(c));
      sHighWater = c.sHighWater;
      pHighWater = c.pHighWater;
      previous = digest(history.checkpoint);
      for (const item of history.retainedOriginals) {
        checkOriginal(key, item, history);
        const block = parsePaperBlock(item.payload);
        if (
          block !== null &&
          block.allocations.some(
            (a) =>
              Number(a.installationIdentity.slice(1)) >
              (a.source === "initial-paper" ? sHighWater : pHighWater),
          )
        )
          refuse();
        originals.push(item);
      }
    }
    heads.push({ registerId: history.registerId, revision: "0", digest: previous });
    for (const r of history.revisions) {
      const p = r.payload;
      if (
        p.registerId !== history.registerId ||
        !equal(p.scope, history.scope) ||
        BigInt(p.revision) !== revisionNumber + 1n ||
        p.previousDigest !== previous ||
        p.sHighWater < sHighWater ||
        p.pHighWater < pHighWater
      )
        refuse();
      checkSignature(key, r, registerRevisionBytes(p));
      const priorS = sHighWater,
        priorP = pHighWater;
      for (const e of p.events) {
        if (e.kind === "reserve") {
          checkOriginal(key, e.block, history);
          const b = e.block.payload;
          if (blockIds.has(b.blockId)) refuse();
          blockIds.add(b.blockId);
          for (const a of b.allocations) {
            const serial = Number(a.installationIdentity.slice(1)),
              initial = a.source === "initial-paper";
            if (
              occupied.has(a.allocationId) ||
              names.has(a.installationIdentity) ||
              serial <= (initial ? priorS : priorP) ||
              serial > (initial ? p.sHighWater : p.pHighWater)
            )
              refuse();
            names.add(a.installationIdentity);
            occupied.set(a.allocationId, {
              allocation: a,
              recipientVenueId: b.recipientVenueId,
              state: "reserved",
            });
            allocations.set(a.allocationId, {
              block: b,
              digest: createHash("sha256").update(paperBlockBytes(b)).digest("hex"),
            });
          }
          originals.push(e.block);
        } else {
          const id = e.kind === "consume" ? e.consumption.payload.allocationId : e.allocationId;
          const eventId = e.kind === "consume" ? e.consumption.payload.eventId : e.eventId;
          const item = occupied.get(id);
          if (item === undefined || item.state !== "reserved" || eventIds.has(eventId)) refuse();
          eventIds.add(eventId);
          if (e.kind === "consume") {
            checkOriginal(key, e.consumption, history);
            if (e.consumption.payload.blockDigest !== allocations.get(id)?.digest) refuse();
            originals.push(e.consumption);
          }
          occupied.set(id, {
            ...item,
            state:
              e.kind === "consume" ? "consumed" : e.kind === "retire" ? "retired" : "uncertain",
          });
        }
      }
      sHighWater = p.sHighWater;
      pHighWater = p.pHighWater;
      previous = digest(r);
      revisionNumber++;
      heads.push({ registerId: history.registerId, revision: p.revision, digest: previous });
    }
    if (sHighWater < known.sHighWater || pHighWater < known.pHighWater) refuse();
    if (
      known.currentHead !== null &&
      !heads.some((h) => equal(h, known.currentHead)) &&
      !(
        history.mode === "checkpoint" &&
        history.registerId !== known.currentHead.registerId &&
        history.checkpoint.payload.sourceHeadTag === (await registerHeadTag(known.currentHead))
      )
    )
      refuse();
    for (const h of known.retainedHeads) {
      const matching = heads.find(
        (candidate) => candidate.registerId === h.registerId && candidate.revision === h.revision,
      );
      if (matching !== undefined && !equal(matching, h)) refuse();
    }
    for (const item of known.retainedOriginals)
      if (!original(item) || !originals.some((o) => equal(o, item))) refuse();
    return freeze({
      mode: history.mode,
      custodyVersion: known.custodyVersion ?? null,
      head: heads.at(-1)!,
      sHighWater,
      pHighWater,
      occupied: [...occupied.values()],
      originals,
      nextS: sHighWater === 999999 ? null : sHighWater + 1,
      nextP: pHighWater === 999999 ? null : pHighWater + 1,
      completeHistory: history.mode === "complete",
      currentnessRequired: true,
    });
  } catch {
    return refuse();
  }
}
