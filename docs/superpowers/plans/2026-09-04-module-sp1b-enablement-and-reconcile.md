# SP-1b — Module enablement + boot reconcile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SP-1a's recorded module `tier` + an on-box `modules.json` config file *act*: compute an enabled set, filter the boot migration list by it, and refuse venue provisioning when a `provision-only` module (fiscal) is disabled — behaviour-preserving by default (all enabled).

**Architecture:** A new pure surface in `@waitron/module` (config parser + set-arithmetic reconcile + a generic provision-only guard helper), consumed only by the composition root (`apps/server`): `boot.ts` reads `modules.json` and filters the migration list in trading mode (setup mode still migrates all), and `provision.ts` refuses fiscal-disabled venue provisioning. Actual state is *derived* from `appliedSchemaVersion` (no `deployment` column). No schema change, no new privilege.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), pnpm workspace, Vitest (+ real-Postgres via Testcontainers for the boot test), Drizzle, `@waitron/shared` `AppError`.

**Spec:** [docs/superpowers/specs/2026-09-04-module-sp1b-enablement-and-reconcile.md](../specs/2026-09-04-module-sp1b-enablement-and-reconcile.md)

> **Deviations landed in the finish-branch simplify pass (2026-09-04) — the task code blocks below
> predate these; the SHIPPED code is what governs.** (1) `parseModuleConfig`'s second argument is
> `modules: readonly WaitronModule[]`, not `known: readonly string[]` — it reads each descriptor's
> `tier` so the mandatory check is generic. (2) The mandatory-disable error code is
> **`module.mandatory_not_disableable`** with params `{ module: string }`, NOT
> `module.core_not_disableable` / `Record<string, never>` as Task 1/2 show — generalized from a
> hardcoded `"core"` to `tier === "mandatory"` so the generic package names no module. (3) `boot.ts`
> reads `modules.json` **once, unconditionally** before the mode branch (both modes reuse the one
> value), rather than the trading-only read Task 5 sketches. Behaviour is unchanged; these are the
> quality cleanups from the reuse/altitude review.

## Global Constraints

- **The gate** (run before pushing): `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`. Per-package coverage is `test:coverage` (CI runs coverage, not plain `test`) — thresholds `98/98/98/95` for `@waitron/module`, `@waitron/server` (apps/server), `@waitron/provisioning`.
- **Every commit `git commit -s`** (DCO job walks the whole PR range).
- **Error codes name the DOMAIN CONCEPT, never the throwing package** — `module.*` here (the module system), lowercase, dot-namespaced. Codes are **never renamed once shipped**. Every file that throws a code imports its registry (`import "./errors.js"` within the package, or imports the package for a cross-package code).
- **`@waitron/module` is a generic (english-only-scanned) package** — no Spanish vocabulary and **no module-name literal** (`fiscal`, `verifactu`, `venta`, …) in its source. The provision-only guard iterates the `tier`, it does not name a module.
- **TDD** — failing test first, watch it fail, minimal implementation, watch it pass, commit. **Prove each guard by deletion.**
- **Real-Postgres suites need `TESTCONTAINERS_RYUK_DISABLED=true`** locally (or they hang to the 180s hookTimeout); run `pnpm reap` if a run is interrupted.
- **Behaviour-preserving is the headline invariant**: with no `modules.json` (or one disabling nothing) the same nine sets migrate in the same order in both modes and `registerSif`/`applyVenue` run exactly as today.
- **`ModuleConfig` is default-on**: a module is enabled unless `modules.<name>` is explicitly `false`.

---

### Task 1: `@waitron/module` error registry

**Files:**
- Create: `packages/module/src/errors.ts`
- Modify: `packages/module/src/index.ts` (add `import "./errors.js"`)
- Modify: `packages/module/package.json` (add `@waitron/shared` dependency)
- Test: covered by the root `scripts/errors-reachable.test.ts` (auto-discovers the package) + a small local `packages/module/src/errors.test.ts`

**Interfaces:**
- Produces: four `ErrorParams` augmentations — `module.config_invalid` `{ reason: string }`, `module.config_unknown` `{ module: string }`, `module.core_not_disableable` `Record<string, never>`, `module.provision_only_disabled` `{ module: string }`. Consumed by Tasks 2 and 6.

- [ ] **Step 1: Add the dependency.** In `packages/module/package.json`, add to `dependencies`:

```json
"@waitron/shared": "workspace:*"
```

Then run `pnpm install` (updates the lockfile — commit it).

- [ ] **Step 2: Write the failing test** — `packages/module/src/errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AppError, isAppError } from "@waitron/shared";
import "./errors.js";

describe("module error registry", () => {
  it("constructs each module.* code with its params", () => {
    const e = new AppError("module.config_unknown", { module: "nope" });
    expect(isAppError(e) && e.code).toBe("module.config_unknown");
  });
});
```

- [ ] **Step 3: Run it — expect FAIL** (`module.config_unknown` not assignable): `pnpm --filter @waitron/module test errors`

- [ ] **Step 4: Create `packages/module/src/errors.ts`:**

```ts
// A bare side-effect import so TypeScript treats "@waitron/shared" as a module to AUGMENT rather
// than redeclare — the same idiom packages/migrations/src/errors.ts uses.
import "@waitron/shared";

/**
 * The module system's contribution to the shared error registry, by declaration merging. The
 * convention is the DOMAIN CONCEPT (name the concept, not the throwing package —
 * packages/shared/src/errors.ts) — `module.*` because these are facts about the module-enablement
 * system. This package is generic (english-only-scanned): the codes name no specific module.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** The on-box modules.json could not be parsed — not an object, `modules` not an object, or a
     * value that is not a boolean. `reason` is our own English description, never the file content. */
    "module.config_invalid": { reason: string };
    /** modules.json names a module that is not in the module list — a typo we refuse rather than
     * silently ignore. `module` is the offending key. */
    "module.config_unknown": { module: string };
    /** modules.json set `core: false`; `core` is mandatory and can never be disabled. */
    "module.core_not_disableable": Record<string, never>;
    /** Venue provisioning was attempted while a `provision-only` module (fiscal today) is disabled.
     * `module` is the disabled provision-only module. Refused before any chain is minted (spec §4). */
    "module.provision_only_disabled": { module: string };
  }
}
```

- [ ] **Step 5: Re-export the registry from the barrel.** In `packages/module/src/index.ts`, add at the bottom (matching `packages/migrations/src/index.ts:6`):

```ts
import "./errors.js";
```

- [ ] **Step 6: Run tests — expect PASS:** `pnpm --filter @waitron/module test errors` and `pnpm vitest run scripts/errors-reachable.test.ts` (the root guard now discovers `@waitron/module` and finds `errors.ts` reachable from `index.ts`).

- [ ] **Step 7: Commit**

```bash
git add packages/module/src/errors.ts packages/module/src/index.ts packages/module/package.json pnpm-lock.yaml packages/module/src/errors.test.ts
git commit -s -m "feat(module): add module.* error registry for SP-1b enablement"
```

---

### Task 2: Config parser + enablement helpers (pure)

**Files:**
- Create: `packages/module/src/config.ts`
- Modify: `packages/module/src/index.ts` (exports)
- Test: `packages/module/src/config.test.ts`

**Interfaces:**
- Consumes: `WaitronModule` (`./module.js`), the `module.*` codes (Task 1).
- Produces:
  - `interface ModuleConfig { readonly overrides: ReadonlyMap<string, boolean> }`
  - `parseModuleConfig(raw: unknown, known: readonly string[]): ModuleConfig`
  - `isEnabled(config: ModuleConfig, name: string): boolean`
  - `enabledModules(modules: readonly WaitronModule[], config: ModuleConfig): WaitronModule[]`
  - `disabledProvisionOnly(modules: readonly WaitronModule[], config: ModuleConfig): string[]`
  - Consumed by Tasks 4, 5, 6.

