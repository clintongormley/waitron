# SP-3c — Module-owned gated provisioning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put every provisioning-time fiscal seam (venue seed, standalone node re-seed, standby reservation and establishment) and the till's fiscal-backend choice behind two typed module seats, so that swapping the fiscal module later touches only the composition list.

**Architecture:** `WaitronModule` gains `provisioning` (`seed` / `standby`, typed in `@waitron/module`) and `fiscal` (`{ id, makeBackend }`, typed in `@waitron/fiscal`). The fiscal package exports `FISCAL_PROVISIONING` and `FISCAL_SLOT`; `@waitron/provisioning` becomes a generic runner (`planVenue` emits one `seed-module` action per declaring module, `applyVenue` runs it inside its one transaction); the composition list moves to a new `@waitron/composition` package because the provisioning CLI needs it; the host selects the backend with `fiscalSlot(enabledModules, stampedFilingModule)`; `FiscalBackend.id` replaces the hardcoded `fiscalBackend: "verifactu"` input. A root guard pins the import boundary with an explicit allowlist for the deferred runtime pass.

**Tech Stack:** TypeScript, Vitest (root project + per-package; PGlite and Testcontainers real PG), pnpm workspace, drizzle-orm. One new workspace package, no migration, no new external dependency.

**Spec:** `docs/superpowers/specs/2026-09-05-module-sp3c-gated-provisioning-design.md` — read it first; the plan argues from it.

## Global Constraints

