import { check, foreignKey } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { count, id, nowIso, table, tsString } from "./columns.js";
import { sales } from "./sales.js";

/** The guest count a sale's simplified receipt prints, fixed when the sale was recorded; null prints no line. */
export const saleReceiptGuests = table(
  "sale_receipt_guests",
  {
    saleId: id("sale_id").primaryKey(),
    guestCount: count("guests"),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    foreignKey({
      columns: [t.saleId],
      foreignColumns: [sales.id],
      name: "sale_receipt_guests_sale_fk",
    }).onDelete("restrict"),
    // An integer column's affinity alone stores 2.5 as a real; typeof refuses it.
    check(
      "sale_receipt_guests_guests_ck",
      sql`${t.guestCount} is null or (typeof(${t.guestCount}) = 'integer' and ${t.guestCount} between 1 and 999)`,
    ),
  ],
);
