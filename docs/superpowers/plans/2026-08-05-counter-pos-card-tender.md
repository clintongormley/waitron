# Counter POS — Manual Card Tender Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the counter till take a **manual (unintegrated) card tender** — the *datáfono* case — beside cash: the operator runs the card on a separate bank terminal, taps Card, and the till files the same legal ticket with a `card` tender and a captured payment-ledger row.

**Architecture:** Pure wiring. `tender_method` already includes `"card"` and `recordManualCardPayment` already exists, makes **no network call**, and is documented to run **inside** the sale transaction alongside `recordSale` + `associatePaymentWithSale` (`packages/payments/src/manual.ts:36-58`). So the tender path generalises from cash-only to a `{ cash | card }` union; the card branch adds the two payment-ledger calls in the same transaction. No migration, no new payment machinery, no integrated-terminal network/timeout handling (that is a separate later slice).

**Tech Stack:** TypeScript (ESM), Drizzle + PostgreSQL, Hono, Lit 3 (`apps/till`), Vitest (+ `@vitest/browser`, Testcontainers).

## Global Constraints

- **This branch rebases on `feat/counter-pos-park-retrieve` (7b).** It builds on `payWorkingOrder` / the generalised `recordTillSale` and the `workingOrderId`-on-`recordSale` seam from that plan. Land 7b first, then branch `feat/counter-pos-card-tender` off it. Rebase before merge.
- Coverage thresholds, real-PG-for-privileges/concurrency, `TESTCONTAINERS_RYUK_DISABLED=true`, domain-named error codes with `import "./errors.js"`, `git commit -s` — all as in the 7b plan's Global Constraints (`CLAUDE.md` §§2-4).
- **No new migration.** If you reach for one, stop — the enum value and the `payments` table already exist.
- **Manual card commits atomically inside the sale tx** — no orphan window, no idempotency coupling beyond the sale's own (7b's `working_order_id` UNIQUE covers the lost-response retry for card exactly as for cash).

---

## File Structure

- `apps/server/src/till-sale.ts` — widen `TillSaleRequest.tender` to `{ method: "cash" | "card"; amount: string; externalRef?: string }`.
- `apps/server/src/working-order.ts` — in `payWorkingOrder`, the `card` branch: `recordManualCardPayment` + `associatePaymentWithSale` inside the tx; `tenders` row `method: "card"`; amount == total.
- `apps/server/src/errors.ts` — reuse `sale.unsupported_tender` for the still-refused methods; add nothing unless a new fault appears.
- `apps/till/src/api/client.ts` — a `Tender` union (`CashTender | CardTender`); `recordSale` accepts it.
- `apps/till/src/widgets/tender-pay.ts` — a **Card** button beside Cash; `ConfirmPaymentDetail` becomes a union; card path confirms the total with no change pad, optional `externalRef`.
- `apps/till/src/till-app.ts` — `#onConfirmPayment` passes the union tender through unchanged.
- `apps/till/src/i18n/strings.ts` — `"tender.card"` (+ `es`).
- `apps/server/scripts/*` — extend the park-retrieve demo (or `demo:till`) to also pay by card.

---

## Task 1: Server — the card tender path

**Files:**
- Modify: `apps/server/src/till-sale.ts` (the `TillSaleRequest` type), `apps/server/src/working-order.ts` (`payWorkingOrder`)
- Test: `apps/server/src/working-order.rls.test.ts` (**real Postgres** — asserts the payment-ledger row + association; a captured payment is a privilege/RLS-scoped write)

**Interfaces:**
- Consumes: `recordManualCardPayment(tx, { tenantId, workingOrderId, amount, settledAt, externalRef? }): Promise<{ provider, paymentRef, settledAt }>` and `associatePaymentWithSale(tx, { provider, paymentRef, saleId, tenantId? })` (`@waitron/payments`; `store.ts:254`, `manual.ts:43`). Confirm `@waitron/payments` is a dependency of `apps/server` (it is used by `webhook.ts`/`reconcile-duty.ts`); if `payWorkingOrder`'s module lacks the import, add it.
- Produces: `payWorkingOrder`/`recordTillSale` accept `tender.method` `"cash" | "card"`; `"voucher"|"transfer"|"other"` still throw `sale.unsupported_tender`.

