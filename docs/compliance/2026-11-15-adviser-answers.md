# The tax adviser's answers of 15 November 2026: what they change

Written 15 November 2026 for the owner, to go through before the meeting of Thursday 19 November.

**What arrived.** Marboré Tax & Legal's draft "Veri\*Factu, invoicing and VAT in the restaurant
sector: answers to Waitron's questionnaire", dated 15 November 2026, answers the
[shortened list](asesor-questions.md#the-shortened-list-2026-10-09) sent around 15 October. Its
numbers map one to one: its 1.1 to 1.16 are our S1 to S16, and its 2.1 to 2.6 are our R1 to R6.
It does not answer S17 (selling by weight), S18 (a change of legal name) or S19 (keeping a chain's
later records unsent). The document is marked "DRAFT – Working document subject to review", and its
Spanish version prevails over the English one we received.

**The PDF is not stored here.** This repository is public, and the document is the adviser's
draft. What follows restates his answers in our words, with the laws and rulings he cites, so
they can be searched; the owner keeps the PDF.

**How to use it.** Part A lists where Waitron already does what the adviser says. Part B is each
difference: his answer, what Waitron does today with an example, what should change, and the
decision it needs from you. Part C is what to remember for features not built yet. Part D is the
list of your decisions, numbered, to answer one by one. The follow-up questions for Thursday are in
the [meeting sheet](2026-11-19-adviser-meeting.md): questions 3 and 4 are rewritten and 15 to 22 are
new, in English and Spanish.

**How "today" was established.** By reading the code, tests and backlog on `main` at `52aa441257`
(15 November). Nothing was run. Each claim below has its file and line in the
[evidence table](#evidence) at the end.

## Part A. Where Waitron already matches

| Adviser | His answer, in short | Waitron today |
| --- | --- | --- |
| 1.1 | The ticket is due when the meal ends, in the same visit. Issuing it earlier is not forbidden, but invites corrections. | Issued at payment, in the same visit. (But see B1: it waits for full payment.) |
| 1.6 | An unknown customer who walks out: the VAT is lost in practice. A tourist living abroad is "not established", so the VAT can't be recovered either. A debt paid later needs no change to the invoice. | The walkout's ticket is issued for the full amount and stays. |
| 1.9 | Each diner who orders and pays their own dishes is a separate sale and **must** get their own ticket. A table that ordered together may still split, but need not. | A table can have several bills; each gets its own ticket. |
| 1.12 | A cancellation in a later quarter may go in the current quarter's return or correct the old one; the venue chooses. | Waitron's VAT report counts a void on the day it is made (owner, 24 September), which is the first option. |
| 1.14, first half | Full invoices (F1) and full invoices replacing tickets (F3) may share a series. | They share the full-invoice series. |
| 1.16 | After restoring an old backup: a new installation number and new series, keep everything, cancel nothing automatically. Nothing to tell AEAT. | Exactly that. |
| 2.1 | The first successful print is the original; a later print says «duplicado». Log failed prints. | Done; each print job keeps its status, attempts and last error. |
| 2.2 | The card slip is not an invoice. | As we have it. |
| 2.3 | 0% only for goods donated to non-profits; non-taxable amounts recorded as N1 with the reason. | Confirmed; the "No tax (0%)" entry in the backlog can rest on this. |
| 2.4 | An F3 or a corrective may come from another server of the same taxpayer. A tourist is identified by passport (type 03); which code AEAT accepts is AEAT's technical rule, not law. | As we have it. |
| 2.5 | Replacing the hardware with the same database and software keeps the installation number; when in doubt, a new number is always safe. Nothing to tell AEAT when a chain ends. An emailed F3 is an original, not a duplicate; resending an email that failed is still the original. | As we have it. (Email consent: see B2.) |
| 2.6 (a) | When only part of a purchase's VAT is deductible, declare the full base and apply the percentage to the VAT only. | Done in the purchases report. |
| 1.5, tips | Change the customer leaves on purpose is a tip, outside the price. | Tips are recorded apart from the invoice. |
| 1.5, short payment | Accepting less as payment in full, before the ticket, is a discount and must show on the ticket. | Staff apply a bill discount before payment; it is spread over the lines and shows on the ticket. |

## Part B. Where Waitron differs

### B1. The ticket waits for full payment (adviser 1.3, 1.1, 1.4)

**His answer.** Money a guest pays before the table has been fully served is an advance payment:
VAT is due on it at once and it needs its own ticket (LIVA 75.Dos; RD 1619/2012 art. 2.1). That
holds when the dishes it pays for are clearly identified (CJEU C-419/02, BUPA). Once the meal is
over, several payments may go on one ticket, but the ticket is due when the meal ends: "its issue
cannot be made conditional on the bill being paid in full". A table that leaves with part unpaid
still gets a ticket for everything served.

**What Waitron does today.** A part-payment is held on the bill with no ticket. One ticket is
issued only by the payment that leaves the bill fully paid. A bill that holds any payment cannot
be recorded as an unpaid departure.

- *Example 1, a payment mid-meal.* A table of four has €120 on the bill; mains are still to come.
  At 21:30 Ana pays €30 by card and leaves. Waitron issues nothing. At 23:00 the others pay €90 and
  Waitron issues one €120 ticket listing both payments. The adviser: Ana's €30 needed its own ticket
  at 21:30, if it counts as identified (see question 15).
- *Example 2, part-paid walkout.* After the meal two guests pay €80 of €120; the third leaves
  without paying. Waitron issues no ticket at all, and refuses to record the departure because the
  bill holds a payment. The bill stays open. The adviser: a €120 ticket at the end; the €40 is a
  debt.
- *Example 3, a dish never served.* The guests pay on Monday for what they ate. A dessert ordered
  and never served stays on the bill, so the payments fall short and no ticket is issued until
  staff remove the dessert on Wednesday. The adviser: the meal ended on Monday, so the ticket was
  due on Monday.

**What should change.**

1. Issue the ticket when the table's visit ends, for everything served, whether fully paid or not.
2. Let a part-paid bill be recorded as an unpaid departure, with the ticket for the whole amount.
3. Leave unserved dishes out of the ticket, or settle them, so they don't hold it back.
4. If question 15 says a payment towards the bill mid-meal is an advance: give it its own ticket,
   and have the final ticket deduct it the way a deposit is deducted (C1).

This is the largest change in the answers. It meets the date-of-sale work now on lane L's
unpushed branch `feat/later-sale-date`: that branch's example 3 is example 3 above, and it relies on
the ticket waiting for full payment.

**Your decision (D1).** Design 1 to 3 now, and 4 once question 15 is answered? *Recommended: yes,
and tell lane L before its branch lands.*

### B2. Delivering the ticket (adviser 1.11, 2.5)

**His answer.** The duty is to issue *and deliver* the ticket, and the customer cannot waive it
(DGT V0150-08, V1884-22). Printing only when asked, or never, breaches it. Showing the ticket on a
screen is not delivery. Email or a download link is electronic delivery, which needs the
customer's consent (RD 1619/2012 art. 9). The consent may be tacit, but only if the customer was
told beforehand how the ticket will arrive and that they may have paper. For a link, keep proof
that the customer downloaded it, and offer paper if they didn't.

**What Waitron does today.** After payment the till asks: Receipt, Full invoice, Email or **None**.
A ticket prints only if staff tap Receipt; None closes the window and records nothing. Email takes
the address and nothing else: on 9 October you said "just giving us the email address is
sufficient", recorded as a product decision while the legal question stayed open as A448. A later
reprint from the receipts list is always marked «DUPLICADO», even when nothing was delivered first.

- *Example.* A couple pay €42 by card. The waiter taps None. No paper ticket exists and nothing
  was emailed. The adviser: a breach.
- *Example.* A guest gives an email address. Nothing tells them the ticket will come by email or
  that they can ask for paper. The adviser: not informed consent.

**What should change.**

1. Print every ticket at payment, unless the customer chose email. Remove None.
2. In the email step, show a sentence like "We'll email your ticket to this address. You can ask
   for a paper copy at any time." and record that it was shown.
3. A reprint is the original when no original was delivered before. (Mostly moot once every
   ticket prints, but a failed print still needs it.)
4. A QR code or link the customer scans to download the ticket is not built. Build it only if you
   want it, with the download proof and the paper fallback.

**Your decision (D2).** Do 1 to 3? This reverses your 9 October decision on email. *Recommended:
yes.* Question 16 asks the adviser what counts as delivered when a customer leaves the paper on
the table, and whether the sentence above is enough consent.

### B3. Undoing a ticket when nothing was served or paid (adviser 1.7)

**His answer.** If a ticket was issued for an order that was neither served nor paid, record its
cancellation (AEAT's "anulación" record), not a corrective invoice. The cancellation is only for
invoices issued in error, for a sale that never happened (DGT V0611-11; developer FAQ §17.2.d). A
real sale that was paid and then refunded gets a corrective (R5) instead, delivered to the
customer and kept linked to the refund's evidence.

**What Waitron does today.** Waitron never sends a cancellation record: the code that writes one
is called only from a test helper. Cancelling an order whose ticket was issued and which holds no
money credits the whole ticket with a corrective (C126, your decision of 2 October, taken without
the adviser). Since 11 November the till no longer offers this on the Counter. The server still
does it for a bill recorded as an unpaid departure and cancelled later.

- *Example.* Table 7 is recorded as "left without paying"; a €56 ticket is issued. Later staff
  cancel it. Waitron issues a −€56 corrective, which reduces the VAT by €5.09.
  - If table 7 really ate and left, the adviser says the ticket stands and the VAT cannot be
    reduced (his 1.6, in Part A). The corrective understates the VAT.
  - If the order was entered on the wrong table and nobody ate, the adviser says: a cancellation
    record, not a corrective.

**What should change.** Undoing a ticket where nothing was served and nothing paid sends a
cancellation record. A ticket for food that was served and not paid is not undone. A paid-and-
refunded sale keeps its corrective, as today.

**Your decision (D3).** Make those changes, replacing C126? *Recommended: yes.*

### B4. A free item on a bill mixing VAT rates (adviser 1.10; backlog A445)

**His answer.** A free item given with a paid sale is a discount on the whole (DGT V0555-17). When
the items carry different VAT rates, share the price paid across all of them in proportion to their
value, the free one included; the free item may not be left at zero (LIVA 79.Dos). The menu price
is a fair measure of value for this.

**What Waitron does today.** The free item is priced at exactly €0 and its rate files nothing. A
discount over the whole bill is spread by each line's charged value, so a line already at €0 takes
no share.

- *Example (a deli).* A bottle of wine, €12.00 at 21%, and a loaf, €2.00 at 4%, given free. The
  customer pays €12.00.
  - Today: wine €12.00 (base €9.92, VAT €2.08); bread €0. VAT €2.08.
  - Should be: shared 12:2 by menu price, wine €10.29 (base €8.50, VAT €1.79) and bread €1.71
    (base €1.64, VAT €0.07). VAT €1.86.

In a restaurant, where everything eaten on the premises is at 10%, the result is the same either
way; it matters only where rates mix.

**Your decision (D4).** Build A445 now? *Recommended: yes; fiscal, so you land it.*

### B5. A whole table, or a staff meal, given free (adviser 1.10)

**His answer.** A table given everything free is not a 100% discount. It is a supply for no
payment. There are two ways to treat it:

- **Risk-free:** a self-supply ("autoconsumo") valued at **cost**, not at the menu price (DGT
  V2347-24; LIVA 79.Cuatro). It needs an invoice and a record.
- **Defensible:** an invitation made for business reasons (rewarding a regular, promoting the
  venue) is outside VAT (LIVA 12.3.º; DGT V1496-08, V2330-18, V1443-21). But V2347-24 goes the other
  way and AEAT can be expected to follow it; and the venue would lose the VAT it reclaimed on what
  went into the meal. An invitation for personal reasons (the owner's friends) is a self-supply
  either way.

He recommends recording each invitation's reason and who authorised it, and says the venue should
choose its treatment with its own adviser.

**What Waitron does today.** A fully comped bill closes as a €0.00 ticket. The reason, who asked
and who approved are recorded on the discount, not on the ticket. "Staff meal" is one of the
discount reasons (up to 50% off without approval).

- *Example.* The owner invites a table of four regulars; menu value €160, food cost about €48.
  - Today: a €0 ticket; no VAT.
  - Risk-free: a ticket with a base of €48 and VAT of €4.80, which the venue pays.
  - Defensible: no VAT, as today, provided the reason is a business one.

**What should change.** Let the venue mark each discount reason as either "self-supply at cost" or
"business invitation, outside VAT", and issue the matching document. Valuing at cost needs a cost
figure: Waitron has recipe costs only where recipes are set up. Question 17 asks what "cost" means,
which document is issued, and how staff meals are treated.

**Your decision (D5).** The per-reason choice above, built after Thursday? Or one treatment for
every venue? *Recommended: the per-reason choice, since the adviser leaves it to each venue.*

### B6. A drink sold at the wrong VAT rate (adviser 1.13)

**His answer.** Do not issue correctives to customers: the law forbids charging them the
difference (LIVA 89.Tres.1.º). The venue pays the difference itself, treating the price charged as
already including the right rate (DGT V0824-25, V0624-23). Found before the return is filed: put
it right in that return. Found after: a complementary return for each quarter concerned, with any
surcharge and interest.

**What Waitron does today.** Nothing exists for this. The backlog entry "Correct VAT without
returning money" is open with no design. The VAT report's figures have no way to include an
adjustment.

- *Example.* In the first quarter, 200 cocktails at €8.00 were sold at 10% instead of 21%: €1,600.
  VAT charged: €1,600 × 10/110 = €145.45. VAT due: €1,600 × 21/121 = €277.69. The venue pays
  €132.24 more, and the customers' tickets stay as they are.

**What should change.** No customer documents. Correct the product's class for future sales.
Then either Waitron works out the difference per quarter for the accountant, or the accountant does
it outside Waitron.

**Your decision (D6).** Which? *Recommended: Waitron lists the affected sales and the difference
for each quarter, and the accountant files it; nothing is filed by Waitron itself.* This settles the
"Correct VAT without returning money" entry.

### B7. Spotting a supplier invoice entered twice (adviser 2.6 (b))

**His answer.** Corrected. Don't check "same number within a year". Use the full identity of an
invoice: the supplier's tax ID, its series and number, and its date of issue (RD 1619/2012 art.
6.1.a; developer FAQ §6).

**What Waitron does today.** The same supplier and number are refused within one issue year and
accepted, with a warning, in another (your rule A981, 21 October). There is no separate series
field; a series can only be typed into the number.

- *Example, a false refusal.* A supplier with two series it does not print as prefixes sends a "15"
  dated 3 February and another "15" dated 9 June. Today the second is refused; under the adviser's
  key it is accepted.
- *Example, a miss.* The same invoice is entered twice, once dated 3 February and once, mistyped,
  2 March. Under the adviser's key both are accepted.

**What should change.** Refuse on supplier, number and exact date of issue; warn, not refuse, when
the same supplier and number arrive with a different date, which catches the mistyped date.

**Your decision (D7).** That, replacing A981? *Recommended: yes.*

### B8. A series for full-invoice correctives (adviser 1.14, second half)

**His answer.** Ticket correctives (R5) and full-invoice correctives (R1 to R4) are different types
and must use separate series (RD 1619/2012 arts. 6.1.a and 7.1.a).

**What Waitron does today.** Every corrective goes in one corrective series. Correcting a full
invoice is refused, and the one full-invoice corrective that exists (an R4 for a wrong date) is
switched off. If it were switched on today, it would share the R5 series. You decided on 15 November
that they will not share, so this is a fix before switching on, not a decision.

### B9. A venue's own backup bucket outside the EU (adviser 1.15)

**His answer.** A backup held abroad while the original stays on the box in Spain is not, in
itself, "storage outside Spain". But whoever holds the copy for the venue is a third party (RD
1619/2012 art. 19.3). A third party established outside the EU (in a country without an equivalent
mutual-assistance agreement) must be notified to AEAT before storage starts (art. 19.4), through
AEAT's procedure GZ05. Because GZ05 still reads as an authorisation, he recommends waiting for
AEAT's reply. If the box in Spain is lost and the copy abroad becomes the only one, that could
become storage outside Spain; notifying the copy in advance is a precaution.

**What Waitron does today.** Waitron Cloud is designed, not live: its copies would be with Amazon
Web Services in Spain plus an encrypted copy in Paris, both in the EU. A venue's own bucket may be
with any provider in any country; nothing warns about this or mentions GZ05.

**What should change.** For a venue's own bucket, either allow only providers established in the
EU, or warn that one established outside it must first be notified to AEAT.

**Your decision (D8).** After question 20 (which company is the third party, and does the
provider's home or the data's location count)? *Recommended: wait for Thursday, then warn rather
than restrict.*

### B10. Rebuilding invoice copies after a restore (adviser 1.16)

**His answer.** If the box lost the copies of invoices issued after the backup, retrieve their
records from AEAT's query service to rebuild them. Records sent to AEAT need not be kept on the
box, but **copies of invoices** must be (RD 1619/2012 art. 19; developer FAQ §13.1).

**What Waitron does today.** A daily check asks AEAT what it holds. For invoices AEAT has and the
box doesn't, it keeps only the number, state and fingerprint, as conflict evidence. AEAT's reply
can also carry each invoice's description, customer, VAT breakdown and totals, but not its dishes.
Waitron discards them.

**What should change.** Keep everything AEAT's reply carries for those invoices, so a copy can be
rebuilt. Question 21 asks whether such a copy, without the dishes, is acceptable.

**Your decision (D9).** Build it after Thursday? *Recommended: yes.*

### B11. The date of the sale (adviser 1.4) — being built on lane L's branch

**His answer.** A meal is one service, supplied when it ends, not dish by dish. A dinner past
midnight is dated the day it ends. If the VAT rate changes, the rate on the day the meal ends
applies, except to advance payments, which keep the rate of the day they were paid (DGT V0602-10).
The issue date may stand as the date of the sale when the ticket is issued at the meal's end; an
invoice issued on a later day (a late close, payment by transfer) must also state the date of the
sale.

**What Waitron does today.** On `main`, an invoice shows only its own date (your decision A444, 12
November), and VAT is priced at the rates of the day the bill is fully paid. Lane L's branch
`feat/later-sale-date` (unpushed, tasks 1 to 6 under way) adds the date of the sale to a later
invoice and prices at that day's rates, which matches the adviser.

Two points to check against his answer:

- *When the meal ends.* The branch takes the day of the last dish served, when that falls on an
  earlier trading day than the payment. In a venue whose day turns over at midnight, a table served
  its last dish at 23:40 and paying at 00:30 gets a date of sale of the day before. The adviser
  speaks of the day the meal *ends*; if the meal ends when the guests finish and leave, that is the
  later day. Question 3 asks.
- *Example 3 of B1* (paid Monday, dessert removed Wednesday) is built on the ticket waiting for full
  payment, which the adviser rejects.

**Your decision (D10).** None until question 3 is answered; tell lane L about both points now.
*Recommended: yes.*

### B12. Money given back as goodwill after the ticket (adviser 1.5)

**His answer.** A price reduction after the ticket is issued "will, where applicable, require" a
corrective (LIVA 80.Uno.2.º; DGT V1493-26).

**What Waitron does today.** "Refund a payment" can give money back after the ticket with no
corrective. The design for correcting paid invoices keeps it for exactly this: a goodwill return
for a served dish.

- *Example.* A guest complains after paying €62. The manager gives €10 back. No corrective: the
  venue goes on declaring VAT on €62, about €0.91 more than on €52.

**Your decision (D11).** None until question 19 asks whether the corrective is required or only
allowed.

## Part C. To remember when these are built

- **Deposits (adviser 1.8).** A deposit for an identified booking (date, guests, menu or price) is
  an advance payment with its own ticket. A deposit that identifies nothing is not. The final ticket
  shows the meal's total, the deposit's base and VAT, and what is left to pay; the record sent to
  AEAT carries only what is left. *Example:* a €40 deposit (base €36.36, VAT €3.64), meal €160 (base
  €145.45, VAT €14.55): the final ticket shows €160, minus the deposit, €120 to pay, and its record
  carries base €109.09 and VAT €10.91. Deposits are not built (no backlog number yet). What happens
  to the VAT on a deposit kept after a no-show is question 18.
- **Cash rounding (adviser 1.5).** Not built. Cents added by rounding up are part of the price and
  of the base (DGT V1919-18). Cents left off by rounding down are a discount and must be on the
  ticket, so it never shows more than was collected. *Example:* €12.37 rounded down to €12.35 shows
  "Rounding −€0.02" and a €12.35 total; rounded up to €12.40, the €0.03 is part of the price.
- **The pre-bill (adviser 1.2; backlog A446).** The adviser confirms the strict reading the design
  follows: the pre-bill is a preparatory document, made by the same system, kept and linked to the
  ticket that follows; every later change to the order is recorded, and the order need not be
  locked. A line saying it is not an invoice is advisable, not required; the design doesn't have
  one. His answer to S1 changes nothing in A446, so it can go ahead.
- **The full invoice replacing a ticket (F3; backlog A556).** Not built. When it is, it shows the
  date of the sale when that differs from its own date (adviser 1.4), and sent by email it is an
  original (2.5).
- **A refund by card without the customer present (adviser 1.7).** Issue the corrective anyway
  and keep it linked to the refund's evidence; the risk of not delivering it remains. Waitron's
  "Correct invoice" already does the linking.

## Part D. Your decisions

Answer each with yes, no or a note; the recommendation is first.

- **D1** (B1). Design now: the ticket is issued when the visit ends, paid or not; a part-paid bill
  can be recorded as an unpaid departure; unserved dishes don't hold the ticket. Advance tickets
  after question 15. Tell lane L.
- **D2** (B2). Print every ticket unless emailed; remove None; add the "you can ask for paper"
  sentence to email and record it; a reprint is the original when nothing was delivered.
- **D3** (B3). Nothing served or paid: send a cancellation record instead of a corrective. Served
  and unpaid: not undone. Replaces C126.
- **D4** (B4). Build A445: a free item takes its share of the price by menu value.
- **D5** (B5). Each discount reason is marked "self-supply at cost" or "business invitation"; built
  after question 17.
- **D6** (B6). Wrong VAT rate: Waitron lists the sales and the difference per quarter for the
  accountant; no customer documents.
- **D7** (B7). Supplier invoices: refuse on supplier, number and date; warn on the same number with
  another date. Replaces A981.
- **D8** (B9). Own bucket outside the EU: warn, after question 20.
- **D9** (B10). Keep what AEAT returns for invoices the box lacks, after question 21.
- **D10** (B11). Tell lane L about the meal's end and example 3 now.
- **D11** (B12). Goodwill refunds: wait for question 19.

## Evidence

Read on `main` at `52aa441257` unless stated. Nothing was run.

| Claim | Where |
| --- | --- |
| The ticket waits for full payment, with nothing pending and nothing unsent | `apps/server/src/bill-payments.ts:745-781` (`issueWhenFullyPaid`) |
| A part-payment leaves the bill open with no invoice | `apps/server/src/bill-payments-api.test.ts:766` |
| An unpaid departure is refused while the bill holds a payment | `apps/server/src/unpaid-departure.ts:113-114` |
| Example 3 (paid Monday, dessert removed Wednesday) | `docs/superpowers/plans/2026-11-15-later-sale-date.md:110-139` |
| The branch takes the last dish served on an earlier trading day; P1 states the midnight cost | same plan, lines 83-98 |
| None closes the window and records nothing | `apps/till/src/widgets/settlement-document-dialog.ts:111-118` |
| Email has no consent step (owner, 9 October); A448 open | `docs/backlog/printers.md:713-717` |
| A reprint is always a duplicate | `apps/server/src/transaction-receipt-api.ts:288` and `apps/server/src/orders-reprint.ts:29` call `enqueueReceiptCopy`, which lays the receipt out as a copy unconditionally (`apps/server/src/receipt-print.ts:321`) |
| No cancellation record is sent; core's `recordVoid` is called from a test helper only (the `recordVoid` in `packages/payments` is a card void, a different function) | `apps/server/src/testing/order-venue.ts:229-234`; `docs/backlog/fiscal.md:147` |
| Cancelling an issued order credits it with a corrective (C126) | `apps/server/src/working-order.ts:7428-7435`; `docs/backlog/fiscal.md:748-762` |
| A comp prices the item at €0 and files nothing at its rate | `apps/server/src/adjustments-apply.ts:783-794`; `apps/server/src/full-comp.fiscal-identity.test.ts:263-292` |
| A bill discount is spread by charged value | `packages/adjustments/src/spread.ts:265-275` |
| A full comp closes as a €0.00 ticket | `apps/server/src/pay-owing-nothing.test.ts:379` |
| The discount records reason, requester and approver | `packages/db/src/schema/adjustments/adjustments.ts:61-76` |
| Staff meal is a discount reason, 50% without approval | `apps/server/src/guide/en/table-service.md:34-35` |
| The VAT report has no adjustment for a wrong rate | `packages/reporting/src/modelo-303.ts:14-17, 93-95`; `docs/backlog/fiscal.md:915-920` |
| Partial deduction: full base, scaled VAT | `packages/reporting/src/input-vat.ts:33-36, 66-70`; `input-vat.test.ts:140-153` |
| Supplier invoices unique by supplier, number and issue year | `packages/db/src/schema/purchase-invoices.ts:51-55`; `packages/purchasing/src/supplier-year.test.ts:26-46` |
| One corrective series; the R4 for a wrong date uses it and is switched off | `packages/db/src/schema/series.ts:43`; `packages/fiscal-verifactu/src/record-remedy-replacement.ts:79` |
| A venue's own bucket has no country restriction | `apps/server/src/stream-host.ts:65-151` |
| Cloud's planned storage: AWS Spain plus Paris | `waitron-cloud/docs/cloud-data-processing-register.md:56-57, 88-90` (the Cloud repository) |
| A restore takes a new installation number and new series | `packages/fiscal-verifactu/src/allocation.ts:436-464` |
| The daily check keeps number, state and fingerprint only | `packages/fiscal-verifactu/src/reconcile-series.ts:61-110` |
| AEAT's query reply may carry description, recipients, VAT breakdown and totals | `schemas/RespuestaConsultaLR.xsd:121-146` in the `verifactu` library repository |
| A goodwill return after the ticket uses Refund with no corrective | `docs/superpowers/specs/2026-10-20-a802-partial-paid-invoice-correction-design.md:299-302` |
| Pre-bill, part-payment and free-item entries | `docs/backlog/fiscal.md:20-46` |