- [ ] **Step 1: Write the failing test** — `packages/module/src/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import {
  disabledProvisionOnly,
  enabledModules,
  isEnabled,
  parseModuleConfig,
  type ModuleConfig,
} from "./index.js";
import type { WaitronModule } from "./module.js";

const KNOWN = ["core", "fiscal", "payments"];
const mod = (name: string, tier: WaitronModule["tier"]): WaitronModule => ({
  name,
  version: "0.0.0",
  tier,
  migrations: { name, table: `__drizzle_migrations_${name}`, from: `../${name}/drizzle` },
});
const MODULES = [mod("core", "mandatory"), mod("fiscal", "provision-only"), mod("payments", "toggleable")];

describe("parseModuleConfig", () => {
  it("empty input enables everything (default-on)", () => {
    const c = parseModuleConfig({}, KNOWN);
    expect(isEnabled(c, "payments")).toBe(true);
    expect(isEnabled(c, "fiscal")).toBe(true);
  });
  it("an absent key stays enabled; only explicit false disables", () => {
    const c = parseModuleConfig({ modules: { payments: false } }, KNOWN);
    expect(isEnabled(c, "payments")).toBe(false);
    expect(isEnabled(c, "fiscal")).toBe(true);
  });
  it("rejects a non-object", () => {
    const err = (() => { try { parseModuleConfig(42, KNOWN); } catch (e) { return e; } })();
    expect(isAppError(err) && err.code).toBe("module.config_invalid");
  });
  it("rejects a non-boolean value", () => {
    const err = (() => { try { parseModuleConfig({ modules: { payments: "no" } }, KNOWN); } catch (e) { return e; } })();
    expect(isAppError(err) && err.code).toBe("module.config_invalid");
  });
  it("rejects an unknown module name", () => {
    const err = (() => { try { parseModuleConfig({ modules: { nope: false } }, KNOWN); } catch (e) { return e; } })();
    expect(isAppError(err) && err.code).toBe("module.config_unknown");
  });
  it("rejects core: false", () => {
    const err = (() => { try { parseModuleConfig({ modules: { core: false } }, KNOWN); } catch (e) { return e; } })();
    expect(isAppError(err) && err.code).toBe("module.core_not_disableable");
  });
});

describe("enabledModules / disabledProvisionOnly", () => {
  it("enabledModules drops only explicitly-disabled modules, order preserved", () => {
    const c = parseModuleConfig({ modules: { payments: false } }, KNOWN);
    expect(enabledModules(MODULES, c).map((m) => m.name)).toEqual(["core", "fiscal"]);
  });
  it("disabledProvisionOnly lists a disabled provision-only module and nothing else", () => {
    expect(disabledProvisionOnly(MODULES, parseModuleConfig({ modules: { fiscal: false } }, KNOWN))).toEqual(["fiscal"]);
    expect(disabledProvisionOnly(MODULES, parseModuleConfig({ modules: { payments: false } }, KNOWN))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (module not found): `pnpm --filter @waitron/module test config`

- [ ] **Step 3: Create `packages/module/src/config.ts`:**

```ts
import { AppError } from "@waitron/shared";
import type { WaitronModule } from "./module.js";
import "./errors.js";

/**
 * The desired module set, parsed from the on-box modules.json. A SPARSE OVERRIDE map: a module is
 * enabled unless it appears here with `false` (default-on, spec §2). `core` never appears false
 * (the parser refuses it). Absent file → an empty map → everything enabled.
 */
export interface ModuleConfig {
  readonly overrides: ReadonlyMap<string, boolean>;
}

const CORE = "core";

/**
 * Parse and validate raw modules.json content. `known` is the set of valid module names (the
 * composition root passes ALL_MODULES' names) so this pure parser needs no import of the module list.
 * Validates rather than trusts — the file is operator-editable (CLAUDE.md §3).
 */
export function parseModuleConfig(raw: unknown, known: readonly string[]): ModuleConfig {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AppError("module.config_invalid", { reason: "not an object" });
  }
  const modules = (raw as Record<string, unknown>).modules;
  if (modules === undefined) return { overrides: new Map() };
  if (modules === null || typeof modules !== "object" || Array.isArray(modules)) {
    throw new AppError("module.config_invalid", { reason: "`modules` is not an object" });
  }
  const knownSet = new Set(known);
  const overrides = new Map<string, boolean>();
  for (const [name, value] of Object.entries(modules as Record<string, unknown>)) {
    if (typeof value !== "boolean") {
      throw new AppError("module.config_invalid", { reason: `\`modules.${name}\` is not a boolean` });
    }
    if (!knownSet.has(name)) {
      throw new AppError("module.config_unknown", { module: name });
    }
    if (name === CORE && value === false) {
      throw new AppError("module.core_not_disableable", {});
    }
    overrides.set(name, value);
  }
  return { overrides };
}

/** Whether a module is enabled — default-on: only an explicit `false` disables it. */
export function isEnabled(config: ModuleConfig, name: string): boolean {
  return config.overrides.get(name) ?? true;
}

