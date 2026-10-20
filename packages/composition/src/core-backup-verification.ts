import type { BackupVerificationContribution } from "@waitron/module";
import { CORE_BACKUP_TABLE_POLICIES, verifyCoreBackupData } from "@waitron/db";

export const CORE_BACKUP_VERIFICATION: BackupVerificationContribution = {
  version: 1,
  publicEvidenceDigest: null,
  data: {
    kind: "custom",
    tables: CORE_BACKUP_TABLE_POLICIES.map((policy) => policy.table),
    immutableTables: CORE_BACKUP_TABLE_POLICIES.filter((policy) => policy.immutable).map(
      (policy) => policy.table,
    ),
    checks: ["data"],
  },
  secrets: [],
  entries: [],
  effects: [
    { id: "host_series_replacement", kind: "activation", check: null },
    { id: "host_first_start", kind: "activation", check: null },
  ],
  zeroSchema: "absent_tables_and_entries",
  targetOnly: "unsupported",
  async verifyRestoredData(context) {
    const status = (await verifyCoreBackupData({
      before: context.before,
      after: context.after,
      ...context.source,
    }))
      ? "passed"
      : "invalid";
    return {
      status,
      checks: [{ code: "data", status }],
    };
  },
};
