# A placed order takes one payment at a time — implementation plan (A526)

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax. Every task is test-first: write the failing test, run it, watch it fail
> for the reason the step states, then write the smallest code that passes.

**Status:** plan, 2026-10-12. Not started. Nothing here is built.

**Goal:** while a card payment of a PLACED order is at a reader (or its outcome is still unknown, or
it was charged and no sale records it yet), a cash or hand-keyed card collect of that order, and a
second card payment of it, are refused with `order.payment_in_flight` (409), writing nothing and
asking no reader. Pressing Pay again to file a card that was already charged is never refused.

**Architecture:** one existing check, `refusePlacedPaymentInFlight` (`apps/server/src/till-sale.ts`),
already answers "is a card payment of this placed order in flight?" — a card collection of it
running in this process (the in-process list `liveAttemptsOf`), or a `payments` row that is
`attempting`, or captured / accepted offline with no sale (`ordersWithUnfiledPayment`). Today it runs
only when a request would change the order's receipt language or invoice choice. This plan calls it
from the two places that take money for a placed order: the collect transaction (`runCollectOrder`)
and the first transaction of the card payment (`payIntegrated`'s P1). Because every write
transaction runs alone on the venue file, and the card payment registers itself in the in-process
list inside its own P1 transaction, the check in one request and the registration in another cannot
interleave. No migration, no new table, no new error code.

**Tech stack:** TypeScript, Hono (server routes), Vitest in Node with a real venue database
(`useVenueDb`) and real Veri\*Factu filing for the server; Lit and Vitest in real headless Chromium
for the till.

**Spec:** the owner's queue text for A526, and the backlog entry and detail section it names. All
three are quoted verbatim.

> A526. A placed order cannot be charged twice while its card is at the reader. Spec: the backlog
> entry A497 added, 'A placed order can be charged twice while its card is at the reader' in
> docs/backlog.md, and its detail section in docs/backlog/payments.md — read both in FULL on current
> main and quote. Measured at main 126cd3ad2: with a placed order's card payment held at the reader,
> a cash collect answered 200 and filed a sale, then the card captured too (a captured card payment
> no sale records); a second /api/pay also answered 200 and both cards captured.
> Fix: refuse collect and pay on a placed order while a card payment is in flight, with
> order.payment_in_flight. Find EVERY route that can take money for a placed order (cash collect,
> /api/pay, the bill-payment routes, the find-bill pay) by following the call chains, not by name;
> list them in the PR and say which ones the refusal covers and why any is left out.
> Tests first: reproduce each double charge through the real routes (failing test printed before the
> fix), assert the domain error code, and keep a case proving the legitimate path still pays (a
> normal card payment, and cash after a card payment was cancelled or declined). Concurrency: two
> requests at once on the same order — one must win, one refused.
> Path: FULL (money path, concurrency). No migration expected; if one is needed, say so.

`docs/backlog.md` (Payments area, the entry A497 added), verbatim:

> - **A placed order can be charged twice while its card is at the reader — OPEN (found 2026-10-11
>   during A497's review, measured at main 126cd3ad2).** A cash collect or a second `/api/pay` on it
>   answers 200, and both payments go through while only one is recorded on a sale. Next: refuse
>   collect and pay on a placed order while a card payment is in flight (`order.payment_in_flight`).
>   [Detail](backlog/payments.md#a-placed-order-can-be-charged-twice-while-its-card-is-at-the-reader)

`docs/backlog/payments.md`, section "A placed order can be charged twice while its card is at the
reader", verbatim:

> **OPEN (found 2026-10-11 during A497's review, measured at main 126cd3ad2).** With a placed order's
> card payment held at the reader, a cash collect answered 200 and filed a sale, and the card then
> captured too, leaving a captured card payment no sale records. A second `/api/pay` also answered
> 200, and both cards captured with one sale recording a payment. A497 refuses these only when they
> would change the receipt language (`refusePlacedPaymentInFlight`, `apps/server/src/till-sale.ts`).
> Fix: refuse collect and pay on a placed order while a card payment is in flight
> (`order.payment_in_flight`).

**Audited base.** Every pointer below was READ on main `df3048a42` (2026-10-12) in the worktree
`/Users/clintongormley/workspace/worktrees/waitron-feat-service-placed-order-one-payment`, branch
`feat/service-placed-order-one-payment`. Line numbers drift; search by the quoted text. What the
author RAN, rather than read:

- `pnpm --filter @waitron/server exec vitest run src/till-sale-integrated.db.test.ts -t "concurrent
  winner|two concurrent pays for one placed order|a concurrent collect that settles the invoice
  first"` — 3 passed. Each of those cases pins today's behaviour: a cash collect of a placed order
  answers successfully while that order's card payment is between its first and last transaction,
  and two card payments of one placed order both reach a reader.
- `pnpm --filter @waitron/server exec vitest run src/cancel-invoiced-order.test.ts -t "either of two
  cards"` — 1 passed: two card payments of one placed order, each with its own fake reader, both
  reach their reader at once.

The author did not re-run the 126cd3ad2 measurement the spec quotes; Task 1 and Task 2 reproduce it
through the routes as their failing tests. Everything else in this plan is reading.

**Review path: FULL** (per-task reviews, then the full `/finish-branch` wave with the two Codex
run-it reviews side by side). Risk triggers: money and the fiscal record (a sale filed beside a card
that is also charged), and concurrency (two requests on one order).

**No migration.** A placed order cannot carry the database mark open orders use:
`working_orders_enforce_transition` refuses a placed order's `payment_attempt_at` being set (the
comment at `till-sale.ts` ~1164–1166, and the transition rules at
`packages/db/src/schema/orders.ts` ~51–60). The check reads the in-process list and the existing
`payments` table, both of which exist today.

---

## Where money can be taken for a placed order

Found by following each route handler to the place that writes a sale, a settlement, a tender or a
`payments` row, and by grepping every caller of `collectOrder`, `payWorkingOrderIntegrated`,
`recordTillSale`, `payWorkingOrder`, the `*Orchestration` variants, `takeBillPayment`,
`takeReaderBillPayment`, `settleSale`, `recordManualCardPayment`, `completeBillPayment` and
`settleIssuedOwingNothing` outside test files. A placed order cannot go back to open (the transition
rules above), so a route that requires an open order can never take money for a placed one.

| # | Route (till action) | Handler | Chain to the money write | Refuses while a card of the order is in flight today? | This plan |
| --- | --- | --- | --- | --- | --- |
| 1 | `POST /api/working-orders/:id/collect`, cash tender (counter Collect; a presented party bill's Pay, `#onPayTab`; Find a bill's Pay, `#onFindBillPay`) | `till-api.ts` ~2201 | `collectOrder` (`till-sale.ts` ~107) → `runCollectOrder` (~1915) → with an issued invoice: `settleSale` (~1956); without: `fileImmediateSale` (~1999) | **No.** Only when the request also sends a different receipt language, and only on the no-invoice branch (`storeSentReceiptLanguage` ~1997 → ~477) | **Covered** (Task 1) |
| 2 | Same route, hand-keyed card tender | same | as 1, plus `recordManualCardPayment` (~1970, or inside `fileImmediateSale` ~902) | **No**, as 1 | **Covered** (Task 1) |
| 3 | `POST /api/pay` (counter Card on the collect stage, `#collectCard`) | `till-api.ts` ~1626 | `payWorkingOrderIntegrated` (~116) → `runIntegratedPay` (~996) → `payIntegrated` (~1030): P1 holds the attempt (~1105 for an issued invoice, `settle`; ~1178 without, `collect`), P2 `provider.collect` (~1208), P3 `finalizeSettle` (~1733) or `finalizeCapture` (~1418) | **No.** Only a different receipt language (~1121 → ~477). The open-order refusal at ~1111–1117 reads the mark, which a placed order never has | **Covered** (Task 2) |
| 3r | Same route when a card was already charged and no sale records it (`recover` / `recover-settle`, ~1083–1093) | same | `finalizeRecovery` (~1546) / `finalizeSettleRecovery` (~1801); asks no reader | n/a | **Deliberately not refused** (decision 2): it charges nothing, and is how a charged card gets filed |
| 4 | Find a bill → Pay (cash or hand-keyed card) | till `widgets/find-bill-dialog.ts` ~227–252 → `till-app.ts` `#onFindBillPay` ~4017 → `api.collectOrder` | route 1/2 | as 1 | **Covered** through route 1/2; till message in Task 4 |
| 5 | A presented party bill's Pay | till `#onPayTab` ~8406 → `api.collectOrder` when `bill.status === "placed"` | route 1/2 | as 1 | **Covered** through route 1/2; till message in Task 4 |
| 6 | `POST /api/sales` (counter cash or hand-keyed card) | `till-api.ts` ~1585 | `recordTillSale` (~98) → `runTillSale` (~2051) → `runPayWorkingOrder` (~581) | A placed order is refused `working_order.not_open` at ~610 before anything is written | **Left out:** takes no money for a placed order |
| 7 | `POST /api/working-orders/:id/payments` (bill payment: cash, hand-keyed card, reader card) | `bill-payments-api.ts` ~213 | `takeBillPayment` (`bill-payments.ts` ~1084) / `takeReaderBillPayment` (~1255) → `beginBillPayment` (~1010) → `requireOpenBill` (~899, called ~1037) | A placed order is refused `working_order.not_open` before any write (a retry of an EARLIER payment replays first, ~1026–1035, and takes nothing new) | **Left out:** takes no money for a placed order. Placing also refuses a bill holding any pending or received bill payment (`placeOrder`, `working-order.ts` ~5666–5667) |
| 8 | `POST /api/working-orders/:id/payments/preview` | `bill-payments-api.ts` ~202 | writes nothing | n/a | Left out: writes nothing |
| 9 | `POST /management-api/payments/stuck/:id/resolve` | `payments-api.ts` ~956 | files a charged card through `payWorkingOrderIntegratedOrchestration` with a provider that cannot collect (~1015) | Refuses any order not `open` with a mark (`payment.not_stuck`, ~973–980) | Left out: never reaches a placed order; asks no reader |
| 10 | Bill-payment resolve / attest (`payments-api.ts` ~1091, ~1158), the bill-payment loop (`bill-payments-loop.ts` ~128) | — | `completeBillPayment` | Only bill payments, which only an open bill can start (row 7) | Left out |
| 11 | `POST /api/parties/:id/unpaid-departure` | `unpaid-departure-api.ts` ~46 | `recordUnpaidDeparture` (`unpaid-departure.ts`): may file an invoice for a presented bill (`issueUnpaidInvoice` ~115) or settle one owing nothing (`settleIssuedOwingNothing` ~130) | Its in-flight check covers open bills only (`refusePaymentInFlight(tx, [...openIds])`, ~101) | **Left out** (decision 6): takes no money. Read, not run: a departure recorded while a presented bill's card is at the reader may leave that card charged with no sale. Becomes a backlog entry (Task 5) |
| 12 | `POST /api/working-orders/:id/cancel` | `till-api.ts` ~2233 → `cancelPlacedOrder` (`working-order.ts` ~5840) | credits and abandons; takes no money | **Yes** (C126, ~5858–5864) | Unchanged |
| 13 | Simulator routes (`/management-api/demo-reader/payments/:id/decision`, `/api/demo-reader/cancel`, `till-api.ts` ~1079, ~1097) | — | decide or decline an attempt already running; start none | n/a | Left out |
| 14 | Provider sweeps (`resolvePending`, `boot.ts` ~414) | not a route | finish an existing `payments` row; never start a charge | n/a | Left out |

The PR description carries this table (Task 5 Step 5).

---

## The race, and how one request wins

**Where the window is.** A card payment is three phases (`payIntegrated`, doc at `till-sale.ts`
~957–986): P1 is one write transaction that decides what to charge; P2 calls the provider with no
transaction open (the reader wait, seconds to minutes); P3 is a second transaction that files or
settles. Today a placed order's P1 records nothing anyone checks except the cancel, so any request
arriving during P2 sees an unsettled placed order and goes ahead.

**What serialises the check and the registration.** Read, not run:

- Every `withTransaction` body runs through the store's write queue
  (`packages/db/src/tenancy.ts` ~30–42 → `db.withWriteLock`), which chains each body behind the
  previous one and runs it from `begin immediate` to `commit` before the next starts
  (`packages/store/src/write-queue.ts` ~28–38 `enqueue`, ~40–65 `run`).
- The card payment registers itself in the in-process list INSIDE its P1 body: `onPlacedCollect()`
  at ~1105 (issued invoice) and ~1178 (no invoice) calls `holdPlacedAttempt` (~1019–1022, ~1292),
  which puts the order in `liveAttemptsOf` (~1259, a `perDatabase` map,
  `apps/server/src/live-in-process.ts` ~8–19). It is taken out in `runIntegratedPay`'s `finally`
  (~1024–1027), after P3 has committed or the attempt has failed.
- The new check (`refusePlacedPaymentInFlight`, ~1272) reads that list inside the refusing request's
  own transaction body. So whichever body runs first decides: if the card's P1 ran first, the list
  holds the order and the second request is refused; if a collect ran first, it settled the order,
  and the card's P1 reads `settled` and replays the collect's ticket without asking a reader
  (~1054–1059). Once P3 commits the order is settled, so a request arriving between P3's commit and
  the `finally` replays too.
- After the `finally`, the database half of the same check still refuses while a `payments` row of
  the order is `attempting` (a reader timeout, or a crash mid-collect), or captured with no sale (P3
  failed or the process died after the charge) — `ordersWithUnfiledPayment` (~1318).

**What the check does not see.** A second process on the same venue: there is none, one process owns
a venue folder (`openVenueStore`'s lock, CLAUDE.md §3). A provider that writes its `payments` row
only after the money moves (Stripe's on-device Tap to Pay) once this process has forgotten the
attempt: not used today (`docs/backlog.md` "Slice 2 — the handheld NFC/QR link" names restoring it).

**The tests that would fail if the window were open** (designed in Task 2):

1. A held reader (FakePaymentProvider `holdNextCollect`, `packages/payments/src/testing/fake-provider.ts`
   ~125–133) keeps till 1's card in P2 while till 2 sends `/api/pay` and a cash collect. Fails today
   (both 200, and till 2's reader is asked).
2. Two card payments started in the same tick, each with its own held fake reader, as
   `cancel-invoiced-order.test.ts` ~1494 does today: exactly one reaches its reader and the other is
   refused before asking its reader. Today both reach their readers — that existing case passes on
   `df3048a42` (run above), so the new case fails today.
3. A mutation run the implementer must report: move `onPlacedCollect()` out of the P1 body (register
   after `withTransaction` returns) and run cases 1 and 2. Case 1 will not catch it (the first card is
   held long after its P1). If case 2 does not catch it either, the PR says so, and the property rests
   on the existing invariant comment at ~1176–1177 ("Inside the transaction, so a cancel either runs
   first … or runs after and sees the attempt live"), which no test pins.

"Two requests at once — one wins, one refused" is exact for two card payments, and for a card payment
whose P1 runs before a collect. When a collect's transaction runs first, the card payment that
follows is not refused: it replays the collect's ticket and asks no reader (decision 4). Either way
one payment, one sale.

---

## Decisions this plan makes that the spec does not (defaults — answer any to override)

1. **"In flight" means exactly what `refusePlacedPaymentInFlight` already checks: a card collection
   of the order running in this process, or a `payments` row of the order that is `attempting`, or
   `captured` / `accepted_offline` with no sale.** The same check A497 uses for the receipt language
   and the invoice choice, and the same facts an open order's second card payment is refused on
   (`till-sale.ts` ~1111–1117). Consequence the owner should know: after a reader TIMEOUT the provider
   row stays `attempting` (SumUp leaves it for its sweep, `packages/payments-sumup/src/provider.ts`
   ~121, ~310), so cash on that placed order is refused until the sweep settles the row — at the next
   loop pass when SumUp has an answer, up to 15 minutes when SumUp has no record of it
   (`NOT_FOUND_GRACE_MS`, same file ~46). An open order behaves the same way today (its mark is kept
   while the row is `attempting`). A Stripe row left `attempting` by a crash on a placed order has no
   manager path out: the stuck list and resolve accept open orders with a mark only
   (`payments-api.ts` ~935–941, ~973–980), so that order could not be collected or paid. Stripe has no
   account at the venue today (`docs/backlog.md`, "Stripe does not fill `CardDetails`"). Default:
   build it this way, and record the Stripe gap as a backlog entry (Task 5). Alternative: count only
   this process's live attempt plus captured-unfiled rows, which lets cash through after a timeout at
   the risk the sweep then captures the card.

2. **Pressing Pay again to file a card that was already charged is never refused.** The new check in
   P1 runs AFTER the recovery branch (`till-sale.ts` ~1083–1093), as the open-order check already
   does (the comment at ~1109–1110 says why). Recovery asks no reader. While a card is live, no new
   charged-but-unfiled row of the same provider can appear (any pay that would create it is refused),
   so recovery cannot settle the order under a live card. That last sentence is read, not run.

3. **The check also stops the owing-nothing settle in both paths.** In P1 it goes before the
   `outstanding` branch (~1095), and in collect after `refuseBillWithPayments` (~1940), before the
   owing-nothing return (~1951–1953). Settling the order while a card is at the reader would leave
   that card charged with no sale. No test today reaches "owes nothing while a card is live" (a card
   starts only when something is owed); the plan adds no case for it.

4. **A collect or a card payment that arrives after the order is settled still replays the stored
   ticket (200), as today.** A collect arriving after the card settled answers the card's receipt. It
   is not refused, because a lost-response retry of the same collect must get the same answer and the
   request carries nothing that tells a retry from a second till. The till shows the receipt, whose
   tender reads card.

5. **The duplicate backstops in `finalizeCapture` (~1524–1531) and `finalizeSettle` (~1780–1788)
   stay**, though no route now lets a second payment of the same order reach P3 while the first is
   live. `sales_working_order_id_key` refuses a second sale whatever wrote it, and the backstop turns
   that into a replay instead of a 500 after a charged card. Their three tests, which today use a
   cash collect as the competing writer (which this change refuses), are moved to a competing writer
   written straight to the database and named "backstop: …" (Task 1 Step 6, Task 2 Step 8).

6. **Unpaid departure is left out of this branch.** It takes no money; whether a departure recorded
   while a presented bill's card is at the reader should be refused is a separate question with its
   own test. Default: a backlog entry (Task 5), marked read-not-run.

7. **`placedAttemptsOf` keeps its count.** With the refusal, at most one attempt per placed order is
   live in this process, so the count is 0 or 1. Counting rather than flagging costs nothing and
   means a hold can never end early if two ever overlapped. Only the false half of its comment ("two
   pays of one placed order may both reach the reader") is cut (Task 3).

8. **`storeSentReceiptLanguage`'s own placed-order check (~477) is deleted**, with its `db` parameter
   and the sentence in its doc comment. Both of its callers that see a placed order (P1 ~1121,
   collect ~1997) now run the general refusal first, so it can no longer refuse anything. Proof it is
   safe: the four "refuses … and files the language the payment started with" cases in
   `receipt-language.test.ts` (~1922–2003) still pass with the same 409 body (Task 3).

9. **Till: a refused collect, Find-a-bill pay or presented-bill Pay says so in its own words.**
   Today those three handlers show the generic "Could not complete the sale, try again"
   (`sale.error`) for `order.payment_in_flight` (`till-app.ts` `#onCollectOrder` ~3963–3971,
   `#onFindBillPay` ~4033–4040, `#onPayTab` ~8426–8436). New till string `sale.payment_in_flight`:
   English "A card payment for this order is in progress. Wait for it to finish." Spanish "Se está
   cobrando este pedido con tarjeta. Espera a que termine." `#collectCard` (the reader card) already
   shows the code's own message through `ACTIONABLE_REFUSALS` (~595–603); it is left as it is.
   Find a bill's `error` is a string key (`till-app.ts` ~2017), which is why this is a string and not
   the code's message (whose wording, "… before changing the order", also fits a payment poorly).

## Recorded decisions checked for a contradiction

- **Bill payments design §5.2** (`docs/superpowers/specs/2026-09-26-bill-payments-design.md` ~460–463):
  "**Allowed while a card payment on the bill is pending:** a cash payment, and a second card payment
  on another reader, each against what is still available after the pending one's reservation
  (§3.1). So a second device may take cash while a card is at the terminal. **Why:** at a large table
  two guests paying at once is ordinary, and the reservation is what keeps it safe." Not contradicted:
  it is about bill payments, which need an OPEN bill (row 7), and each reserves its own amount. A
  placed order is paid whole, with no reservation.
- **C126 (#1030, `89d6cb9a8`)** added `placedAttemptsOf` and its comment "two pays of one placed order
  may both reach the reader, and the entry must outlive the first to finish" so that a cancel stays
  refused while either of two cards runs. Its commit message describes that as what the code did, not
  as something wanted; the test it added (`cancel-invoiced-order.test.ts` ~1494, "refuses while
  either of two cards paying the order at once is at its reader") pins it. A526's spec asks for the
  second payment to be refused, so Task 2 rewrites that test (Step 8) and keeps its assertion that
  the cancel is refused while a card is live.
- No entry in `docs/backlog/payments.md` → "Decisions and deliberate limits", in `docs/backlog.md`, or
  in the specs and plans under `docs/superpowers/` says two payments of one placed order should both
  be allowed (`grep -rn "both reach\|two pays\|second pay\|charged twice"` over those paths found only
  the A526 entry itself).

## Global Constraints

- Error code `order.payment_in_flight`, HTTP 409 (`till-api.ts` ~424), params
  `{ workingOrderId }`. No new server code; no rename.
- A refused request writes nothing: no sale, registro, tender, settlement, `payments` row, drawer
  job or receipt job, and the order stays `placed`. A refused `/api/pay` asks no reader.
- Never refuse a request that files a card already charged (recovery), and never change a replay of
  a settled order.
- Queries on one transaction are awaited in turn, never `Promise.all` (CLAUDE.md §3). The refusal
  runs inside the existing transaction; no new transaction.
- Tests first, through the real HTTP routes on a real venue database (`useVenueDb` with
  `migrationOptionsFor(manifestSets(), null)`), real Veri\*Factu filing; till tests in real Chromium.
  Rejected writes assert the domain code, never `toBeInstanceOf(Error)`.
- Rewriting an existing test changes its setup, not what it asserts, unless the assertion pinned the
  double charge itself; each such change is named in the commit message.
- Coverage holds `98/98/98/95` in `apps/server` and `apps/till`.
- Comments only for an invariant or a non-obvious why; never history. A comment this change makes
  false is cut, preferring deletion to rewording.
- Every commit `git commit -s`, message in plain English. Never `--no-verify`. Do not push from a
  task; `/finish-branch` pushes.
- Browser runs: check `memory_pressure | grep free` first. Kill only processes you started, by pid.
- Unset `AI_AGENT` and `CLAUDECODE` (`env -u AI_AGENT -u CLAUDECODE …`) when you need a passing
  test's console output; read the `Tests` count of every run.

## Review Focus

1. **The window between P1 and P3.** A collect or second pay arriving while the card is at the
   reader, while P3 runs, and after P3 commits. Pinned in Task 1 (collect during the held reader) and
   Task 2 (second pay during the held reader; two pays in the same tick; at-once HTTP rounds).
2. **The refused request must not release the first card's hold.** `runIntegratedPay`'s `finally`
   releases only what its own call held. Pinned in Task 2 Step 1: after till 2's refused pay returns,
   a cash collect is still refused while till 1's card is held.
3. **Recovery must still work** (a charged card filed by pressing Pay again, asking no reader).
   Pinned in Task 1 Step 1 (case "captured, not yet filed") and Task 2 Step 1.
4. **A reader timeout locks cash out until the sweep answers** (decision 1). Pinned in Task 1 Step 1:
   refused while `attempting`, accepted once the row is failed.
5. **Legitimate payments still pay:** a normal card payment (issued invoice and none), cash after a
   declined card, a card after a declined card. Pinned in Tasks 1 and 2.

---

## File map

| File | Change |
| --- | --- |
| `apps/server/src/till-sale.ts` | The refusal in `runCollectOrder` and in `payIntegrated`'s P1; drop the check inside `storeSentReceiptLanguage`; comments the change makes false |
| `apps/server/src/errors.ts` | `order.payment_in_flight`'s doc names pay and collect of a placed order |
| `apps/server/src/placed-order-one-payment.test.ts` | New: the route-level cases |
| `apps/server/src/till-sale-integrated.db.test.ts` | Three cases pinning the old behaviour moved (Task 1 Step 6, Task 2 Step 8) |
| `apps/server/src/cancel-invoiced-order.test.ts` | The "two cards at once" case rewritten (Task 2 Step 8) |
| `apps/till/src/till-app.ts`, `apps/till/src/i18n/strings.ts` | The three handlers' message; the new string |
| `apps/till/src/till-app.test.ts`, `apps/till/src/till-app-parties.test.ts` | Till cases |
| `docs/backlog.md`, `docs/backlog/payments.md` | Delete the entry; leftovers; the decision |

Existing suites whose cases may pin the old behaviour and must be run after Task 2 (they collect or
pay placed orders, or hold a card at a fake reader): the 34 server test files `grep -lE
"collectOrder|/collect\`|/collect\"|payWorkingOrderIntegrated|\"/api/pay\"" apps/server/src/*.test.ts`
lists. Run them once as a set (Task 3 Step 5), not after every step.

---

## Task 1: A placed order's collect is refused while its card is in flight

**Files:**
- Create: `apps/server/src/placed-order-one-payment.test.ts`
- Modify: `apps/server/src/till-sale.ts` (`runCollectOrder`, ~1915–2001)
- Modify: `apps/server/src/till-sale-integrated.db.test.ts` (two cases, Step 6)

**Harness to reuse** (read these first):
- `apps/server/src/testing/bill-venue.ts` — `provisionBillVenue` (~103): real Veri\*Factu, two
  enrolled tills (`cookie`, `cookie2`) each with its own reader, one `FakePaymentProvider` behind the
  reader pool as `venue.card` (~242–283); `send` (~317), `inTx` (~337), `statusOf` (~357),
  `registroCount` (~367).
- `apps/server/src/cancel-invoiced-order.test.ts` — the `useVenueDb` setup (~77–198), `placed()`
  (~201–224: park through `POST /api/working-orders`, optionally issue the invoice with
  `issueOrderInvoice`, place through `POST /api/working-orders/:id/place`), `observeRefusal` /
  `expectUnwritten` (~342–366), and the held-reader cases (~1427–1540, ~1605–1640). Copy what you need
  into the new file; do not import from another test file.
- `packages/payments/src/testing/fake-provider.ts` — `holdNextCollect` (~125), `failNextCollect`
  (~102), `stallNextCollect` (~113), `crashNextCollect` (~119), `collectCalls`; `collect` (~213–283).

Both kinds of placed order must be covered by every case below (`it.each`): **with an issued
invoice** (invoice-first: collect settles it, `/api/pay` takes the `settle` branch) and **without**
(collect files the sale, `/api/pay` takes the `collect` branch). For the no-invoice order, create a
fresh counter zone as the cancel suite's "placed order with no invoice" cases do (~1580–1590).

- [ ] **Step 1: Write the failing cases.** In a `describe("a placed order's collect while its card is
  in flight")`, each case a fresh placed order:
  1. *cash collect while till 1's card is at the reader, before any payment row* —
     `venue.card.holdNextCollect()`; `POST /api/pay` from `venue.cookie` (do not await); `await
     expect.poll(() => venue.card.collectCalls.length).toBe(calls + 1)`; take a snapshot (sales,
     registros, tenders, settlements, payments rows, drawer and receipt jobs for the order); `POST
     /api/working-orders/:id/collect` from `venue.cookie2` with `{ tender: { method: "cash", amount:
     "50.00" } }`; snapshot again; `release()`; await the pay. Assert the collect answered
     `{ status: 409, json: { code: "order.payment_in_flight", params: { workingOrderId: id } } }`,
     the two snapshots are equal, the order was `placed` while held, then the pay answered 200
     `captured`, there is exactly one sale for the order, its one tender is `card`, and the order's
     one `payments` row is `captured` with that sale's id. Release in a `finally` so a failing
     assertion cannot leave the reader held.
  2. *hand-keyed card collect* — the same with `{ tender: { method: "card", amount: <total> } }`;
     also assert no `manual` provider `payments` row was written.
  3. *a card captured and not yet filed* — `venue.card.crashNextCollect("captured")`; `POST /api/pay`
     answers 500; cash collect → 409 `order.payment_in_flight`, nothing written; then `POST /api/pay`
     again → 200 `captured` with `venue.card.collectCalls` unchanged (recovery asks no reader), and one
     sale whose payment is that captured row.
  4. *a reader that timed out* — `venue.card.stallNextCollect()`; `POST /api/pay` answers 200
     `{ outcome: "timeout" }`; cash collect → 409, nothing written; then mark the row failed as the
     sweep would (`inTx(venue, (tx) => failAttempting(tx, { provider: "fake", paymentRef }))`, from
     `@waitron/payments`; read the ref from the order's `payments` row); cash collect → 200, one sale,
     one cash tender.
  5. *legitimate: cash after a declined card* — `venue.card.failNextCollect()`; `POST /api/pay` → 200
     `declined`; cash collect → 200; one sale, one cash tender; the failed `payments` row has no sale.
     (The simulator's Cancel on the pretend reader answers as a decline,
     `packages/payments/src/simulator.ts` ~150–157 — read, not run — so this case stands for
     "cancelled" too.)
  6. *legitimate: a cash collect with no card involved* → 200, one sale, one cash tender.

- [ ] **Step 2: Run them and watch 1–4 fail.**
  `pnpm --filter @waitron/server exec vitest run src/placed-order-one-payment.test.ts`.
  Expected: cases 1–4 fail because the collect answers 200 (and in 1–3 a sale is filed with a cash
  tender while the card is or was charged); 5 and 6 pass. Paste the failure lines into the task's
  report. If 1–4 do not fail this way, stop: the reproduction is wrong.

- [ ] **Step 3: The minimal change.** In `runCollectOrder` (`till-sale.ts`), directly after
  `await refuseBillWithPayments(tx, req.id);` (~1940):
  `await refusePlacedPaymentInFlight(deps.db, tx, req.id);`
  After the settled replay and the `working_order.not_placed` check, so a retry of a finished
  collect still replays; before the tender check and the owing-nothing settle (decision 3).

- [ ] **Step 4: Run the new file again.** All six pass. Read the `Tests` count.

- [ ] **Step 5: Prove the refusal by deletion.** Comment out the new line, run the file: cases 1–4
  fail; put it back. Then delete only the database half — call `paymentAttemptIsLive` alone in place
  of the new line — and run: cases 3 and 4 must fail (they have no live attempt), 1 and 2 still pass.
  Restore. State both runs in the commit message.

- [ ] **Step 6: Move the two backstop cases the change breaks.** Run
  `pnpm --filter @waitron/server exec vitest run src/till-sale-integrated.db.test.ts`. Expected to
  fail: "concurrent winner: a sale filed between collect and finalize makes P3 REPLAY, filing nothing
  (duplicate backstop)" (~1128) and "a concurrent collect that settles the invoice first makes
  finalizeSettle REPLAY via sale.already_settled" (~1680): their provider hook calls `collectOrder`
  mid-collect, which is now refused. Keep every assertion about the result (the replayed ticket, one
  sale, one registro, the order settled, the winner's tender). Change only the competing writer: in
  the hook, write the winner straight to the database — for the first, `issueOrderInvoice`
  (`apps/server/src/testing/issue-order.ts`) then `settleSale` (`@waitron/core`) with one cash tender
  and the order set `settled`; for the second, `settleSale` on the issued invoice and the order set
  `settled` — and rename each case to start "backstop: a winner written straight to the database …".
  Delete the comment at ~1129–1131 ("its card collect writes no in-flight mark, so a cash collect at
  another till can still settle it while the reader runs"), which is now false. Prove each moved case
  still reaches its backstop: with the backstop's catch made to rethrow, the case fails; restore.

- [ ] **Step 7: Run the touched files.**
  `pnpm --filter @waitron/server exec vitest run src/placed-order-one-payment.test.ts src/till-sale-integrated.db.test.ts src/receipt-language.test.ts src/cancel-invoiced-order.test.ts`.
  All pass (Task 2 has not changed `/api/pay` yet, so the C126 "two cards" case still passes).

- [ ] **Step 8: Commit.** `git commit -s`, e.g. "A placed order's collect is refused while its card
  payment is in flight (A526)", the body stating the failing run, the deletion runs and the two moved
  cases.

---

## Task 2: A second card payment of a placed order is refused while the first is in flight

**Files:**
- Modify: `apps/server/src/placed-order-one-payment.test.ts`
- Modify: `apps/server/src/till-sale.ts` (`payIntegrated` P1, ~1077–1118)
- Modify: `apps/server/src/till-sale-integrated.db.test.ts` (~1519), `apps/server/src/cancel-invoiced-order.test.ts` (~1494)

- [ ] **Step 1: Write the failing cases**, in `describe("a second card payment of a placed order
  while the first is in flight")`, both kinds of placed order:
  1. *held* — `venue.card.holdNextCollect()`; `POST /api/pay` from `venue.cookie` (not awaited);
     poll until `collectCalls` grew by one; `POST /api/pay` from `venue.cookie2` (till 2, its own
     reader); then `POST /api/working-orders/:id/collect` cash from `venue.cookie2`; `release()` in a
     `finally`. Assert till 2's pay answered 409 `order.payment_in_flight` with
     `{ workingOrderId: id }`, `collectCalls` did not grow for it (no second reader asked), the cash
     collect sent AFTER the refused pay returned was also 409 (the refused pay did not release till
     1's hold), the first pay answered 200 `captured`, one sale, one `payments` row (captured, linked).
  2. *after a timeout* — `stallNextCollect()`; `POST /api/pay` → 200 `timeout`; a second
     `POST /api/pay` → 409, `collectCalls` unchanged, still one `attempting` row.
  3. *recovery is never refused* — `crashNextCollect("captured")`; `POST /api/pay` → 500; `POST
     /api/pay` again → 200 `captured`, `collectCalls` unchanged, one sale linked to the captured row.
  4. *legitimate: a normal card payment* → 200 `captured`, one sale, one card tender.
  5. *legitimate: a card after a declined card* — `failNextCollect()`; pay → `declined`; pay again →
     `captured`; one sale; the failed row unlinked, the captured row linked.
  6. *two payments started in the same tick* (orchestration level, as
     `cancel-invoiced-order.test.ts` ~1494–1525 does): two `FakePaymentProvider`s, each with
     `holdNextCollect()`; start `payWorkingOrderIntegratedOrchestration` with each, without awaiting
     between them; `await expect.poll(() => first.collectCalls.length + second.collectCalls.length)
     .toBe(1)`; assert the one with no call rejects with `order.payment_in_flight`; release both;
     the other answers `captured`; one sale.
  7. *at once over HTTP, many rounds* — 20 fresh placed orders (no invoice, to keep it quick); for
     each, `Promise.all` of `POST /api/pay` from `cookie` and from `cookie2`, no hold. Per order
     assert: exactly one reader call, exactly one `captured` payment row and it is linked, one sale;
     each answer is either 200 `captured` or 409 `order.payment_in_flight`, and a 200 pair names the
     same invoice number (the second replayed). And a mixed round: `Promise.all` of `/api/pay` and a
     cash collect, 20 orders: one sale per order, and either its tender is cash and no reader was
     asked, or its tender is card and the collect answered 409.

- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/placed-order-one-payment.test.ts -t "second card payment"`.
  Expected: 1 fails (till 2's pay answers 200 and a second reader call and capture appear), 2 fails
  (the second pay is not refused), 6 fails (both providers reach their reader). 3, 4, 5 pass. Case 7:
  record how many rounds broke the invariant on this code. **If no round breaks it, case 7 is not a
  probe of the race** (both answers look alike, CLAUDE.md §1): keep it as a guard of the invariant,
  say so in its case name ("…, a guard: it may not catch the race"), and rely on cases 1 and 6.

- [ ] **Step 3: The minimal change.** In `payIntegrated`'s P1 (`till-sale.ts`), directly after the
  recovery block (`if (captured !== undefined && captured.saleId === null) { … }`, ~1089–1093) and
  before `if (outstanding !== undefined)` (~1095):
  `if (locked.status === "placed") await refusePlacedPaymentInFlight(deps.db, tx, req.id);`
  (decisions 2 and 3). No other change in this step.

- [ ] **Step 4: Run the file.** All cases pass. Read the `Tests` count.

- [ ] **Step 5: Prove it by deletion.** Remove the new line: cases 1, 2, 6 fail; restore. Remove only
  the database half as in Task 1 Step 5: case 2 fails, 1 and 6 still pass; restore.

- [ ] **Step 6: The mutation run for the race** (see "The race" above). Move both `onPlacedCollect()`
  calls (~1105, ~1178) out of the P1 body, so the hold is registered after `withTransaction` returns
  (e.g. return a flag in `prepared` and call the hold right after P1). Run cases 1, 6 and 7. Record
  which fail. Restore. If none fails, write in the commit message and the PR that no test pins the
  hold being registered inside P1.

- [ ] **Step 7: Run the suites that pinned two payments.**
  `pnpm --filter @waitron/server exec vitest run src/till-sale-integrated.db.test.ts src/cancel-invoiced-order.test.ts`.
  Expected to fail: "two concurrent pays for one placed order file ONE sale; the loser replays"
  (`till-sale-integrated.db.test.ts` ~1519) and "refuses while either of two cards paying the order at
  once is at its reader" (`cancel-invoiced-order.test.ts` ~1494).

- [ ] **Step 8: Rewrite those two.** These assertions pinned the double charge itself, so they change,
  and the commit message names them:
  - ~1519 becomes "two concurrent pays for one placed order: one is captured, the other is refused
    before asking its reader, and ONE sale is filed". Use two held providers as in Step 1 case 6 so
    the order is deterministic. Keep "one sale", "one registro". Delete the comments at ~1520–1521 and
    ~1532–1534, which describe the old behaviour.
  - ~1494 becomes "refuses while a card is at the reader, and after a second card for the order was
    refused". Start the first pay held; start a second pay with its own provider and assert it
    rejects `order.payment_in_flight` without a `collect` call; then the cancel → 409 and nothing
    written (`expectUnwritten`); release; the first answers `captured`; the order is settled; no
    credit note. This keeps the case's point: a cancel is refused while any card of the order is live.
  Run both files again: all pass.

- [ ] **Step 9: Commit.** "A second card payment of a placed order is refused while the first is in
  flight (A526)", with the failing run, the deletion runs, the mutation result and the two rewritten
  cases in the body.

---

## Task 3: Remove the check the refusal made redundant, and the claims it made false

**Files:**
- Modify: `apps/server/src/till-sale.ts`, `apps/server/src/errors.ts`

- [ ] **Step 1: Delete the language-only check (decision 8).** In `storeSentReceiptLanguage`
  (~469–482) delete `if (order.status === "placed") await refusePlacedPaymentInFlight(db, tx,
  workingOrderId);`, its now unused `db` parameter (update its three callers: ~646, ~1121, ~1997), and
  the doc sentence "A different language is refused while another card payment of a placed order is
  underway, since that payment files in the stored one."

- [ ] **Step 2: Prove it.** `pnpm --filter @waitron/server exec vitest run src/receipt-language.test.ts`.
  The four cases "refuses %s, and files the language the payment started with" (~1922–2003) pass
  unchanged — two of them ("the language a second card payment sends", "the language a collect
  sends") now refused by the general check with the same 409 body.

- [ ] **Step 3: Cut or narrow every comment the change made false.** Grep first:
  `grep -n "both reach\|two pays\|placedAttemptsOf\|refusePlacedPaymentInFlight\|concurrent collect\|both pass P1" apps/server/src/till-sale.ts apps/server/src/errors.ts apps/server/src/working-order.ts`.
  At least:
  - `payWorkingOrderIntegratedOrchestration`'s doc (~971–974): "P1's serialisation ends at its own
    commit, so two pays for one id can both pass P1 with the order unsettled and both reach P3 — which
    is why `finalizeCapture` and `finalizeSettle` each keep a duplicate backstop …". Replace with the
    one fact still true: P3 of `finalizeCapture` and `finalizeSettle` keeps a duplicate backstop
    because `sales_working_order_id_key` / `settleSale` refuse a second sale or settlement whatever
    wrote it; the rest of that sentence (which phases need none) stays only if still accurate.
  - `finalizeCapture`'s doc (~1411–1413): "Two pays can both commit a P1 that saw the order unsettled
    and both arrive here." — delete; keep "the loser's `recordSale` is refused … and it replays",
    reworded only as far as needed to stay true.
  - `finalizeSettle`'s doc (~1728–1731): "A concurrent collect or recovery can settle the invoice
    between P1 and here" — narrow to what can still do it (another writer), or delete.
  - `refusePlacedPaymentInFlight`'s doc (~1266–1271): name its callers' purpose once (a payment or a
    change of a placed order while a card of it could still file its sale).
  - `placedAttemptsOf`'s doc (~1288–1289): cut "two pays of one placed order may both reach the
    reader, and the entry must outlive the first to finish" (decision 7).
  - `ordersWithUnfiledPayment`'s doc (~1310–1317): add "whether a placed order may be collected or
    paid", drop "or receipt language" only if that use is gone (it is not: `readChoiceChangeableOrder`,
    `working-order.ts` ~3484, still calls it).
  - `errors.ts` `order.payment_in_flight` (~296–307): replace "or a different receipt language sent
    with a pay or collect of it" with "and a pay or collect of it", keeping the rest.
  Prefer deleting to rewording; every new sentence is a claim — check it against the code you just
  changed.

- [ ] **Step 4: Run the focused files.**
  `pnpm --filter @waitron/server exec vitest run src/placed-order-one-payment.test.ts src/receipt-language.test.ts src/till-sale-integrated.db.test.ts src/cancel-invoiced-order.test.ts src/till-money.write-session.test.ts`
  and `pnpm --filter @waitron/server typecheck`.

- [ ] **Step 5: Run once the set of suites that collect or pay** (see File map). Check memory first.
  `cd apps/server && env -u AI_AGENT -u CLAUDECODE pnpm exec vitest run $(grep -lE "collectOrder|/collect\`|/collect\"|payWorkingOrderIntegrated|\"/api/pay\"" src/*.test.ts | tr '\n' ' ')`
  (zsh: the `$(…)` result must be split — use `${=…}` or `xargs`; CLAUDE.md global note). Any
  failure that pins the old behaviour (a collect or second pay of a placed order while a card is live
  answering 200) is changed as Task 2 Step 8 did and named in the commit; any other failure is a
  defect to fix, not to re-run.

- [ ] **Step 6: Commit.** "Drop the receipt-language-only in-flight check and the comments the A526
  refusal made false".

---

## Task 4: The till says a card payment is in progress when a collect is refused

**Files:**
- Modify: `apps/till/src/i18n/strings.ts` (English ~872, Spanish ~2033, beside `sale.error`)
- Modify: `apps/till/src/till-app.ts` (`#onCollectOrder` ~3941, `#onFindBillPay` ~4017, `#onPayTab` ~8406)
- Modify: `apps/till/src/till-app.test.ts` (the collect-order and Find-a-bill cases ~10010–10180),
  `apps/till/src/till-app-parties.test.ts` (the pay-tab cases ~3030–3125)

- [ ] **Step 1: Write the failing cases.**
  - Counter collect: in the "collect-order: …" group, mirror "collect-order: says the operator may not
    take payments when refused the payment permission" (~10117): `collectOrder` rejects
    `{ code: "order.payment_in_flight", status: 409, workingOrderId: "wo-1" }`; the banner contains
    `t("sale.payment_in_flight")`, not `t("sale.error")`; the stage stays `collect`.
  - Find a bill: mirror "keeps Find a bill open with a refusal when collection fails" (~10012):
    `dialog.error` is `"sale.payment_in_flight"`; the dialog stays open; no ticket.
  - Presented party bill: mirror an existing `pay-tab` refusal case in `till-app-parties.test.ts`
    with a bill whose `status` is `placed`, `collectOrder` rejecting with the code; the banner
    contains `t("sale.payment_in_flight")`.
  Run: `pnpm --filter @waitron/till exec vitest run src/till-app.test.ts src/till-app-parties.test.ts -t "payment_in_flight|card payment is in progress"`.
  Expected: they fail on the missing string key (type error or the generic message shown).

- [ ] **Step 2: Add the string** (decision 9): English `"sale.payment_in_flight": "A card payment for
  this order is in progress. Wait for it to finish."`, Spanish `"Se está cobrando este pedido con
  tarjeta. Espera a que termine."`.

- [ ] **Step 3: Map the code in the three handlers**, before each one's generic fallback and after its
  permanent-refusal and network checks: `code === "order.payment_in_flight" ? "sale.payment_in_flight"
  : …`. One small helper beside `isTakePaymentRefusal` if the three would otherwise repeat the read
  of `error.code`. `#collectCard` and `#onConfirmPayment` are not changed (they already show the
  code's own message, ~14025–14060 pins it).

- [ ] **Step 4: Run** the two files whole (check memory first; Chromium):
  `pnpm --filter @waitron/till exec vitest run src/till-app.test.ts src/till-app-parties.test.ts src/i18n`
  — the string-parity tests in `src/i18n` must pass with the new key in both languages.

- [ ] **Step 5: Look at it.** Run the dev stack from this worktree (`wa-wt demo
  waitron-feat-service-placed-order-one-payment`), place a counter order in a ticket-then-pay zone,
  start a card on the pretend reader on one till and press Collect cash on a second till (or a second
  browser tab signed in on another device): the banner reads the new sentence, English and Spanish.
  If a second till cannot be had in the demo stack, say so in the report; the browser tests stand.

- [ ] **Step 6: Commit.** "The till says a card payment is in progress when a collect is refused
  (A526)".

---

## Task 5: Backlog and docs

**Files:**
- Modify: `docs/backlog.md`, `docs/backlog/payments.md`

- [ ] **Step 1: Delete the entry** "A placed order can be charged twice while its card is at the
  reader" from `docs/backlog.md` (Payments area, ~3159–3163) and its detail section from
  `docs/backlog/payments.md` (~171–179).

- [ ] **Step 2: Add the leftovers as short entries** in the same area, each with "Left open by A526"
  and marked read, not run:
  - **An unpaid departure recorded while a presented bill's card is at the reader** (decision 6):
    `recordUnpaidDeparture` checks open bills only (`unpaid-departure.ts` ~101); for a presented bill
    with no invoice it files one (`issueUnpaidInvoice`), after which the card's own filing would meet
    `sales_working_order_id_key`. Whether a departure should be refused while a card is live needs a
    failing test and the owner's view.
  - **A card row a crash leaves `attempting` on a placed order has no manager way out** (decision 1):
    the stuck list and resolve take open orders with a mark only (`payments-api.ts` ~936–940,
    ~973–980), and since A526 that row refuses the order's collect and pay. SumUp's sweep settles its
    own rows; a Stripe one would stay until a manager path exists.

- [ ] **Step 3: Record the decision** in `docs/backlog/payments.md` → "Decisions and deliberate
  limits": **A placed order takes one payment at a time** (A526, 2026-10-12): a collect or a second
  card payment is refused `order.payment_in_flight` while a card of it is at a reader, its outcome is
  unknown, or it was charged and not yet filed; pressing Pay again to file a charged card is not
  refused; after a reader timeout, cash waits for the provider's sweep (up to 15 minutes with SumUp
  when SumUp has no record); a request arriving after the order settled replays its receipt (a cash
  collect after the card settled answers the card's receipt). Plan:
  `docs/superpowers/plans/2026-10-12-a526-placed-order-one-payment.md`.

- [ ] **Step 4: Grep for claims the change retires**, over the whole tree, prose included:
  `grep -rn "both reach the reader\|two pays of one placed\|charged twice\|cash collect at another till\|refusePlacedPaymentInFlight\|placedAttemptsOf" docs apps packages --include='*.md' --include='*.ts'`.
  Each hit outside this plan either still holds or is changed in this step (a historical spec or
  plan gets a dated pointer, not a rewrite). Prettier ignores `docs/`; nothing to format there.

- [ ] **Step 5: Draft the PR description** for `/finish-branch`: what changed in plain English; the
  route table above (rows, handler `file:line`, covered or left out and why); the failing runs from
  Tasks 1 and 2; the deletion and mutation results; the tests whose assertions changed and why; the
  owner-facing consequences (decisions 1 and 4).

- [ ] **Step 6: Commit** `git commit -s` "Backlog: a placed order takes one payment at a time (A526);
  two leftovers".

---

## Self-review (done while writing)

- Every route that writes a sale, settlement, tender or `payments` row was traced from its handler;
  rows 6–14 are left out with the line that refuses or the reason they take no money.
- The concurrency claim rests on two tests that fail today (Task 2 Step 1 cases 1 and 6) and a
  mutation run whose result is reported either way (Step 6). The "at once" HTTP case is labelled a
  guard if it never broke on the old code.
- Legitimate paths: a normal card payment (both kinds of placed order), cash after a declined card,
  a card after a declined card, cash after a timed-out card once its row is failed, recovery of a
  charged card, and a plain cash collect.
- Tests that pinned the double charge are rewritten and named: three in
  `till-sale-integrated.db.test.ts`, one in `cancel-invoiced-order.test.ts`.
- No migration: a placed order cannot carry the mark, and nothing new is stored.
