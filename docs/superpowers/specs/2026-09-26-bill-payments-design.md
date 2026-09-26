# Several payments against one bill — the payment and billing design

**Status:** written 2026-09-26 by the lane B runner as plan Task 0. **Awaiting the owner's approval**;
plan Task 14 (`bill-payments`) does not start until the owner approves it. The open points are
listed in §11 with a recommended default for each, and copied to the lane's questions file.

**What this is.** The owner decided on 2026-09-26 that a table's bill is invoiced when it is fully
paid, and that several payments can be taken against it first
([service spec §6](2026-09-20-service-ordering-and-billing-design.md#6-take-contributions-without-consuming-somebody-elses-tip)).
Today the software cannot do that: every bill is paid in one go at the moment its
invoice is issued. This document decides how money taken before the invoice is recorded, how each
payment is split between the bill, change and tip, what several devices may do at once, how a card
payment interrupted by a crash is recovered, and which transaction issues the invoice. The
[implementation plan](../plans/2026-09-26-service-ordering-and-billing.md) Task 14 builds the server
side and Task 15 the till.

**Words used here.** A **bill** is one working order that is paid and invoiced on its own: a table's
tab, or a bill split off it. A **visit** (plan Task 2) groups the bills of one seated party. A **bill
payment** is one payment taken against a bill before its invoice exists. **Applied** is the part of
a payment that pays the bill; **tip** is the part the payer gives on top; **change** is cash handed
back. **Outstanding** is what the bill still owes.

**How the facts below were established.** By reading `main` at `906ab157b` and lane C's unlanded
order-edits branch (`feat/menus-order-edits`, read at `e60829ff4`; it has moved on since). Nothing
was run except the equal-shares check in §3.4 and the tender probe a reviewer of this design ran
(§2.5). Lane C's M7b (the order-edit rules and the
card-payment lock) and M7b2 (a manager clearing a stuck card payment) have **not landed**; M7b2 is
not built yet. Task 14's Step 0 re-maps every function named here against the `main` it starts from.

---

## 1. Today's payment path

### 1.1 How a table's bill is paid today

- **Cash or a manual card** (`POST /api/sales` → `recordTillSale` → `payWorkingOrder`,
  `apps/server/src/till-sale.ts:315-402`) runs in ONE transaction. It prices the order from its
  stored lines, issues the invoice (`recordSale`, `packages/core/src/record-sale.ts:112`) with
  exactly one tender, marks the order settled and queues the receipt and, for cash, a separate
  audited drawer job (`enqueueCashSaleDrawer`, `apps/server/src/receipt-print.ts:168-185`).
- **An integrated card** (`POST /api/pay` → `payWorkingOrderIntegrated`, `till-sale.ts:647-755`) runs
  in three phases so the card network is never called inside a transaction: P1 prices the order in
  a transaction, P2 calls `provider.collect` for `total + tip` with no transaction open, and P3
  (`finalizeCapture`, `:768-861`) issues the invoice with one card tender of `total + tip`, links the
  provider's payment row to the sale and settles the order.
- **Retries.** The only retry key is the working order's id: at most one sale per working order
  (`sales_working_order_id_key`, `packages/db/src/schema/sales.ts:136`), and a repeat of a settled
  order replays its stored ticket (`till-sale.ts:329-331`, `:660-665`).
- **Tips.** Cash and manual-card tips are always `0.00` (`till-sale.ts:539`). An integrated card
  carries the tip typed on the till, and only when `WAITRON_TILL_TIPS` is on
  (`apps/server/src/till-config.ts:68-69`). No reader is asked to prompt for a tip.

Counter orders (pay first, `ticket_then_pay`, `invoice_first`) use the same functions and are out
of scope here: this design changes the payment of a table's bill only (§9).

### 1.2 The one-payment assumptions this design has to remove

1. **A tender cannot exist before its invoice.** `tenders.sale_id` is NOT NULL
   (`packages/db/src/schema/sales.ts:239`) and `tenders` is append-only. So money taken before the
   invoice has nowhere to live today except a provider's `payments` row with no sale.
2. **One tender per sale on the till path.** `TillTender` is a single tender (`till-sale.ts:65-69`),
   every path builds a one-element tender list, and the ticket reads only the first tender row
   (`readTenderBlock`, `:167-177`). The database itself already allows several: the schema comment
   says "Split tender is several rows" (`sales.ts:224-228`), and settlement is checked once, when
   declared (`sale_settlements_check_coverage`, `packages/db/drizzle/0001_behavioural_triggers.sql:62-72`:
   the tenders must sum to the total plus corrections plus tips).
3. **One captured card payment per working order.** "At most one captured payment per working order
   holds by construction, not by a constraint" (`findCapturedPaymentForWorkingOrder`,
   `packages/payments/src/store.ts:300-304`), and the crash-recovery branch of P1 relies on it.
4. **One Stripe PaymentIntent per working order.** Stripe's idempotency key is
   `workingOrderIdempotencyKey(workingOrderId)` (`packages/payments-stripe/src/provider.ts:60`).
   Inferred from Stripe's documented idempotency behaviour, not tested: a second payment against the
   same order would reuse the key, and Stripe would refuse a different amount or return the first
   PaymentIntent for the same one.
