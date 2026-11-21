# Giving back a part payment after the table's ticket took it off — decision page and plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task by task, and only after the owner has answered the decisions below.

**Status:** for the owner to read before anything is built (2026-11-21; revised the same day after a
fresh read found a simpler path).
**Spec:** the owner's decision of 2026-11-21 13:25, item 3, in `~/waitron-campaign-l/questions.md`
under "WATCHER 2026-11-21 13:25". It replaces the closed #3941.

Words used here: a **part payment** (the code says "advance", the ticket says «Pago a cuenta») is
money a guest pays before the table's own ticket, with a ticket of its own. The **table's ticket**
is the invoice issued at the end; it lists the dishes and **takes off** each part payment by
number, date and amount. **Refund a payment** is the till's existing window that gives money back
on a receipt without a corrective invoice; **Correct invoice** gives money back and files one.

## Outcome

- When money has to come back after the table's ticket took a part payment off, staff correct the
  table's ticket for what was paid on it, and give any rest back with **Refund a payment** on the
  part payment's ticket. Waitron files nothing with AEAT for that rest; the accountant decides.
- Staff see, on the bill, each part payment's ticket and the table's ticket that took it off.
- The accountant's export shows that link and lists the money given back without a corrective.

## What happens today (each point read, unless it says "ran")

1. **Every way of giving a part payment back is refused once the table's ticket took it off.**
   `refuseTakenOffAdvance` answers `advance.taken_off_final_invoice` when a line of a sale that
   corrects nothing names the part payment in `deducts_sale_id` (`apps/server/src/advance-taken-off.ts:13-27`).
   It runs on Correct invoice (`invoice-corrections.ts:151`), a bill refund (`bill-refunds.ts:689`)
   and Refund a payment (`tender-refund-reservation.ts:136-145`, `:214-217`). The till's words send
   staff to Correct invoice on the table's ticket (`apps/till/src/i18n/codes.ts:664-667`). Ran, in
   `apps/server`: `pnpm exec vitest run src/advance-corrections.test.ts -t "refuses a plain refund of the advance's ticket|leaves Correct invoice on the advance refused"`: 2 passed.
2. **Correct invoice on the table's ticket gives back only money paid on that ticket**
   (`invoice_correction.money_short`, `apps/server/src/invoice-corrections.ts:126-131`; till words
   "Enter a smaller amount", `apps/till/src/i18n/codes.ts:516-519`). So a table's ticket of €0.00,
   or of less than must come back, leaves the rest with no way back. Ran:
   `-t "takes nothing off the 21% dishes"` in the same file: passed (`advance-corrections.test.ts:344-394`).
3. **Refund a payment already does what the manual route needs, except for this one block.** It
   records amount, cash or card, a `manual` flag for a card keyed on another machine, reason, who
   asked, who approved, till and node (`packages/db/src/schema/tender-refunds.ts:25-58`). It files no
   corrective of its own: none of the four files that use `reserveTenderRefund` calls `recordCorrection` or `recordSale` (grep), and the guide
   says so (`apps/server/src/guide/en/table-service.md:298-303` against `:331-333`). It waits while
   the box's time is unconfirmed (`tender-refund-completion.ts:26`), checks the device profile and the
   payment's kind (`tender-refund-authorization.ts:110-123`), asks a manager's PIN for a card keyed on
   another machine (`:150-158`), and sends a connected SumUp payment's refund itself
   (`tender-refunds.ts:111-118`). It is capped at what is left of the payment
   (`tender-refund-reservation.ts:220-236`). A completed one comes off the day's cash-up by method
   (`packages/reporting/src/cash-up.ts:113-117`), and a cash one opens the drawer under its own reason
   (`packages/db/src/schema/drawer-opens.ts:38`, `:64-66`). Ran:
   `packages/reporting` `src/cash-up-tender-refunds.test.ts` 11 passed; `apps/server`
   `src/tender-refund-drawer.test.ts` 17 passed.
4. **Waitron already notices a refund made in the SumUp app with no record behind it:** the refund
   audit lists it as `missing_local` (`apps/server/src/refund-audit.ts:207-212`). I read this; the
   fresh reader ran `src/refund-audit.test.ts` (11 passed).
