# MEAL-END-TICKET: a bill's receipt is issued when staff print the bill, paid or not — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`.

**Status: cleared to build 2026-11-17.** Revised the same day after one fresh-context review
("Ready after fixes": one critical, seven important, four minor findings, all folded in), then
amended for the answers recorded in lane L's `questions.md`: the watcher cleared §6's defaults 1
and 2 (17:20); the owner chose "Warn, let staff print" for dishes not yet served (17:50) and to
replace the adviser sheet's question 3 (17:52); and the owner asked that "once a bill is printed
(its invoice issued), neither invoice switch may happen" (17:59, lane L `queue.md`), which Task 3a
builds.

**Authority.** Owner decision D1, 16 November (`docs/compliance/2026-11-15-adviser-answers.md`,
Part B1): "yes. The ticket is issued when the meal ends, even if the bill is paid much later"; the
meal ends when staff close the table (commit `7fccbf470e`). Owner, 17 November, in the watcher's
window (lane L `queue.md`, MEAL-END-TICKET): the printed pre-bill (A446) is not built; "when a
table asks for the bill, staff close the table, the real receipt prints, and guests pay against
it." Owner, 12 November 11:38 (`docs/superpowers/plans/2026-11-08-a1308-build-order.md:3-13`): for
part payments on a presented bill, "Yes, allow parts". The owner approved those outcomes, not this
design: every "Decision" below is lane L's, open to the owner.

**Thursday's adviser sheet.** Question 3 of `docs/compliance/2026-11-19-adviser-meeting.md` (English
and Spanish) asks about this moment since `4941038c49`: the ticket is issued when staff print the
bill; staff are shown any dish not yet served and may print anyway.

**Goal.** Part B1's changes 1–3: (1) the receipt (simplified invoice, "ticket") is issued when the
meal ends, for everything on the bill, paid or not; (2) a part-paid bill can be recorded as left
without paying, with the ticket for the whole amount; (3) dishes not yet served no longer hold the
ticket back.

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
adviser answers are recorded (lane L queue). PR A (server, Tasks 1–5), then PR B (till and guide,
Tasks 6–10).

**Size.** About 270 production lines on the server and 380 in the till, about 650 in all, with
about 1,200 lines of tests and 120 of guide: medium. The review's cuts (no separate "what a printed
bill owes" change, one bill at a time, no confirmation window) took off about 170.

---

## 1. Today, traced

Read on `main` at `7e3101d3e1` unless marked **ran**. "Ran" means a temporary test case was added
to `apps/server/src/unpaid-departure.test.ts`, run with
`pnpm exec vitest run src/unpaid-departure.test.ts -t "PROBE"` from `apps/server`, and removed
(`git checkout` of the file); each says what a failing answer would have printed.

**When the ticket is issued.** For a table's bill, only by the payment that leaves it fully paid:
`issueWhenFullyPaid` (`apps/server/src/bill-payments.ts:745-893`) returns without issuing unless the
bill is open or placed (`:767`), has at least one received payment and none pending (`:770`), has no
card refund pending (`:772`), has no unsent dishes in anyone's draft (`:774`, `readBillUnsent`,
`apps/server/src/bill-unsent.ts:8-37`), has a non-zero total (`:778`) and has received exactly its
total (`:779`). A whole payment in one go issues through `recordSale` in `till-sale.ts` instead
(the till's `#sendWholePayment`, `apps/till/src/till-app.ts:9528-9552`). Nothing there checks whether
dishes were *served*; "unsent" means typed into a draft and not sent to the kitchen.

**What part payments do.** A part payment (`bill_payments`: items, contribution or share) is held on
the bill with no ticket (`docs/compliance/2026-11-15-adviser-answers.md` evidence table:
`bill-payments-api.test.ts:766`). When a later payment completes the bill, the ticket is issued for
the whole total and every held payment becomes one of its tenders (`bill-payments.ts:792-802`,
`:842`).

**What "close the table" is today.** Two different things in the till's menus:

- **Finish table** (ES «Cerrar mesa», `apps/till/src/i18n/strings.ts:1703, 3790`) frees the table. It
  refuses while any bill owes (`party.bill_outstanding`: `apps/server/src/parties.ts:787`,
  `apps/server/src/finish-party-service.ts:261`); the refusal offers **Take payment** for an unpaid
  bill (`apps/till/src/screens/till-table-order-screen.ts:5459-5481`). For paid bills it lists every
  line nobody marked served and asks staff to cancel it or send it to the counter
  (`finish-party-service.ts:276-284`). It issues nothing.
- **Mark bill requested** sets `parties.bill_requested_at` for the floor plan and nothing else
  (`apps/server/src/bill-request.ts:29-55`); it clears when a payment leaves nothing to pay
  (`:63-90`).

So a table cannot get its real receipt before paying in full.

**How a dish becomes "served".** Only by a waiter's tap. `servedQuantity` is written by
`writeServed` (`apps/server/src/working-order.ts:4159-4198`), called only from `markServed`,
`unmarkServed` and `markGroupServed` (`:4268, :4313`), whose only callers are the till routes
`POST /api/parties/:id/served`, `/unserved` and `/groups/:gid/served` (`apps/server/src/till-api.ts:3434-3466`,
profile action `hand-over-orders`), sent by the till's **Serve** (`#onServeLines`, `#onServeGroup`,
`till-app.ts:15332, 15414`). No kitchen, pass or made-here step writes it (grep of `servedQuantity:`
writers in `apps/server/src` and `packages/*/src`). Drinks count: the service-dish scope is every
top-level line except a set lunch's shell (`apps/server/src/service-dishes.ts:7-13`). **Ran:** a
seated bill of one Caña, and another of one Red wine bottle, each sent (a station ticket, `queued`),
paid in full and never marked served: Finish table answered 409 `party.unserved_dishes` listing the
drink, both times. A venue that marks dishes served would have seen 200. So every table finished
today already has each line served or cancelled; how often staff meet that list depends only on
whether they tap **Serve** as they serve. Not measured: a made-here line with no station ticket.

**A bill presented ("placed") with a ticket.** Three paths issue a ticket without payment, each
through `priceForIssuance` and `issueUnpaidInvoice` (`working-order.ts:7709-7798`) and then
`markOrderPlaced` (`:7814-7834`): an unpaid departure (`apps/server/src/unpaid-departure.ts:122-141`),
a deferred close (`apps/server/src/deferred-close.ts:149-176`, which also settles at once), and a
Counter "ticket then pay" order invoiced when placed (the fixture `placedCounterBillMovedTo`,
`apps/server/src/testing/bill-venue.ts:535`). Such a bill:

- is paid **whole** through `collect`/`/api/pay`, which settle the issued sale
  (`apps/server/src/till-sale.ts:1284-1286, 2291-2292`) and refuse a bill holding a part payment
  (`refuseBillHoldingMoney`). **Ran:** a €30.00 bill holding a €5.00 cash payment, issued and
  placed directly, then `POST /collect` of €25.00: 409 `bill.payments_received`;
