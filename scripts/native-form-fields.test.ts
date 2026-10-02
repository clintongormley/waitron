/**
 * A screen does not draw its own form field (docs/developers/design-system.md → Forms).
 *
 * Weaker than its name: it reads TEXT — the template and string literals of each non-test `.ts`
 * file under `apps/` and `packages/`, and no other file — so a field built with
 * `document.createElement`, from markup no single literal holds (built at run time, or read from a
 * file or a response), or whose tag name is split across a `${…}` boundary is
 * invisible to it; the files in EXEMPT_FILES are not read at all, so a second field added inside
 * one passes; and an ALLOWED file is held to its count of LINES, so a field swapped for another,
 * a hidden input made visible, a field moved to another line, or one added on a line that already
 * has one, passes.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, test } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const ROOTS = ["apps", "packages"];
const NOT_TEXT = new Set([
  "checkbox",
  "radio",
  "file",
  "range",
  "color",
  "hidden",
  "button",
  "submit",
  "reset",
  "image",
]);

/** The primitives whose job is to draw the native control. */
const EXEMPT_FILES = new Set([
  "packages/ui-core/src/components/wt-input.ts",
  "packages/ui-core/src/components/wt-textarea.ts",
  "packages/ui/src/components/wt-combobox.ts",
  "packages/ui/src/components/wt-price-input.ts",
  "packages/ui/src/components/wt-number-stepper.ts",
  "packages/ui/src/components/wt-data-table.ts",
]);

/** Fields that are not fields: the list shrinks; it does not grow. */
const ALLOWED: ReadonlyArray<{ file: string; lines: number; reason: string }> = [
  {
    file: "apps/dashboard/src/screens/login-screen.ts",
    lines: 3,
    reason: "hidden username inputs for the browser's password manager",
  },
  {
    file: "apps/dashboard/src/widgets/autofill-username.ts",
    lines: 1,
    reason: "hidden username input for the browser's password manager",
  },
  {
    file: "apps/print-agent/src/setup-page.ts",
    lines: 2,
    reason:
      "an HTML string the print agent's server builds, with no script or front-end bundle; the app does not depend on @waitron/ui or @waitron/ui-core",
  },
];

/** The value of the `type` attribute among a tag's attributes, lowercased. A quote left open by the
 * tag match ending at a `>` runs to the end. */
