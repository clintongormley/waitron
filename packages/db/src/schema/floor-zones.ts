import { sql } from "drizzle-orm";
import { uniqueIndex } from "drizzle-orm/sqlite-core";
import { count, flag, id, label, newId, nowIso, table, tsString } from "./columns.js";

/**
 * A venue-configured floor-plan zone. A grouping the live floor
 * renders tables under: an authorable ROW (rename once, reorder, deactivate) rather than a value
 * re-typed onto every table. `dining_tables.zone_id` points at one of these.
 */
export const floorZones = table(
  "floor_zones",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    name: label("name").notNull(),
    // Author-controlled ordering in the editor + the floor-plan layout.
    displayOrder: count("display_order").notNull().default(0),
    active: flag("active").notNull().default(true),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    uniqueIndex("floor_zones_name_key")
      .on(t.name)
      .where(sql`${t.active} = 1`),
  ],
);
