import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
function runtimeImports(source: string): string[] {
  const file = ts.createSourceFile("input.ts", source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const onlyTypes =
        clause?.isTypeOnly === true ||
        (clause?.name === undefined &&
          bindings !== undefined &&
          ts.isNamedImports(bindings) &&
          bindings.elements.length > 0 &&
          bindings.elements.every((e) => e.isTypeOnly));
      if (!onlyTypes) found.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const onlyTypes =
        node.exportClause !== undefined &&
        ts.isNamedExports(node.exportClause) &&
        node.exportClause.elements.length > 0 &&
        node.exportClause.elements.every((e) => e.isTypeOnly);
      if (!onlyTypes) found.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]!)
    )
      found.push(node.arguments[0]!.text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}
function forbiddenReachable(
  entry: string,
  source: (path: string) => string,
  resolveImport: (path: string, spec: string) => string | undefined,
): string[] {
  const seen = new Set<string>();
  const bad: string[] = [];
  function visit(file: string): void {
    if (seen.has(file)) return;
    seen.add(file);
    for (const spec of runtimeImports(source(file))) {
      const next = resolveImport(file, spec);
      if (next === undefined) continue;
      if (/\/demo(?:\/|\.ts$|-testing\.ts$)|\/test-fixtures\//.test(next))
        bad.push(`${file} -> ${next}`);
      visit(next);
    }
  }
  visit(entry);
  return bad;
}
function localImport(file: string, spec: string): string | undefined {
  let path: string;
  if (spec.startsWith(".")) path = resolve(dirname(file), spec);
  else if (spec.startsWith("@waitron/")) {
    const [name, ...segments] = spec.slice("@waitron/".length).split("/");
    const directory = join(ROOT, "packages", name!);
    const manifestPath = join(directory, "package.json");
    if (!existsSync(manifestPath)) return undefined;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      main?: string;
      exports?: Record<string, string>;
    };
    const target = segments.length
      ? manifest.exports?.[`./${segments.join("/")}`]
      : (manifest.exports?.["."] ?? manifest.main);
    if (target === undefined) throw new Error(`Unresolved workspace entry ${spec}`);
    path = resolve(directory, target);
  } else return undefined;
  const target = [path.replace(/\.js$/, ".ts"), path, join(path, "index.ts")].find(existsSync);
  if (target === undefined) throw new Error(`Unresolved local import ${file} -> ${spec}`);
  return target;
}
describe("demo entry reachability", () => {
  it.each(["import './helper.ts';", "export * from './helper.ts';", "void import('./helper.ts');"])(
    "detects an indirect runtime leak through %s",
    (statement) => {
      const files: Record<string, string> = {
        "/main.ts": statement,
        "/helper.ts": "export { dish } from './demo/menu.ts';",
        "/demo/menu.ts": "export const dish = 'food';",
      };
      expect(
        forbiddenReachable(
          "/main.ts",
          (p) => files[p]!,
          (p, s) => resolve(dirname(p), s),
        ),
      ).toHaveLength(1);
    },
  );
  it("allows type-only edges, cycles and legitimate secondary imports", () => {
    const files: Record<string, string> = {
      "/main.ts":
        "import type { Dish } from './demo/menu.ts'; export type { Dish } from './demo/menu.ts'; import { type Dish } from './demo/menu.ts'; export { type Dish } from './demo/menu.ts'; import './helper.ts';",
      "/helper.ts": "import './main.ts';",
      "/demo/menu.ts": "export const dish = 'food';",
    };
    expect(
      forbiddenReachable(
        "/main.ts",
        (p) => files[p]!,
        (p, s) => resolve(dirname(p), s),
      ),
    ).toEqual([]);
    expect(
      forbiddenReachable(
        "/demo/menu.ts",
        (p) => files[p]!,
        (p, s) => resolve(dirname(p), s),
      ),
    ).toEqual([]);
  });
  it.each(["country-es", "country-packs"])(
    "keeps %s main transitively free of demo data and fixtures",
    (name) => {
      const entry = join(ROOT, "packages", name, "src/index.ts");
      expect(forbiddenReachable(entry, (p) => readFileSync(p, "utf8"), localImport)).toEqual([]);
    },
  );
  it.each(["country-es", "country-packs"])(
    "keeps %s demo exports independent of fixture readers and filesystem APIs",
    (name) => {
      const entry = join(
        ROOT,
        "packages",
        name,
        "src/demo" + (name === "country-es" ? "/index.ts" : ".ts"),
      );
      expect(existsSync(entry), "secondary demo entry exists").toBe(true);
      const visited = new Set<string>();
      function visit(file: string): void {
        if (visited.has(file)) return;
        visited.add(file);
        for (const spec of runtimeImports(readFileSync(file, "utf8"))) {
          expect(spec).not.toMatch(/^node:|demo\/testing|demo-testing|test-fixtures/);
          const next = localImport(file, spec);
          if (next !== undefined) visit(next);
        }
      }
      visit(entry);
    },
  );
});
