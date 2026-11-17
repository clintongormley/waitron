# MEAL-END-TICKET: the table's receipt is issued when staff print the bill, paid or not — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`.

**Status: proposed 2026-11-17 by lane L; not yet reviewed.** It needs one fresh-context Opus read
against Part B1 before any implementer starts (lane L queue, MEAL-END-TICKET "Then").

**Authority.** Owner decision D1, 16 November (`docs/compliance/2026-11-15-adviser-answers.md`,
Part B1): "yes. The ticket is issued when the meal ends, even if the bill is paid much later"; the
meal ends when staff close the table (commit `7fccbf470e`). Owner, 17 November, in the watcher's
window (lane L `queue.md`, MEAL-END-TICKET): the printed pre-bill (A446) is not built; "when a
table asks for the bill, staff close the table, the real receipt prints, and guests pay against
it." Owner, 12 November 11:38 (`docs/superpowers/plans/2026-11-08-a1308-build-order.md:3-13`): for
part payments on a presented bill, "Yes, allow parts". The owner approved those outcomes, not this
design: every "Decision" below is lane L's, open to the owner.

**Goal.** Part B1's changes 1–3: (1) the receipt (simplified invoice, "ticket") is issued when the
table's meal ends, for everything on the bill, paid or not; (2) a part-paid bill can be recorded as
left without paying, with the ticket for the whole amount; (3) dishes not yet served no longer hold
the ticket back.

**Out of scope.** Change 4 (an advance-payment ticket for money paid during the meal) waits for
Thursday's question 15: a part payment taken before the bill is printed keeps today's handling (held
on the bill with no ticket of its own) and is counted in the ticket when the bill is printed. Also
out: the pre-bill (A446); `registros_facturacion`, `computeHuella`, the chain, invoice numbering;
any change to `recordSale`, `recordCorrection` or `recordSubstitution` (this plan only calls
`recordSale`, through the existing `issueUnpaidInvoice`, from a new moment). The receipt's
"Pendiente" line and the later-payment slip are PR 3 of
`docs/superpowers/plans/2026-11-17-receipt-layout-and-payments.md` (Tasks 7–9), which waits for
this item; see "Seam for the receipt-layout plan".

**Landing.** Fiscal: the owner lands both pull requests, and only after Thursday 19 November's
adviser answers are recorded (lane L queue). Two pull requests: PR A (server, Tasks 1–6), then PR B
(till and guide, Tasks 7–10).

**Size, honestly.** About 330 production lines on the server and 450 in the till, so about 780 in
all, with about 1,500 lines of tests and 120 of guide. **That is at the edge of the "larger than
medium" mark (about 800 production lines).** The till half is the larger: `apps/till/src/till-app.ts`
is 23,919 lines, and every table action is wired through it. Q3 below would save about 130 lines.

---

## 1. Today, traced

Read on `main` at `7e3101d3e1` unless marked **ran**. "Ran" means a temporary test case was added
to `apps/server/src/unpaid-departure.test.ts`, run with
`pnpm exec vitest run src/unpaid-departure.test.ts -t "PROBE"` from `apps/server`, and removed
(`git checkout` of the file); the case is described with what the failing answer would have printed.

**When the ticket is issued.** For a table's bill, only by the payment that leaves it fully paid:
`issueWhenFullyPaid` (`apps/server/src/bill-payments.ts:745-893`) returns without issuing unless the
bill is open or placed (`:767`), has at least one received payment and none pending (`:770`), has no
card refund pending (`:772`), has no unsent dishes in anyone's draft (`:774`, `readBillUnsent`,
`apps/server/src/bill-unsent.ts:8-37`), has a non-zero total (`:778`) and has received exactly its
total (`:779`). A whole payment in one go issues through `recordSale` in `till-sale.ts` instead
(the till's `#sendWholePayment`, `apps/till/src/till-app.ts:9528-9552`). Nothing checks whether
dishes were *served*; "unsent" means typed into a draft and not sent to the kitchen.

**What part payments do.** A part payment (`bill_payments`: items, contribution or share) is held on
the bill with no ticket (`docs/compliance/2026-11-15-adviser-answers.md` evidence table:
`bill-payments-api.test.ts:766`). When a later payment completes the bill, the ticket is issued for
the whole total and every held payment becomes one of its tenders (`bill-payments.ts:792-802`,
`:842`).

**What "close the table" is today.** Two different things in the till's menus:

- **Finish table** (ES «Cerrar mesa», `apps/till/src/i18n/strings.ts:1703, 3790`) frees the table. It
  refuses while any bill owes (`party.bill_outstanding`: `apps/server/src/parties.ts:787`,
  `apps/server/src/finish-party-service.ts:261`) and, for paid bills only, asks staff to cancel dishes
  still unserved (`finish-party-service.ts:276-284`). It issues nothing.
- **Mark bill requested** sets `parties.bill_requested_at` for the floor plan and nothing else
  (`apps/server/src/bill-request.ts:29-55`); it clears when a payment leaves nothing to pay
  (`:63-90`).

So a table cannot get its real receipt before paying in full.

**A bill presented ("placed") with a ticket.** Three paths issue a ticket without payment, each
through `priceForIssuance` and `issueUnpaidInvoice` (`apps/server/src/working-order.ts:7709-7798`)
and then `markOrderPlaced` (`:7814-7834`): an unpaid departure (`apps/server/src/unpaid-departure.ts:122-141`),
a deferred close (`apps/server/src/deferred-close.ts:149-176`, which also settles at once), and a
Counter "ticket then pay" order invoiced when placed (the fixture `placedCounterBillMovedTo`,
`apps/server/src/testing/bill-venue.ts:535`). Such a bill:

- is paid **whole** through `collect`/`/api/pay`, which settle the issued sale
  (`apps/server/src/till-sale.ts:1284-1286, 2291-2292`) and refuse a bill holding a part payment
  (`refuseBillHoldingMoney`);
- takes a **part** payment only when it already holds a received one: `requirePayableBill`
  (`bill-payments.ts:1065-1094`) admits a placed bill with an invoice only at `:1078-1080`, else falls
  to `requireOpenBill` (`:1092`). **Ran:** a bill left unpaid (issued, placed, no money), then a €5.00
  cash contribution: answered 409 `working_order.not_open`. Control: the same case expecting another
  code failed, printing `working_order.not_open` as received;
- once a part payment is held, settles from a later bill payment, the same sale reused: the
  `outstanding` branch of `issueWhenFullyPaid` (`bill-payments.ts:815-842`). **Ran:** a seated bill
  of €30.00 took a €5.00 cash contribution; the case then ran `priceForIssuance`,
  `issueUnpaidInvoice` and `markOrderPlaced` on it directly; a €25.00 cash contribution answered 200,
  and the bill had one sale, the same id, now with `settledAt` set, and status `settled`. A failure
  would have printed a 409, a second sale or `settledAt: null`.

The till matches: on a presented table bill **Pay** opens the presented bill's sheet, whole amount
only (`apps/till/src/screens/till-table-order-screen.ts:5325-5353`,
`apps/till/src/widgets/presented-pay-dialog.ts:71-73`), and the guide says so
(`apps/server/src/guide/en/table-service.md:798`).

**"Left without paying" (Record unpaid departure).** `recordUnpaidDeparture`
(`unpaid-departure.ts:73-191`) needs `sale.void`, issues the ticket for the whole bill unless it has
one (`:119-141`), records the debt in `unpaid_departures` (`:143-153`), stops the kitchen work still
to come on that bill (`:155`), and closes the table when nothing else blocks it (`:173-190`). It
refuses, for a bill without a ticket: dishes not sent, on hold, or waiting for the pass and not
fully served (`unpaid_departure.unfired_dishes`, `:111-112`; predicate `ordersWithUnfiredDish`,
`working-order.ts:4080-4126`), and **any money held from a payment**
(`unpaid_departure.bill_holds_payment`, `:113-114`; tests `unpaid-departure.test.ts:857-892,
1661-1691`). For a bill that already has a ticket it records `amountDue` as the debt
(`:120`), with no account of money received (none could be, until Task 1).

**Dishes not served.** They hold the ticket back only indirectly: Part B1's Example 3 (guests pay for
what they ate, the unserved dessert stays on the bill, the payments fall short). Unpaid departure is
the one path that refuses on dish state, and only for dishes the kitchen is not making.