5. **One in-flight mark per order.** Lane C's lock (menus plan D22) is one timestamp,
   `working_orders.payment_attempt_at`, set in P1 and cleared in P3, on a failed attempt, or by the
   loop's `releaseStalePaymentAttempts` when nothing can still capture or file the payment. Every
   line write refuses `order.payment_in_flight` while it is set (through `bumpRevision` and
   `refusePaymentInFlight` in `apps/server/src/working-order.ts`), and so do a cash or manual-card
   payment of the order. Over a set mark, a second card payment is refused while the first attempt
   still runs in this process, or a payment of the order is `attempting`, or is `captured` or
   `accepted_offline` with no sale under another provider; the same provider's unfiled capture is
   filed instead (the recovery branch); otherwise the second payment overwrites the mark (read on
   lane C's branch at `e60829ff4`). It is application code only; no trigger enforces it. The line
   writes' refusal reads only the mark, not the `payments` table, because the simulator writes no
   `attempting` row and the real providers write theirs after P1 has committed; the release of the
   mark and the second-card check do read `payments` (`ordersWithUnfiledPayment` in
   `apps/server/src/till-sale.ts`, on lane C's branch).
6. **Stripe's crash recovery does nothing.** `resolvePending` is a no-op
   (`packages/payments-stripe/src/provider.ts:97-102`). SumUp's is real: it resolves an `attempting`
   row against SumUp's own record, and marks one SumUp has never heard of `failed` after 15 minutes
   (`packages/payments-sumup/src/provider.ts:271-361`). M7b2 exists because a crash during a Stripe
   payment leaves the order locked with no way out.
7. **No refund path.** No route or screen refunds a payment. The provider interface has `void`,
   `refund` and `partialRefund` (`packages/payments/src/provider.ts:120-129`), and the only product
   caller is the automatic reversal of a card payment taken for an abandoned order
   (`packages/payments/src/reconcile.ts`, `packages/payments-stripe/src/reconciler.ts:59-73`).

---

## 2. Where a payment before the invoice lives

**Decision: three new core tables, one new column on `payments`, one on `tenders`.** Core, because
they key into `working_orders` (the commit states this, CLAUDE.md §3).

### 2.1 `bill_payments` — one row per payment taken against a bill

| Column | Meaning |
| --- | --- |
| `id` | |
| `working_order_id` | the bill; key to `working_orders`, `restrict` |
| `submission_id` | client-made; unique together with `working_order_id` (§5.1) |
| `fingerprint` | SHA-256 of the canonical request body (§5.1) |
| `kind` | `items` (pays named lines), `contribution` (an amount towards the bill), `share` (an equal share, §3.4) |
| `share_of` | for `share`: how many people the outstanding was divided among; null otherwise |
| `method` | `cash` or `card` (a subset of the tender methods, `sales.ts:41`) |
| `applied` | money: what pays the bill |
| `tip` | money: the payer's tip, never part of the bill |
| `tendered` | money: cash handed over; null for a card |
| `state` | `pending` (a card at the reader), `received`, `failed`, `declined` (§5.4) |
| `requested_by`, `till_id` | who took it, on which device |
| `created_at`, `received_at`, `failed_at` | |

Change is not stored: it is `tendered − applied − tip` (§2.5 says how the ticket shows it). A card
is charged `applied + tip`.

**Classified `ledger`, not append-only**, because its `state` moves. A behavioural trigger (a custom
migration) allows only `pending → received`, `pending → failed`, and `received → declined` while no
tender names the payment (§5.4), and refuses any change to the amounts, the kind, the method or the
bill. **Why not append-only with a separate "attempt" table:** the payment's amounts are decided
once, in P1, and never change; only its outcome arrives later. One row with a guarded state says
that. (`payments` also keeps a moving state on one row, but guards only the set of values,
`payments_state_ck`, not the transitions.)

**Cash and a hand-keyed card are `received` at once**, in the request's own transaction. A
hand-keyed card also gets its manual `payments` row there (`recordManualCardPayment`, as
`till-sale.ts:547-555` does today), linked to the bill payment. Only a card on a connected reader is
ever `pending`.

**Why our own table and not the provider's `payments` row:** a cash payment has no provider row;
several payments must be read together as one bill's balance whatever their method; and D22's
reason for not reading `payments` (the simulator writes no `attempting` row, the providers write
theirs late)
does not apply to a row we write ourselves in P1.

### 2.2 `bill_payment_lines` — which lines an item payment covers

`bill_payment_id` (key, the parent is never deleted), `line_id`, `quantity` (thousandths), `amount`
(money: what those units cost when paid). **Append-only.** `line_id` is a plain id with no key:
a void deletes a line, and an append-only row holding a key to a row product code deletes turns the
delete into a refusal (plan, Global Constraints). The application refuses to void, reduce or move a
paid quantity (§4), and the column says so.

A line's **paid quantity** is the sum of its `bill_payment_lines.quantity` over payments that are
`pending` or `received` and not refunded (§6). It never exceeds the line's quantity.

### 2.3 `bill_payment_refunds` — money given back before the invoice

`bill_payment_id`, `submission_id` (unique together with `bill_payment_id`, so a retried refund
gives money back once, §5.1), `fingerprint` (§5.1), `applied_amount`, `tip_amount`, `reason`, `authorized_by`,
`created_at`. **Append-only.** For a card, the provider refund it made is recorded where refunds
already are (`payment_refunds`, `packages/payments/src/schema/payment-refunds.ts`), through the
`payments` row. A payment's **net applied** is `applied − sum(applied_amount)` and its **net tip** is
`tip − sum(tip_amount)`. A refund gives back applied money first; it returns a tip only when the
whole payment is refunded at the payer's request (§6).

### 2.4 New columns on existing tables

- **`payments.bill_payment_id`** (payments module migration; the module already keys into core, so
  this is the allowed direction). Nullable, unique where not null: one provider payment per bill
  payment. Every provider sets it on the first row it writes for the attempt: the server reader
  providers commit an `attempting` row before any network call (Stripe
  `packages/payments-stripe/src/provider.ts:63-71`, SumUp
  `packages/payments-sumup/src/provider.ts:139-147`), and the simulator writes one `captured` or
  `failed` row when `collect` ends (`packages/payments/src/simulator.ts:37-40`). So crash recovery
  can find the bill payment from the provider row (§5.4).
- **`tenders.bill_payment_id`**. Nullable, unique where not null: a bill payment becomes at most one
  tender, which is what makes issuing the invoice safe to repeat. Both are plain `ALTER TABLE … ADD`
  (a nullable column with a key; the plan review measured that shape on 2026-09-26).
- **`drawer_opens`** gains the reasons `bill_payment` and `bill_refund` and a nullable
  `bill_payment_id`, because a cash payment or cash refund before the invoice opens the drawer with
  no sale to name (`drawer_opens.sale_id`
  exists; the reason check allows only `cash_sale`, `manual` and `calibration`,
  `packages/db/drizzle/0012_printer_calibration.sql`). Changing the reason CHECK rebuilds the table.
  Nothing points a key at `drawer_opens` (`grep -rln 'REFERENCES \`drawer_opens\`' packages/*/drizzle/`
  found nothing on `906ab157b`), so the rebuild deletes no child rows; Task 14 repeats that grep and
  reads the generated SQL.

### 2.5 How the rows become tenders

When the bill is fully paid (§7), the invoice is issued with one tender per `received` bill payment
whose net applied plus net tip is above zero (`tenders_amount_ck` refuses a zero amount):

| Tender column | From the bill payment |
| --- | --- |
| `method` | `method` |
| `amount` | net applied + net tip |
| `tip_amount` | net tip |
| `cash_tendered` | `tendered` (cash only) |
| `settled_at` | `received_at`: when the money moved, not when the invoice was issued |
| `bill_payment_id` | `id` |

The coverage trigger then holds by construction: the tenders sum to the sum of net applied plus the
net tips, and the sum of net applied equals the bill's total (§7). The reviewer of this design
checked the tender shapes with a `node:sqlite` probe that copied the three tender checks and the
coverage trigger (not the migration itself): cash with a tip, cash with a tip whose applied part
was refunded, and a partial cash refund were accepted, and its two controls (a total short by one
cent, cash handed over below the tender amount) were refused. Every card bill payment's `payments`
row is linked to the sale (`associatePaymentWithSale`), including a fully refunded one, so every
provider payment of the bill points at the invoice it paid.

**The ticket derives change from the bill payment**, `tendered − applied − tip` as recorded when the
money was taken, and lists refunds as their own lines. Today's ticket derives change as
`cash_tendered − amount` (`till-sale.ts:184-188`), which after a refund would print the refund as
change.

---

## 3. How a payment is split between the bill, change and tip

### 3.1 The rule

For a payment request, the server computes, in the request's own transaction:

- **available** = the bill's total − the net applied of its `received` payments − the applied of its
  `pending` payments. A pending card payment reserves its amount, so two devices cannot both pay the
  same euro (§5.2).
- **due** = what the request asks to pay: the listed lines' amount for `items`, the typed amount for
  `contribution`, the share for `share` (§3.4).
- **applied** = the smaller of `due` and `available`.
- The rest of the money offered follows the change-or-tip rule:
  - **cash:** `tendered − applied` is change, unless the operator marks some or all of it as a tip
    (`tip` in the request, at most `tendered − applied`). With tips off, a `tip` above zero is
    refused `bill.tip_not_allowed`. (Today's card path silently clamps a tip to zero when tips are
    off, `till-sale.ts:722`, and cash takes no tip at all, `:539`. A bill payment refuses instead,
    so the operator sees the amount the guest agreed to is not what will be recorded.)
  - **card:** anything charged above `applied` is a tip. The preview (§3.6) shows it before the
    reader is asked, "even if other guests still owe money" (spec §6). When the venue has tips off
    (`WAITRON_TILL_TIPS`), a card charge above `applied` is refused with `bill.tip_not_allowed`
    and the operator charges the applied amount.

**A request against a bill with nothing available is refused**, `bill.nothing_outstanding`, unless a
pending card payment is what takes it to zero, in which case it is `order.payment_in_flight`
(the reason is the card at the reader, and that code already says so).

### 3.2 Examples (spec §6 and §12 item 7)

| Case | Applied | Change | Tip | Charged |
| --- | --- | --- | --- | --- |
| Items €40.00, cash €50.00 | €40.00 | €10.00 | €0.00 | — |
| Same, operator marks it a tip | €40.00 | €0.00 | €10.00 | — |
| Items €40.00, card €50.00 | €40.00 | — | €10.00 | €50.00 |
| Contribution €50.00, €30.00 available, cash €50.00 | €30.00 | €20.00 | €0.00 | — |
| Contribution €50.00, €30.00 available, card €50.00 | €30.00 | — | €20.00 | €50.00 |

### 3.3 A contribution is a pool, and the €25 steak

A general contribution pays down the bill; it changes no line's price and is not a discount spread
over the lines. An item payment names lines and quantities. When the listed lines cost more than is
available, the preview offers up to two choices, and the payment request must name one (`choice`);
a request that needs a choice and names none is refused `bill.allocation_changed` with the preview
in its params:

- **Pay the full price with a tip.** After €105.00 of contributions on a €120.00 bill, the €25.00
  steak: pay €25.00, applied €15.00, tip €10.00.
- **Pay what is left, using the earlier contribution.** Pay €15.00, applied €15.00, tip €0.00; the
  steak's other €10.00 counts as paid from the pool. **Offered only while no payment on the bill is
  pending**, so the pool it draws on is money already received, never a card still at the reader
  that may yet fail.

With tips on and nothing pending, both are offered (spec §12 item 8). With tips off only the second
is offered; with a card pending only the first; with tips off and a card pending, neither, and the
item payment is refused `order.payment_in_flight` until the card ends. The first choice records the
€10.00 as a tip for cash as well as card: that is what the choice says, so it is not change.

Either way the steak's quantity is recorded as paid (`bill_payment_lines.amount` is €25.00, its
price), so it cannot be charged again (§4.1). **Earlier tips are never consumed:** a tip is stored
apart from applied money and never enters "available", so no later payment can use one.

### 3.4 Equal shares

A `share` request names how many people are still to pay, `share_of = n`. The server charges
**the available amount divided by n, rounded up to the cent**. That gives exactly the plan's D16
allocation without storing any split state: €100.01 across 3 is €33.34, then €33.34 of the €66.67
left across 2, then €33.33, and the shares sum to the bill. Checked 2026-09-26 with a Node script
over every amount from 0 to 3,000 cents and every n from 1 to 12: the "divide the remainder by the
people left, round up" sequence matched D16's "floor, then one extra cent to the first `C mod n`"
in every case, and a control using "round down" instead mismatched in 26,692 cases. Because each
share is computed from what is left, a contribution or item payment taken between two shares simply
leaves less to divide; the till decides `n`.

### 3.5 What cannot be split

- **Whole units only**, for a discrete line: Beer ×3 can be paid one or two at a time; a bottle is
  paid whole (spec §6). A weighed line is paid as a whole line.
- A dish with options or extras is paid as a whole line, the rule the split already uses
  (`tab.transfer_modifier_line`, re-mapped after M7b). Its extras lines are paid with it.
- **A tip is never moved to the bill or used by another payment.** It is returned only when its
  own payment is refunded in full at the payer's request (§6).

### 3.6 Preview, then confirm

`POST …/payments/preview` computes §3.1 and writes nothing. The payment request carries the applied
amount and tip the operator saw. If the server's own computation differs (another device paid in
between, a line was added), it is refused `bill.allocation_changed` with the new preview in its
params, and the till shows it for confirmation again. **Why:** "show that allocation before payment
confirmation" (spec §6) has to hold when the balance moved under the operator, and the same
refuse-and-reconfirm shape is what menus D9 does for a changed price.

