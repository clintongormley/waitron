# Advances and kept deposits (ADVISER-ADVANCES) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`.

**Status: for the watcher's clearance; the owner has answered every open point.** Nothing here is
built. Revised on 19 November to the owner's answers to D1–D11, after a fresh read of that revision
(`~/waitron-campaign-l/receipts/adviser-advances/fresh-read-d8381214af.md`); again to the owner's
20:30 answers (an advance is one share of the bill, invoiced by itself), after a second fresh read
(`~/waitron-campaign-l/receipts/adviser-advances/fresh-read-66b249bb2c.md`); and again to the
owner's 21:00 answers: the rest's invoice lists the dishes and takes the advance off, by its number
and amount; the till's "own receipt" is built now; 10% stands. Revised again after a third fresh
read (`~/waitron-campaign-l/receipts/adviser-advances/fresh-read-d0a9ecf759.md`), under lane L's
rulings of 19 November (listed under "Decisions as answered", each open to the owner): the advance
line prints no base and VAT, and the rest's record subtracts the advance's own filed figures,
which changes what is filed by a few cents in four to seven bills in ten ("Changes to what is
sent to AEAT"). One new point for the owner has a recommended default ("Questions for you"). Every
piece is fiscal: the owner lands it.

**Goal:** A payment towards a meal whose payer wants their own receipt gets an invoice of its own,
«Pago a cuenta — consumo en mesa 7», at the eat-in rate, a ticket or a full invoice as the payer
wants. When the meal ends, the bill's own invoice lists the dishes at their prices, takes the
advance off by its number and amount, and comes to what is left. A company's payment
before the day is invoiced on its booking. When the payments made before the day come to more than
the meal, staff give back the difference or keep it as the agreed price, as agreed with the
company. When a no-show's deposit is kept, Waitron issues the corrective by itself and shows the
kept deposit to the accountant.

**Architecture:** An advance is an ordinary sale (`recordSale`) with one line, linked to its bill
by a new table `bill_advances`, which also puts the advance under its bill's table and zone in
**Find a bill**. When the meal ends, the bill's own invoice covers the rest: its record carries,
rate by rate, the meal's base and VAT less each advance's own filed base and VAT, so no money is
invoiced twice and the bases filed across the advance and the rest add up to the meal's. Each
invoice is a ticket or a full invoice as its payer wants. The rest's sale stores the meal's dishes
plus one line per advance and rate that takes the advanced amount off, and the printed invoice
shows exactly those stored lines: the dishes, then «Pago a cuenta n.º A/12, 19/11/2026» −30.00,
then the total left (owner, 21:00), with no base or VAT printed under the advance (lane L ruling).
Piece 3 (correctives of full invoices) changes a record builder and gets its own plan; the other
pieces call the builders unchanged with new figures, except piece 1's changes to the line writer,
the VAT split and the correction history ("Pieces that touch the invoice builders"). Every change
to what is sent to AEAT is listed in one place, "Changes to what is sent to AEAT".

**Tech Stack:** TypeScript 7, drizzle (core, payments, fiscal-verifactu and bookings migration
sets, rebuilt with `migration-baseline rebuild`), Hono routes in `apps/server` and
`packages/bookings`, Lit screens in `apps/till` and `packages/bookings/src/dashboard`, Vitest 4.

**Spec:** no design document. The rules are the owner's answers of 19 November (table below), the
owner's answers and decisions of 18 November at the top of
[2026-11-19-adviser-meeting.md](../../compliance/2026-11-19-adviser-meeting.md), and the
adviser's answers 1.3 and 1.8 in
[2026-11-15-adviser-answers.md](../../compliance/2026-11-15-adviser-answers.md).

**Code read at:** `main` at `1eb7a415fb` (19 November 2026). **READ** means the cited line was
opened and read; **RUN** means a command was run and its output read. `git diff f77b29f9bb
1eb7a415fb` (RUN) changes, of the files this plan cites by line, only `docs/backlog.md`, whose
A447 and A1407 lines were located again (`:263`, `:1276`); other pointers read at `f77b29f9bb`
hold, and pointers into files that did not change since `42e453075c` were read there. For the
21:00 revision, read at `1eb7a415fb`: `packages/fiscal-verifactu/src/backend.ts:248-271` (what an
F1/F2 record carries), `packages/core/src/record-sale.ts:336-350`,
`apps/server/src/receipt-document.ts:450-503` (lines, total, VAT table) and
`packages/core/src/correction-history.ts:75-91`. For the revision after the third fresh read, read
at `1eb7a415fb` (`git diff --stat 1eb7a415fb origin/main` at `9f5754e5ef`, RUN, touches none of
these): `packages/menu/src/pricing.ts:83-86`, `:179-203` (`baseFromGross`, `rateLines`),
`apps/server/src/find-bill-transactions.ts:15-35`, `:180-191`, `apps/server/src/orders-list.ts:160-215`,
`:820-832`, `:953-975`, `packages/core/src/record-correction.ts:146`, `:412-465`, and
`@waitron/verifactu` 0.2.1's `dist/validate.js:311-314`, `:955-962`. #3752 (receipts that show what is still owed;
payment slips) is open at `ec647b65a5` and is being reworked to the owner's 20:56 answers (a
payment slip prints only when its payer asks); lines only there say so.

---

## Part 1. For the owner

### Words used here

- **Ticket** (F2): a simplified invoice, naming no customer. **Full invoice** (F1): an invoice
  naming the customer, for a company that wants to reclaim VAT. "Invoice" below means either.
- **Corrective**: a new invoice that changes an earlier one by the difference, since an issued
  invoice is never edited. **R5** corrects a ticket; **R1** corrects a full invoice, which Waitron
  cannot issue yet (piece 3).
- **Record**: what Waitron sends AEAT (the Spanish tax agency) for each invoice and corrective.
  **AEAT's test service** is AEAT's practice copy, which answers like the real one but files
  nothing.
- **Series**: a numbering sequence for invoices. Every box has three today: **standard** for
  tickets, **full** for full invoices, **rectificative** for correctives of tickets. Piece 3 adds a
  fourth, for correctives of full invoices.
- **Origin**: which part of Waitron created a sale or record (a till, an operator's script, the
  demo seed). It is stored beside each sale and record and does not enter the record's fingerprint.
- **Advance**: money paid towards a meal that gets an invoice of its own («Pago a cuenta»). A
  **part payment** is money paid towards a bill with no invoice of its own; the bill's invoice
  covers it, as today.
- **Own receipt**: in the till's question, the payer's own ticket or full invoice for the amount
  they pay, a fiscal document. Never a payment slip.
