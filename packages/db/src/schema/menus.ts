import { sql } from "drizzle-orm";
import { check, foreignKey, index, unique } from "drizzle-orm/sqlite-core";
import {
  count,
  flag,
  id,
  json,
  label,
  money,
  newId,
  now,
  table,
  ts,
  enumType,
  enumCheck,
} from "./columns.js";
import {
  PRODUCT_ORDERINGS,
  HOME_DISPLAY_DEFAULTS,
  HOME_COLUMN_RANGE,
  HOME_TILE_MODES,
  HOME_ORDERS,
  type AllergenMap,
} from "@waitron/shared";
import { units } from "./menu/units.js";
import { kitchenCourses } from "./kitchen-courses.js";
import { uniqueIndex } from "drizzle-orm/sqlite-core";

const menuKind = enumType(["menu", "set_menu"]);
const vatClasses = sql`('general','reduced','super_reduced','zero')`;
const homeTiles = enumType(HOME_TILE_MODES);
const homeOrder = enumType(HOME_ORDERS);
const { handheld, till } = HOME_DISPLAY_DEFAULTS;

export const menus = table(
  "menus",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    name: label("name").notNull(),
    active: flag("active").notNull().default(true),
    isDefault: flag("is_default").notNull().default(false),
    createdAt: ts("created_at").notNull().$defaultFn(now),
    updatedAt: ts("updated_at").notNull().$defaultFn(now),
    handheldColumns: count("handheld_columns").notNull().default(handheld.columns),
    handheldTiles: homeTiles("handheld_tiles").notNull().default(handheld.tiles),
    handheldOrder: homeOrder("handheld_order").notNull().default(handheld.order),
    tillColumns: count("till_columns").notNull().default(till.columns),
    tillTiles: homeTiles("till_tiles").notNull().default(till.tiles),
    tillOrder: homeOrder("till_order").notNull().default(till.order),
    kind: menuKind("kind").notNull().default("menu"),
    setPrice: money("set_price"),
    setVatClass: label("set_vat_class"),
    setTakeawayVatClass: label("set_takeaway_vat_class"),
  },
  (t) => [
    check(
      "menus_handheld_columns_ck",
      sql`${t.handheldColumns} between ${sql.raw(String(HOME_COLUMN_RANGE.handheld.min))} and ${sql.raw(String(HOME_COLUMN_RANGE.handheld.max))}`,
    ),
    check(
      "menus_till_columns_ck",
      sql`${t.tillColumns} between ${sql.raw(String(HOME_COLUMN_RANGE.till.min))} and ${sql.raw(String(HOME_COLUMN_RANGE.till.max))}`,
    ),
    check("menus_handheld_tiles_ck", enumCheck(t.handheldTiles)),
    check("menus_handheld_order_ck", enumCheck(t.handheldOrder)),
    check("menus_till_tiles_ck", enumCheck(t.tillTiles)),
    check("menus_till_order_ck", enumCheck(t.tillOrder)),
    check("menus_kind_ck", enumCheck(t.kind)),
    check(
      "menus_set_terms_ck",
      sql`(${t.kind} = 'set_menu' and ${t.setPrice} is not null and ${t.setVatClass} is not null)
        or (${t.kind} = 'menu' and ${t.setPrice} is null and ${t.setVatClass} is null and ${t.setTakeawayVatClass} is null)`,
    ),
    check("menus_set_price_ck", sql`${t.setPrice} is null or ${t.setPrice} >= 0`),
    check("menus_set_vat_class_ck", sql`${t.setVatClass} in ${vatClasses}`),
    check("menus_set_takeaway_vat_class_ck", sql`${t.setTakeawayVatClass} in ${vatClasses}`),
    check("menus_set_not_default_ck", sql`${t.kind} = 'menu' or ${t.isDefault} = 0`),
    uniqueIndex("menus_one_default_uq")
      .on(t.isDefault)
      .where(sql`${t.isDefault} = 1`),
  ],
);

/** The analytics taxonomy ("Food", "Drinks"). Orthogonal to menu; snapshotted onto
 * the sale line as a label so a roll-up sums one canonical bucket across menus. */
export const categories = table(
  "categories",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    name: label("name").notNull(),
    createdAt: ts("created_at").notNull().$defaultFn(now),
    updatedAt: ts("updated_at").notNull().$defaultFn(now),
    parentId: id("parent_id"),
    color: label("color"),
  },
  (t) => [
    foreignKey({
      columns: [t.parentId],
      foreignColumns: [t.id],
      name: "categories_parent_fk",
    }).onDelete("restrict"),
    index("categories_parent_idx").on(t.parentId),
  ],
);

