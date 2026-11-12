import { id, table, ts } from "@waitron/db";
import { registrosFacturacion } from "./registros.js";

export const returnedInvoiceRecords = table("returned_invoice_records", {
  recordId: id("record_id")
    .primaryKey()
    .references(() => registrosFacturacion.id),
  receivedAt: ts("received_at").notNull(),
});
