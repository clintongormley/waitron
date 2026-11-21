# Giving back a part payment after the table's ticket took it off — decision page and plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task by task, and only after the owner has answered the decisions below.

**Status:** PR 1 (Tasks 0–4) landed as #3983; PR 2 (Tasks 5–9) built on
`feat/advance-manual-refund`. The owner chose decisions 1 (i) and 6 (i) at 16:36 on the earlier wording
(`~/waitron-campaign-l/questions.md`, "WATCHER 2026-11-21 16:36"). The watcher, not the owner,
accepted the corrected decision 1 below and chose decision 2 (ii) at 16:54 ("WATCHER 2026-11-21
16:54").
**Spec:** the owner's decision of 2026-11-21 13:25, item 3, in `~/waitron-campaign-l/questions.md`
under "WATCHER 2026-11-21 13:25". It replaces the closed #3941.

Words used here: a **part payment** (the code says "advance", the ticket says «Pago a cuenta») is
money a guest pays before the table's own ticket, with a ticket of its own. The **table's ticket**
is the invoice issued at the end; it lists the dishes and **takes off** each part payment by
number, date and amount. **Refund a payment** is the till's existing window that gives money back
on a receipt without a corrective invoice; **Correct invoice** gives money back and files one. A
**bill refund** is the Refund button on the Pay window, which gives back a payment of a bill
whose table's ticket is not yet issued.

## Outcome

- When money has to come back after the table's ticket took a part payment off, staff correct the
  table's ticket for what was paid on it, and give any rest back with **Refund a payment** on the
  part payment's ticket. Waitron files nothing with AEAT for that rest, so the VAT filed on it stays
  declared until the accountant acts; the export shows how much.
- Staff see which table's ticket took a part payment off: on the part payment's ticket, which is
  where they reach it after a normal meal, and on the Pay window for a printed bill still being
  paid.
- The accountant's export shows that link and lists the money given back without a corrective,
  with the VAT it leaves declared.

## What happens today (each point read, unless it says "ran")

1. **A part payment's money cannot come back by any route once the table's ticket took it off, and
   a plain refund of it is refused before that too.** `refuseTakenOffAdvance` answers
   `advance.taken_off_final_invoice` when a line of a sale that corrects nothing names the part
   payment in `deducts_sale_id` (`apps/server/src/advance-taken-off.ts:13-27`). It runs on Correct
   invoice (`invoice-corrections.ts:151`) and on a correction's own refund
   (`tender-refund-reservation.ts:216`). A plain refund and a bill refund go through
   `refuseAdvanceRefund` (`advance-taken-off.ts:35-48`; `tender-refund-reservation.ts:137-148`,
   `bill-refunds.ts:688-689`), which **throws in both cases**: `advance.taken_off_final_invoice`
   once the table's ticket took the part payment off, otherwise `tender.refund_of_advance` or
   `bill.refund_of_advance`, whose words send staff to Correct invoice on the part payment's own
   ticket (`apps/till/src/i18n/codes.ts:656-663`). Only a tip alone skips it (`:217`). Ran, in
   `apps/server` on main f59a8a6081: `pnpm exec vitest run src/advance-corrections.test.ts -t "is
   refused, naming Correct invoice on the advance's ticket|refuses a plain refund of the advance's
   ticket and a bill refund|a plain refund of €20 of the settled|leaves Correct invoice on the
   advance refused"`: 4 passed. Then, with `refuseTakenOffAdvance`'s call removed from
   `refuseAdvanceRefund` (reverted after): the plain-refund case failed, answering 409
   `tender.refund_of_advance` where it expected `advance.taken_off_final_invoice`. So removing the
   taken-off check alone does not allow the refund; the second fresh read ran the same and more.
2. **Correct invoice on the table's ticket gives back only money paid on that ticket**
   (`invoice_correction.money_short`, `apps/server/src/invoice-corrections.ts:126-131`, capped at
   `readRefundableTenders` of that ticket, `:153-160`; till words "Enter a smaller amount",
   `apps/till/src/i18n/codes.ts:516-519`). So a table's ticket of €0.00, or of less than must come
   back, leaves the rest with no way back. Ran: `-t "takes nothing off the 21% dishes"` in the same
   file: passed (`advance-corrections.test.ts:410-462`).
3. **Refund a payment already does what the manual route needs, once its part-payment gate is
   inverted.** It records amount, cash or card, a `manual` flag for a card keyed on another machine,
   reason, who asked, who approved, till and node (`packages/db/src/schema/tender-refunds.ts:25-58`).
   It files no corrective of its own: none of the four files that use `reserveTenderRefund` calls
   `recordCorrection` or `recordSale` (grep), and the guide says so
   (`apps/server/src/guide/en/table-service.md:299-303` against `:331-335`). It waits while the
   box's time is unconfirmed (`tender-refund-completion.ts:26`), checks the device profile and the
   payment's kind (`tender-refund-authorization.ts:110-123`), asks a manager's PIN for a card keyed
   on another machine (`:150-158`), and sends a connected SumUp payment's refund itself
   (`tender-refunds.ts:111-118`, read; not run). It is capped at what is left of the payment's
   tender (`tender-refund-reservation.ts:220-236`), which for a part payment is the whole part
   payment: nothing caps it at what the table's ticket could not give back. A completed one comes
   off the day's cash-up by method (`packages/reporting/src/cash-up.ts:113-117`), and a cash one
   opens the drawer under its own reason (`packages/db/src/schema/drawer-opens.ts:38`, `:64-66`).
   Ran: `packages/reporting` `src/cash-up-tender-refunds.test.ts` 11 passed; `apps/server`
   `src/tender-refund-drawer.test.ts` 17 passed. The second fresh read ran an allowed refund of €20
   of a taken-off €30 cash part payment: 200, cash takings 120.00 → 100.00, no new `sales` or
   `registros_facturacion` row, a drawer opening and drawer print job, and the bill's received
   figure and the part payment's `left` both unchanged.
4. **Waitron already notices a refund made in the SumUp app with no record behind it:** the refund
   audit lists it as `missing_local` (`apps/server/src/refund-audit.ts:207-212`). The first fresh
   reader ran `src/refund-audit.test.ts` (11 passed).
5. **The link already exists in the data, but is copied onto correctives.** The table's ticket's
   deduction line holds the part payment's sale id in `sale_lines.deducts_sale_id`, indexed
   (`packages/db/src/schema/sales.ts:274-275`, `:299-302`, `:309`). A credit note and a replacement
   copy it (`apps/server/src/cancel-credit.ts:115`, `packages/core/src/correction-history.ts:387`,
   `packages/core/src/record-replacement.ts`'s line copy); both carry `corrects_sale_id`, which
   `refuseTakenOffAdvance` filters out. No route issues a full invoice replacing a ticket
   (grep: `recordSubstitution` has no caller in `apps/`).
6. **No screen and no export shows the link, and the Pay window is rarely where staff are.** A
   part payment's row on the Pay window shows "Payment n · cash/card", amount and tip
   (`apps/till/src/widgets/bill-pay-dialog.ts:1417-1440`); the server sends only its sale id and
   what correctives left of it (`apps/server/src/bill-payments.ts:332`, `:708-711`). The Pay window
   lists payments, and offers Refund, only while the bill is open or placed
   (`apps/till/src/state/bill-payment.ts:356-361`). The table's ticket is issued by the payment that
   settles the bill, and the Pay window then turns to that ticket (`till-app.ts:22596`, `:22651`);
   the exception is a printed table bill still part paid (`till-app.ts:9260-9272`). After a normal
   meal staff reach the part payment through Find bills and its ticket, where Refund a payment is
   offered (`apps/till/src/screens/till-ticket-view.ts:1040-1045`, `till-app.ts:9472-9486`) and no
   link is shown. On a printed bill, Refund beside a part payment opens a bill refund
   (`till-app.ts:23251-23257`), which `bill-refunds.ts:689` refuses. The export's invoice sheet
   types a part payment's ticket only F1 or F2 (`accountant-export.ts:262-268`) and has no
   payment-method column (`i18n/accountant-export.ts:44-64`). The table's own ticket already prints
   each part payment's number and date (`receipt-document.ts:234-238`).
7. **A plain refund leaves a bill's received figure as it was** (#3961): only money a filed
   Correct invoice gave back lowers a settled bill's received (`bill-payments.ts:840-843`,
   `givenBackAfterSettling`; test `advance-corrections.test.ts:800`, "a plain refund of €20 of the
   settled €120 leaves €120 received of €120", ran above). A part payment's `left` comes from the
   same `gross` as what the table's ticket takes off (`bill-advances.ts:315-333`, `payments` and
   `credits`), and it feeds the payment's `netApplied` (`bill-payments.ts:332`), which the bill's
   received (`:456-460`), the outstanding figure of an open or placed bill (`:906`), Find bills'
   paid figure (`:666`) and the Pay window's Refund offer (`apps/till/src/state/bill-payment.ts:332-334`)
   all read.
8. **No screen or route records a cash count.** `countedCash` appears only in the reporting package,
   the bench script and a test fixture (grep); the figures that exist are the Sales screen's cash-up.
9. **The adviser sheet has no questions A1 or A2 on main** (grep), so nothing needs withdrawing. On
   its question 6, "may the venue give the money back without [a corrective]", the owner answered
   "yes" to "is the corrective required" on 18 November (`docs/compliance/2026-11-19-adviser-meeting.md:163-170`).
10. **A1308's approved design merges `tender_refunds` and `bill_payment_refunds` into one `refunds`
    table** (`docs/superpowers/specs/2026-11-02-rationalisation/tables-fiscal.md:766-803`).

## Design (recommended: reuse Refund a payment)

**(a) Allow it after the table's ticket, and say so.** The gate on a part payment's plain refund
is inverted, not removed. Before the table's ticket takes a part payment off, Refund a payment on
it stays refused with `tender.refund_of_advance`, which sends staff to Correct invoice on the part
payment's own ticket (a corrective is filed then, as today). Once the table's ticket has taken it
off, Refund a payment on the part payment's ticket is allowed, capped as any refund at what is left
of that payment. Correct invoice on the part payment's ticket, a correction's own refund, and a
bill refund keep refusing as today. This differs from the proposal's words, "the till keeps
refusing": those were the watcher's words, which the owner said "yes" to; the owner's own were
"allow for manual workarounds … provide the information they need", and at 16:36 the owner chose
this route.

The refusal `advance.taken_off_final_invoice` gains a parameter, `finalMoneyLeft`: what Correct
invoice on the table's ticket can still give back (`readRefundableTenders` of that ticket, as
`money_short` reads it). Its till words, Spanish twin to match:

> This payment on account was already taken off the table's receipt A/45, so this ticket cannot be
> corrected. To give money back, first use Correct invoice on A/45: it takes the amount off the
> dishes at their own VAT rates, files a corrective invoice and gives back money paid on A/45. For
> anything more, choose Refund a payment on this ticket: it gives money back from this payment and
> files no corrective invoice; the accountant's export lists it.

When `finalMoneyLeft` is 0.00 (A/45 was paid wholly by part payments, or Correct invoice or a whole
credit has already given back everything paid on it, ruling L9, test
`advance-corrections.test.ts:1015`):

> This payment on account was already taken off the table's receipt A/45, and nothing paid on A/45
> is left to give back. Choose Refund a payment on this ticket: it gives money back from this
> payment and files no corrective invoice; the accountant's export lists it.

Neither says how the money goes back: Refund a payment's own window handles a card keyed on another
terminal (refunded there, confirmed with a PIN). Both meet the refusal rule (root `CLAUDE.md` §3):
what happened, what each choice does, both in reach of the same person, with the usual PIN asked
in place. A SumUp payment is refunded by Waitron itself, so nobody needs the owner's SumUp login.
On a printed bill whose table's ticket is issued, **Refund** beside a part payment opens Refund a
payment on its ticket, as it opens Correct invoice before.