5. **The link already exists in the data, but is copied onto correctives.** The table's ticket's
   deduction line holds the part payment's sale id in `sale_lines.deducts_sale_id`, indexed
   (`packages/db/src/schema/sales.ts:274-275`, `:299-302`, `:309`). A credit note and a replacement
   copy it (`apps/server/src/cancel-credit.ts:115`, `packages/core/src/correction-history.ts:387`,
   `packages/core/src/record-replacement.ts`'s line copy); both carry `corrects_sale_id`, which
   `refuseTakenOffAdvance` filters out. No route issues a full invoice replacing a ticket
   (grep: `recordSubstitution` has no caller in `apps/`).
6. **Neither the Pay window nor the export shows the link.** A part payment's row shows "Payment n ·
   cash/card", amount and tip (`apps/till/src/widgets/bill-pay-dialog.ts:1417-1440`); the server sends
   only its sale id and what correctives left of it (`apps/server/src/bill-payments.ts:326`, `:699-706`).
   The export's invoice sheet types a part payment's ticket only F1 or F2 (`accountant-export.ts:262-268`).
   The table's own ticket already prints each part payment's number and date (`receipt-document.ts:225-229`).
7. **No screen or route records a cash count.** `countedCash` appears only in the reporting package,
   the bench script and a test fixture (grep); the figures that exist are the Sales screen's cash-up.
8. **The adviser sheet has no questions A1 or A2 on main** (grep), so nothing needs withdrawing. On
   its question 6, "may the venue give the money back without [a corrective]", the owner answered
   "yes" to "is the corrective required" on 18 November (`docs/compliance/2026-11-19-adviser-meeting.md:163-170`).
9. **A1308's approved design merges `tender_refunds` and `bill_payment_refunds` into one `refunds`
   table** (`docs/superpowers/specs/2026-11-02-rationalisation/tables-fiscal.md:766-803`).

## Design (recommended: reuse Refund a payment)

**(a) Allow it, and say so.** Once the table's ticket has taken a part payment off, Refund a payment
on the part payment's ticket is allowed, capped as any refund. Correct invoice on that ticket and a
bill refund of its payment keep refusing. This differs from the proposal's words, "the till keeps
refusing": those were the watcher's words, which the owner said "yes" to; the owner's own were
"allow for manual workarounds … provide the information they need". The refusal's till words become
(Spanish twin to match):

> Payment on account already taken off receipt A/45. Use Correct invoice on A/45 for what was paid
> on it. For the rest, choose Refund a payment on this ticket: it gives the money back the way it
> was paid, and no corrective invoice is filed.

It meets the refusal rule (root `CLAUDE.md` §3): what happened, what each choice does, both in
reach of the same person, with the usual PIN in place. A SumUp payment is refunded by Waitron itself,
so nobody needs the owner's SumUp login. On a bill whose ticket is issued, **Refund** beside a part
payment opens Refund a payment on its ticket, as it opens Correct invoice before.

**(b) The link.** The part payment's row on the Pay window adds its ticket number, date and VAT
("A/12 · 19/11 · 10%: €27.27 + €2.73"; how it was paid is already shown), "Taken off on A/45" and any
refund given. The export's invoice sheet gains a column "Payment on account": "Taken off by A/45" on
the part payment's rows, "Takes off A/12, A/13" on the table's ticket. Both read only deduction lines
of sales that correct nothing, so a credit note or a replacement shows no link of its own.

**(c) The record** is the refund row itself. Cash and card both come off the cash-up by method, as
every refund does today; that goes beyond the proposal's "a card one is marked as refunded in the
SumUp app", and is how Waitron already treats card refunds. The bill's figure for what is left of
the part payment subtracts these refunds.

**(d) The export** gains a sheet "Refunds without a corrective invoice": when, amount, cash or card,
reason, who asked and approved (names read at export time), the ticket refunded, and for a part
payment the table's ticket that took it off.

**The alternative: a separate record of money given back by hand.** A new append-only table in
core's set, a till form from the refusal, a cash-up line and a drawer reason. Its full cost:
rebuilding core's starting migration resets every venue, and backups and exports from before cannot
be restored or imported (`docs/developers/conventions-data.md:4087-4090`), the owner's demo and
Santet venues included; the table travels in `packages/migrations/migrations.manifest.json`
(guards `scripts/append-only-migration-sets.test.ts`, `packages/composition/src/composition.test.ts`);
`drawer_opens` needs a new reason, link column and check (`drawer-opens.ts:30-38`, `:55-68`); a
third refund table works against A1308's merge; staff would refund card payments in the SumUp app,
which usually needs the owner's login (sending the person to somebody else), and every such refund
would stay an unexplained `missing_local` in the refund audit. About 450 lines over 3 PRs.

## Decisions for the owner

1. **How money comes back.** (i) Reuse Refund a payment on the part payment's ticket (recommended:
   no new table, no venue reset, refunds SumUp itself, already counted and audited; cost: a refusal
   becomes an allowed refund, and one existing test is changed to say so). (ii) A separate record
   of money given back by hand (cost above: a reset of every venue, a third refund table, SumUp
   refunds by the owner's login that the audit cannot match).
2. **Wording: correct the table's ticket first, then refund the rest.** (i) Both steps (recommended;
   cost: a longer message). (ii) Refund only (shorter, but no corrective for money a correction
   could have covered).
