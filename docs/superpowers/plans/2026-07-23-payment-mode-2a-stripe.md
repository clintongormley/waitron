# Payment Mode 2a — Stripe Terminal Adapter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first real integrated `PaymentProvider` — `StripeTerminalProvider` in a new `@waitron/payments-stripe` package — driving a server-side Stripe Terminal reader to `collect` card payments and to reverse them, proven end-to-end against a deterministic `FakeStripe` in the normal gate plus a real Stripe test-mode suite run nightly.

**Architecture:** The adapter talks to a **narrow injected `StripeClient` interface** (real impl wraps the `stripe` SDK; `FakeStripe` for tests) — mirroring `VerifactuBackend`↔`VerifactuClient`. It is **config-agnostic**: constructed with `{ client, resolveReader, db }`, a client credentialed for the merchant's own **standalone** Stripe account. `collect` is **poll-to-completion** with T1/T2 discipline: a committed `attempting` row (keyed by `working_order_id`, `payment_ref` = a minted idempotency uuid) before the network, the outcome written after, with the Stripe PaymentIntent id in `external_ref`. Reversals map to `stripe.refunds`. The neutral `@waitron/payments` package gains the `attempting` state, the network-lifecycle store helpers, `PaymentRow.externalRef`, and the failed-refund path. Full design: `docs/superpowers/specs/2026-07-22-payment-layer-design.md` (Mode 2a section + §2).

**Tech Stack:** TypeScript (ESM, `.js` specifiers, `verbatimModuleSyntax`), the `stripe` Node SDK (`^22.3.2`), Drizzle ORM + PostgreSQL, exact-decimal `Decimal`/`decimal` from `@waitron/shared` (a branded string — **no `toNumber`**), Vitest + PGlite (hermetic) + Testcontainers (real-PG), Node 26.

## Global Constraints

Every task's requirements implicitly include this section.

- **Worktree root:** all commands run from `/Users/clintongormley/workspace/worktrees/waitron-payment-mode-2a-stripe`. `git -C <that path>` for commits; `cd` into it each shell invocation (the shell resets between calls). `git add` **only the paths a task names** — never `-A`/`.`.
- **Two packages change.** `@waitron/payments` (neutral — Tasks 1–3) gains the `attempting` state, store helpers, `PaymentRow.externalRef`, and the failed-refund path. `@waitron/payments-stripe` (new, Tasks 4–8) is the adapter. Keep vendor vocabulary (`stripe`, `reader`, `terminal`, `PaymentIntent`) **out of `@waitron/payments`** — it is English-only + guarded by `no-provider-vocabulary.test.ts`; the only neutral addition is `attempting`.
- **`payments-stripe` is in NEITHER `GENERIC_PACKAGES` nor `EXEMPT_PACKAGES`.** Do **not** edit `packages/db/src/english-only.ts` or its pinned tests — verified: the Spanish guard scans only `GENERIC_PACKAGES`, `no-provider-vocabulary` only `@waitron/payments`, and no completeness guard requires classification. Adding it would break `english-only.test.ts:25` + `vocabulary-scope.test.ts:34` for no benefit (its vocabulary is English).
- **Exact decimals.** Money is `Decimal` (branded string, scale 2) / `numeric(12,2)`. **Never** reach for a float; there is deliberately no `toNumber`. Stripe minor-unit conversion goes through the exact `toMinorUnits` helper (Task 4).
- **`attempting` is neutral** (every integrated adapter has an in-flight window), so it lives in `@waitron/payments`'s `payment_state` enum via `ALTER TYPE`, not the adapter.
- **T1/T2:** never hold a DB transaction across a network call. `collect` = commit `attempting` (T1) → network → commit outcome (T2).
- **Currency = `"eur"`** (the Spanish deli); a per-tenant currency is a later concern.
- **Config-agnostic adapter:** no config tables, no `drizzle/` in `payments-stripe`. It takes an injected `client` + `resolveReader`; provisioning (keys, reader ids) is deferred.
- **Coverage gate** (both packages, singleFork): statements/lines/functions ≥ 98, branches ≥ 95. The real-SDK wrapper (`stripe-client.ts`) is coverage-excluded (exercised only by the nightly sandbox); everything else is covered by the hermetic suite.
- **TDD + tight commits:** failing test → minimal impl → passing test → commit.
- The **fake is never barrel-exported** (import test doubles via the deep `src/testing/…js` path), mirroring `FakePaymentProvider`/`FakeFiscalBackend`.

---

### Task 1: Neutral `attempting` state + network-lifecycle store helpers

The in-flight state and the T1/T2 store primitives the adapter's `collect` needs.

**Files:**
- Modify: `packages/payments/src/schema/payments.ts` (enum), `packages/payments/src/provider.ts` (`PaymentState`), `packages/payments/src/store.ts` (helpers), `packages/payments/src/index.ts` (exports), `packages/payments/src/migrations.test.ts` (enum test)
- Create (via drizzle-kit): `packages/payments/drizzle/0003_payment_attempting.sql` + meta
- Test: `packages/payments/src/store.test.ts`

**Interfaces:**
- Produces: `payment_state` gains `"attempting"`. `insertAttempting(tx, NewPayment): Promise<void>`, `captureAttempting(tx, Key & { settledAt: Date; externalRef: string }): Promise<PaymentRow>`, `failAttempting(tx, Key): Promise<PaymentRow>`. All exported from the barrel.

- [ ] **Step 1: Write the failing enum test** — add to the `describe("payments migrations", …)` in `packages/payments/src/migrations.test.ts`:

```ts
it("adds 'attempting' to the payment_state enum", async () => {
  const db = await createPgliteDb();
  try {
    await runMigrations(db, CORE_MIGRATIONS);
    await runMigrations(db, PAYMENTS_MIGRATIONS);
    const rows = await db.execute<{ enumlabel: string }>(sql`
      select e.enumlabel from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      where t.typname = 'payment_state'
    `);
    expect(rows.rows.map((r) => r.enumlabel)).toContain("attempting");
  } finally {
    await db.close();
  }
});
```

- [ ] **Step 2: Run it — expect FAIL** (`attempting` not in the enum)

Run: `pnpm --filter @waitron/payments exec vitest run src/migrations.test.ts -t "attempting"`
Expected: FAIL.

- [ ] **Step 3: Add `attempting` to the enum + type.** In `packages/payments/src/schema/payments.ts`, change the `paymentState` enum to include `"attempting"` first (order is cosmetic; leading is fine):

```ts
export const paymentState = pgEnum("payment_state", [
  "attempting",
  "captured",
  "voided",
  "refunded",
  "partially_refunded",
  "failed",
]);
```

In `packages/payments/src/provider.ts`, add `"attempting"` to the `PaymentState` union and note it in the doc comment:

```ts
export type PaymentState =
  | "attempting"
  | "captured"
  | "voided"
  | "refunded"
  | "partially_refunded"
  | "failed";
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @waitron/payments exec drizzle-kit generate --name payment_attempting`
Expected: `drizzle/0003_payment_attempting.sql` containing an `ALTER TYPE "public"."payment_state" ADD VALUE 'attempting'...` statement (drizzle emits `ALTER TYPE ... ADD VALUE` for a new enum member) + a `0003` snapshot + journal entry.

Run: `cat packages/payments/drizzle/0003_payment_attempting.sql`
Expected: only the enum `ADD VALUE` (no table changes). If it emitted anything else, STOP and report.

- [ ] **Step 5: Write failing store-helper tests** — append to `packages/payments/src/store.test.ts` (imports `sql`, `decimal`, `AppError` already present; add `captureAttempting, failAttempting, insertAttempting` to the `./store.js` import):

