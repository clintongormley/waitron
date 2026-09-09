import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_MODULES } from "../packages/composition/src/index.js";
import { COUNTRY_PACKS } from "../packages/country-packs/src/index.js";
import { FISCAL_TERRITORIES, resolveFiscalModules } from "../packages/provisioning/src/index.js";

/**
 * The module seams (SP-3c): the swappable fiscal regime is reached only through the descriptor's
 * seats. Generic provisioning code imports neither regime package nor the composition list (its
 * `bin.ts` is the CLI's composition root and may); no file under `apps/server/src` imports a regime
 * package outside the deferred runtime pass below. There is no `modules.ts` exception — the
 * composition list lives in `packages/composition`, which this guard does not scan because naming
 * every module is that package's job. Provisioning's imports of `@waitron/identity` and
 * `@waitron/layouts` are legitimate — those modules are not swappable slots — so the boundary is
 * the REGIME, not "any module".
 *
 * Reads text, like `module-graph-honesty` — a `from "@waitron/…"` inside a comment counts; stated
 * rather than papered over. The match is on the PREFIX `from "<pkg>` with no closing quote, so a
 * subpath import (`from "@waitron/fiscal-verifactu/src/registro-sif.js"`) counts too; no regime
 * package's name is a prefix of another's, so the prefix cannot cross-match. What is still NOT
 * seen: a side-effect `import "<pkg>"` (no `from`), a dynamic `import("<pkg>")`, and any file
 * reaching the regime indirectly through another module of the app.
 *
 * OUT OF SCOPE, by `sourceFiles`: `*.test.ts` and every `testing/` directory. The seam this guard
 * protects is what the SHIPPED code depends on; a suite may name the regime to assert against it
 * (`packages/provisioning/src/venue-apply.e2e.test.ts` does), and a `testing/` file is a fixture for
 * such a suite, not composition. No `testing/` file imports a regime package today — the exclusion
 * is the rule, not a carve-out for an existing violation. `apps/server/src/testing/
 * fiscal-fixtures.ts` is the fixture nearest the line: it seeds `registros_facturacion` rows with
 * raw SQL and imports no regime package at all.
 *
 * The allowlist is now EMPTY. The `fiscal-none` slice moved the runtime drain behind the fiscal
 * contribution's `drain` seat, relocated the AEAT transport into the regime, and finally moved the
 * cert validate/seal into the regime behind the `provisioningSecret` seat — so no file under
 * `apps/server/src` reaches a regime package. It is kept as a Map (not deleted) so a future deferral
 * has to name itself and its reason here; shrink this list, never grow it.
 */
const DEFERRED_RUNTIME_PASS = new Map<string, string>([]);

const REPO_ROOT = join(import.meta.dirname, "..");
const REGIME_PACKAGES = ["@waitron/fiscal-verifactu", "@waitron/verifactu"];

function workspaceSourceFiles(parent: "apps" | "packages"): string[] {
  return readdirSync(join(REPO_ROOT, parent), { withFileTypes: true }).flatMap((entry) => {
    const src = join(REPO_ROOT, parent, entry.name, "src");
    return entry.isDirectory() && existsSync(src) ? sourceFiles(src) : [];
  });
}

function countryImplementationPackages(): string[] {
  return readdirSync(join(REPO_ROOT, "packages"), { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && entry.name.startsWith("country-") && entry.name !== "country-packs",
    )
    .map((entry) => {
      const manifest = JSON.parse(
        readFileSync(join(REPO_ROOT, "packages", entry.name, "package.json"), "utf8"),
      ) as { name: string };
      return manifest.name;
    })
    .sort();
}

const COUNTRY_IMPLEMENTATIONS = countryImplementationPackages();

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "testing" || entry.name === "node_modules") continue;
      out.push(...sourceFiles(p));
    } else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

function imports(file: string, packages: Iterable<string>): string[] {
  const text = readFileSync(file, "utf8");
  return [...packages].filter((pkg) => text.includes(`from "${pkg}`));
}

describe("packages/provisioning imports no regime package, and the composition list only from bin.ts", () => {
  const files = sourceFiles(join(REPO_ROOT, "packages/provisioning/src"));
  it("scans the runner (not vacuous)", () => {
    expect(files.some((f) => f.endsWith("venue-apply.ts"))).toBe(true);
  });
  it.each(files.map((f) => [relative(REPO_ROOT, f), f]))("%s", (rel, file) => {
    if (rel === "packages/provisioning/src/bin.ts") return;
    expect(imports(file, [...REGIME_PACKAGES, "@waitron/composition"])).toEqual([]);
  });
  it("declares no regime package under dependencies", () => {
    const manifest = JSON.parse(
      readFileSync(join(REPO_ROOT, "packages/provisioning/package.json"), "utf8"),
    ) as { dependencies: Record<string, string> };
    expect(Object.keys(manifest.dependencies).filter((d) => REGIME_PACKAGES.includes(d))).toEqual(
      [],
    );
  });
});

