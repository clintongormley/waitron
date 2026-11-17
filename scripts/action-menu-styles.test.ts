import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { expect, it, vi } from "vitest";

vi.mock("typescript", async (importOriginal) => {
  const actual = await importOriginal<typeof import("typescript")>();
  return {
    default: { ...actual.default, createSourceFile: vi.fn(actual.default.createSourceFile) },
  };
});
import { decodeEscapes, sourceFilesIn } from "./no-till-as-issuer.mjs";

const helpers: Record<string, string[]> = {
  "apps/dashboard/src/widgets/product-list.ts": ["#addItems"],
  "apps/dashboard/src/widgets/staff-list.ts": ["#menuItem"],
  "apps/till/src/widgets/floor-zone-menu.ts": ["#planItems"],
  "packages/adjustments/src/dashboard/reasons-screen.ts": ["#rowMenu"],
  "apps/dashboard/src/screens/themes-card.ts": ["#item"],
  "packages/staffing/src/dashboard/staff-roles-screen.ts": ["#rowMenu"],
  "apps/till/src/screens/till-table-order-screen.ts": [
    "#tableMenu",
    "#compBill",
    "#billDocumentItems",
    "#billRequestItem",
  ],
  "apps/till/src/widgets/till-shell.ts": [
    "#items",
    "#operatorActions",
    "#menu",
    "#reportOption",
    "#tillMenu",
    "#aboutOption",
  ],
};

