/**
 * A placed order with no sale may go back to `open` by a status-only update
 * (`working_orders_enforce_transition` in `packages/db/triggers/core.sql`), and the database then
 * allows anything an open order allows. Only `apps/server/src/sent-order-open.ts` takes that step,
 * around a Pay for items move.
 *
 * Weaker than its name: it reads TEXT. It flags `status: "open"` (or `'open'`) inside a `.set({`
 * object, and `status = 'open'` after a `set` and before any `where` within one SQL template, in
 * every `.ts` file under `apps/` and `packages/` that is not a test, a test helper or under
 * `testing/`. A status held in a variable (`.set({ status })`), built by `sql`, spread from
 * another object, or written by a script outside those folders is unseen.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const ALLOWED = "apps/server/src/sent-order-open.ts";
const SET_OPEN = /\.set\(\s*\{[^}]*\bstatus\s*:\s*["']open["']/g;
const SQL_SET_OPEN = /\bset\b(?:(?!\bwhere\b)[^;`])*?\bstatus\s*=\s*'open'/gi;

function productFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "testing")
      continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...productFiles(path));
    else if (
      entry.isFile() &&
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".d.ts") &&
      !/(^|[.-])test([.-]|$)/.test(entry.name)
    )
      files.push(path);
  }
  return files;
}

/** The 1-based lines of `source` that set an order's status to open. */
function openingWrites(source: string): number[] {
  const lines = new Set<number>();
  for (const pattern of [SET_OPEN, SQL_SET_OPEN])
    for (const match of source.matchAll(pattern))
      lines.add(source.slice(0, match.index + match[0].length).split("\n").length);
  return [...lines].sort((a, b) => a - b);
}

describe("sent-order-open guard", () => {
  test("reads both spellings", () => {
    expect(openingWrites(`await tx.update(t)\n  .set({ status: "open" })`)).toEqual([2]);
    expect(openingWrites("sql`update working_orders\n set status = 'open' where id = 1`")).toEqual([
      2,
    ]);
    expect(openingWrites("sql`update t set label = 'x' where status = 'open'`")).toEqual([]);
    expect(openingWrites(`tx.insert(t).values({ status: "open" })`)).toEqual([]);
  });

  test("only sent-order-open.ts sets an order back to open", () => {
    const found: string[] = [];
    for (const top of ["apps", "packages"])
      for (const file of productFiles(join(ROOT, top))) {
        const lines = openingWrites(readFileSync(file, "utf8"));
        const name = relative(ROOT, file);
        if (lines.length > 0) found.push(`${name}:${lines.join(",")}`);
      }
    expect(found.map((entry) => entry.split(":")[0])).toEqual([ALLOWED]);
  });
});
