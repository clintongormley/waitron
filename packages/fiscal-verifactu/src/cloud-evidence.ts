import { createHash, createPublicKey, verify } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { parseAllocationOperator } from "./allocation-operator.js";
import { isAllocatedSeries } from "./allocation-identity.js";
import {
  validateAllocationEnvelope,
  type AllocationContext,
  type AllocationValidation,
  type FiscalAllocation,
  type RecoveryApproval,
} from "./allocation-envelope.js";

export interface ReceiptTrust {
  readonly issuer: string;
  readonly keys: ReadonlyMap<string, string>;
}

export interface CloudAllocationReceipt {
  readonly payload: {
    readonly version: 1;
    readonly issuer: string;
    readonly receiptId: string;
    readonly state: "reserved" | "consumed" | "abandoned";
    readonly allocation: FiscalAllocation;
    readonly binding: Pick<
      RecoveryApproval,
      "eventId" | "operatorId" | "sourceId" | "targetNodeId" | "incidentEvidence"
    >;
    readonly mode: "initial-setup" | "recovery";
    readonly approval: RecoveryApproval | null;
    readonly cloudAccountId: string;
    readonly venueId: string;
    readonly custodyVersion: string;
    readonly entitlementVersion: string;
    readonly continuity: {
      readonly authorityId: string;
      readonly scope: Pick<FiscalAllocation, "taxpayerNif" | "softwareId" | "environment">;
      readonly sequence: string;
      readonly cHighWater: number;
      readonly historyDigest: string;
      readonly writerFence: string;
      readonly requestNonce: string;
      readonly observedAt: string;
      readonly keyId: string;
      readonly signature: string;
    };
    readonly recordedAt: string;
  };
  readonly keyId: string;
  readonly signature: string;
}

const PREFIX = "WAITRON-FISCAL-ALLOCATION-1:";
const BINDING = ["eventId", "operatorId", "sourceId", "targetNodeId", "incidentEvidence"];

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype &&
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

function timestamp(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function uuid(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  );
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function decimal(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9][0-9]{0,77})$/.test(value);
}

function encoded(value: unknown, size?: number): value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  const bytes = Buffer.from(value, "base64url");
  return bytes.toString("base64url") === value && (size === undefined || bytes.length === size);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null)
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function binding(value: unknown): value is CloudAllocationReceipt["payload"]["binding"] {
  return (
    exact(value, BINDING) &&
    BINDING.filter((key) => key !== "operatorId").every((key) => text(value[key])) &&
    parseAllocationOperator(value.operatorId) !== null
  );
}

function scope(value: unknown): value is CloudAllocationReceipt["payload"]["continuity"]["scope"] {
  return (
    exact(value, ["taxpayerNif", "softwareId", "environment"]) &&
    typeof value.taxpayerNif === "string" &&
    /^[A-Z0-9]{9}$/.test(value.taxpayerNif) &&
    typeof value.softwareId === "string" &&
    /^[A-Z0-9]{2}$/.test(value.softwareId) &&
    (value.environment === "preproduction" || value.environment === "production")
  );
}

function allocation(value: unknown): value is FiscalAllocation {
  if (
    !exact(value, [
      "version",
      "allocationId",
      "taxpayerNif",
      "softwareId",
      "environment",
      "installationIdentity",
      "series",
      "source",
      "reservationEvidence",
      "issuedAt",
    ]) ||
    value.version !== 1 ||
    !uuid(value.allocationId) ||
    !scope({
      taxpayerNif: value.taxpayerNif,
      softwareId: value.softwareId,
      environment: value.environment,
    }) ||
    value.source !== "cloud" ||
    typeof value.installationIdentity !== "string" ||
    !/^C[0-9]{6}$/.test(value.installationIdentity) ||
    !timestamp(value.issuedAt) ||
    !Array.isArray(value.series) ||
    value.series.length > 20 ||
    !value.series.every(
      (row: unknown) =>
        exact(row, ["code", "purpose"]) &&
        typeof row.code === "string" &&
        typeof row.purpose === "string",
    ) ||
    !exact(value.reservationEvidence, [
      "kind",
      "authorityId",
      "reservationId",
      "reservationSequence",
    ])
  )
    return false;
  const items = value.series as { code: string; purpose: string }[];
  const suffix = `-${value.installationIdentity}`;
  const reference = value.reservationEvidence;
  return (
    items.every((row) => row.code.endsWith(suffix)) &&
    isAllocatedSeries(
      items,
      value.installationIdentity,
      items.map((row) => ({ code: row.code.slice(0, -suffix.length), purpose: row.purpose })),
    ) &&
    reference.kind === "cloud" &&
    text(reference.authorityId) &&
    uuid(reference.reservationId) &&
    decimal(reference.reservationSequence)
  );
}

