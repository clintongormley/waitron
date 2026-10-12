import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import { isAllocatedSeries, isInstallationIdentity } from "./allocation-identity.js";

export interface PaperAllocation {
  readonly version: 1;
  readonly allocationId: string;
  readonly taxpayerNif: string;
  readonly softwareId: string;
  readonly environment: "preproduction" | "production";
  readonly installationIdentity: string;
  readonly series: readonly { readonly code: string; readonly purpose: string }[];
  readonly source: "initial-paper" | "paper";
  readonly issuedAt: string;
}

export interface PaperBlock {
  readonly version: 1;
  readonly custodianId: string;
  readonly generationId: string;
  readonly blockId: string;
  readonly packVersion: 1;
  readonly recipientVenueId: string;
  readonly allocations: readonly PaperAllocation[];
}

export interface PaperConsumption {
  readonly version: 1;
  readonly custodianId: string;
  readonly blockDigest: string;
  readonly allocationId: string;
  readonly eventId: string;
  readonly operatorId: string;
  readonly sourceId: string;
  readonly targetNodeId: string;
  readonly incidentEvidence: string;
  readonly consumedAt: string;
}

export interface PaperReservation {
  readonly version: 1;
  readonly custodianId: string;
  readonly blockDigest: string;
  readonly allocationId: string;
  readonly eventId: string;
  readonly operatorId: string;
  readonly sourceId: string;
  readonly targetNodeId: string;
  readonly incidentEvidence: string;
  readonly reservedAt: string;
}

export interface PaperReservationContext extends Omit<
  PaperEvidenceContext,
  "consumptionConfirmed"
> {
  readonly reservationConfirmed: boolean;
  readonly currentEntryState:
    "reserved" | "consumed-for-event" | "consumed-elsewhere" | "retired" | "abandoned";
}

export type PaperReservationVerification =
  | {
      readonly ok: true;
      readonly allocation: PaperAllocation;
      readonly reservation: PaperReservation;
    }
  | {
      readonly ok: false;
      readonly reason:
        Exclude<PaperVerification, { ok: true }>["reason"] | "reservation_not_current";
    };

export interface PaperCustodianTrust {
  readonly custodianId: string;
  readonly publicKey: string;
  readonly fingerprint: string;
}

export interface PaperEvidenceContext {
  readonly allocationId: string;
  readonly taxpayerNif: string;
  readonly softwareId: string;
  readonly environment: string;
  readonly recipientVenueId: string;
  readonly generationId: string;
  readonly blockId: string;
  readonly eventId: string;
  readonly operatorId: string;
  readonly sourceId: string;
  readonly targetNodeId: string;
  readonly incidentEvidence: string;
  readonly currentRegisterConfirmed: boolean;
  readonly consumptionConfirmed: boolean;
  readonly requiredBases: readonly { readonly code: string; readonly purpose: string }[];
}

export type PaperVerification =
  | { readonly ok: true; readonly allocation: PaperAllocation }
  | {
      readonly ok: false;
      readonly reason:
        | "malformed"
        | "untrusted"
        | "outside_confirmation_missing"
        | "scope_mismatch"
        | "series_mismatch";
    };

export interface SignedPaperValue<T> {
  readonly payload: T;
  readonly signature: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
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

function timestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value))
    return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

const ALLOCATION_KEYS = [
  "version",
  "allocationId",
  "taxpayerNif",
  "softwareId",
  "environment",
  "installationIdentity",
  "series",
  "source",
  "issuedAt",
];
const BLOCK_KEYS = [
  "version",
  "custodianId",
  "generationId",
  "blockId",
  "packVersion",
  "recipientVenueId",
  "allocations",
];
const CONSUMPTION_KEYS = [
  "version",
  "custodianId",
  "blockDigest",
  "allocationId",
  "eventId",
  "operatorId",
  "sourceId",
  "targetNodeId",
  "incidentEvidence",
  "consumedAt",
];

