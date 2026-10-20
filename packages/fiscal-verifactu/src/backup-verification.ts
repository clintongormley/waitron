import type {
  BackupModuleStatus,
  BackupVerificationContext,
  BackupVerificationContribution,
} from "@waitron/module";
import type { BackupQuery, BackupRow, BackupValue } from "@waitron/store";
import { isAppError } from "@waitron/shared";
import { FISCAL_CLASSIFICATION } from "./classification.js";
import { fiscalBackupPublicEvidenceDigest } from "./backup-verification-trust.js";
import { verifyBackupFiscalChains } from "./backup-verification-chain.js";
import { verifyBackupFiscalHistory } from "./backup-verification-history.js";
import { verifyBackupFiscalSecrets } from "./backup-verification-secrets.js";
import { FISCAL_HOUR_BACKUP_STATE } from "./hour-backup-state.js";
import { projectHourHistory, type HourHistorySource } from "./hour-history.js";
import { isHourIdentity } from "./hour-identity.js";

const HISTORY_ENTRY = "secrets/module-evidence/fiscal-verifactu/hour-history.json";
async function rows(query: BackupQuery, table: string): Promise<BackupRow[]> {
  let present = false;
  for await (const row of query.rows(
    "select name from sqlite_schema where type='table' and name=?",
    [table],
  ))
    present = row.name === table;
  if (!present) return [];
  const result: BackupRow[] = [];
  for await (const row of query.rows(`select * from "${table.replaceAll('"', '""')}"`))
    result.push(row);
  return result;
}
function time(...values: (BackupValue | undefined)[]): number | null {
  const present = values.filter((value) => value !== null);
  return present.length === 0
    ? null
    : Math.max(...present.map((value) => (typeof value === "string" ? Date.parse(value) : NaN)));
}
function json(value: BackupValue | undefined): Record<string, unknown> | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}
async function storedSource(
  query: BackupQuery,
  context: BackupVerificationContext,
): Promise<HourHistorySource> {
  const sifs = await rows(query, "registro_sif");
  const series = await rows(query, "invoice_series");
  const allocations = await rows(query, "fiscal_allocations");
  const reservations = await rows(query, "fiscal_reservations");
  let complete = true;
  const records: unknown[] = [];
  for (const row of sifs)
    records.push({
      reference: `registro_sif/${row.id}`,
      kind: "activation",
      taxpayerNif: row.nif,
      environment: context.source.environment,
      softwareId: row.id_sistema_informatico,
      nodeId: row.node_id,
      identity: row.numero_instalacion,
      recordedAtMs: time(row.registrado_en, row.revocado_en),
    });
  for (const row of series) {
    const matches = sifs.filter(
      (sif) =>
        row.node_id === sif.node_id &&
        typeof row.code === "string" &&
        typeof sif.numero_instalacion === "string" &&
        row.code.endsWith(`-${sif.numero_instalacion}`),
    );
    if (matches.length !== 1) complete = false;
    const sif = matches[0];
    records.push({
      reference: `invoice_series/${row.id}`,
      kind: "series",
      taxpayerNif: sif?.nif,
      environment: context.source.environment,
      softwareId: sif?.id_sistema_informatico,
      nodeId: row.node_id,
      identity: sif?.numero_instalacion,
      recordedAtMs: time(row.retired_at),
    });
  }
  for (const row of allocations) {
    const allocation = json(row.allocation),
      approval = json(row.approval);
    if (allocation === null || approval === null) complete = false;
    records.push({
      reference: `fiscal_allocations/${row.event_key}`,
      kind: "intent",
      taxpayerNif: row.taxpayer_nif,
      environment: row.environment,
      softwareId: row.software_id,
      nodeId: row.node_id,
      identity: row.installation_identity,
      recordedAtMs: time(
        row.activated_at,
        typeof allocation?.issuedAt === "string" ? allocation.issuedAt : undefined,
        typeof approval?.confirmedAt === "string" ? approval.confirmedAt : undefined,
      ),
    });
  }
  for (const row of reservations)
    records.push({
      reference: `fiscal_reservations/${row.event_key}`,
      kind: "reservation",
      taxpayerNif: row.taxpayer_nif,
      environment: row.environment,
      softwareId: row.software_id,
      nodeId: row.node_id,
      identity: row.installation_identity,
      recordedAtMs: time(row.established_at),
    });
  return { reference: "venue", complete, records };
}
function projected(sources: readonly HourHistorySource[]): BackupModuleStatus {
  const scopes = new Map<
    string,
    { taxpayerNif: string; environment: "preproduction" | "production" }
  >();
  scopes.set("empty", { taxpayerNif: "validation", environment: "preproduction" });
  for (const source of sources)
    for (const value of source.records) {
      if (value === null || typeof value !== "object") return "invalid";
      const row = value as Record<string, unknown>;
      if (typeof row.identity === "string" && !isHourIdentity(row.identity)) return "unsupported";
      if (
        typeof row.taxpayerNif === "string" &&
        (row.environment === "production" || row.environment === "preproduction")
      ) {
        scopes.set(JSON.stringify([row.taxpayerNif, row.environment]), {
          taxpayerNif: row.taxpayerNif,
          environment: row.environment,
        });
      }
    }
  for (const scope of scopes.values())
    if (projectHourHistory({ scope, sources }).contradictions.length > 0) return "invalid";
  return "passed";
}
async function hourHistory(context: BackupVerificationContext): Promise<BackupModuleStatus> {
  const entry = await context.entries.read(HISTORY_ENTRY);
  const retained: HourHistorySource[] = [];
  if (entry !== null) {
    if (context.sourceSchema === null || context.sourceSchema === 0) return "invalid";
    let value: unknown;
    try {
      value = JSON.parse(Buffer.from(entry).toString("utf8"));
    } catch (error) {
      if (error instanceof SyntaxError) return "invalid";
      throw error;
    }
    if (FISCAL_HOUR_BACKUP_STATE.kind !== "preparation-history") return "unsupported";
    try {
      retained.push(
        FISCAL_HOUR_BACKUP_STATE.project({
          preparations: [],
          retained: [value],
        }) as HourHistorySource,
      );
    } catch (error) {
      if (isAppError(error) && error.code === "sif.allocation_invalid") return "invalid";
      throw error;
    }
  }
  const beforeSource = await storedSource(context.before, context);
  const afterSource = await storedSource(context.after, context);
  if (
    (context.sourceSchema === null || context.sourceSchema === 0) &&
    (beforeSource.records.length > 0 || afterSource.records.length > 0)
  )
    return "invalid";
  const before = projected([beforeSource, ...retained]);
  const after = projected([afterSource, ...retained]);
  return before === "invalid" || after === "invalid"
    ? "invalid"
    : before === "unsupported" || after === "unsupported"
      ? "unsupported"
      : "passed";
}

