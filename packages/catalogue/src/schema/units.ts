import { sql } from "drizzle-orm";
import { check, foreignKey, index, primaryKey, unique } from "drizzle-orm/sqlite-core";
import { count, id, json, label, newId, products, table } from "@waitron/db";

export const units = table(
  "units",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    seedKey: label("seed_key"),
    name: json<Record<string, string>>("name").notNull(),
    abbreviation: json<Record<string, string>>("abbreviation").notNull(),
    precision: count("precision").notNull(),
    // A plain text column beside its own check constraint below, NOT the enumText/enumCheck pair:
    // that pair narrows the column's TypeScript type to the union of its values, which is a
    // caller-facing change the schema probe cannot see, and values written inline at the call
    // narrow whatever the column's nullability. enumText's own note in
    // packages/db/src/schema/columns.ts has the table, and says how to control for it.
    hardwareUnit: label("hardware_unit"),
  },
  (t) => [
    unique("units_seed_key_key").on(t.seedKey),
    check("units_precision_ck", sql`${t.precision} between 0 and 3`),
    check("units_hardware_unit_ck", sql`${t.hardwareUnit} in ('kg', 'g', 'mg')`),
  ],
);

/** A durable marker: once present, intentionally deleted seed units are never recreated. At most one
 * row, `id` pinned to 1 (the `@waitron/db` singleton shape). */
export const unitSeedStates = table(
  "unit_seed_states",
  {
    id: count("id").primaryKey().notNull().default(1),
  },
  (t) => [check("unit_seed_states_singleton_ck", sql`${t.id} = 1`)],
);

/** Catalogue-owned assignment avoids a core migration depending on the catalogue migration set. */
export const productUnits = table(
  "product_units",
  {
    productId: id("product_id").notNull(),
    unitId: id("unit_id").notNull(),
  },
  (t) => [
    // A PRIMARY KEY on `product_id` alone, not a bare UNIQUE: one unit per product. It also used
    // to double as the table's REPLICA IDENTITY, without which PostgreSQL refused to UPDATE (the
    // upsert that changes a product's unit) a table that was in a publication. SQLite has neither
    // publications nor a replica identity, so that second reason is gone, and so is the case that
    // created a publication to reproduce it (`units.db.test.ts` names it among what it lost).
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
