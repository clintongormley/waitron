/**
 * Every "?" (`wt-help-tooltip`) outside the setup app shows only in help mode
 * (docs/developers/design-system.md → Help mode).
 *
 * Weaker than its name: it reads TEXT — the template and string literals of each non-test `.ts`
 * file under `apps/` and `packages/`, setup excepted — so a "?" made with `document.createElement`,
 * or whose tag name is built at run time, is unseen; it refuses a bound `mode`, even one that
 * resolves to `help-mode`; and it does not check that a badge sits in a positioned box.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, test } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const ROOTS = ["apps", "packages"];
const SKIPPED = new Set(["apps/setup"]);

/** Lines of `source` holding a `wt-help-tooltip` tag without `mode="help-mode"`. The expression
 * inside each `${…}` is blanked to spaces (newlines kept), so offsets map straight back to lines and
 * a bound `mode` does not count as the literal. */
export function tooltipsOutsideHelpMode(source: string): number[] {
  const file = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, true);
  const lines = new Set<number>();
  const blank = (text: string) => text.replace(/[^\n]/g, " ");
  const scan = (node: ts.Node) => {
    const start = node.getStart();
    let text = node.getText();
    if (ts.isTemplateExpression(node)) {
      for (const span of node.templateSpans) {
        const from = span.expression.getStart() - start;
        const to = span.expression.getEnd() - start;
        text = text.slice(0, from) + blank(text.slice(from, to)) + text.slice(to);
      }
    }
    for (const match of text.matchAll(/<wt-help-tooltip\b[^>]*/g)) {
      if (/(?:^|\s)mode="help-mode"/.test(match[0])) continue;
      lines.add(file.getLineAndCharacterOfPosition(start + match.index!).line + 1);
    }
  };
  const visit = (node: ts.Node) => {
    if (
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isStringLiteral(node) ||
      ts.isTemplateExpression(node)
    )
      scan(node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...lines].sort((a, b) => a - b);
}

function sourceFilesIn(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (SKIPPED.has(relative(ROOT, full))) continue;
    const stats = statSync(full);
    if (stats.isDirectory()) out.push(...sourceFilesIn(full));
    else if (stats.isFile() && full.endsWith(".ts") && !full.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

describe("tooltipsOutsideHelpMode", () => {
  test("passes a tag in help mode", () => {
    expect(
      tooltipsOutsideHelpMode('html`<wt-help-tooltip mode="help-mode" aria-label="x">`'),
    ).toEqual([]);
  });

  test("reports a tag without a mode", () => {
    expect(tooltipsOutsideHelpMode('html`<wt-help-tooltip aria-label="x">`')).toEqual([1]);
  });

  test("reports a tag whose mode is bound", () => {
    expect(tooltipsOutsideHelpMode("html`<wt-help-tooltip mode=${x}>`")).toEqual([1]);
  });

  test("reports a tag that is always shown", () => {
    expect(tooltipsOutsideHelpMode('html`<wt-help-tooltip mode="always">`')).toEqual([1]);
  });

  test("reads a mode written after a binding, on a later line", () => {
    expect(
      tooltipsOutsideHelpMode('html`<wt-help-tooltip\n  aria-label=${l}\n  mode="help-mode">`'),
    ).toEqual([]);
  });

  test("does not read a comment", () => {
    expect(tooltipsOutsideHelpMode("// <wt-help-tooltip>\nconst x = 1;")).toEqual([]);
  });

  test("reports the line the tag starts on", () => {
    expect(
      tooltipsOutsideHelpMode("html`<div>\n<wt-help-tooltip></wt-help-tooltip></div>`"),
    ).toEqual([2]);
  });
});

describe("the tree", () => {
  const read = new Map<string, number[]>();
  for (const file of ROOTS.flatMap((root) => sourceFilesIn(join(ROOT, root)))) {
    read.set(relative(ROOT, file), tooltipsOutsideHelpMode(readFileSync(file, "utf8")));
  }

  test("reaches both roots", () => {
    for (const root of ROOTS)
      expect([...read.keys()].some((name) => name.startsWith(`${root}/`))).toBe(true);
  });

  test("skips the setup app", () => {
    expect([...read.keys()].some((name) => name.startsWith("apps/setup/"))).toBe(false);
  });

  test("every help tooltip outside setup shows only in help mode", () => {
    const offenders = [...read].flatMap(([name, lines]) => lines.map((line) => `${name}:${line}`));
    expect(offenders.sort()).toEqual([]);
  });
});
