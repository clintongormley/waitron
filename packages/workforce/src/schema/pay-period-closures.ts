import { sql } from "drizzle-orm";
import { check, uniqueIndex } from "drizzle-orm/sqlite-core";
import { count, day, id, json, label, locations, newId, nodes, table, tsString } from "@waitron/db";
import type { BusinessDayClock } from "@waitron/shared";
import type { PayPeriodSnapshot } from "../record-types.js";

export const payPeriodClosures = table(
  "pay_period_closures",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    nodeId: id("node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "restrict" }),
    locationId: id("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    periodStart: day("period_start").notNull(),
    periodEnd: day("period_end").notNull(),
    clock: json<BusinessDayClock>("clock").notNull(),
    scheduledCloseAt: tsString("scheduled_close_at").notNull(),
    closedAt: tsString("closed_at").notNull(),
    snapshot: json<PayPeriodSnapshot>("snapshot").notNull(),
    sequenceNo: count("sequence_no").notNull(),
    prevClosureHash: label("prev_closure_hash"),
    closureHash: label("closure_hash").notNull(),
  },
  (t) => [
    uniqueIndex("pay_period_closures_chain_position_uq").on(t.nodeId, t.locationId, t.sequenceNo),
    uniqueIndex("pay_period_closures_period_uq").on(t.locationId, t.periodStart, t.periodEnd),
    check("pay_period_closures_period_ck", sql`${t.periodEnd} > ${t.periodStart}`),
    check("pay_period_closures_sequence_ck", sql`${t.sequenceNo} > 0`),
    check(
      "pay_period_closures_predecessor_ck",
      sql`(${t.sequenceNo} = 1 and ${t.prevClosureHash} is null)
  or (${t.sequenceNo} > 1 and ${t.prevClosureHash} is not null)`,
    ),
    check(
      "pay_period_closures_hash_ck",
      sql`length(${t.closureHash}) = 64 and ${t.closureHash} not glob '*[^0-9A-F]*'`,
    ),
  ],
);