```ts
describe("attempting lifecycle", () => {
  it("insertAttempting writes state=attempting, settledAt null", async () => {
    const seeded = await seedTenant();
    await db.transaction((tx) =>
      insertAttempting(tx, {
        tenantId: seeded.tenantId,
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: "a1",
        amount: decimal("12.10"),
      }),
    );
    const row = await getRow({ tenantId: seeded.tenantId, provider: "fake", paymentRef: "a1" });
    expect(row?.state).toBe("attempting");
    expect(row?.settledAt).toBeNull();
  });

  it("captureAttempting advances attempting -> captured with settledAt + external_ref", async () => {
    const seeded = await seedTenant();
    const key = { tenantId: seeded.tenantId, provider: "fake", paymentRef: "a2" };
    await db.transaction((tx) =>
      insertAttempting(tx, { ...key, workingOrderId: seeded.workingOrderId, amount: decimal("12.10") }),
    );
    const settledAt = new Date("2026-07-23T10:00:00Z");
    const result = await db.transaction((tx) =>
      captureAttempting(tx, { ...key, settledAt, externalRef: "pi_123" }),
    );
    expect(result.state).toBe("captured");
    const rows = await db.execute<{ state: string; external_ref: string | null; settled_at: string | null }>(
      sql`select state, external_ref, settled_at from payments where payment_ref = ${"a2"} and tenant_id = ${seeded.tenantId}`,
    );
    expect(rows.rows[0]).toMatchObject({ state: "captured", external_ref: "pi_123" });
    expect(rows.rows[0].settled_at).not.toBeNull();
  });

  it("failAttempting advances attempting -> failed", async () => {
    const seeded = await seedTenant();
    const key = { tenantId: seeded.tenantId, provider: "fake", paymentRef: "a3" };
    await db.transaction((tx) =>
      insertAttempting(tx, { ...key, workingOrderId: seeded.workingOrderId, amount: decimal("12.10") }),
    );
    const result = await db.transaction((tx) => failAttempting(tx, key));
    expect(result.state).toBe("failed");
    expect((await getRow(key))?.state).toBe("failed");
  });

  it("captureAttempting throws payment.not_found when there is no attempting row", async () => {
    const seeded = await seedTenant();
    const key = { tenantId: seeded.tenantId, provider: "fake", paymentRef: "nope" };
    const err = await db
      .transaction((tx) => captureAttempting(tx, { ...key, settledAt: new Date(), externalRef: "pi_x" }))
      .catch((e: unknown) => e);
    expect((err as AppError).code).toBe("payment.not_found");
  });
});
```

- [ ] **Step 6: Run — expect FAIL** (helpers undefined)

Run: `pnpm --filter @waitron/payments exec vitest run src/store.test.ts -t "attempting lifecycle"`
Expected: FAIL (import/type error).

- [ ] **Step 7: Implement the helpers** in `packages/payments/src/store.ts` (after `insertFailedPayment`):

```ts
/** Insert an in-flight payment — state=attempting, settledAt null. Committed BEFORE a provider's
 * network call (T1) so a crash mid-network leaves a recoverable row and the `payment_ref` (the
 * caller's idempotency anchor) is already claimed. Resolved by `captureAttempting`/`failAttempting`
 * (T2). Only network-driving integrated adapters use it; manual mode never does. */
export async function insertAttempting(tx: Transaction, params: NewPayment): Promise<void> {
  await insertPayment(tx, params, "attempting", null);
}

/** Resolve an `attempting` row to `captured` (T2 success): sets `settled_at` (the tender-settlement
 * time) and `external_ref` (the processor's own reference, e.g. a Stripe PaymentIntent id). Matches
 * only a row still `attempting`; if none matches, throws `payment.not_found`. */
export async function captureAttempting(
  tx: Transaction,
  params: Key & { settledAt: Date; externalRef: string },
): Promise<PaymentRow> {
  return resolveAttempting(tx, params, "captured", {
    settledAt: params.settledAt.toISOString(),
    externalRef: params.externalRef,
  });
}

/** Resolve an `attempting` row to `failed` (T2 failure — the network refused or timed out). Matches
 * only a row still `attempting`; if none matches, throws `payment.not_found`. */
export async function failAttempting(tx: Transaction, params: Key): Promise<PaymentRow> {
  return resolveAttempting(tx, params, "failed", {});
}

async function resolveAttempting(
  tx: Transaction,
  params: Key,
  state: "captured" | "failed",
  extra: { settledAt?: string; externalRef?: string },
): Promise<PaymentRow> {
  const [row] = await tx
    .update(payments)
    .set({
      state,
      settledAt: extra.settledAt ?? null,
      externalRef: extra.externalRef ?? null,
      updatedAt: sql`now()`,
    })
    .where(and(keyWhere(params), eq(payments.state, "attempting")))
    .returning(PAYMENT_COLUMNS);
  if (row === undefined) {
    throw new AppError("payment.not_found", {
      provider: params.provider,
      paymentRef: params.paymentRef,
    });
  }
  return row;
}
```

(Add `import { eq } … from "drizzle-orm"` — already imported. `PAYMENT_COLUMNS` and `keyWhere` already exist.)

- [ ] **Step 8: Export from the barrel** — add to the `./store.js` re-export block in `packages/payments/src/index.ts`:

```ts
  captureAttempting,
  failAttempting,
  insertAttempting,
```

- [ ] **Step 9: Run the store + migration + barrel suites — expect PASS**

Run: `pnpm --filter @waitron/payments exec vitest run src/store.test.ts src/migrations.test.ts src/index.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git -C /Users/clintongormley/workspace/worktrees/waitron-payment-mode-2a-stripe add \
  packages/payments/src/schema/payments.ts packages/payments/src/provider.ts \
  packages/payments/src/store.ts packages/payments/src/index.ts \
  packages/payments/src/migrations.test.ts \
  packages/payments/drizzle/0003_payment_attempting.sql \
  packages/payments/drizzle/meta/0003_snapshot.json packages/payments/drizzle/meta/_journal.json
git -C /Users/clintongormley/workspace/worktrees/waitron-payment-mode-2a-stripe commit -m "feat(payments): neutral 'attempting' state + T1/T2 store helpers"
```

---

### Task 2: `PaymentRow.externalRef`, `recordRefund` state filter, failed-refund path, fake amount fix

The reversal-result contract items the adapter needs, in the neutral package.

**Files:**
- Modify: `packages/payments/src/store.ts` (`PaymentRow`, `PAYMENT_COLUMNS`, `recordRefund`, new `recordFailedRefund`), `packages/payments/src/testing/fake-provider.ts` (partialRefund amount), `packages/payments/src/provider.ts` (doc), `packages/payments/src/index.ts`
- Test: `packages/payments/src/store.test.ts`, `packages/payments/src/testing/fake-provider.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces: `PaymentRow` gains `externalRef: string | null` (so `getPaymentByRef`/`findPaymentByRef` return the PI id). `recordFailedRefund(tx, Key & { amount: Decimal }): Promise<void>` (inserts a `state='failed'` refund row; the payment state is unchanged). `recordRefund`'s prior-sum filters `payment_refunds.state='succeeded'`.

- [ ] **Step 1: Write failing tests** — append to `packages/payments/src/store.test.ts`:

```ts
describe("externalRef on read-back + failed refunds", () => {
  it("getPaymentByRef returns externalRef", async () => {
    const seeded = await seedTenant();
    const key = { tenantId: seeded.tenantId, provider: "fake", paymentRef: "e1" };
    await db.transaction((tx) =>
      insertCapturedPayment(tx, {
        ...key, workingOrderId: seeded.workingOrderId, amount: decimal("10.00"),
        settledAt: SETTLED, externalRef: "pi_ext",
      }),
    );
    const row = await getRow(key);
    expect(row?.externalRef).toBe("pi_ext");
  });

  it("recordFailedRefund inserts a failed refund row and leaves the payment captured", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "e2", "20.00");
    await db.transaction((tx) => recordFailedRefund(tx, { ...key, amount: decimal("5.00") }));
    expect((await getRow(key))?.state).toBe("captured");
    const refunds = await db.execute<{ state: string }>(
      sql`select state from payment_refunds where payment_ref = ${"e2"} and tenant_id = ${seeded.tenantId}`,
    );
    expect(refunds.rows).toEqual([{ state: "failed" }]);
  });

  it("recordRefund ignores a prior FAILED refund when summing (a failed refund does not consume the balance)", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "e3", "20.00");
    await db.transaction((tx) => recordFailedRefund(tx, { ...key, amount: decimal("20.00") }));
    // A full succeeded refund must still be allowed — the failed one didn't consume anything.
    const result = await db.transaction((tx) => recordRefund(tx, { ...key, amount: decimal("20.00") }));
    expect(result.state).toBe("refunded");
  });
});
```

Add `recordFailedRefund` to the `./store.js` import at the top of the test file.

- [ ] **Step 2: Run — expect FAIL** (externalRef absent from PaymentRow; recordFailedRefund undefined; the third test proves the filter — it would currently throw `refund_exceeds_capture` because the failed 20.00 is summed).

Run: `pnpm --filter @waitron/payments exec vitest run src/store.test.ts -t "externalRef on read-back"`
Expected: FAIL.

- [ ] **Step 3: Add `externalRef` to `PaymentRow` + `PAYMENT_COLUMNS`** in `packages/payments/src/store.ts`:

```ts
export interface PaymentRow {
  id: string;
  state: PaymentState;
  amount: string;
  saleId: string | null;
  settledAt: string | null;
  /** The processor's own reference (e.g. a Stripe PaymentIntent id) / a manual acquirer ref; null
   * when none. Read-side of the `external_ref` column, needed by the reversal path to address the
   * processor. */
  externalRef: string | null;
}
```
```ts
const PAYMENT_COLUMNS = {
  id: payments.id,
  state: payments.state,
  amount: payments.amount,
  saleId: payments.saleId,
  settledAt: payments.settledAt,
  externalRef: payments.externalRef,
};
```

- [ ] **Step 4: Filter `recordRefund`'s prior sum to succeeded, and add `recordFailedRefund`.** In `recordRefund`, change the prior-refunds query to filter state:

```ts
  const prior = await tx
    .select({ amount: paymentRefunds.amount })
    .from(paymentRefunds)
    .where(
      and(
        eq(paymentRefunds.tenantId, params.tenantId),
        eq(paymentRefunds.paymentId, row.id),
        eq(paymentRefunds.state, "succeeded"),
      ),
    );
