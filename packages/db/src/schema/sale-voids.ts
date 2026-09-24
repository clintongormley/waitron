import { foreignKey, unique } from "drizzle-orm/sqlite-core";
import { id, label, newId, table, tsString } from "./columns.js";
import { sales } from "./sales.js";

/**
 * A sale is voided by APPENDING a row here, never by editing the sale: every
 * `sales` column is written once. Keeping the projection in packages/db rather
 * than deriving it from the module's annulment record is what lets a Z-report
 * answer "which sales were voided" without a cross-boundary join per row.
 */
export const saleVoids = table(
  "sale_voids",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    saleId: id("sale_id").notNull(),
    reason: label("reason").notNull(),
    // tsString rather than ts, for the reason given at `sales.issuedAt`.
    voidedAt: tsString("voided_at").notNull(),
    /** The person who authorised the void. Nullable, no FK: `persons` is in @waitron/identity's
     * migration set, not the core one. */
    voidedBy: id("voided_by"),
  },
  (t) => [
    // The database is what makes double-voiding impossible. A SELECT-then-INSERT
    // check in application code is passed by both of two concurrent
    // transactions, and the second one would chain a duplicate annulment.
    unique("sale_voids_sale_id_key").on(t.saleId),
    foreignKey({
      columns: [t.saleId],
      foreignColumns: [sales.id],
      name: "sale_voids_sale_fk",
    }).onDelete("restrict"),
  ],
);
