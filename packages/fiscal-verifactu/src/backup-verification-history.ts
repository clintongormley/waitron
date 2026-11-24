import { createHash, createPublicKey, verify } from "node:crypto";
import { isDeepStrictEqual as equal } from "node:util";
import { compareBackupTables } from "@waitron/db";
import type {
  BackupVerificationContext,
  BackupModuleResult,
  BackupModuleStatus,
} from "@waitron/module";
import type { BackupQuery, BackupRow, BackupValue } from "@waitron/store";
import { isAppError } from "@waitron/shared";
import { FISCAL_CLASSIFICATION } from "./classification.js";
import { encodeMinuteIdentity, isMinuteAllocatedSeries } from "./hour-identity.js";
import { isAllocatedSeries, matchesInstallationChecksum } from "./allocation-identity.js";
import { parseAllocationOperator } from "./allocation-operator.js";
import { readDeclaredPaperInput } from "./declared-paper-evidence.js";
import {
  parsePaperBlock,
  parsePaperConsumption,
  paperBlockBytes,
  paperConsumptionBytes,
} from "./paper-protocol.js";
import type { PaperCustodianTrust } from "./paper-evidence.js";
import { FISCAL_BACKUP_PUBLIC_TRUST } from "./backup-verification-trust.js";

const TABLES = FISCAL_CLASSIFICATION.map((row) => row.table).filter(
  (table) => table !== "verifactu_records",
);
type RecordValue = Record<string, unknown>;
function object(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exact(value: unknown, keys: readonly string[]): value is RecordValue {
  return (
    object(value) &&
    Object.keys(value).length === keys.length &&
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
function timestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
function json(value: BackupValue | undefined): unknown {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}
async function first(query: BackupQuery, sql: string, values?: readonly BackupValue[]) {
  for await (const row of query.rows(sql, values)) return row;
  return undefined;
}
async function exists(query: BackupQuery, table: string) {
  return (
    (await first(query, "select name from sqlite_schema where type='table' and name=?", [
      table,
    ])) !== undefined
  );
}
function ident(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}
const SCOPE = [
  ["nif", "taxpayerNif"],
  ["id_sistema_informatico", "softwareId"],
  ["environment", "environment"],
  ["numero_instalacion", "installationIdentity"],
  ["allocation_key", "allocationId"],
] as const;
const BINDING = ["eventId", "operatorId", "sourceId", "targetNodeId", "incidentEvidence"] as const;
function bases(value: unknown): value is { code: string; purpose: string }[] {
  return (
    Array.isArray(value) &&
    value.every((row) => exact(row, ["code", "purpose"]) && text(row.code) && text(row.purpose))
  );
}
function allocation(
  value: unknown,
): value is RecordValue & { source: string; installationIdentity: string; issuedAt: string } {
  return (
    exact(value, [
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
    ]) &&
    value.version === 1 &&
    text(value.allocationId) &&
    typeof value.taxpayerNif === "string" &&
    /^[A-Z0-9]{9}$/.test(value.taxpayerNif) &&
    typeof value.softwareId === "string" &&
    /^[A-Z0-9]{2}$/.test(value.softwareId) &&
    typeof value.environment === "string" &&
    ["preproduction", "production"].includes(value.environment) &&
    typeof value.installationIdentity === "string" &&
    typeof value.source === "string" &&
    ["hour", "cloud", "initial-paper", "paper", "emergency"].includes(value.source) &&
    timestamp(value.issuedAt)
  );
}
const APPROVAL = [
  "version",
  ...BINDING,
  "oldMachineOffline",
  "oldMachineAbsent",
  "noParallelRecovery",
  "confirmedAt",
];
function approval(value: unknown): value is RecordValue {
  // Only a relinquished promotion and an identity change write version 2, always in this shape.
  const v2 =
    exact(value, [...APPROVAL, "oldMachineRelinquished"]) &&
    value.version === 2 &&
    value.oldMachineRelinquished === true &&
    value.oldMachineAbsent === false &&
    value.oldMachineOffline === false;
  if (
    !(v2 || (exact(value, APPROVAL) && value.version === 1)) ||
    parseAllocationOperator(value.operatorId) === null ||
    !BINDING.filter((key) => key !== "operatorId").every((key) => text(value[key])) ||
    !timestamp(value.confirmedAt) ||
    typeof value.oldMachineAbsent !== "boolean" ||
    typeof value.oldMachineOffline !== "boolean" ||
    value.noParallelRecovery !== true ||
    (!value.oldMachineAbsent && !value.oldMachineOffline && !v2)
  )
    return false;
  return (
    typeof value.operatorId === "string" ||
    (object(value.operatorId) &&
      !value.oldMachineAbsent &&
      value.operatorId.nodeId === value.targetNodeId &&
      value.operatorId.eventId === value.eventId)
  );
}
function signature(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_-]{86}$/.test(value) &&
    Buffer.from(value, "base64url").toString("base64url") === value
  );
}
function digest(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}
function trustedKey(trust: PaperCustodianTrust) {
  try {
    const key = createPublicKey(trust.publicKey);
    return key.asymmetricKeyType === "ed25519" &&
      digest(key.export({ format: "der", type: "spki" })) === trust.fingerprint
      ? key
      : null;
  } catch {
    return null;
  }
}
function signedPaper(a: RecordValue, p: RecordValue): BackupModuleStatus {
  const proof = a.reservationEvidence;
  if (
    !exact(proof, ["block", "consumption"]) ||
    !exact(proof.block, ["payload", "signature"]) ||
    !exact(proof.consumption, ["payload", "signature"])
  )
    return "invalid";
  const block = parsePaperBlock(proof.block.payload),
    consumption = parsePaperConsumption(proof.consumption.payload);
  if (
    block === null ||
    consumption === null ||
    !signature(proof.block.signature) ||
    !signature(proof.consumption.signature)
  )
    return "invalid";
  const candidate = { ...a };
  Reflect.deleteProperty(candidate, "reservationEvidence");
  if (
    !block.allocations.some((entry) => equal(entry, candidate)) ||
    consumption.custodianId !== block.custodianId ||
    consumption.blockDigest !== digest(paperBlockBytes(block)) ||
    consumption.allocationId !== a.allocationId ||
    !BINDING.every((key) => equal(consumption[key], p[key]))
  )
    return "invalid";
  const trust = FISCAL_BACKUP_PUBLIC_TRUST.paper.find(
    (root) => root.custodianId === block.custodianId,
  );
  if (trust === undefined) return "unsupported";
  const key = trustedKey(trust);
  if (key === null) return "unsupported";
  if (
    !verify(null, paperBlockBytes(block), key, Buffer.from(proof.block.signature, "base64url")) ||
    !verify(
      null,
      paperConsumptionBytes(consumption),
      key,
      Buffer.from(proof.consumption.signature, "base64url"),
    )
  )
    return "invalid";
  return "passed";
}
function evidence(
  a: RecordValue & { source: string; installationIdentity: string; issuedAt: string },
  p: RecordValue,
): BackupModuleStatus {
  switch (a.source) {
    case "hour": {
      if (a.reservationEvidence !== null) return "invalid";
      try {
        return encodeMinuteIdentity(Date.parse(a.issuedAt)) === a.installationIdentity
          ? "passed"
          : "invalid";
      } catch (error) {
        if (error instanceof RangeError) return "invalid";
        throw error;
      }
    }
    case "emergency":
      // The retained checksum can be checked; the original random draw is not a public attestation.
      return !p.oldMachineAbsent &&
        exact(a.reservationEvidence, ["checksum"]) &&
        a.installationIdentity.startsWith("E") &&
        matchesInstallationChecksum(a.installationIdentity, a.reservationEvidence.checksum)
        ? "passed"
        : "invalid";
    case "cloud":
      // Activation stores the signed receipt outside this database; its reference is not a signature.
      return exact(a.reservationEvidence, [
        "kind",
        "authorityId",
        "reservationId",
        "reservationSequence",
      ]) &&
        a.reservationEvidence.kind === "cloud" &&
        text(a.reservationEvidence.authorityId) &&
        typeof a.reservationEvidence.reservationId === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          a.reservationEvidence.reservationId,
        ) &&
        typeof a.reservationEvidence.reservationSequence === "string" &&
        /^(0|[1-9][0-9]{0,77})$/.test(a.reservationEvidence.reservationSequence) &&
        a.installationIdentity.startsWith("C")
        ? "unsupported"
        : "invalid";
    default:
      if (
        (a.source === "initial-paper") !== p.oldMachineAbsent ||
        !a.installationIdentity.startsWith(a.source === "initial-paper" ? "S" : "P")
      )
        return "invalid";
      if (
        object(a.reservationEvidence) &&
        a.reservationEvidence.kind === "paper-declared-evidence"
      ) {
        // This validates captured owner-declared structure, never an outside signature or current grant.
        try {
          readDeclaredPaperInput({ allocation: a, approval: p });
          return "passed";
        } catch (error) {
          if (isAppError(error) && error.code === "sif.allocation_invalid") return "invalid";
          throw error;
        }
      }
      return signedPaper(a, p);
  }
}

