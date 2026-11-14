import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import type { Database } from "@waitron/db";
import { FISCAL_CLASSIFICATION } from "@waitron/fiscal-verifactu";
import { MODULE_PREPARATION_STATE_FILE } from "@waitron/store";

/** The fiscal module's tables and the invoice series. */
export const FISCAL_TABLES = [...FISCAL_CLASSIFICATION.map(({ table }) => table), "invoice_series"];

/** Every row of `FISCAL_TABLES` in `db`, by table, in `rowid` order. */
export async function fiscalRows(db: Database): Promise<Record<string, unknown[]>> {
  const rows: Record<string, unknown[]> = {};
  for (const table of FISCAL_TABLES)
    rows[table] = (await db.execute(sql.raw(`select * from "${table}" order by rowid`))).rows;
  return rows;
}

/** The dormant module setup a box holds in its state folder, or `null` without one. */
export async function preparationIn(stateDir: string): Promise<string | null> {
  try {
    return await readFile(join(stateDir, MODULE_PREPARATION_STATE_FILE), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
