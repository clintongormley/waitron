import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Contract: every `wt-data-table` column keyed `"actions"` (the row's ⋮ menu) is declared
 * `pinned: "end"`, so the menu stays on a phone's screen while the other columns scroll sideways.
 *
 * Weaker than its name: it reads only `.ts` files under `apps/` and `packages/`, less `*.test.ts`
 * (never `.tsx`, `.mts`, `.cts`, `.js` or `.mjs`), and looks for object literals whose own `key` is
 * written as the string `"actions"`. A row-menu column under another key, or whose key is a variable,
 * a shorthand, a computed name or an `as const`, is invisible to it; a key spread in from another
 * object is judged on that object. Its own `pinned` must be written as the string `"end"`: one set
 * through a variable, a spread or an `as const` is reported even when it holds `"end"`. It does not
 * know which objects are table columns, so any such object is held to the rule, and a data column
 * must take another key. It never checks that the column is the table's last.
 */

const repoRoot = join(import.meta.dirname, "..");
const ROOTS = ["apps", "packages"];

interface Unpinned {
  line: number;
}

function ownProperty(node: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const property of node.properties)
    if (
      ts.isPropertyAssignment(property) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
      property.name.text === name
    )
      return property.initializer;
  return undefined;
}

/** Each object literal whose own `key` is `"actions"` and whose own `pinned` is not `"end"`. */
export function unpinnedActionsColumns(source: string): Unpinned[] {
  const file = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, true);
  const found: Unpinned[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const key = ownProperty(node, "key");
      const pinned = ownProperty(node, "pinned");
      if (
        key !== undefined &&
        ts.isStringLiteralLike(key) &&
        key.text === "actions" &&
        !(pinned !== undefined && ts.isStringLiteralLike(pinned) && pinned.text === "end")
      )
        found.push({ line: file.getLineAndCharacterOfPosition(key.getStart()).line + 1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe("the matcher", () => {
  it("passes a pinned column", () => {
    const source = 'const c = [{ key: "actions", label: t("x"), pinned: "end", cell: () => 1 }];';
    expect(unpinnedActionsColumns(source)).toEqual([]);
  });

  it("reports an unpinned column whose cell's text mentions a pinned setting", () => {
    const source = [
      "const c = [",
      '  { key: "name", pinned: "end", cell: (r) => r.name },',
      "  {",
      '    key: "actions",',
      '    label: t("a"),',
      '    cell: (r) => html`pinned: "end" ${r.ok ? html`<b>}</b>` : ""}`,',
      "  },",
      "];",
    ].join("\n");
    expect(unpinnedActionsColumns(source)).toEqual([{ line: 4 }]);
  });

  it("does not count a pinned setting inside a nested object as the column's own", () => {
    const source = 'const c = { key: "actions", cell: () => ({ pinned: "end" }) };';
    expect(unpinnedActionsColumns(source)).toEqual([{ line: 1 }]);
  });

  it("ignores the string when it is not the key, and the key inside a comment", () => {
    const source = ['// { key: "actions" }', 'const c = { key: "name", label: "actions" };'].join(
      "\n",
    );
    expect(unpinnedActionsColumns(source)).toEqual([]);
  });
});

/**
 * Every non-test `.ts` file under `dir`. The DIRECTORY branch is taken first: a failing browser test
 * writes its screenshot into a directory named after the test file.
 */
function sourceFilesIn(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) out.push(...sourceFilesIn(full));
    else if (stats.isFile() && full.endsWith(".ts") && !full.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

describe("the tree", () => {
  const offenders: string[] = [];
  for (const file of ROOTS.flatMap((root) => sourceFilesIn(join(repoRoot, root)))) {
    const source = readFileSync(file, "utf8");
    if (!source.includes("actions")) continue;
    const name = relative(repoRoot, file);
    for (const column of unpinnedActionsColumns(source)) offenders.push(`${name}:${column.line}`);
  }

  it("pins every actions column to the end", () => {
    expect(offenders.sort()).toEqual([]);
  });
});
