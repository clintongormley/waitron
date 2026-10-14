import "./errors.js";
import { open, type FileHandle } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { AppError } from "@waitron/shared";
import type {
  AllocationEvidenceRequest,
  AllocationOperationEvidence,
} from "./allocation-operation.js";
import type {
  StandbyAllocationEvidence,
  StandbyAllocationEvidenceSource,
} from "./allocated-standby.js";
import { enrolPaperCustodian } from "./paper-evidence.js";

type PaperAuthority = Extract<AllocationOperationEvidence["authority"], { kind: "paper" }>;
type PaperAllocationSource = (request: AllocationEvidenceRequest) => Promise<
  AllocationEvidenceRequest & {
    evidence: AllocationOperationEvidence & {
      allocationId: string;
      authority: PaperAuthority;
      requiredBases: NonNullable<AllocationOperationEvidence["requiredBases"]>;
    };
  }
>;
type CurrentConfirmation = AllocationEvidenceRequest &
  Pick<AllocationOperationEvidence, "priorActivation" | "incidentEvidence"> & {
    version: 1;
    allocationId: string;
    requiredBases: NonNullable<AllocationOperationEvidence["requiredBases"]>;
  } & Omit<PaperAuthority, "kind" | "trust">;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
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

async function readJson(path: string): Promise<unknown> {
  let file: FileHandle | undefined;
  try {
    if (path.length === 0) return null;
    file = await open(path, "r");
    const buffer = Buffer.alloc(65537);
    let count = 0;
    while (count < buffer.length) {
      const { bytesRead } = await file.read(buffer, count, buffer.length - count, null);
      if (bytesRead === 0) break;
      count += bytesRead;
    }
    if (count > 65536) return null;
    return JSON.parse(buffer.subarray(0, count).toString("utf8")) as unknown;
  } catch {
    return null;
  } finally {
    await file?.close();
  }
}

function currentConfirmation(value: unknown): value is CurrentConfirmation {
  return (
    record(value) &&
    exact(value, [
      "version",
      "allocationId",
      "binding",
      "operatorId",
      "priorActivation",
      "incidentEvidence",
      "requiredBases",
      "recipientVenueId",
      "generationId",
      "blockId",
      "currentRegisterConfirmed",
      "consumptionConfirmed",
      "currentEntryState",
    ]) &&
    value.version === 1 &&
    ["none", "committed", "uncertain"].includes(value.priorActivation as string) &&
    ["consumed-for-event", "reserved", "consumed-elsewhere", "retired", "abandoned"].includes(
      value.currentEntryState as string,
    ) &&
    ["allocationId", "incidentEvidence", "recipientVenueId", "generationId", "blockId"].every(
      (key) => text(value[key]),
    ) &&
    typeof value.currentRegisterConfirmed === "boolean" &&
    typeof value.consumptionConfirmed === "boolean" &&
    Array.isArray(value.requiredBases) &&
    value.requiredBases.length > 0 &&
    value.requiredBases.every(
      (base: unknown) =>
        record(base) && exact(base, ["code", "purpose"]) && text(base.code) && text(base.purpose),
    )
  );
}

export function createPaperAllocationSource(configuration: {
  readonly custodianPath: string;
  readonly confirmationPath: string;
  readonly confirmedFingerprint: string;
}): PaperAllocationSource {
  const { custodianPath, confirmationPath, confirmedFingerprint } = configuration;
  return async (supplied) => {
    const request = structuredClone(supplied);
    const refuse = (reason: string): never => {
      throw new AppError("sif.allocation_invalid", { reason });
    };
    const key = await readJson(custodianPath);
    if (!record(key) || !exact(key, ["custodianId", "publicKey", "fingerprint"]))
      return refuse("reservation_untrusted");
    const trust = enrolPaperCustodian(key.custodianId, key.publicKey, confirmedFingerprint);
    if (trust === null || trust.fingerprint !== key.fingerprint)
      return refuse("reservation_untrusted");
    const current = await readJson(confirmationPath);
    if (!currentConfirmation(current)) return refuse("outside_confirmation_missing");
    if (
      !isDeepStrictEqual(current.binding, request.binding) ||
      !isDeepStrictEqual(current.operatorId, request.operatorId)
    )
      return refuse("event_mismatch");
    return {
      ...request,
      evidence: {
        allocationId: current.allocationId,
        priorActivation: current.priorActivation,
        incidentEvidence: current.incidentEvidence,
        requiredBases: current.requiredBases,
        authority: {
          kind: "paper",
          trust,
          recipientVenueId: current.recipientVenueId,
          generationId: current.generationId,
          blockId: current.blockId,
          currentRegisterConfirmed: current.currentRegisterConfirmed,
          consumptionConfirmed: current.consumptionConfirmed,
          currentEntryState: current.currentEntryState,
        },
      },
    };
  };
}

export function createPaperStandbySource(configuration: {
  readonly custodianPath: string;
  readonly confirmationPath: string;
  readonly confirmedFingerprint: string;
}): StandbyAllocationEvidenceSource {
  const { custodianPath, confirmationPath, confirmedFingerprint } = configuration;
  return async (supplied) => {
    const request = structuredClone(supplied);
    const refuse = (reason: string): never => {
      throw new AppError("sif.allocation_invalid", { reason });
    };
    const key = await readJson(custodianPath);
    if (!record(key) || !exact(key, ["custodianId", "publicKey", "fingerprint"]))
      return refuse("reservation_untrusted");
    const trust = enrolPaperCustodian(key.custodianId, key.publicKey, confirmedFingerprint);
    if (trust === null || trust.fingerprint !== key.fingerprint)
      return refuse("reservation_untrusted");
    const current = await readJson(confirmationPath);
    if (
      !record(current) ||
      !exact(current, [
        "version",
        "allocationId",
        "binding",
        "operatorId",
        "incidentEvidence",
        "recipientVenueId",
        "generationId",
        "blockId",
        "currentRegisterConfirmed",
        "reservationConfirmed",
        "currentEntryState",
      ]) ||
      current.version !== 1 ||
      !["allocationId", "incidentEvidence", "recipientVenueId", "generationId", "blockId"].every(
        (field) => text(current[field]),
      ) ||
      typeof current.currentRegisterConfirmed !== "boolean" ||
      typeof current.reservationConfirmed !== "boolean" ||
      !["reserved", "consumed-for-event", "consumed-elsewhere", "retired", "abandoned"].includes(
        current.currentEntryState as string,
      )
    )
      return refuse("outside_confirmation_missing");
    if (
      !isDeepStrictEqual(current.binding, request.binding) ||
      !isDeepStrictEqual(current.operatorId, request.operatorId)
    )
      return refuse("event_mismatch");
    if (current.currentRegisterConfirmed !== true || current.reservationConfirmed !== true)
      return refuse("outside_confirmation_missing");
    if (current.currentEntryState !== "reserved") return refuse("reservation_not_current");
    return {
      ...request,
      evidence: {
        trust,
        allocationId: current.allocationId as string,
        incidentEvidence: current.incidentEvidence as string,
        recipientVenueId: current.recipientVenueId as string,
        generationId: current.generationId as string,
        blockId: current.blockId as string,
        currentRegisterConfirmed: true,
        reservationConfirmed: true,
        currentEntryState: "reserved",
      } satisfies StandbyAllocationEvidence,
    };
  };
}
