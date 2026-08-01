# Payment Mode 1 — Manual / Unintegrated Tender — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the POS record a card payment taken on a *separate* bank terminal (an unintegrated "manual" tender) as a settled card tender, atomically with the sale, plus record manual refunds — reusing the existing payment store with no `PaymentProvider` adapter and no network call.

**Architecture:** Manual mode is the trivial, provider-less end of the payment layer (design doc §0 + the "Mode 1" section of `docs/superpowers/specs/2026-07-22-payment-layer-design.md`). It writes an ordinary `payments` lifecycle row under a **sentinel `provider = "manual"`**, `state = captured`, carrying an optional hand-keyed `external_ref` (the bank terminal's operation number). Because there is no network step, the payment row, the sale, and the association all commit in **one transaction** — so manual capture is atomic and the §4 orphan window cannot arise. Refunds staff perform on the bank terminal are mirrored via the existing `recordRefund` under the same sentinel provider.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Drizzle ORM + PostgreSQL, `numeric(12,2)` exact decimals via `@waitron/shared`'s `Decimal`/`decimal`, Vitest + PGlite (in-process Postgres) for tests, drizzle-kit for migration generation. Package: `@waitron/payments` (neutral, English-only).

## Global Constraints

Every task's requirements implicitly include this section.

- **Worktree root:** all commands run from `/Users/clintongormley/workspace/worktrees/waitron-payment-mode-1-manual-tender` unless a step says otherwise. The design doc is already committed on this branch (`b0e725b`).
- **English-only source.** `@waitron/payments` is a `GENERIC_PACKAGES` member (`packages/db/src/english-only.ts`), so Spanish words are banned **in identifiers and string literals** (comments are stripped before scanning, so Spanish *in comments* is allowed). Never write a Spanish word from `SPANISH_WORDS` (`pago`, `cobro`, `venta`, `importe`, `estado`, `operacion`, …) as an identifier or string. Use `manual`, `external_ref`, `acquirer`, `bank terminal`, `operation number`. The enforcing test — `packages/db/src/english-only.test.ts` — is **cross-package and is NOT run by the payments per-package suite**; it must be run explicitly (Task 5). (This is the 4a lesson: a shared/cross-package guard the per-package SDD suites never run.)
- **Exact decimals.** Money is `numeric(12,2)`; use `Decimal`/`decimal()` from `@waitron/shared`. No float ever touches the money path.
- **Manual mode is NOT a `PaymentProvider`.** No adapter class, no network, no `collect`. It reuses the store with `provider = "manual"`.
- **Additive migration only** — a nullable column. Migrations run **core-first** (`CORE_MIGRATIONS` then `PAYMENTS_MIGRATIONS`); the payments migration table is `__drizzle_migrations_payments`.
- **Coverage gate.** `packages/payments/vitest.config.ts` enforces statements/lines/functions ≥ 98, branches ≥ 95, under `poolOptions.forks.singleFork: true`. New code must be covered (both the `externalRef` set/omitted branches, and both manual functions).
- **TDD + tight commits.** Failing test → minimal implementation → passing test → commit. `git add` **only the explicit paths a task names** — never `-A` or `.`.
- **Types:** `import type { … }` for type-only imports; ESM specifiers end in `.js`.

---

### Task 1: Add the nullable `external_ref` column + migration `0002`

Adds the one new column manual mode needs (and integrated modes reuse later). Additive and nullable, so it applies cleanly over existing data.

**Files:**
- Modify: `packages/payments/src/schema/payments.ts`
- Create (via drizzle-kit): `packages/payments/drizzle/0002_payment_external_ref.sql`, `packages/payments/drizzle/meta/0002_snapshot.json`, and an updated `packages/payments/drizzle/meta/_journal.json`
- Test: `packages/payments/src/migrations.test.ts`

**Interfaces:**
- Produces: an `external_ref` (`text`, nullable) column on `payments`, exposed through the Drizzle table as `payments.externalRef`.

- [ ] **Step 1: Write the failing test** — add this `it` inside the existing `describe("payments migrations", …)` in `packages/payments/src/migrations.test.ts` (the file already imports `sql`, `CORE_MIGRATIONS`, `createPgliteDb`, `runMigrations`, `PAYMENTS_MIGRATIONS`):

```ts
it("adds a nullable external_ref column to payments", async () => {
  const db = await createPgliteDb();
  try {
    await runMigrations(db, CORE_MIGRATIONS);
    await runMigrations(db, PAYMENTS_MIGRATIONS);
    const rows = await db.execute<{ data_type: string; is_nullable: string }>(sql`
      select data_type, is_nullable
      from information_schema.columns
      where table_name = 'payments' and column_name = 'external_ref'
    `);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].data_type).toBe("text");
    expect(rows.rows[0].is_nullable).toBe("YES");
  } finally {
    await db.close();
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @waitron/payments exec vitest run src/migrations.test.ts -t "external_ref"`
Expected: FAIL — `expected [] to have a length of 1` (the column does not exist yet).

- [ ] **Step 3: Add the column to the schema** — in `packages/payments/src/schema/payments.ts`, insert the `externalRef` column immediately after the `paymentRef` line:

```ts
    /** This provider's opaque reference and the idempotency anchor. */
    paymentRef: text("payment_ref").notNull(),
    /** Optional human acquirer reference — e.g. the operation number a merchant keys off a
     * standalone bank card terminal for an unintegrated (manual) tender. Nullable: only manual
     * mode, and some integrated adapters, populate it. A reconciliation hook, never validated. */
    externalRef: text("external_ref"),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @waitron/payments exec drizzle-kit generate --name payment_external_ref`
Expected: creates `drizzle/0002_payment_external_ref.sql`, writes `drizzle/meta/0002_snapshot.json`, and appends a `0002_payment_external_ref` entry to `drizzle/meta/_journal.json`.

- [ ] **Step 5: Verify the generated SQL is the additive column only**

Run: `cat packages/payments/drizzle/0002_payment_external_ref.sql`
Expected: a single statement — `ALTER TABLE "payments" ADD COLUMN "external_ref" text;` (no other tables, no constraint changes). If drizzle-kit emitted anything else (a dropped constraint, a second table), STOP — the schema edit picked up unintended drift; revert and redo Step 3 with only the `externalRef` line added.

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @waitron/payments exec vitest run src/migrations.test.ts`
Expected: PASS (all migration tests, including the new one).

- [ ] **Step 7: Commit**

```bash
git -C /Users/clintongormley/workspace/worktrees/waitron-payment-mode-1-manual-tender add \
  packages/payments/src/schema/payments.ts \
  packages/payments/src/migrations.test.ts \
  packages/payments/drizzle/0002_payment_external_ref.sql \
  packages/payments/drizzle/meta/0002_snapshot.json \
  packages/payments/drizzle/meta/_journal.json
git -C /Users/clintongormley/workspace/worktrees/waitron-payment-mode-1-manual-tender commit -m "feat(payments): add nullable external_ref column (manual-tender acquirer ref)"
```

---

### Task 2: Thread `externalRef` through the store's insert path

Lets `insertCapturedPayment` persist the new column. The one internal writer (`insertPayment`) gains an optional field; `insertFailedPayment` is unaffected (a decline carries no acquirer ref → null).

**Files:**
- Modify: `packages/payments/src/store.ts`
- Test: `packages/payments/src/store.test.ts`

**Interfaces:**
- Consumes: the `external_ref` column from Task 1.
- Produces: `insertCapturedPayment(tx, NewPayment & { settledAt: Date })` where `NewPayment` now carries an optional `externalRef?: string`.

- [ ] **Step 1: Write the failing test** — append this `describe` block to `packages/payments/src/store.test.ts` (its `seedTenant`, `capture`, `SETTLED`, `decimal`, `sql`, and `insertCapturedPayment` imports already exist):

```ts
describe("insertCapturedPayment external_ref", () => {
  it("persists external_ref when provided", async () => {
    const seeded = await seedTenant();
    await db.transaction((tx) =>
      insertCapturedPayment(tx, {
        tenantId: seeded.tenantId,
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: "ext1",
        amount: decimal("10.00"),
        settledAt: SETTLED,
        externalRef: "OP-42",
      }),
    );
    const rows = await db.execute<{ external_ref: string | null }>(
      sql`select external_ref from payments where payment_ref = ${"ext1"} and tenant_id = ${seeded.tenantId}`,
    );
    expect(rows.rows[0].external_ref).toBe("OP-42");
  });

  it("leaves external_ref null when omitted", async () => {
    const seeded = await seedTenant();
    await capture(seeded, "ext2");
    const rows = await db.execute<{ external_ref: string | null }>(
      sql`select external_ref from payments where payment_ref = ${"ext2"} and tenant_id = ${seeded.tenantId}`,
    );
    expect(rows.rows[0].external_ref).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @waitron/payments exec vitest run src/store.test.ts -t "external_ref"`
Expected: FAIL — a TypeScript excess-property error on `externalRef` (the param type does not accept it yet), or the value is not persisted.

- [ ] **Step 3: Extend `NewPayment` and `insertPayment`** — in `packages/payments/src/store.ts`:

Add the optional field to `NewPayment`:

```ts
interface NewPayment {
  tenantId: string;
  workingOrderId: string;
  provider: string;
  paymentRef: string;
  amount: Decimal;
  /** Optional human acquirer reference (e.g. a standalone bank terminal's operation number). Set
   * for manual tenders; null otherwise. */
  externalRef?: string;
}
```

And set the column in `insertPayment`'s `values(...)` (add the `externalRef` line):

```ts
  await tx.insert(payments).values({
    tenantId: params.tenantId,
    workingOrderId: params.workingOrderId,
    provider: params.provider,
    paymentRef: params.paymentRef,
    amount: params.amount,
    externalRef: params.externalRef ?? null,
    state,
    settledAt,
  });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @waitron/payments exec vitest run src/store.test.ts`
Expected: PASS (the whole store suite, including both new cases).

- [ ] **Step 5: Commit**

```bash
git -C /Users/clintongormley/workspace/worktrees/waitron-payment-mode-1-manual-tender add \
  packages/payments/src/store.ts \
  packages/payments/src/store.test.ts
git -C /Users/clintongormley/workspace/worktrees/waitron-payment-mode-1-manual-tender commit -m "feat(payments): persist external_ref via insertCapturedPayment"
```

---

### Task 3: The `manual.ts` module — record a manual card tender and a manual refund

The manual-mode surface. Two thin functions over the store, pinning the sentinel provider, plus the exported `MANUAL_PROVIDER` constant. No class, no network.

**Files:**
- Create: `packages/payments/src/manual.ts`
- Create: `packages/payments/src/manual.test.ts`
- Modify: `packages/payments/src/index.ts`
- Test: `packages/payments/src/index.test.ts`

**Interfaces:**
- Consumes: `insertCapturedPayment` (with `externalRef`, Task 2), `recordRefund`, and `PaymentRow` from `./store.js`.
- Produces:
  - `MANUAL_PROVIDER = "manual"` (const string).
  - `recordManualCardPayment(tx, { tenantId: string; workingOrderId: string; amount: Decimal; settledAt: Date; externalRef?: string }): Promise<{ provider: string; paymentRef: string; settledAt: Date }>`
  - `recordManualRefund(tx, { tenantId: string; paymentRef: string; amount: Decimal }): Promise<PaymentRow>`

- [ ] **Step 1: Write the failing test** — create `packages/payments/src/manual.test.ts`:

```ts
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations } from "@waitron/db";
import type { Database } from "@waitron/db";
import { decimal } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import { MANUAL_PROVIDER, recordManualCardPayment, recordManualRefund } from "./manual.js";
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
  await db.execute(sql`truncate payment_refunds, payments cascade`);
});

const SETTLED = new Date("2026-07-23T09:00:00Z");

describe("recordManualCardPayment", () => {
  it("writes a captured row under the manual provider, with external_ref and a minted manual- ref", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    const result = await db.transaction((tx) =>
      recordManualCardPayment(tx, {
        tenantId: seeded.tenantId,
        workingOrderId: seeded.workingOrderId,
        amount: decimal("12.10"),
        settledAt: SETTLED,
        externalRef: "OP-000123",
      }),
    );
    expect(result.provider).toBe("manual");
    expect(result.paymentRef.startsWith("manual-")).toBe(true);
    expect(result.settledAt).toBe(SETTLED);

    const rows = await db.execute<{
      provider: string;
      state: string;
      amount: string;
      external_ref: string | null;
      settled_at: string | null;
    }>(sql`
      select provider, state, amount, external_ref, settled_at
      from payments where payment_ref = ${result.paymentRef} and tenant_id = ${seeded.tenantId}
    `);
    expect(rows.rows[0]).toMatchObject({
      provider: "manual",
      state: "captured",
      amount: "12.10",
      external_ref: "OP-000123",
    });
    expect(rows.rows[0].settled_at).not.toBeNull();
  });

  it("leaves external_ref null when the operation number is not supplied", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    const result = await db.transaction((tx) =>
      recordManualCardPayment(tx, {
        tenantId: seeded.tenantId,
        workingOrderId: seeded.workingOrderId,
        amount: decimal("5.00"),
        settledAt: SETTLED,
      }),
    );
    const rows = await db.execute<{ external_ref: string | null }>(
      sql`select external_ref from payments where payment_ref = ${result.paymentRef} and tenant_id = ${seeded.tenantId}`,
    );
    expect(rows.rows[0].external_ref).toBeNull();
  });
});