**What the day's figures do** (read, not run): the VAT summary counts a sale on its issue day; the
cash-up counts each bill payment on the day and device it was received
(`packages/reporting/src/cash-up.ts:87-110`); "bills closed" per department counts a bill on its
`settled_at` day (`packages/reporting/src/closed-bills.ts:22`); the comment at
`packages/reporting/src/daily-close.ts:10-14` states the split.

**Corrections.** "Correct invoice" (A802) refuses a sale not yet settled
(`apps/server/src/invoice-corrections.ts:146`, `invoice_correction.not_settled`). "Cancel and credit"
on a presented bill credits the whole ticket and abandons the bill (`working-order.ts:7839-7946`).

---

## 2. The new behaviour, path by path

### 2.1 Print the bill (the meal ends)

A new **Whole table** action, **Print the bill** (ES «Imprimir la cuenta»; Q1). It acts on every
bill of the table's party family that still owes and has no ticket (`billOwes`,
`parties.ts:914-922`, and no `sales` row). In one transaction it:

1. refuses as Finish table does for a stale screen or someone else's unsent dishes
   (`checkAndBumpParty`, `requirePartyClosingEdits`, `parties.ts:833-842`), and for a payment in
   flight (`refusePaymentInFlight`, `working-order.ts:5961-5968`; `refusePlacedPaymentInFlight`,
   `till-sale.ts:1625-1639`);
2. refuses `meal_end.unfired_dishes` (naming the bill) when a bill holds a dish not sent or on hold,
   by the same `ordersWithUnfiredDish` the departure uses: staff send or remove it (Q4);
3. refuses `meal_end.unserved_dishes` (listing them) when a bill holds a dish sent to the kitchen but
   not fully served, unless the request acknowledges exactly those dishes: the till lists them so
   staff can remove any that will not come, then print (Q3);
4. refuses `meal_end.no_printer` when a bill that needs paper (a simplified invoice, or a full
   invoice staged for the receipt printer) has no receipt printer on this device (Q7);
5. for each bill: `priceForIssuance` at one pinned reading, `issueUnpaidInvoice`, `markOrderPlaced`
   when open; a €0.00 bill is then settled at once (`settleIssuedOwingNothing`,
   `till-sale.ts:2396-2403`, as the departure does at `unpaid-departure.ts:154`); a bill whose held
   payments already cover it is settled through `issueIfFullyPaid` (`bill-payments.ts:895-904`);
6. queues each bill's **original** receipt on this device's receipt printer
   (`enqueueOriginalReceipt`, `apps/server/src/receipt-print.ts:540`, built by `readSettledTicket`,
   `till-sale.ts:897-966`), except a full invoice staged for A4 or email, which
   `issueUnpaidInvoice` already reserved (`reserveStagedInvoiceDelivery`,
   `apps/server/src/invoice-choice-delivery.ts:68`);
7. leaves the party open and its tables held. **Finish table** still frees the table once every bill
   is paid or left unpaid, exactly as today.

The ticket's amount is the bill's total (its lines, as `priceForIssuance` prices them), whatever has
been paid. Its date is the moment of printing, the meal's end (D1); VAT is charged at that day's
rates (`priceForIssuance` prices "at the rates of today, its issue date", `working-order.ts:7708`).

