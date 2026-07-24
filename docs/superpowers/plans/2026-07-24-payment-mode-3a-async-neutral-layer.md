# Payment Mode 3 — Slice A: the provider-neutral async layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and prove — with a fake and real Postgres — the provider-neutral *asynchronous / hosted* payment layer in `@waitron/payments`: the `AsyncPaymentProvider` interface, the `initiated` lifecycle state, the webhook→settle→associate store path, the untenanted `(provider, external_ref)` tenant resolver, and idempotency.

**Architecture:** Mode 3 settles out-of-band: `initiate()` mints a hosted payment and writes an `initiated` `payments` row (`external_ref` = the hosted-payment id); a later inbound webhook advances that row to `captured` and the app-level orchestrator chains `recordSale`. This slice ships the *neutral* half only — no vendor SDK, no HTTP endpoint. The vendor binding (Stripe Checkout) is Slice B; the webhook HTTP endpoint + signing-secret provisioning + `reconcile()` are deferred (see the Mode 3 design section of the umbrella spec). The neutral package stays **core-free** (`@waitron/core` is a devDependency, for the capstone wiring test only) and **vendor-vocabulary-free**.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), drizzle-orm 0.45 + drizzle-kit (PostgreSQL dialect), PostgreSQL 18, PGlite (WASM Postgres) + Testcontainers for real-PG tests, Vitest.

## Global Constraints

Every task's requirements implicitly include this section. Values copied verbatim from the umbrella spec (`docs/superpowers/specs/2026-07-22-payment-layer-design.md`, Mode 3 section) and the payment-layer conventions.

- **Neutral vocabulary:** no `stripe`/`adyen`/`sumup`/`paymentintent`/`readerid`/`reader`/`terminal`/`connectiontoken`/`acquirer` in any real identifier in `@waitron/payments` (comments are stripped before the scan). Enforced by `src/no-provider-vocabulary.test.ts`. `webhook`/`hosted`/`session`/`checkout`/`async`/`initiate` are all fine.
- **Core-free runtime:** `@waitron/payments` runtime `dependencies` stay `@waitron/db`, `@waitron/shared`, `drizzle-orm`. `@waitron/core` and `@waitron/fiscal` are **devDependencies** (test-only), already present.
- **Money columns:** `numeric(12, 2)`, exact decimal via `@waitron/shared`'s `Decimal`/`decimal()`. No float ever touches the money path. Amounts are the tenant's single currency (no currency column).
- **Errors are structured codes+params**, never English prose (the UI localises). New codes go through `src/errors.ts` (the `declare module "@waitron/shared"` augmentation) and must stay reachable from the barrel.
- **RLS:** every table `FORCE ROW LEVEL SECURITY`, tenant-scoped on `current_tenant_id()` (reads `app.tenant_id`). Non-superuser role behaviour is only provable on **real Postgres** (PGlite connects as superuser and bypasses RLS) — the `startRealPostgres` harness in `src/testing/postgres.ts` exists for exactly this and must **never** degrade to a skip.
- **Migrations:** drizzle migrations live in `packages/payments/drizzle/`. Anything drizzle-kit cannot model (roles, policies, `SECURITY DEFINER`, ownership, partial/predicate indexes) is a **hand-written `--custom`** migration, so a later `generate` never diffs or drops it. Generate via the `exec` form to avoid the `--` pnpm leak: `pnpm --filter @waitron/payments exec drizzle-kit generate [--custom] --name <name>`.
- **Coverage (CI only, not the pre-push hook):** 98% statements / 98% lines / 98% functions / 95% branches, single-fork. `src/testing/**`, `src/index.ts`, `src/schema/index.ts`, `src/manual.ts`, `drizzle/**` are excluded. Run `pnpm --filter @waitron/payments test:coverage` locally before pushing (Task 6 owns the run).
- **Every new drizzle table needs a `getTableConfig` test** (lazy extraConfig). This slice adds **no new table** (only an enum value, a hand-written index, a hand-written function) — so no new `getTableConfig` block is required; the index and function are proven behaviourally instead.
- **`format:check` (prettier) is a separate gate from `lint` (eslint).** Run `pnpm format:check` (or `prettier --write`) before pushing.

---

## File Structure

**Modified:**
- `packages/payments/src/provider.ts` — add `"initiated"` to `PaymentState`; add the `AsyncPaymentProvider` interface + `InitiateParams`, `InitiateResult`, `InboundSettlement` types (co-located with `PaymentProvider`; the file already carries the `import "./errors.js"` side-effect so it stays in coverage — no new pure-types file, no new coverage exclusion).
- `packages/payments/src/schema/payments.ts` — add `"initiated"` to the `paymentState` pgEnum.
- `packages/payments/src/store.ts` — add `insertInitiated`, `settleInitiated`, `expireInitiated`, `resolvePaymentTenant`, and the `SettledInitiated` type; widen the `@waitron/db` type import to include `Database`.
- `packages/payments/src/index.ts` — re-export the new interface/types from `./provider.js` and the new store functions from `./store.js`.
- `packages/payments/src/index.test.ts` — assert the new barrel re-exports.
- `packages/payments/src/store.test.ts` — tests for the new store functions + the partial-unique-index behaviour.

**Created:**
- `packages/payments/drizzle/0006_payment_initiated_state.sql` — generated: `ALTER TYPE payment_state ADD VALUE 'initiated'`.
- `packages/payments/drizzle/0007_payments_async_ref_unique.sql` — custom: the partial unique index on `(provider, external_ref)`.
- `packages/payments/drizzle/0008_payments_webhook_resolver.sql` — custom: the untenanted resolver seam (role + permissive policy + `SECURITY DEFINER` function).
- `packages/payments/src/testing/fake-async-provider.ts` — `FakeAsyncProvider` (coverage-excluded, not barrel-exported).
- `packages/payments/src/testing/fake-async-provider.test.ts` — its unit test.
- `packages/payments/src/async.wiring.test.ts` — the capstone orchestrator wiring test (PGlite).
- `packages/payments/src/async-settle.concurrency.test.ts` — the two-delivery idempotency race (real-PG).

---

## Task 1: The `initiated` state + the `AsyncPaymentProvider` interface & types

**Files:**
- Modify: `packages/payments/src/provider.ts`
- Modify: `packages/payments/src/schema/payments.ts:26-38` (the `paymentState` pgEnum)
- Modify: `packages/payments/src/index.ts`
- Modify: `packages/payments/src/index.test.ts`
- Create (generated): `packages/payments/drizzle/0006_payment_initiated_state.sql`

**Interfaces:**
- Produces (consumed by Tasks 2–6):
  ```ts
  export type PaymentState = /* … existing … */ | "initiated";
  export interface InitiateParams {
    tenantId: TenantId;
    workingOrderId: WorkingOrderId;
    amount: Decimal;
    paymentRef: string;
  }
  export interface InitiateResult { ref: string; externalRef: string; url: string; }
  export interface InboundSettlement {
    provider: string;
    externalRef: string;
    outcome: "settled" | "expired";
    amount: Decimal;
    settledAt: Date;
  }
  export interface AsyncPaymentProvider {
    readonly provider: string;
    initiate(params: InitiateParams): Promise<InitiateResult>;
    verifyAndParse(payload: string, signature: string): InboundSettlement | null;
  }
  ```

- [ ] **Step 1: Write the failing barrel re-export test**

