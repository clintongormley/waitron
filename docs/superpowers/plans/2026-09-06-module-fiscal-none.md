# `fiscal-none` Module Implementation Plan

> **2026-09-12:** this document refers to `.github/instructions/waitron.instructions.md`, which has
> been deleted. Its rules moved to `docs/developers/conventions-ui.md`, `conventions-data.md` and
> `testing-guide.md` — sweep those instead. The original is still readable with
> `git show f5941462:.github/instructions/waitron.instructions.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second fiscal module (`@waitron/fiscal-none`, the no-regime / UK case) that fills the `FiscalBackend` slot with a backend recording nothing, proving the fiscal slot is genuinely swappable, and complete the runtime-duty and provisioning-input seats SP-3c deferred so `apps/server` imports no regime package.

**Architecture:** Fiscal is an exclusive slot (`m.fiscal !== undefined`); exactly one enabled member fills it, selected by the territory and persisted to `modules.json` at provisioning. The Veri\*Factu descriptor is renamed `fiscal → fiscal-verifactu`. The runtime submission pass and the AEAT transport move behind a `FiscalContribution.drain` seat (transport relocated into `@waitron/fiscal-verifactu`); the provisioning-time certificate moves behind a `FiscalContribution.provisioningSecret` seat. `fiscal-none` implements both as no-ops.

**Tech Stack:** TypeScript (ESM, NodeNext), pnpm workspace, Drizzle ORM, Vitest, PGlite (hermetic) + Testcontainers (real Postgres 18), Hono (server).

**Spec:** [docs/superpowers/specs/2026-09-06-module-fiscal-none-design.md](../specs/2026-09-06-module-fiscal-none-design.md)

## Global Constraints

- **Every commit is signed:** `git commit -s`. CI's `dco` job walks the whole PR range.
- **The gate** (run before every commit that changes code): `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`. CI's shards run `test:coverage`, not `test` — before calling a package green run `pnpm --filter <pkg> test:coverage`.
- **Coverage bars:** `98/98/98/95` (statements/lines/functions/branches) on `verifactu`, `fiscal-verifactu`, `core`, `db`, `sync`, `payments`; `90/90/85/85` floor everywhere else, including the new `@waitron/fiscal-none` and `@waitron/module`, `@waitron/composition`, `apps/server`. The root project keeps the high bar. `scripts/coverage-thresholds.test.ts` pins which package holds which bar — a new package needs no edit unless it must hold the high bar (it does not).
- **Error codes name the DOMAIN CONCEPT, never the package**, and are never renamed once shipped — EXCEPT this slice renames `setup.aeat_cert_required → setup.provisioning_secret_required` outright (owner decision 2026-09-06, pre-production, no deprecation). Every file throwing a code imports its registry (`import "./errors.js"`).
- **No new CORE table.** `fiscal-none` owns no domain tables; its migration set is empty.
- **Real Postgres (Testcontainers) is required** for anything about privileges, RLS as the deployment role, or concurrency; PGlite is a superuser and RLS-bypassing, so a privilege/isolation assertion on PGlite is a false pass. `TESTCONTAINERS_RYUK_DISABLED=true` must be set locally or container suites hang. Run `pnpm reap` if a prior run was interrupted.
- **Comments carry the invariant and the non-obvious why, never the history** (CLAUDE.md §1). The receipt lives in the commit/PR.
- **Behaviour-preserving slices (S1, S2, S3) must keep the existing suites GREEN** — do not rewrite a behavioural assertion to match moved code; update mocks/imports only.
- **Contribution id `"verifactu"` and the migration table `__drizzle_migrations_fiscal` never change** (immutable-row identity; decoupled `name`/`table`).

---

## File Structure

**New package `packages/fiscal-none/`:**
- `package.json`, `tsconfig.json`, `vitest.config.ts`, `drizzle.config.ts` — workspace boilerplate mirroring a tiny existing package (`packages/workforce-es` is the closest small module).
- `drizzle/meta/_journal.json` — an empty migration journal (no SQL files).
- `src/index.ts` — barrel: `FISCAL_NONE_SLOT`, `FISCAL_NONE_MIGRATIONS` (if a constant is used), and errors side-effect if any.
- `src/backend.ts` — `NoneBackend implements FiscalBackend`.
- `src/slot.ts` — `FISCAL_NONE_SLOT: FiscalContribution`.
- `src/*.test.ts` — colocated unit tests.

**Modified:**
- `packages/fiscal/src/contribution.ts` — add `drain`, `FiscalDutyDeps`, `FiscalDutyLog`, `provisioningSecret` to `FiscalContribution`; export the new types from `index.ts`.
- `packages/fiscal/src/backend.ts` — remove `drain`/`reconcile` from `FiscalBackend`; remove now-unused types if any.
- `packages/fiscal/src/testing/fake-backend.ts` — remove `FakeFiscalBackend.drain`/`reconcile`.
- `packages/fiscal-verifactu/src/slot.ts` — `FISCAL_SLOT` gains `drain` + `provisioningSecret`.
- `packages/fiscal-verifactu/src/aeat-transport.ts` — NEW home of the relocated transport (from `apps/server`).
- `packages/fiscal-verifactu/src/provisioning-secret.ts` — NEW home of cert validate/seal (from `apps/server/src/aeat-credential.ts`).
- `packages/fiscal-verifactu/src/backend.ts` — remove the `drain`/`reconcile` methods (interface no longer declares them); keep the standalone `drain`/`reconcile` functions.
- `packages/fiscal-verifactu/package.json` — add `@waitron/credentials` dependency.
- `packages/composition/src/modules.ts` — rename `fiscal → fiscal-verifactu`; add `fiscal-none` descriptor.
- `packages/migrations/migrations.manifest.json` — rename entry `fiscal → fiscal-verifactu` (name only); add `fiscal-none`.
- `packages/module/src/config.ts` — slot-aware `disabledProvisionOnly` split; a `fiscalSlotMembers` helper.
- `packages/provisioning/src/fiscal-modules.ts` — add the `GB-…` territory.
- `apps/server/src/aeat-transport.ts` — DELETED (moved).
- `apps/server/src/aeat-credential.ts` — DELETED (moved).
- `apps/server/src/boot.ts` — call `enabledFiscal.drain(...)`; drop the `@waitron/fiscal-verifactu` + `@waitron/verifactu` imports.
- `apps/server/src/setup-api.ts` — ask the contribution's `provisioningSecret` seat; write `modules.json`.
- `apps/server/src/provision.ts` — slot-aware gate; derive + write the fiscal-slot `modules.json`.
- `packages/provisioning/src/bin.ts` — write the fiscal-slot `modules.json` (CLI path).
- `apps/server/src/errors.ts` — rename the cert code.
- `scripts/module-seams.test.ts` — empty `DEFERRED_RUNTIME_PASS`; extend the territory/slot check.
- `packages/composition/src/composition.test.ts` — slot listing + name pins.
- `CLAUDE.md` §3 — the two new rules.

---

## Task 1 (S0): Scaffold `@waitron/fiscal-none` with an empty migration set, prove it migrates clean

De-risks the spec's one feasibility unknown (§6.2) before any other work.

**Files:**
- Create: `packages/fiscal-none/package.json`, `tsconfig.json`, `vitest.config.ts`, `drizzle.config.ts`, `src/index.ts`, `drizzle/meta/_journal.json`
- Test: `packages/fiscal-none/src/migrations.test.ts`

**Interfaces:**
- Produces: the package `@waitron/fiscal-none` resolvable in the workspace; an empty drizzle migration set at `packages/fiscal-none/drizzle`.

- [ ] **Step 1: Copy the boilerplate from `packages/workforce-es`.** Read `packages/workforce-es/package.json`, `tsconfig.json`, `vitest.config.ts`, `drizzle.config.ts` and reproduce them for `fiscal-none`, changing the name to `@waitron/fiscal-none`, the drizzle table to `__drizzle_migrations_fiscal_none`, and stripping any workforce-es-specific schema/vocabulary. `package.json` `dependencies`: `@waitron/fiscal`, `@waitron/db`, `@waitron/shared` (add `@waitron/migrations` only if a constant needs it). `singleFork` must be preserved in `vitest.config.ts` (CLAUDE.md §4 — v8 coverage under-merges without it).

- [ ] **Step 2: Create the empty migration journal.** `packages/fiscal-none/drizzle/meta/_journal.json`:

```json
{ "version": "7", "dialect": "postgresql", "entries": [] }
```

No `.sql` files. (Confirm the `version`/`dialect` against an existing `packages/*/drizzle/meta/_journal.json` header and match it.)

- [ ] **Step 2b: Add the migrations constant.** `packages/fiscal-none/src/migrations.ts`, mirroring `packages/workforce-es/src/migrations.ts` exactly (read it first for the precise shape):

```ts
import { fileURLToPath } from "node:url";

