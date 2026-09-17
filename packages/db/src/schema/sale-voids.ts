import { foreignKey, unique } from "drizzle-orm/pg-core";
import { id, label, table, tsString } from "./columns.js";
import { sales } from "./sales.js";

/**
 * A sale is voided by APPENDING a row here, never by editing the sale.
 *
 * `sales` has UPDATE and DELETE revoked from the application role, so
 * void-ness cannot live on it as a mutable column even though spec §6 puts
 * `fiscal_state` there — that column is written once at insert and never moves.
 * This is the same split the design already makes twice: immutable fact, and a
 * separate row recording what later happened to it. Keeping the projection in
 * packages/db rather than deriving it from the module's annulment record is
 * what lets a Z-report answer "which sales were voided" without a
 * cross-boundary join per row.
 */
export const saleVoids = table(
  "sale_voids",
  {
    id: id("id").primaryKey().defaultRandom(),
    // No inline `.references()` here — see the hand-written
    // `sale_voids_sale_fk` below, mirroring `./sales.ts`'s own
    // `sale_lines_sale_fk`/`tenders_sale_fk`: a child row must not point at a
    // a property a bare `sale_id -> sales.id` reference cannot express.
    saleId: id("sale_id").notNull(),
    reason: label("reason").notNull(),
    // mode: "string", matching `sales.issuedAt`/`tenders.settledAt`: a JS Date
    // normalises through the host timezone the moment anything formats it, and
    // this column is populated by the application (never `defaultNow()`), so
    // the same "nothing formatted is ever stored" discipline applies here too.
    voidedAt: tsString("voided_at").notNull(),
    /** The person who authorised the void. Sub-project 5 has landed
     * (2026-08-05): `recordVoid` now sets this at INSERT from the `authorize()`
     * result (append-only table — supplied on the insert `recordVoid` already
     * makes, never a later UPDATE). Nullable, no FK, per the house seam pattern;
     * pre-production means no backfill. */
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
