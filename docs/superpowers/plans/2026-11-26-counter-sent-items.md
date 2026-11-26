# Pay > Items on a Counter order already sent to the kitchen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At the Counter, staff can pay for chosen dishes on an order that was sent to the kitchen before payment and has no receipt yet. The server moves those dishes to a bill of their own and takes the payment there. No credit note is needed, because no receipt exists.

**Architecture:** This reuses Pay for items' existing move (`moveItemsToNewBill`, `apps/server/src/pay-for-items.ts:220-267`). A sent order's dishes cannot leave it today, so for the length of the move (inside the payment's one transaction) the order goes back to `open`, and it is `placed` again before the payment is taken. That needs one new exception in the database's order-status rule, so core's starting migration is rebuilt and **every venue is reset**.

**Spec:** the owner's request of 25 November (picker answer "Build it next (Recommended)", "keeping the order's number"), the watcher's note on order numbers, and `docs/superpowers/plans/2026-11-24-a1515-1-pay-for-items-new-bill.md` (D10, PR3-D8). **Review:** fiscal, and it touches a migration: full `/finish-branch` wave with both Codex angles. The owner lands it.

## What the code says (from reading, except where marked "probe")

- **The dishes cannot move off a sent order today.** I ran a throwaway test (deleted afterwards) that sent a Counter order with `placeOrder`. `moveItemsToNewBill` refused it with `bill.presented` (`bill-actions.ts:66`), and a raw `placed → open` update was refused with "working order cannot make that transition" (`packages/db/triggers/core.sql:737-760`, pinned by `orders.transition.test.ts:359`). Lines move only between two open orders (`core.sql:389-398`; `working-order-transfer.ts:108-113`).
- **Probe, part 2.** In the same throwaway database I dropped only that status rule, then switched the order to open, moved the dish and switched the order back. The move worked. The moved dish's kitchen item kept its id, fired time, state and station, and gained `sent_order_number = 2`. No print job and no kitchen notice appeared. The kitchen queue listed "3 (was 2)". A cash payment then settled the new order. Waiting listed `2` as placed and `3 (was 2)` as settled. The test venue had no receipt printer, so the probe says nothing about receipts.
- **Placed with no receipt happens in one place only.** Only `placeOrder` makes an order `placed` without issuing its sale (`working-order-counter.ts:107-117`). Every other caller of `markOrderPlaced` issues first: `meal-end.ts:131/142`, `unpaid-departure.ts:121/132`, `deferred-close.ts:153/156`, `close-of-day.ts:120/128`.
- **Order numbers are unique** (`working_orders_order_number_key`, `packages/db/src/schema/orders.ts:146`) and come from `max + 1` (`allocate-order-number.ts:9-13`). The order number is not the invoice number, which belongs to the `sales` row issued at payment (`working-order-counter.ts:489-493`, `:565`).

## Decisions

- **D1. Data shape.**
  - **The new bill:** a new `working_orders` row, made as every Pay for items bill is (`moveDishes` with no target, `bill-actions.ts:362-395`). It names its source in `items_paid_from`, and its service context and way of eating are copied from the source (`working-order-open.ts:160-172`, `:201-204`).
  - **The original** keeps its row, number, unchosen dishes, `placed` status, money and `order_placed` record.
  - **Every dish chosen:** refused with `bill.all_items_chosen` before anything moves (`pay-for-items.ts:177-186`); staff pay with Whole bill instead.
  - **A card that charges nothing:** every dish goes back on the original (`movedItemsBack`, `bill-payments.ts:2363-2420`), with the original opened for that move too (D3).
  - **A card that charges nothing after the original was paid, cancelled or moved to a table meanwhile:** the dishes stay on their own *open* Counter bill, as they do on a table today (`bill-payments.ts:2319-2322`); after a move to a table the put-back is refused `tab.not_open`. Waiting does not list it, because Waiting reads only sent or paid orders (`working-order-counter.ts:467-479`). It shows under Held orders (`working-order-held-read.ts:195`, numbered "3 (was 2)" by `held-orders.ts:258`), where it is paid as any held order.
- **D2. Order number: a new number, shown as "(was N)". Needs the watcher's or owner's decision.** The watcher asked for the new bill to keep the original number, but the unique index refuses two rows with one number.
  - **Recommended:** what every move of sent dishes already does. The new bill takes the next number, and its kitchen items carry the number they were sent under (`stampSentOrderNumber`, `working-order-transfer.ts:192`, `:206-240`). The kitchen screen, the pass board and Counter > Waiting show "3 (was 2)" (`former-numbers.ts:9-37`; till `counter-waiting.ts:147`, `station-queue.ts:1171`, `pass-board.ts:424`).
  - **Keeping the same number**, measured by the reviewer:
    - Product code looks an order up by its number in only two places: the orders list's number search (`orders-list.ts:293`, which would then find both bills) and the hand-over between boxes, which renumbers a clashing order (`handover-return.ts:518-520`).
    - Today the index makes sure a number called out means one order. Dropping it means replacing it with a narrower database rule: a number may repeat only on a bill whose `items_paid_from` names the order holding that number. The hand-over's renumbering would need rethinking so it keeps such a pair together.
    - Rough size: 40–60 production lines in 3–4 files (`orders.ts`, `core.sql`, `handover-return.ts`) and about 80 test lines. The venue reset is already paid for here.
  - **Simpler alternative for the owner:** no server change, no reset, and the number stays. Staff use **An amount** on the sent order for the chosen dishes' price. The payer can ask for their own receipt, which states the amount but not the dishes (`bill-payments.ts:220-222`). The dishes appear on one receipt when the rest is paid. The cost to staff is adding up the dishes themselves, and the payer gets no itemised receipt for their part.
- **D3. How the move runs, and what that exposes.**
  - **The helper:** `withSentOrderOpen(tx, orderId, move)` acts only on a `placed` Counter order (no party) with no `sales` row. It sets the order to `open`, runs `move`, and sets it back to `placed` if `move` left it open. For any other bill it just runs `move`.
  - **Its two callers:**
    - `moveItemsToNewBill`, around everything from `guardPathParty` through `moveDishes`, so the advances check and `issueIfFullyPaid` run on the placed order as they do today;
    - `movedItemsBack`, around its whole savepoint body (Task 3).
  - **The database rule** gains one exception: `placed → open` is allowed while no `sales` row names the order and that one update changes nothing else.
  - **What this exposes.** That condition protects nothing across statements. Once the order is open, the database allows an open order to change anything (`core.sql:742`). A later statement could change its label, number, revision or `collected_at`, reprice a sent line, or delete one (which silently deletes its kitchen item, `ticket-items.ts:40-42`), and then set it back to `placed`. So a sent Counter order with no receipt becomes as exposed in the database as an open table bill holding sent dishes already is. Only the code protects it. A printed (issued) order stays frozen.
  - **The guard:** a root text-scanning test, `scripts/sent-order-open.test.ts`. It checks that no product file other than `apps/server/src/sent-order-open.ts` writes `status: "open"` in a `.set(` or `status = 'open'` in an `UPDATE`. It is weaker than its name: it reads text. It is proved once by deletion, with the control recorded in the PR; no self-mutation test is committed. Tests also check that the order is `placed` again after the move and after the put-back.
  - **Other way, for the watcher:** a rule at line level instead. Lines may move from a placed order with no sale to an open bill whose `items_paid_from` names it, and back, so the order row never leaves `placed`. This takes more server code, because splitting part of a line inserts a line into the source.
- **D4. Counter orders only** (the owner asked about the Counter). Only a sent Counter order with no receipt takes the new path.
  - **Moved to a table afterwards:** the till keeps today's bar, and the server keeps today's refusal: it tries to reopen and refuses `bill.not_issued` (`split-after-print.ts:161`).
  - **A placed Counter order with a receipt:** still refused with `bill.not_at_table` (`:155`). The till keeps its bar.
- **D5. Kitchen.** Nothing is sent again and no slip prints. Pay for items already moves dishes with `tellKitchen: false` (`pay-for-items.ts:246-249`), the put-back prints nothing, and the moved lines keep `sent_at`. If the original was already handed over (`collected_at`, allowed before payment, `working-order-counter.ts:400-408`), the new bill copies `collected_at`. Otherwise its dishes would reappear on the kitchen screen, which lists every order not yet collected (`working-order-station-queue.ts:398-401`).
- **D6. Collection ticket and Waiting.** No new slip prints for either part.
  - **When the order was sent:** the number slip "2" printed once, if the zone numbers collections (`working-order-counter.ts:119-121`, `receipt-print.ts:386-391`).
  - **The paid part:** an ordinary receipt whose "Order" line reads 3 (`invoice-layout.ts:232-233`). In a pay-after-sending zone no number slip prints, because a slip comes with a receipt only in a prepay zone (`receipt-print.ts:370-372`).
  - **Waiting:** lists "3 (was 2)" as paid and ready to hand over, and "2" as still sent with a lower total. The paid part sorts last, because Waiting is oldest-opened first (`working-order-counter.ts:482`). That matters little, since both rows show 2; no change is planned.
- **D7. Fiscal.** The paid part's receipt is an ordinary sale (`takeBillPaymentIn` → `issueIfFullyPaid`). No credit note is filed. Nothing in `packages/fiscal-verifactu` changes. `write-path.e2e.test.ts` and `inmutabilidad.test.ts` pass unedited.
- **D8. VAT.** The new bill copies the original's way of eating (`working-order-open.ts:201-204`). At issuing, rates are read from the way of eating and each line's product (`stored-order-lines.ts:113-134` → `line-vat-rates.ts:43-49`): the one eat-in rate for eat-in, and each product's takeaway rate, dated at the payment, for takeaway. Neither can change once the kitchen has the order (`core.sql:694-710`).
- **D9. Migration: yes.** This edits the trigger file `packages/db/triggers/core.sql` and rebuilds core's starting migration (`pnpm --filter @waitron/server migration-baseline rebuild --set core`), with no new migration file. Every venue is reset; the PR's first line says so. Another branch rebuilding core's starting migration will conflict: on rebase take main's copy (`git checkout --ours` during the rebase) and rebuild.
- **D10. A full-invoice choice.**
  - **What happens:** a sent Counter order can carry a full-invoice choice (F1, with the customer's tax details; `till-app.ts:7912-7915`). The new bill is always made F2 (`working-order-open.ts:252`). Moving some but not all dishes carries no invoice choice (`checkMoveInvoice`, `bill-actions.ts:299-314`), and Pay for items copies only the receipt language (`pay-for-items.ts:250-257`). So the paid part's receipt is a simplified invoice.
  - **Tables do the same today,** by reading: these lines date from #4280's branch (`2e2d06eb7a`, 2026-11-24, and `584f5fc894`, 2026-11-25), and nothing tests the case.
  - **Recommend keeping it** (not built). Paying by item usually means a different person pays, and copying would put their part on the first customer's full invoice.
  - **The other choice,** copying the original's invoice type, recipient columns and `invoice_delivery` onto the new bill, is a few lines in that same update plus one test. If the owner prefers it, it goes in Task 2b and applies to tables too.

## Review Focus

1. A card declined, or cancelled at the reader: the dishes go back to the original, which is `placed` again and not left `open`.
2. An original handed over before payment: the paid part never reappears on a kitchen screen.
3. An original part-paid with An amount: what is left, if exactly covered, issues and settles; if overpaid, it keeps the money and issues nothing.
4. Part of a sent line (100 g of 300 g of a dish sold by weight): its kitchen item splits and nothing is sent again.
5. A placed order with a receipt, or one at a table, is never switched to open.

### Task 1: Let a sent order with no receipt go back to open (database)

**Files:** Modify `packages/db/triggers/core.sql` (`working_orders_enforce_transition`, `:737`); regenerate `packages/db/drizzle/0000_baseline.sql`; test `packages/db/src/schema/orders.transition.test.ts`.

- [ ] **Step 1: Failing tests.** Change `:359` deliberately to `"rejects placed → open once a sale names the order, and a non-status update of a placed row"`: `placed → open` is refused with `TRANSITION_REFUSAL` after a `sales` row for the order is seeded, and the label edit stays refused. Add `"lets a placed order with no sale go back to open by status alone"`: the status change alone succeeds, and `{status:"open", label:"x"}` from placed is refused. Run `pnpm --filter @waitron/db exec vitest run src/schema/orders.transition.test.ts` → FAIL.
- [ ] **Step 2: Implement.** Add the branch `old.status='placed' AND new.status='open' AND NOT EXISTS (SELECT 1 FROM sales WHERE working_order_id = old.id)`, with every other column `IS old.<column>` as the `placed → placed` branch lists them. Update `:915` if it reads the branch. Rebuild core.
- [ ] **Step 3: Verify.** Run the test file above. From the root, run `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/starting-migrations.test.ts`. Then run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts src/write-path.e2e.test.ts`. Commit `git commit -s -m "Let a sent order with no receipt go back to open, for Pay for items (resets venues)"`.

### Task 2a: Pay for items on a sent Counter order: move, cash, kitchen silence (server)

**Files:**
- Create `apps/server/src/sent-order-open.ts` and `scripts/sent-order-open.test.ts` (D3's guard; add it to the root guards' shard lists if they name files).
- Modify `apps/server/src/pay-for-items.ts`:
  - `moveItemsToNewBill`;
  - `reopenIfPrinted` (`:372`): a placed Counter order with no sale returns `sent` unchanged;
  - `previewPayForItems` (`:579-582`): calls `refuseReopen` for every other placed bill.
- Export `hasInvoice` (`bill-payments.ts:1336`); this adds no line.
- Test: create `apps/server/src/pay-for-items.sent.test.ts`, modelled on `pay-for-items.printed.test.ts`. Its fixture:
  - `setupPartyVenue`;
  - `setZoneSalePolicyOverride(tx, v.counter.zoneId, "paidWhen", "ticket_then_pay")` and `(…, "collectionNumber", "numbered")` (`packages/venue-service/src/operations.ts:591`, `:661`);
  - one station routed as in `former-numbers.test.ts:40-63`;
  - a receipt printer (`attachedPrinter`, `testing/working-order.test-support.ts:559`);
  - `print-receipt` granted to the till profile as `pay-for-items.printed.test.ts:36-37` does;
  - the order sent with `testing/order-writer-fixture.ts`'s `placeOrder`.

**Interfaces:** Produces `withSentOrderOpen<T>(tx: Transaction, orderId: string, move: () => Promise<T>): Promise<T>` and `carryHandover(tx: Transaction, fromId: string, toId: string): Promise<void>`.

- [ ] **Step 1: Failing tests:**
  - `"cash pays for chosen dishes on a sent Counter order on a bill of their own"`: the new bill is `settled` with a `sales` row of the dishes' total; the original is `placed` again and holds the rest.
  - `"tells the kitchen nothing"`:
    - kitchen-printer `print_jobs` and `kitchen_notices` counts are unchanged across the payment's transaction;
    - the moved line's `ticket_items` keep `id`, `fired_at`, `state` and `station_id`, and carry `sent_order_number` = the original's number;
    - control: `moveDishes` of a sent dish on an open table bill raises the count (as at `pay-for-items.move.test.ts:590-595`).
  - `"prints the paid part's receipt and no collection slip"`: the baseline is taken after the order is sent, when its slip has printed. Counting *every* receipt-printer job (the slip is also a `document`, `receipt-print.ts:386-391`), exactly one is new, and it is linked to the new sale.
  - `"part of a sent line"`: 100 g of 300 g of a dish sold by weight moves, the rest stays, and no kitchen job appears.
  - `"every dish chosen is refused, the order still placed"`: `bill.all_items_chosen`, and the rows are unchanged.
  - `"a sent Counter order with a receipt is still refused bill.not_at_table"` and `"a sent order at a table is still refused bill.not_issued"`, each left `placed`.

  In `scripts/sent-order-open.test.ts`: `"only sent-order-open.ts sets an order back to open"`. Run `pnpm --filter @waitron/server exec vitest run src/pay-for-items.sent.test.ts` → FAIL with `bill.presented`.
- [ ] **Step 2: Implement** D3 and D5. Then run the deletion control: put a `status: "open"` set into another product file, watch the guard fail, revert, and note it for the PR.
- [ ] **Step 3: Verify.** Run the new file plus `src/pay-for-items.test.ts src/pay-for-items.move.test.ts src/pay-for-items.printed.test.ts src/former-numbers.test.ts`, which pass unedited. Run `pnpm exec vitest run scripts/sent-order-open.test.ts` and `pnpm --filter @waitron/server typecheck`. Commit `git commit -s -m "Pay for chosen dishes on a Counter order already sent to the kitchen"`.

### Task 2b: Waiting, hand-over, part-paid, resend, preview (server)

**Files:** `apps/server/src/pay-for-items.sent.test.ts`, and `pay-for-items.ts` if a test fails.

- [ ] **Step 1: Tests:**
  - `"Waiting lists the paid part with the number it was sent under"`: in `listCounterWaiting`, the new bill has `status: "settled"` and `formerNumbers: [n]`; the original is `placed` with a lower total.
  - `"a handed-over original keeps the paid part off the kitchen screen"`: after `handOverOrder`, `listStationQueues` lists neither bill.
  - `"a part-paid original left exactly paid issues its invoice"` (mirror of `pay-for-items.move.test.ts:598`).
  - `"the same submission twice makes one bill"`.
  - `"the preview prices a sent Counter order's chosen dishes, writing nothing"`.
- [ ] **Step 2: Fix any failure; Step 3: verify** as in Task 2a. Commit `git commit -s -m "Waiting, hand-over and resends for dishes paid on a sent Counter order"`.

### Task 3: A card reader on a sent Counter order (server)

**Files:** Modify `apps/server/src/bill-payments.ts` (`movedItemsBack`). Wrap the whole savepoint body (`:2377-2392`: the move, `bumpRevision`, the abandon and the party bump) in `withSentOrderOpen`, *inside* `tx.transaction`. That way `bumpRevision`, which bumps only open orders (`working-order-edit-state.ts:278-281`), still bumps the original, and a refusal the savepoint absorbs also rolls back the reopen. Net 2–3 lines: the file is at 2,722 lines against a 2,750 cap (`scripts/product-file-size-limits.json:27`). Test: `pay-for-items.sent.test.ts`, following `pay-for-items.printed.test.ts:355-485`.

- [ ] **Step 1: Failing tests:**
  - `"a declined card puts every dish back on the sent order, placed again"`: the new bill is `abandoned`, every line is back, the original is `placed` with its revision bumped, and no kitchen job or notice appears up to the decline's answer.
  - `"Cancel payment at the reader does the same"`.
  - `"a captured card settles the paid part and leaves the original placed"`.
  - `"a declined card after the original was paid meanwhile leaves the dishes on an open bill listed under Held orders"`.

  Run the file → the decline test FAILs.
- [ ] **Step 2: Implement; Step 3: verify** the file plus `src/pay-for-items.card.test.ts` and the server typecheck. Commit `git commit -s -m "Put a declined card's dishes back on the sent Counter order"`.

### Task 4: The till offers Items on a sent Counter order; words, guides, backlog

**Files:**
- `apps/till/src/state/pay-for-items.ts:92-106`, `itemsBarredReason`: Find a bill → `items_barred_found`; `counter && printed` → `items_barred_counter_receipt`; `!counter && status === "placed" && !printed` (a sent order moved to a table) → `items_barred_counter`; else null. Drop `counterCollect` from it and from its call at `till-app.ts:12233`.
- `apps/till/src/i18n/strings.ts:2027-2028` and `:4445-4446`:
  - `items_barred_counter` becomes "A Counter order sent to the kitchen and then moved to a table is paid with An amount, Split equally or Whole bill." / "Un pedido de mostrador enviado a cocina y pasado después a una mesa se paga con Una cantidad, Dividir a partes iguales o Toda la cuenta."
  - New `items_barred_counter_receipt`: "A Counter order whose receipt is issued is paid with An amount, Split equally or Whole bill." / "Un pedido de mostrador con su ticket emitido se paga con Una cantidad, Dividir a partes iguales o Toda la cuenta."
- Guides `apps/server/src/guide/en/table-service.md:986-989` and `es/table-service.md:1048-1051`. The sentence becomes "On a Counter order already sent to the kitchen, **Items** puts the chosen dishes on a bill of their own, which **Waiting** shows with the order's number in brackets; once moved to a table, such an order is paid with **An amount**, **Split equally** or **Whole bill**." The Spanish uses **Artículos** and **En espera** (`shell.waiting`, `strings.ts:487`, `:2933`). The "Pay in parts" clause stays.
- `docs/backlog/menu.md:776`: delete the COUNTER-SENT-ITEMS clause.

**Tests (these change deliberately):**
- `state/pay-for-items.test.ts:75-92`: a sent Counter order → null; a Counter order with a receipt → the receipt reason; a placed table bill with no receipt → `items_barred_counter`.
- `till-app-counter-payment-window.test.ts`: "a Counter order just sent shows Items barred…" becomes "…offers Items, and paying them keeps the Counter on the order showing what is left".
- `till-app-pay-for-items.test.ts:505-520` keeps its bar (a table bill) with the new words.
- The words test at `till-app-counter-payment-window.test.ts:305-312` also covers the new key.

- [ ] Failing tests → implement → `pnpm --filter @waitron/till exec vitest run src/state/pay-for-items.test.ts src/till-app-counter-payment-window.test.ts src/till-app-pay-for-items.test.ts` and the till's typecheck. Then `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`, and from the root `pnpm exec vitest run scripts/guide-links.test.ts`. Commit `git commit -s -m "Offer Items on a Counter order already sent to the kitchen"`.

## Try in the real till

1. `wa-wt demo <worktree>`. Set the Counter's zone to take payment after sending, with numbered collections. Send Burger, Paella and 300 g of a dish sold by weight (such as Sliced Iberian ham) without paying. Slip "N" prints and the kitchen screen shows N.
2. Pay > Items: choose Burger and 100 g of the weighed dish, then cash. A receipt for those two prints with no new number slip. The kitchen screen shows "M (was N)" with Burger and the 100 g, and N with the rest; nothing new prints in the kitchen.
3. Counter > Waiting shows "M (was N)" as paid (at the bottom) and N as still sent, with its lower total. Hand over each.
4. Again with a reader card set to decline: every dish is back on N, and nothing prints.
5. Hand N over before paying, then pay for items: the paid part never reappears on the kitchen screen.
6. Pay > Items with every dish chosen: refused, and Whole bill pays it. Move a sent Counter order to a table: Items is barred there.

## Size

Production: about 25 lines of trigger SQL (plus the generated baseline), about 50 server lines (the new file and `pay-for-items.ts`), 2–3 in `bill-payments.ts`, about 15 in the till, 8 string lines, 4 guide lines and a guard of about 40 lines. Tests: about 350 server lines (new file), about 30 database lines and about 60 till lines changed.
