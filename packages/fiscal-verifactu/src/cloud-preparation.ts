import "./errors.js";
import { createHash, randomUUID } from "node:crypto";
import { open, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { eq } from "drizzle-orm";
import { deployment, nodes, readTenant, type Database } from "@waitron/db";
import type { ProvisionedNode } from "@waitron/module";
import { fiscalAllocations } from "./schema/allocations.js";
import { AppError, isUuid } from "@waitron/shared";
import { readOperationAuthority, type ModuleOperationPreparation } from "@waitron/module";
import { createAllocationPreparation } from "./allocation-preparation.js";
import {
  readCloudAllocationReceipt,
  verifyCloudAllocationEvidence,
  type ReceiptTrust,
} from "./cloud-evidence.js";
import type { AllocationContext } from "./allocation-envelope.js";

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

export function createCloudAllocationPreparation(configuration: {
  readonly trust: ReceiptTrust;
  readonly confirmationPath: string;
  readonly receiptDirectory: string;
}): ModuleOperationPreparation {
  const { confirmationPath, receiptDirectory } = configuration;
  const trust = { issuer: configuration.trust.issuer, keys: new Map(configuration.trust.keys) };
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
      if (!exact(held.input, ["allocation", "approval", "receipt"])) refuse("malformed_allocation");
      const supplied = structuredClone(held.input);
      const receipt = readCloudAllocationReceipt(supplied.receipt, trust);
      if (receipt === null) refuse("reservation_untrusted");
      if (
        !isDeepStrictEqual(supplied.allocation, receipt.payload.allocation) ||
        !isDeepStrictEqual(supplied.approval, receipt.payload.approval)
      )
        refuse("reservation_mismatch");
      const current = await readJson(confirmationPath);
      if (
        !exact(current, [
          "version",
          "binding",
          "operatorId",
          "allocationId",
          "receiptId",
          "priorActivation",
          "incidentEvidence",
          "requiredBases",
        ]) ||
        current.version !== 1 ||
        !["none", "committed", "uncertain"].includes(current.priorActivation as string) ||
        !text(current.incidentEvidence) ||
        !Array.isArray(current.requiredBases) ||
        current.requiredBases.length === 0 ||
        !current.requiredBases.every(
          (base: unknown) =>
            exact(base, ["code", "purpose"]) && text(base.code) && text(base.purpose),
        )
      )
        refuse("outside_confirmation_missing");
      if (
        !isDeepStrictEqual(current.binding, held.binding) ||
        !isDeepStrictEqual(current.operatorId, operator.operatorId)
      )
        refuse("event_mismatch");
      if (
        current.allocationId !== receipt.payload.allocation.allocationId ||
        current.receiptId !== receipt.payload.receiptId
      )
        refuse("reservation_mismatch");
      if (current.priorActivation === "uncertain") refuse("uncertain_prior_activation");
      const requiredBases = current.requiredBases as { code: string; purpose: string }[];
      const context: AllocationContext = {
        taxpayerNif: receipt.payload.allocation.taxpayerNif,
        softwareId: receipt.payload.allocation.softwareId,
        environment: receipt.payload.allocation.environment,
        mode: "recovery",
        ...held.binding,
        operatorId: operator.operatorId,
        incidentEvidence: current.incidentEvidence,
        requiredBases,
        priorActivation: "none",
        reauthentication: { operatorId: operator.operatorId, eventId: held.binding.eventId },
        authority: { kind: "cloud", trust, receipt },
      };
      const verified = verifyCloudAllocationEvidence(receipt, trust, context);
      if (!verified.ok) refuse(verified.reason);
      const record = {
        version: 1,
        receipt,
        binding: held.binding,
        operatorId: operator.operatorId,
      };
      const path = join(
        receiptDirectory,
        createHash("sha256").update(receipt.payload.allocation.allocationId).digest("hex") +
          ".json",
      );
      if (current.priorActivation === "committed") {
        const prior = await readJson(path);
        if (!exact(prior, [...Object.keys(record), "reportOperationId"]))
          refuse("outside_confirmation_missing");
        if (
          !Object.entries(record).every(([key, value]) => isDeepStrictEqual(prior[key], value)) ||
          typeof prior.reportOperationId !== "string" ||
          !isUuid(prior.reportOperationId)
        )
          refuse("reservation_mismatch");
      } else {
        let file: FileHandle | undefined;
        let directory: FileHandle | undefined;
        try {
          directory = await open(receiptDirectory, "r");
          // Even a rolled-back local attempt spends this receipt; only a committed result can replay.
          file = await open(path, "wx", 0o600);
          await file.writeFile(JSON.stringify({ ...record, reportOperationId: randomUUID() }));
          await file.sync();
          await directory.sync();
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST")
            refuse("uncertain_prior_activation");
          refuse("outside_confirmation_missing");
        } finally {
          await file?.close();
          await directory?.close();
        }
      }
      return createAllocationPreparation(async (request) => ({
        ...request,
        evidence: {
          allocationId: receipt.payload.allocation.allocationId,
          priorActivation: current.priorActivation as "none" | "committed",
          requiredBases,
          incidentEvidence: current.incidentEvidence as string,
          authority: { kind: "cloud", trust, receipt },
        },
      })).prepare(
        { ...held, input: { allocation: verified.allocation, approval: verified.approval } },
        run,
      );
    },
  };
}

