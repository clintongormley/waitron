# Split a bill after its ticket printed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff print a table's bill, the guests then decide to pay separately, and the till undoes
the printed ticket with a credit note and puts its dishes back on a new open bill, so each guest's
dishes can be moved to their own bill and printed or paid as their own ticket.

**Architecture:** The till's existing **Cancel and credit** (#1055) already files a whole credit
note (an R5 corrective) for a printed, unpaid ticket. This plan adds a second way out of the same
server path: instead of abandoning the bill's dishes, it moves them all to a new open bill of the
same party. Splitting them between guests then uses today's Move dishes and Print the bill unchanged.

**Tech Stack:** Hono routes in `apps/server`, Drizzle on SQLite, Lit till in `apps/till`.

**Spec:** the queue item's ask and the owner's answer recorded on the adviser sheet, "Either a
cancellation or correction is acceptable here" (`docs/compliance/2026-11-19-adviser-meeting.md:110-114`); the survey that chose the
corrective, with receipts: `~/waitron-campaign-l/receipts/adviser-split-after-print/finding.md`.

## Why a corrective and not a cancellation

Run on main `64ea6c0c39` (survey E8, E9): Cancel and credit already files the R5 for a printed,
unpaid ticket, with its permission, approver PIN and till dialog. A cancellation record
(`recordVoid`) has no product caller, leaves the bill still issued and still taking payments, would
be the first cancellation a real venue sends AEAT, and the adviser's answer 1.7 keeps cancellations
for sales that never happened. The corrective needs about half the new code.

## ⚠ Decision needed before building (fresh read, 2026-11-20, finding C1)

A fresh read ran it (`receipts/adviser-split-after-print/fresh-read-31d17f0473.md`): **a printed
bill's dishes cannot leave it.** `moveOrderLines` refuses a bill that is not open
(`working-order.ts:4228-4229`, `tab.not_open`); underneath, the database rule
`working_order_lines_require_open_parent_update` (`packages/db/triggers/core.sql:393-401`) refuses
any line write on a bill that is not open, and `working_orders_enforce_transition`
(`core.sql:710-718`) lets a printed bill become only paid or cancelled. Task 1 below is written for
option (a); it is not built until one is chosen.

- **(a) Recommended: let dishes leave a bill whose ticket is wholly credited.** Narrow both checks so
  a line may move from a `placed` or `abandoned` bill to an open bill when that bill's ticket has a
  whole credit note against it (its corrective's total is minus the ticket's), and nowhere else. The
  dishes keep their ids (A1308: the order line is the dish), and the move reuses the merge of two
  bills (`mergeCheckedBills`, `bill-actions.ts:155-192`), which already carries set-menu copies and
  kitchen print links. Cost: a change to a database protection on issued bills, so the core starting
  migration is rebuilt (`migration-baseline rebuild --set core`) and test venues reset. Before
  building, check that nothing reads a ticket's content back from the bill's dishes rather than from
  the sale's own lines (`orders-reprint.ts`, the receipt layout).
- **(b) Copy the dishes instead.** Leave the originals on the cancelled bill, as Cancel and credit
  does, and copy each onto the new bill under a new id with its kitchen item, allergy ticks, print
  links and set-menu copies. No database rule changes, but the dishes get new ids (against A1308's
  rule) and every piece of per-dish state needs its own copy code; larger and easier to get wrong.

## Global Constraints

- Nothing new is sent to AEAT: the same R5 whole credit `creditWholeInvoice`
  (`apps/server/src/cancel-credit.ts:46-79`) files today. `recordCorrection`, the chain, numbering,
  `computeHuella` and `registros_facturacion`'s triggers are not touched. The golden huella test and
  `inmutabilidad` pass unedited.
- No new table or column. Option (a) changes two database rules in `packages/db/triggers/core.sql`
  and rebuilds the core starting migration. The order history entry reuses kind `order_cancelled`
  (`packages/db/src/schema/order-amendments.ts:14`), reason `Bill split after printing`; orders lists
  show the old bill as Cancelled (`orders-list.ts:121-132`), which the guide says.