**(b) The link.** The part payment's ticket in the ticket view (reached from Find bills) shows
"Taken off by receipt A/45" above its actions, on screen only; the printed ticket is unchanged. The
part payment's row on the Pay window adds its ticket as printed: number, date with year, total and
VAT ("Receipt A/12, 19/11/2026: €30.00 · VAT 10%: base €27.27, VAT €2.73"; how it was paid is
already shown, and "Paid off the bill" stays what is still applied), "Taken off on A/45" and any
money given back by Refund a payment; this row serves the printed bill still being paid, the only
case where the Pay window lists a part payment after its table's ticket. The export's invoice sheet
gains a column "Payment on account": "Cash; taken off by A/45" (or "Card; …") on the part payment's rows,
"Takes off A/12, A/13" on the table's ticket. All read only deduction lines of sales that correct
nothing and are not a full invoice issued in substitution, so a credit note, a replacement or a
substitution shows no link of its own.

**(c) The record** is the refund row itself. Cash and card both come off the cash-up by method, as
every refund does today; that goes beyond the proposal's "a card one is marked as refunded in the
SumUp app", and is how Waitron already treats card refunds. **The bill's figures do not change**
(recommended): the part payment's `left`, the bill's received and Find bills' paid figure stay as
they are, as #3961 rules for a plain refund of any other payment. The reason: the table's ticket
took the whole part payment off what the guest owed, and that stays filed; lowering `left` would
lower received and, on a printed bill still being paid, raise the outstanding figure, so the till
would ask the guest to pay the money just given back. The server instead sends the part payment's
plain refunds as a separate figure, `givenBack`, which the Pay window row shows and its Refund offer
subtracts. Nothing changes `credits`, the amount the table's ticket takes off. Alternative: lower
`left`, which makes a part payment the one payment whose plain refund lowers received, and needs a
guard against the outstanding figure rising.

