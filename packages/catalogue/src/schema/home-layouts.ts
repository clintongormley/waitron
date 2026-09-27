import { foreignKey, primaryKey } from "drizzle-orm/sqlite-core";
import { catalogues, deviceProfiles, id, table } from "@waitron/db";

/** The home layout a device profile shows for one menu; no row means the menu's default (D14). */
export const deviceProfileHomeLayouts = table(
  "device_profile_home_layouts",
  {
    deviceProfileId: id("device_profile_id").notNull(),
    menuId: id("menu_id").notNull(),
    // No key, on purpose (D14): a deleted layout must leave the selection in place, so the server
    // can report `layout_removed` rather than silently show the default. What establishes the
    // target exists: `setDeviceHomeLayout` checks it when the row is written; afterwards, nothing.
    layoutId: id("layout_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.deviceProfileId, t.menuId] }),
    foreignKey({
      columns: [t.deviceProfileId],
      foreignColumns: [deviceProfiles.id],
      name: "device_profile_home_layouts_profile_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.menuId],
      foreignColumns: [catalogues.id],
      name: "device_profile_home_layouts_menu_fk",
    }),
  ],
);