/** The enabled subset, in the input list's order (the migration order, SP-1a §4). */
export function enabledModules(
  modules: readonly WaitronModule[],
  config: ModuleConfig,
): WaitronModule[] {
  return modules.filter((m) => isEnabled(config, m.name));
}

/**
 * The `provision-only` modules that are disabled. Generic — it names no module, it iterates the
 * `tier`, so this stays free of the token "fiscal". The composition root refuses venue provisioning
 * when this is non-empty (spec §4): a provision-only module mints unrecoverable state at provision.
 */
export function disabledProvisionOnly(
  modules: readonly WaitronModule[],
  config: ModuleConfig,
): string[] {
  return modules
    .filter((m) => m.tier === "provision-only" && !isEnabled(config, m.name))
    .map((m) => m.name);
}
```

- [ ] **Step 4: Add exports** to `packages/module/src/index.ts`:

```ts
export type { ModuleConfig } from "./config.js";
export {
  disabledProvisionOnly,
  enabledModules,
  isEnabled,
  parseModuleConfig,
} from "./config.js";
```

- [ ] **Step 5: Run tests — expect PASS:** `pnpm --filter @waitron/module test config`

- [ ] **Step 6: Prove the guards by deletion** — one at a time, temporarily remove the `core: false` check, confirm that test fails, restore; same for the unknown-name check. (Manual verification; do not commit the deletions.)

- [ ] **Step 7: Commit**

```bash
git add packages/module/src/config.ts packages/module/src/index.ts packages/module/src/config.test.ts
git commit -s -m "feat(module): modules.json parser + enablement helpers"
```

---

### Task 3: Reconcile (pure set arithmetic)

**Files:**
- Create: `packages/module/src/reconcile.ts`
- Modify: `packages/module/src/index.ts` (exports)
- Test: `packages/module/src/reconcile.test.ts`

**Interfaces:**
- Produces:
  - `interface Reconciliation { readonly toMigrate: readonly string[]; readonly steady: readonly string[]; readonly softDisabled: readonly string[] }`
  - `reconcile(enabled: readonly string[], migrated: ReadonlySet<string>): Reconciliation`
  - Consumed by Task 5 (boot drift log).

- [ ] **Step 1: Write the failing test** — `packages/module/src/reconcile.test.ts`. The fixture puts one module in EACH class, so the three differences are distinguishable (CLAUDE.md §1 — a measurement where both answers look alike measures nothing):

```ts
import { describe, expect, it } from "vitest";
import { reconcile } from "./index.js";

describe("reconcile", () => {
  it("classifies each module into exactly one of toMigrate / steady / softDisabled", () => {
    // enabled: core (already migrated), payments (not yet migrated)
    // migrated: core, scheduler (scheduler is migrated but no longer enabled → soft-disabled)
    const r = reconcile(["core", "payments"], new Set(["core", "scheduler"]));
    expect(r.toMigrate).toEqual(["payments"]);
    expect(r.steady).toEqual(["core"]);
    expect(r.softDisabled).toEqual(["scheduler"]);
  });
  it("empty when nothing is enabled or migrated", () => {
    const r = reconcile([], new Set());
    expect(r).toEqual({ toMigrate: [], steady: [], softDisabled: [] });
  });
});
```

- [ ] **Step 2: Run it — expect FAIL:** `pnpm --filter @waitron/module test reconcile`

- [ ] **Step 3: Create `packages/module/src/reconcile.ts`:**

```ts
/**
 * The outcome of comparing DESIRED (the modules.json enabled set) against ACTUAL (the modules whose
 * schema the database has already migrated, derived from appliedSchemaVersion — spec §3). Every
 * module lands in exactly one class.
 */
export interface Reconciliation {
  /** enabled but not yet migrated → migrate (and, when provisioned, seed). */
  readonly toMigrate: readonly string[];
  /** enabled and already migrated → nothing (an idempotent re-run is a no-op). */
  readonly steady: readonly string[];
  /** migrated but no longer enabled → soft-disable: skip, data kept (spec §5). */
  readonly softDisabled: readonly string[];
}

/**
 * Pure set arithmetic. `enabled` order is preserved in `toMigrate`/`steady`; `softDisabled` is in
 * `migrated` iteration order. No DB access here — the caller derives `migrated` from
 * appliedSchemaVersion and runs this OUTSIDE any transaction (spec §3: that probe's 42P01 catch
 * would poison one).
 */