---

## 4. Lines that are already paid, and moving lines after a contribution

### 4.1 One code for "this quantity is paid for"

`bill.line_paid` refuses any of these on a paid quantity (§2.2):

- another item payment naming it (spec §6: "an item already paid for cannot be charged again");
- moving it to another bill, splitting it off, or transferring it to another table's tab;
- voiding it, reducing its quantity, or an adjustment that lowers its price (plan Task 11).

The unpaid quantity of the same line stays free: with Beer ×3 and one beer paid for, two can move.
A partial move takes the unpaid units into the new row and leaves the paid ones on the row the
`bill_payment_lines` name. To change a paid line, refund that item payment first (§6); that releases
it.

### 4.2 The owner's example: a split after a contribution

A €120.00 bill; one guest contributes €50.00. A second guest wants their own invoice for two items
(€30.00). Staff move the two lines to a new bill (it belongs to the same visit, plan Task 2), take
€30.00, and the new bill's invoice is issued at once, for €30.00. The original bill is now €90.00
with €50.00 applied and €40.00 outstanding. Paying €40.00 issues its invoice for €90.00, with two
tenders summing to €90.00. **The contribution stays on the bill it was given to**; nothing moves it.

### 4.3 A move that would leave the bill owing less than it has received

**Refused**, `bill.received_exceeds_total`, with the amount by which it would exceed. A €60.00 bill
with €50.00 contributed cannot move €30.00 of lines out (it would be €30.00 with €50.00 received).
The till offers two ways on: move fewer lines, or refund the excess first (here €20.00, §6) and then
move. **Why refuse rather than carry the excess across to the new bill:** the payer gave that money
for this bill, the owner's example keeps it there, and a payment that silently changes bills would
put one person's money on another person's invoice. Carrying the excess across is open point §11.2.

