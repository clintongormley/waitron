import { isTable } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { compareBackupTables } from "@waitron/db";
import type { BackupVerificationContribution } from "@waitron/module";
import type { BackupQuery, BackupValue } from "@waitron/store";
import { ADJUSTMENTS_CLASSIFICATION } from "./classification.js";
import * as schema from "./schema/index.js";

const tables = ADJUSTMENTS_CLASSIFICATION.map((c) => c.table);
const immutableTables = ["adjustments"];
export const ADJUSTMENTS_BACKUP_VERIFICATION: BackupVerificationContribution = {
  version: 1,
  publicEvidenceDigest: null,
  data: { kind: "custom", tables, immutableTables, checks: ["data"] },
  secrets: [],
  entries: [],
  effects: [],
  zeroSchema: "absent_tables_and_entries",
  targetOnly: "empty_after_migration",
  async verifyRestoredData(context) {
    if (context.sourceSchema === 0) {
      for (const table of tables) {
        if (await hasTable(context.before, table))
          return { status: "invalid", checks: [{ code: "data", status: "invalid" }] };
      }
    }
    const equal = await compareBackupTables({
      before: context.before,
      after: context.after,
      policies: tables.map((table) => ({
        table,
        immutable: immutableTables.includes(table),
        addedColumns: {},
      })),
    });
    const sourceValid = await referencesValid(context.before);
    const restoredValid = await referencesValid(context.after);
    const status = equal && sourceValid && restoredValid ? "passed" : "invalid";
    return { status, checks: [{ code: "data", status }] };
  },
};
function ident(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}
async function first(query: BackupQuery, statement: string, values: readonly BackupValue[] = []) {
  for await (const row of query.rows(statement, values)) return row;
  return undefined;
}
async function hasTable(query: BackupQuery, table: string): Promise<boolean> {
  return (
    (await first(query, "select name from sqlite_schema where type='table' and name=?", [
      table,
    ])) !== undefined
  );
}
async function referencesValid(query: BackupQuery): Promise<boolean> {
  for (const value of Object.values(schema)) {
    if (!isTable(value)) continue;
    const config = getTableConfig(value);
    if (!(await hasTable(query, config.name))) continue;
    for (const key of config.foreignKeys) {
      const { columns, foreignColumns, foreignTable } = key.reference();
      const present = columns.map((c) => `child.${ident(c.name)} is not null`).join(" and ");
      const parent = getTableConfig(foreignTable).name;
      if (!(await hasTable(query, parent))) {
        if (
          await first(query, `select 1 from ${ident(config.name)} child where ${present} limit 1`)
        )
          return false;
        continue;
      }
      const match = columns
        .map((c, i) => `parent.${ident(foreignColumns[i]!.name)}=child.${ident(c.name)}`)
        .join(" and ");
      if (
        await first(
          query,
          `select 1 from ${ident(config.name)} child where ${present} and not exists (select 1 from ${ident(parent)} parent where ${match}) limit 1`,
        )
      )
        return false;
    }
  }
  return true;
}
