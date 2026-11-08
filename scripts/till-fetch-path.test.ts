/**
 * No till source file outside `apps/till/src/api/` and `main.ts` (which builds the client's fetch
 * and the theme's) calls `fetch`.
 *
 * Weaker than its name: it reads TEXT, so it sees only a call written as `fetch(…)` or
 * `<something>.fetch(…)`; a fetch reached by another name (`const load = fetch; load(…)`) passes.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, test } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const TILL = "apps/till/src";
const SKIPPED = new Set([`${TILL}/api`, `${TILL}/main.ts`]);

/** Lines of `source` that call `fetch`, bare or as a property. */
export function fetchCalls(source: string): number[] {
  const file = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, true);
  const lines: number[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : undefined;
      if (name === "fetch")
        lines.push(file.getLineAndCharacterOfPosition(node.getStart()).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return lines;
}

function sourceFilesIn(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry.startsWith(".") || SKIPPED.has(relative(ROOT, full))) continue;
    const stats = statSync(full);
    if (stats.isDirectory()) out.push(...sourceFilesIn(full));
    else if (
      stats.isFile() &&
      entry.endsWith(".ts") &&
      !entry.endsWith(".test.ts") &&
      !entry.includes("test-helpers")
    )
      out.push(full);
  }
  return out;
}

describe("fetchCalls", () => {
  test("finds a bare call and a property call, and nothing in comments, strings or other names", () => {
    const source = [
      "// fetch(here) is a comment",
      'const text = "fetch(x)";',
      "await fetch('/api/till');",
      "await globalThis.fetch('/api/till');",
      "await this.#fetchImpl('/api/till');",
      "await load();",
    ].join("\n");
    expect(fetchCalls(source)).toEqual([3, 4]);
  });
});

describe("till code outside the client makes no request of its own", () => {
  test("no till source file outside api/ and main.ts calls fetch", () => {
    const offenders = sourceFilesIn(join(ROOT, TILL)).flatMap((path) =>
      fetchCalls(readFileSync(path, "utf8")).map((line) => `${relative(ROOT, path)}:${line}`),
    );
    expect(offenders).toEqual([]);
  });
});
