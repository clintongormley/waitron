# SP-2b — schema-version handshake + park gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the cross-node schema-skew window safe: a subscriber parks (never applies, never drops) a sync row whose owning module the source has migrated ahead of it, until the subscriber reboots and migrates.

**Architecture:** `/sync-api/hello` advertises each module's applied schema version (a boot snapshot). The subscriber threads the source's map + its own map + a `table→module` map into `applyBatch`, which parks a row when `sourceVersion[module] > subscriberVersion[module]`, reusing the existing at-least-once `deferred`-set → cursor-hold → redelivery machinery (a second park reason beside the `23503` FK-defer). Coarse per-module; no migration, no new error code.

**Tech Stack:** TypeScript, pnpm workspaces, Drizzle ORM, Vitest (unit + real-Postgres via Testcontainers), Hono (sync HTTP).

**Spec:** [docs/superpowers/specs/2026-09-05-module-sp2b-schema-version-gate-design.md](../specs/2026-09-05-module-sp2b-schema-version-gate-design.md) — read it alongside this plan.

## Global Constraints

- **Behaviour-preserving with no skew.** With equal versions (the normal case) nothing parks; a peer that serves no `moduleVersions` at all (a pre-SP-2b peer) disables the gate entirely. No migration, no grant, no schema change, no new error code. (spec §7, §9)
- **Reuse the park machinery unchanged in kind.** The version-park routes through the existing `deferred` set → `eligible`/`high` cursor-hold → redelivery (`packages/sync/src/apply.ts:224-233`), which is at-least-once/never-skip. Do NOT alter the cursor model. (spec §3)
- **Coarse per-module, applied-vs-applied.** Compare one `appliedSchemaVersion` (journal-row-count, `@waitron/migrations`) per module; park iff `(source[M] ?? 0) > (subscriber[M] ?? 0)`. A subscriber ahead never parks. (spec §4, §7.2)
- **Module identity is a `table→module` map built at the composition root** (`MODULE_BY_TABLE`), threaded into `applyBatch` — NOT a field on `EnrolledTable` (leave SP-2a's enrolment type + threading untouched). (spec §5, §7.3)
- **The environment gate still runs first, unchanged** (`apply.ts:126-145`) — a whole-batch refuse before any per-module version check. (spec §6, §9)
- **The version-park gets its OWN counter/telemetry**, distinct from the `23503` `deferred` count. (spec §3, §7.4)
- **Every commit `git commit -s`. Prove each guard by deletion.** Real-PG suites need `TESTCONTAINERS_RYUK_DISABLED=true`; `pnpm reap` if interrupted. (CLAUDE.md §4)
- **Gate before pushing:** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`, plus `pnpm --filter @waitron/sync test:coverage` and `pnpm --filter @waitron/server test:coverage`, plus the root guards. (CLAUDE.md §2)

---

## File Structure

**Modified:**
- `apps/server/src/modules.ts` — add `MODULE_BY_TABLE` beside `ALL_SYNC_ENROLMENTS`.
- `apps/server/src/boot.ts` — compute the per-module applied-version map once; inject into sync-api deps (source) and pull deps (subscriber); DRY the existing migrated-set loop through the new helper.
- `apps/server/src/sync-api.ts` — `SyncApiDeps.moduleVersions`; `/sync-api/hello` returns it.
- `packages/sync/src/pull.ts` — `SyncPullDeps.moduleVersions` (subscriber's own); parse the source's `moduleVersions` off `helloBody`; thread source + subscriber + `moduleByTable` into `applyBatch` opts.
- `packages/sync/src/apply.ts` — `ApplyBatchOptions` gains `sourceModuleVersions?`, `subscriberModuleVersions`, `moduleByTable`; the park gate; `ApplyBatchResult.versionParked`.
- Test files that build sync-api/pull deps in `apps/server` (thread the new fields).
- `docs/backlog.md`, `CLAUDE.md` — Task 5.

**Created (helper — location decided in Task 1):**
- A `moduleAppliedVersions(db, modules)` helper (apps/server) + its test.
- Real-PG park tests (extend `packages/sync/src/apply.gate.test.ts` or a new suite).

---

## Task 1: `MODULE_BY_TABLE` + `moduleAppliedVersions` helper

**Files:**
- Modify: `apps/server/src/modules.ts` (add `MODULE_BY_TABLE`)
- Create: `apps/server/src/module-versions.ts` (the helper) + `apps/server/src/module-versions.test.ts`
- Modify: `apps/server/src/boot.ts` (DRY the migrated-set loop through the helper)

**Interfaces:**
- Produces:
  - `const MODULE_BY_TABLE: ReadonlyMap<string, string>` (table → owning module name)
  - `async function moduleAppliedVersions(db: Database, modules: readonly WaitronModule[]): Promise<Record<string, number>>` — `{ m.name: appliedSchemaVersion(db, m.migrations) }` for each module.

- [ ] **Step 1: Write the failing test for `MODULE_BY_TABLE`** (`apps/server/src/module-versions.test.ts` or extend `modules.test.ts`):
```ts
import { describe, expect, it } from "vitest";
import { MODULE_BY_TABLE, ALL_SYNC_ENROLMENTS } from "./modules.js";

describe("MODULE_BY_TABLE", () => {
  it("maps every enrolled table to its owning module", () => {
    expect(MODULE_BY_TABLE.get("sales")).toBe("core");
    expect(MODULE_BY_TABLE.get("ticket_items")).toBe("core");
    expect(MODULE_BY_TABLE.get("persons")).toBe("identity");
    expect(MODULE_BY_TABLE.get("webauthn_credentials")).toBe("identity");
    expect(MODULE_BY_TABLE.get("payments")).toBe("payments");
    expect(MODULE_BY_TABLE.get("payment_policy")).toBe("payments");
  });
  it("covers exactly the assembled enrolment's tables", () => {
    expect([...MODULE_BY_TABLE.keys()].sort()).toEqual(ALL_SYNC_ENROLMENTS.map((e) => e.table).sort());
    expect(MODULE_BY_TABLE.size).toBe(ALL_SYNC_ENROLMENTS.length); // 22, no duplicate table
  });
});
```

- [ ] **Step 2: Run it, watch it fail** (`MODULE_BY_TABLE` not exported).

- [ ] **Step 3: Add `MODULE_BY_TABLE` to `apps/server/src/modules.ts`** (just after `ALL_SYNC_ENROLMENTS`):
```ts
/** table → owning-module name, built at the composition root (SP-2b). The apply gate resolves a
 * sync_log row's module by table name; it is a side map rather than a field on EnrolledTable so
 * SP-2a's enrolment type and its threading stay untouched (spec §5). */
export const MODULE_BY_TABLE: ReadonlyMap<string, string> = new Map(
  ALL_MODULES.flatMap((m) => (m.sync ?? []).map((e) => [e.table, m.name] as const)),
);
```

- [ ] **Step 4: Run it, watch it pass.** Prove by deletion: remove one module's `sync:` wiring temporarily → the coverage test fails on the missing table → restore.

- [ ] **Step 5: Write the failing test for `moduleAppliedVersions`** (real-PG — it reads drizzle journal tables). Mirror `apps/server`'s real-PG harness (`useTemplateDb({ template: "manifest" })`, the fully-migrated template):
```ts
// module-versions.test.ts (real-PG)
it("returns each module's applied schema version = its journal row count", async () => {
  const db = postgres.db();
  const versions = await moduleAppliedVersions(db, ALL_MODULES);
  // fully migrated → each equals expectedSchemaVersion(m.migrations) (journal head)
  for (const m of ALL_MODULES) {
    expect(versions[m.name]).toBe(expectedSchemaVersion(m.migrations, config.migrationsRoot));
    expect(versions[m.name]).toBeGreaterThan(0);
  }
});
```
(Import `expectedSchemaVersion` from `@waitron/migrations`; resolve the migrations root the way the existing boot/version tests do.)

- [ ] **Step 6: Implement `apps/server/src/module-versions.ts`:**
```ts
import { appliedSchemaVersion } from "@waitron/migrations";
import type { WaitronModule } from "@waitron/module";
import type { Database } from "@waitron/db";

/** Each module's APPLIED schema version — the drizzle-journal row count (@waitron/migrations), keyed by
 * module name. A boot snapshot: migrations run only at boot, so this is stable between reboots (spec §4).
 * MUST run auto-commit (not inside a transaction): appliedSchemaVersion's 42P01→0 catch poisons an
 * enclosing tx (boot.ts records this). */
export async function moduleAppliedVersions(
  db: Database,
  modules: readonly WaitronModule[],
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const m of modules) out[m.name] = await appliedSchemaVersion(db, m.migrations);
  return out;
}
```
(Sequential, not `Promise.all`: each call may hit 42P01 and must be its own statement on the auto-commit connection — matching how `boot.ts` runs the migrated-set loop today.)

- [ ] **Step 7: DRY boot's migrated-set loop.** In `apps/server/src/boot.ts` (~581-590), the reconcile loop computes `migrated` (a `Set` of names where `appliedSchemaVersion > 0`). Refactor to compute the version map once and derive the set from it:
```ts
const myModuleVersions = await moduleAppliedVersions(driftProbe, ALL_MODULES);
const migrated = new Set(Object.entries(myModuleVersions).filter(([, v]) => v > 0).map(([n]) => n));
```
Keep `myModuleVersions` in scope — Tasks 2/3 inject it into the sync deps. **Behaviour-preserving:** `reconcile` receives the identical `migrated` set; assert the existing boot/reconcile tests pass unchanged.

- [ ] **Step 8: Run to verify** (`pnpm --filter @waitron/server test module-versions modules`, real-PG env set) and the boot suite still green.

- [ ] **Step 9: Commit.**
```bash
git add apps/server/src/modules.ts apps/server/src/module-versions.ts apps/server/src/module-versions.test.ts apps/server/src/boot.ts
git commit -s -m "feat(server): MODULE_BY_TABLE + moduleAppliedVersions (SP-2b foundation)"
```

---

## Task 2: `/sync-api/hello` advertises `moduleVersions` (source side)

**Files:**
- Modify: `apps/server/src/sync-api.ts` (`SyncApiDeps.moduleVersions`; `/hello` body)
- Modify: `apps/server/src/boot.ts` (inject `myModuleVersions` into both `mountSyncApi` deps)
- Modify: `apps/server/src/sync-api.rls.test.ts` (assert `/hello` returns the map) + any test building `SyncApiDeps`

**Interfaces:**
- Consumes: `moduleAppliedVersions` output (Task 1), in scope in boot as `myModuleVersions`.
- Produces: `SyncApiDeps` gains `moduleVersions: Record<string, number>`; `GET /sync-api/hello` returns `{ nodeId, environment, membership, moduleVersions }`.

- [ ] **Step 1: Write the failing test** — extend `apps/server/src/sync-api.rls.test.ts` (or its hello test): a `/sync-api/hello` request (peer-authenticated) returns a body whose `moduleVersions` equals the deps' map (e.g. `{ core: N, ... }`). Build the deps with a known `moduleVersions` fixture and assert the JSON echoes it.

- [ ] **Step 2: Run it, watch it fail** (field absent).

- [ ] **Step 3: Implement.** In `apps/server/src/sync-api.ts`, add to `SyncApiDeps`:
```ts
  /** Each module's applied schema version, advertised on /hello for the subscriber's version gate
   * (SP-2b). A boot snapshot from moduleAppliedVersions(). */
  moduleVersions: Record<string, number>;
