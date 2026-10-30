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

export const startAgainHoldings: NonNullable<
  InitialSetupContribution["startAgainHoldings"]
> = async (db) => {
  const records = await count(db, sql`select count(*) as n from registros_facturacion`);
  try {
    const accepted = await count(
      db,
      sql`select count(*) as n from envios where estado in ('aceptado', 'aceptado_con_errores')`,
    );
    return { records, accepted };
  } catch (error) {
    // Any record refuses Start again whatever `accepted` says, so a failed count must not lose it.
    if (records === 0) throw error;
    return { records, accepted: 0 };
  }
};
