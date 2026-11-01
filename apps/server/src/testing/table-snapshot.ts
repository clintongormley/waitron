import { sql } from "drizzle-orm";
import type { Database } from "@waitron/db";

/** Every row of every table in one database file, by table name, for a before-and-after compare. */
export async function tableSnapshot(
  db: Database,
  except: readonly string[] = [],
): Promise<Record<string, unknown[]>> {
  const tables = await db.execute<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' order by name`,
  );
  const snapshot: Record<string, unknown[]> = {};
  for (const { name } of tables.rows) {
    if (except.includes(name)) continue;
    snapshot[name] = (
      await db.execute(sql.raw(`select * from "${name.replaceAll('"', '""')}" order by rowid`))
    ).rows;
  }
  return snapshot;
}
