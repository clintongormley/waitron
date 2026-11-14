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
  return sql`select correctives_of_k.id from sales correctives_of_k
    where (correctives_of_k.corrects_sale_id = ${saleId} and correctives_of_k.replaces_original = 0)
      or correctives_of_k.corrects_sale_id in
        (select correctives_of_r.id from sales correctives_of_r
          where correctives_of_r.corrects_sale_id = ${saleId} and correctives_of_r.replaces_original = 1)`;
}
