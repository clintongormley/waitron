# Payment `reconcile()` — Slice A (neutral sweep) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the provider-neutral payment reconciliation sweep in `@waitron/payments` — five mismatch classes, three injected vendor ports, aggregate idempotent incidents, and a bounded orphan self-heal — proven end-to-end with fakes, real-Postgres RLS/concurrency suites and a wiring capstone.

**Architecture:** `reconcilePayments(deps, tenantId, period, now)` owns the whole algorithm and lives in the neutral package. The vendor supplies three narrow ports (`SettlementReportSource`, `ReversalFn`, `IncidentSink`), so `@waitron/core` stays a dev dependency. The sweep is T1 read → report fetch (outside every transaction) → pure `classify()` → T2 incidents + marker → reversals (outside every transaction). A new `PaymentReconciler` interface is the seam; `StripeReconciler` is Slice B and out of scope here.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), drizzle-orm 0.45, PostgreSQL 18, PGlite for behavioural tests, Testcontainers for RLS/concurrency, vitest 3.

**Spec:** [`docs/superpowers/specs/2026-07-25-payment-reconcile-design.md`](../specs/2026-07-25-payment-reconcile-design.md)

## Global Constraints

- **Package:** all production code lands in `packages/payments`. **Nothing** in `packages/payments-stripe` or `apps/*` — that is Slice B.
- **`@waitron/core` stays a DEV dependency of `packages/payments`.** Production code must never `import` it. `IncidentSink` is typed structurally so `recordIncidentOnce` is assignable to it.
- **Banned vocabulary** (`no-provider-vocabulary.test.ts`, blunt case-insensitive substring over comment-stripped source): `stripe`, `adyen`, `sumup`, `paymentintent`, `readerid`, `reader`, `terminal`, `connectiontoken`, `acquirer`. Note **`terminal` is banned even in its CS sense** — write `finalState`, never `terminalState`. Comments are stripped before the scan, so prose may mention them.
- **Money is exact decimal.** Never `Number` on an amount. Compare with `compareDecimal(decimal(a), b)`; `numeric(12,2)` columns come back as strings and stay strings.
- **Errors are structured codes + params**, never prose (localisation rule). New codes are declared in `packages/payments/src/errors.ts` via declaration merging on `ErrorParams`.
- **T1/T2:** never hold a database transaction across a network call. The report fetch and every reversal run outside `withTenant`.
- **Import style:** ESM with explicit `.js` specifiers (`from "./store.js"`), `import type` for type-only imports.
- **Every step's commands run from the worktree root:** `/Users/<user>/workspace/worktrees/waitron-payment-reconcile-slice-a`.
- **Test command:** `pnpm --filter @waitron/payments test`. Coverage (`test:coverage`, thresholds 98/98/98/95) is run once, in Task 10 — it is a CI-only gate that no local hook runs.
- **Real-Postgres suites throw, never skip,** when Docker is absent (`startRealPostgres` already does this). If Docker is down, that is an environment failure to report, not a test to weaken.
- **Prettier is a separate gate from eslint.** Run `pnpm format:check` before the final commit; `pnpm --filter @waitron/payments lint` does not cover it.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/payments/src/schema/payments.ts` | **Modify** — add the `reconcile_remediated_at` column + `payments_reconcile_idx` |
| `packages/payments/drizzle/0009_payments_reconcile_marker.sql` | **Create** (generated) — the migration |
| `packages/payments/src/store.ts` | **Modify** — `listReconcilable`, `anyPaymentWithReference`, `markReconcileRemediated`, `tillForWorkingOrder` |
| `packages/payments/src/reconcile.ts` | **Create** — the contract types, the ports, the pure `classify()`, and the `reconcilePayments()` orchestrator |
| `packages/payments/src/errors.ts` | **Modify** — six `payment.reconcile_*` codes |
| `packages/payments/src/provider.ts` | **Modify** — one doc-comment line ("`reconcile` is a later plan" is no longer true) |
| `packages/payments/src/index.ts` | **Modify** — barrel exports |
| `packages/payments/src/testing/fake-settlement-report.ts` | **Create** — configurable `SettlementReportSource` double |
| `packages/payments/src/testing/fake-reconciler.ts` | **Create** — `FakeReconciler implements PaymentReconciler` |
| `packages/payments/src/classify.test.ts` | **Create** — pure classification, no DB |
| `packages/payments/src/reconcile.test.ts` | **Create** — the sweep on PGlite |
| `packages/payments/src/reconcile.rls.test.ts` | **Create** — real Postgres, non-superuser probe |
| `packages/payments/src/reconcile.concurrency.test.ts` | **Create** — real Postgres, two racing sweeps |
| `packages/payments/src/reconcile.wiring.test.ts` | **Create** — the capstone |
| `packages/payments/src/store.test.ts`, `index.test.ts`, `migrations.test.ts` | **Modify** — cover the new surface |

`reconcile.ts` holds both the contract and the sweep deliberately: they are one responsibility (the audit), and splitting the types into a `*-types.ts` would be a technical-layer split with a type-only import cycle back into the orchestrator. `classify()` is exported from that module (not from the package barrel) so it can be tested exhaustively without a database.

---

### Task 1: The remediation marker — schema, index, migration

**Files:**

- Modify: `packages/payments/src/schema/payments.ts`
- Create: `packages/payments/drizzle/0009_payments_reconcile_marker.sql` (generated)
- Test: `packages/payments/src/migrations.test.ts`, `packages/payments/src/index.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: the `payments.reconcile_remediated_at` column (`timestamptz`, nullable) and the `payments_reconcile_idx` index on `(tenant_id, provider, settled_at)`. Task 2's store functions read and write the column.

- [ ] **Step 1: Write the failing migration tests**

Append to `packages/payments/src/migrations.test.ts`, following the existing `external_ref` test verbatim in shape:

```ts
  it("adds a nullable reconcile_remediated_at column to payments", async () => {
    const db = await createPgliteDb();
    try {
      await runMigrations(db, CORE_MIGRATIONS);
      await runMigrations(db, PAYMENTS_MIGRATIONS);
      const rows = await db.execute<{ data_type: string; is_nullable: string }>(sql`
        select data_type, is_nullable
        from information_schema.columns
        where table_name = 'payments' and column_name = 'reconcile_remediated_at'
      `);
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0].data_type).toBe("timestamp with time zone");
      expect(rows.rows[0].is_nullable).toBe("YES");
    } finally {
      await db.close();
    }
  });

  it("creates the reconcile sweep index on payments", async () => {
    const db = await createPgliteDb();
    try {
      await runMigrations(db, CORE_MIGRATIONS);
      await runMigrations(db, PAYMENTS_MIGRATIONS);
      const rows = await db.execute<{ indexdef: string }>(sql`
        select indexdef from pg_indexes
        where tablename = 'payments' and indexname = 'payments_reconcile_idx'
      `);
      expect(rows.rows).toHaveLength(1);
      // A plain, NON-UNIQUE index: a unique one here would break any legitimate
      // "N rows sharing a key" writer (the PR #25 lesson).
      expect(rows.rows[0].indexdef).not.toContain("UNIQUE");
      expect(rows.rows[0].indexdef).toContain("tenant_id");
      expect(rows.rows[0].indexdef).toContain("provider");
      expect(rows.rows[0].indexdef).toContain("settled_at");
    } finally {
      await db.close();
    }
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @waitron/payments test -- migrations`
Expected: FAIL — both new tests get `rows` of length 0 (`expected 0 to be 1`).

- [ ] **Step 3: Add the column and the index to the schema**

In `packages/payments/src/schema/payments.ts`, add the column after `settledAt` (keep the existing doc-comment density):

```ts
    /** Set by the reconcile sweep when it ATTEMPTS to auto-reverse an orphan (a captured payment
     * with no sale on an abandoned working order), whether or not that reversal then succeeds.
     * Bounds the self-heal to one attempt so a permanently-unrefundable orphan cannot start a
     * retry storm on every sweep — exactly as `envios.reconciled_resubmit_at` bounds the fiscal
     * self-heal. Null on every payment reconcile has not remediated. */
    reconcileRemediatedAt: timestamp("reconcile_remediated_at", {
      withTimezone: true,
      mode: "string",
    }),
```

and add the index to the `(t) => [...]` extraConfig array, after `index("payments_sale_idx")`:

```ts
    // The reconcile sweep's own filter: one tenant's rows for one provider over a settled_at
    // window. Plain and non-unique — it constrains nothing, so it cannot collide with any writer.
    index("payments_reconcile_idx").on(t.tenantId, t.provider, t.settledAt),
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @waitron/payments exec drizzle-kit generate --name payments_reconcile_marker`

Expected: creates `packages/payments/drizzle/0009_payments_reconcile_marker.sql` containing an `ALTER TABLE "payments" ADD COLUMN "reconcile_remediated_at" timestamp with time zone;` and a `CREATE INDEX "payments_reconcile_idx" ...`. Read the generated SQL and confirm it contains **only** those two statements — if drizzle-kit emits anything else (a dropped index, a re-created constraint), stop and report it rather than committing it.

Note: do **not** write `-- --name` with a `--` separator; under this pnpm the separator leaks to drizzle-kit. The `exec` form above is the working one.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @waitron/payments test -- migrations`
Expected: PASS (all migration tests, old and new).

- [ ] **Step 6: Assert the new index in the table-config test**

`packages/payments/src/index.test.ts` already has a `getTableConfig(payments)` block (a table's `(t) => [...]` callback is lazy and never runs on plain import, so without this the lines report uncovered). Extend that block's index assertion to include the new index name — find the existing assertion over `getTableConfig(payments).indexes` and add:

```ts
    expect(getTableConfig(payments).indexes.map((i) => i.config.name)).toContain(
      "payments_reconcile_idx",
    );
```

- [ ] **Step 7: Run the full package suite**

Run: `pnpm --filter @waitron/payments test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/payments/src/schema/payments.ts packages/payments/drizzle packages/payments/src/migrations.test.ts packages/payments/src/index.test.ts
git commit -m "feat(payments): add reconcile_remediated_at marker + sweep index"
```

---

### Task 2: The store queries the sweep reads and writes

**Files:**

- Modify: `packages/payments/src/store.ts`
- Test: `packages/payments/src/store.test.ts`

**Interfaces:**

- Consumes: Task 1's `reconcile_remediated_at` column and `payments_reconcile_idx`.
- Produces:
  - `interface ReconcilableRow { paymentRef: string; state: PaymentState; amount: string; externalRef: string | null; saleId: string | null; settledAt: string | null; auditedAt: string; workingOrderId: string; workingOrderStatus: "open" | "settled" | "abandoned"; tillId: string; reconcileRemediatedAt: string | null }`
  - `listReconcilable(tx: Transaction, provider: string, period: { from: Date; to: Date }): Promise<ReconcilableRow[]>`
  - `anyPaymentWithReference(tx: Transaction, provider: string, references: string[]): Promise<boolean>`
  - `markReconcileRemediated(tx: Transaction, params: { tenantId: string; provider: string; paymentRef: string; at: Date }): Promise<boolean>`
  - `tillForWorkingOrder(tx: Transaction, tenantId: string, workingOrderId: string): Promise<string | undefined>`

- [ ] **Step 1: Write the failing tests**

Append to `packages/payments/src/store.test.ts`. The file already has `seedTenant()`, `capture(seeded, ref, amount)` and a `beforeEach` that truncates `payments`/`payment_refunds`; reuse them. Add the new imports to the existing import block from `./store.js`.

```ts
const PERIOD = { from: new Date("2026-07-22T00:00:00Z"), to: new Date("2026-07-23T00:00:00Z") };

