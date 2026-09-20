import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * The dashboard module-UI seam (bookings SP2): a module's `./dashboard` sub-path is BROWSER-SAFE. It is
 * bundled into the admin dashboard, so it must never reach server-only code — a runtime import of
 * `@waitron/db`, `hono`, `pg`, `drizzle-orm` or a `node:` builtin would drag Node into the browser
 * bundle (the #70 rule the app's local client shapes exist for). This guard reads text and scans, for
 * each listed sub-path, every file REACHABLE from it by RELATIVE imports for a forbidden specifier, and
 * forbids reaching the package's own server barrel/entry (`../index.js`, `../bookings.js`).
 *
 * Reachability follows `./`/`../` specifiers, INCLUDING ones that leave `src/dashboard` for elsewhere in
 * the same package — so a dashboard file that imports a browser-innocent-looking sibling which itself
 * imports `drizzle-orm` is caught, not just a forbidden import written directly in a `src/dashboard`
 * file. LIMITATION, stated because the guard reads text: it resolves RELATIVE paths only. A CROSS-
 * WORKSPACE-PACKAGE transitive leak (a dashboard file → a browser-safe `@waitron/x` export → server code
 * inside that package) is NOT followed here — resolving arbitrary workspace-package internals is beyond
 * a text scan. It used to say that case "stays the Vite-build backstop's job (`bundle-smoke`)", which
 * was wrong on both halves and is corrected here (2026-09-19): `bundle-smoke` runs no `vite build` at
 * all, and the dashboard bundle is not built by any pull request that leaves `deploy/` alone. So
 * NOTHING catches that case on a pull request. See CLAUDE.md §2 and
 * docs/developers/ci-and-gates.md.
 *
 * It reads TEXT (like module-seams / module-graph-honesty): a `from "@waitron/db"` inside a comment
 * would count, and a dynamic `import("…")` would not. Stated, not papered over — the shape it protects
 * is a static import a bundler follows.
 *
 * SUBPATHS grows as UI modules land. The package-dependency check below covers both browser-bundled
 * infrastructure packages: `dashboard-kit` (shared helpers) and `dashboard-modules` (the app-side
 * registry the app imports to mount modules).
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

/** Every RELATIVE import/export specifier in a source (`from "./x"`, side-effect `import "../y"`), the
 * only edges reachability follows — a bare-package specifier (`@waitron/x`, `lit`) is left to the
 * bundle backstop (see the header). */
function relativeSpecifiers(text: string): string[] {
  const out: string[] = [];
  for (const re of [/from\s+["']([^"']+)["']/g, /import\s+["']([^"']+)["']/g]) {
    for (const m of text.matchAll(re)) if (m[1]!.startsWith(".")) out.push(m[1]!);
  }
  return out;
}

/** Resolve a relative specifier from `fromFile` to an on-disk `.ts` file, or undefined. ESM sources
 * spell `./x.js`; the source is `./x.ts`, so `.js` maps to `.ts`. Also tries a bare `.ts` and a
 * `/index.ts` directory entry. */
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
 * transitively. THIS is what the guard's transitive protection turns on: an entry file's sibling
 * OUTSIDE `src/dashboard` (elsewhere in the package) is reached and scanned, not just the entry itself.
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
    // The browser-bundled infrastructure packages: the kit (shared helpers) and the registry
    // (@waitron/dashboard-modules, which the app imports to mount modules) must both stay free of a
    // direct server dependency. The registry's `@waitron/bookings` dep is the whole module package, but
    // the app imports only its browser `./dashboard` sub-path; a direct server specifier here (db/hono/
    // pg/drizzle/node:) is what this forbids.
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
    // `packages/catalogue/src/product-types.ts` (the product editor shapes, imported by the dashboard)
    // and `menu-types.ts` (the sell-side shapes, imported by the till) each hold wire shapes a browser
    // app imports DIRECTLY (`@waitron/catalogue/src/<leaf>.js`). Each is a PURE type module: every
    // import is `import type`, every export is a type/interface, and it declares no value — so it
    // compiles to an empty runtime module and contributes NO code, and no runtime dependency, to any
    // browser bundle. That is a STRONGER, more precise guarantee than the reachable-specifier scan
    // above, which here would false-positive on a harmless `import type` edge (the leaves they draw
    // types from reach `errors.ts`, whose own `import type { ProductUsingUnit } from "./units.js"` is
    // erased at build time but text-visible); the check is on each leaf's own statements instead.
    //
    // HEDGE (it reads TEXT, not the compiler): it flags the runtime forms that actually occur — an
    // `import` that is not `import type` (a side-effect `import "x"` or a value import, RELATIVE OR NOT,
    // so a direct `import "@waitron/db"` is caught), an `export` that is not `export type`/`export
    // interface` (`export const`, `export {value}`, `export default`), and a bare top-level value
    // declaration (`const`/`let`/`var`/`function`/`class`/`enum`). It would NOT catch an exotic
    // top-level expression statement (`sideEffect();`) — which no type file writes; this guard reads
    // text rather than transpiling, so the transpile check is left to whatever next builds the
    // dashboard bundle, which on a pull request that leaves `deploy/` alone is nothing (corrected
    // 2026-09-19; this line used to name `bundle-smoke`, which builds no vite bundle).
    // Prove-by-deletion:
    // add `import "@waitron/db";` or `export const x = 1;` to either leaf and it goes red.
    const LEAVES = [
      "packages/catalogue/src/product-types.ts",
      "packages/catalogue/src/menu-types.ts",
    ];

    /** Every top-level statement in `src` that would emit runtime JS: an `import` that is not
     * `import type`, an `export` that is not `export type`/`export interface`, or a bare value
     * declaration. Comments are stripped first so prose mentioning `import`/`export` is not misread as
     * code. A file with none of these transpiles to empty — it contributes nothing to a bundle. */
    function runtimeStatements(src: string): string[] {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      const out: string[] = [];
      // Anchored at column 0 (no leading whitespace): a module's import/export/value statements sit at
      // the top level, while an interface's members are always indented — so a wire field NAMED
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

    it.each(LEAVES)("%s imports at least one type (not vacuous)", (leaf) => {
      expect(/import\s+type\s/.test(readFileSync(join(REPO, leaf), "utf8"))).toBe(true);
    });

    it.each(LEAVES)("%s is type-only: no runtime import, export, or declaration", (leaf) => {
      expect(runtimeStatements(readFileSync(join(REPO, leaf), "utf8"))).toEqual([]);
    });

    it("flags planted runtime constructs, ignores type-only ones (control)", () => {
      // A relative side-effect import, a NON-relative server-package import, a value import, a value
      // export and a bare declaration are each caught — the leaks the bundle guarantee is about.
      expect(runtimeStatements('import "./operations.js";')).toEqual(['import "./operations.js";']);
      expect(runtimeStatements('import "@waitron/db";')).toEqual(['import "@waitron/db";']);
      expect(runtimeStatements('import { readProductEditor } from "./operations.js";')).toEqual([
        'import { readProductEditor } from "./operations.js";',
      ]);
      expect(runtimeStatements("export const reviewRuntime = 1;")).toEqual([
        "export const reviewRuntime = 1;",
      ]);
      expect(runtimeStatements("const x = 1;")).toEqual(["const x = 1;"]);
      // Type-only statements are correctly NOT runtime — they never reach the bundle.
      expect(runtimeStatements('import type { Product } from "./operations.js";')).toEqual([]);
      expect(runtimeStatements('export type { Product } from "./operations.js";')).toEqual([]);
      expect(runtimeStatements("export interface Foo { a: string }")).toEqual([]);
      // An INDENTED interface member whose name happens to be a keyword is not a top-level statement,
      // so the column-0 anchoring must leave it alone (it would otherwise false-positive a legitimate
      // type-only field named `class`, `import`, `export`, …).
      expect(
        runtimeStatements("export interface Foo {\n  class: string;\n  import: number;\n}"),
      ).toEqual([]);
    });
  });

  describe("reachability follows a relative import out of src/dashboard (regression)", () => {
    // The bypass a run-it reviewer FALSIFIED: a `src/dashboard` file importing a sibling OUTSIDE
    // `src/dashboard` that imports a forbidden specifier passed a DIRECT-only scan. The fixture below
    // reproduces exactly that shape; the transitive walk must reach the sibling and flag it. Prove-by-
    // deletion: reverting `reachableFrom` to return only its entry files (the non-transitive gap) makes
    // the "reaches and flags" assertion go red while the direct-only scan below still passes it green —
    // which is the whole point.
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
