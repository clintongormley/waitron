import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Contract: markup a screen hands to `wt-data-table` as a cell is styled with `part=` and
 * `::part()`, never a CSS class, because the table renders it inside its own shadow root, where the
 * screen's stylesheet matches nothing (design-system.md, "Style your own cell markup with `part=`").
 * This reports each class name that a file both puts on cell markup and styles as `.name` in one
 * of its own `css` templates.
 *
 * Weaker than its name: it reads only `.ts` files under `apps/` and `packages/`, less `*.test.ts`,
 * one file at a time. Cell markup is what lies inside the value of an object property named `cell`
 * (or a `cell()` method) and inside a `.rowControls=${…}` binding, plus the bodies of functions and
 * methods in the SAME file that those call by name (`foo(…)`, `this.foo(…)`, `this.#foo(…)`),
 * followed transitively. Markup passed in as an argument — the till's find-bill screen hands each
 * column's template to a `column(key, cell(…))` helper — is not reached, nor is a helper imported
 * from another file. Classes are read from the static text of `class="…"` in `html` templates and
 * the keys of `classMap({…})`; a class built in an expression (`class=${…}`, part of a name joined
 * to a placeholder) is invisible. Styled classes are the `.name` selectors in the file's own `css`
 * templates; a stylesheet imported from another module, or held in a plain string, is never read.
 * It does not know which `css` template belongs to the element rendering the table, so a class
 * styled by another element in the same file still counts.
 */

const repoRoot = join(import.meta.dirname, "..");
const ROOTS = ["apps", "packages"];

interface CellClass {
  className: string;
  line: number;
}

type Literal =
  ts.NoSubstitutionTemplateLiteral | ts.TemplateHead | ts.TemplateMiddle | ts.TemplateTail;

/** A tagged template's static text, its pieces joined by NUL, with each character's source offset. */
function staticText(template: ts.TaggedTemplateExpression): { text: string; offsets: number[] } {
  const literals: Literal[] = ts.isNoSubstitutionTemplateLiteral(template.template)
    ? [template.template]
    : [template.template.head, ...template.template.templateSpans.map((span) => span.literal)];
  let text = "";
  const offsets: number[] = [];
  for (const literal of literals) {
    if (text !== "") {
      text += "\0";
      offsets.push(-1);
    }
    const raw = literal.getText();
    const start = literal.getStart() + 1;
    const end = raw.endsWith("${") ? raw.length - 2 : raw.length - 1;
    for (let i = 1; i < end; i++) {
      text += raw[i];
      offsets.push(start + i - 1);
    }
  }
  return { text, offsets };
}

function tagName(node: ts.TaggedTemplateExpression): string | undefined {
  return ts.isIdentifier(node.tag) ? node.tag.text : undefined;
}

function memberName(name: ts.Node): string | undefined {
  return ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name)
    ? name.text
    : undefined;
}

/** The name a call or reference resolves by: `foo`, `this.foo` or `this.#foo`. */
function calleeName(node: ts.Expression): string | undefined {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword)
    return memberName(node.name);
  return undefined;
}

