# Giving back a part payment by hand — decision page and plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task by task, and only after the owner has answered the decisions below.

**Status:** for the owner to read before anything is built (2026-11-21).
**Spec:** the owner's decision of 2026-11-21 13:25, item 3, in `~/waitron-campaign-l/questions.md`
under "WATCHER 2026-11-21 13:25". It replaces the closed #3941.

Words used here: a **part payment** (the code says "advance", the ticket says «Pago a cuenta») is
money a guest pays before the table's own ticket, with a ticket of its own. The **table's ticket**
is the invoice issued at the end; it lists the dishes and **takes off** each part payment by
number, date and amount.

## Outcome

- When money has to come back after the table's ticket took a part payment off, the till says what
  to do: correct the table's ticket for what it can give back, and give any rest back **by hand**
  (cash from the drawer, or a refund on the card machine or in the SumUp app), then **record it**.
- Staff see, on the bill, each part payment's ticket and the table's ticket that took it off.
- The accountant's export shows the same link, and lists every amount given back by hand: amount,
  cash or card, who, when, why and the two tickets. Waitron files nothing about it with AEAT; the
  accountant decides what, if anything, to do.

## What happens today (each point read, unless it says "ran")

1. **Both ways of giving the part payment back are refused once the table's ticket took it off.**
   `refuseTakenOffAdvance` answers `advance.taken_off_final_invoice` when a line of a non-corrective
   sale names the part payment in `deducts_sale_id` (`apps/server/src/advance-taken-off.ts:13-27`).
   It runs on Correct invoice (`invoice-corrections.ts:151`), on a bill refund (`bill-refunds.ts:689`)
   and on a ticket refund (`tender-refund-reservation.ts:147`, `:216`). The till's words send staff
   to Correct invoice on the table's ticket (`apps/till/src/i18n/codes.ts:664-667`).
2. **Correct invoice on the table's ticket gives back only money paid on that ticket.** Asking for
   more answers `invoice_correction.money_short` (`apps/server/src/invoice-corrections.ts:126-131`),
   worded "Enter a smaller amount" (`apps/till/src/i18n/codes.ts:516-519`). So a table's ticket that
   came to €0.00, or less than what must come back, cannot give the rest back, and nothing else can.
   Ran: `pnpm exec vitest run src/advance-corrections.test.ts -t "takes nothing off the 21% dishes|refuses Correct invoice on the advance's ticket"`
   in `apps/server`: 2 passed. The first pins a table's ticket with €50 paid refusing €50.01 and,
   after €50 back, €0.01 (`advance-corrections.test.ts:344-394`).
3. **The link already exists in the data.** The table's ticket's deduction line holds the part
   payment's sale id in `sale_lines.deducts_sale_id`, indexed, and only a deduction line has one
   (`packages/db/src/schema/sales.ts:274-275`, `:299-302`, `:309`). `bill_advances` ties each part
   payment's sale to its bill and its bill payment (`packages/db/src/schema/bill-advances.ts:11-42`).
4. **The bill's Pay window does not show it.** A part payment's row shows "Payment n · cash/card",
   the amount and the tip (`apps/till/src/widgets/bill-pay-dialog.ts:1417-1440`); the server sends
   only its sale id and what is left of it (`apps/server/src/bill-payments.ts:699-706`), not its
   number, date, VAT or the table's ticket. The table's own ticket, printed or on screen, already
   names each part payment by number and date (`apps/server/src/receipt-document.ts:225-229`).
5. **The accountant export does not show it.** The workbook has three sheets: issued invoices,
   purchases, other card machines (`apps/server/src/accountant-export.ts:180`). A part payment's
   ticket is typed only F1 or F2, with no column naming the ticket that took it off (`:262-268`).