/** A priced item. Deactivate via `active`, never delete (may sit behind historical sale-line
 * snapshots). */
const productOrdering = enumType(PRODUCT_ORDERINGS);

export const products = table(
  "products",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    // Set only on a VARIANT: the product it is a variant of. One level only, fixed when the row is
    // created, and the row's `id` never changes either — all enforced by triggers, which cannot be
    // declared here (`triggers/core.sql`).
    parentId: id("parent_id"),
    // A variant's position among its parent's variants; unused with no parent.
    variantOrder: count("variant_order").notNull().default(0),
    // The main reporting category; null is Uncategorised, and on a variant means its parent's.
    /* v8 ignore start */
    categoryId: id("category_id").references(() => categories.id),
    /* v8 ignore stop */
    // A line with no course fires earliest.
    /* v8 ignore start */
    courseId: id("course_id").references(() => kitchenCourses.id),
    /* v8 ignore stop */
    // Staff-facing product name, shown on the dashboard, till buttons/basket and reports.
    name: label("name").notNull(),
    // Customer-facing translated name; null or a blank entry means "use `name`". Shown on receipts,
    // invoice lines, the customer display and customer menus.
    customerName: json<Record<string, string>>("customer_name"),
    description: json<Record<string, string>>("description"),
    kitchenName: label("kitchen_name"),
    dietaryDeclarations: json<string[]>("dietary_declarations").default([]),
    /* v8 ignore start */
    unitId: id("unit_id").references(() => units.id, { onDelete: "restrict" }),
    /* v8 ignore stop */
    unitPrice: money("unit_price"),
    vatClass: label("vat_class"),
    // The class charged when the product is taken away; how a blank resolves:
    // `effectiveProductColumns`.
    takeawayVatClass: label("takeaway_vat_class"),
    // `active` is whether the product exists for the venue — deleting makes it false and removes no
    // row — and `available` is "sold out for now". The till sells a product only when both are
    // true. `available` is never inherited by a variant.
    active: flag("active").notNull().default(true),
    available: flag("available").notNull().default(true),
    ordering: productOrdering("ordering").notNull().default("public"),
    // The photo's original hash filename is its stable reference; media resolves its current picture.
    image: label("image"),
    // Its own tile colour, lowercase #rrggbb; null takes its category's. A variant's own value is
    // ignored: it reads its parent's.
    color: label("color"),
    // Allergen declaration (EU 1169/2011 Annex II). NULL = not yet reviewed (a compliance gap the
    // till surfaces distinctly); {} = reviewed, contains none.
    allergens: json<AllergenMap>("allergens"),
    dietOverride: json<{
      vegan?: "yes" | "no";
      vegetarian?: "yes" | "no";
      halal?: "yes" | "no";
      kosher?: "yes" | "no";
      addContains?: string[];
      removeContains?: string[];
    }>("diet_override"),
    createdAt: ts("created_at").notNull().$defaultFn(now),
    updatedAt: ts("updated_at").notNull().$defaultFn(now),
  },
  (t) => [
    index("products_image_idx")
      .on(t.image)
      .where(sql`${t.image} is not null`),
    check("products_ordering_ck", enumCheck(t.ordering)),
    check("products_unit_price_ck", sql`${t.unitPrice} is null or ${t.unitPrice} >= 0`),
    check("products_name_ck", sql`trim(${t.name}) <> ''`),
    index("products_unit_idx").on(t.unitId),
    index("products_course_idx").on(t.courseId),
    // Target of menu's `menu_item_variant_overrides` key `(product_id, variant_id)`.
    unique("products_parent_id_key").on(t.parentId, t.id),
    foreignKey({
      columns: [t.parentId],
      foreignColumns: [t.id],
    }).onDelete("restrict"),
    // A product with no parent owns every value a variant may inherit.
    check(
      "products_top_level_owns_ck",
      sql`${t.parentId} is not null or (${t.vatClass} is not null and ${t.unitPrice} is not null and ${t.dietaryDeclarations} is not null)`,
    ),
    check("products_vat_class_ck", sql`${t.vatClass} in ${vatClasses}`),
    check("products_takeaway_vat_class_ck", sql`${t.takeawayVatClass} in ${vatClasses}`),
  ],
);