- **Payment slip**: optional proof of one payment, not an invoice. It prints once, only when that
  payer asks (#3752 as reworked); a lost one is reprinted from the print job queue. Nothing in this
  plan relies on a slip existing (owner, 20:57).
- **The rest's invoice**: the bill's own invoice, issued when the meal ends. It lists the dishes,
  takes each advance off, and comes to what the advances did not cover.
- **Invoice builders**: `recordSale`, `recordCorrection` and `recordSubstitution`, the three
  functions in Waitron's central code ("core") that write a sale and hand its record to the part of
  Waitron that sends it to AEAT. The rules this lane works under (its rule "H2") say a change to
  them lands only with your approval, which is why this plan names them.
- **Test venue reset**: before go-live, a change to the database's layout rewrites the layout every
  new box starts from (its "starting migration"), so the test venues are wiped and set up again.
  Pieces 1, 3 and 4 do this, and each pull request says so in its first line.

### Decisions as answered

Recorded in lane L's queue, `~/waitron-campaign-l/questions.md`, as the watcher relayed them on 19
November. The owner's words are quoted; where the queue gives only the watcher's summary, it says so.

| | Decision | Owner's answer | Where recorded |
| --- | --- | --- | --- |
| D1 | When a payment towards a bill is an advance | "a payment made before the meal begins should be an advance, a part payment after the meal has begun but before it has ended: if it needs a receipt, it is an advance, if it doesn't then it is just part payment" | `questions.md:295-297` (17:12) |
| D2 | An advance's VAT rate | Watcher's summary: "D2 = the shipped reduced rate on the day paid (10%), which holds under either answer" (the owner's words at 17:20 were about the eat-in rate, Q10) | `questions.md:299-301` (17:25) |
| D3 | A till advance on a bill set for a full invoice | "Full invoice to the company"; refined by the 20:30 answer to question 2 below | `questions.md:309` (17:53) |
| D4 | Advances worth more than the meal | "This should be agreed between the restaurant and the company. It could either be (1) a refund, (2) tip, or (3) the agreed price which is kept by the restaurant" | `questions.md:310` (17:53) |
| D5 | Origin of a payment recorded in the dashboard | "Add \"dashboard\"" | `questions.md:311` (17:53) |
| D6 | A company's deposit: full invoice or ticket | "Full invoice (Recommended)", then "it could be a ticket too, depends on what the company wants" | `questions.md:312` (17:53) |
| D7 | A cancelled booking whose deposit is kept | "Same as a no-show (Recommended)" | `questions.md:316` (18:10) |
| D8 | The no-show corrective, and where it is reported | "we should issue a corrective to reduce the whole deposit to zero. we keep the 36.36 as compensation. the 3.64 could be refunded to the customer should they ask, but if they don't then we keep it … the corrective and the money kept and the VAT refund owed should be on one of our reports"; then "it'd be good if there were a single report to send to the accountant every month. if not, then so be it" | `questions.md:317`, `:328` (18:10, 18:14) |
| D9 | Whether piece 1 waits for the adviser on Q7 | "it is still being paid towards this meal, as opposed to \"a deposit to spend on anything that you like any time you like\", so this should be an advance" | `questions.md:329` (18:16) |
| D10 | Sending a company the corrective of its kept deposit | "Email it automatically (Recommended)" | `questions.md:330` (18:21) |
| D11 | Invoices whose VAT at one rate rounds to €0.00 | "Every ticket (Recommended)" | `questions.md:331` (18:21) |
| 20:30 Q1 | The adviser's answer 1.3 against D1 | "No, not once the meal has begun. We can take multiple payments towards the final bill. Each one doesn't need a receipt (unless they want one). So there's no difference between Ana paying 30€ at the end and Ana paying 30€ and leaving an hour before the meal ends" | `questions.md:376` (20:30) |
| 20:30 Q2 | Ticket or full invoice on a bill holding an advance | "The advance is a receipt or an invoice by itself. The rest of the bill could be a receipt or an invoice in its own right, but it wouldn't mention the advance. That receipt/invoice has already been issued separately. So with any table, you could split the bill and most people want receipts but one wants an invoice." | `questions.md:377` (20:30) |
| 20:30 Q3 | The tip choice | "agreed" (hold it until the adviser answers Q8) | `questions.md:378` (20:30) |
| 20:30 Q4 | Payment methods in Record a payment | "fair enough" (bank transfer only) | `questions.md:379` (20:30) |
| 20:30 Q5 | A group that has ordered but not started eating | "yes it has begun" (a part payment there is a part payment, with a receipt only if asked) | `questions.md:382` (20:30) |
| 20:57 | Receipt and payment slip | "from the questions, you seem to have confused payment slips (not required) with receipts (required)"; the watcher's rule: the receipt or invoice is required for every sale and lists the payments taken before it prints; a slip prints once, only when that payer asks, and no design may rely on one | `questions.md:429` (20:57), with `:418-426` (20:56) |
| 21:00 Q1 | What the rest's invoice prints | "We are required to list whatever they ordered, which means that we need to mention the advance payment as well, to make it balance out. ok, so we DO need to mention the advance payment on the final bill" (the dishes at their prices, the advance's number and amount taken off, then what is left; this revises the 20:30 Q2 "it wouldn't mention the advance" for the final document only) | `questions.md:432` (21:00) |
| 21:00 Q2 | Build the till's "pay part of the bill with its own receipt" now | "yes" | `questions.md:433` (21:00) |
| 21:00 Q3 | The VAT rate of a payment taken during the meal | "yes, this is correct" (10%, D2; the negative-10% case tested at AEAT's test service before piece 1 lands; the adviser asked) | `questions.md:434` (21:00) |

Lane L's rulings on the third fresh read (of `d0a9ecf759`). These are lane L's, not the owner's;
the owner can overrule any of them.

| | Ruling | Where it lands |
| --- | --- | --- |
| L1 | The printed rest's invoice shows each advance as the owner asked at 21:00, its number, date and amount taken off, with no base and VAT printed under it (the read's option a). The rest's record subtracts each advance's own filed base and VAT from the meal's, rate by rate (option c), so the bases filed across the advance and the rest add up to the meal's; at a rate where that would break AEAT's sign rule, what is left there is worked out from its gross as before. The printed VAT table is the rest's own record. Q3 goes to the adviser (sheet question 12). Lane L ruling, 2026-11-19 | "Changes to what is sent to AEAT", Tasks 1.2, 1.4a, 1.5, 1.6a, example 8 |
| L2 | An advance ticket belongs to its bill's table and zone in **Find a bill**: a device limited to other zones does not see it, and a search by table finds it. Lane L ruling, 2026-11-19 | Task 1.3 |
| L3 | Task 1.6 splits into 1.6a (correction history and the refund refusal) and 1.6b (reports); Task 4.1b splits into 4.1b (issue and seat a booking advance) and 4.1c (correct an advance, with `advance_outcomes`). Lane L ruling, 2026-11-19 | Pieces 1 and 4 |
| L4 | The till's wording for `advance.exceeds_bill` and its route test move to piece 4, which is the first piece that can reach it; piece 1 keeps the check in `deductAdvances` with a unit test. Lane L ruling, 2026-11-19 | Tasks 1.2, 4.3 |
| L5 | The line that takes an advance off stores the fixed words "Payment on account" (and «Pago a cuenta» in Spanish), never a formatted number or date; its number and date are read from the advance when printing. Lane L ruling, 2026-11-19 | Tasks 1.2, 1.5 |
| L6 | Two lines taking off advances never merge on the printed invoice (the read's run showed them merging without the guard). Lane L ruling, 2026-11-19 | Task 1.5 |
| L7 | Task 1.0 also sends a €0.00 record with a negative 10% line and a positive 21% line, example 2 as full invoices, and example 8's rest. Lane L ruling, 2026-11-19 | Task 1.0 |
| L8 | Tasks 1.1, 1.2 and 1.6a each say which invoice-builder code they change, for the owner's approval. Lane L ruling, 2026-11-19 | "Pieces that touch the invoice builders" |
| L9 | Task 1.6a tests that a whole credit of the rest's invoice still works; Task 1.4a tests deferred close with a till advance. Lane L ruling, 2026-11-19 | Tasks 1.4a, 1.6a |
| L10 | Giving back an advance after the rest's invoice has taken it off goes to the owner, with a recommended default. Lane L ruling, 2026-11-19 | "Questions for you" |
| L11 | A till advance ticket is printed only, never emailed, and the plan says so as an exception: Waitron can email any ticket (`apps/server/src/invoice-delivery.ts:45-57`). Lane L ruling, 2026-11-19 | "What each answer means" (20:57), "Choices the plan makes", Task 1.3 |

What each answer means for the build:

- **D1, with 20:30 Q1.** When staff take part of a bill that has no invoice yet, the till asks
  **Does this payer want their own receipt for this amount?** (a ticket or full invoice, never a
  slip). **Yes** makes it an advance; **No** keeps today's part payment. A payment that pays the
  bill off is always part of the rest's invoice. You read the adviser's answer 1.3 as covering money
  paid before the meal begins, so it is no longer an open conflict; the adviser sheet asks the
  adviser to confirm that reading (Q7). A till cannot take money on a bill that comes to €0.00 (RUN,
  under "Where the rules come from"), so the plan treats every till part payment as made during the
  meal, and "before the meal begins" as a booking's deposit or a company's payment before the day
  (piece 4). A group that has ordered but not started eating is during the meal (your 20:30 answer
  to question 5).
- **D2, with 21:00 Q3.** Waitron's shipped "reduced" rate on the day the money is paid, 10% today,
  for every advance. Task 1.0 sends example 2's negative 10% line to AEAT's test service before
  piece 1 lands, and the adviser is asked (Q2, Q12).
- **D3 and D6, with 20:30 Q2 and 21:00 Q1.** Every invoice is a ticket or a full invoice as its
  payer wants. An advance at the till is a ticket in piece 1; piece 1b lets its payer choose a full
  invoice, with the bill's customer filled in when the bill is set for one (D3). The rest's
  invoice is a ticket or a full invoice as the bill is set, whatever the advances were, and lists
  the dishes, then each advance taken off by its number, date and amount, then what is left
  (Task 1.5; no base or VAT under the advance, ruling L1). Whether a full invoice may take off a ticket advance, and the reverse, goes to the
  adviser (Q1) without holding anything up. A company's payment before the day is a full invoice
  or a ticket as the company asks (D6).
- **21:00 Q2.** The till's "own receipt" for an amount (Tasks 1.3 and 1.7) is built in piece 1.
- **20:57.** Every advance's ticket and every rest's invoice is printed (or, for a full invoice,
  emailed if the payer chooses). One exception to the rule for any sale's receipt (ruling L11): a
  till advance ticket can only be printed, on the device that took the payment, though Waitron can
  email any ticket (`apps/server/src/invoice-delivery.ts:45-57`). The rest's invoice lists
  the payments with no invoice of their own taken before it prints, as #3752 (reworked) does; an
  advance appears on it as a line taken off, not as a payment, and its money is listed on the
  advance's own ticket. The receipt question asks about a ticket or full invoice, never a slip.
  Whether a slip prints is #3752's separate choice; nothing here prints one or depends on one.
- **D4, with 20:30 Q3.** Piece 4 builds **give back the difference** and **keep it as the agreed
  price**. The tip choice is held until the adviser answers Q8.
- **D5, with 20:30 Q4.** "dashboard" joins the origins a sale may carry; the list is shared by the
  sales, bill payment, card payment, correction, refund and AEAT-record tables, so all of them
  widen (piece 4). The dashboard records bank transfers only.
- **D7, D8, D10.** Piece 5. The kept deposit goes on the accountant workbook that **Sales &
  takings** already downloads (the plan's choice of "the existing report that fits best"; the
  corrections list of ADVISER-CORRECTIONS-REPORT is the alternative, not yet on `main`). When a
  customer asks for the €3.64 back, staff record it on the booking (Task 5.2).
- **D9.** Asked about Q7 only, so it settles only that piece 1 need not wait for the adviser's
  answer to Q7. Q2 still touches what piece 1 files, so Task 1.0 sends example 2's record to AEAT's
  test service before piece 1 lands.
- **D11.** The one-cent rule goes in `rateLines`, which works out the VAT of every invoice, full
  invoices included: AEAT's check behind it treats tickets and full invoices alike, exempting only
  correctives by differences and R2/R3 correctives (`dist/validate.js:950-960`, READ). So it
  applies to every invoice, not only tickets.

### What the till does today when a bill is split (RUN)

- **By dishes, into separate invoices:** **Move dishes…** or **Split a table** puts dishes on a
  bill of their own (`apps/server/src/guide/en/table-service.md:617-661`, READ). Each bill has its
  own sale and its own ticket-or-full-invoice choice (`PUT /api/working-orders/:id/invoice-choice`,
  `apps/server/src/till-api.ts:2192`).
- **By amount, on one invoice:** **An amount** and **Split equally** in the Pay window take several
  payments that all end on the bill's one invoice. RUN at `89cb892c8c`:
  `pnpm --filter @waitron/server exec vitest run src/bill-payments-api.test.ts -t "files one line of €30.00 and three tenders"`
  passed (1 passed, 199 skipped). That test (`apps/server/src/bill-payments-api.test.ts:3657-3676`)
  splits a wine bottle onto a bill of its own, then takes three €10.00 payments: one sale, one
  €30.00 line, three tenders. `-t "leaves €70.00 outstanding"` also passed: a part payment issues
  no invoice (`:822`). And, RUN at `1eb7a415fb`, `-t "invoices the €30.00 split at once"` passed
  (1 passed, 199 skipped): on a €120 bill that has taken €50, €30 of dishes moved to a bill of their
  own gets its own €30.00 invoice when paid, and the original's invoice is for the €90 of dishes
  left (`apps/server/src/bill-payments-api.test.ts:1797-1822`). Neither invoice mentions the other,
  and neither needs to: each lists only its own dishes.
- **By amount, into separate invoices:** nothing does this today. The advance is that: one share
  of the bill, by amount, invoiced by itself. Piece 1 builds it on the bill payment route, so it
  reuses that route's payment, refund and card handling, and the rest's invoice comes from the same
  final-invoice paths as today.

### What staff and the venue can do when each piece lands

Build order: **1, 3, 1b, 4, 5**. Piece 3 is planned separately and can be built beside piece 1,
but lands before 1b, 4 and 5. Before piece 1 lands, example 2's record goes to AEAT's test service
(Task 1.0). Inside piece 1: 1.1, 1.2, 1.3, 1.4a, 1.4b, 1.5, 1.6a, 1.6b, 1.7, 1.8; Task 1.0 runs
beside them and must be answered before the PR lands.

1. **Piece 1: a payment whose payer wants their own receipt gets its own ticket.** At 21:30 Ana pays
   €30 towards table 7's €120 bill, says she wants her own receipt, and leaves. Waitron prints her a
   ticket for €30, «Pago a cuenta — consumo en mesa 7», at 10%: €27.27 plus €2.73 VAT, with its own
   number, A/12, and sends its record to AEAT. When the meal ends (Print the bill, the last payment,
   left without paying, or the end of the business day), the bill's own invoice prints the dishes,
   €120, then «Pago a cuenta n.º A/12, 19/11/2026» −€30.00, then TOTAL €90.00 and the VAT table of
   what is left; its record carries €81.82 plus €8.18 VAT (the meal's €109.09 and €10.91 less A/12's
   own €27.27 and €2.73). Find a bill shows Ana's ticket under table 7, so a copy can be printed for
   her. A part payment nobody wants a receipt for works as
   today: it is listed among the payments on the bill's invoice. Before the bill has an invoice,
   **Refund** on a payment that has its own ticket opens **Correct invoice** on that ticket; once
   the table's invoice has taken it off, the till refuses (`advance.taken_off_final_invoice`) and
   names Correct invoice on the table's invoice (owner, 20 November, 14:26).
   (2026-11-21: replaced by [the refund-after-final plan](2026-11-21-advance-refund-after-final.md).) On a bill set for a full invoice the
   question is not asked until piece 1b. The staff guide, in English and Spanish, says all of this.
   Test venues are reset.
2. **Piece 3: correctives of full invoices (its own plan).** Today no full invoice can be
   corrected. Pieces 1b, 4 and 5 need it. Test venues are reset.
3. **Piece 1b: an advance as a full invoice.** After **Yes**, staff choose **Ticket** or **Full
   invoice**; a full invoice needs the customer's details, filled in with the bill's customer when
   the bill is set for one.
4. **Piece 4: a company pays before the day.** The company pays €1,000 by bank transfer on the 5th
   for its dinner on the 14th. In the dashboard's **Bookings**, a manager records the transfer
   against the booking and chooses full invoice (with the company's details) or ticket. Waitron
   issues it, worded «Pago a cuenta — reserva del 14/12/2026, 40 comensales», for printing or email.
   When the group is seated, the advance moves to the table's bill, and the rest's invoice lists the
   dinner, takes the advance off by its number and comes to what is left. Until then it never blocks
   removing a dish, and **Still to pay** never goes below €0.00. If the meal comes to less than what
   was paid, the till says so when the meal ends and offers, as agreed with the company, **Give back
   the difference** or **Keep it as the agreed price**. Test venues are reset.
5. **Piece 5: a kept deposit.** Marking a booking as a no-show, or cancelling it and choosing
   **Keep the deposit**, makes Waitron issue a corrective taking the deposit's invoice to zero
   (−€36.36, −€3.64 on a €40 deposit). Nothing is refunded. A company's corrective is emailed to
   the address its deposit invoice went to. The accountant workbook lists the corrective with the
   money kept (€40) and the VAT the customer could ask back (€3.64). If the customer asks for the
   €3.64, staff give it back and record it on the booking. **Give it back** on a cancelled booking
   records that the transfer was returned and files the corrective.

### Changes to what is sent to AEAT (for your approval)

Every change to the records Waitron sends AEAT, in one list. What an F1 or F2 record carries is
fixed by `packages/fiscal-verifactu/src/backend.ts:248-271` (READ): invoice number and date, the
issuer, the type (F2 with no customer, F1 with one), the customer, `DescripcionOperacion` (the
caller's operation description, `packages/core/src/record-sale.ts:336`), the VAT breakdown per
rate (`Desglose`), the total VAT and the total. It has no field for the dishes and none naming an
earlier invoice, so what the printed invoice lists does not reach AEAT.

Records that are new or change, against `main` today:

1. **Each advance is a new record (piece 1, Task 1.3).** An F2: one breakdown line at 10%
   (example 1: base 27.27, VAT 2.73), total 30.00, operation description «Pago a cuenta — consumo
   en mesa 7». Piece 1b makes the same record an F1 naming the payer's customer; piece 4 makes it
   from the dashboard («Pago a cuenta — reserva del 14/12/2026, 40 comensales»), F1 or F2.
2. **The rest's record carries the meal less each advance's own filed figures, rate by rate
   (piece 1, Tasks 1.2 and 1.4a; ruling L1).** At each rate an advance touches, the record's base is
   the meal's base at that rate (the sum of its dishes' bases, as every record is worked out today,
   `packages/menu/src/pricing.ts:179-203`) less the advance's own filed base, and its VAT is the
   meal's VAT less the advance's own filed VAT, each with any correctives of the advance. So the
   bases and the VAT filed across the advance and the rest add up to what one invoice for the meal
   would carry. Example 1: 10% base 81.82, VAT 8.18, total 90.00 (109.09 − 27.27 and 10.91 − 2.73),
   where today's record for the same meal would carry 109.09, 10.91 and 120.00. Example 8 (seven
   €1.05 dishes, a €3.00 advance): 10% base 3.92, VAT 0.43, total 4.35 (6.65 − 2.73 and 0.70 −
   0.27). A rate the advances more than cover goes negative (example 2: 10% −27.27 and −2.73 beside
   21% 66.12 and 13.88; Task 1.0 asks AEAT's test service first). Its type (F1 or F2) is as the bill
   is set, and its operation description is chosen as today.
   - **When the subtraction is not used.** At a rate where the subtracted base and VAT would be
     refused by AEAT's sign rule, as Waitron's copy of AEAT's checks states it
     (`@waitron/verifactu` 0.2.1, `dist/validate.js:955-959`), what is left at that rate is worked
     out from its gross alone instead (`splitGross`, item 3), as the previous revision did
     everywhere. The rule refuses a rate whose VAT is 0.00 while its base times the rate does not
     round to 0.00, whose base is 0.00 while its VAT is not, or whose base and VAT have opposite
     signs. RUN at `1eb7a415fb`, a throwaway Vitest file in `packages/fiscal-verifactu` (deleted),
     using the real `baseFromGross` and `validate`: of 20,000 random meals at 10% (2 to 15 dishes
     of €1.05 to €22.00, an advance below the meal), 16 needed it, never with more than €0.23 left
     at that rate; of 20,000 mixed 10% and 21% meals with a 10% advance, 14, never with more than
     €0.16 left; of 242,000 cases with between −€0.60 and €0.60 left, 21,105, never with more than
     €0.38 left, and in 977 of 2,000 meals whose advance equalled the meal. Every record chosen
     passed `validate` in all three. It is how example 6 is filed (the subtraction gives 0.05 and
     0.00, refused; filed 0.04 and 0.01), and how a bill whose advances equal its meal files 0.00
     when the subtraction would leave a base and VAT of opposite signs.
   - **Under piece 4's agreed price**, the advance is taken off only up to the meal (example 3).
     The part taken off has no filed base of its own, so the capped rate is worked out from its
     gross alone, as in the bullet above.
3. **The one-cent rule, on every invoice (piece 1, Task 1.2; D11).** When a rate's VAT works out
   at 0.00 but its base times the rate does not round to 0.00, one cent moves from base to VAT
   (€0.05 at 10%: 0.04 + 0.01). In the sweep under "Where the rules come from" (single amounts
   from −€200 to €200), the amounts it changes are the four AEAT's checks refused, which the chain
   turns into `fiscal.record_invalid` today; the plan therefore expects no record that can be filed
   today to change, and Task 1.2's "every other amount rates as before" is the check.
4. **A corrective of the rest's invoice (piece 1, Task 1.6a).** R5 by differences, as today, but
   its amounts come only from the dishes, never from the line that takes the advance off, and at
   each rate never more than the rest's record carries at that rate.
5. **Correctives of full invoices (piece 3, own plan).** R1 records in a fourth series.
6. **Correctives of advances without a refund through Waitron (pieces 4 and 5).** Give back the
   difference (piece 4), a no-show's or kept cancellation's deposit taken to zero (piece 5): R5,
   or R1 through piece 3, filed by `recordCorrection` unchanged.
7. **The origin "dashboard" (piece 4).** Stored beside the sale and the record, not sent to AEAT
   and not in the fingerprint ("the source and device are inert to the huella",
   `write-path.e2e.test.ts:510`, must pass unedited).

**Against the previous revision of this plan (`d0a9ecf759`): the rest's record changes by a few
cents in four to seven bills in ten.** That revision worked out what is left once, from its gross
(`splitGross` of the meal's gross less the advance's), and printed the gap as the advance line's
base and VAT, which then differed from the advance's own. This revision files that gap instead: the rest's base moves
by a few cents one way and its VAT by the same cents the other way; the total, the advance's own
record and the dishes do not change. How often: the third fresh read measured the gap on the
printed line in 13,691 of 18,947 random meals at 10% (72.3%: 1 cent in 8,196, 2 cents in 4,222,
3 cents in 1,232, 4 cents in 41); under this revision those bills, less the few that are worked out
from the gross as above, change their record by those cents, because the printed gap was the old
remainder's base less the new one. The sweep above counted the record change directly and found it in 10,943 of 20,000 meals at 10% (1 cent
9,132, 2 cents 1,665, 3 cents 139, 4 cents 7) and 8,560 of 20,000 mixed meals (at most 3 cents);
the share depends on the prices drawn. Example 8 shows one: the previous revision would have filed
3.95 and 0.40; this one files 3.92 and 0.43. Examples 1, 2 and 6 file the same as before. Q3 asks
the adviser to confirm.

### Pieces that touch the invoice builders (for your approval)

The invoice builders are `recordSale`, `recordCorrection` and `recordSubstitution` (see "Words
used here"), and the code that works out the figures they file. Each task that changes them says
so in a **Builders touched** line, so you can approve each change where it is built.

- **Piece 1:**
  - **Task 1.1:** `saleLineRows` (`packages/core/src/sale-line-rows.ts:13`), which `recordSale`
    (`record-sale.ts:328`), `recordCorrection` (`record-correction.ts:212`, `:329`) and
    `recordSubstitution` (`record-substitution.ts:232`) share, stores two more facts on each line:
    whether it is an advance or the line that takes one off, and which advance. The two copies of a
    line used for correctives (`correctionLinesFor`, `reversedLines`) carry them.
  - **Task 1.2:** `rateLines` (`packages/menu/src/pricing.ts:179`), which works out the VAT of
    every invoice, gains the one-cent rule (item 3), and the new `deductAdvances` works out the
    rest's figures (item 2).
  - **Task 1.6a:** core's reading of an invoice's earlier corrections (`readHistory`,
    `readCorrectableLines`, and `checkPartialCorrectionHistory`, which `recordCorrection` checks)
    learns the line that takes an advance off (item 4).
- **Piece 3:** `recordCorrection`'s record builder (R1) and a series (item 5).
- **Pieces 1b, 4 and 5** call `recordSale` and `recordCorrection` unchanged.

The code that builds the record, its fingerprint, the chain and invoice numbering does not change
outside piece 3. The test that pins the exact fingerprint of known records
(`packages/fiscal-verifactu/src/write-path.e2e.test.ts`) and the test that stored records cannot be
changed (`inmutabilidad.test.ts`) run unedited in every piece; if either fails, the implementer
stops and reports to you rather than editing the test.

### Answers that conflict, listed and not resolved

1. **D1 against the backlog and the adviser sheet on `main`.** A447 says "Money paid before then
   is an advance, even when it names no dishes" (`docs/backlog/fiscal.md:68`), and so do
   `docs/backlog.md:263-266` and the sheet's "Changed" note (`2026-11-19-adviser-meeting.md:26-28`).
   The plan is written to D1 and your 20:30 reading; piece 1's docs task rewrites A447.
2. **D4's tip choice against the tip rules.** A tip is "the payer's affirmed gratuity,
   non-taxable and on no invoice" (`packages/db/src/schema/sales.ts:303`), and the sheet treats a
   tip as outside VAT because "no fixed amount is set and the amount is left to the giver"
   (`2026-11-19-adviser-meeting.md:175`). Held until the adviser answers Q8, as you agreed.
3. **D4 against the end-of-business-day invoice** (#3847, open). That job issues open table bills
   with nobody present, and on its branch a refused bill counts as a failure and is retried with
   increasing waits (`apps/server/src/close-of-day.ts:326-352`, `:368` at `f580b5eb7a`, READ). A
   bill whose booking advance is worth more than its meal needs staff to choose; piece 4 makes the
   job leave such a bill open, without counting it as a failure.
4. **D8 against the sheet's own premise.** The sheet says reducing VAT already declared "requires
   refunding it to the customer (LIVA 89.Cinco.b)" (`2026-11-19-adviser-meeting.md:160`); D8 keeps
   the €3.64 unless the customer asks. The adviser is asked (Q9).
5. **The owner's 17:20 VAT research against the 18 November answers.** "all dine in consumption
   is charged at 10%, so the individual VAT rates only apply when you buy products to take away"
   (`questions.md:300`) against "in the restaurant, if a customer orders just alcohol without food
   then they should pay 21%" (`2026-11-19-adviser-meeting.md:139`) and a dated eat-in rate per
   product (`:145`, `:152`). No design here changes (Q10). If the adviser confirms 10% for all
   dine-in, example 2 cannot happen at a table and Task 1.0 is no longer needed.

### Questions for you

1. **Giving back an advance after the table's invoice has taken it off (ruling L10).** As planned,
   **Correct invoice** on Ana's ticket A/12 still works after the table's invoice has taken her €30
   off (Task 1.6a), and what the table owes does not change (Task 1.4b). So if a manager gives Ana
   her €30 back after Print the bill, the meal's price has in effect come down by €30: the table's
   invoice still lists €120 of dishes and takes A/12 off, A/12's corrective takes A/12 to zero,
   and nobody pays the €30 again. It needs the corrective permission (`sale.rectify`), asked for in
   place with a manager's sign-in, as any refund after an invoice does. It is also the only way to
   give back more than the table's invoice carries: if the guests send back €100 of dishes after
   paying the €90, the table's invoice can be corrected by its €90 and the other €10 comes off the
   advance (Task 1.6a's test). **Recommended: keep it as planned.** A refund after an invoice is
   always a price cut recorded by a corrective, and refusing this one would need a second way to
   give back that €10. The alternative is to refuse it once the table's invoice exists, except for
   what the table's invoice cannot take. The plan goes ahead with the recommendation unless you
   say otherwise.

   **Answered 2026-11-20 14:26 (owner): refuse it.** "Once a table's final invoice exists, the till
   refuses to refund an advance on its own", naming Correct invoice on the table's invoice, which
   takes the amount off the dishes at their own rates; before that invoice, refunding an advance
   works as planned. Built as `advance.taken_off_final_invoice` (`advance-taken-off.ts`), refused
   by Correct invoice on the advance's ticket and by a plain or bill refund of its money, and still
   refused after a whole credit of the table's invoice. The €10 beyond what the table's invoice
   carries therefore has no way back through the till.
   (2026-11-21: replaced by [the refund-after-final plan](2026-11-21-advance-refund-after-final.md).)
   A correction of an advance still open holds the table's invoice back
   (`advance.correction_open`, `refuseWhileAdvanceCorrectionOpen` in `bill-advances.ts`), so it
   cannot file a credit note after that invoice took the advance off. A reader payment started
   before the correction keeps its money with no invoice; when the correction is closed or
   discarded, the table's invoice is issued if the bill is then paid off (`issueAdvanceBill` in
   `invoice-corrections.ts`; tested with Discard), and ending it is refused when issuing that
   invoice is refused, as while the box waits for its time.

Your 21:00 answers settled the last three earlier questions: the rest's invoice lists the dishes
and takes the advance off by its number and amount (example 1); the till's "own receipt" for an
amount is built now; every advance is charged at 10%, with Task 1.0 at AEAT's test service and the
adviser asked. The adviser's questions further down hold nothing up; only Task 1.0's answer from
AEAT's test service holds up piece 1's landing. Lane L's rulings L1 to L11 ("Decisions as
answered") are yours to overrule.

Settled earlier by your 20:30 answers: conflict 9 (your reading of answer 1.3); switching a bill
holding an advance between ticket and full invoice (nothing is refused); the tip choice (held);
payment methods (bank transfer only); a group that has ordered but not started eating (during the
meal); whether seating a booking sets its bill to a full invoice (no: the rest's invoice is as the
bill is set, like any bill).

### Choices the plan makes that you can overrule

- An advance's record to AEAT carries the same description as its invoice line.
- On the rest's invoice, each advance is one line per rate it touches, «Pago a cuenta n.º A/12,
  19/11/2026» and its amount (−30.00), with nothing printed under it (ruling L1). The third fresh
  read found that a base and VAT printed there would differ from A/12's own by a few cents in most
  bills. On a ticket the line carries its VAT-rate letter, like every line; on a full invoice its
  base column shows the line's stored base, which is A/12's own base (−27.27), except at a rate
  worked out from its gross (example 6: −27.28). The adviser's answer 1.8 as recorded has the
  final ticket show "the deposit's amount before VAT and its VAT"; Q4 asks whether the number,
  date and amount are enough. Under the agreed price (piece 4) the line names the advance's full
  amount and takes off only the meal's part: «Pago a cuenta n.º F/3, 05/12/2026 (1000,00 €)»
  −800.00.
- The till's question reads **Does this payer want their own receipt for this amount?**, with
  **Yes — a ticket of its own; the table's receipt takes it off** and **No — it is listed on the
  table's receipt** (Spanish twins in Task 1.7). It never says "slip"; a payment slip is #3752's
  separate choice and stays offered or not as #3752 decides.
- A bill with no table number reads «Pago a cuenta — consumo en pedido 123».
- A till advance ticket prints on the device that took the payment and is never emailed. This is
  an exception (ruling L11): Waitron can email any ticket (`apps/server/src/invoice-delivery.ts:45-57`),
  and a copy of the advance ticket can be printed again from **Find a bill**. A full-invoice
  advance (piece 1b) is printed on A4 or emailed, as the payer chooses.
- The receipt question is never asked on **Whole bill** or when the amount pays the bill off, and
  has no answer chosen in advance.
- Marking a no-show, keeping or giving back a cancelled booking's deposit, giving back the VAT of a
  kept deposit, and each D4 choice need the corrective permission (`sale.rectify`), asked for in
  place with a manager's sign-in.
- The €3,000 limit for a ticket is checked against the meal's total, not what is left after
  advances, since the law's «cuando su importe no exceda»
  (`docs/compliance/verifactu-findings.md:1164`) should not be met by splitting one meal; an
  advance ticket is checked against its own amount.
- A bank transfer is stored with the existing payment method "other"
  (`packages/db/src/schema/sales.ts:47`), which prints no payment row on a one-payment invoice
  (`apps/server/src/receipt-document.ts:539-551` prints one only for cash, deferred and card).
- The kept deposit goes on the accountant workbook, not the corrections list.

### What this plan leaves out, on purpose

- **Issuing an open bill when the business day ends** is ADVISER-CLOSE-OF-DAY-TICKET's (#3847). It
  issues through `priceForIssuance` and `issueUnpaidInvoice`, which piece 1 makes take advances off.
- **Splitting a bill by amount into several invoices at the end of the meal** (each guest their own
  invoice for an amount). An advance does this for one share during the meal; doing it for every
  share at the end is a separate item, if you want it.
- **Online deposits.** Every bookings route is under `/management-api`
  (`packages/bookings/src/routes.ts:134`), so nothing online takes money.
- **Moving money for a bank transfer through Waitron.** Refunds return cash or card only
  (`apps/server/src/tender-refund-balance.ts:130`). Staff return a transfer outside Waitron and
  record it; Waitron files the corrective.
- **A new report.** The kept deposit goes on the existing accountant workbook (D8).
- **Exchanging advance tickets for a full invoice afterwards** (F3, A556, not built).
- **Merging a bill that holds an advance.** Already refused for a bill holding payments
  (`apps/server/src/bill-actions.ts:85`, `:133`); piece 4 extends it to a booking's advance.

### Open questions for the adviser

Q1, Q2, Q3, Q4, Q6–Q10 and Q12 are on the adviser sheet as question 12, in English and Spanish.
Q5 is on this list only. Q11 was withdrawn after the owner's 21:00 answer. None holds up a
piece; Task 1.0 (Q2) holds up piece 1's landing.

- **Q1.** The rest's invoice takes off each advance whatever kind each invoice is. May a full
  invoice (F1) for the rest take off an advance invoiced as a ticket (F2), and may a ticket for the
  rest take off an advance invoiced as a full invoice? (Example 7: Luis's full invoice to Acme,
  then a ticket for the rest.) Built as allowed; if the adviser says no, a refusal is added where
  the second kind is chosen (Tasks 1.4b, 1b.1 and 4.1b), not a change to any record.
- **Q2.** When an advance at 10% is larger than the meal's 10% part (example 2), may the rest's
  record carry a negative line at 10% beside a positive line at 21%? Waitron's copy of AEAT's
  checks accepts it; Task 1.0 sends it to AEAT's test service. AEAT's test service accepted it
  (verifactu run 44707265624, `e5d065b40f`: every record `Correcto`).
- **Q3.** The rest's record takes off the advance's own filed base and VAT (ruling L1), so across
  the two invoices the VAT declared is what one invoice for the meal would declare. Example 8:
  seven €1.05 dishes at 10% (base 6.65, VAT 0.70) and a €3.00 advance (2.73 + 0.27) leave 3.92 +
  0.43, and 0.27 + 0.43 = 0.70. The rest's VAT is then not always its base times the rate, rounded
  (3.92 × 10% = 0.39, filed 0.43); the meal's own invoice today already has such a gap (6.65 ×
  10% = 0.67, filed 0.70), because each dish's base is rounded. Working out what is left once,
  from its gross, would file 3.95 + 0.40 and declare 0.67 over both invoices, 3 cents less than
  the meal's. Is taking off the advance's own figures right? Where that would break AEAT's sign
  rule, which in the sweeps happened only with less than €0.40 left at a rate, what is left is
  worked out from its gross (example 6).
- **Q4.** Is this the right way for the rest's invoice to show the advance: the dishes at their
  prices, then «Pago a cuenta n.º A/12, 19/11/2026» −30.00, then TOTAL 90.00 and the VAT table of
  what is left (10%: 81.82 and 8.18)? The owner chose to list the advance "to make it balance
  out". Your answer 1.8, as we recorded it, has the final ticket show the deposit's base and VAT;
  we print them on the advance's own ticket only, and the final ticket's VAT table shows what is
  left after them. Are the advance's number, date and amount enough on the final ticket? RD 1619/2012 art. 6.1.i (full invoices) and 7.1.c (tickets) require the
  date «en la que, en su caso, se haya recibido el pago anticipado» on an invoice that documents an
  advance (`docs/compliance/research/2026-10-09-invoice-timing.md:136`,
  `docs/compliance/verifactu-findings.md:968`); the rest's invoice prints the advance's date as
  well.
- **Q5.** Confirm that a no-show's corrective takes the whole deposit to zero (D8), not only its
  VAT.
- **Q6.** No source in the repository says how AEAT expects the rest's record to relate to a
  separately invoiced advance, and the record has no field naming it. The plan files the rest's
  record for the meal less the advance, rate by rate, as answer 1.8 does ("its record carries only
  what is left"), while the printed invoice lists the whole meal and the advance; please confirm.
- **Q7.** Confirming the owner's reading: answer 1.3, as we recorded it, makes money paid before
  the table has been fully served an advance with its own ticket. The owner reads it as covering
  money paid before the meal begins. Once the meal has begun, guests may make several payments
  towards the final bill, and a payment gets its own invoice only if the payer wants one: there is
  no difference between Ana paying €30 at the end and paying €30 and leaving an hour before the
  meal ends. And answer 1.8's "a deposit that identifies nothing" we read as a deposit spendable on
  anything at any time, like a voucher. Please confirm both readings.
- **Q8.** When a company's €1,000 advance is more than its €800 meal and the company agrees the
  venue keeps €200 as a tip: may a corrective remove €200 (−€181.82, −€18.18) from the advance's
  invoice and the €200 be treated as a tip outside VAT, though the customer did not leave it
  freely? And for the agreed price, is it right to leave VAT declared on the whole €1,000, the
  extra €200 at the advance's 10% (example 3)?
- **Q9.** After a no-show the corrective removes the €3.64 VAT on a €40 deposit, and the venue
  keeps the €40. The customer could ask for the €3.64 back, but the venue often does not know who
  the customer is, or the customer never asks. May the venue keep the €3.64 when nobody reclaims
  it, and must it do anything else?
- **Q10.** Is all dine-in consumption, drinks included, at 10%, with product rates applying only
  to takeaway? (No design here changes for it.)
- **Q11.** Withdrawn: the rest's invoice lists the dishes (owner, 21:00).
- **Q12.** Instead of 10% always, may an advance paid during the meal be charged at the mix of VAT
  rates on the bill so far, so that the rest's record never carries a negative line? (The owner
  keeps 10% and wants the adviser asked, 21:00.)

### Changed after the third fresh read (of `d0a9ecf759`)

- **What is filed changes** (ruling L1): the rest's record subtracts each advance's own filed base
  and VAT, so its base and VAT move by a few cents in four to seven bills in ten against the last
  revision; the totals do not ("Changes to what is sent to AEAT", item 2 and the paragraph after the list).
  Example 8 (seven dishes) is new and is tested in Tasks 1.2, 1.4a, 1.5 and 1.6a.
- **What is printed:** the advance line shows its number, date and amount only; the under-line
  label `advanceBaseAndVat` is gone. The line stores "Payment on account" and never a formatted
  number or date (L5); two such lines never merge (L6).
- **Find a bill** lists an advance ticket under its bill's table and zone (Task 1.3, L2).
- Tasks 1.6 and 4.1b are split (L3); `advance.exceeds_bill`'s till wording and route test move to
  Task 4.3 (L4); Task 1.0 sends three more records (L7); the builder changes are listed per task
  in a new section, "Pieces that touch the invoice builders" (L8); new tests for a whole credit
  and for deferred close with a till advance (L9).
- For you: a new question on giving back an advance after the table's invoice (L10); a till
  advance ticket being print-only is stated as an exception (L11).
- Adviser: Q3 rewritten to the subtraction and moved onto the sheet's question 12, in English and
  Spanish, with example 8; Q4 asks whether the number, date and amount are enough; the sheet's
  description of the table's ticket no longer prints the advance's base and VAT.
- Sizes: piece 1 and piece 4 estimates updated, and generated migration lines named.

### Changed after your 21:00 answers

- **What the rest's invoice prints:** the dishes, then each advance taken off by its number, date,
  amount, base and VAT, then what is left (Task 1.5 rewritten; examples 1, 2, 3, 4 and 6 give the
  printed form). The «Consumo en mesa 7» per-rate printing, its label and its catches are gone.
  What is filed with AEAT does not change against the last revision ("Changes to what is sent to
  AEAT").
- **Correct invoice** on the rest's invoice lists the dishes and never the line that takes an
  advance off (Task 1.6), matching the printed copy.
- The till's "own receipt" is in scope (Tasks 1.3, 1.7); 10% stands (Task 1.0, Q2, Q12).
- The 20:57 rule applied: "own receipt" defined as a ticket or full invoice, never a slip; Task
  1.3's slip test and Task 1.7's question rewritten so nothing relies on a slip; #3752's pointer
  moved to `ec647b65a5` and its rework.
- Adviser: Q1 returns (a full invoice taking off a ticket advance, and the reverse); Q4 and Q6
  reworded to the printed advance; Q11 withdrawn; the sheet's question 12 rewritten to match.
- "For the owner" questions: none left. Conflict 1 of the last revision (the owner's 20:30 words
  against an invoice that adds up) is settled and removed; the others are renumbered.

### Changed after the second fresh read (of `66b249bb2c`)

- Owner question 1 rewritten with correct costs: the per-rate printed invoice is the default (it
  keeps your words, and the dishes stay stored for reports); the dishes plus "Invoiced separately"
  is the alternative; each states its catches.
- Owner question 2 is new: Move dishes already gives the split for whole dishes (test run), and
  the till's amount-based advance could wait. Owner question 3 is new: charging a till advance at
  the bill's mix of rates, as an option.
- The old owner question 2 is answered ("yes it has begun") and recorded in the table.
- Q2, Q4 (with a corrected citation), Q6 and the new Q11 and Q12 go to the adviser on the sheet;
  the sheet's 18 November "Changed" note carries a dated pointer.
- Example 3 gains a mixed-rate case and says how the agreed price's cap falls across rates; the
  evidence for a €0.00 invoice and whether one prints are cited (Task 1.4a); "H2" explained.

### Changed after your 20:30 answers

- The model: each invoice stands alone (Architecture; owner question 1 for what the rest's invoice
  lists). The refusal to switch a bill holding an advance between ticket and full invoice, adviser
  Q1, conflicts 2, 6 and 9 of the last revision, and owner questions 1, 2, 6 and 7 of the last
  revision are gone.
- D3: the advance's payer chooses ticket or full invoice (piece 1b), the bill's customer filled in.
- Seating a booking no longer sets its bill to a full invoice.
- Adviser Q7 and the sheet's question 12 now ask the adviser to confirm your reading, not an open
  question; Q4 and Q6 are reworded to the rest's invoice.
- Task 1.0 and Q2 stay: the rest's record still takes the advance off rate by rate, so example 2
  still makes a negative 10% line. If the adviser confirms Q10, both go.
- The tip choice is held; the dashboard takes bank transfers only.

Earlier, after the fresh read of `d8381214af`: giving back a kept deposit's VAT on request (Task
5.2) and a transfer deposit on cancellation (Task 5.1) were designed; piece 2 was folded into piece
1; Tasks 1.4 and 4.1 were split; the A1308 "one way to pay" overlap was named; whether a payment is
an advance is decided by amount; the one-cent rule's cent comes off the largest line.

---

## Where the rules come from

Quoted, then paraphrased.

- **The owner's rule, 19 November (D1):** "a payment made before the meal begins should be an
  advance, a part payment after the meal has begun but before it has ended: if it needs a receipt,
  it is an advance, if it doesn't then it is just part payment" (`questions.md:296`), and at 20:30:
  "No, not once the meal has begun. We can take multiple payments towards the final bill. Each one
  doesn't need a receipt (unless they want one)" (`questions.md:376`).
- **Each invoice is its own kind (20:30), and the final one lists the advance (21:00):** "The
  advance is a receipt or an invoice by itself. The rest of the bill could be a receipt or an
  invoice in its own right" (`questions.md:377`); then "We are required to list whatever they
  ordered, which means that we need to mention the advance payment as well, to make it balance
  out" (`questions.md:432`), which replaces 20:30's "but it wouldn't mention the advance" for the
  final document.
- **Receipt required, payment slip optional (20:57):** "you seem to have confused payment slips
  (not required) with receipts (required)" (`questions.md:429`).
- **The adviser's answer 1.3 as recorded** (`2026-11-15-adviser-answers.md:121-125`): "Money paid
  *before the table has been fully served* is, for VAT, an **advance payment**. VAT is due on it the
  moment it is received (LIVA 75.Dos), so it needs a ticket of its own at that moment (RD 1619/2012
  art. 2.1). This applies when what the money pays for is clearly identified". The owner reads it
  as covering money paid before the meal begins (Q7).
- **The adviser's answer 1.8 as recorded** (`2026-11-15-adviser-answers.md:533-540`): "A deposit
  for an identified booking (date, number of guests, menu or price) is an advance payment and gets
  its own ticket. A deposit that identifies nothing is not. The final ticket shows the meal's total,
  the deposit's amount before VAT and its VAT, and what is left to pay; the record sent to AEAT
  carries only what is left." That document restates the adviser's answers "in our words". The
  owner's 21:00 answer agrees with its final ticket showing the deposit; Task 1.5 prints it (Q4).
- **The owner's decision, 18 November** (`2026-11-19-adviser-meeting.md:70-72`): "An advance's
  ticket reads «Pago a cuenta — consumo en mesa 7» at the eat-in rate. Waitron issues advances paid
  before the day too, on the booking; where the company can pay afterwards, the dinner is closed as
  a deferred payment instead (question 1)."
- **A €0.00 invoice.** AEAT's test service took an F2 with base, VAT and total 0.00 as `Correcto`
  (`docs/compliance/verifactu-findings.md:1402`, §19, run 39721604913; read, not run). Not tested
  anywhere: a €0.00 full invoice at AEAT, or a €0.00 record with lines of opposite sign except in
  the library's checks (the second fresh read ran `validate` on example 3's mixed case, accepted).
  Task 1.0 now sends both to AEAT's test service (ruling L7).
  On `main` a newly issued €0.00 invoice is queued to print like any other
  (`apps/server/src/bill-payments.ts:941`).
- **No-show** (`2026-11-19-adviser-meeting.md:160`, `:166`, `:67`): the owner's "yes we should
  issue the corrective", and "Waitron issues the corrective for a no-show's kept deposit by itself,
  at every venue (question 6)"; D8 settles that it takes the whole deposit to zero.
- **An advance's rate** (question 5, `:145`, `:152`): "A deposit keeps the rate of the day it was
  paid. *Is that right?*" — "correct".
- **AEAT's developer FAQ v1.3** (`docs/compliance/sources/FAQs-Desarrolladores-v1.3-2025-12-04.pdf`,
  read with `pdftotext` for the first revision, not reread), §20: «La forma en que se materialice el
  pago, incluyendo pagos anticipados que no hayan devengado una factura anterior, no forma parte de
  la factura misma». §29.2 is about an invoice registered with VAT not yet due, a different case
  (Q6).
- **A till cannot take money on a bill that comes to €0.00.** `previewAllocation` refuses
  `bill.nothing_outstanding` when nothing is available and caps a payment at what is
  (`apps/server/src/bill-allocation.ts:152-167`). RUN at `42e453075c` (file unchanged since), a
  throwaway Vitest file, deleted: a €30 cash contribution on a €0.00 bill was refused
  `bill.nothing_outstanding`; the control, the same payment on a €20.00 bill, was allocated €20.00
  with €10.00 change. It shows a bill with dishes can take money, not that the meal began.
- **A negative VAT line passes Waitron's copy of AEAT's checks.** RUN at `42e453075c`
  (`@waitron/verifactu` 0.2.1): an F2 built with `buildAltaRecord` and passed to `validate`, a 10%
  line of −27.27 and −2.73 beside a 21% line of 66.12 and 13.88, total 50.00, returned no issues.
  Control: the 10% VAT made +2.73 returned `S1_CUOTA_REPERCUTIDA_SIGN`. All-positive control: no
  issues. This is the library's model of AEAT's checks, not AEAT; Task 1.0 asks AEAT's test service.
- **VAT that rounds to €0.00 (D11).** RUN at `42e453075c`: every amount from −€200.00 to €200.00
  in cents at 21%, 10%, 4% and 0% (160,000 records), base by `baseFromGross`
  (`packages/menu/src/pricing.ts:83-86`) and VAT as the difference, checked with `validate`. Four
  were refused, all `S1_CUOTA_REPERCUTIDA_SIGN`: ±0.05 at 10% and ±0.13 at 4%. The one-cent splits
  (±0.04 + ±0.01 at 10%, ±0.12 + ±0.01 at 4%) returned no issues; control, 0.05 + 0.00 at 10%, was
  refused. The rule (`dist/validate.js:955-960`, `taxRoundsToZero` `:311-314`) does not apply to a
  corrective by differences or an R2/R3 (`:950`), and treats F1 and F2 alike. Such an invoice
  cannot be issued today: the chain turns the refusal into `fiscal.record_invalid`
  (`packages/fiscal-verifactu/src/chain.ts:207-222`).
- **How a record reaches AEAT's test service.** A mode of the `live-aeat.yml` workflow in the
  `waitron-io/verifactu` repository, dispatched from its `main` under the `aeat-preproduction`
  environment (`docs/compliance/aeat-four-behaviours-probe-handoff.md:74-81`). The R1 test that
  A1407 cites (`docs/backlog.md:1276`) was its mode `rejected-invoice-credit`, run 37286368370
  (`docs/superpowers/specs/2026-10-05-aeat-protocol-evidence.json:20547-20550`).

## The worked examples every test uses

All amounts in euros; "base" is the amount before VAT. "Printed" is the rest's invoice as Task 1.5
prints it (21:00).

1. **Simple.** Table 7, €120 of food at 10%. Ana pays €30 at 21:30 and wants her own receipt: advance
   ticket A/12, one line, base 27.27, VAT 2.73. The rest's ticket at 23:00: stored lines, the
   meal's dishes (base 109.09, VAT 10.91, total 120.00) and one line −30.00 (base −27.27, A/12's
   own) naming A/12; printed, the dishes (120.00), «Pago a cuenta n.º A/12, 19/11/2026» −30.00
   with nothing under it, TOTAL 90.00, VAT table 10% 81.82 / 8.18 / 90.00; record: 10% base 81.82,
   VAT 8.18, total 90.00 (109.09 − 27.27, 10.91 − 2.73). Payments on it: the €90 paid at 23:00 only;
   Ana's €30 is listed on A/12.
