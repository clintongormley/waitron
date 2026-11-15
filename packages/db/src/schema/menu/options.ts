import { sql } from "drizzle-orm";
import { check, foreignKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { count, flag, id, json, label, newId, table } from "../columns.js";

/** A reusable, named list of labels the diner picks exactly one of — a kitchen instruction, not a
 * priced thing. Each list and each label carries three names (staff, customer-facing, kitchen). */
export const optionLists = table(
  "option_lists",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    name: label("name").notNull(),
    customerName: json<Record<string, string>>("customer_name"),
    kitchenName: label("kitchen_name"),
    sort: count("sort").notNull().default(0),
    active: flag("active").notNull().default(true),
  },
  (t) => [check("option_lists_name_ck", sql`trim(${t.name}) <> ''`)],
);

/** One answer within an options list. `available` hides a label without disturbing saved orders —
 * nothing on an order line points back here by id, so the cascade below only has to
 * clear the list's own labels. */
export const optionLabels = table(
  "option_labels",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    listId: id("list_id").notNull(),
    name: label("name").notNull(),
    customerName: json<Record<string, string>>("customer_name"),
    kitchenName: label("kitchen_name"),
    available: flag("available").notNull().default(true),
    sort: count("sort").notNull().default(0),
    isDefault: flag("is_default").notNull().default(false),
  },
  (t) => [
    check("option_labels_name_ck", sql`trim(${t.name}) <> ''`),
    uniqueIndex("option_labels_one_default_uq")
      .on(t.listId)
      .where(sql`${t.isDefault} = 1`),
    foreignKey({
      columns: [t.listId],
      foreignColumns: [optionLists.id],
      name: "option_labels_list_fk",
    }).onDelete("cascade"),
    index("option_labels_list_sort_idx").on(t.listId, t.sort),
  ],
);
