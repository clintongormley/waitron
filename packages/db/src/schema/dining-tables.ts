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
import { locations, tenants } from "./tenants.js";

/**
 * The rendered shape of a table on the FP-2 floor plan. Venue layout only — nowhere near the fiscal
 * huella — so it carries no Spanish vocabulary and needs no fiscal review.
 */
export const floorTableShape = pgEnum("floor_table_shape", ["round", "square", "rect"]);

/**
 * A dining table — tenant + location scoped, long-lived. Anchored to the venue-wide `location`, NOT to
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
    tenantId: uuid("tenant_id")
      .notNull()
      /* v8 ignore next */
      .references(() => tenants.id, { onDelete: "restrict" }),
    // Bare column: the FK is the tenant-consistent COMPOSITE (tenant_id, location_id) →
    // locations(tenant_id, id) declared below (mirroring working_orders_node_fk).
    locationId: uuid("location_id").notNull(),
    // The human id shown on the floor ("12", "Terraza 3"). Unique within a venue (see below).
    label: text("label").notNull(),
    // The floor-plan zone this table sits in (FP-1), or NULL for none. Replaces the former free-text
    // `zone` string with a reference to the authorable `floor_zones` config row. BARE column — its
    // (tenant_id, zone_id) → floor_zones(tenant_id, id) tenant-consistent composite FK is hand-written
    // in the paired --custom migration (the same shape as status_id below), not `.references()` here.
    zoneId: uuid("zone_id"),
    // Covers. Nullable.
    capacity: integer("capacity"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    // The open tab covering this table (design §2b). Nullable back-pointer; a set value points at an
    // `open` working order. BARE column — its (tenant_id, tab_id) → working_orders(tenant_id, id) FK is
    // hand-written in Task 2's custom migration (the mutual-FK cycle note above).
    tabId: uuid("tab_id"),
    statusId: uuid("status_id"),
    posX: smallint("pos_x"),
    posY: smallint("pos_y"),
    shape: floorTableShape("shape"),
    rotation: smallint("rotation"),
  },
  (t) => [
    // Composite (tenant_id, id) UNIQUE — the target for working_orders' tenant-consistent
    // (tenant_id, delivery_table_id) FK (Task 2), the same role nodes_tenant_id_key plays for
    // working_orders_node_fk.
    unique("dining_tables_tenant_id_key").on(t.tenantId, t.id),
    // No duplicate labels within a venue.
    unique("dining_tables_location_label_key").on(t.tenantId, t.locationId, t.label),
    foreignKey({
      columns: [t.tenantId, t.locationId],
      foreignColumns: [locations.tenantId, locations.id],
      name: "dining_tables_location_fk",
    }),
    foreignKey({
      columns: [t.tenantId, t.statusId],
      foreignColumns: [tableServiceStatuses.tenantId, tableServiceStatuses.id],
      name: "dining_tables_status_fk",
    }),
  ],
);
