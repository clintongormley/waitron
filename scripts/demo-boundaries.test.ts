import {
  existsSync,
  readdirSync,
  realpathSync,
  readFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Static edges and literal dynamic imports are followed; computed imports and bundler plugins are outside this source check.
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
      (ts.isStringLiteral(node.arguments[0]!) ||
        ts.isNoSubstitutionTemplateLiteral(node.arguments[0]!))
    )
      found.push(node.arguments[0]!.text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}
function forbiddenReachable(
  entry: string | readonly string[],
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
  for (const root of typeof entry === "string" ? [entry] : entry) visit(root);
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
      for (const root of typeof entry === "string" ? [entry] : entry) visit(root);
    },
  );
});

it("recognizes quoted and backtick literal imports while ignoring computed expressions", () => {
  expect(runtimeImports("void import(`./demo/index.js`);")).toEqual(["./demo/index.js"]);
  expect(runtimeImports("void import(`./${name}.js`);")).toEqual([]);
});
it("selects browser runtime files without test files, resources or screenshot directories", () => {
  expect(typeof browserSourceFiles).toBe("function");
  const root = mkdtempSync(join(tmpdir(), "demo-browser-sources-"));
  try {
    for (const file of [
      "setup/src/direct.ts",
      "setup/src/direct.test.ts",
      "setup/src/screenshot.test.ts/artifact.ts",
      "till/src/deep/lazy.mjs",
      "till/src/image.png",
      "dashboard/src/main.ts",
      "dashboard/src/testing/fixture.ts",
    ]) {
      const target = join(root, "apps", file);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, "export const value = 1;");
    }
    expect(browserSourceFiles(root)).toEqual(
      ["dashboard/src/main.ts", "setup/src/direct.ts", "till/src/deep/lazy.mjs"].map((file) =>
        join(root, "apps", file),
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function browserSourceFiles(root: string): string[] {
  const files: string[] = [];
  function visit(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name !== "testing" &&
          entry.name !== "__tests__" &&
          !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)
        )
          visit(path);
      } else if (
        entry.isFile() &&
        /\.[cm]?[jt]sx?$/.test(entry.name) &&
        !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)
      )
        files.push(path);
    }
  }
  for (const app of ["setup", "till", "dashboard"]) visit(join(root, "apps", app, "src"));
  return files.sort();
}
function browserImportResolver(): (file: string, spec: string) => string | undefined {
  const options = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
  };
  const cache = ts.createModuleResolutionCache(ROOT, (path) => path, options);
  return function resolveBrowserImport(file: string, spec: string): string | undefined {
    // A missing app dependency must not hide a forbidden workspace demo import.
    if (/^@waitron\/country-[^/]+\/demo(?:\/|$)/.test(spec)) return localImport(file, spec);
    const module = ts.resolveModuleName(spec, file, options, ts.sys, cache).resolvedModule;
    if (module === undefined || /\.d\.[cm]?ts$/.test(module.resolvedFileName)) return undefined;
    const path = realpathSync(module.resolvedFileName);
    return ["apps", "packages"].some((parent) => path.startsWith(join(ROOT, parent) + "/")) &&
      /\.[cm]?[jt]sx?$/.test(path)
      ? path
      : undefined;
  };
}
it("keeps setup, till and dashboard runtime sources transitively free of demo data", () => {
  const files = browserSourceFiles(ROOT);
  expect(files.length).toBeGreaterThan(0);
  expect(
    forbiddenReachable(files, (path) => readFileSync(path, "utf8"), browserImportResolver()),
  ).toEqual([]);
});
it.each(["setup", "till", "dashboard"])(
  "rejects literal demo imports from %s even without a declared dependency",
  (app) => {
    const entry = join(ROOT, "apps", app, "src/a972-import-probe.ts");
    for (const pack of ["country-es", "country-packs"]) {
      const spec = `@waitron/${pack}/demo`;
      const source = `void import(\`${spec}\`);`;
      const bad = forbiddenReachable(
        entry,
        (file) => (file === entry ? source : readFileSync(file, "utf8")),
        browserImportResolver(),
      );
      expect(
        bad.some((edge) => edge.startsWith(entry + " -> ")),
        spec,
      ).toBe(true);
    }
  },
);
it("allows browser type-only demo imports without reaching their data", () => {
  const entry = join(ROOT, "apps/setup/src/a972-type-probe.ts");
  const source = 'import type { DEMO_DATA_SETS } from "@waitron/country-packs/demo";';
  expect(
    forbiddenReachable(
      entry,
      (file) => (file === entry ? source : readFileSync(file, "utf8")),
      browserImportResolver(),
    ),
  ).toEqual([]);
});