async function allocationRow(query: BackupQuery, row: BackupRow): Promise<BackupModuleStatus> {
  const a = json(row.allocation),
    p = json(row.approval),
    b = json(row.bases),
    r = json(row.result);
  if (
    !allocation(a) ||
    !approval(p) ||
    (p.version === 2 && a.source !== "hour") ||
    !bases(b) ||
    !SCOPE.every(([column, key]) => row[column] === a[key]) ||
    p.eventId !== row.event_key ||
    p.targetNodeId !== row.node_id ||
    !exact(r, ["activationEventId", "sifId", "series"]) ||
    r.activationEventId !== row.event_key ||
    r.sifId !== row.id ||
    !Array.isArray(r.series) ||
    !(a.source === "hour" ? isMinuteAllocatedSeries : isAllocatedSeries)(
      a.series,
      a.installationIdentity,
      b,
    )
  )
    return "invalid";
  const declared = [];
  const ids = new Set<string>();
  for (const entry of r.series) {
    if (
      !exact(entry, ["id", "code", "purpose"]) ||
      !text(entry.id) ||
      !text(entry.code) ||
      !text(entry.purpose) ||
      ids.has(entry.id)
    )
      return "invalid";
    ids.add(entry.id);
    const actual = await first(query, "select * from invoice_series where id=?", [entry.id]);
    if (
      actual === undefined ||
      actual.node_id !== row.node_id ||
      actual.code !== entry.code ||
      actual.purpose !== entry.purpose
    )
      return "invalid";
    declared.push({ code: entry.code, purpose: entry.purpose });
  }
  if (
    !(a.source === "hour" ? isMinuteAllocatedSeries : isAllocatedSeries)(
      declared,
      a.installationIdentity,
      b,
    )
  )
    return "invalid";
  return evidence(a, p);
}