/** Sets a seeded working order's status. `settled` also needs `settled_at` (the biconditional
 * CHECK `working_orders_settled_at_ck`); `abandoned` must leave it null. */
async function setOrderStatus(
  seeded: Seeded,
  status: "open" | "settled" | "abandoned",
): Promise<void> {
  await db.execute(sql`
    update working_orders
    set status = ${status}, settled_at = ${status === "settled" ? sql`now()` : null}
    where id = ${seeded.workingOrderId}`);
}

describe("listReconcilable", () => {
  it("returns captured rows settled inside the period, joined to their working order", async () => {
    const seeded = await seedTenant();
    await capture(seeded, "in-period");
    const rows = await db.transaction((tx) => listReconcilable(tx, "fake", PERIOD));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      paymentRef: "in-period",
      state: "captured",
      amount: "10.00",
      saleId: null,
      workingOrderId: seeded.workingOrderId,
      workingOrderStatus: "open",
      tillId: seeded.tillId,
      reconcileRemediatedAt: null,
    });
    // auditedAt is the non-null tolerance anchor: settled_at for a captured row.
    expect(rows[0].auditedAt).toBe(rows[0].settledAt);
  });

  it("excludes rows settled outside the period", async () => {
    const seeded = await seedTenant();
    await capture(seeded, "outside");
    const later = { from: new Date("2026-07-23T00:00:00Z"), to: new Date("2026-07-24T00:00:00Z") };
    expect(await db.transaction((tx) => listReconcilable(tx, "fake", later))).toEqual([]);
  });

  it("excludes another provider's rows", async () => {
    const seeded = await seedTenant();
    await capture(seeded, "ours");
    expect(await db.transaction((tx) => listReconcilable(tx, "other", PERIOD))).toEqual([]);
  });

  it("includes initiated rows by created_at and reports auditedAt from it", async () => {
    const seeded = await seedTenant();
    await db.transaction((tx) =>
      insertInitiated(tx, {
        tenantId: seeded.tenantId,
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: "pending",
        amount: decimal("7.00"),
        externalRef: "ext-pending",
      }),
    );
    // created_at defaults to now(), so widen the period to today rather than the fixed fixture day.
    const now = { from: new Date(Date.now() - 60_000), to: new Date(Date.now() + 60_000) };
    const rows = await db.transaction((tx) => listReconcilable(tx, "fake", now));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ paymentRef: "pending", state: "initiated", settledAt: null });
    expect(rows[0].auditedAt).not.toBeNull();
  });

  it("excludes failed and accepted_offline rows (forward's queue, not reconcile's)", async () => {
    const seeded = await seedTenant();
    await db.transaction(async (tx) => {
      await insertFailedPayment(tx, {
        tenantId: seeded.tenantId,
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: "nope",
        amount: decimal("3.00"),
      });
      await insertAcceptedOffline(tx, {
        tenantId: seeded.tenantId,
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: "queued",
        amount: decimal("4.00"),
        settledAt: SETTLED,
      });
    });
    expect(await db.transaction((tx) => listReconcilable(tx, "fake", PERIOD))).toEqual([]);
  });

  it("reports the working order status the orphan rule reads", async () => {
    const seeded = await seedTenant();
    await capture(seeded, "abandoned-one");
    await setOrderStatus(seeded, "abandoned");
    const rows = await db.transaction((tx) => listReconcilable(tx, "fake", PERIOD));
    expect(rows[0].workingOrderStatus).toBe("abandoned");
  });
});

describe("anyPaymentWithReference", () => {
  it("is true when any reference matches a row in any state at any time", async () => {
    const seeded = await seedTenant();
    await db.transaction((tx) =>
      insertInitiated(tx, {
        tenantId: seeded.tenantId,
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: "r-init",
        amount: decimal("5.00"),
        externalRef: "ext-1",
      }),
    );
    expect(
      await db.transaction((tx) => anyPaymentWithReference(tx, "fake", ["nope", "ext-1"])),
    ).toBe(true);
  });

  it("is false for unknown references, an empty list, and another provider", async () => {
    const seeded = await seedTenant();
    await db.transaction((tx) =>
      insertInitiated(tx, {
        tenantId: seeded.tenantId,
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: "r-init2",
        amount: decimal("5.00"),
        externalRef: "ext-2",
      }),
    );
    expect(await db.transaction((tx) => anyPaymentWithReference(tx, "fake", ["ghost"]))).toBe(false);
    expect(await db.transaction((tx) => anyPaymentWithReference(tx, "fake", []))).toBe(false);
    expect(await db.transaction((tx) => anyPaymentWithReference(tx, "other", ["ext-2"]))).toBe(
      false,
    );
  });
});

describe("markReconcileRemediated", () => {
  it("stamps the marker once and refuses a second stamp", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "orphan-1");
    const at = new Date("2026-07-25T08:00:00Z");
    expect(await db.transaction((tx) => markReconcileRemediated(tx, { ...key, at }))).toBe(true);
    expect(await db.transaction((tx) => markReconcileRemediated(tx, { ...key, at }))).toBe(false);
    const rows = await db.transaction((tx) => listReconcilable(tx, "fake", PERIOD));
    expect(rows[0].reconcileRemediatedAt).not.toBeNull();
  });

  it("returns false for a payment that does not exist", async () => {
    const seeded = await seedTenant();
    const at = new Date("2026-07-25T08:00:00Z");
    expect(
      await db.transaction((tx) =>
        markReconcileRemediated(tx, {
          tenantId: seeded.tenantId,
          provider: "fake",
          paymentRef: "ghost",
          at,
        }),
      ),
    ).toBe(false);
  });
});