export const FISCAL_BACKUP_VERIFICATION: BackupVerificationContribution = {
  version: 1,
  publicEvidenceDigest: fiscalBackupPublicEvidenceDigest(),
  data: {
    kind: "custom",
    tables: FISCAL_CLASSIFICATION.map((v) => v.table),
    immutableTables: FISCAL_CLASSIFICATION.map((v) => v.table),
    checks: ["chain", "history", "secret", "entries"],
  },
  secrets: ["vault:fiscal.aeat"],
  entries: [
    { name: "secrets/secrets.env", presence: "required" },
    { name: "secrets/trading.env", presence: "required" },
    { name: "secrets/backup.env", presence: "optional" },
    { name: "secrets/module-evidence/fiscal-verifactu/hour-history.json", presence: "optional" },
  ],
  effects: [
    { id: "captured_full_chain", kind: "data", check: "chain" },
    { id: "captured_fiscal_state", kind: "data", check: "history" },
    { id: "captured_certificate", kind: "data", check: "secret" },
    { id: "captured_hour_history", kind: "data", check: "entries" },
    { id: "fresh_installation_identity", kind: "activation", check: null },
    { id: "fresh_invoice_series", kind: "activation", check: null },
    { id: "fresh_registration", kind: "activation", check: null },
    { id: "standby_promotion", kind: "activation", check: null },
  ],
  zeroSchema: "absent_tables_and_entries",
  targetOnly: "unsupported",
  async verifyRestoredData(context) {
    const chain: BackupModuleStatus = (await verifyBackupFiscalChains(
      context.before,
      context.after,
    ))
      ? "passed"
      : "invalid";
    const history = await verifyBackupFiscalHistory(context);
    const secret = await verifyBackupFiscalSecrets(context);
    const entries = await hourHistory(context);
    const checks = [
      { code: "chain" as const, status: chain },
      { code: "history" as const, status: history.status },
      { code: "secret" as const, status: secret.status },
      { code: "entries" as const, status: entries },
    ];
    const status: BackupModuleStatus = checks.some((v) => v.status === "unsupported")
      ? "unsupported"
      : checks.some((v) => v.status === "needs_authority")
        ? "needs_authority"
        : checks.some((v) => v.status === "invalid")
          ? "invalid"
          : "passed";
    return { status, checks };
  },
};
