import { foreignKey, primaryKey } from "drizzle-orm/sqlite-core";
import { id, table } from "./columns.js";
import { menuVersions } from "./menu/publication.js";
import { menus } from "./menus.js";
import { workingOrders } from "./orders.js";

export const billSetMenuCopies = table(
  "bill_set_menu_copies",
  {
    workingOrderId: id("working_order_id").notNull(),
    setMenuId: id("set_menu_id").notNull(),
    menuVersionId: id("menu_version_id").notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.workingOrderId, t.setMenuId],
      name: "bill_set_menu_copies_pk",
    }),
    foreignKey({
      columns: [t.workingOrderId],
      foreignColumns: [workingOrders.id],
      name: "bill_set_menu_copies_order_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.setMenuId],
      foreignColumns: [menus.id],
      name: "bill_set_menu_copies_set_menu_fk",
    }),
    foreignKey({
      columns: [t.menuVersionId],
      foreignColumns: [menuVersions.id],
      name: "bill_set_menu_copies_menu_version_fk",
    }),
  ],
);