**Decision: unserved dishes are settled first, never left off.** Leaving a dish off would need a
ticket priced from part of a bill, and the dish would then sit on a presented bill whose lines can
no longer change (`packages/db/src/schema/orders.ts:51-63`), with no way to remove or charge it.
Settling first uses only what exists: a dish not yet with the kitchen blocks (step 2); a dish the
kitchen has is listed (step 3) and staff remove it with today's **Cancel dish** (`cancelItem`,
`apps/server/src/line-cancel.ts:92`) or print with it on. Whatever is still unserved after payment is
handled by today's Finish table (`finish-party-service.ts:276-284`).

### 2.2 Paying a printed bill

Pay on a printed table bill opens the same **Pay** window as an unprinted bill: whole bill, an
amount, equal shares or items (owner, 12 November: "Yes, allow parts"). The server change is one
condition: `requirePayableBill` admits a placed bill with a ticket whether or not it already holds
money (Task 1). Everything after that exists and was run (§1): the payments are held as bill
payments, and the one that completes the amount due settles the existing sale with every payment as
a tender, under the same invoice number. A card part payment that completes later goes through the
same `issueWhenFullyPaid` from `completeBillPayment` (`bill-payments.ts:1499`).

After the last payment the till shows the change and no **Receipt / Full invoice / Email / None**
choice: the guests already have their receipt (Q8). **Receipt copy** is offered on a printed bill
before payment too (Task 7). Today's whole-amount sheet stays for a presented bill with no ticket
(a Counter order moved to a table).

**Decision: one rule for every issued, unsettled bill.** Task 1 also lets a bill left unpaid take
part payments (Q5); `docs/backlog/till.md` Task 17's "Collecting PART of the debt later is not built"
is deleted in Task 1.

### 2.3 Left without paying, part paid

`recordUnpaidDeparture` no longer refuses money held from a received payment. It issues the ticket
for the whole bill if the bill has none, keeps the held payments on it, and records as the debt what
is still owed: amount due less the net money received (tips and completed refunds out, as
`fundsOf` reads it). A pending payment is still refused (`order.payment_in_flight` from
`refusePaymentInFlight`). The `unpaid_departure.bill_holds_payment` code is deleted (pre-live:
CLAUDE.md §3 "Error codes"). The sale is not settled; collecting the rest later settles it, as in
§2.2. This also removes the reason the 1 October limit was kept: `docs/backlog/till.md` Task 17 notes
the sale "would have its invoice settled in part", which `settleSale` refuses; here it stays
unsettled until paid.

### 2.4 Worked examples (Madrid, trading day starting 05:00)

| Example | Today | After this plan |
|---|---|---|
| **B1 Example 1.** Table of four, €120. 21:30 Ana pays €30 by card and leaves; mains still to come. At 22:55 the table asks for the bill; 23:00 the others pay €90. | No ticket at 21:30 or 22:55; one €120 ticket at 23:00 listing both payments. | 21:30 unchanged (change 4 waits for question 15). 22:55 **Print the bill**: one €120 ticket, dated 22:55, prints; the bill owes €90. 23:00 the others pay €90 through **Pay**; the sale settles with the €30 and €90 as its tenders. Cash-up: €30 at 21:30 and €90 at 23:00 on their devices. |
| **B1 Example 2.** €120. Two guests pay €80 after the meal; the third leaves. | No ticket; "left without paying" refused (`bill_holds_payment`); the bill stays open. | If the bill was printed: the €120 ticket exists; **Record unpaid departure** records €40 owed. If not printed yet: the departure issues the €120 ticket and records €40 owed. The table can then be finished. |
| **B1 Example 3.** Guests pay on Monday for what they ate; a dessert ordered was never served; staff remove it on Wednesday. | No ticket until Wednesday's removal. | Monday, **Print the bill**: if the dessert never went to the kitchen (or is on hold), the till says so and staff remove it; if it went to the kitchen, the till lists it as not served and staff remove it or print with it on. The ticket is dated Monday. |
| A couple, €54, everything served. | €54 ticket at payment, then the document choice. | **Print the bill**: €54 ticket prints. **Pay** €54 by card; the till shows the result and returns to the table. **Finish table** as today. |
| Two bills at one table, €38.50 and €54.00. | Each ticket at its own full payment. | **Print the bill** issues and prints two tickets. Each bill is paid on its own. |
| A bill comped to €0.00. | €0.00 ticket when settled ("Comp closes it"). | **Print the bill** issues the €0.00 ticket and settles it in the same step. |
| A guest asks for a coffee after the bill is printed. | (Not reachable.) | The printed bill takes no new dishes (`bill.presented`, new wording in Task 10): put the coffee on **+ New bill**, which gets its own ticket. |
| Ticket printed 23:50 in a venue whose day starts at midnight; paid 00:05. | Ticket, VAT and takings all on day 2. | VAT on day 1 (issue day); the payment and "bills closed" on day 2 (`cash-up.ts:102`, `closed-bills.ts:22`). Nothing in reporting changes. |

---

## 3. Schema

**None.** Each new state uses existing columns and transitions: a party bill moves open → placed
(already allowed, `working_orders_enforce_transition`, `packages/db/triggers/core.sql:563-...`) and
placed → settled; `bill_payments` has no insert trigger that refuses a placed bill
(`core.sql:89-131` are update and delete guards only), and the run in §1 inserted one;
`unpaid_departures.amount` is already "the amount that invoice still owed when the party left"
(`packages/db/src/schema/unpaid-departures.ts:10-11`), with its `> 0` check kept by computing the
rest before inserting.

---

## 4. Where this meets other work

