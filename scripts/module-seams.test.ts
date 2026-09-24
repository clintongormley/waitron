import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_MODULES } from "../packages/composition/src/index.js";
import { COUNTRY_PACKS } from "../packages/country-packs/src/index.js";
import { FISCAL_TERRITORIES, resolveFiscalModules } from "../packages/provisioning/src/index.js";

/**
 * The swappable fiscal regime is reached only through the descriptor's seats. Generic provisioning
 * code imports neither regime package nor the composition list (its `bin.ts` is the CLI's
 * composition root and may), and no file under `apps/server/src` imports a regime package outside
 * this allowlist. The boundary is the REGIME, not "any module": provisioning's imports of
 * `@waitron/identity` and `@waitron/layouts` are legitimate.
 *
 * Reads text, so a `from "@waitron/…"` inside a comment counts. The match is on the PREFIX
 * `from "<pkg>`, so a subpath import counts too; no regime package's name is a prefix of another's.
 * NOT seen: a side-effect `import "<pkg>"` (no `from`), a dynamic `import("<pkg>")`, a file
 * reaching the regime indirectly through another module, and any directory other than
 * `packages/provisioning/src` and `apps/server/src`, which are the only two checked for regime
 * imports. `*.test.ts` and every `testing/` directory are out of scope.
 *
 * EMPTY; shrink this list, never grow it.
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
    // Asserted empty rather than deleted so a future entry has to justify itself, and a regrown
    // entry must still genuinely import the regime.
    expect([...DEFERRED_RUNTIME_PASS.keys()]).toEqual([]);
    for (const rel of DEFERRED_RUNTIME_PASS.keys()) {
      expect(imports(join(REPO_ROOT, rel), REGIME_PACKAGES).length, rel).toBeGreaterThan(0);
    }
  });
});

/**
 * `apps/dashboard` reaches a UI module or a card-provider panel only through
 * `@waitron/dashboard-modules`. The prefix match also catches a subpath such as
 * `@waitron/bookings/dashboard`.
 */
const APP_FORBIDDEN = [
  "@waitron/composition",
  "@waitron/module",
  "@waitron/bookings",
  "@waitron/payments-sumup",
  "@waitron/payments-stripe",
];

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
      const badProvider = join(dir, "bad-provider.ts");
      writeFileSync(
        badProvider,
        'import { SUMUP_PANEL } from "@waitron/payments-sumup/dashboard";\n',
      );
      expect(imports(badProvider, APP_FORBIDDEN)).toEqual(["@waitron/payments-sumup"]);
      const good = join(dir, "good.ts");
      writeFileSync(good, 'import { DASHBOARD_MODULES } from "@waitron/dashboard-modules";\n');
      expect(imports(good, APP_FORBIDDEN)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * `packages/composition/src/card-providers.ts` is the card-provider registry. Unlike the regime
 * allowlist above, this one is ADVISORY: it refuses a NEW, non-allowlisted import but does not
 * assert that every allowlisted file still needs to be there.
 */
const PROVIDER_PACKAGES = ["@waitron/payments-sumup", "@waitron/payments-stripe"];

const PROVIDER_DEFERRED = new Map<string, string>([
  [
    "apps/server/src/boot.ts",
    "StripeReconciler (hosted-payment settlement) + webhook wiring; the reader-collect path now goes through the pool/seat",
  ],
  [
    "apps/server/src/stripe-account.ts",
    "Stripe account-connect route reads the client/report helpers directly; migrates behind the seat later",
  ],
  [
    "apps/server/src/sumup-account.ts",
    "SumUp account-connect route reads the client helpers directly; migrates behind the seat later",
  ],
  [
    "apps/server/src/webhook.ts",
    "Stripe hosted-payment webhook wiring; migrates behind the seat later",
  ],
]);

describe("apps/server reaches a card-provider package only via the registry or the deferred allowlist", () => {
  const files = sourceFiles(join(REPO_ROOT, "apps/server/src"));
  it("scans the host (not vacuous)", () => {
    expect(files.some((f) => f.endsWith("boot.ts"))).toBe(true);
  });
  it.each(files.map((f) => [relative(REPO_ROOT, f), f]))("%s", (rel, file) => {
    if (PROVIDER_DEFERRED.has(rel)) return;
    expect(imports(file, PROVIDER_PACKAGES)).toEqual([]);
  });
  it("packages/composition/src/card-providers.ts is the registry and may import both providers", () => {
    const file = join(REPO_ROOT, "packages/composition/src/card-providers.ts");
    expect(imports(file, PROVIDER_PACKAGES).sort()).toEqual([...PROVIDER_PACKAGES].sort());
  });
  it("finds a planted provider-package import (positive control)", () => {
    const dir = mkdtempSync(join(tmpdir(), "module-seams-"));
    try {
      const bad = join(dir, "bad.ts");
      writeFileSync(bad, 'import { SUMUP_CARD_PROVIDER } from "@waitron/payments-sumup";\n');
      expect(imports(bad, PROVIDER_PACKAGES)).toEqual(["@waitron/payments-sumup"]);
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
