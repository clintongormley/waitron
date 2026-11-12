import { foreignKey, index, unique } from "drizzle-orm/sqlite-core";
import { id, label, newId, nowIso, table, tsString } from "./columns.js";
import { sales } from "./sales.js";
import { tenderRefunds } from "./tender-refunds.js";

/** One cash leg of a correction a till asked for, kept so a repeated request returns its first answer. */
export const invoiceCorrections = table(
  "invoice_corrections",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    originalSaleId: id("original_sale_id").notNull(),
    correctiveSaleId: id("corrective_sale_id").notNull(),
    tenderRefundId: id("tender_refund_id").notNull(),
    submissionId: id("submission_id").notNull(),
    fingerprint: label("fingerprint").notNull(),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    foreignKey({
      columns: [t.originalSaleId],
      foreignColumns: [sales.id],
      name: "invoice_corrections_original_sale_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.correctiveSaleId],
      foreignColumns: [sales.id],
      name: "invoice_corrections_corrective_sale_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.tenderRefundId],
      foreignColumns: [tenderRefunds.id],
      name: "invoice_corrections_tender_refund_fk",
    }).onDelete("restrict"),
    unique("invoice_corrections_tender_refund_key").on(t.tenderRefundId),
    index("invoice_corrections_submission_idx").on(t.originalSaleId, t.submissionId),
  ],
);