6. **Nobody enters the daily close's "payouts" today.** It is one figure per till, typed at the
   close (`packages/reporting/src/record-daily-close.ts:118`, `:155`, `:202`). Ran a grep: the only
   callers of `recordDailyClose` are the bench script (`apps/server/scripts/bench/trading-day.ts:494`)
   and a test fixture (`apps/server/src/testing/deferred-close-fixture.ts:179`); no route or screen.
   The owner-approved drawer design (A1325, with A239) replaces "payouts" with recorded cash in and
   out, and counts cash refunds out of the drawer
   (`docs/superpowers/specs/2026-11-06-a1325-close-a-drawer-design.md:66-69`, `:124-129`, `:188-189`);
   it has no plan yet. What the Sales screen does count is the cash-up: payments in, refunds out,
   per till and method (`packages/reporting/src/cash-up.ts:87-118`).
7. **`activity_log` cannot hold the record.** No product decision may read it
   (`docs/developers/conventions-data.md:6870-6877`), and a cash count is one.
8. **Adviser sheet:** a grep of `docs/compliance/2026-11-19-adviser-meeting.md` on main finds no
   questions A1 or A2, so nothing needs withdrawing. Its question 6 already asks whether money may be
   given back without a corrective (line 163); that answer covers this route too.

## Design

**(a) The refusal explains the route.** The server's refusal and its parameters stay as they are.
The till's words become (Spanish twin to match):

> Payment on account already taken off receipt A/45. To give money back, use Correct invoice on
> A/45 first. If it cannot give back all of it, give the rest by hand (cash from the drawer, or a
> refund on the card machine or in the SumUp app), then choose **Record money given back**. That
> counts it in the day's takings and the accountant's export; nothing is sent to the tax agency.

It meets the refusal rule (root `CLAUDE.md` §3): it says what happened (taken off on A/45), what
each choice does (Correct invoice gives back what was paid on A/45; recording counts the money and
files nothing), and the action is a button in the same place, with the usual manager PIN for a
person who may not refund (guide, `apps/server/src/guide/en/table-service.md:226-227`). Nobody is
sent elsewhere. Decision 2 adds the same last two sentences to `money_short` on such a ticket.

**(b) The link on the bill and in the export.** The Pay window's part payment row adds its ticket
number, date and VAT ("A/12 · 19/11 · 10%: €27.27 + €2.73"; how it was paid is already shown) and,
once issued, "Taken off on A/45". The export's issued-invoices sheet gains a column "Payment on
account": "Taken off by A/45" on a part payment's rows, "Takes off A/12, A/13" on the table's ticket.
Both read `deducts_sale_id`; no new data.

**(c) The record of money given back by hand.** A new table (working name `hand_refunds`) in
core's set, classified **ledger** and **append-only** (`appendOnly()`): money already handed over is
never corrected. Columns: id, node, the part payment's sale, the table's ticket's sale, amount
(whole cents), `cash` or `card`, reason (the refund reasons list, with a note for Other), the person
who gave it back, the approver when a PIN was asked, the till device, and the time. It rebuilds
core's starting migration (`migration-baseline rebuild --set core`); no new migration file, no
compatibility code. A till route records one. It refuses: without `sale.refund` (or a PIN), a
device whose profile does not allow that method (as a refund today checks the action its payment
was taken with, `apps/server/src/till-api.profile-actions.test.ts:538`), a part payment not yet taken off, an amount above the
part payment's ticket less what was already recorded on it, and while the box's time is unconfirmed
(root `CLAUDE.md` §5 asks the same before refund and drawer work). It writes nothing to `sales`, `sale_lines`, `registros_facturacion`, the chain or
numbering. It **feeds** the day's figures rather than reusing "payouts", which nobody enters (point
6): one more line in the cash-up's union, money out for that till and method, so the Sales screen's
cash for that till drops by it. When A1325 is built, its drawer balance reads these rows as cash out,
as it already plans for cash refunds; its plan must say so. A card record is a note that the refund
was done on the card machine or in the SumUp app; Waitron moves no card money.

**(d) In the export.** A fourth sheet, "Money given back by hand", one row per record in the
period: when, amount, cash or card, who (name read at export time), reason, the part payment's
ticket and the table's ticket.

## Decisions for the owner

