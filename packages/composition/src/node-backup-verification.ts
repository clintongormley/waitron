import { NODE_CLASSIFICATION } from "@waitron/node-db";
import type { BackupVerificationContext, BackupVerificationContribution } from "@waitron/module";

const tables = NODE_CLASSIFICATION.map((entry) => entry.table);

async function holdsAny(query: BackupVerificationContext["before"]): Promise<boolean> {
  for (const table of tables) {
    for await (const row of query.rows(
      "select name from sqlite_schema where type='table' and name=?",
      [table],
    )) {
      if (row.name === table) return true;
    }
  }
  return false;
}

/**
 * node.db is in no archive yet, so the one thing checked is that neither venue copy holds one of
 * its tables: they belong to the box, never to the venue.
 */
export const NODE_BACKUP_VERIFICATION: BackupVerificationContribution = {
  version: 1,
  publicEvidenceDigest: null,
  data: { kind: "custom", tables, immutableTables: [], checks: ["data"] },
  secrets: [],
  entries: [],
  effects: [],
  zeroSchema: "absent_tables_and_entries",
  targetOnly: "empty_after_migration",
  async verifyRestoredData(context) {
    const status =
      (await holdsAny(context.before)) || (await holdsAny(context.after)) ? "invalid" : "passed";
    return { status, checks: [{ code: "data", status }] };
  },
};
