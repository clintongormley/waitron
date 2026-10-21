import {
  BackupCredentialReadError,
  readBackupCredential,
  resolveBackupKeyInputs,
} from "@waitron/credentials";
import { compareBackupTables } from "@waitron/db";
import {
  BackupCheckUnavailable,
  type BackupVerificationContext,
  type BackupModuleResult,
  type BackupModuleStatus,
} from "@waitron/module";
import type { BackupQuery, BackupValue } from "@waitron/store";
import { isCertKind } from "./aeat-transport.js";
import { normaliseTaxId, openCertificateFile } from "./certificate-file.js";

const TABLES = ["fiscal_certificate_installs", "fiscal_certificate_reminders"] as const;

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
function result(status: BackupModuleStatus): BackupModuleResult {
  return { status, checks: [{ code: "secret", status }] };
}

async function check(
  query: BackupQuery,
  context: BackupVerificationContext,
  inputs: Readonly<Record<string, string>>,
): Promise<BackupModuleStatus> {
  const credential = (await exists(query, "tenant_credentials"))
    ? await readBackupCredential(query, inputs, "fiscal.aeat")
    : null;
  if (credential === null) {
    if (context.sourceSchema === null || context.sourceSchema === 0) {
      let hasEvidence = false;
      for (const table of TABLES) {
        if (await exists(query, table)) {
          if (await first(query, `select 1 from "${table}" limit 1`)) hasEvidence = true;
        }
      }
      if (!hasEvidence) return "passed";
    }
    throw new BackupCheckUnavailable("secret_unavailable");
  }
  const { pfxBase64, passphrase, certKind } = credential;
  if (
    pfxBase64 === undefined ||
    passphrase === undefined ||
    certKind === undefined ||
    !isCertKind(certKind)
  )
    return "invalid";
  const pfx = Buffer.from(pfxBase64, "base64");
  if (pfx.length === 0 || pfx.toString("base64") !== pfxBase64) return "invalid";
  const opened = openCertificateFile(pfx, passphrase);
  if (!opened.ok) {
    if (opened.reason === "passphrase_wrong")
      throw new BackupCheckUnavailable("decryption_unavailable");
    return opened.reason === "old_encryption" ? "unsupported" : "invalid";
  }
  const node = await first(query, "select location_id from nodes where id=?", [
    context.source.nodeId,
  ]);
  const tenant = await first(query, "select tax_id from tenants where id=1");
  if (node?.location_id !== context.source.locationId || typeof tenant?.tax_id !== "string")
    return "invalid";
  const { details } = opened;
  if (details.taxId !== null && details.taxId !== normaliseTaxId(tenant.tax_id)) return "invalid";
  if (!(await exists(query, "fiscal_certificate_installs"))) return "invalid";
  let latest: Awaited<ReturnType<typeof first>>;
  let ambiguous = false;
  for await (const row of query.rows(
    "select * from fiscal_certificate_installs where node_id=? order by installed_at desc",
    [context.source.nodeId],
  )) {
    if (latest === undefined) latest = row;
    else if (row.installed_at === latest.installed_at) ambiguous = true;
    else break;
  }
  if (latest === undefined || ambiguous) return "invalid";
  if (
    latest.kind !== certKind ||
    latest.fingerprint !== details.fingerprint ||
    latest.organisation !== details.organisation ||
    latest.tax_id !== details.taxId ||
    latest.issuer !== details.issuer ||
    latest.valid_from !== details.validFrom.toISOString() ||
    latest.valid_until !== details.validUntil.toISOString()
  )
    return "invalid";
  return "passed";
}

export async function verifyBackupFiscalSecrets(
  context: BackupVerificationContext,
): Promise<BackupModuleResult> {
  const secretsEnv = await context.entries.read("secrets/secrets.env");
  const tradingEnv = await context.entries.read("secrets/trading.env");
  const backupEnv = await context.entries.read("secrets/backup.env");
  if (secretsEnv === null || tradingEnv === null)
    throw new BackupCheckUnavailable("secret_unavailable");
  const inputs = resolveBackupKeyInputs({ secretsEnv, tradingEnv, backupEnv });
  const statuses: BackupModuleStatus[] = [];
  for (const query of [context.before, context.after]) {
    try {
      statuses.push(await check(query, context, inputs));
    } catch (error) {
      if (!(error instanceof BackupCredentialReadError)) throw error;
      if (error.status === "unavailable")
        throw new BackupCheckUnavailable("decryption_unavailable");
      statuses.push(error.status);
    }
  }
  const preserved = await compareBackupTables({
    before: context.before,
    after: context.after,
    policies: TABLES.map((table) => ({ table, immutable: true, addedColumns: {} })),
  });
  return result(
    !preserved || statuses.includes("invalid")
      ? "invalid"
      : statuses.includes("unsupported")
        ? "unsupported"
        : "passed",
  );
}
