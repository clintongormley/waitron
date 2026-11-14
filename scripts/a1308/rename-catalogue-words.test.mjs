import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { rewriteWords, run, clashes, LOCAL_RENAMES, main } from "./rename-catalogue-words.mjs";

const roots = [];
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "mn3-words-"));
  roots.push(root);
  execFileSync("git", ["init", "-q"], { cwd: root, env });
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(root, file, ".."), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  execFileSync("git", ["add", "."], { cwd: root, env });
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});
const rewrite = (text, file = "packages/menu/src/x.ts") => rewriteWords(text, file).text;

it("applies the Products names and error keys before the catch-all", () => {
  expect(
    rewrite(
      '"nav.catalogue" "catalogue.title" "catalogue.not_found" CatalogueScreen CatalogueSelection cataloguePrice CatalogueSettings',
    ),
  ).toBe(
    '"nav.products" "products.title" "menu.not_found" ProductsScreen ProductSelection productPrice MenuDefaults',
  );
  expect(
    rewrite('"catalogue_settings.no_vat" CatalogueFormsApp #zoneCatalogues ZoneOfferCatalogue'),
  ).toBe('"menu_settings.no_vat" ProductFormsApp #zoneOffers ZoneOffers');
});
it("limits dashboard screen ids and addresses to the dashboard", () => {
  expect(rewrite('screen: "catalogue"; /catalogue/a', "apps/dashboard/src/x.ts")).toBe(
    'screen: "products"; /products/a',
  );
  expect(rewrite('screen: "catalogue"', "packages/composition/src/modules.ts")).toBe(
    'screen: "menu"',
  );
});
it("renames Products route roots and navigation keys without renaming the module to products", () => {
  expect(
    rewrite(
      'const url = "/manage/catalogue"; const modules = { modules: ["catalogue"] };',
      "apps/dashboard/src/example.ts",
    ),
  ).toBe('const url = "/manage/products"; const modules = { modules: ["menu"] };');
  expect(
    rewrite('children: { catalogue: { product: "product" } }', "apps/dashboard/src/navigation.ts"),
  ).toBe('children: { products: { product: "product" } }');
});
it("keeps case and plural inside identifiers", () => {
  expect(rewrite("CATALOGUE_TABLES useCatalogueDb catalogue_id Catalogues catalogues")).toBe(
    "MENU_TABLES useMenuDb menu_id Menus menus",
  );
});
it("keeps translation, guide and job-inventory tokens everywhere and reports them", () => {
  const result = rewriteWords(
    'registerCatalogue(strings); I18N_CATALOGUES helpCatalogues import "./guide-catalogue.js"; JOB_CATALOGUE job-catalogue.ts',
    "apps/server/src/x.ts",
  );
  expect(result.text).toBe(
    'registerCatalogue(strings); I18N_CATALOGUES helpCatalogues import "./guide-catalogue.js"; JOB_CATALOGUE job-catalogue.ts',
  );
  expect(result.kept.map(({ rule }) => rule)).toEqual(["K1", "K1", "K1", "K1", "K8", "K8"]);
});
it("keeps string-catalogue words while still renaming exact keys", () => {
  expect(
    rewrite(
      'export const catalogues = {}; "nav.catalogue": "Products";',
      "apps/dashboard/src/i18n/strings.ts",
    ),
  ).toBe('export const catalogues = {}; "nav.products": "Products";');
});
it.each([
  ["packages/fiscal-verifactu/src/inmutabilidad.test.ts", "database catalogue", "K3"],
  ["packages/store/src/append-only.ts", "CatalogueTarget", "K5"],
  ["packages/staffing/src/dashboard/painter-parts.ts", "catalogueText", "K6"],
  ["docs/developers/testing-guide.md", "AEAT error catalogue", "K7"],
  ["apps/server/src/job-catalogue.test.ts", "job catalogue", "K8"],
])("keeps the other meaning in %s", (file, text, rule) => {
  expect(rewriteWords(text, file)).toMatchObject({
    text,
    kept: [{ rule, line: 1, snippet: text }],
  });
});
it("keeps historical Madrid input names while renaming live semantics", () => {
  expect(
    rewrite(
      "original.tables.catalogue_settings; delete result.tables.catalogue_settings;",
      "apps/server/scripts/demo-seed/testing/madrid-documents.ts",
    ),
  ).toBe("original.tables.catalogue_settings; delete result.tables.catalogue_settings;");
  expect(
    rewrite(
      '"location_catalogues"; { catalogue_id: "id" }; targetTable: "catalogues";',
      "apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts",
    ),
  ).toBe('"location_catalogues"; { catalogue_id: "id" }; targetTable: "catalogues";');
  expect(
    rewrite('case "catalogues":', "apps/server/scripts/demo-seed/testing/madrid-semantics.ts"),
  ).toBe('case "menus":');
});
it("keeps new Madrid rename maps historical across reruns", () => {
  const input = '{ catalogues: "menus" }; { catalogue_id: "menu_id" }; phases.catalogues;';
  expect(rewrite(input, "apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts")).toBe(input);
});
it("keeps a zone offers answer separate from each menu it contains", () => {
  expect(
    rewrite(
      "const catalogue = {}; catalogue.menus.map(menu => menu.id);",
      "apps/till/src/till-app.ts",
    ),
  ).toBe("const zoneOffers = {}; zoneOffers.menus.map(menu => menu.id);");
});
it("limits the product price property to CombineInput consumers", () => {
  expect(rewrite("const x: CombineInput = { catalogue: { price } }; x.catalogue;")).toBe(
    "const x: CombineInput = { product: { price } }; x.product;",
  );
  expect(rewrite("const x = { catalogue: { price } };")).toBe("const x = { menu: { price } };");
});
it("renames only CombineInput identifiers before dashboard paths", () => {
  const input =
    'type Price = CombineInput["catalogue"]; const value: CombineInput = { catalogue: { price } }; value.catalogue; const url = "/manage/catalogue/product/1";';
  expect(rewrite(input, "apps/dashboard/src/widgets/example.ts")).toBe(
    'type Price = CombineInput["product"]; const value: CombineInput = { product: { price } }; value.product; const url = "/manage/products/product/1";',
  );
});
it("renames a listed local without changing property keys", () => {
  LOCAL_RENAMES.push({ file: "packages/menu/src/example.ts", name: "menus", to: "menuRows" });
  try {
    expect(
      rewrite(
        "const menus = tx.select({ id: catalogues.id }).from(catalogues); row.menus; row?.menus; ({ menus: 1 });",
        "packages/menu/src/example.ts",
      ),
    ).toBe(
      "const menuRows = tx.select({ id: menus.id }).from(menus); row.menus; row?.menus; ({ menus: 1 });",
    );
  } finally {
    LOCAL_RENAMES.pop();
  }
});
it("renames typed local parameters and preserves shorthand object keys", () => {
  const row = { file: "packages/menu/src/typed.ts", name: "menus", to: "menuRows" };
  LOCAL_RENAMES.push(row);
  try {
    const input = "const catalogues = {}; function use(menus: string[]) { return { menus }; }";
    const expected =
      "const menus = {}; function use(menuRows: string[]) { return { menus: menuRows }; }";
    expect(rewrite(input, row.file)).toBe(expected);
    expect(rewrite(expected, row.file)).toBe(expected);
  } finally {
    LOCAL_RENAMES.pop();
  }
});
it("keeps destructuring property keys when renaming the binding", () => {
  const file = "packages/menu/src/destructure.ts";
  LOCAL_RENAMES.push({ file, name: "menus", to: "menuRows" });
  try {
    expect(
      rewrite(
        "const catalogues = db; const { menus } = value; const { menus: other } = value;",
        file,
      ),
    ).toBe("const menus = db; const { menus: menuRows } = value; const { menus: other } = value;");
  } finally {
    LOCAL_RENAMES.pop();
  }
});
it("reports declaration clashes with produced names", () => {
  const root = fixture({ "packages/menu/src/x.ts": "const menus = db.from(catalogues);" });
  expect(clashes(root)).toContainEqual({
    file: "packages/menu/src/x.ts",
    name: "catalogues",
    produced: "menus",
  });
});
it("moves backlog links, leaves frozen input and Spanish intact, and is idempotent", () => {
  const root = fixture({
    "docs/backlog/catalogue.md": "# catalogue price",
    "docs/backlog.md": "[x](catalogue.md#a-catalogue-price)",
    "packages/db/drizzle/0000_baseline.sql": "catalogues",
    "apps/server/src/guide-catalogue.ts": "catalogues",
    "packages/menu/src/x.ts": '"Elige un catálogo"; const catalogue = 1;',
    "packages/country-es/test-fixtures/frozen.json": '"catalogues"',
    "scripts/a1308/rename-catalogue-words.mjs": "catalogue",
  });
  vi.stubEnv("GIT_DIR", "/missing-mn3-git");
  try {
    expect(run({ root, dryRun: true }).rewrote).toBe(3);
    expect(existsSync(join(root, "docs/backlog/catalogue.md"))).toBe(true);
    expect(run({ root }).rewrote).toBe(3);
    expect(readFileSync(join(root, "docs/backlog.md"), "utf8")).toBe("[x](menu.md#a-menu-price)");
    expect(readFileSync(join(root, "docs/backlog/menu.md"), "utf8")).toBe("# menu price");
    expect(readFileSync(join(root, "packages/menu/src/x.ts"), "utf8")).toBe(
      '"Elige un catálogo"; const menu = 1;',
    );
    for (const file of [
      "packages/db/drizzle/0000_baseline.sql",
      "apps/server/src/guide-catalogue.ts",
    ])
      expect(readFileSync(join(root, file), "utf8")).toBe("catalogues");
    expect(run({ root }).rewrote).toBe(0);
  } finally {
    vi.unstubAllEnvs();
  }
});
it("reports only kept spans without changing files", () => {
  const root = fixture({ "packages/menu/src/x.ts": "catalogue registerCatalogue(x);" });
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  expect(run({ root, report: true })).toMatchObject({ rewrote: 1, kept: 1 });
  expect(readFileSync(join(root, "packages/menu/src/x.ts"), "utf8")).toBe(
    "catalogue registerCatalogue(x);",
  );
  expect(log).toHaveBeenCalledWith(expect.stringContaining("K1 packages/menu/src/x.ts:1"));
});
it("runs command modes and refuses an occupied move target", () => {
  const root = fixture({
    "docs/backlog/catalogue.md": "catalogue",
    "docs/backlog/menu.md": "keep",
  });
  expect(() => run({ root })).toThrow("Move target exists");
  const other = fixture({ "packages/menu/src/x.ts": "const menus = catalogues;" });
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  main(["--clashes"], other);
  expect(log).toHaveBeenCalledWith(expect.stringContaining("menus"));
  main(["--dry-run"], other);
  expect(log).toHaveBeenCalledWith(expect.stringContaining("rewrote 1"));
  main(["--report"], other);
  expect(readFileSync(join(other, "packages/menu/src/x.ts"), "utf8")).toBe(
    "const menus = catalogues;",
  );
  main([], other);
  expect(readFileSync(join(other, "packages/menu/src/x.ts"), "utf8")).toBe("const menus = menus;");
});

