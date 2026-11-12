import { sql } from "drizzle-orm";
import { check, foreignKey, index, unique } from "drizzle-orm/sqlite-core";
import { day, id, json, label, table, tsString } from "./columns.js";
import { devices } from "./devices.js";
import { nodes } from "./nodes.js";
import { workingOrders } from "./orders.js";
import { originChecks, sourceColumn } from "./origin.js";
import { persons } from "./identity/persons.js";
import { sales } from "./sales.js";

export type DeferredClosurePartyBlocker =
  "other_bills" | "service" | "revision" | "editor" | "scope" | "authority";

/** The answer a bill's deferred close gave, kept so a replay returns the same answer. */
export interface DeferredClosureResult {
  submissionId: string;
  workingOrderId: string;
  saleId: string;
  invoiceNumber: string;
  classification: "deferred_payment";
  closedAt: string;
  businessDay: string;
  total: string;
  currency: "EUR";
  party: {
    state: "not_applicable" | "closed" | "open";
    blockers: DeferredClosurePartyBlocker[];
  };
}

/**
 * A bill closed as a deferred payment: one row per submission, per bill and per sale.
 *
 * `fingerprint` is a digest of the request, not the request: the delivery email and invoice
 * recipient stay out of this append-only row.
 */
export const deferredClosures = table(
  "deferred_closures",
  {
    id: id("id").primaryKey(),
    workingOrderId: id("working_order_id").notNull(),
    saleId: id("sale_id").notNull(),
    fingerprint: label("fingerprint").notNull(),
    actorId: id("actor_id")
      .notNull()
      .references(() => persons.id, { onDelete: "restrict" }),
    source: sourceColumn("source").notNull(),
    /* v8 ignore start */
    deviceId: id("device_id").references(() => devices.id, { onDelete: "restrict" }),
    /* v8 ignore stop */
    nodeId: id("node_id").notNull(),
    closedAt: tsString("closed_at").notNull(),
    businessDay: day("business_day").notNull(),
    result: json<DeferredClosureResult>("result").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.workingOrderId],
      foreignColumns: [workingOrders.id],
      name: "deferred_closures_working_order_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.saleId],
      foreignColumns: [sales.id],
      name: "deferred_closures_sale_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.nodeId],
      foreignColumns: [nodes.id],
      name: "deferred_closures_node_fk",
    }).onDelete("restrict"),
    unique("deferred_closures_working_order_key").on(t.workingOrderId),
    unique("deferred_closures_sale_key").on(t.saleId),
    index("deferred_closures_node_day_idx").on(t.nodeId, t.businessDay, t.closedAt, t.id),
    check(
      "deferred_closures_business_day_ck",
      sql`length(${t.businessDay}) = 10 and ${t.businessDay} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
    ...originChecks("deferred_closures", t.source, t.deviceId),
  ],
);
