import { foreignKey, index, unique } from "drizzle-orm/sqlite-core";
import { id, newId, table } from "./columns.js";
import { workingOrderLines } from "./orders.js";
import { printJobs } from "./print-jobs.js";

/**
 * Which order lines each kitchen ticket's print job carried: one row per (job, line), written with
 * the job by `enqueueKitchenTickets` and `reprintOrderTickets` (`apps/server/src/kitchen-print.ts`),
 * copied by `copyKitchenJobLines` there onto the new line a split makes (`carveOffLines`,
 * `apps/server/src/working-order.ts`), and read by `copyKitchenPrintLinks` in
 * `apps/server/src/kitchen-print.ts`.
 */
export const kitchenPrintJobLines = table(
  "kitchen_print_job_lines",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    printJobId: id("print_job_id").notNull(),
    workingOrderLineId: id("working_order_line_id").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.printJobId],
      foreignColumns: [printJobs.id],
      name: "kitchen_print_job_lines_job_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.workingOrderLineId],
      foreignColumns: [workingOrderLines.id],
      name: "kitchen_print_job_lines_line_fk",
    }).onDelete("cascade"),
    unique("kitchen_print_job_lines_job_line_key").on(t.printJobId, t.workingOrderLineId),
    index("kitchen_print_job_lines_line_idx").on(t.workingOrderLineId),
  ],
);
