import { sql } from "drizzle-orm";
import { check, foreignKey, index, unique } from "drizzle-orm/sqlite-core";
import { count, enumCheck, enumType, flag, id, newId, nowIso, table, tsString } from "./columns.js";
import { workingOrderLines } from "./orders.js";
import { saleLines } from "./sales.js";

/**
 * One dish ordered, kept for good: the line that holds it can move between orders or be
 * deleted, and this row stays. Portions expanded from one priced request line share a cohort and
 * are numbered from 1 within it.
 */
export const orderPortions = table(
  "order_portions",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    cohortId: id("cohort_id").notNull(),
    ordinal: count("ordinal").notNull(),
    measured: flag("measured").notNull(),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    unique("order_portions_cohort_ordinal_key").on(t.cohortId, t.ordinal),
    check("order_portions_ordinal_ck", sql`${t.ordinal} >= 1`),
  ],
);

/** Which working line holds which portion right now. */
export const workingLinePortions = table(
  "working_line_portions",
  {
    // No delete rule on purpose: a drizzle rebuild of `working_order_lines` runs with foreign keys
    // on, so a cascading child would lose every row without a word; with none the rebuild fails.
    // A writer that deletes a bound dish line deletes its binding first.
    workingOrderLineId: id("working_order_line_id").primaryKey(),
    portionId: id("portion_id").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.workingOrderLineId],
      foreignColumns: [workingOrderLines.id],
      name: "working_line_portions_line_fk",
    }),
    foreignKey({
      columns: [t.portionId],
      foreignColumns: [orderPortions.id],
      name: "working_line_portions_portion_fk",
    }).onDelete("restrict"),
    unique("working_line_portions_portion_key").on(t.portionId),
  ],
);

/** Which portions a filed sale row stands for. */
export const saleLinePortions = table(
  "sale_line_portions",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    saleLineId: id("sale_line_id").notNull(),
    portionId: id("portion_id").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.saleLineId],
      foreignColumns: [saleLines.id],
      name: "sale_line_portions_sale_line_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.portionId],
      foreignColumns: [orderPortions.id],
      name: "sale_line_portions_portion_fk",
    }).onDelete("restrict"),
    unique("sale_line_portions_sale_line_portion_key").on(t.saleLineId, t.portionId),
    index("sale_line_portions_portion_idx").on(t.portionId),
  ],
);

export const ORDER_PORTION_EVENT_KINDS = ["moved", "cancelled"] as const;
const portionEventKind = enumType(ORDER_PORTION_EVENT_KINDS);

/**
 * A portion moved to another order, or cancelled with its charge. The order ids are plain ids with
 * no key: a row nothing may change must not refuse a later delete of a working order. The actor is a
 * plain person id because `persons` is in @waitron/identity's migration set, not the core one.
 */
export const orderPortionEvents = table(
  "order_portion_events",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    portionId: id("portion_id").notNull(),
    kind: portionEventKind("kind").notNull(),
    fromOrderId: id("from_order_id").notNull(),
    toOrderId: id("to_order_id"),
    actorId: id("actor_id"),
    at: tsString("at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    foreignKey({
      columns: [t.portionId],
      foreignColumns: [orderPortions.id],
      name: "order_portion_events_portion_fk",
    }).onDelete("restrict"),
    check("order_portion_events_kind_ck", enumCheck(t.kind)),
    check(
      "order_portion_events_destination_ck",
      sql`(${t.kind} = 'moved' and ${t.toOrderId} is not null and ${t.toOrderId} <> ${t.fromOrderId}) or (${t.kind} = 'cancelled' and ${t.toOrderId} is null)`,
    ),
  ],
);
