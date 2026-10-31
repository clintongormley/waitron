import { DatabaseSync } from "node:sqlite";
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

function opensAsDatabase(bytes: Uint8Array | null): boolean {
  if (bytes === null) return false;
  const database = new DatabaseSync(":memory:");
  try {
    database.deserialize(bytes);
    database.prepare("select count(*) from sqlite_schema").get();
    return true;
  } catch {
    return false;
  } finally {
    database.close();
  }
}

/**
 * The archive's node.dump must open as a database, and neither venue copy may hold one of
 * node.db's tables: they belong to the box, never to the venue.
 */
export const NODE_BACKUP_VERIFICATION: BackupVerificationContribution = {
  version: 1,
  publicEvidenceDigest: null,
  data: { kind: "custom", tables, immutableTables: [], checks: ["data"] },
  secrets: [],
  entries: [{ name: "node.dump", presence: "required" }],
  effects: [],
  zeroSchema: "absent_tables_and_entries",
  targetOnly: "empty_after_migration",
  async verifyRestoredData(context) {
    const status =
      !opensAsDatabase(await context.entries.read("node.dump")) ||
      (await holdsAny(context.before)) ||
      (await holdsAny(context.after))
        ? "invalid"
        : "passed";
    return { status, checks: [{ code: "data", status }] };
  },
};