function parseAllocation(value: unknown): PaperAllocation | null {
  if (
    !record(value) ||
    !exactKeys(value, ALLOCATION_KEYS) ||
    value.version !== 1 ||
    !text(value.allocationId) ||
    typeof value.taxpayerNif !== "string" ||
    !/^[A-Z0-9]{9}$/.test(value.taxpayerNif) ||
    typeof value.softwareId !== "string" ||
    !/^[A-Z0-9]{2}$/.test(value.softwareId) ||
    !["preproduction", "production"].includes(value.environment as string) ||
    !isInstallationIdentity(value.installationIdentity) ||
    (value.source !== "paper" && value.source !== "initial-paper") ||
    !value.installationIdentity.startsWith(value.source === "paper" ? "P" : "S") ||
    !timestamp(value.issuedAt) ||
    !Array.isArray(value.series) ||
    value.series.length === 0
  )
    return null;
  const series: { code: string; purpose: string }[] = [];
  for (const item of value.series) {
    if (
      !record(item) ||
      !exactKeys(item, ["code", "purpose"]) ||
      typeof item.code !== "string" ||
      typeof item.purpose !== "string"
    )
      return null;
    series.push(Object.freeze({ code: item.code, purpose: item.purpose }));
  }
  const suffixLength = value.installationIdentity.length + 1;
  const bases = series.map((item) => ({
    code: item.code.slice(0, -suffixLength),
    purpose: item.purpose,
  }));
  if (!isAllocatedSeries(series, value.installationIdentity, bases)) return null;
  return Object.freeze({
    version: 1,
    allocationId: value.allocationId,
    taxpayerNif: value.taxpayerNif,
    softwareId: value.softwareId,
    environment: value.environment as PaperAllocation["environment"],
    installationIdentity: value.installationIdentity,
    series: Object.freeze(series),
    source: value.source,
    issuedAt: value.issuedAt,
  });
}

function parseBlock(value: unknown): PaperBlock | null {
  if (
    !record(value) ||
    !exactKeys(value, BLOCK_KEYS) ||
    value.version !== 1 ||
    value.packVersion !== 1 ||
    !text(value.custodianId) ||
    !text(value.generationId) ||
    !text(value.blockId) ||
    !text(value.recipientVenueId) ||
    !Array.isArray(value.allocations) ||
    value.allocations.length === 0 ||
    value.allocations.length > 1000
  )
    return null;
  const allocations: PaperAllocation[] = [];
  const ids = new Set<string>();
  const identities = new Set<string>();
  for (const input of value.allocations) {
    const allocation = parseAllocation(input);
    if (
      allocation === null ||
      ids.has(allocation.allocationId) ||
      identities.has(allocation.installationIdentity)
    )
      return null;
    const first = allocations[0];
    if (
      first !== undefined &&
      (first.taxpayerNif !== allocation.taxpayerNif ||
        first.softwareId !== allocation.softwareId ||
        first.environment !== allocation.environment)
    )
      return null;
    ids.add(allocation.allocationId);
    identities.add(allocation.installationIdentity);
    allocations.push(allocation);
  }
  return {
    version: 1,
    custodianId: value.custodianId,
    generationId: value.generationId,
    blockId: value.blockId,
    packVersion: 1,
    recipientVenueId: value.recipientVenueId,
    allocations,
  };
}

function parseConsumption(value: unknown): PaperConsumption | null {
  if (
    !record(value) ||
    !exactKeys(value, CONSUMPTION_KEYS) ||
    value.version !== 1 ||
    ![
      "custodianId",
      "allocationId",
      "eventId",
      "operatorId",
      "sourceId",
      "targetNodeId",
      "incidentEvidence",
    ].every((key) => text(value[key])) ||
    typeof value.blockDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.blockDigest) ||
    !timestamp(value.consumedAt)
  )
    return null;
  return {
    version: 1,
    custodianId: value.custodianId as string,
    blockDigest: value.blockDigest,
    allocationId: value.allocationId as string,
    eventId: value.eventId as string,
    operatorId: value.operatorId as string,
    sourceId: value.sourceId as string,
    targetNodeId: value.targetNodeId as string,
    incidentEvidence: value.incidentEvidence as string,
    consumedAt: value.consumedAt,
  };
}

function blockBytes(block: PaperBlock): Buffer {
  return Buffer.from(
    JSON.stringify([
      "waitron.paper-block",
      block.version,
      block.custodianId,
      block.generationId,
      block.blockId,
      block.packVersion,
      block.recipientVenueId,
      block.allocations.map((a) => [
        a.version,
        a.allocationId,
        a.taxpayerNif,
        a.softwareId,
        a.environment,
        a.installationIdentity,
        a.series.map((s) => [s.code, s.purpose]),
        a.source,
        a.issuedAt,
      ]),
    ]),
  );
}

