import { index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { id, newId, nowIso, table, tsString } from "./columns.js";
import { printJobs } from "./print-jobs.js";
import { sales } from "./sales.js";

export const documentPageReprints = table(
  "document_page_reprints",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    saleId: id("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "restrict" }),
    printJobId: id("print_job_id")
      .notNull()
      .references(() => printJobs.id, { onDelete: "restrict" }),
    // Identity owns people; removal must not erase the requesting operator's attribution.
    personId: id("person_id").notNull(),
    requestedAt: tsString("requested_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    uniqueIndex("document_page_reprints_job_uq").on(t.printJobId),
    index("document_page_reprints_sale_idx").on(t.saleId),
  ],
);
