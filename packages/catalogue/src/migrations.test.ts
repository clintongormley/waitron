import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  captureError,
  catalogues,
  CHECK_VIOLATION,
  CORE_MIGRATIONS,
  FOREIGN_KEY_VIOLATION,
  isRefusal,
  categories as coreCategories,
  products,
  engineErrorMessage,
  UNIQUE_VIOLATION,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import { contentLanguages, menuItems, menuSections } from "./schema/menu.js";
import { categoryDetails } from "./schema/categories.js";
import {
  extraListItems,
  extraLists,
  menuItemExtraItems,
  menuItemExtraLists,
} from "./schema/extras.js";
import { labels, productLabels } from "./schema/labels.js";
import { optionLabels } from "./schema/options.js";
import { productUnits, unitSeedStates, units } from "./schema/units.js";
import { menuItemVariantOverrides } from "./schema/variant-overrides.js";

// One SQLite file with the core set and this package's set applied, which is what the product
// opens.
const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS],
  timeoutMs: 60_000,
});

let db: Database;
beforeAll(() => {
  db = suite.db;
});

const TABLES = [
  "content_languages",
  "menu_sections",
  "menu_items",
  "category_details",
  "labels",
  "product_labels",
  "units",
  "unit_seed_states",
  "product_units",
  "menu_item_variant_overrides",
  "option_lists",
  "option_labels",
  "extra_lists",
  "extra_list_items",
  "menu_item_extra_lists",
  "menu_item_extra_items",
  "product_modifiers",
];

/**
 * One table's columns, as the engine's own catalogue reports them.
 *
 * `pk` is 0 for an ordinary column and the column's 1-based position in the primary key otherwise,
 * which is what makes a composite key readable in declaration order.
 */
async function columnsOf(table: string) {
  return (
    await db.execute<{ name: string; pk: number }>(sql`pragma table_info(${sql.raw(`'${table}'`)})`)
  ).rows;
}