```
and change the `/sync-api/hello` handler's response:
```ts
return c.json({ nodeId: deps.nodeId, environment: deps.environment, membership, moduleVersions: deps.moduleVersions });
```

- [ ] **Step 4: Wire boot.** In `apps/server/src/boot.ts`, both `mountSyncApi(...)` calls (~1307, ~1326) gain `moduleVersions: myModuleVersions`.

- [ ] **Step 5: Fix any other test/site building `SyncApiDeps`** to include `moduleVersions` (grep `grep -rln "mountSyncApi\|SyncApiDeps" apps/server/src`). A `{}` or a small fixture is fine where the value is irrelevant.

- [ ] **Step 6: Run to verify** (`pnpm --filter @waitron/server test sync-api`) green.

- [ ] **Step 7: Commit.**
```bash
git add apps/server/src/sync-api.ts apps/server/src/boot.ts apps/server/src/*.test.ts
git commit -s -m "feat(sync-api): advertise per-module applied versions on /sync-api/hello (SP-2b)"
```

---

## Task 3: Subscriber threads source + own versions + `moduleByTable` into `applyBatch` (gate still inert)

**Files:**
- Modify: `packages/sync/src/pull.ts` (`SyncPullDeps`; `helloBody` parse; `applyBatch` opts)
- Modify: `packages/sync/src/apply.ts` (`ApplyBatchOptions` gains the three fields — declared, not yet used)
- Modify: `apps/server/src/boot.ts` (inject subscriber map + `MODULE_BY_TABLE` into `runSyncPull` deps)
- Modify: `packages/sync/src/pull.test.ts` + any apps/server test building `SyncPullDeps`

**Interfaces:**
- Produces:
  - `SyncPullDeps` gains `moduleVersions: Record<string, number>` (the subscriber's own) and `moduleByTable: ReadonlyMap<string, string>`.
  - `ApplyBatchOptions` gains `sourceModuleVersions?: Record<string, number>` (from `helloBody`; optional — absent for a pre-SP-2b peer), `subscriberModuleVersions: Record<string, number>`, `moduleByTable: ReadonlyMap<string, string>`.
  - `syncPullOnce` parses `helloBody.moduleVersions` and passes all three into `applyBatch` opts.

- [ ] **Step 1: Write the failing test** (`packages/sync/src/pull.test.ts`): with a fake `http` returning a `/hello` body carrying `moduleVersions: { core: 5 }`, `syncPullOnce` calls the injected `applyBatch` with opts where `sourceModuleVersions.core === 5`, `subscriberModuleVersions` equals the deps map, and `moduleByTable` is the deps map. (The gate does nothing yet — this pins the WIRING.)

- [ ] **Step 2: Run it, watch it fail.**

- [ ] **Step 3: Implement `apply.ts` opts** (declared, unused this task): add to `ApplyBatchOptions`:
```ts
  /** The SOURCE's per-module applied versions from /hello. Absent for a pre-SP-2b peer → the version
   * gate is disabled (behaviour-preserving, spec §4). */
  sourceModuleVersions?: Record<string, number>;
  /** THIS subscriber's own per-module applied versions (boot snapshot). */
  subscriberModuleVersions: Record<string, number>;
  /** table → owning module, for resolving a row's module in the gate (spec §5). */
  moduleByTable: ReadonlyMap<string, string>;
