# A bill that has been paid more than it comes to

Status: design approved by the owner, 24 November 2026 at 23:2x in the watcher's window: "yes build it,
and make the cash back an assignable permission". The owner was shown the watcher's summaries of both drafts and five of the seven pictures, not this
text whole; what the summaries did not name is the writer's, for the owner to overrule.
Queued as OVERPAID-BILLS in lane L. The pictures (drawn) are
not committed: `~/waitron-campaign-shared/desk/overpaid-bill/`.

**The permission, the owner's change.** Giving cash back for a card payment has a permission of its own,
given to a role on the Roles page like the others. It decides who may do it: whoever asks for cash
instead, the PIN entered is that of a person whose role has it (it replaces "a supervisor's PIN" below).
A PIN is asked every time, even of a person signed in who has it. Supervisors and managers have it to
start with (the watcher's default). Name and wording at the plan: one permission, in the existing list.

**Words.** *The extra*: the money on a bill above what the bill comes to. *Plain money*: money paid
towards a bill by amount or equal share, with no receipt yet. *Advance*: an amount a guest paid and
got a receipt for; that receipt is already filed with the tax agency.

## 0. What you decided

- The rule (24 November, 22:30): "perhaps we should teach waitron to cope with overpaid but unclosed
  bills. if we end up with too much money on the bill then we could (a) refund it or (b) keep it as
  tip." And: "if somebody wants a receipt then that becomes an advance, which is separate from the
  still open bill".
- On my "no cash back when a card refund fails": "why?"
- On a tip kept the next morning: "i wonder if we shouldn't close the bill automatically anyway at
  the end of business day and keep the tip. what is going to happen? the customer is going to come
  back asking for the money, in which case we give them cash". Then: "the difference is that if you
  keep it it counts as income, tips go to the staff. perhaps we should just close it recording a
  cash refund, which can then be dropped into the tip drawer or wait for the customer. but then we
  probably need the manager to take the money out of the till, in which case we shouldn't close it
  automatically".
- "y" to the watcher's five points: (1) no PIN to give back up to the extra while the bill is open;
  (2) cash back for a card payment is built, with a supervisor's PIN, on open bills and in Give money
  back on closed ones, recorded and counted as cash and named in the day's report; (3) below an
  advance: refused, with Give money back on that receipt first; (4) at the day close the receipt is
  issued as for any open table bill, and the extra stays as money to give back until a manager does
  it; no Keep as tip then; (5) moving the last dish off a bill holding money stays refused.

**This replaces three answers of 26 September:** a change leaving too much money was refused,
"refund first", and giving it back needed the refund permission. Still true from then: nothing is
refunded by itself, and nothing becomes a tip unless staff choose it.

## 1. The rule

Any change to an open bill is accepted even if it leaves more plain money on the bill than it comes
to. The till shows the extra at once, and it can stay there while guests are still ordering. During
service staff settle it before the bill closes: **give it back**, or **keep it as a tip**. If nobody
does, the day close issues the receipt and the extra waits for a manager to give it back.

Example used throughout: table 7 owes €68.50. Three guests have paid €20.00 each, so €60.00 is in.
The paella (€18.50) is cancelled. The bill is now €50.00 and €10.00 is extra. Today the till refuses
that cancel and says to refund €10.00 first.

## 2. Should this exist?

**Yes, and much of it is built.** For Pay for items, `main` already lets a bill hold an extra, gives
it back and keeps it as a tip. Lane C's unlanded branch has the till's notice, both buttons, and the
refusals at closing. I switched today's refusal off in a throwaway copy: of 844 server tests around
it, 19 failed, all of them tests that say "this is refused".

**Against:** "refund first" means nobody leaves without their money, because staff cannot go on. The
new way relies on a notice, a bill that will not finish, and an alert the next morning.

**The day close turned out small.** I feared an issued bill could not hold more than its total. It
can. I ran it (section 7).

**Cash back for a card is the part I would think hardest about.** It is the one piece that is not
needed to stop refusing changes, it touches the cash figures, and it needs its own step in two
windows. It is also the only way out when a card refund will not go through.

**What I cut:** anything on the floor plan; moving the extra to another bill; vouchers; several
payments in one press; remembering which change caused the extra; falling below advances.

## 3. Where the till shows it (pictures 1, 5 and 7)

- **In the bill, above the total:** a box with one sentence and two buttons. **Pay** is not offered.
- **On the bill button at the top:** "Bill 1 · €10.00 over".
- **At the Counter:** the same box (lane C's branch).
- **After the day close:** the same box, with only **Give back**.
- **Not on the floor plan.**

| | English | Spanish |
| --- | --- | --- |
| Box (built) | Paid €10.00 more than this bill comes to | Se ha pagado 10,00 € más de lo que suma esta cuenta |
| Second line (new) | It counts towards anything they order next. | Cuenta para lo que pidan después. |
| Second line after the day close (new) | The day closed and its receipt A/1043 was issued. Give the money back to finish the table. | El día se cerró y se emitió su ticket A/1043. Devuelve el dinero para cerrar la mesa. |
| Button (built) | Give back €10.00 | Devolver 10,00 € |
| Button (built) | Keep €10.00 as tip | Dejar 10,00 € de propina |
| Bill button (built) | €10.00 over | 10,00 € de más |
| In the window (new) | Back to the card / In cash instead | A la tarjeta / En efectivo |
| Under it (new) | A supervisor or manager enters their PIN. | Un responsable o encargado introduce su PIN. |
| Finish table (new) | Bill 1 was paid €10.00 more than it comes to. Give it back or keep it as a tip, then finish the table. | En la Cuenta 1 se han pagado 10,00 € de más. Devuélvelos o déjalos de propina y después cierra la mesa. |
| Finish table, no tip possible (new) | Bill 1 was paid €10.00 more than it comes to. Give it back, then finish the table. | En la Cuenta 1 se han pagado 10,00 € de más. Devuélvelos y después cierra la mesa. |
| Below an advance (new) | €15.00 of this bill was paid with its own receipt, so the bill cannot come to less than that. First give back €4.00 on that receipt. | 15,00 € de esta cuenta se pagaron con su propio ticket, así que la cuenta no puede quedar por menos. Primero devuelve 4,00 € en ese ticket. |
| Its button (new) | Give money back | Devolver dinero |
| Moving the last dish off (new) | This bill has been paid €20.00. Leave at least one dish on it, or give the money back first. | Esta cuenta tiene 20,00 € pagados. Deja al menos un plato o devuelve antes el dinero. |
| Dashboard alert (new) | Table 7's bill was paid €10.00 more than it comes to. Its receipt was issued when the day closed. Give the money back on the till. | La cuenta de la Mesa 7 se pagó 10,00 € de más. Su ticket se emitió al cerrar el día. Devuelve el dinero en la caja. |
| Day's report (new) | Held to give back · Cash given back for card payments | Pendiente de devolver · Efectivo devuelto de pagos con tarjeta |

You did not comment on "€10.00 to give back" as the box's sentence; I kept the built one (my call),
because the money may go on more dishes or become a tip instead.

## 4. What each button does

### Give back, one payment (picture 2)

1. A window opens, **Give money back**, with €10.00 filled in and the one payment chosen.
2. Staff choose a reason and press **Give back €10.00**.
3. Cash: the drawer opens once. Card reader: back to the same card. Separate terminal: staff refund
   it there, then confirm.
4. The bill is now exactly paid, so it closes and its receipt is issued. If guests order again, that
   is a new bill. The window says so first.

Less than €10.00 can be given back; the rest stays showing.

### Give back, three payments by different guests (picture 3)

All three are listed, with **none chosen**: the extra does not belong to one payment, so staff ask
the guests. One payment at a time. If the extra is bigger than the chosen payment, the window fills
in all that payment holds, and the rest still shows on the bill.

### In cash instead, for a card payment (picture 6)

Choosing a card payment shows **Back to the card** and **In cash instead**. Cash instead asks for a
supervisor's or manager's PIN, opens the drawer once, and needs a device that may take cash. The card
company is not told, because nothing happened on the card. The same choice appears in lane L's
**Give money back** on a closed bill: for a dish, for goodwill and for the extra paid on top. What is
filed there does not change with the way the money goes.

### Keep as tip

While the bill is open only. One press, where the venue takes tips and the person may take payments.
It takes the amount from the newest payment back; if another till changed the bill meanwhile, the
till shows the new amount and asks again. The bill then closes and its receipt is issued. A bill that
comes to nothing has no sale to tip on, so it can only be given back.

### Who may do what

| | Bill open | After the day close | Cash for a card |
| --- | --- | --- | --- |
| Up to the extra | anyone who takes payments, no PIN | refund permission, or its holder's PIN | a supervisor's PIN |
| More than the extra | refund permission, or its holder's PIN | refused: it would make the bill owe again | as each column, plus the PIN |

Nothing new is stored about *why* there is an extra: it can never be more than the change took off,
and cancelling a dish the kitchen was asked to make, or a discount over the person's limit, already
needed approval. Moving dishes has no such check, but the moved dishes still owe the money, and the
refund carries the waiter's name.

### The same window as a past receipt?

To staff, yes: same title, same "How it goes back". Underneath, lane L's window works on a receipt,
and an open bill has none, so this is the open-bill refund window that exists, with lane L's words.
After the day close it is still that window, because the extra is on the bill, not on the receipt.

## 5. If they order more

Dishes count once sent. With €10.00 extra, a €6.00 dessert leaves €4.00. A €10.00 dessert makes the
bill exactly paid, so it closes when the dish is sent (that already happens). A €15.00 dessert leaves
€5.00 to pay, and **Pay** comes back.

## 6. Advances

The bill cannot come to less than its advances, so the extra is always plain money and settling it
never touches a filed receipt. Example: €21.00 bill, one guest paid €15.00 and has a receipt, and a
€10.00 dish is to be cancelled, leaving €11.00. The cancel is refused, with **Give money back** on
that receipt: €4.00 goes back and a corrective invoice is filed, as today. Then the cancel goes
through and the bill's receipt is issued at €0.00 with the advance taken off. I ran both orders: this
one works; cancelling first gets stuck, with nothing to pay and no receipt issued.

## 7. The day close

Table 7 is still open with €10.00 extra when the business day ends.

1. **The receipt is issued for €50.00**, as for any open table bill, and no paper is printed.
2. **The bill keeps the €60.00.** The €10.00 is not a sale, not VAT and not a tip. Expected cash
   still includes it. Ran: a €30.00 bill holding €35.00 gave one filed record, sales and VAT of
   €30.00, and cash of €35.00.
3. **The sale waits, unpaid on paper, until the extra goes back.** A receipt can only be marked paid
   by money that adds up to exactly its total; that check is in the database and stays.
4. **A dashboard alert** names the table and the amount, and goes by itself once settled. The day's
   report has a line, "Held to give back". The table stays on the floor, as any bill the close issues
   does today, and cannot be finished.
5. **A manager gives it back**, to the card or in cash from the drawer. The bill is then exactly
   paid: the sale is marked paid and the table can be finished. Ran: refunding the €5.00 closed the
   bill, left one filed record, and opened the drawer.
6. **What the manager does with the cash after that** (the tip drawer, an envelope for the guest) is
   outside Waitron, which records cash out.

**Can an issued bill hold more than its total? Yes.** Ran in a throwaway copy: the close issued it;
the balance, Find a bill and the day's figures read it; another payment was refused; a refund of the
extra settled it; 1,664 of 1,673 tests in the 50 server files around closing, refunds, corrections
and advances passed, and the 9 failures are the refusals being removed on purpose. What it needs:

- the close's "owes nothing" rule skips such a bill today, so it must issue it;
- a refund on an issued bill is refused today; it must be allowed, up to the extra and no more;
- Keep as tip must be refused there (it went through when I only relaxed that refusal);
- a bill that comes to €0.00 but holds money is not marked paid when the money goes back (ran); it
  must be;
- the day the bill counts as closed must be the day the extra went back. Today it would be the day
  of the last payment, which would change yesterday's report after it was sent;
- Find a bill shows it as part-paid with nothing owed; it should say "€10.00 over";
- the table's amount owed came out as −€10.00; lane C's branch already makes that €0.00 and "over".

Unchanged, because they already refuse such a bill: deferred close, cancelling the receipt, reopening
to split, merging it away. Left without paying and Print are refused on lane C's branch. Correct
invoice acts only on a paid receipt, so it waits until the extra is back.

**Not issued by the close:** a bill with a dish the kitchen was never asked for (as today), and a bill
with no dishes left, which has nothing to issue. Both stay open and raise the same alert. They are
the only bills where a tip can still be kept the next day; the takings do not change, only that
day's tips part.

## 8. Every other way a bill closes

| Closing | With an extra |
| --- | --- |
| Print the bill | Refused until settled (lane C's branch) |
| Last payment | Pay is not offered, and the server refuses one |
| Finish table (picture 4) | Refused. Today's message says the bill is *unpaid* and offers **Take payment**, which is wrong here; both change |
| Left without paying | Refused until settled (lane C's branch) |
| Deferred close (pay later) | Already refused for any bill that has taken plain money |
| A bill emptied by cancels | Accepted. Finish is refused until the money is given back; then the empty bill closes with nothing filed |

## 9. Cash back for a card: what must change

The database needs **no new column and no venue reset**: each refund already stores the way it went
back, separately from how the payment was taken, and the database accepted "cash" for a card payment
when I tried it on an open bill. That try also showed a wrong figure: the drawer's own record
said cash, but the day's takings took the €5.00 off card.

| Reader | Today | Change |
| --- | --- | --- |
| Day's takings by method | uses how the payment was taken, for a bill's refunds | use the way it went back |
| Day's report, Sales screen | no such line | add "Cash given back for card payments" |
| What is left to refund on a card, after closing | treats every refund as one the card company made | leave out cash ones, or a refund made in the card company's own website is missed |
| Give money back, cash list and corrective | "cash" means cash payments only | allow a chosen card payment in cash |
| Which device may do it | checks the payment's kind | check cash |
| PIN and resend checks | no way chosen | the way is part of the request |
| The till's payment list | does not show the way | "Given back in cash" |
| Drawer count, refund slip, Find a bill, accountant's refunds sheet, personal-data export, old-box list | already use the way it went back | none (read) |
| Card company comparison, separate-terminal list | read the card company's own refunds | none: the card was not refunded (read) |

## 10. When anything is filed

| Event | Filed |
| --- | --- |
| The change that makes an extra; the extra sitting there | nothing |
| Giving it back or keeping a tip on an open bill | nothing by itself. If the bill is then exactly paid, its receipt is filed then, dated as any bill paid then |
| The day close | the receipt, once, at what the bill comes to, dated the end of the business day the bill was opened in |
| Giving the extra back after the day close, card or cash | **nothing**. The receipt was already right (ran: one record before and after) |
| Marking that sale paid | nothing |
| Giving money back on an advance, or on a paid receipt | what today's route files, whichever way the money goes |

No new kind of document, and no fiscal rule changes. What does change: a bill with an extra, which
the close now leaves unfiled, is filed that night.

## 11. Still refused

- Any change while a card payment or a card refund is in progress.
- Anything taking the bill below its advances.
- Moving or splitting off the last dish of a bill that holds money. Move the whole bill, or merge the
  other bill into this one.
- Merging away a bill that has taken money; changing eat-in or takeaway on one.
- Giving back more than the extra once the receipt is issued; keeping it as a tip then.
- Taking a dish off that was paid by item, until lane C removes that old kind of payment.

## 12. Size

**No new column, no migration, no venue reset.** Four pull requests, after lane C's unlanded one:

1. **Server, open bills:** accept the changes, the advance rule, the last-dish rule. About 120 lines
   added, 80 removed; the 19 tests rewritten, about 12 new.
2. **Server, day close:** issue it, refund up to the extra, mark it paid, the alert, "Held to give
   back". About 250 lines; about 25 new tests.
3. **Server, cash for a card:** open bills and Give money back, the takings, the report line. About
   300 lines; about 30 new tests. After lane L's till work.
4. **Till, dashboard, guides:** the window, Finish message, after-close box, "In cash instead" in both
   windows, the report lines, English and Spanish. About 450 lines added, 250 removed.

Roughly 1,100 lines added and 330 removed, before tests. All four take the full review and you land
them. The sizes are estimates. If it is too much, 1 and 2 with their till parts are the rule you asked
for, and 3 can follow. Set menus' refused cancel (D25) goes with 1.

## 13. Questions

Settled with the owner's "yes build it": each as recommended, with the permission above.

1. **Is "In cash instead" offered on every card payment, or only once a card refund has failed?**
   Recommended: **always.** The PIN guards it, and the guest who comes back may not have the card.
   Only-after-failing needs us to tell a failed refund from a slow one.
2. **Does a manager who is already signed in still enter a PIN for cash instead?** Recommended:
   **yes**, as for a refund on a separate terminal today: money leaves the drawer for a payment that
   was never cash.
3. **After the day close, does the table stay occupied until the extra goes back?** Recommended:
   **yes**, as for any bill the close issues unpaid. It keeps it in front of staff.

## For the builder

Read at `f9d6664efd` unless marked **C** (branch `feat/a1515-1-pay-items-till`, `f066f59d1f`, no pull
request yet and still being edited) or **L** (`feat/give-money-back-till`).

- **The refusal:** `assertBillInvariant` `apps/server/src/bill-payments.ts:568`, `refuseExcess` `:577`,
  `assertLinesKeptExcess` `:636`. Callers: `adjustments-apply.ts:1420`, `bill-actions.ts:369`,
  `table-actions.ts:431`, `set-menu-count.ts:158`, `working-order-removal.ts:190,210,276`,
  `working-order-line-edits.ts:1150`. All go; `readBillExcess` (`:621`) stays.
  _2026-11-25: A1515-3 PR 2b (#4313) deletes `set-menu-count.ts` and adds calls of this refusal in
  `working-order-open.ts`, `working-order-removal.ts` and `working-order-transfer.ts`, where working
  out a bill's set menus again can leave it below what it received._
- **Pending money:** each caller also refuses card money in flight (`refusePaymentInFlight` by
  `bumpRevision`, `working-order-edit-state.ts:230,266`; `set-menu-count.ts:123`;
  `adjustments-apply.ts:815`). Read, not run for each.
- **Advances:** `refuseBelowAdvances` `pay-for-items.ts:207` moves to the callers above. "Filing
  needs no such step" `invoice-corrections.ts:591-598` is why the other order sticks;
  `advance.exceeds_bill` refuses printing. Refund of an advance: `bill.refund_of_advance`
  (`bill-refunds.ts:225`); lane L D18 opens its window on the ticket. Leave advances out of the
  list of payments offered for the extra (`refundOffered`, `apps/till/src/state/bill-payment.ts:386`,
  includes them).
- **Give back:** `refundBillPayment` `bill-refunds.ts:163`, `refundPermission` `bill-overpaid.ts:40`
  (already `payment.take` for any extra; nothing records the cause), device check
  `bill-payments-api.ts:595`, drawer `enqueueRefundDrawer` `receipt-print.ts:827`.
- **Keep as tip:** `bill-overpaid.ts:66`; trigger `packages/db/triggers/core.sql:60-68`; **C** adds
  `bill.overpaid_changed` and `bill.tip_needs_a_sale`. Must refuse a placed bill with an invoice.
- **Closing:** Print `meal-end.ts:125`, left without paying `unpaid-departure.ts:134`, day close
  `close-of-day.ts:115` (**C** adds `bill.overpaid` to the first two and counts a 0.00 bill in the
  third); dating `closeOfDayEnd` `close-of-day.ts:192`; deferred `deferred-close.ts:124`; Finish
  `finish-party-service.ts` `readFinishState`, `parties.ts:897`. The till's Finish notice is
  `data-finish-refusal` in `till-table-order-screen.ts` (always offers Take payment). The alert needs
  a code, an area claim and EN/ES words (`scripts/alert-codes.test.ts`); an ongoing alert
  (`AlertSource`, `alert-sources.ts:33`) goes away by itself.
- **Day close:** the test at `close-of-day.ts:115` skips `owed < 0` (comes back as `owes_nothing`);
  zero-total branch `close-of-day.ts:128` must not settle while money is held. Refund of an issued
  bill: `requireRefundableBill` and `hasInvoice`, `bill-payments.ts:1588,1608`; cap it at the extra and
  make `refundPermission` answer `sale.refund` there. Settling is the existing issued branch of
  `issueOrSettleWhenFullyPaid` (`bill-payments.ts:1260`), whose `settledAt` is the last payment's
  (`:1261`) and which `packages/reporting/src/closed-bills.ts` dates by; its zero case (`:1230`) needs
  `closeZero`. A pending card refund ends in `issueAfterBillRefund` (`tender-refund-sends.ts`).
  Coverage trigger `sale_settlements_check_coverage` `core.sql:101` and `packages/core/src/settle-sale.ts`
  stay. Find a bill: `find-bill-bills.ts` clamps `owing_cents` at 0 and says `part-paid`. Receipt:
  `receipt-payments.ts:165-181` leaves `owed` out at or below zero. Still negative for an over bill:
  `orders-list.ts:506`, `working-order-held-read.ts:225`, `parties.ts:776` (**C** fixes the last).
  Whether a paper receipt prints when the extra is given back later (`enqueueSaleReceipt`,
  `bill-payments.ts:1271`) was not looked at on a printer.
- **Cash for a card:** `refunds.method` is the refund's own (`packages/db/src/schema/refunds.ts`; check
  `refunds_provider_ck` `:141` accepts cash with no provider). Writers: `bill-refunds.ts:270,282,299`,
  `tender-refund-reservation.ts:397,401,519`, `invoice-correction-cash.ts:52`, `give-back-read.ts:362`
  (`waysOf`), `give-back-plan.ts:194-253`. Readers to change: `packages/reporting/src/cash-up.ts:105`
  (`bp.method` to `r.method`; `:113` is right), `tender-refund-balance.ts:151,168` (`preInvoice` and
  `accounted` must count card refunds only), device checks `bill-refunds.ts:131` and
  `tender-refund-authorization.ts:49`, `refundFingerprint` `bill-refunds.ts:105`, `BillRefundView`.
  Right as they are: `drawer_entries` (`tender-refund-completion.ts:87`), `receipt-print.ts:845`,
  `find-bill-transactions.ts:102`, `tender-refund-receipt.ts`, `accountant-export.ts:605`,
  `personal-data-actions.ts:126`, `old-box-data-since.ts:326`, `payment_refunds` readers.
- **Till today:** `billWriteError` and the "Refund {amount}" offer (`till-app.ts:983,2075-2105`),
  `#onRefundExcess`/`#openRefund` (`:22754`; opens the refund only when one payment is offered).
  **C**: `screens/bill-money-notice.ts`, `state/pay-for-items.ts:37-57`, `widgets/bill-refund-dialog.ts`
  (`pinFreeUpTo`). **L** words: `give_back.title`, `.how`, `.way_cash`, `.submit`.
- **Guide:** `apps/server/src/guide/{en,es}/table-service.md`, "If a change to a bill would leave it
  owing less" (en `:273`), and **C**'s "A bill paid more than it comes to".
- **Earlier decisions:** `docs/superpowers/specs/2026-09-26-bill-payments-design.md` §4.3, §4.4, §6a,
  §11 answers 2, 4 and 6: add dated pointers. Pay for items plan D3 and D4.
- **Run:** throwaway worktree at `f9d6664efd`, `refuseExcess` switched off. The 13 server files:
  844 passed before; 19 failed, 825 passed after, every failure a refusal expected and not given. Five
  probes through the till's routes, from a 21.00 bill: cancel leaving 5.00 over, then refund of 5.00
  with no PIN: settled, one sale of 10.00; every dish cancelled with 15.00 in: Finish
  `bill.payments_received`, refund, Finish closes, bill abandoned, no sale; advance corrected first,
  then cancel: settled, own sale 0.00; cancel first, then correct: open at 0.00 with no sale, Print
  before it `advance.exceeds_bill`; over bill: Finish `party.bill_outstanding`. The session is `bill-venue`'s
  operator, which `bill-overpaid.test.ts` describes as a waiter who may not give refunds. Second worktree, same commit,
  with the close's test, `requireRefundableBill` and a cash way for a card hacked in: five probes
  (section 7 and 9's "ran" lines; the 0.00 bill given back stayed `placed` with no settlement; a
  refund above the extra by that waiter was 403), then 50 files: 9 failed, 1,664 passed. No test in
  those files pins the two refusals the day close needs lifted. Both worktrees removed.
- **Server tests pinning the refusal (the 19):** `adjustments-bill-payments` 1, `advance-money` 1,
  `bill-overpaid` 1, `bill-payments-api` 4, `bill-payments` 2, `draft-split` 1, `move-dishes` 2,
  `party-bill-actions` 1, `party-table-actions` 3, `pay-for-items.move` 1, `set-menu-adjustments` 1,
  `till-api.table-actions` 1. `bill-payments` "counts a pending card's reservation" needs a new home;
  `party-table-actions` "every sent dish" keeps refusing, with a new code.
- **Till tests (found by search, not run):** `till-app-bill-payments` `:4385-4549`,
  `till-app-move-dishes:590`, `till-app-split-table:2997,3129`, `codes.test:249,275`,
  `refund-wording.test:20,24`, `adjustment-dialog.test:774`.
- **Not run:** anything on lane C's or L's branches, any till code, card reader refunds, the day close
  through its job (its function was run), cash for a card on a closed bill, the card-reader and
  advance cases of the day close, set-menu regrouping.