- takes a **part** payment only when it already holds a received one: `requirePayableBill`
  (`bill-payments.ts:1065-1094`) admits a placed bill with an invoice only at `:1078-1080`, else falls
  to `requireOpenBill` (`:1092`). **Ran:** a bill left unpaid (issued, placed, no money), then a €5.00
  cash contribution: 409 `working_order.not_open`. Control: the same case expecting another code
  failed, printing `working_order.not_open` as received;
- once a part payment is held, settles from a later bill payment, the same sale reused: the
  `outstanding` branch of `issueWhenFullyPaid` (`bill-payments.ts:815-842`). **Ran:** a seated
  €30.00 bill took €5.00 in cash; the case issued and placed it directly; a €25.00 cash contribution
  answered 200, and the bill had one sale, the same id, now with `settledAt` set, and status
  `settled`. A failure would have printed a 409, a second sale or `settledAt: null`.

`GET /api/parties/:id/bills` already reads such a bill correctly. **Ran:** the €30.00 bill holding
€5.00, issued and placed: `outstanding` "25.00", `amountDue` "30.00", `holdsMoney` true. For a
credited presented bill with no money, `outstanding` is the line total and `amountDue` the credited
amount (`unpaid-departure.test.ts:1215, 1229`: 18.00 and 15.58).

The till matches the whole-only rule: on a presented table bill **Pay** opens the presented bill's
sheet, whole amount only (`till-table-order-screen.ts:5325-5353`,
`apps/till/src/widgets/presented-pay-dialog.ts:71-73`), and the guide says so
(`apps/server/src/guide/en/table-service.md:798`).

**Find bill and a presented bill holding money.** The list's `collection_status` is null for a bill
holding a payment (`apps/server/src/find-bill-bills.ts:86-88`), so the till does not collect it from
the list; it opens the bill at its table (`till-app.ts:8724-8749`), which fails with `held.stale`
when the table has been finished (`:8727-8730`), as a departure finishes it
(`unpaid-departure.ts:173-190`). Read, not run.

**"Left without paying" (Record unpaid departure).** `recordUnpaidDeparture`
(`unpaid-departure.ts:73-191`) needs `sale.void`, issues the ticket for the whole bill unless it has
one (`:119-141`), records the debt in `unpaid_departures` (`:143-153`), stops the kitchen work still
to come on that bill (`:155`), and closes the table when nothing else blocks it (`:173-190`). It
refuses, for a bill without a ticket: a dish not sent, on hold, or waiting for the pass and not yet
called (`unpaid_departure.unfired_dishes`, `:111-112`; `ordersWithUnfiredDish`,
`working-order.ts:4080-4126`, which counts a line neither released nor fully served-and-requested
at `:4119-4122`), and **any money held from a payment** (`unpaid_departure.bill_holds_payment`,
`:113-114`; tests `unpaid-departure.test.ts:857-892, 1662-1691`). For a bill that already has a
ticket it records `amountDue` as the debt (`:120`).

**Taking a dish off a bill that has its ticket.** Not possible before payment: Cancel dish's
remove-charge path calls `assertTabOpen` (`apps/server/src/line-cancel.ts:233-236`); "Correct
invoice" (A802) refuses a sale not yet settled (`apps/server/src/invoice-corrections.ts:146`,
`invoice_correction.not_settled`); "Cancel and credit" credits the whole ticket and abandons the bill
(`working-order.ts:7839-7946`) and is hidden once the bill holds a payment
(`till-table-order-screen.ts:6952`).

**What the day's figures do** (read, not run): the VAT summary counts a sale on its issue day; the
cash-up counts each bill payment on the day and device it was received
(`packages/reporting/src/cash-up.ts:87-110`); "bills closed" per department counts a bill on its
`settled_at` day (`packages/reporting/src/closed-bills.ts:22`); the comment at
`packages/reporting/src/daily-close.ts:10-14` states the split.

---

## 2. The new behaviour, path by path

### 2.1 Print the bill (the meal ends for that bill)

A new action on the bill on screen, **Print the bill** (ES «Imprimir la cuenta»), in **Bill ⋯** and
in Finish table's "still unpaid" refusal (§2.5). It acts on **one bill**, as Record unpaid departure
does: separate bills at one table are separate sales (adviser answer 1.9), and another bill's guests
may still be eating. For that bill, in one transaction, it:

1. refuses as the departure does for a stale screen, someone else's unsent dishes and a payment in
   flight (`checkAndBumpParty`, `requireBillEditors`, `assertBillHasNoUnsent`,
   `refusePaymentInFlight`, `refusePlacedPaymentInFlight`: `unpaid-departure.ts:94-117`), and
   refuses `meal_end.already_issued` when the bill already has a ticket, then
   `bill.nothing_outstanding` when the departure's `billOwes` says it owes nothing (a bill with no
   dishes, or one cancelled with Cancel order);
2. after step 3's paper checks (so a till that cannot print is refused before staff are asked to
   print anyway), unless the request says `printAnyway: true`, refuses `meal_end.unserved_dishes`, listing them,
   while any line on the bill is not fully served and not cancelled (the same reckoning as Finish:
   `serviceDishCondition` and `serviceQuantities(...).remaining`, `finish-party-service.ts:255-306`).
   Each listed dish says whether the kitchen has it (`isReleased`, `working-order.ts:3999-4011`): one
   it has can be marked served; one not sent, on hold or waiting to be called can be sent or taken
   off. With `printAnyway: true` it prints with those dishes on the ticket. `printAnyway` absent
   means false; any value but a boolean is refused `management.request_invalid` at the route;
3. refuses `meal_end.no_printer` when the bill needs paper (a simplified invoice, or a full invoice
   staged for the receipt printer) and this device's receipts resolve to no printer: its own chosen
   receipt printer, else its profile's default, a portable one only while this device holds it
   (`printerLookup`, `apps/server/src/receipt-print.ts:59-65`; `roleState`,
   `packages/layouts/src/device-equipment.ts:275-301`). That is where the device's receipts print
   today, so a handheld using a shared printer prints there;
4. `priceForIssuance` at one pinned reading, `issueUnpaidInvoice`, `markOrderPlaced` when open; a
   €0.00 bill is then settled at once (`settleIssuedOwingNothing`, `till-sale.ts:2396-2403`, as the
   departure does at `unpaid-departure.ts:154`);
5. queues the bill's **original** receipt on that printer (`enqueueOriginalReceipt`,
   `receipt-print.ts:540`, built by `readSettledTicket`, `till-sale.ts:897-966`), except a full
   invoice staged for A4 or email, which `issueUnpaidInvoice` already reserved
   (`reserveStagedInvoiceDelivery`, `apps/server/src/invoice-choice-delivery.ts:68`). When that
   delivery is not queued (an A4 printer switched off since it was chosen, or a failed reservation)
   it refuses `meal_end.delivery_unavailable { workingOrderId, medium }` and the whole issue rolls
   back (review finding, 17 November);
6. leaves the party open and its tables held. **Finish table** still frees the table once every bill
   is paid or left unpaid, as today.

The ticket's amount is the bill's total, whatever has been paid. Its date is the moment of printing
(D1); VAT is charged at that day's rates (`priceForIssuance` prices "at the rates of today, its issue
date", `working-order.ts:7708`).

