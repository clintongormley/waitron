import { foreignKey, index, unique } from "drizzle-orm/sqlite-core";
import { id, newId, nowIso, table, tsString } from "./columns.js";
import { invoiceCorrections } from "./invoice-corrections.js";
import { tenderRefunds } from "./tender-refunds.js";

/** One leg of a correction: a refund that gives back part of its money. */
export const invoiceCorrectionRefunds = table(
  "invoice_correction_refunds",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    invoiceCorrectionId: id("invoice_correction_id").notNull(),
    tenderRefundId: id("tender_refund_id").notNull(),
    requestId: id("request_id").notNull(),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    foreignKey({
      columns: [t.invoiceCorrectionId],
      foreignColumns: [invoiceCorrections.id],
      name: "invoice_correction_refunds_correction_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.tenderRefundId],
      foreignColumns: [tenderRefunds.id],
      name: "invoice_correction_refunds_tender_refund_fk",
    }).onDelete("restrict"),
    unique("invoice_correction_refunds_tender_refund_key").on(t.tenderRefundId),
    index("invoice_correction_refunds_request_idx").on(t.invoiceCorrectionId, t.requestId),
  ],
);