describe("tillForWorkingOrder", () => {
  it("returns the till of an existing working order and undefined for an unknown one", async () => {
    const seeded = await seedTenant();
    expect(
      await db.transaction((tx) =>
        tillForWorkingOrder(tx, seeded.tenantId, seeded.workingOrderId),
      ),
    ).toBe(seeded.tillId);
    expect(
      await db.transaction((tx) =>
        tillForWorkingOrder(tx, seeded.tenantId, "00000000-0000-0000-0000-000000000000"),
      ),
    ).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @waitron/payments test -- store`
Expected: FAIL — TypeScript/import errors, `listReconcilable is not exported`.

- [ ] **Step 3: Implement the store functions**

In `packages/payments/src/store.ts`, extend the drizzle-orm import to `import { and, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";` and add `import { workingOrders } from "@waitron/db";` (a core table imported for a join — the module→core direction the schema files already use). Append:

```ts
/**
 * One row the reconcile sweep audits, joined to its working order for the till (every incident
 * needs one) and the status (the orphan rule). `auditedAt` is the NON-NULL tolerance anchor —
 * `settled_at` for a captured/settled row, `created_at` for an `initiated` one — so the classifier
 * needs no null branch on a column that, for the states this query returns, is never null anyway.
 */
export interface ReconcilableRow {
  paymentRef: string;
  state: PaymentState;
  amount: string;
  externalRef: string | null;
  saleId: string | null;
  settledAt: string | null;
  auditedAt: string;
  workingOrderId: string;
  workingOrderStatus: "open" | "settled" | "abandoned";
  tillId: string;
  reconcileRemediatedAt: string | null;
}

/**
 * The reconcile sweep's T1 read: this provider's auditable rows for the period, joined to their
 * working order. Auditable means money we believe we hold (`captured`/`settled`, anchored on
 * `settled_at`) or money we believe is pending (`initiated`, anchored on `created_at` — it has no
 * settlement time yet). `accepted_offline` is deliberately absent: that queue belongs to
 * `forward()`. `failed`/`voided`/`refunded`/`partially_refunded` are absent too — nothing is
 * expected to settle for them, and `anyPaymentWithReference` still sees them, so their settlements
 * never read as missingLocal.
 *
 * Filters compare the timestamp columns directly (no `to_char` wrapper), so the
 * `payments_reconcile_idx` index is usable — sargable by construction. Run under `withTenant`, so
 * RLS scopes both tables; the `tenant_id` equality in the join keeps it tenant-consistent even in
 * an RLS-bypassing superuser context (the same defence-in-depth the fiscal sweep's join uses).
 */
export async function listReconcilable(
  tx: Transaction,
  provider: string,
  period: { from: Date; to: Date },
): Promise<ReconcilableRow[]> {
  const from = period.from.toISOString();
  const to = period.to.toISOString();
  return tx
    .select({
      paymentRef: payments.paymentRef,
      state: payments.state,
      amount: payments.amount,
      externalRef: payments.externalRef,
      saleId: payments.saleId,
      settledAt: payments.settledAt,
      auditedAt: sql<string>`coalesce(${payments.settledAt}, ${payments.createdAt})`,
      workingOrderId: payments.workingOrderId,
      workingOrderStatus: workingOrders.status,
      tillId: workingOrders.tillId,
      reconcileRemediatedAt: payments.reconcileRemediatedAt,
    })
    .from(payments)
    .innerJoin(
      workingOrders,
      and(
        eq(workingOrders.id, payments.workingOrderId),
        eq(workingOrders.tenantId, payments.tenantId),
      ),
    )
    .where(
      and(
        eq(payments.provider, provider),
        or(
          and(
            inArray(payments.state, ["captured", "settled"]),
            gte(payments.settledAt, from),
            lt(payments.settledAt, to),
          ),
          and(
            eq(payments.state, "initiated"),
            gte(payments.createdAt, from),
            lt(payments.createdAt, to),
          ),
        ),
      ),
    )
    .orderBy(payments.createdAt);
}

/**
 * Does ANY payment of this provider carry one of these processor references — in any state, at any
 * time? The targeted existence check that stands between an unmatched settlement and a
 * `missingLocal` classification. It is deliberately unbounded by period and by state: the report is
 * fetched over a WIDER window than the local rows (settlement lags capture by days), so a
 * window-difference would manufacture false positives for payments whose local row simply sits
 * outside the audited period.
 */
export async function anyPaymentWithReference(
  tx: Transaction,
  provider: string,
  references: string[],
): Promise<boolean> {
  if (references.length === 0) return false;
  const [row] = await tx
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.provider, provider), inArray(payments.externalRef, references)))
    .limit(1);
  return row !== undefined;
}

/**
 * Stamp the orphan-remediation marker, matching only a row whose marker is still null and returning
 * whether it stamped. That row-or-nothing return is the concurrency guard: two sweeps racing over
 * one orphan produce exactly one reversal, because only one of them sees `true`.
 */
export async function markReconcileRemediated(
  tx: Transaction,
  params: Key & { at: Date },
): Promise<boolean> {
  const [row] = await tx
    .update(payments)
    .set({ reconcileRemediatedAt: params.at.toISOString(), updatedAt: sql`now()` })
    .where(and(keyWhere(params), isNull(payments.reconcileRemediatedAt)))
    .returning({ id: payments.id });
  return row !== undefined;
}

/** The till a working order belongs to — every incident needs one, and a payment reaches its till
 * only through its working order. `undefined` when the order does not exist (or RLS hides it). */
export async function tillForWorkingOrder(
  tx: Transaction,
  tenantId: string,
  workingOrderId: string,
): Promise<string | undefined> {
  const [row] = await tx
    .select({ tillId: workingOrders.tillId })
    .from(workingOrders)
    .where(and(eq(workingOrders.tenantId, tenantId), eq(workingOrders.id, workingOrderId)));
  return row?.tillId;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @waitron/payments test -- store`
Expected: PASS.

- [ ] **Step 5: Run the full package suite and typecheck**

Run: `pnpm --filter @waitron/payments test && pnpm --filter @waitron/payments typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/payments/src/store.ts packages/payments/src/store.test.ts
git commit -m "feat(payments): store queries for the reconcile sweep"
```

---

### Task 3: The contract types and the pure classifier

**Files:**

- Create: `packages/payments/src/reconcile.ts`
- Create: `packages/payments/src/classify.test.ts`

**Interfaces:**

- Consumes: `ReconcilableRow` (Task 2).
- Produces: every type below, plus `classify(rows, records, now, settlementLagMs): Classification`. Task 4 builds the orchestrator on them; Task 6's fakes implement `SettlementReportSource` and `PaymentReconciler`.

- [ ] **Step 1: Write the failing classifier tests**

Create `packages/payments/src/classify.test.ts`. No database — this is a pure function.

```ts
import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import { classify } from "./reconcile.js";
import type { SettlementRecord } from "./reconcile.js";
import type { ReconcilableRow } from "./store.js";

const NOW = new Date("2026-07-25T12:00:00Z");
const LAG = 7 * 24 * 60 * 60 * 1000;
/** Comfortably older than NOW - LAG, so the tolerance has expired. */
const OLD = "2026-07-01T12:00:00Z";
/** Inside the tolerance window (yesterday). */
const RECENT = "2026-07-24T12:00:00Z";

function row(over: Partial<ReconcilableRow> = {}): ReconcilableRow {
  return {
    paymentRef: "ref-1",
    state: "captured",
    amount: "10.00",
    externalRef: "ext-1",
    saleId: "sale-1",
    settledAt: OLD,
    auditedAt: OLD,
    workingOrderId: "wo-1",
    workingOrderStatus: "settled",
    tillId: "till-1",
    reconcileRemediatedAt: null,
    ...over,
  };
}

function record(over: Partial<SettlementRecord> = {}): SettlementRecord {
  return { references: ["ext-1"], amount: decimal("10.00"), settledAt: NOW, ...over };
}

describe("classify", () => {
  it("reports a clean match as no mismatch at all", () => {
    const out = classify([row()], [record()], NOW, LAG);
    expect(out.rows).toEqual([]);
    expect(out.unmatched).toEqual([]);
    expect(out.checked).toBe(1);
  });

  it("classifies an unreported payment past the tolerance as unsettled", () => {
    const out = classify([row()], [], NOW, LAG);
    expect(out.rows.map((r) => r.klass)).toEqual(["unsettled"]);
  });

  it("does NOT classify an unreported payment inside the tolerance", () => {
    const out = classify([row({ settledAt: RECENT, auditedAt: RECENT })], [], NOW, LAG);
    expect(out.rows).toEqual([]);
  });

  it("treats the tolerance boundary as exclusive on the in-flight side", () => {
    const exactly = new Date(NOW.getTime() - LAG).toISOString();
    expect(classify([row({ auditedAt: exactly })], [], NOW, LAG).rows).toEqual([]);
    const oneMsOlder = new Date(NOW.getTime() - LAG - 1).toISOString();
    expect(classify([row({ auditedAt: oneMsOlder })], [], NOW, LAG).rows.map((r) => r.klass)).toEqual(
      ["unsettled"],
    );
  });

  it("classifies a differing settled amount as drift and keeps the settlement", () => {
    const settled = record({ amount: decimal("9.50") });
    const out = classify([row()], [settled], NOW, LAG);
    expect(out.rows.map((r) => r.klass)).toEqual(["drift"]);
    expect(out.rows[0].settled).toBe(settled);
  });

  it("treats a different decimal spelling of the same amount as agreement, not drift", () => {
    const out = classify([row({ amount: "10.00" })], [record({ amount: decimal("10.0") })], NOW, LAG);
    expect(out.rows).toEqual([]);
  });

  it("classifies a captured payment with no sale on a settled order as an orphan", () => {
    const out = classify([row({ saleId: null })], [record()], NOW, LAG);
    expect(out.rows.map((r) => r.klass)).toEqual(["orphan"]);
  });

  it("does not treat a captured payment on an OPEN order as an orphan", () => {
    const out = classify([row({ saleId: null, workingOrderStatus: "open" })], [record()], NOW, LAG);
    expect(out.rows).toEqual([]);
  });

  it("reports a row that is both an orphan and unsettled under both classes", () => {
    const out = classify([row({ saleId: null, workingOrderStatus: "abandoned" })], [], NOW, LAG);
    expect(out.rows.map((r) => r.klass).sort()).toEqual(["orphan", "unsettled"]);
  });

  it("classifies an initiated row the report says settled as lostSettlement", () => {
    const out = classify([row({ state: "initiated", saleId: null, settledAt: null })], [record()], NOW, LAG);
    expect(out.rows.map((r) => r.klass)).toEqual(["lostSettlement"]);
  });

  it("leaves an initiated row with no settlement alone, however old", () => {
    const out = classify([row({ state: "initiated", saleId: null, settledAt: null })], [], NOW, LAG);
    expect(out.rows).toEqual([]);
  });

  it("reports a settlement matching no local row as unmatched", () => {
    const stray = record({ references: ["ext-stray"] });
    const out = classify([row()], [record(), stray], NOW, LAG);
    expect(out.unmatched).toEqual([stray]);
  });

  it("matches on ANY of a settlement's references, so a hosted session id matches too", () => {
    const multi = record({ references: ["pi-x", "ch-x", "ext-1"] });
    const out = classify([row()], [multi], NOW, LAG);
    expect(out.rows).toEqual([]);
    expect(out.unmatched).toEqual([]);
  });

  it("never matches a row whose external_ref is null", () => {
    const out = classify([row({ externalRef: null, saleId: "s" })], [record()], NOW, LAG);
    expect(out.rows.map((r) => r.klass)).toEqual(["unsettled"]);
    expect(out.unmatched).toHaveLength(1);
  });

  it("counts every local row it examined, mismatch or not", () => {
    expect(classify([row(), row({ paymentRef: "ref-2" })], [record()], NOW, LAG).checked).toBe(2);
  });

  it("handles an empty sweep", () => {
    expect(classify([], [], NOW, LAG)).toEqual({ checked: 0, rows: [], unmatched: [] });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @waitron/payments test -- classify`
Expected: FAIL — `Cannot find module './reconcile.js'`.

- [ ] **Step 3: Write the contract and the classifier**

Create `packages/payments/src/reconcile.ts` with the types and `classify` (the orchestrator arrives in Task 4):

```ts
import { compareDecimal, decimal } from "@waitron/shared";
import type { AppError, Decimal, SaleId, TenantId, TillId } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import type { PaymentState } from "./provider.js";
import type { ReconcilableRow } from "./store.js";

/** Half-open `[from, to)`. A daily sweep is yesterday; a monthly one is the 1st to the 1st. */
export interface ReconcilePeriod {
  from: Date;
  to: Date;
}

/**
 * One settlement the processor says actually cleared.
 *
 * `references` is a LIST, and that is load-bearing rather than defensive: our `external_ref` holds
 * whichever identifier the inbound path carried, and for a hosted payment that is the hosted
 * session id, while settlement data keys by the payment/charge id and never by the session. A
 * single-keyed record would leave every hosted payment reading as `unsettled` for ever and every
 * hosted settlement reading as `missingLocal` — wrong for exactly the mode this audit exists to
 * protect. The adapter therefore supplies every processor identifier that could match a local
 * `external_ref`, resolved from the processor's own data, so matching works even when our inbound
 * notification never arrived.
 */
export interface SettlementRecord {
  references: string[];
  amount: Decimal;
  settledAt: Date;
  /** Our own identifiers, when the processor carried them back. Present = a settlement with no
   * local row can still be attributed to a till and raise an incident; absent = report-only. */
  hint?: { workingOrderId: string; paymentRef: string };
}

/** The processor's settlement report for a window — the vendor half of the audit. The neutral seam
 * never names any vendor concept. */
export interface SettlementReportSource {
  fetch(window: ReconcilePeriod): Promise<SettlementRecord[]>;
}

/** Reverse one payment in full at the processor — the orphan self-heal. The adapter chooses how.
 * Throws when the payment cannot be addressed at the processor. */
export type ReversalFn = (paymentRef: string) => Promise<void>;

/**
 * Raise an incident, deduplicated per open `(tenant, till, code, sale)`, reporting whether it
 * actually inserted. Typed structurally rather than imported so this package keeps `@waitron/core`
 * a DEV dependency; `recordIncidentOnce` is assignable to it verbatim.
 */
export type IncidentSink = (
  tx: Transaction,
  input: {
    tenantId: TenantId;
    tillId: TillId;
    saleId?: SaleId;
    error: AppError;
    severity: "warning" | "error";
    detectedAt: Date;
  },
) => Promise<boolean>;

/** One disagreement between our books and the processor's. `paymentRef` is null only for a
 * `missingLocal` — there is no local row to name. Amounts are exact decimal strings, as read. */
export interface PaymentMismatch {
  paymentRef: string | null;
  references: string[];
  localState: PaymentState | null;
  localAmount: string | null;
  settledAmount: string | null;
  workingOrderId: string | null;
}

/** The outcome of one sweep. A tenant with nothing to check answers all-empty / zeros. */
export interface PaymentReconcileResult {
  period: ReconcilePeriod;
  /** LOCAL rows examined — not report entries, so a tenant with no local rows and a non-empty
   * report answers `checked: 0` alongside a non-empty `missingLocal`. */
  checked: number;
  unsettled: PaymentMismatch[];
  lostSettlement: PaymentMismatch[];
  orphan: PaymentMismatch[];
  missingLocal: PaymentMismatch[];
  drift: PaymentMismatch[];
  incidentsRaised: number;
  /** Orphans actually reversed this sweep. */
  remediated: number;
}

/**
 * The audit seam: one implementer per SETTLEMENT IDENTITY (per `provider` id), never one per
 * capture mechanism. A vendor whose synchronous and hosted adapters share a `provider` id is
 * audited by ONE reconciler covering all of them. Manual mode implements nothing — its audit is
 * external. `now` is passed in, exactly as `forward(now)` takes it: the in-flight tolerance and
 * every `detectedAt` need a clock, and an injected one is what makes the boundary testable.
 */
export interface PaymentReconciler {
  readonly provider: string;
  reconcile(
    tenantId: TenantId,
    period: ReconcilePeriod,
    now: Date,
  ): Promise<PaymentReconcileResult>;
}

/** The four classes a LOCAL row can fall into. `missingLocal` is not here: it has no local row. */
export type MismatchClass = "unsettled" | "lostSettlement" | "orphan" | "drift";

export interface ClassifiedRow {
  klass: MismatchClass;
  row: ReconcilableRow;
  /** The settlement that matched, when one did. */
  settled: SettlementRecord | null;
}

export interface Classification {
  checked: number;
  rows: ClassifiedRow[];
  /** Settlements matched by no local row — CANDIDATE `missingLocal`s, pending the targeted
   * existence check the caller runs against the whole table. */
  unmatched: SettlementRecord[];
}

/**
 * Classify one sweep's local rows against the processor's report. Pure: no I/O, no clock of its
 * own, no transaction — every input is an argument, which is what lets the money-critical rules be
 * tested exhaustively without a database.
 *
 * The classes are INDEPENDENT predicates, not a switch: an orphan whose settlement has not appeared
 * yet is genuinely both `orphan` and `unsettled`, and the result says so rather than picking a
 * winner (fiscal's three classes are mutually exclusive; these are not).
 */
export function classify(
  rows: ReconcilableRow[],
  records: SettlementRecord[],
  now: Date,
  settlementLagMs: number,
): Classification {
  const index = new Map<string, SettlementRecord>();
  for (const record of records) {
    for (const reference of record.references) index.set(reference, record);
  }
  const matched = new Set<SettlementRecord>();
  const out: ClassifiedRow[] = [];
  const toleranceCutoff = now.getTime() - settlementLagMs;

  for (const row of rows) {
    const settled = row.externalRef === null ? undefined : index.get(row.externalRef);
    if (settled !== undefined) matched.add(settled);

    if (row.state === "initiated") {
      // A minted-but-unpaid hosted payment is ordinary at any age — the abandonment path
      // resolves it. Only the processor saying it PAID makes it a mismatch.
      if (settled !== undefined) out.push({ klass: "lostSettlement", row, settled });
      continue;
    }

    // Money we believe we hold. The orphan rule is local-only: it never consults the report.
    if (row.saleId === null && row.workingOrderStatus !== "open") {
      out.push({ klass: "orphan", row, settled: settled ?? null });
    }
    if (settled === undefined) {
      if (Date.parse(row.auditedAt) < toleranceCutoff) {
        out.push({ klass: "unsettled", row, settled: null });
      }
    } else if (compareDecimal(decimal(row.amount), settled.amount) !== 0) {
      out.push({ klass: "drift", row, settled });
    }
  }

  return {
    checked: rows.length,
    rows: out,
    unmatched: records.filter((record) => !matched.has(record)),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @waitron/payments test -- classify`
Expected: PASS (16 tests).

- [ ] **Step 5: Run the vocabulary guard and typecheck**

Run: `pnpm --filter @waitron/payments test -- no-provider-vocabulary && pnpm --filter @waitron/payments typecheck`
Expected: PASS. If the guard fails, a banned term reached an identifier — rename it (remember `terminal` is banned outright; use `finalState`).

- [ ] **Step 6: Commit**

```bash
git add packages/payments/src/reconcile.ts packages/payments/src/classify.test.ts
git commit -m "feat(payments): reconcile contract types + pure classifier"
```

---

### Task 4: The sweep — T1, report fetch, T2 incidents

**Files:**

- Modify: `packages/payments/src/reconcile.ts`
- Modify: `packages/payments/src/errors.ts`
- Create: `packages/payments/src/reconcile.test.ts`

**Interfaces:**

- Consumes: Task 2's store functions, Task 3's types and `classify`.
- Produces: `ReconcileDeps`, `DEFAULT_SETTLEMENT_LAG_MS`, and `reconcilePayments(deps, tenantId, period, now): Promise<PaymentReconcileResult>`. Task 5 adds the reversal pass to the same function; Task 6's `FakeReconciler` calls it.

- [ ] **Step 1: Declare the incident codes**

In `packages/payments/src/errors.ts`, inside the existing `interface ErrorParams` block, add:

```ts
    /** Raised as an INCIDENT (never thrown) by a reconcile sweep: payments we believe settled that
     * the processor's report still shows nothing for, past the in-flight tolerance. AGGREGATED —
     * one incident per (till, code) carrying every payment, because the open-incident dedup index
     * keys on `(tenant, till, code, sale_id)` and these rows share a null sale_id, so N same-key
     * rows would silently collapse into one (the PR #25 lesson, applied deliberately here). */
    "payment.reconcile_unsettled": {
      payments: { paymentRef: string; amount: string; settledAt: string | null }[];
      count: number;
    };
    /** Reconcile INCIDENT: a payment still `initiated` locally that the processor reports as paid —
     * a missed or late inbound settlement. Not auto-healed: advancing it would need the sale to be
     * chained, which is app-level orchestration. Aggregated per till, as above. */
    "payment.reconcile_lost_settlement": {
      payments: { paymentRef: string; amount: string; workingOrderId: string }[];
      count: number;
    };
    /** Reconcile INCIDENT: money captured against a working order that is settled or abandoned but
     * carries no sale. `remediating` is true only for the abandoned case this sweep auto-reversed —
     * on a SETTLED order the orphan may be a lost association, where refunding would hand back money
     * for an invoice the customer owes, so it is reported for a human instead. Aggregated per till. */
    "payment.reconcile_orphan": {
      payments: {
        paymentRef: string;
        amount: string;
        workingOrderId: string;
        workingOrderStatus: string;
        remediating: boolean;
      }[];
      count: number;
    };
    /** Reconcile INCIDENT: the processor reports a settlement we hold no payment row for, at any
     * time, in any state — silent data loss. Only raised when the settlement carried our own
     * identifiers back (the `hint`), because an incident needs a till and an unattributable
     * settlement has none; unattributable ones are reported in the result instead. */
    "payment.reconcile_missing_local": {
      settlements: {
        references: string[];
        amount: string;
        settledAt: string;
        paymentRef: string;
      }[];
      count: number;
    };
    /** Reconcile INCIDENT: the processor settled a DIFFERENT amount than we captured. Never
     * auto-corrected — a human decides. Aggregated per till. */
    "payment.reconcile_drift": {
      payments: { paymentRef: string; captured: string; settled: string }[];
      count: number;
    };
    /** Reconcile INCIDENT: an orphan auto-reversal was attempted and the processor refused (or the
     * payment could not be addressed at all). The remediation marker is already stamped, so this
     * will not be retried — it is a human's to resolve. `reason` is a structured code, never
     * prose. */
    "payment.reconcile_remediation_failed": {
      paymentRef: string;
      amount: string;
      reason: string;
    };
```

- [ ] **Step 2: Write the failing sweep tests**

Create `packages/payments/src/reconcile.test.ts`:

```ts
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { decimal, tenantId as brandTenantId } from "@waitron/shared";
import { recordIncidentOnce } from "@waitron/core";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import { reconcilePayments, DEFAULT_SETTLEMENT_LAG_MS } from "./reconcile.js";
import type { ReconcileDeps, SettlementRecord } from "./reconcile.js";
import { insertCapturedPayment, insertInitiated } from "./store.js";
import { FakeSettlementReport } from "./testing/fake-settlement-report.js";
import { freshNif, seedSale, seedWorkingOrder } from "../test/seed.js";
import type { Seeded } from "../test/seed.js";

let db: Database;

beforeAll(async () => {
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, PAYMENTS_MIGRATIONS);
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.execute(sql`truncate incidents, payment_refunds, payments cascade`);
});

const PROVIDER = "fake";
const NOW = new Date("2026-07-25T12:00:00Z");
/** Older than NOW - DEFAULT_SETTLEMENT_LAG_MS, so the in-flight tolerance has expired. */
const OLD_SETTLED = new Date("2026-07-01T12:00:00Z");
const PERIOD = { from: new Date("2026-07-01T00:00:00Z"), to: new Date("2026-07-02T00:00:00Z") };

/** Records every reversal the sweep asks for, so a test can assert what money moved. */
function recordingReverse() {
  const calls: string[] = [];
  const fn = async (paymentRef: string): Promise<void> => {
    calls.push(paymentRef);
  };
  return { calls, fn };
}

function deps(report: FakeSettlementReport, reverse = recordingReverse().fn): ReconcileDeps {
  return {
    db,
    provider: PROVIDER,
    report,
    reverse,
    incidents: recordIncidentOnce,
    settlementLagMs: DEFAULT_SETTLEMENT_LAG_MS,
  };
}

async function capture(seeded: Seeded, paymentRef: string, externalRef: string, amount = "10.00") {
  await withTenant(db, seeded.tenantId, (tx) =>
    insertCapturedPayment(tx, {
      tenantId: seeded.tenantId,
      workingOrderId: seeded.workingOrderId,
      provider: PROVIDER,
      paymentRef,
      externalRef,
      amount: decimal(amount),
      settledAt: OLD_SETTLED,
    }),
  );
}

async function openIncidentCodes(tenantId: string): Promise<string[]> {
  const { rows } = await db.execute<{ code: string }>(
    sql`select code from incidents where tenant_id = ${tenantId} order by code`,
  );
  return rows.map((r) => r.code);
}

function settlement(over: Partial<SettlementRecord> = {}): SettlementRecord {
  return { references: ["ext-1"], amount: decimal("10.00"), settledAt: OLD_SETTLED, ...over };
}

describe("reconcilePayments", () => {
  it("answers all-empty for a tenant with nothing to check", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([])),
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(result).toMatchObject({
      checked: 0,
      unsettled: [],
      lostSettlement: [],
      orphan: [],
      missingLocal: [],
      drift: [],
      incidentsRaised: 0,
      remediated: 0,
    });
  });

  it("reports a clean, fully-settled period with no incidents", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await associate(seeded, "p1");
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement()])),
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(result.checked).toBe(1);
    expect(result.incidentsRaised).toBe(0);
    expect(await openIncidentCodes(seeded.tenantId)).toEqual([]);
  });

  it("raises one aggregated unsettled incident covering every stale payment on the till", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await capture(seeded, "p2", "ext-2", "20.00");
    await associate(seeded, "p1");
    await associate(seeded, "p2");
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([])),
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(result.unsettled).toHaveLength(2);
    expect(result.incidentsRaised).toBe(1);
    const { rows } = await db.execute<{ params: { count: number } }>(
      sql`select params from incidents where code = 'payment.reconcile_unsettled'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].params.count).toBe(2);
  });

  it("does not re-count an incident a second sweep re-detects", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await associate(seeded, "p1");
    const d = deps(new FakeSettlementReport([]));
    const first = await reconcilePayments(d, brandTenantId(seeded.tenantId), PERIOD, NOW);
    const second = await reconcilePayments(d, brandTenantId(seeded.tenantId), PERIOD, NOW);
    expect(first.incidentsRaised).toBe(1);
    // Still reported as a mismatch — the audit finding is always reported — but the open incident
    // already exists, so nothing new was inserted.
    expect(second.unsettled).toHaveLength(1);
    expect(second.incidentsRaised).toBe(0);
  });

  it("classifies a differing settled amount as drift and raises its incident", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await associate(seeded, "p1");
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement({ amount: decimal("9.00") })])),
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(result.drift).toHaveLength(1);
    expect(result.drift[0]).toMatchObject({ localAmount: "10.00", settledAmount: "9.00" });
    expect(await openIncidentCodes(seeded.tenantId)).toEqual(["payment.reconcile_drift"]);
  });

  it("classifies an initiated row the report settled as lostSettlement", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    await withTenant(db, seeded.tenantId, (tx) =>
      insertInitiated(tx, {
        tenantId: seeded.tenantId,
        workingOrderId: seeded.workingOrderId,
        provider: PROVIDER,
        paymentRef: "p-init",
        amount: decimal("10.00"),
        externalRef: "ext-1",
      }),
    );
    const now = { from: new Date(Date.now() - 60_000), to: new Date(Date.now() + 60_000) };
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement()])),
      brandTenantId(seeded.tenantId),
      now,
      NOW,
    );
    expect(result.lostSettlement).toHaveLength(1);
    expect(await openIncidentCodes(seeded.tenantId)).toEqual([
      "payment.reconcile_lost_settlement",
    ]);
  });

  it("reports an unattributable missingLocal WITHOUT raising an incident", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement({ references: ["ext-ghost"] })])),
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(result.missingLocal).toHaveLength(1);
    expect(result.missingLocal[0]).toMatchObject({ paymentRef: null, references: ["ext-ghost"] });
    expect(result.incidentsRaised).toBe(0);
    expect(await openIncidentCodes(seeded.tenantId)).toEqual([]);
  });

  it("raises an incident for a missingLocal the processor attributed via a hint", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    const result = await reconcilePayments(
      deps(
        new FakeSettlementReport([
          settlement({
            references: ["ext-ghost"],
            hint: { workingOrderId: seeded.workingOrderId, paymentRef: "p-lost" },
          }),
        ]),
      ),
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(result.missingLocal).toHaveLength(1);
    expect(result.incidentsRaised).toBe(1);
    expect(await openIncidentCodes(seeded.tenantId)).toEqual([
      "payment.reconcile_missing_local",
    ]);
  });

  it("does not call a settlement missingLocal when a local row exists outside the period", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    await capture(seeded, "p1", "ext-1");
    // A period that excludes the payment entirely, while the report still carries its settlement.
    const elsewhere = {
      from: new Date("2026-06-01T00:00:00Z"),
      to: new Date("2026-06-02T00:00:00Z"),
    };
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement()])),
      brandTenantId(seeded.tenantId),
      elsewhere,
      NOW,
    );
    expect(result.checked).toBe(0);
    expect(result.missingLocal).toEqual([]);
  });

  it("fetches the report even when there are no local rows at all", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    const report = new FakeSettlementReport([settlement({ references: ["ext-ghost"] })]);
    await reconcilePayments(deps(report), brandTenantId(seeded.tenantId), PERIOD, NOW);
    expect(report.windows).toHaveLength(1);
  });

  it("fetches the report over a window widened by the settlement lag", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    const report = new FakeSettlementReport([]);
    await reconcilePayments(deps(report), brandTenantId(seeded.tenantId), PERIOD, NOW);
    expect(report.windows[0].from).toEqual(PERIOD.from);
    expect(report.windows[0].to).toEqual(
      new Date(PERIOD.to.getTime() + DEFAULT_SETTLEMENT_LAG_MS),
    );
  });
});