### 4.4 The invariant every write keeps

**For every bill, at every commit: the net applied of its received payments plus the applied of its
pending payments is at most the bill's total, and each line's paid quantity is at most its
quantity.** It is checked by one application helper that every writer calls before it commits: each
payment, refund, void, quantity change, adjustment, split, transfer, join and unjoin. There is no
trigger: the bill's total is computed by the pricing code, not stored. So the guard is weaker than
the invariant: a new writer that forgets the helper is seen by nothing except its own tests, and
the Task 14 PR says so.

### 4.5 A bill with money on it cannot be abandoned

Abandoning a bill with any pending payment, or any received payment whose net applied or net tip
is above zero, is refused, `bill.payments_received`. **Why:** the nightly reconcile automatically
refunds a captured card payment on an abandoned order (`reconcile.ts:277-317`) and would do so here
without anyone deciding it, while a cash contribution would simply vanish from the records. Refund
in full first (§6), then abandon.

**When the rest of the table walks out** after someone contributed, there is nobody to refund. That
is an unpaid departure, plan Task 17, which waits on asesor Q28; until it lands such a bill stays
open and visible on the table. Open point §11.8.

---

## 5. Several devices, retries, and a card at the reader

### 5.1 Retries

Every payment and refund request carries a client-made `submission_id` (plan D8). The row it
creates also records the request's `fingerprint`: SHA-256 of the canonical JSON of the request
body, keys sorted, with the `submission_id` left out (amended 2026-09-26 after the plan's second
review). A repeat with the same id on the same bill:

- with a different fingerprint, or naming a refund where the first was a payment (or the reverse),
  is refused with `submission.id_reused`, writing nothing — returning the first result would tell
  the device an action happened that it never asked for;
- with the same fingerprint, finds the first row and returns its result, writing nothing.

Payments and refunds live in two tables, and refund ids are unique only per payment, so the id space
is made the BILL by a lookup: in the same transaction, a new request's id is looked up among ALL of
that bill's payments and ALL of its refunds (across every payment). A hit on a different kind, or on
a refund of a different payment, is `submission.id_reused`. A repeated payment returns:

- `received`: the first allocation and the bill's current balance;
- `pending`: "in progress", and no second `collect` is started;
- `failed`: the failure. A new attempt is a new request with a new `submission_id`.

A repeated refund request finds its `bill_payment_refunds` row the same way, so a retried cash
refund opens the drawer once.

**Why not the working order id, as today:** a bill now takes several payments, so the order's id no
longer names one of them.

### 5.2 What one card at the reader locks

The in-flight fact becomes **"the bill has a `pending` card bill payment"**, written in P1's own
transaction before the provider is called. **A bill payment never sets D22's
`payment_attempt_at`**: if it did, lane C's cash path would refuse cash while a card is at the
reader (`till-sale.ts:344` on lane C's branch), which is what this section allows. Task 14 makes
`refusePaymentInFlight` read both facts, so line writes refuse on either; a bill payment's own
checks are the ones below.

- **Still refused while a card payment on the bill is pending** (`order.payment_in_flight`): every
  line write, as D22 refuses it today, including a new round; abandoning the bill; and an item
  payment naming lines the pending payment covers (`bill.line_paid`). **Why keep D22's rule whole:**
  the bill's total must not move under a capture, because the final capture issues the invoice from
  it (§7), and M7b's single helper is where every line write already stops. Letting new rounds
  through while a card is at the reader is open point §11.3.
- **Allowed while a card payment on the bill is pending:** a cash payment, and a second card payment
  on another reader, each against what is still available after the pending one's reservation
  (§3.1). So a second device may take cash while a card is at the terminal. **Why:** at a large
  table two guests paying at once is ordinary, and the reservation is what keeps it safe.
- **A different bill of the same visit** is never locked by this bill's card payment.

**Both orders of every race are tested as sequential calls** (the engine takes one write
transaction at a time, plan Global Constraints): cash then a card's P1 on the same last €40.00 (the
card is refused `bill.nothing_outstanding`); a card's P1 then cash (cash is refused
`order.payment_in_flight`); two cards of €30.00 and €40.00 on €70.00, captured in either order (the
invoice is issued by the second capture's P3, never by the first).

### 5.3 The three phases for one card bill payment

- **P1 (transaction):** refuse on D22's mark or the invariant; compute and check the allocation
  (§3.6); insert the `pending` bill payment and its lines; commit.
- **P2 (no transaction):** `provider.collect` for `applied + tip`, passing the bill payment's id.
  `CollectParams` gains `billPaymentId` (a change to the payments package's contract). Stripe's
  idempotency key becomes one per bill payment instead of one per working order (the server reader,
  `provider.ts:60`; the on-device provider keys on the working order too, `device-provider.ts:68`). SumUp's
  `createCheckout` sends no idempotency key, and sends the payment's own reference only when an
  affiliate key is configured (`packages/payments-sumup/src/sumup-client.ts:88-99`), so nothing
  there is keyed to the order and nothing needs changing.
- **P3 (transaction):** on `captured` or `accepted_offline`, mark the bill payment `received`, then
  issue the invoice if the bill is now fully paid (§7). When the live attempt's own answer is a
  decline or a failure, mark it `failed`, which releases its reservation. Anything else leaves it
  `pending`.
- **Offline acceptance** (`accepted_offline`) counts as received, the rule today's P3 follows (see
  §5.4 for when that can happen).

### 5.4 After a crash, and M7b2's manual clear

A pending bill payment is resolved from the provider's row, never from its age:

- **The loop's pass** (beside `releaseStalePaymentAttempts`) completes every pending bill payment,
  not in this process's live attempts, whose `payments` row is now `captured`: it runs P3's work.
  **It never fails one automatically on the provider row's word**, because a failed row does not
  always mean no money moved: SumUp marks a checkout it cannot find `failed` after 15 minutes, which
  its own code calls an uncertain charge (`packages/payments-sumup/src/provider.ts:314-331`), and it
  can reach that when a crash fell after SumUp accepted the checkout but before SumUp's own
  reference for it was stored (`:173`), since our reference reaches SumUp only when an affiliate
  key is configured (`sumup-client.ts:92-100`). A pending bill payment whose
  row is `failed` or still `attempting` goes to M7b2's manager action. The amounts were fixed in P1,
  so recovery re-derives nothing. A captured amount that differs from `applied + tip` files
  nothing, leaves the payment pending for M7b2's manager action, and raises an alert (Task 14 picks
  the code; the nearest sibling is `payment.pending_outcome_unactionable`).