2. **Advance at 10%, bill mostly at 21%.** €20 at 10% (18.18 + 1.82) and €80 at 21% (66.12 +
   13.88); an advance of €50 (45.45 + 4.55). The rest's record: 10% −27.27 and −2.73 (18.18 −
   45.45, 1.82 − 4.55); 21% 66.12 and 13.88; total 50.00. Printed: the dishes (20.00 at 10%, 80.00
   at 21%), the advance −50.00 at 10%, TOTAL 50.00, and a VAT table whose 10% row is −27.27 /
   −2.73 / −30.00. With €50 of the wine removed before the meal ends, the rest's record is 10%
   −27.27 and −2.73, 21% 24.79 and 5.21, total 0.00 (Task 1.0 sends this one too).
3. **Advances worth more than the meal (piece 4).** A booking advance of €1,000 (909.09 + 90.91)
   at 10%. Issuing the rest's invoice is refused (`advance.exceeds_bill`) with the choices:
   (a) **give back** the difference, by a corrective of the advance, the money returned; (b)
   **agreed price**: no corrective, the difference stays on the advance's invoice. Under (b) the
   rest's invoice takes off credit only up to the meal's total, at the advance's own rate, so each
   rate keeps what is left of it, worked out from its gross (the part taken off has no filed base
   of its own), and prints «Pago a cuenta n.º F/3, 05/12/2026 (1000,00 €)»
   −800.00.
   - A meal of €800 at 10%: (a) corrective −181.82 and −18.18; the rest's record 0.00. (b) the
     rest's record 0.00. VAT over both records: (a) 72.73, (b) 90.91, the VAT on €1,000.
   - A meal of €800, €600 at 10% (545.45 + 54.55) and €200 at 21% (165.29 + 34.71): (a) the same
     corrective; the rest's record 10% −181.82 and −18.18, 21% 165.29 and 34.71, total 0.00. (b) the
     same rest's record. VAT over both records under (b): 90.91 − 18.18 + 34.71 = 107.44, which is
     the meal's own VAT (89.26) plus 10% on the extra €200 (18.18).
