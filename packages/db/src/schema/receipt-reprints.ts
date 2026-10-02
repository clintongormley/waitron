import { foreignKey, index, unique } from "drizzle-orm/sqlite-core";
import { id, newId, nowIso, table, tsString } from "./columns.js";
import { printJobs } from "./print-jobs.js";
import { sales } from "./sales.js";

/** A receipt copy records who requested it and which document job carries it. */
export const receiptReprints = table(
  "receipt_reprints",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    saleId: id("sale_id").notNull(),
    printJobId: id("print_job_id").notNull(),
    // Persons belong to identity's migration set; a removed person must not erase this audit row.
    personId: id("person_id").notNull(),
    requestedAt: tsString("requested_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    foreignKey({
      columns: [t.saleId],
      foreignColumns: [sales.id],
      name: "receipt_reprints_sale_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.printJobId],
      foreignColumns: [printJobs.id],
      name: "receipt_reprints_job_fk",
    }).onDelete("restrict"),
    unique("receipt_reprints_job_uq").on(t.printJobId),
    index("receipt_reprints_sale_idx").on(t.saleId),
  ],
);
