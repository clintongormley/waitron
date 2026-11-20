# Split a bill after its ticket printed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff print a table's bill, the guests then decide to pay separately, and the till undoes
the printed ticket with a credit note and puts copies of its dishes on a new open bill, so each
guest's dishes can be moved to their own bill and printed or paid as their own ticket.

**Architecture:** The till's existing **Cancel and credit** (#1055) already files a whole credit
note (an R5 corrective) for a printed, unpaid ticket and leaves the dishes on the cancelled bill.
This plan adds a second way out of the same server path: after the credit, it copies every dish
onto a new open bill of the same party. Splitting them between guests then uses today's Move dishes
and Print the bill unchanged.

**Tech Stack:** Hono routes in `apps/server`, Drizzle on SQLite, Lit till in `apps/till`.

**Spec:** the queue item's ask and the owner's answer recorded on the adviser sheet, "Either a
cancellation or correction is acceptable here" (`docs/compliance/2026-11-19-adviser-meeting.md:110-114`); the survey that chose the
corrective, with receipts: `~/waitron-campaign-l/receipts/adviser-split-after-print/finding.md`.

## Why a corrective and not a cancellation

Run on main `64ea6c0c39` (survey E8, E9): Cancel and credit already files the R5 for a printed,
unpaid ticket, with its permission, approver PIN and till dialog. A cancellation record
(`recordVoid`) has no product caller, leaves the bill still issued and still taking payments, would
be the first cancellation a real venue sends AEAT, and the adviser's answer 1.7 keeps cancellations
for sales that never happened.

## Decision: (b), copy the dishes (watcher 2026-11-20 10:11)

A printed ticket's dishes are read from the bill's lines, not from the filed sale:
`readSettledTicket` (`apps/server/src/till-sale.ts:963-1031`, through `readStoredOrder` →
`readLockedLines`, `working-order.ts:1408-1417`, `1216-1227`) feeds the dashboard reprint
(`orders-reprint.ts:35`), the till's ticket read (`GET /api/sales/:id`, `till-api.ts:2521-2535`)
and invoice delivery (`invoice-delivery-actions.ts:113`, `:266`). Moving the dishes off the bill
would empty every reprint of the credited ticket, so they are copied and the originals stay on the
cancelled bill, as Cancel and credit leaves them today.

**The A1308 exception, said in the PR:** the copies are new dish rows with new ids, though A1308
says a dish moves with its line (`docs/superpowers/specs/2026-10-18-a803-bills-and-tables-design.md:63-66`).
It is taken because the printed ticket is drawn from the bill's lines. The nearest precedent is a
split, which gives the split-off row a new id (`splitRow`, `working-order.ts:5048-5107`).

A dish printed with **Print anyway** and still not served is refused, with **Mark served** in the
same message; the split then carries on. D1–D3 below keep their defaults.

## What each piece of a dish's state does

