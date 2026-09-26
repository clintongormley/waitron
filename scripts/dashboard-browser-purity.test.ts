import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * A module's `./dashboard` sub-path is bundled into the admin dashboard, so it must never reach
 * server-only code: a runtime import of `@waitron/db`, `hono`, `pg`, `drizzle-orm` or a `node:`
 * builtin would drag Node into the browser bundle. For each listed sub-path this scans every file
 * REACHABLE from it by RELATIVE imports, including ones that leave `src/dashboard`, and forbids
 * reaching the package's own server barrel/entry (`../index.js`, `../bookings.js`).
 *
 * LIMITATIONS, because it reads TEXT: it resolves RELATIVE paths only, so a CROSS-PACKAGE
 * transitive leak (a dashboard file → a browser-safe `@waitron/x` export → server code inside that
 * package) is NOT followed, and no dashboard bundle is built by a pull request that leaves
 * `deploy/` alone, so nothing catches that case on such a pull request. A `from "@waitron/db"`
 * inside a comment counts, and a dynamic `import("…")` does not.
 */
const REPO = join(import.meta.dirname, "..");
const FORBIDDEN = ["@waitron/db", "hono", "pg", "drizzle-orm", "node:"];
const SERVER_ENTRIES = ['from "../index.js"', 'from "../bookings.js"'];
const SUBPATHS: Array<[string, string]> = [
  ["@waitron/bookings", "packages/bookings/src/dashboard"],
];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(p));
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

function forbiddenImports(text: string): string[] {
  return FORBIDDEN.filter((f) => text.includes(`from "${f}`) || text.includes(`import "${f}`));
}

function serverEntryImports(text: string): string[] {
  return SERVER_ENTRIES.filter((e) => text.includes(e));
}

/** Every RELATIVE import/export specifier in a source (`from "./x"`, side-effect `import "../y"`),
 * the only edges reachability follows; a bare-package specifier (`@waitron/x`, `lit`) is not
 * followed. */
function relativeSpecifiers(text: string): string[] {
  const out: string[] = [];
  for (const re of [/from\s+["']([^"']+)["']/g, /import\s+["']([^"']+)["']/g]) {
    for (const m of text.matchAll(re)) if (m[1]!.startsWith(".")) out.push(m[1]!);
  }
  return out;
}

/** Resolve a relative specifier from `fromFile` to an on-disk `.ts` file, or undefined: `.js`
 * maps to `.ts`, then a bare `.ts`, then a `/index.ts` directory entry. */