**(d) The export** gains a sheet "Refunds without a corrective invoice": when, amount, cash or card,
reason, who asked and approved (names read at export time), the ticket refunded, for a part
payment the table's ticket that took it off, and **the VAT left declared**: one row per VAT rate of
the refunded ticket, with that rate, base and VAT of the refund's share. The share is pro rata to
the ticket's VAT breakdown by gross, rounded to the cent, the last rate taking the remainder; within
a rate, VAT is the share less the share divided by (1 + rate), rounded to the cent, and base is the
share less that VAT. Example: €20 given back on a €30 part payment at 10% shows base €18.18 and VAT
€1.82, the VAT that stays filed. A sheet note says this VAT stays declared until the accountant acts.

**The alternative: a separate record of money given back by hand.** A new append-only table in
core's set, a till form from the refusal, a cash-up line and a drawer reason. Its full cost:
rebuilding core's starting migration resets every venue, and backups and exports from before cannot
be restored or imported (`docs/developers/conventions-data.md:4087-4090`), the owner's demo and
Santet venues included; the table travels in `packages/migrations/migrations.manifest.json`
(guards `scripts/append-only-migration-sets.test.ts`, `packages/composition/src/composition.test.ts`);
`drawer_opens` needs a new reason, link column and check (`drawer-opens.ts:30-38`, `:55-68`); a
third refund table works against A1308's merge; staff would refund card payments in the SumUp app,
which usually needs the owner's login (sending the person to somebody else), and every such refund
would stay an unexplained `missing_local` in the refund audit. About 450 production lines over 3
PRs, costed before the ticket-view link and the VAT columns were added, which it would need too.

## Decisions for the owner

