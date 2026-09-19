import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { captureError, CORE_MIGRATIONS, pgErrorCode, pgErrorMessage } from "@waitron/db";
import type { Database } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";

// PGlite applies the same migration files PostgreSQL does; these cases read the catalog and the
// foreign-key refusals, with no role or concurrency dimension.
const suite = usePgliteDb({
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
  "menu_item_option_groups",
  "menu_item_options",
  "category_details",
  "product_categories",
  "units",
  "unit_seed_states",
  "product_units",
  "product_variants",
  "menu_item_variants",
  "option_lists",
  "option_labels",
  "extra_lists",
  "extra_list_items",
  "menu_item_extra_lists",
  "menu_item_extra_items",
];

const tableList = () =>
  sql.join(
    TABLES.map((table) => sql`${table}`),
    sql`, `,
  );

describe("the catalogue migration set carries no tenant column", () => {
  it("has no tenant_id column on any table in the set", async () => {
    const rows = await db.execute<{ table_name: string }>(sql`
      select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'tenant_id' and table_name in (${tableList()})`);
    expect(rows.rows).toEqual([]);
  });

  it("keys and links every table on its own columns and each parent's primary key", async () => {
    const rows = await db.execute<{ name: string; def: string }>(sql`
      select conname as name, pg_get_constraintdef(oid) as def from pg_constraint
      where contype in ('p', 'u', 'f', 'c') and conrelid::regclass::text in (${tableList()})
      order by conname`);
    expect(Object.fromEntries(rows.rows.map((row) => [row.name, row.def]))).toEqual({
      category_details_category_fk:
        "FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE",
      category_details_category_id_pk: "PRIMARY KEY (category_id)",
      category_details_parent_fk:
        "FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE RESTRICT",
      content_languages_default_ck: "CHECK ((default_language = ANY (languages)))",
      content_languages_list_ck:
        "CHECK ((((cardinality(languages) >= 1) AND (cardinality(languages) <= 200)) AND (array_position(languages, NULL::text) IS NULL)))",
      content_languages_pkey: "PRIMARY KEY (id)",
      content_languages_singleton_ck: "CHECK ((id = 1))",
      extra_list_items_list_fk:
        "FOREIGN KEY (list_id) REFERENCES extra_lists(id) ON DELETE CASCADE",
      extra_list_items_pkey: "PRIMARY KEY (id)",
      extra_list_items_price_ck: "CHECK ((price >= (0)::numeric))",
      extra_list_items_product_fk:
        "FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT",
      extra_list_items_qty_ck: "CHECK ((max_quantity >= 1))",
      extra_lists_picks_ck:
        "CHECK (((min_picks >= 0) AND ((max_picks IS NULL) OR (max_picks >= min_picks))))",
      extra_lists_pkey: "PRIMARY KEY (id)",
      menu_item_extra_items_list_fk:
        "FOREIGN KEY (menu_item_id, list_id) REFERENCES menu_item_extra_lists(menu_item_id, list_id) ON DELETE CASCADE",
      menu_item_extra_items_pk: "PRIMARY KEY (menu_item_id, list_id, product_id)",
      menu_item_extra_items_price_ck: "CHECK ((price >= (0)::numeric))",
      menu_item_extra_items_product_fk:
        "FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT",
      menu_item_extra_lists_item_fk:
        "FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE",
      menu_item_extra_lists_list_fk:
        "FOREIGN KEY (list_id) REFERENCES extra_lists(id) ON DELETE CASCADE",
      menu_item_extra_lists_pk: "PRIMARY KEY (menu_item_id, list_id)",
      menu_item_option_groups_group_fk:
        "FOREIGN KEY (group_id) REFERENCES option_groups(id) ON DELETE CASCADE",
      menu_item_option_groups_item_fk:
        "FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE",
      menu_item_option_groups_pk: "PRIMARY KEY (menu_item_id, group_id)",
      menu_item_options_group_fk:
        "FOREIGN KEY (menu_item_id, group_id) REFERENCES menu_item_option_groups(menu_item_id, group_id) ON DELETE CASCADE",
      menu_item_options_option_fk:
        "FOREIGN KEY (option_id) REFERENCES option_group_items(id) ON DELETE CASCADE",
      menu_item_options_pk: "PRIMARY KEY (menu_item_id, option_id)",
      menu_item_variants_offer_fk:
        "FOREIGN KEY (menu_item_id, product_id) REFERENCES menu_items(id, product_id) ON DELETE CASCADE",
      menu_item_variants_pk: "PRIMARY KEY (menu_item_id, variant_id)",
      menu_item_variants_price_ck: "CHECK ((unit_price >= (0)::numeric))",
      menu_item_variants_variant_fk:
        "FOREIGN KEY (product_id, variant_id) REFERENCES product_variants(product_id, id) ON DELETE RESTRICT",
      menu_items_gross_price_ck: "CHECK ((gross_price >= (0)::numeric))",
      menu_items_id_product_key: "UNIQUE (id, product_id)",
      menu_items_menu_fk: "FOREIGN KEY (menu_id) REFERENCES catalogues(id) ON DELETE CASCADE",
      menu_items_menu_product_key: "UNIQUE (menu_id, product_id)",
      menu_items_pkey: "PRIMARY KEY (id)",
      menu_items_product_fk: "FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT",
      menu_items_section_fk:
        "FOREIGN KEY (menu_id, section_id) REFERENCES menu_sections(menu_id, id) ON DELETE RESTRICT",
      menu_sections_menu_fk: "FOREIGN KEY (menu_id) REFERENCES catalogues(id) ON DELETE CASCADE",
      menu_sections_menu_id_key: "UNIQUE (menu_id, id)",
      menu_sections_pkey: "PRIMARY KEY (id)",
      option_labels_list_fk: "FOREIGN KEY (list_id) REFERENCES option_lists(id) ON DELETE CASCADE",
      option_labels_pkey: "PRIMARY KEY (id)",
      option_lists_pkey: "PRIMARY KEY (id)",
      product_categories_category_fk:
        "FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT",
      product_categories_product_fk:
        "FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE",
      product_categories_product_id_category_id_pk: "PRIMARY KEY (product_id, category_id)",
      product_units_product_fk:
        "FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE",
      product_units_product_id_pk: "PRIMARY KEY (product_id)",
      product_units_unit_fk: "FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE RESTRICT",
      product_variants_pkey: "PRIMARY KEY (id)",
      product_variants_price_ck: "CHECK ((unit_price >= (0)::numeric))",
      product_variants_product_fk:
        "FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT",
      product_variants_product_id_key: "UNIQUE (product_id, id)",
      unit_seed_states_pkey: "PRIMARY KEY (id)",
      unit_seed_states_singleton_ck: "CHECK ((id = 1))",
      units_hardware_unit_ck:
        "CHECK ((hardware_unit = ANY (ARRAY['kg'::text, 'g'::text, 'mg'::text])))",
      units_pkey: "PRIMARY KEY (id)",
      units_precision_ck: 'CHECK ((("precision" >= 0) AND ("precision" <= 3)))',
      units_seed_key_key: "UNIQUE (seed_key)",
    });
  });

  it("rebuilds every lookup index without the tenant", async () => {
    const rows = await db.execute<{ name: string; def: string }>(sql`
      select indexname as name, indexdef as def from pg_indexes
      where schemaname = 'public' and tablename in (${tableList()})
        and indexname not in (select conname from pg_constraint)
      order by indexname`);
    const columns = Object.fromEntries(
      rows.rows.map((row) => [row.name, /USING btree \(([^)]*)\)/.exec(row.def)?.[1]]),
    );
    expect(columns).toEqual({
      category_details_parent_idx: "parent_id",
      extra_list_items_list_product_uq: "list_id, product_id",
      extra_list_items_list_sort_idx: "list_id, sort",
      menu_item_extra_items_list_product_idx: "list_id, product_id",
      menu_item_extra_lists_list_idx: "list_id",
      menu_items_menu_order_idx: "menu_id, display_order",
      menu_sections_menu_order_idx: "menu_id, display_order",
      option_labels_list_sort_idx: "list_id, sort",
      product_categories_category_idx: "category_id",
      product_units_unit_idx: "unit_id",
    });
  });
});