4. **Left without paying.** Example 1, but nobody pays the €90: the walkout ticket prints as in
   example 1, then «Pendiente: 90,00 €», and its record carries €90.
5. **A no-show.** A €40 deposit ticket (36.36 + 3.64); the booking is marked no-show; corrective
   R5 of −36.36 and −3.64, naming the deposit ticket. The accountant workbook's row for it shows
   kept 40.00 and VAT the customer could ask back 3.64; once given back on request, 0.00.
6. **What is left rounds to nothing (D11).** A €30.05 meal at 10% (27.32 + 2.73) and a €30.00
   advance (27.27 + 2.73). Subtracting gives base 0.05 and VAT 0.00, which AEAT's sign rule refuses
   (0.05 × 10% rounds to 0.01), so what is left is worked out from its gross: the rest's record
   carries 10% base 0.04, VAT 0.01, total 0.05, and the deduction line's stored base is −27.28
   (0.04 − 27.32), a cent off A/12's own. Printed: the dishes (30.05), the advance −30.00, TOTAL
   0.05, VAT table 0.04 / 0.01 / 0.05.
7. **A full-invoice advance (piece 1b).** Table 9, set for a ticket; Luis pays €300 and asks for a
   full invoice to Acme SL: F1 to Acme, 272.73 + 27.27. The rest's invoice is a ticket for what is
   left.
8. **Several dishes, where rounding differs (ruling L1).** Table 3: seven dishes of €1.05 at 10%,
   each on its own line (base 0.95, VAT 0.10 each; the meal's base 6.65, VAT 0.70, total 7.35). Bea
   pays €3.00 and wants her own receipt: advance ticket A/12, 2.73 + 0.27. The rest's record: 10%
   base 3.92, VAT 0.43, total 4.35 (6.65 − 2.73, 0.70 − 0.27); the deduction line stores −3.00 with
   base −2.73. Printed: the seven dishes (7.35), «Pago a cuenta n.º A/12, 19/11/2026» −3.00, TOTAL
   4.35, VAT table 10% 3.92 / 0.43 / 4.35. VAT over both records: 0.70, the meal's own. The
   previous revision (`d0a9ecf759`) would have filed 3.95 + 0.40 and printed base −2.70 under the
   advance. RUN in the sweep under "Changes to what is sent to AEAT": `validate` accepts the rest's
   record.

---

## Global Constraints

- Fiscal records are append-only; no piece rewrites a stored sale, line or record.
- `computeHuella`, `appendToChain`, `allocateInvoiceNumber` and `registros_facturacion`'s columns
  are unchanged outside piece 3, except piece 4's widening of the origin column's allowed values.
  `write-path.e2e.test.ts` (including "the source and device are inert to the huella", `:510`) and
  `inmutabilidad.test.ts` pass unedited; a failure there is a STOP for the owner.
- Pre-live: a schema change edits the TypeScript schema and reruns
  `migration-baseline rebuild --set <name>`; never a new migration or a hand edit. On a rebase
  conflict take main's copy and rerun the rebuild. The PR's first line says test venues are reset.
- New tables are classified, `appendOnly()` where a row never changes, listed in
  `scripts/write-path-tables.json`, with foreign keys declared in the TypeScript schema.
- Money is whole cents in columns and exact `Decimal` above them. A rate's base comes from its
  gross by `baseFromGross` and its VAT is gross − base, with D11's one-cent rule. The one
  exception is the rest's record at a rate an advance touches: the meal's base and VAT less each
  advance's own filed base and VAT, unless AEAT's sign rule would refuse that (ruling L1, Task
  1.2).
- Readers that sum an advance's correctives go through `correctivesOf` (`@waitron/db`).
- Words printed on an invoice live in the receipt labels (`packages/country/src/country.ts` keys,
  `packages/country-es/src/receipt-labels.ts` text); general code is English only.
- A refusal says what happened and what each choice does, with the next step offered in place.
- Receipt required, payment slip optional (owner, 20:57): every advance and every rest's invoice is
  printed, or emailed where a full invoice's payer chooses. A till advance ticket is printed only
  (ruling L11). No task
  prints a payment slip by itself, and no behaviour or test relies on one existing.
- Every implementer's verification includes `pnpm format:check` on changed files and the
  package's typecheck. An implementer past about 150 tool calls stops at a passing point, commits,
  and hands over.

## Review Focus

1. **A card advance is linked to its own sale and never again.** Both final-invoice paths link
   every received card payment to the final sale, and a second link throws
   `payment.already_associated` (Task 1.4b).
2. **Only a flagged payment that leaves something owed is an advance.** An unflagged one issues
   nothing (the pinned test stays unedited), and one that pays the bill off is part of the rest's
   invoice, even when that cannot be issued yet (Task 1.3).
3. **The rest's record subtracts each advance's own filed figures,** so the bases and VAT filed
   across the advance and the rest add up to the meal's, and falls back to working from the gross
   exactly where AEAT's sign rule would refuse the subtraction; a remainder of a few cents never
   produces a record AEAT's checks refuse (Task 1.2, which runs the real `validate` over meals of
   several dishes, not only one line).
4. **A bill whose advances equal its meal** still issues its €0.00 rest's invoice. Today
   `issueWhenFullyPaid` returns without issuing when the bill has no received payment
   (`apps/server/src/bill-payments.ts:794`) or its total is zero (`:807`) (Task 1.4a).
5. **A card captured, then recovered or attested,** issues its advance once:
   `bill_advances.bill_payment_id` is unique, the flag is stored on the payment row, and
   `completeBillPayment` is the one place (Task 1.3).
6. **Correcting the rest's invoice** never takes from the line that takes the advance off, is
   capped at what the invoice is worth, and a whole credit reverses every line (Task 1.6a).
7. **An advance given back through Correct invoice** stops counting as money on the bill (Task
   1.4b).
8. **D4's choices** leave the books adding up: VAT declared as in example 3, and the cash count
   counting the advance's money once (Task 4.3).
9. **The printed rest's invoice adds up and matches its record:** its lines (dishes and the lines
   taking advances off) sum to TOTAL, and its VAT table is the record's breakdown, checked on
   example 8 as well as the one-line examples (Task 1.5).
10. **An advance ticket is seen only within its bill's zones** in Find a bill and on every path
    that reads the same scope (Task 1.3).

---

## How the code works today (at `89cb892c8c`)

- **A part payment issues nothing,** pinned by "leaves €70.00 outstanding on a €120.00 bill,
  changes no line's price, and issues no invoice" (`apps/server/src/bill-payments-api.test.ts:822`,
  RUN, passed). Under D1 that stays true for a part payment nobody needs a receipt for; piece 1
  leaves the test unedited.
