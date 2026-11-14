import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { matchesGlob, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { SCOPE as PATH_SCOPE, NEVER as PATH_NEVER } from "./rename-catalogue-paths.mjs";

export const SCOPE = [...PATH_SCOPE, "apps/server/src/guide/**"];
export const NEVER = [
  ...PATH_NEVER,
  "apps/server/src/guide-catalogue*",
  "docs/backlog/english-only-audit.md",
];
export const CATCH_ALL = [
  ["CATALOGUES", "MENUS"],
  ["CATALOGUE", "MENU"],
  ["Catalogues", "Menus"],
  ["Catalogue", "Menu"],
  ["catalogues", "menus"],
  ["catalogue", "menu"],
];
export const EXACT = [
  ["CatalogueSettings", "MenuDefaults"],
  ["CatalogueScreen", "ProductsScreen"],
  ["dashboard-catalogue-screen", "dashboard-products-screen"],
  ["CatalogueBrowser", "ProductBrowser"],
  ["dashboard-catalogue-browser", "dashboard-product-browser"],
  ["CatalogueFormsApp", "ProductFormsApp"],
  ["catalogue-forms-leave-test-app", "product-forms-leave-test-app"],
  ["CatalogueLeaveApp", "ProductsLeaveApp"],
  ["catalogue-leave-test-app", "products-leave-test-app"],
  ["CatalogueSelection", "ProductSelection"],
  ["moveCatalogueItems", "moveProductItems"],
  ["deleteCatalogueItems", "deleteProductItems"],
  ["nav.catalogue", "nav.products"],
  ["navCatalogue", "navProducts"],
  ["nav-catalogue", "nav-products"],
  ["catalogue.title", "products.title"],
  ["catalogue.add_product", "products.add_product"],
  ["catalogue.empty_prompt", "products.empty_prompt"],
  ["catalogue_settings.", "menu_settings."],
  ["catalogue.not_found", "menu.not_found"],
  ["catalogue.failed", "menu.failed"],
  ["catalogue.manage", "menu.manage"],
  ["cataloguePrice", "productPrice"],
  ["ZoneOfferCatalogue", "ZoneOffers"],
  ["zoneCatalogues", "zoneOffers"],
  ["rememberZoneCatalogue", "rememberZoneOffers"],
  ["forgetZoneCatalogues", "forgetZoneOffers"],
  ["zoneCatalogueGeneration", "zoneOffersGeneration"],
].map(([from, to]) => ({ from, to }));
EXACT.push(
  { from: '"catalogue"', to: '"guest_menu"', files: ["packages/menu/src/guest-menu-settings.ts"] },
  {
    from: "checkImportedSettings({ catalogue:",
    to: "checkImportedSettings({ guest_menu:",
    files: ["packages/provisioning/src/settings-transfer.test.ts"],
  },
  {
    from: "catalogueVariants",
    to: "productVariants",
    files: ["apps/dashboard/src/widgets/test-helpers.ts"],
  },
  {
    from: "catalogue",
    to: "zoneOffers",
    identifiers: true,
    files: [
      "apps/till/src/till-app.ts",
      "apps/till/src/till-app.test.ts",
      "apps/till/src/till-app-device-zones.test.ts",
      "apps/till/src/till-app-drafts.test.ts",
    ],
  },
  { from: "defaultCatalogue", to: "defaultZoneOffers", files: ["apps/till/src/till-app.test.ts"] },
);
export const PROTECTED = [
  {
    id: "K11",
    files: ["apps/server/src/configuration-import.test.ts"],
    pattern:
      /Catalogue's migration count just before the squash|catalogue(?=: 36)|(?<=toHaveProperty\(")catalogue(?="\))|(?<=exportOnly: \[")catalogue(?="\])/g,
  },
  { id: "K10", files: ["docs/**"], pattern: /\b[\w-]*catalogue[\w.-]*\.(?:ts|mjs|js)\b/g },
  { id: "K10", files: ["**"], pattern: /\b(?:translation|string) catalogues?\b/g },
  {
    id: "K1",
    files: ["**"],
    pattern: /registerCatalogue|I18N_CATALOGUES|helpCatalogues|guide-catalogue/g,
  },
  {
    id: "K2",
    files: [
      "apps/*/src/i18n/**",
      "apps/dashboard/src/widgets/theme-words.ts",
      "packages/dashboard-kit/src/i18n*.ts",
      "packages/*/src/dashboard/strings*.ts",
      "packages/recovery-pack/src/i18n/**",
      "scripts/english-only.test.ts",
      "packages/db/src/english-only.ts",
    ],
    pattern: /catalogues?|Catalogues?/g,
  },
  {
    id: "K3",
    files: ["packages/fiscal-verifactu/src/inmutabilidad.test.ts"],
    pattern: /catalogues?|Catalogues?/g,
  },
  { id: "K5", files: ["**"], pattern: /CatalogueTarget/g },
  {
    id: "K5",
    files: ["packages/db/src/schema/menu/migrations.test.ts"],
    pattern: /engine's own catalogue/g,
  },
  {
    id: "K6",
    files: [
      "packages/staffing/src/dashboard/painter-parts.ts",
      "apps/dashboard/src/screens/card-provider-panel.ts",
      "packages/payments-stripe/src/dashboard/index.ts",
    ],
    pattern: /catalogues?|Catalogues?/g,
  },
  { id: "K7", files: ["docs/developers/testing-guide.md"], pattern: /AEAT error catalogue/g },
  { id: "K8", files: ["**"], pattern: /job-catalogue|JOB_CATALOGUE|job catalogue/g },
  {
    id: "K9",
    files: [
      "apps/server/scripts/demo-seed/testing/madrid-*.ts",
      "apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts",
    ],
    pattern: /location_catalogues|catalogue_settings/g,
  },
];
export const LOCAL_RENAMES = [
  { file: "packages/menu/src/operations.ts", name: "productPrice", to: "variantProductPrice" },
  {
    file: "apps/dashboard/src/widgets/test-helpers.ts",
    name: "catalogue",
    to: "productVariantPrice",
  },
  { file: "packages/venue-service/src/menu-timetable.test.ts", name: "menus", to: "menuRows" },
  { file: "packages/venue-service/src/provisioning.test.ts", name: "menus", to: "menuRows" },
  {
    file: "apps/dashboard/src/widgets/test-helpers.ts",
    name: "productPrice",
    to: "effectivePrice",
    when: "cataloguePrice",
  },
  { file: "packages/menu/src/section-graph.ts", name: "menus", to: "menuRows" },
  { file: "packages/menu/src/menu-document.ts", name: "menus", to: "menuRows" },
  { file: "packages/menu/src/provisioning.test.ts", name: "menus", to: "menuRows" },
  { file: "packages/menu/src/menu-copy.test.ts", name: "menus", to: "menuRows" },
  { file: "packages/venue-service/src/menu-timetable.ts", name: "menus", to: "menuRows" },
  { file: "apps/server/src/upgrade-checks.ts", name: "menus", to: "menuRows" },
  { file: "packages/menu/src/settings.test.ts", name: "catalogue", to: "menuModule" },
];
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const catchAll = (text) =>
  CATCH_ALL.reduce((value, [from, to]) => value.replaceAll(from, to), text);
const selected = (file) =>
  SCOPE.some((glob) => matchesGlob(file, glob)) && !NEVER.some((glob) => matchesGlob(file, glob));
const historical = (file) =>
  /apps\/server\/scripts\/demo-seed\/(?:testing\/madrid-(?!semantics)[^/]+\.ts|seed\.madrid-baseline\.test\.ts)$/.test(
    file,
  );

function renameIdentifiers(text, file, from, to) {
  const positions = [];
  const visit = (node) => {
    if (ts.isIdentifier(node) && node.text === from) positions.push([node.getStart(), node.end]);
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true));
  for (const [start, end] of positions.reverse())
    text = text.slice(0, start) + to + text.slice(end);
  return text;
}