describe("the one-row catalogue tables hold at most one row", () => {
  it("refuses a second content-language policy", async () => {
    await db.execute(
      sql`insert into content_languages (default_language, languages) values ('en', array['en'])`,
    );
    const second = await captureError(() =>
      db.execute(
        sql`insert into content_languages (id, default_language, languages) values (2, 'es', array['es'])`,
      ),
    );
    expect(pgErrorCode(second)).toBe("23514");
    expect(pgErrorMessage(second)).toContain("content_languages_singleton_ck");
    const duplicate = await captureError(() =>
      db.execute(
        sql`insert into content_languages (default_language, languages) values ('es', array['es'])`,
      ),
    );
    expect(pgErrorCode(duplicate)).toBe("23505");
  });

  it("refuses a second unit-seed marker", async () => {
    await db.execute(sql`insert into unit_seed_states default values`);
    const second = await captureError(() =>
      db.execute(sql`insert into unit_seed_states (id) values (2)`),
    );
    expect(pgErrorCode(second)).toBe("23514");
    expect(pgErrorMessage(second)).toContain("unit_seed_states_singleton_ck");
    const duplicate = await captureError(() =>
      db.execute(sql`insert into unit_seed_states default values`),
    );
    expect(pgErrorCode(duplicate)).toBe("23505");
  });
});

