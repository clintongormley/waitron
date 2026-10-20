import { isAllocatedSeries, isInstallationIdentity } from "./allocation-identity.js";
import { parseAllocationOperator } from "./allocation-operator.js";
import type { OperationOperator } from "@waitron/module/src/operation-authority.js";

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
  readonly operatorId: OperationOperator;
  readonly sourceId: string;
  readonly targetNodeId: string;
  readonly incidentEvidence: string;
  readonly consumedAt: string;
}

export interface SignedPaperValue<T> {
  readonly payload: T;
  readonly signature: string;
}

export function paperBlockBytes(block: PaperBlock): Uint8Array {
  return new TextEncoder().encode(
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

export function paperConsumptionBytes(value: PaperConsumption): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify([
      "waitron.paper-consumption",
      value.version,
      value.custodianId,
      value.blockDigest,
      value.allocationId,
      value.eventId,
      typeof value.operatorId === "string"
        ? value.operatorId
        : {
            kind: value.operatorId.kind,
            nodeId: value.operatorId.nodeId,
            eventId: value.operatorId.eventId,
          },
      value.sourceId,
      value.targetNodeId,
      value.incidentEvidence,
      value.consumedAt,
    ]),
  );
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

export function parsePaperAllocation(value: unknown): PaperAllocation | null {
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

export function parsePaperBlock(value: unknown): PaperBlock | null {
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
    const allocation = parsePaperAllocation(input);
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

export function parsePaperConsumption(value: unknown): PaperConsumption | null {
  const operator = record(value) ? parseAllocationOperator(value.operatorId) : null;
  if (
    !record(value) ||
    !exactKeys(value, CONSUMPTION_KEYS) ||
    value.version !== 1 ||
    ![
      "custodianId",
      "allocationId",
      "eventId",
      "sourceId",
      "targetNodeId",
      "incidentEvidence",
    ].every((key) => text(value[key])) ||
    operator === null ||
    (typeof operator !== "string" &&
      (operator.nodeId !== value.targetNodeId || operator.eventId !== value.eventId)) ||
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
    operatorId: operator,
    sourceId: value.sourceId as string,
    targetNodeId: value.targetNodeId as string,
    incidentEvidence: value.incidentEvidence as string,
    consumedAt: value.consumedAt,
  };
}