| State (schema) | Copied? | Why |
| --- | --- | --- |
| The line's own columns: product, names, descriptions, options, unit, quantity, prices, VAT classes, total, list price, category, course, station, note, group, credited-to, menu and offer context, allergens, diet, late-send fields, `sent_at`, `served_quantity`, `served_at` (`packages/db/src/schema/orders.ts:203-305`) | Yes, as read with `select()` | `applyLineEdits` copies a dish the same way when it adds whole portions (`working-order.ts:6789-6830`). New: `id`, `working_order_id`, `line_no` (in the original order, extras straight after their dish). |
| `parent_line_id` (`orders.ts:255`, key `:333-337`) | Remapped | Points at the copy of the dish. |
| `cohort_id`, `cohort_ordinal`, `whole_portion` | New cohort id per original cohort, same ordinals | `(cohort_id, cohort_ordinal)` is unique across the table (`orders.ts:413`) and the originals keep theirs. |
| Set-menu columns and `bill_set_menu_copies` (`set-menu-copies.ts`) | Never met | Print the bill refuses a bill holding set-menu lines, `set_menu.payment_not_ready` (`set-menu-bill.ts:64-74`, reached from `working-order.ts:1250`, `:1429`). The copy throws a plain `Error` if it meets one; a test pins it, so set-menu billing has to extend it. |
| `adjustment_lines` (comps and discounts per line, `adjustments/adjustment-lines.ts:11-29`) | Yes, `carryLineReductions` (`order-portions.ts:142-166`) | As a split and `applyLineEdits` carry them (`working-order.ts:5148`, `:6970`). |
| `adjustments` rows (`adjustments/adjustments.ts:39-90`) | No, they stay on the old bill | Append-only, and the adjustments report counts every row (`packages/adjustments/src/reports.ts:289-308`): a copy would count a comp twice. The new ticket therefore prints each dish's comp or discount from its list and charged price (`receipt-adjustments.ts:131`, `:173-182`, `:241-253`), as a ticket does today after Move dishes, which moves lines only (`working-order.ts:4313-4321`). |
| `line_service_cancellations` (`line-service-cancellations.ts:7-29`) | Yes, keyed to the copy | As `splitLineServiceState` writes one (`line-service-state.ts:174-176`). Without it, a dish taken off service but still charged reads as unserved on the new bill (`serviceQuantities`, `line-service-state.ts:20-32`) and stops its Print the bill. |
| `allergy_line_ticks` (`venue-service/party-allergy.ts:38-68`) | Yes, `copyAllergyWorkingTicks` (`kitchen-allergy.ts:402-428`), dishes only | As `splitRow` and `applyLineEdits` do (`working-order.ts:5104-5105`, `:6971`). |
| `ticket_items` (`ticket-items.ts:36-91`) | No | Every copied dish is served or off service (the refusal below), so the kitchen has finished. A sent line with no kitchen item reads as released (`isReleased`, `working-order.ts:3823-3835`). |
| `kitchen_print_job_lines`, `ticket_item_moves` (`kitchen-print-job-lines.ts:13-33`, `ticket-item-moves.ts:11-54`) | No | Paper already printed and hand moves made. With no print links, a later Move dishes sends the kitchen no slip for a copy, which is right for a served dish. |
| `sale_line_dishes` (`sale-line-dishes.ts:7-28`) | No | The originals stay linked to A/1's rows (key `restrict`). Each new ticket links its copies when issued (`linkSaleDishes`, `order-portions.ts:311-329`, called at `working-order.ts:7733`). |
| `bill_payment_lines` (`bill-payments.ts:118-140`) | None exist | A bill holding money is refused (`refuseBillHoldingMoney`). |
| `order_events` | No `dish.moved` | The originals stay on the old bill, so "moved" would be false; the old bill's `order_cancelled` entry names the new bill. |
| The bill: way of dining, service context, receipt language | Yes | `createOpenOrder(…, { copyServiceContextFrom, receiptLocale })` (`working-order.ts:1565-1577`, `:1660`, `:1669-1670`), the new bill made as Move dishes makes one (`bill-actions.ts:327-358`). |

**The database allows it as is.** An inserted line is refused only on a bill that is not open or
with descriptions not in the venue's invoice languages (`packages/db/triggers/core.sql:159-167`,
`:184-247`); nothing checks served columns on insert, and the cohort trigger fires on update only
(`:628-637`). If the invoice languages changed since a dish was rung, its copy is refused by the
same rule that refuses moving it today (`:203-222`).

**Mark served on a printed bill already works.** `unservedDishes` (`meal-end.ts:214-255`) lists
the dishes not served in full nor taken off service; on a placed bill these can only be dishes
printed with Print anyway (`meal-end.ts:112-116`). `POST /api/parties/:id/served` → `markServed`
(`till-api.ts:3638-3668`, permission `hand-over-orders`; `working-order.ts:4025-4035`) reaches
placed bills (`servableLines` → `onShownBill`, `working-order.ts:3750-3797`,
`order-groups.ts:2135-2143`), and the database lets a bill that is not open change its served
columns alone (`core.sql:403-405`). The till already offers **Mark served** for Print the bill's
list (`till-table-order-screen.ts:5478-5540`, `#markListedServed` `:5641-5646`).

## Global Constraints

- Nothing new is sent to AEAT: the same R5 whole credit `creditWholeInvoice`
  (`apps/server/src/cancel-credit.ts:46-79`) files today. `recordCorrection`, the chain, numbering,
  `computeHuella` and `registros_facturacion`'s triggers are not touched. The golden huella test and
  `inmutabilidad` pass unedited.
