/**
 * A sent Counter order with no sale may go back to `open` by a status-only update
 * (`working_orders_enforce_transition` in `packages/db/triggers/core.sql`), and the database then
 * allows anything an open order allows. Only `apps/server/src/sent-order-open.ts` takes that step,
 * around a Pay for items move.
 *
 * Weaker than its name: it reads LITERALS. In every `.ts` file under `apps/` and `packages/` except
 * `.d.ts`, `*.test.ts` and files under `testing/`, it flags a `status` property (bare, quoted or a
 * literal computed key) whose value is the literal `"open"` (any quotes, through `as`, `satisfies`,
 * `!` or parentheses) inside the arguments of a `.set(…)` call or inside a `set: {…}` object; and
 * `status = 'open'` after `update working_orders … set` and before any `where` in one string or
 * template literal. A status held in a variable, built by a call, spread from another object, or
 * interpolated into `sql` is unseen.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, test } from "vitest";
import { sourceFilesIn } from "./no-till-as-issuer.mjs";

const ROOT = join(import.meta.dirname, "..");
const ALLOWED = "apps/server/src/sent-order-open.ts";
const SQL_SET_OPEN =
  /\bupdate\s+(?:"?working_orders"?|\$\{\s*workingOrders\s*\})\s+set\b(?:(?!\bwhere\b)[^;`])*?(?:"status"|\bstatus\b)\s*=\s*'open'/gi;

const productFiles = ["apps", "packages"]
  .flatMap((dir) => sourceFilesIn(ROOT, dir))
  .filter(
    (path: string) =>
      path.endsWith(".ts") && !path.endsWith(".d.ts") && !/\.test\.ts$|(^|\/)testing\//.test(path),
  );

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression))
    return name.expression.text;
  return undefined;
}

function literalText(node: ts.Expression): string | undefined {
  let value = node;
  while (
    ts.isAsExpression(value) ||
    ts.isSatisfiesExpression(value) ||
    ts.isParenthesizedExpression(value) ||
    ts.isTypeAssertionExpression(value) ||
    ts.isNonNullExpression(value)
  )
    value = value.expression;
  return ts.isStringLiteralLike(value) ? value.text : undefined;
}

/** Whether `node` sits in the arguments of a `.set(…)` call or in the object of a `set:` key. */
function insideSet(node: ts.Node): boolean {
  for (let child = node, parent = node.parent; parent !== undefined;) {
    if (
      ts.isCallExpression(parent) &&
      child !== parent.expression &&
      ts.isPropertyAccessExpression(parent.expression) &&
      parent.expression.name.text === "set"
    )
      return true;
    if (
      ts.isPropertyAssignment(parent) &&
      child === parent.initializer &&
      propertyName(parent.name) === "set"
    )
      return true;
    child = parent;
    parent = parent.parent;
  }
  return false;
}

/** The 1-based lines of `source` that write the literal open status to an order. */
function openingWrites(source: string): number[] {
  const file = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, true);
  const lines = new Set<number>();
  const lineAt = (position: number) => file.getLineAndCharacterOfPosition(position).line + 1;
  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAssignment(node) &&
      propertyName(node.name) === "status" &&
      literalText(node.initializer) === "open" &&
      insideSet(node)
    )
      lines.add(lineAt(node.getEnd()));
    const text = ts.isTemplateExpression(node)
      ? node.getText(file)
      : ts.isStringLiteralLike(node)
        ? node.text
        : undefined;
    if (text !== undefined)
      for (const match of text.matchAll(SQL_SET_OPEN)) {
        const end = match.index + match[0].length;
        lines.add(lineAt(node.getStart(file)) + text.slice(0, end).split("\n").length - 1);
      }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...lines].sort((a, b) => a - b);
}

describe("sent-order-open guard", () => {
  test.each([
    [`await tx.update(t)\n  .set({ status: "open" })`, [2]],
    [`tx.update(t).set({ "status": 'open' })`, [1]],
    ["tx.update(t).set({ status: `open` })", [1]],
    [`tx.update(t).set({ status: "open" as const })`, [1]],
    [`tx.update(t).set({ status: ("open" satisfies Status) })`, [1]],
    [`tx.update(t).set({ ["status"]: "open" })`, [1]],
    [`tx.insert(t).values(row).onConflictDoUpdate({ target: t.id, set: { status: "open" } })`, [1]],
    ["sql`update working_orders\n set status = 'open' where id = 1`", [2]],
    [`sql\`update working_orders set "status" = 'open' where id = 1\``, [1]],
    [`sql.raw("update working_orders set status = 'open' where id = 1")`, [1]],
    ['tx.update(t).set({ revision: sql`${t.revision} + 1`, status: "open" })', [1]],
    [`tx.update(t).set({ meta: { a: 1 }, note: "})", status: "open" })`, [1]],
    [`tx.update(t).set({ pattern: /[("']/, status: "open" })`, [1]],
    ["sql`update ${workingOrders} set status = 'open' where id = 1`", [1]],
    ["sql`update tabs set status = 'open' where id = 1`", []],
    ["sql`update working_orders set label = 'x' where status = 'open'`", []],
    [`tx.update(t).set({ status: "placed" }).where(eq(t.status, "open"))`, []],
    [`tx.insert(t).values({ status: "open" })`, []],
    [`// tx.update(t).set({ status: "open" })`, []],
  ])("reads %j", (source, lines) => {
    expect(openingWrites(source)).toEqual(lines);
  });

  test("selects product sources by their real suffixes", () => {
    expect(productFiles).toEqual(
      expect.arrayContaining([ALLOWED, "apps/server/src/printer-test-page.ts"]),
    );
    expect(productFiles.filter((path: string) => /\.test\.ts$|\/testing\//.test(path))).toEqual([]);
  });

  test("only sent-order-open.ts writes a literal open status to an order", () => {
    const found = productFiles.filter(
      (path: string) => openingWrites(readFileSync(join(ROOT, path), "utf8")).length > 0,
    );
    expect(found).toEqual([ALLOWED]);
  });
});
