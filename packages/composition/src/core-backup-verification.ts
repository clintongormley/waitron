import { verifyBackupCloseHistory } from "@waitron/reporting";
import {
  BackupCheckUnavailable,
  type BackupModuleStatus,
  type BackupVerificationContribution,
} from "@waitron/module";
import {
  BackupCredentialReadError,
  readBackupCredential,
  resolveBackupKeyInputs,
} from "@waitron/credentials";
import {
  CORE_BACKUP_TABLE_POLICIES,
  verifyCoreBackupData,
  verifyBackupMembershipIdentity,
} from "@waitron/db";

export const CORE_BACKUP_VERIFICATION: BackupVerificationContribution = {
  version: 1,
  publicEvidenceDigest: null,
  data: {
    kind: "custom",
    tables: CORE_BACKUP_TABLE_POLICIES.map((policy) => policy.table),
    immutableTables: CORE_BACKUP_TABLE_POLICIES.filter((policy) => policy.immutable).map(
      (policy) => policy.table,
    ),
    checks: ["data", "secret"],
  },
  secrets: ["vault:membership.node_key"],
  entries: [
    { name: "secrets/secrets.env", presence: "required" },
    { name: "secrets/trading.env", presence: "required" },
    { name: "secrets/backup.env", presence: "optional" },
  ],
  effects: [
    { id: "host_series_replacement", kind: "activation", check: null },
    { id: "host_first_start", kind: "activation", check: null },
  ],
  zeroSchema: "absent_tables_and_entries",
  targetOnly: "unsupported",
  async verifyRestoredData(context) {
    const secretsEnv = await context.entries.read("secrets/secrets.env");
    const tradingEnv = await context.entries.read("secrets/trading.env");
    const backupEnv = await context.entries.read("secrets/backup.env");
    if (secretsEnv === null || tradingEnv === null)
      throw new BackupCheckUnavailable("secret_unavailable");
    const keyInputs = resolveBackupKeyInputs({ secretsEnv, tradingEnv, backupEnv });
    const data =
      (await verifyCoreBackupData({
        before: context.before,
        after: context.after,
        ...context.source,
      })) && (await verifyBackupCloseHistory(context.before, context.after))
        ? "passed"
        : "invalid";
    let secret: BackupModuleStatus;
    try {
      let hasVault = false;
      for await (const row of context.before.rows(
        "select name from sqlite_schema where type = 'table' and name = ?",
        ["tenant_credentials"],
      )) {
        hasVault = row.name === "tenant_credentials";
        break;
      }
      const credential = hasVault
        ? await readBackupCredential(context.before, keyInputs, "membership.node_key")
        : null;
      secret = (await verifyBackupMembershipIdentity({
        before: context.before,
        after: context.after,
        nodeId: context.source.nodeId,
        privateKey: credential?.privateKey ?? null,
      }))
        ? "passed"
        : "invalid";
    } catch (error) {
      if (!(error instanceof BackupCredentialReadError)) throw error;
      if (error.status === "unavailable")
        throw new BackupCheckUnavailable("decryption_unavailable");
      secret = error.status;
    }
    const status =
      secret === "unsupported"
        ? "unsupported"
        : data === "invalid" || secret === "invalid"
          ? "invalid"
          : "passed";
    return {
      status,
      checks: [
        { code: "data", status: data },
        { code: "secret", status: secret },
      ],
    };
  },
};
