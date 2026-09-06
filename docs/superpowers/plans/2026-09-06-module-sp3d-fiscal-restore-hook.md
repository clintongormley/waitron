# SP-3d — The fiscal module's restore hook — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the disaster-recovery CLI (`waitron-restore restore <artifact>`) leave a restored box fiscally trade-ready as the same node: a fresh SIF (installation number floored by the clock, chain head reset), the node's invoice series retired and replaced by disjoint ones, and `trading.env` pointing at the new standard series — with no bootable identity written until all of that has committed.

**Architecture:** `@waitron/module`'s `backup.restore` seat becomes a typed `RestoreHook = (tx, node) => Promise<RestoreOutcome>`. The fiscal package exports `FISCAL_RESTORE` (re-register via `registerSif` after raising the counter floor; derive series codes from stripped bases). `apps/server/src/restore.ts`'s `writeValidated` gains: migrate-after-`pg_restore`, an identity gate (`skipSecrets` ⇒ no hooks), one origin-stamped `withTenant` transaction that runs every hook and then retires/inserts the node's series through new `@waitron/db` helpers, and a secrets write whose `trading.env` is rewritten in memory. `invoice_series` gains `retired_at`; the three `packages/core` write paths refuse a retired series.

**Tech Stack:** TypeScript, Vitest (PGlite via `createPgliteDb`/`usePgliteDb`; real PostgreSQL via the shared Testcontainers container + `docker exec pg_dump`/`pg_restore`), drizzle-orm + drizzle-kit (`db:generate`), pnpm workspace. One new core migration, no new dependency.

**Spec:** `docs/superpowers/specs/2026-09-06-module-sp3d-fiscal-restore-hook-design.md` — read it first; the plan argues from it. Section numbers below (§n) are the spec's.

## Global Constraints