```

Add after `recordRefund`:

```ts
/** Record a refund the processor REFUSED — a `payment_refunds` row with `state='failed'`. The
 * payment's own state is unchanged (nothing was returned), and this refund is excluded from
 * `recordRefund`'s balance sum, so a later succeeded refund of the same amount is still allowed. No
 * `FOR UPDATE` needed: it neither reads a running total nor transitions the payment. */
export async function recordFailedRefund(
  tx: Transaction,
  params: Key & { amount: Decimal },
): Promise<void> {
  const row = await getPaymentByRef(tx, params);
  if (row === undefined) {
    throw new AppError("payment.not_found", { provider: params.provider, paymentRef: params.paymentRef });
  }
  await tx.insert(paymentRefunds).values({
    tenantId: params.tenantId,
    paymentId: row.id,
    provider: params.provider,
    paymentRef: params.paymentRef,
    amount: params.amount,
    state: "failed",
  });
}
```

- [ ] **Step 5: Fix the fake's partial-refund amount + document the contract.** In `packages/payments/src/provider.ts`, extend `PaymentResult.amount`'s doc:

```ts
  /** The amount this result concerns. For `collect`/`void`/`refund` it is the captured total; for
   * `partialRefund` it is the AMOUNT REFUNDED (not the capture). */
  amount: Decimal;
```

In `packages/payments/src/testing/fake-provider.ts`, `partialRefund` must return the refunded `amount`, not the capture. The `reverse` helper currently returns `decimal(row.amount)` (the capture). Change `toResult` usage so `partialRefund` reports the requested amount:

```ts
  async partialRefund(ref: string, amount: Decimal): Promise<PaymentResult> {
    const row = await this.db.transaction(async (tx) => {
      const found = await this.require(tx, ref);
      return recordRefund(tx, { tenantId: found.tenantId, provider: this.provider, paymentRef: ref, amount });
    });
    return { provider: this.provider, paymentRef: ref, state: row.state, amount, settledAt: null };
  }
```

(Leave `refund`/`reverse` returning the capture total. `settledAt` on a reversal result is `null`.)

- [ ] **Step 6: Add a fake test for the partial-refund amount** — in `packages/payments/src/testing/fake-provider.test.ts`, add a case asserting `partialRefund` returns the refunded amount:

```ts
it("partialRefund reports the refunded amount, not the captured total", async () => {
  const seeded = await seedTenant();
  const provider = new FakePaymentProvider(db);
  const paid = await provider.collect({
    tenantId: brandTenantId(seeded.tenantId), tillId: brandTillId(seeded.tillId),
    workingOrderId: brandWorkingOrderId(seeded.workingOrderId), amount: decimal("20.00"),
  });
  const refunded = await provider.partialRefund(paid.paymentRef, decimal("5.00"));
  expect(refunded.amount).toBe(decimal("5.00"));
  expect(refunded.state).toBe("partially_refunded");
});
```

(Match the existing imports/seed helper in that file; if it lacks a `seedTenant`, follow the file's existing per-test seeding.)

- [ ] **Step 7: Export `recordFailedRefund`** from `packages/payments/src/index.ts` (in the `./store.js` block).

- [ ] **Step 8: Run — expect PASS**

Run: `pnpm --filter @waitron/payments exec vitest run src/store.test.ts src/testing/fake-provider.test.ts src/index.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git -C /Users/clintongormley/workspace/worktrees/waitron-payment-mode-2a-stripe add \
  packages/payments/src/store.ts packages/payments/src/provider.ts \
  packages/payments/src/testing/fake-provider.ts packages/payments/src/testing/fake-provider.test.ts \
  packages/payments/src/store.test.ts packages/payments/src/index.ts
git -C /Users/clintongormley/workspace/worktrees/waitron-payment-mode-2a-stripe commit -m "feat(payments): PaymentRow.externalRef, recordRefund succeeded-filter + failed-refund path, fake partialRefund amount"
```

---

### Task 3: Real-Postgres reversal-concurrency test (neutral)

Proves `recordVoid`/`recordRefund`'s `FOR UPDATE` lock serialises concurrent reversals — the deferred item. No production code (the lock exists in `requireRowForUpdate`); this is the racing test that exercises it, following the acquired-signal pattern to avoid the 120s CI hang.

**Files:**
- Create: `packages/payments/src/reversal.concurrency.test.ts`

**Interfaces:** consumes `recordRefund`, `insertCapturedPayment`, the real-PG harness `startRealPostgres` (`./testing/postgres.js`) and `seedWorkingOrder` (`../test/seed.js`).

- [ ] **Step 1: Write the concurrency test** — create `packages/payments/src/reversal.concurrency.test.ts`. It seeds a captured payment as superuser, then has one connection hold the payment row `FOR UPDATE` (via `recordRefund` inside a held transaction) while a second concurrent `recordRefund` is proven to block until release. Use the acquired-signal pattern verbatim in shape:

```ts
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import { decimal } from "@waitron/shared";
import { insertCapturedPayment, recordRefund } from "./store.js";
import { startRealPostgres, type RealPostgres } from "./testing/postgres.js";
import { freshNif, seedWorkingOrder } from "../test/seed.js";

let pg: RealPostgres;
let admin: import("@waitron/db").Database;

beforeAll(async () => {
  pg = await startRealPostgres();
  admin = await pg.connect();
});
afterAll(async () => {
  await admin.close();
  await pg.stop();
});

const SETTLED = new Date("2026-07-23T10:00:00Z");