/** Associates a payment with a freshly-seeded sale, so it is not an orphan. */
async function associate(seeded: Seeded, paymentRef: string): Promise<void> {
  const saleId = await seedSale(db, seeded);
  await db.execute(sql`
    update payments set sale_id = ${saleId}
    where tenant_id = ${seeded.tenantId} and payment_ref = ${paymentRef}`);
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @waitron/payments test -- reconcile.test`
Expected: FAIL — `reconcilePayments` and `FakeSettlementReport` do not exist. (The fake is created in Task 6; create a minimal version now — Step 4 — so this task is independently runnable, and Task 6 only adds its barrel/test surface.)

- [ ] **Step 4: Create the fake settlement report**

Create `packages/payments/src/testing/fake-settlement-report.ts`:

```ts
import type { ReconcilePeriod, SettlementReportSource, SettlementRecord } from "../reconcile.js";

/**
 * A deterministic `SettlementReportSource` returning a fixed set of settlements and recording every
 * window it was asked for, so a test can assert the sweep widened its fetch by the settlement lag.
 * NOT re-exported from the package barrel — a production import cannot reach a test double.
 */
export class FakeSettlementReport implements SettlementReportSource {
  readonly windows: ReconcilePeriod[] = [];

  constructor(private readonly records: SettlementRecord[]) {}

  async fetch(window: ReconcilePeriod): Promise<SettlementRecord[]> {
    this.windows.push(window);
    return this.records;
  }
}
```

- [ ] **Step 5: Implement the orchestrator**

Append to `packages/payments/src/reconcile.ts`. Extend its imports with `import { AppError } from "@waitron/shared";` (a value now, not just a type), `import { withTenant } from "@waitron/db";`, `import type { Database } from "@waitron/db";`, `import { saleId as brandSaleId, tillId as brandTillId } from "@waitron/shared";` and the store functions.

```ts
/** Seven days: long enough for the ordinary clearing delay of a card processor, short enough that a
 * genuinely lost settlement surfaces the same week. A vendor property, so it is a dependency rather
 * than a constant the sweep hard-codes. */
export const DEFAULT_SETTLEMENT_LAG_MS = 7 * 24 * 60 * 60 * 1000;

export interface ReconcileDeps {
  db: Database;
  /** The settlement identity being audited — one `provider` id, however many capture mechanisms
   * write it. */
  provider: string;
  report: SettlementReportSource;
  reverse: ReversalFn;
  incidents: IncidentSink;
  settlementLagMs: number;
}

const CODE = {
  unsettled: "payment.reconcile_unsettled",
  lostSettlement: "payment.reconcile_lost_settlement",
  orphan: "payment.reconcile_orphan",
  drift: "payment.reconcile_drift",
} as const;

/** `unsettled` is a warning — money that has not cleared YET, past its tolerance but not yet proven
 * lost. The rest are errors: each is money we cannot account for. */
const SEVERITY = {
  unsettled: "warning",
  lostSettlement: "error",
  orphan: "error",
  drift: "error",
} as const;

/**
 * The reconciliation sweep: audit one tenant's payments for one period against what the processor's
 * settlement report says actually cleared, classify every disagreement, raise an idempotent
 * incident per (till, class), and auto-reverse the one orphan shape that is unambiguously safe.
 *
 * T1/T2, like `forward` and the fiscal sweep: a short read transaction, then the report fetch
 * OUTSIDE every transaction, then a short write transaction for incidents and markers, then the
 * reversals — also outside every transaction, because each is a network call.
 *
 * Two deliberate divergences from the fiscal sweep:
 *
 *   - the report is fetched even when T1 read NOTHING. Fiscal skips its network call on an empty
 *     period because a record it never wrote cannot exist; here, zero local rows plus a non-empty
 *     report IS the silent-data-loss case (every inbound settlement missed), so skipping would
 *     blind the sweep to exactly what it exists for;
 *   - the remediation marker is stamped BEFORE the reversal, not after. There is no persisted
 *     per-reversal idempotency key yet, so a crash between "the processor refunded" and "we
 *     recorded it" would let the next sweep refund again. Stamping first makes the failure mode an
 *     UNDER-remediated orphan carrying an open incident, never a double refund.
 */
export async function reconcilePayments(
  deps: ReconcileDeps,
  tenantId: TenantId,
  period: ReconcilePeriod,
  now: Date,
): Promise<PaymentReconcileResult> {
  // T1 — our rows for the period. No network call inside it.
  const rows = await withTenant(deps.db, tenantId, (tx) =>
    listReconcilable(tx, deps.provider, period),
  );

  // Network — outside every transaction, over a window widened by the settlement lag, because a
  // payment captured at the end of the period settles days after it.
  const records = await deps.report.fetch({
    from: period.from,
    to: new Date(period.to.getTime() + deps.settlementLagMs),
  });

  const classified = classify(rows, records, now, deps.settlementLagMs);
  const result: PaymentReconcileResult = {
    period,
    checked: classified.checked,
    unsettled: [],
    lostSettlement: [],
    orphan: [],
    missingLocal: [],
    drift: [],
    incidentsRaised: 0,
    remediated: 0,
  };
  for (const entry of classified.rows) result[entry.klass].push(mismatchOf(entry));

  // T2 — resolve the missingLocal candidates, raise every incident, and claim the orphans this
  // sweep will reverse. One short write transaction.
  const remediable: ReconcilableRow[] = [];
  await withTenant(deps.db, tenantId, async (tx) => {
    const missing: SettlementRecord[] = [];
    for (const record of classified.unmatched) {
      if (await anyPaymentWithReference(tx, deps.provider, record.references)) continue;
      missing.push(record);
      result.missingLocal.push(missingLocalMismatch(record));
    }

    for (const entry of classified.rows) {
      if (entry.klass !== "orphan") continue;
      if (entry.row.workingOrderStatus !== "abandoned") continue;
      if (entry.row.reconcileRemediatedAt !== null) continue;
      const claimed = await markReconcileRemediated(tx, {
        tenantId,
        provider: deps.provider,
        paymentRef: entry.row.paymentRef,
        at: now,
      });
      if (claimed) remediable.push(entry.row);
    }
    const claimedRefs = new Set(remediable.map((row) => row.paymentRef));

    result.incidentsRaised += await raiseRowIncidents(tx, deps, tenantId, classified, claimedRefs, now);
    result.incidentsRaised += await raiseMissingLocal(tx, deps, tenantId, missing, now);
  });

  // Reversals — outside every transaction. See the marker-ordering note above.
  for (const row of remediable) {
    result.remediated += await remediate(deps, tenantId, row, now);
  }
  return result;
}

/** Raises one AGGREGATE incident per (till, class) over the classified rows, returning how many
 * were really inserted (`recordIncidentOnce` reports its own de-duplication, so a re-detected
 * still-open condition is not counted twice). Aggregate rather than one incident per payment: the
 * open-incident dedup index keys on `(tenant, till, code, sale_id)` and these rows frequently share
 * a null sale_id, so N same-key incidents would silently collapse into whichever won the race. */
async function raiseRowIncidents(
  tx: Transaction,
  deps: ReconcileDeps,
  tenantId: TenantId,
  classified: Classification,
  claimedRefs: Set<string>,
  now: Date,
): Promise<number> {
  const groups = new Map<string, ClassifiedRow[]>();
  for (const entry of classified.rows) {
    const key = `${entry.row.tillId}|${entry.klass}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [entry]);
    else group.push(entry);
  }

  let raised = 0;
  for (const group of groups.values()) {
    const first = group[0]!;
    const inserted = await deps.incidents(tx, {
      tenantId,
      tillId: brandTillId(first.row.tillId),
      error: incidentFor(first.klass, group, claimedRefs),
      severity: SEVERITY[first.klass],
      detectedAt: now,
    });
    if (inserted) raised += 1;
  }
  return raised;
}

/** Builds one class's aggregate incident. Params are structured data — a list plus its count —
 * never prose: the display layer localises from the code. */
function incidentFor(
  klass: MismatchClass,
  group: ClassifiedRow[],
  claimedRefs: Set<string>,
): AppError {
  const count = group.length;
  if (klass === "unsettled") {
    return new AppError(CODE.unsettled, {
      count,
      payments: group.map(({ row }) => ({
        paymentRef: row.paymentRef,
        amount: row.amount,
        settledAt: row.settledAt,
      })),
    });
  }
  if (klass === "lostSettlement") {
    return new AppError(CODE.lostSettlement, {
      count,
      payments: group.map(({ row }) => ({
        paymentRef: row.paymentRef,
        amount: row.amount,
        workingOrderId: row.workingOrderId,
      })),
    });
  }
  if (klass === "orphan") {
    return new AppError(CODE.orphan, {
      count,
      payments: group.map(({ row }) => ({
        paymentRef: row.paymentRef,
        amount: row.amount,
        workingOrderId: row.workingOrderId,
        workingOrderStatus: row.workingOrderStatus,
        remediating: claimedRefs.has(row.paymentRef),
      })),
    });
  }
  return new AppError(CODE.drift, {
    count,
    payments: group.map(({ row, settled }) => ({
      paymentRef: row.paymentRef,
      captured: row.amount,
      settled: settled === null ? row.amount : settled.amount,
    })),
  });
}

/** Raises the aggregate `missingLocal` incident for the settlements the processor attributed back to
 * one of our working orders. An unattributed settlement has no till, so it cannot be an incident at
 * all — it is reported in the result and left to the caller. */
async function raiseMissingLocal(
  tx: Transaction,
  deps: ReconcileDeps,
  tenantId: TenantId,
  missing: SettlementRecord[],
  now: Date,
): Promise<number> {
  const byTill = new Map<string, { record: SettlementRecord; paymentRef: string }[]>();
  for (const record of missing) {
    if (record.hint === undefined) continue;
    const tillId = await tillForWorkingOrder(tx, tenantId, record.hint.workingOrderId);
    if (tillId === undefined) continue;
    const group = byTill.get(tillId);
    const item = { record, paymentRef: record.hint.paymentRef };
    if (group === undefined) byTill.set(tillId, [item]);
    else group.push(item);
  }

  let raised = 0;
  for (const [tillId, group] of byTill) {
    const inserted = await deps.incidents(tx, {
      tenantId,
      tillId: brandTillId(tillId),
      error: new AppError("payment.reconcile_missing_local", {
        count: group.length,
        settlements: group.map(({ record, paymentRef }) => ({
          references: record.references,
          amount: record.amount,
          settledAt: record.settledAt.toISOString(),
          paymentRef,
        })),
      }),
      severity: "error",
      detectedAt: now,
    });
    if (inserted) raised += 1;
  }
  return raised;
}

function mismatchOf(entry: ClassifiedRow): PaymentMismatch {
  return {
    paymentRef: entry.row.paymentRef,
    references: entry.row.externalRef === null ? [] : [entry.row.externalRef],
    localState: entry.row.state,
    localAmount: entry.row.amount,
    settledAmount: entry.settled === null ? null : entry.settled.amount,
    workingOrderId: entry.row.workingOrderId,
  };
}

function missingLocalMismatch(record: SettlementRecord): PaymentMismatch {
  return {
    paymentRef: null,
    references: record.references,
    localState: null,
    localAmount: null,
    settledAmount: record.amount,
    workingOrderId: record.hint?.workingOrderId ?? null,
  };
}
```

`remediate` is Task 5's; for this task add the minimal placeholder-free version that Task 5 extends:

```ts
/** Reverse one claimed orphan at the processor. Task 5 gives this its failure path. */
async function remediate(
  deps: ReconcileDeps,
  tenantId: TenantId,
  row: ReconcilableRow,
  now: Date,
): Promise<number> {
  await deps.reverse(row.paymentRef);
  return 1;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @waitron/payments test -- reconcile.test`
Expected: PASS (12 tests).

- [ ] **Step 7: Run the full suite, typecheck and the vocabulary guard**

Run: `pnpm --filter @waitron/payments test && pnpm --filter @waitron/payments typecheck && pnpm --filter @waitron/payments lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/payments/src/reconcile.ts packages/payments/src/errors.ts packages/payments/src/reconcile.test.ts packages/payments/src/testing/fake-settlement-report.ts
git commit -m "feat(payments): the reconcile sweep — T1, report fetch, aggregate incidents"
```

---

### Task 5: The bounded orphan self-heal

**Files:**

- Modify: `packages/payments/src/reconcile.ts`
- Modify: `packages/payments/src/reconcile.test.ts`

**Interfaces:**

- Consumes: Task 4's `reconcilePayments`, `ReconcileDeps.reverse`, `markReconcileRemediated`.
- Produces: the completed `remediate()` behaviour — reversal on an abandoned order only, one attempt per payment, and a `payment.reconcile_remediation_failed` incident when the processor refuses.

- [ ] **Step 1: Write the failing tests**

Append to `packages/payments/src/reconcile.test.ts`:

```ts
/** Sets a seeded working order's status. `settled` also needs `settled_at` (the biconditional
 * CHECK `working_orders_settled_at_ck`); `abandoned` must leave it null. */
async function setOrderStatus(
  seeded: Seeded,
  status: "settled" | "abandoned",
): Promise<void> {
  await db.execute(sql`
    update working_orders
    set status = ${status}, settled_at = ${status === "settled" ? sql`now()` : null}
    where id = ${seeded.workingOrderId}`);
}

describe("orphan remediation", () => {
  it("auto-reverses an orphan on an ABANDONED order and stamps the marker", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await setOrderStatus(seeded, "abandoned");
    const reverse = recordingReverse();
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement()]), reverse.fn),
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(result.orphan).toHaveLength(1);
    expect(result.remediated).toBe(1);
    expect(reverse.calls).toEqual(["p1"]);
    const { rows } = await db.execute<{ reconcile_remediated_at: string | null }>(
      sql`select reconcile_remediated_at from payments where payment_ref = 'p1'`,
    );
    expect(rows[0].reconcile_remediated_at).not.toBeNull();
  });

  it("does NOT reverse an orphan on a SETTLED order — it reports and raises only", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await setOrderStatus(seeded, "settled");
    const reverse = recordingReverse();
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement()]), reverse.fn),
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(result.orphan).toHaveLength(1);
    expect(result.remediated).toBe(0);
    expect(reverse.calls).toEqual([]);
    expect(await openIncidentCodes(seeded.tenantId)).toEqual(["payment.reconcile_orphan"]);
    const { rows } = await db.execute<{ reconcile_remediated_at: string | null }>(
      sql`select reconcile_remediated_at from payments where payment_ref = 'p1'`,
    );
    expect(rows[0].reconcile_remediated_at).toBeNull();
  });

  it("reverses each orphan at most once, however many sweeps run", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await setOrderStatus(seeded, "abandoned");
    const reverse = recordingReverse();
    const d = deps(new FakeSettlementReport([settlement()]), reverse.fn);
    await reconcilePayments(d, brandTenantId(seeded.tenantId), PERIOD, NOW);
    const second = await reconcilePayments(d, brandTenantId(seeded.tenantId), PERIOD, NOW);
    // Still REPORTED — the audit finding never disappears — but not reversed again.
    expect(second.orphan).toHaveLength(1);
    expect(second.remediated).toBe(0);
    expect(reverse.calls).toEqual(["p1"]);
  });

  it("raises a remediation-failed incident when the processor refuses the reversal", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await setOrderStatus(seeded, "abandoned");
    const refusing = async (): Promise<void> => {
      throw new AppError("payment.not_refundable", { paymentRef: "p1", state: "refunded" });
    };
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement()]), refusing),
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(result.remediated).toBe(0);
    expect(await openIncidentCodes(seeded.tenantId)).toEqual([
      "payment.reconcile_orphan",
      "payment.reconcile_remediation_failed",
    ]);
    const { rows } = await db.execute<{ params: { reason: string } }>(
      sql`select params from incidents where code = 'payment.reconcile_remediation_failed'`,
    );
    expect(rows[0].params.reason).toBe("payment.not_refundable");
    // The marker is stamped even on failure, so this is not retried every sweep.
    const marker = await db.execute<{ reconcile_remediated_at: string | null }>(
      sql`select reconcile_remediated_at from payments where payment_ref = 'p1'`,
    );
    expect(marker.rows[0].reconcile_remediated_at).not.toBeNull();
  });

  it("reports a non-AppError reversal failure with an unknown reason and keeps sweeping", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await capture(seeded, "p2", "ext-2", "20.00");
    await setOrderStatus(seeded, "abandoned");
    const calls: string[] = [];
    const flaky = async (paymentRef: string): Promise<void> => {
      calls.push(paymentRef);
      if (paymentRef === "p1") throw new Error("socket hang up");
    };
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement(), settlement({ references: ["ext-2"], amount: decimal("20.00") })]), flaky),
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    // One failure does not abort the pass: p2 was still reversed.
    expect(calls).toEqual(["p1", "p2"]);
    expect(result.remediated).toBe(1);
    const { rows } = await db.execute<{ params: { reason: string } }>(
      sql`select params from incidents where code = 'payment.reconcile_remediation_failed'`,
    );
    expect(rows[0].params.reason).toBe("unknown");
  });
});
```

Add `AppError` to the test file's `@waitron/shared` import.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @waitron/payments test -- reconcile.test`
Expected: FAIL — the refusing-reversal tests throw out of `reconcilePayments` instead of raising an incident.

- [ ] **Step 3: Complete the remediation path**

Replace Task 4's `remediate` in `packages/payments/src/reconcile.ts` with:

```ts
/**
 * Reverse one claimed orphan at the processor, outside every transaction (it is a network call).
 * Returns 1 when the money went back, 0 when it did not.
 *
 * A refusal is not fatal to the sweep and is never retried: the marker was already stamped in T2,
 * so this raises one idempotent incident naming the structured reason and moves on to the next
 * orphan. A payment the adapter cannot address at all (a hosted payment, whose stored reference is
 * not the one the reversal path needs) lands here too, by design — visible, bounded, and fixed for
 * free when that reference gap closes.
 */
async function remediate(
  deps: ReconcileDeps,
  tenantId: TenantId,
  row: ReconcilableRow,
  now: Date,
): Promise<number> {
  try {
    await deps.reverse(row.paymentRef);
    return 1;
  } catch (error) {
    await withTenant(deps.db, tenantId, (tx) =>
      deps.incidents(tx, {
        tenantId,
        tillId: brandTillId(row.tillId),
        error: new AppError("payment.reconcile_remediation_failed", {
          paymentRef: row.paymentRef,
          amount: row.amount,
          reason: isAppError(error) ? error.code : "unknown",
        }),
        severity: "error",
        detectedAt: now,
      }),
    );
    return 0;
  }
}
```

Add `isAppError` to the `@waitron/shared` value import in `reconcile.ts`.

Note the remediation-failed incident is NOT counted into `incidentsRaised` by `remediate` — it is a
distinct, per-payment incident raised after T2 closed. Count it: change the caller loop to

```ts
  for (const row of remediable) {
    const outcome = await remediate(deps, tenantId, row, now);
    result.remediated += outcome.remediated;
    result.incidentsRaised += outcome.incidentsRaised;
  }
```

and have `remediate` return `{ remediated: number; incidentsRaised: number }` — `{ remediated: 1, incidentsRaised: 0 }` on success, `{ remediated: 0, incidentsRaised: inserted ? 1 : 0 }` on failure, where `inserted` is the `IncidentSink`'s own boolean.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @waitron/payments test -- reconcile.test`
Expected: PASS (17 tests).

- [ ] **Step 5: Run the full suite**

Run: `pnpm --filter @waitron/payments test && pnpm --filter @waitron/payments typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/payments/src/reconcile.ts packages/payments/src/reconcile.test.ts
git commit -m "feat(payments): bounded orphan self-heal (abandoned orders only)"
```

---

### Task 6: The fake reconciler and the package surface

**Files:**

- Create: `packages/payments/src/testing/fake-reconciler.ts`
- Modify: `packages/payments/src/index.ts`
- Modify: `packages/payments/src/provider.ts`
- Test: `packages/payments/src/index.test.ts`

**Interfaces:**

- Consumes: everything from Tasks 2–5.
- Produces: `FakeReconciler` (implements `PaymentReconciler`) and the public barrel exports Slice B's `StripeReconciler` will import.

- [ ] **Step 1: Write the failing surface tests**

Append to `packages/payments/src/index.test.ts`:

```ts
describe("the reconcile surface", () => {
  it("re-exports the sweep and its default lag from the package root", () => {
    expect(typeof reconcilePayments).toBe("function");
    expect(DEFAULT_SETTLEMENT_LAG_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("re-exports the store queries the sweep is built on", () => {
    expect(typeof listReconcilable).toBe("function");
    expect(typeof anyPaymentWithReference).toBe("function");
    expect(typeof markReconcileRemediated).toBe("function");
    expect(typeof tillForWorkingOrder).toBe("function");
  });

  it("types a PaymentReconciler an adapter can implement against the root barrel", () => {
    // A structural check, exactly like the AsyncPaymentProvider one above: this is what a vendor
    // package's own reconciler has to satisfy, so it must be reachable and complete from here.
    const reconciler: PaymentReconciler = {
      provider: "fake",
      reconcile: async (_tenantId, period): Promise<PaymentReconcileResult> => ({
        period,
        checked: 0,
        unsettled: [],
        lostSettlement: [],
        orphan: [],
        missingLocal: [],
        drift: [],
        incidentsRaised: 0,
        remediated: 0,
      }),
    };
    expect(reconciler.provider).toBe("fake");
  });

  it("types a SettlementReportSource and a mismatch from the root barrel", () => {
    const source: SettlementReportSource = {
      fetch: async (): Promise<SettlementRecord[]> => [
        { references: ["a", "b"], amount: decimal("1.00"), settledAt: new Date() },
      ],
    };
    const mismatch: PaymentMismatch = {
      paymentRef: "p",
      references: ["a"],
      localState: "captured",
      localAmount: "1.00",
      settledAmount: "1.00",
      workingOrderId: "w",
    };
    expect(typeof source.fetch).toBe("function");
    expect(mismatch.paymentRef).toBe("p");
  });
});
```

Add the new names to the file's `./index.js` value and type imports.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @waitron/payments test -- index.test`
Expected: FAIL — the names are not exported from `./index.js`.

- [ ] **Step 3: Export the surface**

In `packages/payments/src/index.ts` add:

```ts
export { classify, reconcilePayments, DEFAULT_SETTLEMENT_LAG_MS } from "./reconcile.js";
export type {
  Classification,
  ClassifiedRow,
  IncidentSink,
  MismatchClass,
  PaymentMismatch,
  PaymentReconcileResult,
  PaymentReconciler,
  ReconcileDeps,
  ReconcilePeriod,
  ReversalFn,
  SettlementRecord,
  SettlementReportSource,
} from "./reconcile.js";
```

and extend the existing `./store.js` export lists with `anyPaymentWithReference`, `listReconcilable`, `markReconcileRemediated`, `tillForWorkingOrder` (values) and `ReconcilableRow` (type).

- [ ] **Step 4: Correct the stale interface comment**

In `packages/payments/src/provider.ts`, the `PaymentProvider` doc comment ends with
"`authorize`/`capture`/`preAuth`/`incrementalAuth`/`tipAdjust`/`reconcile` are later plans." Drop
`reconcile` from that list and add a sentence:

```ts
 * `authorize`/`capture`/`preAuth`/`incrementalAuth`/`tipAdjust` are later plans. `reconcile` is
 * deliberately NOT here: the audit is scoped per settlement identity, not per capture mechanism, so
 * it lives on its own `PaymentReconciler` interface (./reconcile.ts) which one implementer covers
 * for all of a vendor's adapters — including a hosted one, which is not a `PaymentProvider` at all.
```

- [ ] **Step 5: Write the fake reconciler**

Create `packages/payments/src/testing/fake-reconciler.ts`:

```ts
import type { Database } from "@waitron/db";
import { recordIncidentOnce } from "@waitron/core";
import type { TenantId } from "@waitron/shared";
import {
  DEFAULT_SETTLEMENT_LAG_MS,
  reconcilePayments,
} from "../reconcile.js";
import type {
  PaymentReconcileResult,
  PaymentReconciler,
  ReconcilePeriod,
  SettlementReportSource,
} from "../reconcile.js";

/**
 * A genuine DB-backed `PaymentReconciler` double, not a stub: it runs the REAL sweep against the
 * real tables, with a simulated settlement report and a reversal that only records what it was
 * asked to reverse. That is the point of the ported design — the fake proves the shipping
 * algorithm, never a second copy of it. NOT re-exported from the package barrel.
 */
export class FakeReconciler implements PaymentReconciler {
  readonly provider = "fake";
  /** Every payment reference this reconciler was asked to reverse, in order. */
  readonly reversed: string[] = [];

  constructor(
    private readonly db: Database,
    private readonly report: SettlementReportSource,
    private readonly settlementLagMs: number = DEFAULT_SETTLEMENT_LAG_MS,
  ) {}

  async reconcile(
    tenantId: TenantId,
    period: ReconcilePeriod,
    now: Date,
  ): Promise<PaymentReconcileResult> {
    return reconcilePayments(
      {
        db: this.db,
        provider: this.provider,
        report: this.report,
        reverse: async (paymentRef: string) => {
          this.reversed.push(paymentRef);
        },
        incidents: recordIncidentOnce,
        settlementLagMs: this.settlementLagMs,
      },
      tenantId,
      period,
      now,
    );
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @waitron/payments test`
Expected: PASS. `schema-ownership.test.ts` and `no-provider-vocabulary.test.ts` must stay green.

- [ ] **Step 7: Commit**

```bash
git add packages/payments/src/index.ts packages/payments/src/provider.ts packages/payments/src/testing/fake-reconciler.ts packages/payments/src/index.test.ts
git commit -m "feat(payments): expose the reconcile surface + FakeReconciler"
```

---

### Task 7: Real-Postgres RLS suite

**Files:**

- Create: `packages/payments/src/reconcile.rls.test.ts`

**Interfaces:**

- Consumes: `reconcilePayments`, `FakeSettlementReport`, `startRealPostgres`.
- Produces: nothing consumed downstream.

- [ ] **Step 1: Write the failing test**

Create `packages/payments/src/reconcile.rls.test.ts`, modelled on `payments.rls.test.ts` (same probe-role setup) and on `fiscal-verifactu/src/reconcile.rls.test.ts` (same reasoning about what a superuser would hide):

```ts
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@waitron/db";
import { decimal, tenantId as brandTenantId } from "@waitron/shared";
import { recordIncidentOnce } from "@waitron/core";
import { withTenant } from "@waitron/db";
import { reconcilePayments, DEFAULT_SETTLEMENT_LAG_MS } from "./reconcile.js";
import { insertCapturedPayment } from "./store.js";
import { FakeSettlementReport } from "./testing/fake-settlement-report.js";
import { startRealPostgres, type RealPostgres } from "./testing/postgres.js";
import { seedWorkingOrder } from "../test/seed.js";

// A non-superuser LOGIN role inheriting app_user's grants. Being non-superuser is what makes RLS
// apply at all (a superuser bypasses FORCE ROW LEVEL SECURITY), which is why PGlite cannot prove
// any of this. The sweep opens TWO withTenant scopes and touches THREE privileges: SELECT on
// payments + working_orders (T1), INSERT on incidents and UPDATE on payments (T2). A missing grant
// on any of them is invisible until a real role runs it.
const PROBE_ROLE = "reconcile_rls_probe";
const PROBE_PASSWORD = "probe";

let pg: RealPostgres;
let admin: Database;

beforeAll(async () => {
  pg = await startRealPostgres();
  admin = await pg.connect();
  await admin.execute(
    sql.raw(`create role ${PROBE_ROLE} login password '${PROBE_PASSWORD}' in role app_user`),
  );
});

afterAll(async () => {
  await admin.close();
  await pg.stop();
});

const NOW = new Date("2026-07-25T12:00:00Z");
const OLD_SETTLED = new Date("2026-07-01T12:00:00Z");
const PERIOD = { from: new Date("2026-07-01T00:00:00Z"), to: new Date("2026-07-02T00:00:00Z") };

describe("reconcile under real row-level security", () => {
  it("sweeps, raises an incident and stamps the marker as a non-superuser app_user member", async () => {
    const seeded = await seedWorkingOrder(admin, "B33333333");
    await withTenant(admin, seeded.tenantId, (tx) =>
      insertCapturedPayment(tx, {
        tenantId: seeded.tenantId,
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: "rls-1",
        externalRef: "ext-rls-1",
        amount: decimal("10.00"),
        settledAt: OLD_SETTLED,
      }),
    );
    await admin.execute(sql`
      update working_orders set status = 'abandoned' where id = ${seeded.workingOrderId}`);

    const probe = await pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const reversed: string[] = [];
      const result = await reconcilePayments(
        {
          db: probe,
          provider: "fake",
          report: new FakeSettlementReport([]),
          reverse: async (ref) => {
            reversed.push(ref);
          },
          incidents: recordIncidentOnce,
          settlementLagMs: DEFAULT_SETTLEMENT_LAG_MS,
        },
        brandTenantId(seeded.tenantId),
        PERIOD,
        NOW,
      );

      // T1's SELECT saw the row through the tenant-isolation policy (join to working_orders
      // included), T2's INSERT satisfied incidents' WITH CHECK, and T2's UPDATE had the grant.
      expect(result.checked).toBe(1);
      expect(result.orphan).toHaveLength(1);
      expect(result.remediated).toBe(1);
      expect(reversed).toEqual(["rls-1"]);
      expect(result.incidentsRaised).toBeGreaterThan(0);
    } finally {
      await probe.close();
    }
  });

  it("sees nothing for a tenant it is not scoped to", async () => {
    const mine = await seedWorkingOrder(admin, "B44444444");
    const theirs = await seedWorkingOrder(admin, "B55555555");
    await withTenant(admin, theirs.tenantId, (tx) =>
      insertCapturedPayment(tx, {
        tenantId: theirs.tenantId,
        workingOrderId: theirs.workingOrderId,
        provider: "fake",
        paymentRef: "rls-theirs",
        externalRef: "ext-rls-theirs",
        amount: decimal("10.00"),
        settledAt: OLD_SETTLED,
      }),
    );

    const probe = await pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const result = await reconcilePayments(
        {
          db: probe,
          provider: "fake",
          report: new FakeSettlementReport([]),
          reverse: async () => {},
          incidents: recordIncidentOnce,
          settlementLagMs: DEFAULT_SETTLEMENT_LAG_MS,
        },
        brandTenantId(mine.tenantId),
        PERIOD,
        NOW,
      );
      // The other tenant's stale payment is invisible: RLS scopes T1 to `mine`.
      expect(result.checked).toBe(0);
      expect(result.unsettled).toEqual([]);
    } finally {
      await probe.close();
    }
  });
});
```

- [ ] **Step 2: Run it to verify it passes (this is a proof, not a red-green cycle)**

Run: `pnpm --filter @waitron/payments test -- reconcile.rls`
Expected: PASS. If it fails on a missing privilege, the fix is a GRANT migration, not a weakened test. If Docker is absent the suite THROWS — that is an environment problem to report, never a skip.

- [ ] **Step 3: Commit**

```bash
git add packages/payments/src/reconcile.rls.test.ts
git commit -m "test(payments): reconcile under real row-level security"
```

---

### Task 8: Real-Postgres concurrency suite

**Files:**

- Create: `packages/payments/src/reconcile.concurrency.test.ts`

**Interfaces:**

- Consumes: `reconcilePayments`, `FakeSettlementReport`, `startRealPostgres`.
- Produces: nothing consumed downstream.

- [ ] **Step 1: Write the test**

Create `packages/payments/src/reconcile.concurrency.test.ts`. Model the structure on `packages/payments/src/incident-dedup.concurrency.test.ts`. The invariant under test: two sweeps of the same tenant racing produce exactly ONE reversal and ONE open incident per class, because `markReconcileRemediated` and the incidents dedup index are both single-winner.

```ts
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@waitron/db";
import { decimal, tenantId as brandTenantId } from "@waitron/shared";
import { recordIncidentOnce } from "@waitron/core";
import { withTenant } from "@waitron/db";
import { reconcilePayments, DEFAULT_SETTLEMENT_LAG_MS } from "./reconcile.js";
import type { ReconcileDeps } from "./reconcile.js";
import { insertCapturedPayment } from "./store.js";
import { FakeSettlementReport } from "./testing/fake-settlement-report.js";
import { startRealPostgres, type RealPostgres } from "./testing/postgres.js";
import { seedWorkingOrder } from "../test/seed.js";

let pg: RealPostgres;
let admin: Database;

beforeAll(async () => {
  pg = await startRealPostgres();
  admin = await pg.connect();
});

afterAll(async () => {
  await admin.close();
  await pg.stop();
});

const NOW = new Date("2026-07-25T12:00:00Z");
const OLD_SETTLED = new Date("2026-07-01T12:00:00Z");
const PERIOD = { from: new Date("2026-07-01T00:00:00Z"), to: new Date("2026-07-02T00:00:00Z") };

describe("concurrent reconcile sweeps", () => {
  it("reverse an orphan exactly once and raise one incident, however they interleave", async () => {
    const seeded = await seedWorkingOrder(admin, "B66666666");
    await withTenant(admin, seeded.tenantId, (tx) =>
      insertCapturedPayment(tx, {
        tenantId: seeded.tenantId,
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: "race-1",
        externalRef: "ext-race-1",
        amount: decimal("10.00"),
        settledAt: OLD_SETTLED,
      }),
    );
    await admin.execute(sql`
      update working_orders set status = 'abandoned' where id = ${seeded.workingOrderId}`);

    const one = await pg.connect();
    const two = await pg.connect();
    const reversed: string[] = [];
    const make = (db: Database): ReconcileDeps => ({
      db,
      provider: "fake",
      report: new FakeSettlementReport([]),
      reverse: async (ref) => {
        reversed.push(ref);
      },
      incidents: recordIncidentOnce,
      settlementLagMs: DEFAULT_SETTLEMENT_LAG_MS,
    });

    try {
      const [a, b] = await Promise.all([
        reconcilePayments(make(one), brandTenantId(seeded.tenantId), PERIOD, NOW),
        reconcilePayments(make(two), brandTenantId(seeded.tenantId), PERIOD, NOW),
      ]);

      // Both sweeps REPORT the orphan — the audit finding is not a claim on it. Only one
      // stamped the marker, so only one reversal was issued.
      expect(a.orphan).toHaveLength(1);
      expect(b.orphan).toHaveLength(1);
      expect(a.remediated + b.remediated).toBe(1);
      expect(reversed).toEqual(["race-1"]);

      // The open-incident dedup index is the arbiter for the incident: exactly one row, and
      // exactly one sweep counted it.
      const { rows } = await admin.execute<{ n: string }>(sql`
        select count(*) as n from incidents
        where tenant_id = ${seeded.tenantId} and code = 'payment.reconcile_orphan'`);
      expect(Number(rows[0].n)).toBe(1);
      expect(a.incidentsRaised + b.incidentsRaised).toBe(1);
    } finally {
      await one.close();
      await two.close();
    }
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @waitron/payments test -- reconcile.concurrency`
Expected: PASS. If it hangs, the cause is a transaction left open on a lost race — every connection close is already in a `finally` above; do not raise the timeout to hide it.

- [ ] **Step 3: Commit**

```bash
git add packages/payments/src/reconcile.concurrency.test.ts
git commit -m "test(payments): concurrent reconcile sweeps remediate exactly once"
```

---

### Task 9: The wiring capstone

**Files:**

- Create: `packages/payments/src/reconcile.wiring.test.ts`

**Interfaces:**

- Consumes: `FakePaymentProvider`, `FakeReconciler`, `FakeSettlementReport`, `@waitron/core`'s `openIncidents`.
- Produces: nothing consumed downstream.

- [ ] **Step 1: Write the test**

Create `packages/payments/src/reconcile.wiring.test.ts`, modelled on `offline.wiring.test.ts` (which already pairs `FakePaymentProvider` with `openIncidents`). The story: a real card is collected through the provider, the sale is never recorded (the orphan window), the working order is abandoned, and the sweep finds it, reverses it, and surfaces one incident to the till.

```ts
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations } from "@waitron/db";
import type { Database } from "@waitron/db";
import { decimal, tenantId as brandTenantId, tillId as brandTillId } from "@waitron/shared";
import { openIncidents } from "@waitron/core";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import { FakePaymentProvider } from "./testing/fake-provider.js";
import { FakeReconciler } from "./testing/fake-reconciler.js";
import { FakeSettlementReport } from "./testing/fake-settlement-report.js";
import { freshNif, seedWorkingOrder } from "../test/seed.js";

let db: Database;

beforeAll(async () => {
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, PAYMENTS_MIGRATIONS);
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.execute(sql`truncate incidents, payment_refunds, payments cascade`);
});

/**
 * The capstone: money moved, the sale never happened, and the audit closed the gap.
 *
 * This is the §4 orphan window made concrete — `collect` captures, then `recordSale` never runs
 * (a crash, a walked-out customer), so a captured payment sits with a null `sale_id`. Nothing in
 * the capture path can fix that: the money moved before the invoice number existed, and T1/T2
 * forbids making the two atomic. `reconcile` is the designed backstop, and this proves the whole
 * chain end to end — provider → orphan → sweep → reversal → an incident the till can actually see
 * through the same `openIncidents` query the UI uses.
 */
describe("the orphan backstop, end to end", () => {
  it("collects, loses the sale, and lets the sweep reverse it and warn the till", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    const provider = new FakePaymentProvider(db);

    // 1. Real capture through the provider — the money moves.
    const captured = await provider.collect({
      tenantId: brandTenantId(seeded.tenantId),
      tillId: brandTillId(seeded.tillId),
      workingOrderId: seeded.workingOrderId as never,
      amount: decimal("12.50"),
    });
    expect(captured.state).toBe("captured");

    // 2. recordSale never happens; the customer leaves and the order is abandoned.
    await db.execute(sql`
      update working_orders set status = 'abandoned' where id = ${seeded.workingOrderId}`);

    // 3. The processor's report shows the settlement, so this is not ALSO an unsettled payment —
    //    the orphan is the whole finding.
    const now = new Date();
    const report = new FakeSettlementReport([
      { references: ["irrelevant"], amount: decimal("12.50"), settledAt: now },
    ]);
    const reconciler = new FakeReconciler(db, report);
    const period = { from: new Date(now.getTime() - 3_600_000), to: new Date(now.getTime() + 1) };

    const result = await reconciler.reconcile(brandTenantId(seeded.tenantId), period, now);

    // 4. The audit found it, reversed it, and said so.
    expect(result.orphan).toHaveLength(1);
    expect(result.orphan[0].paymentRef).toBe(captured.paymentRef);
    expect(result.remediated).toBe(1);
    expect(reconciler.reversed).toEqual([captured.paymentRef]);

    // 5. And the till sees exactly one incident, through the UI's own query.
    const incidents = await db.transaction((tx) =>
      openIncidents(tx, brandTillId(seeded.tillId)),
    );
    expect(incidents.map((i) => i.code)).toEqual(["payment.reconcile_orphan"]);
    expect(incidents[0].params.count).toBe(1);
  });
});
```

If `FakePaymentProvider.collect`'s `workingOrderId` parameter is branded, replace the `as never`
cast with the package's own brand helper (`workingOrderId` from `@waitron/shared`) exactly as
`offline.wiring.test.ts` does — copy that file's call site rather than inventing one.

- [ ] **Step 2: Run it**

Run: `pnpm --filter @waitron/payments test -- reconcile.wiring`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/payments/src/reconcile.wiring.test.ts
git commit -m "test(payments): orphan backstop wiring capstone"
```

---

### Task 10: Coverage, formatting and the design-doc cross-references

**Files:**

- Modify: `docs/superpowers/specs/2026-07-22-payment-layer-design.md`
- Modify: `packages/payments/vitest.config.ts` (only if coverage demands it)

**Interfaces:**

- Consumes: everything.
- Produces: a branch that passes the CI gates.

- [ ] **Step 1: Run the coverage gate**

Run: `pnpm --filter @waitron/payments test:coverage`
Expected: statements ≥ 98, lines ≥ 98, functions ≥ 98, branches ≥ 95.

This gate is **CI-only** — no local hook runs it, so a shortfall here is invisible until CI. If it fails:

- prefer adding the missing test to the suite that owns the behaviour;
- an unreachable defensive branch is a signal to delete the branch, not to add an untestable test (a defensive check that cannot be reached will FAIL the branch gate — the PR #23 lesson);
- only a genuine v8 artifact (a branchless module reporting phantom branches) justifies a
  `coverage.exclude` entry, and it must carry a comment saying which artifact and why, like the
  existing `src/manual.ts` entry.

- [ ] **Step 2: Update the umbrella design's cross-references**

In `docs/superpowers/specs/2026-07-22-payment-layer-design.md`:

1. **§3's interface sketch** — remove the `reconcile(tenantId, period)` line from the
   `PaymentProvider` block and replace the `// The drain / reconcile pair — mirrors FiscalBackend.`
   comment with `// The drain half of the pair; reconcile is its own interface (see the reconcile design).`
2. **§6** — add a pointer immediately under the heading:
   `> **Superseded in two places by [the reconcile design](./2026-07-25-payment-reconcile-design.md) (2026-07-25):** the sweep is a separate `PaymentReconciler` interface rather than a `PaymentProvider` method, and the missed-inbound-settlement case is its own fifth class (`lostSettlement`) rather than part of `missingLocal`.`
3. **§10 item 5** — mark the reconcile line: `` `reconcile()` per settlement identity (the former "4d") — **Slice A (the neutral sweep) landed**; Slice B (the vendor adapter) is next. ``

- [ ] **Step 3: Format and lint everything**

Run: `pnpm format:check`
If it reports files, run `npx prettier --write` on them (prettier is a pre-push and CI gate and is **not** part of `lint` — it catches this branch's new files every time).

Run: `pnpm --filter @waitron/payments lint && pnpm --filter @waitron/payments typecheck`
Expected: PASS.

- [ ] **Step 4: Run the whole repo suite**

Run: `pnpm -r test`
Expected: PASS. Nothing outside `packages/payments` should have changed behaviour; if another package fails, the cause is a shared-surface change that needs investigating, not a retry.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs(payments): point the umbrella design at the reconcile design"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| §1 `PaymentReconciler` seam, `now` argument | 3, 6 |
| §2 neutral sweep + three ports, core stays a dev dep | 3, 4 |
| §3 half-open period, two windows, sargable filter | 2, 3, 4 |
| §4 T1 → network → T2 → remediation; network never skipped; marker before reversal | 4, 5 |
| §5 the five classes + independence + `checked` + hinted-till rule | 3, 4 |
| §6 aggregate incidents per (till × class), real-insert counting, six codes | 4, 5 |
| §7 `PaymentReconcileResult` / `PaymentMismatch` | 3, 6 |
| §8 marker column, sweep index, three store queries + `tillForWorkingOrder` | 1, 2 |
| §9 the five test suites, fakes not barrel-exported, vocabulary guard, coverage | 3–10 |
| §10 Slice A boundary (no `payments-stripe` changes) | Global Constraints |
| §11 out of scope | not implemented, by design |

**Type consistency:** `ReconcilableRow` (Task 2) is consumed by name in Tasks 3–5; `SettlementRecord`, `ClassifiedRow`, `Classification`, `MismatchClass`, `PaymentMismatch`, `PaymentReconcileResult`, `ReconcileDeps`, `IncidentSink`, `ReversalFn`, `SettlementReportSource`, `ReconcilePeriod`, `PaymentReconciler` are all defined in Task 3 and used under exactly those names afterwards. `markReconcileRemediated` returns `boolean` in Task 2 and is consumed as a boolean in Task 4. `remediate` returns `{ remediated, incidentsRaised }` after Task 5 Step 3, and Task 4's caller loop is updated in that same step.

**Known intentional gaps:** `remediate`'s Task 4 form is deliberately incomplete (no failure path) and is replaced in Task 5 — Task 4's tests never exercise a failing reversal, so it is green at both points.