- **Worktree:** all work happens in `/Users/clintongormley/workspace/worktrees/waitron-feat-module-sp3d-fiscal-restore-hook` on branch `feat/module-sp3d-fiscal-restore-hook`. Never commit to `main`.
- **Every commit is `git commit -s`** (DCO; CI's `dco` job walks the whole PR range).
- **TDD:** failing test first, watch it fail, minimal implementation, watch it pass. Every guard is proven by deletion (delete the check → the test goes red → restore it) and the task's verification step names which test proves which guard.
- **Generic packages stay English.** `packages/module`, `packages/db` and `packages/core` are scanned by the english-only guard (`GENERIC_PACKAGES`, `packages/db/src/english-only.ts`) against the base list plus every module's `vocabulary` — the fiscal tokens include `sif`, `registro`, `instalacion`, `numero`, `serie`, `huella`, `cadena`. Nothing you add to those three packages may contain them (identifiers OR comments). `series` (English) is fine. Fiscal words live in `packages/fiscal-verifactu`, `packages/composition`, `apps/server`, tests and `docs/`.
- **Names are fixed:** `RestoreHook`, `RestoreOutcome` (`@waitron/module`); `FISCAL_RESTORE`, `restoreFiscal`, `installationFloor`, `raiseInstallationFloor`, `stripOwnSuffixes`, `MAX_BASE_CODE_LENGTH` (`@waitron/fiscal-verifactu`); `retireNodeSeriesTx`, `insertNodeSeriesTx`, `readStandardSeriesIdTx` (`@waitron/db`); `runRestoreHooks`, `readArtifactIdentity`, `rewriteTradingEnv` (`apps/server/src/restore.ts`); `RestoreDeps.openDb` / `RestoreDeps.migrate` seams.
- **Error codes (never renamed once shipped):** `series.code_collision { code }` (`packages/db`); `sale.series_retired { seriesId, retiredAt }` (`packages/core`); `series.code_too_long { code }` (`packages/fiscal-verifactu`); `restore.identity_incomplete { missing }`, `restore.identity_unknown { tenantId, nodeId }`, `restore.series_conflict { modules }`, `restore.hook_failed { module, code }` (`apps/server`). Every file that throws a code imports its registry (`import "./errors.js"`).
- **Never widen a grant.** `app_user`'s UPDATE on `invoice_series` stays column-scoped to `next_number` (`packages/db/drizzle/0003_invoice_series.sql`); the retire runs on the privileged restore connection only.
- **The migration is generated, never hand-written:** `pnpm --filter @waitron/db db:generate --name series_retired_at`. Commit `packages/db/drizzle/0111_series_retired_at.sql` and the `meta/` snapshot + journal it updates together. (If `main` gains a `0111` before this lands, regenerate at the rebase — CLAUDE.md §3 — never hand-edit the journal.)
- **Per-task verification** = `pnpm format:check` (whole workspace, fast) + the named package's `lint`, `typecheck` and `test:coverage`. Real-PG suites need `TESTCONTAINERS_RYUK_DISABLED=true`. `apps/server`'s whole `test:coverage` is heavy (three CI shards): run the named suites per task and the whole package once in Task 7.
- **Coverage bars:** `db`, `core`, `fiscal-verifactu` hold `98/98/98/95`; `module`, `composition`, `apps/server` hold `90/90/85/85`. New code lands with its tests in the same task so the bar never dips.
- **Comments state the invariant, not the history** (CLAUDE.md §1). No "added in SP-3d" narratives; at most a one-line spec pointer. Thin the comments you touch, and delete every receipt §11 lists in the task that changes the behaviour it described.
- **Never run two browser-mode gates at once; never background `pnpm -r test:coverage`.** Before any `git push`, `pgrep -f .husky/pre-push` must print nothing.
- **Do not open the PR from a task.** Task 7 ends with the branch ready; `/finish-branch` opens it. This slice is owner-gated (H2): never land it.

---

### Task 1: `invoice_series.retired_at` and the core series helpers (`@waitron/db`)

**Files:**
- Modify: `packages/db/src/schema/series.ts` (column), `packages/db/src/errors.ts` (code), `packages/db/src/reserved-identity.ts` (helpers), `packages/db/src/index.ts` (exports)
- Create: `packages/db/drizzle/0111_series_retired_at.sql` + `meta/` updates (generated)
- Test: `packages/db/src/reserved-identity.test.ts`

**Interfaces:**
- Produces:
  - column `invoiceSeries.retiredAt: Date | null` (`retired_at timestamptz null`)
  - `readStandardSeriesIdTx(tx: Transaction, tenantId: string, nodeId: string): Promise<string>` — the LIVE standard series id; throws `series.no_standard_for_node` on none, a plain `Error` on two
  - `readStandardSeriesId(db, tenantId, nodeId)` — unchanged signature, now `withTenant` around `readStandardSeriesIdTx`
  - `retireNodeSeriesTx(tx, tenantId: string, nodeId: string): Promise<number>` — sets `retired_at = now()` on every live series of the node; returns the count
  - `insertNodeSeriesTx(tx, tenantId: string, nodeId: string, series: readonly { code: string; purpose: string }[]): Promise<void>` — inserts at `next_number = 1`; throws `series.code_collision { code }` if the node already holds the code (live or retired)

- [ ] **Step 1: Write the failing tests**

Append to `describe("reserved-identity accessors", …)` in `packages/db/src/reserved-identity.test.ts` (imports to add: `retireNodeSeriesTx`, `insertNodeSeriesTx`, `readStandardSeriesIdTx` from `./index.js`; `isNull` is not needed):

```ts
  it("readStandardSeriesId ignores a RETIRED standard series (a cold restore retires the old one)", async () => {
    const node = await seedNode(suite.db, tenantId, locationId);
    await withTenant(suite.db, tenantId, (tx) =>
      insertReservedSeriesTx(tx, [
        { tenantId, nodeId: node, code: "FA", purpose: "standard" },
        { tenantId, nodeId: node, code: "FA-210441234", purpose: "standard" },
      ]),
    );
    await suite.db
      .update(invoiceSeries)
      .set({ retiredAt: new Date() })
      .where(and(eq(invoiceSeries.nodeId, node), eq(invoiceSeries.code, "FA")));
    const id = await readStandardSeriesId(suite.db, tenantId, node);
    const [row] = await suite.db
      .select({ code: invoiceSeries.code })
      .from(invoiceSeries)
      .where(eq(invoiceSeries.id, id));
    expect(row?.code).toBe("FA-210441234");
  });

  it("readStandardSeriesId is LOUD on two live standard series (a data-integrity corruption)", async () => {
    const node = await seedNode(suite.db, tenantId, locationId);
    await withTenant(suite.db, tenantId, (tx) =>
      insertReservedSeriesTx(tx, [
        { tenantId, nodeId: node, code: "X1", purpose: "standard" },
        { tenantId, nodeId: node, code: "X2", purpose: "standard" },
      ]),
    );
    await expect(readStandardSeriesId(suite.db, tenantId, node)).rejects.toThrow(
      /more than one standard series/,
    );
  });

  it("retireNodeSeriesTx retires every LIVE series of the node and only those", async () => {
    const node = await seedNode(suite.db, tenantId, locationId);
    const other = await seedNode(suite.db, tenantId, locationId);
    await withTenant(suite.db, tenantId, (tx) =>
      insertReservedSeriesTx(tx, [
        { tenantId, nodeId: node, code: "FA", purpose: "standard" },
        { tenantId, nodeId: node, code: "RE", purpose: "rectificative" },
        { tenantId, nodeId: other, code: "FA", purpose: "standard" },
      ]),
    );
    const retired = await withTenant(suite.db, tenantId, (tx) => retireNodeSeriesTx(tx, tenantId, node));
    expect(retired).toBe(2);
    const rows = await suite.db
      .select({ nodeId: invoiceSeries.nodeId, retiredAt: invoiceSeries.retiredAt })
      .from(invoiceSeries)
      .where(inArray(invoiceSeries.nodeId, [node, other]));
    expect(rows.filter((r) => r.nodeId === node).every((r) => r.retiredAt !== null)).toBe(true);
    expect(rows.filter((r) => r.nodeId === other).every((r) => r.retiredAt === null)).toBe(true);
    // Idempotent on the already-retired: nothing left to retire.
    expect(await withTenant(suite.db, tenantId, (tx) => retireNodeSeriesTx(tx, tenantId, node))).toBe(0);
  });

  it("insertNodeSeriesTx inserts at next_number 1 and refuses a code the node holds, live OR retired", async () => {
    const node = await seedNode(suite.db, tenantId, locationId);
    await withTenant(suite.db, tenantId, (tx) =>
      insertReservedSeriesTx(tx, [{ tenantId, nodeId: node, code: "FA", purpose: "standard" }]),
    );
    await withTenant(suite.db, tenantId, (tx) => retireNodeSeriesTx(tx, tenantId, node));
    await withTenant(suite.db, tenantId, (tx) =>
      insertNodeSeriesTx(tx, tenantId, node, [{ code: "FA-7", purpose: "standard" }]),
    );
    const [fresh] = await suite.db
      .select({ nextNumber: invoiceSeries.nextNumber, retiredAt: invoiceSeries.retiredAt })
      .from(invoiceSeries)
      .where(and(eq(invoiceSeries.nodeId, node), eq(invoiceSeries.code, "FA-7")));
    expect(fresh).toEqual({ nextNumber: 1, retiredAt: null });
    // The retired `FA` still reserves its code — the natural key includes retired rows.
    const err = await captureError(() =>
      withTenant(suite.db, tenantId, (tx) =>
        insertNodeSeriesTx(tx, tenantId, node, [{ code: "FA", purpose: "standard" }]),
      ),
    );
    expect(isAppError(err) && err.code).toBe("series.code_collision");
    expect(isAppError(err) && err.params).toEqual({ code: "FA" });
    // An empty list is a no-op, not an INSERT with no rows.
    await withTenant(suite.db, tenantId, (tx) => insertNodeSeriesTx(tx, tenantId, node, []));
  });
```

Add `and`, `inArray` to the `drizzle-orm` import at the top of the test file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @waitron/db test reserved-identity`
Expected: FAIL — `retiredAt` does not exist on `invoiceSeries`; the three helpers are not exported.

- [ ] **Step 3: Add the column and generate the migration**

In `packages/db/src/schema/series.ts` add `timestamp` to the `drizzle-orm/pg-core` import and, after `nextNumber`:

```ts
    // Set when the series stops numbering: a cold restore retires every live series of the node and
    // opens fresh ones (spec 2026-09-06-module-sp3d §3.2). A retired series stays for history — sales
    // reference it by id — and the write paths refuse to number from it.
    retiredAt: timestamp("retired_at", { withTimezone: true, mode: "date" }),
```

Run: `pnpm --filter @waitron/db db:generate --name series_retired_at`
Expected: `packages/db/drizzle/0111_series_retired_at.sql` containing exactly
`ALTER TABLE "invoice_series" ADD COLUMN "retired_at" timestamp with time zone;` and an updated
`meta/_journal.json` + snapshot. Inspect the SQL; nothing else may be in it.

- [ ] **Step 4: Register the code**

In `packages/db/src/errors.ts`, inside `interface ErrorParams`, after `series.no_standard_for_node`:

```ts
    /**
     * A series code being opened for a node is one the node already holds — live or retired: the
     * natural key `(tenant_id, node_id, code)` covers both, so a retired code can never be reopened.
     * Reached only by a restore deriving a code that a human had chosen earlier; the restore is
     * redone. `series.*` names the domain concept; never renamed once shipped.
     */
    "series.code_collision": { code: string };
```

- [ ] **Step 5: Implement the helpers**

In `packages/db/src/reserved-identity.ts`, change the imports to `import { and, eq, inArray, isNull, sql } from "drizzle-orm";` and replace `readStandardSeriesId` with:

```ts
/**
 * The id of a node's LIVE standard-purpose invoice series, inside the caller's tenant transaction.
 * Reads only `retired_at IS NULL` rows — a retired series is history, never the one to number from.
 * Caps the read at TWO rows and fails LOUD on a second live standard series rather than picking one
 * silently: nothing enforces one standard series per node (the natural key is `(tenant_id, node_id,
 * code)`, not purpose), and two would make `NumSerieFactura` non-deterministic. Reachable only by a
 * corrupt write; a plain `Error`, not a code, because it is a programming-level invariant.
 */
export async function readStandardSeriesIdTx(
  tx: Transaction,
  tenantId: string,
  nodeId: string,
): Promise<string> {
  const rows = await tx
    .select({ id: invoiceSeries.id })
    .from(invoiceSeries)
    .where(
      and(
        eq(invoiceSeries.nodeId, nodeId),
        eq(invoiceSeries.purpose, "standard"),
        isNull(invoiceSeries.retiredAt),
      ),
    )
    .limit(2);
  const [row, extra] = rows;
  if (row === undefined) {
    throw new AppError("series.no_standard_for_node", { tenantId, nodeId });
  }
  if (extra !== undefined) {
    throw new Error(`invoice_series: node ${nodeId} has more than one standard series`);
  }
  return row.id;
}

/** {@link readStandardSeriesIdTx} under its own `withTenant` (app_user SELECT suffices). */
export function readStandardSeriesId(
  db: Database,
  tenantId: string,
  nodeId: string,
): Promise<string> {
  return withTenant(db, brandTenantId(tenantId), (tx) =>
    readStandardSeriesIdTx(tx, tenantId, nodeId),
  );
}

/**
 * Retire every LIVE series of a node (`retired_at = now()`), returning how many were retired.
 * Owner-role only: `app_user`'s UPDATE on this table is column-scoped to `next_number`
 * (`0003_invoice_series.sql`), and no runtime path retires a series — a restore does, on its
 * privileged connection, before opening the node's replacement series.
 */
export async function retireNodeSeriesTx(
  tx: Transaction,
  tenantId: string,
  nodeId: string,
): Promise<number> {
  const rows = await tx
    .update(invoiceSeries)
    .set({ retiredAt: sql`now()` })
    .where(
      and(
        eq(invoiceSeries.tenantId, tenantId),
        eq(invoiceSeries.nodeId, nodeId),
        isNull(invoiceSeries.retiredAt),
      ),
    )
    .returning({ id: invoiceSeries.id });
  return rows.length;
}

/**
 * Open fresh series for a node at `next_number = 1`. Refuses — `series.code_collision` — a code the
 * node already holds, live or retired: the natural key covers both, and a constraint violation would
 * surface as a raw driver error rather than a code an operator can act on. A no-op on an empty list.
 */
export async function insertNodeSeriesTx(
  tx: Transaction,
  tenantId: string,
  nodeId: string,
  series: readonly { code: string; purpose: string }[],
): Promise<void> {
  if (series.length === 0) return;
  const [held] = await tx
    .select({ code: invoiceSeries.code })
    .from(invoiceSeries)
    .where(
      and(
        eq(invoiceSeries.tenantId, tenantId),
        eq(invoiceSeries.nodeId, nodeId),
        inArray(
          invoiceSeries.code,
          series.map((s) => s.code),
        ),
      ),
    )
    .limit(1);
  if (held !== undefined) {
    throw new AppError("series.code_collision", { code: held.code });
  }
  await insertReservedSeriesTx(
    tx,
    series.map((s) => ({ tenantId, nodeId, code: s.code, purpose: s.purpose })),
  );
}
```

Delete the old `/* v8 ignore */` markers around the ">1" guard (the new test reaches it). Export the three new functions from `packages/db/src/index.ts` beside `readStandardSeriesId`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @waitron/db test reserved-identity`
Expected: PASS. Then prove by deletion: remove `isNull(invoiceSeries.retiredAt)` from `readStandardSeriesIdTx` → the "ignores a RETIRED" test fails (the loud >1 guard fires); restore it.

- [ ] **Step 7: Verify and commit**

Run: `pnpm format:check && pnpm --filter @waitron/db lint && pnpm --filter @waitron/db typecheck && TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test:coverage`
Also: `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` (a column on a `tenant_id` table — the FORCE-RLS scan must stay green).

```bash
git add packages/db
git commit -s -m "feat(db): invoice_series.retired_at; live-only readStandardSeriesId; retire/insert node series helpers"
```

---

### Task 2: The write paths refuse a retired series (`@waitron/core`)

**Files:**
- Modify: `packages/core/src/errors.ts`, `packages/core/src/record-sale.ts` (the series guard, ~L215-247), `packages/core/src/record-correction.ts` (~L146-175), `packages/core/src/record-substitution.ts` (~L170-200)
- Test: `packages/core/src/record-sale.test.ts`, `packages/core/src/record-correction.test.ts`, `packages/core/src/record-substitution.test.ts`

**Interfaces:**
- Produces: `sale.series_retired { seriesId: string; retiredAt: string }` thrown by all three write paths after the `purpose` guard.

- [ ] **Step 1: Write the failing tests**

In `packages/core/src/record-sale.test.ts`, inside `describe("recordSale — series validation", …)`, after the rectificative test (add `invoiceSeries` to the `@waitron/db` import and `eq` to `drizzle-orm` if absent):

```ts
  it("rejects a RETIRED series: a restored box must never number from the series it was restored with", async () => {
    // A cold restore retires the node's series and opens fresh ones; a stale `WAITRON_TILL_SERIES_ID`
    // (spec 2026-09-06-module-sp3d §5) must fail LOUD here, never issue a number AEAT already saw.
    const retiredAt = new Date("2026-09-06T10:00:00.000Z");
    await suite.db.update(invoiceSeries).set({ retiredAt }).where(eq(invoiceSeries.id, seriesId));
    try {
      await expect(run(new FakeFiscalBackend(suite.db))).rejects.toMatchObject({
        code: "sale.series_retired",
        params: { seriesId, retiredAt: retiredAt.toISOString() },
      });
    } finally {
      await suite.db.update(invoiceSeries).set({ retiredAt: null }).where(eq(invoiceSeries.id, seriesId));
    }
  });
```

(`seriesId` is the suite-level standard series the surrounding tests already use; keep the `finally` so later tests see it live again.)

In `record-correction.test.ts` and `record-substitution.test.ts`, beside each file's existing `sale.series_wrong_purpose` test (L~250 and L~330), add the same shape: retire the series that test's happy path uses (the rectificative one for corrections, the standard one for substitutions) with a direct `update(invoiceSeries).set({ retiredAt })`, expect `sale.series_retired` with `params: { seriesId, retiredAt: retiredAt.toISOString() }`, and un-retire in a `finally`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @waitron/core test "series_retired"` (or the three files by name)
Expected: FAIL — the sale succeeds (no such code).

- [ ] **Step 3: Register the code and add the guard**

`packages/core/src/errors.ts`, after `sale.series_wrong_purpose`:

```ts
    /** Thrown when the series is real, on the right node and of the right kind, but RETIRED
     * (`invoice_series.retired_at` set): a restore retired it and opened a replacement, so numbering
     * from it would re-issue an invoice identity the tax agency may already hold. `retiredAt` is the
     * ISO timestamp, for the operator's message. Same shape as its `sale.series_*` siblings. */
    "sale.series_retired": { seriesId: string; retiredAt: string };
```

In each of the three files, add `retiredAt: invoiceSeries.retiredAt` to the series `select({...})` and, directly after the `purpose` guard:

```ts
  if (series.retiredAt !== null) {
    throw new AppError("sale.series_retired", {
      seriesId: input.seriesId,
      retiredAt: series.retiredAt.toISOString(),
    });
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @waitron/core test`
Expected: PASS. Prove by deletion in ONE file (delete the guard in `record-sale.ts` → its test fails → restore).

- [ ] **Step 5: Verify and commit**

Run: `pnpm format:check && pnpm --filter @waitron/core lint && pnpm --filter @waitron/core typecheck && pnpm --filter @waitron/core test:coverage`

```bash
git add packages/core
git commit -s -m "feat(core): sale.series_retired — the three write paths refuse a retired series"
```

---

### Task 3: The typed `backup.restore` seat (`@waitron/module`)

**Files:**
- Create: `packages/module/src/restore.ts`
- Modify: `packages/module/src/module.ts` (`ModuleBackupContribution.restore`), `packages/module/src/index.ts` (exports)
- Test: `packages/module/src/module.test.ts` (a type-level + shape test)

**Interfaces:**
- Produces (exact):

```ts
export interface RestoreOutcome {
  readonly report: string;
  readonly series?: readonly { readonly code: string; readonly purpose: string }[];
}
export type RestoreHook = (tx: Transaction, node: ProvisionedNode) => Promise<RestoreOutcome>;
```
and `ModuleBackupContribution.restore?: RestoreHook`.

- [ ] **Step 1: Write the failing test**

Add to `packages/module/src/module.test.ts` (create the describe if the file has none for backup):

```ts
describe("backup.restore seat", () => {
  it("is a typed hook: (tx, node) => RestoreOutcome, and a module may omit it", async () => {
    const hook: RestoreHook = async (_tx, node) => ({
      report: `restored ${node.nodeId}`,
      series: [{ code: "A-1", purpose: "standard" }],
    });
    const withHook: WaitronModule = {
      name: "x",
      version: "0.0.0",
      tier: "toggleable",
      migrations: { name: "x", table: "__drizzle_migrations_x", from: "../x/drizzle" },
      backup: { restore: hook },
    };
    const without: WaitronModule = { ...withHook, backup: {} };
    expect(typeof withHook.backup?.restore).toBe("function");
    expect(without.backup?.restore).toBeUndefined();
    const outcome = await withHook.backup!.restore!({} as never, {
      tenantId: "t" as never,
      locationId: "l" as never,
      nodeId: "n" as never,
    });
    expect(outcome).toEqual({ report: "restored n", series: [{ code: "A-1", purpose: "standard" }] });
  });
});
```

Import `RestoreHook` and `WaitronModule` from `./index.js`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/module typecheck && pnpm --filter @waitron/module test module`
Expected: typecheck FAILS — `RestoreHook` is not exported; `restore` is `unknown`.

- [ ] **Step 3: Implement**

`packages/module/src/restore.ts`:

```ts
import type { Transaction } from "@waitron/db";
import type { ProvisionedNode } from "./provisioning.js";

/**
 * What a module hands back from its restore hook. `series`, when present, REPLACES the node's live
 * invoice series: the orchestrator retires every live series of the node and opens these at number 1
 * (`invoice_series` is core's table; the disjointness rule is the module's). Absent = leave the
 * series alone. At most one module may return it; an empty list is a module error — a node with no
 * live standard series cannot sell.
 */
export interface RestoreOutcome {
  /** One line for the operator's terminal. */
  readonly report: string;
  readonly series?: readonly { readonly code: string; readonly purpose: string }[];
}

/**
 * A module's restore hook: what it does so a box that has just restored this node's backup and is
 * about to TAKE its identity can trade again as that node. Runs inside the orchestrator's tenant
 * transaction (origin-stamped with the node), after the database is restored and migrated and before
 * the identity is written to disk. Never runs for a restore that keeps the box's own identity.
 */
export type RestoreHook = (tx: Transaction, node: ProvisionedNode) => Promise<RestoreOutcome>;
```

In `module.ts`: `import type { RestoreHook } from "./restore.js";` and

```ts
/** A module's backup contribution: the non-DB state it owns, and what it does after a restore. */
export interface ModuleBackupContribution {
  readonly nonDbState?: readonly NonDbSource[];
  readonly restore?: RestoreHook;
}
```

In `index.ts`: `export type { RestoreHook, RestoreOutcome } from "./restore.js";`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @waitron/module typecheck && pnpm --filter @waitron/module test`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

Run: `pnpm format:check && pnpm --filter @waitron/module lint && pnpm --filter @waitron/module test:coverage && pnpm test english-only` (root project: the new file is English).

```bash
git add packages/module
git commit -s -m "feat(module): type the backup.restore seat — RestoreHook(tx, node) → RestoreOutcome"
```

---

### Task 4: `FISCAL_RESTORE` — fresh SIF, clock-floored number, bounded disjoint series (`@waitron/fiscal-verifactu` + composition)

**Files:**
- Create: `packages/fiscal-verifactu/src/restore.ts`, `packages/fiscal-verifactu/src/restore.test.ts`
- Modify: `packages/fiscal-verifactu/src/errors.ts` (code), `packages/fiscal-verifactu/src/provisioning.ts` (`standby.reserve` reads live series only), `packages/fiscal-verifactu/src/provisioning.test.ts`, `packages/fiscal-verifactu/src/index.ts` (export), `packages/composition/src/modules.ts` (wire `backup: { restore: FISCAL_RESTORE }`), `packages/composition/src/composition.test.ts`

**Interfaces:**
- Consumes: `RestoreHook`/`RestoreOutcome` (Task 3); `invoiceSeries.retiredAt` (Task 1).
- Produces:
  - `FISCAL_RESTORE: RestoreHook`
  - `restoreFiscal(tx, node, now: Date): Promise<RestoreOutcome>` (the testable body; `FISCAL_RESTORE` = `restoreFiscal(tx, node, new Date())`)
  - `installationFloor(now: Date): number` — whole seconds since 2020-01-01T00:00:00Z
  - `raiseInstallationFloor(tx, { nif, idSistemaInformatico, floor }): Promise<void>`
  - `stripOwnSuffixes(code: string, registered: ReadonlySet<number>): string`
  - `MAX_BASE_CODE_LENGTH = 38`
  - `series.code_too_long { code: string }`

- [ ] **Step 1: Write the failing tests**

`packages/fiscal-verifactu/src/restore.test.ts` (the fresh-PGlite-per-test shape of `provisioning.test.ts`):

```ts
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPgliteDb, runMigrations, withTenant } from "@waitron/db";
import { isAppError, locationId as brandLocationId } from "@waitron/shared";
import type { ProvisionedNode } from "@waitron/module";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { TENANT_A, seedSoldRegistro, seedTenants } from "../test/fixtures.js";
import { currentSif, esPrimerRegistro, registerSif, type SifRegistration } from "./registro-sif.js";
import {
  FISCAL_RESTORE,
  MAX_BASE_CODE_LENGTH,
  installationFloor,
  restoreFiscal,
  stripOwnSuffixes,
} from "./restore.js";
import { verifyChain } from "./verify.js";

let db: Awaited<ReturnType<typeof createPgliteDb>>;

const NODE: ProvisionedNode = {
  tenantId: TENANT_A.id,
  locationId: brandLocationId(TENANT_A.locationId),
  nodeId: TENANT_A.nodeId,
};
const SIF = { nif: "89890001K", idSistemaInformatico: "WT" } as const;
const NOW = new Date("2026-09-06T10:00:00.000Z");
const FLOOR = installationFloor(NOW);

beforeEach(async () => {
  db = await createPgliteDb();
  for (const migrations of TEST_MIGRATIONS) await runMigrations(db, migrations);
  await seedTenants(db);
});
afterEach(async () => {
  if (db !== undefined) await db.close();
});

/** A live node: registered SIF + `FA` (standard, next_number 5) and `RE` (rectificative). */
async function seedLiveNode(): Promise<SifRegistration> {
  const sif = await withTenant(db, TENANT_A.id, (tx) =>
    registerSif(tx, { ...SIF, tenantId: TENANT_A.id, nodeId: TENANT_A.nodeId }),
  );
  await db.execute(sql`
    insert into invoice_series (tenant_id, node_id, code, purpose, next_number) values
      (${TENANT_A.id}, ${TENANT_A.nodeId}, 'FA', 'standard', 5),
      (${TENANT_A.id}, ${TENANT_A.nodeId}, 'RE', 'rectificative', 1)
  `);
  return sif;
}

async function liveSeriesCodes(): Promise<string[]> {
  const { rows } = await db.execute<{ code: string }>(sql`
    select code from invoice_series
    where node_id = ${TENANT_A.nodeId} and retired_at is null order by code
  `);
  return rows.map((r) => r.code);
}

describe("installationFloor", () => {
  it("is whole seconds since 2020-01-01T00:00:00Z", () => {
    expect(installationFloor(new Date("2020-01-01T00:00:00.000Z"))).toBe(0);
    expect(installationFloor(new Date("2020-01-01T00:01:00.999Z"))).toBe(60);
    // Fits `integer` until 2088.
    expect(installationFloor(new Date("2088-01-01T00:00:00Z"))).toBeLessThan(2 ** 31);
  });
});

describe("stripOwnSuffixes", () => {
  it("strips only trailing -<digits> groups that are registered installation numbers", () => {
    const registered = new Set([7, 210441234]);
    expect(stripOwnSuffixes("FA", registered)).toBe("FA");
    expect(stripOwnSuffixes("FA-7", registered)).toBe("FA");
    expect(stripOwnSuffixes("FA-210441234", registered)).toBe("FA");
    expect(stripOwnSuffixes("FA-7-210441234", registered)).toBe("FA");
    expect(stripOwnSuffixes("FA-2026", registered)).toBe("FA-2026");
    expect(stripOwnSuffixes("FA-2026-7", registered)).toBe("FA-2026");
  });
});

describe("restoreFiscal", () => {
  it("revokes the live SIF, mints a floored number, resets the chain head, keeps the ledger, returns disjoint series", async () => {
    const first = await seedLiveNode();
    await seedSoldRegistro(db, {
      tenantId: TENANT_A.id,
      tillId: TENANT_A.tillId,
      nodeId: TENANT_A.nodeId,
      sifId: first.id,
      nif: SIF.nif,
      secuencia: 7,
      huella: "C".repeat(64),
    });

    const outcome = await withTenant(db, TENANT_A.id, (tx) => restoreFiscal(tx, NODE, NOW));

    const fresh = await withTenant(db, TENANT_A.id, (tx) => currentSif(tx, TENANT_A.id, TENANT_A.nodeId));
    expect(fresh.id).not.toBe(first.id);
    expect(fresh.numeroInstalacion).toBeGreaterThanOrEqual(FLOOR);
    expect(fresh.numeroInstalacion).toBeGreaterThan(first.numeroInstalacion);
    const { rows: old } = await db.execute<{ revocado_en: string | null }>(
      sql`select revocado_en from registro_sif where id = ${first.id}`,
    );
    expect(old[0]?.revocado_en).not.toBeNull();
    expect(await withTenant(db, TENANT_A.id, (tx) => esPrimerRegistro(tx, TENANT_A.id, TENANT_A.nodeId))).toBe(true);
    const { rows: head } = await db.execute<{ secuencia: number }>(
      sql`select secuencia from cadenas where node_id = ${TENANT_A.nodeId}`,
    );
    expect(head[0]?.secuencia).toBe(7); // ours; never reset
    const { rows: ledger } = await db.execute<{ n: number }>(sql`select count(*)::int as n from registros_facturacion`);
    expect(ledger[0]?.n).toBe(1); // the seeded S7/1 registro is untouched
    // seedSoldRegistro also opened an `S7` series on the node — it is live, so it is re-derived too.
    const n = fresh.numeroInstalacion;
    expect(outcome.series).toEqual([
      { code: `FA-${n}`, purpose: "standard" },
      { code: `RE-${n}`, purpose: "rectificative" },
      { code: `S7-${n}`, purpose: "standard" },
    ]);
    expect(outcome.report).toContain(`installation ${n}`);
    // The hook writes NO series itself — the orchestrator does (spec §3.4).
    expect(await liveSeriesCodes()).toEqual(["FA", "RE", "S7"]);
  });

  it("THE REUSE EXPERIMENT: restoring an older counter cannot re-mint a number a later restore used", async () => {
    // Spec §3.5. Snapshot the counter after the first registration, register again (as a previous
    // restore would have), roll the counter back to the snapshot (what restoring the older artifact
    // does), and run the hook: the minted number must exceed the one the intervening registration used.
    await seedLiveNode();
    const { rows: snap } = await db.execute<{ proximo_numero: number }>(
      sql`select proximo_numero from contadores_instalacion where nif = ${SIF.nif} and id_sistema_informatico = ${SIF.idSistemaInformatico}`,
    );
    const later = await withTenant(db, TENANT_A.id, (tx) =>
      registerSif(tx, { ...SIF, tenantId: TENANT_A.id, nodeId: TENANT_A.nodeId }),
    );
    await db.execute(
      sql`update contadores_instalacion set proximo_numero = ${snap[0]!.proximo_numero} where nif = ${SIF.nif} and id_sistema_informatico = ${SIF.idSistemaInformatico}`,
    );
    await withTenant(db, TENANT_A.id, (tx) => restoreFiscal(tx, NODE, NOW));
    const fresh = await withTenant(db, TENANT_A.id, (tx) => currentSif(tx, TENANT_A.id, TENANT_A.nodeId));
    expect(fresh.numeroInstalacion).not.toBe(later.numeroInstalacion);
    expect(fresh.numeroInstalacion).toBeGreaterThan(later.numeroInstalacion);
  });

  it("creates the counter row when the restored database has none (a promoted standby's backup)", async () => {
    await seedLiveNode();
    await db.execute(sql`delete from contadores_instalacion`);
    await withTenant(db, TENANT_A.id, (tx) => restoreFiscal(tx, NODE, NOW));
    const fresh = await withTenant(db, TENANT_A.id, (tx) => currentSif(tx, TENANT_A.id, TENANT_A.nodeId));
    expect(fresh.numeroInstalacion).toBe(FLOOR);
  });

  it("does nothing for a node with no live SIF: no mint, no series", async () => {
    await db.execute(sql`
      insert into invoice_series (tenant_id, node_id, code) values (${TENANT_A.id}, ${TENANT_A.nodeId}, 'FA')
    `);
    const outcome = await withTenant(db, TENANT_A.id, (tx) => restoreFiscal(tx, NODE, NOW));
    expect(outcome.series).toBeUndefined();
    expect(outcome.report).toMatch(/no live SIF/);
    const { rows } = await db.execute<{ n: number }>(sql`select count(*)::int as n from registro_sif`);
    expect(rows[0]?.n).toBe(0);
  });

  it("derives from live series only, stripping our own suffixes, and ignores retired ones", async () => {
    const first = await seedLiveNode();
    await db.execute(sql`update invoice_series set retired_at = now() where code = 'RE'`);
    // A previous restore's derived code, live; `FA` retired by that restore.
    await db.execute(sql`update invoice_series set code = ${`FA-${first.numeroInstalacion}`} where code = 'FA'`);
    const outcome = await withTenant(db, TENANT_A.id, (tx) => restoreFiscal(tx, NODE, NOW));
    const fresh = await withTenant(db, TENANT_A.id, (tx) => currentSif(tx, TENANT_A.id, TENANT_A.nodeId));
    expect(outcome.series).toEqual([{ code: `FA-${fresh.numeroInstalacion}`, purpose: "standard" }]);
  });

  it("refuses a base code that cannot carry a suffix within NumSerieFactura's 60 characters, BEFORE minting", async () => {
    await seedLiveNode();
    const long = "L".repeat(MAX_BASE_CODE_LENGTH + 1);
    await db.execute(sql`update invoice_series set code = ${long} where code = 'FA'`);
    const err = await withTenant(db, TENANT_A.id, (tx) => restoreFiscal(tx, NODE, NOW)).catch((e: unknown) => e);
    expect(isAppError(err) && err.code).toBe("series.code_too_long");
    // Nothing minted: the live SIF is the seeded one, the counter untouched.
    const { rows } = await db.execute<{ n: number }>(sql`select count(*)::int as n from registro_sif`);
    expect(rows[0]?.n).toBe(1);
  });

  it("the first post-restore record verifies as a chain start", async () => {
    const first = await seedLiveNode();
    await seedSoldRegistro(db, { tenantId: TENANT_A.id, tillId: TENANT_A.tillId, nodeId: TENANT_A.nodeId, sifId: first.id, nif: SIF.nif, secuencia: 1, huella: "A".repeat(64) });
    await withTenant(db, TENANT_A.id, (tx) => restoreFiscal(tx, NODE, NOW));
    const fresh = await withTenant(db, TENANT_A.id, (tx) => currentSif(tx, TENANT_A.id, TENANT_A.nodeId));
    // One record under the NEW SIF, `primer_registro = true` (what the real append derives from
    // `esPrimerRegistro`, pinned by registro-sif.test.ts), then the verifier over the boundary.
    await seedSoldRegistro(db, { tenantId: TENANT_A.id, tillId: TENANT_A.tillId, nodeId: TENANT_A.nodeId, sifId: fresh.id, nif: SIF.nif, secuencia: 2, huella: "B".repeat(64) });
    const report = await withTenant(db, TENANT_A.id, (tx) => verifyChain(tx, TENANT_A.id, TENANT_A.nodeId));
    expect(report.ok).toBe(true);
  });

  it("FISCAL_RESTORE is restoreFiscal with the wall clock", async () => {
    await seedLiveNode();
    const before = installationFloor(new Date());
    await withTenant(db, TENANT_A.id, (tx) => FISCAL_RESTORE(tx, NODE));
    const fresh = await withTenant(db, TENANT_A.id, (tx) => currentSif(tx, TENANT_A.id, TENANT_A.nodeId));
    expect(fresh.numeroInstalacion).toBeGreaterThanOrEqual(before);
  });
});
```

In `provisioning.test.ts`, add under `describe("FISCAL_PROVISIONING.standby")` (find its existing `reserve` test for the setup shape and reuse it):

```ts
  it("reserve derives from the primary's LIVE series only — a retired series is history", async () => {
    // Seed the primary exactly as the sibling reserve test does, then retire one of its series.
    await db.execute(sql`update invoice_series set retired_at = now() where node_id = ${NODE.nodeId} and code = ${"<the retired code>"}`);
    const reservation = await withTenant(db, TENANT_A.id, (tx) => standby.reserve(tx, NODE));
    expect(reservation.series.map((s) => s.code)).not.toContainEqual(expect.stringMatching(/^<the retired code>-/));
  });
```

(Replace `<the retired code>` with the code the sibling test seeds.)

In `packages/composition/src/composition.test.ts`, in `describe("ALL_MODULES backup contribution")`:

```ts
  it("fiscal declares its restore hook, by reference", () => {
    const fiscal = ALL_MODULES.find((m) => m.name === "fiscal")!;
    expect(fiscal.backup?.restore).toBe(FISCAL_RESTORE);
  });
```

(add `FISCAL_RESTORE` to the `@waitron/fiscal-verifactu` import).

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @waitron/fiscal-verifactu test restore provisioning && pnpm --filter @waitron/composition test`
Expected: FAIL — `./restore.js` does not exist; `FISCAL_RESTORE` not exported.

- [ ] **Step 3: Register the code**

`packages/fiscal-verifactu/src/errors.ts`, inside `ErrorParams` beside the `sif.*` codes:

```ts
    /**
     * A restore cannot open a disjoint series for this base code: `NumSerieFactura` is capped at 60
     * characters (`packages/verifactu` validate) and the base plus one `-<installation number>` suffix
     * plus `/<counter>` would not fit. A base over `MAX_BASE_CODE_LENGTH` is not a real code; refused
     * BEFORE anything is minted. `series.*` names the concept (the `series.not_found` prefix), never
     * the package. Never renamed once shipped.
     */
    "series.code_too_long": { code: string };
```

- [ ] **Step 4: Implement the hook**

`packages/fiscal-verifactu/src/restore.ts`:

```ts
// Side-effect only: registers this package's codes on the shared registry. See ./errors.ts.
import "./errors.js";
import { and, eq, isNull, sql } from "drizzle-orm";
import { invoiceSeries, type Transaction } from "@waitron/db";
import type { ProvisionedNode, RestoreHook, RestoreOutcome } from "@waitron/module";
import { AppError, isAppError } from "@waitron/shared";
import { currentSif, registerSif, type SifRegistration } from "./registro-sif.js";
import { deriveReservedSeriesCodes } from "./reserved-series.js";
import { contadoresInstalacion, registroSif } from "./schema/sif.js";

/** `NumSerieFactura` (`<code>/<counter>`) is capped at 60 characters (packages/verifactu validate). A
 * base must leave room for one `-<installation number>` suffix and the counter, each at most ten
 * digits (`integer`), so it may be at most 38 characters. */
const NUM_SERIE_MAX = 60;
const MAX_INT_DIGITS = 10;
export const MAX_BASE_CODE_LENGTH = NUM_SERIE_MAX - (1 + MAX_INT_DIGITS) - (1 + MAX_INT_DIGITS);

const FLOOR_EPOCH_MS = Date.UTC(2020, 0, 1);

/**
 * The installation-number floor a restore raises the counter to: whole seconds since
 * 2020-01-01T00:00:00Z. The counter row is in the dump, so restoring an artifact older than a
 * previous restore's minting would otherwise re-mint that number; the wall clock is the one
 * monotonic state a sole box has that a restore does not roll back (spec §3.5). Fits `integer`
 * until 2088.
 */
export function installationFloor(now: Date): number {
  return Math.floor((now.getTime() - FLOOR_EPOCH_MS) / 1000);
}

/**
 * Raise `contadores_instalacion` for `(nif, id_sistema_informatico)` to at least `floor`, creating
 * the row when the restored database has none (a promoted standby's backup never wrote the counter:
 * `writeReservedSif` does not touch it). Never lowers it. The next `registerSif` mints `floor` or more.
 */
export async function raiseInstallationFloor(
  tx: Transaction,
  params: { nif: string; idSistemaInformatico: string; floor: number },
): Promise<void> {
  await tx
    .insert(contadoresInstalacion)
    .values({
      nif: params.nif,
      idSistemaInformatico: params.idSistemaInformatico,
      proximoNumero: params.floor,
    })
    .onConflictDoUpdate({
      target: [contadoresInstalacion.nif, contadoresInstalacion.idSistemaInformatico],
      set: {
        proximoNumero: sql`greatest(${contadoresInstalacion.proximoNumero}, ${params.floor})`,
      },
    });
}

/**
 * The base a restore derives a fresh code from: `code` with every trailing `-<digits>` group whose
 * digits are an installation number this tenant has registered (any node, live or revoked) removed.
 * `FA-7` from a promoted standby and `FA-210441234` from an earlier restore both give `FA`; a human's
 * `FA-2026` stays unless 2026 was an installation number. Keeps a code to one suffix regardless of
 * how many restores a node survives (`NumSerieFactura`'s 60-character cap).
 */
export function stripOwnSuffixes(code: string, registered: ReadonlySet<number>): string {
  let base = code;
  for (;;) {
    const match = /^(.*)-(\d{1,10})$/.exec(base);
    if (match === null || !registered.has(Number(match[2]))) return base;
    base = match[1]!;
  }
}

async function registeredNumbers(tx: Transaction, tenantId: string): Promise<Set<number>> {
  const rows = await tx
    .select({ n: registroSif.numeroInstalacion })
    .from(registroSif)
    .where(eq(registroSif.tenantId, tenantId));
  return new Set(rows.map((r) => r.n));
}

/**
 * The fiscal module's restore hook body (spec §6). With a live SIF: read the node's live series, refuse
 * a base that cannot carry a suffix, raise the counter floor, `registerSif` under the identity IN USE
 * (the live row's NIF + software id — the counter is keyed by that pair), and return the derived
 * disjoint codes for the orchestrator to open. Without one the node is not a filing node and the
 * restore does not make it one: nothing minted, `series` absent. Writes nothing to `invoice_series`.
 */
export async function restoreFiscal(
  tx: Transaction,
  node: ProvisionedNode,
  now: Date,
): Promise<RestoreOutcome> {
  let live: SifRegistration;
  try {
    live = await currentSif(tx, node.tenantId, node.nodeId);
  } catch (err) {
    if (isAppError(err) && err.code === "sif.not_registered") {
      return {
        report: `node ${node.nodeId} holds no live SIF; nothing re-registered, series unchanged`,
      };
    }
    throw err;
  }

  const liveSeries = await tx
    .select({ code: invoiceSeries.code, purpose: invoiceSeries.purpose })
    .from(invoiceSeries)
    .where(
      and(
        eq(invoiceSeries.tenantId, node.tenantId),
        eq(invoiceSeries.nodeId, node.nodeId),
        isNull(invoiceSeries.retiredAt),
      ),
    )
    .orderBy(invoiceSeries.code);
  const registered = await registeredNumbers(tx, node.tenantId);
  const bases = liveSeries.map((s) => ({
    code: stripOwnSuffixes(s.code, registered),
    purpose: s.purpose,
  }));
  for (const base of bases) {
    if (base.code.length > MAX_BASE_CODE_LENGTH) {
      throw new AppError("series.code_too_long", { code: base.code });
    }
  }

  await raiseInstallationFloor(tx, {
    nif: live.nif,
    idSistemaInformatico: live.idSistemaInformatico,
    floor: installationFloor(now),
  });
  const fresh = await registerSif(tx, {
    tenantId: node.tenantId,
    nodeId: node.nodeId,
    nif: live.nif,
    idSistemaInformatico: live.idSistemaInformatico,
  });
  const series = deriveReservedSeriesCodes(bases, fresh.numeroInstalacion);
  return {
    report: `SIF ${fresh.id} (installation ${fresh.numeroInstalacion}); series ${series.map((s) => s.code).join(", ")}`,
    series,
  };
}

/** The wired hook: {@link restoreFiscal} with the wall clock. */
export const FISCAL_RESTORE: RestoreHook = (tx, node) => restoreFiscal(tx, node, new Date());
```

`packages/fiscal-verifactu/src/index.ts`: add
`export { FISCAL_RESTORE, restoreFiscal, installationFloor, raiseInstallationFloor, stripOwnSuffixes, MAX_BASE_CODE_LENGTH } from "./restore.js";`.

In `provisioning.ts`'s `standby.reserve`, change the series read to
`.where(and(eq(invoiceSeries.nodeId, primary.nodeId), isNull(invoiceSeries.retiredAt)))` (add `and`, `isNull` to the `drizzle-orm` import).

In `packages/composition/src/modules.ts`: import `FISCAL_RESTORE` and add `backup: { restore: FISCAL_RESTORE },` to the `fiscal` descriptor; update the header's "Populated seats today" sentence to include `backup.restore` on `fiscal`, and delete `core`'s "`restore` is a later slice's seat (BR-3/BR-4) — unpopulated here" note.

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm --filter @waitron/fiscal-verifactu test restore provisioning && pnpm --filter @waitron/composition test`
Expected: PASS. Prove by deletion: comment out the `raiseInstallationFloor` call → "THE REUSE EXPERIMENT" and "creates the counter row" go red; restore. Comment out the `sif.not_registered` branch → "does nothing for a node with no live SIF" goes red; restore.

- [ ] **Step 6: Verify and commit**

Run: `pnpm format:check && pnpm --filter @waitron/fiscal-verifactu lint && pnpm --filter @waitron/fiscal-verifactu typecheck && TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test:coverage && pnpm --filter @waitron/composition test:coverage && pnpm test module-seams errors-reachable english-only` (root project).

```bash
git add packages/fiscal-verifactu packages/composition
git commit -s -m "feat(fiscal): FISCAL_RESTORE — clock-floored fresh SIF, bounded disjoint series; standby.reserve reads live series; wired on the fiscal descriptor"
```

---

### Task 5: The orchestrator — migrate, identity gate, one origin-stamped transaction, secrets last (`apps/server`)

**Files:**
- Modify: `apps/server/src/restore.ts`, `apps/server/src/errors.ts`, `apps/server/src/restore-command.ts` (doc + the operator precondition line), `apps/server/src/rejoin.ts` and `rejoin-command.ts` (the `skipSecrets` wording only)
- Test: `apps/server/src/restore.test.ts`, `apps/server/src/restore-command.test.ts`

**Interfaces:**
- Consumes: `retireNodeSeriesTx`, `insertNodeSeriesTx`, `readStandardSeriesIdTx`, `withTenant`, `createPostgresDb`, `nodes` (`@waitron/db`); `RestoreHook`, `orderedMigrationSets` (`@waitron/module`); `applyMigrations`, `migrationOptionsFor` (`@waitron/migrations`); `parseEnvFile`, `formatEnvFile` (`./env-file.js`); `isUnset` (`./env-value.js`).
- Produces (exact):

```ts
// RestoreDeps gains:
readonly openDb?: (url: string) => Promise<{ db: Database; close(): Promise<void> }>;
readonly migrate?: typeof applyMigrations;

export function readArtifactIdentity(secretEntries: readonly ArchiveEntry[]): {
  node: ProvisionedNode; seriesId: string;
};
export function rewriteTradingEnv(entries: readonly ArchiveEntry[], seriesId: string): ArchiveEntry[];
export async function runRestoreHooks(args: {
  db: Database; modules: readonly WaitronModule[]; node: ProvisionedNode; log: Logger;
}): Promise<{ seriesId: string | undefined; reports: readonly string[] }>;
```
`invokeRestoreHooks` and `RestoreHookContext` are deleted.

- [ ] **Step 1: Write the failing tests**

Rework `apps/server/src/restore.test.ts`:

1. Add a PGlite suite at module level (the `membership-mint.test.ts` shape), migrated with the whole manifest, and seed one identity:

```ts
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { sql } from "drizzle-orm";
import { formatEnvFile, parseEnvFile } from "./env-file.js";
import { AppError } from "@waitron/shared";

const suite = usePgliteDb({ migrations: migrationOptionsFor(manifestSets(), null), timeoutMs: 120_000 });

const T = {
  tenantId: "c0000000-0000-4000-8000-000000000001",
  locationId: "c0000000-0000-4000-8000-000000000002",
  tillId: "c0000000-0000-4000-8000-000000000003",
  seriesId: "c0000000-0000-4000-8000-000000000004",
  nodeId: "c0000000-0000-4000-8000-000000000008",
};
const TRADING_ENV = formatEnvFile({
  WAITRON_TILL_TENANT_ID: T.tenantId,
  WAITRON_TILL_TILL_ID: T.tillId,
  WAITRON_TILL_NODE_ID: T.nodeId,
  WAITRON_TILL_SERIES_ID: T.seriesId,
  WAITRON_TILL_LOCATION_ID: T.locationId,
  DATABASE_URL: "postgres://app@localhost/waitron",
  WAITRON_MIGRATIONS_DATABASE_URL: "postgres://owner@localhost/waitron",
  WAITRON_ENV: "preproduction",
});

beforeAll(async () => {
  const db = suite.db;
  await db.execute(sql`insert into tenants (id, country, tax_id, legal_name) values (${T.tenantId}, 'ES', '89890001K', 'Waitron SL')`);
  await db.execute(sql`insert into locations (id, tenant_id, name, invoice_locales, operation_description) values (${T.locationId}, ${T.tenantId}, 'Local', array['es'], 'Venta')`);
  await db.execute(sql`insert into tills (id, tenant_id, location_id, name) values (${T.tillId}, ${T.tenantId}, ${T.locationId}, 'Caja 1')`);
  await db.execute(sql`insert into nodes (id, tenant_id, location_id, name) values (${T.nodeId}, ${T.tenantId}, ${T.locationId}, 'Node 1')`);
  await db.execute(sql`insert into invoice_series (id, tenant_id, node_id, code) values (${T.seriesId}, ${T.tenantId}, ${T.nodeId}, 'FA')`);
});

/** Re-arm the node's series between tests: FA live, anything a hook opened removed. */
async function resetSeries(): Promise<void> {
  await suite.db.execute(sql`delete from invoice_series where node_id = ${T.nodeId} and id <> ${T.seriesId}`);
  await suite.db.execute(sql`update invoice_series set retired_at = null where id = ${T.seriesId}`);
}

const openDb = async () => ({ db: suite.db, close: async () => {} });
```

2. `FULL_ENTRIES` gains `{ name: "secrets/trading.env", bytes: Buffer.from(TRADING_ENV) }`; every `deps()` helper gains `openDb` and `migrate: vi.fn(async () => {})`.

3. Replace the `describe("invokeRestoreHooks")` block with `describe("restore hooks (identity phase)")`, `beforeEach(resetSeries)`, and these tests (each builds a module via `{ name, backup: { restore } } as unknown as WaitronModule`, passing `modules: [fake]` in `deps`; `runRestore` is the recording fake):

```ts
  it("migrates after pg_restore and BEFORE any hook; hooks run BEFORE secrets are written", async () => {
    const order: string[] = [];
    const migrate = vi.fn(async () => { order.push("migrate"); });
    const hook = vi.fn(async () => { order.push("hook"); await expect(stat(join(stateDir, "secrets.env"))).rejects.toMatchObject({ code: "ENOENT" }); return { report: "ok" }; });
    await restoreFromArtifact(deps({ migrate, modules: [mod("x", hook)], runRestore: vi.fn(async () => { order.push("pg_restore"); }) }));
    expect(order).toEqual(["pg_restore", "migrate", "hook"]);
    expect(migrate).toHaveBeenCalledWith("postgres://admin@localhost/fresh", expect.any(Array));
    expect(await readFile(join(stateDir, "secrets.env"), "utf8")).toBe(SECRET);
  });

  it("skipSecrets:true runs NO hook and reads no identity (the rejoin shape)", async () => {
    const hook = vi.fn(async () => ({ report: "must not run" }));
    await restoreFromArtifact(deps({ skipSecrets: true, modules: [mod("x", hook)] }));
    expect(hook).not.toHaveBeenCalled();
  });

  it("hands each hook (tx, node) with the ids from the ARTIFACT's trading.env, not the target's", async () => {
    await writeFile(join(stateDir, "trading.env"), formatEnvFile({ WAITRON_TILL_TENANT_ID: "stale", WAITRON_TILL_NODE_ID: "stale", WAITRON_TILL_LOCATION_ID: "stale", WAITRON_TILL_SERIES_ID: "stale" }));
    const hook = vi.fn(async () => ({ report: "ok" }));
    await restoreFromArtifact(deps({ modules: [mod("x", hook)] }));
    expect(hook).toHaveBeenCalledWith(expect.anything(), { tenantId: T.tenantId, locationId: T.locationId, nodeId: T.nodeId });
  });

  it("series returned → old retired + new opened in the SAME transaction, trading.env rewritten in exactly one key", async () => {
    const hook = async () => ({ report: "ok", series: [{ code: "FA-9", purpose: "standard" }] });
    await restoreFromArtifact(deps({ modules: [mod("x", hook)] }));
    const rows = await suite.db.execute<{ code: string; retired: boolean; next: number }>(sql`select code, retired_at is not null as retired, next_number as next from invoice_series where node_id = ${T.nodeId} order by code`);
    expect(rows.rows).toEqual([{ code: "FA", retired: true, next: 1 }, { code: "FA-9", retired: false, next: 1 }]);
    const written = parseEnvFile(await readFile(join(stateDir, "trading.env"), "utf8"));
    const original = parseEnvFile(TRADING_ENV);
    expect(written.WAITRON_TILL_SERIES_ID).not.toBe(T.seriesId);
    expect({ ...written, WAITRON_TILL_SERIES_ID: original.WAITRON_TILL_SERIES_ID }).toEqual(original);
    expect(Object.keys(written)).toEqual(Object.keys(original)); // order preserved
  });

  it("no series returned → trading.env is byte-identical to the artifact's", async () => {
    await restoreFromArtifact(deps({ modules: [mod("x", async () => ({ report: "ok" }))] }));
    expect(await readFile(join(stateDir, "trading.env"), "utf8")).toBe(TRADING_ENV);
  });

  it("a throwing second hook rolls the first hook's series writes back and writes NO secrets", async () => {
    const first = mod("a", async () => ({ report: "a", series: [{ code: "FA-9", purpose: "standard" }] }));
    const second = mod("b", async () => { throw new AppError("restore.unexpected_entry", { name: "boom" }); });
    await expect(restoreFromArtifact(deps({ modules: [first, second] }))).rejects.toMatchObject({ code: "restore.hook_failed", params: { module: "b", code: "restore.unexpected_entry" } });
    const rows = await suite.db.execute<{ code: string; retired: boolean }>(sql`select code, retired_at is not null as retired from invoice_series where node_id = ${T.nodeId}`);
    expect(rows.rows).toEqual([{ code: "FA", retired: false }]);
    await expect(stat(join(stateDir, "trading.env"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(stateDir, "secrets.env"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("two modules returning series → restore.series_conflict; an empty list → hook_failed wrapping no_standard_for_node", async () => {
    const a = mod("a", async () => ({ report: "a", series: [{ code: "FA-1", purpose: "standard" }] }));
    const b = mod("b", async () => ({ report: "b", series: [{ code: "FA-2", purpose: "standard" }] }));
    await expect(restoreFromArtifact(deps({ modules: [a, b] }))).rejects.toMatchObject({ code: "restore.series_conflict", params: { modules: "a,b" } });
    const empty = mod("a", async () => ({ report: "a", series: [] }));
    await expect(restoreFromArtifact(deps({ modules: [empty] }))).rejects.toMatchObject({ code: "restore.hook_failed", params: { module: "a", code: "series.no_standard_for_node" } });
  });

  it("identity_incomplete on a missing key; identity_unknown on a node the restored db lacks", async () => {
    const noNode = formatEnvFile({ ...parseEnvFile(TRADING_ENV), WAITRON_TILL_NODE_ID: "" });
    const entries = [FULL_ENTRIES[0]!, FULL_ENTRIES[1]!, { name: "secrets/trading.env", bytes: Buffer.from(noNode) }];
    await expect(restoreFromArtifact(deps({ artifact: buildArtifact(entries) }))).rejects.toMatchObject({ code: "restore.identity_incomplete", params: { missing: "WAITRON_TILL_NODE_ID" } });
    const noFile = [FULL_ENTRIES[0]!, FULL_ENTRIES[1]!, FULL_ENTRIES[2]!]; // no trading.env at all
    await expect(restoreFromArtifact(deps({ artifact: buildArtifact(noFile) }))).rejects.toMatchObject({ code: "restore.identity_incomplete", params: { missing: "trading.env" } });
    const strangeNode = formatEnvFile({ ...parseEnvFile(TRADING_ENV), WAITRON_TILL_NODE_ID: "c0000000-0000-4000-8000-0000000000ff" });
    await expect(restoreFromArtifact(deps({ artifact: buildArtifact([FULL_ENTRIES[0]!, FULL_ENTRIES[1]!, { name: "secrets/trading.env", bytes: Buffer.from(strangeNode) }]) }))).rejects.toMatchObject({ code: "restore.identity_unknown" });
  });
```

with `function mod(name: string, restore: unknown): WaitronModule { return { name, backup: { restore } } as unknown as WaitronModule; }` and `writeFile` added to the fs imports. Keep the existing tests; the "restores db dump, media and secrets" one now also asserts `trading.env` landed.

In `restore-command.test.ts`, extend the existing success-path test (the one with a fake `restore` that resolves) to assert `out` contains a line matching `/no peer .* survived/` and that it precedes the `restored` line; add a case where the fake `restore` rejects with `new AppError("restore.hook_failed", { module: "fiscal", code: "series.code_too_long" })` → exit 1 and `out` contains `restore.hook_failed`.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @waitron/server test restore`
Expected: FAIL — `openDb`/`migrate` unknown, no identity phase, `invokeRestoreHooks` still the old shape.

- [ ] **Step 3: Register the codes**

`apps/server/src/errors.ts`, after `restore.unexpected_entry`:

```ts
    /** The artifact's `secrets/trading.env` is absent or lacks one of the identity keys the restore
     * hooks need (`WAITRON_TILL_TENANT_ID`/`NODE_ID`/`LOCATION_ID`/`SERIES_ID`; an empty value is
     * missing). A backup of a box that never finished provisioning has no node to re-register.
     * `missing` is the fixed key or file name. Never renamed once shipped. */
    "restore.identity_incomplete": { missing: string };
    /** The artifact's identity names a node the restored database does not hold: the identity must
     * be one this backup knows. Both ids are uuids, not secrets. Never renamed once shipped. */
    "restore.identity_unknown": { tenantId: string; nodeId: string };
    /** More than one module's restore hook returned replacement series; only one may own the node's
     * numbering. `modules` is the comma-joined list of their names. Never renamed once shipped. */
    "restore.series_conflict": { modules: string };
    /** A module's restore hook, or the series write for its outcome, threw an `AppError`: `module` is
     * the module's name and `code` the inner code, so the CLI's `restore.*` reporting shows both
     * without learning any module's namespaces. A non-`AppError` throw is not wrapped. Never renamed
     * once shipped. */
    "restore.hook_failed": { module: string; code: string };
```

- [ ] **Step 4: Implement**

In `apps/server/src/restore.ts`:

Imports to add: `import { and, eq } from "drizzle-orm";`, `import { AppError, isAppError, locationId as brandLocationId, nodeId as brandNodeId, tenantId as brandTenantId } from "@waitron/shared";` (replace the existing `AppError` import), `import { createPostgresDb, insertNodeSeriesTx, nodes, readStandardSeriesIdTx, retireNodeSeriesTx, withTenant, type Database } from "@waitron/db";`, `import { applyMigrations, migrationOptionsFor } from "@waitron/migrations";` (keep `expectedSchemaVersion`), `import { orderedMigrationSets, type ProvisionedNode, type WaitronModule } from "@waitron/module";`, `import { formatEnvFile, parseEnvFile } from "./env-file.js";`, `import { isUnset } from "./env-value.js";`.

Constants beside the existing ones:

```ts
const TRADING_ENV_ENTRY = `${SECRETS_PREFIX}trading.env`;
const IDENTITY_KEYS = [
  "WAITRON_TILL_TENANT_ID",
  "WAITRON_TILL_NODE_ID",
  "WAITRON_TILL_LOCATION_ID",
  "WAITRON_TILL_SERIES_ID",
] as const;
```

`RestoreDeps` gains (with the `skipSecrets` doc rewritten to "Skip restoring `secrets/*` AND the restore hooks: a returning node keeps its OWN identity, and a hook exists only to make an ASSUMED identity trade-safe (spec §3.3)."):

```ts
  /** Opens the privileged connection the hook transaction runs on. Default `createPostgresDb`;
   * tests hand in a PGlite. */
  readonly openDb?: (url: string) => Promise<{ db: Database; close(): Promise<void> }>;
  /** Migrates the restored database to this binary's schema before any hook runs. Default
   * `applyMigrations`; tests stub it. */
  readonly migrate?: typeof applyMigrations;
```

Delete `RestoreHookContext`, `RestoreHook` (local type) and `invokeRestoreHooks`. Add:

```ts
/**
 * The identity the restored box will take, read from the ARTIFACT's `secrets/trading.env` — never the
 * target box's file, which may hold a stale or foreign identity. Every key is required and non-empty
 * (`isUnset`): a backup of a never-provisioned box has no node to re-register.
 */
export function readArtifactIdentity(secretEntries: readonly ArchiveEntry[]): {
  node: ProvisionedNode;
  seriesId: string;
} {
  const entry = secretEntries.find((e) => e.name === TRADING_ENV_ENTRY);
  if (entry === undefined) {
    throw new AppError("restore.identity_incomplete", { missing: "trading.env" });
  }
  const env = parseEnvFile(Buffer.from(entry.bytes).toString("utf8"));
  for (const key of IDENTITY_KEYS) {
    if (isUnset(env[key])) throw new AppError("restore.identity_incomplete", { missing: key });
  }
  return {
    node: {
      tenantId: brandTenantId(env.WAITRON_TILL_TENANT_ID!),
      locationId: brandLocationId(env.WAITRON_TILL_LOCATION_ID!),
      nodeId: brandNodeId(env.WAITRON_TILL_NODE_ID!),
    },
    seriesId: env.WAITRON_TILL_SERIES_ID!,
  };
}

/** The secret entries with `trading.env`'s `WAITRON_TILL_SERIES_ID` replaced; every other key and the
 * line order preserved (`parseEnvFile` keeps insertion order; `formatEnvFile` writes it back). */
export function rewriteTradingEnv(
  entries: readonly ArchiveEntry[],
  seriesId: string,
): ArchiveEntry[] {
  return entries.map((e) =>
    e.name === TRADING_ENV_ENTRY
      ? {
          name: e.name,
          bytes: Buffer.from(
            formatEnvFile({
              ...parseEnvFile(Buffer.from(e.bytes).toString("utf8")),
              WAITRON_TILL_SERIES_ID: seriesId,
            }),
          ),
        }
      : e,
  );
}

function wrapHookError(module: string, err: unknown): unknown {
  return isAppError(err) ? new AppError("restore.hook_failed", { module, code: err.code }) : err;
}

/**
 * Run every module's `backup.restore` hook and open the node's replacement series, in ONE tenant
 * transaction stamped with the node as sync origin (`registro_sif`/`cadenas` are enrolled on the
 * ordered lane; a later standby pulls only rows whose origin is this node). Order: check the node
 * exists → hooks in list order → at most one module may return `series` → retire the node's live
 * series, open the returned ones, and read the live standard series id — zero or two live standard
 * series aborts the transaction, so a commit never leaves a node that cannot sell. Returns the new
 * standard series id (undefined when no module returned series) and the hooks' reports.
 */
export async function runRestoreHooks(args: {
  db: Database;
  modules: readonly WaitronModule[];
  node: ProvisionedNode;
  log: Logger;
}): Promise<{ seriesId: string | undefined; reports: readonly string[] }> {
  const { node } = args;
  return withTenant(
    args.db,
    node.tenantId,
    async (tx) => {
      const [known] = await tx
        .select({ id: nodes.id })
        .from(nodes)
        .where(and(eq(nodes.tenantId, node.tenantId), eq(nodes.id, node.nodeId)))
        .limit(1);
      if (known === undefined) {
        throw new AppError("restore.identity_unknown", {
          tenantId: node.tenantId,
          nodeId: node.nodeId,
        });
      }
      const reports: string[] = [];
      let replacement:
        | { module: string; series: readonly { code: string; purpose: string }[] }
        | undefined;
      for (const m of args.modules) {
        const hook = m.backup?.restore;
        if (hook === undefined) continue;
        let outcome;
        try {
          outcome = await hook(tx, node);
        } catch (err) {
          throw wrapHookError(m.name, err);
        }
        reports.push(`${m.name}: ${outcome.report}`);
        args.log("info", "restore.hook.done", { module: m.name, report: outcome.report });
        if (outcome.series !== undefined) {
          if (replacement !== undefined) {
            throw new AppError("restore.series_conflict", {
              modules: `${replacement.module},${m.name}`,
            });
          }
          replacement = { module: m.name, series: outcome.series };
        }
      }
      if (replacement === undefined) return { seriesId: undefined, reports };
      try {
        await retireNodeSeriesTx(tx, node.tenantId, node.nodeId);
        await insertNodeSeriesTx(tx, node.tenantId, node.nodeId, replacement.series);
        const seriesId = await readStandardSeriesIdTx(tx, node.tenantId, node.nodeId);
        return { seriesId, reports };
      } catch (err) {
        throw wrapHookError(replacement.module, err);
      }
    },
    { nodeId: node.nodeId },
  );
}
```

Rewrite `writeValidated`'s body:

```ts
  const { log } = deps;
  const staged = join(deps.stagingDir, DB_DUMP_NAME);
  try {
    await restoreDatabase({ dumpBytes: validated.dumpEntry.bytes, stagingDir: deps.stagingDir, databaseUrl: deps.databaseUrl, runRestore: deps.runRestore ?? realPgRestore, log });
    await restoreMedia({ entries: validated.mediaEntries, mediaDir: deps.mediaDir, log });
    // The gate admits an OLDER schema; a hook written against today's must not run against
    // yesterday's. Every module, as setup mode migrates — the CLI has no enabled-set config.
    await (deps.migrate ?? applyMigrations)(
      deps.databaseUrl,
      migrationOptionsFor(orderedMigrationSets(deps.modules), deps.migrationsRoot),
    );
    log("info", "restore.migrated", {});
    if (deps.skipSecrets) {
      log("info", "restore.identity.kept", {});
      return;
    }
    const identity = readArtifactIdentity(validated.secretEntries);
    const opened = await (deps.openDb ?? openPostgres)(deps.databaseUrl);
    let seriesId: string | undefined;
    try {
      ({ seriesId } = await runRestoreHooks({ db: opened.db, modules: deps.modules, node: identity.node, log }));
    } finally {
      await opened.close();
    }
    const entries =
      seriesId === undefined || seriesId === identity.seriesId
        ? validated.secretEntries
        : rewriteTradingEnv(validated.secretEntries, seriesId);
    await restoreSecrets({ entries, stateDir: deps.stateDir, log });
  } finally {
    await rm(staged, { force: true });
  }
```

with `async function openPostgres(url: string) { const db = await createPostgresDb(url); return { db, close: () => db.close() }; }`. Rewrite the `writeValidated` and `restoreFromArtifact` doc comments to state the new order and delete every "mints NO fresh chain … no trade-readier" sentence (§11): the truth is now "runs each module's restore hook inside one transaction BEFORE the identity is written, so a failed hook leaves no bootable identity".

In `restore-command.ts`: replace the "`modules` is always `ALL_MODULES` … the restore-hook seat is empty in v1" paragraph with "`modules` is always `ALL_MODULES`: a restore hook must run for every module whose tables are in the backup, and the descriptor list is that set." Before `await restore(restoreDeps)`, print:

```ts
  deps.out(
    "cold restore: use only when no peer (mirror or local secondary) survived — a survivor holds more history and is promoted, not overwritten (promotion runbook §5d)",
  );
```

In `rejoin.ts:36-37` and `rejoin-command.ts:86`, extend the `skipSecrets:true` remark: "(the returning node keeps its own identity, and no module restore hook runs)".

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm --filter @waitron/server test restore rejoin`
Expected: PASS (rejoin suites unchanged in behaviour). Prove by deletion: remove the `if (deps.skipSecrets) return;` gate → the "skipSecrets:true runs NO hook" test fails; restore. Remove `{ nodeId: node.nodeId }` from `withTenant` → nothing here fails (Task 6's e2e is what catches it); leave it in.

- [ ] **Step 6: Verify and commit**

Run: `pnpm format:check && pnpm --filter @waitron/server lint && pnpm --filter @waitron/server typecheck && pnpm --filter @waitron/server test restore rejoin backup && pnpm test module-seams errors-reachable`

```bash
git add apps/server
git commit -s -m "feat(server): restore runs module hooks in one origin-stamped transaction — migrate first, identity from the artifact, secrets written last"
```

---

### Task 6: The real-Postgres end-to-end receipt (`apps/server`)

**Files:**
- Create: `apps/server/src/restore-fiscal-e2e.rls.test.ts`

**Interfaces:**
- Consumes everything above through the shipped `restoreFromArtifact`; `schemaVersionsByModule` (`./backup-manifest.js`); `expectedSchemaVersion` (`@waitron/migrations`); `locateSharedContainer`; `readStandardSeriesId` (`@waitron/db`).

- [ ] **Step 1: Write the suite**

Model it on `rejoin-e2e.rls.test.ts` (copy its `containerPgRestore`, `internalUrl`, artifact-building `beforeAll`, LOUD-skip and teardown shapes verbatim) with these differences:

1. `seedFiscalRegistro(admin)` seeds `F` with a **realistic** identity: `registro_sif` row `('89890001K', 'W1', 1)`, the counter row `insert into contadores_instalacion (nif, id_sistema_informatico, proximo_numero) values ('89890001K', 'W1', 2)`, series `FA` (standard, `next_number` 5) as `F.seriesId` plus `RE` (rectificative), one `registros_facturacion` row (`num_serie_factura 'FA/4'`, huella `'A'.repeat(64)`), and `cadenas` pointed at it (`seedSoldRegistro`'s final UPDATE shape).
2. The artifact's secrets are `secrets/trading.env` = `formatEnvFile({ WAITRON_TILL_TENANT_ID: F.tenantId, WAITRON_TILL_TILL_ID: F.tillId, WAITRON_TILL_NODE_ID: F.nodeId, WAITRON_TILL_SERIES_ID: F.seriesId, WAITRON_TILL_LOCATION_ID: F.locationId, DATABASE_URL: "postgres://app@localhost/waitron", WAITRON_MIGRATIONS_DATABASE_URL: "postgres://owner@localhost/waitron", WAITRON_ENV: "preproduction" })` and `secrets/secrets.env` = `"WAITRON_CREDENTIALS_KEY=deadbeef\n"`.
3. **Targets are FRESH databases**, not template clones: `makeFreshTarget()` runs `docker exec <id> psql <internal("postgres")> -v ON_ERROR_STOP=1 -c "create database <name>"` (`pg-restore.test.ts`'s step 4) with `name = \`restore_fiscal_${process.pid}_${n++}\``, records it for `drop database … with (force)` in `afterAll`, and returns `databaseUrl(adminUri, name)`.
4. `drive(targetUrl, dirs, over = {})` calls the shipped `restoreFromArtifact({ artifact: await readFile(artifactPath), recoveryKey: RECOVERY_KEY, databaseUrl: targetUrl, ...dirs, stagingDir: join(dirs.stateDir, "restore-staging"), migrationsRoot, modules: ALL_MODULES, environment: "preproduction", runRestore: containerPgRestore(containerId!), log: noopLog, ...over })` — the real `applyMigrations` and the real `createPostgresDb` (no `migrate`/`openDb` override).

Tests:

```ts
  it("re-registers the SIF, retires and replaces the series, rewrites trading.env, keeps the ledger immutable, stamps the origin", async () => {
    if (containerId === undefined) return;
    const target = await makeFreshTarget();
    const dirs = await arrangeDirs();
    await drive(target, dirs);

    const db = await createPostgresDb(target);
    try {
      // SIF: old revoked, new live, number ≥ the clock floor.
      const sifs = await db.execute<{ numero_instalacion: number; revocado_en: string | null }>(sql`select numero_instalacion, revocado_en from registro_sif where node_id = ${F.nodeId}::uuid order by numero_instalacion`);
      expect(sifs.rows).toHaveLength(2);
      expect(sifs.rows[0]).toMatchObject({ numero_instalacion: 1 });
      expect(sifs.rows[0]?.revocado_en).not.toBeNull();
      expect(sifs.rows[1]?.revocado_en).toBeNull();
      expect(sifs.rows[1]!.numero_instalacion).toBeGreaterThanOrEqual(installationFloor(new Date(Date.now() - 60_000)));
      const n = sifs.rows[1]!.numero_instalacion;
      // Chain head reset, sequence kept.
      const head = await db.execute<{ ultima_huella: string | null; secuencia: number }>(sql`select ultima_huella, secuencia from cadenas where node_id = ${F.nodeId}::uuid`);
      expect(head.rows[0]).toEqual({ ultima_huella: null, secuencia: 1 });
      // Series: FA and RE retired; FA-n / RE-n live at 1.
      const series = await db.execute<{ code: string; retired: boolean; next_number: number }>(sql`select code, retired_at is not null as retired, next_number from invoice_series where node_id = ${F.nodeId}::uuid order by code`);
      expect(series.rows).toEqual([
        { code: "FA", retired: true, next_number: 5 },
        { code: `FA-${n}`, retired: false, next_number: 1 },
        { code: "RE", retired: true, next_number: 1 },
        { code: `RE-${n}`, retired: false, next_number: 1 },
      ]);
      // trading.env names the new standard series; everything else preserved.
      const env = parseEnvFile(await readFile(join(dirs.stateDir, "trading.env"), "utf8"));
      expect(env.WAITRON_TILL_SERIES_ID).toBe(await readStandardSeriesId(db, F.tenantId, F.nodeId));
      expect(env.WAITRON_TILL_NODE_ID).toBe(F.nodeId);
      expect(env.DATABASE_URL).toBe("postgres://app@localhost/waitron");
      // The ledger row is present and IMMUTABLE (BR-3's receipt, kept).
      const ledger = await db.execute<{ n: number }>(sql`select count(*)::int as n from registros_facturacion`);
      expect(ledger.rows[0]?.n).toBe(1);
      const blocked = await db.execute(sql`update registros_facturacion set huella = ${"E".repeat(64)}`).then(() => undefined).catch((e: unknown) => e as { code?: string; cause?: { code?: string } });
      expect(blocked?.code ?? blocked?.cause?.code).toBe("WT001");
      // Origin stamping: the hook's captured rows carry THIS node, not the all-zero origin.
      const captured = await db.execute<{ n: number }>(sql`select count(*)::int as n from sync_log where table_name in ('registro_sif', 'cadenas') and origin_id = ${F.nodeId}::uuid`);
      expect(captured.rows[0]!.n).toBeGreaterThanOrEqual(3); // revoke + insert + head reset
      // Migrated to this binary's schema.
      expect(await schemaVersionsByModule(db, ALL_MODULES)).toEqual(Object.fromEntries(ALL_MODULES.map((m) => [m.name, expectedSchemaVersion(m.migrations, migrationsRoot)])));
    } finally {
      await db.close();
    }
    await expect(stat(join(dirs.stateDir, "restore-staging", "db.dump"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("NEGATIVE CONTROL — skipSecrets:true (the rejoin shape) leaves SIF, series and stateDir untouched", async () => {
    if (containerId === undefined) return;
    const target = await makeFreshTarget();
    const dirs = await arrangeDirs();
    await drive(target, dirs, { skipSecrets: true });
    const db = await createPostgresDb(target);
    try {
      const sifs = await db.execute<{ n: number }>(sql`select count(*)::int as n from registro_sif where revocado_en is null and numero_instalacion = 1`);
      expect(sifs.rows[0]?.n).toBe(1);
      const retired = await db.execute<{ n: number }>(sql`select count(*)::int as n from invoice_series where retired_at is not null`);
      expect(retired.rows[0]?.n).toBe(0);
    } finally {
      await db.close();
    }
    await expect(stat(join(dirs.stateDir, "trading.env"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("a throwing hook after the fiscal one rolls the SIF and series back and writes no identity", async () => {
    if (containerId === undefined) return;
    const target = await makeFreshTarget();
    const dirs = await arrangeDirs();
    const boom = { name: "boom", version: "0.0.0", tier: "toggleable", migrations: { name: "boom", table: "__drizzle_migrations_boom", from: "../boom/drizzle" }, backup: { restore: async () => { throw new AppError("restore.unexpected_entry", { name: "boom" }); } } } as unknown as WaitronModule;
    // `modules` feeds the gate and the migrate step too, so the fake module needs a migrations folder:
    // point `from` at an EMPTY folder created under scratchRoot/migrations/boom with an empty journal —
    // OR pass the fake only to the hook phase by wrapping: simplest is to keep `modules: ALL_MODULES`
    // for gate+migrate and run `writeValidated` with `modules: [...ALL_MODULES, boom]` after a
    // `validateArtifact` with `ALL_MODULES`. Do the latter.
    const rd = restoreDepsFor(target, dirs);
    const validated = await validateArtifact(rd);
    await expect(writeValidated(validated, { ...rd, modules: [...ALL_MODULES, boom], migrate: async () => {} })).rejects.toMatchObject({ code: "restore.hook_failed", params: { module: "boom" } });
    const db = await createPostgresDb(target);
    try {
      const sifs = await db.execute<{ n: number }>(sql`select count(*)::int as n from registro_sif`);
      expect(sifs.rows[0]?.n).toBe(1); // the fiscal hook's new row rolled back
      const retired = await db.execute<{ n: number }>(sql`select count(*)::int as n from invoice_series where retired_at is not null`);
      expect(retired.rows[0]?.n).toBe(0);
    } finally {
      await db.close();
    }
    await expect(stat(join(dirs.stateDir, "trading.env"))).rejects.toMatchObject({ code: "ENOENT" });
  });
```

(`restoreDepsFor` is the deps-building half of `drive`; `migrate: async () => {}` in the third test avoids `orderedMigrationSets` seeing the fake module — the real migrate ran in neither, so also assert nothing: this test is about the rollback.)

- [ ] **Step 2: Run it**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test restore-fiscal-e2e`
Expected: PASS with the container reachable (a LOUD skip line otherwise — then it proves nothing; get docker up). Prove by deletion: remove `{ nodeId: node.nodeId }` from `runRestoreHooks`'s `withTenant` → the origin assertion counts 0 → red; restore it.

- [ ] **Step 3: Verify and commit**

Run: `pnpm format:check && pnpm --filter @waitron/server lint && pnpm --filter @waitron/server typecheck && pnpm test guarded-teardowns` (root: the suite's raw teardown must be guarded).

```bash
git add apps/server/src/restore-fiscal-e2e.rls.test.ts
git commit -s -m "test(server): real-Postgres receipt for the fiscal restore hook — fresh SIF, retired series, origin-stamped, rollback, skipSecrets control"
```

---

### Task 7: Receipts, docs, and the whole-package runs

**Files:**
- Modify: `CLAUDE.md` (§5), `docs/backlog.md`, `docs/superpowers/plans/2026-08-30-onboarding-slice4b-iii-cold-restore-runbook.md`, `docs/superpowers/specs/2026-09-04-backup-restore-regime-design.md`, `docs/superpowers/specs/2026-09-05-membership-rejoin-r3-wipe-and-restore-design.md`, `docs/superpowers/specs/2026-09-06-module-sp3d-fiscal-restore-hook-design.md` (status line), plus any code comment §11 lists that Tasks 1–6 did not already retire.

- [ ] **Step 1: The base-to-tip receipt sweep**

Run `git diff origin/main..HEAD --stat` and then, for every claim §11 of the spec lists, `grep -rn` the phrase across the WHOLE tree (`packages/ apps/ scripts/ docs/ .github/ CLAUDE.md README.md`) — not only the files the branch touched:

```bash
grep -rn "no business touching the fiscal chain\|mints NO fresh chain\|no trade-readier\|EMPTY in v1\|restore-hook seat is empty\|body lands in BR-3/BR-4\|later slice's seat\|only the \`restoreSecrets\` write is elided\|unreachable today\|backstopped by AEAT error" packages apps scripts docs .github CLAUDE.md README.md | grep -v node_modules
```

Fix each hit: code comments get the invariant (one line, no history); docs get a dated pointer (`> **2026-09-06 (SP-3d):** …`) — never a rewrite of a historical spec.

- [ ] **Step 2: CLAUDE.md §5**

Change the "Re-registering a node starts a new chain" bullet to:

```
- **Re-registering a node starts a new chain** and mints a fresh installation number. Correct for a
  reimaged box, destructive for a working one. A cold restore (`waitron-restore`) does it
  automatically inside the restore: it floors the installation counter by the clock (the counter is in
  the dump, so an older artifact would otherwise re-mint a number a previous restore used), retires
  the node's invoice series and opens disjoint ones, and writes the box's identity only after that
  commits — `docs/superpowers/specs/2026-09-06-module-sp3d-fiscal-restore-hook-design.md`.
```

- [ ] **Step 3: Backlog**

In `docs/backlog.md`: mark SP-3d / BR-4 LANDED-pending (the row at ~L865 and the BR-4 bullet at ~L1464; the section header at ~L1414) as "**SP-3d — on branch, PR open, owner-gated (H2)**" with the PR number once known; replace the "Cold-restore follow-up (from 4b-iii)" note (~L1651) with a one-line "closed by SP-3d" pointer; in the promote-action slices (~L1748) change Slice 4's gate to "mechanism landed with SP-3d; remaining: the operator surface (§2 of the SP-3d spec: connection rebinding, advertised origin, an authenticated entry)"; under the SP-3c follow-ups add: "the provisioning seed opens `withTenant` without `{ nodeId }` (`packages/provisioning/src/venue-apply.ts`), so its captured fiscal rows carry the all-zero origin — same class as the SP-3d review's Major 1; fix with the first standby that adopts from a freshly provisioned primary". Record the yardstick data (fix rounds per task, false claims found at whole-branch review) in the SP-3d row when `/finish-branch` is done.

- [ ] **Step 4: Spec status line**

In the SP-3d spec, change `**Status:** design.` to `**Status:** built on feat/module-sp3d-fiscal-restore-hook; owner review at PR.`

- [ ] **Step 5: Whole-package and root runs**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test                                      # root project: every guard, unfiltered
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test:coverage
pnpm --filter @waitron/core test:coverage
pnpm --filter @waitron/module test:coverage
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test:coverage
pnpm --filter @waitron/composition test:coverage
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage   # alone; nothing else running
pnpm --filter @waitron/provisioning test:coverage                               # depends on db's schema change
```

Every run green at its package's bar. If `apps/server`'s run trips a known timing flake in `boot.test`/`mirror-e2e`, re-run that file once before investigating.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -s -m "docs: SP-3d receipts — CLAUDE.md §5 cold restore, backlog, runbook and spec pointers"
```

Then hand over to `/finish-branch` (simplify → the two reviewers → rebase → PR → CI). **Do not land**: this slice is owner-gated.

---

## Self-review (done while writing)

- **Spec coverage:** §3.1 (no node-id change) — nothing to build, Task 5 keeps `trading.env`'s node id. §3.2/§7 — Tasks 1, 2, 4 (`standby.reserve`), 5. §3.3 — Task 5 gate + test, Task 6 control. §3.4 — Tasks 3, 4, 5. §3.5 — Task 4 (`installationFloor`, `raiseInstallationFloor`, the reuse experiment). §4 — Task 3. §5 — Task 5 (migrate, identity, transaction, origin `{ nodeId }`, secrets last), Task 6 (real migrate, origin count, rollback). §6 — Task 4 (bases, bound, live-row identity, no-live-SIF branch). §8 — Tasks 1, 2, 4, 5. §9 — Tasks 1, 2, 4, 5, 6; root guards in Tasks 4, 5, 7. §11 — Tasks 4, 5, 7. §2's CLI precondition line — Task 5.
- **Placeholders:** the `provisioning.test.ts` addition in Task 4 names `<the retired code>` for the implementer to read off the sibling test — that is a read, not a TBD; everything else is literal.
- **Type consistency:** `RestoreHook(tx, node)` in Tasks 3, 4, 5, 6; `RestoreOutcome.series` shape `{ code, purpose }` everywhere; `runRestoreHooks` returns `{ seriesId, reports }` (Task 5 body and tests); `openDb` returns `{ db, close }` in Task 5's seam and both tests; `insertNodeSeriesTx(tx, tenantId, nodeId, series)` in Tasks 1 and 5; `readStandardSeriesIdTx(tx, tenantId, nodeId)` in Tasks 1 and 5.
