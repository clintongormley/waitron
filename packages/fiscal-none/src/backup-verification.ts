import type { BackupVerificationContribution } from "@waitron/module";
export const FISCAL_NONE_BACKUP_VERIFICATION: BackupVerificationContribution = {
  version: 1,
  publicEvidenceDigest: null,
  data: { kind: "database_only", tables: [], immutableTables: [], checks: ["data"] },
  secrets: [],
  entries: [],
  effects: [],
  zeroSchema: "absent_tables_and_entries",
  targetOnly: "empty_after_migration",
  async verifyRestoredData() {
    return { status: "passed", checks: [{ code: "data", status: "passed" }] };
  },
};