describe("apps/server imports the Spanish regime only from the deferred runtime pass", () => {
  const files = sourceFiles(join(REPO_ROOT, "apps/server/src"));
  it("scans the host (not vacuous)", () => {
    expect(files.some((f) => f.endsWith("till-backend.ts"))).toBe(true);
  });
  it.each(files.map((f) => [relative(REPO_ROOT, f), f]))("%s", (rel, file) => {
    if (DEFERRED_RUNTIME_PASS.has(rel)) return;
    expect(imports(file, REGIME_PACKAGES)).toEqual([]);
  });
  it("the deferred-runtime-pass allowlist is EMPTY (the fiscal-none slice's end state)", () => {
    // Task 5 relocated the last regime-reaching file (aeat-credential.ts) into
    // packages/fiscal-verifactu, so nothing under apps/server/src imports a regime package. Asserted
    // as an empty list rather than deleted so a future entry has to justify itself; and, should the
    // list ever regrow, each entry must still GENUINELY import the regime (no stale entries).
    expect([...DEFERRED_RUNTIME_PASS.keys()]).toEqual([]);
    for (const rel of DEFERRED_RUNTIME_PASS.keys()) {
      expect(imports(join(REPO_ROOT, rel), REGIME_PACKAGES).length, rel).toBeGreaterThan(0);
    }
  });
});

/**
 * The dashboard module-UI seam (bookings SP2): the admin app reaches a UI module only TRANSITIVELY,
 * through `@waitron/dashboard-modules` (the browser-safe registry). So no file under `apps/dashboard/src`
 * imports the composition list, the module contract, or a UI module package directly. `@waitron/bookings`
 * is forbidden as a bare PREFIX (the `imports()` helper matches `from "<pkg>`), which also catches the
 * browser sub-path `@waitron/bookings/dashboard` — the app must import NEITHER; the registry, a different
 * specifier (`@waitron/dashboard-modules`), is the only path in. The app imports none of these today.
 */
const APP_FORBIDDEN = ["@waitron/composition", "@waitron/module", "@waitron/bookings"];

describe("apps/dashboard reaches UI modules only via the registry, never a module or the composition list", () => {
  const files = sourceFiles(join(REPO_ROOT, "apps/dashboard/src"));
  it("scans the app (not vacuous)", () => {
    expect(files.some((f) => f.endsWith("dashboard-app.ts"))).toBe(true);
  });
  it.each(files.map((f) => [relative(REPO_ROOT, f), f]))("%s", (rel, file) => {
    expect(imports(file, APP_FORBIDDEN)).toEqual([]);
  });
  it("finds a planted module/subpath import (positive control), and does NOT flag the registry", () => {
    const dir = mkdtempSync(join(tmpdir(), "module-seams-"));
    try {
      const bad = join(dir, "bad.ts");
      writeFileSync(bad, 'import { BOOKINGS_DASHBOARD } from "@waitron/bookings/dashboard";\n');
      expect(imports(bad, APP_FORBIDDEN)).toEqual(["@waitron/bookings"]);
      const good = join(dir, "good.ts");
      writeFileSync(good, 'import { DASHBOARD_MODULES } from "@waitron/dashboard-modules";\n');
      expect(imports(good, APP_FORBIDDEN)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the detector itself", () => {
  it("finds a regime import in a synthetic source (positive control)", () => {
    const dir = mkdtempSync(join(tmpdir(), "module-seams-"));
    const probe = join(dir, "probe.ts");
    writeFileSync(probe, 'import { x } from "@waitron/fiscal-verifactu";\n');
    try {
      expect(imports(probe, REGIME_PACKAGES)).toEqual(["@waitron/fiscal-verifactu"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("finds a DEEP regime import, which the exact-string form missed", () => {
    const dir = mkdtempSync(join(tmpdir(), "module-seams-"));
    const probe = join(dir, "probe.ts");
    writeFileSync(probe, 'import { x } from "@waitron/fiscal-verifactu/src/registro-sif.js";\n');
    try {
      expect(imports(probe, REGIME_PACKAGES)).toEqual(["@waitron/fiscal-verifactu"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the territory registry and the fiscal slot agree", () => {
  it("every filing value names an enabled fiscal contribution", () => {
    expect(FISCAL_TERRITORIES.length).toBeGreaterThan(0);
    const ids = new Set(ALL_MODULES.flatMap((m) => (m.fiscal === undefined ? [] : [m.fiscal.id])));
    for (const t of FISCAL_TERRITORIES)
      expect(ids.has(resolveFiscalModules(t).filing), t).toBe(true);
  });

  it("every country pack's default module id names an enabled module", () => {
    const names = new Set(ALL_MODULES.map(({ name }) => name));
    for (const pack of COUNTRY_PACKS) {
      for (const moduleId of pack.moduleIds)
        expect(names.has(moduleId), pack.countryCode).toBe(true);
    }
  });
});

describe("country implementations are named only by the browser-safe country registry", () => {
  const files = [...workspaceSourceFiles("apps"), ...workspaceSourceFiles("packages")];
  const registry = "packages/country-packs/src/registry.ts";

  it("scans production sources and finds the registry's implementation imports", () => {
    expect(files.length).toBeGreaterThan(0);
    expect(imports(join(REPO_ROOT, registry), COUNTRY_IMPLEMENTATIONS)).toEqual(
      COUNTRY_IMPLEMENTATIONS,
    );
  });

  it.each(files.map((file) => [relative(REPO_ROOT, file), file]))("%s", (rel, file) => {
    if (rel === registry) return;
    expect(imports(file, COUNTRY_IMPLEMENTATIONS)).toEqual([]);
  });

  it("finds a planted cross-import from one country implementation to another", () => {
    const dir = mkdtempSync(join(tmpdir(), "country-seams-"));
    try {
      const bad = join(dir, "bad.ts");
      writeFileSync(bad, 'import { SPAIN } from "@waitron/country-es";\n');
      expect(imports(bad, COUNTRY_IMPLEMENTATIONS)).toEqual(["@waitron/country-es"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