function consumptionBytes(value: PaperConsumption): Buffer {
  return Buffer.from(
    JSON.stringify([
      "waitron.paper-consumption",
      value.version,
      value.custodianId,
      value.blockDigest,
      value.allocationId,
      value.eventId,
      value.operatorId,
      value.sourceId,
      value.targetNodeId,
      value.incidentEvidence,
      value.consumedAt,
    ]),
  );
}

function parseReservation(value: unknown): PaperReservation | null {
  if (
    !record(value) ||
    !exactKeys(value, [
      "version",
      "custodianId",
      "blockDigest",
      "allocationId",
      "eventId",
      "operatorId",
      "sourceId",
      "targetNodeId",
      "incidentEvidence",
      "reservedAt",
    ]) ||
    value.version !== 1 ||
    ![
      "custodianId",
      "allocationId",
      "eventId",
      "operatorId",
      "sourceId",
      "targetNodeId",
      "incidentEvidence",
    ].every((key) => text(value[key])) ||
    typeof value.blockDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.blockDigest) ||
    !timestamp(value.reservedAt)
  )
    return null;
  return {
    version: 1,
    custodianId: value.custodianId as string,
    blockDigest: value.blockDigest,
    allocationId: value.allocationId as string,
    eventId: value.eventId as string,
    operatorId: value.operatorId as string,
    sourceId: value.sourceId as string,
    targetNodeId: value.targetNodeId as string,
    incidentEvidence: value.incidentEvidence as string,
    reservedAt: value.reservedAt,
  };
}

function reservationBytes(value: PaperReservation): Buffer {
  return Buffer.from(
    JSON.stringify([
      "waitron.paper-reservation",
      value.version,
      value.custodianId,
      value.blockDigest,
      value.allocationId,
      value.eventId,
      value.operatorId,
      value.sourceId,
      value.targetNodeId,
      value.incidentEvidence,
      value.reservedAt,
    ]),
  );
}

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function publicKey(value: unknown): KeyObject | null {
  if (typeof value !== "string" || value.length > 1024) return null;
  const pem =
    /^-----BEGIN PUBLIC KEY-----\n((?:[A-Za-z0-9+/=]+\n)+)-----END PUBLIC KEY-----\n?$/.exec(value);
  if (pem === null) return null;
  try {
    const key = createPublicKey(value);
    if (key.asymmetricKeyType !== "ed25519") return null;
    const encoded = Buffer.from(pem[1]!.replaceAll("\n", ""), "base64");
    return key.export({ type: "spki", format: "der" }).equals(encoded) ? key : null;
  } catch {
    return null;
  }
}

function trustedKey(value: unknown): KeyObject | null {
  if (!record(value) || !text(value.custodianId) || typeof value.fingerprint !== "string")
    return null;
  const key = publicKey(value.publicKey);
  if (key === null || digest(key.export({ type: "spki", format: "der" })) !== value.fingerprint)
    return null;
  return key;
}

export function paperCustodianFingerprint(value: unknown): string | null {
  const key = publicKey(value);
  return key === null ? null : digest(key.export({ type: "spki", format: "der" }));
}

export function enrolPaperCustodian(
  custodianId: unknown,
  key: unknown,
  confirmedFingerprint: unknown,
): PaperCustodianTrust | null {
  const fingerprint = paperCustodianFingerprint(key);
  if (
    !text(custodianId) ||
    typeof key !== "string" ||
    fingerprint === null ||
    fingerprint !== confirmedFingerprint
  )
    return null;
  return { custodianId, publicKey: key, fingerprint };
}

function signingKey(value: string): KeyObject {
  const key = createPrivateKey(value);
  if (key.asymmetricKeyType !== "ed25519")
    throw new RangeError("Paper evidence requires an Ed25519 custodian key");
  return key;
}

export function signPaperBlock(value: unknown, privateKey: string): SignedPaperValue<PaperBlock> {
  const block = parseBlock(value);
  if (block === null) throw new RangeError("Invalid paper block");
  return {
    payload: block,
    signature: sign(null, blockBytes(block), signingKey(privateKey)).toString("base64url"),
  };
}

export function signPaperConsumption(
  value: unknown,
  privateKey: string,
): SignedPaperValue<PaperConsumption> {
  const consumption = parseConsumption(value);
  if (consumption === null) throw new RangeError("Invalid paper consumption");
  return {
    payload: consumption,
    signature: sign(null, consumptionBytes(consumption), signingKey(privateKey)).toString(
      "base64url",
    ),
  };
}

