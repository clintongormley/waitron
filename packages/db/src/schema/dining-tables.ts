import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
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
import { workingOrders } from "./orders.js";
import { tableServiceStatuses } from "./table-service-statuses.js";
import { locations } from "./tenants.js";

/**
 * The rendered shape of a table on the FP-2 floor plan. Venue layout only — nowhere near the fiscal
 * fingerprint — so it carries no Spanish vocabulary and needs no fiscal review.
 */
export const floorTableShape = enumType(["round", "square", "rect"]);

/**
 * A dining table — location scoped, long-lived. Anchored to the venue-wide `location`, NOT to
 * `node` (working orders, the held list, the order-number counter and the prep queue are all
 * node-scoped, but a table must not fragment when a venue runs a second node — design §2a).
 *
 * `tab_id` is the BACK-POINTER to the open tab covering this table (design §2b): set ⇒ this table is
 * covered by that open working order; a single nullable FK gives one-open-tab-per-table automatically
 * (no partial-unique, no CHECK). Several tables pointing at the SAME tab is a join (TS-3); TS-1 only
 * ever sets one table's tab_id per tab. `working_orders` carries the reverse key
 * (`working_orders.delivery_table_id` → `dining_tables`), so the two tables name each other; the
 * `AnySQLiteColumn` annotation on the thunk below is what stops TypeScript inferring each table's
 * type from the other's.
 */
export const diningTables = table(
  "dining_tables",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    // Bare column: the FK is the (location_id) →
    // locations(id) declared below (mirroring working_orders_node_fk).
    locationId: id("location_id").notNull(),
    // The human id shown on the floor ("12", "Terraza 3"). Unique within a venue (see below).
    label: label("label").notNull(),
    // The floor-plan zone this table sits in (FP-1), or NULL for none. Replaces the former free-text
    // `zone` string with a reference to the authorable `floor_zones` config row. Its foreign key is
    // declared below, the same shape as `status_id`.
    zoneId: id("zone_id"),
    // Covers. Nullable.
    capacity: count("capacity"),
    active: flag("active").notNull().default(true),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    // The open tab covering this table (design §2b). Nullable back-pointer; a set value points at an
    // `open` working order (the mutual-key note above).
    /* v8 ignore start */
    tabId: id("tab_id").references((): AnySQLiteColumn => workingOrders.id),
    /* v8 ignore stop */
    statusId: id("status_id"),
    posX: smallCount("pos_x"),
    posY: smallCount("pos_y"),
    shape: floorTableShape("shape"),
    rotation: smallCount("rotation"),
  },
  (t) => [
    // No duplicate labels within a venue.
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
    // The values are read off the column itself (`enumCheck`), so the vocabulary is declared once,
    // in `floorTableShape` above.
    check("dining_tables_shape_ck", enumCheck(t.shape)),
  ],
);