export function reconcile(
  enabled: readonly string[],
  migrated: ReadonlySet<string>,
): Reconciliation {
  const enabledSet = new Set(enabled);
  return {
    toMigrate: enabled.filter((m) => !migrated.has(m)),
    steady: enabled.filter((m) => migrated.has(m)),
    softDisabled: [...migrated].filter((m) => !enabledSet.has(m)),
  };
}
```

- [ ] **Step 4: Add exports** to `packages/module/src/index.ts`:

```ts
export type { Reconciliation } from "./reconcile.js";
export { reconcile } from "./reconcile.js";
```

- [ ] **Step 5: Run tests — expect PASS:** `pnpm --filter @waitron/module test:coverage` (whole package, unfiltered — confirms 98/98/98/95).

- [ ] **Step 6: Commit**

```bash
git add packages/module/src/reconcile.ts packages/module/src/index.ts packages/module/src/reconcile.test.ts
git commit -s -m "feat(module): reconcile desired vs migrated module sets"
```

---

### Task 4: `readModuleConfig` in the composition root

**Files:**
- Create: `apps/server/src/module-config.ts`
- Test: `apps/server/src/module-config.test.ts`

**Interfaces:**
- Consumes: `parseModuleConfig`, `ModuleConfig` (`@waitron/module`); `ALL_MODULES` (`./modules.js`).
- Produces: `readModuleConfig(stateDir: string): Promise<ModuleConfig>` — consumed by Task 5 (boot) and Task 6 (provision binding).

- [ ] **Step 1: Write the failing test** — `apps/server/src/module-config.test.ts` (uses a real temp dir):

```ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { isEnabled } from "@waitron/module";
import { readModuleConfig } from "./module-config.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "waitron-modcfg-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("readModuleConfig", () => {
  it("absent file → everything enabled", async () => {
    const c = await readModuleConfig(dir);
    expect(isEnabled(c, "fiscal")).toBe(true);
    expect(isEnabled(c, "payments")).toBe(true);
  });
  it("reads and validates a present file", async () => {
    writeFileSync(join(dir, "modules.json"), JSON.stringify({ modules: { payments: false } }));
    const c = await readModuleConfig(dir);
    expect(isEnabled(c, "payments")).toBe(false);
  });
  it("a malformed (non-JSON) file throws module.config_invalid, not a bare SyntaxError", async () => {
    writeFileSync(join(dir, "modules.json"), "{ not json");
    const err = await readModuleConfig(dir).catch((e) => e);
    expect(isAppError(err) && err.code).toBe("module.config_invalid");
  });
  it("an unknown module name in the file throws module.config_unknown", async () => {
    writeFileSync(join(dir, "modules.json"), JSON.stringify({ modules: { nope: false } }));
    const err = await readModuleConfig(dir).catch((e) => e);
    expect(isAppError(err) && err.code).toBe("module.config_unknown");
  });
});
```

- [ ] **Step 2: Run it — expect FAIL:** `pnpm --filter @waitron/server test module-config`

- [ ] **Step 3: Create `apps/server/src/module-config.ts`:**

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "@waitron/shared";
import { parseModuleConfig, type ModuleConfig } from "@waitron/module";
import { ALL_MODULES } from "./modules.js";

const KNOWN = ALL_MODULES.map((m) => m.name);

/**
 * Read `<stateDir>/modules.json` into the desired ModuleConfig (spec §2). Absent file = every module
 * enabled (today's behaviour). A present-but-unparseable file is reported as `module.config_invalid`
 * rather than a bare `SyntaxError`, so a hand-edited file fails with a classified, actionable code.
 * Read at boot before migrations (spec §1.3) — the enabled set is not a DB row.
 */
export async function readModuleConfig(stateDir: string): Promise<ModuleConfig> {
  let text: string;
  try {
    text = await readFile(join(stateDir, "modules.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return parseModuleConfig({}, KNOWN); // no file → all enabled
    }
    throw error;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AppError("module.config_invalid", { reason: "modules.json is not valid JSON" });
  }
  return parseModuleConfig(raw, KNOWN);
}
```

