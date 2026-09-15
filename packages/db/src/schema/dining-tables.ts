import {
  boolean,
  foreignKey,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tableServiceStatuses } from "./table-service-statuses.js";
import { locations } from "./tenants.js";

/**
 * The rendered shape of a table on the FP-2 floor plan. Venue layout only — nowhere near the fiscal
 * fingerprint — so it carries no Spanish vocabulary and needs no fiscal review.
 */
export const floorTableShape = pgEnum("floor_table_shape", ["round", "square", "rect"]);

/**
 * A dining table — location scoped, long-lived. Anchored to the venue-wide `location`, NOT to
 * `node` (working orders, the held list, the order-number counter and the prep queue are all
 * node-scoped, but a table must not fragment when a venue runs a second node — design §2a).
 *
 * `tab_id` is the BACK-POINTER to the open tab covering this table (design §2b): set ⇒ this table is
 * covered by that open working order; a single nullable FK gives one-open-tab-per-table automatically
 * (no partial-unique, no CHECK). Several tables pointing at the SAME tab is a join (TS-3); TS-1 only
 * ever sets one table's tab_id per tab. It is a BARE column here — its FK to working_orders is
 * hand-written in the mutual-FK migration (Task 2), because the reverse FK
 * (working_orders.delivery_table_id → dining_tables) would otherwise close a load-time import cycle.
 */
export const diningTables = pgTable(
  "dining_tables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Bare column: the FK is the (location_id) →
    // locations(id) declared below (mirroring working_orders_node_fk).
    locationId: uuid("location_id").notNull(),
    // The human id shown on the floor ("12", "Terraza 3"). Unique within a venue (see below).
    label: text("label").notNull(),
    // The floor-plan zone this table sits in (FP-1), or NULL for none. Replaces the former free-text
    // `zone` string with a reference to the authorable `floor_zones` config row. BARE column — its
    // (zone_id) → floor_zones(id) FK is hand-written
    // in the paired --custom migration (the same shape as status_id below), not `.references()` here.
    zoneId: uuid("zone_id"),
    // Covers. Nullable.
    capacity: integer("capacity"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    // The open tab covering this table (design §2b). Nullable back-pointer; a set value points at an
    // `open` working order. BARE column — its (tab_id) → working_orders(id) FK is
    // hand-written in Task 2's custom migration (the mutual-FK cycle note above).
    tabId: uuid("tab_id"),
    statusId: uuid("status_id"),
    posX: smallint("pos_x"),
    posY: smallint("pos_y"),
    shape: floorTableShape("shape"),
    rotation: smallint("rotation"),
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
  ],
);