Add to `packages/payments/src/index.test.ts`, inside the first `describe("package public surface (./index.js)")` block, a new `it`:

```ts
it("re-exports the async (Mode 3) provider types from the package root", () => {
  // Type-only exports: the meaningful check is that ./index.ts's re-export type-checks against a
  // real value shaped by ./provider.ts — a deleted re-export fails this package's `pnpm typecheck`,
  // and the annotations force that check against the ROOT barrel, not a deep path.
  const settlement: InboundSettlement = {
    provider: "fake",
    externalRef: "hosted-1",
    outcome: "settled",
    amount: decimal("12.10"),
    settledAt: new Date("2026-07-24T10:00:00Z"),
  };
  const result: InitiateResult = { ref: "pay-1", externalRef: "hosted-1", url: "https://pay/hosted-1" };
  const params: InitiateParams = {
    tenantId: "t",
    workingOrderId: "w",
    amount: decimal("12.10"),
    paymentRef: "pay-1",
  };
  const asyncProvider: AsyncPaymentProvider["provider"] = "fake";
  expect(settlement.outcome).toBe("settled");
  expect(result.externalRef).toBe("hosted-1");
  expect(params.paymentRef).toBe("pay-1");
  expect(asyncProvider).toBe("fake");
});
```

And extend the existing type-import block at the top of the file:

```ts
import type {
  AsyncPaymentProvider,
  InboundSettlement,
  InitiateParams,
  InitiateResult,
  ManualCardPaymentParams,
  ManualCardPaymentResult,
  PaymentProvider,
  PaymentResult,
} from "./index.js";
```

- [ ] **Step 2: Run typecheck to verify it fails**

Run: `pnpm --filter @waitron/payments typecheck`
Expected: FAIL — `Module '"./index.js"' has no exported member 'AsyncPaymentProvider'` (and the sibling type names).

- [ ] **Step 3: Add the `initiated` state + async types to `provider.ts`**

In `packages/payments/src/provider.ts`, add `"initiated"` to the `PaymentState` union (append after `"declined"`), and update the type's doc comment to name it:

```ts
export type PaymentState =
  | "attempting"
  | "captured"
  | "voided"
  | "refunded"
  | "partially_refunded"
  | "failed"
  | "accepted_offline"
  | "settled"
  | "declined"
  // Mode 3 (async / hosted): the minted-but-unpaid hosted payment. initiate() writes it; the
  // inbound settlement advances it to `captured` (paid) or `failed` (abandoned / expired).
  | "initiated";
```

Then append the async interface + types at the end of the file (after `PaymentProvider`):

```ts
/**
 * Parameters to mint one hosted payment for an OPEN working order. `paymentRef` is the caller's
 * `(tenant_id, provider, payment_ref)` idempotency anchor (a uuid), so a retried initiate cannot
 * double-insert. Amount is the tenant's single currency.
 */
export interface InitiateParams {
  tenantId: TenantId;
  workingOrderId: WorkingOrderId;
  amount: Decimal;
  paymentRef: string;
}

/**
 * What `initiate` returns: `ref` echoes the caller's `paymentRef`; `externalRef` is the
 * hosted-payment id (the ONLY identifier the later inbound webhook carries, and therefore the
 * resolve/settle key); `url` is the hosted payment page — presentation-agnostic, rendered as a QR
 * at the table or sent as a link by the app, never distinguished here.
 */
export interface InitiateResult {
  ref: string;
  externalRef: string;
  url: string;
}

/**
 * A VERIFIED, parsed inbound settlement event, neutral of any vendor's wire shape. `outcome` is
 * `settled` (the customer paid — advance to `captured`) or `expired` (abandoned / timed out —
 * advance to `failed`). `amount` is what actually settled (the drift anchor reconcile uses later).
 */
export interface InboundSettlement {
  provider: string;
  externalRef: string;
  outcome: "settled" | "expired";
  amount: Decimal;
  settledAt: Date;
}

/**
 * The asynchronous / hosted settlement contract (§0's Mode 3) — a DIFFERENT method shape from
 * `PaymentProvider`, never new methods on it (a required `initiate` would break every synchronous
 * adapter). An adapter may implement `PaymentProvider`, this, or both. No method takes a caller
 * transaction: `initiate` does its own short-transaction bookkeeping around a network call (T1/T2,
 * like `collect`), and `verifyAndParse` is a pure verify+decode of a raw inbound event.
 */
export interface AsyncPaymentProvider {
  readonly provider: string;

  /** Mint a hosted payment and write an `initiated` `payments` row (external_ref = hosted id). */
  initiate(params: InitiateParams): Promise<InitiateResult>;

  /** Verify (signature) + parse a raw inbound event into a neutral settlement. `null` = an event
   * we do not act on; throws on a bad signature. */
  verifyAndParse(payload: string, signature: string): InboundSettlement | null;
}
```

- [ ] **Step 4: Re-export the async types from the barrel**

In `packages/payments/src/index.ts`, add the four names to the type re-export from `./provider.js`:

```ts
export type {
  AsyncPaymentProvider,
  CollectParams,
  ForwardResult,
  InboundSettlement,
  InitiateParams,
  InitiateResult,
  PaymentProvider,
  PaymentResult,
  PaymentResultState,
  PaymentState,
  ProviderCapabilities,
} from "./provider.js";
```

- [ ] **Step 5: Add `"initiated"` to the schema pgEnum**

In `packages/payments/src/schema/payments.ts`, add `"initiated"` to the `paymentState` array (append after `"declined"`) and extend its doc comment to mention Mode 3:

```ts
export const paymentState = pgEnum("payment_state", [
  "attempting",
  "captured",
  "voided",
  "refunded",
  "partially_refunded",
  "failed",
  "accepted_offline",
  "settled",
  "declined",
  // Mode 3 (async / hosted): the minted-but-unpaid hosted payment. Mirrors `PaymentState`.
  "initiated",
]);
```

- [ ] **Step 6: Run typecheck to verify it passes**

Run: `pnpm --filter @waitron/payments typecheck`
Expected: PASS.

- [ ] **Step 7: Generate the enum migration**

Run: `pnpm --filter @waitron/payments exec drizzle-kit generate --name payment_initiated_state`
Expected: creates `packages/payments/drizzle/0006_payment_initiated_state.sql` containing exactly:

```sql
ALTER TYPE "public"."payment_state" ADD VALUE 'initiated';
```

and appends an `idx: 6` entry to `packages/payments/drizzle/meta/_journal.json` plus a `0006_snapshot.json`. Open the `.sql` and confirm it is only the `ADD VALUE` line (no unexpected table diffs). If drizzle emits any other statement, discard and investigate — the only schema change is the enum value.

- [ ] **Step 8: Run the migration round-trip + full package test**

Run: `pnpm --filter @waitron/payments test`
Expected: PASS — `migrations.test.ts` applies `0006` cleanly (core-then-payments ordering), the new `index.test.ts` re-export test passes, and no existing test regresses.

- [ ] **Step 9: Format + commit**

```bash
pnpm --filter @waitron/payments exec prettier --write src/provider.ts src/schema/payments.ts src/index.ts src/index.test.ts
git add packages/payments/src/provider.ts packages/payments/src/schema/payments.ts \
  packages/payments/src/index.ts packages/payments/src/index.test.ts \
  packages/payments/drizzle/0006_payment_initiated_state.sql packages/payments/drizzle/meta/
git commit -m "feat(payments): Mode 3 — AsyncPaymentProvider interface + initiated state"
```