describe("the catalogue migration set carries no tenant column", () => {
  it("has no tenant_id column on any table in the set", async () => {
    const found: string[] = [];
    for (const table of TABLES)
      for (const column of await columnsOf(table))
        if (column.name === "tenant_id") found.push(`${table}.${column.name}`);
    expect(found).toEqual([]);
  });

  /**
   * The keys and links, read through the catalogues SQLite has.
   *
   * **A foreign key and a primary key have no NAME here**, which is a fact about the generated
   * schema and not only about this test: drizzle-kit emits a SQLite foreign key as a bare
   * `FOREIGN KEY (…) REFERENCES …` clause with no `CONSTRAINT <name>` before it, and a primary key
   * as `PRIMARY KEY(…)`. So the map is keyed by the table and columns the key is declared ON.
   *
   * CHECK constraints keep their names, because drizzle writes those as `CONSTRAINT "<name>"
   * CHECK(…)`; they are read out of the stored `CREATE TABLE` text, which is the only place SQLite
   * keeps a check's expression.
   */
  it("keys and links every table on its own columns and each parent's primary key", async () => {
    const foreignKeys: Record<string, string> = {};
    const primaryKeys: Record<string, string> = {};
    const checks: Record<string, string> = {};
    for (const table of TABLES) {
      const key = await columnsOf(table);
      const pk = key
        .filter((column) => column.pk > 0)
        .sort((left, right) => left.pk - right.pk)
        .map((column) => column.name);
      if (pk.length > 0) primaryKeys[table] = pk.join(", ");
      // One row per COLUMN of a key, grouped by `id`, which is the key's own number on the table —
      // a composite key arrives as several rows sharing one id, in declaration order (`seq`).
      const rows = (
        await db.execute<{
          id: number;
          seq: number;
          table: string;
          from: string;
          to: string;
          on_delete: string;
        }>(sql`pragma foreign_key_list(${sql.raw(`'${table}'`)})`)
      ).rows;
      const grouped = new Map<
        number,
        { parent: string; from: string[]; to: string[]; onDelete: string }
      >();
      for (const row of [...rows].sort((left, right) => left.seq - right.seq)) {
        const entry = grouped.get(row.id) ?? {
          parent: row.table,
          from: [],
          to: [],
          onDelete: row.on_delete.toLowerCase(),
        };
        entry.from.push(row.from);
        entry.to.push(row.to);
        grouped.set(row.id, entry);
      }
      for (const entry of grouped.values())
        foreignKeys[`${table}(${entry.from.join(", ")})`] =
          `${entry.parent}(${entry.to.join(", ")}) on delete ${entry.onDelete}`;
      const ddl = (
        await db.execute<{ sql: string }>(
          sql`select sql from sqlite_master where type = 'table' and name = ${table}`,
        )
      ).rows[0]!.sql;
      // Each check ends at the comma before the next clause, or at the closing paren of the table.
      for (const match of ddl.matchAll(/CONSTRAINT "([^"]+)" CHECK\((.*?)\)(?=,\n|\n\))/gs))
        checks[match[1]!] = match[2]!;
    }

    expect(primaryKeys).toEqual({
      content_languages: "id",
      menu_sections: "id",
      menu_items: "id",
      category_details: "category_id",
      labels: "id",
      product_labels: "product_id, label_id",
      units: "id",
      unit_seed_states: "id",
      product_units: "product_id",
      menu_item_variant_overrides: "menu_item_id, variant_id",
      option_lists: "id",
      option_labels: "id",
      extra_lists: "id",
      extra_list_items: "id",
      menu_item_extra_lists: "menu_item_id, list_id",
      menu_item_extra_items: "menu_item_id, list_id, product_id",
      product_modifiers: "id",
    });

    expect(foreignKeys).toEqual({
      "category_details(category_id)": "categories(id) on delete cascade",
      "category_details(parent_id)": "categories(id) on delete restrict",
      "extra_list_items(list_id)": "extra_lists(id) on delete cascade",
      "extra_list_items(product_id)": "products(id) on delete restrict",
      "menu_item_extra_items(menu_item_id, list_id)":
        "menu_item_extra_lists(menu_item_id, list_id) on delete cascade",
      "menu_item_extra_items(product_id)": "products(id) on delete restrict",
      "menu_item_extra_lists(list_id)": "extra_lists(id) on delete cascade",
      "menu_item_extra_lists(menu_item_id)": "menu_items(id) on delete cascade",
      "menu_item_variant_overrides(menu_item_id, product_id)":
        "menu_items(id, product_id) on delete cascade",
      "menu_item_variant_overrides(product_id, variant_id)":
        "products(parent_id, id) on delete restrict",
      "menu_items(menu_id)": "catalogues(id) on delete cascade",
      "menu_items(menu_id, section_id)": "menu_sections(menu_id, id) on delete restrict",
      "menu_items(product_id)": "products(id) on delete restrict",
      "menu_sections(menu_id)": "catalogues(id) on delete cascade",
      "option_labels(list_id)": "option_lists(id) on delete cascade",
      "product_labels(label_id)": "labels(id) on delete cascade",
      "product_labels(product_id)": "products(id) on delete cascade",
      "product_modifiers(extra_list_id)": "extra_lists(id) on delete cascade",
      "product_modifiers(option_list_id)": "option_lists(id) on delete cascade",
      "product_modifiers(product_id)": "products(id) on delete cascade",
      "product_units(product_id)": "products(id) on delete cascade",
      "product_units(unit_id)": "units(id) on delete restrict",
    });

    expect(checks).toEqual({
      content_languages_singleton_ck: `"content_languages"."id" = 1`,
      // The list is JSON text, and the membership test matches the QUOTED token so one code cannot
      // match a prefix of a longer one.
      content_languages_default_ck: `instr("content_languages"."languages", '"' || "content_languages"."default_language" || '"') > 0`,
      // This does not refuse a NULL ENTRY in the list; `schema/menu.ts` says what does.
      content_languages_list_ck: `json_array_length("content_languages"."languages") between 1 and 200`,
      menu_items_gross_price_ck: `"menu_items"."gross_price" >= 0`,
      units_precision_ck: `"units"."precision" between 0 and 3`,
      units_hardware_unit_ck: `"units"."hardware_unit" in ('kg', 'g', 'mg')`,
      unit_seed_states_singleton_ck: `"unit_seed_states"."id" = 1`,
      menu_item_variant_overrides_price_ck: `"menu_item_variant_overrides"."price" >= 0`,
      menu_item_variant_overrides_overrides_ck: `"menu_item_variant_overrides"."price" is not null or "menu_item_variant_overrides"."offered" = 0`,
      extra_lists_picks_ck: `"extra_lists"."min_picks" >= 0 and ("extra_lists"."max_picks" is null or "extra_lists"."max_picks" >= "extra_lists"."min_picks")`,
      extra_list_items_qty_ck: `"extra_list_items"."max_quantity" >= 1`,
      extra_list_items_price_ck: `"extra_list_items"."price" >= 0`,
      menu_item_extra_items_price_ck: `"menu_item_extra_items"."price" >= 0`,
      product_modifiers_one_reference_ck: `("product_modifiers"."extra_list_id" is null) <> ("product_modifiers"."option_list_id" is null)`,
    });
  });

  /**
   * Every index the set declares, whether it backs a UNIQUE constraint or only a lookup.
   *
   * SQLite declares a multi-column UNIQUE as a `CREATE UNIQUE INDEX` and nothing else, so those
   * belong here; the `unique` flag is what keeps the two kinds apart.
   *
   * `sql is null` is the filter, not a name pattern: SQLite stores no statement for an index it
   * created itself for a `PRIMARY KEY` or a single-column `UNIQUE` declaration.
   */
  it("rebuilds every lookup index without the tenant", async () => {
    const indexes: Record<string, { unique: boolean; columns: string }> = {};
    for (const table of TABLES) {
      const rows = (
        await db.execute<{ name: string; sql: string | null }>(
          sql`select name, sql from sqlite_master where type = 'index' and tbl_name = ${table}`,
        )
      ).rows;
      for (const row of rows) {
        if (row.sql === null) continue;
        const columns = (
          await db.execute<{ name: string }>(sql`pragma index_info(${sql.raw(`'${row.name}'`)})`)
        ).rows;
        indexes[row.name] = {
          unique: row.sql.startsWith("CREATE UNIQUE"),
          columns: columns.map((column) => column.name).join(", "),
        };
      }
    }
    expect(indexes).toEqual({
      category_details_parent_idx: { unique: false, columns: "parent_id" },
      extra_list_items_list_product_uq: { unique: true, columns: "list_id, product_id" },
      extra_list_items_list_sort_idx: { unique: false, columns: "list_id, sort" },
      menu_item_extra_items_list_product_idx: { unique: false, columns: "list_id, product_id" },
      menu_item_extra_lists_list_idx: { unique: false, columns: "list_id" },
      menu_items_id_product_key: { unique: true, columns: "id, product_id" },
      menu_items_menu_order_idx: { unique: false, columns: "menu_id, display_order" },
      menu_items_menu_product_key: { unique: true, columns: "menu_id, product_id" },
      menu_sections_menu_id_key: { unique: true, columns: "menu_id, id" },
      menu_sections_menu_order_idx: { unique: false, columns: "menu_id, display_order" },
      labels_name_uq: { unique: true, columns: "name" },
      option_labels_list_sort_idx: { unique: false, columns: "list_id, sort" },
      product_labels_label_idx: { unique: false, columns: "label_id" },
      product_modifiers_product_extra_uq: { unique: true, columns: "product_id, extra_list_id" },
      product_modifiers_product_option_uq: { unique: true, columns: "product_id, option_list_id" },
      product_modifiers_product_sort_idx: { unique: false, columns: "product_id, sort" },
      product_units_unit_idx: { unique: false, columns: "unit_id" },
      units_seed_key_key: { unique: true, columns: "seed_key" },
    });
  });
});