- **Payments are taken** by `takeBillPayment` (`bill-payments.ts:1470`; cash and hand-keyed card)
  and completed by `completeBillPayment` (`:1649`; a card at a reader, its recovery
  `bill-payments-loop.ts:130`, and a manager's answer `payments-api.ts:1562`, `:2025`). Both then
  call `issueWhenFullyPaid` (`:1515`, `:1729`), which returns nothing while a card is pending, a
  card refund is pending, or dishes are unsent (`:767-805`). A payment's retry is matched on
  `retryShapeOf` (`:1197`).
- **Card payments are linked to the sale that took them** by `linkCardBillPayments`
  (`bill-payments.ts:650-670`), called by `issueWhenFullyPaid` (`:839`, `:895`) and, through
  `linkBillCardPaymentsToSale` (`:673-684`), by `issueUnpaidInvoice` (`working-order.ts:7665`). It
  skips a payment already linked to this sale only (`:662`); `associatePaymentWithSale` throws
  `payment.already_associated` for one linked elsewhere (`packages/payments/src/store.ts:294-317`).
- **The final invoice is rated by `issueMoment`** (`apps/server/src/issue-moment.ts:19`) on five
  paths: `issueWhenFullyPaid` (`bill-payments.ts:859`), `priceForIssuance` (`working-order.ts:7594`,
  `:7605`; used by Print the bill `meal-end.ts:118`, left without paying `unpaid-departure.ts:115`,
  deferred close `deferred-close.ts:149`), and three whole-order till payments (`till-sale.ts:1126`,
  `:1871`, `:1995`), which refuse a bill holding any payment (`:837`, `:1363`, `:2375`) and which
  A1308's "one way to pay" retires (below). Each passes the meal's lines to `recordSale` through
  `withReceiptListPrices` (`receipt-lines.ts:90`), then `linkSaleDishes` (`order-portions.ts:311`).
- **`recordSale` takes a caller's VAT breakdown and total** (`packages/core/src/record-sale.ts:186`)
  and hands them to the fiscal backend (`:340`), which files `Desglose` from them
  (`packages/fiscal-verifactu/src/backend.ts:252`). The database refuses only a negative total on a
  sale that corrects nothing (`sales_total_ck`, `packages/db/src/schema/sales.ts:165`).
- **Sale lines are written in one place,** `saleLineRows`, from `RecordSaleLine`
  (`packages/core/src/sale-line.ts:5`). Copies field by field: `reversedLines`
  (`apps/server/src/cancel-credit.ts:81-113`) and `correctionLinesFor`
  (`packages/core/src/correction-history.ts:283-321`), both `satisfies Required<RecordSaleLine>`;
  `recordReplacement` copies every column (`packages/core/src/record-replacement.ts:191`);
  `transaction-receipt.ts:84` reads every line onto a reprint. Category sales read `sale_lines`
  (`packages/reporting/src/category-sales.ts:206`).
- **One sale per bill** (`sales_working_order_id_key`, `sales.ts:162`), so an advance carries no
  bill and is linked by `bill_advances`. **One tender per bill payment**
  (`tenders_bill_payment_key`, `sales.ts:333-335`). The cash count counts a tender that names a
  bill payment once, through the payment, and a tender without one under its sale's origin
  (`packages/reporting/src/cash-up.ts:87-118`). Cash removed from a drawer is entered by staff at
  the day's close as "payouts" (`packages/reporting/src/record-daily-close.ts:118`, `:155`).
- **Money on a bill** is each payment's applied money less its completed refunds (`moneyOf`,
  `bill-payments.ts:261-278`); `billsHoldingMoney` (`:519`) stops discarding or cancelling a bill
  (`working-order.ts:7505`, `:7773`), closing an emptied one (`parties.ts:870`), finishing the party
  (`finish-party-service.ts:324`) and deferred close (`deferred-close.ts:131`). A refund through
  **Correct invoice** writes `tender_refunds` (`tender-refund-reservation.ts:316-317`), which
  `moneyOf` does not read.
- **Before the invoice**, `refundBillPayment` (`bill-refunds.ts:650`) gives money back and files
  nothing. **After it**, Correct invoice files a corrective only for money given back through it
  (`fileCorrectionIn`, `invoice-corrections.ts:343-357`, refusing `invoice_correction.nothing_back`
  at `:355`), and only cash and card come back (`tender-refund-balance.ts:130`).
- **Correcting part of an invoice** reads its history (`readHistory`, `correction-history.ts:198`)
  and allocates through `remainingLines` (`correction-allocation.ts:166`), which refuses a negative
  line or rate (experiment for the first revision: example 1's final threw
  `sale.correction_history_unusable`; both files unchanged since, RUN). The writer checks again
  (`checkPartialCorrectionHistory`, `partial-correction-breakdown.ts:123`, from
  `record-correction.ts:248`); the correction is capped at what is left (`:190`).
- **A whole-invoice credit** reverses every line (`assertReversesLineForLine`,
  `record-correction.ts:362`), matches each rate's breakdown (`wholeInvoiceBreakdown`, `:412`), and
  is refused once any corrective exists (`:423`).
- **No full invoice can be corrected:** `requireSupportedCorrection` refuses a sale naming a
  customer (`packages/core/src/correction-eligibility.ts:5-8`); the corrective builder files R5 or
  R4 only (`backend.ts:571`).
- **The €3,000 ticket limit** is checked by `selectOrderInvoice` (`invoice-selection.ts:115-116`).
- **Sale origins.** `SALE_SOURCES` (`packages/shared/src/origin.ts:22-27`) lists device, demo seed,
  readiness test and operator script; "dashboard" is a known origin (`:11`) a sale may not carry.
  One column type (`packages/db/src/schema/origin.ts:8`) carries it to `sales` (`sales.ts:73`),
  `bill_payments` and their refunds (`bill-payments.ts:52`, `:163`), `invoice_corrections`
  (`invoice-corrections.ts:38`), `tender_refunds` (`tender-refunds.ts:41`), card payments
  (`packages/payments/src/schema/payments.ts:54`) and AEAT records
  (`packages/fiscal-verifactu/src/schema/registros.ts:34`).
- **Bookings** have their own migration set; statuses `booked | seated | completed | no_show |
  cancelled` (`packages/bookings/src/schema/bookings.ts:25`), no payment, no customer. `markNoShow`
  only moves the status (`bookings.ts:184-186`); `seatBooking` (`:196`) calls `core.seatTable`
  (`packages/module/src/module.ts:64-68`; bound at `apps/server/src/parties.ts:168-170`).
- **Emailing an invoice** goes through `reserveInvoiceDelivery`, which takes any sale and requires
  a full invoice only for paper (`apps/server/src/invoice-delivery.ts:45-57`).
- **The accountant workbook** (`renderAccountantWorkbook`, `apps/server/src/accountant-export.ts:84`)
  has an "Issued invoices" sheet whose rows include correctives (`invoiceType`, `:30`; column words
  `apps/server/src/i18n/accountant-export.ts:43`, Spanish `:126`).

## Other work on the same ground