it.each(["madrid-renamed-tables", "madrid-name-changes", "madrid-added-rows"])(
  "keeps %s historical table inputs",
  (name) => {
    const input = 'const source = "catalogues"; const id = "@catalogues:[\\"Lunch\\"]";';
    expect(rewrite(input, `apps/server/scripts/demo-seed/testing/${name}.ts`)).toBe(input);
  },
);
it("keeps base and effective product prices distinct on a rerun", () => {
  const file = "apps/dashboard/src/widgets/test-helpers.ts";
  const input =
    "const cataloguePrice = price; const productPrice = decided(cataloguePrice); const catalogueVariants = {}; const catalogue = catalogueVariants.v;";
  const expected =
    "const productPrice = price; const effectivePrice = decided(productPrice); const productVariants = {}; const productVariantPrice = productVariants.v;";
  expect(rewrite(input, file)).toBe(expected);
  expect(rewrite(expected, file)).toBe(expected);
});
it("scans destructured declarations, skips unrelated text and leaves binary files alone", () => {
  const root = fixture({
    "packages/menu/src/destructure.ts":
      "const [, menus] = value; export default function () {} const catalogues = source;",
    "packages/menu/src/plain.ts": "const only = 1;",
    "docs/backlog/list.md": "catalogue list",
    "packages/menu/src/binary.bin": Buffer.from([0, 99, 97]),
  });
  expect(clashes(root)).toEqual([
    { file: "packages/menu/src/destructure.ts", name: "catalogues", produced: "menus" },
  ]);
  run({ root });
  expect(readFileSync(join(root, "packages/menu/src/binary.bin"))).toEqual(
    Buffer.from([0, 99, 97]),
  );
});