/** The empty migration set: a journal with zero entries, so this applies as a no-op. */
export const FISCAL_NONE_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_fiscal_none",
} as const;
```

- [ ] **Step 3: Write the failing test** — prove an empty set migrates clean on top of core. `packages/fiscal-none/src/migrations.test.ts`, mirroring `packages/workforce-es/src/migrations.test.ts` (read it for the exact `usePgliteDb`/`CORE_MIGRATIONS` names and call shape — do NOT use `runMigrations`/`resolveMigrationsFolder`; neither is exported from the package barrels):

```ts
import { describe, expect, it } from "vitest";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { CORE_MIGRATIONS } from "@waitron/db"; // confirm the exact export name against workforce-es's test
import { FISCAL_NONE_MIGRATIONS } from "./migrations.js";

describe("@waitron/fiscal-none empty migration set", () => {
  const db = usePgliteDb({ migrations: [CORE_MIGRATIONS, FISCAL_NONE_MIGRATIONS] });
  it("migrates clean with zero migrations", () => {
    // usePgliteDb runs the migrations in beforeAll; reaching the test body means the empty set
    // applied as a no-op with no error. Assert the tracking table exists and is empty.
    expect(db()).toBeDefined();
  });
});
```

Match `usePgliteDb`'s real option shape and the core-migrations import to what `workforce-es/src/migrations.test.ts` actually does — that is the canonical pattern and the source of truth for symbol names.

- [ ] **Step 4: Run it.** `pnpm --filter @waitron/fiscal-none test migrations` (Testcontainers not needed; PGlite via `usePgliteDb`) — Expected: PASS (an empty drizzle set is a no-op — confirmed feasible: `resolveExistingMigrationsFolder` guards only on `meta/_journal.json` existence, and a `{ entries: [] }` journal drizzle reads as zero migrations). **If it FAILS** with a drizzle error about the journal, STOP and report: the fallback (relax `WaitronModule.migrations` to optional for a slot-only module — a contract change) needs owner sign-off before proceeding.

- [ ] **Step 5: Run the package lint/typecheck.** `pnpm --filter @waitron/fiscal-none lint typecheck` — Expected: PASS. The coverage FLOOR is not asserted for a scaffold with one migration test; it is met once the backend + slot land (Tasks 6–7). `coverage-thresholds.test.ts` auto-discovers the package and applies the floor from the copied `vitest.config.ts` — no pin edit needed.

- [ ] **Step 6: Commit.** `git add packages/fiscal-none && git commit -s -m "feat(fiscal-none): scaffold the package with an empty migration set"`

---

## Task 2 (S1): Rename the Veri\*Factu descriptor `fiscal → fiscal-verifactu`

Behaviour-preserving. Only the logical module `name` changes; the contribution id (`"verifactu"`) and the migration table (`__drizzle_migrations_fiscal`) do NOT (§3.1). **The blast radius is wide** — the `name` is also written into the provisioning seed action (`venue-plan.ts:185` sets `module: m.name`) and is the migrated-set name, so many suites assert the literal `"fiscal"`. This is NOT a 3-file change; the Step-1 grep is authoritative and the Step-4 whole-workspace run is the gate.

**Files:**
- Modify: `packages/composition/src/modules.ts` (descriptor `name` + `migrations.name`), `packages/migrations/migrations.manifest.json` (`name` only, keep `table`/`from`), `packages/composition/src/composition.test.ts` (the slot listing AND the `m.name === "fiscal"` lookups in the backup/vocabulary/provisioning blocks — several, not two)
- Modify (name-asserting suites — verify each with the Step-1 grep; the reviewer found these): `packages/provisioning/src/{venue-apply.test.ts, venue-apply.node-privilege.rls.test.ts, cli.test.ts, instance-plan.test.ts, status-command.test.ts, instance-apply.rls.test.ts}`, `apps/server/src/{setup-api.test.ts, provision-till.test.ts, restore-gate.test.ts, restore-command.test.ts, restore.test.ts, restore-fiscal-e2e.rls.test.ts}`
- LEAVE unchanged (test-local `mod("fiscal")` fixtures, not the descriptor name): `packages/module/src/{config,module}.test.ts`, `packages/module/src/testing/fake-module.ts`

**Interfaces:**
- Produces: `ALL_MODULES` member with `name: "fiscal-verifactu"`; manifest entry `{ name: "fiscal-verifactu", table: "__drizzle_migrations_fiscal", from: "../fiscal-verifactu/drizzle" }`.

- [ ] **Step 1: Find every consumer of the module name.** Run:

```bash
grep -rn '"fiscal"' packages apps scripts --include='*.ts' | grep -v node_modules
grep -rn 'name === "fiscal"\|=== "fiscal"\|"fiscal":' packages apps scripts --include='*.ts' --include='*.json' | grep -v node_modules
```

Classify each hit: the module NAME (rename it) vs the concept/word `fiscal` (leave: error domains `fiscal.*`, the `english-only.ts` base-list word, the `fiscal` SEAT key on the descriptor, `@waitron/fiscal` package name, directory names). Only the descriptor `name`, the manifest `name`, and name-equality lookups change.

- [ ] **Step 2: Rename in `modules.ts` and the manifest.** In `packages/composition/src/modules.ts`, the fiscal descriptor's `name: "fiscal"` → `name: "fiscal-verifactu"` (leave `migrations.table` and `migrations.name`… note: `migrations.name` must equal the module `name` per the contract, so it becomes `"fiscal-verifactu"` too; only `migrations.table` stays `__drizzle_migrations_fiscal`). In `migrations.manifest.json`, the entry's `"name"` → `"fiscal-verifactu"`, `"table"` unchanged, `"from"` unchanged (`"../fiscal-verifactu/drizzle"`).

- [ ] **Step 3: Update the composition pins.** In `packages/composition/src/composition.test.ts`, the "lists the manifest's module names in order" and "exactly one module fills the fiscal slot" assertions now expect `"fiscal-verifactu"`. The `orderedMigrationSets(ALL_MODULES)` = `manifestSets()` pin holds because both changed together.

- [ ] **Step 4: Run the composition + migrations gate to verify green.** `pnpm --filter @waitron/composition test:coverage && pnpm --filter @waitron/migrations test:coverage` — Expected: PASS. Then the whole workspace, because the name is a value more than one suite asserts (CLAUDE.md §2): `pnpm test`. Expected: PASS (behaviour-preserving; `MODULE_BY_TABLE` now maps fiscal tables to `"fiscal-verifactu"`, consistently on every node since all read `ALL_MODULES`).

- [ ] **Step 5: Base-to-tip doc/comment sweep** (CLAUDE.md §1). Grep docs and comments that call the module `"fiscal"` as its NAME (not the concept):

```bash
grep -rn 'module.*"fiscal"\|"fiscal" module\|`fiscal` module' docs .github packages apps --include='*.md' --include='*.ts' | grep -v node_modules
```

Update `.github/instructions/waitron.instructions.md`, README paraphrases, and touched-file comments where they name the module. Do not sweep unrelated files.

- [ ] **Step 6: Commit.** `git add -A && git commit -s -m "refactor(modules): rename the fiscal descriptor fiscal -> fiscal-verifactu (name only)"`

---

## Task 3 (S2): Add the drain seat, relocate the AEAT transport, rewire `boot.ts`

**This task is ONE green unit by necessity.** Moving `aeat-transport.ts` out of `apps/server` dangles the import in `aeat-credential.ts` (which imports `CertKind`/`isCertKind` from it) and in `boot.ts` (which imports `drain` + the transport). Adding `FiscalContribution.drain` as a required method breaks `FISCAL_SLOT` until it is implemented, which needs the relocated transport. So all of it lands together, and `aeat-credential.ts` is TEMPORARILY added to the seams allowlist (it now reaches the regime for `CertKind`) until Task 5 moves it too.

**Files:**
- Modify: `packages/fiscal/src/contribution.ts` (+ `index.ts`), `packages/fiscal/package.json` (dep `@waitron/credentials`)
- Create (moved): `packages/fiscal-verifactu/src/aeat-transport.ts` + its `.test.ts` (from `apps/server/src/`)
- Modify: `packages/fiscal-verifactu/src/slot.ts` (+ `index.ts`), `packages/fiscal-verifactu/package.json` (dep `@waitron/credentials`)
- Modify: `apps/server/src/aeat-credential.ts` (import `CertKind`/`isCertKind` from `@waitron/fiscal-verifactu`), `apps/server/src/boot.ts`, `scripts/module-seams.test.ts`
- Test: `packages/fiscal/src/contribution.test.ts`, `packages/fiscal-verifactu/src/slot.test.ts`

**Interfaces:**
- Produces:

```ts
// @waitron/fiscal contribution.ts
import type { KeyRing } from "@waitron/credentials";
import type { Database, DeploymentEnvironment } from "@waitron/db";
import type { DrainResult } from "./backend.js";

