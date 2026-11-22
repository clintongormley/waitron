import { foreignKey, index, unique } from "drizzle-orm/sqlite-core";
import { flag, id, newId, nowIso, table, tsString } from "./columns.js";
import { kitchenStations } from "./kitchen-stations.js";
import { workingOrders } from "./orders.js";
import { printJobs } from "./print-jobs.js";

/** One link per (job, bill, station). A correction slip links to the affected bill and station.
 * Only tickets carry dish links that can follow a dish onto another bill.
 */
export const kitchenPrintJobs = table(
  "kitchen_print_jobs",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    printJobId: id("print_job_id").notNull(),
    workingOrderId: id("working_order_id").notNull(),
    stationId: id("station_id").notNull(),
    reprint: flag("reprint").notNull(),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    correctionSlip: flag("correction_slip").notNull().default(false),
  },
  (t) => [
    // Cascades: the row says nothing once its job or its bill is gone. The station's key has no delete
    // rule, as `ticket_items.station_id` has none.
    foreignKey({
      columns: [t.printJobId],
      foreignColumns: [printJobs.id],
      name: "kitchen_print_jobs_job_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.workingOrderId],
      foreignColumns: [workingOrders.id],
      name: "kitchen_print_jobs_order_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.stationId],
      foreignColumns: [kitchenStations.id],
      name: "kitchen_print_jobs_station_fk",
    }),
    unique("kitchen_print_jobs_job_order_station_key").on(
      t.printJobId,
      t.workingOrderId,
      t.stationId,
    ),
    index("kitchen_print_jobs_order_station_idx").on(t.workingOrderId, t.stationId),
  ],
);