export function rewriteWords(original, file) {
  const kept = [];
  const saved = [];
  const originalLines = original.split("\n");
  const mask = (text, pattern, rule) =>
    text.replace(pattern, (span, ...args) => {
      const offset = args.at(-2);
      const line = text.slice(0, offset).split("\n").length;
      kept.push({ rule, line, snippet: originalLines[line - 1] });
      saved.push(span);
      return `\uE000${saved.length - 1}\uE001`;
    });
  let text = original;
  // These are inputs to older checked transforms, before the table-rename adapter runs.
  if (historical(file)) {
    text = mask(text, /@catalogues:/g, "K9");
    if (file.includes("madrid-renamed-tables")) text = mask(text, /\bcatalogues\b/g, "K9");
    if (file.includes("madrid-name-changes")) text = mask(text, /\bcatalogues\b/g, "K9");
    if (file.includes("madrid-added-rows"))
      text = mask(text, /\bcatalogues\b|\bcatalogue_id\b/g, "K9");
    if (file.includes("madrid-documents"))
      text = mask(text, /\bcatalogues\b|\bcatalogue_id\b/g, "K9");
    if (file.endsWith("seed.madrid-baseline.test.ts"))
      text = mask(text, /\bcatalogue_id\b|\bcatalogues\b/g, "K9");
  }
  for (const { name, to, file: target, when } of LOCAL_RENAMES) {
    if (
      file !== target ||
      (when && !original.includes(when)) ||
      (name === "menus" && !/\bcatalogues\b/.test(original))
    )
      continue;
    const edits = [];
    const visit = (node) => {
      if (ts.isIdentifier(node) && node.text === name) {
        const parent = node.parent;
        const property =
          (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
          ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)) &&
            parent.name === node) ||
          (ts.isBindingElement(parent) && parent.propertyName === node);
        if (!property)
          edits.push([
            node.getStart(),
            node.end,
            ts.isShorthandPropertyAssignment(parent) ||
            (ts.isBindingElement(parent) &&
              !parent.propertyName &&
              ts.isObjectBindingPattern(parent.parent))
              ? `${name}: ${to}`
              : to,
          ]);
      }
      ts.forEachChild(node, visit);
    };
    visit(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true));
    for (const [start, end, replacement] of edits.reverse())
      text = text.slice(0, start) + replacement + text.slice(end);
  }
  for (const { from, to, files, identifiers } of EXACT) {
    if (files && !files.includes(file)) continue;
    if (identifiers) {
      text = renameIdentifiers(text, file, from, to);
      continue;
    }
    text = text.replace(
      new RegExp(
        `(?<![A-Za-z0-9_])${escape(from)}${from.endsWith(".") ? "" : "(?![A-Za-z0-9_])"}`,
        "g",
      ),
      to,
    );
  }
  text = text.replace(/\bCombineInput\[(["'])catalogue\1\]/g, "CombineInput[$1product$1]");
  if (/\b(?:CombineInput|combineOffer)\b/.test(original))
    text = renameIdentifiers(text, file, "catalogue", "product");
  if (file.startsWith("apps/dashboard/")) {
    text = text.replace(/\bmodules:\s*\[\s*(["'])catalogue\1\s*\]/g, 'modules: ["menu"]');
    text = text
      .replace(/(["'])catalogue\1/g, "$1products$1")
      .replace(/\/catalogue(?=[/"'`?#]|$)/g, "/products");
    if (file === "apps/dashboard/src/navigation.ts")
      text = text.replace(/\bcatalogue(?=\s*:)/g, "products");
  }
  for (const { id, files, pattern } of PROTECTED)
    if (files.some((glob) => matchesGlob(file, glob))) text = mask(text, pattern, id);
  text = text.replace(/\/manage\/catalogue(?=[/"'`?#]|$)/g, "/manage/products");
  text = catchAll(text).replace(/\uE000(\d+)\uE001/g, (_whole, index) => saved[Number(index)]);
  return { text, kept };
}

function gitFor(root) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  return (...args) => execFileSync("git", args, { cwd: root, env, encoding: "utf8" });
}
function sources(root) {
  return gitFor(root)("ls-files", "-z")
    .split("\0")
    .filter(
      (file) =>
        file &&
        selected(file) &&
        existsSync(resolve(root, file)) &&
        lstatSync(resolve(root, file)).isFile(),
    )
    .flatMap((file) => {
      const bytes = readFileSync(resolve(root, file));
      return bytes.subarray(0, 8000).includes(0) ? [] : [[file, bytes.toString("utf8")]];
    });
}
export function clashes(root) {
  const found = [];
  for (const [file, text] of sources(root)) {
    if (!/\.[cm]?[jt]s$/.test(file) || !/catalogue/i.test(text)) continue;
    const names = new Set();
    const add = (name) => {
      if (!name) return;
      if (ts.isIdentifier(name)) names.add(name.text);
      else if (name.elements) for (const part of name.elements) add(part.name);
    };
    const visit = (node) => {
      if (
        ts.isVariableDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isImportSpecifier(node)
      )
        add(node.name);
      ts.forEachChild(node, visit);
    };
    visit(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true));
    for (const name of new Set(text.match(/[\w$]*catalogue[\w$]*/gi))) {
      const produced = catchAll(name);
      if (names.has(produced)) found.push({ file, name, produced });
    }
  }
  return found;
}
export function run({ root, dryRun = false, report = false }) {
  const git = gitFor(root);
  const old = "docs/backlog/catalogue.md",
    next = "docs/backlog/menu.md";
  const move = existsSync(resolve(root, old));
  if (move && existsSync(resolve(root, next)))
    throw new Error("Move target exists: docs/backlog/menu.md");
  const changes = [];
  let kept = 0;
  for (const [file, original] of sources(root)) {
    const result = rewriteWords(original, file);
    kept += result.kept.length;
    if (report)
      for (const span of result.kept)
        console.log(`${span.rule} ${file}:${span.line} ${span.snippet.trim()}`);
    if (result.text === original) continue;
    const lines = original.split("\n");
    changes.push({
      file: move && file === old ? next : file,
      lines: result.text.split("\n").filter((line, i) => line !== lines[i]).length,
    });
    if (!dryRun && !report) writeFileSync(resolve(root, file), result.text);
  }
  if (move && !dryRun && !report) git("mv", "--", old, next);
  return { rewrote: changes.length, kept, changes };
}
export function main(args, root) {
  if (args.includes("--clashes")) {
    for (const row of clashes(root)) console.log(`${row.file}: ${row.name} -> ${row.produced}`);
    return;
  }
  const result = run({
    root,
    dryRun: args.includes("--dry-run"),
    report: args.includes("--report"),
  });
  if (args.includes("--dry-run"))
    for (const row of result.changes)
      console.log(`rewrite ${row.file} (${row.lines} changed lines)`);
  if (!args.includes("--report")) console.log(`rewrote ${result.rewrote}`);
}
if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main(process.argv.slice(2), process.cwd());
