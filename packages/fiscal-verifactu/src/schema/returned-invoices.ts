import { id, table, ts } from "@waitron/db";
import { verifactuRecords } from "./verifactu-records.js";

export const returnedInvoiceRecords = table("returned_invoice_records", {
  recordId: id("record_id")
    .primaryKey()
    .references(() => verifactuRecords.id),
  receivedAt: ts("received_at").notNull(),
});