const LINKS = [
  ["returned_invoice_records", "record_id", "verifactu_records", "id"],
  ["verifactu_identities", "node_id", "nodes", "id"],
  ["verifactu_series_conflicts", "sif_id", "verifactu_identities", "id"],
  ["verifactu_series_conflicts", "series_id", "invoice_series", "id"],
  ["verifactu_submissions", "registro_id", "verifactu_records", "id"],
  ["verifactu_submissions", "case_remedy_registro_id", "verifactu_records", "id"],
  ["verifactu_submissions", "case_resolved_by", "persons", "id"],
  ["fiscal_certificate_reminders", "install_id", "verifactu_certificates", "id"],
  ["verifactu_history", "node_id", "nodes", "id"],
  ["verifactu_history", "person_id", "persons", "id"],
  ["verifactu_history", "registro_id", "verifactu_records", "id"],
] as const;
async function walk(
  query: BackupQuery,
  context: BackupVerificationContext,
): Promise<BackupModuleStatus> {
  let status: BackupModuleStatus = "passed";
  for (const [table, column, parent, key] of LINKS) {
    if (!(await exists(query, table))) continue;
    if (
      await first(
        query,
        `select 1 from ${ident(table)} c where c.${ident(column)} is not null and not exists (select 1 from ${ident(parent)} p where p.${ident(key)}=c.${ident(column)}) limit 1`,
      )
    )
      return "invalid";
  }
  if (await exists(query, "verifactu_identities"))
    for await (const row of query.rows("select * from verifactu_identities")) {
      if (
        !text(row.nif) ||
        !text(row.id_sistema_informatico) ||
        !text(row.numero_instalacion) ||
        !timestamp(row.registrado_en) ||
        (row.revocado_en !== null && !timestamp(row.revocado_en))
      )
        return "invalid";
      if (row.event_key === null) continue;
      if (row.environment !== context.source.environment) return "invalid";
      const checked = await allocationRow(query, row);
      if (checked === "invalid") return "invalid";
      if (checked === "unsupported") status = "unsupported";
    }
  return status;
}
export async function verifyBackupFiscalHistory(
  context: BackupVerificationContext,
): Promise<BackupModuleResult> {
  const before = await walk(context.before, context),
    after = await walk(context.after, context);
  const preserved = await compareBackupTables({
    before: context.before,
    after: context.after,
    policies: TABLES.map((table) => ({ table, immutable: true, addedColumns: {} })),
  });
  const status: BackupModuleStatus =
    !preserved || before === "invalid" || after === "invalid"
      ? "invalid"
      : before === "unsupported" || after === "unsupported"
        ? "unsupported"
        : "passed";
  return { status, checks: [{ code: "history", status }] };
}