- **A pending bill payment with no `payments` row**, not in this process's live attempts, is marked
  `failed` by the loop, for the providers the server uses today: Stripe's and SumUp's server readers
  commit their `attempting` row before any network call (§2.4), so no row means neither was asked to
  charge, and the simulator writes its only row when `collect` ends and charges nothing real. This
  is the reasoning `releaseStalePaymentAttempts` uses for D22's mark. **A provider that writes its
  row only after the money moves** (Stripe's on-device Tap to Pay,
  `packages/payments-stripe/src/device-provider.ts:46-48`) would break it: a pending bill payment
  with no row goes to M7b2's manager action if that provider is ever used for a bill.
- **A Stripe payment a crash left `attempting`** stays pending, keeps its reservation, and keeps the
  bill locked, because `resolvePending` does nothing. **M7b2's manager action** resolves it against
  Stripe's own record. With several payments on one bill, the action lists the bill's pending
  payments and resolves ONE at a time, by bill payment: captured → P3's work; not captured →
  cancelled at the provider, `failed`, reservation released; provider unreachable or ambiguous →
  refused, the payment stays pending. Task 14 re-maps M7b2 as landed and extends it; it adds no
  second clearing path.
- **An offline-accepted payment the provider later declines** (`forward`,
  `packages/payments/src/provider.ts:108-110`: a decline is an incident with no fiscal change). No
  path the server uses today produces one: only the on-device Tap to Pay provider writes
  `accepted_offline` (`device-provider.ts:123-130`), and `git grep -n 'StripeOnDeviceProvider\|device-provider' -- apps/`
  prints nothing. The rule, for when it is wired:
  - **before the bill's invoice**, the bill payment moves `received → declined`, it leaves the
    balance, and the bill owes that amount again; the incident alert is raised as today;
  - **after the invoice**, it is today's case: the tender stands, the incident alert is raised, and
    nothing fiscal changes.

---

## 6. Refunds

- **Before the invoice**, one bill payment can be refunded, in whole or in part, up to its net
  applied; or, when the payer asks for the whole payment back, its net applied plus its net tip.
  It needs the existing `sale.refund` permission (`packages/identity/src/permissions.ts:7`),
  approved on the operator's device with the manager PIN override that keeps the waiter signed in
  (`authorize`). A cash refund opens the drawer through an audited drawer job (`bill_refund`); a
  card refund calls the provider's `partialRefund` for the exact amount, never `refund`, which
  returns the whole capture, tip included (`packages/payments/src/provider.ts:124-125`). Every
  provider declares `partialRefund: true` on `906ab157b` (Stripe `provider.ts:40`, Stripe on-device
  `device-provider.ts:53`, SumUp `provider.ts:112`, the simulator `simulator.ts:23`); a provider that
  did not would offer no card refund before the invoice. An item payment is refunded whole, which
  releases its lines.
- **After the invoice**, the bill's payments are tenders on a filed sale. A refund of one of them is
  a payment action with no fiscal effect when the charge was right. When the charge was wrong, it is
  the fiscal correction workflow (`recordCorrection`, which "settles nothing; a refund is a separate
  payments action", `packages/core/src/record-correction.ts:55-58`) plus a refund. **No route does
  either today, and Task 14 builds neither**: its scope is money before the invoice. The backlog
  keeps the post-invoice refund as its own item.

### 6a. A reduction on a bill that already has contributions

A €60.00 bill with €50.00 contributed takes a €20.00 comp; it would total €40.00 with €50.00
received. **The comp is refused, `bill.received_exceeds_total`, with the €10.00 excess in its
params; the till offers "refund €10.00 first", and after the refund the comp goes through.** The
excess is never a tip and never a credit. **Why refuse rather than refund automatically:** a card
refund is a network call, so it cannot share the comp's transaction, and a comp that half-happened
while the refund failed is worse than two explicit steps. **Why not a credit:** a credit left on a
visit that closes has no home and no fiscal meaning. After the refund and the comp, the bill is
€40.00 with €40.00 received, so the comp's transaction issues the invoice (§7).

---

## 7. The invoice at full payment

**A bill's invoice is issued by the transaction whose write leaves it fully paid:** the bill is
open, it has no pending payment, it has at least one line and at least one received payment, and
the net applied of its received payments equals its total. A bill whose lines were all comped and
that holds no payment is not issued by this helper. No product path issues a €0.00 sale today: the
pay action sends one tender for the total, and `tenders_amount_ck` refuses a zero amount
(`packages/db/src/schema/sales.ts:254`), although `settleSale` itself accepts no tenders
(`packages/core/src/settle-sale.ts:106-107`). How a fully comped bill closes is Task 11's to decide.

One helper (`issueIfFullyPaid`) is called at the end of every write that can make that true:

- a cash payment's own transaction;
- a card payment's P3, or its recovery by the loop or M7b2;
- a write that lowers the total to exactly what has been received: a move or split of lines out, a
  void, a quantity reduction, an adjustment.

**Why in the same transaction:** a bill left fully paid but not invoiced would only lengthen the
delay between the first payment and the invoice that asesor Q27(a) asks about, and it would need a
second trigger to close it later.

**Today's single-payment routes stay** (`/api/sales`, `/api/pay`), so the till keeps working until
Task 15 moves it to the bill routes; each of them pays a bill in one go exactly as today. On a bill
that already holds a pending or received bill payment they refuse with `bill.payments_received`,
because they would invoice the whole total as one tender beside money already taken.

The helper calls `recordSale` with immediate settlement and the tenders of §2.5, links every card
bill payment's `payments` row to the sale, settles the order and queues the receipt (which lists
every tender; `readTenderBlock` reads only the first today, so the ticket changes, Task 14). At most
one sale per working order (`sales_working_order_id_key`) makes a repeat impossible, and
`tenders.bill_payment_id`'s uniqueness makes each payment one tender.

