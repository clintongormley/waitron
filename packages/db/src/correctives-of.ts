import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

/**
 * A condition true when the `sales` row the caller names `corrective` is one of the correctives
 * that change what the sale `saleId` owes: the sale's own correctives except its replacement, and
 * the correctives of that replacement. A replacement repeats the original's full amounts and the
 * original carries the sale, so adding the replacement's total would count the sale twice; a later
 * refund corrects the replacement and still changes what the original owes. Guard, with the lines
 * it allows to read correctives directly: `scripts/corrective-sums.test.ts`.
 *
 * A condition on the caller's row rather than a list of ids: SQLite plans an id list with an extra
 * look-up by id for every corrective. The condition is NULL, not false, for a row that corrects
 * nothing: never negate it.
 */
export function correctivesOf(corrective: SQL, saleId: SQL): SQL {
  return sql`((${corrective}.corrects_sale_id = ${saleId} and ${corrective}.replaces_original = 0)
      or ${corrective}.corrects_sale_id in
        (select correctives_of_r.id from sales correctives_of_r
          where correctives_of_r.corrects_sale_id = ${saleId} and correctives_of_r.replaces_original = 1))`;
}