```

- [ ] **Step 4: Implement `pull.ts`.** Add to `SyncPullDeps`:
```ts
  /** THIS subscriber's own per-module applied versions (boot snapshot), for the version gate (SP-2b). */
  moduleVersions: Record<string, number>;
  /** table → owning module (from the composition root), for the version gate (SP-2b). */
  moduleByTable: ReadonlyMap<string, string>;
```
Widen the `helloBody` parse:
```ts
const helloBody = JSON.parse(await hello.text()) as {
  environment: string; membership?: unknown; moduleVersions?: Record<string, number>;
};
```
and thread into the `applyBatch` opts (beside `sourceEnvironment`):
```ts
const result = await applyBatch(deps.localDb, rows, {
  subscriberId: deps.subscriberId,
  localEnvironment: deps.localEnvironment,
  sourceEnvironment,
  lane,
  enrolments: deps.enrolments,
  sourceModuleVersions: helloBody.moduleVersions,
  subscriberModuleVersions: deps.moduleVersions,
  moduleByTable: deps.moduleByTable,
});
```

- [ ] **Step 5: Wire boot.** `runSyncPull({...})` deps (~1390-1406) gain `moduleVersions: myModuleVersions` and `moduleByTable: MODULE_BY_TABLE` (import `MODULE_BY_TABLE` from `./modules.js`).

- [ ] **Step 6: Fix other `SyncPullDeps` builders** (grep `grep -rln "runSyncPull\|syncPullOnce\|SyncPullDeps" apps/server/src packages/sync/src`) — the apps/server e2e sync tests and sync's own pull tests build these deps; add `moduleVersions` (a `{}` or fixture) and `moduleByTable` (`new Map()` where the gate is irrelevant). Since `applyBatch`'s new opts include a required `subscriberModuleVersions` + `moduleByTable`, every `applyBatch` caller in tests also needs them — grep `grep -rln "applyBatch" packages/sync/src` and add `subscriberModuleVersions: {}` + `moduleByTable: new Map()` (gate inert with an empty source map).

- [ ] **Step 7: Run to verify** (`pnpm --filter @waitron/sync test:coverage`, `pnpm --filter @waitron/server test sync`) green. Behaviour unchanged (gate not implemented).

- [ ] **Step 8: Commit.**
```bash
git add packages/sync/src/pull.ts packages/sync/src/apply.ts apps/server/src/boot.ts packages/sync/src/*.test.ts apps/server/src/*.test.ts
git commit -s -m "feat(sync): thread source/subscriber module versions + table→module map into applyBatch (SP-2b wiring)"
```

---

## Task 4: The park gate + `versionParked` counter + tests (the behaviour)

**Files:**
- Modify: `packages/sync/src/apply.ts` (the gate + `ApplyBatchResult.versionParked`)
- Modify/extend: `packages/sync/src/apply.gate.test.ts` (real-PG park tests) + `packages/sync/src/pull.ts` (`SyncPullResult`/drain: confirm no change needed)

**Interfaces:**
- Consumes: `opts.sourceModuleVersions`, `opts.subscriberModuleVersions`, `opts.moduleByTable` (Task 3); the `DISPATCH`/`settleOrPark`/`deferred`/cursor machinery (existing).
- Produces: `ApplyBatchResult` gains `versionParked: number`; a row parks (held below cursor, redelivered) when its module's source version exceeds the subscriber's.

- [ ] **Step 1: Write the failing real-PG test** in `apply.gate.test.ts`. Fixture: a module whose subscriber-side schema LACKS a column the source's row carries — construct `sourceModuleVersions = { <mod>: 2 }`, `subscriberModuleVersions = { <mod>: 1 }`, `moduleByTable` mapping the row's table → `<mod>`. Assert: (a) the row is NOT applied (the target row is absent), (b) `result.versionParked === 1` (and `applied === 0`), (c) the `(subscriber, origin, lane)` cursor did NOT advance past the parked seq. Then a second batch with `subscriberModuleVersions = { <mod>: 2 }` (subscriber caught up) → the row applies, cursor advances. **Prove-by-deletion of the corruption it prevents:** with the gate disabled (or `sourceModuleVersions` omitted), the ahead-version row applies and the new column is silently dropped — assert that column is null/absent on the applied row — demonstrating exactly the hazard the gate closes. (Use a real enrolled table + a real "newer" column, or a purpose-built fixture table enrolled for the test.)

- [ ] **Step 2: Run it, watch it fail** (no gate).

- [ ] **Step 3: Implement the gate in `apply.ts`.** Add `versionParked` to `ApplyBatchResult`:
```ts
  /** Rows parked because the SOURCE's schema version for the row's module is ahead of THIS
   * subscriber's — held below the cursor, redelivered after this node reboots and migrates (SP-2b).
   * Distinct from `deferred` (23503 FK-park). */
  versionParked: number;