describe("the catalogue foreign keys refuse a missing or mismatched target", () => {
  const missing = "00000000-0000-4000-8000-00000000dead";

  /** Rows seeded per test: the per-test reset empties every table after each case. */
  async function catalogue() {
    await seedTenant(db);
    const one = async (statement: ReturnType<typeof sql>) =>
      (await db.execute<{ id: string }>(statement)).rows[0]!.id;
    const menuId = await one(sql`insert into catalogues (name) values ('Lunch') returning id`);
    const otherMenuId = await one(
      sql`insert into catalogues (name) values ('Dinner') returning id`,
    );
    const product = (name: string) =>
      one(sql`insert into products (catalogue_id, name, pricing_unit, unit_price, vat_class) values (${menuId}, ${name}, 'each', 1, 'general')
        returning id`);
    const productId = await product("Soup");
    const otherProductId = await product("Bread");
    const categoryId = await one(
      sql`insert into categories (name) values ('{"en":"Food"}') returning id`,
    );
    const groupId = await one(
      sql`insert into option_groups (name) values ('{"en":"Size"}') returning id`,
    );
    const optionId = await one(
      sql`insert into option_group_items (group_id, name) values (${groupId}, '{"en":"Large"}') returning id`,
    );
    const unitId = await one(sql`insert into units (seed_key, name, abbreviation, precision)
      values ('each', '{"en":"each"}', '{"en":"ea"}', 0) returning id`);
    const sectionId = await one(sql`insert into menu_sections (menu_id, name)
      values (${menuId}, '{"en":"Starters"}') returning id`);
    const otherSectionId = await one(sql`insert into menu_sections (menu_id, name)
      values (${otherMenuId}, '{"en":"Mains"}') returning id`);
    const menuItemId =
      await one(sql`insert into menu_items (menu_id, product_id, section_id, gross_price)
      values (${menuId}, ${productId}, ${sectionId}, 3) returning id`);
    await db.execute(sql`insert into menu_item_option_groups (menu_item_id, group_id)
      values (${menuItemId}, ${groupId})`);
    const variantId = await one(sql`insert into product_variants (product_id, name, unit_price)
      values (${productId}, '{"en":"Bowl"}', 4) returning id`);
    const otherVariantId = await one(sql`insert into product_variants (product_id, name, unit_price)
      values (${otherProductId}, '{"en":"Loaf"}', 2) returning id`);
    return {
      menuId,
      otherMenuId,
      productId,
      otherProductId,
      categoryId,
      groupId,
      optionId,
      unitId,
      sectionId,
      otherSectionId,
      menuItemId,
      variantId,
      otherVariantId,
    };
  }

  /** One extras list, for the cases that need a list without needing what it offers. */
  async function extraList(name: string): Promise<string> {
    const rows = await db.execute<{ id: string }>(
      sql`insert into extra_lists (name) values (${name}) returning id`,
    );
    return rows.rows[0]!.id;
  }

  async function refusal(statement: ReturnType<typeof sql>, constraint: string) {
    const error = await captureError(() => db.transaction((tx) => tx.execute(statement)));
    expect(pgErrorCode(error), constraint).toBe("23503");
    expect(pgErrorMessage(error), constraint).toContain(constraint);
  }

  it("refuses a menu section or offer whose menu, product or section does not exist", async () => {
    const c = await catalogue();
    await refusal(
      sql`insert into menu_sections (menu_id, name) values (${missing}, '{"en":"X"}')`,
      "menu_sections_menu_fk",
    );
    await refusal(
      sql`insert into menu_items (menu_id, product_id, section_id, gross_price)
        values (${missing}, ${c.otherProductId}, ${c.sectionId}, 1)`,
      "menu_items_menu_fk",
    );
    await refusal(
      sql`insert into menu_items (menu_id, product_id, section_id, gross_price)
        values (${c.menuId}, ${missing}, ${c.sectionId}, 1)`,
      "menu_items_product_fk",
    );
    await refusal(
      sql`insert into menu_items (menu_id, product_id, section_id, gross_price)
        values (${c.menuId}, ${c.otherProductId}, ${missing}, 1)`,
      "menu_items_section_fk",
    );
  });

  it("refuses an offer placed in another menu's section", async () => {
    const c = await catalogue();
    await refusal(
      sql`insert into menu_items (menu_id, product_id, section_id, gross_price)
        values (${c.menuId}, ${c.otherProductId}, ${c.otherSectionId}, 1)`,
      "menu_items_section_fk",
    );
  });

  it("refuses offered modifiers whose offer, group or choice does not exist", async () => {
    const c = await catalogue();
    await refusal(
      sql`insert into menu_item_option_groups (menu_item_id, group_id) values (${missing}, ${c.groupId})`,
      "menu_item_option_groups_item_fk",
    );
    await refusal(
      sql`insert into menu_item_option_groups (menu_item_id, group_id) values (${c.menuItemId}, ${missing})`,
      "menu_item_option_groups_group_fk",
    );
    await refusal(
      sql`insert into menu_item_options (menu_item_id, group_id, option_id)
        values (${c.menuItemId}, ${missing}, ${c.optionId})`,
      "menu_item_options_group_fk",
    );
    await refusal(
      sql`insert into menu_item_options (menu_item_id, group_id, option_id)
        values (${c.menuItemId}, ${c.groupId}, ${missing})`,
      "menu_item_options_option_fk",
    );
  });

  it("refuses category details and memberships whose category or product does not exist", async () => {
    const c = await catalogue();
    await refusal(
      sql`insert into category_details (category_id) values (${missing})`,
      "category_details_category_fk",
    );
    await refusal(
      sql`insert into category_details (category_id, parent_id) values (${c.categoryId}, ${missing})`,
      "category_details_parent_fk",
    );
    await refusal(
      sql`insert into product_categories (product_id, category_id) values (${missing}, ${c.categoryId})`,
      "product_categories_product_fk",
    );
    await refusal(
      sql`insert into product_categories (product_id, category_id) values (${c.productId}, ${missing})`,
      "product_categories_category_fk",
    );
  });

  it("refuses a unit assignment whose product or unit does not exist", async () => {
    const c = await catalogue();
    await refusal(
      sql`insert into product_units (product_id, unit_id) values (${missing}, ${c.unitId})`,
      "product_units_product_fk",
    );
    await refusal(
      sql`insert into product_units (product_id, unit_id) values (${c.productId}, ${missing})`,
      "product_units_unit_fk",
    );
  });

  it("refuses variants whose product, offer or product variant does not exist or does not match", async () => {
    const c = await catalogue();
    await refusal(
      sql`insert into product_variants (product_id, name, unit_price) values (${missing}, '{"en":"X"}', 1)`,
      "product_variants_product_fk",
    );
    await refusal(
      sql`insert into menu_item_variants (menu_item_id, product_id, variant_id, unit_price)
        values (${missing}, ${c.productId}, ${c.variantId}, 1)`,
      "menu_item_variants_offer_fk",
    );
    await refusal(
      sql`insert into menu_item_variants (menu_item_id, product_id, variant_id, unit_price)
        values (${c.menuItemId}, ${c.otherProductId}, ${c.otherVariantId}, 1)`,
      "menu_item_variants_offer_fk",
    );
    await refusal(
      sql`insert into menu_item_variants (menu_item_id, product_id, variant_id, unit_price)
        values (${c.menuItemId}, ${c.productId}, ${missing}, 1)`,
      "menu_item_variants_variant_fk",
    );
    await refusal(
      sql`insert into menu_item_variants (menu_item_id, product_id, variant_id, unit_price)
        values (${c.menuItemId}, ${c.productId}, ${c.otherVariantId}, 1)`,
      "menu_item_variants_variant_fk",
    );
  });

  it("refuses a label whose options list does not exist", async () => {
    await refusal(
      sql`insert into option_labels (list_id, name) values (${missing}, 'Rare')`,
      "option_labels_list_fk",
    );
  });

  it("refuses a published extras list whose menu offer or list does not exist", async () => {
    const c = await catalogue();
    const listId = await extraList("Breads");
    await refusal(
      sql`insert into menu_item_extra_lists (menu_item_id, list_id) values (${missing}, ${listId})`,
      "menu_item_extra_lists_item_fk",
    );
    await refusal(
      sql`insert into menu_item_extra_lists (menu_item_id, list_id) values (${c.menuItemId}, ${missing})`,
      "menu_item_extra_lists_list_fk",
    );
  });

  it("refuses a menu override whose publication or product does not exist or does not match", async () => {
    const c = await catalogue();
    const listId = await extraList("Breads");
    const otherListId = await extraList("Sauces");
    await db.execute(
      sql`insert into menu_item_extra_lists (menu_item_id, list_id) values (${c.menuItemId}, ${listId})`,
    );
    await refusal(
      sql`insert into menu_item_extra_items (menu_item_id, list_id, product_id)
        values (${missing}, ${listId}, ${c.productId})`,
      "menu_item_extra_items_list_fk",
    );
    // The offer and the list both exist; what is wrong is that this offer does not publish THAT
    // list, so an override under it would be read by nothing.
    await refusal(
      sql`insert into menu_item_extra_items (menu_item_id, list_id, product_id)
        values (${c.menuItemId}, ${otherListId}, ${c.productId})`,
      "menu_item_extra_items_list_fk",
    );
    await refusal(
      sql`insert into menu_item_extra_items (menu_item_id, list_id, product_id)
        values (${c.menuItemId}, ${listId}, ${missing})`,
      "menu_item_extra_items_product_fk",
    );
  });

  it("refuses an extras item whose list or product does not exist", async () => {
    const c = await catalogue();
    const listId = await extraList("Breads");
    await refusal(
      sql`insert into extra_list_items (list_id, product_id) values (${missing}, ${c.productId})`,
      "extra_list_items_list_fk",
    );
    await refusal(
      sql`insert into extra_list_items (list_id, product_id) values (${listId}, ${missing})`,
      "extra_list_items_product_fk",
    );
  });
});