**Decision (owner, 17 November 17:50, "Warn, let staff print"): dishes not yet served are shown,
and staff may print anyway.** Measured above: "served" is a waiter's tap, never automatic, drinks
included. The till lists the dishes, with **Mark served** for those the kitchen has and **Print
anyway**; nothing new is built for a dish that then never comes. It stays on the ticket, which
cannot be reduced before payment (§1, "Taking a dish off"); once the bill is paid, staff take it off
with the existing **Correct invoice** (A802), which refunds it, or, while the bill holds no payment,
**Cancel and credit** the whole ticket and print again. Change 3 holds: an unserved dish no longer
stops the ticket for days, as in Example 3. Finish table's demand that every paid line be served or
cancelled (`finish-party-service.ts:276-284`) is unchanged.

**Invoice type is locked once printed (owner, 17:59).** A printed bill's receipt is issued, so
neither switch, full to simplified nor simplified to full, may happen afterwards. Today such a
request is refused `working_order.not_open` (`readChoiceChangeableOrder`,
`working-order.ts:4829-4838`, for a placed bill holding a sale); Task 3a answers it
`invoice.choice_locked`, the refusal #3663 gives a full-invoice bill that has received a payment,
with wording that covers both causes. Choose **Full invoice** before printing.

### 2.2 Paying a printed bill

Pay on a printed table bill opens the same **Pay** window as an unprinted bill: whole bill, an
amount, equal shares or items (owner, 12 November: "Yes, allow parts"). The server change is one
condition: `requirePayableBill` admits a placed bill with a ticket whether or not it already holds
money (Task 1). Everything after that exists and was run (§1): the payments are held as bill
payments, and the one that completes the amount due settles the existing sale with every payment as
a tender, under the same invoice number. A card part payment that completes later goes through the
same `issueWhenFullyPaid` from `completeBillPayment` (`bill-payments.ts:1499`).

After the last payment the till shows the change and no **Receipt / Full invoice / Email / None**
choice: the guests already have their receipt (Q7). **Receipt copy** is offered on a printed bill
before payment too. Today's whole-amount sheet stays for a presented bill with no ticket (a Counter
order moved to a table).

**Decision: one rule for every issued, unsettled bill.** Task 1 also lets a bill left unpaid take
part payments (Q5).

### 2.3 Left without paying, part paid

`recordUnpaidDeparture` no longer refuses money held from a received payment. It issues the ticket
for the whole bill if the bill has none, keeps the held payments on it, and records as the debt what
is still owed: amount due less the net money received (tips and completed refunds out, as `fundsOf`
reads it). A pending payment is still refused (`order.payment_in_flight` from
`refusePaymentInFlight`). The `unpaid_departure.bill_holds_payment` code is deleted (pre-live:
CLAUDE.md §3 "Error codes"). The sale is not settled; collecting the rest later settles it, as in
§2.2. This also removes the reason the 1 October limit was kept: `docs/backlog/till.md` Task 17 notes
the sale "would have its invoice settled in part", which `settleSale` refuses; here it stays
unsettled until paid.

The till's departure window shows what is still owed: for a bill with a ticket, `amountDue` less
what it has received (`total − outstanding`), else `outstanding`. Not `outstanding` alone: for a
credited presented bill it is the uncredited 18.00 where the debt is 15.58 (§1).

### 2.4 Collecting the rest later (Find bill)

A guest who left part unpaid comes back to pay the rest. The table is finished, so the bill is
reached through **Find bill**. A presented bill with a ticket that holds money opens the bill **Pay**
window for what it still owes (as a Counter part-paid bill does, `till-app.ts:8770-8781`), instead of
opening its table. The bill-payments route then settles the ticket (§1, run).

### 2.5 Finish table's refusal offers Print the bill

Staff may skip Print the bill, take part payments, and press **Finish table**: it refuses
`party.bill_outstanding`. Its refusal (`till-table-order-screen.ts:5459-5481`) gains **Print the
bill** beside **Take payment** for the bill it names, when that bill has no ticket (CLAUDE.md §3: a
refusal explains and offers the next step). Printing it issues the ticket; staff then take the rest
or record the departure. That closes the gap through which B1's Example 3 would otherwise recur.

The not-served warning of §2.1 shows the dishes by name, with **Mark served** for those the kitchen
has (the existing serve command for those lines, on a device whose profile allows
`hand-over-orders`) and **Print anyway**, which sends the same request with `printAnyway: true`; the
others are sent or taken off with today's buttons.

### 2.6 Worked examples (Madrid, trading day starting 05:00)

| Example | Today | After this plan |
|---|---|---|
| **B1 Example 1.** Table of four, one bill, €120. 21:30 Ana pays €30 by card and leaves; mains still to come. At 22:55 the table asks for the bill; 23:00 the others pay €90. | No ticket at 21:30 or 22:55; one €120 ticket at 23:00 listing both payments. | 21:30 unchanged (change 4 waits for question 15). 22:55 **Print the bill** (every dish served): one €120 ticket, dated 22:55, prints; the bill owes €90. 23:00 the others pay €90 through **Pay**; the sale settles with the €30 and €90 as its tenders. Cash-up: €30 at 21:30 and €90 at 23:00 on their devices. |
| **B1 Example 2.** €120. Two guests pay €80 after the meal; the third leaves. | No ticket; "left without paying" refused (`bill_holds_payment`); the bill stays open. | If printed: the €120 ticket exists; **Record unpaid departure** records €40 owed. If not printed: the departure issues the €120 ticket and records €40 owed. The table can then be finished. Next week the third guest pays €40 through **Find bill**; the ticket settles. |
| **B1 Example 3.** Guests pay on Monday for what they ate; a dessert ordered was never served; staff remove it on Wednesday. | No ticket until Wednesday's removal. | Monday, **Print the bill** lists the dessert as not served; staff take it off (Cancel dish) and print: the ticket, dated Monday, is for what was eaten. If they press **Print anyway**, the dessert is on Monday's ticket, and once paid they refund it with **Correct invoice**. If staff skip printing and press **Finish table**, its refusal offers **Print the bill**, which lists the dessert the same way. |
| A couple, €54, everything marked served. | €54 ticket at payment, then the document choice. | **Print the bill**: €54 ticket prints. **Pay** €54 by card; the till shows the result and returns to the table. **Finish table** as today. |
| Two bills at one table, €38.50 (a couple who have finished) and €54.00 (still on dessert). | Each ticket at its own full payment. | **Print the bill** on Bill 1: its ticket prints; Bill 2 is untouched until its guests ask. |
| A bill comped to €0.00. | €0.00 ticket when settled ("Comp closes it"). | **Print the bill** issues the €0.00 ticket and settles it in the same step. |
| A guest asks for a coffee after the bill is printed. | (Not reachable.) | The printed bill takes no new dishes (`bill.presented`, new wording in Task 10): put the coffee on **+ New bill**, which gets its own ticket. |
| Ticket printed 23:50 in a venue whose day starts at midnight; paid 00:05. | Ticket, VAT and takings all on day 2. | VAT on day 1 (issue day); the payment and "bills closed" on day 2 (`cash-up.ts:102`, `closed-bills.ts:22`). Nothing in reporting changes. |