export function signPaperConsumptionForBlock(
  input: unknown,
  allocationId: string,
  event: unknown,
  privateKey: string,
): SignedPaperValue<PaperConsumption> {
  const block = record(input) ? parseBlock(input.payload) : null;
  const key = signingKey(privateKey);
  if (
    block === null ||
    !record(input) ||
    !signature(input.signature) ||
    !verify(
      null,
      blockBytes(block),
      createPublicKey(key),
      Buffer.from(input.signature, "base64url"),
    ) ||
    !block.allocations.some((allocation) => allocation.allocationId === allocationId)
  ) {
    throw new RangeError("Untrusted paper block or absent allocation");
  }
  if (
    !record(event) ||
    !exactKeys(event, [
      "eventId",
      "operatorId",
      "sourceId",
      "targetNodeId",
      "incidentEvidence",
      "consumedAt",
    ])
  ) {
    throw new RangeError("Invalid paper consumption event");
  }
  return signPaperConsumption(
    {
      version: 1,
      custodianId: block.custodianId,
      blockDigest: digest(blockBytes(block)),
      allocationId,
      eventId: event.eventId,
      operatorId: event.operatorId,
      sourceId: event.sourceId,
      targetNodeId: event.targetNodeId,
      incidentEvidence: event.incidentEvidence,
      consumedAt: event.consumedAt,
    },
    privateKey,
  );
}

function signature(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_-]{86}$/.test(value) &&
    Buffer.from(value, "base64url").toString("base64url") === value
  );
}

export function signPaperReservationForBlock(
  input: unknown,
  allocationId: string,
  event: unknown,
  privateKey: string,
): SignedPaperValue<PaperReservation> {
  const block = record(input) ? parseBlock(input.payload) : null;
  const key = signingKey(privateKey);
  if (
    block === null ||
    !record(input) ||
    !signature(input.signature) ||
    !verify(
      null,
      blockBytes(block),
      createPublicKey(key),
      Buffer.from(input.signature, "base64url"),
    ) ||
    !block.allocations.some(
      (allocation) => allocation.allocationId === allocationId && allocation.source === "paper",
    )
  )
    throw new RangeError("Untrusted paper block or absent allocation");
  if (
    !record(event) ||
    !exactKeys(event, [
      "eventId",
      "operatorId",
      "sourceId",
      "targetNodeId",
      "incidentEvidence",
      "reservedAt",
    ])
  )
    throw new RangeError("Invalid paper reservation event");
  const reservation = parseReservation({
    version: 1,
    custodianId: block.custodianId,
    blockDigest: digest(blockBytes(block)),
    allocationId,
    ...event,
  });
  if (reservation === null || reservation.sourceId === reservation.targetNodeId)
    throw new RangeError("Invalid paper reservation event");
  return {
    payload: reservation,
    signature: sign(null, reservationBytes(reservation), key).toString("base64url"),
  };
}