**PR #3398 (`feat/later-sale-date`, held until after 19 November).** Read by a subagent from
`gh pr diff 3398` (head `c05c6c0f26`), not run. It changes the bodies of `priceForIssuance` and
`issueUnpaidInvoice` (working-order.ts), `issueWhenFullyPaid`, `issueIfFullyPaid` and
`completeBillPayment` (bill-payments.ts), adds `apps/server/src/sale-day.ts` and the
`working_order_lines.last_served_at` column, and keeps every call this plan makes valid (it adds
only an optional `closedAt` option to `issueIfFullyPaid`). This plan changes none of those
bodies: in `bill-payments.ts` only `requirePayableBill` (main `:1065-1094`), and it does not touch
`working-order.ts`. Expected textual meeting: none in shared hunks; `errors.ts` and import lines
only. Meaning: after both land, **Print the bill** gets the PR's sale-day rule through
`priceForIssuance`; the PR's `lastServedAt` answers nothing while any owed dish is unserved, so the
ticket's date is the print moment, and when every dish was served on an earlier trading day (a bill
left open overnight) the ticket carries that day as the date of the sale, the owner's fallback of 16
November. The PR's Example 3 tests (`bill-left-open.later-sale-date.test.ts`, about lines 240 and
306) drive issuance by an edit through `issueIfFullyPaid`; this plan keeps that path, so they should
still pass, though D1 makes their situation rare. Whichever lands second rebases; the owner lands
both.

**A1308 (lanes E and H).** Checked by a subagent on 17 November (`gh pr list --state open`, the
lane queues and worktrees): no open A1308 pull request touches these files. Lane H's os1 (uncommitted worktree `refactor/h-a1308-os1-order-numbers`) changes one
line of `working-order.ts`, which this plan does not touch. os2 (queued) rewrites party and
bill-number handling in `parties.ts` and `finish-party-service.ts`: Task 2 changes `readPartyBills`
in `parties.ts`, a small overlap. os8 (owner-landed) adds person keys to `unpaid_departures`: Task 3
changes only how `insertDeparture`'s amount is worked out. os5, os6, os11 and os12–13 rewrite parts
of `bill-payments.ts`, not `requirePayableBill`. The unplanned "one way to pay" slice (build order
`:3-16`) will put every payment through the Pay window's route; Tasks 1 and 7 move printed table
bills onto that route already, and its plan must count printed bills among the payable ones.

**Other open PRs** touching the till files: #3661 and #3663 (`apps/till/src/till-app.ts`,
`api/client.ts`, strings); expect small rebases in PR B.

**Seam for the receipt-layout plan (PR 3, Tasks 7–9).** Its Task 7 lists "every builder of a
`TillSaleResult`": Print the bill builds its receipts with the existing `readSettledTicket`, adding no
builder, so Task 7's `readReceiptPayments` reaches them. A printed bill holding part payments is
exactly Task 7's "issued, unsettled F1/F2" whose payments sit in `bill_payments`. Task 9's survey
already names "a bill payment against an issued unpaid sale, `bill-payments.ts:815`": this plan
makes that the ordinary path and prints nothing at those payments, so Task 9 adds the slip without
undoing anything. Until PR 3 lands, a printed bill's receipt shows its total with no "Pendiente"
line, as an unpaid departure's receipt does today (`readTenderBlock` answers `unpaid`,
`till-sale.ts:422`).

---

## 5. Global constraints for every task

