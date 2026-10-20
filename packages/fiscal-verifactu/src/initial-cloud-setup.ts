import "./errors.js";
import { createHash } from "node:crypto";
import { openSync, readSync, closeSync, fstatSync } from "node:fs";
import { isDeepStrictEqual as equal } from "node:util";
import { AppError, isUuid } from "@waitron/shared";
import type { InitialSetupContext, InitialSetupImport } from "@waitron/module";
import {
  readCloudAllocationReceipt,
  verifyCloudAllocationEvidence,
  type ReceiptTrust,
} from "./cloud-evidence.js";
import { isAllocatedSeries } from "./allocation-identity.js";
import { WAITRON_ID_SISTEMA } from "./software.js";

function refuse(reason = "malformed_allocation"): never {
  throw new AppError("sif.allocation_invalid", { reason });
}
export function cloudExact(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
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
function freeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export function createInitialCloudRequest(
  context: InitialSetupContext,
  venueId: string,
  operationId: string,
  incidentEvidence: string,
) {
  if (
    !text(context.attemptId) ||
    !text(context.administratorId) ||
    !cloudExact(context.binding, ["module", "action", "eventId", "sourceId", "targetNodeId"]) ||
    context.binding.module !== "fiscal-verifactu" ||
    context.binding.action !== "setup" ||
    !text(context.binding.eventId) ||
    !text(context.binding.targetNodeId) ||
    context.binding.sourceId !== `first-setup:${context.attemptId}` ||
    context.recipientVenueId !== context.binding.sourceId ||
    !isUuid(venueId) ||
    !isUuid(operationId) ||
    !text(incidentEvidence) ||
    !/^[A-Z0-9]{9}$/.test(context.taxId) ||
    !["preproduction", "production"].includes(context.environment) ||
    !context.bases.every((base) => cloudExact(base, ["code", "purpose"])) ||
    !isAllocatedSeries(
      context.bases.map((base) => ({ code: `${base.code}-C000001`, purpose: base.purpose })),
      "C000001",
      context.bases,
    )
  )
    refuse("event_mismatch");
  return freeze(
    structuredClone({
      version: 1 as const,
      operationId,
      venueId,
      scope: {
        taxpayerNif: context.taxId,
        softwareId: WAITRON_ID_SISTEMA,
        environment: context.environment,
      },
      bases: context.bases,
      binding: {
        eventId: context.binding.eventId,
        operatorId: context.administratorId,
        sourceId: context.binding.sourceId,
        targetNodeId: context.binding.targetNodeId,
        incidentEvidence,
      },
      mode: "initial-setup" as const,
    }),
  );
}
export function readInitialCloudRequest(context: InitialSetupContext) {
  const supplied = context.request;
  if (
    !cloudExact(supplied, [
      "version",
      "operationId",
      "venueId",
      "scope",
      "bases",
      "binding",
      "mode",
    ]) ||
    !cloudExact(supplied.binding, [
      "eventId",
      "operatorId",
      "sourceId",
      "targetNodeId",
      "incidentEvidence",
    ]) ||
    typeof supplied.venueId !== "string" ||
    typeof supplied.operationId !== "string" ||
    typeof supplied.binding.incidentEvidence !== "string"
  )
    refuse("event_mismatch");
  const expected = createInitialCloudRequest(
    context,
    supplied.venueId,
    supplied.operationId,
    supplied.binding.incidentEvidence,
  );
  if (!equal(expected, supplied)) refuse("event_mismatch");
  return expected;
}
export function isInitialCloudRequest(value: unknown): boolean {
  return (
    typeof value === "object" && value !== null && "mode" in value && value.mode === "initial-setup"
  );
}
export function prepareInitialCloudSetup(
  context: InitialSetupContext,
  input: unknown,
  evidence: { readonly trust: ReceiptTrust | null | undefined },
): InitialSetupImport {
  const request = readInitialCloudRequest(context);
  if (!cloudExact(input, ["allocation", "approval", "receipt"])) refuse();
  const receipt = readCloudAllocationReceipt(input.receipt, evidence.trust);
  if (receipt === null) refuse("reservation_untrusted");
  if (
    !equal(input.allocation, receipt.payload.allocation) ||
    !equal(input.approval, receipt.payload.approval)
  )
    refuse("reservation_mismatch");
  if (
    receipt.payload.venueId !== request.venueId ||
    (receipt.payload.allocation.reservationEvidence as { reservationId: string }).reservationId !==
      request.operationId
  )
    refuse("reservation_mismatch");
  const verified = verifyCloudAllocationEvidence(receipt, evidence.trust, {
    ...request.scope,
    mode: "initial-setup",
    ...context.binding,
    operatorId: context.administratorId,
    incidentEvidence: request.binding.incidentEvidence,
    requiredBases: context.bases,
    priorActivation: "none",
    reauthentication: { eventId: context.binding.eventId, operatorId: context.administratorId },
    authority: { kind: "cloud", trust: evidence.trust, receipt },
  });
  if (!verified.ok) refuse(verified.reason);
  if (verified.approval.oldMachineOffline !== false) refuse("old_machine_absence_unconfirmed");
  return freeze(
    structuredClone({
      input,
      summary: {
        allocationId: verified.allocation.allocationId,
        installationIdentity: verified.allocation.installationIdentity,
        series: verified.allocation.series,
        integrity: "signed-cloud",
        receiptId: receipt.payload.receiptId,
      },
    }),
  );
}

export function configuredCloudTrust(
  environment: Readonly<Record<string, string | undefined>>,
): ReceiptTrust | null {
  const path = environment.WAITRON_FISCAL_CLOUD_TRUST_FILE;
  const fingerprint = environment.WAITRON_FISCAL_CLOUD_FINGERPRINT;
  let fd: number | undefined;
  try {
    if (!path?.trim() || !fingerprint || !/^[a-f0-9]{64}$/.test(fingerprint)) return null;
    fd = openSync(path, "r");
    if (!fstatSync(fd).isFile()) return null;
    const bytes = Buffer.alloc(65537);
    let n = 0;
    while (n < bytes.length) {
      const read = readSync(fd, bytes, n, bytes.length - n, null);
      if (read === 0) break;
      n += read;
    }
    if (n > 65536) return null;
    const key: unknown = JSON.parse(bytes.subarray(0, n).toString("utf8"));
    if (
      !cloudExact(key, ["issuer", "fingerprint", "publicKey"]) ||
      key.fingerprint !== fingerprint ||
      !text(key.issuer) ||
      typeof key.publicKey !== "string"
    )
      return null;
    return { issuer: key.issuer, keys: new Map([[fingerprint, key.publicKey]]) };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
export function readInitialCloudConfirmation(value: unknown) {
  if (
    !cloudExact(value, [
      "version",
      "kind",
      "binding",
      "operatorId",
      "allocationId",
      "receiptId",
      "priorActivation",
      "incidentEvidence",
      "requiredBases",
      "delivery",
    ]) ||
    value.version !== 1 ||
    value.kind !== "cloud-initial-confirmation" ||
    !["none", "committed"].includes(value.priorActivation as string) ||
    !cloudExact(value.delivery, ["kept", "documentDigest", "historyDigest"]) ||
    value.delivery.kept !== true ||
    ![value.delivery.documentDigest, value.delivery.historyDigest].every(
      (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v),
    )
  )
    refuse("outside_confirmation_missing");
  return value;
}
export function confirmInitialCloudSetup(
  context: InitialSetupContext,
  imported: InitialSetupImport,
  statement: unknown,
  trust: ReceiptTrust | null,
) {
  const checked = prepareInitialCloudSetup(context, imported.input, { trust });
  const current = readInitialCloudConfirmation(statement);
  const request = readInitialCloudRequest(context);
  const summary = checked.summary as { allocationId: string; receiptId: string };
  const receipt = (checked.input as { receipt: unknown }).receipt;
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value !== null && typeof value === "object")
      return `{${Object.keys(value)
        .sort()
        .map(
          (key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
        )
        .join(",")}}`;
    return JSON.stringify(value);
  };
  const historyDigest = createHash("sha256")
    .update(typeof receipt === "string" ? receipt : canonical(receipt))
    .digest("hex");
  const delivery = { ...(current.delivery as Record<string, unknown>), historyDigest };
  const expected = {
    version: 1,
    kind: "cloud-initial-confirmation",
    binding: context.binding,
    operatorId: context.administratorId,
    allocationId: summary.allocationId,
    receiptId: summary.receiptId,
    priorActivation: current.priorActivation,
    incidentEvidence: request.binding.incidentEvidence,
    requiredBases: context.bases,
    delivery,
  };
  if (!equal(expected, current)) refuse("event_mismatch");
  return freeze(structuredClone(expected));
}