```
Add a pure predicate and apply it in the main pass BEFORE `tryApplyRow`. When the source map is absent (pre-SP-2b peer) the gate is disabled:
```ts
const isVersionAhead = (row: SyncLogRow): boolean => {
  if (opts.sourceModuleVersions === undefined) return false; // pre-SP-2b peer: gate disabled
  const mod = opts.moduleByTable.get(row.table);
  if (mod === undefined) return false; // unknown table falls through to the existing table_not_enrolled throw
  return (opts.sourceModuleVersions[mod] ?? 0) > (opts.subscriberModuleVersions[mod] ?? 0);
};
```
In the main pass, insert this **immediately before the existing `const outcome = await tryApplyRow(...)` line** — i.e. AFTER the `if (row.seq <= cur) { … continue; }` already-applied cursor-skip (an already-applied row must not re-park) and BEFORE the apply attempt:
```ts
if (isVersionAhead(row)) {
  if (!versionParkedSeqs.has(row.seq)) versionParked += 1;   // count once
  versionParkedSeqs.add(row.seq);
  bucket(row.originId).deferred.add(row.seq);                 // hold the cursor below it (reuse the machinery)
  continue;                                                    // do NOT push to `parked` — the retry pass cannot change a version verdict within a batch (spec §3)
}
const outcome = await tryApplyRow(subscriberDb, row, DISPATCH);
if (!settleOrPark(row, outcome)) parked.push(row);
```
Initialise `let versionParked = 0;` and `const versionParkedSeqs = new Set<bigint>();` beside the existing counters. Return `{ applied, deferred, versionParked }`. **Do not** run version-parked rows through the retry pass (their verdict is fixed for the batch). The cursor-advance (`eligible`/`high`) already holds below every seq in `deferred`, so a version-parked seq is held for free.

- [ ] **Step 4: Run to verify** the new test passes and the prove-by-deletion demonstrates the dropped column without the gate. Then the whole gate suite.

- [ ] **Step 5: Add the remaining behaviour tests:**
  - **Subscriber ahead / equal → no park:** `sourceModuleVersions = { <mod>: 1 }`, `subscriberModuleVersions = { <mod>: 2 }` (and `=1`) → the row applies, `versionParked === 0`.
  - **Older-peer tolerance:** `sourceModuleVersions` omitted → gate disabled, row applies, `versionParked === 0` (behaviour identical to pre-SP-2b).
  - **Mixed batch:** two modules, one ahead (parks) one equal (applies) → the equal-module rows apply, the ahead-module rows park, and the cursor holds below the LOWEST parked seq (so an applied row with a higher seq than a parked row does not advance the cursor past it — assert the cursor value). This pins the cross-module cursor-safety.
  - **The environment gate still precedes it:** an environment mismatch still throws `sync.peer_environment_mismatch` before any version check (assert the whole batch is refused regardless of versions).

- [ ] **Step 6: Confirm the drain loop is unaffected.** Read `runSyncPull`'s drain (`pull.ts:199-218`): a fully version-parked page has `advanced === false` (cursor held) → the drain breaks and yields, exactly as for an all-`23503`-parked page. Add a note/assertion if a pull-level test is cheap; otherwise rely on the drain's existing `advanced` guard (no code change needed).

- [ ] **Step 7: Fix any `applyBatch` result consumers** that destructure the result (grep `grep -rn "\.deferred\b" packages/sync/src apps/server/src` and the `ApplyBatchResult`/`SyncPullResult` shape) — `versionParked` is additive, but confirm nothing pins the result to exactly `{applied, deferred}`.

- [ ] **Step 8: Commit.**
```bash
git add packages/sync/src/apply.ts packages/sync/src/apply.gate.test.ts packages/sync/src/*.ts
git commit -s -m "feat(sync): version-park gate — park a row whose module the source migrated ahead of us (SP-2b)"
```

---

## Task 5: Docs — backlog SP-2 complete; CLAUDE.md if warranted

**Files:**
- Modify: `docs/backlog.md`, `CLAUDE.md`

- [ ] **Step 1: Backlog.** Update the SP-2b row (currently "next") to describe it as landing on this branch: the schema-version handshake + park gate is built (the anti-silent-corruption gate for the rolling-migration skew window); the enabled-set pull filter stays deferred (cursor-unsafe today, no live case — receipt in spec §2). With SP-2a + SP-2b, note **SP-2 (sync inversion) is complete**; SP-3 (fiscal as a module) is the next module slice; SP-4 waits for B3.2. Match the house voice.

- [ ] **Step 2: CLAUDE.md (only if it earns a durable lesson).** If the implementation surfaced a reusable trap (e.g. the cursor-safety reasoning about source-side exclusion vs subscriber-side parking), add a §3/§4 note. Otherwise skip — do not pad the file. The spec is the durable record of the design.

- [ ] **Step 3: Confirm guards.** `pnpm vitest run scripts/english-only.test.ts scripts/errors-reachable.test.ts scripts/module-graph-honesty.test.ts` green; `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` green (no tenant-scoped table moved).

- [ ] **Step 4: Commit.**
```bash
git add docs/backlog.md CLAUDE.md
git commit -s -m "docs(backlog): SP-2b schema-version gate built; SP-2 complete"
```

---

## Final verification (before finish-branch)

- [ ] `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test` — green.
- [ ] `pnpm --filter @waitron/sync test:coverage`, `pnpm --filter @waitron/server test:coverage` — green (real-PG env set; `pnpm reap` if interrupted).
- [ ] Root guards green (`scripts/*.test.ts` — english-only, errors-reachable, module-graph-honesty, guarded-teardowns).
- [ ] Behaviour-preserving confirmation: with no version skew (equal maps), every pre-existing sync + boot + e2e suite passes unchanged — the gate never fires in the normal case.
- [ ] Grep: no new migration under `packages/*/drizzle`, no new error code in any `errors.ts`, no `sync_log` column added (`git diff main --stat -- '**/drizzle/**'` empty).
