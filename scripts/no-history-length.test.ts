/**
 * A browser test observes navigation with spies on `history.pushState`/`replaceState`, never by
 * reading `history.length`: Chromium stops counting at 50, so once earlier files in a shard have
 * filled the tab's history the count no longer moves when a push happens
 * (docs/developers/testing-guide.md).
 *
 * Weaker than its name: it reads TEXT — the syntax of each `.test.ts` file under `apps/` and
 * `packages/`, without types — and flags only `history.length`, `window.history.length` and
 * `globalThis.history.length` written out as property reads. A read through another name for the
 * browser's history (`const h = history; h.length`), `history["length"]`, or one in a helper file
 * that is not a `.test.ts` is unseen.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, test } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const ROOTS = ["apps", "packages"];
const GLOBALS = new Set(["window", "globalThis"]);
const TRIVIA = String.raw`(?:[\s\u0085\u200B]|/\*[^*]*\*+(?:[^*/][^*]*\*+)*/|//[^\r\n\u2028\u2029]*[\r\n\u2028\u2029])*`;
const POSSIBLE_READ = new RegExp(String.raw`history${TRIVIA}(?:\?\.|\.)${TRIVIA}length`);

function isBrowserHistory(node: ts.Expression): boolean {
  if (ts.isIdentifier(node)) return node.text === "history";
  return (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === "history" &&
    ts.isIdentifier(node.expression) &&
    GLOBALS.has(node.expression.text)
  );
}

/** Lines of `source` that read the browser's global `history.length`. */
export function historyLengthReads(source: string): number[] {
  // Escaped identifiers need the parser's decoded spelling.
  if (!source.includes("\\u") && !POSSIBLE_READ.test(source)) return [];
  const file = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, true);
  const lines = new Set<number>();
  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "length" &&
      isBrowserHistory(node.expression)
    )
      lines.add(file.getLineAndCharacterOfPosition(node.getStart()).line + 1);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...lines].sort((a, b) => a - b);
}

function testFilesIn(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) out.push(...testFilesIn(full));
    else if (stats.isFile() && full.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

describe("historyLengthReads", () => {
  test("flags the global history's length", () => {
    expect(historyLengthReads("const n = history.length;")).toEqual([1]);
    expect(historyLengthReads("\nexpect(window.history.length).toBe(n);")).toEqual([2]);
    expect(historyLengthReads("expect(globalThis.history.length).toBe(n);")).toEqual([1]);
  });

  test("passes another object's history, and a mention in a comment or string", () => {
    expect(historyLengthReads("saved.attempt.revision = saved.attempt.history.length;")).toEqual(
      [],
    );
    expect(historyLengthReads("const stored = f.history.length;")).toEqual([]);
    expect(historyLengthReads("/** `history.length` cannot show a push. */")).toEqual([]);
    expect(historyLengthReads('const s = "history.length";')).toEqual([]);
  });

  test("keeps findings across trivia, optional reads and identifier escapes", () => {
    for (const [source, lines] of [
      ["\nhistory \t. length;", [2]],
      ["history/* first\nsecond */./* third\nfourth */length;", [1]],
      ["history// first\n.length;", [1]],
      ["history// first\r.length;", [1]],
      ["history// first\r\n.// second\u2028length;", [1]],
      ["history// first\u2029.length;", [1]],
      ["history\u0085.length;", [1]],
      ["history.\u200blength;", [1]],
      ["history\u00a0.length;", [1]],
      ["history.\ufefflength;", [1]],
      ["history?.length;", [1]],
      ["window.history?.length;", [1]],
      ["globalThis?.history?.length;", [1]],
      [String.raw`h\u0069story.length;`, [1]],
      [String.raw`history.l\u0065ngth;`, [1]],
      [String.raw`\u{68}istory.length;`, [1]],
      ["history.length;\nhistory.length; history.length;", [1, 2]],
      ["other.history /* comment */ .length;", []],
      ['const text = "history /* comment */ .length";', []],
      ["/* history?.length; */", []],
    ] as const) {
      expect(historyLengthReads(source), JSON.stringify(source)).toEqual(lines);
    }
  });
});

describe("the tree", () => {
  const files = ROOTS.flatMap((root) => testFilesIn(join(ROOT, root)));

  test("reaches both roots", () => {
    for (const root of ROOTS)
      expect(files.some((file) => relative(ROOT, file).startsWith(`${root}/`))).toBe(true);
  });

  test("no test reads the browser's history.length", () => {
    const found: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const line of historyLengthReads(source)) {
        found.push(`${relative(ROOT, file)}:${line}`);
      }
    }
    expect(found).toEqual([]);
  });
});
