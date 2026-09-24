import { sql } from "drizzle-orm";
import { check, foreignKey, index, unique } from "drizzle-orm/sqlite-core";
import {
  catalogues,
  count,
  flag,
  id,
  json,
  label,
  labelList,
  money,
  newId,
  products,
  table,
} from "@waitron/db";

/** The one content-language policy shared by the reusable catalogue and media: at most one row,
 * `id` pinned to 1 (the `deployment` / `node_membership` singleton shape in `@waitron/db`). */
export const contentLanguages = table(
  "content_languages",
  {
    id: count("id").primaryKey().notNull().default(1),
    defaultLanguage: label("default_language").notNull(),
    languages: labelList("languages").notNull(),
  },
  (t) => [
    check("content_languages_singleton_ck", sql`${t.id} = 1`),
    // Membership in the list, matched on the QUOTED token so a code cannot match a prefix of a
    // longer one. Measured on node:sqlite (Node v26.7.0), probe /tmp/f1-ddl-probe/arrays.mjs:
    // `["es-ES"]` with default `es` is refused and with `es-ES` accepted, `["es","en"]` accepts
    // `es` and refuses `fr`, and an empty list refuses every default. It replaces
    // `default_language = any(languages)`, which SQLite refuses at CREATE TABLE time with
    // `no such function: any`. The match is exact only while a language code carries no `"` and
    // needs no JSON escape — true of BCP-47 tags, and nothing below this line enforces it.
    check(
      "content_languages_default_ck",
      sql`instr(${t.languages}, '"' || ${t.defaultLanguage} || '"') > 0`,
    ),
    // The PostgreSQL check was `cardinality(languages) between 1 and 200 and
    // array_position(languages, null) is null`. The count carries across to `json_array_length`,
    // which also refuses text that is not JSON at all (`malformed JSON`, measured). **The second
    // half does NOT carry**: a JSON array holding a null entry, `[null]`, is accepted here, and
    // neither of the two shapes tried refuses it — SQLite answers
    // `subqueries prohibited in CHECK constraints` to the `json_each` form, and `array_position`
    // does not exist. Whether some third expression could is not established; nobody has looked
    // further. What refuses a null entry today is the column's own `string[]` type and the writer
    // above it; the database does not.
    check("content_languages_list_ck", sql`json_array_length(${t.languages}) between 1 and 200`),
  ],
);

/** A presentation heading within one menu. Product categories remain the reporting taxonomy. */
export const menuSections = table(
  "menu_sections",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    menuId: id("menu_id").notNull(),
    name: json<Record<string, string>>("name").notNull(),
    displayOrder: count("display_order").notNull().default(0),
    active: flag("active").notNull().default(true),
  },
  (t) => [
    // The target of menu_items_section_fk: an offer's section belongs to the offer's own menu.
    unique("menu_sections_menu_id_key").on(t.menuId, t.id),
    foreignKey({
      columns: [t.menuId],
      foreignColumns: [catalogues.id],
      name: "menu_sections_menu_fk",
    }).onDelete("cascade"),
    index("menu_sections_menu_order_idx").on(t.menuId, t.displayOrder),
  ],
);

/** A product offered on one menu, and its presentation order. A blank `gross_price` means the
 * product's own price (`resolveOfferPrice`, `offer-price.ts`). */
export const menuItems = table(
  "menu_items",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    menuId: id("menu_id").notNull(),
    productId: id("product_id").notNull(),
    sectionId: id("section_id").notNull(),
    grossPrice: money("gross_price"),
    displayOrder: count("display_order").notNull().default(0),
    active: flag("active").notNull().default(true),
  },
  (t) => [
    // The target of menu_item_variant_overrides_offer_fk: an override names the offer's product.
    unique("menu_items_id_product_key").on(t.id, t.productId),
    unique("menu_items_menu_product_key").on(t.menuId, t.productId),
    foreignKey({
      columns: [t.menuId],
      foreignColumns: [catalogues.id],
      name: "menu_items_menu_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.productId],
      foreignColumns: [products.id],
      name: "menu_items_product_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.menuId, t.sectionId],
      foreignColumns: [menuSections.menuId, menuSections.id],
      name: "menu_items_section_fk",
    }).onDelete("restrict"),
    check("menu_items_gross_price_ck", sql`${t.grossPrice} >= 0`),
    index("menu_items_menu_order_idx").on(t.menuId, t.displayOrder),
  ],
);
