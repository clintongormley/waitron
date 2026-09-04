# SP-1d Module-Set Adopt Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A newly-adopted mirror inherits the primary's enabled-module set — the primary's `modules.json` overrides ride the existing mirror-bundle handshake and are written to the mirror's own `modules.json` before it first enters trading mode.

**Architecture:** Add a pure `serializeModuleConfig` (the inverse of `parseModuleConfig`) to `@waitron/module`; a `writeModuleConfig` file-writer to `apps/server` (symmetric with the existing `readModuleConfig`); a `moduleOverrides: Record<string, boolean>` field to `MirrorBundle` that `assembleMirrorBundle` fills by reading the primary's on-box `modules.json` at mint time; and a parse-then-persist step in `adoptFromPrimary` (fail-closed re-validation against the mirror's own `ALL_MODULES`), with the file write injected as a `persistModuleConfig` dep bound at the boot adopt call site.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), pnpm workspace, Vitest (+ real Postgres via Testcontainers for the RLS/e2e suites), Drizzle, Hono. `@waitron/module` (pure), `apps/server` (composition root).

**Spec:** [docs/superpowers/specs/2026-09-04-module-sp1d-adopt-bootstrap-design.md](../specs/2026-09-04-module-sp1d-adopt-bootstrap-design.md)

## Global Constraints