---

## 3. Schema

**None.** Each new state uses existing columns and transitions: a party bill moves open → placed
(already allowed, `working_orders_enforce_transition`, `packages/db/triggers/core.sql:563`) and
placed → settled; `bill_payments` has no insert trigger (`core.sql:89-131` and their copies in
`packages/db/drizzle/0000_baseline.sql:2949, 2987` are update and delete guards only), and the runs in
§1 inserted payments on a placed bill; `unpaid_departures.amount` is already "the amount that invoice
still owed when the party left" (`packages/db/src/schema/unpaid-departures.ts:10-11`), with its
`> 0` check kept by computing the rest before inserting.

---

## 4. Where this meets other work

**PR #3398 (`feat/later-sale-date`, held until after 19 November).** Read by a subagent from
`gh pr diff 3398` (head `c05c6c0f26`), not run. It changes the bodies of `priceForIssuance` and
`issueUnpaidInvoice` (working-order.ts), `issueWhenFullyPaid`, `issueIfFullyPaid` and
`completeBillPayment` (bill-payments.ts), adds `apps/server/src/sale-day.ts` and the
`working_order_lines.last_served_at` column, and keeps every call this plan makes valid. This plan
changes none of those bodies: in `bill-payments.ts` only `requirePayableBill` (main `:1065-1094`),
and in `working-order.ts` only `setOrderInvoiceChoice` and `readChoiceChangeableOrder` (Task 3a).
Expected textual meeting: `errors.ts` and import lines only. Meaning: after both land, **Print the bill** gets the PR's sale-day rule through
`priceForIssuance`. With **Print anyway**, some or none of the bill's dishes may be served at
printing; what the PR's rule answers for such a bill is not traced here. Whichever lands second
reads `sale-day.ts` as then built and adds one case: a bill printed anyway with no dish served. The PR's `last_served_at` is written by the same Serve tap §1 traces. The PR's
Example 3 tests (`bill-left-open.later-sale-date.test.ts`, about lines 240 and 306) drive issuance
by an edit through `issueIfFullyPaid`; this plan keeps that path, so they should still pass, though
D1 makes their situation rare. Whichever lands second rebases; the owner lands both.

**A1308 (lanes E and H).** Checked by a subagent on 17 November (`gh pr list --state open`, the
lane queues and worktrees): no open A1308 pull request touches these files. Lane H's os1
(uncommitted worktree `refactor/h-a1308-os1-order-numbers`) changes one line of `working-order.ts`,
which this plan does not touch. os2 (queued) rewrites party and bill-number handling in `parties.ts`
and `finish-party-service.ts`; this plan reads from both and changes neither. os8 (owner-landed) adds
person keys to `unpaid_departures`: Task 2 changes only how `insertDeparture`'s amount is worked out.
os5, os6, os11 and os12–13 rewrite parts of `bill-payments.ts`, not `requirePayableBill`. The
unplanned "one way to pay" slice (build order `:3-16`) will put every payment through the Pay
window's route; Tasks 1, 6 and 9 move printed bills onto that route already, and its plan must count
printed bills among the payable ones.

**Other open PRs** touching the till files: #3661 and #3663 (`apps/till/src/till-app.ts`,
`api/client.ts`, strings); expect small rebases in PR B.

**Seam for the receipt-layout plan (PR 3, Tasks 7–9).** Its Task 7 lists "every builder of a
`TillSaleResult`": Print the bill builds its receipt with the existing `readSettledTicket`, adding no
builder, so Task 7's `readReceiptPayments` reaches it. A printed bill holding part payments is
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
  (CLAUDE.md §2). Root guards run from the root as `pnpm exec vitest run scripts/<file>`.
- Database tests use the existing venue fixtures (`provisionBillVenue`, `seatedWith`,
  `seatedHeldWith`, `placedCounterBillMovedTo` in `apps/server/src/testing/bill-venue.ts`); rejected
  writes assert the domain error code and that nothing was written.
- Money is exact `Decimal` at money scale; cents only at the row (CLAUDE.md §3).
- Coverage `98/98/98/95` in `@waitron/server` and `@waitron/till`. Comments only for an invariant or
  a non-obvious why; delete stale ones you pass, including the "before its invoice" wording of
  `PartyBill.outstanding` (`parties.ts:89-92`), which money received after the ticket makes wrong.
- Write no code for an event that cannot happen at a venue.
- Every existing assertion this plan changes is named in its task with before, after and the
  decision; any other existing assertion that fails is a defect in the change, not a test to update.

## Review focus

1. A bill is never issued twice: a resend with the same submission id answers the first answer; a
   second Print the bill on the same bill is refused `meal_end.already_issued`.
2. The settled sale's tenders add up to the amount due, tips apart, after any mix of payments taken
   before printing, after printing, by card completed later, and partly refunded.
3. The departure's recorded debt, and the till's departure window, show amount due less net
   received, never the whole amount on a part-paid bill, and the credited amount on a credited one.
4. Nothing reaches `recordSale` other than through `issueUnpaidInvoice` and `issueWhenFullyPaid`.
5. Once a bill's receipt is issued, no invoice-choice request changes it, in either direction.

---

## PR A — server

### Task 1: a printed bill takes part payments

**Files:** modify `apps/server/src/bill-payments.ts` (`requirePayableBill`) and
`apps/server/src/testing/issue-order.ts`; create `apps/server/src/bill-payments.after-ticket.test.ts`;
modify `apps/server/src/unpaid-departure.test.ts`; modify `docs/backlog/till.md` (Task 17).

- [ ] **Step 1: failing tests** in the new file, each on a `seatedWith` bill issued and placed in a
  transaction by `priceForIssuance`, `issueUnpaidInvoice` and `markOrderPlaced` (a helper,
  `printOrderForTest`, added beside `issueOrderInvoice` in `apps/server/src/testing/issue-order.ts`):
  "a printed bill takes a cash contribution" (today 409 `working_order.not_open`, as run in §1); "the
  payment that completes a printed bill settles its ticket, with every payment as a tender" (one
  sale, same id, `settledAt` set, `tendersOfBill` = the payments, sum = amount due); "items and equal
  shares can be paid on a printed bill"; "a card part payment completed later settles the printed
  ticket" (through the bill-payment loop, as `bill-payments-loop.test.ts` drives one); "a part payment
  taken before printing is kept and counted" (pay €5, print, pay €25: two tenders); control: "a whole
  collect of a printed bill holding a part payment is still refused" (`bill.payments_received`, as
  run in §1).
- [ ] **Step 2: run** `pnpm --filter @waitron/server exec vitest run src/bill-payments.after-ticket.test.ts`
  — expect the first case FAIL with `working_order.not_open`.
- [ ] **Step 3: implement**: in `requirePayableBill`, a placed bill with a sale answers
  `{ payable: "placed", held }` whatever it holds. Delete the comment at `:1076-1077`, which states
  the old rule.