1. **How money comes back.** (i) Refund a payment on the part payment's ticket becomes allowed
   once the table's ticket has taken that part payment off, and only then; before, it stays
   refused and staff use Correct invoice on the part payment's own ticket, which files a corrective,
   as today. The bill refund keeps refusing (recommended, and chosen by the owner at 16:36 on the
   earlier wording: no new table, no venue reset, refunds SumUp itself, already counted and audited;
   cost: the part-payment check is turned round rather than lifted, and one existing test's
   plain-refund half changes from refused to allowed). (ii) A separate record of money given back
   by hand (cost above: a reset of every venue, a third refund table, SumUp refunds by the owner's
   login that the audit cannot match).
2. **Correct the table's ticket first, then refund the rest.** The 15:37 clearing took this as
   wording; nothing in the plan as cleared makes staff correct first, and Refund a payment offers
   the whole part payment. In the 16:36 example (€100 ahead, €120 dinner, €30 back) staff could
   give the whole €30 back with nothing filed, not only the €10 leftover. (i) Wording only (as
   cleared). (ii) Also refuse the plain refund while `finalMoneyLeft` is above 0.00, with the first
   words above (recommended: it makes "only the leftover has no correction" hold for the order of
   steps, though no cap on the amount is possible, since Waitron cannot know how much is owed back;
   cost: about 15 lines, and staff cannot use the plain refund while A/45 still holds money, even
   for a reason that has nothing to do with A/45). The watcher's call, or the owner's if the watcher
   prefers. The watcher chose (ii) at 16:54.
3. **Also point to Refund a payment when Correct invoice on a table's ticket runs short of money**
   and that ticket took off a part payment. (i) Yes (recommended: that is where staff land after
   step one; cost: one extra read when refusing). (ii) No. Cleared at 15:37.
4. **A card keyed on another machine** keeps needing a manager's PIN to confirm its refund was done
   there. (i) Keep, as for every such refund (recommended). (ii) Drop it here (cost: an unconfirmed
   card refund lowers the card figures). Cleared at 15:37.
5. **The export sheet lists** (i) every refund with no corrective (recommended: a goodwill refund,
   adviser question 6, is the same case for the accountant; cost: beyond the literal ask), or (ii)
   only refunds of part payments. Cleared at 15:37.
6. **No corrective for that rest, against your 18 November "yes".** You answered that a corrective
   is required when money is given back; the 13:25 decision leaves such cases to the accountant.
   (i) Build it now; the export shows each one to the accountant, with the VAT it leaves declared
   (recommended, per 13:25; chosen by the owner at 16:36, with a question for the adviser). (ii)
   Wait for the adviser's further details on question 6 first.

## Size (recommended path)

(2026-11-22: PR 2 adds `refunds_completed_at_idx` and rebuilds core's starting migration, so it
resets venues; watcher, "WATCHER 2026-11-22 00:24".)
About 430 lines of production code, no table, no migration, no venue reset, 2 PRs; about 650 lines
of tests and about 40 lines of guide in each of English and Spanish besides. The first estimate,
260, left out the ticket-view link, the VAT columns, the refusal's new parameter and the separate
given-back figure. It changes when a refund is allowed and what the accountant export holds, so I
recommend the owner lands both.

- **PR 1, (b) and the adviser question:** the link on the ticket view, the Pay window and in the
  export, about 170 lines; tests about 250.
- **PR 2, (a), (c), (d):** allow the refund, the given-back figure, the export sheet with its VAT,
  the refusal words and parameters and the till's Refund button, about 260 lines (decision 2 (ii)
  included); tests about 400.

## Tasks (each test first: watch it fail, build, watch it pass, commit with `-s`)

0. **Adviser sheet.** Add one question to `docs/compliance/2026-11-19-adviser-meeting.md` (or the
   current sheet if newer), as the owner asked at 16:36: €100 ahead, €120 dinner, €30 back; correct
   the table's ticket first (€20, filed); give back only the €10 leftover with Refund a payment;
   nothing is filed for it, its VAT (€0.91 at 10%) stays declared, and the accountant's export lists
   it. Ask the adviser to confirm or say what is needed; quote the owner's words.
1. **Server, link on the bill.** A bill with a part payment then its table's ticket answers the
   part payment's number, date, total, VAT and "taken off by"; after a credit note of the table's ticket,
   still only the original's number.