describe("recordManualRefund", () => {
  it("records a refund under the manual provider and advances the payment to refunded", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    const paid = await db.transaction((tx) =>
      recordManualCardPayment(tx, {
        tenantId: seeded.tenantId,
        workingOrderId: seeded.workingOrderId,
        amount: decimal("20.00"),
        settledAt: SETTLED,
      }),
    );
    const refunded = await db.transaction((tx) =>
      recordManualRefund(tx, {
        tenantId: seeded.tenantId,
        paymentRef: paid.paymentRef,
        amount: decimal("20.00"),
      }),
    );
    expect(refunded.state).toBe("refunded");

    const rows = await db.execute<{ provider: string; amount: string }>(sql`
      select provider, amount from payment_refunds
      where payment_ref = ${paid.paymentRef} and tenant_id = ${seeded.tenantId}
    `);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ provider: "manual", amount: "20.00" });
  });

  it("exposes the sentinel provider id as MANUAL_PROVIDER", () => {
    expect(MANUAL_PROVIDER).toBe("manual");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @waitron/payments exec vitest run src/manual.test.ts`
Expected: FAIL — cannot resolve `./manual.js` (the module does not exist yet).

- [ ] **Step 3: Create the module** — write `packages/payments/src/manual.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { Decimal } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import { insertCapturedPayment, recordRefund } from "./store.js";
import type { PaymentRow } from "./store.js";

/**
 * The sentinel `provider` value for a manual / unintegrated card tender — one a merchant takes on a
 * SEPARATE bank card terminal with no electronic link to the POS (the classic "datáfono" case, in a
 * comment where Spanish is allowed). Manual mode is NOT a `PaymentProvider`: it makes no network
 * call and implements no adapter. It reuses the payment store's ledger with this fixed provider id
 * so a manual card tender is uniform with an integrated one for association, reporting and refunds.
 * The word is ordinary English, so it passes `no-provider-vocabulary.test.ts` (which bans SDK/vendor
 * vocabulary, not plain words).
 */
export const MANUAL_PROVIDER = "manual";

export interface ManualCardPaymentParams {
  tenantId: string;
  workingOrderId: string;
  /** Exact decimal, tax-inclusive amount taken on this tender. */
  amount: Decimal;
  /** The instant the tender settled — the SAME reading the caller stamps the sale's tender with, so
   * payment and tender agree on one instant (the repo's one-clock-reading-per-event discipline). */
  settledAt: Date;
  /** Optional hand-keyed acquirer / bank-terminal operation number — a human reconciliation hook. */
  externalRef?: string;
}

export interface ManualCardPaymentResult {
  provider: string;
  paymentRef: string;
  settledAt: Date;
}

/**
 * Record a manual (unintegrated) card tender: a `captured` `payments` row under the sentinel
 * `manual` provider, with a freshly minted `paymentRef` and the optional `externalRef`. Makes NO
 * network call — there is no provider to call — so it can, and should, run INSIDE the sale
 * transaction alongside `recordSale` and `associatePaymentWithSale`, giving manual mode an atomic
 * capture with no orphan window.
 */
export async function recordManualCardPayment(
  tx: Transaction,
  params: ManualCardPaymentParams,
): Promise<ManualCardPaymentResult> {
  const paymentRef = `manual-${randomUUID()}`;
  await insertCapturedPayment(tx, {
    tenantId: params.tenantId,
    workingOrderId: params.workingOrderId,
    provider: MANUAL_PROVIDER,
    paymentRef,
    amount: params.amount,
    settledAt: params.settledAt,
    externalRef: params.externalRef,
  });
  return { provider: MANUAL_PROVIDER, paymentRef, settledAt: params.settledAt };
}

/**
 * Record a refund staff performed on the bank terminal, mirroring what happened there — a
 * `payment_refunds` row under the `manual` provider, advancing the payment to
 * `refunded`/`partially_refunded`. Reuses `recordRefund`, pinning the sentinel provider. Never
 * touches the fiscal record: reversing the SALE (a rectificativa) is a separate, deliberate action
 * through the existing `recordVoid` path, not a side effect of this.
 */
export async function recordManualRefund(
  tx: Transaction,
  params: { tenantId: string; paymentRef: string; amount: Decimal },
): Promise<PaymentRow> {
  return recordRefund(tx, {
    tenantId: params.tenantId,
    provider: MANUAL_PROVIDER,
    paymentRef: params.paymentRef,
    amount: params.amount,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @waitron/payments exec vitest run src/manual.test.ts`
Expected: PASS.

- [ ] **Step 5: Export the module from the package barrel** — in `packages/payments/src/index.ts`, add after the existing `./store.js` re-exports:

```ts
export {
  MANUAL_PROVIDER,
  recordManualCardPayment,
  recordManualRefund,
} from "./manual.js";
export type { ManualCardPaymentParams, ManualCardPaymentResult } from "./manual.js";
```

- [ ] **Step 6: Assert the new exports in the barrel test** — in `packages/payments/src/index.test.ts`, add `MANUAL_PROVIDER`, `recordManualCardPayment`, `recordManualRefund` to the import from `./index.js`, and add this `it` inside `describe("package public surface (./index.js)", …)`:

```ts
  it("re-exports the manual-tender surface from the package root", () => {
    expect(MANUAL_PROVIDER).toBe("manual");
    expect(typeof recordManualCardPayment).toBe("function");
    expect(typeof recordManualRefund).toBe("function");
  });
```

The updated import line at the top of `index.test.ts`:

```ts
import {
  associatePaymentWithSale,
  getPaymentByRef,
  insertCapturedPayment,
  insertFailedPayment,
  MANUAL_PROVIDER,
  PAYMENTS_MIGRATIONS,
  recordManualCardPayment,
  recordManualRefund,
  recordRefund,
  recordVoid,
} from "./index.js";
```

- [ ] **Step 7: Run the barrel test to verify it passes**

Run: `pnpm --filter @waitron/payments exec vitest run src/index.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git -C /Users/clintongormley/workspace/worktrees/waitron-payment-mode-1-manual-tender add \
  packages/payments/src/manual.ts \
  packages/payments/src/manual.test.ts \
  packages/payments/src/index.ts \
  packages/payments/src/index.test.ts
git -C /Users/clintongormley/workspace/worktrees/waitron-payment-mode-1-manual-tender commit -m "feat(payments): manual-tender module (recordManualCardPayment / recordManualRefund)"
```

---

### Task 4: Atomic wiring capstone — record sale + manual tender + associate, in one transaction

An integration capstone. It composes the units built and TDD-tested in Tasks 1–3 with `@waitron/core`'s `recordSale`, so it passes on its first green run; its purpose is to **prove the atomicity guarantee** (the orphan window collapses) — both the happy path and a rollback. Mirrors the existing `packages/payments/src/wiring.test.ts`, but replaces the pre-transaction `provider.collect()` with an in-transaction `recordManualCardPayment`.

**Files:**
- Create: `packages/payments/src/manual.wiring.test.ts`

**Interfaces:**
- Consumes: `recordManualCardPayment` (Task 3), `associatePaymentWithSale` (existing), `recordSale` (`@waitron/core`), `FakeFiscalBackend`, `seedForSale`/`freshNif` (`../test/seed.js`).

- [ ] **Step 1: Write the capstone test** — create `packages/payments/src/manual.wiring.test.ts`:

```ts
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations } from "@waitron/db";
import type { Database } from "@waitron/db";
import {
  decimal,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { recordSale } from "@waitron/core";
import type { RecordSaleInput } from "@waitron/core";
import type { TrustedClock } from "@waitron/fiscal";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import { associatePaymentWithSale } from "./store.js";
import { recordManualCardPayment } from "./manual.js";
import { freshNif, seedForSale } from "../test/seed.js";
import type { SeededForSale } from "../test/seed.js";

// The manual-mode capstone: unlike the integrated wiring (wiring.test.ts), there is no network step
// and no separate collect() before the transaction — recordManualCardPayment runs INSIDE the sale
// transaction, so the payment, the sale, and the association commit atomically. That is the whole
// point: manual mode has no §4 orphan window.

let db: Database;

beforeAll(async () => {
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, PAYMENTS_MIGRATIONS);
  await FakeFiscalBackend.install(db);
}, 60_000);

afterAll(async () => {
  await db.close();
});

const BASE = new Date("2026-03-01T13:05:00+01:00");

const steadyClock: TrustedClock = {
  now: () => ({
    instant: BASE,
    offsetMinutes: 60,
    confident: true,
    confidence: "anchored",
    anchorAgeSeconds: 0,
  }),
  anchor: () => {
    throw new Error("steadyClock: anchor() is not used by recordSale");
  },
  currentAnchor: () => null,
};

/** Builds the RecordSaleInput for one 12.10 card sale, taking the tender's settledAt off `settledAt`
 * (always set for a manual tender, so the sale always chains). */
function buildInput(s: SeededForSale, settledAt: Date): RecordSaleInput {
  return {
    tenantId: brandTenantId(s.tenantId),
    tillId: brandTillId(s.tillId),
    seriesId: brandSeriesId(s.seriesId),
    workingOrderId: brandWorkingOrderId(s.workingOrderId),
    locale: "es",
    invoiceLocales: ["es"],
    total: "12.10",
    tipAmount: "0.00",
    lines: [
      {
        lineNo: 1,
        descriptions: { es: "Item" },
        quantity: "1",
        unitPrice: "10.00",
        vatRate: "21.00",
        lineTotal: "10.00",
      },
    ],
    tenders: [{ method: "card", amount: "12.10", settledAt }],
    fiscalBackend: "fake",
    clock: steadyClock,
  };
}

describe("manual card tender -> recordSale -> associate (atomic, no provider)", () => {
  it("records the sale, the manual payment, and the association in one transaction", async () => {
    const backend = new FakeFiscalBackend(db);
    const s = await seedForSale(db, backend, freshNif());

    const saleId = await db.transaction(async (tx) => {
      const recorded = await recordSale(tx, backend, buildInput(s, BASE));
      const manual = await recordManualCardPayment(tx, {
        tenantId: s.tenantId,
        workingOrderId: s.workingOrderId,
        amount: decimal("12.10"),
        settledAt: BASE,
        externalRef: "OP-000123",
      });
      await associatePaymentWithSale(tx, {
        tenantId: s.tenantId,
        provider: "manual",
        paymentRef: manual.paymentRef,
        saleId: recorded.saleId,
      });
      return recorded.saleId;
    });

    const rows = await db.execute<{
      provider: string;
      state: string;
      sale_id: string | null;
      external_ref: string | null;
    }>(sql`
      select provider, state, sale_id, external_ref
      from payments where tenant_id = ${s.tenantId}
    `);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      provider: "manual",
      state: "captured",
      sale_id: saleId,
      external_ref: "OP-000123",
    });
  });

  it("rolls the manual payment back with the sale — no orphan row", async () => {
    const backend = new FakeFiscalBackend(db);
    const s = await seedForSale(db, backend, freshNif());
    const boom = new Error("boom");

    await expect(
      db.transaction(async (tx) => {
        await recordSale(tx, backend, buildInput(s, BASE));
        await recordManualCardPayment(tx, {
          tenantId: s.tenantId,
          workingOrderId: s.workingOrderId,
          amount: decimal("12.10"),
          settledAt: BASE,
          externalRef: "OP-ROLLBACK",
        });
        throw boom;
      }),
    ).rejects.toBe(boom);

    const rows = await db.execute<{ count: string }>(
      sql`select count(*)::text as count from payments where tenant_id = ${s.tenantId}`,
    );
    expect(rows.rows[0].count).toBe("0");
  });
});
```

- [ ] **Step 2: Run the capstone test to verify it passes**

Run: `pnpm --filter @waitron/payments exec vitest run src/manual.wiring.test.ts`
Expected: PASS (both cases). If the happy path fails on the composite `payments_sale_fk`, the association is running outside the sale transaction — confirm all three calls are inside the single `db.transaction` callback.

- [ ] **Step 3: Commit**

```bash
git -C /Users/clintongormley/workspace/worktrees/waitron-payment-mode-1-manual-tender add \
  packages/payments/src/manual.wiring.test.ts
git -C /Users/clintongormley/workspace/worktrees/waitron-payment-mode-1-manual-tender commit -m "test(payments): manual-tender atomic wiring + rollback capstone"
```

---

### Task 5: Full-suite verification (incl. the cross-package English-only guard)

No new product code — this is the gate that the per-task runs do not cover: full-package coverage, typecheck, lint, and the **cross-package** English-only guard that the payments suite never runs (the 4a lesson).

**Files:** none (verification only).

- [ ] **Step 1: Run the full payments suite with coverage**

Run: `pnpm --filter @waitron/payments test:coverage`
Expected: PASS, with statements/lines/functions ≥ 98 and branches ≥ 95. `manual.ts` and the new `externalRef` branch are covered by Tasks 2–4. If branch coverage dips, confirm both the provided-`externalRef` and omitted-`externalRef` paths are exercised (they are, in `store.test.ts` and `manual.test.ts`).

- [ ] **Step 2: Typecheck and lint the package**

Run: `pnpm --filter @waitron/payments typecheck && pnpm --filter @waitron/payments lint`
Expected: both PASS.

- [ ] **Step 3: Run the cross-package English-only guard**

> **Dated note, 2026-08-01.** The command below no longer finds the suite: it moved to
> `scripts/english-only.test.ts`, the repo-level Vitest project. Run on 2026-08-01,
> `pnpm --filter @waitron/db exec vitest run src/english-only.test.ts` exits 1 with
> `No test files found`. Today's equivalent is `pnpm vitest run scripts/english-only.test.ts` from
> the repository root — and it now runs unconditionally on every push that is not
> documentation-only, so Step 3 is covered whether or not anyone types it. The module under test,
> `packages/db/src/english-only.ts`, did not move.

Run: `pnpm --filter @waitron/db exec vitest run src/english-only.test.ts`
Expected: PASS — proves no Spanish identifier or string literal landed in `manual.ts`/`store.ts`/`payments.ts` (Spanish in comments is fine; the guard strips them). If it fails, a Spanish word from `SPANISH_WORDS` reached an identifier or string — rename it to English.

- [ ] **Step 4: Run the whole repo test suite (the pre-push gate) once**

Run: `pnpm -r test`
Expected: PASS across every package — the same gate the pre-push hook runs, catching any other cross-package assertion (as the 4a `vocabulary-scope` breakage taught). No commit; this is a green-light check before `/finish-branch`.

---

## Self-Review

**1. Spec coverage** (design doc "Mode 1" section):
- "Not a provider — reuses the store, sentinel `provider = "manual"`" → Task 3 (`MANUAL_PROVIDER`, `recordManualCardPayment` reusing `insertCapturedPayment`). ✓
- "Atomic capture — the orphan window collapses" → Task 4 (both the one-transaction happy path and the rollback proof). ✓
- "Manual refunds via existing `recordRefund`" → Task 3 (`recordManualRefund`). ✓
- "Schema: nullable `external_ref` column" → Task 1 (schema + migration) and Task 2 (persistence). ✓
- "external_ref: free-text, optional, unvalidated" → nullable `text`, no check constraint, set-or-null covered in Tasks 2/3. ✓
- "Reconciliation is external (no `reconcile()`)" → nothing built; correctly out of scope. ✓
- "Out of scope: `PaymentProvider` adapter, network, till UI, capture-mode config" → none built. ✓

**2. Placeholder scan:** No `TBD`/`TODO`/"add error handling"/"write tests for the above". Every code step carries full code; every run step carries an exact command and expected result. ✓

**3. Type consistency:** `recordManualCardPayment` returns `{ provider, paymentRef, settledAt }` — consumed as `manual.paymentRef` in Task 4. `NewPayment.externalRef?: string` (Task 2) matches the `externalRef` passed by `recordManualCardPayment` (Task 3) and `insertCapturedPayment` calls in Task 2's test. `MANUAL_PROVIDER = "manual"` matches the `provider: "manual"` string used in Task 4's `associatePaymentWithSale` call and the SQL assertions. `PaymentRow` (returned by `recordManualRefund`) is the existing store type. ✓

**4. Guards not to regress:** `no-provider-vocabulary` (per-package, in Task 5's coverage run) — "manual"/"external_ref"/"acquirer" are not banned vendor vocab. `monetary-columns` — `external_ref` is `text`, not a money column, so unaffected. `schema-ownership` — no new re-export of a core table. English-only cross-package guard — explicitly run in Task 5. ✓