function payload(value: unknown): value is CloudAllocationReceipt["payload"] {
  if (
    !exact(value, [
      "version",
      "issuer",
      "receiptId",
      "state",
      "allocation",
      "binding",
      "mode",
      "approval",
      "cloudAccountId",
      "venueId",
      "custodyVersion",
      "entitlementVersion",
      "continuity",
      "recordedAt",
    ]) ||
    value.version !== 1 ||
    !text(value.issuer) ||
    !uuid(value.receiptId) ||
    !["reserved", "consumed", "abandoned"].includes(value.state as string) ||
    !["initial-setup", "recovery"].includes(value.mode as string) ||
    !allocation(value.allocation) ||
    !binding(value.binding) ||
    !uuid(value.cloudAccountId) ||
    !uuid(value.venueId) ||
    !text(value.custodyVersion) ||
    !text(value.entitlementVersion) ||
    !timestamp(value.recordedAt)
  )
    return false;
  const witness = value.continuity;
  if (
    !exact(witness, [
      "authorityId",
      "scope",
      "sequence",
      "cHighWater",
      "historyDigest",
      "writerFence",
      "requestNonce",
      "observedAt",
      "keyId",
      "signature",
    ]) ||
    !text(witness.authorityId) ||
    !scope(witness.scope) ||
    !decimal(witness.sequence) ||
    !Number.isSafeInteger(witness.cHighWater) ||
    Number(witness.cHighWater) > 999999 ||
    Number(witness.cHighWater) < Number(value.allocation.installationIdentity.slice(1)) ||
    !digest(witness.historyDigest) ||
    !decimal(witness.writerFence) ||
    !text(witness.requestNonce) ||
    !timestamp(witness.observedAt) ||
    !digest(witness.keyId) ||
    !encoded(witness.signature, 64) ||
    !isDeepStrictEqual(witness.scope, {
      taxpayerNif: value.allocation.taxpayerNif,
      softwareId: value.allocation.softwareId,
      environment: value.allocation.environment,
    })
  )
    return false;
  const reference = value.allocation.reservationEvidence as {
    authorityId: string;
    reservationSequence: string;
  };
  if (
    reference.authorityId !== witness.authorityId ||
    BigInt(reference.reservationSequence) > BigInt(witness.sequence)
  )
    return false;
  if (value.state !== "consumed") return value.approval === null;
  const approval = value.approval;
  const heldBinding = value.binding;
  return (
    exact(approval, [
      "version",
      ...BINDING,
      "oldMachineOffline",
      "oldMachineAbsent",
      "noParallelRecovery",
      "confirmedAt",
    ]) &&
    approval.version === 1 &&
    approval.noParallelRecovery === true &&
    typeof approval.oldMachineOffline === "boolean" &&
    typeof approval.oldMachineAbsent === "boolean" &&
    timestamp(approval.confirmedAt) &&
    BINDING.every((key) =>
      isDeepStrictEqual(approval[key], heldBinding[key as keyof typeof heldBinding]),
    ) &&
    (value.mode === "initial-setup"
      ? approval.oldMachineAbsent
      : approval.oldMachineOffline && !approval.oldMachineAbsent)
  );
}

function freeze(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  for (const child of Object.values(value)) freeze(child);
  Object.freeze(value);
}

// A retained signed receipt proves its recorded snapshot, not current selling authority or a lease.
export function readCloudAllocationReceipt(
  supplied: unknown,
  trust: ReceiptTrust | null | undefined,
): CloudAllocationReceipt | null {
  try {
    if (!trust) return null;
    let value = supplied;
    if (typeof value === "string") {
      if (
        !value.startsWith(PREFIX) ||
        Buffer.byteLength(value) > 12288 ||
        !encoded(value.slice(PREFIX.length))
      )
        return null;
      value = JSON.parse(
        Buffer.from(value.slice(PREFIX.length), "base64url").toString("utf8"),
      ) as unknown;
      if (PREFIX + Buffer.from(canonical(value)).toString("base64url") !== supplied) return null;
    }
    if (
      !exact(value, ["payload", "keyId", "signature"]) ||
      !payload(value.payload) ||
      !digest(value.keyId) ||
      !encoded(value.signature, 64)
    )
      return null;
    if (
      PREFIX.length + Buffer.byteLength(Buffer.from(canonical(value)).toString("base64url")) >
        12288 ||
      value.payload.issuer !== trust.issuer
    )
      return null;
    const publicKey = trust.keys.get(value.keyId);
    if (!encoded(publicKey)) return null;
    const bytes = Buffer.from(publicKey, "base64url");
    const key = createPublicKey({ key: bytes, type: "spki", format: "der" });
    if (
      key.asymmetricKeyType !== "ed25519" ||
      !key.export({ type: "spki", format: "der" }).equals(bytes) ||
      createHash("sha256").update(bytes).digest("hex") !== value.keyId ||
      !verify(
        null,
        Buffer.from(
          canonical(["waitron.fiscal-allocation-receipt", 1, value.keyId, value.payload]),
        ),
        key,
        Buffer.from(value.signature, "base64url"),
      )
    )
      return null;
    const held = structuredClone(value) as unknown as CloudAllocationReceipt;
    freeze(held);
    return held;
  } catch {
    return null;
  }
}

export function verifyCloudAllocationEvidence(
  receipt: unknown,
  trust: ReceiptTrust | null | undefined,
  context: AllocationContext,
): AllocationValidation {
  const verified = readCloudAllocationReceipt(receipt, trust);
  if (!verified) return { ok: false, reason: "reservation_untrusted" };
  if (verified.payload.state !== "consumed")
    return {
      ok: false,
      reason:
        verified.payload.state === "reserved"
          ? "reservation_not_consumed"
          : "reservation_abandoned",
    };
  return validateAllocationEnvelope(verified.payload.allocation, verified.payload.approval, {
    ...context,
    authority: { kind: "cloud", trust, receipt: verified },
  });
}