2. **Server, link on the ticket.** `getTransactionReceipt`'s read (`/api/transactions/:id/receipt`,
   `apps/till/src/api/client.ts:4388`) answers `takenOffBy: { saleId, invoiceNumber }` for a part
   payment's ticket the table's ticket took off, and nothing for any other ticket or a corrective.
3. **Till, the link shown.** The ticket view shows "Taken off by receipt A/45" (`till-ticket-view`
   test); the Pay window row shows number, date with year, total, VAT and "Taken off on A/45" (`bill-pay-dialog`
   test).
4. **Server, export link column.** `accountant-export.test.ts`: both rows carry it, with cash or card
   on the part payment's; a corrective none.
5. **Server, allow the refund after the table's ticket.** `refuseRefundOfAdvance`
   (`tender-refund-reservation.ts:137-148`) returns once `refuseTakenOffAdvance` would refuse, and
   otherwise refuses as now. Tests: Refund a payment on a taken-off part payment completes, capped,
   and adds no `sales` or `registros_facturacion` row; a part payment not yet taken off still
   answers `tender.refund_of_advance` (`advance-corrections.test.ts:237`, unchanged); a bill refund
   of a taken-off part payment still answers `advance.taken_off_final_invoice`; Correct invoice on
   it stays refused. Changes `advance-corrections.test.ts:550`'s plain-refund half from refused to
   allowed; list it under "Changed test checks". With decision 2 (ii): refused while
   `finalMoneyLeft` is above 0.00, allowed at 0.00.
6. **Server, the given-back figure.** The part payment's view gains `givenBack` (its completed plain
   refunds' applied amounts); `left`, `credits`, received, outstanding and Find bills' paid figure
   do not move. Test: after €20 plainly given back, a settled bill's received stays 120.00, the row
   answers `left` 30.00 and `givenBack` 20.00; on a printed, part-paid bill the outstanding figure
   does not rise. Change the `payments` map only through this new field, never `credits`.
7. **Server, export sheet** (every refund with no corrective, decision 5), rows in the period only,
   one per VAT rate with rate, base and VAT as (d); a two-rate ticket's rounding case.
8. **Server, refusal parameters.** `advance.taken_off_final_invoice` gains `finalMoneyLeft`;
   `invoice_correction.money_short` gains `advanceInvoiceNumbers`, the part payments its table's
   ticket took off (decision 3). No new refusal code anywhere. Changes the `toEqual` of the refusal
   in `advance-corrections.test.ts:526`, `:550` and `:1015` by the new key; list them.
9. **Till, words and button.** The EN/ES wording for `advance.taken_off_final_invoice` (both forms)
   and `invoice_correction.money_short` pinned in `codes.test.ts`; Refund on a printed bill's part
   payment opens Refund a payment on its ticket; the Pay window row shows `givenBack` and its
   Refund offer subtracts it; guide sections in both languages ("Refund a payment on a receipt").

## Guards to run

In `packages/fiscal-verifactu`, both unedited: `pnpm exec vitest run src/write-path.e2e.test.ts
src/inmutabilidad.test.ts`. At the root: `pnpm exec vitest run scripts/errors-reachable.test.ts
scripts/english-only.test.ts`. In `apps/server`: `pnpm exec vitest run src/advance-corrections.test.ts
src/tender-refund-drawer.test.ts src/refund-audit.test.ts src/till-api.profile-actions.test.ts
src/guide-content.test.ts src/accountant-export.test.ts src/bill-payments.cash-up.test.ts`, with
`advance-corrections.test.ts:237` passing unchanged. In `packages/reporting`: `pnpm exec vitest run
src/cash-up-tender-refunds.test.ts`. A name filter goes after the files as `-t "…"` under `pnpm exec
vitest run`; `pnpm test <file> -t` drops it (root `CLAUDE.md` §2).

**Order with other work:** A1308 is rewriting the refund tables; check its current slice before
PR 2, whose refund change then rides on whichever table holds refunds.