- [ ] **Step 4: Run tests — expect PASS:** `pnpm --filter @waitron/server test module-config`

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/module-config.ts apps/server/src/module-config.test.ts
git commit -s -m "feat(server): read <stateDir>/modules.json into a ModuleConfig"
```

---

### Task 5: Boot migration filter (trading) + drift log; setup migrates all

**Files:**
- Modify: `apps/server/src/boot.ts` (the `applyMigrations` call at `:507-510`, and a drift-log after the `db` pool opens at `:511`)
- Test: extend `apps/server/src/boot.test.ts` (or the existing boot/migration real-Postgres test — search for the suite that asserts the `__drizzle_migrations_*` tables after boot)

**Interfaces:**
- Consumes: `enabledModules`, `reconcile` (`@waitron/module`); `readModuleConfig` (`./module-config.js`); `ALL_MODULES`; the existing `orderedMigrationSets`, `migrationOptionsFor`, `appliedSchemaVersion`.
- Produces: no new export — a behaviour change to `startServer`.

- [ ] **Step 1: Write the failing test.** First locate the existing real-Postgres boot/migration assertion (`grep -n "__drizzle_migrations" apps/server/src/boot.test.ts`). Add two cases (real Postgres — set `TESTCONTAINERS_RYUK_DISABLED=true`). Because a disabled statically-wired module would break a full trading boot, drive the migration STEP with a chosen enabled set rather than asserting a full boot with a module off — assert on the migration tables that result:

```ts
// (a) default (no modules.json): a trading boot migrates every set — behaviour-preserving.
//     Assert every ALL_MODULES set's __drizzle_migrations_<table> exists and is non-empty.
// (b) with modules.json disabling one TOGGLEABLE module (e.g. "scheduler"): after the trading-mode
//     migration step, that module's __drizzle_migrations_<table> is ABSENT while the rest are present.
```

Follow the existing suite's harness for standing up a container + running the trading-mode boot/migration path with a `stateDir` you control (write `modules.json` into it for case (b)). If the existing test boots the whole server, prefer extracting/────calling the migration step with the filtered set, or write `modules.json` into the boot's `stateDir` and assert the resulting tables. Model the assertions on the existing `to_regclass('public.__drizzle_migrations_scheduler')` style already used in the tree.

- [ ] **Step 2: Run it — expect FAIL** (case (b): the disabled set's table is still present because the filter does not exist yet).

- [ ] **Step 3: Implement the filter.** In `apps/server/src/boot.ts`, replace the `applyMigrations(...)` call at `:507-510` with a mode-aware set list:

```ts
// SP-1b: setup mode migrates the FULL schema (the wizard needs it — SP-1a §4 "setup-migrates-all");
// trading mode migrates only the modules the on-box modules.json enables (default: all). The enabled
// set is read from <stateDir>/modules.json BEFORE migrations, exactly when the decision is needed
// (spec §1.3). `enabledModules` never drops `core` (mandatory; the parser refuses `core: false`).
const moduleConfig =
  config.till === undefined ? undefined : await readModuleConfig(config.stateDir);
const setsToMigrate =
  moduleConfig === undefined ? ALL_MODULES : enabledModules(ALL_MODULES, moduleConfig);
await applyMigrations(
  config.migrationsDatabaseUrl,
  migrationOptionsFor(orderedMigrationSets(setsToMigrate), config.migrationsRoot),
);
```

Add the imports at the top of `boot.ts`:

```ts
import { enabledModules, reconcile } from "@waitron/module";
import { appliedSchemaVersion } from "@waitron/migrations";
import { readModuleConfig } from "./module-config.js";
```

(`orderedMigrationSets` and `migrationOptionsFor` are already imported; `ALL_MODULES` too.)

- [ ] **Step 4: Add the drift log** (trading mode only), just after `const db = await createPostgresDb(config.databaseUrl);` at `:511`. This runs on the pool (auto-commit per statement, so the `appliedSchemaVersion` 42P01-catch poisons nothing — spec §3):

```ts
// SP-1b drift visibility (spec §3): compare the enabled set against what the DB has actually
// migrated (derived from appliedSchemaVersion — no deployment column). softDisabled = a module the
// DB carries but modules.json no longer enables; its data is kept, it is simply not migrated. Logged
// at info so an operator sees the reconcile outcome; nothing acts on it here beyond the filter above.
if (moduleConfig !== undefined) {
  const migrated = new Set<string>();
  for (const m of ALL_MODULES) {
    if ((await appliedSchemaVersion(db, m.migrations)) > 0) migrated.add(m.name);
  }
  const r = reconcile(enabledModules(ALL_MODULES, moduleConfig).map((m) => m.name), migrated);
  if (r.softDisabled.length > 0 || r.toMigrate.length > 0) {
    log.info("module.reconcile", { softDisabled: r.softDisabled, toMigrate: r.toMigrate });
  }
}
```

(Confirm the logger binding name in scope at that point — it is `log` in `startServer`; match the existing `log.info(...)` call sites.)

- [ ] **Step 5: Run tests — expect PASS** for both cases: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test boot`