1. **Wording: correct the table's ticket first, then by hand.** (i) Both steps, as above
   (recommended; cost: a longer message). (ii) By hand only (shorter, but staff skip a correction
   AEAT would have received).
2. **Also explain the hand route when Correct invoice on a table's ticket runs short of money** and
   that ticket took off a part payment. (i) Yes (recommended: that is where staff land after
   following step one; cost: one extra read when refusing). (ii) No.
3. **Where it is recorded.** (i) On the till, from the refusal, by someone allowed to refund or
   with a manager's PIN (recommended). (ii) On the dashboard only (cost: the person at the till has
   to find a computer; the refusal can only describe it).
4. **A cash record opens the drawer** through the usual recorded drawer opening. (i) Yes
   (recommended). (ii) No: staff open it separately, and the opening is not tied to the record.
5. **What counts in the day's takings.** (i) Cash and card, by method, so cash matches the drawer
   and card matches the machine's own total (recommended; cost: the card figure is what staff typed,
   not SumUp's confirmation). (ii) Cash only. (iii) Neither: listed in the export only, and the cash
   count shows the money as a shortage.
6. **A mistaken record.** (i) Cannot be changed or removed; it stays visible and the cash count shows
   the difference (recommended: simplest, and the accountant sees it). (ii) A manager can cancel one
   the same day, kept as a second record (cost: another route and state, and the cash-up nets it).

## Size

About 450 lines of production code, over 3 PRs, plus tests. A new table and core's rebuilt starting
migration, so the full review ceremony applies. Each PR touches the accountant export or the day's
money figures; I recommend the owner lands each.

- **PR 1, (b):** the link on the Pay window and in the export, about 110 lines, no table.
- **PR 2, (c) and (d), server:** table, route, cash-up line, export sheet, about 220 lines.
- **PR 3, (a) and (c), till:** wording, the record form from the refusal, the record shown under
  the part payment, guide in English and Spanish, about 120 lines.

## Tasks (each test first: watch the new test fail, build, watch it pass, commit with `-s`)

1. **Pay window link.** Server test: a bill with a part payment, then its table's ticket, answers the
   part payment's number, date, VAT and "taken off by" number. Till test: the row shows them.
2. **Export link column.** `accountant-export.test.ts`: both rows carry the link, other rows empty.
3. **The table.** Schema, classification, `scripts/write-path-tables.json` entry, baseline rebuild;
   schema and trigger guards pass; an UPDATE is refused by the append-only trigger.
4. **The record route.** One case per refusal in (c), with the domain code, plus profile-action and
   session-person inventory rows; a cash record queues one drawer opening (decision 4).
5. **Cash-up.** `bill-payments.cash-up.test.ts`: a €20 cash record lowers that till's cash by €20;
   a card one lowers card (decision 5).
6. **Export sheet.** Rows in the period only, names read at export time.
7. **Till wording.** `codes.test.ts` pins the new EN and ES text for both refusals (decision 2).
8. **Till form and list.** The refusal's button opens a form built from field primitives; saving
   shows the record under the part payment; guide sections updated in both languages.

## Guards to run

Golden huella `packages/fiscal-verifactu/src/write-path.e2e.test.ts` and `inmutabilidad.test.ts`,
both unedited. Then `scripts/schema-constraints.test.ts`, `append-only-triggers.test.ts`,
`behavioural-triggers.test.ts`, `starting-migrations.test.ts`, `classification-complete.test.ts`,
`id-columns-are-references.test.ts`, `two-file-foreign-keys.test.ts`, `write-path-tables.test.ts`,
`errors-reachable.test.ts`, `english-only.test.ts`, `native-form-fields.test.ts`; in `apps/server`,
`till-api.profile-actions.test.ts`, `till-api.session-person.test.ts`, `guide-content.test.ts`,
`advance-corrections.test.ts`, `accountant-export.test.ts`, `bill-payments.cash-up.test.ts`.

**Order with other work:** A1308 is rewriting the payment and refund tables; check its current
slice before PR 2 touches the cash-up.