- Every server task ends by running, **unedited**:
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`.
  Read the `Tests` count; a run without one proves nothing.
- Focused runs use `pnpm --filter <pkg> exec vitest run <file> -t "<name>"`, never `pnpm test <file> -t`
  (CLAUDE.md §2).
- Database tests use the existing venue fixtures (`provisionBillVenue`, `seatedWith`,
  `seatedHeldWith`, `placedCounterBillMovedTo` in `apps/server/src/testing/bill-venue.ts`); rejected
  writes assert the domain error code.
- Money is exact `Decimal` at money scale; cents only at the row (CLAUDE.md §3).
- Coverage `98/98/98/95` in `@waitron/server` and `@waitron/till`. Comments only for an invariant or
  a non-obvious why; delete stale ones you pass, including the "before its invoice" wording of
  `PartyBill.outstanding` (`parties.ts:89-92`).
- Write no code for an event that cannot happen at a venue. In particular, lane L believes (read,
  not run) that a bill whose received money equals its total and has no ticket exists only while
  someone has unsent dishes on it, which step 1 of §2.1 refuses, since every edit that lowers a total
  calls `issueIfFullyPaid` (`line-cancel-api.ts:272`, `adjustments-api.ts:176, 241`,
  `till-api.ts:3263`). So build no branch for it beyond the one `issueIfFullyPaid` call in Task 4.
- Every existing assertion this plan changes is named in its task with before, after and the
  decision; any other existing assertion that fails is a defect in the change, not a test to update.

## Review focus

1. A printed bill can never be issued twice: a resend with the same submission id answers the first
   answer; a second Print the bill skips bills with a sale.
2. The settled sale's tenders add up to the amount due, tips apart, after any mix of payments taken
   before printing, after printing, by card completed later, and partly refunded.
3. The departure's recorded debt is amount due less net received, never the whole amount on a part-paid
   bill.
4. Nothing reaches `recordSale` other than through `issueUnpaidInvoice` and `issueWhenFullyPaid`.

---

## PR A — server

### Task 1: a printed bill takes part payments

**Files:** modify `apps/server/src/bill-payments.ts` (`requirePayableBill`) and
`apps/server/src/testing/issue-order.ts`; create `apps/server/src/bill-payments.after-ticket.test.ts`;
modify `apps/server/src/unpaid-departure.test.ts`;
modify `docs/backlog/till.md` (Task 17).

- [ ] **Step 1: failing tests** in the new file, each on a `seatedWith` bill issued and placed in a
  transaction by `priceForIssuance`, `issueUnpaidInvoice` and `markOrderPlaced` (a helper,
  `printOrderForTest`, added beside `issueOrderInvoice` in `apps/server/src/testing/issue-order.ts`): "a printed bill takes a cash contribution" (today 409 `working_order.not_open`, as
  run in §1); "the payment that completes a printed bill settles its ticket, with every payment as a
  tender" (one sale, same id, `settledAt` set, `tendersOfBill` = the payments, sum = amount due);
  "items and equal shares can be paid on a printed bill"; "a card part payment completed later
  settles the printed ticket" (through the bill-payment loop, as `bill-payments-loop.test.ts` drives
  one); "a part payment taken before printing is kept and counted" (pay €5, print, pay €25: two
  tenders); control: "a whole collect of a printed bill holding a part payment is still refused"
  (`bill.payments_received`).
- [ ] **Step 2: run** `pnpm --filter @waitron/server exec vitest run src/bill-payments.after-ticket.test.ts`
  — expect the first case FAIL with `working_order.not_open`.
- [ ] **Step 3: implement**: in `requirePayableBill`, a placed bill with a sale answers
  `{ payable: "placed", held }` whatever it holds. Delete the comment at `:1076-1077`, which states
  the old rule.
- [ ] **Step 4: change existing assertions** in `apps/server/src/unpaid-departure.test.ts` (decision:
  owner, 12 November, "allow parts"; this plan §2.2):
  - `:1386-1418` "lands a part payment or the departure, never both": **before**, one 200 and one
    409, a departure-first run refusing the payment `working_order.not_open`; **after**, with the
    departure first both answer 200, the payment held against the issued ticket. The payment-first
    branch changes in Task 3.
  - `:1420-1457` "lands a payment in full or the departure, never both, and invoices the bill once": **before**, a departure-first
    run refuses the payment; **after**, the departure-first payment answers 200 and settles the
    ticket (the departure row stays, as a debt collected in full does today). Payment-first is
    unchanged (`unpaid_departure.nothing_outstanding`).
- [ ] **Step 5: run** both files whole, then `bill-payments-api.test.ts`,
  `bill-payments.in-flight.test.ts`, `collect-by-invoice.test.ts` and the fiscal pair (§5). Expect PASS.
- [ ] **Step 6: backlog.** In `docs/backlog/till.md` "Task 17", delete the bullet "Collecting PART of
  the debt later is not built".
- [ ] **Step 7: commit** `git commit -s -m "A bill whose receipt is already issued can be paid in parts"`.

### Task 2: what a printed bill still owes

**Files:** modify `apps/server/src/parties.ts` (`readPartyBills`, `PartyBill.outstanding`'s doc);
test `apps/server/src/find-bill-bills.test.ts` (or the file that reads `GET /api/parties/:id/bills`
for placed bills; Step 1 names it).

- [ ] **Step 1: survey** where `outstanding` of a bill with a sale is read: the till's table foot and
  party total (`till-table-order-screen.ts`, `till-app.ts`), and the departure dialog, which reads
  `amountDue ?? outstanding` (`till-app.ts:19763, 19774`). List them in the commit message.
- [ ] **Step 2: failing tests:** "a printed bill with a €5 part payment owes its amount due less €5";
  "a credited presented bill owes its amount due" (`placedCounterBillMovedTo` plus a credit note, as
  `unpaid-departure.test.ts:813-830` builds one: €15.58 owed).
- [ ] **Step 3: run** the file with `-t "owes"` — expect FAIL.
- [ ] **Step 4: implement:** for a bill with a filed sale, `outstanding` = `amountDue` less the net
  received the family read already holds (`total − outstanding` from `readBillsOfParties`), floored
  at zero; unchanged for a bill without a sale.
- [ ] **Step 5: run** the file whole and `unpaid-departure.test.ts` — expect PASS. In
  `docs/backlog/till.md` Task 17, delete the bullet "The table screen still reads a credited presented
  bill at its full amount" once Task 7 Step 5 makes the till read `outstanding` alone; until then
  leave it.
- [ ] **Step 6: commit** `git commit -s -m "A presented bill's balance is its amount due less what it has received"`.

### Task 3: left unpaid with part paid

**Files:** modify `apps/server/src/unpaid-departure.ts`, `apps/server/src/errors.ts` (delete
`unpaid_departure.bill_holds_payment` and its doc), the HTTP status map that lists it
(`grep -rn bill_holds_payment apps/server/src`), `apps/till/src/i18n/codes.ts:174-177` and their
tests (`apps/till/src/i18n/codes.test.ts:479`, `apps/till/src/i18n/refund-wording.test.ts:60`);
tests `apps/server/src/unpaid-departure.test.ts`; `docs/backlog/till.md` Task 17.

- [ ] **Step 1: failing tests:** "records a part-paid bill as left unpaid, with the ticket for the whole
  bill and the rest as the debt" (€30.00 bill, €5.00 cash: 200, one sale of 3000, `placed`, departure
  `amount` 2500, the payment still `received`, no tender); "a printed bill with a part payment records
  only the rest" (print with `printOrderForTest` from Task 1, pay €5, depart: departure 2500); "collecting
  the rest later settles the ticket" (departure, then a €25 bill payment: settled, two tenders);
  "a pending card payment is still refused" (`order.payment_in_flight`).
- [ ] **Step 2: run** with `-t "part-paid|printed bill with a part|collecting the rest|pending card"` —
  expect FAIL (`unpaid_departure.bill_holds_payment`).
- [ ] **Step 3: implement:** drop `:113-114`; work out the debt as amount due (the issued sale's
  `amountDue`, or the invoice total just issued) less net received (`readPaymentMoney` and `fundsOf`,
  `bill-payments.ts:310, 363`), refusing `unpaid_departure.nothing_outstanding` when that is zero; keep
  `settleIssuedOwingNothing` for a €0.00 bill with nothing received.
- [ ] **Step 4: change existing assertions** (decision: D1 change 2):
  - `unpaid-departure.test.ts:1661-1691` "refuses a bill holding a payment, and writes nothing":
    **before** 409 `unpaid_departure.bill_holds_payment`; **after** rename to "records a bill holding a
    payment as left unpaid, owing the rest" and assert 200 and departure `amount` 2500.
  - `:857-892` "refuses a bill presented after a part payment at the counter, and writes nothing"
    (a Counter bill moved to the table holding €5): **before** 409 `bill_holds_payment` and no sale;
    **after** renamed "records a bill presented after a part payment at the counter as left unpaid",
    200, one sale for the whole bill, debt = amount due less €5.
  - `:1386-1418`, payment-first branch: **before** the departure refused `bill_holds_payment`;
    **after** both 200, debt €25.
  - till `codes.test.ts:479` and `refund-wording.test.ts:60`: delete the
    `unpaid_departure.bill_holds_payment` rows with the code.
- [ ] **Step 5: run** `unpaid-departure.test.ts`, `unpaid-departure-kitchen.test.ts`, the till's
  `src/i18n/codes.test.ts` and `src/i18n/refund-wording.test.ts`, `scripts/errors-reachable.test.ts`
  (root: `pnpm exec vitest run scripts/errors-reachable.test.ts`) and the fiscal pair. Expect PASS.
- [ ] **Step 6: backlog.** In `docs/backlog/till.md` Task 17, delete the "Known limit … a bill still
  holding money from a payment cannot be left unpaid" bullet.
- [ ] **Step 7: commit** `git commit -s -m "A part-paid bill can be left unpaid; the debt is what is still owed"`.

### Task 4: the meal-end command — issuing

**Files:** create `apps/server/src/meal-end.ts` and `apps/server/src/meal-end.test.ts`; modify
`apps/server/src/errors.ts` (`meal_end.unfired_dishes { partyId; workingOrderId }`,
`meal_end.nothing_to_issue { partyId }`).

**Interface:**
`endMeal(tx, deps: { admission; db; backend; clock; log?; attendance? }, cfg: DeviceRequestConfig,
partyId: string, req: { expectedPartyRevision: number; expectedEdits: BillEditExpected[];
submissionId: string; unservedLineIds?: string[] }, operatorId: string):
Promise<{ revision: number; bills: { workingOrderId: string; saleId: string; invoiceNumber: string;
total: string; owed: string }[] }>`, run through `runServiceCommand` with scope
`{ kind: "party", partyId }` and kind `"party.end_meal"`, as `requestBill` does
(`bill-request.ts:29-55`).

- [ ] **Step 1: failing tests** (`meal-end.test.ts`, on `provisionBillVenue`): "issues one ticket per
  bill that owes and has none, and leaves the table seated" (two bills; two sales; both `placed`; party
  `open`; table held); "a part-paid bill's ticket is for the whole bill and owes the rest"; "a €0.00
  bill is issued and settled"; "a bill already issued is left as it is" (a departed bill beside an
  unprinted one: one new sale); "refuses `meal_end.nothing_to_issue` when no bill needs a ticket";
  "refuses a dish on hold, naming its bill, and writes nothing" (`seatedHeldWith`); "refuses someone
  else's unsent dishes (`bill.unsent_dishes`) and a payment in flight (`order.payment_in_flight`)";
  "a resend with the same submission id answers the same and issues nothing more"; "a stale party
  revision is refused (`party.out_of_date`)". Each refusal also asserts `salesOf` is unchanged.
- [ ] **Step 2: run** `pnpm --filter @waitron/server exec vitest run src/meal-end.test.ts` — expect FAIL
  (module missing).
- [ ] **Step 3: implement** §2.1 steps 1, 2 and 5 with `requireEconomicWrite`,
  `backend.refuseUntilRecordable` and `backend.refuseNewIssuance` first, as
  `recordUnpaidDeparture` (`unpaid-departure.ts:87-93`) and `closeBillDeferredTx`
  (`deferred-close.ts:91-95`) do; one `pinnedAt` reading prices every bill. `owed` per bill is amount
  due less net received, as Task 3.
- [ ] **Step 4: run** the file and the fiscal pair — expect PASS.
- [ ] **Step 5: commit** `git commit -s -m "Ending a table's meal issues each unpaid bill's receipt"`.

### Task 5: the meal-end command — dishes not served, and printing

**Files:** modify `apps/server/src/meal-end.ts`, `apps/server/src/errors.ts`
(`meal_end.unserved_dishes { partyId; dishes: { billId; lineId; name; quantity }[] }`,
`meal_end.no_printer { partyId }`); test `apps/server/src/meal-end.test.ts`.

- [ ] **Step 1: survey** how `POST /api/sales/:id/receipt` (`till-api.ts`, `printSaleReceipt`,
  `till-sale.ts:968-994`, `tillReceiptOriginal`) decides the printer and the `print-receipt` profile
  action, and copy that decision; write it in the commit message.
- [ ] **Step 2: failing tests:** "lists a dish the kitchen has but has not served, and issues nothing"
  (served quantity below quantity; `meal_end.unserved_dishes` with that line); "prints once those
  dishes are acknowledged, with them on the ticket"; "a dish served meanwhile is not asked about
  again" (acknowledged list naming a dish now served: still issues); "a dish added to the list since"
  is refused again; "queues one original receipt per bill on this device's printer" (`printJobs`,
  `receiptCopy: false`); "a full invoice staged for email prints no receipt"; "refuses
  `meal_end.no_printer` on a device with no receipt printer, issuing nothing".
- [ ] **Step 3: run** with `-t "not served|acknowledged|original receipt|staged for email|no_printer"`
  — expect FAIL.
- [ ] **Step 4: implement** §2.1 steps 3, 4 and 6; the unserved list uses the same service-dish scope
  as Finish (`serviceDishCondition`, `serviceQuantities`).
- [ ] **Step 5: run** the file and the fiscal pair — expect PASS.
- [ ] **Step 6: commit** `git commit -s -m "Ending a meal asks about dishes not served and prints each receipt"`.

### Task 6: the route

**Files:** create `apps/server/src/meal-end-api.ts` (mounted from `till-api.ts` beside
`mountUnpaidDepartureApi`); modify the till API's HTTP status map for the four `meal_end.*` codes
(each 409); tests `apps/server/src/meal-end-api.test.ts`,
`apps/server/src/till-api.profile-actions.test.ts`, `apps/server/src/till-api.profile-zones.test.ts`,
`apps/server/src/till-api.session-person.test.ts`.

**Interface:** `POST /api/parties/:id/end-meal`, body `{ expectedPartyRevision, expectedEdits,
submissionId, unservedLineIds? }`. Session with `action: "take-orders"` and `permission:
"payment.take"` (issuing the ticket is the first step of taking payment); zones checked for the party;
`withIssuanceTransaction`, as `unpaid-departure-api.ts:54-84`.

- [ ] **Step 1: failing tests:** the route's answer and each refusal over HTTP; a person without
  `payment.take` is refused; a profile without `take-orders` is refused (inventory row and refusing
  case, CLAUDE.md §3 "A device's profile and the signed-in person must both allow…"); a till limited
  to another zone is refused (zone row); the session-person walk includes the route (add it to
  `BODIES`).
- [ ] **Step 2: run** those four files with `-t "end-meal|end_meal"` — expect FAIL.
- [ ] **Step 3: implement.**
- [ ] **Step 4: run** the four files whole and the fiscal pair — expect PASS.
- [ ] **Step 5: commit** `git commit -s -m "The till can end a table's meal"`, run `/finish-branch`,
  open PR A. The owner lands it after Thursday's answers are recorded.

---

## PR B — till and guide

### Task 7: client, the Whole table item, and paying a printed bill

**Files:** modify `apps/till/src/api/client.ts` (`endMeal`, its answer and the refusal shapes),
`apps/till/src/screens/till-table-order-screen.ts`, `apps/till/src/till-app.ts` (`#showPaidTicket`,
the departure amount), `apps/till/src/i18n/strings.ts`; tests
`apps/till/src/api/client.test.ts`, `apps/till/src/screens/till-table-order-screen.table-menu.test.ts`,
`.bill-payments.test.ts`, `.panel-footer.test.ts`, `apps/till/src/till-app-bill-payments.test.ts`.

