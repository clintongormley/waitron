import { isTable } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { compareBackupTables } from "@waitron/db";
import type { BackupModuleStatus, BackupVerificationContribution } from "@waitron/module";
import type { BackupQuery, BackupValue, BackupRow } from "@waitron/store";
import { WORKFORCE_ES_CLASSIFICATION } from "./classification.js";
import * as schema from "./schema/index.js";

const tables = WORKFORCE_ES_CLASSIFICATION.map((c) => c.table);
const immutableTables: readonly string[] = [];
export const WORKFORCE_ES_BACKUP_VERIFICATION: BackupVerificationContribution = {
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
      sourceValid === "unsupported" || restoredValid === "unsupported"
        ? "unsupported"
        : equal && sourceValid === "passed" && restoredValid === "passed"
          ? "passed"
          : "invalid";
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

const requiredIntegers = [
  "working_days_per_week",
  "max_weekly_minutes",
  "min_inter_shift_rest_minutes",
  "max_ordinary_daily_minutes",
  "break_threshold_minutes",
  "min_break_minutes",
  "weekly_rest_minutes",
  "annual_overtime_cap_hours",
  "night_window_start_minute",
  "night_window_end_minute",
];
const optionalIntegers = [
  "reference_period_days",
  "compensation_window_days",
  "daily_target_minutes",
  "night_premium_pct",
  "split_shift_premium",
];
function rowValid(row: BackupRow): boolean {
  return (
    requiredIntegers.every((name) => typeof row[name] === "bigint") &&
    optionalIntegers.every((name) => row[name] === null || typeof row[name] === "bigint") &&
    typeof row.working_days_per_week === "bigint" &&
    row.working_days_per_week >= 1n &&
    row.working_days_per_week <= 7n &&
    (row.breaks_count_as_worked === 0n || row.breaks_count_as_worked === 1n) &&
    typeof row.created_at === "string" &&
    Number.isFinite(Date.parse(row.created_at))
  );
}
async function checkData(query: BackupQuery): Promise<BackupModuleStatus> {
  const references = await referencesValid(query);
  if (!(await hasTable(query, "convenio_config"))) return references ? "passed" : "invalid";
  let valid = references;
  let unsupported = false;
  for await (const row of query.rows("select * from convenio_config")) {
    valid = rowValid(row) && valid;
    if (typeof row.overtime_model !== "string") valid = false;
    else if (row.overtime_model !== "daily_accrual" && row.overtime_model !== "period_net")
      unsupported = true;
  }
  return unsupported ? "unsupported" : valid ? "passed" : "invalid";
}