- Same eligibility as Cancel and credit: a `placed` bill with an issued ticket, no payment, no card
  payment in flight, no customer-named invoice. Same permission: `sale.rectify`, with an approver's
  PIN when the operator lacks it.
- English and Spanish till strings and guide sections change together.

## Review Focus

1. A comped or discounted dish keeps its comp or discount on the new bill and on the new ticket.
2. A dish printed with **Print anyway** and not yet served: no VOID slip; the kitchen is told of the
   move as Move dishes tells it.
3. After the undo and two new tickets, sales reports count each dish once, and VAT nets to the
   dishes' value once (original + credit note + new tickets).
4. A second tap, or a second till, on the same bill: refused `working_order.not_placed`; one credit
   note only.
5. A box waiting for its time to be confirmed: refused as Cancel and credit is, nothing moved.

---

### Task 1: Server — undo a printed ticket and keep its dishes

**Files:**
- Modify: `apps/server/src/working-order.ts` (`cancelPlacedOrder` ~7780, `cancelPlaced` 7806-7883)
- Modify: `apps/server/src/till-api.ts` (beside `POST /api/working-orders/:id/cancel`, 2958)
- Test: `apps/server/src/split-after-print.test.ts` (copy `cancel-invoiced-order.test.ts`'s setup)

**Interfaces:**
- Produces: `POST /api/working-orders/:id/split-after-print`, body `{ override?: unknown }`,
  answers `200 { billId: string, creditNoteNumber: string }`; refusals as the cancel route's
  (`working_order.not_placed`, `bill.payments_received`, `order.payment_in_flight`,
  `authorization.not_permitted`, the PIN-override codes, and `bill.not_issued` for a bill with no ticket).
- `cancelPlaced(…, mode: { keepDishes: boolean })`; with `keepDishes: true` it returns the new bill id.

- [ ] **Step 1: Write the failing tests** in `split-after-print.test.ts`, through the real route:
  - `prints, splits, and each guest gets a ticket`: a €48 bill (€30 + €18 served dishes), Print the
    bill → `A/1`; split-after-print as an administrator → 200; one R5 filed, total `-48.00`,
    naming `A/1`; the old bill `abandoned` with no lines; the new bill `open` holding both dishes at
    their prices; move the €18 dish to a third bill; Print the bill on each → tickets `30.00` and
    `18.00`.
  - `needs sale.rectify`: a plain operator → 403 `authorization.not_permitted`, nothing filed or moved.
  - `refuses a part-paid bill` (`bill.payments_received`), `a second request`
    (`working_order.not_placed`, one R5 in total), `a placed bill with no ticket` (new code
    `bill.not_issued` in `apps/server/src/errors.ts`; run `scripts/errors-reachable.test.ts`), `a box waiting for its time` (the cancel route's refusal, nothing moved).
  - Review Focus 1, 2 and 3 as one case each: a comped dish keeps its comp on the new ticket; an
    unserved dish gets no VOID slip and gets the moved slip Move dishes enqueues; the VAT summary
    (`packages/reporting/src/vat-summary.ts`) and category sales (`category-sales.ts`) for the day
    count each dish once.
- [ ] **Step 2: Run, watch them fail:** `pnpm --filter @waitron/server exec vitest run src/split-after-print.test.ts`
- [ ] **Step 3: Implement (option a).** Narrow the two checks named above, with a case in
  `scripts/behavioural-triggers.test.ts`'s style proving a line still cannot leave a printed bill
  with no whole credit, then rebuild the core starting migration. The route's outer step (beside
  `cancelPlacedOrder`, `working-order.ts:7780-7804`) asks for `sale.rectify` with the PIN override
  and passes the fixed reason; inside the one `withIssuanceTransaction`, with the bill locked,
  `cancelPlaced` with `keepDishes` refuses `bill.not_issued` when there is no ticket, credits it,
  creates the new bill keeping the old bill's way of dining and service context
  (`createOpenOrder(…, copyServiceContextFrom)`, as Move dishes does, `bill-actions.ts:325-330`),
  moves the whole bill as `mergeCheckedBills` does (`moveOrderLines(…, undefined)`,
  `moveKitchenPrintLinks`), skips the VOID slips and `ensureFamilyBill`, still withdraws pending
  department transfers, sets the old bill `abandoned`, and bumps the party revision.
- [ ] **Step 4: Run the file and `cancel-invoiced-order.test.ts`; both pass.** Then the golden
  huella test and `inmutabilidad` (RUNNER cheatsheet), unedited.
- [ ] **Step 5: Commit** (`git commit -s`).

### Task 2: Till — "Reopen to split" on a printed bill

**Files:**
- Modify: `apps/till/src/screens/till-table-order-screen.ts:7039-7046` (the ⋮ menu)
- Modify: `apps/till/src/till-app.ts` (`#onCancelCreditBill` 20893 and its dialog), `apps/till/src/api/client.ts`
- Modify: `apps/till/src/i18n/strings.ts` (EN 1977-2001, ES ~4137), `apps/server/src/guide/en|es/table-service.md` `{#print-bill}`
- Test: `till-screen.table-menu.test.ts`'s cancel-credit cases' file and the cancel-credit dialog tests in `till-app*.test.ts` (search `cancel-credit-bill`)

**Interfaces:** Consumes Task 1's route and answer.

- [ ] **Step 1: Failing tests:** the menu shows **Reopen to split** exactly when it shows **Cancel and
  credit**; choosing it opens the cancel-credit dialog in split mode with no reason field, scope text
  `Ticket {invoice} ({amount}) is credited in full with a credit note, and its dishes go back on a new open bill so each guest can have their own ticket.`,
  confirm button `Reopen to split`, keep button `Keep the bill`; the approver PIN step is the same;
  on 200 the till shows `Credit note {number} issued. Move each guest's dishes to their own bill, then print each one.`
  and opens the new bill; each refusal shows the cancel-credit refusal text for that code.
- [ ] **Step 2: Run, watch them fail.**
- [ ] **Step 3: Implement** with a `mode: "cancel" | "split"` on the existing `CancelCrediting`
  state; Spanish strings beside the English; the guide's Print the bill section gains two sentences
  in each language: if the guests then want to pay separately, choose **Reopen to split**; the ticket
  is credited and its dishes return on a new bill, ready for **Move dishes**.
- [ ] **Step 4: Run the changed till test files, `apps/server/src/guide-content.test.ts` and
  `scripts/guide-links.test.ts`; look at the dialog in both themes and at phone width.**
- [ ] **Step 5: Commit**, and update `docs/backlog/fiscal.md` A446's last owner paragraph to say the
  split after print is built.

## Not in this plan (decisions for the owner, defaults in brackets)

- **D1 Permission:** a split files a credit note, so it needs `sale.rectify` and a manager's PIN for
  staff without it, like Cancel and credit. Splits after print will be common. [Keep it.]
- **D2 Paper:** Cancel and credit prints no credit note; the new tickets print as usual. [Same.]
- **D0 Option (a) or (b)** above. [(a).]
- **D3 A printed bill already part paid:** refused today, and its payment cannot be refunded once the
  ticket exists. [Keep refused; the refusal tells staff the other guests pay the rest on this ticket.]
- **Splitting by amount** needs ADVISER-ADVANCES piece 1's "own receipt" part payment: after
  Reopen to split, it gives a guest their own ticket for an amount. Until it lands, split by dishes.
- **A bill holding an advance** (ADVISER-ADVANCES, not on main): that branch already counts an
  advance as money on the bill, so Reopen to split refuses it `bill.payments_received`; whichever
  lands second adds a test. Both change `reversedLines` in `cancel-credit.ts`: expect a rebase conflict.
- **A dish asked for after printing** keeps going on **+ New bill** (meal-end plan, line 310); Reopen
  to split could serve it too, but this plan does not offer it for that.
- **Full invoices naming a customer** wait for ADVISER-ADVANCES piece 3 (their correctives).

**Size (option a):** about 250–300 product lines, 450–550 test lines, plus the rebuilt core starting
migration's generated files; one pull request; test venues reset.
