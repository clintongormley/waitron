/** Weaker than a runtime check: reads literal wt-data-table tags, not rendered columns or tables
 * built dynamically. Browser tests check whether the declared columns actually offer a choice. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { expect, test } from "vitest";
import { sourceFilesIn } from "./no-till-as-issuer.mjs";

const root = join(import.meta.dirname, "..");
type Table = { label: string; key: boolean; chooser: boolean };
function tablesIn(source: string): Table[] {
  const file = ts.createSourceFile("table.ts", source, ts.ScriptTarget.Latest, true);
  const tables: Table[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isTemplateExpression(node) || ts.isStringLiteralLike(node)) {
      const original = node.getText(file);
      let text = original;
      if (ts.isTemplateExpression(node)) {
        for (const { expression } of node.templateSpans) {
          const from = expression.getStart(file) - node.getStart(file);
          const to = expression.getEnd() - node.getStart(file);
          text = text.slice(0, from) + text.slice(from, to).replace(/[^\n]/g, " ") + text.slice(to);
        }
      }
      for (const tag of text.matchAll(/<wt-data-table\b[^>]*>/g)) {
        const attributes = new Map<string, string>();
        for (const attr of tag[0].matchAll(
          /\s(aria-label|viewKey|customiseColumnsLabel)=("[^"]*"|'[^']*'|\$\{[^}]*\})/g,
        )) {
          const from = tag.index! + attr.index! + attr[0].indexOf("=") + 1;
          attributes.set(attr[1]!, original.slice(from, from + attr[2]!.length));
        }
        tables.push({
          label: attributes.get("aria-label") ?? "",
          key: attributes.has("viewKey"),
          chooser: attributes.has("customiseColumnsLabel"),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return tables;
}

const compliant =
  'html`<wt-data-table aria-label=${t("list")} .rows=${rows.filter(x => x > 0)} viewKey=${key} customiseColumnsLabel=${t("table.customise_columns")}></wt-data-table>`';
test("reads attributes after bindings, including a computed preference key", () => {
  expect(tablesIn(compliant)).toEqual([{ label: '${t("list")}', key: true, chooser: true }]);
});
test.each(["viewKey", "customiseColumnsLabel"])(
  "catches deletion of %s without blaming the next table",
  (attribute) => {
    const broken = compliant.replace(new RegExp(` ${attribute}=\\$\\{[^}]*\\}`), "");
    expect(tablesIn(broken + "\n" + compliant)).toEqual([
      {
        label: '${t("list")}',
        key: attribute !== "viewKey",
        chooser: attribute !== "customiseColumnsLabel",
      },
      { label: '${t("list")}', key: true, chooser: true },
    ]);
  },
);
test("ignores comments and sees a nested template's table", () => {
  expect(
    tablesIn(
      '// <wt-data-table>\nhtml`<div>${ok ? html`<wt-data-table aria-label="picker">` : nothing}</div>`',
    ),
  ).toEqual([{ label: '"picker"', key: false, chooser: false }]);
});

type Reason = "dialog" | "picker" | "owner decision" | "nothing to offer";
const allowed = new Map<string, Reason>([
  [
    'apps/dashboard/src/screens/content-languages-screen.ts | ${t("content_languages.enabled")}',
    "nothing to offer",
  ],
  ['apps/dashboard/src/screens/devices-screen.ts | ${t("devices.waiting_title")}', "picker"],
  ["apps/dashboard/src/screens/modifiers-screen.ts | ${options.label}", "nothing to offer"],
  [
    "apps/dashboard/src/screens/modifiers-screen.ts | ${this.#usedByHeading(viewing)}",
    "nothing to offer",
  ],
  ['apps/dashboard/src/screens/printers-screen.ts | ${t("printers.discovered_title")}', "picker"],
  ['apps/dashboard/src/screens/servers-screen.ts | ${t("servers.title")}', "owner decision"],
  ['apps/dashboard/src/screens/units-screen.ts | ${t("units.in_use_title")}', "dialog"],
  [
    'apps/dashboard/src/widgets/invoice-customer-dialog.ts | ${t("invoice_customer.heading")}',
    "dialog",
  ],
  [
    'apps/dashboard/src/widgets/menu-document-tree.ts | ${t("menus.tree_heading")}',
    "nothing to offer",
  ],
  [
    'apps/dashboard/src/widgets/menu-publications.ts | ${t("menu_publications.heading")}',
    "nothing to offer",
  ],
  [
    'packages/staffing/src/dashboard/staff-roles-screen.ts | ${t("staffing.role.title")}',
    "nothing to offer",
  ],
  [
    'packages/venue-service/src/dashboard/departments-list.ts | ${t("nav.departments_zones")}',
    "owner decision",
  ],
]);
function missingIn(path: string, source: string): string[] {
  return tablesIn(source)
    .filter((table) => !allowed.has(`${path} | ${table.label}`) && (!table.key || !table.chooser))
    .map((table) => `${path} | ${table.label}`);
}
test("allows only the named table, leaving its main-table neighbour checked", () => {
  const source =
    'html`<wt-data-table aria-label=${t("menus.tree_heading")}></wt-data-table><wt-data-table aria-label="new-main"></wt-data-table>`';
  expect(missingIn("apps/dashboard/src/widgets/menu-document-tree.ts", source)).toEqual([
    'apps/dashboard/src/widgets/menu-document-tree.ts | "new-main"',
  ]);
});
const sources = sourceFilesIn(root).filter(
  (path: string) =>
    /^(apps\/dashboard\/src\/|packages\/[^/]+\/src\/dashboard\/)/.test(path) &&
    path.endsWith(".ts") &&
    !path.endsWith(".test.ts") &&
    !path.includes("/testing/"),
);
test("dashboard main tables declare remembered column choices", () => {
  expect(sources.some((path: string) => path.startsWith("apps/"))).toBe(true);
  expect(sources.some((path: string) => path.startsWith("packages/"))).toBe(true);
  expect(
    sources.flatMap((path: string) => missingIn(path, readFileSync(join(root, path), "utf8"))),
  ).toEqual([]);
});