- [ ] **Step 4: change existing assertions** in `apps/server/src/unpaid-departure.test.ts` (decision:
  owner, 12 November, "allow parts"; this plan §2.2). Both titles say "never both", which stops being
  true; rename them:
  - `:1386-1418` "lands a part payment or the departure, never both, with %s": **before**, one 200
    and one 409, a departure-first run refusing the payment `working_order.not_open`; **after**,
    renamed "lands a part payment and the departure in either order, with %s"; departure first, both
    answer 200, the payment held against the issued ticket. The payment-first branch changes in
    Task 2.
  - `:1420-1457` "lands a payment in full or the departure, never both, and invoices the bill once,
    with %s": **before**, a departure-first run refuses the payment; **after**, renamed "lands a
    payment in full and the departure, invoicing the bill once, with %s"; departure first, the payment
    answers 200 and settles the ticket (the departure row stays, as a debt collected in full does
    today). Payment first is unchanged (`unpaid_departure.nothing_outstanding`).
  - `:1910` `it.each` "refuses a new payment $label on the bill left unpaid after its card was given
    back, as on one never paid, writing nothing", and `:2362` "refuses a part payment on the departed
    bill, so its invoice is never filed again and the row stands": **before** 409
    `working_order.not_open`; **after** (decision: §6 question 4, part payments on a bill left unpaid
    are allowed) the payment answers 200 and is held, the bill still has exactly one sale with the
    same id and invoice number, nothing is filed again, and the departure row stands. Rename each to
    say so.
  - Any other existing assertion that fails because a placed bill with a ticket now takes part
    payments changes under the same decision and is named in the PR's "Changed test checks"; one
    that fails for any other reason is a defect in the change.
- [ ] **Step 5: run** both files whole, then `bill-payments-api.test.ts`,
  `bill-payments.in-flight.test.ts`, `collect-by-invoice.test.ts` and the fiscal pair (§5). Expect PASS.
- [ ] **Step 6: backlog.** In `docs/backlog/till.md` "Task 17", delete the bullet "Collecting PART of
  the debt later is not built"; Task 9 builds the till's half.
- [ ] **Step 7: commit** `git commit -s -m "A bill whose receipt is already issued can be paid in parts"`.

### Task 2: left unpaid with part paid

**Files:** modify `apps/server/src/unpaid-departure.ts`, `apps/server/src/errors.ts` (delete
`unpaid_departure.bill_holds_payment`, `:713-723` region), `apps/server/src/till-api.ts:623` (its HTTP
status), `apps/till/src/i18n/codes.ts:174-177`; tests `apps/server/src/unpaid-departure.test.ts`,
`apps/till/src/i18n/codes.test.ts`, `apps/till/src/i18n/refund-wording.test.ts`,
`apps/till/src/till-app-parties.test.ts`, `apps/till/src/widgets/unpaid-departure-dialog.test.ts`;
`docs/backlog/till.md` Task 17.

- [ ] **Step 1: failing tests:** "records a part-paid bill as left unpaid, with the ticket for the whole
  bill and the rest as the debt" (€30.00 bill, €5.00 cash: 200, one sale of 3000, `placed`, departure
  `amount` 2500, the payment still `received`, no tender); "a printed bill with a part payment records
  only the rest" (print with `printOrderForTest`, pay €5, depart: departure 2500); "collecting the
  rest later settles the ticket" (departure, then a €25 bill payment: settled, two tenders); "a pending
  card payment is still refused" (`order.payment_in_flight`).
- [ ] **Step 2: run** with `-t "part-paid|printed bill with a part|collecting the rest|pending card"` —
  expect FAIL (`unpaid_departure.bill_holds_payment`).
- [ ] **Step 3: implement:** drop `:113-114`; work out the debt as amount due (the issued sale's
  `amountDue`, or the invoice total just issued) less net received (`readPaymentMoney` and `fundsOf`,
  `bill-payments.ts:310, 363`), refusing `unpaid_departure.nothing_outstanding` when that is zero; keep
  `settleIssuedOwingNothing` for a €0.00 bill with nothing received.
- [ ] **Step 4: change existing assertions** (decision: D1 change 2):
  - `unpaid-departure.test.ts:1662-1691` "refuses a bill holding a payment, and writes nothing":
    **before** 409 `unpaid_departure.bill_holds_payment`; **after** renamed "records a bill holding a
    payment as left unpaid, owing the rest", 200 and departure `amount` 2500.
  - `:857-892` "refuses a bill presented after a part payment at the counter, and writes nothing"
    (a Counter bill moved to the table holding €5): **before** 409 `bill_holds_payment` and no sale;
    **after** renamed "records a bill presented after a part payment at the counter as left unpaid",
    200, one sale for the whole bill, debt = amount due less €5.
  - `:1386-1418`, payment-first branch: **before** the departure refused `bill_holds_payment`;
    **after** both 200, debt €25.
  - till `codes.test.ts:479` and `refund-wording.test.ts:60`: **before** each lists
    `unpaid_departure.bill_holds_payment` with its sentence; **after** the row is deleted with the code.
  - till `till-app-parties.test.ts:10831`, `it.each(["unpaid_departure.unfired_dishes",
    "unpaid_departure.bill_holds_payment"])` "keeps the dialog open with %s's own sentence, and reads
    the bills again": **before** two rows; **after** only `unpaid_departure.unfired_dishes`.
  - till `widgets/unpaid-departure-dialog.test.ts:136`, the same `it.each` pair in "says %s in its own
    sentence above the action, beside no field": **before** two rows; **after** only
    `unpaid_departure.unfired_dishes`.
- [ ] **Step 5: run** `unpaid-departure.test.ts`, `unpaid-departure-kitchen.test.ts`, the four till
  files above, root `scripts/errors-reachable.test.ts` and the fiscal pair. Expect PASS.
- [ ] **Step 6: backlog.** In `docs/backlog/till.md` Task 17, delete the "Known limit … a bill still
  holding money from a payment cannot be left unpaid" bullet.
- [ ] **Step 7: commit** `git commit -s -m "A part-paid bill can be left unpaid; the debt is what is still owed"`.

### Task 3: the meal-end command

**Files:** create `apps/server/src/meal-end.ts` and `apps/server/src/meal-end.test.ts`; modify
`apps/server/src/errors.ts` (`meal_end.already_issued { workingOrderId }`,
`meal_end.unserved_dishes { workingOrderId; dishes: { lineId; dishName; quantity; released }[] }`).

**Interface:**
`endMeal(tx, deps: { admission; db; backend; clock; log?; attendance? }, cfg: DeviceRequestConfig,
partyId: string, req: { billId: string; expectedPartyRevision: number; expectedEdits:
BillEditExpected[]; submissionId: string; printAnyway: boolean }, operatorId: string): Promise<{ revision: number;
workingOrderId: string; saleId: string; invoiceNumber: string; total: string; owed: string }>`, run
through `runServiceCommand` with scope `{ kind: "party", partyId }` and kind `"party.end_meal"`, as
`requestBill` does (`bill-request.ts:29-55`).

