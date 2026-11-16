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
 * one file at a time, and only a file whose text contains `<wt-data-table`. Cell markup is the
 * value of an object property named `cell` (or a `cell()` method), each argument of a call to a
 * function named `cell`, and a `.rowControls=${…}` binding, plus the bodies of the functions they
 * call, followed transitively: `this.foo(…)` or `this.#foo(…)` is the member of the class `this`
 * belongs to, and `foo(…)` the function the nearest enclosing scope of the file declares under that
 * name. It misses a method inherited from a superclass, a function passed as a value
 * (`.map(this.#row)`) rather than called, and a helper imported from another file; it never looks
 * inside an event listener (`@click=${…}`). Classes are read from the static text of `class="…"` in
 * `html` templates and the keys of `classMap({…})`; a class built in an expression (`class=${…}`,
 * or part of a name joined to a placeholder) is invisible. Styled classes are the `.name` selectors
 * in rule preludes of the file's own `css` templates; a selector built by an interpolation, a
 * stylesheet imported from another module and one held in a plain string are never read. It can
 * wrongly refuse a class that another element in the same file styles, since it does not know which
 * `css` belongs to the element rendering the table; markup a function the cell calls stores
 * elsewhere rather than returns; the arguments of an unrelated function named `cell`; and an outer
 * function whose name a destructured or loop variable reuses at the call.
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

type FunctionLike = ts.FunctionLikeDeclaration;

function asFunction(node: ts.Node | undefined): FunctionLike | undefined {
  return node !== undefined && ts.isFunctionLike(node) && "body" in node ? node : undefined;
}

/** The class whose instance `this` names at `node`, unless a non-arrow function rebinds it first. */
function thisClass(node: ts.Node): ts.ClassLikeDeclaration | undefined {
  for (let at = node.parent; at !== undefined; at = at.parent) {
    if (ts.isClassLike(at)) return at;
    if (ts.isFunctionDeclaration(at) || ts.isFunctionExpression(at)) return undefined;
    if (ts.isMethodDeclaration(at) && ts.isObjectLiteralExpression(at.parent)) return undefined;
  }
  return undefined;
}

/** The function a scope declares under `name`: `null` when something else holds the name there. */
function declaredIn(scope: ts.Node, name: string): FunctionLike | null | undefined {
  if (ts.isFunctionLike(scope))
    for (const parameter of scope.parameters)
      if (ts.isIdentifier(parameter.name) && parameter.name.text === name) return null;
  const statements = (scope as { statements?: ts.NodeArray<ts.Statement> }).statements ?? [];
  for (const statement of statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return statement;
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations)
        if (ts.isIdentifier(declaration.name) && declaration.name.text === name)
          return asFunction(declaration.initializer) ?? null;
  }
  return undefined;
}

/**
 * The function in this file that `expression` names: `this.foo` or `this.#foo` is the member of the
 * class `this` belongs to, and `foo` the function the nearest enclosing scope declares under that name.
 */
function resolve(expression: ts.Expression): FunctionLike | undefined {
  if (ts.isIdentifier(expression)) {
    for (let scope: ts.Node | undefined = expression.parent; scope; scope = scope.parent) {
      const found = declaredIn(scope, expression.text);
      if (found !== undefined) return found ?? undefined;
    }
    return undefined;
  }
  if (!ts.isPropertyAccessExpression(expression)) return undefined;
  if (expression.expression.kind !== ts.SyntaxKind.ThisKeyword) return undefined;
  const name = memberName(expression.name);
  const member = thisClass(expression)?.members.find(
    (candidate) => candidate.name !== undefined && memberName(candidate.name) === name,
  );
  if (member === undefined) return undefined;
  return ts.isPropertyDeclaration(member) ? asFunction(member.initializer) : asFunction(member);
}

/** The static text that comes before each placeholder of an `html` template, paired with it. */
function placeholders(template: ts.TemplateExpression): [string, ts.Expression][] {
  const before = [template.head.text, ...template.templateSpans.map((span) => span.literal.text)];
  return template.templateSpans.map((span, index) => [before[index]!, span.expression]);
}

/**
 * The class names a `css` template styles: the `.name` selectors of each rule's prelude, leaving
 * out at-rules, comments, strings, declaration values and the argument of `:host()`,
 * `:host-context()` or `::slotted()`, which select the host or its own children, never markup
 * inside another shadow root.
 */
function styledClasses(template: ts.TaggedTemplateExpression): string[] {
  const text = staticText(template)
    .text.replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""');
  const names: string[] = [];
  for (const [, prelude] of text.matchAll(/([^{};]*)\{/g)) {
    if (prelude!.trim().startsWith("@")) continue;
    const selector = prelude!.replace(/(?::host(?:-context)?|::slotted)\([^)]*\)/g, "");
    for (const match of selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) names.push(match[1]!);
  }
  return names;
}

