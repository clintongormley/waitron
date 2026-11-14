import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

/**
 * The ids of the correctives that change what a sale owes, as a subquery for `id in (…)`: the
 * sale's own correctives except its replacement, and the correctives of that replacement. A
 * replacement repeats the original's full amounts and the original carries the sale, so adding
 * the replacement's total would count the sale twice; a later refund corrects the replacement
 * and still changes what the original owes. Every reader summing or testing for correctives goes
 * through this (guard: `scripts/corrective-sums.test.ts`).
 */
export function correctivesOf(saleId: SQL): SQL {
  return sql`select k.id from sales k
    where (k.corrects_sale_id = ${saleId} and k.replaces_original = 0)
      or k.corrects_sale_id in
        (select r.id from sales r where r.corrects_sale_id = ${saleId} and r.replaces_original = 1)`;
}
