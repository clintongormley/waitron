/**
 * A placed order with no sale may go back to `open` by a status-only update
 * (`working_orders_enforce_transition` in `packages/db/triggers/core.sql`), and the database then
 * allows anything an open order allows. Only `apps/server/src/sent-order-open.ts` takes that step,
 * around a Pay for items move.
 *
 * Weaker than its name: it reads TEXT, comments blanked. In every `.ts` file under `apps/` and
 * `packages/` except `.d.ts`, `*.test.ts` and files under `testing/`, it flags a `status` key
 * (bare or quoted) given `"open"`, `'open'` or `` `open` `` inside a `.set({` or `set: {` object,
 * and `status = 'open'` (column bare or double-quoted) after a `set` and before any `where`
 * within one SQL template. A status held in a variable (`.set({ status })`), interpolated into
 * `sql`, spread from another object, or written outside those files is unseen.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { blankComments } from "../packages/shared/src/source-comments.js";
import { sourceFilesIn } from "./no-till-as-issuer.mjs";

const ROOT = join(import.meta.dirname, "..");
const ALLOWED = "apps/server/src/sent-order-open.ts";
const SET_OPEN =
  /(?:\.set\(\s*|\bset\s*:\s*)\{[^}]*(?:\bstatus|"status"|'status')\s*:\s*(?:"open"|'open'|`open`)/g;
const SQL_SET_OPEN = /\bset\b(?:(?!\bwhere\b)[^;`])*?(?:"status"|\bstatus\b)\s*=\s*'open'/gi;

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
  for (const pattern of [SET_OPEN, SQL_SET_OPEN])
    for (const match of code.matchAll(pattern))
      lines.add(code.slice(0, match.index + match[0].length).split("\n").length);
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
    ["sql`update t set label = 'x' where status = 'open'`", []],
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