// Reservation evidence identifies the dormant recipient; consumption requires a separate event.
export function verifyPaperReservation(
  input: unknown,
  trust: unknown,
  context: PaperReservationContext,
): PaperReservationVerification {
  if (
    !record(input) ||
    !exactKeys(input, ["block", "reservation"]) ||
    !record(input.block) ||
    !exactKeys(input.block, ["payload", "signature"]) ||
    !record(input.reservation) ||
    !exactKeys(input.reservation, ["payload", "signature"])
  )
    return { ok: false, reason: "malformed" };
  const block = parseBlock(input.block.payload);
  const reservation = parseReservation(input.reservation.payload);
  if (
    block === null ||
    reservation === null ||
    !signature(input.block.signature) ||
    !signature(input.reservation.signature)
  )
    return { ok: false, reason: "malformed" };
  const key = trustedKey(trust);
  if (
    key === null ||
    !record(trust) ||
    trust.custodianId !== block.custodianId ||
    trust.custodianId !== reservation.custodianId ||
    !verify(null, blockBytes(block), key, Buffer.from(input.block.signature, "base64url")) ||
    !verify(
      null,
      reservationBytes(reservation),
      key,
      Buffer.from(input.reservation.signature, "base64url"),
    )
  )
    return { ok: false, reason: "untrusted" };
  if (context.currentRegisterConfirmed !== true || context.reservationConfirmed !== true)
    return { ok: false, reason: "outside_confirmation_missing" };
  if (context.currentEntryState !== "reserved")
    return { ok: false, reason: "reservation_not_current" };
  const allocation = block.allocations.find((a) => a.allocationId === context.allocationId);
  if (
    allocation === undefined ||
    allocation.source !== "paper" ||
    reservation.blockDigest !== digest(blockBytes(block)) ||
    reservation.allocationId !== allocation.allocationId ||
    reservation.sourceId === reservation.targetNodeId ||
    !["taxpayerNif", "softwareId", "environment"].every(
      (key) =>
        allocation[key as "taxpayerNif" | "softwareId" | "environment"] ===
        context[key as "taxpayerNif" | "softwareId" | "environment"],
    ) ||
    !["recipientVenueId", "generationId", "blockId"].every(
      (key) =>
        block[key as "recipientVenueId" | "generationId" | "blockId"] ===
        context[key as "recipientVenueId" | "generationId" | "blockId"],
    ) ||
    !["eventId", "operatorId", "sourceId", "targetNodeId", "incidentEvidence"].every(
      (key) =>
        reservation[
          key as "eventId" | "operatorId" | "sourceId" | "targetNodeId" | "incidentEvidence"
        ] ===
        context[key as "eventId" | "operatorId" | "sourceId" | "targetNodeId" | "incidentEvidence"],
    )
  )
    return { ok: false, reason: "scope_mismatch" };
  if (!isAllocatedSeries(allocation.series, allocation.installationIdentity, context.requiredBases))
    return { ok: false, reason: "series_mismatch" };
  const result = structuredClone({ ok: true as const, allocation, reservation });
  for (const series of result.allocation.series) Object.freeze(series);
  Object.freeze(result.allocation.series);
  Object.freeze(result.allocation);
  Object.freeze(result.reservation);
  return Object.freeze(result);
}

export function verifyPaperEvidence(
  input: unknown,
  trust: unknown,
  context: PaperEvidenceContext,
): PaperVerification {
  if (!record(input) || !record(input.block) || !record(input.consumption))
    return { ok: false, reason: "malformed" };
  const block = parseBlock(input.block.payload);
  const consumption = parseConsumption(input.consumption.payload);
  if (
    block === null ||
    consumption === null ||
    !signature(input.block.signature) ||
    !signature(input.consumption.signature)
  )
    return { ok: false, reason: "malformed" };
  const key = trustedKey(trust);
  if (
    key === null ||
    !record(trust) ||
    trust.custodianId !== block.custodianId ||
    trust.custodianId !== consumption.custodianId ||
    !verify(null, blockBytes(block), key, Buffer.from(input.block.signature, "base64url")) ||
    !verify(
      null,
      consumptionBytes(consumption),
      key,
      Buffer.from(input.consumption.signature, "base64url"),
    )
  )
    return { ok: false, reason: "untrusted" };
  if (context.currentRegisterConfirmed !== true || context.consumptionConfirmed !== true)
    return { ok: false, reason: "outside_confirmation_missing" };
  const allocation = block.allocations.find((a) => a.allocationId === context.allocationId);
  if (
    allocation === undefined ||
    consumption.blockDigest !== digest(blockBytes(block)) ||
    consumption.allocationId !== allocation.allocationId ||
    !["taxpayerNif", "softwareId", "environment"].every(
      (key) =>
        allocation[key as "taxpayerNif" | "softwareId" | "environment"] ===
        context[key as "taxpayerNif" | "softwareId" | "environment"],
    ) ||
    !["recipientVenueId", "generationId", "blockId"].every(
      (key) =>
        block[key as "recipientVenueId" | "generationId" | "blockId"] ===
        context[key as "recipientVenueId" | "generationId" | "blockId"],
    ) ||
    !["eventId", "operatorId", "sourceId", "targetNodeId", "incidentEvidence"].every(
      (key) =>
        consumption[
          key as "eventId" | "operatorId" | "sourceId" | "targetNodeId" | "incidentEvidence"
        ] ===
        context[key as "eventId" | "operatorId" | "sourceId" | "targetNodeId" | "incidentEvidence"],
    )
  )
    return { ok: false, reason: "scope_mismatch" };
  if (!isAllocatedSeries(allocation.series, allocation.installationIdentity, context.requiredBases))
    return { ok: false, reason: "series_mismatch" };
  return { ok: true, allocation };
}
