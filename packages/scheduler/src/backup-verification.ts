import { compareBackupTables } from "@waitron/db";
import type { BackupVerificationContribution } from "@waitron/module";
import { SCHEDULER_CLASSIFICATION } from "./classification.js";

const tables = SCHEDULER_CLASSIFICATION.map((entry) => entry.table);
export const SCHEDULER_BACKUP_VERIFICATION: BackupVerificationContribution = {
  version: 1,
  publicEvidenceDigest: null,
  data: { kind: "custom", tables, immutableTables: [], checks: ["data"] },
  secrets: [],
  entries: [],
  effects: [],
  zeroSchema: "absent_tables_and_entries",
  targetOnly: "empty_after_migration",
  async verifyRestoredData(context) {
    for (const table of tables) {
      let present = false;
      for await (const row of context.before.rows(
        "select name from sqlite_schema where type='table' and name=?",
        [table],
      )) {
        present = row.name === table;
        break;
      }
      if (present !== (context.sourceSchema !== 0 && context.sourceSchema !== null))
        return { status: "invalid", checks: [{ code: "data", status: "invalid" }] };
    }
    const same = await compareBackupTables({
      before: context.before,
      after: context.after,
      policies: tables.map((table) => ({ table, immutable: false, addedColumns: {} })),
    });
    const status = same ? "passed" : "invalid";
    return { status, checks: [{ code: "data", status }] };
  },
};