- [ ] **Step 6: Prove the filter by deletion** — temporarily revert `setsToMigrate` to `ALL_MODULES` unconditionally; confirm case (b) fails (the disabled module's table reappears); restore.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/boot.ts apps/server/src/boot.test.ts
git commit -s -m "feat(server): filter boot migrations by modules.json in trading mode + drift log"
```

---

### Task 6: Provisioning fiscal-gate refusal

**Files:**
- Modify: `apps/server/src/provision.ts` (`ProvisionDeps` + `provisionVenue` step 1 guard)
- Modify: `apps/server/src/boot.ts` (`:648` — bind `moduleConfig` into the `provision` dep)
- Test: `apps/server/src/provision.test.ts` (find the existing suite; add the guard cases)

**Interfaces:**
- Consumes: `disabledProvisionOnly`, `ModuleConfig` (`@waitron/module`); `ALL_MODULES` (`./modules.js`); `readModuleConfig` (Task 4).
- Produces: `ProvisionDeps` gains `readonly moduleConfig: ModuleConfig`; `provisionVenue` throws `module.provision_only_disabled` when a provision-only module is disabled.

- [ ] **Step 1: Write the failing test** — extend `apps/server/src/provision.test.ts`. The guard must fire BEFORE `planVenue`/`stampDeployment`/`applyVenue` (nothing minted). Build a `ModuleConfig` disabling fiscal and assert the throw; assert the default (all enabled) still provisions:

```ts
import { parseModuleConfig } from "@waitron/module";
import { ALL_MODULES } from "./modules.js";

const KNOWN = ALL_MODULES.map((m) => m.name);

it("refuses venue provisioning when a provision-only module is disabled — before minting anything", async () => {
  const moduleConfig = parseModuleConfig({ modules: { fiscal: false } }, KNOWN);
  // A deps whose ownerDb would THROW if touched, proving the guard short-circuits before any DB work:
  const ownerDb = new Proxy({}, { get() { throw new Error("ownerDb must not be touched"); } }) as never;
  const err = await provisionVenue({ ownerDb, moduleConfig }, VALID_REQUEST).catch((e) => e);
  expect(isAppError(err) && err.code).toBe("module.provision_only_disabled");
});

it("provisions normally when all modules are enabled (default)", async () => {
  // existing happy-path test, now passing moduleConfig: parseModuleConfig({}, KNOWN)
});
```

Reuse the suite's existing valid request + real/owner DB fixture for the happy path; add `moduleConfig: parseModuleConfig({}, KNOWN)` to its deps.

- [ ] **Step 2: Run it — expect FAIL** (`moduleConfig` not on `ProvisionDeps`; no guard).

- [ ] **Step 3: Implement.** In `apps/server/src/provision.ts`:

Add to imports:

```ts
import { disabledProvisionOnly, type ModuleConfig } from "@waitron/module";
import { ALL_MODULES } from "./modules.js";
```

Add to `ProvisionDeps`:

```ts
  /** The desired module set (from <stateDir>/modules.json). A `provision-only` module disabled here
   * refuses provisioning (spec §4) — never mint an unrecoverable chain for a module that is off. */
  readonly moduleConfig: ModuleConfig;
```

Insert as the FIRST statement in `provisionVenue` (before `planVenue`), so nothing is validated, stamped or minted when the guard fires:

```ts
  // 0. SP-1b fiscal gate. A `provision-only` module (fiscal today) that modules.json disables must
  // never be seeded — registerSif mints an unrecoverable chain (CLAUDE.md §5). SP-1b REFUSES rather
  // than building a fiscal-less venue (that path touches the fiscal core and is SP-3). Generic: it
  // names no module, it iterates the provision-only tier.
  const blocked = disabledProvisionOnly(ALL_MODULES, deps.moduleConfig);
  if (blocked.length > 0) {
    throw new AppError("module.provision_only_disabled", { module: blocked[0]! });
  }
```

(`AppError` is already imported in `provision.ts`. Importing from `@waitron/module` loads its error registry so the code is registered.)

- [ ] **Step 4: Thread `moduleConfig` through the boot binding.** In `apps/server/src/boot.ts`, the setup branch already computes nothing for provision's config. Read the config once in the setup branch and pass it. At `:648` change:

```ts
provision: (req) => provisionVenue({ ownerDb }, req),
```

to:

```ts
provision: (req) => provisionVenue({ ownerDb, moduleConfig: setupModuleConfig }, req),
```

and, earlier in the setup branch (near where `ownerDb` is created at `:627`, inside the same `try`), add:

```ts
// The desired module set for the provisioning gate (spec §4). Setup mode migrated the full schema
// regardless, but provisioning must refuse a disabled provision-only module — so read the same
// on-box modules.json the trading boot reads. Absent file = all enabled.
const setupModuleConfig = await readModuleConfig(config.stateDir);
```

(`readModuleConfig` is imported by Task 5. Confirm the placement is inside the setup branch, in scope for the `mountSetup` call.)

- [ ] **Step 5: Run tests — expect PASS:** `pnpm --filter @waitron/server test provision`

- [ ] **Step 6: Prove the guard by deletion** — remove the step-0 guard, confirm the fiscal-disabled test now fails (it reaches `applyVenue`/throws elsewhere, not `module.provision_only_disabled`), restore.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/provision.ts apps/server/src/boot.ts apps/server/src/provision.test.ts
git commit -s -m "feat(server): refuse venue provisioning when a provision-only module is disabled"
```

---

### Task 7: Whole-workspace verification + docs

**Files:**
- Modify: `docs/backlog.md` (mark SP-1b landed once merged — done at land time, not here) — no code.

- [ ] **Step 1: Run the guards whole-package / whole-tree** (a filtered green hides cross-cutting suites — CLAUDE.md §2/§4):

```bash
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/module test:coverage
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage
pnpm vitest run scripts/english-only.test.ts
pnpm vitest run scripts/errors-reachable.test.ts
pnpm --filter @waitron/fiscal-verifactu test inmutabilidad
```

Expected: all green. `english-only` confirms `@waitron/module` introduced no Spanish/module-name token; `errors-reachable` confirms the new `errors.ts` is reachable; `inmutabilidad` confirms nothing about the fiscal chain moved.

- [ ] **Step 2: Run the four-command gate + `--frozen-lockfile` check:**

```bash
pnpm lint && pnpm typecheck && pnpm format:check && pnpm test
pnpm install --frozen-lockfile
```

- [ ] **Step 3:** Hand off to `superpowers:finishing-a-development-branch` (simplify → review → rebase → PR → CI + Copilot). Backlog update happens at land time (per `/land-branch`).

## Self-Review

**Spec coverage:** §2 config file → Tasks 1,2,4. §3 reconcile (derived actual) → Tasks 3,5. §4 boot filter + setup-all + provisioning refusal + benign-migrate → Tasks 5,6 (instance-apply intentionally untouched, spec §4). §5 soft-disable (skip migrate + refuse seed) → Tasks 5,6. §6 testing → each task's tests + Task 7. §7 invariants → behaviour-preserving default asserted in Tasks 5,6; no schema/grant change (none added). §8 interactions → documentation, no code.

**Placeholder scan:** none — every code step carries real code. The one soft spot is Task 5 Step 1 (the existing boot test harness must be located and matched); it names the grep and the assertion style rather than inventing a harness, deliberately, because the harness already exists in `boot.test.ts`.

**Type consistency:** `ModuleConfig` (Task 2) is consumed unchanged in Tasks 4,5,6. `parseModuleConfig(raw, known)` — the two-arg form — is used consistently. `enabledModules`/`disabledProvisionOnly`/`reconcile` signatures match across producer (Tasks 2,3) and consumers (Tasks 5,6). `ProvisionDeps.moduleConfig` (Task 6) is bound in boot (Task 6 Step 4) using `readModuleConfig` (Task 4).