describe("concurrent reversals serialise on the payment row's FOR UPDATE lock", () => {
  it("a second recordRefund blocks until the first transaction commits, then sees the updated total", async () => {
    const seeded = await seedWorkingOrder(admin, freshNif());
    const key = { tenantId: seeded.tenantId, provider: "fake", paymentRef: "c1" };
    await admin.transaction((tx) =>
      insertCapturedPayment(tx, { ...key, workingOrderId: seeded.workingOrderId, amount: decimal("20.00"), settledAt: SETTLED }),
    );

    const holder = await pg.connect();
    const waiter = await pg.connect();
    let release: () => void = () => {};
    let holding: Promise<unknown> | undefined;
    try {
      const held = new Promise<void>((resolve) => (release = resolve));
      let acquire!: () => void;
      const acquired = new Promise<void>((resolve) => (acquire = resolve));
      holding = withTenant(holder, seeded.tenantId, async (tx) => {
        await recordRefund(tx, { ...key, amount: decimal("12.00") }); // takes FOR UPDATE on the row
        acquire();     // signal the lock is held
        await held;    // hold the tx open
      });
      await acquired;  // do not race before the lock is actually held

      const start = Date.now();
      const secondDone = withTenant(waiter, seeded.tenantId, (tx) =>
        recordRefund(tx, { ...key, amount: decimal("8.00") }),
      );
      // Give the waiter a beat; it must still be blocked on the lock.
      await new Promise((r) => setTimeout(r, 200));
      let settledEarly = false;
      await Promise.race([secondDone.then(() => (settledEarly = true)), new Promise((r) => setTimeout(r, 0))]);
      expect(settledEarly).toBe(false);

      release();
      const second = await secondDone;
      expect(second.state).toBe("refunded"); // 12 + 8 = 20 = capture
      expect(Date.now() - start).toBeGreaterThanOrEqual(150);
    } finally {
      release();
      if (holding) await holding.catch(() => {});
      await holder.close();
      await waiter.close();
    }
  });
});
```

- [ ] **Step 2: Run — expect PASS** (Docker required; the harness throws, never skips)

Run: `pnpm --filter @waitron/payments exec vitest run src/reversal.concurrency.test.ts`
Expected: PASS. If it hangs near 120s, the `finally` release/await ordering is wrong — re-check against `fiscal-verifactu/src/chain.concurrency.test.ts`.

- [ ] **Step 3: Commit**

```bash
git -C /Users/clintongormley/workspace/worktrees/waitron-payment-mode-2a-stripe add packages/payments/src/reversal.concurrency.test.ts
git -C /Users/clintongormley/workspace/worktrees/waitron-payment-mode-2a-stripe commit -m "test(payments): real-PG reversal-concurrency test (FOR UPDATE serialisation)"
```

---

### Task 4: Scaffold `@waitron/payments-stripe` + the `StripeClient` seam + `FakeStripe`

The new package, the narrow client interface with the exact money helper, the real SDK wrapper (coverage-excluded), and the deterministic fake.

**Files:**
- Create: `packages/payments-stripe/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`, `src/errors.ts`, `src/errors.reachability.test.ts`, `src/client.ts`, `src/client.test.ts`, `src/stripe-client.ts`, `src/testing/fake-stripe.ts`, `src/testing/fake-stripe.test.ts`
- Modify: none in other packages.

**Interfaces:**
- Produces:
  - `StripeClient` (interface): `createPaymentIntent({ amount: Decimal; currency: string; idempotencyKey: string }): Promise<{ id: string }>`; `processPaymentIntent(readerId: string, paymentIntentId: string): Promise<void>`; `readerOutcome(readerId: string): Promise<{ status: "in_progress" | "succeeded" | "failed"; failureCode?: string }>`; `cancelReaderAction(readerId: string): Promise<void>`; `refund({ paymentIntentId: string; amount?: Decimal; idempotencyKey: string }): Promise<{ id: string; status: "succeeded" | "pending" | "failed" }>`.
  - `toMinorUnits(amount: Decimal): number` (exact).
  - `stripeClient(stripe: Stripe): StripeClient` (real, coverage-excluded).
  - `FakeStripe` (class, `src/testing/`, not barrel-exported): implements `StripeClient` in memory + test controls.

- [ ] **Step 1: Scaffold the package.** Create `packages/payments-stripe/package.json`:

```json
{
  "name": "@waitron/payments-stripe",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:sandbox": "vitest run --config vitest.sandbox.config.ts",
    "typecheck": "tsc --noEmit",
    "lint": "eslint ."
  },
  "dependencies": {
    "@waitron/core": "workspace:*",
    "@waitron/db": "workspace:*",
    "@waitron/payments": "workspace:*",
    "@waitron/shared": "workspace:*",
    "stripe": "^22.3.2"
  },
  "devDependencies": {
    "@electric-sql/pglite": "^0.5.4",
    "@testcontainers/postgresql": "^12.0.4",
    "@types/node": "^24.0.0",
    "@vitest/coverage-v8": "^3.0.0",
    "@waitron/fiscal": "workspace:*",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

Create `packages/payments-stripe/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "types": ["vitest/globals", "node"]
  },
  "include": ["src", "test"]
}
```

Create `packages/payments-stripe/vitest.config.ts` (mirror `packages/payments/vitest.config.ts`, but exclude the real-SDK wrapper + testing + barrel from coverage):

```ts
import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**", "src/**/*.sandbox.test.ts"],
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        "src/index.ts",
        // The real Stripe SDK boundary — a thin call-mapping wrapper exercised only by the nightly
        // sandbox suite (real test-mode), never the hermetic run. Its logic is the SDK's; excluding
        // it keeps the branch metric on our own code (FakeStripe, the provider, toMinorUnits).
        "src/stripe-client.ts",
        "src/testing/**",
        "src/**/*.sandbox.test.ts",
      ],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
```

- [ ] **Step 2: Run `pnpm install` to wire the workspace + add `stripe`**

Run: `cd /Users/clintongormley/workspace/worktrees/waitron-payment-mode-2a-stripe && pnpm install`
Expected: resolves `@waitron/payments-stripe` and installs `stripe@^22.3.2`. Confirm: `node -e "require('stripe/package.json')" ` isn't needed; instead `pnpm --filter @waitron/payments-stripe exec node -e "import('stripe').then(()=>console.log('ok'))"` prints `ok`.

- [ ] **Step 3: Errors + reachability.** Create `packages/payments-stripe/src/errors.ts`:

```ts
import "@waitron/shared";

/** `@waitron/payments-stripe`'s contribution to the shared error registry — Stripe-adapter-specific
 * failures the neutral `payment.*` codes don't cover. */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** The reader did not resolve its action within the poll window; the action was cancelled and
     * the payment failed. */
    "stripe.collect_timeout": { paymentRef: string; readerId: string };
  }
}
```

Create `packages/payments-stripe/src/errors.reachability.test.ts` (mirror `packages/payments/src/errors.reachability.test.ts` — assert the code is registered by importing the barrel):

```ts
import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import "./index.js";

describe("errors reachable from the barrel", () => {
  it("registers stripe.collect_timeout", () => {
    const e = new AppError("stripe.collect_timeout", { paymentRef: "p", readerId: "r" });
    expect(e.code).toBe("stripe.collect_timeout");
  });
});
```

Create a minimal `packages/payments-stripe/src/index.ts` for now (grown in later tasks):

```ts
import "./errors.js";
export { toMinorUnits } from "./client.js";
export type { StripeClient } from "./client.js";
export { stripeClient } from "./stripe-client.js";
```

- [ ] **Step 4: Write failing `toMinorUnits` tests** — create `packages/payments-stripe/src/client.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import { toMinorUnits } from "./client.js";

describe("toMinorUnits", () => {
  it("converts major-unit decimals to integer minor units", () => {
    expect(toMinorUnits(decimal("12.10"))).toBe(1210);
    expect(toMinorUnits(decimal("12"))).toBe(1200);
    expect(toMinorUnits(decimal("0.05"))).toBe(5);
    expect(toMinorUnits(decimal("0"))).toBe(0);
  });
  it("is exact for large amounts (no float)", () => {
    expect(toMinorUnits(decimal("999999999999.99"))).toBe(99999999999999);
  });
});
```

- [ ] **Step 5: Run — expect FAIL** (client.ts absent)

Run: `pnpm --filter @waitron/payments-stripe exec vitest run src/client.test.ts`
Expected: FAIL.

- [ ] **Step 6: Implement `client.ts` (interface + exact helper).** Create `packages/payments-stripe/src/client.ts`:

```ts
import { toScale } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";

/** The narrow Stripe surface `StripeTerminalProvider` depends on — the calls it makes, not the SDK.
 * The real impl (`./stripe-client.ts`) wraps the `stripe` SDK; `FakeStripe` (`./testing/`) models it
 * deterministically. Amounts cross this seam as exact `Decimal`; the real impl converts to Stripe's
 * integer minor units via `toMinorUnits`. Mirrors `VerifactuClient`. */
export interface StripeClient {
  createPaymentIntent(params: {
    amount: Decimal;
    currency: string;
    idempotencyKey: string;
  }): Promise<{ id: string }>;
  processPaymentIntent(readerId: string, paymentIntentId: string): Promise<void>;
  readerOutcome(
    readerId: string,
  ): Promise<{ status: "in_progress" | "succeeded" | "failed"; failureCode?: string }>;
  cancelReaderAction(readerId: string): Promise<void>;
  refund(params: {
    paymentIntentId: string;
    amount?: Decimal;
    idempotencyKey: string;
  }): Promise<{ id: string; status: "succeeded" | "pending" | "failed" }>;
}

/** Exact major→minor conversion for Stripe amounts. Money is scale-2, so `toScale(2)` normalises to
 * `"NN.MM"`, and removing the point yields the integer cents string — parsed with `Number` on a PURE
 * INTEGER string (never a float): safe up to `MAX_MONEY_INTEGER_DIGITS + 2 = 14` digits, well under
 * `Number.MAX_SAFE_INTEGER`. There is deliberately no `Decimal.toNumber`, and this is the only place
 * a monetary value becomes a JS number — at the SDK boundary that requires an integer. */
export function toMinorUnits(amount: Decimal): number {
  const scaled = toScale(amount, 2);
  return Number(scaled.replace(".", ""));
}
```

- [ ] **Step 7: Implement the real wrapper (coverage-excluded).** Create `packages/payments-stripe/src/stripe-client.ts`:

```ts
import type Stripe from "stripe";
import type { StripeClient } from "./client.js";
import { toMinorUnits } from "./client.js";

/** The real `StripeClient`, wrapping the `stripe` SDK's server-driven Terminal API. Coverage-excluded
 * (see vitest.config.ts): a thin call-mapping boundary exercised only by the nightly sandbox suite. */
export function stripeClient(stripe: Stripe): StripeClient {
  return {
    async createPaymentIntent({ amount, currency, idempotencyKey }) {
      const pi = await stripe.paymentIntents.create(
        {
          amount: toMinorUnits(amount),
          currency,
          payment_method_types: ["card_present"],
          capture_method: "automatic",
        },
        { idempotencyKey },
      );
      return { id: pi.id };
    },
    async processPaymentIntent(readerId, paymentIntentId) {
      await stripe.terminal.readers.processPaymentIntent(readerId, { payment_intent: paymentIntentId });
    },
    async readerOutcome(readerId) {
      const reader = await stripe.terminal.readers.retrieve(readerId);
      const action = reader.action;
      if (!action || action.status === "in_progress") return { status: "in_progress" };
      if (action.status === "succeeded") return { status: "succeeded" };
      return { status: "failed", failureCode: action.failure_code ?? undefined };
    },
    async cancelReaderAction(readerId) {
      await stripe.terminal.readers.cancelAction(readerId);
    },
    async refund({ paymentIntentId, amount, idempotencyKey }) {
      const refund = await stripe.refunds.create(
        { payment_intent: paymentIntentId, ...(amount ? { amount: toMinorUnits(amount) } : {}) },
        { idempotencyKey },
      );
      const status =
        refund.status === "succeeded" || refund.status === "pending" ? refund.status : "failed";
      return { id: refund.id, status };
    },
  };
}
```

(If `stripe`'s TS types differ slightly in this version — e.g. `action.failure_code` nesting — adjust to the installed types; the shape above matches Terminal server-driven reader actions. This file is not run in the hermetic suite.)

- [ ] **Step 8: Write failing `FakeStripe` tests** — create `packages/payments-stripe/src/testing/fake-stripe.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import { FakeStripe } from "./fake-stripe.js";

describe("FakeStripe", () => {
  it("createPaymentIntent mints a pi_ id; a captured reader outcome succeeds", async () => {
    const fake = new FakeStripe();
    const pi = await fake.createPaymentIntent({ amount: decimal("12.10"), currency: "eur", idempotencyKey: "k1" });
    expect(pi.id).toMatch(/^pi_/);
    await fake.processPaymentIntent("reader_1", pi.id);
    expect(await fake.readerOutcome("reader_1")).toEqual({ status: "succeeded" });
  });

  it("declineNext makes the reader outcome fail", async () => {
    const fake = new FakeStripe();
    fake.declineNext();
    const pi = await fake.createPaymentIntent({ amount: decimal("1.00"), currency: "eur", idempotencyKey: "k2" });
    await fake.processPaymentIntent("reader_1", pi.id);
    expect((await fake.readerOutcome("reader_1")).status).toBe("failed");
  });

  it("stallNext keeps the outcome in_progress until cancelled", async () => {
    const fake = new FakeStripe();
    fake.stallNext();
    const pi = await fake.createPaymentIntent({ amount: decimal("1.00"), currency: "eur", idempotencyKey: "k3" });
    await fake.processPaymentIntent("reader_1", pi.id);
    expect((await fake.readerOutcome("reader_1")).status).toBe("in_progress");
    await fake.cancelReaderAction("reader_1");
    expect((await fake.readerOutcome("reader_1")).status).toBe("failed");
  });

  it("refund echoes a succeeded refund by default; refundFailsNext makes it fail", async () => {
    const fake = new FakeStripe();
    const ok = await fake.refund({ paymentIntentId: "pi_x", idempotencyKey: "r1" });
    expect(ok.status).toBe("succeeded");
    fake.refundFailsNext();
    const bad = await fake.refund({ paymentIntentId: "pi_x", idempotencyKey: "r2" });
    expect(bad.status).toBe("failed");
  });
});
```

- [ ] **Step 9: Run — expect FAIL**, then implement `FakeStripe`. Create `packages/payments-stripe/src/testing/fake-stripe.ts`:

```ts
import type { Decimal } from "@waitron/shared";
import type { StripeClient } from "../client.js";

let seq = 0;
const nextId = (prefix: string): string => `${prefix}_${String(++seq).padStart(8, "0")}`;

type Outcome = "succeeded" | "failed" | "in_progress";

/** A deterministic in-memory `StripeClient` — the hermetic test double for the Stripe adapter. NOT
 * barrel-exported (a production import cannot reach it), like `FakePaymentProvider`. Test controls:
 * `declineNext`/`stallNext` shape the next reader outcome; `refundFailsNext` fails the next refund.
 * A stalled action stays `in_progress` until `cancelReaderAction` flips it to `failed`. */
export class FakeStripe implements StripeClient {
  private outcome: Outcome = "succeeded";
  private nextRefundFails = false;
  private readerAction = new Map<string, Outcome>();

  declineNext(): void {
    this.outcome = "failed";
  }
  stallNext(): void {
    this.outcome = "in_progress";
  }
  refundFailsNext(): void {
    this.nextRefundFails = true;
  }

  createPaymentIntent(_params: { amount: Decimal; currency: string; idempotencyKey: string }): Promise<{ id: string }> {
    return Promise.resolve({ id: nextId("pi") });
  }
  processPaymentIntent(readerId: string, _paymentIntentId: string): Promise<void> {
    this.readerAction.set(readerId, this.outcome);
    this.outcome = "succeeded"; // reset to the default after one use
    return Promise.resolve();
  }
  readerOutcome(readerId: string): Promise<{ status: Outcome; failureCode?: string }> {
    const status = this.readerAction.get(readerId) ?? "succeeded";
    return Promise.resolve(status === "failed" ? { status, failureCode: "card_declined" } : { status });
  }
  cancelReaderAction(readerId: string): Promise<void> {
    this.readerAction.set(readerId, "failed");
    return Promise.resolve();
  }
  refund(_params: { paymentIntentId: string; amount?: Decimal; idempotencyKey: string }): Promise<{ id: string; status: "succeeded" | "pending" | "failed" }> {
    const fails = this.nextRefundFails;
    this.nextRefundFails = false;
    return Promise.resolve({ id: nextId("re"), status: fails ? "failed" : "succeeded" });
  }
}
```

Run: `pnpm --filter @waitron/payments-stripe exec vitest run` — Expected: PASS (client + fake-stripe + errors.reachability).

- [ ] **Step 10: typecheck + lint the new package**

Run: `pnpm --filter @waitron/payments-stripe typecheck && pnpm --filter @waitron/payments-stripe lint`
Expected: both PASS.

- [ ] **Step 11: Commit**

```bash
git -C /Users/clintongormley/workspace/worktrees/waitron-payment-mode-2a-stripe add packages/payments-stripe pnpm-lock.yaml
git -C /Users/clintongormley/workspace/worktrees/waitron-payment-mode-2a-stripe commit -m "feat(payments-stripe): scaffold package + narrow StripeClient seam + FakeStripe"
```

---

### Task 5: `StripeTerminalProvider.collect` (poll-to-completion, T1/T2) + wiring test

**Files:**
- Create: `packages/payments-stripe/src/provider.ts` (the `collect` half), `packages/payments-stripe/src/provider.test.ts`, `packages/payments-stripe/src/wiring.test.ts`, `packages/payments-stripe/test/seed.ts` (or reuse `@waitron/payments`'s test seed — see below)
- Modify: `packages/payments-stripe/src/index.ts` (export the provider)

**Interfaces:**
- Consumes: `StripeClient`, `insertAttempting`/`captureAttempting`/`failAttempting` (`@waitron/payments`), `FakeStripe`.
- Produces: `class StripeTerminalProvider implements PaymentProvider` constructed with `StripeTerminalProviderOptions { client: StripeClient; db: Database; resolveReader: (tenantId: TenantId, tillId: TillId) => Promise<string>; poll?: { maxAttempts?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> } }`. `provider = "stripe"`, `capabilities = { partialRefund: true }`.

- [ ] **Step 1: Write failing `collect` tests** — create `packages/payments-stripe/src/provider.test.ts`. Seed via `@waitron/payments`'s exported test seed (deep import — the seed lives at `@waitron/payments/test/seed.js`; confirm the path resolves, else copy `seedWorkingOrder`/`freshNif` into `packages/payments-stripe/test/seed.ts`). A no-op `sleep` keeps the poll loop instant.

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations } from "@waitron/db";
import type { Database } from "@waitron/db";
import { decimal, tenantId as brandTenantId, tillId as brandTillId, workingOrderId as brandWorkingOrderId } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "@waitron/payments";
import { FakeStripe } from "./testing/fake-stripe.js";
import { StripeTerminalProvider } from "./provider.js";
import { freshNif, seedWorkingOrder } from "@waitron/payments/test/seed.js";

let db: Database;
beforeAll(async () => {
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, PAYMENTS_MIGRATIONS);
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => { await db.execute(sql`truncate payment_refunds, payments cascade`); });

const noSleep = () => Promise.resolve();
function providerFor(fake: FakeStripe): StripeTerminalProvider {
  return new StripeTerminalProvider({
    client: fake, db, resolveReader: () => Promise.resolve("reader_1"),
    poll: { maxAttempts: 3, intervalMs: 0, sleep: noSleep },
  });
}
async function collectParams(nif = freshNif()) {
  const s = await seedWorkingOrder(db, nif);
  return {
    tenantId: brandTenantId(s.tenantId), tillId: brandTillId(s.tillId),
    workingOrderId: brandWorkingOrderId(s.workingOrderId), amount: decimal("12.10"),
    _seeded: s,
  };
}

describe("StripeTerminalProvider.collect", () => {
  it("captures: attempting -> captured, settledAt set, external_ref = the PI id", async () => {
    const fake = new FakeStripe();
    const p = await collectParams();
    const result = await providerFor(fake).collect(p);
    expect(result.state).toBe("captured");
    expect(result.settledAt).not.toBeNull();
    expect(result.paymentRef).toMatch(/^[0-9a-f-]{36}$/); // a uuid, NOT the pi id
    const rows = await db.execute<{ state: string; external_ref: string | null }>(
      sql`select state, external_ref from payments where payment_ref = ${result.paymentRef} and tenant_id = ${p._seeded.tenantId}`,
    );
    expect(rows.rows[0].state).toBe("captured");
    expect(rows.rows[0].external_ref).toMatch(/^pi_/);
  });

  it("declines: attempting -> failed, settledAt null", async () => {
    const fake = new FakeStripe(); fake.declineNext();
    const p = await collectParams();
    const result = await providerFor(fake).collect(p);
    expect(result.state).toBe("failed");
    expect(result.settledAt).toBeNull();
  });

  it("times out: a stalled reader is cancelled and the payment fails", async () => {
    const fake = new FakeStripe(); fake.stallNext();
    const p = await collectParams();
    const result = await providerFor(fake).collect(p);
    expect(result.state).toBe("failed");
    const rows = await db.execute<{ state: string }>(
      sql`select state from payments where payment_ref = ${result.paymentRef} and tenant_id = ${p._seeded.tenantId}`,
    );
    expect(rows.rows[0].state).toBe("failed");
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (provider absent). Then implement.

Run: `pnpm --filter @waitron/payments-stripe exec vitest run src/provider.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `collect` + the poll loop.** Create `packages/payments-stripe/src/provider.ts`:

```ts
import { randomUUID } from "node:crypto";
import { AppError } from "@waitron/shared";
import type { Decimal, TenantId, TillId } from "@waitron/shared";
import type { Database } from "@waitron/db";
import type { CollectParams, PaymentProvider, PaymentResult, ProviderCapabilities } from "@waitron/payments";
import { captureAttempting, failAttempting, insertAttempting } from "@waitron/payments";
import type { StripeClient } from "./client.js";

const PROVIDER = "stripe";
const CURRENCY = "eur";
const DEFAULT_POLL = { maxAttempts: 60, intervalMs: 1000, sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) };

export interface StripeTerminalProviderOptions {
  client: StripeClient;
  db: Database;
  resolveReader: (tenantId: TenantId, tillId: TillId) => Promise<string>;
  poll?: { maxAttempts?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> };
}

/** The real Stripe Terminal `PaymentProvider` (server-driven). `collect` polls the reader to
 * completion under T1/T2: a committed `attempting` row (idempotency-uuid `payment_ref`) before the
 * network, the outcome after, PI id in `external_ref`. Reversals in Task 6. */
export class StripeTerminalProvider implements PaymentProvider {
  readonly provider = PROVIDER;
  readonly capabilities: ProviderCapabilities = { partialRefund: true };
  private readonly poll: Required<NonNullable<StripeTerminalProviderOptions["poll"]>>;

  constructor(private readonly opts: StripeTerminalProviderOptions) {
    this.poll = { ...DEFAULT_POLL, ...opts.poll };
  }

  async collect(params: CollectParams): Promise<PaymentResult> {
    const readerId = await this.opts.resolveReader(params.tenantId, params.tillId);
    const paymentRef = randomUUID();
    const key = { tenantId: params.tenantId, provider: PROVIDER, paymentRef };

    // T1 — commit the attempt before any network call.
    await this.opts.db.transaction((tx) =>
      insertAttempting(tx, {
        tenantId: params.tenantId,
        workingOrderId: params.workingOrderId,
        provider: PROVIDER,
        paymentRef,
        amount: params.amount,
      }),
    );

    // Network — outside any transaction (T1/T2).
    const outcome = await this.drive(readerId, params.amount, paymentRef);

    // T2 — persist the terminal outcome.
    const row = await this.opts.db.transaction((tx) =>
      outcome.captured
        ? captureAttempting(tx, { ...key, settledAt: outcome.settledAt, externalRef: outcome.piId })
        : failAttempting(tx, key),
    );
    return {
      provider: PROVIDER,
      paymentRef,
      state: row.state,
      amount: params.amount,
      settledAt: row.settledAt === null ? null : new Date(row.settledAt),
    };
  }

  private async drive(
    readerId: string,
    amount: Decimal,
    paymentRef: string,
  ): Promise<{ captured: true; settledAt: Date; piId: string } | { captured: false }> {
    let piId: string;
    try {
      const intent = await this.opts.client.createPaymentIntent({ amount, currency: CURRENCY, idempotencyKey: paymentRef });
      piId = intent.id;
      await this.opts.client.processPaymentIntent(readerId, piId);
    } catch {
      return { captured: false }; // a network error before/at process → failed; the attempt row is recoverable
    }
    for (let attempt = 0; attempt < this.poll.maxAttempts; attempt++) {
      const o = await this.opts.client.readerOutcome(readerId);
      if (o.status === "succeeded") return { captured: true, settledAt: new Date(), piId };
      if (o.status === "failed") return { captured: false };
      await this.poll.sleep(this.poll.intervalMs);
    }
    // Timed out — cancel the reader action, fail the payment.
    await this.opts.client.cancelReaderAction(readerId).catch(() => {});
    throw new AppError("stripe.collect_timeout", { paymentRef, readerId });
  }
}
```

Note: the timeout path throws `stripe.collect_timeout` from `drive`, which propagates out of `collect` — BUT the attempting row must still be resolved to `failed` first. **Correction:** the timeout must resolve the row, not leave it `attempting`. Restructure `drive` so timeout returns `{ captured: false }` (like a decline) AND record the timeout as an incident later — for 2a, a timeout resolves to `failed` (the row is failed, the caller sees `failed`); the `stripe.collect_timeout` error is not thrown out of `collect` (that would leave the caller without a `PaymentResult`). So change the timeout branch to `return { captured: false }` (after cancelling), and drop the throw. Keep the `stripe.collect_timeout` error code available for a future incident but do not throw it from `collect`. Implement accordingly:

```ts
    await this.opts.client.cancelReaderAction(readerId).catch(() => {});
    return { captured: false };
```

(Remove the `AppError`/`stripe.collect_timeout` throw from `drive`. The error code stays declared for later incident use; if leaving an unused import/code trips lint, keep `errors.ts`'s declaration but do not import `AppError` in `provider.ts`.)

- [ ] **Step 4: Export the provider** — update `packages/payments-stripe/src/index.ts`:

```ts
import "./errors.js";
export { toMinorUnits } from "./client.js";
export type { StripeClient } from "./client.js";
export { stripeClient } from "./stripe-client.js";
export { StripeTerminalProvider } from "./provider.js";
export type { StripeTerminalProviderOptions } from "./provider.js";
```

- [ ] **Step 5: Run the collect tests — expect PASS**

Run: `pnpm --filter @waitron/payments-stripe exec vitest run src/provider.test.ts`
Expected: PASS (capture, decline, timeout).

- [ ] **Step 6: Write the wiring capstone** — create `packages/payments-stripe/src/wiring.test.ts`, mirroring `packages/payments/src/wiring.test.ts` but driving `StripeTerminalProvider.collect` (with `FakeStripe`) then `recordSale` (`FakeFiscalBackend`) then `associatePaymentWithSale`, asserting the payment row carries `provider='stripe'`, `state='captured'`, `sale_id`, and a `pi_` `external_ref`. Reuse `seedForSale`/`FakeFiscalBackend` via the deep imports (`@waitron/payments/test/seed.js`, `@waitron/fiscal/src/testing/fake-backend.js`). Full `buildInput`/`steadyClock` reproduced locally (house convention). Assert the same atomic-association shape as `payments/src/wiring.test.ts`'s first test.

- [ ] **Step 7: Run wiring — expect PASS**, then commit.

```bash
git -C /Users/clintongormley/workspace/worktrees/waitron-payment-mode-2a-stripe add \
  packages/payments-stripe/src/provider.ts packages/payments-stripe/src/provider.test.ts \
  packages/payments-stripe/src/wiring.test.ts packages/payments-stripe/src/index.ts
git -C /Users/clintongormley/workspace/worktrees/waitron-payment-mode-2a-stripe commit -m "feat(payments-stripe): StripeTerminalProvider.collect (poll-to-completion, T1/T2) + wiring"
```

---

### Task 6: `StripeTerminalProvider` reversals (void / refund / partialRefund)

**Files:**
- Modify: `packages/payments-stripe/src/provider.ts` (add the three methods), `packages/payments-stripe/src/provider.test.ts` (reversal cases)

**Interfaces:**
- Consumes: `findPaymentByRef`, `recordVoid`, `recordRefund`, `recordFailedRefund` (`@waitron/payments`), the client's `refund`.
- Produces: `void(ref)`, `refund(ref)`, `partialRefund(ref, amount)` on `StripeTerminalProvider`.

- [ ] **Step 1: Write failing reversal tests** — add to `packages/payments-stripe/src/provider.test.ts`. Each collects (capture) first, then reverses. A refused Stripe refund records a failed refund and leaves the payment captured.

```ts
describe("StripeTerminalProvider reversals", () => {
  it("refund: full refund via Stripe -> state refunded", async () => {
    const fake = new FakeStripe();
    const provider = providerFor(fake);
    const paid = await provider.collect(await collectParams());
    const refunded = await provider.refund(paid.paymentRef);
    expect(refunded.state).toBe("refunded");
  });

  it("partialRefund: reports the refunded amount and sets partially_refunded", async () => {
    const fake = new FakeStripe();
    const provider = providerFor(fake);
    const p = await collectParams(); // amount 12.10
    const paid = await provider.collect(p);
    const refunded = await provider.partialRefund(paid.paymentRef, decimal("5.00"));
    expect(refunded.amount).toBe(decimal("5.00"));
    expect(refunded.state).toBe("partially_refunded");
  });

  it("void: reverses a captured payment to voided", async () => {
    const fake = new FakeStripe();
    const provider = providerFor(fake);
    const paid = await provider.collect(await collectParams());
    const voided = await provider.void(paid.paymentRef);
    expect(voided.state).toBe("voided");
  });

  it("a Stripe refund refusal records a failed refund and leaves the payment captured", async () => {
    const fake = new FakeStripe();
    const provider = providerFor(fake);
    const paid = await provider.collect(await collectParams());
    fake.refundFailsNext();
    const result = await provider.refund(paid.paymentRef);
    expect(result.state).toBe("captured"); // unchanged — nothing was returned
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (methods absent). Then implement.

- [ ] **Step 3: Implement the reversals** in `packages/payments-stripe/src/provider.ts`. Add the imports (`findPaymentByRef`, `recordVoid`, `recordRefund`, `recordFailedRefund`, and `decimal`/`Decimal`) and the methods:

```ts
  async void(ref: string): Promise<PaymentResult> {
    return this.reverse(ref, "void");
  }
  async refund(ref: string): Promise<PaymentResult> {
    return this.reverse(ref, "refund");
  }
  async partialRefund(ref: string, amount: Decimal): Promise<PaymentResult> {
    return this.reverse(ref, "refund", amount);
  }

  private async reverse(ref: string, kind: "void" | "refund", amount?: Decimal): Promise<PaymentResult> {
    // Untenanted lookup — the interface method carries only a ref. Works under the hermetic
    // (superuser) suite and a tenanted caller; the untenanted webhook case is deferred (design §Mode 2a).
    const found = await this.opts.db.transaction((tx) => findPaymentByRef(tx, PROVIDER, ref));
    if (found === undefined) {
      throw new AppError("payment.not_found", { provider: PROVIDER, paymentRef: ref });
    }
    if (found.externalRef === null) {
      throw new AppError("payment.not_found", { provider: PROVIDER, paymentRef: ref });
    }
    const key = { tenantId: found.tenantId, provider: PROVIDER, paymentRef: ref };

    const outcome = await this.opts.client.refund({
      paymentIntentId: found.externalRef,
      ...(amount ? { amount } : {}),
      idempotencyKey: `${ref}:refund:${amount ?? "full"}`,
    });

    if (outcome.status === "failed") {
      await this.opts.db.transaction((tx) =>
        recordFailedRefund(tx, { ...key, amount: amount ?? decimal(found.amount) }),
      );
      return { provider: PROVIDER, paymentRef: ref, state: found.state, amount: decimal(found.amount), settledAt: null };
    }

    const row = await this.opts.db.transaction((tx) =>
      kind === "void"
        ? recordVoid(tx, key)
        : recordRefund(tx, { ...key, amount: amount ?? decimal(found.amount) }),
    );
    return {
      provider: PROVIDER,
      paymentRef: ref,
      state: row.state,
      amount: amount ?? decimal(row.amount), // partialRefund reports the refunded amount
      settledAt: null,
    };
  }
```

(Re-add `import { AppError, decimal } from "@waitron/shared"` — `AppError` is used here.)

- [ ] **Step 4: Run reversals — expect PASS**

Run: `pnpm --filter @waitron/payments-stripe exec vitest run src/provider.test.ts`
Expected: PASS (collect + reversal cases).

- [ ] **Step 5: Commit**

```bash
git -C /Users/clintongormley/workspace/worktrees/waitron-payment-mode-2a-stripe add \
  packages/payments-stripe/src/provider.ts packages/payments-stripe/src/provider.test.ts
git -C /Users/clintongormley/workspace/worktrees/waitron-payment-mode-2a-stripe commit -m "feat(payments-stripe): void/refund/partialRefund via stripe.refunds (+ failed-refund path)"
```

---

### Task 7: Real-Postgres RLS test for the adapter

Proves `collect` persists under a real non-superuser RLS role (what PGlite can't show). Mirrors `packages/payments/src/payments.rls.test.ts`.

**Files:**
- Create: `packages/payments-stripe/src/testing/postgres.ts` (copy `packages/payments/src/testing/postgres.ts` verbatim — same Testcontainers harness, both migration sets), `packages/payments-stripe/src/stripe.rls.test.ts`

- [ ] **Step 1:** Copy `packages/payments/src/testing/postgres.ts` to `packages/payments-stripe/src/testing/postgres.ts` unchanged (it runs `CORE_MIGRATIONS` + `PAYMENTS_MIGRATIONS`; the adapter owns no schema, so no extra set).

- [ ] **Step 2: Write the RLS test** — create `packages/payments-stripe/src/stripe.rls.test.ts`. As the `rls_probe` non-superuser role (member of `app_user`), scoped to tenant A via `withTenant`, run a `StripeTerminalProvider` whose `db` is the probe connection and assert `collect` writes a `captured` row visible under tenant A and hidden under tenant B. Construct the provider per-call with the probe `Database`:

```ts
// ...beforeAll starts real PG, creates rls_probe (member of app_user), seeds tenants A/B as admin.
it("collect persists a captured payment under a real RLS role, tenant-isolated", async () => {
  const tenantA = await seedWorkingOrder(admin, "B11111111");
  const probe = await pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
  try {
    const paid = await withTenant(probe, tenantA.tenantId, (tx) => {
      // collect does its own transactions; run the provider against a tenant-scoped db instead.
      // Simpler: build the provider with `db: probe` and call collect inside a withTenant wrapper is
      // not possible (collect opens its own tx). So assert via the store directly under the probe:
      return Promise.resolve(tx); // placeholder — see note
    });
    // Preferred shape: construct StripeTerminalProvider({ client: fake, db: <tenant-scoped handle>, ... }).
  } finally {
    await probe.close();
  }
});
```

**Implementation note (resolve during TDD):** `collect` opens its own `this.db.transaction`, so RLS needs `app.tenant_id` set on those transactions. Provide a **tenant-scoped `Database`** to the provider — either a thin wrapper whose `.transaction()` runs `set local app.tenant_id` first, or (simplest, matching the repo) assert the RLS behaviour at the **store** layer under the probe: `withTenant(probe, tenantA, tx => insertAttempting(...))` then `captureAttempting`, then read back under A (visible) and B (hidden). Prefer the store-level RLS assertion here (it proves the same policy the adapter relies on) and keep the adapter's collect flow covered by the hermetic suite. Write the test to insert an attempting row + capture it under the probe/withTenant, then assert visibility under A and invisibility under B — structurally identical to `packages/payments/src/payments.rls.test.ts`, but exercising `insertAttempting`+`captureAttempting`.

- [ ] **Step 3: Run — expect PASS** (Docker required)

Run: `pnpm --filter @waitron/payments-stripe exec vitest run src/stripe.rls.test.ts`
Expected: PASS.

- [ ] **Step 4: Full package coverage run — expect PASS at threshold**

Run: `pnpm --filter @waitron/payments-stripe test:coverage`
Expected: PASS, ≥98/95. `stripe-client.ts` excluded; everything else covered. If `provider.ts` branch coverage dips, ensure the decline, timeout, network-error, and refund-failure branches are all exercised (they are, across Tasks 5–6).

- [ ] **Step 5: Commit**

```bash
git -C /Users/clintongormley/workspace/worktrees/waitron-payment-mode-2a-stripe add packages/payments-stripe/src/testing/postgres.ts packages/payments-stripe/src/stripe.rls.test.ts
git -C /Users/clintongormley/workspace/worktrees/waitron-payment-mode-2a-stripe commit -m "test(payments-stripe): real-PG RLS test for the attempting/capture lifecycle"
```

---

### Task 8: Nightly Stripe sandbox suite + GitHub Action

The env-gated real-Stripe-test-mode suite and the nightly workflow that runs it.

**Files:**
- Create: `packages/payments-stripe/vitest.sandbox.config.ts`, `packages/payments-stripe/src/collect.sandbox.test.ts`, `.github/workflows/stripe-sandbox.yml`

- [ ] **Step 1: Sandbox vitest config** — create `packages/payments-stripe/vitest.sandbox.config.ts` that includes ONLY `**/*.sandbox.test.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.sandbox.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
```

- [ ] **Step 2: Sandbox test (self-skipping without a key)** — create `packages/payments-stripe/src/collect.sandbox.test.ts`. It builds a real `stripeClient(new Stripe(key))`, registers a **simulated** reader, and drives a real test-mode `collect` via `stripe.testHelpers.terminal.readers.presentPaymentMethod`. It **skips deliberately** when `STRIPE_SECRET_KEY` is unset (a nightly-only suite, not the "never skip" RLS rule):

```ts
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations } from "@waitron/db";
import type { Database } from "@waitron/db";
import { decimal, tenantId as brandTenantId, tillId as brandTillId, workingOrderId as brandWorkingOrderId } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "@waitron/payments";
import { stripeClient } from "./stripe-client.js";
import { StripeTerminalProvider } from "./provider.js";
import { freshNif, seedWorkingOrder } from "@waitron/payments/test/seed.js";

const KEY = process.env.STRIPE_SECRET_KEY;
const d = KEY ? describe : describe.skip; // nightly only — deliberate skip when unconfigured

d("Stripe test-mode sandbox: collect against a simulated reader", () => {
  let db: Database;
  let stripe: Stripe;
  let readerId: string;

  beforeAll(async () => {
    db = await createPgliteDb();
    await runMigrations(db, CORE_MIGRATIONS);
    await runMigrations(db, PAYMENTS_MIGRATIONS);
    stripe = new Stripe(KEY!);
    const location = await stripe.terminal.locations.create({
      display_name: "Waitron CI", address: { line1: "1 Test St", city: "Madrid", country: "ES", postal_code: "28001" },
    });
    const reader = await stripe.terminal.readers.create({ registration_code: "simulated-wpe", location: location.id });
    readerId = reader.id;
  }, 120_000);
  afterAll(async () => { await db.close(); });

  it("drives a real test-mode PaymentIntent to captured", async () => {
    const s = await seedWorkingOrder(db, freshNif());
    const provider = new StripeTerminalProvider({
      client: stripeClient(stripe), db, resolveReader: () => Promise.resolve(readerId),
      poll: { maxAttempts: 40, intervalMs: 500 },
    });
    // Kick collect, then present a test card on the simulated reader so the action resolves.
    const collecting = provider.collect({
      tenantId: brandTenantId(s.tenantId), tillId: brandTillId(s.tillId),
      workingOrderId: brandWorkingOrderId(s.workingOrderId), amount: decimal("12.10"),
    });
    // small delay so processPaymentIntent has been issued before we present the card
    await new Promise((r) => setTimeout(r, 1500));
    await stripe.testHelpers.terminal.readers.presentPaymentMethod(readerId);
    const result = await collecting;
    expect(result.state).toBe("captured");
    expect(result.settledAt).not.toBeNull();
  });
});
```

(Exact `testHelpers`/simulated-reader calls may need small tweaks against the installed `stripe@22` types — the implementer adjusts to the SDK and confirms the sandbox test passes locally with a `STRIPE_SECRET_KEY` test key if one is available; otherwise it is verified structurally + by the nightly job. Do NOT commit any key.)

- [ ] **Step 3: Verify the sandbox suite SKIPS cleanly without a key**

Run: `pnpm --filter @waitron/payments-stripe test:sandbox`
Expected: PASS with the suite skipped (no `STRIPE_SECRET_KEY`), and it is NOT picked up by the normal `pnpm --filter @waitron/payments-stripe test` run (excluded via `*.sandbox.test.ts`). Confirm the normal run still passes and doesn't execute it.

- [ ] **Step 4: Nightly workflow** — create `.github/workflows/stripe-sandbox.yml`:

```yaml
name: stripe-sandbox
on:
  schedule:
    - cron: "0 4 * * *" # nightly, 04:00 UTC
  workflow_dispatch:

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  stripe-sandbox:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v6
        with:
          version: 9.15.0
      - uses: actions/setup-node@v5
        with:
          node-version-file: ".nvmrc"
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @waitron/payments-stripe test:sandbox
        env:
          STRIPE_SECRET_KEY: ${{ secrets.STRIPE_SANDBOX_SECRET_KEY }}
```

(Note in the PR description that the repo owner must add the `STRIPE_SANDBOX_SECRET_KEY` repository secret — a Stripe **test-mode** key — for the nightly job to actually run rather than skip.)

- [ ] **Step 5: Lint the workflow shape + commit**

Run: `pnpm --filter @waitron/payments-stripe typecheck && pnpm --filter @waitron/payments-stripe lint`
Expected: PASS.

```bash
git -C /Users/clintongormley/workspace/worktrees/waitron-payment-mode-2a-stripe add \
  packages/payments-stripe/vitest.sandbox.config.ts packages/payments-stripe/src/collect.sandbox.test.ts \
  .github/workflows/stripe-sandbox.yml
git -C /Users/clintongormley/workspace/worktrees/waitron-payment-mode-2a-stripe commit -m "test(payments-stripe): nightly Stripe test-mode sandbox suite + workflow"
```

---

### Task 9: Full-suite verification

**Files:** none.

> **Dated note, 2026-08-01.** Step 3 below no longer finds its suite: `english-only.test.ts` moved
> to `scripts/english-only.test.ts`, the repo-level Vitest project. Run on 2026-08-01,
> `pnpm --filter @waitron/db exec vitest run src/english-only.test.ts` exits 1 with
> `No test files found`. Today's equivalent is `pnpm vitest run scripts/english-only.test.ts` from
> the repository root, which also runs on every push that is not documentation-only. Steps 4 and 5
> are unaffected — `vocabulary-scope.test.ts` is still in `packages/fiscal-verifactu`, and the
> module under test, `packages/db/src/english-only.ts`, did not move.

- [ ] **Step 1:** `pnpm --filter @waitron/payments test:coverage` — Expected: PASS ≥98/95 (the neutral changes).
- [ ] **Step 2:** `pnpm --filter @waitron/payments-stripe test:coverage` — Expected: PASS ≥98/95.
- [ ] **Step 3:** `pnpm --filter @waitron/db exec vitest run src/english-only.test.ts` — Expected: PASS (proves no Spanish leaked into `@waitron/payments`, and that NOT adding `payments-stripe` to any list didn't break the pinned assertions).
- [ ] **Step 4:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/vocabulary-scope.test.ts` — Expected: PASS (the EXEMPT/GENERIC pins are untouched).
- [ ] **Step 5:** `pnpm -r test` — Expected: PASS across all packages (the pre-push gate; new package included).
- [ ] **Step 6:** `pnpm -r typecheck && pnpm lint && pnpm format:check` — Expected: all PASS.

---

## Self-Review

**1. Spec coverage** (Mode 2a design section):
- `packages/payments-stripe` EXEMPT-less, injected `StripeClient` + `FakeStripe`, config-agnostic → Task 4. ✓
- `collect` poll-to-completion, T1/T2, `payment_ref`=uuid, PI id in `external_ref` → Tasks 1 (helpers) + 5. ✓
- Transient neutral `attempting` via `ALTER TYPE` → Task 1. ✓
- Reversals via `stripe.refunds`, tenanted lookup, failed-refund path, `PaymentResult.amount` for partial → Tasks 2 + 6. ✓
- `recordRefund` `state='succeeded'` filter → Task 2. ✓
- Real-PG reversal-concurrency test → Task 3. ✓
- `FakeStripe` hermetic suite + real-PG RLS → Tasks 4–7. ✓
- Nightly env-gated sandbox suite + GH Action → Task 8. ✓
- Deferred (NOT built): webhooks, untenanted tenant-resolution + `(provider, external_ref)` index, capture-mode config. ✓

**2. Placeholder scan:** The only intentionally-open spots are flagged as "implementer adjusts to the installed `stripe@22` types" (the real SDK wrapper + sandbox test — coverage-excluded, nightly) and the RLS-test shape note (Task 7 Step 2, with a concrete preferred resolution). All hermetic-path code (Tasks 1–6) is complete. No `TBD`/"add error handling".

**3. Type consistency:** `StripeClient` shapes are identical across `client.ts` (interface), `stripe-client.ts` (real), `fake-stripe.ts` (fake), and the provider's calls. `captureAttempting(Key & { settledAt: Date; externalRef: string })` matches the provider's `collect` call. `PaymentRow.externalRef` (Task 2) is read by the provider's `reverse` (Task 6). `toMinorUnits(Decimal): number` used identically in `stripe-client.ts`. `provider = "stripe"` is the single `PROVIDER` constant.

**4. Guards/scope:** `payments-stripe` added to NEITHER classification list (verified — no completeness guard; adding would break two pinned tests). `no-provider-vocabulary` (payments-only) unaffected. `attempting` is the sole neutral vendor-neutral addition. `stripe-client.ts` coverage-excluded (real-SDK boundary). Sandbox suite excluded from the normal run + self-skips without a key.
