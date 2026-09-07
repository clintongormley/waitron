import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The dashboard module-UI seam (bookings SP2): a module's `./dashboard` sub-path is BROWSER-SAFE. It is
 * bundled into the admin dashboard, so it must never reach server-only code — a runtime import of
 * `@waitron/db`, `hono`, `pg`, `drizzle-orm` or a `node:` builtin would drag Node into the browser
 * bundle (the #70 rule the app's local client shapes exist for). This guard reads text and text-scans
 * every non-test source file under each listed sub-path for a forbidden specifier, and forbids reaching
 * the package's own server barrel/entry (`../index.js`, `../bookings.js`).
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

describe("module dashboard sub-paths import no server-only specifier", () => {
  for (const [pkg, dir] of SUBPATHS) {
    const files = tsFiles(join(REPO, dir));

    it(`${pkg}/dashboard scans files (not vacuous)`, () => {
      expect(files.length).toBeGreaterThan(0);
    });

    it.each(files.map((f) => [relative(REPO, f), f] as const))(
      "%s imports no server-only specifier",
      (_rel, file) => {
        expect(forbiddenImports(readFileSync(file, "utf8"))).toEqual([]);
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
});
