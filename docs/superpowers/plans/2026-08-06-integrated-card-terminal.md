# Counter POS — Integrated Card Terminal (Stripe first) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive a real Stripe reader (mode 2a `StripeTerminalProvider`) or Tap-to-Pay / on-device (mode 3 `StripeOnDeviceProvider`) **from** the till pay flow: the server calls `provider.collect` (a network step, **outside** the fiscal transaction), polls the reader to a terminal outcome, and settles the sale **on capture** — at **both** 7c pay-timing orderings (issue-at-pay and invoice-first). The one genuinely-new guard is **capture idempotency**: a lost-response retry must not double-charge.

**Architecture:** Wiring + one new guard, not new payment machinery. The two Stripe `PaymentProvider` adapters already exist and each does its own T1/T2 short-transaction bookkeeping and returns a `PaymentResult` as **data** (never a throw). This slice (a) makes the Stripe PaymentIntent-creation idempotency key stable per working order, (b) adds a read-only capture pre-check helper, (c) restructures the till pay seam into the **split-transaction** P1/P2/P3 flow so the network capture sits *between* fiscal transaction boundaries, (d) adds per-node provider selection + a tips flag at boot, and (e) adds the blocking pay route with a 200-with-discriminated-outcome body and the till's collecting / timed-out UX. **No `packages/db` migration** — the `payments` table, its states, its FKs, `payments_working_order_idx`, and the `card` `tender_method` all already exist.

**Tech Stack:** TypeScript (ESM), Drizzle + PostgreSQL, Hono, Lit 3 (`apps/till`), Vitest (+ `@vitest/browser`, Testcontainers). Stripe adapters in `packages/payments-stripe`; neutral seam in `packages/payments`; host in `apps/server`.

## Global Constraints