/** A minimal generic log sink so a regime's duty need not import apps/server's Logger. */
export type FiscalDutyLog = (level: "info" | "warn" | "error", event: string, fields?: Record<string, unknown>) => void;

/** What a host injects to run one runtime submission pass. The module owns its transport; the host
 * owns the vault ring, the deployment identity, and the retry cadence. */
export interface FiscalDutyDeps {
  readonly db: Database;
  readonly ring: KeyRing;
  readonly environment: DeploymentEnvironment;
  readonly skipRetryMs: number;
  readonly log?: FiscalDutyLog;
}

export interface FiscalContribution {
  readonly id: string;
  makeBackend(deps: FiscalBackendDeps): FiscalBackend;
  /** One runtime submission pass. A regime with nothing to submit (id "none") returns the empty
   * DrainResult. The sale-path backend (makeBackend) never contacts an authority; this does. */
  drain(deps: FiscalDutyDeps, now: Date): Promise<DrainResult>;
}
```

- [ ] **Step 1: Add `@waitron/credentials` to `@waitron/fiscal` and `@waitron/fiscal-verifactu` `package.json`** (workspace `*`). Confirm no cycle: `@waitron/credentials` depends on neither (verify its `package.json`).

- [ ] **Step 2: Add the drain seat to `@waitron/fiscal`.** Add `FiscalDutyLog`, `FiscalDutyDeps`, and the required `drain` method to `contribution.ts` (as above); export the two types from `index.ts`. Write `packages/fiscal/src/contribution.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { FiscalContribution } from "./contribution.js";
describe("FiscalContribution.drain contract", () => {
  it("a contribution can expose an empty drain pass", async () => {
    const c: Pick<FiscalContribution, "id" | "drain"> = {
      id: "test",
      drain: async () => ({ nextDueAt: null, batchesSent: 0, recordsSubmitted: 0, recordsAccepted: 0, recordsHalted: 0, incidentsRaised: 0, skipped: [] }),
    };
    expect(await c.drain({} as never, new Date())).toMatchObject({ nextDueAt: null });
  });
});
```

Run `pnpm --filter @waitron/fiscal test contribution` — PASS. (`@waitron/fiscal` builds green on its own; the regime consumer is fixed in the same task below, so do NOT run the whole workspace between steps here.)

- [ ] **Step 3: Move `aeat-transport.ts` + its test into the regime.** `git mv apps/server/src/aeat-transport.ts packages/fiscal-verifactu/src/aeat-transport.ts` and `git mv` the `.test.ts`. Rewrite the transport's imports:
  - `DeploymentEnvironment` — from `@waitron/db` (not `./config.js`).
  - `readCredential` — inline: `withTenant(db, tenantId, (tx) => getCredential(tx, ring, { tenantId, purpose: "fiscal.aeat" }))`; import `getCredential`, `KeyRing` from `@waitron/credentials`, `withTenant` from `@waitron/db`.
  - `codeOf`/`Logger` — replace the `closeAll` failure logging with the generic `FiscalDutyLog` (`@waitron/fiscal`); for the code use `isAppError(error) ? error.code : "unknown"` (`@waitron/shared`).
  - Keep `CertKind`, `isCertKind`, `certMaterialFrom`, `readCertMaterial`, `aeatEndpointFor`, `mtlsFetch`, `aeatClientResolver` intact — only imports change. Export `CertKind`/`isCertKind` from `packages/fiscal-verifactu/src/index.ts` (so `apps/server/src/aeat-credential.ts` can still reach them until Task 5).

- [ ] **Step 4: Fix `aeat-credential.ts`'s dangling import.** In `apps/server/src/aeat-credential.ts`, change `import { isCertKind, type CertKind } from "./aeat-transport.js"` to `from "@waitron/fiscal-verifactu"`. This is temporary (Task 5 moves the whole file into the regime).

- [ ] **Step 5: Run the moved transport test, expect PASS.** `pnpm --filter @waitron/fiscal-verifactu test aeat-transport` — behaviour-preserving; only imports moved. Fix paths until green.

- [ ] **Step 6: Write the failing `FISCAL_SLOT.drain` test** in `packages/fiscal-verifactu/src/slot.test.ts`. Read `packages/fiscal-verifactu/src/drain.test.ts` for the real `db`/vault fixtures (`usePgliteDb` or the real-PG harness, `CORE_MIGRATIONS`+`FISCAL_MIGRATIONS`, and the existing ring/vault helper — do NOT invent `createPgliteDb`/`runMigrations`/`fakeKeyRing`; use the exact helpers `drain.test.ts` uses). Assert a pass with no due work returns zeros and builds no transport:

```ts
it("FISCAL_SLOT.drain returns the empty result when nothing is due", async () => {
  // db migrated to the full manifest, empty envios/registros
  const result = await FISCAL_SLOT.drain({ db: db(), ring: theRing, environment: "preproduction", skipRetryMs: 300_000 }, new Date());
  expect(result.batchesSent).toBe(0);
  expect(result.nextDueAt).toBeNull();
});
```

- [ ] **Step 7: Implement `FISCAL_SLOT.drain`** in `slot.ts` (the `makeBackend` line is unchanged):

```ts
import { drain as runDrain } from "./drain.js";
import { aeatClientResolver, aeatEndpointFor, mtlsFetch } from "./aeat-transport.js";
// FISCAL_SLOT gains:
drain: async ({ db, ring, environment, skipRetryMs, log }, now) => {
  const resolver = aeatClientResolver({ db, ring, endpointFor: aeatEndpointFor(environment), fetchFor: mtlsFetch }, log);
  try {
    return await runDrain({ db, resolveClient: resolver.resolve, skipRetryMs, environment }, now);
  } finally {
    await resolver.closeAll();
  }
},
```

`Entorno` (`runDrain`'s `environment`) and `DeploymentEnvironment` (`aeatEndpointFor`'s) are the SAME union `"production" | "preproduction"` (verified: `registro-row.ts` `Entorno` == `@waitron/db` `DeploymentEnvironment`) — **no cast needed**. The transport's log parameter is already `FiscalDutyLog`-shaped after Step 3, so pass `log` through directly. Run `pnpm --filter @waitron/fiscal-verifactu test slot` — PASS.

- [ ] **Step 8: Rewire `boot.ts`.** Hoist `const enabledFiscal = fiscalSlot(setsToMigrate, filingModule)` to one binding (reused by `makeFiscalBackend`'s call too). Replace the `drain: async (at2) => { const resolver = aeatClientResolver(...); … runDrain(...) … }` block (~`boot.ts:1931`) with `drain: (at2) => enabledFiscal.drain({ db, ring, environment: config.environment, skipRetryMs: config.skipRetryMs, log: (l, e, f) => log(l, e, f) }, at2)`. Remove `import { drain } from "@waitron/fiscal-verifactu"` (line 25) and `import { aeatClientResolver, aeatEndpointFor, mtlsFetch } from "./aeat-transport.js"` (line 31).

- [ ] **Step 9: Adjust the seams allowlist for the interim.** In `scripts/module-seams.test.ts`, `DEFERRED_RUNTIME_PASS` becomes `new Map([["apps/server/src/aeat-credential.ts", "cert validate/seal not yet behind a seat; reaches CertKind via the regime — moved in Task 5"]])`. The `boot.ts` and `aeat-transport.ts` entries are removed (boot imports no regime; the transport left `apps/server`).

- [ ] **Step 10: Run the gate.** `pnpm --filter @waitron/fiscal test:coverage && pnpm --filter @waitron/fiscal-verifactu test:coverage && pnpm --filter @waitron/server typecheck && pnpm --filter @waitron/server test:coverage && pnpm test scripts/module-seams`. Then the boot/drain real-PG suite in `apps/server/src` (grep for the drain/aeat e2e) — the verifactu drain still submits via the seat. Verify `grep -n '@waitron/fiscal-verifactu\|@waitron/verifactu' apps/server/src/boot.ts` prints nothing. Expected: all PASS.

- [ ] **Step 11: Commit.** `git add -A && git commit -s -m "feat(fiscal): drain seat + AEAT transport in the regime; boot imports no regime"`

---

## Task 4 (S2): Remove `FiscalBackend.drain`/`reconcile` (dead surface after the seat)

**Files:**
- Modify: `packages/fiscal/src/backend.ts` (+ `index.ts`), `packages/fiscal/src/testing/fake-backend.ts`, `packages/fiscal-verifactu/src/backend.ts`
- Modify (test doubles / callers the reviewer found): `packages/fiscal-verifactu/src/drain.test.ts` (~10 `backend.drain(...)` sites: lines 46,63,69,116,241,268,300,348,381), `packages/fiscal-verifactu/src/reconcile.rls.test.ts` (~line 111 `seedBackend.drain(...)`), `packages/core/src/record-sale.test.ts` (~line 228 `drain:`/`reconcile:` in a backend double), `packages/core/src/record-void.test.ts` (~line 197)

**Interfaces:**
- Consumes: `FISCAL_SLOT.drain` (Task 3) now carries the runtime pass.
- Produces: a `FiscalBackend` interface with no `drain`/`reconcile`.

- [ ] **Step 1: Confirm no surviving caller.** `grep -rn '\.drain(\|\.reconcile(' apps/server/src packages --include='*.ts' | grep -v node_modules`. Every hit must be either the standalone `drain`/`reconcile` FUNCTIONS (kept) or a test double being migrated below. `boot.ts` now calls `enabledFiscal.drain` (the seat), not a `FiscalBackend`.

- [ ] **Step 2: Remove `drain`/`reconcile` from the `FiscalBackend` interface** (`backend.ts`) and their doc paragraphs. Run `grep -rn 'ReconcileResult\|ReconcileMismatch\|AckState' packages apps --include='*.ts' | grep -v '.test.'` — these types are USED inside `@waitron/fiscal-verifactu`'s own `reconcile.ts`/`drain.ts` (the standalone functions return them), so KEEP them and their `index.ts` exports. Remove only the two interface METHODS.

- [ ] **Step 3: Remove the delegating methods** from `VerifactuBackend` (`packages/fiscal-verifactu/src/backend.ts`) and `FakeFiscalBackend` (`packages/fiscal/src/testing/fake-backend.ts`). The standalone `drain(DrainDeps, now)`/`reconcile(...)` functions STAY.

- [ ] **Step 4: Migrate the test doubles and callers.** In `drain.test.ts`/`reconcile.rls.test.ts`, replace `backend.drain(now)` / `seedBackend.drain(now)` with the standalone `drain(deps, now)` (assemble `DrainDeps` from the suite's existing `db`/`resolveClient` fixtures — the same object the backend used internally). In `record-sale.test.ts`/`record-void.test.ts`, drop the now-removed `drain`/`reconcile` keys from the backend doubles (they were only there to satisfy the interface). Do NOT weaken any surviving behavioural assertion (CLAUDE.md).

- [ ] **Step 5: Run the gate.** `pnpm --filter @waitron/fiscal test:coverage && pnpm --filter @waitron/fiscal-verifactu test:coverage && pnpm --filter @waitron/core test:coverage && pnpm --filter @waitron/server test:coverage`. Expected: PASS.

- [ ] **Step 6: Commit.** `git add -A && git commit -s -m "refactor(fiscal): drop the dead FiscalBackend.drain/reconcile methods"`

---

## Task 5 (S3): Provisioning-secret seat; relocate the cert; rename the error code; empty the allowlist

**Files:**
- Modify: `packages/fiscal/src/contribution.ts` (add `provisioningSecret`), `packages/fiscal-verifactu/src/slot.ts` (+ `index.ts`)
- Create (moved): `packages/fiscal-verifactu/src/provisioning-secret.ts` + its test (from `apps/server/src/aeat-credential.ts` + the `parseCert` helper extracted from `setup-api.ts`)
- Delete: `apps/server/src/aeat-credential.ts`
- Modify: `apps/server/src/setup-api.ts`, `apps/server/src/boot.ts` (inject `db`+`ring` into the setup deps if not already present), `apps/server/src/errors.ts`, `scripts/module-seams.test.ts` (empty the allowlist)
- Modify (browser consumer the reviewer found): `apps/setup/src/setup-app.ts` (~line 402 `case "setup.aeat_cert_required":`) + `apps/setup/src/setup-app.test.ts` (~lines 377-378)

**Interfaces:**
- Produces:

```ts
// @waitron/fiscal contribution.ts — added to FiscalContribution
readonly provisioningSecret?: {
  required(environment: DeploymentEnvironment): boolean;
  seal(deps: { db: Database; ring: KeyRing }, tenantId: TenantId, raw: unknown): Promise<void>;
};
```

- [ ] **Step 1: Add the optional `provisioningSecret` seat** to `FiscalContribution`.

- [ ] **Step 2: Relocate the cert validate/seal into the regime.** `git mv apps/server/src/aeat-credential.ts packages/fiscal-verifactu/src/provisioning-secret.ts` and its test. ALSO move `parseCert` (it lives in `setup-api.ts:259`, not in `aeat-credential.ts` — reviewer M4) into this file. Rewrite imports (`CertKind`/`isCertKind` now local via `./aeat-transport.js`; `putCredential`/`KeyRing` from `@waitron/credentials`; `withTenant`/`Database` from `@waitron/db`). Expose one entry point:

```ts
// validates the opaque raw blob (parseCert + validateAeatCert shape checks, throwing
// setup.request_invalid naming the field) then seals it to the fiscal.aeat purpose under withTenant.
export function sealAeatSecret(deps: { db: Database; ring: KeyRing }, tenantId: TenantId, raw: unknown): Promise<void>;
```

- [ ] **Step 3: Fill `FISCAL_SLOT.provisioningSecret`** in `slot.ts`: `{ required: (environment) => environment === "production", seal: (deps, tenantId, raw) => sealAeatSecret(deps, tenantId, raw) }`. Run `pnpm --filter @waitron/fiscal-verifactu test provisioning-secret` (moved test, behaviour-preserving) — PASS.

- [ ] **Step 4: Rename the error code.** In `apps/server/src/errors.ts` rename `setup.aeat_cert_required` → `setup.provisioning_secret_required`, params `{ module: string }`. `grep -rn 'aeat_cert_required' apps packages --include='*.ts'` and update EVERY consumer — including the browser package `apps/setup/src/setup-app.ts` (~402) and `setup-app.test.ts` (~377-378). Delete the old code; no sibling.

- [ ] **Step 5: Rewire `setup-api.ts` (DI — reviewer M4).** `setup-api.ts` has no `db`/`ring` in scope, and sealing is injected today (`SetupDeps.sealAeat`, boot-built — which would make boot import the regime, forbidden). Fix:
  - Give `setup-api.ts` `db` + `ring` (add to `SetupDeps`; boot already holds both and injects them — generic, no regime import). Remove the old `sealAeat` dep.
  - `setup-api.ts` imports `ALL_MODULES` (`@waitron/composition` — allowed in `apps/server`) and `resolveFiscalModules` (`@waitron/provisioning`); resolve `const contribution = ALL_MODULES.find((m) => m.fiscal?.id === resolveFiscalModules(venue.location.fiscalTerritory).filing)?.fiscal` (the territory in the REQUEST picks the module; the box's enabled set is not yet written at setup).
  - Replace `const certExpected = mode === "live" && …ES-common` with `const secret = contribution?.provisioningSecret; const expected = secret?.required(environment) ?? false;`. `expected && !present` → `throw new AppError("setup.provisioning_secret_required", { module: contribution!.id })`; `!expected && present` → `invalidRequest("aeatCert")`.
  - Replace `parseCert(...)` + `sealAeat(result.tenantId, cert)` with `if (expected) await secret!.seal({ db, ring }, result.tenantId, body.aeatCert)` after `provision`. The wire field stays `body.aeatCert` (renaming it is optional polish; skip to bound the diff).

- [ ] **Step 6: Empty the allowlist.** `apps/server/src/aeat-credential.ts` no longer exists and `setup-api.ts` imports no regime package (composition + provisioning are not regime packages). Set `DEFERRED_RUNTIME_PASS = new Map<string, string>([])` and adjust the "allowlist names only files that still import the regime" meta-check to assert emptiness (read it first, keep it meaningful).

- [ ] **Step 7: Adapt `setup-api.test.ts`.** The existing cases (live ES-common requires the secret; demo rejects a present secret; malformed → `setup.request_invalid`) stay green with the new code name + seat indirection. Do not weaken them.

- [ ] **Step 8: Run the gate.** `pnpm --filter @waitron/fiscal-verifactu test:coverage && pnpm --filter @waitron/server test:coverage && pnpm test scripts/module-seams`, then `apps/setup`: `pnpm --filter @waitron/setup test:coverage` (BROWSER mode — real Chromium; ensure no other browser gate runs concurrently and nothing backgrounds `pnpm -r test:coverage`, CLAUDE.md §2). Verify `grep -rn 'pfxBase64\|certKind\|passphrase' apps/server/src/setup-api.ts` prints nothing and `grep -rn '@waitron/fiscal-verifactu\|@waitron/verifactu' apps/server/src` prints nothing.

- [ ] **Step 9: Commit.** `git add -A && git commit -s -m "feat(fiscal): provisioning-secret seat; setup asks the regime; allowlist emptied"`

---

## Task 6 (S4a): `NoneBackend implements FiscalBackend`

**Files:**
- Create: `packages/fiscal-none/src/backend.ts`
- Test: `packages/fiscal-none/src/backend.test.ts`

**Interfaces:**
- Consumes: `FiscalBackend`, `SaleForFiscalRecord`, `FiscalRecordRef`, `IntegrityReport`, `NodeRegistration` (`@waitron/fiscal`).
- Produces: `class NoneBackend implements FiscalBackend` with `id: "none"`.

- [ ] **Step 1: Write the failing test.** `NoneBackend` touches NO database — every method is a pure no-op returning a fixed shape — so the test needs no `db`; pass a stub `tx`. `packages/fiscal-none/src/backend.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { NoneBackend } from "./backend.js";

