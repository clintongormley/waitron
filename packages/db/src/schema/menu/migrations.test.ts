import { seedPhotoMetadata } from "@waitron/db/testing/seed.js";
import { eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  captureError,
  menus,
  CHECK_VIOLATION,
  CORE_MIGRATIONS,
  contentSuggestionJobs,
  extraListItems,
  extraLists,
  FOREIGN_KEY_VIOLATION,
  restrictRefused,
  isRefusal,
  menuItems,
  menuItemVariantOverrides,
  optionLabels,
  sections,
  units,
  categories as coreCategories,
  products,
  engineErrorMessage,
  UNIQUE_VIOLATION,
} from "../../index.js";
import type { Database } from "../../index.js";
import { useVenueDb } from "../../testing/venue-db.js";
import { seedPerson, seedTaxpayer } from "../../testing/seed.js";

// One SQLite file with the core set applied, which holds the menu's tables.
const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
  timeoutMs: 60_000,
});

let db: Database;
beforeAll(() => {
  db = suite.db;
});

const TABLES = [
  "menus",
  "menu_items",
  "categories",
  "units",
  "menu_item_variant_overrides",
  "set_menu_lines",
  "set_menu_line_courses",
  "set_menu_variant_exclusions",
  "set_menu_dish_courses",
  "option_lists",
  "option_labels",
  "extra_lists",
  "extra_list_items",
  "product_modifiers",
  "sections",
  "section_members",
  "menu_versions",
  "menu_releases",
  "menu_version_images",
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

describe("menu releases", () => {
  beforeEach(async () => {
    await seedPerson(db, { id: "publisher", displayName: "Test publisher" });
    await seedPerson(db, { id: "canceller", displayName: "Test canceller" });
  });
  async function version(menuId: string, number: number, createdBy = "publisher") {
    const id = crypto.randomUUID();
    await db.execute(sql`insert into menu_versions
      (id, menu_id, number, document, content_hash, created_at, created_by)
      values (${id}, ${menuId}, ${number}, '{}', 'hash', '2026-11-15T08:00:00.000Z', ${createdBy})`);
    return id;
  }
  async function menu() {
    const [row] = await db.insert(menus).values({ name: "Releases" }).returning();
    return row!.id;
  }
  const release = (
    versionId: string,
    menuId: string,
    state: string,
    cancelledAt: string | null = null,
    cancelledBy: string | null = null,
  ) =>
    db.execute(sql`insert into menu_releases (version_id, menu_id, state, activates_at, cancelled_at, cancelled_by)
      values (${versionId}, ${menuId}, ${state}, '2026-11-16T08:00:00.000Z', ${cancelledAt}, ${cancelledBy})`);

  it("refuses a version created by nobody and accepts a real publisher", async () => {
    const id = await menu();
    const error = await captureError(() => version(id, 1, "nobody"));
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
    const v = await version(id, 1);
    expect(
      (await db.execute(sql`select created_by from menu_versions where id = ${v}`)).rows,
    ).toEqual([{ created_by: "publisher" }]);
  });

  it("refuses a release cancelled by nobody and accepts a real canceller", async () => {
    const id = await menu();
    const v = await version(id, 1);
    const at = "2026-11-15T09:00:00.000Z";
    const error = await captureError(() => release(v, id, "cancelled", at, "nobody"));
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
    await release(v, id, "cancelled", at, "canceller");
    expect(
      (await db.execute(sql`select cancelled_by from menu_releases where version_id = ${v}`)).rows,
    ).toEqual([{ cancelled_by: "canceller" }]);
  });

  it("refuses deleting a publisher or canceller and permits deleting an unused person", async () => {
    const id = await menu();
    await seedPerson(db, { id: "unused", displayName: "Test unused" });
    await release(await version(id, 1), id, "cancelled", "2026-11-15T09:00:00.000Z", "canceller");
    for (const person of ["publisher", "canceller"]) {
      const error = await captureError(() =>
        db.execute(sql`delete from persons where id = ${person}`),
      );
      expect(restrictRefused(error)).toBe(true);
    }
    await db.execute(sql`delete from persons where id = 'unused'`);
    expect((await db.execute(sql`select id from persons order by id`)).rows).toEqual([
      { id: "canceller" },
      { id: "publisher" },
    ]);
  });

  it("refuses two live releases for one menu and permits another menu and a superseded release", async () => {
    const first = await menu();
    const second = await menu();
    await release(await version(first, 1), first, "live");
    const error = await captureError(() => releaseVersion(first, 2, "live"));
    expect(isRefusal(error, UNIQUE_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toContain("menu_releases.menu_id");
    await release(await version(second, 1), second, "live");
    await release(await version(first, 3), first, "superseded");
    expect((await db.execute(sql`select state from menu_releases order by state`)).rows).toEqual([
      { state: "live" },
      { state: "live" },
      { state: "superseded" },
    ]);
  });
  async function releaseVersion(menuId: string, number: number, state: string) {
    return release(await version(menuId, number), menuId, state);
  }

  it("refuses two queued editions at one instant and permits a cancelled release beside them", async () => {
    const id = await menu();
    await releaseVersion(id, 1, "queued");
    const error = await captureError(() => releaseVersion(id, 2, "queued"));
    expect(isRefusal(error, UNIQUE_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toContain(
      "menu_releases.menu_id, menu_releases.activates_at",
    );
    await release(await version(id, 3), id, "cancelled", "2026-11-15T09:00:00.000Z", "canceller");
    expect((await db.execute(sql`select state from menu_releases order by state`)).rows).toEqual([
      { state: "cancelled" },
      { state: "queued" },
    ]);
  });

  it("requires both cancellation facts only on a cancelled release", async () => {
    const id = await menu();
    let number = 0;
    for (const [state, at, by] of [
      ["cancelled", null, null],
      ["cancelled", "2026-11-15T09:00:00.000Z", null],
      ["cancelled", null, "canceller"],
      ["live", "2026-11-15T09:00:00.000Z", "canceller"],
      ["queued", null, "canceller"],
      ["superseded", "2026-11-15T09:00:00.000Z", null],
    ] as const) {
      const v = await version(id, ++number);
      const error = await captureError(() => release(v, id, state, at, by));
      expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
      expect(engineErrorMessage(error)).toContain("menu_releases_settled_ck");
    }
    for (const state of ["live", "queued", "superseded"]) await releaseVersion(id, ++number, state);
    await release(
      await version(id, number + 1),
      id,
      "cancelled",
      "2026-11-15T09:00:00.000Z",
      "canceller",
    );
    expect((await db.execute(sql`select count(*) as n from menu_releases`)).rows).toEqual([
      { n: 4 },
    ]);
  });

  it("refuses an unknown state and a release for another menu's version", async () => {
    const id = await menu();
    const other = await menu();
    const v = await version(id, 1);
    const stateError = await captureError(() => release(v, id, "paused"));
    expect(isRefusal(stateError, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(stateError)).toContain("menu_releases_state_ck");
    const keyError = await captureError(() => release(v, other, "queued"));
    expect(isRefusal(keyError, FOREIGN_KEY_VIOLATION)).toBe(true);
    await release(v, id, "queued");
    expect((await db.execute(sql`select version_id from menu_releases`)).rows).toEqual([
      { version_id: v },
    ]);
  });
});

it("refuses a root section with a name and a plain section without one", async () => {
  const [menu] = await db.insert(menus).values({ name: "Root names" }).returning({ id: menus.id });
  for (const [role, name] of [
    ["menu_root", "Duplicate"],
    ["section", null],
    ["home_layout", null],
  ]) {
    const error = await captureError(() =>
      db.execute(sql`
      insert into sections (id, role, internal_name, owner_menu_id)
      values (${crypto.randomUUID()}, ${role}, ${name}, ${menu!.id})
    `),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toContain("sections_root_name_ck");
  }
  for (const [role, name] of [
    ["menu_root", null],
    ["section", "Starters"],
    ["home_layout", "Home"],
  ]) {
    await db.execute(sql`
      insert into sections (id, role, internal_name, owner_menu_id)
      values (${crypto.randomUUID()}, ${role}, ${name}, ${menu!.id})
    `);
  }
  expect(
    (await db.select().from(sections)).map(({ role, internalName }) => ({ role, internalName })),
  ).toEqual(
    expect.arrayContaining([
      { role: "menu_root", internalName: null },
      { role: "section", internalName: "Starters" },
      { role: "home_layout", internalName: "Home" },
    ]),
  );
});

it("refuses inconsistent fixed folder values and non-object names, and accepts the three folder states", async () => {
  const [menu] = await db.insert(menus).values({ name: "Folder columns" }).returning();
  const [section] = await db
    .insert(sections)
    .values({ internalName: "List", ownerMenuId: menu!.id })
    .returning();
  const image = `${"a".repeat(64)}.webp`;
  await seedPhotoMetadata(db, { filename: image, names: {} });
  const member = crypto.randomUUID();
  await db.execute(sql`insert into section_members (id, section_id, position, missing_name)
    values (${member}, ${section!.id}, 0, 'Missing')`);
  for (const [column, value, check] of [
    ["folder_image", image, "section_members_folder_image_ck"],
    ["folder_color", "#112233", "section_members_folder_color_ck"],
    ...["[]", "3", "nope"].map((value) => [
      "folder_names",
      value,
      "section_members_folder_names_ck",
    ]),
  ]) {
    const error = await captureError(() =>
      db.execute(sql`update section_members
      set ${sql.raw(column!)} = ${value} where id = ${member}`),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toContain(check);
  }
  for (const [imageFixed, imageValue, colorFixed, colorValue, names] of [
    [0, null, 0, null, null],
    [1, null, 1, null, null],
    [1, image, 1, "#112233", '{"es":"Desserts"}'],
  ]) {
    await db.execute(sql`update section_members set folder_image_fixed = ${imageFixed}, folder_image = ${imageValue},
      folder_color_fixed = ${colorFixed}, folder_color = ${colorValue}, folder_names = ${names} where id = ${member}`);
    expect(
      (
        await db.execute(sql`select folder_image_fixed, folder_image, folder_color_fixed, folder_color, folder_names
      from section_members where id = ${member}`)
      ).rows,
    ).toEqual([
      {
        folder_image_fixed: imageFixed,
        folder_image: imageValue,
        folder_color_fixed: colorFixed,
        folder_color: colorValue,
        folder_names: names,
      },
    ]);
  }
});

it("a lookup of sections by photo uses sections_image_idx", async () => {
  const plan = await db.execute<{ detail: string }>(
    sql`explain query plan select 1 from sections where image = ${"photo"}`,
  );
  expect(plan.rows.map((row) => row.detail).join(" ")).toContain(
    "USING COVERING INDEX sections_image_idx",
  );
});

it("has no per-menu extras tables", async () => {
  const rows = await db.execute<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' and name in ('menu_item_extra_lists', 'menu_item_extra_items')`,
  );
  expect(rows.rows).toEqual([]);
});

it("gives menus six required display settings with their defaults", async () => {
  const columns = (
    await db.execute<{ name: string; type: string; notnull: number; dflt_value: string | null }>(
      sql`pragma table_info('menus')`,
    )
  ).rows
    .filter((column) => /^(handheld|till)_/.test(column.name))
    .map(
      ({ name, type, notnull, dflt_value }) =>
        `${name} ${type.toLowerCase()} ${notnull} ${dflt_value}`,
    );
  expect(columns).toEqual([
    "handheld_columns integer 1 3",
    "handheld_tiles text 1 'colours'",
    "handheld_order text 1 'home_first'",
    "till_columns integer 1 6",
    "till_tiles text 1 'colours'",
    "till_order text 1 'home_first'",
  ]);
});

describe("the menu tables carry no taxpayer column", () => {
  it("has no tenant_id column on any table in the set", async () => {
    const found: string[] = [];
    for (const table of TABLES)
      for (const column of await columnsOf(table))
        if (column.name === "tenant_id") found.push(`${table}.${column.name}`);
    expect(found).toEqual([]);
  });

  /**
   * The keys and links, read through the menus SQLite has.
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
      menus: "id",
      menu_items: "id",
      categories: "id",
      units: "id",
      menu_item_variant_overrides: "menu_item_id, variant_id",
      set_menu_lines: "id",
      set_menu_line_courses: "line_id, course_id",
      set_menu_variant_exclusions: "menu_item_id, variant_id",
      set_menu_dish_courses: "menu_item_id",
      option_lists: "id",
      option_labels: "id",
      extra_lists: "id",
      extra_list_items: "id",
      product_modifiers: "id",
      sections: "id",
      section_members: "id",
      menu_versions: "id",
      menu_releases: "version_id",
      menu_version_images: "version_id, filename",
    });

    expect(foreignKeys).toEqual({
      "categories(parent_id)": "categories(id) on delete restrict",
      "extra_list_items(list_id)": "extra_lists(id) on delete cascade",
      "extra_list_items(product_id)": "products(id) on delete restrict",
      "menu_item_variant_overrides(menu_item_id, product_id)":
        "menu_items(id, product_id) on delete cascade",
      "menu_item_variant_overrides(product_id, variant_id)":
        "products(parent_id, id) on delete restrict",
      "set_menu_lines(menu_id)": "menus(id) on delete cascade",
      "set_menu_line_courses(line_id)": "set_menu_lines(id) on delete cascade",
      "set_menu_line_courses(course_id)": "kitchen_courses(id) on delete no action",
      "set_menu_dish_courses(menu_item_id)": "menu_items(id) on delete cascade",
      "set_menu_dish_courses(course_id)": "kitchen_courses(id) on delete no action",
      "set_menu_variant_exclusions(menu_item_id, product_id)":
        "menu_items(id, product_id) on delete cascade",
      "set_menu_variant_exclusions(product_id, variant_id)":
        "products(parent_id, id) on delete restrict",
      "menu_items(menu_id)": "menus(id) on delete cascade",
      "menu_items(product_id)": "products(id) on delete restrict",
      "option_labels(list_id)": "option_lists(id) on delete cascade",
      "product_modifiers(extra_list_id)": "extra_lists(id) on delete cascade",
      "product_modifiers(option_list_id)": "option_lists(id) on delete cascade",
      "product_modifiers(product_id)": "products(id) on delete cascade",
      "section_members(child_section_id)": "sections(id) on delete cascade",
      "section_members(product_id)": "products(id) on delete cascade",
      "section_members(section_id)": "sections(id) on delete cascade",
      "sections(owner_menu_id)": "menus(id) on delete no action",
      "menu_versions(created_by)": "persons(id) on delete restrict",
      "menu_releases(cancelled_by)": "persons(id) on delete restrict",
      "menu_versions(menu_id)": "menus(id) on delete no action",
      "menu_releases(menu_id)": "menus(id) on delete no action",
      "menu_releases(version_id, menu_id)": "menu_versions(id, menu_id) on delete no action",
      "menu_version_images(version_id)": "menu_versions(id) on delete no action",
    });

    expect(checks).toEqual({
      menus_handheld_columns_ck: `"menus"."handheld_columns" between 2 and 3`,
      menus_till_columns_ck: `"menus"."till_columns" between 4 and 10`,
      menus_handheld_tiles_ck: `"menus"."handheld_tiles" in ('colours', 'thumbnails')`,
      menus_till_tiles_ck: `"menus"."till_tiles" in ('colours', 'thumbnails')`,
      menus_handheld_order_ck: `"menus"."handheld_order" in ('home_first', 'menu_first')`,
      menus_till_order_ck: `"menus"."till_order" in ('home_first', 'menu_first')`,
      menus_kind_ck: `"menus"."kind" in ('menu', 'set_menu')`,
      menus_set_not_default_ck: `"menus"."kind" = 'menu' or "menus"."is_default" = 0`,
      menus_set_price_ck: `"menus"."set_price" is null or "menus"."set_price" >= 0`,
      menus_set_terms_ck: `("menus"."kind" = 'set_menu' and "menus"."set_price" is not null and "menus"."set_vat_class" is not null)
        or ("menus"."kind" = 'menu' and "menus"."set_price" is null and "menus"."set_vat_class" is null)`,
      menus_set_vat_class_ck: `"menus"."set_vat_class" in ('general','reduced','super_reduced','zero')`,
      set_menu_lines_count_ck: `"set_menu_lines"."count" between 1 and 99`,
      menu_items_gross_price_ck: `"menu_items"."gross_price" >= 0`,
      units_precision_ck: `"units"."precision" between 0 and 3`,
      units_hardware_unit_ck: `"units"."hardware_unit" in ('kg', 'g', 'mg')`,
      menu_item_variant_overrides_price_ck: `"menu_item_variant_overrides"."price" >= 0`,
      menu_item_variant_overrides_overrides_ck: `"menu_item_variant_overrides"."price" is not null`,
      extra_lists_picks_ck: `"extra_lists"."min_picks" >= 0 and ("extra_lists"."max_picks" is null or ("extra_lists"."max_picks" >= 1 and "extra_lists"."max_picks" >= "extra_lists"."min_picks"))`,
      extra_lists_name_ck: `trim("extra_lists"."name") <> ''`,
      option_lists_name_ck: `trim("option_lists"."name") <> ''`,
      option_labels_name_ck: `trim("option_labels"."name") <> ''`,
      extra_list_items_qty_ck: `"extra_list_items"."max_quantity" >= 1`,
      extra_list_items_price_ck: `"extra_list_items"."price" >= 0`,
      extra_list_items_portion_ck: `"extra_list_items"."portion" > 0`,
      product_modifiers_one_reference_ck: `("product_modifiers"."extra_list_id" is null) <> ("product_modifiers"."option_list_id" is null)`,
      sections_root_name_ck: `("sections"."role" = 'menu_root') = ("sections"."internal_name" is null)`,
      sections_role_ck: `"sections"."role" in ('section', 'menu_root', 'home_layout')`,
      section_members_folder_names_ck: `json_valid("section_members"."folder_names") and json_type("section_members"."folder_names") = 'object'`,
      section_members_folder_image_ck: `"section_members"."folder_image" is null or "section_members"."folder_image_fixed" = 1`,
      section_members_folder_color_ck: `"section_members"."folder_color" is null or "section_members"."folder_color_fixed" = 1`,
      section_members_one_ref_ck: `("section_members"."product_id" is null or "section_members"."child_section_id" is null) and (("section_members"."product_id" is null and "section_members"."child_section_id" is null) = ("section_members"."missing_name" is not null))`,
      menu_releases_state_ck: `"menu_releases"."state" in ('queued', 'live', 'superseded', 'cancelled')`,
      menu_releases_settled_ck: `("menu_releases"."state" = 'cancelled') = ("menu_releases"."cancelled_at" is not null) and ("menu_releases"."cancelled_at" is null) = ("menu_releases"."cancelled_by" is null)`,
      menu_versions_number_ck: `"menu_versions"."number" >= 1`,
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
  it("declares exactly these indexes", async () => {
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
      categories_parent_idx: { unique: false, columns: "parent_id" },
      extra_list_items_list_product_uq: { unique: true, columns: "list_id, product_id" },
      extra_list_items_list_sort_idx: { unique: false, columns: "list_id, sort" },
      sections_one_root_per_menu_uq: { unique: true, columns: "owner_menu_id, role" },
      menus_one_default_uq: { unique: true, columns: "is_default" },
      set_menu_lines_position_idx: { unique: false, columns: "menu_id, position" },
      set_menu_line_courses_course_idx: { unique: false, columns: "course_id" },
      set_menu_dish_courses_course_idx: { unique: false, columns: "course_id" },
      menu_items_id_product_key: { unique: true, columns: "id, product_id" },
      menu_items_menu_product_key: { unique: true, columns: "menu_id, product_id" },
      option_labels_list_sort_idx: { unique: false, columns: "list_id, sort" },
      option_labels_one_default_uq: { unique: true, columns: "list_id" },
      product_modifiers_product_extra_uq: { unique: true, columns: "product_id, extra_list_id" },
      product_modifiers_product_option_uq: { unique: true, columns: "product_id, option_list_id" },
      product_modifiers_product_sort_idx: { unique: false, columns: "product_id, sort" },
      units_seed_key_key: { unique: true, columns: "seed_key" },
      sections_image_idx: { unique: false, columns: "image" },
      sections_owner_menu_idx: { unique: false, columns: "owner_menu_id" },
      section_members_product_uq: { unique: true, columns: "section_id, product_id" },
      section_members_child_uq: { unique: true, columns: "section_id, child_section_id" },
      section_members_order_idx: { unique: false, columns: "section_id, position" },
      section_members_child_idx: { unique: false, columns: "child_section_id" },
      section_members_product_idx: { unique: false, columns: "product_id" },
      // One expression column, which `pragma index_info` reports with no name.
      section_members_folder_image_idx: { unique: false, columns: "folder_image" },
      menu_versions_menu_number_uq: { unique: true, columns: "menu_id, number" },
      menu_versions_id_menu_key: { unique: true, columns: "id, menu_id" },
      menu_version_images_filename_idx: { unique: false, columns: "filename" },
      menu_releases_one_live_uq: { unique: true, columns: "menu_id" },
      menu_releases_queued_time_uq: {
        unique: true,
        columns: "menu_id, activates_at",
      },
    });
  });
});

describe("core's set keeps no category membership table", () => {
  it("leaves no product_categories behind: a product's one main category is products.category_id", async () => {
    const left = (
      await db.execute<{ name: string }>(
        sql`select name from sqlite_master where type = 'table' and name = 'product_categories'`,
      )
    ).rows;
    expect(left).toEqual([]);
  });
});

describe("core's set keeps no per-menu section table", () => {
  it("leaves no menu_sections behind: a menu's structure is sections the menu owns", async () => {
    const left = (
      await db.execute<{ name: string }>(
        sql`select name from sqlite_master where type = 'table' and name = 'menu_sections'`,
      )
    ).rows;
    expect(left).toEqual([]);
  });
});

describe("core's set keeps no product labels", () => {
  it("leaves no labels tables", async () => {
    const { rows } = await db.execute<{ name: string }>(
      sql`select name from sqlite_master where type = 'table' and name in ('labels', 'product_labels')`,
    );
    expect(rows).toEqual([]);
  });
});

describe("core's set keeps no variant table of its own", () => {
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

describe("the menu foreign keys refuse a missing or mismatched target", () => {
  const missing = "00000000-0000-4000-8000-00000000dead";

  /** Rows seeded per test: the per-test reset empties the data tables after each case. */
  async function menu() {
    await seedTaxpayer(db);
    const menuId = (
      await db.insert(menus).values({ name: "Lunch" }).returning({ id: menus.id })
    )[0]!.id;
    const otherMenuId = (
      await db.insert(menus).values({ name: "Dinner" }).returning({ id: menus.id })
    )[0]!.id;
    const product = async (name: string) =>
      (
        await db
          .insert(products)
          .values({
            name,

            unitPrice: 1,
            vatClass: "general",
          })
          .returning({ id: products.id })
      )[0]!.id;
    const productId = await product("Soup");
    const otherProductId = await product("Bread");
    const categoryId = (
      await db.insert(coreCategories).values({ name: "Food" }).returning({ id: coreCategories.id })
    )[0]!.id;
    const unitId = (
      await db
        .insert(units)
        .values({
          staffName: "Staff unit",
          staffAbbreviation: "su",
          seedKey: "each",
          name: { en: "each" },
          abbreviation: { en: "ea" },
          precision: 0,
        })
        .returning({ id: units.id })
    )[0]!.id;
    const ownedList = async (menu: string, role: "menu_root" | "home_layout") =>
      (
        await db
          .insert(sections)
          .values({ internalName: role === "menu_root" ? null : role, role, ownerMenuId: menu })
          .returning({ id: sections.id })
      )[0]!.id;
    const rootId = await ownedList(menuId, "menu_root");
    const layoutId = await ownedList(menuId, "home_layout");
    const menuItemId = (
      await db
        .insert(menuItems)
        .values({ menuId, productId, grossPrice: 3 })
        .returning({ id: menuItems.id })
    )[0]!.id;
    // A variant as a `products` row under its parent, which is what an override names.
    const productVariant = async (parentId: string, name: string) =>
      (
        await db
          .insert(products)
          .values({ parentId, name, dietaryDeclarations: null })
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
      rootId,
      layoutId,
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

  it("refuses an offer whose menu or product does not exist", async () => {
    const c = await menu();
    await refusal(
      () =>
        db.insert(menuItems).values({
          menuId: missing,
          productId: c.otherProductId,
          grossPrice: 1,
        }),
      "menu_items_menu_fk",
    );
    await refusal(
      () =>
        db.insert(menuItems).values({
          menuId: c.menuId,
          productId: missing,
          grossPrice: 1,
        }),
      "menu_items_product_fk",
    );
  });

  it("accepts an offer with a blank price, and still refuses a negative one", async () => {
    const c = await menu();
    const row = { menuId: c.menuId, productId: c.otherProductId };
    const error = await captureError(() => db.insert(menuItems).values({ ...row, grossPrice: -1 }));
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toContain("menu_items_gross_price_ck");
    const [blank] = await db
      .insert(menuItems)
      .values({ ...row, grossPrice: null })
      .returning({ grossPrice: menuItems.grossPrice });
    expect(blank).toEqual({ grossPrice: null });
  });

  it("refuses a category parent that does not exist", async () => {
    const c = await menu();
    await refusal(
      () =>
        db
          .update(coreCategories)
          .set({ parentId: missing })
          .where(eq(coreCategories.id, c.categoryId)),
      "categories_parent_fk",
    );
  });

  it("refuses a product's unit when that unit does not exist", async () => {
    const c = await menu();
    const error = await captureError(() =>
      db
        .update(products)
        .set({ unitId: missing })
        .where(sql`${products.id} = ${c.productId}`),
    );
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toBe("FOREIGN KEY constraint failed");
  });

  it("refuses a variant override whose offer or variant does not exist or does not match", async () => {
    const c = await menu();
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

  it("refuses a variant override with no price, or a negative price, and accepts 0", async () => {
    const c = await menu();
    const row = { menuItemId: c.menuItemId, productId: c.productId, variantId: c.soupBowlId };
    for (const [price, check] of [
      [null, "menu_item_variant_overrides_overrides_ck"],
      [-1, "menu_item_variant_overrides_price_ck"],
    ] as const) {
      const error = await captureError(() =>
        db.insert(menuItemVariantOverrides).values({ ...row, price }),
      );
      expect(isRefusal(error, CHECK_VIOLATION), check).toBe(true);
      expect(engineErrorMessage(error)).toContain(check);
    }
    await db.insert(menuItemVariantOverrides).values({ ...row, price: 0 });
    expect(await db.select().from(menuItemVariantOverrides)).toEqual([{ ...row, price: 0 }]);
  });

  it("drops an offer's variant overrides with the offer, and keeps an overridden variant", async () => {
    const c = await menu();
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

  it("refuses an extras item whose list or product does not exist", async () => {
    const c = await menu();
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

it("has no offered column on either table, and no retired item active column", async () => {
  const columnsOf = async (table: string) =>
    (
      await db.execute<{ name: string }>(sql`select name from pragma_table_info(${table})`)
    ).rows.map((column) => column.name);
  const items = await columnsOf("menu_items");
  expect(items).toEqual(["id", "menu_id", "product_id", "gross_price"]);
  expect(await columnsOf("menu_item_variant_overrides")).toEqual([
    "menu_item_id",
    "product_id",
    "variant_id",
    "price",
  ]);
  expect(items).not.toContain("active");
});

describe("a suggestion run total belongs only to its first batch", () => {
  it.each([
    [1, null],
    [2, 5],
  ])("refuses position %s with total %s", async (position, runTotal) => {
    const error = await captureError(() =>
      db
        .insert(contentSuggestionJobs)
        .values({ runId: crypto.randomUUID(), position, runTotal, state: "submitting", sent: {} }),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toContain("content_suggestion_jobs_run_total_ck");
  });
  it.each([
    [1, 5],
    [2, null],
  ])("accepts position %s with total %s", async (position, runTotal) => {
    const [row] = await db
      .insert(contentSuggestionJobs)
      .values({ runId: crypto.randomUUID(), position, runTotal, state: "submitting", sent: {} })
      .returning();
    expect(row).toMatchObject({ position, runTotal });
  });
});

describe("option defaults and list checks", () => {
  it("refuses a second preselected label in one list", async () => {
    await db.execute(sql`insert into option_lists(id,name) values ('a','Cooking'),('b','Spice')`);
    await db.execute(sql`
      insert into option_labels(id,list_id,name,is_default) values
      ('one','a','Rare',1),('two','b','Mild',1),('three','a','Medium',0),('four','a','Well',0)
    `);
    expect((await db.execute(sql`select count(*) as n from option_labels`)).rows).toEqual([
      { n: 4 },
    ]);
    const error = await captureError(() =>
      db.execute(sql`
      insert into option_labels(id,list_id,name,is_default) values ('five','a','Blue',1)
    `),
    );
    expect(isRefusal(error, UNIQUE_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toContain("option_labels.list_id");
  });

  it("refuses an extras maximum of 0 and accepts valid bounds", async () => {
    const error = await captureError(() =>
      db.insert(extraLists).values({ name: "Sides", minPicks: 0, maxPicks: 0 }),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toContain("extra_lists_picks_ck");
    for (const [minPicks, maxPicks] of [
      [0, null],
      [0, 1],
      [2, 2],
    ] as const) {
      const [row] = await db
        .insert(extraLists)
        .values({ name: "Sides", minPicks, maxPicks })
        .returning({ minPicks: extraLists.minPicks, maxPicks: extraLists.maxPicks });
      expect(row).toEqual({ minPicks, maxPicks });
    }
  });

  it.each(["option_lists", "option_labels", "extra_lists"] as const)(
    "refuses a blank name in %s",
    async (table) => {
      await db.execute(sql`insert into option_lists(id,name) values ('list','Cooking')`);
      for (const name of ["", "  "]) {
        const error = await captureError(() =>
          table === "option_labels"
            ? db.execute(
                sql`insert into option_labels(id,list_id,name) values ('label','list',${name})`,
              )
            : db.execute(sql`insert into ${sql.identifier(table)}(id,name) values ('new',${name})`),
        );
        expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
        expect(engineErrorMessage(error)).toContain(`${table}_name_ck`);
      }
      await (table === "option_labels"
        ? db.execute(
            sql`insert into option_labels(id,list_id,name) values ('label','list','Choice')`,
          )
        : db.execute(sql`insert into ${sql.identifier(table)}(id,name) values ('new','Choice')`));
      expect(
        (
          await db.execute(
            sql`select name from ${sql.identifier(table)} where id = ${table === "option_labels" ? "label" : "new"}`,
          )
        ).rows,
      ).toEqual([{ name: "Choice" }]);
    },
  );
});
