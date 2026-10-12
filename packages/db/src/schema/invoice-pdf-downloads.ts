import { foreignKey, index } from "drizzle-orm/sqlite-core";
import { id, newId, nowIso, table, tsString } from "./columns.js";
import { sales } from "./sales.js";

/** Who requested an invoice's PDF from the dashboard, and when; the PDF itself is not stored. */
export const invoicePdfDownloads = table(
  "invoice_pdf_downloads",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    saleId: id("sale_id").notNull(),
    // Persons belong to identity's migration set; a removed person must not erase this audit row.
    personId: id("person_id").notNull(),
    requestedAt: tsString("requested_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    foreignKey({
      columns: [t.saleId],
      foreignColumns: [sales.id],
      name: "invoice_pdf_downloads_sale_fk",
    }).onDelete("restrict"),
    index("invoice_pdf_downloads_sale_idx").on(t.saleId),
  ],
);