- No table, column, trigger or migration. This is not a "Reset test venues" PR.
- The order history entry reuses kind `order_cancelled`
  (`packages/db/src/schema/order-amendments.ts:14`), reason `Bill split after printing to bill <n>`
  (the new bill's `bill_number`; the table has no column for a target bill, `:26-47`); orders lists
  show the old bill as Cancelled with its dishes (`orders-list.ts:121-132`). The guide does not
  say so: staff carry on from the new bill, and the old one asks nothing of them.
- Same eligibility as Cancel and credit — a `placed` bill with an issued ticket, no payment, no card
  payment in flight, no customer-named invoice — narrowed to a table's bill its party has not left
  unpaid. Same permission: `sale.rectify`, with an approver's PIN when the operator lacks it.
- English and Spanish till strings and guide sections change together.

## Review Focus

1. Copied state matches the original for every column the new ticket prints: name, options,
   extras, quantity, unit, price, list price (comp or discount), VAT class, receipt language.
2. A dish printed with **Print anyway** and not served: refused, nothing filed or copied; no VOID
   or moved kitchen slip at any point of a split.
3. After the undo and two new tickets, sales reports count each dish once, and VAT nets to the
   dishes' value once (original + credit note + new tickets); the adjustments report counts each
   comp once.
4. Current orders and Finish table list each dish once: they skip the cancelled bill
   (`onShownBill`).
5. A second tap, or a second till, on the same bill: refused `working_order.not_placed`; one credit
   note only. A box waiting for its time to be confirmed: refused as Cancel and credit is.

---

### Task 1: Server — undo a printed ticket and copy its dishes

**Files:**
- Create: `apps/server/src/split-after-print.ts` (`copyBillDishes`, `splitAfterPrint`)
- Modify: `apps/server/src/working-order.ts` (`cancelPlaced` 7816-7899 gains a split mode)
- Modify: `apps/server/src/meal-end.ts` (export `unservedDishes`, 214)
- Modify: `apps/server/src/errors.ts` (beside `meal_end.unserved_dishes`, 742), `apps/server/src/till-api.ts` (status map ~646; route beside `POST /api/working-orders/:id/cancel`, 2958)
- Test: `apps/server/src/split-after-print.test.ts` (copy `cancel-invoiced-order.test.ts`'s setup)

**Interfaces:**
- Produces: `POST /api/working-orders/:id/split-after-print`, body `{ override?: unknown }`,
  answers `200 { billId: string, creditNoteNumber: string }`; refusals as the cancel route's
  (`working_order.not_placed`, `bill.payments_received`, `order.payment_in_flight`,
  `authorization.not_permitted`, the PIN-override codes), plus four new codes, all 409, each
  `{ workingOrderId }` unless shown:
  - `bill.not_at_table`: a counter order, `working_orders.party_id` null
    (`packages/db/src/schema/orders.ts:114-115`). Mark served is per party, so the unserved
    refusal's button could not be reached.
  - `bill.left_unpaid`: the bill has an `unpaid_departures` row
    (`packages/db/src/schema/unpaid-departures.ts:11-21`). Cancel and credit takes it
    (`cancel-invoiced-order.test.ts:944`), but a split would open a bill for guests who have gone,
    which the close of day would then issue; Mark served skips it too (`onShownBill`,
    `order-groups.ts:2134-2143`).
  - `bill.not_issued`: no ticket.
  - `bill.unserved_dishes { workingOrderId, dishes: { lineId, dishName, quantity, released }[] }`,
    the dish shape of `meal_end.unserved_dishes`.
- Refusal order: the bill's state first (`working_order.not_placed`, `bill.not_at_table`,
  `bill.left_unpaid`, `bill.not_issued`, `sale.correction_unsupported` for a full invoice naming a
  customer, `bill.payments_received`, `order.payment_in_flight`), then
  `bill.unserved_dishes`, then `sale.rectify`. So staff are never told to mark dishes served — which
  also takes them off the pass board (`leftToServe`, `kitchen-print.ts:959-973`) — on a bill that
  would then be refused anyway.
- `copyBillDishes(tx, fromBillId, toBillId, actorId): Promise<Map<string, string>>` (original id →
  copy id).

- [ ] **Step 1: Write the failing tests** in `split-after-print.test.ts`, through the real routes:
  - `prints, splits, and each guest gets a ticket`: a €48 bill (€30 + €18 served dishes), Print the
    bill → `A/1`; split-after-print as an administrator → 200; one R5 filed, total `-48.00`,
    naming `A/1`; the old bill `abandoned` still holding both dishes; the new bill `open` holding
    copies with new ids at the same prices, served; move the €18 dish to a third bill; Print the
    bill on each → tickets `30.00` and `18.00`.
  - `the credited ticket still reprints its dishes`: after the split, `GET /api/sales/<old bill>`
    and the dashboard's `POST /management-api/orders/<old bill>/reprint` both list the €30 and €18
    dishes and total `48.00`.
  - `refuses a dish printed with Print anyway, then splits once it is marked served`: one dish
    unserved, Print anyway → `A/1`; split → 409 `bill.unserved_dishes` naming that line with
    `released: true`, nothing filed or copied; `POST /api/parties/:id/served` for it → 200; split
    again → 200.
  - `needs sale.rectify`: a plain operator → 403 `authorization.not_permitted`, nothing filed or
    copied; with an unserved dish the same operator gets `bill.unserved_dishes` first.
  - `refuses a part-paid bill before its unserved dishes`: a printed bill with a part payment and an
    unserved Print-anyway dish → 409 `bill.payments_received`, not `bill.unserved_dishes`.
  - `refuses a bill its party left unpaid` (`bill.left_unpaid`, set up as
    `cancel-invoiced-order.test.ts:944` does) and `refuses a counter order` (`bill.not_at_table`, a
    placed counter order with a ticket); nothing filed or copied in either.
  - `refuses a part-paid bill` (`bill.payments_received`), `a second request`
    (`working_order.not_placed`, one R5 in total), `a placed bill with no ticket`
    (`bill.not_issued`), `a box waiting for its time` (the cancel route's refusal, nothing copied).
  - Review Focus 1, 3 and 4, one case each: a comped dish with an extra and an allergy tick keeps
    its price, list price, extra and tick on the copy, and the new ticket prints the comp; a dish
    taken off service but charged copies its cancellation, so the new bill prints without Print
    anyway; the VAT summary (`packages/reporting/src/vat-summary.ts`), category sales
    (`category-sales.ts`) and the adjustments report count each dish and comp once; Current orders
    lists each dish once.
  - `copyBillDishes` throws on a set-menu line (a direct call on a fixture bill).
- [ ] **Step 2: Run, watch them fail:** `pnpm --filter @waitron/server exec vitest run src/split-after-print.test.ts`
- [ ] **Step 3: Implement.** Add both codes to `errors.ts` and the status map, and run
  `scripts/errors-reachable.test.ts`. The route's outer step mirrors `cancelPlacedOrder`
  (`working-order.ts:7789-7814`). In `cancelPlaced`'s transaction, with the bill locked, the split
  mode refuses in the Interfaces order; today's mode keeps its own (`sale.rectify` at
  `working-order.ts:7840`, before the money checks at `:7842-7847`). The till asks for a PIN only
  after `authorization.not_permitted` (`till-app.ts:21029-21031`), so every other refusal comes
  before any PIN. Then `creditWholeInvoice`, the new bill made as Move dishes makes it
  (`bill-actions.ts:327-358`) with the old bill's `receiptLocale`, and `copyBillDishes`.
  `copyBillDishes` follows the table above: read the rows with `select()`, insert with
  `insertInChunks`, then `carryLineReductions`, the service cancellations and
  `copyAllergyWorkingTicks`. The VOID-slip step runs unchanged: it finds only unserved dishes
  (`working-order.ts:7850-7867`) and the unserved refusal leaves none. The split skips
  `ensureFamilyBill`, still withdraws pending department transfers, sets the old bill `abandoned`,
  appends the amendment naming the new bill, and bumps the party revision.
- [ ] **Step 4: Run the file and `cancel-invoiced-order.test.ts`; both pass.** Then the golden
  huella test and `inmutabilidad` (RUNNER cheatsheet), unedited.
- [ ] **Step 5: Commit** (`git commit -s`).

### Task 2: Till — "Reopen to split" on a printed bill

**Files:**
- Modify: `apps/till/src/screens/till-table-order-screen.ts:7041-7048` (the ⋮ menu)
- Modify: `apps/till/src/till-app.ts` (`#onCancelCreditBill` 20893, `#sendCancelCredit` 20945 and its dialog), `apps/till/src/widgets/cancel-credit-dialog.ts`, `apps/till/src/api/client.ts`
- Modify: `apps/till/src/i18n/strings.ts` (EN 1977-2001, ES ~4137), `apps/till/src/i18n/codes.ts` (beside `meal_end.unserved_dishes`, 588), `apps/server/src/guide/en|es/table-service.md` `{#print-bill}`
- Test: `till-screen.table-menu.test.ts`'s cancel-credit cases' file, `cancel-credit-dialog.test.ts`, and the cancel-credit cases in `till-app*.test.ts` (search `cancel-credit-bill`)

**Interfaces:** Consumes Task 1's route, answer and `bill.unserved_dishes`; `api.markServed`
(`client.ts:4744-4750`).

- [ ] **Step 1: Failing tests:** the menu shows **Reopen to split** exactly when it shows **Cancel and
  credit** (`till-table-order-screen.ts:7040`) and the bill is not `leftUnpaid`; choosing it opens the cancel-credit dialog in split mode with no reason field, scope text
  `Ticket {invoice} ({amount}) is credited in full with a credit note, and its dishes go back on a new open bill so each guest can have their own ticket.`,
  confirm button `Reopen to split`, keep button `Keep the bill`; the approver PIN step is the same;
  on 200 the till shows `Credit note {number} issued. Move each guest's dishes to their own bill, then print each one.`
  and opens the new bill. On `bill.unserved_dishes` the dialog lists the dishes under
  `These dishes are not marked served, so the bill cannot be reopened yet. Mark served records that the guests have had them; the bill then reopens to split.`
  with a **Mark served** button for the dishes with `released: true` when the operator may hand
  over orders; pressing it marks them served and sends the split again. Dishes with
  `released: false`, or an operator without `hand-over-orders`, get D4's text and no button.
  `bill.left_unpaid` and `bill.not_at_table` get their own text in `codes.ts`; each other refusal
  shows the cancel-credit refusal text for that code.
- [ ] **Step 2: Run, watch them fail.**
- [ ] **Step 3: Implement** with a `mode: "cancel" | "split"` on the existing `CancelCrediting`
  state; Spanish strings beside the English (`Estos platos no están marcados como servidos, así que
  la cuenta aún no se puede reabrir. Marcar como servidos registra que los clientes ya los han
  tomado; después la cuenta se reabre para dividirla.`); the guide's Print the bill section gains
  two sentences in each language: if the guests then want to pay separately, choose **Reopen to
  split**; the ticket is credited and its dishes return on a new bill, ready for **Move dishes**.
- [ ] **Step 4: Run the changed till test files, `apps/server/src/guide-content.test.ts` and
  `scripts/guide-links.test.ts`; look at the dialog, its unserved list included, in both themes and
  at phone width.**
- [ ] **Step 5: Commit**, and update `docs/backlog/fiscal.md` A446's last owner paragraph to say the
  split after print is built.

## Decisions (defaults in brackets)

- **D0 Move or copy:** decided (b), copy (watcher, 2026-11-20 10:11).
- **D1 Permission:** a split files a credit note, so it needs `sale.rectify` and a manager's PIN for
  staff without it, like Cancel and credit. [Keep it.]
- **D2 Paper:** Cancel and credit prints no credit note; the new tickets print as usual. [Same.]
- **D3 A printed bill already part paid:** refused today, and its payment cannot be refunded once the
  ticket exists. [Keep refused; the refusal tells staff the other guests pay the rest on this ticket.]
- **D4 An unserved dish the kitchen has not been asked for** (still held in its course): Mark served
  refuses it, `group.line_held` (`working-order.ts:3953-3958`); sending the course
  (`/groups/:gid/fire`) and then Mark served works, as the fresh read ran. [The refusal says to send
  its course to the kitchen first, then mark it served; no button for it, as Print the bill's list
  does (`till-table-order-screen.ts:5484`).] Alternative for the owner: such a dish has no kitchen
  state, so the split could copy it as it is, still held, instead of firing it to the kitchen only to
  mark it served.
- **Splitting by amount** needs ADVISER-ADVANCES piece 1's "own receipt" part payment: after
  Reopen to split, it gives a guest their own ticket for an amount. Until it lands, split by dishes.
- **A bill holding an advance** (ADVISER-ADVANCES, not on main): that branch already counts an
  advance as money on the bill, so Reopen to split refuses it `bill.payments_received`; whichever
  lands second adds a test. Both change `reversedLines` in `cancel-credit.ts`: expect a rebase conflict.
- **A dish asked for after printing** keeps going on **+ New bill** (meal-end plan, line 310); Reopen
  to split could serve it too, but this plan does not offer it for that.
- **Full invoices naming a customer** wait for ADVISER-ADVANCES piece 3 (their correctives).

**Size:** about 340–420 product lines and 600–700 test lines, no generated files; one pull
request; no test venue reset.