- [ ] **Step 1: failing tests** (`meal-end.test.ts`, on `provisionBillVenue`; dishes marked served
  with `markServed` unless the case says otherwise): "issues the bill's ticket and leaves the table
  seated" (one sale; bill `placed`; party `open`; table held; total = bill total); "leaves the
  table's other bill alone"; "a part-paid bill's ticket is for the whole bill and owes the rest"; "a
  €0.00 bill is issued and settled"; "refuses a bill that already has a ticket"; "warns of a dish not
  marked served, listing it as one the kitchen has, and issues nothing" (`seatedWith`, not served);
  "lists a dish on hold as one the kitchen does not have" (`seatedHeldWith`); "prints anyway with
  `printAnyway`, the unserved dish on the ticket" (one sale, its line included); "a dish cancelled
  in full is not listed";
  "refuses someone else's unsent dishes (`bill.unsent_dishes`) and a payment in flight
  (`order.payment_in_flight`)"; "a resend with the same submission id answers the same and issues
  nothing more"; "a stale party revision is refused (`party.out_of_date`)". Each refusal also asserts
  `salesOf` is unchanged.
- [ ] **Step 0: survey** whether a line on a placed bill with a ticket can still be marked served,
  have its hold released and be called away (`markServed`, `releaseHeldWorkOf`,
  `order-groups.ts:1058`, `fireLines`, `working-order.ts:2237`, and their routes). Run one case for
  each and record each answer in the commit message. If any refuses, a dish printed anyway could not
  be sent to the kitchen afterwards: write `## WATCHER-NEEDED:` in lane L's `questions.md` before
  going on, and build nothing for it meanwhile.
- [ ] **Step 2: run** `pnpm --filter @waitron/server exec vitest run src/meal-end.test.ts` — expect FAIL
  (module missing).
- [ ] **Step 3: implement** §2.1 steps 1, 2, 4 and 6, with `requireEconomicWrite` and
  `backend.refuseUntilRecordable` after the saved answer for the submission id is looked up, so a
  resend gets its first answer while the start waits for its time (as `bill-payments.ts`,
  `deferred-close.ts` and `till-sale.ts` do; review finding, 17 November). `owed` is amount due less net received, as Task 2.
- [ ] **Step 4: run** the file and the fiscal pair — expect PASS.
- [ ] **Step 5: commit** `git commit -s -m "Printing a bill issues its receipt, warning of dishes not yet served"`.

### Task 3a: a printed bill's invoice type is locked