const tx = {} as never; // NoneBackend never touches the transaction

describe("NoneBackend records nothing", () => {
  it("recordSale writes nothing and returns a recorded ref", async () => {
    const ref = await new NoneBackend().recordSale(tx, sampleSale()); // sampleSale(): a SaleForFiscalRecord fixture
    expect(ref).toMatchObject({ backend: "none", state: "recorded", verificationUrl: undefined });
  });
  it("pendingCount is 0, checkIntegrity is checked:0, filedReceiptFor is undefined", async () => {
    const b = new NoneBackend();
    expect(await b.pendingCount(someTenant, someNode)).toBe(0);
    expect(await b.checkIntegrity(tx, someTenant, someNode)).toMatchObject({ ok: true, checked: 0, issues: [] });
    expect(await b.filedReceiptFor(tx, someSaleId)).toBeUndefined();
  });
});
```

Build `sampleSale()` from the `SaleForFiscalRecord` shape in `@waitron/fiscal/src/backend.ts` (brand the ids with `@waitron/shared`'s `tenantId`/`saleId`/`nodeId`/… constructors); reuse an existing sale fixture if `@waitron/fiscal/src/testing` exports one.

- [ ] **Step 2: Run it, expect FAIL** (`NoneBackend` undefined). `pnpm --filter @waitron/fiscal-none test backend`.

- [ ] **Step 3: Implement `NoneBackend`** per spec §6.1 — every method returns its empty shape, writes nothing, takes the `tx` where the interface does. `recordSale`/`recordVoid`/`recordCorrection`/`recordSubstitution` return `{ backend: "none", recordId: <sale.saleId as string>, state: "recorded", issuedAt: sale.issuedAt, offsetMinutes: sale.offsetMinutes, verificationUrl: undefined }`. `registerNode` → `{ backend: "none", nodeId, registrationId: "", registeredAt: <now or a passed clock> }`. `filedReceiptFor` → `undefined`. `checkIntegrity` → `{ ok: true, checked: 0, issues: [] }`. `pendingCount` → `0`. No `drain` here (it is on the slot).

- [ ] **Step 4: Run it, expect PASS.** `pnpm --filter @waitron/fiscal-none test backend`.

- [ ] **Step 5: Commit.** `git add -A && git commit -s -m "feat(fiscal-none): the no-regime backend that records nothing"`

---

## Task 7 (S4b): `FISCAL_NONE_SLOT` (fiscal seat + no-op drain, no provisioning secret)

**Files:**
- Create: `packages/fiscal-none/src/slot.ts`
- Modify: `packages/fiscal-none/src/index.ts`
- Test: `packages/fiscal-none/src/slot.test.ts`

**Interfaces:**
- Produces: `FISCAL_NONE_SLOT: FiscalContribution` (`id: "none"`, `makeBackend` → `new NoneBackend()`, `drain` → empty result, `provisioningSecret` absent). Exported from the barrel.

- [ ] **Step 1: Write the failing test.** `packages/fiscal-none/src/slot.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FISCAL_NONE_SLOT } from "./slot.js";