/** Each class a file both puts on `wt-data-table` cell markup and styles in its own `css`. */
export function cellClassesStyledInFile(source: string): CellClass[] {
  const file = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, true);
  const line = (position: number) => file.getLineAndCharacterOfPosition(position).line + 1;
  const functions = new Map<string, ts.Node[]>();
  const roots: ts.Node[] = [];
  const styled = new Set<string>();
  const declare = (name: string | undefined, node: ts.Node) => {
    if (name !== undefined) functions.set(name, [...(functions.get(name) ?? []), node]);
  };
  const isFunction = (node: ts.Node | undefined) =>
    node !== undefined && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));

  const collect = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) declare(node.name.text, node);
    else if (ts.isMethodDeclaration(node)) {
      declare(memberName(node.name), node);
      if (memberName(node.name) === "cell" && ts.isObjectLiteralExpression(node.parent))
        roots.push(node);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      isFunction(node.initializer)
    )
      declare(node.name.text, node.initializer!);
    else if (ts.isPropertyDeclaration(node) && isFunction(node.initializer))
      declare(memberName(node.name), node.initializer!);
    else if (ts.isPropertyAssignment(node) && memberName(node.name) === "cell")
      roots.push(node.initializer);
    else if (ts.isShorthandPropertyAssignment(node) && node.name.text === "cell")
      roots.push(node.name);
    else if (ts.isTaggedTemplateExpression(node) && tagName(node) === "css") {
      const text = staticText(node).text.replace(/\/\*[\s\S]*?\*\//g, "");
      for (const match of text.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) styled.add(match[1]!);
    } else if (
      ts.isTaggedTemplateExpression(node) &&
      tagName(node) === "html" &&
      !ts.isNoSubstitutionTemplateLiteral(node.template)
    ) {
      let before = node.template.head.text;
      for (const span of node.template.templateSpans) {
        if (/\.rowControls=$/.test(before)) roots.push(span.expression);
        before = span.literal.text;
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(file);

  const found = new Map<string, CellClass>();
  const record = (className: string, position: number) => {
    if (!styled.has(className)) return;
    const key = `${className}:${line(position)}`;
    if (!found.has(key)) found.set(key, { className, line: line(position) });
  };
  const seen = new Set<ts.Node>();
  const queue = [...roots];
  const follow = (name: string | undefined) => {
    for (const target of (name && functions.get(name)) || []) queue.push(target);
  };
  const walk = (node: ts.Node): void => {
    if (ts.isTaggedTemplateExpression(node) && tagName(node) === "html") {
      const { text, offsets } = staticText(node);
      for (const match of text.matchAll(/\bclass\s*=\s*(["'])([^"']*)\1/g)) {
        const valueStart = match.index! + match[0].length - match[2]!.length - 1;
        for (const token of match[2]!.matchAll(/[^\s]+/g))
          if (!token[0].includes("\0")) record(token[0], offsets[valueStart + token.index!]!);
      }
    } else if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && node.expression.text === "classMap") {
        const map = node.arguments[0];
        if (map && ts.isObjectLiteralExpression(map))
          for (const property of map.properties)
            if (property.name) {
              const name = memberName(property.name);
              if (name !== undefined)
                for (const part of name.split(/\s+/)) record(part, property.name.getStart());
            }
      } else follow(calleeName(node.expression));
    }
    ts.forEachChild(node, walk);
  };
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (seen.has(node)) continue;
    seen.add(node);
    if (ts.isExpression(node)) follow(calleeName(node));
    walk(node);
  }
  return [...found.values()].sort(
    (a, b) => a.line - b.line || a.className.localeCompare(b.className),
  );
}

describe("the matcher", () => {
  it("reports a class on cell markup that the file's stylesheet styles", () => {
    const source = [
      "class S extends LitElement {",
      "  static styles = css`.swatch { width: 1px; }`;",
      "  columns = [{ key: 'c', cell: (r) => html`<span class=\"swatch\"></span>` }];",
      "}",
    ].join("\n");
    expect(cellClassesStyledInFile(source)).toEqual([{ className: "swatch", line: 3 }]);
  });

  it("follows a method the cell calls", () => {
    const source = [
      "class S extends LitElement {",
      "  static styles = css`.swatch { width: 1px; }`;",
      "  columns = [{ key: 'c', cell: (r) => this.#swatch(r) }];",
      "  #swatch(r) {",
      '    return html`<span class="swatch"></span>`;',
      "  }",
      "}",
    ].join("\n");
    expect(cellClassesStyledInFile(source)).toEqual([{ className: "swatch", line: 5 }]);
  });

  it("reads rowControls markup and classMap keys as cell markup", () => {
    const source = [
      "class S extends LitElement {",
      "  static styles = css`.grip, .busy { width: 1px; }`;",
      "  columns = [{ key: 'c', cell: (r) => html`<b class=${classMap({ busy: r.busy })}></b>` }];",
      "  render() {",
      '    return html`<wt-data-table .rowControls=${(r) => html`<i class="grip"></i>`}></wt-data-table>`;',
      "  }",
      "}",
    ].join("\n");
    expect(cellClassesStyledInFile(source)).toEqual([
      { className: "busy", line: 3 },
      { className: "grip", line: 5 },
    ]);
  });

  it("passes a part styled through wt-data-table::part()", () => {
    const source = [
      "class S extends LitElement {",
      "  static styles = css`wt-data-table::part(swatch) { width: 1px; }`;",
      "  columns = [{ key: 'c', cell: (r) => html`<span part=\"swatch\"></span>` }];",
      "}",
    ].join("\n");
    expect(cellClassesStyledInFile(source)).toEqual([]);
  });

  it("passes a styled class used only outside the cells", () => {
    const source = [
      "class S extends LitElement {",
      "  static styles = css`.swatch { width: 1px; }`;",
      "  columns = [{ key: 'c', cell: (r) => r.name }];",
      "  render() {",
      '    return html`<span class="swatch"></span><wt-data-table .columns=${this.columns}></wt-data-table>`;',
      "  }",
      "}",
    ].join("\n");
    expect(cellClassesStyledInFile(source)).toEqual([]);
  });

  it("passes a class on cell markup that no stylesheet in the file styles", () => {
    const source = [
      "class S extends LitElement {",
      "  static styles = css`.other { width: 1px; }`;",
      "  columns = [{ key: 'c', cell: (r) => html`<span class=\"swatch\"></span>` }];",
      "}",
    ].join("\n");
    expect(cellClassesStyledInFile(source)).toEqual([]);
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
    if (!source.includes("cell") && !source.includes("rowControls")) continue;
    const name = relative(repoRoot, file);
    for (const found of cellClassesStyledInFile(source))
      offenders.push(`${name}:${found.line} .${found.className}`);
  }

  it("styles no wt-data-table cell markup with a class", () => {
    expect(offenders.sort()).toEqual([]);
  });
});