**VAT.** Each line is filed at the rate lane C's M7v records on it when its price locks, and issuance
re-resolves nothing. (Today issuance re-resolves a line's rate from its product's current VAT class,
`priceStoredOrderForIssuance`, `apps/server/src/working-order.ts:593-620` on `main`; M7v removes
that.) The fiscal record is the same one a single payment files today; tenders and tips never reach
the fingerprint (`computeHuella`), so the golden huella test must pass unedited.

**The bottle.** A €30.00 bottle moved to its own bill and paid by three €10.00 contributions files
ONE line of €30.00 and three tenders of €10.00.

---

## 8. The acceptance tests Task 14 writes

Each is a server test with a real database (`useVenueDb`), driving the routes; every refusal asserts
its code.

1. **Change and tip:** items €40.00 with cash €50.00 → applied €40.00, change €10.00, tip €0.00; the
   same marked as a tip → tip €10.00, change €0.00; card €50.00 → applied €40.00, tip €10.00, and the
   preview returns that BEFORE `collect` is called.
2. **Contribution:** €120.00 bill, €50.00 cash contribution → €70.00 outstanding, every line's price
   unchanged, no sale row.
3. **The steak:** €105.00 contributed on €120.00, a €25.00 steak, tips on and nothing pending → the
   preview offers exactly the two choices of §3.3 (and one, or none, in the other combinations
   §3.3 lists); each, when taken, leaves €0.00 outstanding, and the first records a €10.00
   tip; no earlier tip is ever part of "available".
4. **Equal shares:** €100.01 as three `share` payments with `share_of` 3, 2, 1 → €33.34, €33.34,
   €33.33; the third issues the invoice.
5. **Already paid:** an item payment for the steak, then a second naming it → `bill.line_paid`; a
   move, a void and a price reduction of it → `bill.line_paid`.
6. **Split after a contribution** (§4.2): €30.00 invoice issued at once; the original's invoice is
   issued for €90.00 when €40.00 more is paid, its tenders summing to €90.00.
7. **A move over the received amount** (§4.3): €60.00 with €50.00 received, moving €30.00 out →
   `bill.received_exceeds_total`; after a €20.00 refund the move goes through.
8. **The invoice at full payment:** no fiscal record exists while anything is outstanding; then
   exactly one, filing each line at its recorded rate; the golden huella test and `inmutabilidad`
   pass unedited.
9. **The bottle** (§7): one line of €30.00 and three tenders.
10. **Retries:** the same `submission_id` twice → one bill payment, one `collect`, one tender.
11. **A reduction after contributions** (§6a): the comp refused with the €10.00 excess; refund
    €10.00, the comp goes through, and the comp's transaction issues the €40.00 invoice with no tip.
12. **Several devices** (§5.2), both orders of each race as sequential calls, codes asserted.
13. **Recovery** (§5.4): a card bill payment whose `payments` row is `captured` after a simulated
    crash is finalised by the loop's next pass, once; one left `attempting` keeps the bill locked.
14. **Abandon** (§4.5): a bill with a received contribution → `bill.payments_received`; after a full
    refund, abandon goes through.
15. **Refund retries:** the same refund `submission_id` twice → one refund row, one drawer job.
16. **No provider row** (§5.4): a pending bill payment with no `payments` row is failed by the loop;
    one whose row is `failed` stays pending.

---

## 9. What this design does not change

- **Counter orders** (walk-up, `ticket_then_pay`, `invoice_first`) keep today's single-payment paths.
  Partial payment at the counter is not asked for.
- **Guest payment and Bizum** are out of scope (plan D13); paying a bill by a hosted payment link
  is not asked for.
- **Stripe's on-device Tap to Pay** writes its `payments` row only after the money moved
  (`packages/payments-stripe/src/device-provider.ts:46-50`), and nothing under `apps/` uses it today
  (§5.4). If a later task wires it for bills, the pending bill payment is written before the device
  is told to collect, and §5.4's no-row rule does not apply to it.
