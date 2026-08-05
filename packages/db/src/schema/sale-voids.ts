import { foreignKey, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { sales } from "./sales.js";
import { tenants } from "./tenants.js";

/**
 * A sale is voided by APPENDING a row here, never by editing the sale.
 *
 * `sales` has UPDATE and DELETE revoked from the application role, so
 * void-ness cannot live on it as a mutable column even though spec §6 puts
 * `fiscal_state` there — that column is written once at insert and never moves.
 * This is the same split the design already makes twice: immutable fact, and a
 * separate row recording what later happened to it. Keeping the projection in
 * packages/db rather than deriving it from the module's anulación registro is
 * what lets a Z-report answer "which sales were voided" without a
 * cross-boundary join per row.
 *
 * This table is itself append-only, for the identical reason `sales` is: a
 * void is a fact about what happened, not a piece of mutable state — there is
 * no future revision to "un-void" or "correct" a void in place, only a further
 * fact recorded elsewhere. It therefore takes the full four-part recipe
 * (`packages/db/src/immutability.sql.md`), not merely `invoice_series`'s
 * tenant-isolation-only subset: REVOKE UPDATE/DELETE/TRUNCATE plus the
 * row/statement trigger backstop, in the same migration that creates it.
 */
export const saleVoids = pgTable(
  "sale_voids",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      /* v8 ignore next */
      .references(() => tenants.id, { onDelete: "restrict" }),
    // No single-column `.references()` here — see the composite
    // `sale_voids_sale_fk` below, mirroring `./sales.ts`'s own
    // `sale_lines_sale_fk`/`tenders_sale_fk`: a child row must not point at a
    // sale belonging to a DIFFERENT tenant than the one recorded on this row,
    // a property a bare `sale_id -> sales.id` reference cannot express.
    saleId: uuid("sale_id").notNull(),
    reason: text("reason").notNull(),
    // mode: "string", matching `sales.issuedAt`/`tenders.settledAt`: a JS Date
    // normalises through the host timezone the moment anything formats it, and
    // this column is populated by the application (never `defaultNow()`), so
    // the same "nothing formatted is ever stored" discipline applies here too.
    voidedAt: timestamp("voided_at", { withTimezone: true, mode: "string" }).notNull(),
    /** The person who authorised the void. Sub-project 5 has landed
     * (2026-08-05): `recordVoid` now sets this at INSERT from the `authorize()`
     * result (append-only table — supplied on the insert `recordVoid` already
     * makes, never a later UPDATE). Nullable, no FK, per the house seam pattern;
     * pre-production means no backfill. */
    voidedBy: uuid("voided_by"),
  },
  (t) => [
    // The database is what makes double-voiding impossible. A SELECT-then-INSERT
    // check in application code is passed by both of two concurrent
    // transactions, and the second one would chain a duplicate anulación.
    unique("sale_voids_sale_id_key").on(t.saleId),
    foreignKey({
      columns: [t.tenantId, t.saleId],
      foreignColumns: [sales.tenantId, sales.id],
      name: "sale_voids_sale_fk",
    }).onDelete("restrict"),
  ],
).enableRLS();