- [ ] **Step 1: failing tests:**
  - client: `endMeal` posts the body and returns the answer.
  - table menu: **Print the bill** is in **Whole table** when a bill owes and has no
    `invoiceNumber`, absent otherwise; pressing it dispatches `end-meal`.
  - bill payments screen: "a printed bill's Pay asks for the bill Pay window" (placed, with
    `invoiceNumber`: `bill-pay` dispatched, `pay-presented` not). The existing "draws one Pay for a
    presented bill, which asks for the presented bill's sheet" (`:320-331`) keeps passing: its bill has
    no `invoiceNumber`.
  - panel footer / table menu: **Receipt copy** on a placed bill with a receipt
    (`till-table-order-screen.ts:6947`, today settled only).
  - till app: after the payment that settles a bill printed before it, no document choice opens and
    the change shows (`#showPaidTicket`, `till-app.ts:21754-21767`, passing `invoiceIssuedNow`
    `false` as `#payWholeTab` already does for an invoiced bill, `:20694`); the departure dialog's
    amount is the bill's `outstanding` (`:19763, 19774`).
- [ ] **Step 2: run** each file with `-t` on the new names — expect FAIL.
- [ ] **Step 3: implement.** In `#paySheetButton` (`till-table-order-screen.ts:5336-5353`), a placed
  bill with an `invoiceNumber` takes `#payPart("whole")`.