- **Worktree:** all work happens in `/Users/clintongormley/workspace/worktrees/waitron-feat-module-sp3c-gated-provisioning` on branch `feat/module-sp3c-gated-provisioning`. Never commit to `main`.
- **Every commit is `git commit -s`** (DCO; CI's `dco` job walks the whole PR range).
- **Generic packages stay English.** `packages/module` and `packages/fiscal` are scanned by the english-only guard (`GENERIC_PACKAGES`, `packages/db/src/english-only.ts`); nothing you add there may contain a fiscal token (`sif`, `registro`, `instalacion`, `numero`, `sistema`, `informatico`, `serie`… — the full list is `FISCAL_VOCABULARY`). `packages/fiscal` is additionally scanned by `no-regime-vocabulary.test.ts` (no `chain`, `hash`, `verifactu`, `sif`, `aeat`, `registro`…). Fiscal words live in `packages/fiscal-verifactu`, `packages/provisioning` (not generic), `packages/composition` (not generic), `apps/server`, tests, `docs/`, `scripts/`.
- **No `fiscalBackend` string in any `RecordSaleInput` / `RecordCorrectionInput` / `RecordSubstitutionInput` after Task 3.** Direct `sales` inserts in tests and demo seeds keep their column value — the column is unchanged.
- **Seat naming is fixed:** `provisioning` (`seed` / `standby`), `fiscal`; exports `FISCAL_PROVISIONING`, `FISCAL_SLOT`, `WAITRON_ID_SISTEMA` from `@waitron/fiscal-verifactu`; `ALL_MODULES` from `@waitron/composition`; `fiscalSlot` from `@waitron/module`; `FISCAL_TERRITORIES` from `@waitron/provisioning`.
- **Error codes:** new `module.fiscal_slot_empty`, `module.fiscal_slot_ambiguous`, `module.fiscal_slot_mismatch` (`@waitron/module`); `sif.reservation_invalid` (fiscal package); `sif.id_sistema_invalid` MOVES from `apps/server/src/errors.ts` to `packages/fiscal-verifactu/src/errors.ts` (same string); `provisioning.id_sistema_invalid` is DELETED. Every file that throws a code imports its registry (`import "./errors.js"`).
- **Plan-integrity failures in `applyVenue` are plain `Error`s** (a malformed plan is a programming bug), never `AppError`s — the existing convention in that file.
- **Per-task verification** includes `pnpm format:check` (whole workspace — fast) plus the named package's `lint`, `typecheck` and `test:coverage`. Real-PG suites need `TESTCONTAINERS_RYUK_DISABLED=true`. `apps/server`'s full `test:coverage` is heavy: run the named suites per task and the whole package once in Task 9.
- **Coverage bars:** `module`, `fiscal-verifactu`, `core`, `db` hold `98/98/98/95`; `provisioning`, `composition`, `fiscal`, `apps/server` hold `90/90/85/85`. A new package's `vitest.config.ts` declares the floor exactly (`scripts/coverage-thresholds.test.ts` derives the member list from pnpm).
- **Comments state the invariant, not the history** (CLAUDE.md §1). No "moved in SP-3c" narratives; a one-line spec pointer at most. Thin the comments you touch.
- **Do not run two browser-mode test gates at once** and never background `pnpm -r test:coverage`. Before any `git push`, `pgrep -f .husky/pre-push` must print nothing.
- **pnpm install after any `package.json` change and commit `pnpm-lock.yaml`** in the same commit — the hook's `--frozen-lockfile` fails otherwise.

---

### Task 1: `@waitron/composition` — the composition list becomes a package

**Files:**
- Create: `packages/composition/package.json`, `packages/composition/tsconfig.json`, `packages/composition/vitest.config.ts`, `packages/composition/src/index.ts`, `packages/composition/src/modules.ts`, `packages/composition/src/composition.test.ts`
- Modify: `apps/server/src/modules.ts` (keep derived values, re-export the list), `apps/server/src/modules.test.ts` (keep only `MODULE_BY_TABLE`), `apps/server/package.json` (add the dependency)
- Modify: `scripts/changed-scope.mjs:227-241` (`LIGHT_B_PACKAGES`), `.github/workflows/ci.yml` (`test-light-a`'s `LIGHT_B_PACKAGES` exclusion block, after the `!@waitron/sync-enrolment` line near 1124)
- Modify: `scripts/english-only.test.ts` and `scripts/module-graph-honesty.test.ts` (import `ALL_MODULES` from the package)

**Interfaces:**
- Produces: `export const ALL_MODULES: readonly WaitronModule[]` from `@waitron/composition` (unchanged content; `apps/server/src/modules.ts` re-exports it, so `import { ALL_MODULES } from "./modules.js"` keeps working in `apps/server`).

- [ ] **Step 1: Create the package skeleton**

`packages/composition/package.json`:

```json
{
  "name": "@waitron/composition",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit",
    "lint": "eslint ."
  },
  "dependencies": {
    "@waitron/db": "workspace:*",
    "@waitron/fiscal-verifactu": "workspace:*",
    "@waitron/identity": "workspace:*",
    "@waitron/module": "workspace:*",
    "@waitron/payments": "workspace:*",
    "@waitron/workforce-es": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "@vitest/coverage-v8": "^3.0.0",
    "@waitron/migrations": "workspace:*",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`packages/composition/tsconfig.json` — copy `packages/module/tsconfig.json` verbatim.

`packages/composition/vitest.config.ts` — copy `packages/module/vitest.config.ts` verbatim (floor thresholds, `singleFork`, `src/index.ts` excluded).

`packages/composition/src/index.ts`:

```ts
// The entire public surface of @waitron/composition: the module list, and nothing else.
export { ALL_MODULES } from "./modules.js";
```

- [ ] **Step 2: Move the list**

Move the `ALL_MODULES` constant and its imports from `apps/server/src/modules.ts` into `packages/composition/src/modules.ts`, keeping the descriptors byte-for-byte. Replace the long header with this one (the seat-by-seat narrative is history — CLAUDE.md §1):

```ts
import { CORE_ENROLMENT } from "@waitron/db";
import { FISCAL_ENROLMENT, FISCAL_VOCABULARY } from "@waitron/fiscal-verifactu";
import { IDENTITY_ENROLMENT } from "@waitron/identity";
import type { WaitronModule } from "@waitron/module";
import { PAYMENTS_ENROLMENT } from "@waitron/payments";
import { WORKFORCE_ES_VOCABULARY } from "@waitron/workforce-es";

/**
 * Every Waitron module, in composition order. The one place that names every module package: the
 * server, the provisioning CLI and the root guards all read this list, and nothing else imports a
 * module package outside its own owner (`scripts/module-seams.test.ts` enforces the boundary).
 *
 * Each `migrations` object carries the exact `{ name, table, from }` from
 * `packages/migrations/migrations.manifest.json`; `composition.test.ts` pins the two byte-for-byte
 * while both exist. `requires` names every cross-set edge the SQL creates — FK `REFERENCES`,
 * `CREATE TRIGGER … ON <table>` and the `sync_capture()` SPI call — which the root
 * `module-graph-honesty` guard cross-checks against the migrations. Seats: `sync` on every enrolling
 * package (SP-2a/3a), `vocabulary` on the Spanish-by-design packages (SP-3b); the rest stay declared
 * on the contract and empty until their slices land.
 */
export const ALL_MODULES: readonly WaitronModule[] = [
  // … the nine descriptors, unchanged …
];
```

`apps/server/src/modules.ts` becomes:

```ts
import { ALL_MODULES } from "@waitron/composition";
import type { EnrolledTable } from "@waitron/sync";

export { ALL_MODULES };

/** The composition root's assembled sync-enrolment set — every module's declared enrolment, in
 * ALL_MODULES order (SP-2a inversion). `@waitron/sync` no longer owns this; boot injects it into
 * mountSyncApi/runSyncPull/readDrainProgress, and the tests use the same reference. Assembled from
 * ALL_MODULES (not the enabled set) — the enabled-set-aware pull is DEFERRED (spec §2/§7), built
 * with the first genuinely-toggleable module. */
export const ALL_SYNC_ENROLMENTS: readonly EnrolledTable[] = ALL_MODULES.flatMap(
  (m) => m.sync ?? [],
);

/** table → owning-module name, built at the composition root (SP-2b). The apply gate resolves a
 * sync_log row's module by table name; it is a side map rather than a field on EnrolledTable so
 * SP-2a's enrolment type and its threading stay untouched (spec §5). */
export const MODULE_BY_TABLE: ReadonlyMap<string, string> = new Map(
  ALL_MODULES.flatMap((m) => (m.sync ?? []).map((e) => [e.table, m.name] as const)),
);
```

Add `"@waitron/composition": "workspace:*"` to `apps/server/package.json` `dependencies` (alphabetical, after `@waitron/catalogue`).

- [ ] **Step 3: Move the list pins into the package's test**

`packages/composition/src/composition.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FISCAL_VOCABULARY } from "@waitron/fiscal-verifactu";
import { manifestSets } from "@waitron/migrations";
import { orderedMigrationSets } from "@waitron/module";
import { WORKFORCE_ES_VOCABULARY } from "@waitron/workforce-es";
import { ALL_MODULES } from "./modules.js";

describe("ALL_MODULES is the migration source of truth", () => {
  it("derives exactly the manifest's sets, in order", () => {
    expect(orderedMigrationSets(ALL_MODULES)).toEqual(manifestSets());
  });
  it("lists the manifest's module names in order", () => {
    expect(ALL_MODULES.map((m) => m.name)).toEqual(manifestSets().map((s) => s.name));
  });
});

describe("ALL_MODULES backup contribution", () => {
  it("core declares the media store as non-DB backup state", () => {
    const core = ALL_MODULES.find((m) => m.name === "core");
    expect(core?.backup?.nonDbState).toEqual([{ kind: "content-addressed-dir", source: "media" }]);
  });
  it("a module may omit backup (open contribution set)", () => {
    const sync = ALL_MODULES.find((m) => m.name === "sync");
    expect(sync?.backup).toBeUndefined();
  });
});

describe("ALL_MODULES vocabulary seat", () => {
  it("fiscal declares the fiscal module's own vocabulary, by reference", () => {
    const fiscal = ALL_MODULES.find((m) => m.name === "fiscal");
    expect(fiscal?.vocabulary).toBe(FISCAL_VOCABULARY);
  });
  it("workforce-es declares the Spain labour module's own vocabulary, by reference", () => {
    const wfes = ALL_MODULES.find((m) => m.name === "workforce-es");
    expect(wfes?.vocabulary).toBe(WORKFORCE_ES_VOCABULARY);
  });
});
```

`apps/server/src/modules.test.ts` keeps only the `MODULE_BY_TABLE` describe block (delete the other three and the now-unused imports).

- [ ] **Step 4: Register the package with CI and the root guards**

`scripts/changed-scope.mjs`: append `"@waitron/composition",` to `LIGHT_B_PACKAGES` after `"@waitron/sync-enrolment",`.

`.github/workflows/ci.yml`: in `test-light-a`'s `# LIGHT_B_PACKAGES` block, after `set -- "$@" --filter "!@waitron/sync-enrolment"`, add `set -- "$@" --filter "!@waitron/composition"`. (`scripts/ci-workflow.test.mjs:515-516` pins both shards' exclusion sets against the `.mjs` lists, so a mismatch fails the root project.)

`scripts/english-only.test.ts` and `scripts/module-graph-honesty.test.ts`: change `import { ALL_MODULES } from "../apps/server/src/modules.js";` to `import { ALL_MODULES } from "../packages/composition/src/index.js";`. Do NOT add `composition` to the generic-package pin in `english-only.test.ts` — a composition list names every module by construction (spec §4).

- [ ] **Step 5: Install and verify**

```bash
pnpm install
pnpm --filter @waitron/composition lint && pnpm --filter @waitron/composition typecheck && pnpm --filter @waitron/composition test:coverage
pnpm --filter @waitron/server typecheck && pnpm --filter @waitron/server test modules
pnpm vitest run           # root project: ci-workflow, english-only, module-graph-honesty, coverage-thresholds
pnpm format:check
```

Expected: all green; `coverage-thresholds` now lists `@waitron/composition` at the floor; `ci-workflow` "nothing runs twice" passes.

- [ ] **Step 6: Commit**

```bash
git add packages/composition apps/server/src/modules.ts apps/server/src/modules.test.ts apps/server/package.json scripts/changed-scope.mjs .github/workflows/ci.yml scripts/english-only.test.ts scripts/module-graph-honesty.test.ts pnpm-lock.yaml
git commit -s -m "SP-3c: move the composition list into @waitron/composition"
```

---

### Task 2: The `provisioning` and `fiscal` seats, and `fiscalSlot`

**Files:**
- Create: `packages/module/src/provisioning.ts`, `packages/module/src/fiscal-slot.ts`, `packages/module/src/fiscal-slot.test.ts`
- Create: `packages/fiscal/src/contribution.ts`
- Modify: `packages/module/src/module.ts` (seats), `packages/module/src/index.ts`, `packages/module/src/errors.ts`, `packages/module/src/errors.test.ts`, `packages/module/package.json`
- Modify: `packages/fiscal/src/index.ts`

**Interfaces:**
- Produces (`@waitron/module`): `ProvisionedNode`, `NodeSeed`, `StandbyReservation`, `StandbyProvisioning`, `ModuleProvisioning`; `WaitronModule.provisioning?: ModuleProvisioning`; `WaitronModule.fiscal?: FiscalContribution`; `fiscalSlot(modules: readonly WaitronModule[], stamped: string | null): FiscalContribution`.
- Produces (`@waitron/fiscal`): `FiscalBackendDeps { db: Database; clock: TrustedClock; environment: DeploymentEnvironment }`, `FiscalContribution { readonly id: string; makeBackend(deps: FiscalBackendDeps): FiscalBackend }`.

- [ ] **Step 1: Write the failing `fiscalSlot` test**

`packages/module/src/fiscal-slot.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import type { FiscalBackend, FiscalContribution } from "@waitron/fiscal";
import { fiscalSlot } from "./fiscal-slot.js";
import type { WaitronModule } from "./module.js";

const contribution = (id: string): FiscalContribution => ({
  id,
  makeBackend: () => ({ id }) as unknown as FiscalBackend,
});

function module(name: string, fiscal?: FiscalContribution): WaitronModule {
  return {
    name,
    version: "0.0.0",
    tier: "toggleable",
    migrations: { name, table: `__drizzle_migrations_${name}`, from: `../${name}/drizzle` },
    ...(fiscal === undefined ? {} : { fiscal }),
  };
}

const CORE = module("core");
const A = module("a", contribution("a"));
const B = module("b", contribution("b"));

describe("fiscalSlot", () => {
  it("selects the one module declaring a fiscal contribution", () => {
    expect(fiscalSlot([CORE, A], null)).toBe(A.fiscal);
  });

  it("accepts a stamped filing module that matches the selected id", () => {
    expect(fiscalSlot([CORE, A], "a")).toBe(A.fiscal);
  });

  it("throws module.fiscal_slot_empty when no module contributes", () => {
    const err = (() => {
      try {
        fiscalSlot([CORE], null);
        return undefined;
      } catch (e) {
        return e;
      }
    })();
    expect(isAppError(err) && err.code).toBe("module.fiscal_slot_empty");
  });

  it("throws module.fiscal_slot_ambiguous naming both candidates when two contribute", () => {
    expect(() => fiscalSlot([A, B], null)).toThrow(
      expect.objectContaining({
        code: "module.fiscal_slot_ambiguous",
        params: { candidates: ["a", "b"] },
      }),
    );
  });

  it("throws module.fiscal_slot_mismatch when the node was stamped for another regime", () => {
    expect(() => fiscalSlot([CORE, A], "b")).toThrow(
      expect.objectContaining({
        code: "module.fiscal_slot_mismatch",
        params: { stamped: "b", enabled: "a" },
      }),
    );
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @waitron/module test fiscal-slot`
Expected: FAIL — `Cannot find module './fiscal-slot.js'` (and `@waitron/fiscal` unresolved until Step 3's dependency lands).

- [ ] **Step 3: Add the dependencies and the contribution type**

`packages/module/package.json` `dependencies`: add `"@waitron/db": "workspace:*"` and `"@waitron/fiscal": "workspace:*"` (alphabetical). Run `pnpm install`.

`packages/fiscal/src/contribution.ts`:

```ts
import type { Database, DeploymentEnvironment } from "@waitron/db";
import type { FiscalBackend } from "./backend.js";
import type { TrustedClock } from "./clock.js";

/** What a host supplies to build the sale-path backend. */
export interface FiscalBackendDeps {
  readonly db: Database;
  readonly clock: TrustedClock;
  /** Which deployment this host is — the value a regime stamps on what it records. */
  readonly environment: DeploymentEnvironment;
}

/**
 * A module's contribution to the fiscal slot — the one provision-only, swappable slot. Exactly one
 * enabled module fills it; the framework selects it and refuses zero or two.
 */
export interface FiscalContribution {
  /** The backend's identifying string: what `sales.fiscal_backend` records and what provisioning
   * stamps into `nodes.filing_module`. Equals `makeBackend(...).id`. */
  readonly id: string;
  /** The SALE-PATH backend: it records locally and never contacts an authority — nothing external
   * may block a sale. The duty that does contact one is a separate, later seat. */
  makeBackend(deps: FiscalBackendDeps): FiscalBackend;
}
```

`packages/fiscal/src/index.ts`: add `export type { FiscalBackendDeps, FiscalContribution } from "./contribution.js";`.

- [ ] **Step 4: Add the seat types and `fiscalSlot`**

`packages/module/src/provisioning.ts`:

```ts
import type { Transaction } from "@waitron/db";
import type { LocationId, NodeId, TenantId } from "@waitron/shared";

/** The node a seed runs for. Built by the RUNNER from rows it inserted or read — never from operator
 * input; anything else a module needs (the tenant's tax id, its own product constants) it reads or
 * owns itself. */
export interface ProvisionedNode {
  readonly tenantId: TenantId;
  readonly locationId: LocationId;
  readonly nodeId: NodeId;
}

/** A per-node seed: what a module establishes for a freshly created (or reimaged) node. */
export interface NodeSeed {
  /** One line for the operator's plan summary. Names the effect, not the mechanism. */
  readonly summary: string;
  /** Runs INSIDE the caller's provisioning transaction, after the core rows exist. Returns a one-line
   * report of what it established. Re-running for an existing node is the module's call to define,
   * never an error here. */
  run(tx: Transaction, node: ProvisionedNode): Promise<string>;
}

export interface StandbyReservation {
  /** Module-owned, opaque to the carrier, JSON-serialisable (it rides the mirror bundle). */
  readonly state: unknown;
  /** The standby's invoice series, codes derived disjoint from the primary's by the module; the
   * carrier inserts them. */
  readonly series?: readonly { readonly code: string; readonly purpose: string }[];
}

/** Standby support: the primary reserves, the mirror establishes. Declared together — a module that
 * reserves state must know how to establish it. */
export interface StandbyProvisioning {
  /** Primary side, inside the bundle-minting transaction. */
  reserve(tx: Transaction, primary: ProvisionedNode): Promise<StandbyReservation>;
  /** Mirror side, inside the adopt transaction, after the standby's own node row exists. `state` is
   * wire input the module validates before writing anything. */
  establish(tx: Transaction, standby: ProvisionedNode, state: unknown): Promise<void>;
}

export interface ModuleProvisioning {
  readonly seed?: NodeSeed;
  readonly standby?: StandbyProvisioning;
}
```

`packages/module/src/fiscal-slot.ts`:

```ts
import { AppError } from "@waitron/shared";
import type { FiscalContribution } from "@waitron/fiscal";
import type { WaitronModule } from "./module.js";
import "./errors.js";

/**
 * The fiscal slot: exactly one of `modules` (the ENABLED set) declares a `fiscal` contribution.
 * `stamped` is the node's `filing_module` — non-null and different from the candidate's id means the
 * node was provisioned under another regime, whose records this one cannot take back; null (a bare
 * fixture node) skips the check.
 */
export function fiscalSlot(
  modules: readonly WaitronModule[],
  stamped: string | null,
): FiscalContribution {
  const candidates = modules.filter((m) => m.fiscal !== undefined);
  if (candidates.length === 0) throw new AppError("module.fiscal_slot_empty", {});
  if (candidates.length > 1) {
    throw new AppError("module.fiscal_slot_ambiguous", {
      candidates: candidates.map((m) => m.name),
    });
  }
  const slot = candidates[0]!.fiscal!;
  if (stamped !== null && stamped !== slot.id) {
    throw new AppError("module.fiscal_slot_mismatch", { stamped, enabled: slot.id });
  }
  return slot;
}
```

`packages/module/src/module.ts`: add `import type { FiscalContribution } from "@waitron/fiscal";` and `import type { ModuleProvisioning } from "./provisioning.js";`. Replace `readonly provisioningSeeds?: unknown; // SP-1b` with:

```ts
  /** What this module seeds per node at provisioning, and how it takes part in standing up a
   * standby. Run by `@waitron/provisioning` and the composition root inside their transactions. */
  readonly provisioning?: ModuleProvisioning;
  /** The module's contribution to the fiscal slot — `fiscalSlot` selects exactly one. */
  readonly fiscal?: FiscalContribution;
```

Also rewrite the interface's header paragraph "Where the descriptors LIVE in SP-1a…" to: `The descriptors are assembled in one list, `@waitron/composition`'s `ALL_MODULES`; each owning package exports the VALUES its seats carry (enrolment, vocabulary, provisioning, fiscal) and never the descriptor itself.`

`packages/module/src/errors.ts`: add inside `ErrorParams`:

```ts
    /** No enabled module contributes to the fiscal slot. A trading node needs one; "no regime" is
     * itself a module, never an absent slot. */
    "module.fiscal_slot_empty": Record<string, never>;
    /** More than one enabled module contributes to the fiscal slot; `candidates` names them. */
    "module.fiscal_slot_ambiguous": { candidates: readonly string[] };
    /** The node's stamped filing module (`stamped`) is not the enabled slot's id (`enabled`): a node
     * provisioned under one regime must not boot under another. */
    "module.fiscal_slot_mismatch": { stamped: string; enabled: string };
```

`packages/module/src/index.ts`: add

```ts
export type {
  ModuleProvisioning,
  NodeSeed,
  ProvisionedNode,
  StandbyProvisioning,
  StandbyReservation,
} from "./provisioning.js";
export { fiscalSlot } from "./fiscal-slot.js";
```

`packages/module/src/errors.test.ts`: add inside the `describe("module error registry")`:

```ts
  it("constructs the fiscal-slot codes with their params", () => {
    const empty = new AppError("module.fiscal_slot_empty", {});
    expect(isAppError(empty) && empty.code).toBe("module.fiscal_slot_empty");
    const ambiguous = new AppError("module.fiscal_slot_ambiguous", { candidates: ["a", "b"] });
    expect(isAppError(ambiguous) && ambiguous.code).toBe("module.fiscal_slot_ambiguous");
    const mismatch = new AppError("module.fiscal_slot_mismatch", { stamped: "b", enabled: "a" });
    expect(isAppError(mismatch) && mismatch.code).toBe("module.fiscal_slot_mismatch");
  });
```

- [ ] **Step 5: Run the suites**

```bash
pnpm --filter @waitron/module lint && pnpm --filter @waitron/module typecheck && pnpm --filter @waitron/module test:coverage
pnpm --filter @waitron/fiscal lint && pnpm --filter @waitron/fiscal typecheck && pnpm --filter @waitron/fiscal test:coverage
pnpm vitest run english-only errors-reachable
pnpm format:check
```

Expected: green. `no-regime-vocabulary` (in `@waitron/fiscal`'s run) passes on `contribution.ts`; `errors-reachable` still sees `packages/module/src/errors.ts` (imported by `fiscal-slot.ts` and, as before, `module.ts`/`config.ts`).

- [ ] **Step 6: Commit**

```bash
git add packages/module packages/fiscal pnpm-lock.yaml
git commit -s -m "SP-3c: typed provisioning and fiscal seats on WaitronModule; fiscalSlot selection"
```

---

### Task 3: `FiscalBackend.id` replaces the caller-supplied `fiscalBackend`

**Files:**
- Modify: `packages/fiscal/src/backend.ts` (interface), `packages/fiscal/src/testing/fake-backend.ts`
- Modify: `packages/fiscal-verifactu/src/backend.ts`, `packages/fiscal-verifactu/src/backend.test.ts`
- Modify: `packages/core/src/record-sale.ts:113-120,311`, `packages/core/src/record-correction.ts:78,251`, `packages/core/src/record-substitution.ts:80,263`, `packages/core/src/record-sale.test.ts`
- Modify: every `RecordSaleInput`/`RecordCorrectionInput`/`RecordSubstitutionInput` literal that carries `fiscalBackend:` — the list from `grep -rn "fiscalBackend:" packages apps --include='*.ts'` MINUS the direct `sales` inserts (`packages/db/src/schema/*.test.ts`, `packages/reporting/test/fixtures.ts`, `apps/server/scripts/demo-seed/seed-sales.ts`, `packages/fiscal-verifactu/src/testing/seed.ts`), which keep the column value.

**Interfaces:**
- Produces: `FiscalBackend.id: string` (`VerifactuBackend.id === "verifactu"`, `FakeFiscalBackend.id === "fake"`); `RecordSaleInput`, `RecordCorrectionInput`, `RecordSubstitutionInput` no longer have `fiscalBackend`.

- [ ] **Step 1: Write the failing tests**

In `packages/core/src/record-sale.test.ts`, add beside the "allocates the next number from the series" test (it uses the file's own `run(backend)` and `rows<T>(query)` helpers, defined at lines 160 and 195):

```ts
  it("writes the backend's own id into sales.fiscal_backend", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await run(backend);
    const [row] = await rows<{ fiscal_backend: string }>(
      sql`select fiscal_backend from sales where id = ${saleId}`,
    );
    expect(backend.id).toBe("fake");
    expect(row?.fiscal_backend).toBe(backend.id);
  });
```

In `packages/fiscal-verifactu/src/backend.test.ts`, add:

```ts
  it("identifies itself as the verifactu backend", () => {
    expect(backend.id).toBe("verifactu");
  });
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `pnpm --filter @waitron/core test record-sale` and `pnpm --filter @waitron/fiscal-verifactu test backend.test`
Expected: FAIL — `backend.id` is `undefined` (the `fiscal_backend` assertion compares `"fake"` to `undefined`).

- [ ] **Step 3: Add `id` to the interface and both implementations**

`packages/fiscal/src/backend.ts`, first member of `FiscalBackend`:

```ts
  /** This backend's identifying string — what `sales.fiscal_backend` records, and the value the
   * `backend` field of every `NodeRegistration`/`FiscalRecordRef` it returns carries. */
  readonly id: string;
```

`packages/fiscal/src/testing/fake-backend.ts`: add `readonly id = "fake";` as the first class member and replace the two `backend: "fake"` literals with `backend: this.id`.

`packages/fiscal-verifactu/src/backend.ts`: add `readonly id = BACKEND_ID;` as the first member of `VerifactuBackend` and replace the two `backend: BACKEND_ID` literals with `backend: this.id`.

- [ ] **Step 4: Remove the input field from core**

In `record-sale.ts`, delete the `fiscalBackend` doc + field from `RecordSaleInput` (lines 113-120) and change the insert to `fiscalBackend: backend.id,`. Same in `record-correction.ts` (`RecordCorrectionInput.fiscalBackend`, insert at ~251 → `backend.id`) and `record-substitution.ts` (~80, ~263). Each function already receives `backend: FiscalBackend`.

- [ ] **Step 5: Delete the input literals everywhere**

```bash
pnpm -r typecheck 2>&1 | grep "fiscalBackend" 
```

Every error is an object literal with an excess `fiscalBackend` property; delete that line. Expected sites (from the grep): `packages/payments-stripe/src/{device.wiring,hosted.wiring,wiring}.test.ts`, `packages/payments/src/{wiring,async-settle.concurrency,offline.wiring,async.wiring,manual.wiring}.test.ts`, `packages/fiscal-verifactu/test/write-path-fixtures.ts`, `packages/fiscal-verifactu/src/backend.test.ts` (4), `packages/core/test/fixtures.ts`, `packages/core/src/{incidents,record-substitution,record-void,record-correction.rls,record-correction,record-sale,record-substitution.rls,settle-sale}.test.ts`, `packages/provisioning/src/venue-apply.e2e.test.ts`, `packages/catalogue/src/integration.test.ts`, `apps/server/scripts/{record-one-sale,daily-close-z-demo,daily-close-demo,catalogue-demo,modelo-303-demo,settle-invoice-first}.ts`, `apps/server/src/{report-api.rls,report-api}.test.ts`, `apps/server/src/till-sale.ts` (3), `apps/server/src/working-order.ts`. Leave `packages/db/src/schema/*.test.ts`, `packages/reporting/test/fixtures.ts`, `apps/server/scripts/demo-seed/seed-sales.ts`, `packages/fiscal-verifactu/src/testing/seed.ts` alone — those write the `sales` column directly and typecheck clean.

- [ ] **Step 6: Verify**

```bash
pnpm -r typecheck
pnpm --filter @waitron/fiscal test:coverage && pnpm --filter @waitron/core test:coverage
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test:coverage
pnpm --filter @waitron/payments test:coverage && pnpm --filter @waitron/payments-stripe test:coverage && pnpm --filter @waitron/catalogue test:coverage
pnpm --filter @waitron/server test till-sale report-api
pnpm lint && pnpm format:check
```

Expected: green; the two new tests pass.

- [ ] **Step 7: Commit**

```bash
git add -A packages apps
git commit -s -m "SP-3c: FiscalBackend.id — core writes the backend's own id, callers stop restating it"
```

---

### Task 4: The fiscal package's contributions — `FISCAL_PROVISIONING`, `FISCAL_SLOT`, validated `registerSif`

**Files:**
- Create: `packages/fiscal-verifactu/src/provisioning.ts`, `packages/fiscal-verifactu/src/provisioning.test.ts`, `packages/fiscal-verifactu/src/slot.ts`, `packages/fiscal-verifactu/src/slot.test.ts`
- Modify: `packages/fiscal-verifactu/src/registro-sif.ts` (validate `idSistemaInformatico`), `packages/fiscal-verifactu/src/registro-sif.test.ts`, `packages/fiscal-verifactu/src/errors.ts`, `packages/fiscal-verifactu/src/index.ts`, `packages/fiscal-verifactu/package.json` (add `@waitron/module`)
- Modify: `apps/server/src/errors.ts:112-128` (delete `sif.id_sistema_invalid` — it moves)
- Modify: `packages/composition/src/modules.ts` (fiscal descriptor gains both seats), `packages/composition/src/composition.test.ts` (pins)

**Interfaces:**
- Consumes: `ModuleProvisioning`, `ProvisionedNode`, `StandbyReservation` (`@waitron/module`); `FiscalContribution`, `FiscalBackendDeps` (`@waitron/fiscal`); `FiscalBackend.id` (Task 3).
- Produces: `WAITRON_ID_SISTEMA = "W1"`, `FISCAL_PROVISIONING: ModuleProvisioning`, `FISCAL_SLOT: FiscalContribution`, `rejectResolveClient(): Promise<never>` from `@waitron/fiscal-verifactu`; `registerSif` throws `sif.id_sistema_invalid { value, maxLength }`; `establish` throws `sif.reservation_invalid { reason }`; `ALL_MODULES`'s `fiscal` descriptor carries `provisioning: FISCAL_PROVISIONING, fiscal: FISCAL_SLOT`.

- [ ] **Step 1: Write the failing tests**

`packages/fiscal-verifactu/src/provisioning.test.ts` (PGlite, one database per test — the counter under test is monotonic, the same reason `registro-sif.test.ts` gives):

```ts
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPgliteDb, runMigrations, withTenant } from "@waitron/db";
import { isAppError, locationId as brandLocationId } from "@waitron/shared";
import type { ProvisionedNode } from "@waitron/module";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { TENANT_A, seedTenants } from "../test/fixtures.js";
import { FISCAL_PROVISIONING, WAITRON_ID_SISTEMA } from "./provisioning.js";
import { currentSif } from "./registro-sif.js";

let db: Awaited<ReturnType<typeof createPgliteDb>>;

const NODE: ProvisionedNode = {
  tenantId: TENANT_A.id,
  locationId: brandLocationId(TENANT_A.locationId),
  nodeId: TENANT_A.nodeId,
};
const NODE_2: ProvisionedNode = { ...NODE, nodeId: TENANT_A.nodeId2 };

const seed = FISCAL_PROVISIONING.seed!;
const standby = FISCAL_PROVISIONING.standby!;

beforeEach(async () => {
  db = await createPgliteDb();
  for (const migrations of TEST_MIGRATIONS) await runMigrations(db, migrations);
  await seedTenants(db);
});

afterEach(async () => {
  if (db !== undefined) await db.close();
});

describe("FISCAL_PROVISIONING.seed", () => {
  it("names its effect for the operator's plan", () => {
    expect(seed.summary).toMatch(/SIF/);
  });

  it("registers the node as a SIF under the tenant's own tax id and the product's software id", async () => {
    const report = await withTenant(db, TENANT_A.id, (tx) => seed.run(tx, NODE));
    const sif = await withTenant(db, TENANT_A.id, (tx) => currentSif(tx, TENANT_A.id, TENANT_A.nodeId));
    expect(sif.nif).toBe("89890001K"); // seedTenants' tax_id for TENANT_A, never an argument
    expect(sif.idSistemaInformatico).toBe(WAITRON_ID_SISTEMA);
    expect(sif.numeroInstalacion).toBe(1);
    expect(report).toContain(sif.id);
    expect(report).toContain("installation 1");
  });

  it("re-seeding an existing node mints a fresh installation number and a new chain", async () => {
    await withTenant(db, TENANT_A.id, (tx) => seed.run(tx, NODE));
    await withTenant(db, TENANT_A.id, (tx) => seed.run(tx, NODE));
    const sif = await withTenant(db, TENANT_A.id, (tx) => currentSif(tx, TENANT_A.id, TENANT_A.nodeId));
    expect(sif.numeroInstalacion).toBe(2);
    const head = await db.execute<{ h: string | null }>(
      sql`select ultima_huella as h from cadenas where node_id = ${TENANT_A.nodeId}`,
    );
    expect(head.rows[0]?.h).toBeNull();
  });
});

describe("FISCAL_PROVISIONING.standby", () => {
  beforeEach(async () => {
    // The primary must hold a live SIF and its series before it can reserve for a standby.
    await withTenant(db, TENANT_A.id, (tx) => seed.run(tx, NODE));
    await db.execute(sql`
      insert into invoice_series (tenant_id, node_id, code, purpose) values
        (${TENANT_A.id}, ${TENANT_A.nodeId}, 'FA', 'standard'),
        (${TENANT_A.id}, ${TENANT_A.nodeId}, 'RF', 'rectificative')`);
  });

  it("reserves a fresh number and derives disjoint series codes from the primary's", async () => {
    const r = await withTenant(db, TENANT_A.id, (tx) => standby.reserve(tx, NODE));
    expect(r.state).toEqual({ nif: "89890001K", idSistemaInformatico: "W1", numeroInstalacion: 2 });
    expect(r.series?.map((s) => s.code).sort()).toEqual(["FA-2", "RF-2"]);
    expect(r.series?.find((s) => s.code === "RF-2")?.purpose).toBe("rectificative");
  });

  it("establishes the reserved SIF on the standby's own node with the reserved number", async () => {
    const r = await withTenant(db, TENANT_A.id, (tx) => standby.reserve(tx, NODE));
    await withTenant(db, TENANT_A.id, (tx) => standby.establish(tx, NODE_2, r.state));
    const sif = await withTenant(db, TENANT_A.id, (tx) => currentSif(tx, TENANT_A.id, TENANT_A.nodeId2));
    expect(sif.numeroInstalacion).toBe(2);
    expect(sif.nif).toBe("89890001K");
  });

  it.each([
    ["absent", undefined],
    ["not an object", "W1/2"],
    ["missing the number", { nif: "89890001K", idSistemaInformatico: "W1" }],
    ["a non-positive number", { nif: "89890001K", idSistemaInformatico: "W1", numeroInstalacion: 0 }],
    ["a fractional number", { nif: "89890001K", idSistemaInformatico: "W1", numeroInstalacion: 1.5 }],
  ])("refuses a reservation state that is %s, writing nothing", async (_label, state) => {
    const err = await withTenant(db, TENANT_A.id, (tx) => standby.establish(tx, NODE_2, state)).catch(
      (e: unknown) => e,
    );
    expect(isAppError(err) && err.code).toBe("sif.reservation_invalid");
    const rows = await db.execute(sql`select 1 from registro_sif where node_id = ${TENANT_A.nodeId2}`);
    expect(rows.rows).toEqual([]);
  });
});
```

`packages/fiscal-verifactu/src/slot.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Database } from "@waitron/db";
import type { TrustedClock } from "@waitron/fiscal";
import { VerifactuBackend } from "./backend.js";
import { FISCAL_SLOT, rejectResolveClient } from "./slot.js";

// `makeBackend` only CONSTRUCTS the backend (no connection is opened until a method runs).
const STUB_DB = {} as Database;
const clock: TrustedClock = {
  now: () => ({
    instant: new Date(),
    offsetMinutes: 0,
    confident: true,
    confidence: "anchored",
    anchorAgeSeconds: 0,
  }),
  anchor: () => {
    throw new Error("slot.test: anchor() is unused");
  },
  currentAnchor: () => null,
};

describe("FISCAL_SLOT", () => {
  it("builds a VerifactuBackend whose id is the slot's id", () => {
    const backend = FISCAL_SLOT.makeBackend({ db: STUB_DB, clock, environment: "preproduction" });
    expect(backend).toBeInstanceOf(VerifactuBackend);
    expect(backend.id).toBe(FISCAL_SLOT.id);
    expect(FISCAL_SLOT.id).toBe("verifactu");
  });

  it("never resolves an AEAT client on the sale path", async () => {
    await expect(rejectResolveClient()).rejects.toThrow(/never be called/);
  });
});
```

In `packages/fiscal-verifactu/src/registro-sif.test.ts`, add inside `describe("registerSif")`:

```ts
  it.each([
    ["longer than two characters", "WTRN01"],
    ["empty", ""],
  ])("refuses an IdSistemaInformatico that is %s, before writing anything", async (_label, bad) => {
    const err = await withTenant(db, TENANT_A.id, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, idSistemaInformatico: bad, tenantId: TENANT_A.id, nodeId: TENANT_A.nodeId }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("sif.id_sistema_invalid");
    expect((err as AppError).params).toEqual({ value: bad, maxLength: 2 });
    const written = await db.execute(sql`select 1 from registro_sif where node_id = ${TENANT_A.nodeId}`);
    expect(written.rows).toEqual([]);
  });
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test provisioning slot registro-sif`
Expected: FAIL — `provisioning.js`/`slot.js` not found; the `registerSif` validation cases pass through to a successful insert.

- [ ] **Step 3: Registry, dependency, validation**

`packages/fiscal-verifactu/package.json` `dependencies`: add `"@waitron/module": "workspace:*"`; `pnpm install`.

`packages/fiscal-verifactu/src/errors.ts`, inside `ErrorParams` beside `sif.not_registered`:

```ts
    /** `IdSistemaInformatico` is empty or longer than AEAT's two-character cap
     * (`packages/verifactu`'s `ID_SISTEMA_LENGTH`). Checked by `registerSif` because nothing
     * downstream re-checks it: the column carries no CHECK and every registro copies the value. */
    "sif.id_sistema_invalid": { value: string; maxLength: number };
    /** A standby's reserved SIF state arrived from the primary malformed (the mirror bundle is wire
     * input). `reason` is our own English description, never the payload. */
    "sif.reservation_invalid": { reason: string };
```

Delete the `sif.id_sistema_invalid` entry and its doc comment from `apps/server/src/errors.ts` (lines 112-128). `apps/server/src/provision-till.ts` still throws the code until Task 6 and keeps compiling: the fiscal package's registry augments the same `ErrorParams`.

`packages/fiscal-verifactu/src/registro-sif.ts`: add near the top

```ts
/** AEAT caps `IdSistemaInformatico` at two characters (`packages/verifactu`'s `ID_SISTEMA_LENGTH`). */
const ID_SISTEMA_MAX_LENGTH = 2;

function assertUsableIdSistema(value: string): void {
  if (value.length === 0 || value.length > ID_SISTEMA_MAX_LENGTH) {
    throw new AppError("sif.id_sistema_invalid", { value, maxLength: ID_SISTEMA_MAX_LENGTH });
  }
}
```

and make `assertUsableIdSistema(params.idSistemaInformatico);` the first statement of `registerSif` (before the revoke UPDATE).

- [ ] **Step 4: The contributions**

`packages/fiscal-verifactu/src/provisioning.ts`:

```ts
import { eq } from "drizzle-orm";
import { invoiceSeries, tenants, type Transaction } from "@waitron/db";
import type { ModuleProvisioning, ProvisionedNode, StandbyReservation } from "@waitron/module";
import { AppError } from "@waitron/shared";
import "./errors.js";
import {
  currentSif,
  registerSif,
  reserveInstallationNumber,
  writeReservedSif,
} from "./registro-sif.js";
import { deriveReservedSeriesCodes } from "./reserved-series.js";

/** Waitron's own AEAT-registered software identifier (FAQ §4, ≤ 2 chars): a product constant, never
 * operator input. It reaches `registro_sif.id_sistema_informatico` through `registerSif` and, from
 * there, `IdSistemaInformatico` on every registro the node files. */
export const WAITRON_ID_SISTEMA = "W1";

/** The obligado's NIF: `tenants.tax_id` for an ES tenant. Read here, never an argument — an
 * operator-supplied NIF would file a real tenant's sales under someone else's. */
async function obligadoNif(tx: Transaction, node: ProvisionedNode): Promise<string> {
  const [row] = await tx
    .select({ taxId: tenants.taxId })
    .from(tenants)
    .where(eq(tenants.id, node.tenantId));
  /* v8 ignore start */
  if (row === undefined) {
    // Unreachable through the runners: the node row FKs the tenant, and both runners check the node
    // exists before seeding.
    throw new Error(`fiscal seed: tenant ${node.tenantId} has no row`);
  }
  /* v8 ignore stop */
  return row.taxId;
}

/** The dormant identity the primary reserves for a standby; rides the mirror bundle as opaque state. */
interface ReservedSifState {
  nif: string;
  idSistemaInformatico: string;
  numeroInstalacion: number;
}

function parseReservedState(state: unknown): ReservedSifState {
  if (state === undefined) {
    throw new AppError("sif.reservation_invalid", { reason: "no reservation state for the fiscal module" });
  }
  if (typeof state !== "object" || state === null || Array.isArray(state)) {
    throw new AppError("sif.reservation_invalid", { reason: "reservation state is not an object" });
  }
  const { nif, idSistemaInformatico, numeroInstalacion } = state as Record<string, unknown>;
  if (typeof nif !== "string" || nif.length === 0) {
    throw new AppError("sif.reservation_invalid", { reason: "nif is not a non-empty string" });
  }
  if (typeof idSistemaInformatico !== "string" || idSistemaInformatico.length === 0) {
    throw new AppError("sif.reservation_invalid", {
      reason: "idSistemaInformatico is not a non-empty string",
    });
  }
  if (!Number.isInteger(numeroInstalacion) || (numeroInstalacion as number) < 1) {
    throw new AppError("sif.reservation_invalid", {
      reason: "numeroInstalacion is not a positive integer",
    });
  }
  return { nif, idSistemaInformatico, numeroInstalacion: numeroInstalacion as number };
}

/**
 * The fiscal module's provisioning contribution. `seed` registers the node as a SIF — for an
 * existing node that means a FRESH installation number and a new chain (a reimaged box); it never
 * resumes anyone's. `standby.reserve` runs on the PRIMARY (the sole allocator per NIF) and
 * `standby.establish` writes the reserved, dormant SIF on the mirror.
 */
export const FISCAL_PROVISIONING: ModuleProvisioning = {
  seed: {
    summary: "register the node as a Veri*Factu SIF and start its chain",
    async run(tx, node) {
      const sif = await registerSif(tx, {
        tenantId: node.tenantId,
        nodeId: node.nodeId,
        nif: await obligadoNif(tx, node),
        idSistemaInformatico: WAITRON_ID_SISTEMA,
      });
      return `SIF ${sif.id} (installation ${sif.numeroInstalacion})`;
    },
  },
  standby: {
    async reserve(tx, primary): Promise<StandbyReservation> {
      const primarySif = await currentSif(tx, primary.tenantId, primary.nodeId);
      const numeroInstalacion = await reserveInstallationNumber(tx, {
        nif: primarySif.nif,
        idSistemaInformatico: primarySif.idSistemaInformatico,
      });
      const primarySeries = await tx
        .select({ code: invoiceSeries.code, purpose: invoiceSeries.purpose })
        .from(invoiceSeries)
        .where(eq(invoiceSeries.nodeId, primary.nodeId));
      const state: ReservedSifState = {
        nif: primarySif.nif,
        idSistemaInformatico: primarySif.idSistemaInformatico,
        numeroInstalacion,
      };
      return { state, series: deriveReservedSeriesCodes(primarySeries, numeroInstalacion) };
    },
    async establish(tx, standby, state) {
      const reserved = parseReservedState(state);
      await writeReservedSif(tx, {
        tenantId: standby.tenantId,
        nodeId: standby.nodeId,
        nif: reserved.nif,
        idSistemaInformatico: reserved.idSistemaInformatico,
        numeroInstalacion: reserved.numeroInstalacion,
      });
    },
  },
};
```

`packages/fiscal-verifactu/src/slot.ts`:

```ts
import type { FiscalContribution } from "@waitron/fiscal";
import { VerifactuBackend } from "./backend.js";

/**
 * The sale path never contacts AEAT — only `drain`/`reconcile` do, and the backend built here is
 * handed to neither (the host's fiscal pass builds its own transport). Reaching this is a bug in the
 * host or the backend, so it rejects loudly rather than ever returning a usable client.
 */
export function rejectResolveClient(): Promise<never> {
  return Promise.reject(new Error("fiscal slot: resolveClient must never be called by recordSale"));
}

/** The fiscal module's slot contribution: the Veri*Factu sale-path backend. Both `environment`
 * (the QR validation host) and `deploymentEnvironment` (the `entorno` stamped on every registro)
 * take the host's deployment, so a preproduction box never files as production. */
export const FISCAL_SLOT: FiscalContribution = {
  id: "verifactu",
  makeBackend: ({ db, clock, environment }) =>
    new VerifactuBackend({
      clock,
      db,
      environment,
      deploymentEnvironment: environment,
      resolveClient: rejectResolveClient,
    }),
};
```

`packages/fiscal-verifactu/src/index.ts`: add

```ts
export { FISCAL_PROVISIONING, WAITRON_ID_SISTEMA } from "./provisioning.js";
export { FISCAL_SLOT, rejectResolveClient } from "./slot.js";
```

`packages/composition/src/modules.ts`: import `FISCAL_PROVISIONING, FISCAL_SLOT` beside `FISCAL_ENROLMENT` and add to the `fiscal` descriptor:

```ts
    provisioning: FISCAL_PROVISIONING,
    fiscal: FISCAL_SLOT,
```

`packages/composition/src/composition.test.ts`: add

```ts
describe("ALL_MODULES provisioning and fiscal seats", () => {
  it("fiscal declares its provisioning contribution and fills the fiscal slot, by reference", () => {
    const fiscal = ALL_MODULES.find((m) => m.name === "fiscal");
    expect(fiscal?.provisioning).toBe(FISCAL_PROVISIONING);
    expect(fiscal?.fiscal).toBe(FISCAL_SLOT);
  });
  it("exactly one module fills the fiscal slot", () => {
    expect(ALL_MODULES.filter((m) => m.fiscal !== undefined).map((m) => m.name)).toEqual(["fiscal"]);
  });
});
```

- [ ] **Step 5: Verify**

```bash
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu lint && pnpm --filter @waitron/fiscal-verifactu typecheck && TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test:coverage
pnpm --filter @waitron/composition test:coverage && pnpm --filter @waitron/server typecheck
pnpm vitest run errors-reachable english-only
pnpm format:check
```

Expected: green; fiscal-verifactu stays at 98/98/98/95 (the v8-ignored unreachable branch is the only uncovered line).

- [ ] **Step 6: Commit**

```bash
git add packages/fiscal-verifactu packages/composition apps/server/src/errors.ts pnpm-lock.yaml
git commit -s -m "SP-3c: fiscal package exports FISCAL_PROVISIONING and FISCAL_SLOT; registerSif validates its software id"
```

---

### Task 5: `@waitron/provisioning` becomes a generic runner

**Files:**
- Modify: `packages/provisioning/src/venue-plan.ts`, `packages/provisioning/src/venue-apply.ts`, `packages/provisioning/src/fiscal-modules.ts`, `packages/provisioning/src/cli.ts`, `packages/provisioning/src/bin.ts`, `packages/provisioning/src/errors.ts`, `packages/provisioning/src/index.ts`, `packages/provisioning/package.json`
- Modify tests: `venue-plan.test.ts`, `venue-apply.test.ts`, `venue-apply.e2e.test.ts`, `cli.test.ts`, `fiscal-modules.test.ts`
- Modify callers: `apps/server/src/provision.ts`, `apps/server/src/provision.test.ts`, `apps/server/scripts/{dev-setup,park-retrieve-demo,catalogue-demo,till-demo,integrated-card-demo}.ts`, and every `apps/server/src/*.test.ts` that calls `planVenue(`/`applyVenue(` (42 files; `grep -rln "planVenue(\|applyVenue(" apps/server/src/*.test.ts`)

**Interfaces:**
- Consumes: `WaitronModule`, `ProvisionedNode` (`@waitron/module`); `ALL_MODULES` (`@waitron/composition`); `FISCAL_PROVISIONING` (Task 4, in tests).
- Produces: `planVenue(request: VenueRequest, modules: readonly WaitronModule[]): VenueAction[]`; `VenueAction |= { kind: "seed-module"; module: string; summary: string }` (and `register-sif` is gone); `VenueApplyDeps { db: Database; modules: readonly WaitronModule[] }`; `VenueResult { tenantId; locationId; tillId; nodeId; seriesIds: string[]; seeded: readonly { module: string; report: string }[] }` (no `sif`); `CliDeps.modules: readonly WaitronModule[]`; `FISCAL_TERRITORIES: readonly string[]`.

- [ ] **Step 1: Write the failing plan tests**

In `packages/provisioning/src/venue-plan.test.ts`, add a fake module list at the top and pass it to every `planVenue(request(...))` call (`planVenue(request(), MODULES)`):

```ts
import type { WaitronModule } from "@waitron/module";

function fakeModule(name: string, seed?: { summary: string }): WaitronModule {
  return {
    name,
    version: "0.0.0",
    tier: "toggleable",
    migrations: { name, table: `__drizzle_migrations_${name}`, from: `../${name}/drizzle` },
    ...(seed === undefined
      ? {}
      : { provisioning: { seed: { summary: seed.summary, run: async () => "done" } } }),
  };
}

const MODULES: readonly WaitronModule[] = [
  fakeModule("core"),
  fakeModule("probe", { summary: "seed the probe" }),
];
```

Change the ordering test's expected list to end `"create-node", "create-series", "create-series", "seed-module"` (no `register-sif`), and add:

```ts
  it("emits one seed-module per module declaring a seed, last, in list order, carrying its summary", () => {
    const seeds = planVenue(
      request(),
      [fakeModule("b", { summary: "seed b" }), fakeModule("core"), fakeModule("a", { summary: "seed a" })],
    ).filter((a) => a.kind === "seed-module");
    expect(seeds).toEqual([
      { kind: "seed-module", module: "b", summary: "seed b" },
      { kind: "seed-module", module: "a", summary: "seed a" },
    ]);
  });

  it("emits no seed-module for a list with no seeds", () => {
    expect(planVenue(request(), [fakeModule("core")]).some((a) => a.kind === "seed-module")).toBe(false);
  });

  it("describes a seed-module action by module and summary", () => {
    expect(describeVenueAction({ kind: "seed-module", module: "probe", summary: "seed the probe" })).toBe(
      "seed module probe: seed the probe",
    );
  });
```

Delete every assertion on `register-sif` / `idSistemaInformatico` in this file. In `fiscal-modules.test.ts`, delete the `WAITRON_ID_SISTEMA` describe block and add:

```ts
describe("FISCAL_TERRITORIES", () => {
  it("lists the territories the registry resolves, and resolves each of them", () => {
    expect(FISCAL_TERRITORIES).toEqual(["ES-common"]);
    for (const t of FISCAL_TERRITORIES) expect(resolveFiscalModules(t).filing).toBe("verifactu");
  });
});
```

- [ ] **Step 2: Write the failing apply tests**

In `packages/provisioning/src/venue-apply.test.ts`: import `ALL_MODULES` from `@waitron/composition` and `type WaitronModule` from `@waitron/module`; change every `applyVenue(planVenue(request(X)), { db: suite.db })` to `applyVenue(planVenue(request(X), ALL_MODULES), { db: suite.db, modules: ALL_MODULES })`. Replace `expect(result.sif.numeroInstalacion).toBeGreaterThanOrEqual(1)` and the `registro_sif where id = ${result.sif.id}` read with a read by node:

```ts
    const sif = await suite.db.execute<{ nif: string; numero_instalacion: number }>(sql`
      select nif, numero_instalacion from registro_sif where node_id = ${result.nodeId} and revocado_en is null`);
    expect(sif.rows[0]?.nif).toBe("B12345678");
    expect(sif.rows[0]?.numero_instalacion).toBeGreaterThanOrEqual(1);
    expect(result.seeded).toEqual([{ module: "fiscal", report: expect.stringMatching(/^SIF .* \(installation \d+\)$/) }]);
```

In the "distinct installation number per node" test, read both nodes' `numero_instalacion` from `registro_sif` instead of `a.sif`/`b.sif`. In the hand-built plans, replace `{ kind: "register-sif", idSistemaInformatico: "W1" }` with `{ kind: "seed-module", module: "fiscal", summary: "s" }` and the "register-sif before create-node" ordering case with `seed-module before create-node` (message `"applyVenue: seed-module before create-node"`). Then add:

```ts
  describe("seed-module runs the named module's seed inside the venue transaction", () => {
    const seeded: string[] = [];
    const recorder: WaitronModule = {
      name: "probe",
      version: "0.0.0",
      tier: "toggleable",
      migrations: { name: "probe", table: "__drizzle_migrations_probe", from: "../probe/drizzle" },
      provisioning: {
        seed: {
          summary: "record the node",
          run: async (_tx, node) => {
            seeded.push(node.nodeId);
            return `recorded ${node.nodeId}`;
          },
        },
      },
    };
    const exploding: WaitronModule = {
      ...recorder,
      name: "boom",
      migrations: { name: "boom", table: "__drizzle_migrations_boom", from: "../boom/drizzle" },
      provisioning: { seed: { summary: "explode", run: async () => { throw new Error("seed failed"); } } },
    };

    it("runs the seed with the node it just created and reports its line", async () => {
      const modules = [...ALL_MODULES, recorder];
      const result = await applyVenue(planVenue(request("B44444444"), modules), { db: suite.db, modules });
      expect(seeded).toContain(result.nodeId);
      expect(result.seeded.map((s) => s.module)).toEqual(["fiscal", "probe"]);
      expect(result.seeded[1]).toEqual({ module: "probe", report: `recorded ${result.nodeId}` });
    });

    it("a throwing seed rolls the whole venue back — no tenant row survives", async () => {
      const modules = [...ALL_MODULES, exploding];
      const taxId = "B55555555";
      await expect(applyVenue(planVenue(request(taxId), modules), { db: suite.db, modules })).rejects.toThrow("seed failed");
      const tenant = await suite.db.execute(sql`select 1 from tenants where id = ${obligadoTenantId("ES", taxId)}`);
      expect(tenant.rows).toEqual([]);
    });

    it("refuses a plan naming a module the deps do not hold, or one without a seed", async () => {
      const plan = planVenue(request("B66666666"), [...ALL_MODULES, recorder]);
      await expect(applyVenue(plan, { db: suite.db, modules: ALL_MODULES })).rejects.toThrow(
        "applyVenue: seed-module names probe, which is not in deps.modules or declares no seed",
      );
    });
  });
```

In `venue-apply.e2e.test.ts`: `applyVenue(planVenue(request(...), ALL_MODULES), { db: suite.db, modules: ALL_MODULES })` at each of its three call sites, and replace the header paragraph beginning "Lives in `@waitron/provisioning`, NOT in `packages/fiscal-verifactu`…" with:

```ts
 * Lives in `@waitron/provisioning` because a venue that can sell is this package's success criterion.
 * The fiscal package is a devDependency here (the real backend and the real seed, via the composition
 * list); production code in this package imports no module package — `scripts/module-seams.test.ts`.
```

In `cli.test.ts`: `VENUE_RESULT` drops `sif` and gains `seeded: [{ module: "fiscal", report: "SIF 55555555-5555-5555-5555-555555555555 (installation 1)" }]`; the harness `deps` gains `modules: MODULES` (the same `fakeModule` helper as `venue-plan.test.ts`, with `probe` seeding); the actions-order assertion at ~1031 replaces `"register-sif"` (after `create-node`) with a trailing `"seed-module"`; the printed-line assertion at ~1078 becomes `expect(printed).toContain("seeded:   fiscal — SIF 55555555-5555-5555-5555-555555555555 (installation 1)")`; and the `applyDeps` capture asserts `applyDeps.modules` is `MODULES`.

- [ ] **Step 3: Run them to confirm they fail**

Run: `pnpm --filter @waitron/provisioning test venue-plan venue-apply cli fiscal-modules`
Expected: FAIL — `planVenue` ignores its second argument and still emits `register-sif`; `applyVenue` rejects the unknown action; `VenueResult.seeded` is undefined; `FISCAL_TERRITORIES` is not exported.

- [ ] **Step 4: Dependencies**

`packages/provisioning/package.json`: remove `"@waitron/fiscal-verifactu"` from `dependencies`; add `"@waitron/composition": "workspace:*"` and `"@waitron/module": "workspace:*"` to `dependencies`; add `"@waitron/fiscal-verifactu": "workspace:*"` to `devDependencies`. `pnpm install`.

- [ ] **Step 5: `fiscal-modules.ts` and the error registry**

Delete `WAITRON_ID_SISTEMA`, `ID_SISTEMA_MAX_LENGTH`, `assertUsableIdSistema` and `import "./errors.js"` from `fiscal-modules.ts`; add after `REGISTRY`:

```ts
/** The territories the registry resolves — exported so a guard can enumerate the real set. */
export const FISCAL_TERRITORIES: readonly string[] = Object.keys(REGISTRY);
```

Delete the `provisioning.id_sistema_invalid` entry (with its doc) from `packages/provisioning/src/errors.ts` and remove it from the `value`-param sibling list in the `provisioning.invalid_environment` doc (`errors.ts:93`). Export `FISCAL_TERRITORIES` from `index.ts`.

- [ ] **Step 6: `venue-plan.ts`**

Change the imports to `import { resolveFiscalModules } from "./fiscal-modules.js";` plus `import type { WaitronModule } from "@waitron/module";`. Replace the `register-sif` member of `VenueAction` with:

```ts
  /** Runs `modules[module].provisioning.seed` inside the venue transaction, after every core row.
   * `summary` is the seed's own one-line description, so the plan summary reads without the list. */
  | { kind: "seed-module"; module: string; summary: string }
```

Signature: `export function planVenue(request: VenueRequest, modules: readonly WaitronModule[]): VenueAction[]`. Delete the `assertUsableIdSistema(WAITRON_ID_SISTEMA);` block and its comment. Replace the `register-sif` element of the returned array (between `create-node` and the first `create-series`) with nothing, and append after the two `create-series` elements:

```ts
    // Module seeds run LAST, once every core row exists, one per declaring module in list order.
    ...modules.flatMap((m) =>
      m.provisioning?.seed === undefined
        ? []
        : [{ kind: "seed-module", module: m.name, summary: m.provisioning.seed.summary } as const],
    ),
```

`describeVenueAction`: replace the `register-sif` case with

```ts
    case "seed-module":
      return `seed module ${action.module}: ${action.summary}`;
```

- [ ] **Step 7: `venue-apply.ts`**

Imports: drop `registerSif`/`SifRegistration`; add `import { locationId as brandLocationId, nodeId as brandNodeId, tenantId as brandTenantId } from "@waitron/shared";` (the file already brands node/tenant) and `import type { WaitronModule } from "@waitron/module";`.

```ts
export interface VenueApplyDeps {
  db: Database;
  /** The modules whose seeds a `seed-module` action may name — the enabled set, in the composition
   * list's order. */
  modules: readonly WaitronModule[];
}

export interface VenueResult {
  tenantId: string;
  locationId: string;
  tillId: string;
  nodeId: string;
  seriesIds: string[];
  /** One entry per `seed-module` action run, in plan order: the module and its one-line report. */
  seeded: { module: string; report: string }[];
}
```

Inside the loop, replace `let sif: SifRegistration | undefined;` with `const seeded: { module: string; report: string }[] = [];` and the `register-sif` case with:

```ts
        case "seed-module": {
          // A seed before create-node would run against an EMPTY node id; refuse it as a plan-integrity
          // error like the other ordering guards.
          if (nodeId === "") throw new Error("applyVenue: seed-module before create-node");
          const seed = deps.modules.find((m) => m.name === action.module)?.provisioning?.seed;
          if (seed === undefined) {
            throw new Error(
              `applyVenue: seed-module names ${action.module}, which is not in deps.modules or declares no seed`,
            );
          }
          const report = await seed.run(tx, {
            tenantId: brandTenantId(tenantId),
            locationId: brandLocationId(locationId),
            nodeId: brandNodeId(nodeId),
          });
          seeded.push({ module: action.module, report });
          break;
        }
```

Delete `if (sif === undefined) throw new Error("applyVenue: register-sif never ran");` and return `{ tenantId, locationId, tillId, nodeId, seriesIds, seeded }`. Delete `registerSifForNode`. Rewrite the header's last sentence ("…never re-registers an existing node's SIF…") to: `each run creates a FRESH node and runs every module's seed for it, so the fiscal seed mints a new installation number and starts a new chain rather than forking one.`

- [ ] **Step 8: CLI and bin**

`cli.ts`: `CliDeps` gains

```ts
  /** The composition list (`@waitron/composition`'s `ALL_MODULES`), injected like `applyVenue`: the
   * CLI has no `modules.json`, so `venue` seeds every module in it. */
  modules: readonly WaitronModule[];
```

(`import type { WaitronModule } from "@waitron/module";`). `const actions = planVenue(request, deps.modules);`; `deps.applyVenue(actions, { db: target, modules: deps.modules })`; replace the `SIF:` line with

```ts
        for (const s of result.seeded) deps.io.stdout(`seeded:   ${s.module} — ${s.report}`);
```

`bin.ts`: `import { ALL_MODULES } from "@waitron/composition";` and `modules: ALL_MODULES,` in the `runCli` deps.

- [ ] **Step 9: Callers in `apps/server`**

`apps/server/src/provision.ts`: `import { disabledProvisionOnly, enabledModules, type ModuleConfig } from "@waitron/module";`; after the gate: `const modules = enabledModules(ALL_MODULES, deps.moduleConfig);`; `planVenue(req.venue, modules)`; `applyVenue(plan, { db: deps.ownerDb, modules })`. Header step 4: "mints tenant/location/till/node/series, runs every enabled module's seed (fiscal's registers the SIF), and returns the ids."

`apps/server/src/provision.test.ts`: `expect(result.sif).toBeDefined()` → `expect(result.seeded.map((s) => s.module)).toEqual(["fiscal"])`.

Scripts (`dev-setup.ts`, the four demos): `import { ALL_MODULES } from "../src/modules.js";`, `planVenue({...}, ALL_MODULES)`, `{ db, modules: ALL_MODULES }`.

The 42 server test files: same two edits each. Mechanical rewrite for the dominant shape (`applyVenue(\n planVenue({…}),\n { db: X },\n)`):

```bash
cd apps/server && perl -0pi -e 's/planVenue\((\{.*?\n\s*\})\),(\s*)\{ db: ([^}]*?) \}/planVenue($1, ALL_MODULES),$2\{ db: $3, modules: ALL_MODULES \}/gs' src/*.test.ts
```

then `pnpm --filter @waitron/server typecheck` and fix the remainder by hand (single-line calls, `return applyVenue(`); add `import { ALL_MODULES } from "./modules.js";` to each file that lacks it. `mirror-bundle.rls.test.ts`, `mirror-bundle-api.rls.test.ts`, `adopt.rls.test.ts`, `adopt-e2e.rls.test.ts` already import it.

- [ ] **Step 10: Verify**

```bash
pnpm --filter @waitron/provisioning lint && pnpm --filter @waitron/provisioning typecheck && TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/provisioning test:coverage
pnpm --filter @waitron/server typecheck && pnpm --filter @waitron/server lint
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test provision.test till-sale.test management-api.test
pnpm vitest run module-seams errors-reachable   # module-seams does not exist yet; errors-reachable must stay green
pnpm format:check
```

Expected: green. `provisioning`'s e2e chains a sale through a venue the real seed provisioned.

- [ ] **Step 11: Commit**

```bash
git add -A packages/provisioning apps/server pnpm-lock.yaml
git commit -s -m "SP-3c: provisioning runs module seeds — planVenue emits seed-module, applyVenue runs them, no fiscal import"
```

---

### Task 6: Standalone node registration on the seat (`provisionNode`, `register-till`)

**Files:**
- Modify: `apps/server/src/provision-till.ts`, `apps/server/src/provision-till.test.ts`, `apps/server/scripts/register-till.ts`

**Interfaces:**
- Produces: `provisionNode(db: Database, params: { tenantId: TenantId; nodeId: NodeId }, modules: readonly WaitronModule[]): Promise<{ module: string; report: string }[]>`.

- [ ] **Step 1: Rewrite the failing tests**

In `provision-till.test.ts`: import `ALL_MODULES` from `./modules.js`; delete `ID_SIF`; delete the `it.each` on `IdSistemaInformatico` (that guard now lives in `registerSif`, tested in the fiscal package). The three remaining tests become:

```ts
  it("runs every module's seed for the node — fiscal registers it under the tenant's own NIF", async () => {
    const { tenantId, nodeId, nif } = await bootstrapTenant();

    const seeded = await provisionNode(suite.db, { tenantId, nodeId }, ALL_MODULES);
    expect(seeded.map((s) => s.module)).toEqual(["fiscal"]);
    expect(seeded[0]!.report).toMatch(/^SIF .* \(installation 1\)$/);

    const live = await suite.db.execute<{ nif: string; id_sistema_informatico: string; numero_instalacion: number }>(
      sql`select nif, id_sistema_informatico, numero_instalacion from registro_sif
          where tenant_id = ${tenantId} and node_id = ${nodeId} and revocado_en is null`,
    );
    expect(live.rows).toEqual([{ nif, id_sistema_informatico: "W1", numero_instalacion: 1 }]);
  });

  it("refuses a node belonging to a different tenant, and writes nothing", async () => {
    const mine = await bootstrapTenant();
    const theirs = await bootstrapTenant();
    await expect(
      provisionNode(suite.db, { tenantId: mine.tenantId, nodeId: theirs.nodeId }, ALL_MODULES),
    ).rejects.toMatchObject({ code: "node.not_found", params: { id: theirs.nodeId, tenantId: mine.tenantId } });
    const written = await suite.db.execute(sql`select 1 from registro_sif where node_id = ${theirs.nodeId}`);
    expect(written.rows).toEqual([]);
  });

  it("refuses a tenant that does not exist (the node is not its)", async () => {
    const { nodeId } = await bootstrapTenant();
    await expect(
      provisionNode(suite.db, { tenantId: brandTenantId(ABSENT), nodeId }, ALL_MODULES),
    ).rejects.toMatchObject({ code: "node.not_found", params: { id: nodeId, tenantId: ABSENT } });
  });
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @waitron/server test provision-till`
Expected: FAIL — `provisionNode` still demands `idSistemaInformatico` and returns a `SifRegistration`.

- [ ] **Step 3: Implement**

`provision-till.ts` — replace the file body after the header with:

```ts
import { and, eq } from "drizzle-orm";
import { nodes, withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import type { WaitronModule } from "@waitron/module";
import { AppError, locationId as brandLocationId } from "@waitron/shared";
import type { NodeId, TenantId } from "@waitron/shared";
import "./errors.js";

export interface ProvisionNodeParams {
  tenantId: TenantId;
  nodeId: NodeId;
}

/**
 * Refuses a node this tenant does not own, and returns its location. `registro_sif` carries separate
 * foreign keys onto `tenants` and `nodes` and no composite one, so a row naming tenant A and a node of
 * tenant B satisfies both — and RLS's WITH CHECK only constrains `tenant_id`. Matching on
 * `nodes.tenant_id` explicitly is what makes this hold for a superuser too.
 */
async function ownedNodeLocation(tx: Transaction, tenantId: TenantId, nodeId: NodeId): Promise<string> {
  const [row] = await tx
    .select({ locationId: nodes.locationId })
    .from(nodes)
    .where(and(eq(nodes.id, nodeId), eq(nodes.tenantId, tenantId)));
  if (row === undefined) throw new AppError("node.not_found", { id: nodeId, tenantId });
  return row.locationId;
}

/**
 * Runs every module's per-node seed for an EXISTING node — a node with no fiscal identity yet, or a
 * reimaged one: the fiscal seed mints a fresh installation number and starts a new chain, which is
 * what a reimaged node needs. One transaction; the caller decides whether re-running is wanted.
 */
export async function provisionNode(
  db: Database,
  params: ProvisionNodeParams,
  modules: readonly WaitronModule[],
): Promise<{ module: string; report: string }[]> {
  return withTenant(db, params.tenantId, async (tx) => {
    const locationId = await ownedNodeLocation(tx, params.tenantId, params.nodeId);
    const node = { tenantId: params.tenantId, locationId: brandLocationId(locationId), nodeId: params.nodeId };
    const seeded: { module: string; report: string }[] = [];
    for (const m of modules) {
      if (m.provisioning?.seed === undefined) continue;
      seeded.push({ module: m.name, report: await m.provisioning.seed.run(tx, node) });
    }
    return seeded;
  });
}
```

Rewrite the file header to three sentences: what the standalone path is for (a node with no fiscal identity, or a reimaged one), that `waitron-provision venue` covers a fresh venue, and that `scripts/register-till.ts` is the argv shim.

`register-till.ts`: two arguments (`<tenantId> <nodeId>`), `usageError` text updated, import `ALL_MODULES` from `../src/modules.js`, and

```ts
    const seeded = await provisionNode(db, { tenantId: brandTenantId(tenantArg), nodeId: brandNodeId(nodeArg) }, ALL_MODULES);
    for (const s of seeded) console.log(`${s.module}: ${s.report}`);
```

Update its header's usage block and delete the "NIF is NOT an argument — see provisionNode's own note" sentence (the fiscal seed's doc holds it now).

- [ ] **Step 4: Verify and commit**

```bash
pnpm --filter @waitron/server lint && pnpm --filter @waitron/server typecheck && pnpm --filter @waitron/server test provision-till
pnpm format:check
git add apps/server/src/provision-till.ts apps/server/src/provision-till.test.ts apps/server/scripts/register-till.ts
git commit -s -m "SP-3c: provisionNode runs the module seeds; register-till drops the software-id argument"
```

---

### Task 7: Standby reservation and establishment through the seat

**Files:**
- Modify: `apps/server/src/mirror-bundle.ts`, `apps/server/src/reserved-identity.ts`, `apps/server/src/adopt.ts`
- Modify tests: `reserved-identity.test.ts`, `adopt.rls.test.ts` (`nextReservedIdentity`), `mirror-bundle.rls.test.ts:160-169`, `mirror-bundle-api.rls.test.ts:299-321`, `mirror-bundle-fetch.test.ts:34-44`, `boot.promote.test.ts:405-425`, `promote.test.ts:370-381`

**Interfaces:**
- Consumes: `StandbyProvisioning` (Task 2), `FISCAL_PROVISIONING.standby` (Task 4), `enabledModules` (`@waitron/module`).
- Produces: `ReservedIdentity { modules: Record<string, unknown>; series: { code: string; purpose: string }[]; endorsement: Endorsement }`; `establishReservedStandbyIdentity(deps, args)` where `args` gains `modules: readonly WaitronModule[]` and `reserved: ReservedIdentity`.

- [ ] **Step 1: Rewrite the failing tests**

`reserved-identity.test.ts`: import `ALL_MODULES` from `./modules.js`; in both tests pass `modules: ALL_MODULES` and

```ts
        reserved: {
          modules: { fiscal: { nif: NIF, idSistemaInformatico: "W1", numeroInstalacion: 7 } },
          series: [{ code: "FA-7", purpose: "standard" }],
          endorsement: { ...ENDORSEMENT, nodeId: standby.nodeId, publicKey: standby.publicKey },
        },
```

Add:

```ts
  it("refuses a bundle whose fiscal reservation is missing, before writing the node", async () => {
    const standby = generateStandbyIdentity();
    await expect(
      establishReservedStandbyIdentity(
        { ownerDb: suite.db, ring: RING },
        {
          tenantId, locationId, standby, nodeName: "cloud", filingModule: "verifactu", taxModule: "iva",
          modules: ALL_MODULES,
          reserved: { modules: {}, series: [], endorsement: ENDORSEMENT },
        },
      ),
    ).rejects.toMatchObject({ code: "sif.reservation_invalid" });
    const node = await suite.db.execute(sql`select 1 from nodes where id = ${standby.nodeId}`);
    expect(node.rows).toEqual([]); // the one transaction rolled back
  });
```

`adopt.rls.test.ts` `nextReservedIdentity()` returns `{ modules: { fiscal: { nif, idSistemaInformatico: "WAITRON-STANDBY", ... } } ... }` — keep the same values, nested; the assertion at ~375 reads `(reservedIdentity.modules.fiscal as { numeroInstalacion: number }).numeroInstalacion`. `mirror-bundle.rls.test.ts` and `mirror-bundle-api.rls.test.ts`: `const r = bundle.reservedIdentity; const fiscal = r.modules.fiscal as { nif: string; idSistemaInformatico: string; numeroInstalacion: number };` and read `fiscal.numeroInstalacion` / `fiscal.idSistemaInformatico` where `r.numeroInstalacion` / `r.idSistemaInformatico` were; `r.series` stays. `mirror-bundle-fetch.test.ts` `SAMPLE_BUNDLE.reservedIdentity` nests the three fields under `modules: { fiscal: {...} }`. `boot.promote.test.ts` and `promote.test.ts` fixtures nest the same way and pass `modules: ALL_MODULES`.

- [ ] **Step 2: Run to confirm failure**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test reserved-identity mirror-bundle-fetch`
Expected: FAIL — type errors on `reserved.modules` / the new `modules` arg.

- [ ] **Step 3: `mirror-bundle.ts`**

```ts
export interface ReservedIdentity {
  /** Module name → the opaque state that module's `provisioning.standby.reserve` returned. */
  modules: Record<string, unknown>;
  /** The standby's invoice series, codes derived disjoint from the primary's by the reserving module. */
  series: { code: string; purpose: string }[];
  endorsement: Endorsement;
}
```

Imports: add `enabledModules` to the `@waitron/module` import, `ALL_MODULES` from `./modules.js`, `locationId as brandLocationId` from `@waitron/shared`; drop `currentSif`, `deriveReservedSeriesCodes`, `reserveInstallationNumber` and the `@waitron/fiscal-verifactu` import. Read the module config BEFORE the reservation (it decides the enabled set) and reserve through the seat:

```ts
  const moduleConfig = await readModuleConfig(deps.stateDir);
  const modules = enabledModules(ALL_MODULES, moduleConfig);

  const [reserved, primaryPrivateKey] = await Promise.all([
    withTenant(deps.appDb, deps.designated.tenantId, async (tx) => {
      const primary = {
        tenantId: brandTenantId(deps.designated.tenantId),
        locationId: brandLocationId(deps.designated.locationId),
        nodeId: brandNodeId(deps.designated.nodeId),
      };
      const states: Record<string, unknown> = {};
      const series: { code: string; purpose: string }[] = [];
      for (const m of modules) {
        if (m.provisioning?.standby === undefined) continue;
        const r = await m.provisioning.standby.reserve(tx, primary);
        states[m.name] = r.state;
        series.push(...(r.series ?? []));
      }
      return { modules: states, series };
    }),
    readNodeIdentityKey(deps.appDb, deps.ring, deps.designated.tenantId),
  ]);
```

The later `Promise.all` keeps only `readFile(caCertPath(...))`; `moduleOverrides` is `serializeModuleConfig(moduleConfig)`. Thin the reservation comment to: the reservation shares ONE `withTenant` transaction so each module's reads and its allocation are consistent; the endorsement is membership's, computed here. Keep the `ReservedIdentity` doc's second sentence about the endorsement.

- [ ] **Step 4: `reserved-identity.ts`**

Args gain `modules: readonly WaitronModule[]`; drop the `@waitron/fiscal-verifactu` import; add `locationId as brandLocationId` from `@waitron/shared`. After `insertReservedNodeTx`:

```ts
    const standbyNode = {
      tenantId: tenant,
      locationId: brandLocationId(args.locationId),
      nodeId: brandNodeId(args.standby.nodeId),
    };
    for (const m of args.modules) {
      if (m.provisioning?.standby === undefined) continue;
      await m.provisioning.standby.establish(tx, standbyNode, args.reserved.modules[m.name]);
    }
    await insertReservedSeriesTx(tx, args.reserved.series.map((s) => ({ ... })));
```

`adopt.ts`: pass `modules: enabledModules(ALL_MODULES, moduleConfig),` (import `enabledModules`).

- [ ] **Step 5: Verify and commit**

```bash
pnpm --filter @waitron/server lint && pnpm --filter @waitron/server typecheck
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test reserved-identity mirror-bundle mirror-bundle-api mirror-bundle-fetch adopt.rls adopt-e2e boot.promote promote.test
pnpm format:check
git add -A apps/server
git commit -s -m "SP-3c: standby reservation and establishment run through the provisioning seat; bundle carries opaque module state"
```

---

### Task 8: The host selects the backend from the slot

**Files:**
- Modify: `apps/server/src/till-backend.ts`, `apps/server/src/till-backend.test.ts`, `apps/server/src/till-config.ts` (+ its test file if one has a PGlite suite; otherwise `apps/server/src/till-config.filing.test.ts` new), `apps/server/src/boot.ts:1088,1117`

**Interfaces:**
- Consumes: `fiscalSlot` (Task 2), `FISCAL_SLOT` via `ALL_MODULES` (Task 4).
- Produces: `makeFiscalBackend(modules: readonly WaitronModule[], stamped: string | null, db: Database, env: Env): FiscalBackend`; `readFilingModule(db: Database, cfg: Pick<TillConfig, "tenantId" | "nodeId">): Promise<string | null>`.

- [ ] **Step 1: Rewrite the failing tests**

`till-backend.test.ts`: drop the `VerifactuBackend` import; keep `systemClock`'s tests; delete the `rejectResolveClient` describe (it moved to the fiscal package). Replace the `makeFiscalBackend` describe with:

```ts
import { ALL_MODULES } from "./modules.js";
import type { WaitronModule } from "@waitron/module";
import { FISCAL_SLOT } from "@waitron/fiscal-verifactu";

const NO_FISCAL: readonly WaitronModule[] = ALL_MODULES.filter((m) => m.fiscal === undefined);

describe("makeFiscalBackend", () => {
  it("builds the enabled slot's backend without touching the database", () => {
    const backend = makeFiscalBackend(ALL_MODULES, "verifactu", STUB_DB, { WAITRON_ENV: "preproduction" });
    expect(backend.id).toBe(FISCAL_SLOT.id);
  });

  it("accepts a node with no stamped filing module (bare fixtures)", () => {
    expect(makeFiscalBackend(ALL_MODULES, null, STUB_DB, {}).id).toBe("verifactu");
  });

  it("refuses when no enabled module fills the slot", () => {
    expect(() => makeFiscalBackend(NO_FISCAL, null, STUB_DB, {})).toThrow(
      expect.objectContaining({ code: "module.fiscal_slot_empty" }),
    );
  });

  it("refuses a node stamped for another regime", () => {
    expect(() => makeFiscalBackend(ALL_MODULES, "other", STUB_DB, {})).toThrow(
      expect.objectContaining({ code: "module.fiscal_slot_mismatch", params: { stamped: "other", enabled: "verifactu" } }),
    );
  });

  it("refuses an unrepresentable WAITRON_ENV, the same guard loadConfig uses", () => {
    expect(() => makeFiscalBackend(ALL_MODULES, null, STUB_DB, { WAITRON_ENV: "staging" })).toThrow();
  });
});
```

`till-config.test.ts` is env-parsing only (no database), so `readFilingModule` gets its own file, `apps/server/src/till-config.filing.test.ts`:

```ts
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { nodeId as brandNodeId } from "@waitron/shared";
import type { NodeId, TenantId } from "@waitron/shared";
import { readFilingModule } from "./till-config.js";

// PGlite (superuser, RLS bypassed) is enough: this proves the column read and the null case, not the
// role path — `readOrderFlow`, its sibling, is proven under the app role by the boot suites.
const suite = usePgliteDb({ migrations: migrationOptionsFor(manifestSets(), null) });

let tenantId: TenantId;
let stamped: NodeId;
let bare: NodeId;

beforeAll(async () => {
  tenantId = await seedTenant(suite.db);
  const loc = await suite.db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Barra', array['es-ES'], 'Venta en establecimiento') returning id`);
  const locationId = loc.rows[0]!.id;
  const s = await suite.db.execute<{ id: string }>(sql`
    insert into nodes (tenant_id, location_id, name, filing_module, tax_module)
    values (${tenantId}, ${locationId}, 'stamped', 'verifactu', 'iva') returning id`);
  const b = await suite.db.execute<{ id: string }>(sql`
    insert into nodes (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'bare') returning id`);
  stamped = brandNodeId(s.rows[0]!.id);
  bare = brandNodeId(b.rows[0]!.id);
});

describe("readFilingModule", () => {
  it("reads the node's stamped filing module", async () => {
    expect(await readFilingModule(suite.db, { tenantId, nodeId: stamped })).toBe("verifactu");
  });
  it("is null for a node provisioning never stamped", async () => {
    expect(await readFilingModule(suite.db, { tenantId, nodeId: bare })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @waitron/server test till-backend till-config`
Expected: FAIL — signature mismatch / `readFilingModule` missing.

- [ ] **Step 3: Implement**

`till-config.ts`, beside `readOrderFlow` (import `nodes` from `@waitron/db`):

```ts
/**
 * The node's stamped filing module (`nodes.filing_module`, set by provisioning from the territory's
 * registry), which `fiscalSlot` cross-checks against the enabled fiscal module. Null for a bare
 * fixture node. Read ONCE at boot, as the app role under the till's tenant.
 */
export async function readFilingModule(
  db: Database,
  cfg: Pick<TillConfig, "tenantId" | "nodeId">,
): Promise<string | null> {
  return withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const [row] = await tx
      .select({ filingModule: nodes.filingModule })
      .from(nodes)
      .where(eq(nodes.id, cfg.nodeId));
    /* v8 ignore start */
    if (row === undefined) throw new Error(`readFilingModule: no node ${cfg.nodeId}`);
    /* v8 ignore stop */
    return row.filingModule;
  });
}
```

`till-backend.ts`: drop the `VerifactuBackend` import and `rejectResolveClient`; import `fiscalSlot, type WaitronModule` from `@waitron/module`:

```ts
/**
 * The till's fiscal backend: the enabled module that fills the fiscal slot builds it
 * (`fiscalSlot` refuses zero, two, or a node stamped for another regime). `deploymentEnvironment(env)`
 * is the same resolver the rest of `config.ts` uses, so an unset value takes the safe `preproduction`
 * default and an unrepresentable one is refused here rather than mid-sale.
 */
export function makeFiscalBackend(
  modules: readonly WaitronModule[],
  stamped: string | null,
  db: Database,
  env: Env,
): FiscalBackend {
  return fiscalSlot(modules, stamped).makeBackend({
    db,
    clock: systemClock(),
    environment: deploymentEnvironment(env),
  });
}
```

`boot.ts`: beside line 1088, `const filingModule = await readFilingModule(db, config.till);` (import it from `./till-config.js`), and at 1117 `backend: makeFiscalBackend(setsToMigrate, filingModule, db, env),` — `setsToMigrate` is the enabled set in trading mode (its own comment at ~602 says so).

- [ ] **Step 4: Verify and commit**

```bash
pnpm --filter @waitron/server lint && pnpm --filter @waitron/server typecheck
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test till-backend till-config boot.test till-sale.test
pnpm format:check
git add -A apps/server
git commit -s -m "SP-3c: the host builds the till's fiscal backend from the enabled module's slot, cross-checked against the node's filing module"
```

---

### Task 9: The import-boundary guard, receipts, docs

**Files:**
- Create: `scripts/module-seams.test.ts`
- Modify: every receipt in spec §11 not already retired by Tasks 1–8; `CLAUDE.md` §3; `docs/backlog.md` (SP-3c entry, Track C item 1, the "next slices" paragraph); `docs/superpowers/specs/2026-09-04-module-system-architecture-design.md` §9 (dated pointer)

**Interfaces:** none new.

- [ ] **Step 1: Write the guard**

`scripts/module-seams.test.ts`:

```ts
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_MODULES } from "../packages/composition/src/index.js";
import { FISCAL_TERRITORIES, resolveFiscalModules } from "../packages/provisioning/src/index.js";

/**
 * The module seams (SP-3c): the swappable fiscal regime is reached only through the descriptor's
 * seats. Generic provisioning code imports neither regime package nor the composition list (its
 * `bin.ts` is the CLI's composition root and may); the server's non-list files import no regime
 * package. Provisioning's imports of `@waitron/identity` and `@waitron/layouts` are legitimate —
 * those modules are not swappable slots — so the boundary is the REGIME, not "any module".
 *
 * Reads text, like module-graph-honesty — a `from "@waitron/…"` inside a comment counts; stated
 * rather than papered over. The regime package set is derived from the slot: whichever module fills
 * `fiscal` plus its regime library.
 *
 * DEFERRED, allowlisted with the reason: the runtime fiscal pass still imports the Spanish regime
 * directly until the `fiscal-none` slice designs the runtime-duty seat (SP-3c spec §12). Shrink this
 * list there; do not grow it.
 */
const DEFERRED_RUNTIME_PASS = new Map<string, string>([
  ["apps/server/src/boot.ts", "drain: the fiscal pass builds a per-pass AEAT transport"],
  ["apps/server/src/aeat-transport.ts", "AEAT SOAP endpoints and mTLS"],
  ["apps/server/src/aeat-credential.ts", "seals the AEAT certificate"],
]);

const REPO_ROOT = join(import.meta.dirname, "..");
const REGIME_PACKAGES = ["@waitron/fiscal-verifactu", "@waitron/verifactu"];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === "testing" || entry === "node_modules") continue;
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
    expect(Object.keys(manifest.dependencies).filter((d) => REGIME_PACKAGES.includes(d))).toEqual([]);
  });
});

