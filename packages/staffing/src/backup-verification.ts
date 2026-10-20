import { isTable } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { compareBackupTables } from "@waitron/db";
import type { BackupModuleStatus, BackupVerificationContribution } from "@waitron/module";
import type { BackupQuery, BackupValue, BackupRow } from "@waitron/store";
import { STAFFING_CLASSIFICATION } from "./classification.js";
import * as schema from "./schema/index.js";
import { CALENDAR_COLOURS } from "@waitron/venue-service/hours-types";

const tables = STAFFING_CLASSIFICATION.map((c) => c.table);
const immutableTables: readonly string[] = [];
export const STAFFING_BACKUP_VERIFICATION: BackupVerificationContribution = {
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
    const sourceValid = await checkData(context.before);
    const restoredValid = await checkData(context.after);
    const status =
      equal && sourceValid === "passed" && restoredValid === "passed" ? "passed" : "invalid";
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

function integer(value: BackupValue | undefined, min: bigint, max: bigint): boolean {
  return typeof value === "bigint" && value >= min && value <= max;
}
function time(value: BackupValue | undefined): boolean {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):(?:00|15|30|45)(?::00)?$/.test(value);
}
function rowValid(table: string, row: BackupRow): boolean {
  if (table === "staff_roles")
    return (
      typeof row.name === "string" &&
      row.name.trim().length > 0 &&
      typeof row.colour === "string" &&
      (CALENDAR_COLOURS as readonly string[]).includes(row.colour) &&
      typeof row.position === "bigint"
    );
  if (table === "staffing_days")
    return (
      (row.department_id === null) !== (row.station_id === null) &&
      (row.season_id === null) !== (row.special_day_date_id === null) &&
      (row.season_id === null ? row.weekday === null : integer(row.weekday, 0n, 6n))
    );
  if (table === "staffing_blocks")
    return (
      integer(row.headcount, 1n, 50n) &&
      time(row.starts_at) &&
      time(row.ends_at) &&
      row.starts_at !== row.ends_at
    );
  if (table === "shift_assignments")
    return (row.department_id === null) !== (row.station_id === null);
  return true;
}
async function checkData(query: BackupQuery): Promise<BackupModuleStatus> {
  let valid = await referencesValid(query);
  for (const table of tables) {
    if (!(await hasTable(query, table))) continue;
    for await (const row of query.rows(`select * from ${ident(table)}`))
      valid = rowValid(table, row) && valid;
  }
  return valid ? "passed" : "invalid";
}
