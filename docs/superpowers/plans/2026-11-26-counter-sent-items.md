# Pay > Items on a Counter order already sent to the kitchen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At the Counter, staff can pay for chosen dishes on an order that was sent to the kitchen before payment and has no receipt yet. The server moves those dishes to a bill of their own and takes the payment there. No credit note is needed, because no receipt exists.

**Architecture:** This reuses Pay for items' existing move (`moveItemsToNewBill`, `apps/server/src/pay-for-items.ts:220-267`). A sent order's dishes cannot leave it today, so for the length of the move (inside the payment's one transaction) the order goes back to `open`, and it is `placed` again before the payment is taken. That needs one new exception in the database's order-status rule, so core's starting migration is rebuilt and **every venue is reset**.

**Spec:** the owner's request of 25 November (picker answer "Build it next (Recommended)", "keeping the order's number"), the watcher's note on order numbers, and `docs/superpowers/plans/2026-11-24-a1515-1-pay-for-items-new-bill.md` (D10, PR3-D8). **Review:** fiscal, and it touches a migration: full `/finish-branch` wave with both Codex angles. The owner lands it.

## What the code says (from reading, except where marked "probe")

- **The dishes cannot move off a sent order today.** I ran a throwaway test (deleted afterwards) that sent a Counter order with `placeOrder`. `moveItemsToNewBill` refused it with `bill.presented` (`refuseClosedBill`, `bill-actions.ts:66`), and a raw `placed → open` update was refused with "working order cannot make that transition" (`packages/db/triggers/core.sql:737-760`; pinned by `packages/db/src/schema/orders.transition.test.ts:359`). Lines can move only between two open orders (`core.sql:389-398`; `moveOrderLines`, `working-order-transfer.ts:108-113`).
- **Probe, part 2.** In the same throwaway database I dropped only that status rule, then switched the order to open, ran `moveItemsToNewBill` and switched it back to placed. The move worked. The moved dish's kitchen item kept its id, fired time, state and station, and gained `sent_order_number = 2`, the number it was sent under. No new print job and no kitchen notice appeared. The kitchen queue listed the new order as "3 (was 2)". A whole cash payment then settled the new order with no print job (the test venue had no receipt printer, so this says nothing about receipts). Waiting then listed `2` as placed and `3 (was 2)` as settled.
- **Placed with no receipt happens in one place only.** Only `placeOrder` makes an order `placed` without issuing its sale (`working-order-counter.ts:107-117`). Every other caller of `markOrderPlaced` issues first: `meal-end.ts:131/142`, `unpaid-departure.ts:121/132`, `deferred-close.ts:153/156`, `close-of-day.ts:120/128`.
- **Order numbers are unique.** `working_orders_order_number_key` (`packages/db/src/schema/orders.ts:146`) makes them so. They come from `max + 1` (`packages/db/src/allocate-order-number.ts:9-13`), and the payment hand-over between boxes gives a clashing order a new number (`packages/fiscal-verifactu/src/handover-return.ts:518-520`). The order number is not the invoice number: the invoice number belongs to the `sales` row issued at payment (`listCounterWaiting`, `working-order-counter.ts:489-493`, `:565`).

## Decisions

- **D1. Data shape.** The paid part is a new `working_orders` row, made the way every Pay for items bill is made (`moveDishes` with no target, `bill-actions.ts:362-395`). It names its source in `items_paid_from`, and its service context and way of eating are copied from the source (`working-order-open.ts:160-172`, `:201-204`). The original keeps its row, its number, its unchosen dishes, its `placed` status, its money and its `order_placed` record. Choosing every dish is refused with `bill.all_items_chosen` before anything moves (`pay-for-items.ts:177-186`); staff pay with Whole bill instead, as on a table. A card that charges nothing puts every dish back on the original (`movedItemsBack`, `bill-payments.ts:2363-2420`), with the original opened for that move too (D3). If the original was paid in full or issued while the card was out, the dishes stay on their own bill, as they do today (`bill-payments.ts:2319-2322`).
- **D2. Order number: a new number, shown as "(was N)". Needs the watcher's or owner's decision.** The watcher asked for the new bill to keep the original number, but the unique index refuses two rows with one number. I recommend the behaviour every move of sent dishes already has. The new bill gets the next number, and its kitchen items carry the number they were sent under (`stampSentOrderNumber`, `working-order-transfer.ts:192`, `:206-240`). The kitchen screen, the pass board and Counter > Waiting then show "3 (was 2)" (`readFormerNumbers`, `former-numbers.ts:9-37`; till `widgets/counter-waiting.ts:147`, `station-queue.ts:1171`, `pass-board.ts:424`). Keeping the same number would mean dropping that index and re-checking everything that treats a number as one order, starting with the hand-over code above. I priced it as a separate change and did not plan it.
- **D3. How the move runs.** A new `withSentOrderOpen(tx, orderId, move)` does the work. When the order is `placed` with no `sales` row, it sets the order to `open`, runs `move`, and sets it back to `placed` if `move` left it open. For any other bill it just runs `move`. Exactly two callers use it, and nothing guards that limit:
  - `moveItemsToNewBill`, around everything from `guardPathParty` through `moveDishes`, so the advances check and `issueIfFullyPaid` run on the placed order as they do today;
  - `movedItemsBack`, around its `moveOrderLines`.
  The database rule gains one exception: `placed → open` is allowed only while no `sales` row names the order and no other column changes. A printed (issued) order stays frozen.
- **D4. Which orders this covers.** Every `placed` order with no receipt. That means a sent Counter order, and also one moved to a table afterwards, which the till bars today with the same reason (`state/pay-for-items.ts:92-106`). The server change is the same code for both. **Recommend including both; watcher to confirm.** A placed order *with* a receipt keeps today's path: a table bill is reopened, and a Counter order is refused `bill.not_at_table` (`split-after-print.ts:155`).
- **D5. Kitchen.** Nothing is sent again and no slip prints. Pay for items already moves dishes with `tellKitchen: false` (`pay-for-items.ts:246-249`), the put-back prints nothing, and the moved lines keep `sent_at`, so they are never sendable again (`unsentDishLines`). One gap: an original already handed over (`collected_at` set, allowed before payment by `sentUnpaidCounterOrder`, `working-order-counter.ts:400-408`) would make its moved dishes reappear on the kitchen screen, because that screen lists every order not yet collected (`working-order-station-queue.ts:398-401`). The new bill therefore copies the original's `collected_at`.
- **D6. Collection ticket and Waiting.** No new slip prints for either part.
  - **When the order was sent:** the number slip "2" printed once, if the zone numbers collections (`working-order-counter.ts:119-121`, `receipt-print.ts:386-391`).
  - **The paid part:** an ordinary receipt whose "Order" line reads 3 (`invoice-layout.ts:232-233`). In a pay-after-sending zone no number slip prints, because a slip comes with a receipt only in a prepay zone (`receipt-print.ts:370-372`). In a prepay zone the slip prints 3, as for any prepay payment.
  - **Waiting:** lists "3 (was 2)" as paid, ready to hand over once its dishes are on a kitchen ticket, and "2" as still sent with its total reduced (`working-order-counter.ts:445-571`). Each is handed over on its own.
- **D7. Fiscal.** The paid part's receipt is an ordinary sale issued by the existing payment path (`takeBillPaymentIn` → `issueIfFullyPaid`). No credit note is filed and no invoice number is spent beyond that sale. Nothing in `packages/fiscal-verifactu` changes. `write-path.e2e.test.ts` and `inmutabilidad.test.ts` pass unedited.
- **D8. VAT.** Each moved line keeps the rate it would have had on the original. The new bill copies the original's way of eating (eat-in or takeaway, `working-order-open.ts:201-204`). At issuing, rates are read from the order's way of eating and each line's product (`stored-order-lines.ts:113-134` → `line-vat-rates.ts:43-49`): the one eat-in rate for eat-in, and each product's takeaway rate, dated at the payment, for takeaway. Neither can change once the kitchen has the order (`core.sql:694-710`).
- **D9. Migration: yes.** This edits the trigger file `packages/db/triggers/core.sql` and rebuilds core's starting migration (`pnpm --filter @waitron/server migration-baseline rebuild --set core`), with no new migration file. Every venue is reset (allowed before go-live). The PR's first line says so.

## Review Focus

1. A card declined, or cancelled at the reader: the dishes go back to the original, which is `placed` again and not left `open`.
2. An original handed over before payment: the paid part never reappears on a kitchen screen.
3. An original part-paid with An amount: what is left, if exactly covered, issues and settles; if overpaid, it keeps the money and issues nothing.
4. Part of a sent line (1 of 3 beers): its kitchen item splits and nothing is sent again.
5. A placed order *with* a receipt is never switched to open, by the code or by the database.

### Task 1: Let a sent order with no receipt go back to open (database)

**Files:** Modify `packages/db/triggers/core.sql` (`working_orders_enforce_transition`, `:737`); regenerate `packages/db/drizzle/0000_baseline.sql`; test `packages/db/src/schema/orders.transition.test.ts`.

- [ ] **Step 1: Failing tests.** Change `"rejects placed → open and a non-status update of a placed row"` (`:359`) deliberately to `"rejects placed → open once a sale names the order, and a non-status update of a placed row"`: `placed → open` is refused with `TRANSITION_REFUSAL` after a `sales` row for the order is seeded, and the label edit stays refused. Add `"lets a placed order with no sale go back to open, changing nothing else"`: the status change alone succeeds, and `{status:"open", label:"x"}` from placed is refused. Run `pnpm --filter @waitron/db exec vitest run src/schema/orders.transition.test.ts` → FAIL.
- [ ] **Step 2: Implement.** Add the `old.status='placed' AND new.status='open' AND NOT EXISTS (SELECT 1 FROM sales WHERE working_order_id = old.id)` branch, with every other column `IS old.<column>` as the `placed → placed` branch lists them. Update `"the exception names every column"` (`:915`) if it reads the branch. Rebuild core.
- [ ] **Step 3: Verify.** Run the test file above, then from the root `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/starting-migrations.test.ts`, then `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts src/write-path.e2e.test.ts`. Commit `git commit -s -m "Let a sent order with no receipt go back to open, for Pay for items (resets venues)"`.

### Task 2: Pay for items on a sent order, cash and hand-keyed card (server)

**Files:** Create `apps/server/src/sent-order-open.ts`. Modify `apps/server/src/pay-for-items.ts`: `moveItemsToNewBill`; `reopenIfPrinted` (`:372`), which reopens only a placed bill with a sale; `previewPayForItems` (`:579-582`), which calls `refuseReopen` only then. Export `hasInvoice` from `bill-payments.ts:1336`; that file sits at 2,722 lines against a 2,750 cap, so add no lines there in this task. Test: create `apps/server/src/pay-for-items.sent.test.ts`, modelled on `pay-for-items.printed.test.ts`. Its fixture: `setupPartyVenue`; `setZoneSalePolicyOverride(tx, v.counter.zoneId, "paidWhen", "ticket_then_pay")`; one station routed as in `former-numbers.test.ts:40-63`; a receipt printer (`attachedPrinter`, `testing/working-order.test-support.ts:559`); the order sent with `testing/order-writer-fixture.ts`'s `placeOrder`.

**Interfaces:** Produces `withSentOrderOpen<T>(tx: Transaction, orderId: string, move: () => Promise<T>): Promise<T>` and `carryHandover(tx: Transaction, fromId: string, toId: string): Promise<void>`, both in `sent-order-open.ts`.

- [ ] **Step 1: Failing tests** in `pay-for-items.sent.test.ts`:
  - `"cash pays for chosen dishes on a sent Counter order on a bill of their own"`: the new bill is `settled`, its `sales` row's total equals the dishes' total, and the original is `placed` and holds the rest.
  - `"tells the kitchen nothing"`: `print_jobs` rows on kitchen printers and `kitchen_notices` are the same count after the payment's transaction as before. The moved line's `ticket_items` rows keep `id`, `fired_at`, `state`, `station_id` and carry `sent_order_number` = the original's number. Control in the same test: `moveDishes` of another sent dish on an open table bill does raise the count, as at `pay-for-items.move.test.ts:590-595`.
  - `"prints the paid part's receipt and no collection slip"`: exactly one new receipt-printer job, of kind `document`, linked to the new sale.
  - `"part of a sent line"`: 1 of 3 moves, the rest stays on the original, and no new kitchen job appears.
  - `"Waiting lists the paid part with the number it was sent under"`: in `listCounterWaiting`, the new bill has `status: "settled"` and `formerNumbers: [n]`, and the original has `status: "placed"` with its total reduced.
  - `"a handed-over original keeps the paid part off the kitchen screen"`: after `handOverOrder`, `listStationQueues` lists neither bill.
  - `"every dish chosen is refused, the order still placed"`: `bill.all_items_chosen`, and the rows are unchanged.
  - `"a part-paid original left exactly paid issues its invoice"` (mirror of `pay-for-items.move.test.ts:598`).
  - `"a sent order with a receipt is still refused bill.not_at_table"`, and its status stays `placed`.
  - `"the same submission twice makes one bill"`.
  - `"the preview prices a sent order's chosen dishes"`.

  Run `pnpm --filter @waitron/server exec vitest run src/pay-for-items.sent.test.ts` → FAIL with `bill.presented`.
- [ ] **Step 2: Implement** D3 and D5 in `sent-order-open.ts` and `pay-for-items.ts`. Pay for items' file stays under 1,000 lines.
- [ ] **Step 3: Verify.** Run the new file plus `src/pay-for-items.test.ts src/pay-for-items.move.test.ts src/pay-for-items.printed.test.ts src/former-numbers.test.ts`, all passing unedited, and `pnpm --filter @waitron/server typecheck`. Commit `git commit -s -m "Pay for chosen dishes on a Counter order already sent to the kitchen"`.

### Task 3: A card reader on a sent order: charged, declined, cancelled (server)

**Files:** Modify `apps/server/src/bill-payments.ts` (`movedItemsBack`, `:2379`: wrap its `moveOrderLines` in `withSentOrderOpen`, net 2 lines or fewer). Test: `apps/server/src/pay-for-items.sent.test.ts`, following `pay-for-items.printed.test.ts:355-485`.

- [ ] **Step 1: Failing tests:**
  - `"a declined card puts every dish back on the sent order, placed again"`: the new bill is `abandoned`, every line is back on the original, the original is `placed`, and no kitchen job or notice appears between the request and the decline's answer.
  - `"Cancel payment at the reader does the same"`.
  - `"a captured card settles the paid part and leaves the original placed"`.
  - `"a declined card leaves the dishes on their own bill when the original was paid meanwhile"`.

  Run the file → the decline test FAILs with dishes left on the new bill.
- [ ] **Step 2: Implement; Step 3: verify** the file plus `src/pay-for-items.card.test.ts`, and the server typecheck. Commit `git commit -s -m "Put a declined card's dishes back on the sent Counter order"`.

### Task 4: The till offers Items again; words, guides, backlog

**Files:**
- `apps/till/src/state/pay-for-items.ts:92-106`: `itemsBarredReason({ found, counter, printed })` returns the Find a bill reason, or the Counter reason only when `counter && printed`, else null. Drop `counterCollect` and `status` from it and from its one call, `till-app.ts:12233`.
- `apps/till/src/i18n/strings.ts:2027-2028` and `:4445-4446`: `bill_pay.items_barred_counter` becomes "A Counter order whose receipt is issued is paid with An amount, Split equally or Whole bill." / "Un pedido de mostrador con su ticket emitido se paga con Una cantidad, Dividir a partes iguales o Toda la cuenta."
- `apps/server/src/guide/en/table-service.md:986-989` and `es/table-service.md:1048-1051`: replace the sentence with "On a Counter order already sent to the kitchen, **Items** puts the chosen dishes on a bill of their own, which **Waiting** shows with the order's number in brackets." / "En un pedido de mostrador ya enviado a cocina, **Artículos** pasa los platos elegidos a una cuenta propia, que **En espera** muestra con el número del pedido entre paréntesis." These are the labels of `shell.waiting`, `strings.ts:487` and `:2933`.
- `docs/backlog/menu.md:776`: delete the COUNTER-SENT-ITEMS clause.

**Tests (these change deliberately):** `state/pay-for-items.test.ts:75-92` (sent Counter order and placed table bill → null; Counter with receipt → the Counter reason); `till-app-counter-payment-window.test.ts` "a Counter order just sent shows Items barred…" becomes "…offers Items, and paying them keeps the Counter on the order showing what is left"; `till-app-pay-for-items.test.ts:505-520` becomes "offers Items". The words test at `till-app-counter-payment-window.test.ts:305-312` stays as is.

- [ ] Failing tests → implement → `pnpm --filter @waitron/till exec vitest run src/state/pay-for-items.test.ts src/till-app-counter-payment-window.test.ts src/till-app-pay-for-items.test.ts`, the till's typecheck, and `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`, plus `pnpm exec vitest run scripts/guide-links.test.ts` from the root. Commit `git commit -s -m "Offer Items on a Counter order already sent to the kitchen"`.

## Try in the real till

1. `wa-wt demo <worktree>`. Set the Counter's zone to take payment after sending, with numbered collections. Send Burger, Paella and 3 beers without paying. Slip "N" prints and the kitchen screen shows N.
2. Pay > Items: choose Burger and 1 beer, then cash. A receipt for those two prints with no new number slip. The kitchen screen shows "M (was N)" with Burger and the beer, and N with the rest; nothing new prints in the kitchen.
3. Counter > Waiting shows "M (was N)" as paid and N as still sent, with its lower total. Hand over each.
4. Again with a reader card set to decline: every dish is back on N, and nothing prints.
5. Hand N over before paying, then pay for items: the paid part never reappears on the kitchen screen.
6. Pay > Items with every dish chosen: refused, and Whole bill pays it.

## Size

Production: about 25 lines of trigger SQL (plus the generated baseline), about 45 server lines (new file and `pay-for-items.ts`), 2 in `bill-payments.ts`, about 10 in the till, 4 string lines and 4 guide lines. Tests: about 300 server lines (new file), about 30 database lines, and about 50 till lines changed.