// Literal menu fragments and named helpers only; dynamic values/selectors, detached new helpers and
// class-only CSS need review. Native choice content layout and rich panels are outside this guard.
// Each rule needs a candidate marker in raw or decoded text, or a named helper above.
const MENU_CANDIDATE = /row-actions|wt-menu-row|--wt-button-justify/;
function violations(path: string, source: string): string[] {
  if (
    !helpers[path] &&
    !MENU_CANDIDATE.test(source) &&
    (!source.includes("\\") || !MENU_CANDIDATE.test(decodeEscapes(source)))
  )
    return [];
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const failures = new Set<string>();
  const menuPattern = /<(?:wt|dashboard)-row-actions\b[\s\S]*?<\/(?:wt|dashboard)-row-actions\s*>/g;
  const menus = (text: string) =>
    [...text.matchAll(menuPattern)].filter((match) => !/icon="bell"/.test(match[0]));
  const ranges = menus(source).map((match) => [match.index!, match.index! + match[0].length]);
  const named = (node: ts.Node): boolean => {
    for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
      if (
        (ts.isMethodDeclaration(parent) || ts.isFunctionDeclaration(parent)) &&
        parent.name &&
        helpers[path]?.includes(parent.name.getText(file))
      )
        return true;
    }
    return false;
  };
  const visit = (node: ts.Node): void => {
    if (
      (ts.isStringLiteralLike(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)) &&
      node.text.includes("--wt-button-justify")
    )
      failures.add("reserved alignment");
    if (ts.isTaggedTemplateExpression(node)) {
      const template = node.template;
      const text = ts.isNoSubstitutionTemplateLiteral(template)
        ? template.text
        : template.head.text +
          template.templateSpans.map((span) => "__EXPR__" + span.literal.text).join("");
      if (node.tag.getText(file) === "html") {
        const nested = ranges.some(
          ([start, end]) => node.getStart(file) > start! && node.end < end!,
        );
        const fragments = named(node) || nested ? [text] : menus(text).map((match) => match[0]);
        for (const fragment of fragments)
          for (const match of fragment.matchAll(/<wt-button\b([^>]*)>/g)) {
            const attributes = match[1]!;
            if (/\balign\s*=/.test(attributes)) failures.add("menu alignment");
            if (/\bsize\s*=/.test(attributes)) failures.add("menu size");
            if (/\bvariant\s*=\s*(["'])ghost\1/.test(attributes)) failures.add("menu variant");
          }
      }
      if (
        node.tag.getText(file) === "css" &&
        /(?:wt-row-actions|dashboard-row-actions|wt-menu-row)[^{}]*(?:wt-button|::part\(button\)|\ba\b)[^{}]*\{/.test(
          text,
        )
      )
        failures.add("menu CSS");
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...failures].sort();
}

it.each([
  [
    'html`<wt-row-actions><wt-button size="sm">Edit</wt-button></wt-row-actions\n >`',
    ["menu size"],
  ],
  ['html`<wt-row-actions><wt-button size="sm">Edit</wt-button></wt-row-actions>`', ["menu size"]],
  [
    'html`<dashboard-row-actions><wt-button variant="ghost">Edit</wt-button></dashboard-row-actions>`',
    ["menu variant"],
  ],
  [
    'html`<wt-row-actions><wt-menu-row><wt-button align="start">Edit</wt-button></wt-menu-row></wt-row-actions>`',
    ["menu alignment"],
  ],
  ["css`wt-row-actions wt-button::part(button) { padding: 0; }`", ["menu CSS"]],
  ["css`:host { --wt-button-justify: start; }`", ["reserved alignment"]],
  ['html`<wt-button align="start" size="sm">Find a bill</wt-button>`', []],
  [
    'html`<wt-row-actions align="end"><wt-button variant="danger">Delete</wt-button></wt-row-actions>`',
    [],
  ],
  [
    'html`<wt-row-actions icon="bell"><wt-button size="sm" variant="ghost" align="start">Read</wt-button></wt-row-actions>`',
    [],
  ],
  [
    "css`.photo-links wt-button::part(button) { padding: 0; } .bill-switcher-option { display: flex; justify-content: space-between; }`",
    [],
  ],
])("judges menu ownership in %s", (source, expected) => {
  expect(violations("apps/dashboard/src/screens/sample.ts", source)).toEqual(expected);
});

it("checks a detached till action builder without treating an ordinary helper as a menu", () => {
  expect(
    violations(
      "apps/till/src/widgets/till-shell.ts",
      'class Shell { #tillMenu() { return html`<wt-button size="sm">Edit</wt-button>`; } }',
    ),
  ).toEqual(["menu size"]);
  expect(
    violations(
      "apps/till/src/widgets/till-shell.ts",
      'class Shell { #ordinary() { return html`<wt-button size="sm">Edit</wt-button>`; } }',
    ),
  ).toEqual([]);
});

it("screens leave action item appearance to the shared components", () => {
  const paths = [
    ...sourceFilesIn(process.cwd(), "apps"),
    ...sourceFilesIn(process.cwd(), "packages"),
  ].filter(
    (path) =>
      path.endsWith(".ts") &&
      !path.endsWith(".test.ts") &&
      ((path.startsWith("apps/") && path.includes("/src/")) ||
        /packages\/[^/]+\/src\/dashboard\//.test(path) ||
        path === "packages/ui/demo/main.ts"),
  );
  const failures = paths.flatMap((path) =>
    violations(path, readFileSync(join(process.cwd(), path), "utf8")).map(
      (failure) => `${path}: ${failure}`,
    ),
  );
  expect(failures).toEqual([]);
});

it("skips parsing sources with no possible menu ownership match", () => {
  vi.mocked(ts.createSourceFile).mockClear();
  expect(violations("apps/server/src/example.ts", 'export const message = "ready";')).toEqual([]);
  expect(ts.createSourceFile).not.toHaveBeenCalled();
});

it.each([
  ["css`:host { --wt-button-justif\\u0079: start; }`", ["reserved alignment"]],
  [
    'html`<wt-row-\\u0061ctions><wt-button size="sm">Edit</wt-button></wt-row-actions>`',
    ["menu size"],
  ],
  ["css`wt-menu-row a { padding: 0; }`", ["menu CSS"]],
  ["html`<wt-button>\\u00a0</wt-button>`", []],
])("keeps escaped literals and CSS candidates in %s", (source, expected) => {
  expect(violations("apps/dashboard/src/screens/sample.ts", source)).toEqual(expected);
});