**Files:** modify `apps/server/src/working-order.ts` (`setOrderInvoiceChoice`,
`readChoiceChangeableOrder`), `apps/till/src/i18n/codes.ts` (`invoice.choice_locked`'s wording);
tests `apps/server/src/meal-end.test.ts`, `apps/server/src/counter-handover.test.ts`.

- [ ] **Step 1: failing tests** in `meal-end.test.ts`: "a printed, unpaid simplified bill refuses a
  switch to a full invoice" and "a printed, unpaid full-invoice bill refuses a switch to a simplified
  one", each through `PUT /api/working-orders/:id/invoice-choice` after `endMeal`, answering 409
  `invoice.choice_locked` with `params: {}`, the order row and its sale unchanged. Control: the same
  bill before printing switches both ways (200).
- [ ] **Step 2: run** with `-t "refuses a switch"` — expect FAIL with `working_order.not_open`.
- [ ] **Step 3: implement:** for an invoice-choice request, an open or placed order holding an
  issued sale answers `invoice.choice_locked`; the receipt-language request
  (`setOrderReceiptLanguage`) keeps `working_order.not_open`. The received-payment lock of #3663
  (`working-order.ts:4873-4880`) is unchanged.
- [ ] **Step 4: change existing assertion** `counter-handover.test.ts:186-214` "refuses to change a
  placed order after its simplified invoice was issued": **before** 409 `working_order.not_open`
  with `{ workingOrderId }`; **after** 409 `invoice.choice_locked` with `{}`, the row and sale count
  checks unchanged (decision: owner, 17 November 17:59).
- [ ] **Step 5: wording** (the watcher clears final wording): `invoice.choice_locked` becomes "This
  bill already has its receipt or a payment, so it can no longer switch between a full and a
  simplified invoice." / "Esta cuenta ya tiene su tique o un pago, así que ya no puede cambiar entre
  factura completa y simplificada." Run `pnpm --filter @waitron/till exec vitest run
  src/i18n/codes.test.ts src/till-app-bill-payments.test.ts`.
- [ ] **Step 6: run** `meal-end.test.ts`, `counter-handover.test.ts`, `bill-payments-api.test.ts`,
  `bill-editing.order-choices.test.ts` and the fiscal pair — expect PASS.
- [ ] **Step 7: commit** `git commit -s -m "A bill's invoice type is locked once its receipt is issued"`.

### Task 4: printing

**Files:** modify `apps/server/src/meal-end.ts`, `apps/server/src/errors.ts`
(`meal_end.no_printer { workingOrderId }`); test `apps/server/src/meal-end.test.ts`.

- [ ] **Step 1: survey** how `POST /api/sales/:id/receipt` (`till-api.ts`, `printSaleReceipt`,
  `till-sale.ts:968-994`, `tillReceiptOriginal`) decides the printer and the `print-receipt` profile
  action, and use the same decision; write it in the commit message.
- [ ] **Step 2: failing tests:** "queues one original receipt on the device's chosen receipt printer"
  (`printJobs`, `receiptCopy: false`); "a device with no printer of its own prints on its profile's
  default"; "a full invoice staged for email prints no receipt and needs no printer"; "refuses
  `meal_end.no_printer` when the device's receipts resolve to no printer, issuing nothing".
- [ ] **Step 3: run** with `-t "original receipt|profile's default|staged for email|no_printer"` —
  expect FAIL.
- [ ] **Step 4: implement** §2.1 steps 3 and 5.
- [ ] **Step 5: run** the file and the fiscal pair — expect PASS.
- [ ] **Step 6: commit** `git commit -s -m "Printing a bill prints its receipt where the device's receipts print"`.

### Task 5: the route

**Files:** create `apps/server/src/meal-end-api.ts` (mounted from `till-api.ts` beside
`mountUnpaidDepartureApi`); modify the till API's HTTP status map for the three `meal_end.*` codes
(each 409); tests `apps/server/src/meal-end-api.test.ts`,
`apps/server/src/till-api.profile-actions.test.ts`, `apps/server/src/till-api.profile-zones.test.ts`,
`apps/server/src/till-api.session-person.test.ts`.

**Interface:** `POST /api/parties/:id/end-meal`, body `{ billId, expectedPartyRevision,
expectedEdits, submissionId, printAnyway? }`. Session with `action: "take-orders"` and `permission:
"payment.take"` (issuing the ticket is the first step of taking payment); zones checked for the
party; `withIssuanceTransaction`, as `unpaid-departure-api.ts:54-84`. The session, the device on an
unretired profile allowing `take-orders`, the person's admission to it, `payment.take` and the zone
are checked again inside the write, as `deferred-close-api.ts`'s `stillAllowed` does (review
finding, 17 November).

- [ ] **Step 1: failing tests:** the route's answer and each refusal over HTTP; a person without
  `payment.take` is refused; a profile without `take-orders` is refused (inventory row and refusing
  case, CLAUDE.md §3 "A device's profile and the signed-in person must both allow…"); a till limited
  to another zone is refused (zone row); the session-person walk includes the route (add it to
  `BODIES`).
- [ ] **Step 2: run** those four files with `-t "end-meal|end_meal"` — expect FAIL.
- [ ] **Step 3: implement.**
- [ ] **Step 4: run** the four files whole and the fiscal pair — expect PASS.
- [ ] **Step 5: commit** `git commit -s -m "The till can print a bill before payment"`, run
  `/finish-branch`, open PR A. The owner lands it after Thursday's answers are recorded.

---

## PR B — till and guide

**2026-11-17:** Tasks 6 and 9 moved to PR A after the finish-branch review: two run-it reviewers found that PR A alone left the existing till overstating a part-paid departure's debt and unable to collect its rest.

Before each till run, check memory (`memory_pressure | grep free`; CLAUDE.md §2) and run files with
`pnpm --filter @waitron/till exec vitest run <files>`.

### Task 6: paying a printed bill, and what the departure window owes

**2026-11-17:** moved to PR A after the finish-branch review: two run-it reviewers found that PR A alone left the existing till overstating a part-paid departure's debt and unable to collect its rest.

**Files:** modify `apps/till/src/screens/till-table-order-screen.ts` (`#paySheetButton`),
`apps/till/src/till-app.ts` (`#showPaidTicket`, `#onRecordUnpaidDeparture`),
`apps/till/src/state/bill-state.ts` (a `stillOwed(bill)` helper); tests
`apps/till/src/screens/till-table-order-screen.bill-payments.test.ts`,
`apps/till/src/state/bill-state.test.ts`, `apps/till/src/till-app-bill-payments.test.ts`,
`apps/till/src/till-app-parties.test.ts`.

- [ ] **Step 1: failing tests:**
  - "a printed bill's Pay asks for the bill Pay window" (placed, with `invoiceNumber`: `bill-pay`
    dispatched, `pay-presented` not). The existing "draws one Pay for a presented bill, which asks
    for the presented bill's sheet" (`:320-331`) keeps passing: its bill has no `invoiceNumber`.
  - after the payment that settles a bill printed before it, no document choice opens and the change
    shows (`#showPaidTicket`, `till-app.ts:21754-21767`, passing `invoiceIssuedNow` `false`, as
    `#payWholeTab` already does for an invoiced bill, `:20694`).
  - `stillOwed`: a printed €30 bill holding €5 owes 25.00; a credited presented bill (total 18.00,
    `amountDue` 15.58, nothing received) owes 15.58; an unprinted bill owes `outstanding`. The
    departure window shows `stillOwed` (today `amountDue ?? outstanding`, `till-app.ts:19763, 19774`).
- [ ] **Step 2: run** each file with `-t` on the new names — expect FAIL.
- [ ] **Step 3: implement.** In `#paySheetButton` (`till-table-order-screen.ts:5336-5353`), a placed
  bill with an `invoiceNumber` takes `#payPart("whole")`.
- [ ] **Step 4: run** the four files whole — expect PASS.
- [ ] **Step 5: commit** `git commit -s -m "The till pays a printed bill in parts and shows what a departure still owes"`.

### Task 7: the Bill ⋯ item, the client, and Receipt copy

**Files:** modify `apps/till/src/api/client.ts` (`endMeal`, its answer, the refusal shapes),
`apps/till/src/screens/till-table-order-screen.ts` (`#tableMenu` bill items, `#billDocumentItems`),
`apps/till/src/i18n/strings.ts`; tests `apps/till/src/api/client.test.ts`,
`apps/till/src/screens/till-table-order-screen.table-menu.test.ts`,
`apps/till/src/screens/till-table-order-screen.panel-footer.test.ts`.

- [ ] **Step 1: failing tests:** client `endMeal` posts the body and returns the answer; **Print the
  bill** is in **Bill ⋯** for an owing bill with no `invoiceNumber` and not left unpaid, absent
  otherwise, and dispatches `end-meal` with the bill's id; **Receipt copy** is offered on a placed
  bill with a receipt (`till-table-order-screen.ts:6947`, today settled only).
- [ ] **Step 2: run** — expect FAIL. **Step 3: implement.** **Step 4: run** the three files whole —
  expect PASS.
- [ ] **Step 5: commit** `git commit -s -m "Bill ⋯ offers Print the bill and a printed bill's receipt copy"`.

### Task 8: the print flow, and Finish table's refusal

**Files:** modify `apps/till/src/till-app.ts`, `apps/till/src/screens/till-table-order-screen.ts`
(`#finishRefusal`, a not-served refusal block beside it); create
`apps/till/src/till-app-meal-end.test.ts`; tests
`apps/till/src/screens/till-table-order-screen.table-menu.test.ts` (or the file holding
`#finishRefusal`'s cases).

Model the send on the departure flow (`#sendDeparture`, `till-app.ts:19818-19890`): one submission
id per press, `#resend` under `TABLE_REQUEST_LIMIT_MS`, nothing sent when the screen has changed.

- [ ] **Step 1: failing tests:** a press sends `endMeal` and rereads the party's bills, showing
  **Bill printed**; `meal_end.unserved_dishes` shows the dishes by name with **Mark served** for those
  the kitchen has (sends the existing `markServed` for those lines; hidden on a profile without
  `hand-over-orders`) and **Print anyway** (sends `printAnyway: true`, one new submission id), and a
  press of Print the bill after serving them prints; **Full invoice** is not offered in **Bill ⋯** for
  a bill with an `invoiceNumber` (if it is today, hide it); `meal_end.no_printer`,
  `meal_end.delivery_unavailable`, `meal_end.already_issued`, `bill.unsent_dishes` and `party.out_of_date` show their messages (the
  last reloads the table); a lost answer resent answers once; Finish table's refusal shows **Print the
  bill** beside **Take payment** for the named bill when it has no `invoiceNumber`, and not when it
  has one.
- [ ] **Step 2: run** — expect FAIL. **Step 3: implement.** **Step 4: run** the files and
  `till-app-table-service.test.ts` — expect PASS.
- [ ] **Step 5: commit** `git commit -s -m "Print the bill from the till, and from Finish table's refusal"`.

### Task 9: Find bill collects the rest of a printed bill

**2026-11-17:** moved to PR A after the finish-branch review: two run-it reviewers found that PR A alone left the existing till overstating a part-paid departure's debt and unable to collect its rest.

**Files:** modify `apps/till/src/till-app.ts` (the Find bill row handler, `:8670-8790`); tests
`apps/till/src/till-app-find-bill.test.ts` (or the file holding the Find bill row cases; Step 1 names
it) and `apps/server/src/find-bill-api.test.ts`.

- [ ] **Step 1: verify first.** Add a server case to `find-bill-api.test.ts`: a part-paid bill left
  unpaid (Task 2) is listed with `state` "part-paid", `collectionStatus` null and its `invoiceNumber`;
  and a till case reproducing today's answer for that row: it opens the table and shows `held.stale`
  (`till-app.ts:8724-8730`). Run both; record what each printed. If the till case does not show
  `held.stale`, stop and report: the premise is wrong.
- [ ] **Step 2: failing till test:** "Find bill opens the Pay window for the rest of a printed bill
  holding a payment", whether or not its table is still seated, with the bill's edit state; paying the
  rest settles it (stubbed API answer with `invoice`).
- [ ] **Step 3: implement:** a row with `orderStatus` "placed", an `invoiceNumber` and `state`
  "part-paid" opens `#openBillPaying("contribution", …, row.stillOwed, { surface: "counter", … })`,
  as the open Counter part-paid branch does (`:8770-8781`).
- [ ] **Step 4: run** both files whole — expect PASS.
- [ ] **Step 5: commit** `git commit -s -m "Find bill takes the rest of a printed bill"`.

### Task 10: words and guide

**Files:** `apps/till/src/i18n/strings.ts`, `apps/till/src/i18n/codes.ts` and their tests;
`apps/server/src/guide/en/table-service.md`, `apps/server/src/guide/es/table-service.md`.

**Till words** (English / Spanish; the watcher clears final wording, as for A1403):

| Key | English | Spanish |
|---|---|---|
| `bill.print` | Print the bill | Imprimir la cuenta |
| `bill.printed` | Bill printed | Cuenta impresa |
| `meal_end.unserved_heading` | Not served yet: | Aún sin servir: |
| `meal_end.mark_served` | Mark served | Marcar como servidos |
| `meal_end.print_anyway` | Print anyway | Imprimir igualmente |
| code `meal_end.unserved_dishes` | Some dishes on this bill are not marked served. Mark served what has been served, or print anyway: a dish that never comes is refunded after payment with Correct invoice. | Algunos platos de esta cuenta no están marcados como servidos. Marca como servido lo que se ha servido, o imprime igualmente: un plato que no llegue se devuelve después del cobro con Rectificar factura. |
| code `meal_end.already_issued` | This bill already has its receipt. Take payment, or print a receipt copy. | Esta cuenta ya tiene su tique. Cóbrala o imprime una copia del tique. |
| code `meal_end.no_printer` | This device has no receipt printer. Choose one in Equipment, then print the bill. | Este dispositivo no tiene impresora de tiques. Elige una en Equipo y luego imprime la cuenta. |
| code `meal_end.delivery_unavailable` | This full invoice cannot go where it was chosen to go. Choose another printer or email, then print the bill. | Esta factura completa no puede ir adonde se eligió. Elige otra impresora u otro correo y luego imprime la cuenta. |
| code `bill.presented` (changed) | This bill has been presented, so it cannot be changed. Put anything more on a new bill. | Esta cuenta ya se ha presentado, así que no se puede cambiar. Pon lo que pidan después en una cuenta nueva. |

`codes.test.ts:307-312` asserts today's `bill.presented` text: **before** "…so it cannot be changed";
**after** the row above (decision: this plan, the coffee example in §2.6).

**Guide**, from the code as built (CLAUDE.md §3 "A help bubble…", "A guide sentence earns its
place…"), both languages, anchors shared:

- new section **Print the bill** / **Imprimir la cuenta** `{#print-bill}`, after `{#bill-switcher}`:
  when to use it; that the bill gets its receipt now and prints where this device's receipts print;
  dishes not yet served are listed, with **Mark served** and **Print anyway**; that a printed bill
  takes no new dishes (use **+ New bill**); choose **Full invoice** before printing, as it cannot be
  changed afterwards; part payments taken earlier count;
  each bill at the table is printed on its own;
- `{#pay-window}`: replace "A bill already presented for collection offers the whole amount only"
  (`table-service.md:798`) with what the code then does;
- `{#bill-switcher}`: add **Print the bill** to the bill's ⋯ list; in the Finish table paragraph,
  its refusal's **Print the bill**; in the unpaid departure paragraph, replace "The bill remains owed
  in full" with what is still owed, and say the rest is taken later from **Find bill**;
- `{#full-invoice}`: "Paying the table bill in full issues the invoice" gains printing the bill, and
  the way back to a simplified invoice (#3663) is open until the bill is printed or a payment is
  received;
- `{#settlement-document}`: a bill printed before payment skips the choice.

- [ ] **Step 1:** update `codes.test.ts` and `strings.test.ts` expectations first; run
  `pnpm --filter @waitron/till exec vitest run src/i18n/codes.test.ts src/i18n/strings.test.ts` — expect
  FAIL; then the strings — expect PASS.
- [ ] **Step 2:** write the guide sections; run
  `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and, from the root,
  `pnpm exec vitest run scripts/guide-links.test.ts`. Open the till in `wa-wt demo <worktree>` and LOOK
  at Bill ⋯, the not-served refusal, Finish table's refusal and a printed bill's Pay window, both
  themes, phone width; screenshots stay in the working folder (CLAUDE.md §6).
- [ ] **Step 3: commit** `git commit -s -m "Words and guide for printing the bill"`, run
  `/finish-branch`, open PR B. The owner lands it after PR A.

---

## 6. Open questions (each with lane L's default; **watcher** marks the ones to confirm before building)

1. **Cleared by the watcher, 17:20 — The action's name.** **Print the bill** / «Imprimir la cuenta». The owner's word was
   "close the table", but the till's Spanish for Finish table is already «Cerrar mesa»
   (`strings.ts:3790`), so "close" would name two actions.
2. **Cleared by the watcher, 17:20 — One bill at a time.** Print the bill acts on the bill on screen, in **Bill ⋯** and in
   Finish table's refusal (review I4): separate bills at one table are separate sales (answer 1.9),
   and a whole-table print would issue tickets for bills whose meal has not ended. Also putting it in
   the bill's foot beside **Pay** is a small addition if staff miss it in ⋯.
3. **Answered by the owner, 17:50 — dishes not yet served.** "Warn, let staff print": the till lists
   them, with **Mark served** and **Print anyway** (§2.1).
4. **Part payments on a bill left unpaid.** Allowed, the same rule as any issued bill (Task 1), and
   collected from **Find bill** (Task 9).
5. **Correcting a printed bill before payment** (a guest disputes a line). Not built: "Correct
   invoice" needs a settled sale. Default: not in this item; staff take the payment, then correct the
   invoice with a refund (A802), or cancel and credit the whole bill while it holds no payment. Decide
   after Thursday, beside the meeting's question on splitting a printed ticket between two guests;
   printing before payment makes this more common, so it may deserve its own item.
6. **A device whose receipts resolve to no printer.** Refuse before issuing, naming **Equipment** as
   the fix. A full invoice staged for email or A4 needs no printer.
7. **After the last payment of a printed bill.** Show the change; no document choice. The
   receipt-layout plan's Task 9 later prints a payment slip there.
8. **The "Bill requested" mark.** Unchanged (clears when paid).
9. **A bill paid in full before anyone prints** keeps today's behaviour: the paying payment issues the
   ticket (the meal ends at the last payment, owner, 16 November).
10. **Who lands PR B.** The owner, as PR A, because it is the first way staff issue a ticket before
    payment.
11. **Counter bills.** Not in this item; Print the bill is a table action.
12. **Answered by the owner, 17:52 — Thursday's question 3.** Replaced on the sheet (`4941038c49`).
13. **Answered by the owner, 17:59 — the invoice type after printing.** Locked in both directions
    (Task 3a).
