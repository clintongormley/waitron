import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_MODULES } from "../packages/composition/src/index.js";
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
 * rather than papered over. Only the DIRECT import is seen: a file reaching the regime through
 * another module of the app is not detected here.
 *
 * DEFERRED, allowlisted with the reason: the runtime fiscal pass still imports the Spanish regime
 * directly until the `fiscal-none` slice designs the runtime-duty seat (SP-3c spec §12). Shrink this
 * list there; do not grow it. `apps/server/src/aeat-credential.ts` is deferred by that spec too but
 * is not listed: it seals the AEAT certificate and names no regime package itself, reaching the
 * transport only through `./aeat-transport.js`, so the assertion below already holds for it.
 */
const DEFERRED_RUNTIME_PASS = new Map<string, string>([
  ["apps/server/src/boot.ts", "drain: the fiscal pass builds a per-pass AEAT transport"],
  ["apps/server/src/aeat-transport.ts", "AEAT SOAP endpoints and mTLS"],
]);

const REPO_ROOT = join(import.meta.dirname, "..");
const REGIME_PACKAGES = ["@waitron/fiscal-verifactu", "@waitron/verifactu"];

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
  return [...packages].filter((pkg) => text.includes(`from "${pkg}"`));
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
  it("the allowlist names only files that still import the regime (no stale entries)", () => {
    for (const rel of DEFERRED_RUNTIME_PASS.keys()) {
      expect(imports(join(REPO_ROOT, rel), REGIME_PACKAGES).length, rel).toBeGreaterThan(0);
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
});

describe("the territory registry and the fiscal slot agree", () => {
  it("every filing value names an enabled fiscal contribution", () => {
    expect(FISCAL_TERRITORIES.length).toBeGreaterThan(0);
    const ids = new Set(ALL_MODULES.flatMap((m) => (m.fiscal === undefined ? [] : [m.fiscal.id])));
    for (const t of FISCAL_TERRITORIES)
      expect(ids.has(resolveFiscalModules(t).filing), t).toBe(true);
  });
});