it("keeps Products links consistent outside the dashboard package", () => {
  expect(
    rewrite(
      'return "/manage/catalogue/product/p1";',
      "packages/media/src/dashboard/image-library.ts",
    ),
  ).toBe('return "/manage/products/product/p1";');
  expect(
    rewrite("Open /manage/catalogue/category/c1.", "docs/developers/product-categories.md"),
  ).toBe("Open /manage/products/category/c1.");
});
it("keeps historical filenames and translation catalogue meanings", () => {
  const text =
    "Run `37932573955` left `catalogue-screen.test.ts` unfinished. A translation catalogue.";
  expect(rewrite(text, "docs/backlog/ci.md")).toBe(text);
});
it("renames zone-offer identifiers without inserting identifiers into prose", () => {
  expect(
    rewrite(
      "const catalogue = data; catalogue.menus; // threads it with the catalogue",
      "apps/till/src/till-app.ts",
    ),
  ).toBe("const zoneOffers = data; zoneOffers.menus; // threads it with the menu");
});

it("keeps guest settings separate from the existing menu defaults", () => {
  expect(rewrite('module: "catalogue"', "packages/menu/src/guest-menu-settings.ts")).toBe(
    'module: "guest_menu"',
  );
});
it("keeps the retired module's refusal fixture historical", () => {
  const text =
    'expect(versions).not.toHaveProperty("catalogue"); // Catalogue\'s migration count just before the squash\nmodules: { catalogue: 36 }; params: { exportOnly: ["catalogue"], serverOnly: [] };';
  expect(rewrite(text, "apps/server/src/configuration-import.test.ts")).toBe(text);
});