describe("apps/server imports the Spanish regime only from modules.ts and the deferred runtime pass", () => {
  const files = sourceFiles(join(REPO_ROOT, "apps/server/src"));
  it("scans the host (not vacuous)", () => {
    expect(files.some((f) => f.endsWith("till-backend.ts"))).toBe(true);
  });
  it.each(files.map((f) => [relative(REPO_ROOT, f), f]))("%s", (rel, file) => {
    if (rel === "apps/server/src/modules.ts" || DEFERRED_RUNTIME_PASS.has(rel)) return;
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
    for (const t of FISCAL_TERRITORIES) expect(ids.has(resolveFiscalModules(t).filing), t).toBe(true);
  });
});
```

- [ ] **Step 2: Run it; it must pass on the tree as built, and fail on a control**

Run: `pnpm vitest run module-seams`
Expected: PASS. Control: temporarily add `import { registerSif } from "@waitron/fiscal-verifactu";` to `packages/provisioning/src/venue-apply.ts`, rerun → that file's case FAILS; revert.

- [ ] **Step 3: Proven-by-deletion experiments (run, then revert each)**

1. Delete `provisioning: FISCAL_PROVISIONING,` from the fiscal descriptor → `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/provisioning test venue-apply.e2e` fails with `sif.not_registered`. Revert.
2. Delete `fiscal: FISCAL_SLOT,` → `pnpm --filter @waitron/server test till-backend` fails with `module.fiscal_slot_empty`. Revert.
3. In `packages/fiscal-verifactu/src/provisioning.ts`, delete the `writeReservedSif` call in `establish` → `pnpm --filter @waitron/server test reserved-identity` fails on `currentSif` (`sif.not_registered`). Revert.

Record each outcome in the PR description as the experiment run.

- [ ] **Step 4: Receipts sweep (spec §11)**

Read each and edit what Tasks 1–8 did not already: `packages/module/src/module.ts` header (done in Task 2 — confirm); `apps/server/src/provision.ts` `ProvisionDeps` doc; `apps/server/src/till-backend.ts` header (Task 8); `apps/server/src/mirror-bundle.ts` `ReservedIdentity` doc and `reserved-identity.ts` header, `adopt.ts:123-130` comment (Task 7 — confirm none names `nif`/`numeroInstalacion` as bundle fields); `packages/provisioning/src/fiscal-modules.ts` header (drop the paragraph on `iva`/`verifactu` tripping guards only if it is now false — it is still true; drop the `WAITRON_ID_SISTEMA` sentences); `apps/server/src/errors.ts` `node.not_found` doc (still true). Then:

```bash
grep -rn "register-sif\|registerSifForNode\|provisioningSeeds\|result\.sif\|idSistemaInformatico: ID_SIF\|apps/server/src/modules.ts" packages apps scripts docs/superpowers/specs/2026-09-05-module-sp3c-gated-provisioning-design.md CLAUDE.md .github --include='*.ts' --include='*.md' --include='*.mjs' | grep -v node_modules
```

Every hit is either historical (a spec/plan other than SP-3c's — leave, or add a dated pointer) or a stale receipt (fix). Read `.github/instructions/waitron.instructions.md` end to end (measured 2026-09-05: it names `packages/fiscal-verifactu` only as the home of the chain-contention suites, still true).

- [ ] **Step 5: Docs**

`docs/superpowers/specs/2026-09-04-module-system-architecture-design.md` §9, after "…gated on the fiscal module being the chosen slot, never toggled after.": add `*(2026-09-05, SP-3c: the mint now runs through the fiscal module's `provisioning.seed`; `venue-apply.ts` imports no regime — see `2026-09-05-module-sp3c-gated-provisioning-design.md`.)*`

`CLAUDE.md` §3, one new bullet after the module-vocabulary bullet:

```markdown
- **The composition list lives in `@waitron/composition`, and it is the only place that names every
  module.** Generic provisioning code (`packages/provisioning/src`, `bin.ts` excepted — it is the
  CLI's composition root) and the server's non-list files import no module package; the fiscal
  regime is reached through the descriptor's `provisioning` and `fiscal` seats, and
  `scripts/module-seams.test.ts` pins the boundary with an explicit allowlist for the runtime pass
  the `fiscal-none` slice still owes. A module's per-node seed runs INSIDE `applyVenue`'s one
  transaction (a seed that throws rolls the venue back). Cost of the old shape: six direct
  `@waitron/fiscal-verifactu` imports across two packages, and `fiscal-none` could not land.
```

`docs/backlog.md`: in the SP-3 breakdown replace the SP-3c bullet with a LANDED-style entry (mark it "in PR #<n>" until merge, then `/land-branch` updates it): what landed (two seats, composition package, backend id, guard), the allocation decision (runtime pass → `fiscal-none`, spec §12), and the spec/plan links. Update Track C item 1 ("SP-3c gated-provisioning seam" → "SP-3c (PR #<n>)") and the "Next module slices are SP-3c / SP-3d" paragraph.

- [ ] **Step 6: Full verification, then commit**

```bash
pnpm lint && pnpm typecheck && pnpm format:check
pnpm vitest run --coverage                                  # root project incl. module-seams
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage   # alone; nothing else running
git add -A
git commit -s -m "SP-3c: module-seams guard, receipts retired, CLAUDE.md §3 and backlog"
```

Then the §2 gate (`pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`) and `/finish-branch`.