- [ ] **Step 1: Write the failing tests.**

```ts
it("files a card sale with a card tender AND a captured manual payment linked to the sale", async () => {
  const id = crypto.randomUUID();
  const res = await payWorkingOrder({ db, backend, clock }, cfg, {
    id, lines: [{ productId: cafeId, quantity: "1" }],   // total 1.50 say
    tender: { method: "card", amount: "1.50" },
  });
  expect(res.change).toBe("0.00");                        // no change on card
  // a tenders row for the sale with method 'card'
  // a payments row: provider 'manual', state 'captured', sale_id = the filed sale
});
it("card amount must equal the total (no under/over-tender path)", async () => { /* amount != total → refused or normalised; assert the filed tender == total */ });
it("still refuses voucher/transfer/other with sale.unsupported_tender", async () => { ... });
it("card lost-response retry replays the SAME ticket (7b idempotency covers card)", async () => { /* two card pays, same id → one sale, one payment */ });
```

- [ ] **Step 2: Run → FAIL** (card rejected today by the cash-only guard).

- [ ] **Step 3: Implement.** Widen `TillSaleRequest.tender` to `{ method: "cash" | "card"; amount: string; externalRef?: string }`. In `payWorkingOrder`, replace the cash-only refusal: allow `cash` and `card`, keep throwing `sale.unsupported_tender` for anything else. Branch after pricing:
  - **cash** — unchanged (coverage/change as 7b, `till-sale.ts:92-100`).
  - **card** — the settled amount is the total exactly (no change; `change = "0.00"`). Pass `settlement.tenders: [{ method: "card", amount: priced.total, tipAmount: "0.00", settledAt: clock.now().instant }]` to `recordSale`. After `recordSale` returns `saleId`, in the SAME tx: `const { provider, paymentRef, settledAt } = await recordManualCardPayment(tx, { tenantId: cfg.tenantId, workingOrderId: req.id, amount: decimal(priced.total), settledAt: clock.now().instant, externalRef: req.tender.externalRef })` then `await associatePaymentWithSale(tx, { provider, paymentRef, saleId, tenantId: cfg.tenantId })`. Use ONE clock reading (`recordSale` already reads its own for the fiscal record — reuse `deps.clock.now().instant` for the tender/payment `settledAt`, the repo's one-reading-per-event discipline).

- [ ] **Step 4: Run → PASS**, then `pnpm --filter @waitron/server test:coverage` → PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(server): manual card tender — captured payment linked in the sale tx"`

---

## Task 2: Till — Card button on the tender widget

**Files:** Modify `apps/till/src/api/client.ts`, `apps/till/src/widgets/tender-pay.ts`, `apps/till/src/i18n/strings.ts`; Tests `tender-pay.test.ts`, `tender-pay.a11y.test.ts`.

**Interfaces:**
- Produces: `client.ts` — `CardTender = { method: "card"; amount: string; externalRef?: string }`, `Tender = CashTender | CardTender`; `recordSale(lines, tender: Tender, workingOrderId)`. `tender-pay.ts` — `ConfirmPaymentDetail = { method: "cash"; amount } | { method: "card"; amount; externalRef? }`; a **Card** button in the idle view.

- [ ] **Step 1: Write the failing tests.** In `tender-pay.test.ts`: an idle **Card** button appears beside Pay, disabled on an empty basket; clicking it emits `confirm-payment` with `{ method: "card", amount: <total> }` (the card path skips the tendered/change entry — amount IS the total); an optional `externalRef`, when entered, rides along. a11y: drive the widget into the card mode in both themes.

```ts
it("emits confirm-payment method:card with amount == total, no change entry", async () => {
  const store = new WorkingOrderStore();
  store.addProduct(cafe, "1");                 // total 1.50
  const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
  const spy = vi.fn();
  el.addEventListener("confirm-payment", (e) => spy((e as CustomEvent).detail));
  click(el, ".pay-card");
  await el.updateComplete;
  click(el, ".confirm");
  expect(spy).toHaveBeenCalledWith({ method: "card", amount: "1.50" });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.** In `client.ts` add the `CardTender`/`Tender` types and widen `recordSale`'s param to `Tender`. In `tender-pay.ts`: add a `.pay-card` `<wt-button>` beside the cash Pay in `#renderIdle` (`tender-pay.ts:216-228`), disabled when `store.lineCount === 0 || busy`; a `mode: "card"` (extend the `Mode` union) whose view shows the total, an optional `externalRef` `<wt-input>`, and a Confirm that emits `confirm-payment` `{ method: "card", amount: this.store.total (as string), externalRef? }` (no numeric pad, no change row). Add `"tender.card"` to `en` **and** `es` in `strings.ts`.

- [ ] **Step 4: Run → PASS** (behaviour + a11y).
- [ ] **Step 5: Commit** — `git commit -s -m "feat(till): Card tender button (manual datáfono path)"`

---

## Task 3: Till — app confirm handler passes the union tender

**Files:** Modify `apps/till/src/till-app.ts`; Test `apps/till/src/till-app.test.ts`.

**Interfaces:**
- Consumes: `ConfirmPaymentDetail` (union). Produces: `#onConfirmPayment` forwards the union tender to `api.recordSale(lines, tender, store.id)`.

- [ ] **Step 1: Write the failing test** — emit `confirm-payment` `{ method: "card", amount: "1.50" }`; assert `api.recordSale` was called with the mapped lines, that tender, and `this.#store.id`; the ticket screen shows.

- [ ] **Step 2: Run → FAIL** (the handler is typed to `CashTender` only, or drops `externalRef`).

- [ ] **Step 3: Implement.** In `#onConfirmPayment` (`till-app.ts:139-165`), type `tender` as the `Tender` union and pass it straight through to `api.recordSale(lines.map(...), tender, this.#store.id)` (the `workingOrderId` arg from 7b Task 9). No branching needed — the server distinguishes cash/card.

- [ ] **Step 4: Run → PASS**, then `pnpm --filter @waitron/till test:coverage` → PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(till): forward cash/card union tender from the counter"`

---

## Task 4: Demo + gate

**Files:** Modify a demo script under `apps/server/scripts` (the park-retrieve demo from 7b, or `demo:till`).

- [ ] **Step 1: Extend the demo** to ring one sale by **card** — assert the ticket files and a `payments` row (`provider = 'manual'`, `state = 'captured'`) is linked to the sale.
- [ ] **Step 2: Run** `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server demo:...` → a card sale files with its captured payment.
- [ ] **Step 3: Full gate** — `pnpm lint && pnpm typecheck && pnpm format:check`, then `test:coverage` for `@waitron/server` and `@waitron/till`. (No schema changed, so `inmutabilidad` is unaffected — but a quick `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` costs nothing.)
- [ ] **Step 4: Commit** — `git commit -s -m "feat: card-tender demo + gate"`

---

## Notes for the executor

- **Rebase on 7b first.** Every task here assumes `payWorkingOrder`, the generalised `recordTillSale`, `sales.working_order_id`, and `recordSale(workingOrderId)` already exist. On a fresh branch without 7b these tasks do not compile.
- **The only shared-seam conflict with 7b** is `recordTillSale`'s tender block and `tender-pay.ts`'s idle view. 7b restructured both; this slice adds one branch/one button. Resolve any rebase conflict by keeping 7b's structure and inserting the `card` case.
- **Cash gets no `payments` row; card gets one.** Cash is a tender only; a manual card tender is a tender **and** a captured payment-ledger row (for reconciliation), linked by `associatePaymentWithSale`. Do not add a payments row for cash.
- **No integrated terminal here.** `recordManualCardPayment` makes no network call by design (`manual.ts:36-42`). The retry/timeout/orphan handling of a real reader is a separate future slice and must not leak in.