- [ ] **Step 4: run** the five files whole with `pnpm --filter @waitron/till exec vitest run <files>` —
  expect PASS. Check memory first (`memory_pressure | grep free`; CLAUDE.md §2).
- [ ] **Step 5: backlog.** Delete `docs/backlog/till.md` Task 17's "credited presented bill" bullet
  (Task 2 Step 5).
- [ ] **Step 6: commit** `git commit -s -m "The till pays a printed bill in parts and offers Print the bill"`.

### Task 8: the not-served dishes window

**Files:** create `apps/till/src/widgets/meal-end-dialog.ts`, `meal-end-dialog.test.ts`,
`meal-end-dialog.a11y.test.ts` (as `unpaid-departure-dialog.a11y.test.ts` does); strings.

A window with no typed input (so no draft scope): heading **{n} dishes not served yet**, one row
per dish (name, quantity, bill), the sentence, **Print the bill** and **Back**. It dispatches
`meal-end-confirm` with the line ids shown, or `meal-end-back`.

- [ ] **Step 1: failing tests:** rows and heading in English and Spanish; confirm carries the ids; Back
  closes; axe in both themes.
- [ ] **Step 2: run** — expect FAIL. **Step 3: implement.** **Step 4: run** — expect PASS.
- [ ] **Step 5: commit** `git commit -s -m "A window lists dishes not served before the bill prints"`.

### Task 9: the meal-end flow in the till

**Files:** modify `apps/till/src/till-app.ts`; create `apps/till/src/till-app-meal-end.test.ts`.
Model it on the departure flow (`#sendDeparture`, `till-app.ts:19818-19890`): one submission id per
press, `#resend` under `TABLE_REQUEST_LIMIT_MS`, nothing sent when the screen has changed.

- [ ] **Step 1: failing tests:** a press sends `endMeal` and rereads the party's bills, showing
  **Bill printed** (or **{n} bills printed**); `meal_end.unserved_dishes` opens Task 8's window, and
  its confirm resends with the ids and the same submission id; `meal_end.unfired_dishes` puts that
  bill on screen with its message; `meal_end.no_printer`, `meal_end.nothing_to_issue`,
  `bill.unsent_dishes` and `party.out_of_date` show their messages (the last reloads the table); a
  lost answer resent answers once.
- [ ] **Step 2: run** — expect FAIL. **Step 3: implement.** **Step 4: run** the file and
  `till-app-table-service.test.ts` — expect PASS.
- [ ] **Step 5: commit** `git commit -s -m "Print the bill ends the meal from the till"`.

### Task 10: words and guide

**Files:** `apps/till/src/i18n/strings.ts`, `apps/till/src/i18n/codes.ts` and their tests;
`apps/server/src/guide/en/table-service.md`, `apps/server/src/guide/es/table-service.md`;
`docs/backlog.md` and `docs/backlog/fiscal.md` if a line names the old rule.

