import { sql, type SQL } from "drizzle-orm";
import { sales, saleSubstitutions, tenders, type BankAccount, type Transaction } from "@waitron/db";
import { readBankAccount } from "@waitron/provisioning";

/**
 * Defined when `saleId`, or a sale it replaces or substitutes (followed back through replacements
 * and substitutions, never corrections by differences), was closed as a deferred payment; carries
 * the venue's bank account as it is now.
 */
export async function readDeferredPayment(
  tx: Transaction,
  saleId: string,
): Promise<{ account: BankAccount | null } | undefined> {
  const found = await tx.execute(deferredTenderQuery(saleId));
  if (found.rows.length === 0) return undefined;
  return { account: await readBankAccount(tx) };
}

/** Exported for the test that pins its plan. */
export function deferredTenderQuery(saleId: string): SQL {
  // `union`, not `union all`: a sale already reached is not queued again, so a cycle ends.
  // `cross join` keeps the chain as the outer loop: with no planner statistics on a box, a plain
  // join scans every tender.
  return sql`
    with recursive replaced(id) as (
      select ${saleId}
      union
      select s.corrects_sale_id from ${sales} s join replaced r on s.id = r.id
        where s.replaces_original = 1 and s.corrects_sale_id is not null
      union
      select ss.substituted_sale_id from ${saleSubstitutions} ss
        join replaced r on ss.substitution_sale_id = r.id
    )
    select 1 from replaced r cross join ${tenders} t on t.sale_id = r.id
    where t.method = 'deferred' limit 1
  `;
}
