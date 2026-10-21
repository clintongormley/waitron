import { compareBackupTables } from "@waitron/db";
import {
  CREDENTIALS_BACKUP_POLICY,
  resolveBackupKeyInputs,
  verifyBackupCredentials,
} from "@waitron/credentials";
import { BackupCheckUnavailable, type BackupVerificationContribution } from "@waitron/module";

export const CREDENTIALS_BACKUP_VERIFICATION: BackupVerificationContribution = {
  ...CREDENTIALS_BACKUP_POLICY,
  async verifyRestoredData(context) {
    const secretsEnv = await context.entries.read("secrets/secrets.env");
    const tradingEnv = await context.entries.read("secrets/trading.env");
    const backupEnv = await context.entries.read("secrets/backup.env");
    if (secretsEnv === null || tradingEnv === null)
      throw new BackupCheckUnavailable("secret_unavailable");
    const inputs = resolveBackupKeyInputs({ secretsEnv, tradingEnv, backupEnv });
    const data = (await compareBackupTables({
      before: context.before,
      after: context.after,
      policies: [{ table: "tenant_credentials", immutable: false, addedColumns: {} }],
    }))
      ? "passed"
      : "invalid";
    const original = await verifyBackupCredentials(context.before, inputs);
    const restored = await verifyBackupCredentials(context.after, inputs);
    if (original === "unavailable" || restored === "unavailable")
      throw new BackupCheckUnavailable("decryption_unavailable");
    const secret =
      original === "unsupported" || restored === "unsupported"
        ? "unsupported"
        : original === "invalid" || restored === "invalid"
          ? "invalid"
          : "passed";
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