/** Each class a file both puts on `wt-data-table` cell markup and styles in its own `css`. */
export function cellClassesStyledInFile(source: string): CellClass[] {
  if (!source.includes("<wt-data-table")) return [];
  const file = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, true);
  const line = (position: number) => file.getLineAndCharacterOfPosition(position).line + 1;
  const roots: ts.Node[] = [];
  const styled = new Set<string>();

  const collect = (node: ts.Node): void => {
    if (
      ts.isMethodDeclaration(node) &&
      memberName(node.name) === "cell" &&
      ts.isObjectLiteralExpression(node.parent)
    )
      roots.push(node);
    else if (ts.isPropertyAssignment(node) && memberName(node.name) === "cell")
      roots.push(node.initializer);
    else if (ts.isShorthandPropertyAssignment(node) && node.name.text === "cell")
      roots.push(node.name);
    else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "cell"
    )
      roots.push(...node.arguments);
    else if (ts.isTaggedTemplateExpression(node) && tagName(node) === "css")
      for (const name of styledClasses(node)) styled.add(name);
    else if (
      ts.isTaggedTemplateExpression(node) &&
      tagName(node) === "html" &&
      ts.isTemplateExpression(node.template)
    )
      for (const [before, expression] of placeholders(node.template))
        if (/\.rowControls\s*=\s*["']?$/.test(before)) roots.push(expression);
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
  const follow = (expression: ts.Expression) => {
    const target = resolve(expression);
    if (target !== undefined) queue.push(target);
  };
  const walk = (node: ts.Node): void => {
    if (ts.isTaggedTemplateExpression(node) && tagName(node) === "html") {
      const { text, offsets } = staticText(node);
      for (const match of text.matchAll(/(?<=\s)class\s*=\s*(["'])([^"']*)\1/g)) {
        const valueStart = match.index! + match[0].length - match[2]!.length - 1;
        for (const token of match[2]!.matchAll(/[^\s]+/g))
          if (!token[0].includes("\0")) record(token[0], offsets[valueStart + token.index!]!);
      }
      if (ts.isTemplateExpression(node.template))
        for (const [before, expression] of placeholders(node.template))
          // An event listener's markup renders wherever the listener puts it, not in the cell.
          if (!/@[^\s=]+\s*=\s*["']?$/.test(before)) walk(expression);
      return;
    }
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && node.expression.text === "classMap") {
        const map = node.arguments[0];
        if (map && ts.isObjectLiteralExpression(map))
          for (const property of map.properties)
            if (property.name) {
              const name = memberName(property.name);
              if (name !== undefined)
                for (const part of name.split(/\s+/)) record(part, property.name.getStart());
            }
      } else follow(node.expression);
    }
    ts.forEachChild(node, walk);
  };
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (seen.has(node)) continue;
    seen.add(node);
    if (ts.isExpression(node)) follow(node);
    walk(node);
  }
  return [...found.values()].sort(
    (a, b) => a.line - b.line || a.className.localeCompare(b.className),
  );
}

const TABLE =
  "  render() { return html`<wt-data-table .columns=${this.columns}></wt-data-table>`; }";

describe("the matcher", () => {
  it("reports a class on cell markup that the file's stylesheet styles", () => {
    const source = [
      "class S extends LitElement {",
      "  static styles = css`.swatch { width: 1px; }`;",
      "  columns = [{ key: 'c', cell: (r) => html`<span class=\"swatch\"></span>` }];",
      TABLE,
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
      TABLE,
      "}",
    ].join("\n");
    expect(cellClassesStyledInFile(source)).toEqual([{ className: "swatch", line: 5 }]);
  });

  it("follows a map callback and a function declared in the file", () => {
    const source = [
      'const chip = (t) => html`<i class="chip">${t}</i>`;',
      "class S extends LitElement {",
      "  static styles = css`.chip, .tag { width: 1px; }`;",
      "  columns = [{ key: 'c', cell: (r) => html`${r.tags.map((t) => html`<b class=\"tag\">${chip(t)}</b>`)}` }];",
      TABLE,
      "}",
    ].join("\n");
    expect(cellClassesStyledInFile(source)).toEqual([
      { className: "chip", line: 1 },
      { className: "tag", line: 4 },
    ]);
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

  it("reads a rowControls binding written with spaces around the equals sign", () => {
    const source = [
      "class S extends LitElement {",
      "  static styles = css`.grip { width: 1px; }`;",
      "  render() {",
      '    return html`<wt-data-table .rowControls = ${(r) => html`<i class="grip"></i>`}></wt-data-table>`;',
      "  }",
      "}",
    ].join("\n");
    expect(cellClassesStyledInFile(source)).toEqual([{ className: "grip", line: 4 }]);
  });

  it("reads the markup passed to a cell() helper as cell markup", () => {
    const source = [
      "class S extends LitElement {",
      "  static styles = css`.earlier { width: 1px; }`;",
      "  columns() {",
      "    const column = (key, cell) => ({ key, cell });",
      "    const cell = (read) => (row) => read(row);",
      "    return [column('a', cell((row) => html`<span class=\"earlier\"></span>`))];",
      "  }",
      TABLE,
      "}",
    ].join("\n");
    expect(cellClassesStyledInFile(source)).toEqual([{ className: "earlier", line: 6 }]);
  });

  it("reads class selectors inside an at-rule and beside an interpolation, and after :host()", () => {
    const source = [
      "class S extends LitElement {",
      "  static styles = css`${shared} .v { width: 1px; } @media (min-width: 1px) { .w { width: 1px; } } :host(.z) .y { width: 1px; }`;",
      "  columns = [{ key: 'c', cell: (r) => html`<span class=\"v w y\"></span>` }];",
      TABLE,
      "}",
    ].join("\n");
    expect(cellClassesStyledInFile(source)).toEqual([
      { className: "v", line: 3 },
      { className: "w", line: 3 },
      { className: "y", line: 3 },
    ]);
  });

  it("passes a part styled through wt-data-table::part()", () => {
    const source = [
      "class S extends LitElement {",
      "  static styles = css`wt-data-table::part(swatch) { width: 1px; }`;",
      "  columns = [{ key: 'c', cell: (r) => html`<span part=\"swatch\"></span>` }];",
      TABLE,
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
      TABLE,
      "}",
    ].join("\n");
    expect(cellClassesStyledInFile(source)).toEqual([]);
  });

  it("passes a data-class attribute on cell markup", () => {
    const source = [
      "class S extends LitElement {",
      "  static styles = css`.x { width: 1px; }`;",
      "  columns = [{ key: 'c', cell: (r) => html`<span data-class=\"x\"></span>` }];",
      TABLE,
      "}",
    ].join("\n");
    expect(cellClassesStyledInFile(source)).toEqual([]);
  });

  it("passes another class's same-named method", () => {
    const source = [
      "class S extends LitElement {",
      "  columns = [{ key: 'c', cell: (r) => this.helper(r) }];",
      '  helper(r) { return html`<span part="x"></span>`; }',
      TABLE,
      "}",
      "class T extends LitElement {",
      "  static styles = css`.x { width: 1px; }`;",
      '  helper() { return html`<span class="x"></span>`; }',
      "}",
    ].join("\n");
    expect(cellClassesStyledInFile(source)).toEqual([]);
  });

  it("passes markup an event listener in a cell renders, and still follows the cell's own calls", () => {
    const source = [
      "class S extends LitElement {",
      "  static styles = css`.x, .y { width: 1px; }`;",
      "  columns = [{ key: 'c', cell: (r) => html`<wt-button @click=${() => this.#openDialog(r)}>${this.#label(r)}</wt-button>` }];",
      '  #openDialog(r) { return html`<wt-dialog class="x"></wt-dialog>`; }',
      '  #label(r) { return html`<span class="y"></span>`; }',
      TABLE,
      "}",
    ].join("\n");
    expect(cellClassesStyledInFile(source)).toEqual([{ className: "y", line: 5 }]);
  });

  it("passes a cell property in a file that renders no wt-data-table", () => {
    const source = [
      "class S extends LitElement {",
      "  static styles = css`.x { width: 1px; }`;",
      '  grid = { cell: () => html`<td class="x"></td>` };',
      "}",
    ].join("\n");
    expect(cellClassesStyledInFile(source)).toEqual([]);
  });

  it("passes a class named only in a declaration value or a :host() or ::slotted() argument", () => {
    const source = [
      "class S extends LitElement {",
      '  static styles = css`button::after { content: ".y"; } :host(.z) { width: 1px; } :host-context(.q) { width: 1px; } ::slotted(.s) { width: 1px; }`;',
      "  columns = [{ key: 'c', cell: (r) => html`<span class=\"y z q s\"></span>` }];",
      TABLE,
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
    const name = relative(repoRoot, file);
    for (const found of cellClassesStyledInFile(source))
      offenders.push(`${name}:${found.line} .${found.className}`);
  }

  it("styles no wt-data-table cell markup with a class", () => {
    expect(offenders.sort()).toEqual([]);
  });
});
