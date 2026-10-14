import "./errors.js";
import { createHash, randomUUID } from "node:crypto";
import { open, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { AppError } from "@waitron/shared";
import { readOperationAuthority, type ModuleOperationPreparation } from "@waitron/module";
import {
  drawEmergencyIdentity,
  validateAllocationEnvelope,
  type AllocationContext,
  type FiscalAllocation,
} from "./allocation-envelope.js";
import {
  installationChecksum,
  isAllocatedSeries,
  isInstallationIdentity,
} from "./allocation-identity.js";
import { createAllocationPreparation } from "./allocation-preparation.js";
import { WAITRON_ID_SISTEMA } from "./software.js";
import { withEmergencyAttempt } from "./emergency-attempt.js";

function refuse(reason: string): never {
  throw new AppError("sif.allocation_invalid", { reason });
}

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Reflect.ownKeys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

async function readCurrent(path: string): Promise<unknown> {
  let file: FileHandle | undefined;
  try {
    file = await open(path, "r");
    if (!(await file.stat()).isFile()) return null;
    const buffer = Buffer.alloc(65537);
    let count = 0;
    while (count < buffer.length) {
      const { bytesRead } = await file.read(buffer, count, buffer.length - count, null);
      if (bytesRead === 0) break;
      count += bytesRead;
    }
    return count > 65536 ? null : JSON.parse(buffer.subarray(0, count).toString("utf8"));
  } catch {
    return null;
  } finally {
    await file?.close();
  }
}

async function consume(directory: string, key: string, record: unknown): Promise<void> {
  let file: FileHandle | undefined;
  let parent: FileHandle | undefined;
  try {
    parent = await open(directory, "r");
    file = await open(join(directory, `${key}.json`), "wx", 0o600);
    await file.writeFile(JSON.stringify(record));
    await file.sync();
    await parent.sync();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") refuse("allocation_consumed");
    refuse("outside_confirmation_missing");
  } finally {
    await file?.close();
    await parent?.close();
  }
}

export function createEmergencyAllocationPreparation(configuration: {
  readonly confirmationPath: string;
  readonly incidentDirectory: string;
}): ModuleOperationPreparation {
  const { confirmationPath, incidentDirectory } = configuration;
  return {
    async prepare(operation, run) {
      const held = { ...operation, binding: Object.freeze({ ...operation.binding }) };
      const operator = readOperationAuthority(held.authority, held.binding);
      if (
        operator === undefined ||
        held.binding.module !== "fiscal-verifactu" ||
        !["restore", "re-register"].includes(held.binding.action)
      )
        refuse("reauthentication_required");
      const input = held.input;
      if (
        !exact(input, ["emergency", "approval"]) ||
        !exact(input.emergency, ["version"]) ||
        input.emergency.version !== 1
      )
        refuse("malformed_allocation");
      const approval = structuredClone(input.approval);
      const current = await readCurrent(confirmationPath);
      if (
        !exact(current, [
          "version",
          "priorActivation",
          "binding",
          "operatorId",
          "taxpayerNif",
          "environment",
          "requiredBases",
          "incidentEvidence",
          "knownIdentities",
          "uncertaintyRecorded",
        ]) ||
        current.version !== 1 ||
        typeof current.priorActivation !== "string" ||
        !["none", "committed", "uncertain"].includes(current.priorActivation) ||
        typeof current.taxpayerNif !== "string" ||
        !/^[A-Z0-9]{9}$/.test(current.taxpayerNif) ||
        (current.environment !== "preproduction" && current.environment !== "production") ||
        typeof current.incidentEvidence !== "string" ||
        !current.incidentEvidence.trim() ||
        typeof current.uncertaintyRecorded !== "boolean" ||
        !Array.isArray(current.requiredBases) ||
        !current.requiredBases.every(
          (base: unknown) =>
            exact(base, ["code", "purpose"]) &&
            typeof base.code === "string" &&
            typeof base.purpose === "string",
        ) ||
        (current.knownIdentities !== null &&
          (!Array.isArray(current.knownIdentities) ||
            !current.knownIdentities.every(isInstallationIdentity)))
      )
        refuse("outside_confirmation_missing");
      if (
        !isDeepStrictEqual(current.binding, held.binding) ||
        !isDeepStrictEqual(current.operatorId, operator.operatorId)
      )
        refuse("event_mismatch");
      const requiredBases = current.requiredBases as { code: string; purpose: string }[];
      const knownIdentities = current.knownIdentities as readonly string[] | null;
      const key = createHash("sha256").update(held.binding.eventId).digest("hex");
      if (current.priorActivation === "uncertain") refuse("uncertain_prior_activation");
      if (current.priorActivation === "committed") {
        const prior = await readCurrent(join(incidentDirectory, `${key}.json`));
        if (
          !exact(prior, [
            "version",
            "binding",
            "operatorId",
            "allocation",
            "approval",
            "knownIdentities",
            "uncertaintyRecorded",
            "attempts",
          ]) ||
          prior.version !== 1
        )
          refuse("outside_confirmation_missing");
        if (
          !isDeepStrictEqual(prior.binding, held.binding) ||
          !isDeepStrictEqual(prior.operatorId, operator.operatorId) ||
          !isDeepStrictEqual(prior.approval, approval)
        )
          refuse("event_mismatch");
        const allocation = prior.allocation as FiscalAllocation | null;
        if (
          allocation === null ||
          typeof allocation !== "object" ||
          allocation.source !== "emergency"
        )
          refuse("malformed_allocation");
        if (allocation.taxpayerNif !== current.taxpayerNif) refuse("taxpayer_mismatch");
        if (allocation.environment !== current.environment) refuse("environment_mismatch");
        if (!isAllocatedSeries(allocation.series, allocation.installationIdentity, requiredBases))
          refuse("series_mismatch");
        // A reconstructed draw can only replay an exact locally committed activation.
        const consumption = { ...prior };
        delete consumption.attempts;
        return withEmergencyAttempt(
          incidentDirectory,
          join(incidentDirectory, `${key}.json`),
          consumption,
          () =>
            createAllocationPreparation(async (request) => ({
              ...request,
              evidence: {
                allocationId: allocation.allocationId,
                priorActivation: "committed",
                requiredBases,
                incidentEvidence: current.incidentEvidence as string,
                authority: {
                  kind: "emergency",
                  draw: {
                    identity: allocation.installationIdentity,
                    checksum: installationChecksum(allocation.installationIdentity) ?? "",
                  },
                  knownIdentities,
                  incidentRecorded: true,
                  uncertaintyRecorded: current.uncertaintyRecorded as boolean,
                },
              },
            })).prepare({ ...held, input: { allocation, approval } }, run),
        );
      }
      let draw = drawEmergencyIdentity();
      while (knownIdentities?.includes(draw.identity)) draw = drawEmergencyIdentity();
      const authority: AllocationContext["authority"] = {
        kind: "emergency",
        draw,
        knownIdentities,
        incidentRecorded: true,
        uncertaintyRecorded: current.uncertaintyRecorded,
      };
      const allocation: FiscalAllocation = {
        version: 1,
        allocationId: randomUUID(),
        taxpayerNif: current.taxpayerNif,
        softwareId: WAITRON_ID_SISTEMA,
        environment: current.environment,
        installationIdentity: draw.identity,
        source: "emergency",
        series: requiredBases.map((base) => ({
          code: `${base.code}-${draw.identity}`,
          purpose: base.purpose,
        })),
        reservationEvidence: { checksum: draw.checksum },
        issuedAt: new Date().toISOString(),
      };
      const verdict = validateAllocationEnvelope(allocation, approval, {
        taxpayerNif: current.taxpayerNif,
        softwareId: WAITRON_ID_SISTEMA,
        environment: current.environment,
        mode: "recovery",
        ...held.binding,
        operatorId: operator.operatorId,
        incidentEvidence: current.incidentEvidence,
        requiredBases,
        reauthentication: { operatorId: operator.operatorId, eventId: held.binding.eventId },
        priorActivation: "none",
        authority,
      });
      if (!verdict.ok) refuse(verdict.reason);
      if (readOperationAuthority(held.authority, held.binding) === undefined)
        refuse("reauthentication_required");
      // This record stays consumed if activation fails; no saved draw grants authority on a retry.
      const consumption = {
        version: 1,
        binding: held.binding,
        operatorId: operator.operatorId,
        allocation,
        approval: verdict.approval,
        knownIdentities,
        uncertaintyRecorded: current.uncertaintyRecorded,
      };
      await consume(incidentDirectory, key, { ...consumption, attempts: [] });
      return withEmergencyAttempt(
        incidentDirectory,
        join(incidentDirectory, `${key}.json`),
        consumption,
        () =>
          createAllocationPreparation(async (request) => ({
            ...request,
            evidence: {
              allocationId: allocation.allocationId,
              authority,
              priorActivation: "none",
              requiredBases,
              incidentEvidence: current.incidentEvidence as string,
            },
          })).prepare({ ...held, input: { allocation, approval: verdict.approval } }, run),
      );
    },
  };
}