- **A1308 "one way to pay"** (`docs/superpowers/plans/2026-11-19-a1308-one-way-to-pay.md`, lane
  H). PRs 1 and 2 are on `main` (#3822, #3843). PR 3 (save and pay), 4a (move test callers) and 4b
  (retire `/api/sales`, `/api/pay` and `/collect`) are cleared and expected to land **before**
  piece 1, which has not been approved. After 4b the three whole-order till paths in Task 1.4a are
  gone. If piece 1 lands first, it passes no advances to those three routes (they refuse a bill
  holding a payment) and 4b deletes them. Either way, the second to land reruns its final-invoice
  tests.
- **#3752** (receipts showing what is owed; payment slips), open at `ec647b65a5` and being
  reworked to the owner's 20:56 answers: a payment slip prints only when its payer asks, and the
  receipt lists every payment taken before it prints. Task 1.4b reads its `readUnsettledBill`
  (`receipt-payments.ts:137` there, not exported; only there) and Task 1.5 rebases over its
  receipt changes. Whatever slip choice the rework adds to the Pay window stays separate from the
  receipt question (Task 1.7).
- **ADVISER-CLOSE-OF-DAY-TICKET (#3847)** is ready for the owner and expected to land before piece
  1; the plan assumes it does. It adds the sale origin `business_day_close` to the list piece 4
  widens and rebuilds the same starting migrations; whichever lands second reruns the rebuilds.
  Conflict 3.
- **ADVISER-SPLIT-AFTER-PRINT** (landed as #3876; on 20 November this branch added the test that
  Reopen to split refuses a bill holding an advance, `bill.payments_received`, in
  `apps/server/src/split-after-print.test.ts`): splitting a bill after its invoice
  printed. Not the same as an advance (that comes before the invoice); it would reuse piece 1's
  share invoice if it splits by amount.
- **#3398** (LATER-SALE-DATE, being reworked) changes `issue-moment.ts`, `record-sale.ts` and the
  final-invoice paths. Whichever lands second puts the advances into the helper the final paths
  share. An advance's payment has its own invoice and date and must not date the rest's.
- **ADVISER-CORRECTIONS-REPORT** (planned, not on `main`) adds a corrections workbook; D8's
  alternative home.
- **A1308 os12/os13** (one refund mechanism) replace `bill-refunds.ts`; piece 1's refusal of a
  bill-payment refund for a payment with its own invoice moves with it. The A1308 table hold was
  lifted on 7 November (`docs/backlog/payments.md:156`).
- **A1515 set-menu bill** adds `sale_lines.set_menu_role` through the same line copies; whichever
  lands second reruns core's rebuild and carries both.

---

## Piece 1 (PR 1): an advance at the till, and the rest's invoice

**First line of the PR:** "Resets test venues: …" (core's starting migration is rebuilt).

**Why one pull request:** advance invoices without the rest's invoice taking them off would invoice
the same money twice; the second half alone would be code nothing reaches. The till's receipt
question is part of it, so it is never shipped with nothing to do.

**Landing:** fiscal; the owner lands it, after Task 1.0's answer. Does not wait for the adviser's
answer to Q7 (D9). Full review weight (a fiscal invariant, a migration, and core's correction code).

**Adds** (core's set): table `bill_advances`; columns `sale_lines.advance_role`,
`sale_lines.deducts_sale_id`, `bill_payments.own_receipt`.

**Builders touched:** Tasks 1.1, 1.2 and 1.6a; see "Pieces that touch the invoice builders".

**Size:** about 1,030 product lines and 2,250 test lines, plus about 30 lines of existing tests
that read the balance answer's shape, plus the regenerated starting migration of core's set, which
these estimates do not count: a recent core rebuild changed about 280 generated lines (#3819,
`0000_baseline.sql` +60, `0000_snapshot.json` +216, as the third fresh read counted). Estimates,
not measured. Against the last revision: Find a bill's scope and its tests (Task 1.3), the
subtraction and example 8's tests (Tasks 1.2, 1.4a, 1.5, 1.6a), the whole-credit and deferred-close
tests are added; `advance.exceeds_bill`'s till wording and route test move to piece 4. Each task
stays well under 100 steps; Task 1.6 is split into 1.6a and 1.6b for that reason. Task 1.5 touches
the server's receipt and the till's line type, so if it nears 100 calls its till half (the till's
`TillSaleLine` and screen) is split into a Task 1.5b.

### Task 1.0: the rest's records at AEAT's test service (before piece 1 lands; Q2)

Not Waitron code. In `waitron-io/verifactu`, add a mode to the `live-aeat.yml` workflow that sends,
in one run and one chain:
1. a first F2, the advance (45.45 + 4.55 at 10%), then a chained F2 carrying example 2's rest
   (10% −27.27 and −2.73; 21% 66.12 and 13.88; total 50.00);
2. example 2 again as full invoices: an F1 advance and an F1 rest with the same figures, each
   naming a test customer;
3. the €0.00 rest with lines of opposite sign that piece 1 can produce once dishes are removed
   (example 2 with €50 of the wine removed: 10% −27.27 and −2.73; 21% 24.79 and 5.21; total 0.00);
4. example 8's rest (10% base 3.92, VAT 0.43, total 4.35), whose VAT is 4 cents from its base
   times the rate, and as its control the same meal's own record as Waitron files one today (6.65
   and 0.70, 3 cents from 6.65 × 10%);
5. a control with positive lines only.

Records 1 to 3 are dropped if the adviser confirms Q10 first; record 4 is not, since it does not
depend on a second rate. Review and merge the mode to that repository's `main`, then
`gh workflow run live-aeat.yml --repo waitron-io/verifactu --ref main -f mode=<the new mode>`,
under the `aeat-preproduction` environment, as for run 37286368370. Record the run id, head and
each record's `EstadoRegistro` in `docs/compliance/` and on Q2 and Q3. Every rest's record
`Correcto`: piece 1 may land. Any `Incorrecto` while the positive control is `Correcto`: STOP for
the owner; piece 1 does not land. Example 8's control `Incorrecto` as well would mean records filed
today are refused: STOP for the owner at once.

### Task 1.1: the tables, the columns, and every line copy

**Files:**
- Create: `packages/db/src/schema/bill-advances.ts` and its test
- Modify: `packages/db/src/schema/sales.ts` (`saleLines`), `packages/db/src/schema/bill-payments.ts`
  (`ownReceipt`, default false), `packages/db/src/schema/index.ts`,
  `packages/db/src/classification.ts`, `scripts/write-path-tables.json`,
  `packages/migrations/migrations.manifest.json`, core's starting migration (rebuilt);
  `packages/core/src/sale-line.ts`, `sale-line-rows.ts`, `correction-history.ts`
  (`correctionLinesFor`), `apps/server/src/cancel-credit.ts` (`reversedLines`)
- Test: `bill-advances.test.ts`, `packages/core/src/sale-line-rows.test.ts`,
  `apps/server/src/cancel-credit.test.ts`

**Interfaces:**
- `billAdvances`: `id`, `working_order_id` (FK, restrict), `advance_sale_id` (FK `sales`, restrict,
  unique), `bill_payment_id` (FK, restrict, not null, unique),
  `created_at`; and, added on 21 November in the branch's review, `order_label` (nullable), the
  ticket's heading as it read when the advance was issued. `appendOnly()`, classified `ledger`.
- `sale_lines.advance_role` (`'payment_on_account' | 'deduction'`, nullable) and
  `sale_lines.deducts_sale_id` (FK `sales`, nullable), CHECK
  `(advance_role is 'deduction') = (deducts_sale_id is not null)`. A `deduction` line is the stored
  line that takes an advance off the rest's invoice.
- Carried by `saleLineRows`, `reversedLines` (a whole credit reverses a deduction line with its
  role and sale) and `correctionLinesFor` (a partial corrective of an advance keeps
  `payment_on_account`); `recordReplacement` already copies every column.

**Builders touched (for the owner's approval):** `saleLineRows`, shared by `recordSale`,
`recordCorrection` and `recordSubstitution`, writes the two new columns; `correctionLinesFor` and
`reversedLines` copy them. No figure any builder files changes in this task.

- [ ] **Step 1: Failing tests:** "refuses a second advance for the same bill payment" (the
  constraint's name); "refuses an update and a delete"; "a deduction line must name the sale it
  deducts, and only a deduction line may" (both directions; neither passes); "writes a line's
  advance role and the sale it deducts"; "a whole credit of a rest's invoice reverses its
  deduction line, role and sale included".
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3:** schema, classification, list, `pnpm --filter @waitron/db exec migration-baseline
  rebuild --set core`; carry the fields.
- [ ] **Step 4: Run** the tests and the guards: `scripts/schema-constraints.test.ts`,
  `append-only-triggers.test.ts`, `append-only-migration-sets.test.ts`,
  `classification-complete.test.ts`, `starting-migrations.test.ts`, `behavioural-triggers.test.ts`,
  `write-path-tables.test.ts`, `two-file-foreign-keys.test.ts`, and the fiscal pair
  (`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`)
  unedited. Expected: PASS.
- [ ] **Step 5: Commit** (`git commit -s`).

### Task 1.2: what the rest's invoice carries, and the one-cent rule on every invoice (D11)

**Files:** create `apps/server/src/advance-deduction.ts` and its test; modify
`packages/menu/src/pricing.ts` (`splitGross` beside `baseFromGross`; `rateLines` uses it) and
`pricing.test.ts`.

**Interfaces:**
- `splitGross(gross, rate): { base; tax }` — `base = baseFromGross(gross, rate)`, `tax = gross −
  base`; when `tax` is 0.00, `base` is not, and `base × rate` does not round to 0.00, one cent of
  `gross`'s sign moves from `base` to `tax`. `rateLines` applies it to each rate's group and takes
  the cent off the line at that rate with the largest base (the last such line on a tie), so no
  €0.00 line goes to −0.01.
- `AdvanceCredit { saleId; invoiceNumber; issuedAt; groups: { rate; base; tax }[]; gross }` (the
  advance plus its correctives).
- `deductAdvances(priced, advances, { languages }): { priced; deductionLines }` — unchanged
  `priced` and no lines when there is no credit. Otherwise, per rate `r` an advance touches
  (ruling L1):
  - **Subtract the advances' own figures:** `left_base[r] = meal_base[r] − Σ advance base at r`
    and `left_tax[r] = meal_tax[r] − Σ advance tax at r`, where `meal_base[r]` and `meal_tax[r]`
    are `priced.vatBreakdown`'s (the sum of the dishes' bases, and gross less that) and each
    advance's base and tax are its `AdvanceCredit.groups` (its record plus its correctives). Each
    advance's deduction line at `r` has `lineGross` −(its gross at r) and `lineTotal` −(its base
    at r).
  - **Fall back where AEAT's sign rule would refuse it:** when `left_tax[r]` is 0.00 and
    `left_base[r] × r` does not round to 0.00, or `left_base[r]` is 0.00 and `left_tax[r]` is not,
    or the two are non-zero with opposite signs (the rule at `@waitron/verifactu`
    `dist/validate.js:955-959`, written as one exported predicate beside `splitGross` with its own
    tests, not imported from the library), use `left_gross[r] = meal_gross[r] − Σ advance gross at
    r` and `left_base, left_tax = splitGross(left_gross[r], r)` instead; the last deduction line
    at `r` takes the difference, so its `lineTotal = left_base[r] − Σ meal line bases at r − Σ the
    other deduction lines' bases at r`.
  - Either way each rate's line bases equal its breakdown base and its line grosses equal base
    plus VAT, which a whole credit checks (`record-correction.ts:412-465`); the total is the meal
    less the credit.
  - One deduction line per advance and rate (`advanceRole: "deduction"`, `deductsSaleId`,
    quantity 1, `lineGross` −gross), numbered after the meal's last line; the caller appends them
    after `withReceiptListPrices` and `linkSaleDishes`. **What it stores as text (ruling L5):**
    `name` "Payment on account" (no number or date), `descriptions` the same label's words in
    each of the sale's invoice languages (es «Pago a cuenta»), `category` null. The stored words
    come from a separate receipt label, `paymentOnAccount`, which holds the words only (its
    Catalan, Galician and Basque words are not yet confirmed by a native speaker); Task 1.5's
    printed caption builds on it rather than repeating the words. Nothing formatted is stored: the
    number and date are read through `deducts_sale_id` when the invoice is printed (Task 1.5).
  - Throws `advance.exceeds_bill { mealTotal, advances }` when the total left is below zero.
    Piece 1 cannot reach it through any route (ruling L4): every route that
    lowers the meal checks the bill first (`assertBillInvariant` at `adjustments-apply.ts:1433`,
    `bill-actions.ts:366`, `table-actions.ts:431`, `set-menu-count.ts:146`, `working-order.ts:3324`,
    `:3344`, `:3411`, `:7066`; grep, RUN), Task 1.4b makes that check count advances, and a payment
    that pays the bill off is never an advance. It stays as a guard with a unit test; its till
    wording and route test come with piece 4's booking advances (Task 4.3).

**Builders touched (for the owner's approval):** `rateLines`, which works out every invoice's VAT,
gains the one-cent rule; `deductAdvances` works out the rest's figures that `recordSale` files.

- [ ] **Step 1: Failing tests:** examples 1, 2, 6 and 8 (breakdown, total, deduction lines with
  their base); "example 8 subtracts the advance's own base and VAT: 3.92 and 0.43, not 3.95 and
  0.40"; "example 6 falls back to the gross: 0.04 and 0.01, deduction base −27.28"; "advances equal
  to the meal file 0.00 at every rate" (including a meal whose subtraction leaves a base and VAT
  of opposite signs; find one with the sweep below); "two advances at one rate each take off their
  own base; on a fallback the last one takes the difference"; "a corrected advance takes off what
  is left of it"; "advances worth more than the meal throw advance.exceeds_bill" (unit only); "every
  rest passes AEAT's checks, and the bases filed across advance and rest add up to the meal's
  wherever the subtraction is used" (`buildAltaRecord` and `validate` from `@waitron/verifactu`
  over seeded random meals of 1 to 15 dishes of €1.05 to €22.00 at 10%, and of mixed 10% and 21%
  dishes, each with an advance from €0.01 up to the meal; over every remainder from −€0.60 to
  €0.60 against such meals; every advance €0.01–€200.00 at 10%; and example 2. Controls, so it can
  fail: the subtraction without the fallback is refused by `validate` in some of the sweep's
  meals, and the previous revision's method files a different base from the subtraction in some);
  "the sign-rule predicate agrees with `validate` on every refusal the sweep finds"; "each rate's
  line bases equal its breakdown base and its line grosses its base plus VAT"; "no advances
  returns the priced lines unchanged" (`toBe`); "a deduction line stores Payment on account, the
  Spanish words, and no number or date". In `pricing.test.ts`: "a lone €0.05 item at 10% rates
  0.04 + 0.01", "€0.13 at 4% rates 0.12 + 0.01", "the cent comes off the largest line, never a
  €0.00 line" (a €0.05 line beside a €0.00 line at 10%), "every other amount rates as before".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/advance-deduction.test.ts`
  and `pnpm --filter @waitron/menu exec vitest run src/pricing.test.ts`. Expected: FAIL.
- [ ] **Step 3:** implement; register `advance.exceeds_bill` in `apps/server/src/errors.ts`.
- [ ] **Step 4: Run** them, `scripts/errors-reachable.test.ts`, `scripts/english-only.test.ts`,
  the fiscal pair unedited.
- [ ] **Step 5: Commit.**

### Task 1.3: a part payment whose payer wants their own receipt issues its own ticket

**Files:** create `apps/server/src/bill-advances.ts` and its test; modify
`apps/server/src/bill-payments.ts` (`beginBillPayment` `:1348` stores `ownReceipt`, `retryShapeOf`
includes it, `takeBillPayment`, `completeBillPayment`), `apps/server/src/bill-payments-api.ts`
(request schema), `packages/shared/src/menu-document/vat-rates.ts` (`ADVANCE_VAT_CLASS =
"reduced"`, D2), receipt labels (`paymentOnAccountAtTable`: es «Pago a cuenta — consumo en mesa {table}», en "Payment on account — meal at table {table}"; `paymentOnAccountForOrder`, for a bill with no table: es «Pago a cuenta — consumo en pedido {number}», en "Payment on account — order {number}"), `apps/server/src/find-bill-transactions.ts`
(`scopeRelation`, ruling L2).

**Interfaces:**
- `issueAdvance(tx, deps, cfg, payment, printers): Promise<{ saleId }>` (as built,
  `apps/server/src/bill-advances.ts:59-65`). Rates one line of `applied` at `ADVANCE_VAT_CLASS`
  on the payment's local day through `rateLines`; live `standard` series; `recordSale` with
  deferred settlement, then `settleSale` with one tender (applied + tip, `tipAmount`,
  `billPaymentId`), as `bill-payments.ts:812-822` builds tenders; inserts `bill_advances`; links a
  card payment to the advance sale; queues the ticket on the device's receipt printer. It is never
  emailed (ruling L11, an exception: `invoice-delivery.ts:45-57` can email any ticket); a copy is
  printed again from Find a bill. Piece 1b adds a full-invoice choice (`{ kind: "full", counterparty }`).
- **The advance ticket belongs to its bill's table and zone (ruling L2).** Without this an
  advance's sale, having no bill of its own, would belong to no table: Find a bill takes both its
  table names and its zone check from `scope_orders`, which joins only `sales.working_order_id`
  (`find-bill-transactions.ts:15-28`, READ), and its zone condition is true for a sale with no
  orders (`:30-34`), so every zone-limited device would list every zone's advances, and a search
  by table would never find one. `scopeRelation`'s `scope_orders` gains the advance's bill:
  `union select g.sale_id, ba.working_order_id from invoice_scope g join bill_advances ba on
  ba.advance_sale_id = g.source_sale_id`, so an advance and its correctives carry its bill's
  table, zone and order label. Trace every reader of that scope before changing it:
  `findTransactionsRelation` (the list and its search), `resolveTransactionScope` (`:180`), and the
  files that call it, `transaction-receipt.ts` (the duplicate's table label, `:124-130`),
  `tender-refund-api.ts`, `tender-refund-authorization.ts`, `tender-refund-balance.ts`,
  `tender-refund-reservation.ts`, `tender-refund-receipt.ts`, `transaction-receipt-api.ts` and
  `document-printer-offers.ts` (grep, RUN). The advance ticket prints its bill's order label and
  number when first printed, so a duplicate matches it.
- `readBillAdvances(tx, workingOrderIds).credits` — each bill's advances with correctives through
  `correctivesOf`.
- **Decided by amount:** a received payment whose row says `own_receipt` is an advance when the
  bill had no invoice before it and, after it, the meal less advance credit less the received money
  of payments with no advance is still above zero. A flagged payment that pays the bill off is never
  an advance, even when the rest's invoice cannot be issued yet (a card or refund pending, dishes
  unsent); it waits for it as today. Called after `issueWhenFullyPaid` in `takeBillPayment`
  (`:1515`) and `completeBillPayment` (`:1729`), in the same transaction, so a failure rolls the
  payment back.
- `ownReceipt: true` on a bill set for a full invoice is refused with
  `advance.full_invoice_unsupported` until piece 1b (the till does not ask there).

- [ ] **Step 1: Failing tests** (real routes, `useVenueDb`): "a €30 cash payment that needs a
  receipt, on a €120 bill, issues an advance ticket with one line at 10%" (no bill on the sale, one
  `payment_on_account` line 27.27/30.00, «Pago a cuenta — consumo en mesa 7», breakdown
  27.27/2.73, one tender naming the payment, one `bill_advances` row, one F2 record, one print
  job); "the tip is on its tender, not its ticket"; "a payment that does not need a receipt issues
  nothing" (cash and card); "a flagged payment that pays the bill off is part of the rest's
  invoice"; "a flagged payment that pays the bill off while dishes are unsent is not an advance"; "a
  flagged payment taken while another card is pending is still an advance when something is left";
  "a flagged card captured, then recovered, issues its advance once"; "a tip-only payment issues no
  advance"; "after the invoice a flagged payment issues no advance and prints no ticket" (whether a
  payment slip prints is #3752's choice, not asserted here); "a flagged payment prints its advance
  ticket and no payment slip unless one is asked for"; "while the box waits for its time to be
  confirmed, the payment is refused"; "Find a bill lists the advance under table 7, and a search
  for table 7 finds it"; "a device limited to another zone does not see the advance, and one
  limited to table 7's zone does" (as `find-bill-transactions.test.ts:501` tests a corrective's
  zones); "a duplicate of the advance ticket prints as the original, with table 7"; "a correction
  of the advance keeps table 7's zone"; "the day's cash count counts an advance's cash once"
  (`computeDailyClose`); "a flagged payment on a bill set for a full invoice is refused with
  advance.full_invoice_unsupported"; "a retry with a different ownReceipt is a different request".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/bill-advances.test.ts src/bill-payments-api.test.ts`.
  Expected: new tests FAIL; the pinned test at `bill-payments-api.test.ts:822` still PASSES,
  unedited.
- [ ] **Step 3:** implement. **Step 4:** run them, `src/bill-payments*.test.ts`,
  `src/find-bill*.test.ts`, `src/transaction-receipt*.test.ts`, `src/tender-refund*.test.ts`,
  `src/document-printer-offers.test.ts`, `scripts/english-only.test.ts`. **Step 5:** commit.

### Task 1.4a: every path that issues the bill's invoice takes the advances off

**Files:** `apps/server/src/issue-moment.ts` (`issueMoment` takes `advances` and returns the
deduction lines), its callers and their `recordSale` calls (`bill-payments.ts:859`,
`working-order.ts:7605`, and, if A1308 4b has not landed, `till-sale.ts:1126`, `:1871`, `:1995`,
which pass `[]`); `bill-payments.ts` (`issueWhenFullyPaid`'s received and zero checks `:794`,
`:807`, `:811`; `tendersOfBill` `:812`); `invoice-selection.ts` (the limit takes the meal's total).
Test: `apps/server/src/advance-final.test.ts`.

- `issueWhenFullyPaid` issues when advance credit plus other received money equals the meal, or
  advance credit alone does (a €0.00 rest's invoice); settlement takes only payments with no
  advance. The rest's invoice is a ticket or a full invoice as the bill is set, whatever the
  advances were. A €0.00 rest's invoice is issued, filed and printed like any other (it is queued
  at `bill-payments.ts:941`), so the guests leave with a ticket for the meal even when advances
  paid for all of it.
- [ ] **Step 1: Failing tests:** example 1 by the last payment (stored total, breakdown, record's
  `ImporteTotal` and `CuotaTotal`, deduction line naming the advance, the €90 as the only tender);
  example 1 by Print the bill, then paid; example 8 by the last payment (record 3.92 and 0.43,
  deduction line base −2.73, and the advance's and the rest's record bases summing to the meal's
  6.65); example 4; "advances equal to the meal issue and print a €0.00 rest's invoice", once at
  one rate and once as example 2 with €50 of the wine removed (10% −27.27/−2.73, 21% 24.79/5.21);
  example 2 through the route; "a bill set for a full invoice takes off an advance ticket" (F1
  rest, F2 advance); "the ticket limit checks the meal, not what is left"; example 6; "deferred
  close takes off a till advance" (ruling L9: example 1's €30 advance, then the bill closed as a
  deferred payment through `priceForIssuance`; its record carries 81.82 and 8.18 and €90 is owed).
  The route test for `advance.exceeds_bill` is in Task 4.3 (ruling L4).
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3:** implement.
- [ ] **Step 4: Run** the file, `src/meal-end*.test.ts`, `src/unpaid-departure*.test.ts`,
  `src/deferred-close*.test.ts`, `src/till-sale*.test.ts`, the fiscal pair unedited. **Step 5:**
  commit.

### Task 1.4b: money and cards around an advance

**Files:** `bill-payments.ts` (`moneyOf` `:261`, `fundsOf` callers, `stillOwedOnIssuedBill` `:505`,
`assertBillInvariant` `:467`, `linkCardBillPayments` `:650`, `readBillBalance` `:716`);
`working-order.ts` (`issueUnpaidInvoice`); `receipt-payments.ts` (`readUnsettledBill`, #3752);
`sale-due.ts`. Test: `apps/server/src/advance-money.test.ts`.

**Interfaces:**
- **Cards are linked once:** `linkCardBillPayments` skips a payment with a `bill_advances` row.
  Both final paths reach it, so one skip covers Print the bill, left without paying, deferred
  close, the end-of-day job and the last payment. Without it a card advance makes every later
  rest's invoice on that bill throw `payment.already_associated`, and when the rest's invoice is
  the reader's own capture, `completeBillPayment` throws inside the recovery loop, which I believe
  retries it on every pass (READ, not run).
- **Money on a bill:** a payment with an advance counts by what is left of the advance (its total
  plus correctives) and its tip less the tips of completed `tender_refunds` against its tender. So
  an advance given back through Correct invoice stops holding money.
- **Balance:** before the rest's invoice, owed = meal − advance credit − received (payments with no
  advance) − reserved; after it, its amount due − received (payments with no advance).
  `readBillBalance` keeps its shape: `total` is the meal and `received` includes the advance credit.

- [ ] **Step 1: Failing tests:** "the bill invariant counts an advance by what is left of it"
  (advance corrected by €10: removing €10 of dishes allowed, €11 refused
  `bill.received_exceeds_total`); "card advance, then card payment of the rest"; "card advance,
  then Print the bill"; "advance refunded by Correct invoice, then the emptied bill closes" (without
  the `moneyOf` change: `bill.payments_received`); "switching the bill between ticket and full
  invoice after an advance is allowed and changes only the rest's invoice"; "the end-of-day job
  takes a till advance off" (#3847 on `main`).
- [ ] **Steps 2–5:** run, implement, run with `src/bill-payments*.test.ts`, `src/parties*.test.ts`,
  `src/close-of-day*.test.ts`, the fiscal pair unedited; commit.

### Task 1.5: what the rest's invoice prints (owner, 21:00; ruling L1)

**Files:** `apps/server/src/till-sale.ts` (`TillSaleLine` `:265` gains `advance?: { invoiceNumber;
issuedOn }` on a deduction line), the code that builds a sale's receipt lines on the
final paths and on a reprint (`transaction-receipt.ts:84-90`, which reads every stored line and
works out each line's gross with `receiptGrosses`), `receipt-document.ts` (lines block `:450-463`;
a deduction line never merges in `mergeIdenticalGroups`, `receipt-lines.ts:148`),
`invoice-document.ts` (A4); receipt label `advanceTakenOff` (es «Pago a cuenta n.º {number},
{date}», en "Payment on account no. {number}, {date}"; built on Task 1.2's label
`paymentOnAccount`, the words it stores, so the words live in one place); the till's `TillSaleLine` (`apps/till/src/api/client.ts:1003`) and any till
screen that lists a sale's lines (grep it in `apps/till/src`). Test:
`apps/server/src/receipt-advances.test.ts`, and the till screen's own test if one lists lines.

- A sale with deduction lines prints its dishes exactly as today, then each deduction line as
  «Pago a cuenta n.º A/12, 19/11/2026» with its amount (negative; with its rate letter on a
  ticket, as every line has; on a full invoice its stored base in the base column, as every line
  there has). Nothing is printed under it: no base and no VAT (ruling L1). Then **TOTAL**, the
  VAT table, and the payments and any amount owed as #3752 prints them. The lines sum to TOTAL. A
  sale with no deduction lines prints exactly as today. An advance's own invoice prints like any ticket.
- **The VAT table is the rest's own record.** It is the sale's stored breakdown, which is what was
  filed (`receipt-document.ts:467-503` prints it today), so the paper and the record cannot differ.
- The number is the advance's series and number as printed on its own ticket; the date is its
  issue date in the venue's time zone. Both are read through `deducts_sale_id` when printing, never
  from the stored line text (ruling L5).
- **Never merge (ruling L6).** Two deduction lines at one rate with the same amount store the same
  words and amount, so `mergeIdenticalGroups` would print them as one. The third fresh read's
  throwaway test through `formatReceipt` printed two such lines as "2  Pago a cuenta  -60,00" with
  "-30,00 € por unidad" (`fresh-read-d0a9ecf759.md`, Minor 3); the same test showed a single
  negative line and a negative VAT row printing correctly ("1  Pago a cuenta  -50,00 A" and "A 10%
  -27,27  -2,73  -30,00").
- **Other screens that read the stored line (ruling L5).** The dashboard's Orders list shows a
  bill's lines from the bill itself (`readBillLines`, `orders-list.ts:820`), so the table's row
  lists its dishes and its invoice's €90 total, and no deduction line. An advance ticket, a sale
  with no bill, is listed as a row of its own (`orders-list.ts:190-202`), whose line reads its
  stored name, "Payment on account — meal at table 7". Where sale lines are read straight from
  `sale_lines` (`readSaleLines`, `orders-list.ts:953`, for a sale with no bill), a deduction line
  would read "Payment on account" and −30.00. The dashboard's live queries name `sale_lines` only
  as a table whose change refreshes a view (`apps/dashboard/src/api/live-queries.ts:151`, READ).
- [ ] **Step 1: Failing tests:** example 1 prints its dishes, the A/12 line −30.00 with nothing
  under it, TOTAL 90.00 and VAT table 81.82 / 8.18; example 8 prints seven dishes, the A/12 line
  −3.00, TOTAL 4.35 and VAT table 3.92 / 0.43 / 4.35, and that table equals the record's `Desglose`
  (ruling L1: the one-line examples cannot show a rounding difference); example 2 (the 10% VAT row
  negative); example 6; the A4 full invoice of example 1 (line
  base −27.27 and Base imponible 10% 81.82) and of example 8 (line base −2.73, Base imponible 10%
  3.92); "the lines sum to TOTAL and the VAT table equals the record" over examples 1, 2, 6 and 8;
  a duplicate prints the same as the original; two advances of the same amount print two lines
  and never merge; "no base or VAT is printed under an advance line"; a bill with no advance prints
  exactly as before (an existing receipt test, unedited); an advance ticket. Then write example
  1's and example 8's Spanish tickets to files and open them in the workspace's Playwright
  Chromium, phone width, both themes.
- [ ] **Steps 2–5:** run, implement, run with `src/receipt-*.test.ts`,
  `src/invoice-document*.test.ts`, `src/transaction-receipt*.test.ts`, `src/orders-list*.test.ts`,
  `scripts/english-only.test.ts`; commit.

### Task 1.6a: correction history and the refund refusal

**Files:** `bill-refunds.ts` (`refundBillPayment`), `packages/core/src/correction-history.ts`
(`readHistory`, `readCorrectableLines`), `partial-correction-breakdown.ts`
(`checkPartialCorrectionHistory`); tests beside each and `apps/server/src/advance-corrections.test.ts`.

**Builders touched (for the owner's approval):** `readHistory`, `readCorrectableLines` and
`checkPartialCorrectionHistory`, which `recordCorrection` checks before it files a partial
corrective, learn the line that takes an advance off. `recordCorrection` itself does not change.

- `refundBillPayment` refuses a payment with an advance: `bill.refund_of_advance { paymentId,
  saleId, invoiceNumber }`.
- For a sale with deduction lines, `readHistory` hands the allocator the meal's lines only, and
  each deduction as an earlier correction already taken at its rate, spread from the last line
  back, never more than the meal holds at that rate; `checkPartialCorrectionHistory` checks the
  same view. A rate an advance more than covers has nothing to correct; the whole correction stays
  capped by `sale.correction_exceeds_total` (`record-correction.ts:190`).
- **A whole credit still works (ruling L9).** A whole credit reverses every line, the deduction
  line too, and matches the rest's breakdown rate by rate (`wholeInvoiceBreakdown`,
  `record-correction.ts:412-465`). Its refusal once a corrective exists counts filed correctives
  only (`correctionCount`, `:146`, `select count(*) from sales c where c.corrects_sale_id = …`), so
  the deductions `readHistory` presents as earlier corrections must not send a whole credit down
  the partial path instead.
- **Correct invoice** on the rest's invoice lists the dishes only: `readCorrectableLines`
  (`packages/core/src/correction-history.ts:75`), which builds the dialog's lines from
  `readHistory`'s lines, then never offers the line that takes an advance off.
- [ ] **Step 1: Failing tests:** the refusal; "correcting the rest's invoice never takes from its
  deduction line" (example 1, €10: −9.09/−0.91; the preview shows what the writer files); example 8
  (one €1.05 dish: −0.95/−0.10; five dishes, €5.25, more than the rest's €4.35, are refused with
  `sale.correction_exceeds_total`); example 2 (10% has nothing left; €50 at 21% files −41.32/−8.68); "a
  whole credit of the rest's invoice files a whole credit and reverses every line, the deduction
  line included" (example 1: −81.82/−8.18; example 8: −3.92/−0.43; `assertReversesLineForLine`
  and `wholeInvoiceBreakdown` pass); "a refund larger than the rest's invoice is refused, and the
  whole of the rest's invoice can be corrected" (correcting the advance itself is refused once the
  rest's invoice took it off: owner, 20 November, 14:26; 2026-11-21: replaced by [the refund-after-final plan](2026-11-21-advance-refund-after-final.md).); "correcting an advance before the meal ends
  reduces what the rest's invoice takes off"; "an item advance corrected to zero frees its lines";
  "the correction lines of a rest's invoice list its dishes and not the advance's line"
  (`GET /api/transactions/:saleId/corrections/lines`).
- [ ] **Steps 2–5:** run, implement, run with
  `pnpm --filter @waitron/core exec vitest run src/correction-allocation.test.ts src/partial-correction-breakdown.test.ts src/record-correction.test.ts`,
  `src/bill-refund*.test.ts`, the fiscal pair unedited; commit.

### Task 1.6b: reports count the dishes once

**Files:** `packages/reporting/src/category-sales.ts`, `top-sellers.ts`, `bill-payments.ts`
(`paidQuantitiesOf`, left unchanged); tests beside each.

- Category sales and top sellers leave out lines with either role, so the dishes count once and
  neither an advance's line nor a deduction line appears as a product. (2026-11-21, category sales
  only, top sellers unchanged: replaced by [the refund-after-final plan](2026-11-21-advance-refund-after-final.md).) `paidQuantitiesOf` (`apps/server/src/bill-payments.ts:471`) is left
  unchanged: advance and deduction lines never reach it, since its lines come only from the bill's
  own dish lines. Task 1.6b's reviewer ran it on b73e75b18f, through the till's routes: a bill with an
  advance for two of its dishes listed only those two dish lines, before and after the rest's
  invoice, never the advance's or the deduction's line.
