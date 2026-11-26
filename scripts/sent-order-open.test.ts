/**
 * A placed order with no sale may go back to `open` by a status-only update
 * (`working_orders_enforce_transition` in `packages/db/triggers/core.sql`), and the database then
 * allows anything an open order allows. Only `apps/server/src/sent-order-open.ts` takes that step,
 * around a Pay for items move.
 *
 * Weaker than its name: it reads TEXT, comments blanked. In every `.ts` file under `apps/` and
 * `packages/` except `.d.ts`, `*.test.ts` and files under `testing/`, it flags a `status` key
 * (bare or quoted) given `"open"`, `'open'` or `` `open` `` anywhere between a `.set(` and its
 * closing parenthesis, or within a `set: {` object, skipping strings and template literals whole;
 * and `status = 'open'` (column bare or double-quoted) after `update working_orders … set` (the
 * table bare, double-quoted or `${workingOrders}`) and before any `where` within one SQL template.
 * A status held in a variable (`.set({ status })`), interpolated into `sql`, spread from another
 * object, or written outside those forms is unseen, and a regular expression literal holding a
 * quote or bracket inside the call can end the scan early.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { blankComments } from "../packages/shared/src/source-comments.js";
import { sourceFilesIn } from "./no-till-as-issuer.mjs";

const ROOT = join(import.meta.dirname, "..");
const ALLOWED = "apps/server/src/sent-order-open.ts";
const SET_START = /\.set\(|\bset\s*:\s*\{/g;
const STATUS_OPEN = /(?:\bstatus|"status"|'status')\s*:\s*(?:"open"|'open'|`open`)/g;
const SQL_SET_OPEN =
  /\bupdate\s+(?:"?working_orders"?|\$\{\s*workingOrders\s*\})\s+set\b(?:(?!\bwhere\b)[^;`])*?(?:"status"|\bstatus\b)\s*=\s*'open'/gi;
const CLOSERS = new Map([
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
]);

/** The index just past `closer`, the partner of a bracket opened before `from`. */
function closeOf(code: string, from: number, closer: string): number {
  let i = from;
  while (i < code.length) {
    const c = code[i]!;
    if (c === closer) return i + 1;
    const inner = CLOSERS.get(c);
    if (inner !== undefined) i = closeOf(code, i + 1, inner);
    else if (c === '"' || c === "'") i = quoteEnd(code, i);
    else if (c === "`") i = templateEnd(code, i + 1);
    else i += 1;
  }
  return code.length;
}

function quoteEnd(code: string, open: number): number {
  let i = open + 1;
  while (i < code.length && code[i] !== code[open] && code[i] !== "\n")
    i += code[i] === "\\" ? 2 : 1;
  return i + 1;
}

function templateEnd(code: string, from: number): number {
  let i = from;
  while (i < code.length) {
    if (code[i] === "\\") i += 2;
    else if (code[i] === "`") return i + 1;
    else if (code.startsWith("${", i)) i = closeOf(code, i + 2, "}");
    else i += 1;
  }
  return code.length;
}

const productFiles = ["apps", "packages"]
  .flatMap((dir) => sourceFilesIn(ROOT, dir))
  .filter(
    (path: string) =>
      path.endsWith(".ts") && !path.endsWith(".d.ts") && !/\.test\.ts$|(^|\/)testing\//.test(path),
  );

/** The 1-based lines of `source` that set an order's status to open. */
function openingWrites(source: string): number[] {
  const code = blankComments(source);
  const lines = new Set<number>();
  const lineAt = (end: number) => code.slice(0, end).split("\n").length;
  for (const start of code.matchAll(SET_START)) {
    const from = start.index + start[0].length;
    const span = code.slice(from, closeOf(code, from, start[0].startsWith(".") ? ")" : "}"));
    for (const match of span.matchAll(STATUS_OPEN))
      lines.add(lineAt(from + match.index + match[0].length));
  }
  for (const match of code.matchAll(SQL_SET_OPEN)) lines.add(lineAt(match.index + match[0].length));
  return [...lines].sort((a, b) => a - b);
}

describe("sent-order-open guard", () => {
  test.each([
    [`await tx.update(t)\n  .set({ status: "open" })`, [2]],
    [`tx.update(t).set({ "status": 'open' })`, [1]],
    ["tx.update(t).set({ status: `open` })", [1]],
    [`tx.insert(t).values(row).onConflictDoUpdate({ target: t.id, set: { status: "open" } })`, [1]],
    ["sql`update working_orders\n set status = 'open' where id = 1`", [2]],
    [`sql\`update working_orders set "status" = 'open' where id = 1\``, [1]],
    ['tx.update(t).set({ revision: sql`${t.revision} + 1`, status: "open" })', [1]],
    [`tx.update(t).set({ meta: { a: 1 }, note: "})", status: "open" })`, [1]],
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

  test("only sent-order-open.ts sets an order back to open", () => {
    const found = productFiles.filter(
      (path: string) => openingWrites(readFileSync(join(ROOT, path), "utf8")).length > 0,
    );
    expect(found).toEqual([ALLOWED]);
  });
});