- **A payment before the invoice prints nothing of ours.** The card terminal prints its own slip; a
  "payment received" note is not an invoice (spec §6) and is not built.
- **The daily close** is unchanged: money received against a bill whose invoice is not yet issued is
  not a tender until then (open point §11.5).

---

## 10. What waits on asesor Q27

[Q27](../../compliance/asesor-questions.md#q27-money-taken-against-a-bill-before-its-invoice-exists-then-a-split-added-2026-09-26)
asks whether money may be held against a bill before its invoice, whether the split after a
contribution is correct, and what to do when the invoice was printed first.

- **Built regardless:** everything above. **Held until Q27 answers:** printing the invoice before
  any payment, and correcting it when the table then splits (service spec §6).
- **If Q27(a) sets a maximum delay** between the first payment and the invoice, Task 14's rows
  already hold `received_at`; the change is an alert for a bill holding money longer than the limit.
- **If Q27 says "issue the invoice at the first payment":** the tables of §2 stay. What changes is
  the moment in §7: the first payment's transaction issues the invoice for the whole bill with
  deferred settlement (the `invoice_first` shape, `recordSale` with `settlement: {kind:"deferred"}`,
  `working-order.ts:2659-2678`), each later payment inserts its tender as it is received (the
  triggers allow tenders before settlement is declared), and settlement is declared by the payment
  that covers the total. A split after that first payment then needs the fiscal correction of the
  original invoice and a new invoice for the moved lines, and a round added after it goes to a new
  bill of the visit. §4.2's example would be refused until that correction path exists.
- **If Q27(b) says the split after a contribution is not correct**, moving lines off a bill with
  received money is refused (`bill.payments_received`) until the payments are refunded.

---

## 11. Open points for the owner

Each has a recommended default; the design above is written with the default.

1. **Approve this design** so Task 14 can start. Default: approve as written.
2. **A move that would leave the original owing less than it received** (§4.3). Default: refuse,
   and offer "move fewer lines" or "refund the excess first". Alternative: carry the excess across
   to the new bill as a contribution there.
3. **A new round while a card is at the reader** (§5.2). Default: refused, as D22 refuses it today.
   Alternative: allow additions (they only raise what is owed), refusing only writes that lower the
   total or touch paid lines; this changes M7b's single refusal point into two.
4. **A reduction on a bill with contributions** (§6a). Default: refuse with the excess, offer
   "refund first". Alternatives: refund automatically in the same step (a cash refund could; a card
   refund cannot share the transaction), or refuse the reduction outright.
5. **Money received before the invoice at the daily close** (§9). Default: the close is unchanged
   in Task 14, and a backlog item adds "received, not yet invoiced" to the cash-up. Alternative:
   Task 14 adds it.
6. **Refund permission** (§6). Default: the existing `sale.refund`. Alternative: a new permission
   for refunds before the invoice.
7. **Tips with the venue's tips switched off** (§3.1). Default: a card charge above the applied
   amount and a cash tip are both refused (`bill.tip_not_allowed`). Alternative: allow tips on
   bills whatever the switch says.
8. **A walk-out after a contribution** (§4.5). Default: the bill stays open until Task 17 (unpaid
   departure, waiting on Q28) can close it. Alternative: a manager close before Task 17 that records
   the shortfall without an invoice, which is the reading Q28 asks the advisor about.
9. **Offline card acceptance for a payment that does not complete the bill** (§5.4; nothing in the
   server produces an offline acceptance today, so this matters when Tap to Pay is wired). Default:
   allowed; a later decline before the invoice puts the amount back on the bill. Alternative: allow
   offline only for the payment that completes the bill.

---

## 12. Screens (Task 15)

The till's pay screen for a bill:

- **Three ways to pay**, each showing its scope before it acts (spec §3): Pay selected items,
  Contribute an amount, Split equally (asks how many people are still to pay). The bill's total,
  what has been received, what is reserved by a card in progress, and what is outstanding are shown
  on the screen and refreshed after every payment and every refusal.
- **Before a card is charged**, the allocation (applied, tip, amount charged) is shown and confirmed.
  **Before cash is confirmed**, change is shown, with "leave as tip" (all or an amount).
- **The steak case** shows its two choices as two buttons with their amounts.
- **The list of the bill's payments**, each with method, applied, tip and state; a pending card shows
  "in progress" and, for a manager, the way to M7b2's clear action. Refund (manager) sits on each
  received payment.
- **`bill.allocation_changed`** reopens the confirmation with the new amounts; `bill.line_paid`,
  `bill.received_exceeds_total` and `bill.payments_received` are shown beside the action with the
  way on (refund first, move fewer lines).
- **Related bills** of the visit are listed together (Task 2); the table never reads as fully paid
  while one is outstanding.

New codes, with English and Spanish text wherever the till can meet them: `bill.nothing_outstanding`,
`bill.tip_not_allowed`, `bill.allocation_changed`, `bill.line_paid`,
`bill.received_exceeds_total`, `bill.payments_received`. No `bill.*` code exists on `906ab157b`:
`grep -rn '"bill\.' packages apps --include='*.ts'` printed nothing, where the same command for
`"tab\.` printed 128 lines. Task 14 greps again. `order.payment_in_flight` is reused.