export function createCloudAllocationFilePreparation(configuration: {
  readonly trustPath: string;
  readonly confirmedFingerprint: string;
  readonly confirmationPath: string;
  readonly receiptDirectory: string;
}): ModuleOperationPreparation {
  return {
    async prepare(operation, run) {
      const key = await readJson(configuration.trustPath);
      if (
        !exact(key, ["issuer", "fingerprint", "publicKey"]) ||
        !text(key.issuer) ||
        typeof key.publicKey !== "string" ||
        key.fingerprint !== configuration.confirmedFingerprint ||
        !/^[0-9a-f]{64}$/.test(configuration.confirmedFingerprint)
      )
        refuse("reservation_untrusted");
      return createCloudAllocationPreparation({
        ...configuration,
        trust: {
          issuer: key.issuer,
          keys: new Map([[configuration.confirmedFingerprint, key.publicKey]]),
        },
      }).prepare(operation, run);
    },
  };
}

export async function readCloudAllocationReport(
  db: Database,
  node: ProvisionedNode,
  configuration: {
    readonly receiptPath: string;
    readonly trust: ReceiptTrust;
  },
) {
  const record = await readJson(configuration.receiptPath);
  if (
    !exact(record, ["version", "receipt", "binding", "operatorId", "reportOperationId"]) ||
    record.version !== 1 ||
    typeof record.reportOperationId !== "string" ||
    !isUuid(record.reportOperationId) ||
    !exact(record.binding, ["module", "action", "eventId", "sourceId", "targetNodeId"])
  )
    refuse("outside_confirmation_missing");
  const receipt = readCloudAllocationReceipt(record.receipt, configuration.trust);
  if (receipt === null || receipt.payload.state !== "consumed") refuse("reservation_untrusted");
  const binding = record.binding;
  const approval = receipt.payload.approval!;
  if (
    binding.module !== "fiscal-verifactu" ||
    !["restore", "re-register"].includes(binding.action as string) ||
    binding.targetNodeId !== node.nodeId ||
    binding.targetNodeId !== approval.targetNodeId ||
    binding.sourceId !== approval.sourceId ||
    binding.eventId !== approval.eventId ||
    !isDeepStrictEqual(record.operatorId, approval.operatorId)
  )
    refuse("event_mismatch");
  const [prior] = await db
    .select()
    .from(fiscalAllocations)
    .where(eq(fiscalAllocations.eventKey, approval.eventId));
  if (prior === undefined) refuse("prior_activation_requires_replay");
  if (
    prior.nodeId !== node.nodeId ||
    !isDeepStrictEqual(prior.allocation, receipt.payload.allocation) ||
    !isDeepStrictEqual(prior.approval, approval)
  )
    refuse("reservation_mismatch");
  const [storedNode] = await db.select().from(nodes).where(eq(nodes.id, node.nodeId));
  const tenant = await readTenant(db);
  const [stamp] = await db.select().from(deployment).where(eq(deployment.id, 1));
  if (storedNode?.locationId !== node.locationId) refuse("node_mismatch");
  if (tenant?.taxId !== prior.taxpayerNif) refuse("taxpayer_mismatch");
  if (stamp?.environment !== prior.environment) refuse("environment_mismatch");
  return {
    operationId: record.reportOperationId,
    body: {
      venueId: receipt.payload.venueId,
      scope: {
        taxpayerNif: prior.taxpayerNif,
        softwareId: prior.softwareId,
        environment: prior.environment,
      },
      receipt,
      paperHistory: null,
      activationEvidence: {
        version: 1,
        eventId: prior.eventKey,
        nodeId: prior.nodeId,
        result: prior.result,
      },
    },
  };
}