**Till words** (English / Spanish; the watcher clears final wording, as for A1403):

| Key | English | Spanish |
|---|---|---|
| `table.end_meal` | Print the bill | Imprimir la cuenta |
| `meal_end.unserved_title` | {n} dishes not served yet | {n} platos aún sin servir |
| `meal_end.unserved_body` | These are on the bill. Remove any that will not be served, then print it. | Están en la cuenta. Quita los que no se vayan a servir y luego imprímela. |
| `meal_end.print` | Print the bill | Imprimir la cuenta |
| `meal_end.printed` | Bill printed | Cuenta impresa |
| `meal_end.printed_many` | {n} bills printed | {n} cuentas impresas |
| code `meal_end.unfired_dishes` | This bill has dishes not sent or on hold. Send or remove them, then print the bill. | Esta cuenta tiene platos sin enviar o en espera. Envíalos o quítalos y luego imprime la cuenta. |
| code `meal_end.nothing_to_issue` | Every bill at this table already has its receipt. Take payment, or finish the table. | Todas las cuentas de esta mesa ya tienen su tique. Cobra o cierra la mesa. |
| code `meal_end.no_printer` | This device has no receipt printer, so it cannot print the bill. Use a device that has one. | Este dispositivo no tiene impresora de tiques, así que no puede imprimir la cuenta. Usa uno que la tenga. |
| code `bill.presented` (changed) | This bill has been presented, so it cannot be changed. Put anything more on a new bill. | Esta cuenta ya se ha presentado, así que no se puede cambiar. Pon lo que pidan después en una cuenta nueva. |

`codes.test.ts:307-312` asserts today's `bill.presented` text: **before** "…so it cannot be changed";
**after** the row above (decision: this plan, the coffee example in §2.4).

**Guide**, from the code as built (CLAUDE.md §3 "A help bubble…", "A guide sentence earns its
place…"), both languages, anchors shared:

- new section **Print the bill** / **Imprimir la cuenta** `{#print-bill}`, after `{#bill-switcher}`:
  when to use it; that each unpaid bill gets its receipt now and prints here; send or remove dishes not
  sent; the not-served list; that a printed bill takes no new dishes (use **+ New bill**); choose
  **Full invoice** before printing; part payments taken earlier count;
- `{#pay-window}`: replace "A bill already presented for collection offers the whole amount only"
  (`table-service.md:798`) with what the code then does;
- `{#bill-switcher}`: add **Print the bill** to the **Whole table** list; in the unpaid departure
  paragraph replace "The bill remains owed in full" with what is still owed;
- `{#full-invoice}`: "Paying the table bill in full issues the invoice" gains printing the bill;
- `{#settlement-document}`: a bill printed before payment skips the choice.

- [ ] **Step 1:** update `codes.test.ts` and `strings.test.ts` expectations first; run
  `pnpm --filter @waitron/till exec vitest run src/i18n/codes.test.ts src/i18n/strings.test.ts` — expect
  FAIL; then the strings — expect PASS.
- [ ] **Step 2:** write the guide sections; run
  `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and, from the root,
  `pnpm exec vitest run scripts/guide-links.test.ts`. Open the till in `wa-wt demo <worktree>` and LOOK
  at the Whole table menu, the not-served window and a printed bill's Pay window, both themes, phone
  width; screenshots stay in the working folder (CLAUDE.md §6).
- [ ] **Step 3: commit** `git commit -s -m "Words and guide for printing the bill"`, run
  `/finish-branch`, open PR B. The owner lands it after PR A.

---

## 6. Open questions (each with lane L's default)

1. **The action's name, and whether the table stays seated.** Default: **Print the bill** /
   «Imprimir la cuenta» under **Whole table**; the table stays seated until its bills are paid or left
   unpaid, and **Finish table** frees it as today. The owner's word was "close the table", but the
   till's Spanish for Finish table is already «Cerrar mesa» (`strings.ts:3790`), so "close" would name
   two actions.
2. **Whole table only, or also one bill?** Default: whole table (every bill that owes and has no
   ticket). A guest leaving early still pays their own bill, which issues its ticket at that payment
   (the meal ends "at the last payment", owner, 16 November).
3. **Ask about dishes not served?** Default: yes, list them before printing so staff do not charge for a
   dessert that never comes (Example 3). Without it, saves about 130 lines (Task 8, Task 5's list).
4. **Dishes not sent or on hold.** Default: refuse and put the bill on screen; staff send or remove
   them. Removing them automatically is not proposed: the guests may still want them.
5. **Part payments on a bill left unpaid.** Default: allowed, the same rule as any issued bill
   (Task 1). Alternative: keep a left-unpaid debt collected whole only, at the cost of a second rule.
6. **Correcting a printed bill before payment** (a guest disputes a line). Not built: "Correct
   invoice" needs a settled sale (`invoice-corrections.ts:146`). Default: not in this item; staff take
   the payment and then correct the invoice with a refund (A802), or cancel and credit the whole bill.
   Decide after Thursday, beside the meeting's new question on splitting a printed ticket between two
   guests; this may deserve its own item, since printing before payment makes it common.
7. **A device with no receipt printer.** Default: refuse before issuing (`meal_end.no_printer`), since
   printing is the point. A full invoice staged for email or A4 needs no printer.
8. **After the last payment of a printed bill.** Default: show the change; no document choice. The
   receipt-layout plan's Task 9 later prints a payment slip there.
9. **The "Bill requested" mark.** Default: unchanged (clears when paid). Clearing it at print is a
   one-line alternative.
10. **A bill paid in full before anyone prints** keeps today's behaviour: the paying payment issues
    the ticket (the meal ends at the last payment). Default: keep.
11. **Who lands PR B.** Default: the owner, as PR A, because it is the first path staff use to issue a
    ticket before payment.
12. **Counter bills.** Default: not in this item; Print the bill is a table action.