- [ ] **Step 1: Failing tests:** "category sales count example 1's dishes once and leave out the
  advance's line and the deduction line"; the same for top sellers.
- [ ] **Steps 2–5:** run, implement, run with `scripts/corrective-sums.test.ts` and the reporting
  suites; commit.

### Task 1.7: the till: the receipt question, and Refund opens Correct invoice

**Files:** `apps/till/src/widgets/bill-pay-dialog.ts`, `bill-refund-dialog.ts`,
`apps/till/src/i18n/strings.ts` and `codes.ts` (the question; wording for
`bill.refund_of_advance` and `advance.full_invoice_unsupported`; `advance.exceeds_bill`'s wording
comes with Task 4.3, ruling L4), the till's bill-payment request type
(`ownReceipt?: true`); `bill-payments.ts` (`toView` `:609`: `BillPaymentView` gains `hasTicket`
and the advance's `saleId`); tests in `bill-pay-dialog.test.ts`, `bill-pay-dialog.a11y.test.ts`,
`bill-refund-dialog.test.ts`.

- The question reads **Does this payer want their own receipt for this amount?** (es «¿Quiere
  quien paga su propio ticket por este importe?»), with **Yes — a ticket of its own; the table's
  receipt takes it off** (es «Sí — un ticket propio; el ticket de la mesa lo descuenta») and **No —
  it is listed on the table's receipt** (es «No — figura en el ticket de la mesa»); the till's
  Spanish strings say "ticket" (`grep -c ticket apps/till/src/i18n/*.ts`). It never says
  "slip". If #3752's rework has added a payment-slip choice to the Pay window by then, the two sit
  apart and neither answer sets the other.
- [ ] **Step 1: Failing tests:** on a bill with no invoice, set for a ticket, **An amount**,
  **Split equally** and **Items** ask the question with neither answer chosen; **Yes** sends
  `ownReceipt: true`, **No** sends without it; answering it changes no payment-slip choice. Never asked: **Whole
  bill**; an amount that pays the bill off; a bill with an invoice; a bill set for a full invoice.
  **Refund** on a payment with `hasTicket`, on a bill with no invoice yet, opens **Correct invoice**
  (`invoice-correction-dialog.ts`) on that ticket. (2026-11-21: replaced by [the refund-after-final plan](2026-11-21-advance-refund-after-final.md).) Axe in both themes for the question. Spy on the API client, not on screen text.
- [ ] **Steps 2–5:** run (`pnpm --filter @waitron/till exec vitest run <files>`), implement, run,
  commit.

### Task 1.8: the docs that become false

- [ ] A447 in `docs/backlog/fiscal.md:57-90` and `docs/backlog.md:263-266`: replace "Money paid
  before then is an advance, even when it names no dishes" (`:68`) and "An advance taken at the till
  is issued by Waitron when the payment is taken" (`:81`) with D1's rule and the owner's 20:30
  reading; replace "The final ticket deducts it as it deducts a deposit … it shows … the
  advance's amount before VAT and its VAT" with what is built: the final ticket lists the dishes
  and takes the advance off by its number, date and amount, with no base or VAT under it (ruling
  L1, adviser Q4 open), and its record takes off the advance's own base and VAT; delete the built
  parts. "Today a payment
  that leaves a bill part-paid issues no invoice" (`:78`) stays true for a part payment nobody needs
  a receipt for: say so, and point it at `bill-payments-api.test.ts:822`, where the test now is (it
  cites `:771`). Keep the business-day part.
- [ ] The guide `apps/server/src/guide/en/table-service.md` and its Spanish twin: `#pay-window`
  (`:812`) gains the receipt question and what each answer does; `#refund-payment` (`:190`) gains "a
  payment with its own ticket opens **Correct invoice** on that ticket"; `#print-bill` (`:574`)
  gains how the bill lists an advance: the dishes, then the advance's number, date and amount
  taken off, then what is left. Run `src/guide-content.test.ts` and
  `scripts/guide-links.test.ts`.
- [ ] Commit; `/finish-branch`.

---

## Piece 3 (PR 2, own plan): correctives of full invoices, in their own series

**Needed by:** piece 1b (a full-invoice advance must be correctable), piece 4 (D6's full invoice,
and D4's give-back on one) and piece 5 (D7, D8 and D10 on a full invoice). Its PR resets test venues
(the series check changes).

**Delivers:** a corrective of a full invoice (R1, by differences, naming the customer) in a
corrective series of its own, filed by `recordCorrection`, usable by **Correct invoice** and by the
corrective pieces 4 and 5 file without a refund.

**Builders touched:** `requireSupportedCorrection` (`packages/core/src/correction-eligibility.ts:5-8`)
stops refusing a full invoice; the corrective builder chooses R1 for one
(`packages/fiscal-verifactu/src/backend.ts:497-572`, R5/R4 at `:571`); a fourth series purpose joins
`invoice_series_purpose_ck` (`packages/db/src/schema/series.ts:43`) and every place requiring the
three (`packages/fiscal-verifactu/src/allocation-identity.ts:69`, `initial-paper-candidates.ts:29`,
`hour-series-configuration.ts:7`, `custodian/custody-state.ts:149`, `register-pdf.ts:123`), and
setup, restore and promotion create it (`packages/provisioning/src/venue-plan.ts:232`,
`first-setup-module-context.ts:32`, `recover-provisioned-venue.ts:28`). It is the prerequisite
A1407 waits for (`docs/backlog.md:1276`); AEAT's test service has accepted an R1 (run 37286368370).
Own plan, own fresh-context review.

**Size:** about 600 product lines and 900 test lines (estimate; its plan will measure).

---

## Piece 1b (PR 3): an advance as a full invoice (D3, 20:30 Q2)

**Order:** after pieces 1 and 3. **Landing:** fiscal; the owner lands it. Full review weight.
**Adds:** nothing to the database. **Builders touched:** `recordSale` called unchanged for an F1.
**Size:** about 250 product lines and 450 test lines.

### Task 1b.1: the payer chooses ticket or full invoice

**Files:** `apps/server/src/bill-advances.ts` (`issueAdvance` takes `{ kind: "full", counterparty
}`), `bill-payments.ts` and `bill-payments-api.ts` (the request carries the choice and the
customer; drop `advance.full_invoice_unsupported`), `apps/till/src/widgets/bill-pay-dialog.ts` (after
**Yes**, **Ticket** or **Full invoice**, the customer's details through the till's existing
recipient fields, filled in from the bill's customer when the bill is set for a full invoice), the
guide's `#pay-window`; tests beside each.

- A full-invoice advance is an F1 to the customer the payer names, in the live `full` series, same
  wording and rate, printed on A4 or emailed as the payer chooses (through
  `reserveInvoiceDelivery`). The rest's invoice takes it off as in piece 1, whatever its own kind,
  and prints its number (adviser Q1 asks whether that mix is allowed; built as allowed).
  **Correct invoice** on it files an R1 (piece 3).
- [ ] **Step 1: Failing tests:** example 7 (F1 naming Acme, 272.73/27.27; the rest is a ticket);
  "on a bill set for a full invoice the customer is filled in"; "the advance is emailed when the
  payer chooses email"; "Refund on it opens Correct invoice and files an R1"; "the €3,000 limit
  does not apply to a full-invoice advance".
- [ ] **Steps 2–5:** run, implement, run with the fiscal pair unedited; commit; `/finish-branch`.

---

## Piece 4 (PR 4): an advance paid before the day, on the booking

**First line of the PR:** "Resets test venues: adds the sale origin 'dashboard' (starting
migrations rebuilt)."

**Order:** after pieces 1 and 3; it follows 1b in the build order but does not need it.
**Landing:** fiscal and a contract between packages (`CoreServices`); the owner lands it. Full
review weight.

**Adds:** `dashboard` in `SALE_SOURCES` (D5), widening every table listed under "Sale origins"
(rebuild core's, payments' and fiscal-verifactu's starting migrations); table `booking_advances` in
the bookings set (`booking_id` FK, `sale_id` FK unique, `created_at`; `appendOnly()`, `ledger`; the
module already `requires: { core: "*" }`, `packages/composition/src/modules.ts:348`); core table
`advance_outcomes` (`advance_sale_id` FK, `corrective_sale_id` FK nullable, `outcome`
`'given_back' | 'agreed_price' | 'kept_no_show' | 'kept_on_cancellation' | 'vat_given_back'`,
`amount`, `method` nullable, `recorded_by`, `created_at`; `appendOnly()`, `ledger`; unique on
`(advance_sale_id, outcome)`).

**Builders touched:** `recordSale` (F1 or F2, origin dashboard) and `recordCorrection` (give
back), both unchanged. "the source and device are inert to the huella" (`write-path.e2e.test.ts:510`)
must pass unedited.

**Size:** about 1,015 product lines and 1,610 test lines, with Task 4.3 now carrying
`advance.exceeds_bill`'s till wording and route test from piece 1 (ruling L4), plus the
regenerated starting migrations of core's, payments', fiscal-verifactu's and bookings' sets, which
these estimates do not count (several hundred generated lines; see piece 1's size).

### Task 4.1a: the dashboard origin (D5)

**Files:** `packages/shared/src/origin.ts` and `origin.test.ts`; the origin tests of each widened
table (`packages/fiscal-verifactu/src/registros-origin.test.ts` and the core and payments ones);
core's, payments' and fiscal-verifactu's starting migrations, rebuilt.

- [ ] **Step 1: Failing tests:** "every widened table accepts origin dashboard with no device, and
  refuses it with a device".
- [ ] **Steps 2–5:** run, add `"dashboard"` to `SALE_SOURCES`, rebuild the three sets
  (`migration-baseline rebuild --set core`, `--set payments`, `--set fiscal-verifactu`), run with
  `scripts/starting-migrations.test.ts`, `scripts/schema-constraints.test.ts`, the fiscal pair
  unedited; commit.

### Task 4.1b: issue a booking advance, and seat it (`CoreServices`)

**Files:** `packages/module/src/module.ts`, `apps/server/src/parties.ts` (beside `seatTable`), new
`apps/server/src/booking-advance.ts` and its test, `apps/server/src/bill-payments.ts`
(`readBillBalance`, `assertBillInvariant`, `holdsPayment`).

- `issueBookingAdvance(tx, { managementSessionId, amount, receivedAt, description: { date,
  partySize }, invoice: { kind: "full"; counterparty } | { kind: "ticket" }, recipientAddress })` —
  admits as every economic write does (trading admission, the start's clock confirmation,
  `refuseUntilRecordable`), requires `booking.manage` (`packages/bookings/src/permissions.ts:4`),
  one line «Pago a cuenta — reserva del {date}, {partySize} comensales» at `ADVANCE_VAT_CLASS`, F1
  in the live `full` series or F2 (refused over the ticket limit), one tender of method `other`
  (bank transfer), origin `{ source: "dashboard", deviceId: null }`.
- `seatTable` takes `advanceSaleIds` and writes their `bill_advances` rows (no bill payment). It
  does not change the bill's invoice choice: the rest's invoice is as the bill is set.
- Piece 4 makes `bill_advances.bill_payment_id` nullable for these rows, its unique index partial.
- **A booking's advance counts only when the meal ends:** it enters `readBillAdvances`, the
  rest's invoice, `issueWhenFullyPaid` and `advance.exceeds_bill`; `assertBillInvariant` leaves it
  out; **Paid so far** includes it only up to the meal so far. `holdsPayment`
  (`bill-payments.ts:546`) answers true for a bill with a `bill_advances` row; trace its callers
  first (`refuseBillWithPayments` `:536`, from `bill-actions.ts:85`, `:133`, `till-sale.ts:837`,
  `:1363`, `:2375`, `working-order.ts:7549`; and `till-sale.ts:1316`).
- [ ] **Step 1: Failing tests:** "a €1,000 transfer recorded as a full invoice issues an F1 for
  909.09 + 90.91 with origin dashboard"; "recorded as a ticket it issues an F2"; "a ticket over
  €3,000 is refused"; "while the box waits for its time, it is refused"; "seating attaches the
  advances and leaves the bill's invoice choice alone"; "a bill holding a booking's advance cannot
  be merged"; "it issues nothing when the meal reaches its amount"; "dishes can be removed while it
  is larger than the meal" (balance 600.00 received of 600.00, outstanding 0.00); "deferred close
  takes it off" (€1,000 advance, €1,400 meal, deferred €400, record €400).
- [ ] **Steps 2–5:** run, implement, run with `scripts/module-seams.test.ts`,
  `module-graph-honesty.test.ts`, `workspace-cycles.test.ts`, `personal-log-params.test.ts`, the
  fiscal pair unedited; commit.

### Task 4.1c: correct an advance without a refund, and record the outcome

**Files:** `packages/db/src/schema/advance-outcomes.ts` and its test, `packages/db/src/schema/index.ts`,
`packages/db/src/classification.ts`, `scripts/write-path-tables.json`,
`packages/migrations/migrations.manifest.json`, core's starting migration (rebuilt),
`packages/module/src/module.ts`, `apps/server/src/booking-advance.ts` and its test.

- `advance_outcomes` as listed under **Adds** (`appendOnly()`, `ledger`, unique on
  `(advance_sale_id, outcome)`).
- `correctAdvance(tx, { saleId, gross, managementSessionId, outcome, method? })` — files a
  corrective of an advance through `recordCorrection` with no refund through Waitron: a whole credit
  when nothing has been corrected yet, otherwise a partial one through `previewCorrectionAmounts`
  (`correction-history.ts:43`); R5, or R1 through piece 3; writes `advance_outcomes` in the same
  transaction. Used by Task 4.3 and piece 5.
- [ ] **Step 1: Failing tests:** "correctAdvance files a whole credit of a €1,000 advance and one
  given_back row"; "after €200 given back, a partial one for the €800 left" (−727.27/−72.73, what
  is left of 909.09/90.91 after −181.82/−18.18); "it moves no money and writes no tender refund"; "a full-invoice
  advance is corrected with an R1"; "a second row with the same outcome for one advance is
  refused" (the constraint's name); "advance_outcomes refuses an update and a delete"; "a failed
  corrective writes no outcome".
- [ ] **Steps 2–5:** run, implement, `pnpm --filter @waitron/db exec migration-baseline rebuild
  --set core`, run with `scripts/schema-constraints.test.ts`, `append-only-triggers.test.ts`,
  `append-only-migration-sets.test.ts`, `classification-complete.test.ts`,
  `starting-migrations.test.ts`, `write-path-tables.test.ts`, `scripts/corrective-sums.test.ts`,
  the fiscal pair unedited; commit.

### Task 4.2: the bookings module records the transfer

**Files:** `packages/bookings/src/schema/booking-advances.ts`, `bookings.ts`
(`recordBookingAdvance`; `seatBooking` passes `advanceSaleIds`), `routes.ts`
(`POST /management-api/bookings/:id/advances`), `packages/bookings/src/dashboard/` (a **Record a
payment** form for a bank transfer: amount, date received, **Full invoice** or **Ticket**, and for
a full invoice the company's legal name, tax number, address and country, required), `strings.ts`;
tests beside each. Design-system Forms; `wt-address-lookup` above the address.

- [ ] **Step 1: Failing tests:** refuses a booking that is not `booked`; one `booking_advances` row;
  the company fields are required only for a full invoice; the booking shows the invoice number
  with **Print** and **Email**; seating passes the advances.
- [ ] **Steps 2–5**, with Task 4.1b's guards, the append-only and classification guards of Task
  4.1c (for `booking_advances`), `scripts/address-lookup-forms.test.ts`,
  `scripts/native-form-fields.test.ts` and the bookings suites; commit.

### Task 4.3: advances worth more than the meal: give back or agreed price (D4)

**Files:** `apps/server/src/booking-advance.ts` (`settleExcess`), the final paths' refusal
(`advance.exceeds_bill` now carries the excess and the choices), a route under the till API,
`apps/server/src/close-of-day.ts` (#3847: this refusal leaves the bill open and is not a failure),
the till's refusal in place (`apps/till/src/widgets/`, wording in `codes.ts` and `strings.ts`).
Test: `apps/server/src/advance-excess.test.ts`, the close-of-day tests and the till's tests.

Piece 1 already throws `advance.exceeds_bill` from `deductAdvances` (Task 1.2), but no piece-1
route can reach it; booking advances are the first way it happens. So its route test and its till
wording are here (ruling L4).

How each choice is invoiced and filed (example 3):
- **Give back the difference:** staff confirm the difference was returned by bank transfer outside
  Waitron; `correctAdvance` files the corrective for it (outcome `given_back`, method `other`). Then
  the rest's invoice issues with nothing left.
- **Keep it as the agreed price:** no corrective. The rest's invoice is issued with `cap: "meal"`:
  it takes off credit only up to the meal's total, at the advance's rate, so it carries 0.00
  (with a negative 10% line beside a positive 21% one on a mixed meal, example 3), and the excess
  stays declared, with its VAT, on the advance's own invoice, which already says what the company
  paid. Outcome `agreed_price`. The rest's invoice prints the advance's line with its full amount
  in brackets and −800.00.
- Piece 4 adds `deductAdvances`'s `cap: "meal"`: credit only up to the meal, a part-taken rate
  worked out from its gross as in the fallback. Tests: €1,000 against €800 leaves 0.00; example 3.
- Piece 4 adds `TillSaleLine.advance.fullAmount` for that caption, tested on example 3.
- **Record it as a tip:** held until Q8, as the owner agreed; not offered.
- Each needs `sale.rectify`, asked for in place with a manager's sign-in, and a safe **Stop**.
- [ ] **Step 1: Failing tests:** "advances worth more than the meal refuse Print the bill with
  advance.exceeds_bill and write nothing" (moved from Task 1.4a); both of example 3's paths through
  the till route, asserting the corrective's figures, the rest's record and the `advance_outcomes`
  row; "the cash count counts
  the advance's money once"; "without sale.rectify nothing changes"; the till's refusal names the
  two choices and the excess; "the end-of-day job leaves such a bill open, logs it once, and does
  not count it as a failure or wait longer".
- [ ] **Steps 2–5:** run, implement, run with the fiscal pair unedited; commit.

### Task 4.4: docs

- [ ] The bookings guide in English and Spanish (create its section if none): recording a transfer
  before the day, full invoice or ticket, what the company receives, the two choices when it is
  more than the meal. `#deferred-payment` (`table-service.md:875`) gains "a booking's payment made
  before the day does not count; the invoice covers only the rest". A447: delete the built
  sentences. `/finish-branch`.

---

## Piece 5 (PR 5): a kept deposit's corrective, issued by itself

**Order:** after piece 4. **Landing:** fiscal; the owner lands it.
**Adds:** nothing to the database (piece 4 added `advance_outcomes`).
**Builders touched:** `recordCorrection`, unchanged, through `correctAdvance`.
**Size:** about 390 product lines and 720 test lines.

D8 is untouched by the 20:30 model: a booking that was never seated has no rest's invoice; its
deposit's own invoice is what the corrective takes to zero.

### Task 5.1: no-show, or cancel and keep or give back (D7, D8, D10)

**Files:** `packages/module/src/module.ts` (`CoreServices.correctKeptAdvances(tx, { saleIds,
managementSessionId, reason: "kept_no_show" | "kept_on_cancellation" | "given_back" })`),
`apps/server/src/booking-advance.ts`, `packages/bookings/src/bookings.ts` (`markNoShow`,
`cancelBooking`), `routes.ts`, the bookings dashboard (cancel asks **Keep the deposit** / **Give it
back**; the booking lists the corrective with **Print** and **Email**); tests beside each.

- **Keep** (no-show or cancellation): for each advance with anything left, `correctAdvance` files
  the corrective that takes it to zero (a whole credit, or a partial one for what is left), outcome
  `kept_no_show` or `kept_on_cancellation`, amount = the money kept. Nothing is refunded.
- **Give it back** (cancellation): staff confirm the transfer was returned outside Waitron; the same
  corrective, outcome `given_back`.
- A ticket's corrective is not printed or sent. A full invoice's corrective is emailed automatically
  to the address its deposit invoice was emailed to, through `reserveInvoiceDelivery` (D10); when
  the deposit was not emailed, the booking's **Email** sends it. A seated booking's advance is on
  the bill and is never corrected here.
- [ ] **Step 1: Failing tests:** example 5 (corrective −36.36/−3.64 naming the deposit ticket); "it
  refunds nothing and prints nothing"; "a manager without sale.rectify is refused and the status
  stays booked"; "while the box waits for its time to be confirmed, marking a no-show is refused
  and the status stays booked"; "a deposit already given back in part is corrected for what is
  left" (€10 back: −27.27/−2.73); "cancelling with Keep files the corrective as kept; Give it back
  files it as given back"; "a full-invoice deposit is corrected with R1 and emailed where its
  invoice was".
- [ ] **Steps 2–5:** run, implement, run with the fiscal pair unedited and
  `scripts/corrective-sums.test.ts`; commit.

### Task 5.2: giving back the VAT of a kept deposit, on request (D8)

**Files:** `apps/server/src/booking-advance.ts` (`recordVatGivenBack`), `packages/bookings`
(route and a **Give back the VAT** action on a booking whose deposit was kept); tests beside each.

- No invoice is needed: the corrective already took the VAT off. Staff choose how it went back
  (cash from the drawer, or bank transfer) and confirm; Waitron records outcome `vat_given_back`
  with the amount (the kept corrective's VAT, €3.64) and the method. Cash from the drawer is entered
  as a payout at the day's close, as any cash removed is (`record-daily-close.ts:118`); the action's
  answer says so. Refused when no kept outcome exists or the VAT was already given back.
- [ ] **Step 1: Failing tests:** "recording the €3.64 given back stores one vat_given_back row";
  "a second one is refused"; "a booking whose deposit was not kept offers nothing"; "without
  sale.rectify nothing changes".
- [ ] **Steps 2–5:** run, implement, run; commit.

### Task 5.3: the kept deposit on the accountant workbook (D8)

**Files:** `apps/server/src/accountant-export.ts` (`listAccountantExport`, `:194`, joins
`advance_outcomes`), `apps/server/src/i18n/accountant-export.ts` (two columns in each language);
test beside it.

- The "Issued invoices" sheet gains **Kept as compensation** and **VAT the customer could ask
  back**, filled only on a kept deposit's corrective row (example 5: 40.00 and 3.64; 0.00 once a
  `vat_given_back` row exists).
- [ ] **Step 1: Failing tests:** example 5's row carries both figures; after the VAT is given back
  the second reads 0.00; any other row leaves them empty; the Spanish column words.
- [ ] **Steps 2–5:** run, implement, run; commit.

### Task 5.4: docs

- [ ] The bookings guide, in both languages: what a no-show, or cancelling with Keep or Give it
  back, does to a deposit; giving back the VAT on request; where the accountant sees it.
  `/finish-branch`.

---

## Self-review against the sources

- **D1–D11, the 20:30 and the 21:00 answers:** each answer's place is in "What each answer means
  for the build".
- **"we DO need to mention the advance payment on the final bill"** — Task 1.5 (the dishes, the
  advance's number, date and amount taken off, what is left, nothing under the advance), Task 1.6a
  (Correct invoice lists the same dishes), examples 1–4, 6 and 8; the record now subtracts the
  advance's own figures (ruling L1), which changes it by a few cents in four to seven bills in ten
  against the last revision.
- **Lane L's rulings L1–L11 on the third fresh read** — each row of that table names the tasks it
  lands in.
- **"Build the till's 'pay part of the bill with its own receipt' now: yes"** — Tasks 1.3 and 1.7.
- **10% for a payment during the meal, tested at AEAT, the adviser asked** — Task 1.0, Q2, Q12.
- **Receipt required, payment slip optional (20:57)** — Global Constraints; Task 1.3's tests
  assert no slip by itself; Task 1.7 keeps the receipt question apart from any slip choice; no task
  relies on a slip.
- **"The advance is a receipt or an invoice by itself"** — Tasks 1.3 and 1b.1; **"The rest of the
  bill could be a receipt or an invoice in its own right"** — Task 1.4a (as the bill is set).
- **«Pago a cuenta — consumo en mesa 7» at the eat-in rate** — Task 1.3 (D2).
- **Advances before the day, on the booking; deferred payment instead** — piece 4 (a test proves a
  booking's advance is taken off a deferred close).
- **The corrective for a kept deposit, by itself, at every venue** — piece 5 (no setting turns it
  off); **"the 3.64 could be refunded to the customer should they ask"** — Task 5.2.
- **Each piece leaves `main` working:** piece 1 carries its own till changes; piece 1b only adds a
  choice; piece 4's advance never blocks a meal mid-service and its excess is settled by staff's
  choice; piece 5 corrects only what is left.
- **Hard cases:** 10% advance against a mostly-21% bill (1.0, 1.2, 1.4a, 1.6a); advances over the
  total (1.2 as a unit guard, 4.3); a remainder of a few cents (1.2, 1.4a); several dishes whose
  rounding differs (example 8: 1.0, 1.2, 1.4a, 1.5, 1.6a); card advances (1.4b); left without
  paying (1.4a); deferred close (1.4a, 4.1b); end of the business day (1.4b, 4.3); ticket and full
  invoice mixed (1.4a, 1.4b, 1b; adviser Q1); the printed lines adding up (1.5); an advance found
  by table and zone (1.3); a bill corrected (1.6a), credited whole (1.6a) or merged (refused,
  extended in 4.1b); a refunded advance (1.4b, 1.6a; after the rest's invoice, owner question 1);
  reports (1.6b); a set-menu bill (no special case: the advances come off after rating).
