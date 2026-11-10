import { sql } from "drizzle-orm";
import { check, foreignKey, index, unique } from "drizzle-orm/sqlite-core";
import { day, id, json, label, table, tsString } from "./columns.js";
import { devices } from "./devices.js";
import { nodes } from "./nodes.js";
import { workingOrders } from "./orders.js";
import { originChecks, sourceColumn } from "./origin.js";
import { sales } from "./sales.js";

export type TransferClosurePartyBlocker =
  "other_bills" | "service" | "revision" | "editor" | "scope" | "authority";

/** The answer a bill's close by transfer gave, kept so a replay returns the same answer. */
export interface TransferClosureResult {
  operationId: string;
  workingOrderId: string;
  saleId: string;
  invoiceNumber: string;
  classification: "to_be_paid_by_transfer";
  closedAt: string;
  businessDay: string;
  total: string;
  currency: "EUR";
  party: {
    state: "not_applicable" | "closed" | "open";
    blockers: TransferClosurePartyBlocker[];
  };
}

/**
 * A bill closed as to be paid by bank transfer: one row per operation, per bill and per sale.
 *
 * `intent` is a digest of the request, not the request: the delivery email and invoice recipient
 * stay out of this append-only row. `actor_id` is a plain person id. No key yet, as on
 * `sales.operator_id`.
 */
export const transferClosures = table(
  "transfer_closures",
  {
    id: id("id").primaryKey(),
    workingOrderId: id("working_order_id").notNull(),
    saleId: id("sale_id").notNull(),
    intent: label("intent").notNull(),
    actorId: id("actor_id").notNull(),
    source: sourceColumn("source").notNull(),
    /* v8 ignore start */
    deviceId: id("device_id").references(() => devices.id, { onDelete: "restrict" }),
    /* v8 ignore stop */
    nodeId: id("node_id").notNull(),
    closedAt: tsString("closed_at").notNull(),
    businessDay: day("business_day").notNull(),
    result: json<TransferClosureResult>("result").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.workingOrderId],
      foreignColumns: [workingOrders.id],
      name: "transfer_closures_working_order_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.saleId],
      foreignColumns: [sales.id],
      name: "transfer_closures_sale_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.nodeId],
      foreignColumns: [nodes.id],
      name: "transfer_closures_node_fk",
    }).onDelete("restrict"),
    unique("transfer_closures_working_order_key").on(t.workingOrderId),
    unique("transfer_closures_sale_key").on(t.saleId),
    index("transfer_closures_node_day_idx").on(t.nodeId, t.businessDay, t.closedAt, t.id),
    check(
      "transfer_closures_business_day_ck",
      sql`length(${t.businessDay}) = 10 and ${t.businessDay} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
    ...originChecks("transfer_closures", t.source, t.deviceId),
  ],
);