---

## Task 2: Store functions + the `(provider, external_ref)` partial unique index

**Files:**
- Modify: `packages/payments/src/store.ts`
- Modify: `packages/payments/src/index.ts`
- Modify: `packages/payments/src/store.test.ts`
- Create (custom): `packages/payments/drizzle/0007_payments_async_ref_unique.sql`

**Interfaces:**
- Consumes: `insertPayment` (private, in `store.ts`), `NewPayment` (private type), `payments` schema, `Transaction`/`Database` from `@waitron/db`.
- Produces (consumed by Tasks 4–6):
  ```ts
  export interface SettledInitiated { workingOrderId: string; amount: string; paymentRef: string; }
  export async function insertInitiated(tx: Transaction, params: NewPayment & { externalRef: string }): Promise<void>;
  export async function settleInitiated(tx: Transaction, params: { provider: string; externalRef: string; settledAt: Date }): Promise<SettledInitiated | null>;
  export async function expireInitiated(tx: Transaction, params: { provider: string; externalRef: string }): Promise<void>;
  ```
  (`resolvePaymentTenant` is Task 3.)

- [ ] **Step 1: Verify the partial-index predicate is safe against every `external_ref` writer (#25 lesson)**

Run: `grep -rn "externalRef\|external_ref" packages/payments/src --include=*.ts | grep -v test`
Confirm the only writers are: `insertPayment` (manual, via `recordManualCardPayment` → `provider = "manual"`, excluded by the predicate); `captureAttempting` (integrated capture → `external_ref` = a globally-unique processor reference, one row per reference); and the new `insertInitiated` (async → external_ref = a globally-unique hosted id). No two non-manual rows legitimately share a `(provider, external_ref)`. Record this in the commit message. (A table-wide unique here would collide on manual hand-keyed refs — the exact #25 finding.)

- [ ] **Step 2: Write the failing store tests**

Append to `packages/payments/src/store.test.ts`. First extend the imports from `./store.js` to add `expireInitiated, insertInitiated, settleInitiated`. Then add:

```ts
describe("Mode 3 initiated lifecycle", () => {
  const HOSTED = "hosted-abc";
  const SETTLED_AT = new Date("2026-07-24T12:00:00Z");

  async function initiate(seeded: Seeded, externalRef = HOSTED, paymentRef = "pay-1") {
    await db.transaction((tx) =>
      insertInitiated(tx, {
        tenantId: seeded.tenantId,
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef,
        externalRef,
        amount: decimal("12.10"),
      }),
    );
    return { tenantId: seeded.tenantId, provider: "fake", paymentRef };
  }

  it("insertInitiated writes state=initiated, settledAt null, external_ref set", async () => {
    const seeded = await seedTenant();
    const key = await initiate(seeded);
    const row = await getRow(key);
    expect(row?.state).toBe("initiated");
    expect(row?.settledAt).toBeNull();
    expect(row?.externalRef).toBe(HOSTED);
  });

  it("settleInitiated advances initiated -> captured, sets settledAt, and returns the row", async () => {
    const seeded = await seedTenant();
    const key = await initiate(seeded);
    const settled = await db.transaction((tx) =>
      settleInitiated(tx, { provider: "fake", externalRef: HOSTED, settledAt: SETTLED_AT }),
    );
    expect(settled).not.toBeNull();
    expect(settled?.workingOrderId).toBe(seeded.workingOrderId);
    expect(settled?.amount).toBe("12.10");
    expect(settled?.paymentRef).toBe("pay-1");
    const row = await getRow(key);
    expect(row?.state).toBe("captured");
    expect(row?.settledAt).not.toBeNull();
  });

  it("settleInitiated is idempotent: a second call returns null and does not re-settle", async () => {
    const seeded = await seedTenant();
    await initiate(seeded);
    await db.transaction((tx) =>
      settleInitiated(tx, { provider: "fake", externalRef: HOSTED, settledAt: SETTLED_AT }),
    );
    const second = await db.transaction((tx) =>
      settleInitiated(tx, { provider: "fake", externalRef: HOSTED, settledAt: new Date("2026-07-24T13:00:00Z") }),
    );
    expect(second).toBeNull();
  });

  it("expireInitiated advances initiated -> failed and is idempotent", async () => {
    const seeded = await seedTenant();
    const key = await initiate(seeded);
    await db.transaction((tx) => expireInitiated(tx, { provider: "fake", externalRef: HOSTED }));
    expect((await getRow(key))?.state).toBe("failed");
    // Second call is a no-op (state is no longer `initiated`) — does not throw, leaves `failed`.
    await db.transaction((tx) => expireInitiated(tx, { provider: "fake", externalRef: HOSTED }));
    expect((await getRow(key))?.state).toBe("failed");
  });

  it("the partial unique index rejects a second initiated row with the same (provider, external_ref)", async () => {
    const seeded = await seedTenant();
    await initiate(seeded, HOSTED, "pay-1");
    await expect(initiate(seeded, HOSTED, "pay-2")).rejects.toThrow(
      /payments_provider_external_ref_key|duplicate key/,
    );
  });

  it("the partial unique index does NOT constrain manual/null external_ref rows", async () => {
    const seeded = await seedTenant();
    // Two manual rows sharing a hand-keyed external_ref: allowed (provider = 'manual' is excluded).
    await db.transaction((tx) =>
      insertCapturedPayment(tx, {
        tenantId: seeded.tenantId,
        workingOrderId: seeded.workingOrderId,
        provider: "manual",
        paymentRef: "m-1",
        amount: decimal("5.00"),
        externalRef: "OP-777",
        settledAt: SETTLED,
      }),
    );
    await expect(
      db.transaction((tx) =>
        insertCapturedPayment(tx, {
          tenantId: seeded.tenantId,
          workingOrderId: seeded.workingOrderId,
          provider: "manual",
          paymentRef: "m-2",
          amount: decimal("6.00"),
          externalRef: "OP-777",
          settledAt: SETTLED,
        }),
      ),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @waitron/payments test store.test.ts`
Expected: FAIL — `insertInitiated`/`settleInitiated`/`expireInitiated` are not exported, and the partial-index tests fail (the index does not exist yet).

- [ ] **Step 4: Add the store functions**

In `packages/payments/src/store.ts`, widen the db type import:

```ts
import type { Database, Transaction } from "@waitron/db";
```

Append these functions (after `advanceAcceptedOffline`, before `keyWhere`):

```ts
/** The row `settleInitiated` returns when it advances a hosted payment, enough for the app-level
 * orchestrator to chain `recordSale`: the still-open working order, the captured amount, and the
 * payment_ref association key. */
export interface SettledInitiated {
  workingOrderId: string;
  amount: string;
  paymentRef: string;
}

/** Insert a minted-but-unpaid hosted payment — Mode 3's `initiate`. state=initiated, settledAt null,
 * external_ref = the hosted-payment id (required: it is the resolve/settle key the webhook carries).
 * The working order stays open until the inbound settlement advances this row. */
export async function insertInitiated(
  tx: Transaction,
  params: NewPayment & { externalRef: string },
): Promise<void> {
  await insertPayment(tx, params, "initiated", null);
}

/** Advance a hosted payment still `initiated` -> `captured`, setting `settled_at`. Keyed by
 * `(provider, external_ref)` — all the inbound webhook carries — under the caller's tenant scope
 * (RLS), guarded by `state = 'initiated'`. Returns the row when it advanced, `null` when it matched
 * nothing (already captured — an at-least-once redelivery). That row-or-null is the idempotency
 * signal the orchestrator branches on: it chains `recordSale` only on a non-null return, so no second
 * invoice number is ever allocated. Mirrors `settleForwarded`'s state-guarded, idempotent advance. */
export async function settleInitiated(
  tx: Transaction,
  params: { provider: string; externalRef: string; settledAt: Date },
): Promise<SettledInitiated | null> {
  const [row] = await tx
    .update(payments)
    .set({ state: "captured", settledAt: params.settledAt.toISOString(), updatedAt: sql`now()` })
    .where(
      and(
        eq(payments.provider, params.provider),
        eq(payments.externalRef, params.externalRef),
        eq(payments.state, "initiated"),
      ),
    )
    .returning({
      workingOrderId: payments.workingOrderId,
      amount: payments.amount,
      paymentRef: payments.paymentRef,
    });
  return row ?? null;
}

/** Advance a hosted payment still `initiated` -> `failed` (the customer abandoned / it expired).
 * State-guarded and idempotent, like `settleInitiated`; the working order stays open so staff can
 * take another tender. */
export async function expireInitiated(
  tx: Transaction,
  params: { provider: string; externalRef: string },
): Promise<void> {
  await tx
    .update(payments)
    .set({ state: "failed", updatedAt: sql`now()` })
    .where(
      and(
        eq(payments.provider, params.provider),
        eq(payments.externalRef, params.externalRef),
        eq(payments.state, "initiated"),
      ),
    );
}
```

- [ ] **Step 5: Re-export the new store functions from the barrel**

In `packages/payments/src/index.ts`, add `expireInitiated`, `insertInitiated`, `settleInitiated` to the value re-export from `./store.js` (keep alphabetical order), and add `SettledInitiated` to the `export type { … } from "./store.js"` line.

- [ ] **Step 6: Generate the custom partial-index migration and fill it in**

Run: `pnpm --filter @waitron/payments exec drizzle-kit generate --custom --name payments_async_ref_unique`
Expected: creates an empty `packages/payments/drizzle/0007_payments_async_ref_unique.sql`, a journal `idx: 7` entry, and a `0007_snapshot.json` (a byte-for-byte copy of 0006's — this migration adds no table/column). Replace the file's contents with:

```sql
-- Hand-written custom migration (drizzle-kit generate --custom): a PARTIAL unique index is not in
-- src/schema/payments.ts, so drizzle-kit's snapshot never diffs or drops it (same reason the RLS /
-- GRANT / resolver-seam migrations are hand-written). 0007_snapshot.json is a byte-for-byte copy of
-- 0006's — this migration adds no table or column.
--
-- Mode 3's (provider, external_ref) idempotency + untenanted-resolver anchor: for an integrated or
-- hosted tender external_ref holds the processor's globally-unique reference, so a redelivered
-- initiate/webhook cannot double-insert. PARTIAL and provider <> 'manual': a manual datáfono's
-- external_ref is a free-form hand-keyed operation number — neither unique nor always present — so
-- manual rows (and any null external_ref) are excluded. A table-wide unique here would collide on
-- those, the exact class of bug #25's whole-branch review caught.
CREATE UNIQUE INDEX "payments_provider_external_ref_key"
  ON "payments" ("provider", "external_ref")
  WHERE "external_ref" IS NOT NULL AND "provider" <> 'manual';
```

- [ ] **Step 7: Run the store tests to verify they pass**

Run: `pnpm --filter @waitron/payments test store.test.ts`
Expected: PASS — all six new tests, and the pre-existing store tests still green (the partial index does not disturb the existing `external_ref` insert tests, which use distinct refs).

- [ ] **Step 8: Run the full package test + typecheck**

Run: `pnpm --filter @waitron/payments test && pnpm --filter @waitron/payments typecheck`
Expected: PASS — confirms migration ordering (`migrations.test.ts`) and that no other suite regresses under the new index.

- [ ] **Step 9: Format + commit**

```bash
pnpm --filter @waitron/payments exec prettier --write src/store.ts src/index.ts src/store.test.ts
git add packages/payments/src/store.ts packages/payments/src/index.ts packages/payments/src/store.test.ts \
  packages/payments/drizzle/0007_payments_async_ref_unique.sql packages/payments/drizzle/meta/
git commit -m "feat(payments): Mode 3 — initiated store transitions + partial (provider, external_ref) unique index"
```

---

## Task 3: The untenanted tenant resolver (`SECURITY DEFINER` seam + wrapper + real-PG RLS test)

**Files:**
- Create (custom): `packages/payments/drizzle/0008_payments_webhook_resolver.sql`
- Modify: `packages/payments/src/store.ts`
- Modify: `packages/payments/src/index.ts`
- Create: (real-PG RLS test) add a `describe` to `packages/payments/src/payments.rls.test.ts`

**Interfaces:**
- Consumes: the `resolve_payment_tenant(text, text)` SQL function (this task's migration); `Database` from `@waitron/db`; `startRealPostgres` from `./testing/postgres.js`; `insertInitiated` (Task 2).
- Produces (consumed by Tasks 5–6):
  ```ts
  export async function resolvePaymentTenant(db: Database, provider: string, externalRef: string): Promise<string | null>;
  ```

- [ ] **Step 1: Write the failing real-PG RLS test**

Append to `packages/payments/src/payments.rls.test.ts` a new `describe` (it reuses the file's `pg`/`admin`/`PROBE_ROLE`/`PROBE_PASSWORD` from `beforeAll`). Extend the imports: add `resolvePaymentTenant` (and keep `insertCapturedPayment`) from `./store.js`, and `insertInitiated` from `./store.js`.

```ts
describe("the untenanted webhook resolver under real row-level security", () => {
  it("resolves (provider, external_ref) -> tenant_id across tenants, but leaks no wider row", async () => {
    const tenantA = await seedWorkingOrder(admin, "B33333333");
    const tenantB = await seedWorkingOrder(admin, "B44444444");

    // Seed one `initiated` hosted payment for each tenant, as the superuser (RLS bypassed for setup).
    await withTenant(admin, tenantA.tenantId, (tx) =>
      insertInitiated(tx, {
        tenantId: tenantA.tenantId,
        workingOrderId: tenantA.workingOrderId,
        provider: "fake",
        paymentRef: "pa",
        externalRef: "hosted-A",
        amount: decimal("10.00"),
      }),
    );
    await withTenant(admin, tenantB.tenantId, (tx) =>
      insertInitiated(tx, {
        tenantId: tenantB.tenantId,
        workingOrderId: tenantB.workingOrderId,
        provider: "fake",
        paymentRef: "pb",
        externalRef: "hosted-B",
        amount: decimal("20.00"),
      }),
    );

    const probe = await pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      // The resolver runs with NO tenant GUC set — the genuine webhook case. It must still return
      // tenant A's id for hosted-A, proving the SECURITY DEFINER function crosses tenants for this
      // one lookup even under a real RLS-subject role.
      const resolvedA = await resolvePaymentTenant(probe, "fake", "hosted-A");
      expect(resolvedA).toBe(tenantA.tenantId);
      const resolvedB = await resolvePaymentTenant(probe, "fake", "hosted-B");
      expect(resolvedB).toBe(tenantB.tenantId);

      // An unknown ref resolves to null (the missingLocal case the app acks + reconcile audits).
      expect(await resolvePaymentTenant(probe, "fake", "nope")).toBeNull();

      // The bypass is confined to the function: a PLAIN select by the same probe, with no tenant
      // GUC set, still sees nothing (the permissive policy is scoped TO payments_webhook_resolver,
      // not to app_user). This is what proves the resolver leaks only tenant_id, nothing wider.
      const direct = await probe.execute<{ tenant_id: string }>(
        sql`select tenant_id from payments where provider = 'fake' and external_ref = 'hosted-A'`,
      );
      expect(direct.rows).toHaveLength(0);
    } finally {
      await probe.close();
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @waitron/payments test payments.rls.test.ts`
Expected: FAIL — `resolvePaymentTenant` is not exported, and the `resolve_payment_tenant` function does not exist. (Requires a running Docker daemon; this suite throws rather than skips if Docker is absent — that is by design.)

- [ ] **Step 3: Generate the custom resolver migration and fill it in**

Run: `pnpm --filter @waitron/payments exec drizzle-kit generate --custom --name payments_webhook_resolver`
Expected: creates an empty `packages/payments/drizzle/0008_payments_webhook_resolver.sql`, a journal `idx: 8` entry, and a `0008_snapshot.json` (byte-for-byte copy of 0007's — no table/column change). Replace the file's contents with (mirrors fiscal `0004_envios_drainer_seam.sql` verbatim in mechanism):

```sql
-- Hand-written custom migration (drizzle-kit generate --custom): drizzle-kit models no roles,
-- policies, SECURITY DEFINER functions or ownership, so none of this survives a later `generate`.
-- Adds no table/column; 0008_snapshot.json is a byte-for-byte copy of 0007's.
--
-- WHAT THIS CLOSES. A Mode 3 inbound webhook has NO tenant context. `payments` carries FORCE ROW
-- LEVEL SECURITY and `payments_tenant_isolation` fails closed (current_tenant_id() is NULL with no
-- `app.tenant_id` GUC), so a lookup by (provider, external_ref) under the non-superuser app_user
-- role returns nothing. This builds a seam that lets ONE lookup — (provider, external_ref) ->
-- tenant_id — cross tenants, and nothing else, mirroring fiscal's envios_tenants_with_work
-- (fiscal 0004): a dedicated NOLOGIN role + a per-role permissive SELECT policy + a SECURITY DEFINER
-- function owned by that role, returning ONLY tenant_id.
--
-- Deliberately NOT "grant a role BYPASSRLS": granting BYPASSRLS requires the grantor to already hold
-- it, which the hardened migration role does not. A per-role permissive SELECT policy needs only
-- ordinary GRANT/CREATE POLICY on a table the migration role already owns.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'payments_webhook_resolver') THEN
    CREATE ROLE payments_webhook_resolver NOLOGIN NOSUPERUSER;
  ELSIF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'payments_webhook_resolver' AND rolcanlogin
  ) THEN
    RAISE EXCEPTION
      'payments_webhook_resolver already exists with LOGIN — refusing to reuse it, since anyone who can authenticate as it would read every tenant''s payments unfiltered';
  END IF;
END
$$;--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO payments_webhook_resolver;--> statement-breakpoint
GRANT SELECT ON "payments" TO payments_webhook_resolver;--> statement-breakpoint

-- Role-scoped bypass: visible only when the CURRENT role is payments_webhook_resolver, which nothing
-- but resolve_payment_tenant's SECURITY DEFINER context ever runs as. FOR SELECT only, and additive
-- to payments_tenant_isolation (Postgres ORs permissive policies: (tenant_id = current_tenant_id())
-- OR true = true), so every other role's isolation is unchanged.
CREATE POLICY "payments_webhook_resolver_lookup" ON "payments"
  FOR SELECT
  TO payments_webhook_resolver
  USING (true);--> statement-breakpoint

-- SECURITY DEFINER + fixed search_path: runs with the owner's (payments_webhook_resolver's)
-- privileges, so the SELECT sees rows through the role-scoped permissive policy regardless of
-- app.tenant_id. Returns ONLY tenant_id (uuid) — never a wider payments column.
CREATE FUNCTION resolve_payment_tenant(p_provider text, p_external_ref text)
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT tenant_id
  FROM payments
  WHERE provider = p_provider AND external_ref = p_external_ref
  LIMIT 1
$$;--> statement-breakpoint

-- Reassign ownership to the NOLOGIN role via the temporary-grant dance (0004/0005 document why it is
-- required even for a CREATEROLE-holding non-superuser migration role). Both grants are revoked
-- immediately, so no standing privilege from this bootstrap survives.
GRANT CREATE ON SCHEMA public TO payments_webhook_resolver;--> statement-breakpoint
GRANT payments_webhook_resolver TO CURRENT_USER WITH INHERIT FALSE;--> statement-breakpoint
ALTER FUNCTION resolve_payment_tenant(text, text) OWNER TO payments_webhook_resolver;--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM payments_webhook_resolver;--> statement-breakpoint
REVOKE payments_webhook_resolver FROM CURRENT_USER;--> statement-breakpoint

-- The application role calls the seam; the SECURITY DEFINER context does the crossing. EXECUTE is
-- named to app_user only; PUBLIC's default EXECUTE is revoked so no other role can invoke it.
REVOKE EXECUTE ON FUNCTION resolve_payment_tenant(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_payment_tenant(text, text) TO app_user;
```

- [ ] **Step 4: Add the `resolvePaymentTenant` wrapper**

In `packages/payments/src/store.ts`, append (after `expireInitiated`):

```ts
/** Resolve the tenant that owns a hosted payment from `(provider, external_ref)` alone — the ONLY
 * identifiers an inbound webhook carries, with NO tenant context. Calls the `resolve_payment_tenant`
 * SECURITY DEFINER seam, the single controlled RLS bypass (it returns only tenant_id). Runs on a
 * plain `db` handle, OUTSIDE any tenant scope — the app-level orchestrator calls this first, then
 * opens `withTenant(tenantId)` for the settle + `recordSale` + associate. Returns null for an unknown
 * reference (the missingLocal case reconcile audits per-tenant). Mirrors fiscal drain's
 * `tenantsWithWork` call over `envios_tenants_with_work`. */
export async function resolvePaymentTenant(
  db: Database,
  provider: string,
  externalRef: string,
): Promise<string | null> {
  const result = await db.execute<{ tenant_id: string | null }>(
    sql`select resolve_payment_tenant(${provider}, ${externalRef}) as tenant_id`,
  );
  return result.rows[0]?.tenant_id ?? null;
}
```

- [ ] **Step 5: Re-export `resolvePaymentTenant` from the barrel**

In `packages/payments/src/index.ts`, add `resolvePaymentTenant` to the value re-export from `./store.js` (alphabetical order).

- [ ] **Step 6: Run the real-PG RLS test to verify it passes**

Run: `pnpm --filter @waitron/payments test payments.rls.test.ts`
Expected: PASS — cross-tenant resolution works, an unknown ref → null, and the direct unscoped select still returns nothing. (Docker required.)

- [ ] **Step 7: Run the full package test + typecheck**

Run: `pnpm --filter @waitron/payments test && pnpm --filter @waitron/payments typecheck`
Expected: PASS — `migrations.test.ts` applies `0008` on PGlite too (the role/ownership/`SECURITY DEFINER` dance runs on PGlite exactly as fiscal's `0004` does in `drain.test.ts`).

- [ ] **Step 8: Format + commit**

```bash
pnpm --filter @waitron/payments exec prettier --write src/store.ts src/index.ts src/payments.rls.test.ts
git add packages/payments/src/store.ts packages/payments/src/index.ts packages/payments/src/payments.rls.test.ts \
  packages/payments/drizzle/0008_payments_webhook_resolver.sql packages/payments/drizzle/meta/
git commit -m "feat(payments): Mode 3 — untenanted (provider, external_ref) tenant resolver (SECURITY DEFINER seam)"
```

---

## Task 4: The `FakeAsyncProvider` test double

**Files:**
- Create: `packages/payments/src/testing/fake-async-provider.ts` (coverage-excluded via `src/testing/**`; NOT barrel-exported)
- Create: `packages/payments/src/testing/fake-async-provider.test.ts`

**Interfaces:**
- Consumes: `AsyncPaymentProvider`, `InitiateParams`, `InitiateResult`, `InboundSettlement` (Task 1); `insertInitiated` (Task 2); `Database` from `@waitron/db`; `decimal` from `@waitron/shared`.
- Produces (consumed by Tasks 5–6):
  ```ts
  export class FakeAsyncProvider implements AsyncPaymentProvider {
    readonly provider = "fake";
    constructor(db: Database);
    initiate(params: InitiateParams): Promise<InitiateResult>;
    verifyAndParse(payload: string, signature: string): InboundSettlement | null;
    static event(e: { externalRef: string; outcome: "settled" | "expired"; amount: string; settledAt: Date }): string; // builds a payload the fake's verifyAndParse decodes
  }
  ```

- [ ] **Step 1: Write the failing fake unit test**

Create `packages/payments/src/testing/fake-async-provider.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations } from "@waitron/db";
import type { Database } from "@waitron/db";
import { decimal } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "../migrations.js";
import { getPaymentByRef } from "../store.js";
import { freshNif, seedWorkingOrder } from "../../test/seed.js";
import { FakeAsyncProvider } from "./fake-async-provider.js";

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

describe("FakeAsyncProvider", () => {
  it("initiate writes an initiated row and returns a url + external ref", async () => {
    const s = await seedWorkingOrder(db, freshNif());
    const provider = new FakeAsyncProvider(db);
    const res = await provider.initiate({
      tenantId: s.tenantId,
      workingOrderId: s.workingOrderId,
      amount: decimal("12.10"),
      paymentRef: "pay-1",
    });
    expect(res.ref).toBe("pay-1");
    expect(res.externalRef).toMatch(/^fake-hosted-/);
    expect(res.url).toContain(res.externalRef);
    const row = await db.transaction((tx) =>
      getPaymentByRef(tx, { tenantId: s.tenantId, provider: "fake", paymentRef: "pay-1" }),
    );
    expect(row?.state).toBe("initiated");
    expect(row?.externalRef).toBe(res.externalRef);
  });

  it("verifyAndParse decodes a settled event built by FakeAsyncProvider.event", () => {
    const provider = new FakeAsyncProvider(db);
    const at = new Date("2026-07-24T12:00:00Z");
    const payload = FakeAsyncProvider.event({
      externalRef: "fake-hosted-9",
      outcome: "settled",
      amount: "12.10",
      settledAt: at,
    });
    const event = provider.verifyAndParse(payload, "ignored-signature");
    expect(event).toEqual({
      provider: "fake",
      externalRef: "fake-hosted-9",
      outcome: "settled",
      amount: decimal("12.10"),
      settledAt: at,
    });
  });

  it("verifyAndParse returns null for an event of another provider", () => {
    const provider = new FakeAsyncProvider(db);
    const payload = JSON.stringify({
      provider: "other",
      externalRef: "x",
      outcome: "settled",
      amount: "1.00",
      settledAt: new Date().toISOString(),
    });
    expect(provider.verifyAndParse(payload, "sig")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/payments test fake-async-provider.test.ts`
Expected: FAIL — `./fake-async-provider.js` does not exist.

- [ ] **Step 3: Implement the fake**

Create `packages/payments/src/testing/fake-async-provider.ts`:

```ts
import { decimal } from "@waitron/shared";
import type { Database } from "@waitron/db";
import type {
  AsyncPaymentProvider,
  InboundSettlement,
  InitiateParams,
  InitiateResult,
} from "../provider.js";
import { insertInitiated } from "../store.js";

let counter = 0;
const nextHostedId = (): string => `fake-hosted-${String(++counter).padStart(8, "0")}`;

/** A genuine DB-backed test double for the async / hosted mode, not a stub. `initiate` persists a
 * real `initiated` `payments` row through its own short transaction (no caller tx — the interface
 * forbids it). `verifyAndParse` trusts its payload (there is no signature to check in the fake): the
 * payload is a JSON-encoded settlement built by the static `event` helper. NOT re-exported from the
 * package barrel — a production import cannot reach it. */
export class FakeAsyncProvider implements AsyncPaymentProvider {
  readonly provider = "fake";

  constructor(private readonly db: Database) {}

  async initiate(params: InitiateParams): Promise<InitiateResult> {
    const externalRef = nextHostedId();
    await this.db.transaction((tx) =>
      insertInitiated(tx, {
        tenantId: params.tenantId,
        workingOrderId: params.workingOrderId,
        provider: this.provider,
        paymentRef: params.paymentRef,
        externalRef,
        amount: params.amount,
      }),
    );
    return { ref: params.paymentRef, externalRef, url: `https://fake.pay/${externalRef}` };
  }

  verifyAndParse(payload: string, _signature: string): InboundSettlement | null {
    const raw = JSON.parse(payload) as {
      provider: string;
      externalRef: string;
      outcome: "settled" | "expired";
      amount: string;
      settledAt: string;
    };
    if (raw.provider !== this.provider) return null;
    return {
      provider: raw.provider,
      externalRef: raw.externalRef,
      outcome: raw.outcome,
      amount: decimal(raw.amount),
      settledAt: new Date(raw.settledAt),
    };
  }

  /** Build the raw inbound payload for a settlement of this provider, the shape `verifyAndParse`
   * decodes — the async analogue of `FakePaymentProvider`'s configurable outcomes. */
  static event(e: {
    externalRef: string;
    outcome: "settled" | "expired";
    amount: string;
    settledAt: Date;
  }): string {
    return JSON.stringify({
      provider: "fake",
      externalRef: e.externalRef,
      outcome: e.outcome,
      amount: e.amount,
      settledAt: e.settledAt.toISOString(),
    });
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @waitron/payments test fake-async-provider.test.ts`
Expected: PASS (all three tests).

- [ ] **Step 5: Run the vocabulary guard + full test + typecheck**

Run: `pnpm --filter @waitron/payments test && pnpm --filter @waitron/payments typecheck`
Expected: PASS — including `no-provider-vocabulary.test.ts` (the new file uses only neutral identifiers) and its source-glob assertion (unaffected).

- [ ] **Step 6: Format + commit**

```bash
pnpm --filter @waitron/payments exec prettier --write src/testing/fake-async-provider.ts src/testing/fake-async-provider.test.ts
git add packages/payments/src/testing/fake-async-provider.ts packages/payments/src/testing/fake-async-provider.test.ts
git commit -m "test(payments): Mode 3 — FakeAsyncProvider (initiate + verifyAndParse)"
```

---

## Task 5: The capstone wiring test (orchestrator composition, PGlite)

**Files:**
- Create: `packages/payments/src/async.wiring.test.ts`

**Interfaces:**
- Consumes: `FakeAsyncProvider` (Task 4); `resolvePaymentTenant`, `settleInitiated`, `expireInitiated`, `associatePaymentWithSale`, `getPaymentByRef` (Tasks 2–3 + existing); `recordSale`/`RecordSaleInput` from `@waitron/core`; `FakeFiscalBackend` + `TrustedClock` from `@waitron/fiscal`; `withTenant` from `@waitron/db`; `seedForSale`/`freshNif` from `../test/seed.js`.
- Produces: nothing (a test). It plays the app-level orchestrator, proving the neutral pieces compose without any `apps/` layer.

- [ ] **Step 1: Write the capstone wiring test**

Create `packages/payments/src/async.wiring.test.ts`. This mirrors `wiring.test.ts` (reuse its `steadyClock` and `buildInput` shapes) but drives the async path:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations, withTenant } from "@waitron/db";
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
import {
  associatePaymentWithSale,
  expireInitiated,
  getPaymentByRef,
  resolvePaymentTenant,
  settleInitiated,
} from "./store.js";
import { FakeAsyncProvider } from "./testing/fake-async-provider.js";
import { freshNif, seedForSale } from "../test/seed.js";
import type { SeededForSale } from "../test/seed.js";

// The Mode 3 capstone: it composes the REAL neutral pieces the way the (deferred) app-level webhook
// endpoint will — verify -> resolveTenant -> withTenant{ settleInitiated + recordSale + associate } —
// with no `apps/` layer. It is a second consumer of `@waitron/core` (a dev dependency), exactly like
// wiring.test.ts. `recordSale` runs INSIDE the same transaction as settle + associate, so the sale
// chains atomically with the tender settlement.

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
  now: () => ({ instant: BASE, offsetMinutes: 60, confident: true, confidence: "anchored", anchorAgeSeconds: 0 }),
  anchor: () => {
    throw new Error("steadyClock: anchor() is not used by recordSale");
  },
  currentAnchor: () => null,
};

function buildInput(s: SeededForSale, settledAt: Date | null): RecordSaleInput {
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
      { lineNo: 1, descriptions: { es: "Item" }, quantity: "1", unitPrice: "10.00", vatRate: "21.00", lineTotal: "10.00" },
    ],
    tenders: [{ method: "card", amount: "12.10", settledAt }],
    fiscalBackend: "fake",
    clock: steadyClock,
  };
}

/** Plays the app-level orchestrator: verify the raw event, resolve the tenant untenanted, then in
 * ONE tenant-scoped transaction settle the tender, chain the sale, and associate. Returns the sale
 * id, or null when settleInitiated found nothing to advance (a redelivery — no sale is chained). */
async function orchestrate(
  provider: FakeAsyncProvider,
  backend: FakeFiscalBackend,
  s: SeededForSale,
  payload: string,
): Promise<string | null> {
  const event = provider.verifyAndParse(payload, "signature");
  if (event === null) return null;
  const tenantId = await resolvePaymentTenant(db, event.provider, event.externalRef);
  if (tenantId === null) return null;
  return withTenant(db, tenantId, async (tx) => {
    if (event.outcome === "expired") {
      await expireInitiated(tx, { provider: event.provider, externalRef: event.externalRef });
      return null;
    }
    const row = await settleInitiated(tx, {
      provider: event.provider,
      externalRef: event.externalRef,
      settledAt: event.settledAt,
    });
    if (row === null) return null; // redelivery — already chained; do nothing
    const recorded = await recordSale(tx, backend, buildInput(s, event.settledAt));
    await associatePaymentWithSale(tx, {
      tenantId,
      provider: event.provider,
      paymentRef: row.paymentRef,
      saleId: recorded.saleId,
    });
    return recorded.saleId;
  });
}

describe("initiate -> webhook -> settle -> recordSale -> associate (Mode 3, end to end)", () => {
  it("settles the hosted tender, chains the sale, and associates the payment atomically", async () => {
    const backend = new FakeFiscalBackend(db);
    const s = await seedForSale(db, backend, freshNif());
    const provider = new FakeAsyncProvider(db);

    const minted = await provider.initiate({
      tenantId: brandTenantId(s.tenantId),
      workingOrderId: brandWorkingOrderId(s.workingOrderId),
      amount: decimal("12.10"),
      paymentRef: "pay-1",
    });

    const payload = FakeAsyncProvider.event({
      externalRef: minted.externalRef,
      outcome: "settled",
      amount: "12.10",
      settledAt: BASE,
    });
    const saleId = await orchestrate(provider, backend, s, payload);
    expect(saleId).not.toBeNull();

    const row = await db.transaction((tx) =>
      getPaymentByRef(tx, { tenantId: s.tenantId, provider: "fake", paymentRef: "pay-1" }),
    );
    expect(row?.state).toBe("captured");
    expect(row?.saleId).toBe(saleId);
  });

  it("is idempotent under a redelivered webhook: the second delivery chains no second sale", async () => {
    const backend = new FakeFiscalBackend(db);
    const s = await seedForSale(db, backend, freshNif());
    const provider = new FakeAsyncProvider(db);
    const minted = await provider.initiate({
      tenantId: brandTenantId(s.tenantId),
      workingOrderId: brandWorkingOrderId(s.workingOrderId),
      amount: decimal("12.10"),
      paymentRef: "pay-1",
    });
    const payload = FakeAsyncProvider.event({
      externalRef: minted.externalRef,
      outcome: "settled",
      amount: "12.10",
      settledAt: BASE,
    });

    const first = await orchestrate(provider, backend, s, payload);
    expect(first).not.toBeNull();
    const second = await orchestrate(provider, backend, s, payload); // at-least-once redelivery
    expect(second).toBeNull();

    // Exactly one sale exists for this tenant's till/series (invoice_number 1, never a second).
    const sales = await db.execute<{ count: string }>(
      sql`select count(*)::text as count from sales where tenant_id = ${s.tenantId}`,
    );
    expect(sales.rows[0].count).toBe("1");
  });

  it("an expired hosted payment advances to failed, chains no sale, and leaves the working order open", async () => {
    const backend = new FakeFiscalBackend(db);
    const s = await seedForSale(db, backend, freshNif());
    const provider = new FakeAsyncProvider(db);
    const minted = await provider.initiate({
      tenantId: brandTenantId(s.tenantId),
      workingOrderId: brandWorkingOrderId(s.workingOrderId),
      amount: decimal("12.10"),
      paymentRef: "pay-1",
    });
    const payload = FakeAsyncProvider.event({
      externalRef: minted.externalRef,
      outcome: "expired",
      amount: "12.10",
      settledAt: BASE,
    });

    const saleId = await orchestrate(provider, backend, s, payload);
    expect(saleId).toBeNull();

    const row = await db.transaction((tx) =>
      getPaymentByRef(tx, { tenantId: s.tenantId, provider: "fake", paymentRef: "pay-1" }),
    );
    expect(row?.state).toBe("failed");
    expect(row?.saleId).toBeNull();
    const sales = await db.execute<{ count: string }>(
      sql`select count(*)::text as count from sales where tenant_id = ${s.tenantId}`,
    );
    expect(sales.rows[0].count).toBe("0");
  });
});
```

- [ ] **Step 2: Run to verify it fails, then passes**

Run: `pnpm --filter @waitron/payments test async.wiring.test.ts`
Expected: initially FAIL only if any consumed symbol is missing (they exist from Tasks 1–4), so this should PASS on first run. If it fails, read the error — a `sale.tender_unsettled` or FK error indicates a wiring mistake (compare against `wiring.test.ts`). Fix until PASS (all three tests).

- [ ] **Step 3: Run the full package test + typecheck**

Run: `pnpm --filter @waitron/payments test && pnpm --filter @waitron/payments typecheck`
Expected: PASS.

- [ ] **Step 4: Format + commit**

```bash
pnpm --filter @waitron/payments exec prettier --write src/async.wiring.test.ts
git add packages/payments/src/async.wiring.test.ts
git commit -m "test(payments): Mode 3 — capstone wiring (initiate -> webhook -> settle -> recordSale -> associate)"
```

---

## Task 6: The two-delivery idempotency race (real-PG) + coverage close-out

**Files:**
- Create: `packages/payments/src/async-settle.concurrency.test.ts`

**Interfaces:**
- Consumes: the same neutral pieces as Task 5; `startRealPostgres` from `./testing/postgres.js`; the `asAppUser`/acquired-signal concurrency conventions used by `forward.concurrency.test.ts` / `reversal.concurrency.test.ts`.
- Produces: nothing (a test). Proves that two SIMULTANEOUS deliveries of the same settlement chain exactly one sale — the state-guarded `settleInitiated` + the atomic orchestration transaction serialising under a real row lock.

- [ ] **Step 1: Read the existing concurrency-test harness to mirror it**

Run: `sed -n '1,60p' packages/payments/src/reversal.concurrency.test.ts` and `sed -n '1,60p' packages/payments/src/forward.concurrency.test.ts`.
Note how they (a) obtain two `Database` connections from `startRealPostgres` (`connect()` twice, or `connect` + `connectAs`), (b) coordinate a race (a shared "both started" signal / `Promise.all` of two transactions), and (c) assert the serialised outcome. Reuse that exact structure — do not invent a new concurrency primitive.

- [ ] **Step 2: Write the failing concurrency test**

Create `packages/payments/src/async-settle.concurrency.test.ts`. Seed one tenant with a registered till/series/working order and one `initiated` hosted payment (as the superuser `admin`). Then run the orchestration twice **concurrently** — each: `settleInitiated` → (if non-null) `recordSale` → `associate`, inside its own `withTenant` transaction on its own connection — via `Promise.all`. Assert:
- exactly one of the two returns a sale id, the other returns `null`;
- exactly one `sales` row exists for the tenant;
- the payment row ends `captured` and associated.

Use `recordSale` with the same `buildInput`/`steadyClock` shape as Task 5 (import them by copying the two helpers into this file, as the sibling concurrency tests keep their own local fixtures). Drive the race the way `reversal.concurrency.test.ts` does (its acquired-signal pattern), so both transactions reach `settleInitiated`'s `UPDATE … WHERE state='initiated'` before either commits — the first advances the row and chains the sale, the second's `UPDATE` matches zero rows (state is now `captured`), returns `null`, and chains nothing.

Run: `pnpm --filter @waitron/payments test async-settle.concurrency.test.ts`
Expected: PASS (the behaviour is already implemented in Tasks 2–3; this test proves it under real concurrency). Docker required. If it FAILS with two sales, that is a real defect in `settleInitiated`'s state guard or the transaction boundary — debug via `superpowers:systematic-debugging`, do not weaken the assertion.

- [ ] **Step 3: Full test + typecheck + format**

Run: `pnpm --filter @waitron/payments test && pnpm --filter @waitron/payments typecheck`
Expected: PASS.

```bash
pnpm --filter @waitron/payments exec prettier --write src/async-settle.concurrency.test.ts
```

- [ ] **Step 4: Own the coverage run (the #25 lesson)**

Run: `pnpm --filter @waitron/payments test:coverage`
Expected: PASS with statements ≥ 98, lines ≥ 98, functions ≥ 98, branches ≥ 95. New runtime code (`provider.ts` async types are type-only; `store.ts`'s `insertInitiated`/`settleInitiated`/`expireInitiated`/`resolvePaymentTenant`) is exercised by Tasks 2/3/5/6; `FakeAsyncProvider` is under `src/testing/**` (excluded). If a specific line/branch is uncovered, add the missing assertion to the owning test — do NOT lower a threshold or add an exclusion without a documented v8-artifact reason (see `vitest.config.ts`'s existing exclusions).

- [ ] **Step 5: Repo-wide gates + commit**

Run from the repo root:
```bash
pnpm format:check
pnpm --filter @waitron/payments lint
pnpm --filter @waitron/payments typecheck
```
Expected: all PASS. (`format:check` is a separate gate from `lint` — run it.)

```bash
git add packages/payments/src/async-settle.concurrency.test.ts
git commit -m "test(payments): Mode 3 — two-delivery settle race chains exactly one sale (real-PG)"
```

- [ ] **Step 6: Slice A complete**

The branch `payments-mode-3a-async` now carries the design commit + Tasks 1–6. Hand off to `/finish-branch` (simplify → review → rebase → PR → CI/Copilot) then `/land-branch`, the #21–#25 cycle. Slice B (the real Stripe Checkout adapter in `@waitron/payments-stripe`) is the next plan.

---

## Self-Review

**1. Spec coverage** (Mode 3 design section → task):
- `AsyncPaymentProvider` interface + `initiate`/`verifyAndParse` + types → Task 1. ✓
- New `initiated` state; `initiated → captured` (settle) / `initiated → failed` (expire) → Tasks 1 (enum) + 2 (transitions). ✓
- `settleInitiated` returns row-or-null (idempotency signal) → Task 2, proven in Tasks 5/6. ✓
- Partial `(provider, external_ref)` unique index (excludes manual/null; #25 grep) → Task 2. ✓
- Untenanted resolver mirroring `envios_tenants_with_work` (role + permissive policy + `SECURITY DEFINER`, returns tenant_id only) → Task 3. ✓
- App-level orchestration composed core-free; capstone wiring proof → Task 5 (`orchestrate` helper plays the endpoint). ✓
- Idempotency: state-guard + atomic tx; concurrent redelivery → Tasks 5 (sequential) + 6 (concurrent). ✓
- `FakeAsyncProvider`, not barrel-exported → Task 4. ✓
- Real-PG RLS proof (cross-tenant resolve; no wider leak) → Task 3. ✓
- Deferred (Stripe adapter, HTTP endpoint, `reconcile`, presentation, refunds-via-existing-path) → out of Slice A scope by design; not tasks. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; every command has an expected result. ✓

**3. Type consistency:** `settleInitiated` returns `SettledInitiated | null` in Task 2 and is consumed as `row === null ? … : row.paymentRef/row.workingOrderId/row.amount` in Tasks 5/6. `InboundSettlement.{provider,externalRef,outcome,amount,settledAt}` defined in Task 1, consumed identically in Tasks 4/5. `resolvePaymentTenant(db, provider, externalRef) → string | null` defined in Task 3, consumed in Tasks 5/6. `FakeAsyncProvider` constructor `(db)` + `event(...)` static defined in Task 4, consumed in Tasks 5/6. Consistent. ✓