describe("the catalogue set keeps no category membership table", () => {
  it("leaves no product_categories behind: a product's one main category is products.category_id", async () => {
    const left = (
      await db.execute<{ name: string }>(
        sql`select name from sqlite_master where type = 'table' and name = 'product_categories'`,
      )
    ).rows;
    expect(left).toEqual([]);
  });
});

describe("the catalogue set keeps no variant table of its own", () => {
  it("leaves neither product_variants nor menu_item_variants behind: a variant is a products row", async () => {
    const left = (
      await db.execute<{ name: string }>(
        sql`select name from sqlite_master
            where type = 'table' and name in ('product_variants', 'menu_item_variants')`,
      )
    ).rows.map((row) => row.name);
    expect(left).toEqual([]);
  });
});

describe("the one-row catalogue tables hold at most one row", () => {
  it("refuses a second content-language policy", async () => {
    await db.insert(contentLanguages).values({ defaultLanguage: "en", languages: ["en"] });
    const second = await captureError(() =>
      db.insert(contentLanguages).values({ id: 2, defaultLanguage: "es", languages: ["es"] }),
    );
    expect(isRefusal(second, CHECK_VIOLATION)).toBe(true);
    // A CHECK is the one refusal class SQLite still names.
    expect(engineErrorMessage(second)).toContain("content_languages_singleton_ck");
    const duplicate = await captureError(() =>
      db.insert(contentLanguages).values({ defaultLanguage: "es", languages: ["es"] }),
    );
    expect(isRefusal(duplicate, UNIQUE_VIOLATION)).toBe(true);
  });

  it("refuses a second unit-seed marker", async () => {
    await db.insert(unitSeedStates).values({ id: 1 });
    const second = await captureError(() => db.insert(unitSeedStates).values({ id: 2 }));
    expect(isRefusal(second, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(second)).toContain("unit_seed_states_singleton_ck");
    const duplicate = await captureError(() => db.insert(unitSeedStates).values({ id: 1 }));
    expect(isRefusal(duplicate, UNIQUE_VIOLATION)).toBe(true);
  });
});

describe("the catalogue foreign keys refuse a missing or mismatched target", () => {
  const missing = "00000000-0000-4000-8000-00000000dead";

  /** Rows seeded per test: the per-test reset empties every table after each case. */
  async function catalogue() {
    await seedTenant(db);
    const menuId = (
      await db.insert(catalogues).values({ name: "Lunch" }).returning({ id: catalogues.id })
    )[0]!.id;
    const otherMenuId = (
      await db.insert(catalogues).values({ name: "Dinner" }).returning({ id: catalogues.id })
    )[0]!.id;
    const product = async (name: string) =>
      (
        await db
          .insert(products)
          .values({
            catalogueId: menuId,
            name,
            pricingUnit: "each",
            unitPrice: 1,
            vatClass: "general",
          })
          .returning({ id: products.id })
      )[0]!.id;
    const productId = await product("Soup");
    const otherProductId = await product("Bread");
    const categoryId = (
      await db
        .insert(coreCategories)
        .values({ name: { en: "Food" } })
        .returning({ id: coreCategories.id })
    )[0]!.id;
    const unitId = (
      await db
        .insert(units)
        .values({
          seedKey: "each",
          name: { en: "each" },
          abbreviation: { en: "ea" },
          precision: 0,
        })
        .returning({ id: units.id })
    )[0]!.id;
    const section = async (menu: string, name: string) =>
      (
        await db
          .insert(menuSections)
          .values({ menuId: menu, name: { en: name } })
          .returning({ id: menuSections.id })
      )[0]!.id;
    const sectionId = await section(menuId, "Starters");
    const otherSectionId = await section(otherMenuId, "Mains");
    const menuItemId = (
      await db
        .insert(menuItems)
        .values({ menuId, productId, sectionId, grossPrice: 3 })
        .returning({ id: menuItems.id })
    )[0]!.id;
    // A variant as a `products` row under its parent, which is what an override names.
    const productVariant = async (parentId: string, name: string) =>
      (
        await db
          .insert(products)
          .values({ catalogueId: menuId, parentId, name, dietaryDeclarations: null })
          .returning({ id: products.id })
      )[0]!.id;
    const soupBowlId = await productVariant(productId, "Soup bowl");
    const breadLoafId = await productVariant(otherProductId, "Bread loaf");
    return {
      menuId,
      otherMenuId,
      productId,
      otherProductId,
      categoryId,
      unitId,
      sectionId,
      otherSectionId,
      menuItemId,
      soupBowlId,
      breadLoafId,
    };
  }

  /** One extras list, for the cases that need a list without needing what it offers. */
  async function extraList(name: string): Promise<string> {
    const rows = await db.insert(extraLists).values({ name }).returning({ id: extraLists.id });
    return rows[0]!.id;
  }

  /**
   * The statement is refused, as a foreign-key violation.
   *
   * **`key` is the assertion's LABEL, and nothing checks it against the engine.** SQLite reports a
   * foreign-key refusal as `FOREIGN KEY constraint failed` and names neither the constraint nor the
   * column (`constraintTarget`, `packages/db/src/constraint-target.ts`). What discriminates is that
   * each call below sends a statement with exactly ONE wrong value, so the class plus the statement
   * say which key fired.
   */
  async function refusal(write: () => Promise<unknown>, key: string) {
    const error = await captureError(write);
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION), key).toBe(true);
  }

  it("refuses a menu section or offer whose menu, product or section does not exist", async () => {
    const c = await catalogue();
    await refusal(
      () => db.insert(menuSections).values({ menuId: missing, name: { en: "X" } }),
      "menu_sections_menu_fk",
    );
    await refusal(
      () =>
        db.insert(menuItems).values({
          menuId: missing,
          productId: c.otherProductId,
          sectionId: c.sectionId,
          grossPrice: 1,
        }),
      "menu_items_menu_fk",
    );
    await refusal(
      () =>
        db.insert(menuItems).values({
          menuId: c.menuId,
          productId: missing,
          sectionId: c.sectionId,
          grossPrice: 1,
        }),
      "menu_items_product_fk",
    );
    await refusal(
      () =>
        db.insert(menuItems).values({
          menuId: c.menuId,
          productId: c.otherProductId,
          sectionId: missing,
          grossPrice: 1,
        }),
      "menu_items_section_fk",
    );
  });

  it("accepts an offer with a blank price, and still refuses a negative one", async () => {
    const c = await catalogue();
    const row = { menuId: c.menuId, productId: c.otherProductId, sectionId: c.sectionId };
    const error = await captureError(() => db.insert(menuItems).values({ ...row, grossPrice: -1 }));
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toContain("menu_items_gross_price_ck");
    const [blank] = await db
      .insert(menuItems)
      .values({ ...row, grossPrice: null })
      .returning({ grossPrice: menuItems.grossPrice });
    expect(blank).toEqual({ grossPrice: null });
  });

  it("refuses an offer placed in another menu's section", async () => {
    const c = await catalogue();
    await refusal(
      () =>
        db.insert(menuItems).values({
          menuId: c.menuId,
          productId: c.otherProductId,
          sectionId: c.otherSectionId,
          grossPrice: 1,
        }),
      "menu_items_section_fk",
    );
  });

  it("refuses category details whose category or parent does not exist", async () => {
    const c = await catalogue();
    await refusal(
      () => db.insert(categoryDetails).values({ categoryId: missing }),
      "category_details_category_fk",
    );
    await refusal(
      () => db.insert(categoryDetails).values({ categoryId: c.categoryId, parentId: missing }),
      "category_details_parent_fk",
    );
  });

  it("refuses a product label whose product or label does not exist, and a repeated label name", async () => {
    const c = await catalogue();
    const [label] = await db
      .insert(labels)
      .values({ name: "Alcoholic" })
      .returning({ id: labels.id });
    await refusal(
      () => db.insert(productLabels).values({ productId: missing, labelId: label!.id }),
      "product_labels_product_fk",
    );
    await refusal(
      () => db.insert(productLabels).values({ productId: c.productId, labelId: missing }),
      "product_labels_label_fk",
    );
    const repeated = await captureError(() => db.insert(labels).values({ name: "Alcoholic" }));
    expect(isRefusal(repeated, UNIQUE_VIOLATION)).toBe(true);
    // The accepting control: a real product and a real label.
    await expect(
      db.insert(productLabels).values({ productId: c.productId, labelId: label!.id }),
    ).resolves.toBeDefined();
  });

  it("refuses a unit assignment whose product or unit does not exist", async () => {
    const c = await catalogue();
    await refusal(
      () => db.insert(productUnits).values({ productId: missing, unitId: c.unitId }),
      "product_units_product_fk",
    );
    await refusal(
      () => db.insert(productUnits).values({ productId: c.productId, unitId: missing }),
      "product_units_unit_fk",
    );
  });

  it("refuses a variant override whose offer or variant does not exist or does not match", async () => {
    const c = await catalogue();
    const override = (values: { menuItemId: string; productId: string; variantId: string }) =>
      db.insert(menuItemVariantOverrides).values({ ...values, price: 100 });
    await refusal(
      () => override({ menuItemId: missing, productId: c.productId, variantId: c.soupBowlId }),
      "menu_item_variant_overrides_offer_fk",
    );
    // A real variant, but of a product this offer does not sell.
    await refusal(
      () =>
        override({
          menuItemId: c.menuItemId,
          productId: c.otherProductId,
          variantId: c.breadLoafId,
        }),
      "menu_item_variant_overrides_offer_fk",
    );
    // Another parent's variant under this offer's product.
    await refusal(
      () =>
        override({ menuItemId: c.menuItemId, productId: c.productId, variantId: c.breadLoafId }),
      "menu_item_variant_overrides_variant_fk",
    );
    // A top-level product is not a variant of anything.
    await refusal(
      () =>
        override({
          menuItemId: c.menuItemId,
          productId: c.productId,
          variantId: c.otherProductId,
        }),
      "menu_item_variant_overrides_variant_fk",
    );
    // The accepting control: this offer's product and one of its own variants.
    await expect(
      override({ menuItemId: c.menuItemId, productId: c.productId, variantId: c.soupBowlId }),
    ).resolves.toBeDefined();
  });

  it("refuses a variant override that overrides nothing, or a negative price", async () => {
    const c = await catalogue();
    const row = { menuItemId: c.menuItemId, productId: c.productId, variantId: c.soupBowlId };
    for (const [values, check] of [
      [{ price: null, offered: true }, "menu_item_variant_overrides_overrides_ck"],
      [{ price: -1, offered: true }, "menu_item_variant_overrides_price_ck"],
    ] as const) {
      const error = await captureError(() =>
        db.insert(menuItemVariantOverrides).values({ ...row, ...values }),
      );
      expect(isRefusal(error, CHECK_VIOLATION), check).toBe(true);
      expect(engineErrorMessage(error)).toContain(check);
    }
    // The two ways a row may override something are each accepted on their own.
    await db.insert(menuItemVariantOverrides).values({ ...row, price: null, offered: false });
    await db
      .update(menuItemVariantOverrides)
      .set({ price: 0, offered: true })
      .where(sql`${menuItemVariantOverrides.variantId} = ${c.soupBowlId}`);
  });

  it("drops an offer's variant overrides with the offer, and keeps an overridden variant", async () => {
    const c = await catalogue();
    await db.insert(menuItemVariantOverrides).values({
      menuItemId: c.menuItemId,
      productId: c.productId,
      variantId: c.soupBowlId,
      price: 250,
    });
    const error = await captureError(() =>
      db.delete(products).where(sql`${products.id} = ${c.soupBowlId}`),
    );
    // `on delete restrict` is refused through the engine's own trigger machinery, so it reports
    // errcode 1811 (SQLITE_CONSTRAINT_TRIGGER) rather than a plain key's 787.
    expect(error).toMatchObject({ errcode: 1811, message: "FOREIGN KEY constraint failed" });
    await db.delete(menuItems).where(sql`${menuItems.id} = ${c.menuItemId}`);
    expect(await db.select().from(menuItemVariantOverrides)).toEqual([]);
  });

  it("refuses a label whose options list does not exist", async () => {
    await refusal(
      () => db.insert(optionLabels).values({ listId: missing, name: "Rare" }),
      "option_labels_list_fk",
    );
  });

  it("refuses a published extras list whose menu offer or list does not exist", async () => {
    const c = await catalogue();
    const listId = await extraList("Breads");
    await refusal(
      () => db.insert(menuItemExtraLists).values({ menuItemId: missing, listId }),
      "menu_item_extra_lists_item_fk",
    );
    await refusal(
      () => db.insert(menuItemExtraLists).values({ menuItemId: c.menuItemId, listId: missing }),
      "menu_item_extra_lists_list_fk",
    );
  });

  it("refuses a menu override whose publication or product does not exist or does not match", async () => {
    const c = await catalogue();
    const listId = await extraList("Breads");
    const otherListId = await extraList("Sauces");
    await db.insert(menuItemExtraLists).values({ menuItemId: c.menuItemId, listId });
    await refusal(
      () =>
        db
          .insert(menuItemExtraItems)
          .values({ menuItemId: missing, listId, productId: c.productId }),
      "menu_item_extra_items_list_fk",
    );
    // The offer and the list both exist; what is wrong is that this offer does not publish THAT
    // list, so an override under it would be read by nothing.
    await refusal(
      () =>
        db.insert(menuItemExtraItems).values({
          menuItemId: c.menuItemId,
          listId: otherListId,
          productId: c.productId,
        }),
      "menu_item_extra_items_list_fk",
    );
    await refusal(
      () =>
        db
          .insert(menuItemExtraItems)
          .values({ menuItemId: c.menuItemId, listId, productId: missing }),
      "menu_item_extra_items_product_fk",
    );
  });

  it("refuses an extras item whose list or product does not exist", async () => {
    const c = await catalogue();
    const listId = await extraList("Breads");
    await refusal(
      () => db.insert(extraListItems).values({ listId: missing, productId: c.productId }),
      "extra_list_items_list_fk",
    );
    await refusal(
      () => db.insert(extraListItems).values({ listId, productId: missing }),
      "extra_list_items_product_fk",
    );
  });
});
