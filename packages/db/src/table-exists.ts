import { sql } from "drizzle-orm";
import type { Database } from "./client.js";

/** Probe the schema without treating an absent optional table as a query error. */
export async function tableExists(db: Pick<Database, "execute">, name: string): Promise<boolean> {
  const result = await db.execute<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' and name = ${name}`,
  );
  return result.rows.length > 0;
}
