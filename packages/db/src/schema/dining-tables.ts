import { check, foreignKey, unique } from "drizzle-orm/sqlite-core";
import {
  count,
  enumCheck,
  enumType,
  flag,
  id,
  label,
  newId,
  nowIso,
  smallCount,
  table,
  tsString,
} from "./columns.js";
import { floorZones } from "./floor-zones.js";
import { tableServiceStatuses } from "./table-service-statuses.js";
import { locations } from "./tenants.js";

/**
 * The rendered shape of a table on the floor plan. Venue layout only — nowhere near the fiscal
 * fingerprint — so it carries no Spanish vocabulary and needs no fiscal review.
 */
export const floorTableShape = enumType(["round", "square", "rect"]);

/**
 * A dining table — location scoped, long-lived. Anchored to the venue-wide `location`, NOT to
 * `node` (working orders, the held list, the order-number counter and the prep queue are all
 * node-scoped, but a table must not fragment when a venue runs a second node).
 */
export const diningTables = table(
  "dining_tables",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    locationId: id("location_id").notNull(),
    // The human id shown on the floor ("12", "Terraza 3").
    label: label("label").notNull(),
    zoneId: id("zone_id"),
    // Covers.
    capacity: count("capacity"),
    active: flag("active").notNull().default(true),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    statusId: id("status_id"),
    posX: smallCount("pos_x"),
    posY: smallCount("pos_y"),
    shape: floorTableShape("shape"),
    rotation: smallCount("rotation"),
    needsClearingSince: tsString("needs_clearing_since"),
  },
  (t) => [
    unique("dining_tables_location_label_key").on(t.locationId, t.label),
    foreignKey({
      columns: [t.locationId],
      foreignColumns: [locations.id],
      name: "dining_tables_location_fk",
    }),
    foreignKey({
      columns: [t.statusId],
      foreignColumns: [tableServiceStatuses.id],
      name: "dining_tables_status_fk",
    }),
    foreignKey({
      columns: [t.zoneId],
      foreignColumns: [floorZones.id],
      name: "dining_tables_zone_fk",
    }),
    check("dining_tables_shape_ck", enumCheck(t.shape)),
  ],
);