3. **Also point to Refund a payment when Correct invoice on a table's ticket runs short of money**
   and that ticket took off a part payment. (i) Yes (recommended: that is where staff land after
   step one; cost: one extra read when refusing). (ii) No.
4. **A card keyed on another machine** keeps needing a manager's PIN to confirm its refund was done
   there. (i) Keep, as for every such refund (recommended). (ii) Drop it here (cost: an unconfirmed
   card refund lowers the card figures).
5. **The export sheet lists** (i) every refund with no corrective (recommended: a goodwill refund,
   adviser question 6, is the same case for the accountant; cost: beyond the literal ask), or (ii)
   only refunds of part payments.
6. **No corrective for that rest, against your 18 November "yes".** You answered that a corrective
   is required when money is given back; the 13:25 decision leaves such cases to the accountant.
   (i) Build it now; the export shows each one to the accountant (recommended, per 13:25). (ii) Wait
   for the adviser's further details on question 6 first.

## Size (recommended path)

About 260 lines of production code, no table, no migration, no venue reset, 2 PRs. It changes when a
refund is allowed and what the accountant export holds, so I recommend the owner lands both.

- **PR 1, (b):** the link on the Pay window and in the export, about 110 lines.
- **PR 2, (a), (c), (d):** allow the refund, the bill's remaining figure, the export sheet, the
  refusal words and the till's Refund button, about 150 lines, plus the guide in English and Spanish.

## Tasks (each test first: watch it fail, build, watch it pass, commit with `-s`)

1. **Server, link on the bill.** A bill with a part payment then its table's ticket answers the
   part payment's number, date, VAT and "taken off by"; after a credit note of the table's ticket,
   still only the original's number.
2. **Till, link on the Pay window.** The row shows them (`bill-pay-dialog` test).
3. **Server, export link column.** `accountant-export.test.ts`: both rows carry it, a corrective none.
4. **Server, allow the refund.** Refund a payment on a taken-off part payment completes, capped,
   and adds no `sales` or `registros_facturacion` row; a bill refund and Correct invoice stay refused.
   Changes `advance-corrections.test.ts:461`'s plain-refund half; list it under "Changed test checks".
5. **Server, what is left.** The bill's part payment figure (`bill-payments.ts:326`) subtracts
   completed refunds; trace and test every reader of it (received figure, Find Bills).
6. **Server, export sheet** (scope per decision 5), rows in the period only.
7. **Server, `money_short` names the part payments** its table's ticket took off (decision 3), as a
   new parameter `advanceInvoiceNumbers`. No new refusal code anywhere.
8. **Till, words and button.** New EN/ES wording for `advance.taken_off_final_invoice` and
   `invoice_correction.money_short` pinned in `codes.test.ts`; Refund on a ticketed bill's part
   payment opens Refund a payment on its ticket; guide sections in both languages.

## Guards to run

Golden huella `packages/fiscal-verifactu/src/write-path.e2e.test.ts` and `inmutabilidad.test.ts`,
both unedited; `scripts/errors-reachable.test.ts`, `english-only.test.ts`; in `apps/server`,
`advance-corrections.test.ts`, `tender-refund-drawer.test.ts`, `refund-audit.test.ts`,
`till-api.profile-actions.test.ts`, `guide-content.test.ts`, `accountant-export.test.ts`,
`bill-payments.cash-up.test.ts`; `packages/reporting`'s `cash-up-tender-refunds.test.ts`.

**Order with other work:** A1308 is rewriting the refund tables; check its current slice before
PR 2, whose refund change then rides on whichever table holds refunds.