describe("FISCAL_NONE_SLOT", () => {
  it("id is none and makeBackend builds a NoneBackend", () => {
    expect(FISCAL_NONE_SLOT.id).toBe("none");
    const backend = FISCAL_NONE_SLOT.makeBackend({ db: {} as never, clock: {} as never, environment: "preproduction" });
    expect(backend.id).toBe("none");
  });
  it("drain returns the empty result and needs no ring", async () => {
    const result = await FISCAL_NONE_SLOT.drain({ db: {} as never, ring: {} as never, environment: "preproduction", skipRetryMs: 1 }, new Date());
    expect(result).toMatchObject({ nextDueAt: null, batchesSent: 0, recordsSubmitted: 0, skipped: [] });
  });
  it("declares no provisioning secret", () => {
    expect(FISCAL_NONE_SLOT.provisioningSecret).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.** `pnpm --filter @waitron/fiscal-none test slot`.

- [ ] **Step 3: Implement `FISCAL_NONE_SLOT`** and export it + `NoneBackend` from `src/index.ts`.

```ts
export const FISCAL_NONE_SLOT: FiscalContribution = {
  id: "none",
  makeBackend: () => new NoneBackend(),
  drain: async () => ({
    nextDueAt: null, batchesSent: 0, recordsSubmitted: 0, recordsAccepted: 0,
    recordsHalted: 0, incidentsRaised: 0, skipped: [],
  }),
};
```

- [ ] **Step 4: Decide the provisioning seat** (§6.2). A no-regime node needs no per-node seed, so omit `FISCAL_NONE_PROVISIONING` unless the standby probe (below) shows a standby needs disjoint series from this module. **Standby probe:** grep how `mirror-bundle.ts` / `adoptFromPrimary` handle a module with no `standby` seat and whether a no-regime standby still needs `invoice_series`. If the carrier tolerates a fiscal module with no `standby` (core seeds the series), omit it; if not, add a minimal `standby` deriving disjoint series by a non-fiscal rule. Record the finding in a one-line comment. This does not block the sale-path proof.

- [ ] **Step 5: Run the package gate.** `pnpm --filter @waitron/fiscal-none lint typecheck test:coverage` — Expected: PASS and the coverage floor met (backend + slot tests).

- [ ] **Step 6: Commit.** `git add -A && git commit -s -m "feat(fiscal-none): fill the fiscal slot with a no-op drain"`

---

## Task 8 (S5a): The slot-aware provision-only gate

**Files:**
- Modify: `packages/module/src/config.ts` (split `disabledProvisionOnly`; add a `fiscalSlotMembers`/reuse `fiscalSlot`), `packages/module/src/index.ts`
- Modify: `apps/server/src/provision.ts` (call the slot check)
- Test: `packages/module/src/config.test.ts`, `apps/server/src/provision.test.ts`

**Interfaces:**
- Produces: `disabledProvisionOnly` narrowed to provision-only modules WITHOUT a `fiscal` contribution; a fiscal-slot resolution check in `provisionVenue`.

- [ ] **Step 1: Write the failing tests** in `packages/module/src/config.test.ts`:

```ts
it("a disabled fiscal-slot member is NOT flagged by disabledProvisionOnly (the slot handles it)", () => {
  const config = parseModuleOverrides({ "fiscal-none": false }, MODS); // MODS has both fiscal modules
  expect(disabledProvisionOnly(MODS, config)).toEqual([]); // fiscal-none is a slot member
});
it("a disabled NON-slot provision-only module is still flagged", () => {
  // synthesize a provision-only module with no fiscal seat, disabled -> flagged
});
```

Read the existing `config.test.ts` for the `MODS`/`parseModuleOverrides` fixtures.

- [ ] **Step 2: Run, expect FAIL** (current `disabledProvisionOnly` flags any disabled provision-only, including a fiscal-slot member). `pnpm --filter @waitron/module test config`.

- [ ] **Step 3: Narrow `disabledProvisionOnly`** to `m.tier === "provision-only" && m.fiscal === undefined && !isEnabled(config, m.name)`. Add a comment: fiscal-slot members are governed by the slot's exactly-one rule (`fiscalSlot`), not this gate.

- [ ] **Step 4: Run, expect PASS.** `pnpm --filter @waitron/module test config`.

- [ ] **Step 5: Add the slot check to `provisionVenue`** (`apps/server/src/provision.ts`), after the `disabledProvisionOnly` gate: `fiscalSlot(enabledModules(ALL_MODULES, deps.moduleConfig), null)` — it throws `module.fiscal_slot_empty`/`fiscal_slot_ambiguous` if the slot does not resolve to exactly one. Add a `provision.test.ts` case: provisioning with BOTH fiscal modules enabled throws `fiscal_slot_ambiguous`; with exactly one enabled succeeds.

- [ ] **Step 6: Run the gate.** `pnpm --filter @waitron/module test:coverage && pnpm --filter @waitron/server test:coverage`.

- [ ] **Step 7: Commit.** `git add -A && git commit -s -m "feat(module): the provision-only gate is slot-aware; the fiscal slot must resolve"`

---

## Task 9 (S5b): Wire `fiscal-none` into `ALL_MODULES`, add the territory, provisioning writes `modules.json`

This is the task that makes both fiscal modules coexist. It MUST land the composition + boot green.

**Files:**
- Modify: `packages/composition/src/modules.ts` (add `fiscal-none` descriptor, `@waitron/fiscal-none` dep), `packages/composition/package.json`, `packages/migrations/migrations.manifest.json`, `packages/composition/src/composition.test.ts`
- Modify: `packages/provisioning/src/fiscal-modules.ts` (GB territory)
- Modify: `apps/server/src/provision.ts` + `setup-api.ts`, `packages/provisioning/src/bin.ts` (write the slot `modules.json`)
- Test: composition, provisioning, a boot test

**Interfaces:**
- Consumes: `FISCAL_NONE_SLOT` (Task 7), the slot-aware gate (Task 8).
- Produces: `ALL_MODULES` with a `fiscal-none` member; `resolveFiscalModules("GB-…")`.

- [ ] **Step 1: Add `@waitron/fiscal-none` to `packages/composition/package.json`** and the `fiscal-none` descriptor to `ALL_MODULES` (LAST, after `fiscal-verifactu`): `{ name: "fiscal-none", version: "0.0.0", tier: "provision-only", requires: { core: "*" }, migrations: { name: "fiscal-none", table: "__drizzle_migrations_fiscal_none", from: "../fiscal-none/drizzle" }, fiscal: FISCAL_NONE_SLOT }`. Add the manifest entry last.

- [ ] **Step 2: Update `composition.test.ts`** — the slot listing → `["fiscal-verifactu", "fiscal-none"]`, and the manifest name/order pins gain `fiscal-none`. Add a case asserting `fiscal-none`'s `fiscal.id === "none"` and it has no `provisioning`/`vocabulary`/`sync`.

- [ ] **Step 3: Run composition, expect PASS.** `pnpm --filter @waitron/composition test:coverage`. `orderedMigrationSets` must still equal `manifestSets()` (fiscal-none last, core-only dep — verify the Kahn order).

- [ ] **Step 4: Add the GB territory.** In `packages/provisioning/src/fiscal-modules.ts` `REGISTRY`: `"GB-vat": Object.freeze({ filing: "none", tax: "none" })` (confirm the suffix convention against how ES territories are named; `GB-vat` reads as country-VAT). This auto-extends the seams `FISCAL_TERRITORIES` agreement check. **Update the `REGISTRY` header comment in the same edit** (CLAUDE.md §1): it currently says "Only `ES-common` is populated ... every other territory ... is REFUSED" — now two territories are populated, so the claim is stale.

- [ ] **Step 5: Write `modules.json` at provisioning.** Add a helper (in `@waitron/module`, beside `fiscalSlot`) `selectFiscalModule(modules, filingId): ModuleConfig` that returns overrides enabling the descriptor whose `fiscal.id === filingId` and disabling every other fiscal-slot member, MERGED onto a base config. In `provision.ts`/`setup-api.ts`: derive `filing = resolveFiscalModules(venue.location.fiscalTerritory).filing`, build the config, use it for the gate + `planVenue` + `applyVenue`, and `writeModuleConfig(stateDir, config)` after a successful provision (before restart). In `packages/provisioning/src/bin.ts` (the CLI), do the same write. Add tests: a GB provision writes `modules.json` disabling `fiscal-verifactu`; an ES provision writes it disabling `fiscal-none`.

- [ ] **Step 6: Run the gate.** `pnpm --filter @waitron/composition test:coverage && pnpm --filter @waitron/module test:coverage && pnpm --filter @waitron/provisioning test:coverage && pnpm --filter @waitron/server test:coverage`. Then a boot test proving a GB-configured box boots with `fiscal-none` filling the slot (no `fiscal_slot_ambiguous`).

- [ ] **Step 7: Commit.** `git add -A && git commit -s -m "feat(fiscal-none): wire into ALL_MODULES; provisioning selects the fiscal module by territory"`

---

## Task 10 (S5c): The no-fiscal-write proof (real-PG) and Spanish regression

**Files:**
- Test: `apps/server/src/fiscal-none.e2e.test.ts` (new, real-PG); reuse an existing verifactu e2e for the regression side.

**Interfaces:**
- Consumes: the full wired system (Tasks 1–9).

- [ ] **Step 1: Write the failing real-PG proof.** A GB-configured box (modules.json enables `fiscal-none`), provision a venue, ring a sale (and a correction, void, substitution), then assert:

```ts
// zero fiscal rows written, sale carries fiscal_backend = "none"
const registros = await countRows(db, "registros_facturacion");
expect(registros).toBe(0);
for (const t of ["registro_sif", "cadenas", "envios"]) expect(await countRows(db, t)).toBe(0);
const sale = await readSale(db, saleId);
expect(sale.fiscalBackend).toBe("none");
```

Read `apps/server/src/testing/` for the venue/provision helpers and how an existing e2e rings a sale. Use Testcontainers (real PG) — RLS/deployment-role behaviour matters. Set `TESTCONTAINERS_RYUK_DISABLED=true`.

- [ ] **Step 2: Run, expect the "records nothing" assertion to drive the implementation** — it should PASS given Tasks 6–9, but PROVE BY DELETION: temporarily make `NoneBackend.recordSale` write a stray row (or flip the wiring to verifactu) and confirm the count assertion FAILS, then revert. This confirms the test measures the real thing (CLAUDE.md §1 — a control in the other direction).

- [ ] **Step 3: Spanish regression.** Confirm an ES-common box still mints the SIF and files: run the existing verifactu write-path / drain e2e suites unchanged — they must be green with the transport in its new home and the drain via the seat (already exercised in Task 3, re-confirmed here as the paired control).

- [ ] **Step 4: Run.** `pnpm --filter @waitron/server test:coverage`.

- [ ] **Step 5: Commit.** `git add -A && git commit -s -m "test(fiscal-none): real-PG proof a no-regime venue writes no fiscal record"`

---

## Task 11 (S6): Guards, CLAUDE.md rules, whole-workspace gate

**Files:**
- Modify: `scripts/module-seams.test.ts` (already emptied in Task 5 — confirm), `CLAUDE.md` (§3)
- Verify: `english-only`, `errors-reachable`, `module-graph-honesty`

- [ ] **Step 1: Confirm the empty allowlist and the extended territory/slot check.** `scripts/module-seams.test.ts`'s `DEFERRED_RUNTIME_PASS` is empty and the "every filing value names an enabled fiscal contribution" check now covers `none` (it iterates `FISCAL_TERRITORIES`, so the GB entry from Task 9 extends it). `pnpm test scripts/module-seams` — PASS.

- [ ] **Step 2: Add the two CLAUDE.md §3 rules.** Under §3 (conventions reviewers enforce), add:
  1. A rule that **new product domains land as modules** (a module package filling contract seats), never new code trapped in the core — pointer: this slice (`fiscal-none`) and SP-3.
  2. A rule that **no new table enters the core migration set without a stated reason** in the commit — a `tenant_id`-bearing domain table belongs to a module's own migration set.
  Keep each to the house shape: the rule, the one incident/why, a pointer. Do not restate the whole spec.

- [ ] **Step 3: Run the guards.** `pnpm test scripts/` (the root project: english-only, errors-reachable, module-graph-honesty, module-seams, coverage-thresholds, composition-adjacent). `@waitron/fiscal-none` is scanned as a generic package by english-only — confirm it passes (it contains no Spanish; needs no vocabulary seat and no `GENERIC_PACKAGES` exemption).

- [ ] **Step 4: Whole-workspace gate.** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`. Because this touches values more than one suite asserts (module names, the fiscal slot), run the whole workspace, not a filtered subset (CLAUDE.md §2). The four browser packages run real Chromium — this change does not touch them, but ensure no two browser gates overlap and nothing backgrounds `pnpm -r test:coverage` beside subagents (CLAUDE.md §2).

- [ ] **Step 5: Update `docs/backlog.md`** — Track C item 2 LANDED (mark it, note the runtime-duty seat completed and the allowlist emptied). Same change, per CLAUDE.md §6.

- [ ] **Step 6: Commit.** `git add -A && git commit -s -m "feat(fiscal-none): empty the seams allowlist, add the two CLAUDE.md module rules"`

---

## Self-Review notes (author)

- **Spec coverage:** S0→Task1, S1(rename)→Task2, S2(drain seat + transport + interface cleanup)→Tasks3-4, S3(provisioning-secret + allowlist)→Task5, S4(package)→Tasks6-7, S5(gate/wire/territory/proof)→Tasks8-10, S6(guards/rules)→Task11. Every spec section maps to a task.
- **Sequencing invariant (the reviewer's C1):** the AEAT transport + `aeat-credential.ts` both reach the regime, so moving the transport (Task 3) dangles `aeat-credential.ts` — Task 3 fixes it to import from the regime and TEMPORARILY allowlists `aeat-credential.ts`; Task 5 moves that file into the regime and empties the allowlist. `fiscal-none` enters `ALL_MODULES` (Task 9) only AFTER the slot-aware gate (Task 8) and the package (Tasks 6-7), so composition/boot never go red. `FiscalContribution.drain` (required) is added AND implemented on `FISCAL_SLOT` in the SAME task (Task 3), so no compile gap.
- **Type consistency:** `FiscalDutyDeps`/`FiscalDutyLog` (Task 3) → Tasks 3,5,7. `FISCAL_NONE_SLOT` (Task 7) → Task 9. `sealAeatSecret` (Task 5) → `setup-api.ts`. `selectFiscalModule` (Task 9) and the narrowed `disabledProvisionOnly` (Task 8) → `provision.ts`. `Entorno`==`DeploymentEnvironment` verified, no cast (Task 3 Step 7).
- **Open probes flagged for stop-and-consult:** the empty-migration feasibility (Task 1 Step 4) and the `fiscal-none` standby seat (Task 7 Step 4).
- **Behaviour-preserving proofs:** Tasks 2, 3, 4, 5 keep existing suites green (renames/moves), never rewrite a behavioural assertion. Task 5 crosses a BROWSER package (`apps/setup`) — its gate runs alone (CLAUDE.md §2).