function resolveToTs(fromFile: string, spec: string): string | undefined {
  const base = join(dirname(fromFile), spec);
  const candidates = [base.replace(/\.js$/, ".ts"), `${base}.ts`, join(base, "index.ts")];
  return candidates.find((c) => {
    try {
      readFileSync(c);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Every `.ts` file reachable from `entryFiles` by RELATIVE imports (the entries included), followed
 * transitively, so a sibling OUTSIDE `src/dashboard` is scanned too.
 */
function reachableFrom(entryFiles: string[]): string[] {
  const seen = new Set<string>();
  const queue = [...entryFiles];
  while (queue.length) {
    const f = queue.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const spec of relativeSpecifiers(readFileSync(f, "utf8"))) {
      const resolved = resolveToTs(f, spec);
      if (resolved !== undefined && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return [...seen];
}

describe("module dashboard sub-paths import no server-only specifier", () => {
  for (const [pkg, dir] of SUBPATHS) {
    const files = tsFiles(join(REPO, dir));
    const reached = reachableFrom(files);

    it(`${pkg}/dashboard scans files (not vacuous)`, () => {
      expect(files.length).toBeGreaterThan(0);
    });

    it.each(files.map((f) => [relative(REPO, f), f] as const))(
      "%s imports no server-only specifier (direct)",
      (_rel, file) => {
        expect(forbiddenImports(readFileSync(file, "utf8"))).toEqual([]);
      },
    );

    it.each(reached.map((f) => [relative(REPO, f), f] as const))(
      "%s imports no server-only specifier (reachable)",
      (_rel, file) => {
        const text = readFileSync(file, "utf8");
        expect(forbiddenImports(text)).toEqual([]);
        expect(serverEntryImports(text)).toEqual([]);
      },
    );

    it(`${pkg}/dashboard imports no sibling server entry`, () => {
      for (const f of files) {
        const text = readFileSync(f, "utf8");
        expect(text.includes('from "../index.js"'), f).toBe(false);
        expect(text.includes('from "../bookings.js"'), f).toBe(false);
      }
    });
  }

  it("the kit and registry packages declare no server dependency", () => {
    // The browser-bundled infrastructure packages must stay free of a direct server dependency. The
    // registry's `@waitron/bookings` dep is the whole module package, but the app imports only its
    // browser `./dashboard` sub-path.
    for (const pkg of ["dashboard-kit", "dashboard-modules"]) {
      const m = JSON.parse(readFileSync(join(REPO, `packages/${pkg}/package.json`), "utf8")) as {
        dependencies?: Record<string, string>;
      };
      expect(Object.keys(m.dependencies ?? {}).filter((d) => FORBIDDEN.includes(d))).toEqual([]);
    }
  });

  it("detects a planted server import (positive control)", () => {
    const probe = 'import { x } from "@waitron/db";';
    expect(forbiddenImports(probe)).toEqual(["@waitron/db"]);
  });

  describe("the catalogue wire-shape leaves stay type-only (emit no runtime)", () => {
    // Each leaf holds wire shapes a browser app imports DIRECTLY
    // (`@waitron/catalogue/src/<leaf>.js`), so each must be a PURE type module that compiles to an
    // empty runtime module. The reachable-specifier scan above would false-positive here on an
    // erased `import type` edge, so the check is on each leaf's own statements instead.
    //
    // HEDGE (it reads TEXT, not the compiler): it flags an `import` that is not `import type`, an
    // `export` that is not `export type`/`export interface`, and a bare top-level value declaration
    // (`const`/`let`/`var`/`function`/`class`/`enum`). It would NOT catch a top-level expression
    // statement (`sideEffect();`), and nothing transpiles these leaves on a pull request that
    // leaves `deploy/` alone.
    const LEAVES = [
      "packages/catalogue/src/product-types.ts",
      "packages/catalogue/src/menu-types.ts",
      "packages/catalogue/src/modifier-list-types.ts",
      "packages/catalogue/src/section-types.ts",
      "packages/catalogue/src/menu-document-types.ts",
    ];

    /** Every top-level statement in `src` that would emit runtime JS: an `import` that is not
     * `import type`, an `export` that is not `export type`/`export interface`, or a bare value
     * declaration. Comments are stripped first so prose mentioning `import`/`export` is not
     * misread as code. A file with none of these transpiles to empty. */
    function runtimeStatements(src: string): string[] {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      const out: string[] = [];
      // Anchored at column 0 (no leading whitespace): a module's import/export/value statements sit
      // at the top level, while an interface's members are always indented — so a wire field NAMED
      // `import`, `export`, `class`, `enum`, `const`, … is not mistaken for a runtime statement.
      for (const m of code.matchAll(/^import\b[^\n]*/gm)) {
        if (!/^import\s+type\b/.test(m[0])) out.push(m[0].trim());
      }
      for (const m of code.matchAll(/^export\b[^\n]*/gm)) {
        if (!/^export\s+(?:type|interface)\b/.test(m[0])) out.push(m[0].trim());
      }
      for (const m of code.matchAll(/^(?:const|let|var|function|class|enum)\b[^\n]*/gm)) {
        out.push(m[0].trim());
      }
      return out;
    }

    // An EMPTY file is type-only too, and so is a path that no longer names the leaf the browser
    // imports, so every leaf must have at least one exported type.
    it.each(LEAVES)("%s exports at least one type (not vacuous)", (leaf) => {
      expect(/^export\s+(?:type|interface)\b/m.test(readFileSync(join(REPO, leaf), "utf8"))).toBe(
        true,
      );
    });

    it.each(LEAVES)("%s is type-only: no runtime import, export, or declaration", (leaf) => {
      expect(runtimeStatements(readFileSync(join(REPO, leaf), "utf8"))).toEqual([]);
    });

    it("flags planted runtime constructs, ignores type-only ones (control)", () => {
      // A relative side-effect import, a NON-relative server-package import, a value import, a
      // value export and a bare declaration are each caught.
      expect(runtimeStatements('import "./operations.js";')).toEqual(['import "./operations.js";']);
      expect(runtimeStatements('import "@waitron/db";')).toEqual(['import "@waitron/db";']);
      expect(runtimeStatements('import { readProductEditor } from "./operations.js";')).toEqual([
        'import { readProductEditor } from "./operations.js";',
      ]);
      expect(runtimeStatements("export const reviewRuntime = 1;")).toEqual([
        "export const reviewRuntime = 1;",
      ]);
      expect(runtimeStatements("const x = 1;")).toEqual(["const x = 1;"]);
      expect(runtimeStatements('import type { Product } from "./operations.js";')).toEqual([]);
      expect(runtimeStatements('export type { Product } from "./operations.js";')).toEqual([]);
      expect(runtimeStatements("export interface Foo { a: string }")).toEqual([]);
      // An INDENTED interface member whose name is a keyword is not a top-level statement.
      expect(
        runtimeStatements("export interface Foo {\n  class: string;\n  import: number;\n}"),
      ).toEqual([]);
    });
  });

  describe("reachability follows a relative import out of src/dashboard (regression)", () => {
    // A `src/dashboard` file importing a sibling OUTSIDE `src/dashboard` that imports a forbidden
    // specifier passes a DIRECT-only scan; the transitive walk must reach the sibling and flag it.
    const root = mkdtempSync(join(tmpdir(), "dash-purity-"));
    const dashDir = join(root, "src", "dashboard");
    const otherDir = join(root, "src", "server");
    mkdirSync(dashDir, { recursive: true });
    mkdirSync(otherDir, { recursive: true });
    const entry = join(dashDir, "entry.ts");
    const leak = join(otherDir, "leak.ts");
    writeFileSync(
      entry,
      'import { deepThing } from "../server/leak.js";\nexport const x = deepThing;\n',
    );
    writeFileSync(leak, 'import { sql } from "drizzle-orm";\nexport const deepThing = sql;\n');
    afterAll(() => rmSync(root, { recursive: true, force: true }));

    it("reaches the sibling and flags its forbidden import", () => {
      const reached = reachableFrom([entry]);
      expect(reached).toContain(leak);
      const found = reached.flatMap((f) => forbiddenImports(readFileSync(f, "utf8")));
      expect(found).toEqual(["drizzle-orm"]);
    });

    it("a DIRECT-only scan of src/dashboard misses it — why the walk is needed", () => {
      // The entry file itself imports nothing forbidden; only its out-of-dir sibling does.
      expect(forbiddenImports(readFileSync(entry, "utf8"))).toEqual([]);
    });
  });
});
