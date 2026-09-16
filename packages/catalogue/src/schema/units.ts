import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { products } from "@waitron/db";

export const units = pgTable(
  "units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seedKey: text("seed_key"),
    name: jsonb("name").$type<Record<string, string>>().notNull(),
    abbreviation: jsonb("abbreviation").$type<Record<string, string>>().notNull(),
    precision: integer("precision").notNull(),
    hardwareUnit: text("hardware_unit"),
  },
  (t) => [
    unique("units_seed_key_key").on(t.seedKey),
    check("units_precision_ck", sql`${t.precision} between 0 and 3`),
    check("units_hardware_unit_ck", sql`${t.hardwareUnit} in ('kg', 'g', 'mg')`),
  ],
);

/** A durable marker: once present, intentionally deleted seed units are never recreated. At most one
 * row, `id` pinned to 1 (the `@waitron/db` singleton shape). */
export const unitSeedStates = pgTable(
  "unit_seed_states",
  {
    id: integer("id").primaryKey().notNull().default(1),
  },
  (t) => [check("unit_seed_states_singleton_ck", sql`${t.id} = 1`)],
);

/** Catalogue-owned assignment avoids a core migration depending on the catalogue migration set. */
export const productUnits = pgTable(
  "product_units",
  {
    productId: uuid("product_id").notNull(),
    unitId: uuid("unit_id").notNull(),
  },
  (t) => [
    // A PRIMARY KEY, not a bare UNIQUE: this table publishes for replication, and Postgres refuses to
    // UPDATE (the upsert that changes a product's unit) a published table with no replica identity.
    primaryKey({ columns: [t.productId] }),
    foreignKey({
      columns: [t.productId],
      foreignColumns: [products.id],
      name: "product_units_product_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.unitId],
      foreignColumns: [units.id],
      name: "product_units_unit_fk",
    }).onDelete("restrict"),
    index("product_units_unit_idx").on(t.unitId),
  ],
);
