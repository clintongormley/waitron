# Fiscal records, invoices and the asesor — detail

> **2026-10-10, receipt presentation:** A366 slice 7 supersedes the F1 location-address
> exclusions below. Thermal and till receipts follow the global current-address switch,
> independently of filed domicile; A4 omits the optional current-address block. Filed domicile
> remains. Follow [the slice 7 plan](https://github.com/clintongormley/waitron/blob/f2e5e9fb5976f4c5f63cf1143b9befa22fe2cd12/docs/superpowers/plans/2026-10-08-a366-slice-7-receipts-per-department.md).

The open entries are listed in [the backlog](../backlog.md), under "Fiscal records, invoices and the asesor". This file holds
their full text.

## Structured B2B invoices before the applicable 2027 or 2028 date

The [27 October source check](../compliance/research/2026-10-27-a948-operation-date-and-b2b.md#b2b-delivery-the-rules-exist-their-mandatory-application-is-later)
separates current paper/agreed-electronic delivery qualification from future structured B2B
integration. The general mandate applies from 6 October 2027 above the issuer's EUR8 million
threshold, or 6 October 2028 otherwise. Establish scope and design exchange, public-solution
copies and required state/payment reporting before the applicable date. No connector is built
or qualified by this research; current delivery and preservation checks remain open.

## A445. A free item on a bill with mixed VAT rates should take a share of the price paid

Allocate by value instead of setting the item to €0 (V0555-17, binding). Only bills mixing rates
are affected (the deli's 4%, 10% and 21%). Asked as
[S10](../compliance/asesor-questions.md#the-shortened-list-2026-10-09), and confirmed by the
adviser's answer 1.10 of 15 November; the owner's decision D4 is to build it now. A table given its
whole meal free is not this entry: the owner's answer of 18 November (owner, 2026-11-18; the adviser
still to confirm the details) is that it is a self-supply only
when given in exchange for services, and that it goes on the [report for the accountant](#a-report-for-the-accountant-corrections-to-filed-quarters-wrong-vat-rates-and-free-meals).
Fiscal: the owner lands it.

## A446. Build the pre-bill: each printed pre-bill is stored as printed and linked to the invoice that follows

**Owner, 2026-11-17: not scheduled.** Asked whether to build the printed pre-bill or decision D1
first, the owner chose "Drop it; queue D1", and then: "the printed pre-bill, leave it on the backlog
for the foreseeable future". A table's ticket is issued when staff print the bill instead (D1,
[adviser answers B1](../compliance/2026-11-15-adviser-answers.md#b1-a-tables-ticket-waits-until-the-bill-is-fully-paid)).
The design (A803 §3.9) and what the plans say about the pre-bill are kept as written. The rest of
this entry is the 4 November decision, which this one sets aside.

**Owner, 2026-11-18** (the adviser is still to confirm the details; question 2 of the
[19 November sheet](../compliance/2026-11-19-adviser-meeting.md)): "No pre-bill is fine, and saves us
the hassle of having another system to track. If the bill changes after it is issued then we just
issue a correction or cancellation." Guests who split a bill after it was printed take the correction:
see [Reopen to split](#adviser-split-after-print-a-printed-bill-is-split-by-a-whole-credit-note-and-copies-of-its-dishes-watcher-2026-11-20).

**Owner, 2026-11-04: build it now to the strict reading, without waiting for S2.** Today a table
cannot get a printed bill before paying: "bill requested" only marks the floor plan. If S2 says a
precuenta does not count, the stored copies are merely unnecessary. S1 (when the invoice must be
issued) could still change this, so read its answer before landing if it has arrived. The design is
A803 §3.9. It lists a pre-bill's dishes by order line id, not portion id: A1308 makes the line the
dish's identity (owner, 2026-11-04), so a pre-bill built first needs no rework. Those ids take no
foreign key, because a cancelled dish's line is deleted. Printing it never fires held food and never
marks a line sent (Q21).

AEAT's FAQ calls a system without that link «susceptible de sanción»,
and the pre-bill carries no tax QR code. Whether a precuenta counts is asked as [S2](../compliance/asesor-questions.md#the-shortened-list-2026-10-09).

## A447. A part payment whose payer wants a receipt is an advance

Asked as [S3](../compliance/asesor-questions.md#the-shortened-list-2026-10-09) (LIVA 75.Dos, RD
1619/2012 art. 2.1). The owner's answers of 18 November 2026 (owner, 2026-11-18, question 1 of the
[19 November sheet](../compliance/2026-11-19-adviser-meeting.md)) and 19 November (decision D1 and
the 20:30 answers, quoted in the
[advances plan](../superpowers/plans/2026-11-19-adviser-advances.md#where-the-rules-come-from));
the adviser is still to confirm the details:

- **When the meal ends, and so when its ticket is issued:** "Whichever comes first: printing the
  bill; taking the last payment; close of trading day", or staff marking the table as having left
  without paying (owner, 2026-11-18). The trading day is the venue's own day,
  set to end at an hour when it is closed, such as 05:00. A ticket issued before it is paid shows
  the amount still owed.
- **Which payments are advances:** "a payment made before the meal begins should be an advance, a
  part payment after the meal has begun but before it has ended: if it needs a receipt, it is an
  advance, if it doesn't then it is just part payment" (owner, 2026-11-19, D1), and "We can take
  multiple payments towards the final bill. Each one doesn't need a receipt (unless they want one)"
  (owner, 2026-11-19 20:30). So a part payment during the meal is an advance only when its payer
  wants their own receipt.

Built: on a part payment that leaves something owed on a bill with no invoice yet, set for a
ticket, the till asks "Does this payer want their own receipt for this amount?"
(`#ownReceiptAsked` in `apps/till/src/widgets/bill-pay-dialog.ts`). **Yes** issues the payer a ticket of one line,
«Pago a cuenta — consumo en mesa 7», at Waitron's shipped reduced rate, 10% today
(`issueAdvance` in `apps/server/src/bill-advances.ts`, `ADVANCE_VAT_CLASS` in
`packages/shared/src/menu-document/vat-rates.ts:9`). The bill's own invoice, however it is issued,
takes each advance off (`apps/server/src/advance-deduction.ts`). Its printed ticket lists the
dishes, then «Pago a cuenta n.º A/12, 19/11/2026 −30,00» for each advance, then the total less the
advances, with no base or VAT printed under the advance line (`apps/server/src/receipt-advances.test.ts`,
"no base or VAT, and no price each, is printed under an advance line"), though the ticket's VAT
table takes the advance off its rate's row: with dishes of €20 at 10% and €80 at 21% and a €50
advance, that row reads `10% −27,27 −2,73` (the same file, "example 2: … the VAT table's 10% row
is negative"); whether that is enough is
asked in question 12 of the 19 November sheet (the advances plan's Q4). Its record takes off the advance's own filed base and VAT
(`apps/server/src/advance-deduction.test.ts`, "example 8 subtracts the advance's own base and
VAT"). **No** keeps a plain part payment, which issues no invoice
(`apps/server/src/bill-payments-api.test.ts`, "leaves €70.00 outstanding on a €120.00 bill,
changes no line's price, and issues no invoice"). Printing the bill issues the ticket before
payment; a payment after that is not an advance (question 2). Once the table's invoice has taken an
advance off, money comes back first through Correct invoice on the table's invoice, while that
invoice still has money to give back and a dish at the advance's own rate left to correct: Correct
invoice on the advance's ticket is refused with `advance.final_invoice_first`, naming the table's
invoice, the rate and the smaller of the two amounts (`apps/server/src/advance-taken-off.ts`;
`apps/server/src/advance-corrections.test.ts`, "refuses Correct invoice on the advance's ticket
while the rest's invoice can give back €90 at 10%, naming it, and files nothing"). While a refund on the table's invoice is still waiting for its result and
could change that answer, it is refused with `advance.final_invoice_refund_pending` instead. Otherwise (a
€0.00 table's invoice, dishes sent back for more than it carries, or no dish left at the advance's
rate), it comes back as an R5 of the advance's own ticket at its 10%, filed by `recordCorrection` unchanged, cash with its own drawer
opening or card ("a €0.00 rest's invoice: €20 in cash back on the advance files an R5 of it at 10%
−18.18 and −1.82, opens the drawer once, and leaves the bill and the rest's record as they were");
the table's invoice is never altered by it. The till's Refund beside such a payment opens Correct
invoice on its ticket, printed bill or not, and a plain or bill refund of its money is refused with
`tender.refund_of_advance` or `bill.refund_of_advance`, naming that ticket. This replaces the
2026-11-20 14:26 rule that refused the advance's own correction once the table's invoice existed
(owner, 2026-11-20 ~22:40: "I think we have to allow a refund"; watcher, 2026-11-21 04:35, O1;
[plan](../superpowers/plans/2026-11-21-advance-refund-after-final.md)). On a bill holding a dish
below 10%, the advance's 10% corrective can declare less VAT than the dishes it gives back: €0.52
less over the bill when €10 of water at 4% comes back that way (the plan's measured case, O2 (ii)); that, and whether one corrective should name both tickets, are the two points added on 21 November
to question 12 of the 19 November sheet. A refund leg of a correction of the advance meets the same check as
opening one; when it is refused `advance.final_invoice_first`, a correction opened, by stored times, before the table's invoice took the advance off
is refused `advance.taken_off_final_invoice` instead. The table's invoice is held
back while a correction of one of its advances is open, so that the table's invoice takes the advance off as
corrected: the payment that pays the bill off (refused before any card reader is
asked), Print the bill, the unpaid departure, deferred close and an edit of the bill that would leave
it paid are refused with `advance.correction_open`; a reader payment started before the correction
was opened keeps its money and issues no invoice; when the correction is closed or discarded, the
table's invoice is issued if the bill is then paid off, under the device and person of the bill's
latest received payment that is not an advance, dated as recovery would date it (tested with
Discard, `apps/server/src/advance-corrections.test.ts` and
`advance-corrections.later-sale-date.test.ts`), and ending it is refused when
issuing that invoice is refused, as while the box waits for its time (`clock.unconfirmed`, tested);
the close of the business day answers the bill as it answers a payment still moving (`money_moving`)
and issues nothing.

To build: an advance as a full invoice (the advances plan's piece 1b), and an advance paid before the
day, such as a company's €1,000 for its staff dinner, where staff record the transfer against the
booking, or the booking takes the payment, and Waitron issues the company a full invoice for the
advance and deducts it on the night (piece 4). Where the company can pay afterwards instead, the dinner can
be closed as a deferred payment (`POST /api/working-orders/:id/close-deferred`,
`apps/server/src/deferred-close-api.ts`), which issues the invoice on the night, so no advance
arises (owner, 2026-11-18). A walkout's ticket is for the full amount, with everything still owed.

## Adviser confirmation: supplier invoice numbers by issue year

Confirm the owner's A981
rule in [Q18(b)](../compliance/asesor-questions.md): the same supplier's number is refused within
one issue year and accepted in another with a warning. The receipt date still sets the VAT
reporting period.

## A554. Should any screen show the address an invoice email went to?

An owner question, open
point 1 of the [A231q plan](../superpowers/plans/2026-10-12-a231q-invoice-delivery-part-2.md). Until
it is answered none does: the delivery status the till and the dashboard read carries no address,
and both email forms open empty. Left open by A231q.

## The reconcile sweep may raise a second "accepted with errors" warning

This can happen when it corrects a record the drain is still sending
(`packages/fiscal-verifactu/src/reconcile.ts`);
only one case opens, as cases are one per record. Found by reading in #1596's review, not run;
nothing runs the sweep yet, so check it when the sweep is scheduled.

## Should `packages/fiscal-verifactu` have a mutation floor?

It has no Stryker config, so the
minute-name rules A947 slice 4a added are covered by tests and hand-run deletions only (the
plan's Mutation section lists them). Decide whether it joins the mutation-tested packages.

## Walk-up invoice dates follow the server process time zone

**1 November landing update:** A696 landed in [#2369](https://github.com/clintongormley/waitron/pull/2369).
New invoice dates and record offsets use the writing node's saved venue zone; the
[coverage ledger](https://github.com/clintongormley/waitron/blob/cb1aeeb7b2/docs/superpowers/plans/2026-10-21-a696-startup-zone-validation.md#task-20-coverage-ledger)
records the qualification. The 15 October observations below describe the earlier process-zone
behavior.

Found during A693's test-only fix (2026-10-15). In an installed disposable copy,
`transactional-series.test.ts` issued real walk-up invoices with the venue's stored
`time_zone` fixed to `Europe/Madrid`. At `2026-10-14T23:30:00Z`, the stored
`fecha_expedicion_factura` was `2026-10-14` under process `TZ=UTC` or
`TZ=America/New_York`, and `2026-10-15` under `TZ=Europe/Madrid` or `TZ=Asia/Tokyo`.
At noon UTC all four stored `2026-10-14`.

`apps/server/src/till-backend.ts`'s `systemClock` takes the offset from the process's
`getTimezoneOffset()`; `git blame -L 14,25` attributes it to `d49e2e986` (2026-08-05).
A693 changes no production code. Deployment's runtime ENV and compose app settings do not
set `TZ` or mount a local-time file; a local `node:26.11.1-slim` process reported `UTC`.
That probe does not measure an operator's configured appliance.

**A696 audit/design, 2026-10-15:** the
[audit and design proposal](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/specs/2026-10-15-a696-invoice-time-zone-design.md)
traces every discovered issuing, replay, resend, import and seed path. Driver probes extend the
process-zone observation to held orders, unpaid invoices, table payments, reader capture/recovery,
public unpaid departure and cancellation credits, core F1/F3 and R5, and emergency series.
An annulment retains the original invoice date. Next-day Tokyo outbox sends retain the stored
fiscal payloads and rows; real AEAT acceptance, lost-response/restart and restore are not measured.
No product fix is built.

**Decision update, 2026-10-15:** the owner chose the saved venue zone, including DST, for every
new invoice date and record offset, ordinary receipt and till, independently of the process zone.
Old records stay unchanged. See the [recorded decision](#decisions-and-deliberate-limits) and
the [spec's dated answer](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/specs/2026-10-15-a696-invoice-time-zone-design.md#owner-decision-recorded-2026-10-15-the-venues-saved-time-zone).

**Current direction, updated 2026-10-20:** the owner's 2026-10-15 ~22:25 answer supersedes the
17:20 mid-payment repair proposal. Check the saved zone at startup and every application writer;
admit no sale, payment or invoice while it is bad. Keep manager login and zone confirmation
reachable with `venue.configure`, only for a missing/invalid zone. Valid-to-valid settings locks
remain. The [startup redesign](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/specs/2026-10-20-a696-startup-zone-validation-design.md)
proposes repair-only authenticated serving followed by restart, and identifies A166's country-pack
dependency. The dropped post-capture state, resume action
and reporting consequence remain only in the historical guided proposal and decision below.
The audit also found a
source-only F2 presentation gap: `readReceiptIssuer` supplies the stored offset only for a named
recipient, leaving ordinary receipt views to their runtime zone. The approved behavior includes
consistent ordinary receipt and till dates; passing the saved offset remains a proposed mechanism.
Existing settings history locks are retained; this decision authorizes no repair bypass.
No stored fiscal row is to be rewritten.

## Owner decision 2026-09-24: a void counts on the day it is made, not the day of the sale

- Found by #601 (`packages/reporting`). **Owner decision 2026-09-24: a void counts on the day it
  is made, not the day of the sale** (built in #605 for the daily close's VAT, the period VAT
  summary and top sellers). The quarterly _modelo 303_ keeps its old behaviour, pinned by a test in
  `vat-return.test.ts`, until the [report for the accountant](#a-report-for-the-accountant-corrections-to-filed-quarters-wrong-vat-rates-and-free-meals) is built: Q25
  (which VAT period a later annulment lands in) is settled by owner decision D12 of 2026-11-16,
  which the owner's answer of 18 November keeps (owner, 2026-11-18, question 8 of the
  [19 November sheet](../compliance/2026-11-19-adviser-meeting.md)); the adviser is still to confirm the details. No till screen or server route calls `recordVoid` yet.
  `stableStringify` (`src/daily-close-hash.ts`) throws on a `null`, and a key holding `undefined`
  hashes differently from the row the database stores (the column drops the key); its comment now
  states the precondition, and nothing enforces it for callers. Not fixable in a comments-only
  change: test titles still say "jsonb" (`verify-daily-close-chain.test.ts:70`), "tenant"
  (`top-sellers.test.ts:501`, `overdue-orders.test.ts:252`, `vat-summary.test.ts:233`,
  `vat-summary-period.test.ts:128`), "design §3" (`overdue-orders.test.ts:194`) and "spec §12"
  (`top-sellers.test.ts:307`). `toDr303Record` (`src/dr303.ts`) does not cross-check a monthly total against a
  quarterly period code such as "4T"; a test pins that and the one route that builds the file
  takes both from the same code, so it looks deliberate — worth the owner's eye because it is a
  tax file. The top-sellers fixtures give most lines no kitchen name, where CLAUDE.md §3 asks all
  three names to differ (top-sellers never reads that name).
  `record-daily-close.concurrency.test.ts:60` says "nothing but the write queue keeps the second
  out"; a reviewer, reading only, thinks the one-close-per-day unique constraint refuses it — not
  checked. `packages/core/src/errors.ts` names `scripts/errors-reachable.test.ts` without the hedge
  #601 gave reporting's (the guard matches text).

## Two SQL comments inside a `sql` string in `packages/fiscal/src/testing/fake-backend.ts` are code, not comments

- Found by #592 (`packages/fiscal`), not fixable in a comments-only change or outside the
  package. Two SQL comments inside a `sql` string in `packages/fiscal/src/testing/fake-backend.ts`
  are code, not comments: one points at `packages/fiscal/src/backend.ts:72` for `total: Decimal`
  (it is at line 50) and names "Task 14", and one says the breakdown column is NULL only for a
  void, while the fake's corrections and substitutions leave it NULL too.
  `FiscalBackend.pendingCount` has no caller outside the backends and their tests, yet
  `packages/db/src/schema/sales.ts:29` says it is how the count is read.
  `packages/fiscal-verifactu/src/slot.ts:51`
  says `validate` runs BEFORE `provisionVenue`, which #592 narrowed in `contribution.ts` to an
  instruction to the caller, because `apps/server/scripts/cloud-integration-fixture.ts` calls
  `provisionVenue` without it. `packages/fiscal-verifactu/src/no-regime-scope.test.ts:7` says
  `packages/fiscal`'s guard forbids ENGLISH regime terms; its list is half Spanish.
  `no-hardcoded-margin.test.ts` scans only the files directly in `packages/fiscal/src`, not
  `src/testing/`, and does not say so.

## `packages/fiscal-verifactu` code

- `packages/fiscal-verifactu` code, found by #562; not changed unless marked:
  - The inner try/catch around the log call in `aeat-transport.ts`'s `closeAll` is dead: with it
    removed, the "LOGGER fails" case still passed, because `Promise.allSettled` absorbs the
    rejection.
  - Removing `appendToChain`'s nested `tx.transaction` makes no test fail (`chain.test.ts`'s
    header says so); the protection it gives a losing attempt has no test holding it.
  - `write-path.e2e.test.ts` (lines 410 and 414) points at `test/fixtures.ts:249-256` for a
    receipt of one basket hashing differently filed 16th and filed standalone, and at
    `test/write-path-fixtures.ts:37-44` for `steadyClock`. The receipt is now at
    `test/fixtures.ts:264-267` and `steadyClock` at `test/write-path-fixtures.ts:22-34`. Correct
    them only in a change allowed to touch that file.

## Reporting — the fiscal remainder (parked)

Two pre-filing caveats a human must clear before the first
LIVE 303 filing: validate the DR303 file once against the real AEAT "por fichero" uploader (we
omit página 2, régimen simplificado); and an asesor must confirm the **prorrata** treatment
(`computeInputVat` scales only the cuota by `deductible_proportion`). Deferred build slices:
rectificativas de facturas recibidas (casilla 40/41, needs a `corrects_purchase_invoice_id`
self-FK); bienes-de-inversión regularización (43); the prorrata rule (44, asesor-driven);
intra-community and import boxes (32–39); a libro-registro / Pre303 export.

## `packages/fiscal-verifactu` restates rules the validator owns

- `venue-fields.ts` repeats the venue-field patterns and caps, kept honest by drift guards
  (`record-limits.test.ts` compares the recipient
  name cap with the validator's verdict). `backend.ts`'s simplified-invoice limit no longer restates
  the validator's rule: it is the owner's €3,000 (A741), and `record-limits.test.ts` checks our
  verdict against the validator's at six totals.
  Exporting the patterns from the library instead was DEFERRED on purpose (owner, 2026-09-12) — it
  widens an audited fiscal library's public surface and the drift guard already closes the risk.
  Revisit when something else needs those patterns.

<a id="a1e-simplified-and-full-invoices-use-separate-series--built-public-f1-disabled-2026-10-06"></a>

## A1e. Simplified and full invoices use separate series

A231 [#1256](https://github.com/clintongormley/waitron/pull/1256) adds the `full` purpose beside
`standard` and `rectificative`, provisions its series, and makes core require it for F1 and F3.
Table bill payments, unpaid departures and Counter bills paid through the shared Pay window can issue F1; no route calls `recordSubstitution`. The separate-series
basis is recorded in [verifactu-findings.md §10.1](../compliance/verifactu-findings.md).
**Next action:** complete A231's remaining paths and qualification below. Asesor Q5(d) remains open for F3 and R5.

<a id="a231-full-invoices-at-the-till--gated-implementation-landed-2026-10-06"></a>

<a id="no-sale-over-3000-can-be-made-at-all"></a>

## A231. Full invoices at the till

The owner authorised the gated implementation, which landed as
[#1256](https://github.com/clintongormley/waitron/pull/1256), squash `2d972685530676fbe7c182760f0d96f461214e47`.
Existing preproduction venues require a reset for that schema change. A948 enables the prepared
F1 paths in every environment, with no environment switch. The [design](../superpowers/specs/2026-10-03-full-invoices-at-till-design.md) and
[implementation plan](../superpowers/plans/2026-10-03-full-invoices-at-till.md) retain the decisions
and dated implementation receipts.

The build covers a saved recipient's tax ID or foreign document (with its type and issuing
country), name and address, a separate full-invoice
series, taxpayer domicile, filed receipt data and replay, original/duplicate printing, delivery
status and retry, staff handover confirmation, invoice lookup, and reporting. Paper and till
omit the venue address when an F1 shows its filed taxpayer domicile; phone/email and the
F2/absent-domicile controls remain. Automatic F1 credit/refund/cancellation is refused.

The owner approved the historical-export fixture's current artifact
refusal, including its could-not-open operator advice; provenance, HTTP400/domain-error,
unchanged-database and empty-staging checks remain. This is preproduction format rejection,
with no backward-compatibility implementation.

The till offers **Full invoice**. A saved recipient can be invoiced through table bill
payments or an unpaid departure, and, since #2725, a Counter bill paid through the shared Pay
window. Direct integrated-card payment
(`POST /api/pay`), unissued counter
collection and closing a counter bill by transfer still refuse F1 with `sale.full_invoice_unavailable`.
The shared Full invoice control and automatic recipient prompt are visible at the counter; the
till saves that choice on the order before the Pay window opens. Placing a ticket-then-pay order saves it without issuing an invoice. The retired invoice-first
zone setting creates no separate public issuance route. Zero-total F1 counter requests retain
the same refusal. A saved F1 choice still permits the bill to grow above the simplified ceiling;
the existing recipient checks and F1 series selection remain in place.

**Next action:** complete the physical 58/80 mm paper and QR checks, the asesor's
manual-remedy confirmation and current business-invoice delivery qualification as separate work.
Future structured B2B integration has its own entry above. F3 conversion and F1's
R1–R4 correction path remain separate decisions.

## When the business e-invoicing regime starts

**Not for go-live (owner, 2026-11-11): "we have lots of time to get this done".** Build it
after go-live, well before the first deadline below.

Found by A231d's research. [Orden HAC/1028/2026](https://www.boe.es/buscar/doc.php?id=BOE-A-2026-20587) (BOE núm. 247, 5 October 2026) «entrará en vigor el día siguiente al de su publicación en el «Boletín Oficial del Estado», dándose inicio al cómputo de los plazos» of [RD 238/2026](https://www.boe.es/buscar/act.php?id=BOE-A-2026-7295)'s fourth final provision: «Doce meses después» for businesses whose turnover is over €8 million, and «Veinticuatro meses después, para el resto de los empresarios y profesionales». So from about October 2027, or October 2028 for smaller businesses, an invoice to a Spanish business must be a structured message, and a PDF alone is not enough (the design's register, RD 238/2026 art. 7.1). The exact end day of each period, and whether a restaurant's F1s to businesses fall inside the regime, are asked as [Q45](../compliance/asesor-questions.md#q45-when-does-structured-business-invoicing-reach-a-restaurants-full-invoices-added-2026-10-07). Researched 2026-10-07 in the watcher session; the fetched texts were not kept in the repository.

## Protected write-path test policy quotation

W41s-7's two run-it reviews found the header of
`packages/fiscal-verifactu/src/write-path.e2e.test.ts` still quoting “no fiscal condition blocks a
sale”. The owner-approved local conflict stop is narrower than that old quotation. The protected
file and all its assertions remain unchanged; reconcile its explanatory header when that protected
file's edit scope is authorised. The live procedure is documented in
[hour recovery](../operations/hour-recovery.md#switch-a-running-box-after-an-invoice-identity-conflict).

## W41s. Fiscal prevention and offline recovery — DESIGN AND REVISED PLAN APPROVED (2026-10-04)

Importing, matching or reconciling recovered history, and any missing-history remedy, stay out:
the owner's answer to Q41 (owner, 2026-11-18, question 10 of the
[19 November sheet](../compliance/2026-11-19-adviser-meeting.md); the adviser is still to confirm the details) is to record what happened rather
than rebuild lost invoices from AEAT's records ([incident record](#an-incident-record-the-venue-can-show-the-tax-office-hardware-faults-a-break-in-lost-data)). Signed witnesses and fencing (W41s-10b) were retired on 9 November
2026: A1342 (#2654) stops a returning old main box once a spare it vouched for has taken over, on
signed newer evidence in the backup bucket. A box restored from backup keeps the old box's id, so
the old box is not fenced after a restore: A1418 part 1 is a plan only
([plan](../superpowers/plans/2026-11-07-a1418-part-1-stop-marks.md)), and until it is built the
guide tells the owner to keep the old box off and disconnected. Keep their authority, recovery and
public fiscal-enablement gates. W41s-10a's remaining qualification work follows.

### Qualify reconciliation against live AEAT

Exercise the startup/daily lookup through the real AEAT service. Retain the taxpayer, node and
environment scope; incomplete or failed lookup remains unknown. Do not treat a lookup result as
freshness, allocation authority or evidence that an old writer stopped. Signed witnesses and
fencing belong to A1342 (landed) and A1418.

### Qualify offline recovery through production TLS

Extend the old-backup/new-hardware exercise (`apps/server/src/restore-missing-history.e2e.test.ts`)
to the production HTTPS connection and fresh device pairing. Keep the administrator
approval, cookie admission, recovered-series and retired counter checks. The loopback HTTP
qualification in #2449 is not a production TLS result.

### Take a till payment through a booted restored server

Left open by W41s-11: restore both archive and stream backups without enrolled devices or
internet time, start the recovered server, pair a fresh till and take a payment through its API.
Check the recovered series, one invoice and one tender, original records, retired counters and replay.
Keep optional browser receipt observations separate from recovery authority; missing storage or
an unlisted invoice number is not proof that a number was unused.

Evidence inspection and persistent-repair policy remain separate A1089 work.

### Task 8 staff refund and held-cancellation qualification, 2 November 2026

`apps/server/src/fiscal-remedy.staff-refund.test.ts` uses a real provisioned venue and the
core sale and void writers. It returns 12.10 in cash through the till's refund route before
voiding the invoice; the refund route deliberately refuses an already voided invoice. The
filing queue sets the ordinary cancellation aside after the original's definitive rejection.
An explicitly enabled synthetic correction is accepted by the real client and fake tax service;
the administrator then releases the same cancellation. Concurrent release and reordered retries
return the saved decision. A refund retry returns the original completed refund. The checks compare
all sale, line, tender, settlement, void, refund, drawer, print-job and series rows, plus the
immutable fiscal rows and chain head after release and filing.

The other cases retain those accounting effects while refusing record-producing remedies for
unknown outcomes, conflicting invoice identities and an already generated ordinary cancellation.
Since A1425 the administrator may release a held cancellation once its original's
correction is accepted, whichever issuing chain the correction is on. The original rejection in
these cases is synthetic stored evidence; they do not send a real refund or establish a legal
remedy. The public permitted-remedy set stays empty. The completed implementation still needs the
owner's fiscal review before landing and separate legal authority before production enablement.

The whole-branch review reproduced a dependency cycle when a correction was appended behind an
ordinary cancellation still waiting to be sent: the cancellation waited for that correction's
answer, while the correction waited behind the cancellation. The action now refuses unless any
existing ordinary cancellation is already held for resolution. It also refuses completed,
failed or unknown cancellation states and a synthetic held absent-original cancellation. Once
the queue has actually held the ordinary cancellation, the same decision can be submitted again,
accepted and followed by its explicit release. No queue-order rule was weakened.

For a definitively rejected delivery, the correction action requires a matching non-null rejection
code on the case and delivery; it refuses code 3000 in either admissible outcome. This aligns the
rejected-record boundary with the sibling remedies. The duplicate-code probe used synthetic
stored evidence: the pinned library's reducer returned duplicate outcomes for the tested 3000
reply variants, not a plain rejection. No claim that normal filing generated that inconsistent
state is made. Accepted-with-errors acknowledgement preservation retains its existing behavior.

The staff suite also exercises the built-in empty policy for all five actions in both deployment
modes. The policy is a permitted-action set shared by those modes; a future enablement decision
must account for that scope. The two Claude reviews' findings and deliberate refusal choice are
recorded in the pull request; a passing synthetic tax-service response supplies no legal authority.

**1 November 2026, Task 8 storage decision (owner).** A correction keeps the invoice's issuer,
number and issue date. Its nullable `corrects_registro_id` names the version it replaces;
a unique index permits one replacement per version, and the invoice-identity index applies
only to originals. This permits successive corrections without updating earlier records.
The generated storage migration adds the column and replaces indexes; it does not rebuild
the table.
Correction payload persistence, administrator-only remedy operations, held-case
resolution and the real AEAT second-correction proof remain part of Task 8 before publication.
Of the disputed production remedies, the corrective invoice (the replacement) is built to file as
an R5 "S" (owner's answers A–E, 2026-11-14) and offered on the case dialog for a simplified invoice
refused for a future date; the others stay disabled pending Q35/Q38/Q40 or a case-specific owner
decision. Q37-FIX enables the correction record and the replacement for rejected records only.

**1 November 2026, Task 8 receipt replay check.** The receipt lookup explicitly selects the
original issued alta by its empty correction link. `record-version-receipt.test.ts` stores
three versions with different issuer names, VAT and totals, then compares the replay with the
original receipt under both ordinary and reversed unordered-query traversal. Before that
filter, the reversed traversal returned the second correction's figures. This check covers
receipt replay, not the remaining current-version filing and remedy decisions.

**1 November 2026, Task 8 marker and append checks.** `Subsanacion`, `RechazoPrevio`
and `SinRegistroPrevio` have nullable stored columns. The payload round-trip cases compare the
built and rebuilt records and their XML markers, including explicit `N` and omitted fields.
The append cases exercise successive correction links after an unrelated sale, retain older
rows and recompute the new fingerprints. A competing replacement receives
`fiscal.record_already_corrected`; a missing target, different invoice, sale or node, an
anulación target or an absent correction flag receives `fiscal.remedy_invalid`.
The generated marker migration adds columns without rebuilding the table. These checks do
not implement administrator remedy actions, select the current version for filing, resolve held
cases or prove acceptance by AEAT. Those remain Task 8 work before publication.

**1 November 2026, Task 8 cancellation and consultation checks.** The cancellation queries use
the alta with no replacement. `drain.record-versions.test.ts` exercises two corrections: older
refusals do not set aside a cancellation after the current version is accepted; an unknown
current outcome keeps the cancellation and its later records unsent; a refused current version
sets the cancellation aside. A held cancellation is not set aside using an older refusal while
the current version is unknown. Every case compares the immutable record rows before and after.

`reconcile.record-versions.test.ts` exercises a consultation reporting only the second
correction's reference. Earlier delivery rows and acknowledgements stay unchanged; the current
version still receives lost-acknowledgement recovery or no-trace resubmission. The reconciliation
write transaction rechecks which versions remain current after the network request; a correction
appended during that request prevents a stale resubmission of its predecessor. These tests use
the library's fake authority; live second-correction acceptance, the administrator action boundary
and held-case resolution remain unfinished.

**1 November 2026, Task 8 payload and backend version admission.** The row converter refuses
optional library fields without stored counterparts rather than silently discarding them, including
explicit `N` flags. It also refuses caller-supplied `RefExterna`: the drainer assigns the stored row
id when submitting. Credit-note and substitution admission use the unreplaced version's invoice
type; a correction from F2 to F1 therefore refuses the existing R5/F3 paths, while a correction to
F2 permits them. Void identity and origin come from the issued original, while its chain pointer
uses the current head. These are synthetic storage and backend checks; no new remedy is enabled.

**1 November 2026, Task 8 administrator action boundary.** The fiscal module grants
`fiscal.remedy` to administrators only. `applyRecordCorrection` checks the live management
session and the caller's server policy before creating a correction and its case-resolution event
in one transaction. A retry with the same decision returns the saved record and event; changed
facts under that action key are refused. Its checks include the target node and environment on
replay. The synthetic cases retain original record and delivery rows, exercise two successive
version cases and report a malformed predecessor without rewriting it.

The public `POST /management-api/fiscal-records/remedy` route refuses every remedy kind.
Client-supplied enablement and operator fields cannot grant authority. No production action is
enabled. The HTTP adapter covers synthetic corrections to stored invoice facts for rejected records
and records accepted with errors. The separately gated synthetic absent-original operation is
described below. The separately gated corrective HTTP adapter is also described below. Resolution
of existing held cancellations and manual brake release now have the synthetic paths described
below. Actual staff cancellation/refund qualification remains Task 8 work. The live second-correction
prerequisite is recorded in the dated entry below.

**2 November 2026, Task 8 synthetic corrective-invoice transaction.** The internal operation
uses the existing core correction writer, which now accepts a management session and still checks
`sale.rectify`. The remedy operation separately checks the live administrator's `fiscal.remedy`
permission and its server policy. It requires a current alta with a matching rejection or
accepted-with-errors case and delivery evidence; unknown outcomes, duplicate conflicts and an
already generated cancellation are refused. It binds the original sale and issuing node from the
selected record and host, then writes the corrective sale, its numbered R5, delivery and case event
in one transaction. The earlier sale, fiscal rows and tenders remain unchanged in these tests.
Retries compare the complete decision and return the saved sale, record and event without another
number or payment. A failed resolution rolls the accounting and number allocation back.

`record-remedy-corrective.test.ts` exercises this internal transaction with real accounting and
fiscal writers. No new production remedy is enabled.

**2 November 2026, Task 8 synthetic corrective HTTP boundary.** With a test policy explicitly
allowing `corrective-invoice`, the management route passes validated signed line facts to that
transaction. The host supplies the node, deployment environment and clock; the action uses
`operator_script` origin and the authenticated administrator. Client claims for those values are
refused. The wire input accepts the series, total, operation description, whole-invoice flag and
lines with number, name, language descriptions, quantity, unit price, VAT rate and base, plus
optional gross amount, product id and original-line id. Other line metadata is refused rather
than discarded. Core retains its accounting, whole-invoice, line-reference and series checks.

`record-remedy-corrective-http.test.ts` exercises the real route and writers, including distinct
production/preproduction stamps, fractional quantities, whole-invoice credits, parallel retries,
changed decisions, live write authority and clock refusals. These synthetic operations leave the
earlier sale, fiscal records and payment/refund rows unchanged. The route's default policy remains
empty. Existing held-record and manual brake release have separate synthetic paths below. Actual
staff cancellation/refund integration remains unfinished; this HTTP milestone does not complete Task 8.

**2 November 2026, Task 8 synthetic held-cancellation release.** A cancellation already set
aside has its own immutable identity, so this operation submits that existing record. With a test
policy allowing `release-held-cancellation`, you name the held cancellation, its case and the
accepted current invoice version. The operation requires the same sale, invoice identity and
environment, a cancellation written by this box or a box in its takeover history (since A1425
the accepted version may be on any issuing chain), an ordinary cancellation still set aside, and
its matching `fiscal.anulacion_retenida` case. A pending, unknown, rejected, accepted-with-errors or superseded
invoice version is refused. Production policy remains empty.

The delivery becomes pending and due at the action's clock reading, its held acknowledgement is
deleted, and a resolution event records the signed-in administrator and complete decision in one
transaction. The event names no new remedy record. Changed decisions or another administrator
cannot reuse the action key. A retry returns the saved release even after submission; it still
checks the current administrator, server policy, writable host, node and environment. An earlier
different resolution rolls the delivery and acknowledgement changes back.

`record-remedy-held.test.ts` sends a correction through the real client to the fake tax service,
releases the held cancellation, and then submits that same cancellation. Its fiscal rows, chain
head and sales stay unchanged by the release. This synthetic exercise does not qualify the actual
staff cancellation/refund path or a production legal remedy. Those remain before whole-item review
and publication. Since A1425 (#2570) a new cancellation goes on the chain of the box running now,
whichever box made the sale.

**2 November 2026, Task 8 synthetic absent-original cancellation.** An administrator explicitly
selects the operation for a current rejected alta with matching case evidence. Unknown outcomes,
duplicate conflicts, a different case, an existing cancellation and a superseded version are
refused. The new immutable cancellation keeps the invoice identity and issued origin, carries
`SinRegistroPrevio=S` and joins the current chain head. Its delivery and resolution event commit
together. A retry compares the complete decision and returns its saved result without another
append. These checks leave sales and earlier fiscal rows unchanged; they do not qualify a staff
refund or resolve an already generated unsuitable cancellation.

The filing loop distinguishes this stored absent-original operation from an ordinary cancellation
of a rejected original. Synthetic filing tests send the former and retain the ordinary hold.
The production enabled set stays empty. This is an engineering path under the plan's synthetic
gate, not an adviser answer or a new live AEAT receipt. Historical descriptions of ordinary
cancellation holds below retain their original scope.

**2 November 2026, Task 8 live second-correction prerequisite.** Verifactu
[#150](https://github.com/waitron-io/verifactu/pull/150) adds the manual `double-correction`
probe. Its single authorised [AEAT TEST run](https://github.com/waitron-io/verifactu/actions/runs/41370629637)
submitted an original alta and two description corrections under invoice
`CI/20261102/41370629637-DOUBLE`, dated `02-11-2026`, on one synthetic installation.
All three batch and line replies were `Correcto`, without an error code. Each correction kept
that identity, used `Subsanacion=S` and `RechazoPrevio=N`, and linked to the preceding version.
The final consultation returned one `Correcto` record with the second correction's description,
fingerprint and link to the first correction.

The [dated evidence](../superpowers/specs/2026-11-02-aeat-double-correction-evidence.json)
retains the records, parsed replies and request/reply SOAP after identity masking. You can use
this as the Task 8 storage design's live prerequisite for two successive corrections. It does
not settle which invoice errors legally permit that remedy or enable production policy.
Rejected originals, changed money or tax, actual staff refunds and held-record resolution remain
outside this run; the remaining Task 8 workflows still need implementation and qualification.

| Source, checked 2 November 2026 | Exact words | Observation |
| --- | --- | --- |
| [AEAT TEST run 41370629637](https://github.com/waitron-io/verifactu/actions/runs/41370629637), three submission replies | `EstadoEnvio: "Correcto"`, `EstadoRegistro: "Correcto"` | The original and both S/N description corrections received those states. |
| Same run, final consultation | `ResultadoConsulta: "ConDatos"`, `EstadoRegistro: "Correcto"` | One record carried fingerprint `BB7FFF9845DDB687E31FA5404A273EE186F9D3FAF6FC8EC7B8A04E00ECF2F3F1` and description `Double correction probe: secondCorrection`. |

**2 November 2026, Task 8 corrected-fact requests.** The synthetic HTTP adapter accepts partial
corrections to the stored description, issuer name, invoice type, recipients, tax breakdown, total
and tax amounts, corrective/substitution references and correction amounts. Omitted fields keep
the selected version's facts; explicit null removes optional recipients or correction fields from
the new version. The invoice's issuer tax number, number and issue date remain unchanged. Reference
calendar dates survive a change in generation offset. Amounts must be exact decimal strings;
nested unknown fields and malformed choices are refused before the record builder, which still
validates the complete record. The saved decision includes all supplied facts and the prior outcome,
so changing a fact on retry refuses while object key order does not matter. Tests compare original
records, deliveries and sale rows. These are synthetic record corrections, not new accounting or
refund operations; all production remedies remain disabled. _2026-11-11: a changed rate, base, VAT,
total or correction amount is now refused with `fiscal.remedy_amount_changed`, before the saved
decision is compared; a changed tax type, regime, taxed or not-subject class or exemption reason on
a breakdown line is refused with `fiscal.remedy_class_changed` at the same point; see [A1481](#a1481-a-fix-never-changes-an-invoices-amounts-owner-2026-11-11)._
_2026-11-14: Q37-FIX enables the correction record in production, for rejected records only; see
the W41s entry. A changed
issuer name is refused with `fiscal.remedy_issuer_changed`; a changed invoice type, recipients,
correction type, corrected invoice or replaced invoice, or null for one the record carries, with
`fiscal.remedy_printed_fact_changed`._

**2 November 2026, Task 8 explicit accepted-with-errors description decisions.** With a synthetic
server policy, `priorOutcome: "accepted-with-errors"` requires both an accepted-with-errors delivery
and that cause on the selected filing case. The correction retains `Subsanacion=S` and
`RechazoPrevio=N`; the rejected path retains S/X. Omitting the selection means rejected, so omitted
and explicit rejected decisions share one saved result. A changed selection under a saved action
key is refused. Retries after a later delivery outcome and clock change preserve the saved result.
The tests compare earlier records, deliveries and case facts, including two successive synthetic
accepted-with-errors corrections. These are local engineering checks, not AEAT acceptance or a
decision that a particular invoice error permits this remedy. Production policies remain empty.
_2026-11-14: Q37-FIX enables the correction record in production for rejected records only; a
correction of an accepted-with-errors case stays refused (`fiscal.remedy_disabled` naming
`priorOutcome`) unless a policy carries `ACCEPTED_WITH_ERRORS_CORRECTION`. A record of a former main
this box took back keeps the reach A1342 gave it, both outcomes. Checked by the default-policy and
returned-record cases in `packages/fiscal-verifactu/src/record-remedy-http.test.ts`; see the W41s
entry._

| Source, checked 2 November 2026 | Exact words | Scope |
| --- | --- | --- |
| [AEAT service description v1.0.3, §9.1.2, p.56](https://sede.agenciatributaria.gob.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Veri-Factu_Descripcion_SWeb.pdf) | “No informar <RechazoPrevio> o informarlo con valor N” | The ordinary correction operation uses S with an absent or N prior-rejection marker. The section covers accepted records, including acceptance with errors, when another invoicing remedy is not required. This does not settle the adviser's open questions. |

**1 November 2026, Task 8 synthetic HTTP description correction.** With an explicit server-side
test policy, the route appends a correction and resolves its case. It accepts a description, case
and record references, reason and action key; it refuses unknown fields, including client claims
about policy, operator, node, deployment, software identity or generation time. Boot supplies
record-generation facts through the module route context. Its write check reads the current mode,
primary role and fence and requires trading admission; the adapter binds the clock to the stored
issue zone inside the write transaction. The invoice identity, amounts, tax breakdown, recipient
and corrective/substitution fields come from the selected immutable record. Tests preserve these
fields across a summer-to-winter offset change and retain the original invoice calendar day.

The saved decision excludes server generation facts, so a retry after the clock advances returns
the committed record and event. A changed description under that action key is refused; a changed
original delivery outcome after commit does not generate another correction. Two successive
rejected versions are exercised through HTTP with the earlier records and case facts retained.
These are synthetic checks, not AEAT acceptance or legal enablement. The production policy
remains empty; every disputed production action is refused.

 Earlier
Task 7 automatic-switch requirements below are historical; the 1 November decision supersedes them.

**2026-10-12, a conflict no longer holds its chain (owner).** A record AEAT refuses as a duplicate
(3000) while holding a different or cancelled record under that key is now `rechazado` with code
3000, with its incident and filing case, and the chain's later records are still sent
(`handleDuplicate`, `packages/fiscal-verifactu/src/drain.ts`). AEAT preproduction accepted, without a
warning, a later record after a conflict over changed contents; none after a conflict over a
cancelled record was tested ([W41s-1c receipt](../superpowers/specs/2026-10-04-fiscal-prevention-and-offline-recovery-design.md#successor-receipt-2026-10-12-w41s-1c-both-probes-re-run-with-fresh-chains)).
Three conflicts in a row now trip the same-code brake; the owner wants them to switch to a fresh
number series automatically and keep selling instead (needs Tasks 4 and 7). A cancellation whose
original AEAT refused is now set aside on its own (envío state `retenido`, migration
`0005_envio_retenido`) with an `error` incident and a filing case, both `fiscal.anulacion_retenida`,
and holds nothing behind it; one already held behind its original is set aside in the transaction
that records the original's refusal. The three-refusal brake does not see a set-aside record: it
neither breaks a run of refusals nor counts towards one.
A record accepted with errors opens a filing case unless AEAT exempts the code (2004, 2009); a
re-sent one AEAT answers as a duplicate (3000), and one the reconciliation sweep corrects
(`reconcile`, run by the daily reconciliation sweep), are judged by
the stored copy's own error, read from the duplicate detail or AEAT's consulta. What
still holds later records: the three-refusal brake and the wait behind an unknown answer.

**2026-10-13, old-backup authentication:** the owner chose the verifier in the selected
backup for cold restore; live takeover keeps the live verifier. The key name is now stored
beside each newly minted verifier, shown with the handover secret, and read from the placed
backup before the restore authentication callback. The runbooks warn you to keep older paper
keys until no backup from before their replacement remains. No outside current-key record is planned.

**2026-10-12, standby decision:** the owner selected dormant reservation at join and activation at
takeover. _2026-11-14 (A947 3b-F):_ for a Veri*Factu spare, nothing fiscal is reserved at the join and the
activation writes its dormant setup first (option (c) of the [3b plan](../superpowers/plans/2026-11-04-a947-3b-spare-hosts-store.md)'s question Q1; the owner's choice is recorded only as the campaign watcher's relay of 2026-11-04). Historical signature verification
is separate from current outside consumption; it does not authenticate the caller or prove the
current register state. Takeover must
authenticate the administrator, isolate the old box, rule out parallel recovery and check
outside consumption before atomic activation. All three invoice purposes stay separate.

**Update, 2026-10-04:** the owner requires prevention before conflict recovery, including an
old-backup restore on new hardware with no internet. The
[revised design](../superpowers/specs/2026-10-04-fiscal-prevention-and-offline-recovery-design.md)
records manual recovery, a paper allocation register in the recovery pack, an optional cloud
registry reachable by phone, emergency random series and an explicit later switch to a fresh
short series. Device evidence is optional. Matching invoice date and amounts no longer excuse
a fingerprint mismatch. Q5(f) and Q33–Q40 in the adviser document are revised, and Q41 covers
issued invoices missing from the backup. The owner approved this design ("lgtm") and selected
queue execution. The [revised implementation plan](../superpowers/plans/2026-10-04-fiscal-prevention-and-offline-recovery.md)
separates development from production-enablement gates: prevention and evidence work can
proceed while adviser answers are pending; disputed remedies retain explicit gates. It includes
an allocation-contract checkpoint, live AEAT probes, offline recovery, corrective workflows and
a separately owned Cloud registry workstream. The owner approved the revised plan on 2026-10-04;
it replaces the 2026-10-03 task list while W41s remains the backlog item. The owner approved
the allocation and recovery contract in §9 and granted W41s-4 a narrow H2 scope exception on
2026-10-05. Task 2 landed as [#1213](https://github.com/clintongormley/waitron/pull/1213).
W41s-1 completed eight synthetic preproduction probes;
[the dated protocol receipt](../superpowers/specs/2026-10-04-fiscal-prevention-and-offline-recovery-design.md#71-protocol-receipt-2026-10-05-w41s-1)
records each outcome and its limits; the library probe PR is
[waitron-io/verifactu#132](https://github.com/waitron-io/verifactu/pull/132) (no release tag was created).
**Update, 2026-10-05 (W41s-1d):** [the asesor questions](../compliance/asesor-questions.md)
Q33–Q41 and [the findings, §16](../compliance/verifactu-findings.md#16-aeat-test-service-observations-for-conflict-recovery-added-2026-10-05-w41s-1)
now carry the test-system receipts and their limits. The legal questions remain open.
W41s-10c landed as [#1264](https://github.com/clintongormley/waitron/pull/1264). A231 #1256 has
landed before A948 enabled the prepared table and unpaid-departure F1 paths. **Next action:** continue the approved dependent W41s tasks in campaign order,
keeping each task's fiscal and adviser gates.
**Update, 2026-10-12 (W41s-1c re-run):** the clock fix merged as verifactu
[#141](https://github.com/waitron-io/verifactu/pull/141) and both probes ran again on its main
commit; [the dated receipt](../superpowers/specs/2026-10-04-fiscal-prevention-and-offline-recovery-design.md#successor-receipt-2026-10-12-w41s-1c-both-probes-re-run-with-fresh-chains)
sits beside the partial one. Every line was free of 2004. The successor after a 3000 refusal,
the batch successor sent with its refused predecessor, the next successor after it, and the
successor linked to an unsent cancellation all returned `Correcto`. An exact re-send of the
accepted batch successor returned `Incorrecto`/3000 with `EstadoRegistroDuplicado` `Correcta`.
No consulta, production run or legal answer is behind this; existing holds are unchanged.

**Update, 2026-10-12 (W41s-3d):** PR
[#1309](https://github.com/clintongormley/waitron/pull/1309) adds an hourly retry of the first
eligible brake-held record. An accept or a different-code refusal can release the remaining
brake holds; a same-code refusal keeps them held. A record with its own filing case, an earlier
held record, an unresolved earlier send, a cancellation of a refused original or a different
environment is not probed. The alert's “Since” stays at the time the run reached three
same-code refusals, including after refused hourly retries (owner, 2026-10-12).

**2 November 2026, Task 8 synthetic manual brake release.** With a test policy explicitly
allowing `release-brake`, you name the first held record, the holding refusal's case, your reason
and an action key. The administrator action makes that record pending and due immediately. It
uses the drainer's brake eligibility: three matching refusals immediately before it, no earlier
held or unanswered record and no case of its own. An ordinary cancellation of a refused current
invoice remains held. The action leaves the attempt count and previous send facts unchanged,
clears the held acknowledgement and records a note in the same transaction.

A note permits a retry; it does not resolve the original refusal. Later held records still wait
until the released record's answer breaks the refusal run. Another refusal with the same code
keeps them held. The request can be retried after submission without changing delivery again;
current permissions, host identity, writable status and server policy are checked again. The
public policy stays empty. `record-remedy-brake.test.ts` exercises these outcomes through the
real client and fake tax service, including a rollback when the note cannot be stored. This
synthetic path does not qualify actual staff refunds or enable a production remedy.

A line AEAT moves away from
its record's position is never applied, so that record stays unknown and is retried unless an
earlier record on its chain is on hold, while records whose line is still at their position are
applied as usual. A record whose line AEAT moved in every reply it was sent in would never be
confirmed: Route B's lookup never runs for it, each retry sends it again in the same chain order
while the later records of its chain wait behind it — loud (an alert per record) and never a wrong
acceptance. One option for the owner, not built: after a mismatch, send
each unknown record again in an envío of its own. An incident is not stored while one with the same
code for the same sale is open, so while a `fiscal.respuesta_descuadrada` is open for a sale, a later
mismatched reply to an envío whose first record belongs to the same sale (that record again, or the
sale's cancellation) keeps none of its lines.

**2026-10-22, A985 observation:** the cancellation-reply identity question is
answered for the two synthetic cancellation submissions in
[run 39721604913](https://github.com/waitron-io/verifactu/actions/runs/39721604913): both replies
named the cancelled invoice and operation `Anulacion`. The unchanged retry returned `Correcto`,
not duplicate `3000`; its lookup returned `Anulado` with the cancellation's fingerprint.
The duplicate-response path remains unobserved in this run. See the
[dated findings and limits](../compliance/verifactu-findings.md#19-cancellation-replay-zero-total-and-wrong-fingerprint-added-2026-10-22-a985).

**W41s-4 reconnect qualification, recorded 2026-10-12:** extend the reconnect qualification
through the recovery runtime path; the recorded test exercises an offline and then successful
fiscal drain without a series switch.

## C126 (cancelling an order whose invoice was issued credits it; owner, 2026-10-02, option b, decided without the asesor) — landed as #1030

**11 November 2026, A840:** Counter's Cancel and credit entry is retired. The
unpaid-departure move route check refuses a closed party with `party.not_open`
and finds no invoiced Counter waiting row for that bill. The shared server
invoice-credit/PIN branch and its financial tests remain: a later cancellation
of the departed bill requires correction authority and writes its credit note
(`cancel-invoiced-order.test.ts:838`). The account below records the earlier counter entry.

- **C126 (cancelling an order whose invoice was issued credits it; owner, 2026-10-02, option b,
  decided without the asesor) — landed as #1030.** `POST /api/working-orders/:id/cancel` (`cancelPlacedOrder`,
  `apps/server/src/working-order.ts`; the credit in `apps/server/src/cancel-credit.ts`) issues
  an R5 corrective invoice, by differences, for the whole invoice. The PIN override is B33
  (#1041). The owner dropped the dashboard Orders screen's "Invoice not credited" mark
  (2026-10-02 ~12:05): such a bill is to show as Cancelled with its credit note. Open:
  - **B32 (the till offers "Cancel and credit"; owner, 2026-10-02 ~12:05) — landed as #1055.**
    The dialog's dismiss button reads "Keep the bill" ("Mantener la cuenta"), not the
    shared "Cancel" beside "Cancel and credit" (owner, 2026-10-02). The owner also kept the
    cancel's answer empty, so the till goes on reading the credit note's number from the bills.
  - **Done by B34 (#1077, 2026-10-03; owner, 2026-10-02): a counter order invoiced when it was placed and still
    unpaid can be cancelled with a credit note at the till.** The waiting list "is drawn only
    inside the held-orders card" (Task 16, in [till.md](till.md#task-16-981-counter-handover-with-b25-b26-b29-b30)), so a till layout without that card offers no Cancel and
    credit for counter orders either. How it differs from the table's path, and what is left open:
    - **The result does not name the credit note.** The table's dialog reads the credit note's
      number from the party's bills; the waiting list drops a cancelled order, and the cancel's
      answer is empty, so the dialog says "A credit note was issued and the bill is cancelled"
      without a number. Naming it would need the number from somewhere new; not decided.
    - **A cancel that gets no answer is never shown as done.** On the table, the till reads the
      bills again and shows a bill now cancelled as done. On the counter, an order missing from
      the list may have been cancelled, or may have left it another way (paid and handed over,
      say), so the dialog says the cancel may have been made and to check the waiting orders (a
      new sentence, `cancel_credit.unconfirmed_counter`). The dialog shows this first, and then the
      till reads the waiting list again.
    - Unlike the table's button, the counter's does not check for a payment on the order. Two ways
      of giving a placed counter order a bill payment were tried while building B34 and both were
      refused: taking the payment on the placed order (`working_order.not_open`), and placing an
      order already holding one (`bill.payments_received`). Other ways were not looked for. If an
      order does hold one, the cancel refuses it with `bill.payments_received`, after the
      `sale.rectify` check, and the dialog says so.
  - **`GET /api/cancel-credit-authorizers` (B33) lists the active holders of `sale.rectify`.**
    Every role holding `sale.rectify` today also holds `sale.refund`, `sale.void` and
    `cash.drawer`, so its cases cannot tell which of those it reads.
  - **Done by C132 (landed as #1060, 2026-10-03): a credit note's line names the invoice line it reverses.**
    `sale_lines.corrects_line_id` (core migration `0070_sale_line_corrects`, a foreign key to
    `sale_lines.id`) holds, on a corrective invoice's line, the original line it reverses or
    adjusts. A partial correction keeps the looser rule: its lines may name a line or not. No
    report reads the link yet. Open, for partial corrections only, which no product code makes yet
    (only tests and demo scripts do): whether a line a correction ADDS (a new charge, not a change
    to an invoice line) stays unlinked, and whether two adjustments may name the same invoice
    line. When a report starts reading the link it will want an index on the column, as
    `sales_corrects_idx` serves `sales.corrects_sale_id`.
  - **A fully credited bill's original invoice can still be reprinted**, from the till and from
    the dashboard; the server allows it. Whether a reprint should say the invoice was credited is
    not decided.
  - **Left in the dashboard Orders plan and spec after #1034 landed beside C126:** their banners
    still say C126 "is to" credit the bill (it is built); the plan's owner-answers row 7 still says
    "Task 2, as written" for the dropped mark; its Task 1 voided-bill case still lists
    `invoiceNotCredited: false` with no pointer to the drop; and #1034 did not write its planned
    test that a cancelled bill with an invoice shows its credit note.
  - **An invoice that already has a correction cannot be cancelled.** One that lowered it leaves
    less than the whole credit takes back, so the cancel is refused
    `sale.correction_exceeds_total`; one that raised it is refused `sale.correction_not_whole`,
    because a whole credit must be the invoice's first correction. Both are cases in
    `apps/server/src/cancel-invoiced-order.test.ts`. No route issues a credit note other than this
    one.
  - **The credit note is not printed** for the customer (asesor Q32 (b)).

## Uncertain receipt delivery

Automatic receipt transport retries and manual retries of exhausted original jobs on their own
printer retain their payload. If a printer printed before its reply was lost, sending those bytes again can produce
another unmarked sheet. Moving an original still waiting on a disabled or unseen
printer ends it there and queues it on another printer, laid out again and still unmarked; a waiting job
whose earlier attempt failed may have printed before its reply was lost, so the move carries the
same uncertainty. A991 contains repeated original requests and refuses resending a job recorded as
completed; it does not establish that an uncertain transport attempt printed nothing.

Next action: design recovery for uncertain physical delivery across automatic retries and explicit
retry actions, retaining the customer's route to a legible invoice. Do not describe the outbox's
job count as a physical exactly-once printing guarantee.

## A888. After A795 lands: the owner's checks with real certificates

- **Left open by A795.** These were A795's landing condition until the owner approved landing it on
  2026-10-19 before they ran; the owner runs them with real certificates afterwards. Each is a question the
  [design](../superpowers/specs/2026-10-18-a795-aeat-certificate-after-setup-design.md) (§8) and
  [plan](../superpowers/plans/2026-10-18-a795-aeat-certificate-after-setup.md) (§3, decision 11)
  could not answer from a source or a test server.
- Run them with the operator harness, which opens the file and asks AEAT a read-only `consultar`
  with the code an install runs, and files nothing. Its variables are listed in
  `apps/server/README.md` ("Installing or replacing the AEAT certificate after setup"):
  `pnpm --filter @waitron/server test:preprod --reporter=default src/aeat-certificate-check.preprod.test.ts`
  (file `apps/server/src/aeat-certificate-check.preprod.test.ts`).
- The checks:
  - a consulta to production AEAT, and a consulta with a company seal at `www10`;
  - each type at the other type's address: a seal sent to `www1` and a representative certificate
    sent to `www10` (`WAITRON_CERT_CHECK_ADDRESS_KIND`), which says whether the live check catches
    a wrong type;
  - how AEAT answers an expired certificate: refused during the connection (and with which error,
    `other side closed` or `ECONNRESET`), an HTTP error or SOAP fault, or a reply refusing each
    record;
  - where a real seal keeps the company's tax ID, and whether real representative certificates all
    carry `organizationIdentifier` and `O`;
  - whether files exported by FNMT's own procedure, by the browsers the export guides cover and by
    the Mac keychain use the old RC2 encryption; if they do, the guides say how to export with AES;
  - a non-ASCII passphrase: the tests use ASCII passphrases only, because a test file built with
    one could not be opened by Node (plan §3);
  - where an AEAT error number arrives in a refused consulta. This decides whether the design's
    "AEAT refused this certificate for {taxpayerNif} ({codigo})" sentence is built; today a SOAP
    fault is shown with the code and reason AEAT sent (plan decision 11).
- If any of them answers differently from the design, the affected part is redesigned in a
  follow-up.

## A853. The box makes a company seal's private key itself

- **Decided out of A795 (2026-10-18), design §2.7 and §3.9.** FNMT's seal procedure: «Esta operación
  deberá realizarse en una máquina del suscriptor» — the key pair and certificate request are made on
  the subscriber's machine, and FNMT returns only the certificate
  (`docs/compliance/getting-to-production.md:181-182`, `:199-200`; `action-plan.md:108-109`). Setup
  and A795 both install only a `.p12` file, so a seal's key has to be made on another computer and
  moved to the box. The flow: the box makes the key and the request, shows the request to paste into
  FNMT's form, keeps the key while the request is with FNMT, and takes back only the issued
  certificate. One design for setup's first install and for renewal on A795's card. It also decides
  whether the box keeps the previous seal's key, since the owner then has no file of their own, and
  what the card shows while a request is pending.

## VAT rates per product, eaten in or taken away (was: VAT at line add, M7v, A68)

The owner's brainstorm of 16 November 2026, paused for the adviser: VAT classes go; each product
keeps a dated history of two rates, one for eating in and one for taking away, chosen from the
rates AEAT accepts (0, 2, 4, 5, 7.5, 10 and 21), and a change can be scheduled ahead; an invoice
takes each product's rates on the day its meal ends, and a deposit keeps the rate of the day it
was paid. The owner's answers of 18 November (owner, 2026-11-18, questions 4 and 5 of
the [19 November sheet](../compliance/2026-11-19-adviser-meeting.md)); the adviser is still to confirm the details:

- the two dated rates, taken on the day the meal ends: "correct". This also settles asesor Q26
  (the rate on the day of issue).
- A drink rung up at the counter as drunk on the premises stays at 10% when the customer carries
  it out, and staff may ring it up that way when the customer says nothing: "yes".
- A set menu carries its own eat-in and takeaway rates and can include dishes at any rate.
  Surcharges and paid extras sold as part of it use the menu's rate
  ([A1515](menu.md#a1515-set-menus), watcher, 18 November at 20:28).
- **Waiting:** drinks served in the restaurant without food may take 21%, certainly once the
  kitchen has stopped serving; unsettled, and the adviser will come back on it.

A rate found wrong later goes on the [report for the accountant](#a-report-for-the-accountant-corrections-to-filed-quarters-wrong-vat-rates-and-free-meals). Next: write
the design and get the owner's approval. From M7v, owner rulings
at landing (2026-09-27): invoice-first issues at placing, so it takes the placing day's rate; a
box holding order lines is reset rather than given data-migration code; and every invoice path
reads its one clock after the order's lines. `apps/server/src/vat-class-at-line-add.test.ts`
copies its setup from `issuance-pass.test.ts`; a shared helper could absorb it. The till computes
a basket VAT split (`vatBreakdown`, `apps/till/src/state/working-order.ts`) that no screen shows.

## Correcting a paid invoice: what A802 left open

Staff correct part of a paid invoice from **Correct invoice** on a past receipt (A802, the
[design](../superpowers/specs/2026-10-20-a802-partial-paid-invoice-correction-design.md) and the
[reshape plan](https://github.com/clintongormley/waitron/blob/465e5915389b464a5d6f34937b02f777a0305ec0/docs/superpowers/plans/2026-11-12-a802-reshape.md); how it runs is the
[owner's decision](#a802-a-correction-runs-like-a-bill-in-reverse-owner-2026-11-12)). Left open by
A802 slice 5b (#3108):

- **Picking how many of a dish to correct:** the window ticks whole dishes. The bills-and-tables
  brainstorm (2026-10-17/18) moves order lines to one portion per line; a correction then picks
  portions the same way staff pick dishes to move.
- **Counting an earlier ordinary refund towards a correction:** the design's assignment of earlier
  refunds is not built, so such a refund stays unrelated.
- **A refund of cancelled dishes files its corrective in the same step.** A758 §3.8 (revised
  2026-10-19 for the owner's Q43 notes): a dish cancelled on a paid bill with its Refund tick on is
  refunded through the ordinary refund, with no correction of its own. Owner decision (Q43 e,
  2026-10-18): once A802 lands, a refund of cancelled dishes files their partial R5 in the same
  step. §3.8.1 there has a worked example: €5.50 back at 10% is an R5 of −€5.50, base −€5.00, VAT
  −€0.50.
- **Money given back as goodwill takes a corrective.** Asked whether a €10 goodwill return on a
  paid €62 ticket needs a corrective, the owner answered "yes" (owner, 2026-11-18, question 6 of the
  [19 November sheet](../compliance/2026-11-19-adviser-meeting.md); the adviser is still to confirm the details); the sheet
  records as open that the "yes" does not say which of the two choices it answers, and reads it as
  the corrective being required. Today a refund files a corrective only when it is a leg of an
  invoice correction (`refundSettledTender`, `apps/server/src/tender-refunds.ts:144-146`), and the
  A802 design leaves a served dish's goodwill return to the ordinary **Refund a payment** on purpose
  (`docs/superpowers/specs/2026-10-20-a802-partial-paid-invoice-correction-design.md:301-302`).

Also open, from before A802:

- **The derived correction path**, which works out VAT by rounding, checks almost nothing against
  the invoice: a −12.00 corrective whose lines came to −12.10 was accepted (from `e56323007c`, #982;
  the runs in the [A802 slice 3 plan](../superpowers/plans/2026-11-10-a802-correction-history.md)).

## A report for the accountant: corrections to filed quarters, wrong VAT rates and free meals

Settled by the owner's decisions D6 and D12 of 2026-11-16, after the tax adviser's answers 1.12 and
1.13 ([what they change](../compliance/2026-11-15-adviser-answers.md), Parts B6 and B13), then
kept and widened by the owner's answers of 18 November (owner, 2026-11-18, questions 5, 6 and 8 of
the [19 November sheet](../compliance/2026-11-19-adviser-meeting.md)); the adviser is still to confirm the details. Waitron files nothing itself:
each case goes on a report for the accountant, who decides what to file.

- **Corrections to a filed quarter** (question 8: "yes"). A quarter's VAT report counts that
  quarter's own invoices, with corrections made to them within the same quarter, and a filed
  report never changes. Any later correction of an earlier quarter's invoice (a cancellation, a
  corrective, a wrong date, a wrong rate, an invoice issued after its meal's quarter) is left out
  of the current quarter, whichever way it moves the VAT, and listed by original quarter and rate,
  reductions and additions apart. That holds when the error is found only after the next quarter
  is filed too: "any correctives to the previous quarter should be reported in the correctives
  report."
- **A VAT rate set too low** (question 5). Customers' tickets stay as they are and nothing goes to
  AEAT: the law bars charging customers the difference (LIVA 89.Tres.1.º). The VAT owed is worked
  out per invoice line, treating the price charged as including the right rate, and the product's
  rate is corrected for future sales.
- **A VAT rate set too high** (question 5): "we just produce a correction report which goes to
  the accountant", who decides whether to ask for the earlier return to be corrected.
- **Meals given free** (question 6). A free meal is a self-supply (autoconsumo), taxed at cost,
  only when given in exchange for services; one given as marketing, to a loyal customer, after a
  bad experience or to an employee is not, and then the VAT paid on its ingredients may not be
  recoverable. In the owner's words, "This is way too complex for us to handle automatically in
  Waitron, instead this should be part of some report that we make available to the accountant to
  decide what to do." So the report lists what was given free, with its reason; the owner gave
  a margin as one basis for the cost (a 30% margin makes the cost 70% of the price).
- Today `packages/reporting/src/vat-return.ts` counts a corrective in the quarter it is issued, at
  the original's rate, and moves a wrong-date corrective's VAT back to the real day, changing a
  filed quarter's figures (read, not run).
- How a wrong rate is recorded on the product waits on the design of
  [VAT rates per product](#vat-rates-per-product-eaten-in-or-taken-away-was-vat-at-line-add-m7v-a68).

## "No tax (0%)" is an open fiscal question, and it must be answered before the first live filing

The 2026-10-09 research found the only 0% rate in the VAT Law is art. 91.Cuatro, goods
donated to non-profits; the 0% on basic foods ended on 30 September 2024.

From **The product editor and menu (#345, #379, #387) — what is left open.**
[Operator guide](../../apps/server/src/guide/en/products.md); [developer guide](../developers/products.md).

- The selector shows the menu's zero-rate class under that name; pricing puts the
  whole gross in the base with zero VAT, and Veri\*Factu files it as `S1` — taxable, not exempt — at
  a 0.00 rate. AEAT separately requires a _non-subject_ operation to record its cause (`N1`,
  Articles 7, 14 and others; `N2`, place-of-supply rules), and nothing established that any of this
  venue's products is legally non-subject. Asesor question Q20 asks which intended cases belong in
  `S1` and which need `N1` or `N2`, and whether the label should read "IVA 0%" rather than "Sin
  impuestos". **Non-blocking while pre-production; blocking before going live.** If the answer moves
  a case to `N1`/`N2`, that is an explicit classification threaded through sale facts, reporting and
  every Veri\*Factu sale, correction and substitution path — never a quiet redefinition of `zero`.

## Loose ends left by A230 (`@waitron/verifactu` 0.2.1, #1099).

- A resent cancellation AEAT already holds now counts as accepted when AEAT's stored fingerprint
  matches the cancellation's (`drain.ts`'s `handleDuplicate`; a mismatch is refused with
  `fiscal.duplicado_anulado`). The TEST-service retry in A985 returned `Correcto`, with a
  subsequent lookup `Anulado` and the matching cancellation fingerprint. A real
  `3000`/`Anulada` response and Waitron's handling of it remain unobserved in that run.
  [Findings](../compliance/verifactu-findings.md#19-cancellation-replay-zero-total-and-wrong-fingerprint-added-2026-10-22-a985).
- A voided sale whose lookup AEAT answers under the sale's own reference is not handled; not
  shown to happen either way.
- An unusable `TiempoEsperaEnvio` is not recorded anywhere (the raw value is dropped).

## A556. A full invoice that later replaces a bill's simplified one would not be delivered through the bill.

The dashboard's order detail reaches a bill's invoice as the sale carrying that bill's
id; a replacing full invoice (an F3) is a separate sale, and whether it would carry the bill's id
was not checked (A231q's review, read, not run). Nothing issues an F3 today: no route calls
`recordSubstitution`.

**2026-10-22 source-reading addendum:** core substitution exists, but no public app caller
was found in the inspected main/product trees. The [A739 owner-flow revision](../superpowers/specs/2026-10-22-a739-owner-payment-and-receipt-flow.md#the-fiscal-dependency-is-visible-not-solved-by-moving-fields)
records the missing recipient/address, request recovery, bill/delivery and no-charge integration
here under A556, with A948/Q17/Q5(d). No new fiscal item or enablement is created.

## Bundle: One owner session with a real certificate against AEAT

2 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A1270. Verify the fake AEAT's invoice-date comparison at midnight.**
  The readiness fixture uses a controlled clock. The library's `1112` check compares invoice dates
  at UTC midnight; AEAT validations §3.1.3.1 and the error wording do not name the comparison zone.
  Establish it from an authoritative definition or controlled preproduction probe, then correct and
  release `@waitron/verifactu` if needed. Keep this separate from A696's venue-zone implementation.
  The handover simulation now uses an advancing noon clock after its first filing reproduced
  `1112` at 23:28 UTC on 6 November, on both main and the certificate-worker branch.
  Audit the other server fixtures found by `rg 'createFakeAeat.*serverNow: new Date' apps/server`;
  their exposure to the same date boundary has not been reproduced.
  [Reproduction and sources](../developers/testing-guide.md#give-a-fake-fiscal-service-and-its-sample-one-controlled-clock).
- **A888. After A795 lands: the owner's checks with real certificates** (left open by A795). The
  owner approved landing A795 on 2026-10-19 before these ran.
  If any answers differently from the design, that part is redesigned in a follow-up.
  [Detail](fiscal.md#a888-after-a795-lands-the-owners-checks-with-real-certificates)

## Bundle: Settle the hold and the brake once

2 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **Still open after W41s-3 (#1289): one reply can open up to 1,000 filing cases.** A refusal
  that applies to every later record (one about the taxpayer's identity, say) opens one case per
  record in that reply before the repeated-code brake takes effect (`MAX_REGISTROS_POR_ENVIO`).
  [Detail](fiscal.md#still-open-after-w41s-3-1289-one-reply-can-open-up-to-1000-filing-cases)
- **Re-examine the hold behind an unknown outcome once AEAT's developer channel answers** — OPEN (owner 2026-10-06).
  The owner's view on [Q47](../compliance/asesor-questions.md#q47-keeping-a-chains-later-records-unsent-added-2026-10-12) (S19),
  (owner, 2026-11-18; the adviser is still to confirm the details): nothing seems to need holding back, since AEAT accepts later records when
  an earlier one is refused; the owner suggests asking AEAT's developer channel first. No change until then.
  [Detail](fiscal.md#re-examine-the-hold-behind-an-unknown-outcome-once-aeats-developer-channel-answers)

## Bundle: Decide whether any screen shows an invoice email's address

1 entry, size S, needs the owner. Its text is unchanged from the index it came from (backlog review, 2026-11-06).

- **A554. Should any screen show the address an invoice email went to?** An owner question, open.
  [Detail](fiscal.md#a554-should-any-screen-show-the-address-an-invoice-email-went-to).

## Bundle: One authorised edit of a protected test, plus its neighbours

3 entries, size S. The first two keep their text from the index they came from (backlog review, 2026-11-06).

- **`packages/fiscal-verifactu` code** — found by #562 while pruning comments. **Open:** the inner
  try/catch around the log call in `aeat-transport.ts`'s `closeAll` is dead; removing
  `appendToChain`'s nested `tx.transaction` makes no test fail; and `write-path.e2e.test.ts` points
  at fixture lines that have moved. [Detail](fiscal.md#packagesfiscal-verifactu-code)
- **Reconcile the protected fiscal write-path test's old policy quotation.** Its header still says
  no fiscal condition blocks a sale; the approved local conflict stop is an exception. Keep its
  behavioral assertions and protected-file scope intact.
  [Detail](fiscal.md#protected-write-path-test-policy-quotation).
- **Test files in `packages/fiscal-verifactu` still name their database handle `pg`**
  (`git grep -l 'const pg = ' packages/fiscal-verifactu`), among them `write-path.e2e.test.ts` and
  `inmutabilidad.test.ts`. Rename it in the same authorised edit. Left by the T2 sweep (2026-09-23).

## An incident record the venue can show the tax office: hardware faults, a break-in, lost data

Asked whether a venue whose server was restored from an old backup may rebuild the missing
invoices from AEAT's query service (the adviser's answer 1.16 of 15 November), the owner answered
(owner, 2026-11-18; the adviser is still to confirm the details; question 10 of the
[19 November sheet](../compliance/2026-11-19-adviser-meeting.md)): "if the data is gone, how would
we rebuild? the important thing is to record all issues eg hardware issues, being hacked, data
loss, etc, so that we can explain what happened". This replaces the 15 November recommendation
(D9) to keep what AEAT returns so copies could be rebuilt. The venue needs a record of every such
incident that outlives the data it explains and that it can show the tax office. Not designed:
what is recorded and by whom, how a person adds an incident the box cannot see (a break-in), what
the box adds by itself, and how the record reaches the tax office.

## Decisions and deliberate limits

**The recovery pack's paper-block check compares no venue id (owner, 2026-11-09).** The box's recovery key is what counts; the venue name printed on the sheet is for the person to check by eye, though the signed block still carries `recipientVenueId`. The owner's words: "There is only one venue so there is no point comparing the ID. We have the name on the sheet that the user can check, but the important bit for us is the recovery key."

### ADVISER-SPLIT-AFTER-PRINT: a printed bill is split by a whole credit note and copies of its dishes (watcher, 2026-11-20)

The owner's answer of 18 November allows either a correction or a cancellation (question 2 of the
[19 November sheet](../compliance/2026-11-19-adviser-meeting.md)). **Reopen to split** on a table's
printed, unpaid bill files the same whole credit note as **Cancel and credit** and puts copies of
its dishes on a new open bill of the party; staff then use Move dishes and Print the bill. The copies
are new dish rows, an exception to A1308's "the order line is the dish", because a printed ticket is
drawn from its bill's lines and the credited ticket must still reprint with its dishes. The design,
D1 (an approver's PIN, as Cancel and credit), D2 (no paper for the credit note) and D3 (a part-paid
printed bill stays refused) are the lane watcher's choices of 2026-11-20 (lane L `questions.md`,
09:58 and 10:11), not the owner's; D4 (a dish held in an unsent group is fired first) is the lane's
default. `copyBillDishes` (`apps/server/src/split-after-print.ts`) lists the tables keyed to a dish
line by hand; nothing checks it.
[Plan](../superpowers/plans/2026-11-20-adviser-split-after-print.md).

### W41s-11: the guide is the recovery procedure, and the old box is kept off by hand after a restore (watcher, 2026-11-14)

The recovery guide's **After a recovery** section (`apps/server/src/guide/en/backup-recovery.md`,
`#after-recovery`, and its Spanish twin) is the procedure after restoring on new hardware; there is
no separate operations file. It tells the owner to keep the old box switched off and disconnected,
because after a restore it can go on selling if it is switched on again. Revisit that sentence
when A1418 part 1 lands.

### A555: counter full invoices stay as the Pay window issues them (owner, 2026-11-12)

The owner chose to keep counter full invoices through the shared Pay window as main issues them:
"keep what works, fix the printer choice". The Full invoice choice, with an Email or A4 original,
is saved before Pay and the invoice is issued on the last payment; paper is printed after payment,
from **Print on {printer}** in the window that follows it (from 19 November 2026, ADVISER-NO-NONE,
closing that window also prints the receipt unless an original was emailed or sent to an A4 printer). Direct `POST /api/pay`, unissued
`/collect`, closing a counter bill by transfer and zero-total counter bills still refuse F1 with
`sale.full_invoice_unavailable`. Pinned by the full-invoice cases in
`apps/server/src/counter-bill-payments.test.ts`. Relayed by the watcher in lane L's
`questions.md` (2026-11-12 11:31) and the watcher handoff (2026-11-12 11:58).

### A802: a correction runs like a bill in reverse (owner, 2026-11-12)

A correction of a paid invoice is opened first (every filing check up front, nothing filed, no money
moved), money goes back through Refund a payment as legs linked to it, and the corrective invoice is
filed **"When all money is back"**: once every refund in it has gone through. This replaces the
2026-10-21 "file when opened". **"Opening approval counts"**: when a card refund is confirmed later
with nobody signed in, the approval given at opening counts and Waitron files the corrective
automatically, falling back to an alert and a manager's Record correction whenever that filing is
refused; this authorises a small change to the protected fiscal core (`recordCorrection`'s session
check). Recorded in the campaign's `questions.md`, 2026-11-12 12:37; the shape and its card cases
are in [the note](https://github.com/clintongormley/waitron/blob/465e5915389b464a5d6f34937b02f777a0305ec0/docs/superpowers/plans/2026-11-12-a802-correction-primitives.md).

**2026-11-12, as built in PR 1a:** cash goes back through the correction's own cash route, not
Refund a payment ([reshape plan](https://github.com/clintongormley/waitron/blob/465e5915389b464a5d6f34937b02f777a0305ec0/docs/superpowers/plans/2026-11-12-a802-reshape.md), decision 13), and
Open does not check the corrective series, which the last cash step does.

**2026-11-12, as built in PR 1b:** tickets paid by card, or by card and cash, are corrected the
same way: a card refund joins through Refund a payment and files nothing, and a manager presses
Record correction once all the money is back, until PR 2 files it automatically. A correction that
gave money back over an hour ago and is still open raises `invoice_correction.unfinished`, a warning
among the tax-filing alerts.

**2026-11-12, as built in PR 2:** once a correction's money is all back, Waitron files the
corrective itself on the approval given at opening, under the till that opened it: at the till
when its card refund goes through, or in the background check (about once a minute) when the card
company confirms it later. The refund is recorded first and is never undone. A refused filing
raises `invoice_correction.filing_refused`, an error among the tax-filing alerts, once per ticket
while that alert is open;
the check tries again each minute while refunds are not paused, and attempts no filing while the approver is suspended or lacks
the right to correct invoices, or while the invoice can no longer be corrected
(decision 14 of the [reshape plan](https://github.com/clintongormley/waitron/blob/465e5915389b464a5d6f34937b02f777a0305ec0/docs/superpowers/plans/2026-11-12-a802-reshape.md)).

**2026-11-13, as built in PR 3 (slice 5a):** a corrective invoice prints its original at the till
only when a person's request filed it (the last cash step or File now) and the till may print
receipts; an automatic filing and a replayed request print nothing, and a reprint is marked a copy
and opens no drawer. When it prints is the watcher's rule (lane L `questions.md`, 2026-11-13 01:05);
the print-receipt condition follows the card slip's and came from this branch's review. Both are
for the owner to confirm at landing.
_2026-11-15 (A1407): a replacement corrective's first till reprint is its original; later ones are
copies._

### A444: a full invoice shows only the date it was created (owner, 2026-11-12)

The owner, 2026-11-12, about 11:00 in the watcher's window: "I think we should use the creation
date. That way our invoices and AEAT and our reports will all use the same dates and times."
Asked whether lane L should switch to the creation date everywhere and park what it built until
the adviser answers, the owner answered "yes" (11:10). This replaces the 27 October rule ("the
meal ends when the bill closes") until the adviser answers
[S4](../compliance/asesor-questions.md#the-shortened-list-2026-10-09). No invoice, full or
simplified, carries a separate operation date (exceptions in the dated notes below): paper, the till, the A4/email document and the
accountant export show the creation date, which is the only date AEAT receives. This also answers
"Can a simplified invoice carry an operation date different from its issue date?", left open by
A663 Part 2: no, except a replacement corrective of a refused simplified invoice and an invoice
issued on a later day than the sale (dated notes below). The work built for the bill-close date stays parked on
`feat/a444-fiscal-operation-day` and `feat/a444-close-day-capture`, branches in lane L's local
worktrees that were never pushed, and its plan on `docs/a444-revised-plan`.
[Plan](../superpowers/plans/2026-11-12-a444-creation-date-only.md).
_2026-11-14 (owner's answer B, Q37-FIX): an exception is a replacement corrective (R5 "S") of
a refused simplified invoice, which files the original sale's real day as `FechaOperacion` when it
differs from its own date._
_2026-11-15 (A1407): an R4 "S" replacing a refused full invoice is the same exception, filing the
real day as `FechaOperacion` when it differs from its own date; it is built but switched off
(`FULL_INVOICE_REPLACEMENT_ON`). The owner, 2026-11-15 01:58, relayed by the watcher: "the operation
date is when the table closes, which normally coincides with the invoice date", and "where an
invoice is issued days after the meal finished … the operation date and the invoice date should be
distinct". So a replacement corrective, R4 and R5 alike, prints a "Date of the sale" row with that
real day when it differs from its own issue date (Task 3a of the
[A1407 plan](https://github.com/clintongormley/waitron/blob/0baa2c3869d2a4b5e4f7e632c081ad0b8da7a2ec/docs/superpowers/plans/2026-11-15-a1407-full-invoice-replacement.md)). The owner's
reading has two parts: the creation-date rule above covers an invoice issued at the end of the meal,
when the table closes, which normally coincides with the invoice date; an invoice issued days after
the meal carries a separate date of sale. A1407 step 2 applies that to replacement correctives. The owner
ruled on 2026-11-15 at 05:28 that an invoice issued on a later day (card recovery, a bill paid or
left open for days, a takeaway collected days later) files and prints the sale date too, queued as
LATER-SALE-DATE._
_2026-11-20 (LATER-SALE-DATE): an invoice an order issues on a later calendar day than the moment
its meal ended files that day as `FechaOperacion`, uses its VAT rates, prints it as the date of the
sale, keeps it in `sales.supply_day`, and counts in that day's period on the VAT return and in the
accountant export, which picks it by that day, else its issue date, and shows it in its last column.
The meal ends at whichever comes first: printing the bill, taking the last payment, or the close of
the business day (the owner's words of 18 November, in the [19 November sheet](../compliance/2026-11-19-adviser-meeting.md));
its day is the calendar day of that moment (the owner's D1, "Calendar day it ended", relayed by the
watcher, lane L `questions.md`, "WATCHER 2026-11-19 17:05"). Serving marks date nothing. Card
recovery and a bill payment the box completes later pass the moment the last payment still holding
money was accepted. A table bill the close of day counts as due (`closeOfDayEnd`, `close-of-day.ts`:
this node's, with a trusted opening time, not left by a restore, no dish the kitchen was never asked
for), issued after the business day it was opened in ended, is dated no later than that day's end,
whichever path issues it: the owner's "whichever comes first" above (the owner's D2, "Yes, leave
them to close of day", same record, chose to build nothing for these bills on this branch; the
watcher has not yet cleared this). A bill paid in full before that day ended but held open past it is
dated by the day's end, not by its last payment as that rule would give: a stated limit. Every other invoice carries one date. A card
found later carries roughly when the reader was asked (SumUp's time is the checkout's start), so a
tap just after midnight still files the earlier day. The owner's answers relayed by the watcher on
2026-11-15 at 12:12 and 20:59 (lane L `archive/questions-to-2026-11-18.md`): "sale day" for the
VAT return and the export, and "(a) By meal date" for how the export picks such an invoice.
[Plan](../superpowers/plans/2026-11-15-later-sale-date.md)._

### A1481: a fix never changes an invoice's amounts (owner, 2026-11-11)

A fix re-sends the same invoice, so `applyCorrectedRecordFacts` refuses a changed rate, base, VAT or
total with `fiscal.remedy_amount_changed` before writing anything (option A). A fix of a corrective
invoice also refuses changed correction amounts (`ImporteRectificacion`; owner, 17:22, "correct"),
and so does a fix that adds or removes non-zero ones. An amount error takes a new corrective
invoice, which carries new amounts. Recorded in the campaign's `questions.md`, 2026-11-11 14:12,
14:20 and 17:22. A fix that changes what a line is (its tax type, regime, taxed or not-subject class,
or exemption reason) is refused too, with `fiscal.remedy_class_changed` when its amounts are
unchanged; a line whose amounts also changed is refused with `fiscal.remedy_amount_changed` first
(owner, 2026-11-11, "Yes"; a missing tax type counts as IVA).

### Q37-FIX: a correction record changes only the description (owner 2026-11-13, watcher 2026-11-14)

The Fiscal filing page offers a correction record only for a record AEAT refused with code `1100`,
and the server refuses a new issuer name through it with `fiscal.remedy_issuer_changed` (owner's
picker answer, 2026-11-13 22:09, "Yes to both", recorded in the campaign's
`desk/done/20261113-2205-L-q37-fix-remedy.md`). The watcher narrowed the offer to a refusal whose
AEAT message names `DescripcionOperacion`, and had the server also refuse a changed invoice type,
recipients, correction type, corrected invoice or replaced invoice with
`fiscal.remedy_printed_fact_changed` (campaign `questions.md`, 2026-11-14 00:01 and 00:27).

A simplified invoice AEAT refused for a future date is put right by a replacement corrective
invoice, R5 with `TipoRectificativa` "S", offered on any day (owner's picker, 2026-11-13 22:09, same
`desk/done` file). Answers A–D (owner, relayed 2026-11-14 09:50): rectified amounts 0.00, the real
day as its operation date, the printed copy says it replaces the invoice in full with a 0,00 €
rectification, and a later refund names the replacement. E: the sale counts in its real day's VAT
period (owner, 2026-11-14 17:20). The replacement is dated today (watcher, 11:54); the real day is
asked of the administrator and stored as `sales.supply_day` (watcher, 18:22).
_2026-11-15 (A1407): a full invoice refused the same way is to be put right by an R4 "S" naming
the same customer, with the same rectified amounts, real day and VAT period (Q37's A, C and E
carried over by the plan's default 4; not confirmed by the owner). It is built but
switched off (`FULL_INVOICE_REPLACEMENT_ON` in `packages/fiscal-verifactu/src/put-right.ts`) until
adviser question S14 is answered and AEAT's test service has accepted one._

### A1425 part 1: after a takeover (owner, 2026-11-08)

A box the held membership chart does not name `serving-primary` refuses a sale before any money moves.
So far only on a Veri\*Factu venue: `NoneBackend` has no such check.
A conflict AEAT reports on a record inherited from a box this one took over from is recorded and does
not stop this box. Approved with #2570; the note is in the campaign's
`questions.md`, 2026-11-08 10:44.

### W41s-7: administrator conflict switching only (owner, 2026-11-01)

After the conflict reply commits, stop issuance on its clashing identity until an administrator
uses the current recovery key and the existing activation writer to select a fresh minute identity.
Keep the rejected original and its case. The owner excludes automatic switching permanently and
removes Task 7's outside sole-seller grant, fence acknowledgement, outside switch history and
24-hour automatic limit. Those are not prerequisites for this administrator procedure.
The permitted writer rotates the affected node's identity and series and resets its chain head;
record contents, hash and number-allocation logic, `registerSif`, `restoreFiscal` and protected
assertions remain outside the change. See the [implementation plan](https://github.com/clintongormley/waitron/blob/9faf8661ebd08545d96518b1d7d09305dcdd654c/docs/superpowers/plans/2026-11-01-w41s-7-conflict-recovery.md).

- **27 October 2026, A1157:** Keep the normalized text and source files alongside the library's
  watched fingerprints, updated by `--refresh`; keep date stamps in the comparison (owner: “we
  should keep one for comparison”). The exact October scope-page edit remains unrecovered.
  [Current-rule review and archive limits](../compliance/research/2026-10-27-a1157-faq.md).

- **A948, owner decision 2026-10-27: enable full invoices in every environment now.** No
  environment flag remains. A555, A444, applicable B2B delivery, physical paper/QR checks and
  the asesor's manual-remedy approval were dropped as prerequisites to the switch, not closed.
  Counter sales, integrated-card payment and unissued counter collection retain their F1 refusal
  until A555 carries original delivery through payment. Saved F1 choices may grow above the
  simplified-invoice ceiling.
  2026-11-12, A555: Counter bills paid through the shared Pay window have issued full invoices
  since #2725, and the owner chose to keep that; see [the A555 decision](#a555-counter-full-invoices-stay-as-the-pay-window-issues-them-owner-2026-11-12).
  2026-11-12: A444 is closed by the creation-date decision above.

- **Backup access is independent of a retained setup's password (A731; owner, 2026-10-15).**
  Authenticate the selected backup with its own named node key, plus the archive key or source
  credentials it needs. Keep unrelated local records opaque and retain their files. A key that
  opens the backup does not replace fiscal history admission. Follow
  [repair recovery](../operations/hour-recovery.md#recover-while-first-setup-is-blocked).
  (2026-10-31, A1131bc slice 3: a new recovery no longer keeps the failed setup's files; Recover from
  backup deletes the setup first, then uses the ordinary restore. The anchor now describes that.)

- **Pre-squash certificate metadata (A889).** Until a pre-A795 test box is reset under
  [A760](../operations/a760-migration-squash.md), reinstall its certificate through the
  certificate card if it shows **Installed: not recorded**. The card's expiry alerts and
  reminder emails use an install record. A direct `waitron-credentials set --purpose fiscal.aeat`
  write still creates no install record; use the card when you need that metadata. Removing
  A889 from open work does not mean the planned A760 reset has run.

- **Lost credentials use reinstallation, not A732's recovery desk (owner, 2026-10-21).**
  A732's fresh-workspace action, taxpayer-proof routes and recovery desk are withdrawn.
  If you have lost both the administrator password and recovery sheet, reinstall and set up
  the box again. This loses its local data and starts a fresh fiscal identity and chain.
  Copies held separately remain separate recovery sources, requiring their own recovery keys;
  reinstalling does not recover access to them. See [first Live setup](../operations/first-live-fiscal-setup.md#when-both-credentials-are-lost).

- **The Cloud fiscal allocation registry is dropped (owner, 2026-10-29, A1189).** "We no longer
  have the reservations because we use the time-based codes instead." Waitron's client and report
  journal are removed; the fiscal package still reads old Cloud receipts until
  [their retirement](#retire-the-historical-allocation-formats-from-fiscal-verifactu).

- **A €0 fully comped sale settles when it is comped (owner, 2026-10-21).** Keep the
  settlement-time behaviour; do not backdate it to the invoice's issue time.

### A venue without Cloud needs a usable paper-custodian route

The owner approved the hour-code design on 16 October 2026 at 14:50, replacing paper/Cloud
allocation and S/P/C/E naming with taxpayer-wide coordination, clock/history checks and one
recovery-key PDF. The 18 October clarification requires one prefix for each invoice purpose.
The owner approved the generated PDF and exact retained CLI-launch patch on 19 October.
The [approved design](../superpowers/specs/2026-10-16-a679-hour-coded-series-design.md)
and [historical decision/checkpoint snapshot](../operations/a679-development-checkpoints.md)
retain the decisions and their earlier alternatives. No simultaneous-box reservation guarantee
or conversion of old fiscal records is part of this change. (2026-10-22: A947 slice 4a replaced
the hour names with five-symbol UTC-minute names, the recent-setup question with a 30-second
check against a second clock, and dropped the installation code from the sheet; see the
[A947 design](../superpowers/specs/2026-10-21-a947-two-box-failover-design.md) §6.5 and §6.7.)

- **A795, owner decisions 2026-10-18 (design §9, Q1–Q3).** Replacing the AEAT certificate needs the
  existing `system.manage` (managers and admins); no new permission. Warnings go by type, in
  calendar days left: a company seal turns amber at 90 and red at 30, a representative certificate
  at 60 and 14 (`CERTIFICATE_THRESHOLDS`, `packages/fiscal-verifactu/src/certificate-dates.ts`). The
  box emails every active person holding `system.manage` who has an email address, at most once per
  person and stage. Receipt: [plan §1](../superpowers/plans/2026-10-18-a795-aeat-certificate-after-setup.md).

- **A845 (#1895), owner decision 2026-10-17: cancelling an invoiced bill checks the permission first**, as
  the drawer, refund and unpaid-departure routes do: "not permitted" (with the PIN checked and
  counted) comes before any payment refusal.

- **A741, owner decision 2026-10-15: one large-bill limit of €3,000** (#1774). A sale of exactly
  €3,000.00 is accepted and one of €3,000.01 refused (`simplifiedInvoiceLimit`,
  `packages/fiscal-verifactu/src/backend.ts`), inside the 3,010.00 that `@waitron/verifactu`'s
  validator applies. The till asks whether a large bill is for different people at the server's
  limit, and asks no full-invoice question and draws no Full invoice button while the server sends
  `fullInvoices: false`.
- **A696, owner decision 2026-10-15: “A — Venue's time zone”.** Every new invoice date and
  record offset, ordinary receipt and till use the saved venue zone, including DST, independently
  of the process zone. Old records, including their dates, offsets and hashes, stay unchanged.
  Receipt: `~/waitron-campaign-e/questions.md`, **WATCHER 2026-10-15 ~05:12**, “OWNER ANSWER
  to A696 question 1”; [spec decision](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/specs/2026-10-15-a696-invoice-time-zone-design.md#owner-decision-recorded-2026-10-15-the-venues-saved-time-zone).
  That answer alone grants no repair permission or build approval; the later 17:20 scope
  decision is recorded below. A696 stays open and A444 stays separate. (2026-11-12: A444 is
  closed by the creation-date decision above.)
- **A696, owner decision 2026-10-15 17:20: include restricted guided zone repair.** Only an
  invalid or missing saved zone is eligible. A manager confirms the named zone, the captured
  payment resumes without another charge, and new issuance uses the recovery instant and its
  venue offset. Keep the capture instant and settled replay facts; valid-to-valid settings locks
  stay in force. Receipt: `~/waitron-campaign-e/questions.md`, **WATCHER 17:20**, answer to
  A696 question 2. The [exact design](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/specs/2026-10-15-a696-guided-zone-repair-design.md)
  awaits owner approval before planning or building; the scope answer does not approve its
  proposed permission or repair mechanism.
- **A696, owner supersession 2026-10-15 ~22:25, recorded here 2026-10-20:** validate the saved
  zone at startup and every writer; stop trading before any sale, payment or invoice under a bad
  zone. A manager/admin confirms only a missing/invalid zone using existing `venue.configure`,
  one handled incident and no new table. Valid-zone changes keep all settings locks. This replaces
  the 17:20 post-capture repair direction above: drop its captured-payment failure state, resume
  action and historical-reporting consequence. Keep mid-payment recovery only if a supported live
  invalidation path is evidenced. Receipt:
  `~/waitron-campaign-e/questions.md`, **OWNER 2026-10-15 ~22:25**.
  The [startup redesign](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/specs/2026-10-20-a696-startup-zone-validation-design.md)
  passed requirements review.

- **Reply matching (owner, 2026-10-06).** Line N of AEAT's reply is paired with record N of the envío, and is
applied only when it carries that record's reference, names the invoice (issuer NIF, number, date)
the record was sent as, and names no operation (`Operacion.TipoOperacion`) other than the one sent;
a line with no operation is not refused for that.

- **Records that need a person's decision (owner, 2026-10-12, PR #1596).** A 3000 conflict is
  refused and holds nothing; a cancellation of a refused original is set aside (`retenido`) with a
  filing case of its own and holds nothing; a record accepted with errors opens a filing case
  unless AEAT exempts its code (2004, 2009). Three conflicts in a row still trip the same-code
  brake until Tasks 4 and 7 switch to a fresh number series instead.
- **Decided (owner, 2026-10-02): a whole-invoice credit copies the invoice's own VAT split,
  negated** (`recordCorrection`'s `wholeInvoice`, `packages/core/src/record-correction.ts`).
  Worked out from the lines, as a partial correction still is, a 0.55 dish at 21% invoiced
  0.45 + 0.10 reverses to -0.45 - 0.09 (measured 2026-10-02); copied, it is -0.45 - 0.10.
- **Over-limit invoices (A261-2c, #1285; owner decision, 2026-10-06).** Non-fiscal placement
  accepts an over-limit order; collection refuses the over-limit invoice without taking money.
- **What a legal-name change leaves reading the current name (A494, 2026-10-11).** On a venue with
  no tax regime, a reprinted receipt and an emailed invoice show the current name, since none is
  stored with them (`apps/server/src/receipt-print.ts`, `apps/server/src/invoice-document.ts`). The
  card payment slip, the Modelo 303 export and the till's start-up read the current name. A
  reconcile query across a rename takes its header name from whichever of its rows comes first
  (`packages/fiscal-verifactu/src/reconcile.ts`).
- **Full invoices by email or on A4: the owner's answers in place of the asesor's (2026-10-07, A231d's
  plan Task 0.1, so A231p could be built).** The owner dropped the enablement prerequisites on
  2026-10-27 (A948 above); the asesor is still asked to confirm these as [Q44](../compliance/asesor-questions.md#q44-sending-a-full-invoice-as-a-pdf-by-email-or-on-a4--the-owners-interim-answers-added-2026-10-07):
  1. A PDF emailed after a paper original, or paper after an emailed original, is a «duplicado» and is marked so.
  2. Consent to email: staff ask the customer and record the answer on the till. The customer does not sign or confirm anything themselves.
     **Gap found 2026-10-09 (A448):** for a consumer, TRLGDCU art. 63.3 requires the request for consent to «precisar la forma en la que se procederá a recibir la factura electrónica, así como la posibilidad de que el destinatario que haya dado su consentimiento pueda revocarlo y la forma en la que podrá realizarse dicha revocación». The till's question must say both.
     _2026-10-12: for the product this answer is superseded. The owner removed the consent step on
     2026-10-09 ("We don't need customer consent to send them an email; just giving us the email
     address is sufficient."), and A231q's tasks C1a and C1b removed it
     ([plan](../superpowers/plans/2026-10-12-a231q-invoice-delivery-part-2.md)). A448 keeps the
     legal question open._
  3. Keeping: the same as a printed F1 — the invoice's database record. No copy of the PDF file is stored. The reconciled plan drops the proposed delivered-PDF table and keeps delivery metadata only.
  4. An unsigned PDF is a valid original for a business customer before the [business regime](#when-the-business-e-invoicing-regime-starts) applies, carrying the same QR and legend as paper. Receipts, each found word for word in the source fetched 2026-10-07: RD 1619/2012 art. 8.4, «se presumirá acreditada cuando se haya expedido utilizando un sistema o programa informático en conformidad con los requisitos»; DGT binding ruling V2891-18 (08/11/2018), an emailed PDF «con independencia de que no haya sido firmada digitalmente por el emisor de la misma, tendrá la calificación de factura electrónica»; AEAT's Veri*Factu FAQ, the QR on a PDF «no tendrá especialidades respecto de la que corresponde a la emisión en papel».
  5. A retry after a failed or uncertain send is still the original.
- **Office printers are sent pages Waitron draws itself, rather than through CUPS** (owner, 2026-10-03,
  A231d's decision 10): PDF when the printer lists it, else PWG Raster, else Apple Raster
  (`apps/print-agent/src/ipp-capabilities.ts`). The measurements behind it are in the
  [design](../superpowers/specs/2026-10-03-invoice-pdf-email-and-office-printing-design.md). Office
  printing reverses the 2026-09-09 provisioning design's "raw ESC/POS only" decision.

**Update, 2026-10-12 (W41s-4 key authority):** the owner selected the current node key alone
with permanent attribution to its authentication event. Internal qualification now checks the
real verifier before the lock and rechecks it in the write transaction. Signed consumption and
approval bind `{kind:"recovery-key",nodeId,eventId}`; normal administrator actions retain person
attribution.

**2026-10-14, approved hook-contract checks:** the owner approved exactly the seven groups in
[the supplemental request](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/plans/2026-10-14-w41s4-hook-contract-assertion-approval.md).

**2026-10-14 setup-check approval:** both exact setup-check changes are approved and applied.
[Exact proposals and retained checks](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/plans/2026-10-14-w41s4-setup-check-approval.md).
[Host checks and demo decision](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/plans/2026-10-14-w41s4-host-check-and-demo-decision.md).

### W41s-4 recovery-key label, 2026-10-13

The owner's 18:00 naming override replaces the random 16-character label with the UTC issue
date and four characters from an alphabet without 0/O, 1/I/L, 2/Z, 5/S, 6/G or 8/B pairs. The
stored spelling is `2026-10-15 · K7QF`; the handover shows `Recovery key 15 Oct 2026 · K7QF`
or `Clave de recuperación 15 oct 2026 · K7QF`. Switching language keeps the stored spelling
and secret. A replacement redraws a code matching the current key's name inside the same
transaction that replaces the verifier. The short name does not promise uniqueness across
all historical papers and never authenticates an operation.

### W41s-4 adoption boundary checkpoint, 2026-10-14

An adoption file cannot carry the live authentication that an allocated standby needs. When an
independently prepared module owns series at activation, the public adopter refuses before its
first local write, and the setup route returns `409 module.operation_invalid` (since 2026-11-12,
`409 mirror.standby_series_unsupported`). The pending worker
logs that refusal and keeps the complete adoption file. A booted pending mirror returns only its
pending status, with no ambient viewer session, sealed node key or selling identity created by
that step. A disabled allocation module does not prevent adoption.

**Review clarification, 2026-10-14:** the defaults now select allocated hooks, so a fiscal
standby's public adoption deliberately refuses rather than completing. No shipped caller supplies
fresh establishment authority and the primary's venue copy together. This is the missing-allocation
refusal allowed by spec §9.4, not a completed join journey. The open backlog entry carries the
remaining copy and authentication work. A primary reservation remains consumed/reserved even if
its empty spare cannot finish adoption.
_2026-11-14 (A947 3b-F):_ the adoption refusal above is gone; a join writes nothing fiscal, and the
activation writes the spare's dormant setup first.

- **`packages/fiscal-verifactu` restates rules the validator owns** — Exporting the patterns from the library instead was DEFERRED on purpose (owner, 2026-09-12).
  Revisit when something else needs those patterns.
  [Detail](fiscal.md#packagesfiscal-verifactu-restates-rules-the-validator-owns)
- **A product has one price whether it is eaten here or taken away (owner, 2026-11-14, A1522).** The design's words: "The price includes VAT, so a takeaway sale leaves the venue less after VAT … There is no separate takeaway price."

## W41s-6 pack-download checkpoint (2026-10-14)

Follow the [offline restore procedure](../developers/offline-fiscal-restore.md) for the outside
mounts and operator steps. Task 11 still owns the complete operational exercise; these checks
did not test physical power loss, a physical printer or remote incident storage.

## Still open after W41s-3 (#1289): one reply can open up to 1,000 filing cases

A refusal
that applies to every later record (one about the taxpayer's identity, say) opens one case per
record in that reply before the repeated-code brake takes effect (`MAX_REGISTROS_POR_ENVIO`).
The successor probes are finished: W41s-1c's [receipt](../superpowers/specs/2026-10-04-fiscal-prevention-and-offline-recovery-design.md#successor-receipt-2026-10-12-w41s-1c-both-probes-re-run-with-fresh-chains)
records warning-free `Correcto` successors after a 3000 refusal and after an unsent
cancellation, and a 3000 answer to an exact re-send. The holds after a 3000 conflict and behind a
cancellation of a refused invoice were dropped on 2026-10-12 (owner); the brake and the wait
behind an unknown answer are unchanged.
[W41s detail](#w41s-fiscal-prevention-and-offline-recovery--design-and-revised-plan-approved-2026-10-04)

## Re-examine the hold behind an unknown outcome once AEAT's developer channel answers

**Re-examine the hold behind an unknown outcome once AEAT's developer channel answers** — OPEN (owner
2026-10-06; the owner's view, 2026-11-18). The owner kept the hold for now (it landed with W41s-3c, #1304) and
asked to revisit it when the asesor answers Q37 and its siblings
([questions](../compliance/asesor-questions.md)): drop the hold, keep it, or add the overtaking case
to the W41s-1b probe first. The W41s-1b probes have since run without an overtaking case; their
results are in [W41s-1c's receipt](../superpowers/specs/2026-10-04-fiscal-prevention-and-offline-recovery-design.md#successor-receipt-2026-10-12-w41s-1c-both-probes-re-run-with-fresh-chains).
The decision is put to the asesor as [Q47](../compliance/asesor-questions.md#q47-keeping-a-chains-later-records-unsent-added-2026-10-12)
(S19 in the short list), covering this hold and the three-refusal brake. The owner's view (owner,
2026-11-18; the adviser is still to confirm the details; question 11 of the
[19 November sheet](../compliance/2026-11-19-adviser-meeting.md)): "we should ask on the AEAT
developer's channel, but given that they already accept invoices 2-999 when invoice 1 in the chain
has been rejected, it seems that we don't need to hold anything back." Nothing changes until AEAT's
developer channel answers; the decision then covers the hold and the brake, as before. The holds after a 3000
conflict and behind a cancellation of a refused invoice were dropped on 2026-10-12 (owner).
[W41s detail](#w41s-fiscal-prevention-and-offline-recovery--design-and-revised-plan-approved-2026-10-04)

## A940. Waitron's declaración responsable — design approved 2026-10-22; slice 1 landed 2026-10-23 (#2000).

The producer's statement that a version meets the Veri\*Factu rules, one per release,
readable on every terminal and before installation (compliance plan Step 8). The
[design](../superpowers/specs/2026-10-21-a940-declaracion-responsable-design.md) drafts the text
from AEAT's worked example, makes `pnpm release prepare` land each version's copy in a pull
request and `pnpm release tag` tag it, adds About Waitron to the dashboard, the till's More menu,
an ⓘ corner and the setup wizard, serves it at `/legal/declaration` before setup, on the
plain-HTTP page and on the recovery page, attaches it to each GitHub Release, and gives the
`@waitron/verifactu` library its own declaration. The owner answered all four questions on
2026-10-21: he is the producer (his name, NIF and publishable postal address were supplied by
2026-11-04 and are public); e) = «S» for this version and f) = «N»; item d) is the draft sent to the asesor as
Q53, pending their answer; production boxes run releases only. The owner approved the second revision on 2026-10-22 (about 02:45) and chose
A993's offline behaviour (about 02:55); the third revision folds those answers in. Slice 1,
built from its [plan](../superpowers/plans/2026-10-22-a940-1-software-identity.md), landed on
2026-10-23 (pull request #2000): every record kind's software block, built in
`buildSistemaInformatico` (`packages/fiscal-verifactu/src/backend.ts`), names "Waitron", the
build's version (`0.0.0-dev`, plus the build's commit on a published build; since slice 4's first
pull request a bundle built with a release version names that version) instead of `0.0.0`,
and `TipoUsoPosibleMultiOT = N`. Two test checks
changed with it: the Spanish practice sales were re-recorded (only their software block moved),
and the pinned digest of the shipped XML in `apps/server/src/full-comp.fiscal-identity.test.ts`
changed (the owner accepted it on 2026-10-23). [Task 8](../superpowers/plans/2026-10-22-a940-1-software-identity.md),
rewritten on 2026-11-06 for the owner's answers of 4 and 6 November, has landed. The name, tax number and
postal address are public; they are three settings named for the software's producer
(`WAITRON_PRODUCER_NAME`, `WAITRON_PRODUCER_TAX_ID`, `WAITRON_PRODUCER_ADDRESS`), carried by each
official image from repository secrets of the same names and never committed, so a fork builds with
its own. A production start with none refuses (`sif.producer_unset`); since A940 slice 4, a bundle
built without a release version refuses earlier, with `server.unreleased_build`, and a release image
cannot be built without them; a partly set or malformed value refuses in every environment; and a production start
whose open chain was made under another tax number refuses (`sif.producer_changed`) until A993 can
open the new installation, so a change of producer is blocked in production until A993 lands.
The three secrets hold placeholder values for now (owner, 2026-11-08; `gh secret list` showed all three set that day); replacing them, with
`gh secret set --env-file ~/waitron-campaign-shared/private/producer-identity.env --app actions --repo clintongormley/waitron`,
is safe only while no box has started in production, because a production chain refuses a different producer tax number until A993 lands.
Every full run's publish job fails while any is missing. Once an image carrying a placeholder is published, replacing its tax number also needs `WAITRON_PRODUCER_CHANGE_ALLOWED` set to the new number. Apart from replacing the placeholder, the tax number must not change until A993 lands: the publish job runs on every full run (the nightly, a
manual run on `main`, a `v*` tag), so a changed name or address reaches boxes as they update, but a
changed tax number fails the publish unless the repository variable
`WAITRON_PRODUCER_CHANGE_ALLOWED` holds it. Watch the first nightly or manual publish:
the job builds with `load: true`, checks the three values inside the image and runs the server's
own producer check there, then pushes from the builder's cache, and that sequence has never run on GitHub's runners. The real-fork test (the
plan's 8g Step 5) is still to do.
Slice 2 landed (#2820, #2827 and #2836; [plan](https://github.com/clintongormley/waitron/blob/465e5915389b464a5d6f34937b02f777a0305ec0/docs/superpowers/plans/2026-11-11-a940-2-release-declaration.md)): the text, its renderer, the A4 PDF's renderer, the package's `declaration` command (`show`, `write`, `check`), and `pnpm release prepare` and `pnpm release tag` with their [runbook](../operations/release.md). Both release commands refuse until the release-blocker line in `packages/fiscal-verifactu/declarations/template.md` is deleted, by whoever records the asesor's answer to Q53. Slice 3 landed (#2861, #2874, #2916, #2974; [plan](https://github.com/clintongormley/waitron/blob/465e5915389b464a5d6f34937b02f777a0305ec0/docs/superpowers/plans/2026-11-11-a940-3-in-app-declaration.md)): every box answers `/legal/declaration` (and `.pdf`, `.txt`) and `/legal/about` on every listener, and says it has none when its image carries none; every terminal opens it — the dashboard, the till, a kitchen screen, the till's sign-in and join screens and the setup wizard — and the guide's About Waitron page says where. Slice 4 landed (#2987, #3001, #3014; [plan](https://github.com/clintongormley/waitron/blob/465e5915389b464a5d6f34937b02f777a0305ec0/docs/superpowers/plans/2026-11-12-a940-4-release-image.md)): a `v1.2.3` tag on `main` publishes an image whose records say `1.2.3` and which holds that version's declaration in `/app/declaration/`, checked inside the built image with `node /app/server.js check-release 1.2.3`; CI refuses a tag that is not on `main`, is not a release version, whose declaration is missing, blocked or disagrees with the code, or whose version is already published; a `release` job attaches `waitron-1.2.3-declaration.pdf` and `.txt`, copied out of the published image, to the GitHub Release; `waitron.sh install v1.2.3` pulls the published images; a production start of a bundle built without a release version stops on the recovery page with `server.unreleased_build` ("This box is running a test build."), while a start from source is not refused; and a root guard (`scripts/released-declarations.mjs`) fails when a released version's declaration changes or its tag is missing. So no box can start in production until `v1.0.0` exists, which waits for Q53. Open point, for the owner: the recovery page's action "Install a release." (the design's §5.1 wording) offers no way to do that from the page, whose only button retries the same build; the page cannot offer one until a release can be installed without a terminal (B3's installer, A950's upgrades). Slice 5 landed (#3051; [plan](https://github.com/clintongormley/waitron/blob/0baa2c3869d2a4b5e4f7e632c081ad0b8da7a2ec/docs/superpowers/plans/2026-11-13-a940-5-kept-declarations.md)): a box that starts selling keeps the declaration of the release it runs in the venue database, and the declaration page every About screen opens lists each earlier version it has kept under «Versiones anteriores», each opening that version's text. Slice 6 (`@waitron/verifactu`'s own declaration) remains. 1b (A993) waits until a producer change is scheduled.
Still needed from outside: the asesor's answer to Q53, now question 9 of the
[19 November adviser sheet](../compliance/2026-11-19-adviser-meeting.md); the owner's answers
of 18 November leave items d) and f) to be confirmed. The
owner's address is settled: supplied on 2026-11-04, it travels with the other two.

## A993. A change of the system's identity opens a new installation by itself — designed in A940 §5.6, approved 2026-10-22; fiscal, the owner lands it.

AEAT identifies an invoicing system by the taxpayer's NIF,
the two-character code and the installation number, and the code counts only together with its
producer's NIF, so a new producer (the owner → a future Waitron company), a new code, or a move
to another fiscal policy (the owner: one installation, one policy) makes a different system.
Each chain stores the producer and compliance mode it was opened under (today `registro_sif`
stores neither, `packages/fiscal-verifactu/src/schema/sif.ts:20-22`); the upgrade's step and
every start compare them with the running release's and, on a difference, open a new installation, series and chain in
one transaction, on the filing node only, through a new `identity-change` activation that only
the upgrade's step, or a start that finds the change not made, can authorise (A947's slice 4a
amends CLAUDE.md §5's "does not mint an installation number" sentence; A993 adds the one
allocation no person asks for); a guard, proven by deletion, refuses to add a record to a chain
opened under another identity. Corrections of invoices issued before the change join the new
chain; the design asks for asesor Q53(d)(2) to be widened to cover that. The name is A947's
five-symbol UTC minute (A947 §6.5), so A947's slice 4a lands first; no new recovery sheet is
asked for. Because A947 needs a second clock for every name and, without a synchronised internet time
service, a start has nobody present to give one, the design has the upgrade check the clock while the old release still serves, and make
the change only once that check passes — otherwise the old release never stops. A sale can still
wait on the internet after a crash between the migration and the change, or when the new release
is started by hand; and a power cut during the upgrade's stop leaves no app running until the
upgrade runs again, until the restart-at-boot step the design adds is built. Chosen by the owner
on 2026-10-22 (A940's second-revision question 2, about 02:55), with one addition: in that stuck
case the page the box shows instead of trading also accepts a phone's or a till's clock under
A947's clock rule, and explains every wait with a countdown (design §5.6, "The stuck page";
picture 6). **Built only once a producer change is actually scheduled** (owner, 2026-11-11,
"Later", after the plan's fresh reader found that every record already names its producer, so
nothing is lost by waiting): the plan, `docs/superpowers/plans/2026-11-11-a993-identity-change.md`,
is kept unlanded on branch `docs/a993-identity-change-plan`, and asesor Q53(d)(2) is widened to ask
whether the new system may cancel or correct the old one's invoices. A move between fiscal modules stays a refused start
until the first non-Veri\*Factu mode. Since 2026-11-06 the producer is a setting each image
carries (A940 Task 8), so a start that opened a new installation on any producer difference would
let a hand override do it with nobody present; Task 8 refuses instead. **Constraint on A993's
plan, decided by the owner on 2026-11-06** (about 18:13, relayed by the watcher; recorded in the
A940 plan's "What A993 inherits" and design §5.6): (1) a change of producer stays blocked in
production until A993 exists; (2) once it exists, a start opens a new installation for a producer
difference only when the upgrade's own marker names that same new producer; otherwise it keeps
refusing. What a preproduction box does before A993 (it trades on, the new producer on the same
chain) is settled as built: the owner does not mind, since such a box can be reset.
[Design](../superpowers/specs/2026-10-21-a940-declaracion-responsable-design.md#56-when-the-systems-identity-changes-a-new-installation-by-itself-a993)

## Retire the historical allocation formats from `fiscal-verifactu`

Signed paper, Cloud receipts and emergency names are still read by historical code: the activation
check (`packages/fiscal-verifactu/src/allocation-envelope.ts`, its Cloud branch importing
`cloud-evidence.ts`) and the historical setup
contribution (`initial-setup.ts`, spread into production by `hour-configuration.ts`). The settings
`WAITRON_FISCAL_CLOUD_TRUST_FILE`, `WAITRON_FISCAL_CLOUD_FINGERPRINT` and
`WAITRON_FISCAL_CLOUD_RECEIPT_DIRECTORY` are read by `allocation-configuration.ts`,
`initial-setup.ts` (the trust file and receipt folder) and `initial-cloud-setup.ts` (the trust
file and the fingerprint); their only guide, the Cloud allocation guide, was deleted. Removing the
formats changes activation and the remaining assertions of several tests (among them
`hour-configuration.test.ts`, `backup-verification-history.test.ts`,
`paper-register-history.test.ts`, and the server's `retired-first-setup-routes.test.ts` and
`hour-restore-retired-inputs.test.ts`), so it is its own fiscal change for the owner to land. Left
by A1189 (2026-10-29), which removed the server's unused registry client and report journal.

## Rename the `hour-*` names to minute names

Left by A947 slice 4a, which made every
installation code a UTC minute but kept the `packages/fiscal-verifactu/src/hour-*.ts` file names,
their identifiers, the `source: "hour"` label the allocations carry, and test titles that still
say "hour" for what is now a minute (for example "same-hour code", "burns the entire hour"). Before go-live it needs
no compatibility code: until then any installation may be reset (CLAUDE.md §3).
