import { sql } from "drizzle-orm";
import type { Database } from "@waitron/db";
import type { InitialSetupContribution } from "@waitron/module";

/** Must equal the append-only tables a first-setup activation writes. */
export const FISCAL_START_AGAIN_DELETABLE: readonly string[] = ["fiscal_allocations"];

type Target = Pick<Database, "execute">;

async function count(db: Target, query: ReturnType<typeof sql>): Promise<number> {
  const { rows } = await db.execute<{ n: number }>(query);
  return Number(rows[0]!.n);
}

// A missing table throws "no such table" here, so a damaged database is never read as holding nothing.
export const startAgainHoldings: NonNullable<
  InitialSetupContribution["startAgainHoldings"]
> = async (db) => ({
  records: await count(db, sql`select count(*) as n from registros_facturacion`),
  accepted: await count(
    db,
    sql`select count(*) as n from envios where estado in ('aceptado', 'aceptado_con_errores')`,
  ),
});