- **Coverage thresholds stay `statements 98 / lines 98 / functions 98 / branches 95`** in every touched package (`packages/ui` alone is `95/95/90/88`). Run each touched package's **`test:coverage` unfiltered** so the cross-cutting guards (error-code reachability, teardown guard, english-only) load — a name-filtered green says nothing about them (`CLAUDE.md` §§2, 4).
- **Error codes name the DOMAIN CONCEPT, never the throwing package or vendor**, are imported via a bare `import "./errors.js"` in every file that throws one, and are **never renamed once shipped**. **REUSE the codes the spec §10 lists (table below); invent none.** If a genuinely-new domain concept surfaces, name the concept (not `stripe.*`/`payments.*` beside a shipped code), import its registry, and **grep the siblings first** (`CLAUDE.md` §§1, 3).
- **No `packages/db` migration.** If you reach for one, stop — the enum states (`attempting`/`captured`/`accepted_offline`), the composite FKs, `payments_working_order_idx`, and the `card` `tender_method` already exist (`packages/payments/src/schema/payments.ts`). Keeping this branch off `packages/db` is also what keeps it off the 7c foundation branch's `_journal.json`, so there is no migration collision on rebase.
- **Real Postgres (Testcontainers, `TESTCONTAINERS_RYUK_DISABLED=true`) is required** for the provider's DB phases under the non-superuser `app_user` role, for the split-transaction flow, for the capture-idempotency concurrency test, and for RLS — PGlite connects as **superuser** (bypassing FORCE ROW LEVEL SECURITY) and **serialises every query onto one backend**, so both a privilege test and a concurrency test are **false passes** there (the #34 lesson the adapters' own doc-comments record: `provider.ts:28-36`, `device-provider.ts:49-65`; `CLAUDE.md` §4). PGlite / unit only where the heavy justification does not apply (outcome mapping, config parsing, tips arithmetic, the `tender-pay` state machine) — **say why in a comment**.
- **`pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` is NOT required** here — this slice adds **no** new `tenant_id`-bearing table (§10). Do not add it to the gate.
- **Prove every guard by deletion** (`CLAUDE.md` §4): remove the check, watch the test go red for the claimed reason, restore it. The capture-idempotency guard is proven this way in Task 5 (revert the Stripe key to random / remove the pre-check → a double-capture appears).
- **Nothing may block a sale on anything but the sale itself** (`CLAUDE.md` §5). A card outage never stops the shop trading: the timed-out-card UX always leaves **cash or manual card** (the #60/#62 network-free paths) one tap away. Fiscal submission stays an **outbox**, never inline — this slice adds a network step for the **card capture** only, never for AEAT.
- **New i18n keys land `en` + `es` together** (`apps/till/src/i18n/strings.ts`).
- **Every commit `git commit -s`.** Branch `feat/integrated-card-terminal`; follow the normal PR + CI + Copilot + `/land-branch` flow (this is code, not a `docs/backlog.md` edit).

### Reused error codes (spec §10 — grep-verified 2026-08-06, invent none)

| Reused code | Where declared | Used for |
| --- | --- | --- |
| `stripe.tenant_mismatch` | `packages/payments-stripe/src/errors.ts:18` | host wiring error, thrown by the provider before any network call |
| `stripe.collect_timeout` | `packages/payments-stripe/src/errors.ts:9` | **declared, not thrown** — a stall is a `failed` `PaymentResult` (data); stays for a future incident |
| `payment.not_found` | `packages/payments/src/errors.ts:47` | store lookups when a ref names no row |
| `payment.already_associated` | `packages/payments/src/errors.ts:66` | write-once association backstop |
| `sale.unsupported_tender` | `apps/server/src/errors.ts:226` | refuse `voucher`/`transfer`/`other` (unchanged) |
| `sale.already_settled` | `packages/core/src/errors.ts:165` | ordering-1 double-**settle** backstop (`settleSale`) |
| `sale.tender_shortfall` | `packages/core/src/errors.ts:108` | coverage identity failure |
| `sale.tender_unsettled` | `packages/core/src/errors.ts:95` | a `failed`/`network_unavailable` tender is unsettled — sale refused |
| `sale.empty_basket` | `apps/server/src/errors.ts:219` | empty basket, refused before any work |
| `working_order.not_open` / `working_order.not_found` | `apps/server/src/errors.ts:283` / `:261` (mapped 409 / 404 in `till-api.ts:72-73`) | order-state refusals |
| `server.till_config_missing` / `server.till_config_invalid` | `apps/server/src/errors.ts:56` / `:64` | the new `WAITRON_TILL_CARD_*` config vars |
| `server.internal` | `apps/server/src/errors.ts:144` | genuine faults (incl. the recovery corruption guard) → opaque 500 via `run` |

The non-captured outcomes (`declined`/`timeout`/`network_unavailable`) are **result data**, not error codes — they need no `AppError`.

---

## Resolved open plan-decisions

### Decision 1 — the pay route shape (spec §8): a dedicated `POST /api/pay`

**Chosen: a dedicated `POST /api/pay`, NOT an extension of `POST /api/sales`.**

Justification: the two routes carry genuinely **different response contracts**. `POST /api/sales` is the cash / manual-card path (#60/#62) and stays **behaviourally unchanged** — throw-or-ticket: a `TillSaleResult` on success, else an `AppError` mapped by `run` to 4xx/500. The integrated-card path is a **blocking** request whose payment outcome is *neither a client fault (4xx) nor a server fault (5xx)*, so it answers **200 with a discriminated outcome**. Overloading one route to return either `TillSaleResult` **or** `{ outcome, … }` would force every client to branch on response *shape* and would put the network-blocking poll on the same route as the network-free cash sale. A separate route keeps `run`'s AppError→4xx/500 mapping intact for `/api/sales`, lets `/api/pay` deliberately bypass it for the *non-captured* outcomes while genuine faults still throw-and-map, and matches the spec's own framing ("a deliberate divergence from the cash route's throw-or-ticket shape"). The client learns which route to use from `GET /api/till`'s new `cardProvider` field (Task 3): `none` → the manual-card path on `/api/sales`; an integrated provider → `/api/pay`.

**The 200-with-discriminated-outcome body** (the wire contract the client's result union mirrors):

```ts
{ outcome: "captured", ticket: TillSaleResult }   // filed/settled + payment↔sale linked; order settled
{ outcome: "declined" }                            // a failed capture — retry or switch tender
{ outcome: "timeout" }                             // reserved (see below)
{ outcome: "network_unavailable" }                 // mode 3 only, offline refused; nothing persisted
```

**Reachability note the plan pins (honest about the provider's return shape):** `provider.collect` resolves to `PaymentResultState` = `captured` | `accepted_offline` | `failed` | `network_unavailable`. `drive` returns `{ captured: false }` for **both** a decline **and** a poll-window stall (`provider.ts:165-180`), so `collect` writes `failed` for both — the provider **cannot distinguish a stall from a decline today**, which is exactly why `stripe.collect_timeout` is *declared but never thrown* (`provider.ts:172-174`). So in this slice the server **produces** three of the four arms — `captured` (from `captured`/`accepted_offline`), `declined` (from `failed`), `network_unavailable` — and never constructs `timeout`. The `timeout` arm is kept in the **wire union** (the client type) so a future provider version that separates a stall (a real `stripe.collect_timeout`) from a decline needs no wire change; the till renders `declined` and `timeout` with the **same** retry / switch-tender / wait screen (§8), so nothing is lost by not producing it yet. This is flagged in the outcome-mapper's own comment.

### Decision 2 — the crash-recovery finalize (spec §3 Pricing): file from the stored LOCKED lines, else leave for reconcile

**Chosen: the recovery path (a fresh `POST /api/pay` that finds an already-captured payment with `sale_id = NULL`) files from the working order's stored 7c-locked lines — which equal the charged amount by construction — and NEVER files a divergent total.**

The normal path holds the priced basket in memory across P2/P3, so filed total = charged total. The recovery path has no in-memory basket, so under the 7c foundation it re-derives the priced figure from the working order's **stored locked lines** (7c's line-add snapshot — the same locked lines P1 priced), which equal the captured `payments.amount` **by construction** because the lock does not move between charge and recovery. The tip (a per-pay, till-entered value, never stored on the order) is reconstructed as `tip = captured.amount − priced.total` — correct because the provider was charged the *gross* `priced.total + tip`.

The residual guard is for genuine corruption only: **if `captured.amount < priced.total`** (the charge cannot even cover the locked total), the flow **files nothing** — it throws `server.internal` (→ opaque 500 via `run`) and leaves the captured payment as reconcile's **orphan** class (captured row, `sale_id = NULL`, on an `open` order — `packages/payments/src/reconcile.ts`), **never inventing a fiscal figure** (`CLAUDE.md` §5). The safe default is "file at the locked total (with the reconstructed tip), else leave for reconcile." Tasks are written so no divergent total is ever filed (Task 5 tests both the equal case → files, and the shortfall case → throws + leaves the payment unassociated).

For **ordering 1** (invoice-first) the recovery analogue is `settleSale` (the sale already exists, issued at placing) guarded by `captured.amount ≥ amountDue`; the double-settle backstop is `settleSale`'s own `sale.already_settled`.

---

## File Structure

- `packages/payments-stripe/src/provider.ts` — derive the PaymentIntent-creation idempotency key from `params.workingOrderId` (was `paymentRef`, `:103,160-161`), decoupled from the random `paymentRef`.
- `packages/payments-stripe/src/device-provider.ts` — same derivation on the on-device `collectOnDevice` call (`:142,155`); keep `metadata.payment_ref = paymentRef` (still the random local ref).
- `packages/payments-stripe/src/testing/fake-stripe.ts` / `fake-stripe-device.ts` — record the last create-intent / collect params so a hermetic test can assert the **derived, stable** idempotency key (decoupled from `paymentRef`).
- `packages/payments-stripe/src/collect.sandbox.test.ts` / `connection-token.sandbox.test.ts` — extend for the derived-key **reuse** (two collects for one working order → one PaymentIntent).
- `packages/payments/src/store.ts` — new read-only `findCapturedPaymentForWorkingOrder(tx, { tenantId, provider, workingOrderId })`.
- `packages/payments/src/index.ts` — barrel-export it and its return type.
- `apps/server/src/till-config.ts` — `WAITRON_TILL_CARD_PROVIDER`, `WAITRON_TILL_STRIPE_READER_ID`, `WAITRON_TILL_TIPS` on `TillConfig`.
- `apps/server/src/stripe-account.ts` — a per-tenant **card-client** resolver reusing `stripeSecretKeyFrom` (beside `stripeAccountResolver`).
- `apps/server/src/boot.ts` — `buildCardProvider` (none / terminal / on-device) and inject the provider + `tipsEnabled` into `TillApiDeps`.
- `apps/server/src/till-sale.ts` — `payWorkingOrderIntegrated` (P1/P2/P3, both orderings, the §4 pre-check + recovery, tips), sharing `readSettledTicket` + 7c's locked-lines pricing.
- `apps/server/src/till-api.ts` — `POST /api/pay` (blocking, 200-with-outcome), the pure outcome-mapper, `cardProvider`/`tipsEnabled` on `GET /api/till`, `TillApiDeps` gains `cardProvider?`/`tipsEnabled`.
- `apps/till/src/api/client.ts` — a `pay(...)` method and the `PayOutcome` result union.
- `apps/till/src/widgets/tender-pay.ts` — `collecting` + `declined/timed-out` states, client-abort Cancel, tip entry (when `tipsEnabled`), offline-consent affordance (only `stripe_on_device`).
- `apps/till/src/till-app.ts` — `#onCollectCard` POSTing `/api/pay`, branching on outcome.
- `apps/till/src/i18n/strings.ts` — new keys (`en` + `es`).
- `apps/server/scripts/*` — a `demo:` extension driving `FakeStripe` through a capture.

---

## Task 1 — Stripe idempotency key derived from the working-order id (7c-INDEPENDENT)

> **Independent of 7c** — touches only `packages/payments-stripe`; build immediately, in parallel with the 7c foundation branch.

**Files:**
- Modify: `packages/payments-stripe/src/provider.ts` (`collect` `:100-133`, `drive` `:151-181`), `packages/payments-stripe/src/device-provider.ts` (`collect` `:137-163`)
- Modify: `packages/payments-stripe/src/testing/fake-stripe.ts:46-52`, `packages/payments-stripe/src/testing/fake-stripe-device.ts` (`collectOnDevice`)
- Test: `packages/payments-stripe/src/wiring.test.ts` (hermetic, add the key-decoupling assertions), `packages/payments-stripe/src/collect.sandbox.test.ts` + `connection-token.sandbox.test.ts` (nightly, extend)

**Interfaces (the changed idempotency-key parameter):**
- `StripeClient.createPaymentIntent(params: { amount: Decimal; currency: string; idempotencyKey: string })` — signature unchanged (`client.ts:9-13`); what changes is the **value** `collect` passes for `idempotencyKey`: from the random `paymentRef` to a value **derived from `params.workingOrderId`** (`` `wo_${params.workingOrderId}` ``), stable across retries.
- `StripeDeviceClient.collectOnDevice({ …, idempotencyKey, metadata: { working_order_id, payment_ref } })` (`device-client.ts:23-44`) — same: `idempotencyKey` becomes the derived stable key; `metadata.payment_ref` stays the **random** local `paymentRef` (the attribution hint) and `metadata.working_order_id` stays `params.workingOrderId`.
- FakeStripe gains `lastCreateIntent: { amount: Decimal; currency: string; idempotencyKey: string } | undefined`; FakeStripeDevice gains `lastCollect: { …; idempotencyKey: string; metadata: {…} } | undefined`.

- [ ] **Step 1 — Write the failing hermetic tests** (`wiring.test.ts`, a new `describe`):

```ts
describe("stripe idempotency key is derived from the working order, decoupled from paymentRef", () => {
  it("passes a stable wo-derived key across two collects for one working order, with distinct payment rows", async () => {
    const backend = new FakeFiscalBackend(pg.db);
    const s = await seedForSale(pg.db, backend, freshNif());
    const client = new FakeStripe();
    const provider = new StripeTerminalProvider({
      client,
      db: pg.db,
      tenantId: brandTenantId(s.tenantId),
      resolveReader: () => Promise.resolve("reader_1"),
      poll: { maxAttempts: 3, intervalMs: 0, sleep: () => Promise.resolve() },
    });
    const args = {
      tenantId: brandTenantId(s.tenantId),
      tillId: brandTillId(s.tillId),
      workingOrderId: brandWorkingOrderId(s.workingOrderId),
      amount: decimal("12.10"),
    };

    const first = await provider.collect(args);
    const firstKey = client.lastCreateIntent?.idempotencyKey;
    const second = await provider.collect(args);
    const secondKey = client.lastCreateIntent?.idempotencyKey;

    // The Stripe key is DERIVED FROM THE WORKING ORDER and identical across retries...
    expect(firstKey).toBe(`wo_${s.workingOrderId}`);
    expect(secondKey).toBe(firstKey);
    // ...while the LOCAL payment_ref stays random (one payments-row idempotency anchor per attempt).
    expect(second.paymentRef).not.toBe(first.paymentRef);
    // Prove the decoupling: the key is NOT either random ref.
    expect(firstKey).not.toBe(first.paymentRef);
    expect(secondKey).not.toBe(second.paymentRef);
  });
});
```

- [ ] **Step 2 — Run → FAIL.** Today `firstKey` equals `first.paymentRef` (the random ref), so `expect(firstKey).toBe("wo_…")` fails.

- [ ] **Step 3 — Implement the recorder** in `fake-stripe.ts` (make the ignored `_params` used, drop the eslint-disable):

```ts
lastCreateIntent: { amount: Decimal; currency: string; idempotencyKey: string } | undefined;
createPaymentIntent(params: { amount: Decimal; currency: string; idempotencyKey: string }): Promise<{ id: string }> {
  this.lastCreateIntent = params;
  return Promise.resolve({ id: nextId("pi") });
}
```

Mirror it on `fake-stripe-device.ts`'s `collectOnDevice` (record `lastCollect = params`; keep returning the deterministic `{ outcome, externalRef }`).

- [ ] **Step 4 — Implement the derivation** in `provider.ts` `collect`:

```ts
async collect(params: CollectParams): Promise<PaymentResult> {
  this.requireOwnTenant(params.tenantId);
  const readerId = await this.opts.resolveReader(params.tenantId, params.tillId);
  const paymentRef = randomUUID();
  // The Stripe PaymentIntent-creation idempotency key is derived from the STABLE working-order id,
  // not the per-call random paymentRef (§4): a retry after a lost response re-drives the SAME
  // PaymentIntent to completion, so Stripe charges once. The local paymentRef stays random — it is
  // the `payments` row's (tenant, provider, payment_ref) idempotency anchor, one row per attempt.
  const stripeIdempotencyKey = `wo_${params.workingOrderId}`;
  const key = { tenantId: params.tenantId, provider: PROVIDER, paymentRef };
  await this.inTenant((tx) => insertAttempting(tx, { /* …unchanged… */ }));
  const outcome = await this.drive(readerId, params.amount, stripeIdempotencyKey);
  // …T2 unchanged…
}
```

Rename `drive`'s third parameter `paymentRef` → `idempotencyKey` and pass it straight to `createPaymentIntent({ amount, currency, idempotencyKey })` (`:157-161`); nothing else in `drive` uses that argument.

In `device-provider.ts` `collect` (`:142-163`):

```ts
const paymentRef = randomUUID();
const stripeIdempotencyKey = `wo_${params.workingOrderId}`;   // stable across retries (§4)
// …offline gate unchanged…
const outcome = await this.opts.client.collectOnDevice({
  amount: params.amount,
  currency: CURRENCY,
  idempotencyKey: stripeIdempotencyKey,
  offlineAllowed,
  metadata: { working_order_id: params.workingOrderId, payment_ref: paymentRef },  // payment_ref stays the random local ref
});
```

- [ ] **Step 5 — Run → PASS.** Add the device analogue of the Step-1 test (via `StripeOnDeviceProvider` + `FakeStripeDevice`, asserting `client.lastCollect?.idempotencyKey === "wo_…"` and `metadata.payment_ref` is the distinct random ref).

- [ ] **Step 6 — Prove by deletion.** Revert `stripeIdempotencyKey` to `paymentRef` → the two collects pass different keys and `secondKey === second.paymentRef`, so the decoupling assertions fail. Restore.

- [ ] **Step 7 — Extend the nightly sandbox suites** (the ONLY evidence the real SDK honours the key). In `collect.sandbox.test.ts`, add an `it` that collects **twice** for one working order (presenting a card each time) and asserts the **same** PaymentIntent id came back both times (real Stripe idempotency → one PI → one charge) — the fake cannot prove reuse (it mints a fresh `pi_` per call), so this is the real-API half:

```ts
it("re-collecting the same working order reuses one PaymentIntent (real Stripe idempotency)", async () => {
  // …seed, construct provider as in the existing test…
  const args = { tenantId, tillId, workingOrderId, amount: decimal("12.10") };
  const a = provider.collect(args);
  await new Promise((r) => setTimeout(r, 1500));
  await stripe.testHelpers.terminal.readers.presentPaymentMethod(readerId);
  const first = await a;
  // A second collect for the SAME working order must resolve to the SAME PaymentIntent id.
  const second = await provider.collect(args);
  const firstRow = /* getPaymentByRef(first.paymentRef).externalRef */;
  const secondRow = /* getPaymentByRef(second.paymentRef).externalRef */;
  expect(secondRow).toBe(firstRow);   // one pi_ → charged once
});
```

(Add the on-device analogue to `connection-token.sandbox.test.ts`'s sibling / the on-device sandbox suite where the device provider is exercised.) These self-skip with no `STRIPE_SECRET_KEY` (`collect.sandbox.test.ts:23-24`).

- [ ] **Step 8 — Gate.** `pnpm --filter @waitron/payments-stripe test:coverage` unfiltered → PASS. Commit `-s`.

---

## Task 2 — `findCapturedPaymentForWorkingOrder` read helper (7c-INDEPENDENT)

> **Independent of 7c** — touches only `packages/payments`; build immediately.

**Files:**
- Modify: `packages/payments/src/store.ts` (add the reader beside the existing insert/read helpers, mirroring `getPaymentByRef` `:278-284`), `packages/payments/src/index.ts` (barrel export)
- Test: `packages/payments/src/store.test.ts` or a focused `find-captured.test.ts` (PGlite for the state-filter unit), and `packages/payments/src/payments.rls.test.ts` (real-PG for tenant isolation, proven by deletion)

**Interfaces (the new read helper's return type — used by the seam tasks):**

```ts
/** A captured (or offline-accepted) payment found for a working order — the §4 capture-idempotency
 * pre-check's result. `saleId` NULL is the "collect committed, P3 never ran" recovery window; set
 * means the sale is already filed and the pay is a replay. `amount`/`settledAt`/`externalRef` are the
 * raw column strings, so the recovery path can reconstruct the tender and associate this exact row. */
export interface CapturedPaymentForOrder {
  id: string;
  paymentRef: string;
  amount: string;                 // numeric(12,2) as text
  saleId: string | null;
  externalRef: string | null;
  settledAt: string | null;       // always set for captured/accepted_offline, but typed nullable like the column
  state: "captured" | "accepted_offline";
}

export async function findCapturedPaymentForWorkingOrder(
  tx: Transaction,
  key: { tenantId: string; provider: string; workingOrderId: string },
): Promise<CapturedPaymentForOrder | undefined>;
```

- [ ] **Step 1 — Write the failing unit test** (PGlite — pure state-filter logic, no privilege/concurrency, so the light target is justified; state so in a comment):

```ts
// PGlite: this asserts the STATE filter and column projection only — no RLS, no concurrency — so
// the hermetic superuser target is the right one (CLAUDE.md §4). Tenant isolation is proven on real
// Postgres in payments.rls.test.ts.
it("returns a captured payment for the working order, ignoring non-captured states", async () => {
  const s = await seedWorkingOrder(pg.db);   // tenant → … → open working_order
  const key = { tenantId: s.tenantId, provider: "stripe", workingOrderId: s.workingOrderId };
  // A failed attempt must NOT match (a legitimately-declined card is re-chargeable).
  await pg.db.transaction((tx) => insertFailedPayment(tx, { ...key, provider: "stripe", paymentRef: "f1", amount: decimal("5.00") }));
  expect(await pg.db.transaction((tx) => findCapturedPaymentForWorkingOrder(tx, key))).toBeUndefined();
  // A captured payment matches, carrying its ref/amount/saleId(null)/externalRef.
  await pg.db.transaction((tx) => insertCapturedPayment(tx, { ...key, provider: "stripe", paymentRef: "c1", amount: decimal("12.10"), settledAt: new Date(), externalRef: "pi_x" }));
  const found = await pg.db.transaction((tx) => findCapturedPaymentForWorkingOrder(tx, key));
  expect(found).toMatchObject({ paymentRef: "c1", amount: "12.10", saleId: null, externalRef: "pi_x", state: "captured" });
});
it("matches an accepted_offline payment too (it chained its sale)", async () => { /* insertAcceptedOffline → found.state === "accepted_offline" */ });
it("returns undefined when the only payment is attempting (the lost-T2 window is not yet captured)", async () => { /* insertAttempting → undefined */ });
```

- [ ] **Step 2 — Run → FAIL** (`findCapturedPaymentForWorkingOrder` does not exist).

- [ ] **Step 3 — Implement** in `store.ts` (mirrors `getPaymentByRef`'s shape; uses `payments_working_order_idx`; `inArray` for the state set):

```ts
const CAPTURED_FOR_ORDER_COLUMNS = {
  id: payments.id,
  paymentRef: payments.paymentRef,
  amount: payments.amount,
  saleId: payments.saleId,
  externalRef: payments.externalRef,
  settledAt: payments.settledAt,
  state: payments.state,
};

/** The §4 capture-idempotency pre-check: has this working order already got a captured (or
 * offline-accepted) payment for this provider? Read-only, over existing columns/`payments_working_order_idx`.
 * A `failed`/`attempting` row is NOT captured, so a legitimately-declined card stays re-chargeable and
 * a lost-T2 `attempting` orphan is never mistaken for a completed capture (§4). */
export async function findCapturedPaymentForWorkingOrder(
  tx: Transaction,
  key: { tenantId: string; provider: string; workingOrderId: string },
): Promise<CapturedPaymentForOrder | undefined> {
  const [row] = await tx
    .select(CAPTURED_FOR_ORDER_COLUMNS)
    .from(payments)
    .where(
      and(
        eq(payments.tenantId, key.tenantId),
        eq(payments.provider, key.provider),
        eq(payments.workingOrderId, key.workingOrderId),
        inArray(payments.state, ["captured", "accepted_offline"]),
      ),
    )
    .limit(1);
  return row as CapturedPaymentForOrder | undefined;
}
```

Export `findCapturedPaymentForWorkingOrder` and `CapturedPaymentForOrder` from `index.ts` (value in the `store.js` `export {}` block, type in its `export type {}` block).

- [ ] **Step 4 — Run → PASS.**

- [ ] **Step 5 — Write the real-PG tenant-isolation test** (`payments.rls.test.ts`, the `useRealPostgres` + `PROBE_ROLE` pattern the file already uses):

```ts
it("finds only the caller-tenant's captured payment under real RLS (isolation proven by scope)", async () => {
  const a = await seedWorkingOrder(suite.admin, "B33333333");
  const b = await seedWorkingOrder(suite.admin, "B44444444");
  const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
  try {
    await withTenant(probe, a.tenantId, (tx) => insertCapturedPayment(tx, {
      tenantId: a.tenantId, workingOrderId: a.workingOrderId, provider: "stripe",
      paymentRef: "c1", amount: decimal("10.00"), settledAt: new Date(), externalRef: "pi_a",
    }));
    const key = { tenantId: a.tenantId, provider: "stripe", workingOrderId: a.workingOrderId };
    // Visible under A's scope...
    expect(await withTenant(probe, a.tenantId, (tx) => findCapturedPaymentForWorkingOrder(tx, key))).toBeDefined();
    // ...invisible under B's scope (SAME row, only the GUC differs → the isolation policy hides it).
    expect(await withTenant(probe, b.tenantId, (tx) => findCapturedPaymentForWorkingOrder(tx, { ...key, tenantId: b.tenantId }))).toBeUndefined();
  } finally { await probe.close(); }
});
```

- [ ] **Step 6 — Prove by deletion.** Remove the `eq(payments.tenantId, key.tenantId)` predicate → under B's scope the RLS policy still hides A's row (so this alone would not fail) — instead prove the STATE filter by deletion: drop `inArray(payments.state, [...])` and confirm the unit test's "ignoring non-captured states" case now returns the `failed` row (a false capture). Restore.

- [ ] **Step 7 — Gate.** `pnpm --filter @waitron/payments test:coverage` unfiltered → PASS. Commit `-s`.

---

> **The remaining tasks touch the shared till seam and REBASE onto the 7c foundation branch before merge** (`till-sale.ts` / `till-api.ts` / `tender-pay.ts`, restructured by 7c into the placing / locked-lines / two-orderings shape). 7c lands first and owns any `packages/db` migration; this branch adds none, so there is **no `_journal.json` collision** — the rebase is a localised merge of the tender/settlement block and one widget. Write these tasks against the 7c target shape.

---

## Task 3 — Per-node provider selection + tips flag (config/boot) — SEAM-REBASING

**Files:**
- Modify: `apps/server/src/till-config.ts` (`TillConfig` + `loadTillConfig` `:19-82`), `apps/server/src/stripe-account.ts` (a card-client resolver beside `stripeAccountResolver` `:90-103`), `apps/server/src/boot.ts` (`buildCardProvider` + inject `:166-176`), `apps/server/src/till-api.ts` (`TillApiDeps` `:40-46`, `GET /api/till` `:169-189`)
- Test: `apps/server/src/till-config.test.ts` (PGlite/unit — env parsing), `apps/server/src/stripe-account.test.ts` (unit — key resolution via injected `makeStripe`), `apps/server/src/boot.test.ts` / `till-api.rls.test.ts` (the boot-info fields)

**Interfaces:**

```ts
// till-config.ts — TillConfig gains:
export type CardProvider = "none" | "stripe_terminal" | "stripe_on_device";
export interface TillConfig {
  // …existing fiscal ids + locale…
  cardProvider: CardProvider;          // WAITRON_TILL_CARD_PROVIDER, default "none"
  stripeReaderId?: string;             // WAITRON_TILL_STRIPE_READER_ID (required iff cardProvider === "stripe_terminal")
  tipsEnabled: boolean;                // WAITRON_TILL_TIPS ("true" | "1" enables), default false
}

// stripe-account.ts — build a collect-side client from the till's single tenant credential:
export function cardClientResolver(deps: StripeAccountDeps): (tenantId: TenantId) => Promise<StripeClient>;
export function cardDeviceClientResolver(deps: StripeAccountDeps): (tenantId: TenantId) => Promise<StripeDeviceClient>;

// boot.ts — one provider for the till's tenant (or none):
function buildCardProvider(cfg: TillConfig, deps: { db: Database; ring: KeyRing; environment: DeploymentEnvironment; makeStripe: (k: string) => Stripe }): Promise<PaymentProvider | undefined>;

// till-api.ts — TillApiDeps gains:
cardProvider?: PaymentProvider;        // undefined when WAITRON_TILL_CARD_PROVIDER=none
tipsEnabled: boolean;
```

- [ ] **Step 1 — Write the failing config tests** (`till-config.test.ts` — unit, mirrors the existing fiscal-id parsing tests):

```ts
it("defaults cardProvider to 'none' and tipsEnabled to false", () => {
  const cfg = loadTillConfig(baseEnv());   // no WAITRON_TILL_CARD_* set
  expect(cfg.cardProvider).toBe("none");
  expect(cfg.tipsEnabled).toBe(false);
  expect(cfg.stripeReaderId).toBeUndefined();
});
it("reads stripe_terminal + reader id + tips", () => {
  const cfg = loadTillConfig({ ...baseEnv(), WAITRON_TILL_CARD_PROVIDER: "stripe_terminal", WAITRON_TILL_STRIPE_READER_ID: "tmr_1", WAITRON_TILL_TIPS: "true" });
  expect(cfg.cardProvider).toBe("stripe_terminal");
  expect(cfg.stripeReaderId).toBe("tmr_1");
  expect(cfg.tipsEnabled).toBe(true);
});
it("refuses a stripe_terminal provider with no reader id (server.till_config_missing)", () => {
  expect(() => loadTillConfig({ ...baseEnv(), WAITRON_TILL_CARD_PROVIDER: "stripe_terminal" }))
    .toThrow(expect.objectContaining({ code: "server.till_config_missing" }));   // key: WAITRON_TILL_STRIPE_READER_ID
});
it("refuses an unknown provider value (server.till_config_invalid)", () => {
  expect(() => loadTillConfig({ ...baseEnv(), WAITRON_TILL_CARD_PROVIDER: "square" }))
    .toThrow(expect.objectContaining({ code: "server.till_config_invalid" }));   // key: WAITRON_TILL_CARD_PROVIDER
});
```

- [ ] **Step 2 — Run → FAIL** (fields absent).

- [ ] **Step 3 — Implement `loadTillConfig`** (reuse the existing `required`/`isUnset`/`server.till_config_*` idiom `:35-55`; grep the siblings — the codes and no-value-echo rule are already established):

```ts
const rawProvider = env.WAITRON_TILL_CARD_PROVIDER;
const cardProvider: CardProvider =
  rawProvider === undefined || rawProvider === "" ? "none"
  : rawProvider === "stripe_terminal" || rawProvider === "stripe_on_device" || rawProvider === "none" ? rawProvider
  : (() => { throw new AppError("server.till_config_invalid", { key: "WAITRON_TILL_CARD_PROVIDER" }); })();
// A server-driven reader needs its id; on-device mints its own connection token, so no id there.
const stripeReaderId = cardProvider === "stripe_terminal"
  ? required(env, "WAITRON_TILL_STRIPE_READER_ID")   // throws server.till_config_missing if unset
  : undefined;
const rawTips = env.WAITRON_TILL_TIPS;
const tipsEnabled = rawTips === "true" || rawTips === "1";
return { /* …existing… */ cardProvider, ...(stripeReaderId === undefined ? {} : { stripeReaderId }), tipsEnabled };
```

- [ ] **Step 4 — The card-client resolver** (`stripe-account.ts`, reuse `readCredential` + `stripeSecretKeyFrom` `:62-80` + `makeStripe`, exactly as `stripeAccountResolver` does):

```ts
export function cardClientResolver(deps: StripeAccountDeps): (tenantId: TenantId) => Promise<StripeClient> {
  return async (tenantId) => {
    const payload = await readCredential(deps.db, deps.ring, tenantId, "payments.stripe");
    const secretKey = stripeSecretKeyFrom(payload, { tenantId, purpose: "payments.stripe" }, deps.environment);
    return stripeClient(deps.makeStripe(secretKey));   // env-prefix guard (sk_live_/sk_test_) already inside stripeSecretKeyFrom
  };
}
// cardDeviceClientResolver: identical, returning stripeDeviceClient(deps.makeStripe(secretKey)).
```

- [ ] **Step 5 — `buildCardProvider` + inject in `boot.ts`.** The till serves ONE tenant (`cfg.till.tenantId`), so build ONE provider up front:

```ts
async function buildCardProvider(cfg: TillConfig, deps: { db; ring; environment; makeStripe }): Promise<PaymentProvider | undefined> {
  if (cfg.cardProvider === "none") return undefined;
  if (cfg.cardProvider === "stripe_terminal") {
    const client = await cardClientResolver(deps)(cfg.tenantId);
    const readerId = cfg.stripeReaderId!;   // loadTillConfig guarantees it for stripe_terminal
    return new StripeTerminalProvider({ client, db: deps.db, tenantId: cfg.tenantId, resolveReader: () => Promise.resolve(readerId) });
  }
  const client = await cardDeviceClientResolver(deps)(cfg.tenantId);   // stripe_on_device
  return new StripeOnDeviceProvider({ client, db: deps.db, tenantId: cfg.tenantId });
}
```

Wire it in `startServer` beside the `mountTillApi` call (`:166-176`), adding `cardProvider` + `tipsEnabled: config.till.tipsEnabled` to the `TillApiDeps`:

```ts
const cardProvider = await buildCardProvider(config.till, { db, ring, environment: config.environment, makeStripe: defaultMakeStripe });
mountTillApi(app, { db, backend: makeFiscalBackend(db, env), clock: systemClock(), cfg: config.till,
  secureCookies: config.tls !== undefined, cardProvider, tipsEnabled: config.till.tipsEnabled }, log);
```

- [ ] **Step 6 — Expose `cardProvider`/`tipsEnabled` on `GET /api/till`** so the client picks the route + UI affordances (Task 8). Add to the boot-info payload `:187`:

```ts
return c.json({ locale: deps.cfg.locale, venueName: issuer.venueName, nif: issuer.nif,
  cardProvider: deps.cfg.cardProvider, tipsEnabled: deps.tipsEnabled });
```

- [ ] **Step 7 — Run all → PASS.** `pnpm --filter @waitron/server test:coverage` unfiltered → PASS (the config parsing is unit-covered; a boot-info shape assertion in `till-api.rls.test.ts` covers the new fields). Commit `-s`.

---

## Task 4 — The split-transaction integrated pay (ordering 2, issue-at-pay) — SEAM-REBASING

> **Rebases onto 7c.** Reuses 7c's `readSettledTicket` and 7c's **locked-lines pricing** (7c files a retrieved/placed order from its stored `working_order_lines`, not from a re-priced client basket). Build the new orchestrator beside the (unchanged) single-transaction `payWorkingOrder`; the cash/manual-card path stays behaviourally identical.

**Files:**
- Modify: `apps/server/src/till-sale.ts` (add `payWorkingOrderIntegrated`, `IntegratedPayRequest`, `IntegratedPayOutcome`; share `readSettledTicket` `:354-408` and 7c's locked-lines pricing)
- Test: `apps/server/src/till-sale-integrated.rls.test.ts` (**real Postgres** — the split flow files/settles + links under `app_user`; PGlite is a false pass for the RLS the P3 writes run under and cannot show the T1/T2-then-tx-B ordering meaningfully)

**Interfaces:**

```ts
export interface IntegratedPayRequest {
  id: string;                                       // working order id — the pay-idempotency key (7b)
  lines: { productId: string; quantity: string }[]; // a WALK-UP's basket; a placed order files from its locked lines (7c)
  tip?: string;                                     // till-entered gross tip; clamped to 0 when tips are disabled (§7)
  allowOffline?: boolean;                           // mode 3 only (§6); meaningless for a reader
}

export type IntegratedPayOutcome =
  | { outcome: "captured"; ticket: TillSaleResult }
  | { outcome: "declined" }
  | { outcome: "timeout" }                           // reserved — see Decision 1
  | { outcome: "network_unavailable" };

export type IntegratedPayDeps = TillSaleDeps & { provider: PaymentProvider; tipsEnabled: boolean };

export async function payWorkingOrderIntegrated(
  deps: IntegratedPayDeps,
  cfg: TillConfig,
  req: IntegratedPayRequest,
  operatorId?: string,
): Promise<IntegratedPayOutcome>;
```

**Phase structure this task implements (ordering 2; ordering 1 in Task 6; recovery in Task 5):**

- **P1 (tx A).** `withTenant`/`asAppUser`. `SELECT … FOR UPDATE` the order (`till-sale.ts:151-155`). Already `settled` → **replay** `readSettledTicket` → `{ outcome: "captured", ticket }`, file nothing. `abandoned` → `working_order.not_open`. Refuse `sale.empty_basket` for an empty walk-up basket. Detect ordering: **no outstanding sale for this order** (this task) vs an existing one (Task 6). The §4 pre-check (`findCapturedPaymentForWorkingOrder`) — recovery is Task 5; here assert "none" and proceed. Price: a **walk-up** (`locked === undefined`) → `createOpenOrder` (locks the basket, returns `priced`) and **commit tx A** (the FK needs the `working_orders` row before the provider's `insertAttempting`); a **placed** order → 7c's locked-lines pricing. Hold `priced` in memory.
- **P2 (no tx).** `tip = deps.tipsEnabled ? decimal(req.tip ?? "0.00") : decimal("0.00")`. `const result = await deps.provider.collect({ tenantId: cfg.tenantId, tillId: cfg.tillId, workingOrderId: brandWorkingOrderId(req.id), amount: addDecimal(priced.total, tip), allowOffline: req.allowOffline })`.
- **P3 (tx B), on `captured`/`accepted_offline`.** `withTenant`/`asAppUser`. Re-lock `FOR UPDATE`; already `settled` → replay. `recordSale` immediate (`total = priced.total`, `lines`/`vatBreakdown` from `priced`, one tender `{ method: "card", amount: addDecimal(priced.total, tip), tipAmount: tip, settledAt: result.settledAt }`), then `associatePaymentWithSale({ provider: result.provider, paymentRef: result.paymentRef, saleId, tenantId })`, then `open|placed → settled`. The `23505` unique-violation backstop replays a concurrent winner (`till-sale.ts:312-338`).
- **On `failed`/`network_unavailable`.** File nothing; leave the order `open`; return the mapped outcome (`declined` / `network_unavailable`).

- [ ] **Step 1 — Write the failing real-PG tests** (`till-sale-integrated.rls.test.ts`, the `setupVenue` harness from `working-order.rls.test.ts`; drive the reader with `FakeStripe`):

```ts
// Real Postgres, not PGlite (CLAUDE.md §4): the P3 recordSale/associate/settle writes run as app_user
// under RLS, and the split T1/T2-then-tx-B ordering + the FK-before-attempting invariant are exactly
// what a superuser PGlite backend cannot show. FakeStripe drives the reader deterministically.
function integratedDeps(client = new FakeStripe()) {
  const provider = new StripeTerminalProvider({ client, db: suite.pg /* app-role handle */, tenantId: cfg.tenantId, resolveReader: () => Promise.resolve("reader_1"), poll: { maxAttempts: 3, intervalMs: 0, sleep: () => Promise.resolve() } });
  return { deps: { db: suite.pg, backend, clock, provider, tipsEnabled: false }, provider, client };
}

it("walk-up: captures, files an immediate card sale, links the payment, settles the order", async () => {
  const { cfg, cafe } = await setupVenue();
  const { deps } = integratedDeps();
  const id = crypto.randomUUID();
  const out = await payWorkingOrderIntegrated(deps, cfg, { id, lines: [{ productId: cafe.id, quantity: "1" }] });
  expect(out.outcome).toBe("captured");
  if (out.outcome !== "captured") throw new Error("unreachable");
  expect(out.ticket.change).toBe("0.00");
  // the working order is settled; exactly one sale with a card tender; one captured stripe payment linked to it.
  // assert via reads: working_orders.status = 'settled'; a tenders row method='card' amount=1.50;
  // a payments row provider='stripe' state='captured' sale_id = the filed sale, external_ref ~ /^pi_/.
});

it("a declined card files nothing and leaves the order open (retryable)", async () => {
  const { cfg, cafe } = await setupVenue();
  const client = new FakeStripe(); client.declineNext();
  const { deps } = integratedDeps(client);
  const id = crypto.randomUUID();
  const out = await payWorkingOrderIntegrated(deps, cfg, { id, lines: [{ productId: cafe.id, quantity: "1" }] });
  expect(out.outcome).toBe("declined");
  // no sale filed; the working order exists and is 'open'; a failed payments row exists (audit).
});

it("a settled order replays its ticket without re-collecting", async () => {
  // pay once (captured), then pay again with the SAME id → { outcome: "captured", ticket } with the same invoiceNumber,
  // and provider.collect fired exactly ONCE (spy the FakeStripe / assert only one attempting+captured pair).
});

it("tips on: charges total+tip, files the sale at total, records tip on the tender", async () => {
  const { cfg, cafe } = await setupVenue();
  const { deps, client } = integratedDeps(); deps.tipsEnabled = true;
  const out = await payWorkingOrderIntegrated(deps, cfg, { id: crypto.randomUUID(), lines: [{ productId: cafe.id, quantity: "1" }], tip: "0.30" });
  expect(client.lastCreateIntent?.amount /* via a recorder */).toBe(/* 1.80 gross */);
  // fiscal sale.total = 1.50 (ex-tip); tenders row amount=1.80 tip_amount=0.30 (coverage identity holds).
});
```

- [ ] **Step 2 — Run → FAIL** (`payWorkingOrderIntegrated` does not exist).

- [ ] **Step 3 — Implement `payWorkingOrderIntegrated`** (the three-phase body; a walk-up path shown, placed-order pricing is 7c's helper):

```ts
export async function payWorkingOrderIntegrated(
  deps: IntegratedPayDeps, cfg: TillConfig, req: IntegratedPayRequest, operatorId?: string,
): Promise<IntegratedPayOutcome> {
  const providerId = deps.provider.provider;   // "stripe"
  // ---- P1 (tx A): resolve/replay/price; commit a walk-up order OPEN before the network ----
  const prepared = await withTenant(deps.db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const [locked] = await tx.select({ status: workingOrders.status }).from(workingOrders).where(eq(workingOrders.id, req.id)).for("update");
    if (locked?.status === "settled") return { kind: "replay" as const, ticket: await readSettledTicket(deps.backend, tx, cfg, req.id) };
    // 7c: `placed` is also payable; only a terminal non-settled state refuses.
    if (locked !== undefined && locked.status !== "open" && locked.status !== "placed") throw new AppError("working_order.not_open", { workingOrderId: req.id });
    if (req.lines.length === 0 && locked === undefined) throw new AppError("sale.empty_basket", {});
    // The §4 pre-check. A captured payment on an OPEN order → recovery (Task 5). None here → collect.
    const captured = await findCapturedPaymentForWorkingOrder(tx, { tenantId: cfg.tenantId, provider: providerId, workingOrderId: req.id });
    if (captured !== undefined && captured.saleId === null) return { kind: "recover" as const, captured };  // Task 5
    // Ordering detection: an outstanding sale already issued at placing → ordering 1 (Task 6).
    // (this task: none.) Price: walk-up creates+commits OPEN; a placed order files from locked lines (7c).
    let priced;
    if (locked === undefined) ({ priced } = await createOpenOrder(tx, cfg, req.id, req.lines, null));
    else priced = await priceLockedLines(tx, cfg, req.id);   // 7c seam
    return { kind: "collect" as const, priced };
  });
  if (prepared.kind === "replay") return { outcome: "captured", ticket: prepared.ticket };
  if (prepared.kind === "recover") return finalizeRecovery(deps, cfg, req, prepared.captured, operatorId);   // Task 5
  const { priced } = prepared;

  // ---- P2 (no tx): drive the reader. Timeout/decline/offline-refused are DATA, never a throw. ----
  const tip = deps.tipsEnabled ? decimal(req.tip ?? "0.00") : decimal("0.00");
  const result = await deps.provider.collect({
    tenantId: cfg.tenantId, tillId: cfg.tillId, workingOrderId: brandWorkingOrderId(req.id),
    amount: addDecimal(priced.total, tip), ...(req.allowOffline === undefined ? {} : { allowOffline: req.allowOffline }),
  });
  if (result.state !== "captured" && result.state !== "accepted_offline") return toPayOutcome(result, null);

  // ---- P3 (tx B): file + associate + settle, atomically; 23505 replays a concurrent winner. ----
  const ticket = await finalizeCapture(deps, cfg, req, priced, tip, result, operatorId);
  return { outcome: "captured", ticket };
}
```

`finalizeCapture` is the exact shape of `payWorkingOrder`'s `till-sale.ts:233-286`, minus the inline `recordManualCardPayment`, wrapped in the `23505`→`readSettledTicket` backstop of `:312-338`:

```ts
async function finalizeCapture(deps, cfg, req, priced, tip, result, operatorId): Promise<TillSaleResult> {
  try {
    return await withTenant(deps.db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const [locked] = await tx.select({ status: workingOrders.status }).from(workingOrders).where(eq(workingOrders.id, req.id)).for("update");
      if (locked?.status === "settled") return readSettledTicket(deps.backend, tx, cfg, req.id);
      const settledAt = result.settledAt!;   // non-null on captured/accepted_offline
      const { saleId, fiscal } = await recordSale(tx, deps.backend, {
        tenantId: cfg.tenantId, tillId: cfg.tillId, nodeId: cfg.nodeId, seriesId: cfg.seriesId,
        workingOrderId: brandWorkingOrderId(req.id), locale: cfg.locale, invoiceLocales: cfg.invoiceLocales,
        total: priced.total, lines: priced.lines, vatBreakdown: priced.vatBreakdown, fiscalBackend: "verifactu",
        clock: deps.clock, operatorId,
        settlement: { kind: "immediate", tenders: [{ method: "card", amount: addDecimal(priced.total, tip), tipAmount: tip, settledAt }] },
      });
      await associatePaymentWithSale(tx, { provider: result.provider, paymentRef: result.paymentRef, saleId, tenantId: cfg.tenantId });
      await tx.update(workingOrders).set({ status: "settled", settledAt: settledAt.toISOString() }).where(eq(workingOrders.id, req.id));
      // read back the ticket (invoiceNumber/qr/desglose) exactly as payWorkingOrder does (:297-310)
      return /* TillSaleResult */;
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return withTenant(deps.db, cfg.tenantId, async (tx) => { await asAppUser(tx); /* re-read settled → readSettledTicket */ });
  }
}
```

The pure outcome-mapper (unit-tested in Task 7):

```ts
export function toPayOutcome(result: PaymentResult, ticket: TillSaleResult | null): IntegratedPayOutcome {
  // captured + accepted_offline both chained a sale (settledAt set) → the captured wire arm.
  if (result.state === "captured" || result.state === "accepted_offline") return { outcome: "captured", ticket: ticket! };
  if (result.state === "network_unavailable") return { outcome: "network_unavailable" };
  // `failed` = a decline OR a poll-window stall (the provider collapses them, `provider.ts:165-180`);
  // surfaced as `declined`. A distinct `timeout` awaits the provider distinguishing the two — the
  // `stripe.collect_timeout`-declared-not-thrown gap; the till renders both the same (§8).
  return { outcome: "declined" };
}
```

- [ ] **Step 4 — Run → PASS.** `pnpm --filter @waitron/server test:coverage` unfiltered → PASS.
- [ ] **Step 5 — Commit** `-s` — `feat(server): integrated card pay — split-transaction P1/P2/P3, ordering 2`.

---

## Task 5 — Capture idempotency: the recovery window + concurrency (prove by deletion) — SEAM-REBASING

> **The genuinely-new hard part.** Extends 7b's `working_order_id` double-**file** guard to the double-**capture**.

**Files:**
- Modify: `apps/server/src/till-sale.ts` (`finalizeRecovery`, wired from Task 4's P1 pre-check branch)
- Test: `apps/server/src/till-sale-integrated.rls.test.ts` (**real Postgres** — the lost-T2 recovery, the concurrency race, and the corruption guard; all three are false passes on PGlite)

**Interface:**

```ts
// Finalize a lost-T2 captured payment (sale_id NULL, order open) WITHOUT re-charging: file from the
// stored locked lines (Decision 2), reconstruct the tip, associate THIS captured row. On a shortfall
// (captured.amount < locked total) file nothing and leave the payment for reconcile's orphan class.
async function finalizeRecovery(deps: IntegratedPayDeps, cfg: TillConfig, req: IntegratedPayRequest, captured: CapturedPaymentForOrder, operatorId?: string): Promise<IntegratedPayOutcome>;
```

- [ ] **Step 1 — Write the failing real-PG tests:**

```ts
it("recovers a lost-T2 captured payment: files from locked lines, no re-charge, links the existing row", async () => {
  const { cfg, cafe } = await setupVenue();
  const { deps, client } = integratedDeps();   // FakeStripe
  const id = crypto.randomUUID();
  // Simulate "collect committed, P3 never ran": create the order OPEN with a locked café line (1.50),
  // then insert a captured stripe payment for it with sale_id NULL (as collect's T2 would).
  await withTenant(suite.admin, cfg.tenantId, async (tx) => { await asAppUser(tx); await createOpenOrder(tx, cfg, id, [{ productId: cafe.id, quantity: "1" }], null); });
  await withTenant(suite.admin, cfg.tenantId, (tx) => insertCapturedPayment(tx, { tenantId: cfg.tenantId, workingOrderId: id, provider: "stripe", paymentRef: "pi-ref", amount: decimal("1.50"), settledAt: new Date(), externalRef: "pi_lost" }));
  const before = client.callCount ?? 0;   // a FakeStripe collect counter
  const out = await payWorkingOrderIntegrated(deps, cfg, { id, lines: [] });
  expect(out.outcome).toBe("captured");
  expect(client.callCount).toBe(before);         // collect NOT called again — no double-charge
  // the sale is filed at 1.50; the EXISTING payment (pi-ref) now carries the sale_id; the order is settled.
});

it("recovers with a reconstructed tip when the captured amount exceeds the locked total", async () => {
  // captured.amount 1.80 against a locked total 1.50 → files total 1.50, tender amount 1.80, tip_amount 0.30.
});

it("a captured amount BELOW the locked total is corruption: files nothing, leaves the payment for reconcile", async () => {
  // captured.amount 1.00 against locked total 1.50 → payWorkingOrderIntegrated throws (→ server.internal 500);
  // the captured payment still has sale_id NULL (reconcile's orphan class); no sale filed.
  await expect(payWorkingOrderIntegrated(deps, cfg, { id, lines: [] })).rejects.toBeDefined();
});

it("two concurrent pays for one parked order file ONE sale; the loser replays (one sale/settlement)", async () => {
  // Two DISTINCT app-role connections drive payWorkingOrderIntegrated for the SAME parked order id.
  // Assert: exactly one sales row for the order (sales_working_order_id_key), the loser returns
  // { outcome: "captured", ticket } with the same invoiceNumber. (The one-CHARGE guarantee across the
  // network sub-window is the Stripe key — proven in the sandbox, Task 1 — not the FakeStripe here.)
  const [a, b] = await Promise.allSettled([ payWorkingOrderIntegrated(depsA, cfg, req), payWorkingOrderIntegrated(depsB, cfg, req) ]);
  // both captured, one invoiceNumber, one sale row.
});
```

- [ ] **Step 2 — Run → FAIL** (`finalizeRecovery` unimplemented — Task 4 returns a `recover` marker with no handler).

- [ ] **Step 3 — Implement `finalizeRecovery`:**

```ts
async function finalizeRecovery(deps, cfg, req, captured, operatorId): Promise<IntegratedPayOutcome> {
  return withTenant(deps.db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const [locked] = await tx.select({ status: workingOrders.status }).from(workingOrders).where(eq(workingOrders.id, req.id)).for("update");
    if (locked?.status === "settled") return { outcome: "captured", ticket: await readSettledTicket(deps.backend, tx, cfg, req.id) };
    const priced = await priceLockedLines(tx, cfg, req.id);   // 7c seam — the SAME lines P1 priced, so total == charged by construction
    const capturedAmount = decimal(captured.amount);
    // Decision 2: never file a divergent total. A charge that cannot cover the locked total is
    // corruption — leave the captured payment (sale_id NULL) for reconcile's orphan class, never
    // inventing a fiscal figure (CLAUDE.md §5).
    if (compareDecimal(capturedAmount, priced.total) < 0) throw new Error(`recovery: captured ${captured.amount} below locked total ${priced.total} for working order ${req.id}`);
    const tip = subtractDecimal(capturedAmount, priced.total);   // reconstruct: charge was gross total+tip
    const settledAt = new Date(captured.settledAt!);
    const { saleId } = await recordSale(tx, deps.backend, { /* …as finalizeCapture, total: priced.total,
      settlement: { kind: "immediate", tenders: [{ method: "card", amount: capturedAmount, tipAmount: tip, settledAt }] } … */ });
    await associatePaymentWithSale(tx, { provider: deps.provider.provider, paymentRef: captured.paymentRef, saleId, tenantId: cfg.tenantId });
    await tx.update(workingOrders).set({ status: "settled", settledAt: settledAt.toISOString() }).where(eq(workingOrders.id, req.id));
    return { outcome: "captured", ticket: /* readback */ };
  });
}
```

(The thrown `Error` is a non-`AppError`, so `run` maps it to `server.internal` 500 — the recovery corruption path.)

- [ ] **Step 4 — Run → PASS.**

- [ ] **Step 5 — Prove the pre-check guard by deletion.** In Task 4's P1, delete the `findCapturedPaymentForWorkingOrder` branch (so recovery never fires). Re-run the "recovers a lost-T2 captured payment" test → `payWorkingOrderIntegrated` now **re-drives `collect`** (a second `attempting`→`captured` row appears — a double-capture), so `expect(client.callCount).toBe(before)` fails. That is the double-capture appearing. Restore. Confirm the negative control fails for the right reason (a second captured payments row against the same working order).

- [ ] **Step 6 — Gate.** `pnpm --filter @waitron/server test:coverage` unfiltered → PASS. Commit `-s`.

---

## Task 6 — Ordering 1 (invoice-first) settle path — SEAM-REBASING

> The riskier ordering (a decline leaves an **issued invoice unpaid** in the immutable chain). Built entirely from existing primitives — `settleSale` + `listOutstandingSales`.

**Files:**
- Modify: `apps/server/src/till-sale.ts` (the ordering-1 branch of `payWorkingOrderIntegrated`'s P1 detection + a `finalizeSettle` P3)
- Test: `apps/server/src/till-sale-integrated.rls.test.ts` (**real Postgres**)

**Interface:** no new exported signature — `payWorkingOrderIntegrated` gains an ordering-1 branch: when P1 finds an **outstanding sale** for the working order (issued at placing, `listOutstandingSales` by `sales.working_order_id`), P3 is `settleSale` rather than `recordSale`.

- [ ] **Step 1 — Write the failing real-PG tests:**

```ts
it("invoice-first: settles an already-issued outstanding invoice on capture (settleSale, not recordSale)", async () => {
  const { cfg, cafe } = await setupVenue();
  // Arrange: place + issue a DEFERRED sale for a working order (recordSale deferred → placed), leaving it outstanding.
  const { saleId, workingOrderId } = await placeDeferredSale(cfg, [{ productId: cafe.id, quantity: "1" }]);  // 7c placing helper
  const { deps } = integratedDeps();
  const out = await payWorkingOrderIntegrated(deps, cfg, { id: workingOrderId, lines: [] });
  expect(out.outcome).toBe("captured");
  // NO new sale is filed (still one sales row); a sale_settlements row now covers it; the stripe payment links to it.
});

it("a decline in invoice-first leaves the invoice OUTSTANDING (nothing re-filed, listOutstandingSales still lists it)", async () => {
  const client = new FakeStripe(); client.declineNext();
  // …place deferred, then pay → { outcome: "declined" }; the sale stays outstanding, unsettled, unvoided.
});

it("a double settle replays via sale.already_settled (idempotent close-out)", async () => {
  // pay twice → one sale_settlements row; the second returns { outcome: "captured", ticket }.
});
```

- [ ] **Step 2 — Run → FAIL** (no ordering-1 branch).

- [ ] **Step 3 — Implement.** In P1, after the pre-check, resolve an outstanding sale:

```ts
const outstanding = (await listOutstandingSales(tx, cfg.tenantId)).find((s) => /* s.workingOrderId === req.id — extend listOutstandingSales' row or query by working_order_id */);
if (outstanding !== undefined) return { kind: "settle" as const, outstanding };   // ordering 1
```

`finalizeSettle` (P3), guarded by `settleSale`'s own `sale.already_settled` (the `sale_settlements` UNIQUE / `WT002` trigger):

```ts
async function finalizeSettle(deps, cfg, req, outstanding, tip, result, operatorId): Promise<IntegratedPayOutcome> {
  return withTenant(deps.db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const settledAt = result.settledAt!;
    try {
      await settleSale(tx, { tenantId: cfg.tenantId, saleId: outstanding.saleId,
        tenders: [{ method: "card", amount: addDecimal(outstanding.amountDue, tip), tipAmount: tip, settledAt }] });
    } catch (e) {
      if (isAppError(e) && e.code === "sale.already_settled") return { outcome: "captured", ticket: await readSettledTicketBySale(...) };
      throw e;
    }
    await associatePaymentWithSale(tx, { provider: result.provider, paymentRef: result.paymentRef, saleId: outstanding.saleId, tenantId: cfg.tenantId });
    await tx.update(workingOrders).set({ status: "settled", settledAt: settledAt.toISOString() }).where(eq(workingOrders.id, req.id));   // placed → settled (7c)
    return { outcome: "captured", ticket: /* readback for the already-issued sale */ };
  });
}
```

The P2 `collect` amount for ordering 1 is `addDecimal(outstanding.amountDue, tip)` (`amountDue = total + correctionTotal`, `list-outstanding-sales.ts:70-72`). The recovery analogue (a lost-T2 capture on a placed order) settles instead of re-files, guarded by `captured.amount ≥ amountDue` — mirror Task 5's `finalizeRecovery` with a `settleSale` P3.

- [ ] **Step 4 — Run → PASS.** `pnpm --filter @waitron/server test:coverage` unfiltered → PASS. Commit `-s`.

---

## Task 7 — `POST /api/pay` route + the 200-with-outcome contract — SEAM-REBASING

**Files:**
- Modify: `apps/server/src/till-api.ts` (mount `POST /api/pay`; the outcome-mapper is `till-sale.ts`'s `toPayOutcome` from Task 4)
- Test: `apps/server/src/toPayOutcome.test.ts` (**PGlite/unit** — pure request/response shaping, no DB, so the light target is right; say so), `apps/server/src/till-api.rls.test.ts` (**real Postgres** — the route end to end)

**Interface:** `POST /api/pay` — session-guarded, blocking; body `{ id, lines, tip?, allowOffline? }`; response **200** `IntegratedPayOutcome`; genuine faults still throw and map via `run` (empty basket → `sale.empty_basket` 400, `working_order.not_open` → 409, corruption/other → `server.internal` 500).

- [ ] **Step 1 — Write the failing unit tests for the mapper:**

```ts
// PGlite/unit: toPayOutcome is a pure function of a PaymentResult — no DB, no privilege, no concurrency,
// so the hermetic light target is correct (CLAUDE.md §4).
it("maps captured/accepted_offline to the captured ticket arm", () => {
  const ticket = { invoiceNumber: "A/1" } as TillSaleResult;
  expect(toPayOutcome({ state: "captured" } as PaymentResult, ticket)).toEqual({ outcome: "captured", ticket });
  expect(toPayOutcome({ state: "accepted_offline" } as PaymentResult, ticket)).toEqual({ outcome: "captured", ticket });
});
it("maps failed to declined and network_unavailable to itself", () => {
  expect(toPayOutcome({ state: "failed" } as PaymentResult, null)).toEqual({ outcome: "declined" });
  expect(toPayOutcome({ state: "network_unavailable" } as PaymentResult, null)).toEqual({ outcome: "network_unavailable" });
});
```

And the failing route test (`till-api.rls.test.ts`, wiring a `FakeStripe`-backed provider into `TillApiDeps.cardProvider`):

```ts
it("POST /api/pay captures and returns { outcome: 'captured', ticket } (200)", async () => {
  const res = await app.request("/api/pay", { method: "POST", headers: sessionCookie, body: JSON.stringify({ id: crypto.randomUUID(), lines: [{ productId: cafe.id, quantity: "1" }] }) });
  expect(res.status).toBe(200);
  expect((await res.json()).outcome).toBe("captured");
});
it("POST /api/pay returns 200 { outcome: 'declined' } on a decline (NOT a 4xx)", async () => { /* declineNext → 200 declined */ });
it("POST /api/pay still 400s an empty basket (genuine fault via run)", async () => { /* sale.empty_basket → 400 */ });
```

- [ ] **Step 2 — Run → FAIL** (no route).

- [ ] **Step 3 — Implement the route** (wrapped in `run` for genuine faults; the orchestrator returns the outcome as **data**, serialised 200):

```ts
// Blocking integrated-card pay — a DELIBERATE divergence from /api/sales's throw-or-ticket shape:
// a payment outcome is neither a client (4xx) nor a server (5xx) fault, so the non-captured outcomes
// answer 200 as DATA (Decision 1). Genuine faults still throw and map through `run` (empty basket 400,
// working_order.not_open 409, corruption/other 500). Session-guarded; the operator is the attributor.
app.post("/api/pay", (c) =>
  run(c, log, async () => {
    const { personId } = await requireSession(deps, c);
    const body = await c.req.json<{ id: string; lines: { productId: string; quantity: string }[]; tip?: string; allowOffline?: boolean }>();
    /* v8 ignore start */ // structurally unreachable: the client only calls /api/pay when GET /api/till
    // reported an integrated cardProvider, so a `none` till never surfaces this route.
    if (deps.cardProvider === undefined) throw new Error("/api/pay: no integrated card provider configured");
    /* v8 ignore stop */
    const outcome = await payWorkingOrderIntegrated(
      { db: deps.db, backend: deps.backend, clock: deps.clock, provider: deps.cardProvider, tipsEnabled: deps.tipsEnabled },
      deps.cfg, body, personId,
    );
    return c.json(outcome);   // 200 with the discriminated outcome
  }),
);
```

- [ ] **Step 4 — Run → PASS.** `pnpm --filter @waitron/server test:coverage` unfiltered → PASS. Commit `-s`.

---

## Task 8 — Till API client `pay()` + `till-app` handler — SEAM-REBASING

**Files:**
- Modify: `apps/till/src/api/client.ts` (`pay(...)`, the `PayOutcome` union, `TillInfo` gains `cardProvider`/`tipsEnabled`), `apps/till/src/till-app.ts` (`#onCollectCard`)
- Test: `apps/till/src/api/client.test.ts`, `apps/till/src/till-app.test.ts`

**Interface:**

```ts
// client.ts
export type PayOutcome =
  | { outcome: "captured"; ticket: TillSaleResult }
  | { outcome: "declined" }
  | { outcome: "timeout" }
  | { outcome: "network_unavailable" };
export interface TillInfo { locale: string; venueName: string; nif: string; cardProvider: "none" | "stripe_terminal" | "stripe_on_device"; tipsEnabled: boolean; }
// on class TillApi:
pay(req: { id: string; lines: SaleLine[]; tip?: string; allowOffline?: boolean }): Promise<PayOutcome>;
```

- [ ] **Step 1 — Failing client test:**

```ts
it("POSTs /api/pay and returns the discriminated outcome", async () => {
  const fetchStub = stubJson({ outcome: "captured", ticket: { invoiceNumber: "A/1" } });
  const api = new TillApi("", fetchStub);
  const out = await api.pay({ id: "wo1", lines: [{ productId: "p", quantity: "1" }] });
  expect(out.outcome).toBe("captured");
  expect(fetchStub).toHaveBeenCalledWith("/api/pay", expect.objectContaining({ method: "POST", credentials: "include" }));
});
```

- [ ] **Step 2 — Run → FAIL.** **Step 3 — Implement** `pay` (mirrors `recordSale` `:164-166`, funnels through `#request`), add `cardProvider`/`tipsEnabled` to `TillInfo`. **Step 4 — PASS.**

- [ ] **Step 5 — `#onCollectCard` in `till-app.ts`** (mirrors `#onConfirmPayment` `:179-219`, single-flight via `submitting`, but branches on the outcome instead of assuming a ticket):

```ts
async #onCollectCard(event: Event): Promise<void> {
  if (this.submitting) return;
  this.submitting = true;
  const detail = (event as CustomEvent<CollectCardDetail>).detail;   // { tip?, allowOffline? }
  const lines = this.#store.lines;
  this.errorKey = undefined;
  try {
    const out = await this.api.pay({ id: this.#store.id, lines: lines.map((l) => ({ productId: l.product.id, quantity: l.quantity })), ...(detail.tip ? { tip: detail.tip } : {}), ...(detail.allowOffline ? { allowOffline: true } : {}) });
    if (out.outcome === "captured") {
      this.result = out.ticket; this.ticketLines = lines; this.screen = "ticket";
      await this.#refreshHeldOrders();
    } else {
      // declined | timeout | network_unavailable: stay on the counter, basket intact; the widget shows
      // retry / switch-tender (cash or manual card — nothing blocks the sale) / wait (§8, CLAUDE.md §5).
      this.cardOutcome = out.outcome;
    }
  } catch { this.errorKey = "sale.error"; }
  finally { this.submitting = false; }
}
```

(The `sale.error` catch is for a genuine server fault — incl. the recovery-corruption 500; the operator retries or switches tender.)

- [ ] **Step 6 — Test the handler branches** (captured → ticket + held refresh; declined → stays on counter, `cardOutcome` set, basket intact). **Step 7 — PASS.** Commit `-s`.

---

## Task 9 — `tender-pay` widget: collecting / declined states, Cancel, tip, offline — SEAM-REBASING

**Files:**
- Modify: `apps/till/src/widgets/tender-pay.ts` (states + affordances), `apps/till/src/i18n/strings.ts` (`en` + `es`)
- Test: `apps/till/src/widgets/tender-pay.test.ts`, `apps/till/src/widgets/tender-pay.a11y.test.ts`

**Interface / behaviour (spec §8, all UI-unit — the state machine is a pure DOM/event concern, so `@vitest/browser` unit tests are the right target; the DB/privilege justification does not apply, state so in a comment):**
- The widget learns `cardProvider` + `tipsEnabled` (passed from `till-app` off `GET /api/till`). When `cardProvider === "none"`, the **Card** button is the manual path (#62) unchanged; when integrated, tapping **Card** emits `collect-card` (with the optional tip and, for `stripe_on_device` only, an offline-consent toggle) and enters a **`collecting`** state.
- New `Mode` values: `"collecting"` (spinner + `t("card.collecting")` "Tap / insert card") and `"card_outcome"` (declined/timed-out — three actions: **retry** re-emits `collect-card`; **switch tender** returns to idle so cash / manual card is one tap away; **wait** stays in `collecting`).
- A **Cancel** on `collecting` is a **client-side abort** only (the provider has no `cancel` method — `PaymentProvider` is `collect`/`forward`/`void`/`refund`/`partialRefund`, `provider.ts:113-137`): it returns the widget to idle; the server-side poll continues to its terminal outcome and any later retry **replays** (safe via the §4 guard). A server-side reader-cancel endpoint is a deferred provider extension (flagged, not built).
- The tip entry (a numeric field) shows only when `tipsEnabled`; the offline-consent affordance shows only when `cardProvider === "stripe_on_device"`.

- [ ] **Step 1 — Failing widget tests:**

```ts
// UI unit (@vitest/browser): the collecting/declined state machine is a pure DOM+event concern — no
// DB, no privilege — so the hermetic browser target is correct (CLAUDE.md §4).
it("integrated Card enters the collecting state with a Cancel", async () => {
  el.cardProvider = "stripe_terminal";
  el.shadowRoot!.querySelector(".pay-card")!.dispatchEvent(new Event("click"));  // emits collect-card, mode → collecting
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".collecting")).toBeTruthy();
  expect(el.shadowRoot!.querySelector(".cancel")).toBeTruthy();
});
it("Cancel on collecting returns to idle (client-side abort, no event)", async () => { /* click .cancel → mode idle, no collect-card re-fired */ });
it("a declined outcome shows retry / switch-tender / wait", async () => {
  el.cardOutcome = "declined"; await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".retry")).toBeTruthy();
  expect(el.shadowRoot!.querySelector(".switch-tender")).toBeTruthy();
});
it("shows a tip entry only when tipsEnabled", async () => { /* tipsEnabled true → .tip-input present; false → absent */ });
it("shows the offline-consent toggle only for stripe_on_device", async () => { /* stripe_on_device → toggle; stripe_terminal → none */ });
it("with cardProvider 'none', Card is the manual path (confirm-payment card), unchanged", async () => { /* emits confirm-payment method:card, no collecting state */ });
```

- [ ] **Step 2 — Run → FAIL.** **Step 3 — Implement** the new `Mode` members, the `collect-card` event (`CollectCardDetail = { tip?: string; allowOffline?: boolean }`), the render branches, and the Cancel client-abort. Keep the existing manual-card `#confirmCard` path for `cardProvider === "none"`.

- [ ] **Step 4 — i18n** (`strings.ts`, `en` **and** `es` together):

```ts
// en
"card.collecting": "Tap or insert card…",
"card.cancel": "Cancel",
"card.declined": "Card declined",
"card.retry": "Retry card",
"card.switch_tender": "Use another tender",
"card.wait": "Keep waiting",
"card.tip": "Tip (optional)",
"card.offline_consent": "Accept offline if the network is down",
// es
"card.collecting": "Acerca o inserta la tarjeta…",
"card.cancel": "Cancelar",
"card.declined": "Tarjeta rechazada",
"card.retry": "Reintentar tarjeta",
"card.switch_tender": "Usar otro método de pago",
"card.wait": "Seguir esperando",
"card.tip": "Propina (opcional)",
"card.offline_consent": "Aceptar sin conexión si la red no funciona",
```

- [ ] **Step 5 — a11y** (`tender-pay.a11y.test.ts`): drive the widget into `collecting` and `card_outcome` in both themes. **Step 6 — Run → PASS.** `pnpm --filter @waitron/till test:coverage` unfiltered → PASS (`packages/ui` thresholds `95/95/90/88` apply only to `@waitron/ui`; `apps/till` is `98/98/98/95`). Commit `-s`.

---

## Task 10 — Demo script: FakeStripe through a capture — SEAM-REBASING

**Files:**
- Modify: `apps/server/scripts/*` (extend the park-retrieve / till demo with an integrated-card capture driven by `FakeStripe`), `apps/server/package.json` (a `demo:` entry if a new one is warranted)
- Test: covered by running the script (narration, not a Vitest suite — the demo scripts are excluded from coverage like the existing `park-retrieve-demo.ts`)

- [ ] **Step 1 — Extend the demo** to construct a `StripeTerminalProvider` over `FakeStripe`, call `payWorkingOrderIntegrated` through a capture, and narrate the P1/P2/P3 phases + the resulting ticket. Mirror the existing till-demo's structure.
- [ ] **Step 2 — Run the demo** end to end against a fresh container; confirm a captured ticket prints. Commit `-s`.

---

## Self-review (run before the PR; fix inline)

### (1) Spec-coverage — every spec section maps to a task

| Spec § | Requirement | Task(s) |
| --- | --- | --- |
| §1, §2 | Drive a real reader/Tap-to-Pay; consume the two adapters + the `collect → recordSale → associate` seam | 3 (wiring), 4/6 (drive) |
| §3 | The split-transaction P1/P2/P3 flow, both orderings; walk-up creates OPEN before the network; pricing = filed total by construction | 4 (ordering 2), 6 (ordering 1) |
| §3 Pricing / Decision 2 | Recovery files from stored locked lines; never a divergent total | 5 |
| §4 Layer 1 | The capture pre-check helper + its use | 2 (helper), 4 (use), 5 (recovery + prove-by-deletion) |
| §4 Layer 2 | Stripe key derived from `workingOrderId`, decoupled from `paymentRef` | 1 |
| §5 | Per-node provider selection (`WAITRON_TILL_CARD_PROVIDER`), per-tenant key reuse, config-error codes | 3 |
| §6 | Offline — only mode 3; `allowOffline` surfaced only for `stripe_on_device`; `accepted_offline` chains | 3/4/9 |
| §7 | Tips — per-node flag, till-entered, gross to the provider, absent from the fiscal total | 3 (flag), 4 (arithmetic), 9 (entry) |
| §8 / Decision 1 | Blocking `POST /api/pay`, 200-with-outcome; the collecting / declined UX; client-abort Cancel | 7 (route), 8 (client/handler), 9 (widget) |
| §9 | Fiscal invariants (nothing blocks a sale; outbox; immutability) | honoured across 4/6/9 (switch-tender always available) |
| §10 | No `packages/db` migration; reuse codes | Global Constraints |
| §11 | Real-PG vs light targets; extend sandbox; gate unfiltered; `inmutabilidad` NOT required | per-task test targets + Global Constraints |
| §12 | Demo extension | 10 |
| §13 | Deferred (split tender, on-device tip prompt, provider UI, refund/void UI, server-side cancel, forward loop, SumUp) | out of scope — none built |

**No spec requirement was left un-tasked.** One requirement is expressed as a *reachability caveat* rather than built code: the `timeout` outcome arm (§8) — the provider collapses a stall into `failed`→`declined` today (`stripe.collect_timeout` declared-not-thrown), so the server never constructs `timeout`; it lives in the wire union for a future provider version and the till renders it identically to `declined` (Decision 1). This is a faithful reading of §8 against the provider's real return shape, not a gap.

### (2) Placeholder scan
No task says "similar to Task N" — each carries its own inline test + implementation. Elisions are only real-code read-backs already specified verbatim in the source (`payWorkingOrder`'s ticket read-back `till-sale.ts:297-310`, the `23505` replay `:312-338`) and are cited by `file:line` rather than re-transcribed. The 7c seam calls (`priceLockedLines`, `placeDeferredSale`, `readSettledTicket`) are named as the rebase surface, not left as `TODO`.

### (3) Type consistency across tasks
- **The provider key change (Task 1)** does not alter any exported signature — `StripeClient.createPaymentIntent` / `StripeDeviceClient.collectOnDevice` keep their shapes; only the *value* of `idempotencyKey` changes. So Tasks 3/4/6, which construct the providers and call `collect`, compile unchanged against `CollectParams` (`provider.ts:50-61`, unchanged).
- **`findCapturedPaymentForWorkingOrder`'s return type `CapturedPaymentForOrder` (Task 2)** is the exact shape Task 4's P1 pre-check and Task 5's `finalizeRecovery` consume: `.saleId` (null → recovery), `.amount`/`.settledAt` (reconstruct the tender), `.paymentRef` (associate the existing row). Fields are the raw column strings (`amount`, `settledAt`), matching `PaymentRow`'s convention (`store.ts:13-23`) — the seam parses `decimal(captured.amount)` / `new Date(captured.settledAt!)`.
- **`IntegratedPayOutcome` (Task 4)** is mirrored exactly by the client's `PayOutcome` (Task 8) and the widget's outcome branches (Task 9) — same four arms, `captured` carrying `ticket: TillSaleResult` (the client's local mirror of the server type, `client.ts:84-92`).
- **`toPayOutcome` (Task 4)** returns `IntegratedPayOutcome`; the route (Task 7) serialises it directly; its unit test (Task 7) asserts the exact arms. `PaymentResult.state` is `PaymentResultState` (`provider.ts:42`) — the mapper's `captured`/`accepted_offline`/`network_unavailable`/`failed` branches cover every reachable value.
- **`TillConfig` (Task 3)** gains `cardProvider`/`stripeReaderId?`/`tipsEnabled`; `TillApiDeps` gains `cardProvider?: PaymentProvider`/`tipsEnabled: boolean`; `IntegratedPayDeps = TillSaleDeps & { provider; tipsEnabled }` — the route builds `IntegratedPayDeps` from `TillApiDeps` at the call site, so a `none` till (no `cardProvider`) is caught by the route's structurally-unreachable guard, never reaching `payWorkingOrderIntegrated` with an absent provider.

---

## Composition note (the parallel plan, spec §10 / 7c §8)

- **7c lands first** (it owns the `0030` migration, placing, the two orderings, the locked-lines filing change, and the shared till-seam restructure).
- **This branch (`feat/integrated-card-terminal`) develops concurrently** in the `packages/payments` lane. Tasks 1-2 (`packages/payments-stripe`, `packages/payments`) have **no 7c dependency** and build immediately. Tasks 3-10 touch the shared seam (`till-sale.ts` / `till-api.ts` / `tender-pay.ts`) and are **written against the 7c target shape**; **rebase onto 7c before merge** — the honest cost is a localised merge of the tender/settlement block and one widget, and because this branch adds **no `packages/db` migration** there is no `_journal.json` collision.
- 7c must merge first so this branch rebases onto a settled seam, never the reverse.
