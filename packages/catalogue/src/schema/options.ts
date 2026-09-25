import { foreignKey, index } from "drizzle-orm/sqlite-core";
import { count, flag, id, json, label, newId, table } from "@waitron/db";

/** A reusable, named list of labels the diner picks exactly one of — a kitchen instruction, not a
 * priced thing. Each list and each label carries three names (staff, customer-facing, kitchen). */
export const optionLists = table("option_lists", {
  id: id("id").primaryKey().$defaultFn(newId),
  name: label("name").notNull(),
  // Customer-facing translated name; null or a blank entry means "use `name`".
  customerName: json<Record<string, string>>("customer_name"),
  kitchenName: label("kitchen_name"),
  // The label preselected when this list is asked. It names a label of THIS list, and nothing in
  // the database says so: a key here and option_labels.list_id below would point at each other, so
  // a create would have to write one side null and come back to it. `parseOptionListInput`
  // (option-contract.ts) is what refuses an id naming no label of the list.
  defaultLabelId: id("default_label_id"),
  // An options list and an extras list are ordered by the same column name, and
  // `product_modifiers.sort` (schema/extras.ts) orders the two kinds together.
  sort: count("sort").notNull().default(0),
  active: flag("active").notNull().default(true),
});

/** One answer within an options list. `available` hides a label without disturbing saved orders —
 * nothing on an order line points back here by id (spec §2.3), so the cascade below only has to
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
  },
  (t) => [
    foreignKey({
      columns: [t.listId],
      foreignColumns: [optionLists.id],
      name: "option_labels_list_fk",
    }).onDelete("cascade"),
    index("option_labels_list_sort_idx").on(t.listId, t.sort),
  ],
);
