# SP-1c — Versioned Migration Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-maintained linear migration order with an order derived from a declared, verified dependency graph, and refuse an incompatible or dependency-incomplete module set loudly before migrating anything.

**Architecture:** `@waitron/module`'s `orderedMigrationSets` becomes a single pure resolve-validate-and-order function: it checks every declared dependency is present and version-satisfied, detects cycles, then returns the migration sets in a stable topological order (Kahn's algorithm, input-list order as tie-break). The nine descriptors in `apps/server/src/modules.ts` gain their `requires` edges, read off the real cross-set FK/function graph. Boot's one call site (`boot.ts:543`) is unchanged, so the refusal rides the existing seam.

**Tech Stack:** TypeScript, `@waitron/module` (pure-Node leaf), the `semver` package (new dependency) for full range comparison, Vitest, real-Postgres boot test via the shared-container harness.

**Spec:** `docs/superpowers/specs/2026-09-04-module-sp1c-versioned-ordering.md`

## Global Constraints

- **Behaviour-preserving:** the same nine sets run in the same order in both trading and setup mode. `orderedMigrationSets(ALL_MODULES)` must still deep-equal `manifestSets()` (SP-1a's pin, `apps/server/src/modules.test.ts:8`).
- **`orderedMigrationSets` stays pure** — no DB, no I/O — and keeps its signature `(modules: readonly WaitronModule[]) => MigrationSet[]`.
- **Error codes name the domain concept, never a package** (CLAUDE.md §3); the `module.*` prefix is the sibling convention (`packages/module/src/errors.ts`). Codes are never renamed once shipped.
- **`requires` version ranges are `"*"`** on every descriptor — the true current constraint (all modules workspace-locked at `version: "0.0.0"`); a fake range would be an unreceipted claim (CLAUDE.md §1). The machinery is full-semver; tests exercise real ranges via fixtures.
- **The dependency graph is read from the tree, not invented.** The only inter-module edge is `workforce → identity` (workforce FKs `persons`, which identity owns). Every other non-core module requires only `core`. See spec §3 for the per-module receipts.
- **`@waitron/module` coverage thresholds:** 98 statements / 98 lines / 98 functions / 95 branches. Every new branch (each throw, the cycle path) needs a test.
- **Gate before pushing:** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`, plus `pnpm --filter @waitron/module test:coverage` (CI runs coverage, the four-command gate does not) and `pnpm install` for the lockfile (the `semver` add).

---

### Task 1: Four new `module.*` error codes

**Files:**
- Modify: `packages/module/src/errors.ts` (add to the `declare module` block)
- Test: `packages/module/src/errors.test.ts`

**Interfaces:**
- Consumes: `ErrorParams` interface from `@waitron/shared` (augmented by declaration merging).
- Produces: four error codes for Task 2 to throw — `module.dependency_missing` `{ module: string; requires: string }`, `module.dependency_cycle` `{ modules: readonly string[] }`, `module.incompatible_version` `{ module: string; dependency: string; required: string; actual: string }`, `module.requires_invalid` `{ module: string; dependency: string; range: string }`.

- [ ] **Step 1: Write the failing test** — add a case to `errors.test.ts` constructing the new codes:

```typescript
  it("constructs the SP-1c ordering codes with their params", () => {
    const missing = new AppError("module.dependency_missing", {
      module: "workforce",
      requires: "identity",
    });
    expect(isAppError(missing) && missing.code).toBe("module.dependency_missing");
    const cycle = new AppError("module.dependency_cycle", { modules: ["a", "b"] });
    expect(isAppError(cycle) && cycle.code).toBe("module.dependency_cycle");
    const incompat = new AppError("module.incompatible_version", {
      module: "workforce",
      dependency: "identity",
      required: ">=1.0.0",
      actual: "0.0.0",
    });
    expect(isAppError(incompat) && incompat.code).toBe("module.incompatible_version");
    const invalid = new AppError("module.requires_invalid", {
      module: "workforce",
      dependency: "core",
      range: "not-a-range",
    });
    expect(isAppError(invalid) && invalid.code).toBe("module.requires_invalid");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/module test errors`
Expected: FAIL — TypeScript rejects the unknown codes (`module.dependency_missing` not assignable to the `ErrorParams` keys).

- [ ] **Step 3: Add the codes** — extend the `declare module "@waitron/shared"` block in `errors.ts`, after the existing `module.provision_only_disabled` entry:

```typescript
    /** A migrating module declares a dependency (its `requires.core` or a `requires.modules` entry)
     * that is not present in the set being migrated — e.g. `workforce` enabled while `identity`
     * (which owns `persons`, a table workforce FKs) is disabled. Refused before the first migration
     * runs (spec §4), turning a cryptic mid-run FK failure into a clear pre-migration refusal.
     * `module` requires `requires`. */
    "module.dependency_missing": { module: string; requires: string };
    /** The module dependency graph has a cycle; `modules` names the members that could not be
     * ordered. Unreachable with today's graph (a tree rooted at core), guarded against a future
     * cross-set edit that introduces one. */
    "module.dependency_cycle": { modules: readonly string[] };
    /** A dependency is present but its `version` does not satisfy the declared semver `range`.
     * Never tripped today (every range is `"*"` against `0.0.0`); real once modules distribute
     * independently. `module` requires `dependency` `required`; `dependency` is at `actual`. */
    "module.incompatible_version": {
      module: string;
      dependency: string;
      required: string;
      actual: string;
    };
    /** A `requires` range string is not a valid semver range — a descriptor (code) bug, failed loud
     * rather than silently treated as "any". `module`'s requirement on `dependency` used `range`. */
    "module.requires_invalid": { module: string; dependency: string; range: string };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @waitron/module test errors`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/module/src/errors.ts packages/module/src/errors.test.ts
git commit -s -m "feat(module): SP-1c ordering error codes (dependency_missing/cycle/incompatible_version/requires_invalid)"
```

---

### Task 2: `orderedMigrationSets` resolves, validates, and topologically orders

**Files:**
- Modify: `packages/module/src/package.json` (add `semver` dependency + `@types/semver` dev)
- Modify: `packages/module/src/module.ts` (rewrite `orderedMigrationSets`; add private helpers)
- Test: `packages/module/src/module.test.ts`
- Modify (lockfile): `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `WaitronModule` (`module.ts`), its `requires?: { core?: string; modules?: Readonly<Record<string, string>> }` field; `MigrationSet` from `@waitron/migrations`; `AppError` from `@waitron/shared`; the four codes from Task 1; `semver.validRange` and `semver.satisfies`.
- Produces: `orderedMigrationSets(modules: readonly WaitronModule[]): MigrationSet[]` — now validating + topologically ordering. Task 3 relies on it reproducing the manifest order for `ALL_MODULES`; Task 4 relies on it throwing `module.dependency_missing`.

- [ ] **Step 1: Add the `semver` dependency**

Edit `packages/module/package.json`: add `"semver": "^7.7.0"` to `dependencies` (alongside `@waitron/migrations`/`@waitron/shared`), and `"@types/semver": "^7.7.0"` to `devDependencies`. Then from the repo root:

Run: `pnpm install`
Expected: `pnpm-lock.yaml` updates; `semver` becomes a direct dep of `@waitron/module`. (This is the first external runtime dep on this leaf package — spec §7. CI runs `--frozen-lockfile`, so the lockfile must be committed with this task.)

- [ ] **Step 2: Write the failing tests** — replace the body of `module.test.ts`'s `describe("orderedMigrationSets", …)` and add the graph cases. Keep the `mod` helper but extend it to take optional `requires`:

```typescript
import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { orderedMigrationSets, type WaitronModule } from "./index.js";

const mod = (name: string, requires?: WaitronModule["requires"]): WaitronModule => ({
  name,
  version: "0.0.0",
  tier: "toggleable",
  migrations: { name, table: `__drizzle_migrations_${name}`, from: `../${name}/drizzle` },
  ...(requires ? { requires } : {}),
});

/** The AppError code `fn` throws, or `false` if it did not throw one. */
function thrownCode(fn: () => unknown): string | false {
  try {
    fn();
    return false;
  } catch (error) {
    return isAppError(error) ? error.code : false;
  }
}

describe("orderedMigrationSets", () => {
  it("maps dependency-free modules in list order (no edges → input order preserved)", () => {
    const mods = [mod("core"), mod("fiscal"), mod("sync")];
    expect(orderedMigrationSets(mods)).toEqual(mods.map((m) => m.migrations));
  });

  it("is empty for no modules", () => {
    expect(orderedMigrationSets([])).toEqual([]);
  });

  it("reorders a wrong input into dependency order, input order as tie-break", () => {
    // workforce placed BEFORE identity in the input; the sort must move identity ahead of it, and
    // core (required by both) ahead of all — while leaving unrelated modules in input order.
    const mods = [
      mod("workforce", { core: "*", modules: { identity: "*" } }),
      mod("core"),
      mod("payments", { core: "*" }),
      mod("identity", { core: "*" }),
    ];
    expect(orderedMigrationSets(mods).map((s) => s.name)).toEqual([
      "core",
      "payments",
      "identity",
      "workforce",
    ]);
  });

  it("throws module.dependency_missing when a required module is absent from the set", () => {
    const mods = [mod("core"), mod("workforce", { core: "*", modules: { identity: "*" } })];
    expect(thrownCode(() => orderedMigrationSets(mods))).toBe("module.dependency_missing");
  });

  it("throws module.dependency_cycle on a cyclic graph", () => {
    const mods = [mod("a", { modules: { b: "*" } }), mod("b", { modules: { a: "*" } })];
    expect(thrownCode(() => orderedMigrationSets(mods))).toBe("module.dependency_cycle");
  });

  it("throws module.incompatible_version when a present dependency's version is out of range", () => {
    const mods = [mod("core"), mod("workforce", { core: ">=1.0.0" })]; // core is 0.0.0
    expect(thrownCode(() => orderedMigrationSets(mods))).toBe("module.incompatible_version");
  });

  it("accepts a dependency whose version satisfies the range (positive control)", () => {
    const mods = [mod("core"), mod("workforce", { core: ">=0.0.0" })];
    expect(orderedMigrationSets(mods).map((s) => s.name)).toEqual(["core", "workforce"]);
  });

  it("throws module.requires_invalid on a malformed range string", () => {
    const mods = [mod("core"), mod("workforce", { core: "not-a-range" })];
    expect(thrownCode(() => orderedMigrationSets(mods))).toBe("module.requires_invalid");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @waitron/module test module.test`
Expected: FAIL — the reorder test fails (current impl is `modules.map`, no reordering) and the four throw-cases fail (no validation yet).

- [ ] **Step 4: Rewrite `orderedMigrationSets`** in `module.ts`. Replace the existing function (keep the `WaitronModule` interface above it unchanged) with:

```typescript
import semver from "semver";
import { AppError } from "@waitron/shared";
import type { MigrationSet } from "@waitron/migrations";
import "./errors.js";

// (WaitronModule interface stays above, unchanged.)

/** The dependency edges a module declares: its `requires.core` (as a dep on "core") plus every
 * `requires.modules` entry. Each yields `[dependencyName, semverRange]`. A module with no `requires`
 * yields nothing (in-degree 0 — e.g. core). */
function* requiredEdges(m: WaitronModule): Iterable<readonly [string, string]> {
  if (m.requires?.core !== undefined) yield ["core", m.requires.core];
  for (const [dep, range] of Object.entries(m.requires?.modules ?? {})) yield [dep, range];
}

/**
 * Resolve, validate, and order the migration sets (spec §5). Pure — no DB, no I/O.
 *
 * The list order is NO LONGER the migration order (SP-1a); the order is DERIVED from each module's
 * declared `requires` graph. This single entry point validates the set (version compatibility +
 * dependency presence + no cycle) and returns the sets in a stable topological order, so boot's one
 * call site cannot skip the check. Kahn's algorithm with the INPUT list order as the tie-break among
 * ready nodes reproduces today's manifest order for `ALL_MODULES` (spec §5 trace; the SP-1a pin holds
 * and now also proves the sort reproduces the manifest).
 *
 * Throws (loud, before any caller migrates): `module.requires_invalid` (a malformed range — a
 * descriptor bug), `module.dependency_missing` (a required module absent from the set — tripable
 * today via modules.json, spec §4), `module.incompatible_version` (present but version out of range),
 * `module.dependency_cycle` (the graph does not drain).
 */
export function orderedMigrationSets(modules: readonly WaitronModule[]): MigrationSet[] {
  const byName = new Map(modules.map((m) => [m.name, m]));

  // 1. Validate every declared edge: range well-formed, dependency present, version satisfied.
  //    validRange first (a descriptor bug is independent of the set); presence before satisfies
  //    (an absent module has no version to compare — spec §5).
  for (const m of modules) {
    for (const [dep, range] of requiredEdges(m)) {
      if (semver.validRange(range) === null) {
        throw new AppError("module.requires_invalid", { module: m.name, dependency: dep, range });
      }
      const target = byName.get(dep);
      if (target === undefined) {
        throw new AppError("module.dependency_missing", { module: m.name, requires: dep });
      }
      if (!semver.satisfies(target.version, range)) {
        throw new AppError("module.incompatible_version", {
          module: m.name,
          dependency: dep,
          required: range,
          actual: target.version,
        });
      }
    }
  }

  // 2. Kahn topological sort. in-degree = number of edges OUT of a module (deps it waits on);
  //    dependents[d] = modules that require d (edges to decrement when d is emitted).
  const inDegree = new Map<string, number>(modules.map((m) => [m.name, 0]));
  const dependents = new Map<string, string[]>();
  for (const m of modules) {
    for (const [dep] of requiredEdges(m)) {
      inDegree.set(m.name, (inDegree.get(m.name) ?? 0) + 1);
      const list = dependents.get(dep) ?? [];
      list.push(m.name);
      dependents.set(dep, list);
    }
  }

  // Repeatedly emit the EARLIEST-in-input-order ready (in-degree 0, not yet emitted) module. The
  // rescan-from-top is the stable tie-break: it always picks the lowest input index among the ready
  // set. O(V^2) scans for V modules — V is the module count (≤ a dozen), so this is negligible.
  const ordered: WaitronModule[] = [];
  const emitted = new Set<string>();
  let advanced = true;
  while (ordered.length < modules.length && advanced) {
    advanced = false;
    for (const m of modules) {
      if (emitted.has(m.name) || (inDegree.get(m.name) ?? 0) !== 0) continue;
      ordered.push(m);
      emitted.add(m.name);
      advanced = true;
      for (const d of dependents.get(m.name) ?? []) {
        inDegree.set(d, (inDegree.get(d) ?? 0) - 1);
      }
      break; // restart from the top so the next pick is the earliest ready node.
    }
  }

  if (ordered.length < modules.length) {
    const inCycle = modules.filter((m) => !emitted.has(m.name)).map((m) => m.name);
    throw new AppError("module.dependency_cycle", { modules: inCycle });
  }

  return ordered.map((m) => m.migrations);
}
```

Also delete the now-stale `@param`-style doc line on the old function and remove the old one-line body. Keep the `import type { MigrationSet }` — merge with the new `semver`/`AppError`/`errors.js` imports at the top of the file (do not duplicate the `MigrationSet` import).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @waitron/module test module.test`
Expected: PASS — all eight cases green.

- [ ] **Step 6: Prove each guard by deletion** (CLAUDE.md §4 — do not commit these deletions):

Temporarily comment out the `module.dependency_missing` throw → the missing-dep test fails; restore. Repeat for the cycle throw (comment the final `if`), `module.incompatible_version` (comment the `satisfies` throw), and `module.requires_invalid` (comment the `validRange` throw). Confirm each corresponding test goes red, then restore all. This confirms the tests police the guards, not incidental behaviour.

- [ ] **Step 7: Run the package coverage gate**

Run: `pnpm --filter @waitron/module test:coverage`
Expected: PASS at 98/98/98/95. If a branch is uncovered (e.g. the `?? 0`/`?? []` defensive fallbacks), it is because the map is pre-seeded for every module — those `??` branches are unreachable defensive reads; simplify them to non-`??` reads (the maps are seeded for every `m.name`, and `dependents.get` is only read for emitted names that were keys) OR add a covering case. Prefer removing an unreachable defensive `??` over an artificial test.

- [ ] **Step 8: Commit**

```bash
git add packages/module/package.json packages/module/src/module.ts packages/module/src/module.test.ts pnpm-lock.yaml
git commit -s -m "feat(module): derive migration order from the requires graph + refuse incompatible sets"
```

---

### Task 3: Populate `requires` on the nine descriptors

**Files:**
- Modify: `apps/server/src/modules.ts` (add `requires` to the eight non-core descriptors)
- Verify (no change expected): `apps/server/src/modules.test.ts` (the SP-1a pin), `apps/server/src/boot.test.ts`

**Interfaces:**
- Consumes: the rewritten `orderedMigrationSets` (Task 2) — feeds it `ALL_MODULES`.
- Produces: `ALL_MODULES` descriptors carrying the verified graph; the source of truth boot and the pin resolve.

- [ ] **Step 1: Confirm the pin still passes BEFORE editing** (baseline — Task 2 must not have moved it):

Run: `pnpm --filter @waitron/server test modules.test`
Expected: PASS — `orderedMigrationSets(ALL_MODULES)` still deep-equals `manifestSets()` (Task 2's sort reproduces input order for the still-`requires`-less descriptors).

- [ ] **Step 2: Add `requires` to each non-core descriptor** in `modules.ts`. Add the field after `tier` on each. Core gets nothing. The values (all ranges `"*"`, per Global Constraints):

```typescript
  // identity
    tier: "toggleable",
    requires: { core: "*" },
  // workforce  — the one inter-module edge: workforce FKs `persons`, which identity owns
    tier: "toggleable",
    requires: { core: "*", modules: { identity: "*" } },
  // workforce-es
    tier: "toggleable",
    requires: { core: "*" },
  // fiscal
    tier: "provision-only",
    requires: { core: "*" },
  // payments
    tier: "toggleable",
    requires: { core: "*" },
  // scheduler
    tier: "toggleable",
    requires: { core: "*" },
  // credentials
    tier: "toggleable",
    requires: { core: "*" },
  // sync  — no FKs, but uses core's current_tenant_id() function
    tier: "toggleable",
    requires: { core: "*" },
```

Also update the file's header doc comment: the line "Only `name`/`version`/`tier`/`migrations` are populated in this slice; `requires` … stay empty" is now stale — change it to note that `requires` is populated in SP-1c from the verified cross-set graph (workforce → identity the only inter-module edge; every other non-core module → core), with `"*"` ranges because all versions are workspace-locked at `0.0.0`. Reference spec §3.

- [ ] **Step 3: Verify the pin STILL passes after editing** (the graph must reproduce the manifest order):

Run: `pnpm --filter @waitron/server test modules.test`
Expected: PASS — the topological sort of the now-populated `ALL_MODULES` still equals `manifestSets()` (spec §5 trace). If it fails, the graph contradicts the manifest order — stop and re-check §3, do not reorder the manifest to match.

- [ ] **Step 4: Verify the boot migration suite still passes** (both the trading migration-journal assertion at `boot.test.ts:~644` and the setup-mode fresh-DB probe iterate `orderedMigrationSets(ALL_MODULES)`):

Run: `pnpm --filter @waitron/server test boot.test`
Expected: PASS — all nine journals present/consistent, unchanged order. (Requires Docker + `TESTCONTAINERS_RYUK_DISABLED=true` locally, CLAUDE.md §4.)

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules.ts
git commit -s -m "feat(server): populate module requires from the verified cross-set dependency graph"
```

---

### Task 4: Real-Postgres boot refusal for a dependency-incomplete enabled set

**Files:**
- Modify: `apps/server/src/boot.test.ts` (add one test beside the existing trading-mode boot test)

**Interfaces:**
- Consumes: the existing trading-mode boot harness in `boot.test.ts` (its `startServer`/config/shared-container setup) and `readModuleConfig` reading `<stateDir>/modules.json`; `orderedMigrationSets`'s `module.dependency_missing` throw (Tasks 1–2); the `requires` graph (Task 3).
- Produces: proof that boot refuses `identity`-off + `workforce`-on before migrating — the tripable-today case (spec §4/§8).

- [ ] **Step 1: Locate the existing trading-mode boot test.** Read `boot.test.ts` around the trading-boot test (the block near `boot.test.ts:560-660` that asserts the migration journals and the mounted routes). Note the exact helpers it uses to build a trading config and state dir (the `WAITRON_STATE_DIR` mkdtemp, the shared-container admin URL, how it calls `startServer`). The new test mirrors that setup.

- [ ] **Step 2: Write the failing test.** Add a test that, using the SAME trading-config harness, writes a `modules.json` disabling `identity` (a `toggleable` module `workforce` depends on) into the state dir, then asserts `startServer(config)` rejects with `module.dependency_missing`. Skeleton (adapt the config/harness calls to match the names read in Step 1):

```typescript
  it("refuses a trading boot whose enabled set drops a dependency (identity off, workforce on)", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-depmissing-"));
    try {
      // identity is toggleable; disabling it while workforce stays enabled leaves workforce's
      // `persons` FK unsatisfiable. SP-1c must refuse this BEFORE applyMigrations (spec §4), not
      // fail mid-migration on a missing relation.
      await writeFile(
        join(stateDir, "modules.json"),
        JSON.stringify({ modules: { identity: false } }),
      );
      const config = /* the trading config used by the existing test, with WAITRON_STATE_DIR: stateDir */;
      await expect(startServer(config)).rejects.toMatchObject({
        code: "module.dependency_missing",
      });
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });
```

Ensure `writeFile`, `mkdtemp`, `rm`, `join`, `tmpdir` are imported (most already are at the top of `boot.test.ts`).

- [ ] **Step 3: Run to verify it fails first for the RIGHT reason.** Before Task 3's graph exists the refusal cannot fire — but Tasks 1–3 are already done, so run it now:

Run: `pnpm --filter @waitron/server test boot.test -t "refuses a trading boot"`
Expected: PASS (Tasks 1–3 supply the throw). To confirm the test is not vacuous, temporarily change the fixture to `{ modules: { payments: false } }` (payments is a leaf nothing requires) and re-run — it must then FAIL (no dependency dropped → boot proceeds), proving the assertion depends on the dropped-dependency condition. Restore to `{ identity: false }`.

- [ ] **Step 4: Prove the refusal precedes migration (negative control).** Confirm the default all-enabled boot still migrates all nine sets — the existing trading migration-journal test at `boot.test.ts:~644` is exactly this control and must stay green:

Run: `pnpm --filter @waitron/server test boot.test`
Expected: PASS — both the new refusal test and the existing all-enabled migration test green.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/boot.test.ts
git commit -s -m "test(server): boot refuses a dependency-incomplete enabled set before migrating"
```

---

### Task 5: Full gate + docs

**Files:**
- Modify: `docs/backlog.md` (mark SP-1c landed — in the LAND step, not before the PR)

- [ ] **Step 1: Run the whole-workspace gate**

Run: `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`
Expected: PASS. Then the coverage + guards the four-command gate omits:

Run: `pnpm --filter @waitron/module test:coverage && pnpm --filter @waitron/server test:coverage`
Expected: PASS at each package's thresholds.

- [ ] **Step 2: Confirm the tree-wide guards are green** (english-only + error reachability live in the root project, CLAUDE.md §4):

Run: `pnpm vitest run scripts/english-only.test.ts scripts/errors-reachable.test.ts`
Expected: PASS — `@waitron/module` stays english-only-clean (the `requires` values are module names + `"*"`), and `errors.ts` stays reachable from the barrel.

- [ ] **Step 3: Confirm no "every declared code is thrown" guard is now red.** Run the module package unfiltered (a filtered run skips cross-cutting suites, CLAUDE.md §2):

Run: `pnpm --filter @waitron/module test`
Expected: PASS — all four new codes are thrown in `module.ts`.

- [ ] **Step 4:** Backlog + PR are handled by `finish-branch` / `land-branch`, not here. Do not edit `docs/backlog.md` until the land step (the change that lands the work is written before it lands — CLAUDE.md §6).

---

## Self-Review

**Spec coverage:**
- §2 populate `requires` → Task 3. ✓
- §2/§5 resolve-validate-order rewrite → Task 2. ✓
- §4 dependency-presence tripable today → Task 2 (unit) + Task 4 (boot). ✓
- §6 four error codes → Task 1. ✓
- §7 pin `semver` → Task 2 Step 1. ✓
- §8 unit tests (pin repro, missing, cycle, incompatible, invalid, each by deletion) → Task 2 Steps 2/6; real-PG boot refusal → Task 4. ✓
- §8 graph-honesty guard → explicitly deferred to SP-2 in the spec; no task (correct). ✓
- §9 behaviour-preserving (pin holds, both modes) → Task 3 Steps 3–4. ✓
- Out of scope (schema-version gate, provisioning path, SP-1d, UI) → no tasks (correct). ✓

**Placeholder scan:** The only intentional adaptation point is Task 4 Step 2's `config` (the trading config from the existing test) — Step 1 instructs reading the exact harness first, because the trading-boot fixture's helper names are local to `boot.test.ts` and must be matched verbatim rather than guessed. All code steps carry real code.

**Type consistency:** `requires` shape `{ core?: string; modules?: Record<string, string> }` matches `module.ts`. Error param shapes in Task 1 match the throws in Task 2 (`{ module, requires }`, `{ modules }`, `{ module, dependency, required, actual }`, `{ module, dependency, range }`). `orderedMigrationSets` signature unchanged across Tasks 2–4. `mod` test helper extended consistently (optional `requires`).