- **Every commit is signed off:** `git commit -s` (CI's `dco` job walks the whole PR range).
- **`@waitron/module` stays a scanned English package:** no module-name literal (`fiscal`, …), no Spanish token. `serializeModuleConfig` is generic. Run `pnpm vitest run scripts/english-only.test.ts` green.
- **No new error code.** Re-validation on the mirror reuses `parseModuleConfig`'s existing `module.config_*` codes; `writeModuleConfig` throws only fs errors. No `packages/*/src/errors.ts` change, so `scripts/errors-reachable.test.ts` needs nothing new (run it green regardless).
- **No schema change, no new grant, no `deployment` column** (SP-1b decision 3 preserved — the module set stays an on-box file; the bundle carries a snapshot, not a replicated table).
- **Coverage thresholds:** `@waitron/module` and `@waitron/server` are `98/98/98/95` (statements/lines/functions/branches). CI shards run `test:coverage`, not `test` — verify each touched package with `pnpm --filter <pkg> test:coverage`.
- **Prove every guard by deletion:** remove the check, watch the test fail, restore it.
- **Real-PG suites need** `TESTCONTAINERS_RYUK_DISABLED=true` locally, and `pnpm reap` after any interrupted run (the pre-push hook reaps for you).
- **ESM imports use `.js` specifiers** even for `.ts` sources (e.g. `./module-config.js`).

---

### Task 1: `serializeModuleConfig` — the pure inverse of `parseModuleConfig`

**Files:**
- Modify: `packages/module/src/config.ts` (add the function)
- Modify: `packages/module/src/index.ts:5` (export it from the barrel)
- Test: `packages/module/src/config.test.ts` (extend)

**Interfaces:**
- Consumes: `ModuleConfig` (`{ overrides: ReadonlyMap<string, boolean> }`), `parseModuleConfig(raw, modules)`, `isEnabled(config, name)` — all existing in `packages/module/src/config.ts`.
- Produces: `serializeModuleConfig(config: ModuleConfig): Record<string, boolean>` — Tasks 3 and 2 consume it.

- [ ] **Step 1: Write the failing test**

Add to `packages/module/src/config.test.ts` (reuse the file's existing `WaitronModule` fixtures — it already imports `parseModuleConfig`; add `serializeModuleConfig` to that import). If the file has no local module fixtures, build a minimal list inline as shown:

```ts
import { parseModuleConfig, serializeModuleConfig, isEnabled } from "./config.js";
import type { WaitronModule } from "./module.js";

// Minimal fixtures: one mandatory (core), two toggleable. Only `name` + `tier` are read here.
const MODS = [
  { name: "core", tier: "mandatory" },
  { name: "alpha", tier: "toggleable" },
  { name: "beta", tier: "toggleable" },
] as unknown as WaitronModule[];

describe("serializeModuleConfig", () => {
  it("round-trips parseModuleConfig: same enabled set for every module", () => {
    // A config where the two directions visibly DIFFER: alpha disabled, beta left default.
    const parsed = parseModuleConfig({ modules: { alpha: false } }, MODS);
    const serialized = serializeModuleConfig(parsed);
    expect(serialized).toEqual({ alpha: false });

    const reparsed = parseModuleConfig({ modules: serialized }, MODS);
    for (const m of MODS) {
      expect(isEnabled(reparsed, m.name)).toBe(isEnabled(parsed, m.name));
    }
    expect(isEnabled(reparsed, "alpha")).toBe(false);
    expect(isEnabled(reparsed, "beta")).toBe(true);
  });

  it("serializes an empty config to {}", () => {
    expect(serializeModuleConfig(parseModuleConfig({}, MODS))).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/module test config.test.ts`
Expected: FAIL — `serializeModuleConfig` is not exported / not a function.

- [ ] **Step 3: Write minimal implementation**

Add to `packages/module/src/config.ts` (after `enabledModules`):

```ts
/**
 * Serialize a ModuleConfig back to the sparse override object (the modules.json inner map). The
 * inverse of parseModuleConfig: parseModuleConfig({ modules: serializeModuleConfig(c) }, M) yields
 * the same enabled set as c for every module in M. Generic — no module name, no vocabulary.
 */
export function serializeModuleConfig(config: ModuleConfig): Record<string, boolean> {
  return Object.fromEntries(config.overrides);
}
```

Add it to the barrel (`packages/module/src/index.ts`), extending the existing `config.js` export line:

```ts
export { disabledProvisionOnly, enabledModules, isEnabled, parseModuleConfig, serializeModuleConfig } from "./config.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @waitron/module test config.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the round-trip test is real**

Temporarily change the implementation to `return {};` and rerun — the first test must FAIL (`serialized` no longer equals `{ alpha: false }`). Restore.

- [ ] **Step 6: Full package + guards, then commit**

Run: `pnpm --filter @waitron/module test:coverage` (PASS, thresholds hold) and `pnpm vitest run scripts/english-only.test.ts` (PASS — no new Spanish).

```bash
git add packages/module/src/config.ts packages/module/src/index.ts packages/module/src/config.test.ts
git commit -s -m "feat(module): serializeModuleConfig, the pure inverse of parseModuleConfig"
```

---

### Task 2: `writeModuleConfig` — the on-box modules.json writer

**Files:**
- Modify: `apps/server/src/module-config.ts` (add the writer + imports)
- Test: `apps/server/src/module-config.test.ts` (create if absent; otherwise extend)

**Interfaces:**
- Consumes: `serializeModuleConfig` (Task 1); `writeFileAtomic(path, data, mode)` from `./fs-atomic.js`; `readModuleConfig(stateDir)` + `isEnabled` for the round-trip assertion.
- Produces: `writeModuleConfig(stateDir: string, config: ModuleConfig): Promise<string>` (returns the written path) — Task 4's boot binding consumes it.

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/module-config.test.ts` (or extend it). It uses a real temp dir via `node:fs` — no DB:

```ts
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { parseModuleConfig, isEnabled } from "@waitron/module";
import { readModuleConfig, writeModuleConfig } from "./module-config.js";
import { ALL_MODULES } from "./modules.js";

// A real toggleable module name from ALL_MODULES to disable in the fixture (not a production
// recommendation — a test fixture). Pick the first toggleable descriptor.
const TOGGLEABLE = ALL_MODULES.find((m) => m.tier === "toggleable")!.name;

describe("writeModuleConfig ↔ readModuleConfig", () => {
  it("writes a config that reads back to the same enabled set", async () => {
    const dir = await mkdtemp(join(tmpdir(), "waitron-modcfg-"));
    const config = parseModuleConfig({ modules: { [TOGGLEABLE]: false } }, ALL_MODULES);

    const path = await writeModuleConfig(dir, config);
    expect(path).toBe(join(dir, "modules.json"));

    const roundTripped = await readModuleConfig(dir);
    expect(isEnabled(roundTripped, TOGGLEABLE)).toBe(false);
    // Every other module stays enabled.
    for (const m of ALL_MODULES) {
      if (m.name !== TOGGLEABLE) expect(isEnabled(roundTripped, m.name)).toBe(true);
    }
  });

  it("writes an empty config that reads back as all-enabled, at mode 0600", async () => {
    const dir = await mkdtemp(join(tmpdir(), "waitron-modcfg-"));
    await writeModuleConfig(dir, parseModuleConfig({}, ALL_MODULES));

    const raw = JSON.parse(await readFile(join(dir, "modules.json"), "utf8"));
    expect(raw).toEqual({ modules: {} });

    const roundTripped = await readModuleConfig(dir);
    for (const m of ALL_MODULES) expect(isEnabled(roundTripped, m.name)).toBe(true);

    const mode = (await stat(join(dir, "modules.json"))).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/server test module-config.test.ts`
Expected: FAIL — `writeModuleConfig` is not exported.

- [ ] **Step 3: Write minimal implementation**

Edit `apps/server/src/module-config.ts`. Extend the existing imports and add the writer:

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "@waitron/shared";
import { parseModuleConfig, serializeModuleConfig, type ModuleConfig } from "@waitron/module";
import { ALL_MODULES } from "./modules.js";
import { writeFileAtomic } from "./fs-atomic.js";
```

Append after `readModuleConfig`:

```ts
/**
 * Write `<stateDir>/modules.json` from a validated ModuleConfig (SP-1d adopt bootstrap). The inverse
 * write of `readModuleConfig`: it serializes the override map back into the `{ modules: … }` file
 * envelope. Atomic, mode 0600 to match the state-dir siblings (`trading.env`/`secrets.env`). Returns
 * the written path.
 */
export async function writeModuleConfig(stateDir: string, config: ModuleConfig): Promise<string> {
  const body = JSON.stringify({ modules: serializeModuleConfig(config) }, null, 2) + "\n";
  const path = join(stateDir, "modules.json");
  await writeFileAtomic(path, body, 0o600);
  return path;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @waitron/server test module-config.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Prove the mode assertion is real**

Temporarily change `0o600` to `0o644` in `writeModuleConfig` and rerun — the mode assertion must FAIL. Restore.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/module-config.ts apps/server/src/module-config.test.ts
git commit -s -m "feat(server): writeModuleConfig, the atomic modules.json writer"
```

(Full-package coverage runs at the end of Task 4, after all `apps/server` changes land.)

---

### Task 3: Carry the primary's overrides on the mirror bundle

**Files:**
- Modify: `apps/server/src/mirror-bundle.ts` (add the `MirrorBundle.moduleOverrides` field; mint it in `assembleMirrorBundle`)
- Modify: every test file constructing a `MirrorBundle` literal (add `moduleOverrides` so the package compiles — grep below)
- Test: `apps/server/src/mirror-bundle.rls.test.ts` (extend — assert the mint reads the on-box file)

**Interfaces:**
- Consumes: `readModuleConfig` (Task 2 module, existing function) + `serializeModuleConfig` (Task 1); `AssembleDeps.stateDir` (existing field — `assembleMirrorBundle` already reads `caCertPath(deps.stateDir)`).
- Produces: `MirrorBundle.moduleOverrides: Record<string, boolean>` — Task 4's `adoptFromPrimary` consumes it.

- [ ] **Step 1: Add the field to the interface (makes the package fail to compile until literals are fixed)**

In `apps/server/src/mirror-bundle.ts`, add to the `MirrorBundle` interface (after `reservedIdentity`):

```ts
  /**
   * The primary's enabled-module set as a sparse override map (SP-1b's modules.json inner map), read
   * fresh at mint time. `{}` when nothing is disabled (default-on). The mirror re-validates it against
   * its own ALL_MODULES and writes its own modules.json from it (SP-1d adopt bootstrap).
   */
  moduleOverrides: Record<string, boolean>;
```

- [ ] **Step 2: Mint the field in `assembleMirrorBundle`**

Add the import at the top of `mirror-bundle.ts` (alongside the other `./` imports):

```ts
import { readModuleConfig } from "./module-config.js";
import { serializeModuleConfig } from "@waitron/module";
```

Before the `return { … }` at the end of `assembleMirrorBundle`, read and serialize the primary's on-box config:

```ts
  // SP-1d: snapshot the primary's enabled-module set (its on-box modules.json) so the mirror inherits
  // it at adopt. Read FRESH here, not from boot — the operator may have edited the file since the
  // primary booted; the mint reflects the current desired set. A malformed primary file surfaces its
  // module.config_* code here (fail loud), which is correct — do not ship an unparseable set.
  const moduleOverrides = serializeModuleConfig(await readModuleConfig(deps.stateDir));
```

Add `moduleOverrides,` to the returned object literal.

- [ ] **Step 3: Fix every existing `MirrorBundle` literal so the package compiles**

Find them:

```bash
grep -rn "MirrorBundle = {\|: MirrorBundle\b" apps/server/src
```

For each literal (expected in `apps/server/src/adopt.rls.test.ts` — several — and any other suite), add `moduleOverrides: {},` alongside the other fields. Example, in `adopt.rls.test.ts`:

```ts
    const bundle: MirrorBundle = {
      rows,
      designated,
      environment: "preproduction",
      boxHostname: "waitron.local",
      boxCaPem: "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n",
      relayUrl: "https://relay.test:9000/",
      syncToken: "peer-token-adopt-001",
      reservedIdentity: nextReservedIdentity(),
      moduleOverrides: {},
    };
```

- [ ] **Step 4: Write the failing mint test**

In `apps/server/src/mirror-bundle.rls.test.ts`, add a test that seeds a `modules.json` in the primary's `stateDir` (the same dir the suite already passes as `AssembleDeps.stateDir` — reuse it) disabling a toggleable module, then asserts the bundle carries it. Use `writeModuleConfig` to write the fixture (its round-trip is proven in Task 2):

```ts
import { writeModuleConfig } from "./module-config.js";
import { parseModuleConfig } from "@waitron/module";
import { ALL_MODULES } from "./modules.js";

// inside the existing describe that already builds AssembleDeps with a real stateDir:
it("carries the primary's on-box module overrides", async () => {
  const toggleable = ALL_MODULES.find((m) => m.tier === "toggleable")!.name;
  await writeModuleConfig(stateDir, parseModuleConfig({ modules: { [toggleable]: false } }, ALL_MODULES));

  const bundle = await assembleMirrorBundle(assembleDeps); // assembleDeps.stateDir === stateDir
  expect(bundle.moduleOverrides).toEqual({ [toggleable]: false });
});

it("carries {} when the primary has no modules.json", async () => {
  // (a fresh stateDir with no modules.json — see the suite's per-test dir setup)
  const bundle = await assembleMirrorBundle(assembleDeps);
  expect(bundle.moduleOverrides).toEqual({});
});
```

Adapt the fixture names (`stateDir`, `assembleDeps`) to the suite's existing setup. If the suite reuses one `stateDir` across tests, write the fixture in the disable test and ensure the `{}` test uses a dir with no file (a fresh `mkdtemp`, passing a modified deps `{ ...assembleDeps, stateDir: freshDir }`).

- [ ] **Step 5: Run — the mint test passes, and the package compiles**

Run: `pnpm --filter @waitron/server typecheck` (PASS — all literals fixed) then `pnpm --filter @waitron/server test mirror-bundle.rls.test.ts` (PASS).
Expected before Step 2's mint code existed: the disable test FAILS (`moduleOverrides` is `{}` / undefined). Confirm by temporarily reverting Step 2 (see Step 6).

- [ ] **Step 6: Prove the mint is real**

Temporarily replace the Step 2 line with `const moduleOverrides = {};` and rerun the mint test — the disable case must FAIL. Restore.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/mirror-bundle.ts apps/server/src/mirror-bundle.rls.test.ts apps/server/src/adopt.rls.test.ts
git commit -s -m "feat(server): mirror bundle carries the primary's module overrides"
```

---

### Task 4: Adopt bootstrap — persist the mirror's modules.json before trading

**Files:**
- Modify: `apps/server/src/adopt.ts` (add `persistModuleConfig` to `AdoptDeps`; parse-then-persist step; imports)
- Modify: `apps/server/src/boot.ts:717-732` (bind `persistModuleConfig` into the adopt deps)
- Test: `apps/server/src/adopt.rls.test.ts` (add the persist + fail-closed cases; pass the new dep in existing cases)

**Interfaces:**
- Consumes: `MirrorBundle.moduleOverrides` (Task 3); `parseModuleConfig` + `ALL_MODULES`; `writeModuleConfig` (Task 2) at the boot binding.
- Produces: `AdoptDeps.persistModuleConfig: (config: ModuleConfig) => Promise<void>`; the adopt orchestration now writes the mirror's `modules.json`.

- [ ] **Step 1: Write the failing tests**

In `apps/server/src/adopt.rls.test.ts`, extend the deps in the existing happy-path test to capture `persistModuleConfig`, and add two new cases. First, extend the main test's deps object and assert:

```ts
// add near the test's other capture vars:
const persistedModuleConfigs: ModuleConfig[] = [];
// in the adoptFromPrimary deps object, alongside persistTrading:
persistModuleConfig: async (c) => { persistedModuleConfigs.push(c); },
// after the call, assert the mirror inherited the primary's (empty) set:
expect(persistedModuleConfigs).toHaveLength(1);
expect(isEnabled(persistedModuleConfigs[0]!, ALL_MODULES[0]!.name)).toBe(true);
```

(Add `import { parseModuleConfig, isEnabled, type ModuleConfig } from "@waitron/module";` and `import { ALL_MODULES } from "./modules.js";` to the test file if not present.)

Then a dedicated case proving a disabled module flows through:

```ts
it("bootstraps the mirror's module set from the bundle's overrides", async () => {
  const { rows, designated } = await buildBundleParts();
  const toggleable = ALL_MODULES.find((m) => m.tier === "toggleable")!.name;
  const bundle: MirrorBundle = {
    rows, designated, environment: "preproduction",
    boxHostname: "waitron.local", boxCaPem: "x", relayUrl: "https://relay.test/",
    syncToken: "peer-token-modcfg", reservedIdentity: nextReservedIdentity(),
    moduleOverrides: { [toggleable]: false },
  };
  let persisted: ModuleConfig | undefined;
  await adoptFromPrimary(
    {
      ownerDb: mirror.admin, ring: RING,
      fetchBundle: async () => bundle,
      persistTrading: async () => {},
      persistModuleConfig: async (c) => { persisted = c; },
      databaseUrl: "postgres://app@mirror/db",
      migrationsDatabaseUrl: "postgres://owner@mirror/db",
      syncDatabaseUrl: "postgres://sync@mirror/db",
    },
    { primaryUrl: "https://primary.test/", credential: { personId: "99999999-9999-9999-9999-999999999999", password: "p" } },
  );
  expect(persisted).toBeDefined();
  expect(isEnabled(persisted!, toggleable)).toBe(false);
});

it("refuses adopt (fail-closed) when the bundle names an unknown module, before persistTrading", async () => {
  const { rows, designated } = await buildBundleParts();
  const bundle: MirrorBundle = {
    rows, designated, environment: "preproduction",
    boxHostname: "waitron.local", boxCaPem: "x", relayUrl: "https://relay.test/",
    syncToken: "peer-token-bad", reservedIdentity: nextReservedIdentity(),
    moduleOverrides: { "no-such-module": false },
  };
  let tradingPersisted = false;
  await expect(
    adoptFromPrimary(
      {
        ownerDb: mirror.admin, ring: RING,
        fetchBundle: async () => bundle,
        persistTrading: async () => { tradingPersisted = true; },
        persistModuleConfig: async () => {},
        databaseUrl: "postgres://app@mirror/db",
        migrationsDatabaseUrl: "postgres://owner@mirror/db",
        syncDatabaseUrl: "postgres://sync@mirror/db",
      },
      { primaryUrl: "https://primary.test/", credential: { personId: "99999999-9999-9999-9999-999999999999", password: "p" } },
    ),
  ).rejects.toMatchObject({ code: "module.config_unknown" });
  expect(tradingPersisted).toBe(false);
});
```

> Note on ordering: the fail-closed case asserts `persistTrading` never ran. So the parse-and-persist step must sit **before** `persistTrading` in `adoptFromPrimary` (Step 3). If the suite shares one mirror DB, the unknown-module case throws before any DB write on this path too — but do not rely on that for isolation; each existing case already cleans up.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @waitron/server test adopt.rls.test.ts`
Expected: FAIL — `persistModuleConfig` is not a property of `AdoptDeps` (type error) and the new assertions fail.

- [ ] **Step 3: Add the dep + the parse-then-persist step**

In `apps/server/src/adopt.ts`, add imports:

```ts
import { parseModuleConfig, type ModuleConfig } from "@waitron/module";
import { ALL_MODULES } from "./modules.js";
```

Add the dep to `AdoptDeps` (after `persistTrading`):

```ts
  /** Persists `<stateDir>/modules.json` so the mirror's next boot migrates/wires the primary's
   * enabled set (SP-1d). Injected — bound to `writeModuleConfig(config.stateDir, …)` in boot. */
  persistModuleConfig: (config: ModuleConfig) => Promise<void>;
```

In `adoptFromPrimary`, add the step **immediately before** `await deps.persistTrading({ … })`:

```ts
  // SP-1d: bootstrap the mirror's own modules.json from the primary's set (carried on the bundle).
  // Re-validate against THIS node's ALL_MODULES — fail-closed: an unknown/malformed override throws
  // (module.config_*) and refuses adopt before persistTrading, rather than writing an unparseable
  // file. In the monorepo build both nodes share ALL_MODULES so this cannot fire; it is the defense
  // the bundle being external input demands (CLAUDE.md §3, validate rather than trust). Written
  // unconditionally (even {}), so the mirror's set is explicitly the primary's and re-adopt is
  // idempotent.
  await deps.persistModuleConfig(parseModuleConfig({ modules: bundle.moduleOverrides }, ALL_MODULES));
```

- [ ] **Step 4: Bind it in boot**

In `apps/server/src/boot.ts`, add the import (with the other `./` imports):

```ts
import { writeModuleConfig } from "./module-config.js";
```

In the `adopt:` closure (`boot.ts:717-732`), add to the `adoptFromPrimary` deps object, alongside `persistTrading`:

```ts
                  persistModuleConfig: (c) => writeModuleConfig(config.stateDir, c),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @waitron/server test adopt.rls.test.ts`
Expected: PASS (happy path + the two new cases).

- [ ] **Step 6: Prove both guards by deletion**

1. Comment out the `await deps.persistModuleConfig(…)` line → the "bootstraps the mirror's module set" case FAILS (`persisted` undefined). Restore.
2. Replace the parse with a raw pass-through `deps.persistModuleConfig({ overrides: new Map(Object.entries(bundle.moduleOverrides)) } as ModuleConfig)` → the unknown-module case no longer throws → it FAILS. Restore the `parseModuleConfig` call.

- [ ] **Step 7: Whole-package coverage + guards, then commit**

Run (unfiltered — cross-cutting guards only load whole-package):
- `pnpm --filter @waitron/server test:coverage` (PASS, `98/98/98/95` holds)
- `pnpm --filter @waitron/module test:coverage` (PASS — Task 1 covered)
- `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` (PASS — confirm nothing about the chain moved; adopt sits near the fiscal identity path)
- `pnpm vitest run scripts/english-only.test.ts scripts/errors-reachable.test.ts` (PASS)

```bash
git add apps/server/src/adopt.ts apps/server/src/boot.ts apps/server/src/adopt.rls.test.ts
git commit -s -m "feat(server): adopt bootstraps the mirror's modules.json from the primary"
```

---

### Task 5: End-to-end — the mirror's modules.json matches the primary after adopt

**Files:**
- Modify: `apps/server/src/adopt-e2e.rls.test.ts` (extend the existing full-adopt e2e)

**Interfaces:**
- Consumes: the whole SP-1d path (Tasks 1–4); `readModuleConfig` to read the mirror's resulting file.

- [ ] **Step 1: Understand the existing e2e**

Read `apps/server/src/adopt-e2e.rls.test.ts`. It drives a real adopt from a source (primary) into a mirror, asserting `deployment.mode='mirror'`, `mirror_config`, and the sealed token (per its header). Identify (a) the primary's `stateDir` used when assembling/serving the bundle, and (b) the mirror's `stateDir` that `adoptFromPrimary`'s `persistModuleConfig` writes into. If the e2e stubs `persistTrading` with a real `writeTradingEnv(mirrorStateDir, …)`, mirror that for `persistModuleConfig` with `writeModuleConfig(mirrorStateDir, …)`.

- [ ] **Step 2: Write the failing assertion**

Before the adopt call, seed the **primary's** `modules.json` disabling a toggleable module; after adopt, read the **mirror's** `modules.json` and assert the same enabled set:

```ts
import { writeModuleConfig, readModuleConfig } from "./module-config.js";
import { parseModuleConfig, isEnabled } from "@waitron/module";
import { ALL_MODULES } from "./modules.js";

const toggleable = ALL_MODULES.find((m) => m.tier === "toggleable")!.name;
// Seed the primary's desired set BEFORE the bundle is assembled/served:
await writeModuleConfig(primaryStateDir, parseModuleConfig({ modules: { [toggleable]: false } }, ALL_MODULES));

// … run the existing full adopt (which must wire persistModuleConfig → writeModuleConfig(mirrorStateDir, …)) …

// The mirror inherited the primary's set into its OWN modules.json:
const mirrorConfig = await readModuleConfig(mirrorStateDir);
expect(isEnabled(mirrorConfig, toggleable)).toBe(false);
for (const m of ALL_MODULES) {
  if (m.name !== toggleable) expect(isEnabled(mirrorConfig, m.name)).toBe(true);
}
```

If the e2e builds the mirror-side deps inline (not through `boot.ts`), add `persistModuleConfig: (c) => writeModuleConfig(mirrorStateDir, c)` to that deps object.

- [ ] **Step 3: Run to verify it fails, then passes**

Run: `pnpm --filter @waitron/server test adopt-e2e.rls.test.ts`
Expected: FAIL first if the e2e wasn't yet wiring `persistModuleConfig` to a real writer (the mirror file is absent → `readModuleConfig` returns all-enabled → the `toggleable` assertion fails). After wiring the real `writeModuleConfig(mirrorStateDir, …)`: PASS.

- [ ] **Step 4: Prove it's real**

Temporarily seed the primary with an **empty** config (`writeModuleConfig(primaryStateDir, parseModuleConfig({}, ALL_MODULES))`) and confirm the `toggleable`-disabled assertion FAILS (the mirror is all-enabled) — the assertion is keyed to the primary's set, not a constant. Restore the disabling seed.

- [ ] **Step 5: Full suite + commit**

Run: `pnpm --filter @waitron/server test:coverage` (PASS).

```bash
git add apps/server/src/adopt-e2e.rls.test.ts
git commit -s -m "test(server): adopt e2e asserts the mirror inherits the primary's module set"
```

---

### Task 6: Backlog + docs pointer

**Files:**
- Modify: `docs/backlog.md` (mark SP-1d landed-in-flight; note ongoing flow-down deferred)

**Interfaces:** none (docs only).

- [ ] **Step 1: Update the SP-1d backlog row**

In `docs/backlog.md`, update the `SP-1d` row (currently `- **SP-1d — cross-node config replication** (adopt bootstrap + flow-down; …)`) to record: adopt bootstrap **built on `feat/module-sp1d-adopt-bootstrap`** (the mirror inherits the primary's enabled set at adopt via the mirror bundle); **ongoing flow-down deferred** with the two receipts (no config channel exists; nothing is disableable today), to be built alongside the first genuinely-toggleable module (SP-2/SP-4). Point to the spec. Update the closing "SP-1d / SP-2 remain" summary line to "SP-2 remains" (adopt-bootstrap half of SP-1d done; ongoing flow-down folded into SP-2's scope).

> This edit lands on the feature branch (it accompanies code), so it is NOT the lightweight docs-only path — it rides the PR. Keep the wording receipted (what was built, what was deferred and why), per CLAUDE.md §7.

- [ ] **Step 2: Commit**

```bash
git add docs/backlog.md
git commit -s -m "docs(backlog): SP-1d adopt bootstrap built; ongoing flow-down deferred with receipts"
```

---

## Self-Review

**Spec coverage:**
- Spec §1 (honest "no wedge; makes the enabled set match") — captured in the plan's Architecture + Task 3/4 comments and the e2e (Task 5) asserting set-equality, not a constant.
- Spec §3 bundle field + mint (fresh read) + fetch pass-through + adopt parse/persist + written-unconditionally — Tasks 3 (field+mint) and 4 (parse/persist, before persistTrading). Fetch needs no code (type flows) — correctly untasked.
- Spec §4 `serializeModuleConfig` + `writeModuleConfig` + boot binding — Tasks 1, 2, 4 Step 4.
- Spec §5 testing (serialize round-trip; write↔read; assemble carries overrides; adopt parse/persist + fail-closed + prove-by-deletion; adopt e2e; whole-package guards) — Tasks 1–5, each with a prove-by-deletion step; guards run in Task 4 Step 7.
- Spec §6 deferral — Task 6 records it in the backlog (no code).
- Spec §7 invariants (behaviour-preserving default; no schema/grant/error-code; english-only) — Global Constraints + Task 4 Step 7 guard runs.

**Placeholder scan:** no TBD/TODO; every code step carries real code. Fixture names in the RLS/e2e tasks (`stateDir`, `assembleDeps`, `primaryStateDir`, `mirrorStateDir`) are explicitly flagged "adapt to the suite's existing setup" because they depend on the current test scaffolding — the implementer reads the suite (Task 5 Step 1) rather than inventing them.

**Type consistency:** `serializeModuleConfig(config: ModuleConfig): Record<string, boolean>` (Task 1) is consumed by `writeModuleConfig` (Task 2) and the mint (Task 3); `MirrorBundle.moduleOverrides: Record<string, boolean>` (Task 3) is consumed by `adoptFromPrimary`'s `parseModuleConfig({ modules: bundle.moduleOverrides }, ALL_MODULES)` (Task 4); `AdoptDeps.persistModuleConfig: (config: ModuleConfig) => Promise<void>` (Task 4) is bound to `writeModuleConfig(config.stateDir, c)` (Task 4 Step 4) whose signature is `(stateDir, config: ModuleConfig)` (Task 2). Consistent end to end.