function inputType(attributes: string): string | undefined {
  for (const attribute of attributes.matchAll(
    /(?:^|\s)([^\s"'=<>/`]+)(?:\s*=\s*(?:"([^"]*)"?|'([^']*)'?|([^\s"'=<>`]+)))?/g,
  )) {
    if (attribute[1]!.toLowerCase() !== "type") continue;
    return (attribute[2] ?? attribute[3] ?? attribute[4])?.trim().toLowerCase();
  }
  return undefined;
}

/** Lines of `source` holding a hand-drawn field. The expression inside each `${…}` is blanked to
 * spaces (newlines kept), so offsets map straight back to lines, an attribute written after a
 * binding is still seen, and a `>` inside a binding does not end the tag. A template nested inside
 * a binding is read again on its own, so lines are kept as a set. */
export function offendingFields(source: string): number[] {
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
    for (const match of text.matchAll(/<(select|textarea|input)\b([^>]*)/gi)) {
      if (match[1]!.toLowerCase() === "input") {
        const type = inputType(match[2] ?? "");
        if (type !== undefined && NOT_TEXT.has(type)) continue;
      }
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
    const stats = statSync(full);
    if (stats.isDirectory()) out.push(...sourceFilesIn(full));
    else if (stats.isFile() && full.endsWith(".ts") && !full.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

describe("offendingFields", () => {
  test("reports a select", () => {
    expect(offendingFields('html`<select name="x">`')).toEqual([1]);
  });

  test("passes a checkbox", () => {
    expect(offendingFields('html`<input type="checkbox">`')).toEqual([]);
  });

  test("reports an input with no type", () => {
    expect(offendingFields('html`<input name="x">`')).toEqual([1]);
  });

  test("reports an input whose type is bound", () => {
    expect(offendingFields("html`<input type=${t}>`")).toEqual([1]);
  });

  test("reports an input whose bound type is followed by a boolean attribute", () => {
    expect(offendingFields("html`<input type=${t} hidden>`")).toEqual([1]);
  });

  test("reports a textarea", () => {
    expect(offendingFields("html`<textarea>`")).toEqual([1]);
  });

  test("does not read a comment", () => {
    expect(offendingFields("// <select>\nconst x = 1;")).toEqual([]);
  });

  test("reports a date input", () => {
    expect(offendingFields('html`<input type="date">`')).toEqual([1]);
  });

  test("reads a type written after a binding", () => {
    expect(offendingFields('html`<input .checked=${x} type="radio">`')).toEqual([]);
  });

  test("a > inside a binding does not end the tag", () => {
    expect(offendingFields('html`<input @change=${(e) => f(e)} type="checkbox">`')).toEqual([]);
  });

  test("passes an unquoted checkbox type", () => {
    expect(offendingFields("html`<input type=checkbox>`")).toEqual([]);
  });

  test("passes a type written in capitals", () => {
    expect(offendingFields('html`<input TYPE="Checkbox">`')).toEqual([]);
  });

  test("passes a single-quoted type with spaces around the =", () => {
    expect(offendingFields("html`<input type = 'radio'>`")).toEqual([]);
  });

  test("passes an unquoted type after whitespace following the =", () => {
    expect(offendingFields("html`<input type= checkbox>`")).toEqual([]);
  });

  test("reports an input whose unquoted type is the value of an empty-looking attribute", () => {
    expect(offendingFields("html`<input title= type=checkbox>`")).toEqual([1]);
  });

  test("reports an input whose quoted type is the value of an empty-looking attribute", () => {
    expect(offendingFields('html`<input title= type="checkbox">`')).toEqual([1]);
  });

  test("reports an input whose only type is inside another attribute's name", () => {
    expect(offendingFields('html`<input data-type="checkbox" name="q">`')).toEqual([1]);
  });

  test("reports an input whose non-text type appears only inside another attribute's value", () => {
    expect(offendingFields('html`<input title="type=checkbox" type="text">`')).toEqual([1]);
  });

  test("reports an input whose only type is in a value cut short by a >", () => {
    expect(offendingFields('html`<input title="x type=checkbox>" name="q">`')).toEqual([1]);
  });

  test("reports a type that only starts with a non-text type", () => {
    expect(offendingFields('html`<input type="checkbox1">`')).toEqual([1]);
  });

  test("reports the line the tag starts on", () => {
    expect(offendingFields('html`<div>\n<select name="x"></select></div>`')).toEqual([2]);
  });
});

describe("the tree", () => {
  const allowed = new Set(ALLOWED.map((entry) => entry.file));
  const read = new Map<string, number[]>();
  for (const file of ROOTS.flatMap((root) => sourceFilesIn(join(ROOT, root)))) {
    const name = relative(ROOT, file);
    if (EXEMPT_FILES.has(name)) continue;
    read.set(name, offendingFields(readFileSync(file, "utf8")));
  }

  test("reaches both roots", () => {
    for (const root of ROOTS)
      expect([...read.keys()].some((name) => name.startsWith(`${root}/`))).toBe(true);
  });

  test("no screen draws its own form field", () => {
    const offenders = [...read]
      .filter(([name]) => !allowed.has(name))
      .flatMap(([name, lines]) => lines.map((line) => `${name}:${line}`));
    expect(offenders.sort()).toEqual([]);
  });

  test("every allowed file draws exactly the fields it is allowed", () => {
    const drawn = ALLOWED.map((entry) => [entry.file, read.get(entry.file)?.length ?? 0]);
    expect(drawn).toEqual(ALLOWED.map((entry) => [entry.file, entry.lines]));
  });

  test("every exempt file exists", () => {
    const missing = [...EXEMPT_FILES].filter((name) => {
      try {
        return !statSync(join(ROOT, name)).isFile();
      } catch {
        return true;
      }
    });
    expect(missing).toEqual([]);
  });
});
