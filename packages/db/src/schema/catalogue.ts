import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/** A named, shareable menu. Many locations may point at one catalogue (N identical delis share it);
 * a heterogeneous venue set uses one catalogue each. `version` is the sync seam (bumped later). */
export const catalogues = pgTable(
  "catalogues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    version: bigint("version", { mode: "number" }).notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("catalogues_tenant_id_idx").on(t.tenantId)],
).enableRLS();

/** Tenant-wide analytics taxonomy ("Food", "Drinks"). Orthogonal to catalogue; snapshotted onto
 * the sale line as a label so a roll-up sums one canonical bucket across catalogues. */
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("categories_tenant_id_idx").on(t.tenantId)],
).enableRLS();

/** A priced item. `unit_price` is GROSS (VAT-inclusive), per item (`each`) or per kg (`weight`).
 * Deactivate via `active`, never delete (may sit behind historical sale-line snapshots). */
export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    catalogueId: uuid("catalogue_id")
      .notNull()
      .references(() => catalogues.id),
    categoryId: uuid("category_id").references(() => categories.id),
    descriptions: jsonb("descriptions").$type<Record<string, string>>().notNull(),
    pricingUnit: text("pricing_unit").notNull(),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    vatClass: text("vat_class").notNull(),
    active: boolean("active").notNull().default(true),
    // Allergen declaration (EU 1169/2011 Annex II). NULL = not yet reviewed (a compliance gap the
    // till surfaces distinctly); {} = reviewed, contains none of the 14; else per-code presence +
    // optional specific-substance source. Structural type only — the exact AllergenCode-keyed type
    // lives in @waitron/catalogue (which depends on THIS package, so it cannot be imported here).
    allergens:
      jsonb("allergens").$type<
        Record<string, { presence: "contains" | "may_contain"; source?: string }>
      >(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("products_catalogue_id_idx").on(t.catalogueId),
    // Composite target so a tenant-scoped table can carry a tenant-consistent (tenant_id,
    // product_id) FK — the same role nodes_tenant_id_key plays for `working_orders`/`sales`. Used
    // by working_order_lines_product_fk (schema/orders.ts): a draft line cannot price against a
    // product belonging to another tenant. `id` alone is already unique (it is the PK); this adds
    // the composite so the FK can be tenant-consistent rather than merely referential.
    unique("products_tenant_id_key").on(t.tenantId, t.id),
    check("products_pricing_unit_ck", sql`${t.pricingUnit} in ('each','weight')`),
    check(
      "products_vat_class_ck",
      sql`${t.vatClass} in ('general','reduced','super_reduced','zero')`,
    ),
  ],
).enableRLS();
