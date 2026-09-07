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
 * a text scan — and stays the Vite-build backstop's job (`bundle-smoke`).
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
