import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { products, tenants } from "@waitron/db";

export const units = pgTable(
  "units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    seedKey: text("seed_key"),
    name: jsonb("name").$type<Record<string, string>>().notNull(),
    precision: integer("precision").notNull(),
    hardwareUnit: text("hardware_unit"),
  },
  (t) => [
    unique("units_tenant_id_key").on(t.tenantId, t.id),
    unique("units_tenant_seed_key_key").on(t.tenantId, t.seedKey),
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
      name: "units_tenant_fk",
    }).onDelete("restrict"),
    check("units_precision_ck", sql`${t.precision} between 0 and 3`),
    check("units_hardware_unit_ck", sql`${t.hardwareUnit} in ('kg', 'g', 'mg')`),
    index("units_tenant_idx").on(t.tenantId),
  ],
);

/** A durable marker: once present, intentionally deleted seed units are never recreated. */
export const unitSeedStates = pgTable(
  "unit_seed_states",
  {
    tenantId: uuid("tenant_id").primaryKey(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
      name: "unit_seed_states_tenant_fk",
    }).onDelete("restrict"),
  ],
);

/** Catalogue-owned assignment avoids a core migration depending on the catalogue migration set. */
export const productUnits = pgTable(
  "product_units",
  {
    tenantId: uuid("tenant_id").notNull(),
    productId: uuid("product_id").notNull(),
    unitId: uuid("unit_id").notNull(),
  },
  (t) => [
    unique("product_units_product_key").on(t.tenantId, t.productId),
    foreignKey({
      columns: [t.tenantId, t.productId],
      foreignColumns: [products.tenantId, products.id],
      name: "product_units_product_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.tenantId, t.unitId],
      foreignColumns: [units.tenantId, units.id],
      name: "product_units_unit_fk",
    }).onDelete("restrict"),
    index("product_units_unit_idx").on(t.tenantId, t.unitId),
  ],
);
