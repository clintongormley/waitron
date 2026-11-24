import { sql } from "drizzle-orm";
import type { Database } from "@waitron/db";
import type { InitialSetupContribution } from "@waitron/module";

/** Setup's certificate can be discarded. The module counts later installs separately. */
export const FISCAL_START_AGAIN_DELETABLE: readonly string[] = ["verifactu_certificates"];

type Target = Pick<Database, "execute">;

async function count(db: Target, query: ReturnType<typeof sql>): Promise<number> {
  const { rows } = await db.execute<{ n: number }>(query);
  return Number(rows[0]!.n);
}

export const startAgainHoldings: NonNullable<
  InitialSetupContribution["startAgainHoldings"]
> = async (db) => {
  const records = await count(db, sql`select count(*) as n from verifactu_records`);
  try {
    const accepted = await count(
      db,
      sql`select count(*) as n from verifactu_submissions where estado in ('aceptado', 'aceptado_con_errores')`,
    );
    return { records, accepted };
  } catch (error) {
    // Any record refuses Start again whatever `accepted` says, so a failed count must not lose it;
    // `accepted` 0 here means not counted.
    if (records === 0) throw error;
    return { records, accepted: 0 };
  }
};

/** A certificate installed from the dashboard was installed after setup, so it is not the setup's. */
export const startAgainKept: NonNullable<InitialSetupContribution["startAgainKept"]> = (db) =>
  count(db, sql`select count(*) as n from verifactu_certificates where source <> 'setup'`);
