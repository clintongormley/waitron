# A445 and ADVISER-GOODWILL-CORRECTIVE: a free item takes its share of the price paid, and money given back as goodwill takes a corrective invoice

Status: plan, rewritten 2026-11-23 on `feat/adviser-goodwill-corrective` at `a460d355c4` (plus the
two commits of the 19 November plan this replaces). No product code yet. Every `file:line` below was
read on this branch; every figure marked "run" was produced by a command named beside it.

Words used below, once:

- A **corrective invoice** (Spanish *factura rectificativa*, type **R5** for a ticket) is a new
  invoice with negative amounts that reduces one already issued. Waitron files it with AEAT (the
  tax agency) like any other invoice record. Filed records can never be changed afterwards.
- The **VAT split** of an invoice is, for each VAT rate on it, the **base** (the price before VAT)
  and the **VAT** on that base. A ticket with a salad at 4% and a water at 21% has two rows.
- The **menu price** of a dish is the price it had before a comp or discount changed it. Waitron
  stores it beside the line as the "list" price (`working_order_lines.list_unit_price_gross`,
  `packages/db/src/schema/orders.ts:269`; on the filed line `sale_lines.list_gross` and
  `list_unit_price_gross`, `packages/db/src/schema/sales.ts:260-263`).
- A **free item** is a dish a comp, or a discount, took to €0 while its menu price is above €0 —
  the same test the corrections workbook's **Given free** sheet already uses ("a comp, or a
  discount that left it at zero", `apps/server/src/free-items.ts:45`, filter at `:137-139`).
- A **plain refund** is a **Refund a payment** that is not a step of **Correct invoice** and names
  no dishes cancelled with **Cancel and refund** or **Finish table**.
- A **part payment with its own ticket** (an *advance*, `bill_advances`) is money paid towards a
  table's bill that got a ticket of its own; the table's final ticket takes it off.
- The **watcher** is the session that supervises the campaign lanes and makes day-to-day choices
  the owner can overrule. The **adviser** is the venue's tax adviser.

## 0. Who decided what, and what the watcher still has to confirm

**Owner, 2026-11-21 18:17**, in the watcher's window, recorded in
`~/waitron-campaign-l/questions.md:1033-1037`, entry "WATCHER 2026-11-21 18:17":

- on goodwill money back: "take this as confirmed";
- on A445: "i thought this was also confirmed" (the watcher adds: it is, by the adviser's answer
  1.10 of 15 November, `docs/compliance/2026-11-15-adviser-answers.md:257-260`, and the owner's
  decision D4 "Build A445 now", `:275` and `:567`);
- for both: "i think we can build them and just put a confirmation note onto the adviser's list,
  ie 'have we done this right'".

**The watcher's relay, same entry:** "build them as planned in their items, with ONE allocation by
menu price shared by both (owner 21 Nov "yes and yes": split by menu price; a corrective is
required). In the same PR, add one line per item to the adviser's list
(docs/compliance/2026-11-19-adviser-meeting.md, open points) asking "have we done this right", with
the worked example." The "yes and yes" is recorded in the sheet itself,
`docs/compliance/2026-11-19-adviser-meeting.md:174`.

**The three goodwill choices of the 19 November plan** were the watcher's (2026-11-19 08:00):
(1) a plain refund of money the invoice counted is refused, naming Correct invoice; (2) an amount
given back with no dishes ticked on a two-rate ticket is shared across the dishes by price, and the
till stops limiting ticked dishes to one rate; (3) Complaint can be a reason for Correct invoice.
The watcher cleared choice 1 on 19 November 09:05; the owner then parked both items and unparked
them on 21 November as above. On **22 November 05:39** the watcher asked for choice 1 to be rebuilt
on top of #3993's rule for part payments (section 4.6).

- Choices 1 and 2 are covered by the owner's words: choice 1 is "a corrective is required", choice
  2 is "split by menu price".
- **Choice 3 (Complaint as a Correct invoice reason) is covered only by "build them as planned".**
  Nothing the owner said names it, and it changes nothing filed. **For the watcher to confirm**
  (section 4.7 gives the simplest alternatives). Its tasks come last and can be dropped without
  touching the rest.

**The planner's own calls in this plan, for the watcher** (each with its reason in section 4):
D1b (a correction weighs what is left of each dish's filed price, not its menu price), D2b (a
partial discount beside a free item is shared too), D3a (reprints from Find a bill print the menu
price from the filed line), D3b (the full invoice keeps its existing discount rows), D3c (a
cancelled dish's refund follows its filed share), D5b (no new line in the Refund a payment window),
and D9 (choice 3 kept as the 19 November design, last).

## 1. Should this exist?

**A445.** Need, in the adviser's words: "When the items carry different VAT rates, the price paid is
shared across all of them, the free one included, in proportion to their value (LIVA 79.Dos). The
free item may not be left at zero. The menu price is a fair measure of value for this."
(`docs/compliance/2026-11-15-adviser-answers.md:257-260`.) Today Waitron files the free item at €0
(finding, below). Once this lands, a takeaway ticket mixing rates with a free item files the
adviser's split. Nothing changes for tickets eaten here: since #4133 every line eaten here is at the
one dine-in rate, and at one rate both methods give the same VAT (finding section 2, run). The
simplest thing that meets the need is a single step at issuance that re-shares the price paid by
menu price when (and only when) the ticket's lines carry two rates and one is free. That is what
this plan does; the extras are the reprint fix (D3a, two lines), which keeps a guest's reprint
showing the dish as sold.

**Goodwill.** Need, from the owner's decision of 18 November ("Money given back as goodwill takes a
corrective", `docs/compliance/2026-11-19-adviser-meeting.md:68`) and 21 November ("take this as
confirmed"). Today a €1.00 plain refund is accepted and files nothing (finding section 5, run), and
Correct invoice refuses an amount with no dishes ticked on a two-rate ticket (finding section 3,
run). The simplest thing that meets it: refuse the plain refund where Correct invoice is the right
route, and let Correct invoice take an amount with no dishes ticked on any ticket. Choice 3 is
extra: it changes only which label staff put on a correction; section 4.7 weighs it.

**True size** (estimates from the files each task names, not from a build): about 240 production
lines (shared 35, core 10 changed, menu 45, server 75, till 15, adjustments and its dashboard 60 for
choice 3), about 900 new or changed test lines plus setup changes in 10 refund suites (section 6),
about 60 lines of guides, sheet and backlog. No generated file,
no migration, no schema change. Section 8 has the breakdown.

**Who approved:** section 0. Owner: the two needs and "split by menu price". Watcher: choices 1–3
of 19 November and the 22 November rebase on #3993. Planner: the calls listed at the end of
section 0. Nobody has reviewed this plan yet.

## 2. What people will see when it lands

- **A takeaway ticket with a free item at another rate.** Salad €10.00 at 4%, water €2.00 at 21%
  given free; the guest pays €10.00. The receipt still lists the salad at €10.00 and the water at
  €2.00 with "On the house −€2.00" beneath it; its VAT rows now read 4%: base €8.01, VAT €0.32 and
  21%: base €1.38, VAT €0.29 (today 4%: €9.62 and €0.38, and a 21% row of €0.00). The total does
  not change.
- **Goodwill.** A guest complains after paying; on the past receipt the manager chooses **Correct
  invoice**, types the money back, leaves the dishes unticked, picks a reason and presses **Correct
  and refund**, on any ticket. Waitron shares the amount across the dishes by price and files a
  corrective. Staff may also tick dishes at different rates. If the manager chooses **Refund a
  payment** instead and asks for money the invoice counted, the refusal says why and names
  **Correct invoice**.
- **Unchanged:** tickets eaten here, a discount on one dish with no free item, a refund of a tip,
  a refund of cancelled dishes, a part payment's refund as #3993 allows it, and a full invoice
  naming a customer.

## 3. What happens today

The receipt for behaviour is `~/waitron-campaign-l/receipts/adviser-goodwill/finding-2026-11-23.md`
(run on this branch through the real routes, `useVenueDb`, real Veri*Factu records), cited below
as "finding". The 19 November finding (`receipts/adviser-goodwill/finding.md`) still holds for the
refund rows it names.

**A445.** Finding section 1: water comped on a mixed takeaway ticket files 4%: 9.62 / 0.38 and a
21% row of 0.00 / 0.00; a line discount lowers only its own rate; a whole-bill discount is spread
by each line's charged price, so a €0 line gets none of it. Where the price enters:

1. A comp rewrites the stored line price to 0 (`zeroed`, `apps/server/src/adjustments-apply.ts:790`;
   `setPrice`, `:1252`, keeps the old price in `list_unit_price_gross` through
   `coalesce(…)` at `:1291`). A whole-bill discount spreads over the current charged prices
   (`spreadOverFiledRows`, called at `:843`).
2. At issuance every till path prices the stored lines (`priceStoredOrderForIssuance`,
   `apps/server/src/working-order.ts:1455`), runs `issuancePass`
   (`apps/server/src/issuance-pass.ts:18`, called at `working-order.ts:7781`), and rates them in
   `issueMoment` (`apps/server/src/issue-moment.ts:46`: `rateLines(gross, earlier ?? issueDay)`).
   `rateLines` (`packages/menu/src/pricing.ts:219`) groups lines by rate and takes each rate's base
   from the lines' gross. Advances are taken off after that, on the rated meal
   (`issue-moment.ts:47`, `deductAdvances`).
3. The filed lines are `filedLines(invoice)` (`working-order.ts:7789-7796`), which add each line's
   menu price through `withReceiptListPrices` (`apps/server/src/receipt-lines.ts:90-102`), and the
   breakdown is `priced.vatBreakdown`; both reach `recordSale` ready-made
   (`bill-payments.ts:1236-1237`, `working-order.ts:7867-7868`). `recordSale` and `computeHuella`
   need no change (finding section 6).

`rateLines` has three production callers: `issueMoment`, an advance's own ticket
(`apps/server/src/bill-advances.ts:133`) and the live basket (`priceBasket`, `pricing.ts:269`),
plus the demo seed (`apps/server/scripts/demo-seed/seed-sales.ts:288`) — `git grep -n "rateLines("`.

**Goodwill.** Finding section 3: Correct invoice with no dishes ticked on a two-rate ticket is
refused `sale.correction_scope_invalid` `{reason:"required"}` by
`packages/core/src/correction-allocation.ts:61-66`, which counts only lines whose gross is above
zero (`:63`). With dishes ticked it shares the amount by each dish's remaining filed price
(`apportionCorrectionCents`, `:75-78`, defined `:239-257`). The till greys out dishes at another
rate once one is ticked (`apps/till/src/widgets/invoice-correction-dialog.ts:577` and `:595`,
pinned by "previews the picked dishes and stops offering dishes at another VAT rate",
`invoice-correction-dialog.test.ts:238`). Finding section 5: a €1.00 plain refund is accepted and
files nothing.

**#3993 (7eb01d20f6).** `reserveTenderRefund` calls `refuseRefundOfAdvance`
(`apps/server/src/tender-refund-reservation.ts:137-147`) only when the request names no correction
and returns some payment amount (`:241-242`). For a sale that is a part payment with its own ticket
(`bill_advances.advance_sale_id`), `refusePlainRefundOfAdvance`
(`apps/server/src/advance-taken-off.ts:173-183`) refuses `tender.refund_of_advance` until a table's
ticket takes it off, then `advance.taken_off_final_invoice` while that ticket still holds money
Correct invoice can give back, and **allows** it after. Any other sale meets only
`refuseWhileCorrectionOpen` (`:239`).

**The 19 November work in progress** (local branch `wip/adviser-goodwill-task6-2026-11-19`, commit
`b95a643c19`, base `ee45498b38`, red when parked) holds choice 1's server refusal:
`refuseUncorrectedRefund` in the reservation, a `hasCancelStillOwed` reader in
`packages/adjustments/src/refund-links.ts`, the code in `errors.ts`, status 409, the till message,
and new cases in four test files. **Reused:** the reader's query and the refusal's three exemptions,
the code name, the status, the message (reworded below), and its test cases. **Not reusable as it
is:** its SQL names `tender_refunds` and `tender_refund_id`; on this branch the table is `refunds`
and the column `refund_id` (`refund-links.ts:69-71`). It runs before #3993's gate, not inside it,
and it reads the customer through `correctionTargetFor` where the sale row already carries it.

## 4. Design

### 4.1 D1: the one allocation, and where it lives

**Default: one function, `shareByWeight(total, weights)`, in `packages/shared/src/share-by-weight.ts`,
exported from `@waitron/shared`.** It is core's `apportionCorrectionCents`
(`correction-allocation.ts:239-257`) moved unchanged: each share rounded down to the cent, the cents
left over one at a time to the largest remainders, a tie to the earlier line. Callers:

- `allocateCorrectionAmounts` (`correction-allocation.ts:75` and `:109`), which keeps its
  behaviour — its 94 existing cases are the proof (`pnpm --filter @waitron/core exec vitest run
  src/correction-allocation.test.ts src/correction-history.test.ts`: Tests 93 passed, 1 failed on
  the probe in section 6, the one failure being the row this plan deletes);
- the new `shareFreeItems` (section 4.2).

Why `@waitron/shared`: `@waitron/menu` depends on `@waitron/core` but `@waitron/core` does not
depend on `@waitron/menu` (each `package.json`), and the dashboard imports `@waitron/menu`
(`apps/dashboard/src/api/client.ts`), so the pure decimal helper belongs with the other money
helpers (`packages/shared/src/money.ts`, `cancel-refund-share.ts`). Not merged:
`discountShares` and `spreadBillDiscount` in `packages/adjustments/src/spread.ts:270` and `:308`,
which rewrite stored unit prices to whole cents per unit, a different job.

**The rule, stated once for both items:** an amount not tied to particular dishes is shared across
the dishes in proportion to their prices, a free dish counting at its menu price.

- **At issuance (A445)** the weights are each line's menu price: its stored list total where it has
  one, otherwise its gross.
- **D1b, my call: in a correction (goodwill)** the weights stay what is left of each dish's filed
  price, as today. On a ticket A445 shared, that is already in proportion to menu price (probe
  below: €1.00 back on the comped ticket shares 0.83 / 0.17, as 8.33 / 1.67 does). Weighing by menu
  price instead could take more from a discounted dish than is left of it (salad €10 discounted to
  €1, water €2: €3 back by menu price is €2.50 off a dish with €1 left), and a line below zero makes
  every later correction refuse (`remainingLines`, `correction-allocation.ts:219-220`; read, not run).

### 4.2 D2: A445 — which tickets, and what is shared

**Default: free items only, and only when the meal's lines carry two or more VAT rates on the issue
day.** That is what answer 1.10 covers ("A free item given with a paid sale … When the items carry
different VAT rates"). A partial discount on one dish, with no free item on the ticket, stays on
that dish's own rate, as today; the adviser's line (section 4.8) says so and asks.

`shareFreeItems(gross: GrossLines, on: string): GrossLines`, new in `packages/menu/src/pricing.ts`:

1. If any line has an empty rate list, return `gross` unchanged (`rateLines` then refuses it as
   today, `pricing.ts:223`).
2. Take each line's rate on `on` with `rateOn`, as `rateLines` does (`:224`). If fewer than two
   rates, or no line is free (gross 0, `listGross` above 0), return `gross` unchanged.
3. Weights: `listGross` where set, else `lineGross`. Shares: `shareByWeight(gross.total, weights)`.
4. Each line whose share differs from its gross gets `lineGross` = its share and, where it had none,
   `listGross` = its old gross and `listUnitPriceGross` = its old `grossUnitPrice`, so the filed line
   still records the price it was sold at. `grossUnitPrice`, `total` and every other field stay.

Wiring (three small server edits):

- `issuancePass` (`issuance-pass.ts:51-64`) adds each line's `listGross` from its identity's
  `listUnitGross`, through `listGrossOf` (`receipt-lines.ts:104-118`, exported). `GrossLine`
  already carries an optional `listGross` (from `RecordSaleLine`, `packages/core/src/sale-line.ts:52`).
- `issueMoment` (`issue-moment.ts:46`) rates `shareFreeItems(gross, day)` instead of `gross`. It
  still returns the unshared `gross` (`:52`), which the settle receipt prints from
  (`bill-payments.ts:1286`), so the receipt keeps the dishes as sold.
- Nothing else: `filedLines` keeps a line's own list fields when its identity has no list price
  (`receipt-lines.ts:97-98`, `{ ...line }`).

**D2b, my call: when a free item is on the ticket, every line weighs at its menu price**, so a
partial discount on another dish, or a whole-bill discount, is shared by menu price too. That is
the owner's "split by menu price" taken literally, and the stored lines cannot tell a whole-bill
share from a one-dish discount without reading the adjustment records. Run on the probe: water
comped then €1.00 off the bill files 4%: 7.21 / 0.29 and 21%: 1.24 / 0.26 (the finding's hand
figures for this case).

**Not affected, and why:**

- **Eaten here:** one rate, so step 2 returns unchanged (probe: 10%: 9.09 / 0.91, as the finding).
- **A part payment's ticket** (`bill-advances.ts:133`) and the live basket call `rateLines`
  directly, never `shareFreeItems`.
- **A bill whose advance was paid at an earlier rate** (the VAT-RATES plan's open point,
  `docs/superpowers/plans/2026-11-22-vat-rates-a.md:1222-1223`): the rates counted are the meal's
  lines only; the advance is taken off after (`issue-moment.ts:46-47`).
- **A set menu's covered dish** has no stored list price (only the adjustments writer stores one,
  `adjustments-apply.ts:1291` — `git grep -n "listUnitPriceGross:"`), so it is never "free" here
  and keeps its €0. Comps on set-menu money are refused anyway (`refuseSetMenuMoney`,
  `adjustments-apply.ts:822`).
- **A whole table given free:** the total is €0, so every share is €0 and nothing changes; that
  case is the Given free sheet's, not this one (`docs/backlog/fiscal.md:24-28`).
- **Golden huella and `inmutabilidad`:** neither calls `issueMoment`; the golden cases pass lines
  straight to `recordSale` or through `priceBasket` (`packages/fiscal-verifactu/src/write-path.e2e.test.ts:756`),
  with no comp. Run on this branch:
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`
  → **Tests 20 passed (20)** (18 + 2). No golden case holds a free item on a mixed-rate ticket
  (`grep -n "comp\|discount\|listGross" write-path.e2e.test.ts` finds none).

**The probe.** I built `shareFreeItems`, the `issuancePass` and `issueMoment` edits and the D3a
edit to `transaction-receipt.ts` in a throwaway worktree (`git worktree add --detach`, removed afterwards) and ran a
throwaway suite on the `free-items.test.ts` setup (`provisionAdjustmentVenue`, `billWith(…,
{dining:"takeaway"})`, `takeawayRates({Salad:"4.00", Water:"21.00"})`, a comp, `paySavedBillInCash`):
`env -u CLAUDECODE -u AI_AGENT pnpm exec vitest run src/zz-probe-a445.test.ts` → Tests 3 passed.
Before running, the failing case would have printed the finding's figures (21% row 0.00 / 0.00).
It printed:

| Case | Filed 4% | Filed 21% | Filed lines (gross / base / list) |
| --- | --- | --- | --- |
| Water comped | 8.01 / 0.32 | 1.38 / 0.29 | Salad 8.33 / 8.01 / 10.00; Water 1.67 / 1.38 / 2.00 |
| Water comped, then €1.00 off the bill | 7.21 / 0.29 | 1.24 / 0.26 | Salad 7.50 / 7.21 / 10.00; Water 1.50 / 1.24 / 2.00 |
| Water comped, eaten here | 10%: 9.09 / 0.91 | — | Salad 10.00 / 9.09 / none; Water 0 / 0 / 2.00 |

### 4.3 D3: what each surface shows once a free item holds its share

| Surface | Reads | Changes? | Receipt |
| --- | --- | --- | --- |
| Receipt printed at payment | lines from the unshared `gross` and the order's list prices; VAT rows from the filed breakdown | Lines: no (water still "On the house −€2.00"). VAT rows: yes, the filed split | probe: receipt lines salad 10.00, water 0.00 list 2.00 with comp 2.00; VAT 8.01/0.32, 1.38/0.29; `bill-payments.ts:1285-1286` |
| Reprint of a settled ticket from the till (`readSettledTicket`) | the order's stored lines | Lines: no; VAT rows: filed | `apps/server/src/till-sale.ts:388-395` (read) |
| Reprint from **Find a bill** (`readTransactionReceipt`) and the A4 document of a simplified ticket (`invoice-document.ts`) | filed line grosses, with **no** list price (`listUnitGross: null`, `transaction-receipt.ts:118`, `invoice-document.ts:116`, since #1778 and #1399) | **D3a, my call: yes** — pass the filed `list_unit_price_gross` instead of `null`, so the reprint shows the dish as sold | probe, before: lines 8.33 and 1.67, no comp; after: salad 8.33 list 10.00, water 1.67 list 2.00 with comp 2.00, which prints as 10.00, 2.00, −2.00 (`receipt-document.ts:437`, `listGross ?? gross`). Today a comped ticket's Find a bill reprint already shows no comp; this fixes that too |
| Full invoice naming a customer (A4 table, `receipt-figures.ts`) | each line's filed base, and its list price | **D3b, my call: keep the existing rules** — each line still comes to its filed base; the salad shows a discount row, the water an "On the house" row of its 21% part | read, not run (`receipt-figures.ts:39-48`, `invoiceDiscounts` `:82-133`); Task 4 renders it and looks |
| VAT return and its modelo 303 download | `sales.vat_breakdown` | yes, the filed split | `packages/reporting/src/vat-movements.ts:171-205` |
| Accountant export | `sales.vat_breakdown`; a plain refund's VAT share | yes, the filed split | `apps/server/src/accountant-export.ts:424`, `:552` |
| Given free sheet | adjustment records and order lines | no | `free-items.ts:130-140` |
| Top sellers and category sales reports | `sale_lines.line_total` / `line_gross` | yes: the salad's money falls by the water's share | `packages/reporting/src/top-sellers.ts:67`, `category-sales.ts:212` |
| Dashboard order detail | a bill's own order lines; filed lines only for other kinds | a bill: no | `apps/server/src/orders-list.ts:756` |
| Correct invoice window (till) | each filed dish's gross and what is left of it | yes: salad €8.33, water €1.67 | `invoice-correction-dialog.ts:586-590` (read) |
| Cancel and refund after payment | each dish's filed gross (`byPosition`, `apps/server/src/cancellation-refund-value.ts:89-115`, then `cancelRefundShare`) | **D3c, my call: yes, follow the filed share** — returning the salad refunds €8.33, the water €1.67 | read, not run. Refunding the menu price instead would exceed the filed line, which A758 §3.8's planned corrective of a cancelled dish could not file (`docs/backlog/fiscal.md:942-947`) |

No guide sentence changes for A445: it changes nothing staff do (CLAUDE.md §3, "A guide sentence
earns its place by changing what staff do").

### 4.4 D4: what is already filed or stored

Nothing already filed changes; records are immutable. The rule applies to tickets issued after the
change lands. No schema change (every column used exists), no migration, no venue reset. A
correction of a ticket filed before the change follows that ticket's filed figures: its free line
at €0 gets no share, since it has nothing left at its rate (`correction-allocation.ts:63` counts
only lines above zero for the rate check, and the shares are by what is left). Choice 3's starter
mark reaches a venue only through a reset (pre-live rule, CLAUDE.md §3 last data entry), as in
section 4.7.

### 4.5 Goodwill choice 2: no dishes ticked shares the amount; the till drops its one-rate lock

**Server.** Delete the refusal at `correction-allocation.ts:61-66` (keep the `else` branch's
checks), and `"required"` from `refuseScope`'s parameter (`:58`) and from the reason type of
`sale.correction_scope_invalid` (`packages/core/src/errors.ts:14`). With no dishes, every remaining
dish takes a share by what is left of it (`:71`), which is the path ticked dishes already take.
Consumers traced: HTTP status (`apps/server/src/invoice-correction-api.ts:56`, unchanged), the
till's field placement by code (`invoice-correction-dialog.ts:617`), the till message
(`apps/till/src/i18n/codes.ts:528-531`). Nothing branches on the `required` reason
(`git grep -n '"required"' -- packages/core/src apps/till/src/widgets apps/server/src/invoice-correction*`
finds only the test row and the type).

Run on the probe (refusal removed): €1.00 with no dishes on the comped ticket previews 4%: 0.80 /
0.03 and 21%: 0.14 / 0.03; the sheet's example (wine €12.00 at 21%, cheese €8.00 at 4%, €5.00
back) gives −3.00 at 21% (−2.48 / −0.52) and −2.00 at 4% (−1.92 / −0.08), through
`allocateCorrectionAmounts` itself.

**Till.** Delete the clause `(picked !== undefined && picked.rate !== line.rate)`
(`invoice-correction-dialog.ts:595`) and the now-unused `picked` (`:577`). The message for
`sale.correction_scope_invalid`, now reached only when the dish list no longer matches the invoice:

| | Text |
| --- | --- |
| en | The dishes chosen are not on this invoice. Close this window and choose Correct invoice again. |
| es | Los platos elegidos no están en esta factura. Cierra esta ventana y vuelve a elegir Rectificar factura. |

### 4.6 D5: Goodwill choice 1 — a plain refund of invoiced money is refused, on top of #3993

**Default rule.** In `reserveTenderRefund`, the existing gate (`tender-refund-reservation.ts:241-242`,
no correction named, payment amount above 0) becomes one function, `refusePlainRefund(tx, saleId,
tenderId, cancellationIds)`, replacing `refuseRefundOfAdvance` (`:137-147`):

1. **The sale is a part payment with its own ticket** (a `bill_advances` row): #3993's rule decides
   alone (`refusePlainRefundOfAdvance`), whatever else holds. So a part payment the table's ticket
   took off, with nothing left on that ticket, is still refunded plainly, as the owner chose on
   21 November 16:36 (sheet question 13, `:281-283`).
2. **Otherwise**, refuse `tender.refund_needs_correction` `{ tenderId }` unless one of these holds:
   - the request names cancelled dishes (`cancellationIds`), which `allocateToCancels` already
     bounds (`:80-104`);
   - the sale names a customer (`sales.counterparty_tax_id` is not null): Correct invoice refuses
     it (`requireSupportedCorrection`, `packages/core/src/correction-eligibility.ts:5-9`), and
     refusing both would leave no way to give money back;
   - the sale's order holds a cancel with the Refund tick whose refund value is more than refunds
     have paid on it (new `hasCancelStillOwed(tx, workingOrderId)` in `refund-links.ts`, sharing
     `readCancelsForRefund`'s linked-sum query, `:68-72`), the guide's "Refund a payment again"
     step for the rest of a cancelled dish (`apps/server/src/guide/en/table-service.md:364-370`).
3. A tip alone (payment amount 0) never reaches the gate, as today.

**Known limit (kept from 19 November):** while a cancel still owes money, a plain refund of any
amount passes, because plain refunds are not linked to the cancel. Closing it needs the cancelled
dish's refund to file its own corrective (`docs/backlog/fiscal.md:942-947`).

**Code name.** `tender.refund_needs_correction` sits with its siblings `tender.refund_of_advance`
and `tender.refund_exceeds_cancelled` (`apps/server/src/errors.ts:980-984`) and names the concept,
not the package (CLAUDE.md §3). Register it there; status 409 beside them in
`apps/server/src/tender-refund-api.ts:141-142`.

**Till message** (`apps/till/src/i18n/codes.ts`, beside `tender.refund_exceeds_cancelled`, `:648`).
It says what happened and what each choice does (CLAUDE.md §3); Correct invoice asks for a PIN
itself when the person may not correct invoices, so nobody is sent to someone else.

| | Text |
| --- | --- |
| en | This payment was counted on the invoice, so giving it back must correct the invoice. Close this window and choose Correct invoice: it gives the money back and files a corrective invoice for it. Refund a payment gives back only a tip, or what is still owed for cancelled dishes. |
| es | Este pago cuenta en la factura, así que para devolverlo hay que rectificarla. Cierra esta ventana y elige Rectificar factura: devuelve el dinero y presenta una factura rectificativa por él. Devolver un pago solo devuelve una propina o lo que falta por devolver de platos cancelados. |

It shows as the window's bottom message; a request refusal never disables the button (CLAUDE.md §3,
Forms).

**D5b, my call: no new line in the Refund a payment window.** The 19 November plan added a
"money only" line; the window's existing line, "This returns money only. The original invoice is
unchanged." (`apps/till/src/i18n/strings.ts:148`, Spanish `:2477`, shown at
`tender-refund-dialog.ts:571-575`), stays true, and the refusal explains the rest. Smaller, and one
fewer sentence to keep in step with #3993's own advance wording.

### 4.7 Choice 3 (for the watcher): Complaint can be a Correct invoice reason

Today Correct invoice accepts only void reasons (`apps/server/src/invoice-corrections.ts:236`; the
till offers only reasons with `cancel`, `voidReasons`, `apps/till/src/widgets/reason-picker.ts:10`,
used by the correction window at `invoice-correction-dialog.ts:361`, `:657` and `:777`). The reason
never reaches AEAT (the correction row stores its name; `recordCorrection` gets none), so none of
the options below changes what is filed.

| Option | What changes | Production lines |
| --- | --- | --- |
| (0) Nothing | Staff pick a void reason such as **Other** with a note | 0 |
| (b) Any reason may be given | one server line, the correction window offers every reason | about 10 |
| (a) A stored mark `correct_invoice` on the starter Complaint (the 19 November design) | shared types, policy, routes, starter, demo reasons, server check, till picker, and three dashboard lines so a save keeps the mark | about 60 |

**D9, my call: (a), the 19 November design, as Tasks 8–10, last**, because it is what "as planned"
names; the watcher may choose (0) or (b) instead, and Tasks 8–10 then shrink or go. Design (a),
re-read on this branch:

- `packages/shared/src/adjustment-policy-types.ts`: `REASON_ACTIONS = [...ADJUSTMENT_ACTIONS,
  "correct_invoice"] as const`, `type ReasonAction`. `ADJUSTMENT_ACTIONS` (`:6`) does not change:
  it is the adjustment records' column enum (`packages/db/src/schema/adjustments/adjustments.ts:22`)
  and the comp request's action (`apps/server/src/adjustments-api.ts:60`).
- `packages/adjustments/src/policy.ts`: `reasonShapeFault` (`:34`) lets a comp reason list
  `correct_invoice` beside at least one comp action; a void reason stays `["cancel"]`. New
  `offersInvoiceCorrection(reason)`: void, or `actions` includes `correct_invoice`. The snapshot
  copy (`:201`) carries it.
- `operations.ts:23` and `routes.ts:100` accept `REASON_ACTIONS`; `configuration-transfer.ts:56`
  already validates through `reasonShapeFault`.
- `packages/adjustments/src/provisioning.ts:56`: Complaint takes
  `["comp", "discount_percent", "discount_amount", "correct_invoice"]`;
  `packages/country-es/src/demo/reasons.ts` (Complaint at `:81`) likewise.
- `invoice-corrections.ts:236`: `if (!offersInvoiceCorrection(reason))`, same code as today.
- Till: `apps/till/src/api/client.ts:908`, `:919` gain `ReasonAction`; `reason-picker.ts` gains
  `correctionReasons` and an `offered` option on `reasonPicker` (`:28-29`); the correction window
  uses it at its three sites. The refund windows keep `voidReasons`.
- Dashboard (`packages/adjustments/src/dashboard/reasons-screen.ts`): the comparison (`:397`) and
  the saved body (`:722`) keep any stored action the screen does not offer, after the offered ones;
  the "pick at least one" check (`:690`) counts offered actions only; switching to void still writes
  `["cancel"]` (`:714`). `dashboard/client.ts:8`, `:17` gain `ReasonAction`.
- The correction window's opening line (`invoice_correction.explain`, en `strings.ts:173`, es
  `:2504`) becomes "Correct an overcharge or give money back for a complaint, with a corrective
  invoice." / "Corrige un cobro de más o devuelve dinero por una queja, con una factura
  rectificativa."

Known limits of (a): a venue cannot mark a reason of its own; existing venues get the mark only
through a reset.

### 4.8 D7, D8: the adviser's list, guides and backlog

**Adviser's list** (`docs/compliance/2026-11-19-adviser-meeting.md`). A new question 14 in both
parts, after question 13 (Part 1 after `:283`, Part 2 after `:430`), one bullet per item, and a
paragraph in "Added after the meeting" (`:468`) saying it was added on 23 November from the owner's
words of 21 November and must be copied into the shared Google Doc. The worked figures are the
probe's and the allocator's (section 4.2, 4.5).

Arithmetic, A445: €10.00 × 10/12 = 8.333 → 8.33; €10.00 × 2/12 = 1.666 → 1.66, plus the one cent
left over, which goes to the larger remainder (the water's) → 1.67. 8.33 ÷ 1.04 = 8.0096 → base
8.01, VAT 0.32; 1.67 ÷ 1.21 = 1.3802 → base 1.38, VAT 0.29; VAT 0.61 in all. Today 10.00 ÷ 1.04 =
9.615 → 9.62 and 0.38. Goodwill: €5.00 × 12/20 = 3.00 and × 8/20 = 2.00; 3.00 ÷ 1.21 = 2.479 →
2.48 and 0.52; 2.00 ÷ 1.04 = 1.923 → 1.92 and 0.08.

Part 1:

> **14. Built since your answers: have we done this right?** (added 23 November)
>
> - **A free item on a ticket with two VAT rates** (your answer 1.10). When such a ticket holds an
>   item given free, Waitron shares the price paid across all the items, the free one included, in
>   proportion to their menu prices. For example, a salad at €10.00 (4%) and a water at €2.00 (21%)
>   given free, the customer paying €10.00: Waitron files €8.33 at 4% (base €8.01, VAT €0.32) and
>   €1.67 at 21% (base €1.38, VAT €0.29), €0.61 of VAT in all, where before it filed €10.00 at 4%
>   (base €9.62, VAT €0.38) and nothing at 21%. A discount that leaves an item partly paid stays on
>   that item's own rate. *Have we done this right, and should a partial discount be shared too?*
> - **Money given back as goodwill** (question 6). Waitron now gives such money back only through a
>   corrective invoice. On a ticket with two VAT rates, money not tied to particular items is shared
>   across them in proportion to their prices on the ticket: the €5.00 of question 6's example files
>   −€3.00 at 21% (base −€2.48, VAT −€0.52) and −€2.00 at 4% (base −€1.92, VAT −€0.08). A refund
>   with no corrective is kept only for a tip, money still owed for items cancelled after payment, a
>   part payment as in question 13, and a full invoice naming a customer, which Waitron cannot
>   correct yet. *Have we done this right?*

Part 2:

> **14. Lo que hemos hecho a partir de sus respuestas: ¿lo hemos hecho bien?** (añadida el 23 de
> noviembre)
>
> - **Un producto gratuito en un tique con dos tipos de IVA** (su respuesta 1.10). Cuando un tique
>   así incluye un producto gratuito, Waitron reparte el precio pagado entre todos los productos,
>   también el gratuito, en proporción a sus precios de carta. Por ejemplo, una ensalada de 10,00 €
>   (4 %) y un agua de 2,00 € (21 %) gratis, por las que el cliente paga 10,00 €: Waitron presenta
>   8,33 € al 4 % (base 8,01 €, cuota 0,32 €) y 1,67 € al 21 % (base 1,38 €, cuota 0,29 €), 0,61 €
>   de IVA en total; antes presentaba 10,00 € al 4 % (base 9,62 €, cuota 0,38 €) y nada al 21 %. Un
>   descuento que deja un producto pagado en parte se queda en el tipo de ese producto. *¿Lo hemos
>   hecho bien, y debería repartirse también un descuento parcial?*
> - **Una devolución de cortesía** (pregunta 6). Waitron ya solo devuelve ese dinero mediante una
>   factura rectificativa. En un tique con dos tipos de IVA, el dinero que no corresponde a productos
>   concretos se reparte entre ellos en proporción a su precio en el tique: los 5,00 € del ejemplo de
>   la pregunta 6 presentan −3,00 € al 21 % (base −2,48 €, cuota −0,52 €) y −2,00 € al 4 % (base
>   −1,92 €, cuota −0,08 €). La devolución sin rectificativa queda solo para una propina, el dinero
>   pendiente de productos cancelados después del pago, un pago a cuenta como el de la pregunta 13 y
>   una factura completa a nombre de un cliente, que Waitron aún no puede rectificar. *¿Lo hemos
>   hecho bien?*

The repository copy only; the shared Google Doc is copied by the desk, as the sheet's other
additions say.

**Guides** (`apps/server/src/guide/en/table-service.md`, `apps/server/src/guide/es/table-service.md`;
no `{#id}` changes):

- `{#refund-receipt}` (en `:338`, es `:357`): a new second paragraph. en: "Refund a payment gives
  money back without correcting the invoice, so it refuses money the invoice counted. It is for a
  tip, for dishes cancelled with **Cancel and refund** or **Finish table**, for a part payment as
  below, and for a full invoice naming a customer. For any other money back, such as for a
  complaint, choose **Correct invoice**." es: "Devolver un pago devuelve dinero sin rectificar la
  factura, así que rechaza el dinero que la factura cuenta. Sirve para una propina, para platos
  cancelados con **Cancelar y devolver** o **Cerrar mesa**, para un pago parcial como el de abajo y
  para una factura completa a nombre de un cliente. Para cualquier otra devolución, como una queja,
  elige **Rectificar factura**."
- `{#correct-invoice}` (en `:379-388`, es `:400-409`): first sentence becomes "When a paid bill
  charged too much, or you give money back for a complaint, correct its invoice: …" / "Cuando a una
  cuenta pagada se le cobró de más, o devuelves dinero por una queja, rectifica su factura: …"; the
  second paragraph's "otherwise leave them all unticked" gains ", and it is shared across every
  dish by price" / ", y se reparte entre todos los platos según su precio".

**Backlog.**

- Delete A445 from `docs/backlog.md:261-262` and its section `docs/backlog/fiscal.md:20-30`
  (finished entries are deleted). Its other links are historical (`2026-11-15-adviser-answers.md`)
  or plans (`2026-11-19-adviser-corrections-report.md:767`, the VAT-RATES plan); CLAUDE.md §6 says
  historical docs keep what was true.
- Add to `docs/backlog/fiscal.md` `## Decisions and deliberate limits` (`:1097`): "A free item on
  a ticket at two or more rates shares the price paid by menu price; a partial discount alone stays
  on its dish; the adviser is asked (sheet question 14)", and the goodwill rule with the known limit
  of section 4.6, each dated and marked owner or watcher as section 0 records.
- Replace the goodwill bullet (`docs/backlog/fiscal.md:948-958`) and its sentence in
  `docs/backlog.md:371-372` with: goodwill goes through Correct invoice since this PR; a plain
  refund of invoiced money is refused; the adviser is asked (question 14). The cancelled-dish
  sentence beside it stays.

## 5. Fiscal boundary, and the checks every task runs

What changes in what is filed: the per-rate base and VAT of a takeaway ticket mixing rates with a
free item (A445), and the corrective's split when no dishes are ticked on a two-rate ticket
(choice 2). `CuotaTotal` follows the breakdown, so the hash input changes for those tickets, but
`computeHuella`, `recordSale`, `recordCorrection`, the chain, invoice numbering, series and the
records table and its triggers are untouched (finding section 6; `recordSale` only checks the
breakdown sums to the total, `packages/core/src/record-sale.ts:199-200`).

Every task runs, unedited and passing, and reads the Tests count:

```sh
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts
```

## 6. Test assertions that change

**How this was measured.** In the throwaway worktree of section 4.2 I ran the 84 `apps/server`
suites most likely to be touched — every suite with a comp or discount on a ticket at more than
one rate (`grep -l -E 'action: "comp"|"discount_(amount|percent)"|comp\(' src/*.test.ts | xargs grep -l -E 'takeaway|"21\.00"|"4\.00"|vatRate'`),
every suite that makes a tender refund (24, `git grep -ln "transactions/.*/refunds\|reserveTenderRefund\|beginSettledTenderRefund\|refundSettledTender" -- 'apps/server/src/*.test.ts'`),
and every receipt, reprint, correction and issuance suite — with
`env -u CLAUDECODE -u AI_AGENT pnpm exec vitest run <the 84 files> --reporter=json`, twice:

- **Run 1, everything** (A445, choice 2, the D3a edit to `transaction-receipt.ts` only — not
  `invoice-document.ts` — and a prototype of choice 1's refusal
  with its three exemptions, not yet registered as an error code, so the route answered it 400):
  4157 tests, **3897 passed, 260 failed**, in 18 files.
- **Run 2, choice 1 taken out:** 4157 tests, **4156 passed, 1 failed** (below).

So A445, choice 2 and D3a change one server assertion; choice 1 changes 259, all of them tests
whose setup or subject is a plain refund of a payment amount. The core run is section 4.1's (one
row). The till rows are read, not run (browser suites were not run on the probe). Not run at all:
the other ~1,350 `apps/server` suites, `apps/till`, `apps/dashboard`; CI's scoped run covers the
changed packages, and Task 3 and Task 6 each run their package's affected suites in full.

**A445, choice 2 and D3a**

| File:line | Before | After | Decision | For the watcher |
| --- | --- | --- | --- | --- |
| `apps/server/src/full-comp.fiscal-identity.test.ts:288-327`, "files the full comps' sale with these figures" | takeaway bill, Burger comped, Bottle and Bread discounted to €0, Water €2.00 paid: 21% 1.65 / 0.35, 10% 0.00 / 0.00 (comment: "a zero row at 10%"), `cuota_total` 0.35, huella `60A40E87…`, XML sha256 `b2e296be…` | run 2 received: 21% **1.57 / 0.32**, 10% **0.10 / 0.01**, `cuota_total` **0.33**, huella `4951AAE8E3C6B41946208115DD7F26028DD0D25178FE54A526901E7428B3D57D`; the XML sha256 line is not reached after the first failure, so Task 3 takes its new value from a run. The comment becomes "Bread: its share of the price paid at 10%" | D2, D2b | **Controversial: a pinned filed record and its hash change.** By hand: €2.00 shared 12 : 30 : 2.50 : 2.00 is 0.52, 1.29, 0.11, 0.08 (the two cents left over go to Bread and Burger, the largest remainders); at 21% 0.52 + 1.29 + 0.08 = 1.89, bases 0.43 + 1.07 + 0.07 = 1.57; at 10% 0.11, base 0.10. The test's other case (the receipt's words never reach the record, `:275-286`) is unchanged and still passes |
| `packages/core/src/correction-allocation.test.ts:217` | `[undefined, "required"]`: no dishes on two rates refused | row deleted; new case: no dishes equals all dishes on `mixedRates()` (the figures already pinned at `:52-60`) | choice 2 | **Controversial: decides how a corrective's VAT is divided** |
| `apps/till/src/widgets/invoice-correction-dialog.test.ts:238-253` | after ticking `steak`, `rice` (other rate) is disabled | `rice` stays enabled; ticking both previews with both ids | choice 2 | no money |
| `invoice-correction-dialog.test.ts:358-361` | mocked refusal carries `reason: "required"` | `reason: "missing"`; the message is the new text | choice 2 | no money |

**Choice 1: 259 failing tests in 17 files** (run 1 less run 2). Every one fails because the test
makes a plain refund of a payment amount on a sale with no customer and no cancel still owed. The
list, with failing tests per file:

| Group | Files (failing tests) |
| --- | --- |
| A. Refund mechanics called directly (`bill-payment-fixture`) | `tender-refunds.test.ts` (93), `tender-refund-reservation.test.ts` (36), `tender-refund-authorization.test.ts` (11) |
| B. Refund mechanics through the route (`bill-venue` / `order-venue` / `party-venue`) | `tender-refund-management.test.ts` (37), `tender-refund-api.test.ts` (29), `fiscal-remedy.staff-refund.test.ts` (15), `clock-unconfirmed-gate.test.ts` (12), `conflict-issuance.test.ts` (5), `till-device-proof.test.ts` (5), `clock-behind-stop.refunds.test.ts` (2) |
| C. Tests whose subject includes a plain refund | `advance-corrections.test.ts:850-874`, `:1172` (3), `advance-final.test.ts:511` (1), `invoice-correction-api.test.ts:264` and two others (3), `invoice-corrections.test.ts:280-292`'s helper (2), `invoice-correction-alerts.test.ts` (2), `invoice-correction-cards.test.ts` (2), `handover-controlled.e2e.test.ts:2461` (1) |

Groups A and B keep every assertion about the refund itself; only the sale they refund changes
shape (Tasks 7a–7b). Group C's tests name a plain refund in their own words, so each is a **behaviour
row for the watcher**:

| Test | Before | After |
| --- | --- | --- |
| `advance-final.test.ts:511` "the €90 given back from the rest's invoice, then the €30 advance back in cash by Refund a payment" (#3993's own) | the €90 goes back by a plain refund of the table's ticket | the €90 goes back by Correct invoice on that ticket (as the till's `advance.taken_off_final_invoice` message already tells staff, `codes.ts:664-667`); the €30 of the part payment stays a plain refund and still passes |
| `advance-corrections.test.ts:1172` "a plain refund of €20 of the settled €120 leaves €120 received …" | a plain €20 refund of the table's ticket | the €20 refund is a tip or a cancelled dish's, or the case asserts `tender.refund_needs_correction`; the watcher picks (default: assert the refusal, since that is the new rule, and keep the received figures for the €90 Correct invoice part) |
| `advance-corrections.test.ts:850-874` `goodwill(…)` helper, reason "Goodwill" | a plain refund used as goodwill | Correct invoice, which is now the goodwill route |
| `invoice-corrections.test.ts:280-292` helper, "refuses an ordinary refund on a ticket with an unfinished correction, and allows it once the correction ends" | the ordinary refund is allowed after the correction ends | the refund after the correction ends is one the new rule allows (a cancel still owed); the refusal while open is unchanged |
| `invoice-correction-api.test.ts:264` "still gives money back through Refund a payment while the invoice records need checking" | a plain refund of a payment amount | the same refund of an allowed shape; the "records need checking" point is unchanged |
| `handover-controlled.e2e.test.ts:2461` "M2 refunds in cash one of M1's sales" | a plain cash refund | the same refund of an allowed shape |

Any other assertion that has to change is listed in the PR with file:line, before and after.

## 7. Tasks

Risk triggers: fiscal invariants (what is filed) and money (a refund refused), so the full path:
per-task review, and `/finish-branch` with two Codex run-it reviews side by side. Each task:
failing test first, watch it fail, then the change; then
`pnpm exec prettier --check <changed files>` and the fiscal command of section 5. Till and
dashboard suites run real headless Chromium: check `memory_pressure | grep free` first. Run every
Vitest command with `env -u CLAUDECODE -u AI_AGENT` when you need a passing test's output, and read
the Tests count. Each task is sized for one implementer well under 100 tool calls (estimates
given).

**Order.** VAT-RATES's remaining work (PR 3b and piece B's PR L) does not touch the code this plan
changes except `packages/menu/src/pricing.ts`, where PR L removes the label fallback
(`productRates`, `:263-266`) and this plan adds a new function; `shareFreeItems` reads each line's
rate list exactly as `rateLines` does, so it follows whatever list VAT-RATES supplies. This plan may
go first (say so in `progress.log`). VAT-RATES Task 3b.4 adds a sentence to A445
(`vat-rates-a.md:1226`); if this lands first, that sentence is dropped.

### Task 1: one allocation in `@waitron/shared` — about 25 calls

1. Tests first: `packages/shared/src/share-by-weight.test.ts` — shares by weight with the cent to
   the largest remainder (10.00 by 10:2 → 8.33, 1.67); a tie goes to the earlier weight; a zero
   total gives zeros; a zero weight gets nothing. Run, watch it fail (no module).
2. Move `apportionCorrectionCents` to `share-by-weight.ts` as `shareByWeight`, export it from
   `packages/shared/src/index.ts`, call it at `correction-allocation.ts:75` and `:109`.
3. ```sh
   pnpm --filter @waitron/shared exec vitest run src/share-by-weight.test.ts src/index.test.ts
   pnpm --filter @waitron/core exec vitest run src/correction-allocation.test.ts src/correction-history.test.ts
   ```

### Task 2: `shareFreeItems` — about 30 calls

1. Tests first in `packages/menu/src/pricing.test.ts`: the probe's three cases as pure inputs
   (`GrossLines` with `vatRates` and `listGross`); a ticket at one rate is returned unchanged
   (same object); two rates and no free line, unchanged; a line with an empty list, unchanged; a
   shared line with no list price gets `listGross` = its old gross and `listUnitPriceGross` = its
   old unit price; `total` and line order unchanged; `rateLines(shareFreeItems(g, on), on)` gives
   the probe's breakdowns. Run, watch them fail.
2. Write `shareFreeItems` (section 4.2), with a one-line comment naming answer 1.10.
3. ```sh
   pnpm --filter @waitron/menu exec vitest run src/pricing.test.ts
   ```

### Task 3: issuance files the share — about 50 calls

1. Tests first, through the real writers, in a new `apps/server/src/free-item-share.test.ts` on the
   `free-items.test.ts` setup (copy its `adjust` and `pay` helpers): the probe's three cases,
   asserting `sales.vat_breakdown`, the record's breakdown (`backend.checkIntegrity` reports no
   issue) and the `sale_lines` gross, base and list columns; the receipt `paySavedBillInCash`
   returns lists the salad at 10.00 and the water at 0.00 with "comp 2.00", and its VAT rows are
   the filed ones; a counter sale (`working-order.ts:7867`) and the close-of-day issue
   (`close-of-day.ts:101`) file the same split. Run, watch them fail.
2. Export `listGrossOf`; add `listGross` in `issuancePass`; call `shareFreeItems` in `issueMoment`.
3. Fix every other assertion section 6 lists for A445, changing expected figures only where the
   table says.
4. ```sh
   pnpm --filter @waitron/server exec vitest run src/free-item-share.test.ts src/issuance-pass.test.ts src/free-items.test.ts src/receipt-adjustments.test.ts src/full-comp.fiscal-identity.test.ts src/adjustments-apply.test.ts
   ```
   plus every file section 6 names for A445.

### Task 4: reprints and the full invoice show the dish as sold — about 40 calls

1. Tests first: in `apps/server/src/transaction-receipt.test.ts` and the A4 document's suite
   (`apps/server/src/invoice-document.test.ts`), the comped mixed-rate ticket reprints with the salad
   at list 10.00, the water at list 2.00 and "comp 2.00" beneath it; a comped ticket eaten here
   reprints with its comp (today it prints none). A full invoice naming a customer for the same
   basket: the A4 table's lines come to the filed bases. Run, watch the first two fail.
2. Pass the filed `list_unit_price_gross` at `transaction-receipt.ts:118` and
   `invoice-document.ts:116`.
3. Render the full invoice and the simplified reprint to files and open them in the workspace's
   Playwright Chromium, in both themes and at phone width (CLAUDE.md §4, "A page asserted as a
   STRING"); say in the handover what the A4 discount rows read (D3b).
4. ```sh
   pnpm --filter @waitron/server exec vitest run src/transaction-receipt.test.ts src/invoice-document.test.ts src/receipt-document.test.ts src/receipt-ticket.test.ts
   ```

### Task 5: Correct invoice shares an unticked amount; the till drops its lock — about 40 calls

1. Tests first:
   - `packages/core/src/correction-allocation.test.ts`: delete the `[undefined, "required"]` row
     (`:217`); add "shares an amount with no dishes chosen across every rate, as choosing them all
     does" on `mixedRates()` (`{ gross: "2.00" }` equals `{ gross: "2.00", lineIds: ["wine",
     "dish"] }`).
   - `apps/server/src/invoice-corrections.test.ts`: "files a corrective split across both rates when
     no dishes are chosen": `soldForCash(["Rib steak", "Cold soup"], ["17.60"], "0.00", "takeaway")`
     (as at `:479`), open €8.80 with no `lineIds`, give the cash, file; the corrective's
     `vat_breakdown` is `[{10.00, −2.50, −0.25}, {21.00, −5.00, −1.05}]`, total −8.80, and
     `checkIntegrity` reports nothing. And on Task 3's comped ticket, €1.00 with no dishes previews
     4%: 0.80 / 0.03, 21%: 0.14 / 0.03.
   - `apps/till/src/widgets/invoice-correction-dialog.test.ts:238`: rename to "previews dishes
     picked at both VAT rates"; the dish at the other rate stays enabled and both ids are sent.
     `:360-361`: `reason: "missing"`, and the message is the new text. `codes.test.ts`: the new
     English and Spanish text.
   Run, watch them fail.
2. Delete the refusal and `"required"` (section 4.5); delete the till clause and `picked`; replace
   the message.
3. ```sh
   pnpm --filter @waitron/core exec vitest run src/correction-allocation.test.ts src/correction-history.test.ts
   pnpm --filter @waitron/server exec vitest run src/invoice-corrections.test.ts src/invoice-correction-api.test.ts
   pnpm --filter @waitron/till exec vitest run src/widgets/invoice-correction-dialog.test.ts src/widgets/invoice-correction-dialog.a11y.test.ts src/i18n/codes.test.ts
   pnpm exec vitest run scripts/errors-reachable.test.ts
   ```

### Task 6: the server refuses a plain refund of invoiced money — about 50 calls

1. Tests first, reusing `b95a643c19`'s cases where they fit (`git show b95a643c19 --
   apps/server/src/tender-refund-reservation.test.ts apps/server/src/tender-refund-api.test.ts
   apps/server/src/tender-refund-links.test.ts packages/adjustments/src/refund-links.test.ts
   apps/till/src/i18n/codes.test.ts`), each refusal asserting the code and that no `refunds` row and
   no drawer job were written:
   - a plain €10 refund on a cash sale with no cancels: refused (409 through the route);
   - the same on a sale naming a customer: accepted;
   - a tip-only refund after the payment amount is all back: accepted;
   - with a Refund-ticked cancel still owing money: accepted; after that cancel is fully refunded
     through its filled-in window: refused;
   - with `cancellationIds`, and a correction's card and cash steps: unchanged;
   - **#3993's cases unchanged:** an advance not taken off still answers `tender.refund_of_advance`;
     taken off with money left on the table's ticket, `advance.taken_off_final_invoice`; taken off
     with nothing left, **accepted** (never `tender.refund_needs_correction`). Re-run
     `apps/server/src/advance-taken-off.test.ts` and the advance cases in
     `tender-refund-reservation.test.ts` unedited.
   Run, watch them fail.
2. `hasCancelStillOwed` in `refund-links.ts` (on `refunds` / `refund_id`); `refusePlainRefund` in
   the reservation; the code in `errors.ts`; 409 in `tender-refund-api.ts`; the message in
   `codes.ts`.
3. Fix section 6's group C (7 files, 14 tests) in this task. Then commit at a point where only
   groups A and B (10 files) are red, and hand over: Tasks 7a and 7b take them.
4. ```sh
   pnpm --filter @waitron/server exec vitest run src/tender-refund-reservation.test.ts src/tender-refund-api.test.ts src/tender-refund-links.test.ts src/advance-taken-off.test.ts
   pnpm --filter @waitron/adjustments exec vitest run src/refund-links.test.ts
   pnpm --filter @waitron/till exec vitest run src/i18n/codes.test.ts
   pnpm exec vitest run scripts/errors-reachable.test.ts scripts/write-path-tables.test.ts
   ```

### Task 7a and 7b: setups that made a plain refund — about 70 calls each

Section 6's group A (7a: 3 files, 140 tests) and group B (7b: 7 files, 105 tests). Measured: these
fail only because their sale's payment is refunded plainly (run 2 passes them). Shape, decided
before starting: one helper in `apps/server/src/testing/` (for example `owedCancel(venue, billId)`)
that cancels one dish of the settled bill **keeping its charge with the Refund tick**, through the
real `cancelItem` as `free-items.test.ts:100-120` does with `"keep_charge"`, so the sale then holds
a cancel still owed and a plain refund is allowed. Each suite calls it in setup after the sale
settles. Change setup only; every assertion about the refund itself stays, and the handover lists
each suite with the shape used. Before trusting the helper, prove it: a suite run without the call
must fail with `tender.refund_needs_correction`, with it pass. If a suite's sale has no bill to
cancel on, or a suite counts working-order lines or adjustments that the cancel changes, stop and
report that suite rather than inserting rows by hand or editing its assertions.

Commands: each group's files, then Task 6's command.

### Task 8: Complaint is marked for Correct invoice (choice 3, rules and server) — about 55 calls

Only once the watcher confirms choice 3 (section 0). The 19 November plan's Task 3, on the line
numbers of section 4.7: `policy.test.ts`, `provisioning.test.ts:108-119` (Complaint gains
`correct_invoice`), `configuration-transfer.test.ts`, `routes.test.ts`, the comp-reason refusal in
`invoice-corrections.test.ts` and `invoice-correction-api.test.ts` moving to **On the house**,
`adjustment-policy-types.test.ts`, `apps/server/scripts/demo-seed/seed-adjustments.test.ts` and
`seed.madrid-baseline.test.ts:2206-2209` (the expected rows gain `correct_invoice` inside the test;
the fixture JSON and its sha256 manifest are never edited). Trace every reader of a reason's
`actions` (`git grep -n "\.actions" -- packages/adjustments apps/server/src apps/till/src ':!*.test.ts'`)
and list them in the handover.

```sh
pnpm --filter @waitron/shared exec vitest run src/adjustment-policy-types.test.ts
pnpm --filter @waitron/adjustments exec vitest run src/policy.test.ts src/provisioning.test.ts src/configuration-transfer.test.ts src/routes.test.ts src/operations.test.ts src/record.test.ts
pnpm --filter @waitron/server exec vitest run src/invoice-corrections.test.ts src/invoice-correction-api.test.ts src/adjustments-api.test.ts scripts/demo-seed/seed-adjustments.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts
pnpm exec vitest run scripts/starting-migrations.test.ts scripts/schema-constraints.test.ts scripts/english-only.test.ts
```

### Task 9: the dashboard keeps the mark (choice 3) — about 25 calls

The 19 November plan's Task 4 at `reasons-screen.ts:397`, `:690`, `:722`:

```sh
pnpm --filter @waitron/adjustments exec vitest run src/dashboard/reasons-screen.test.ts src/dashboard/reasons-screen.save-state.test.ts src/dashboard/reasons-screen.unsaved.test.ts
```

### Task 10: the till offers Complaint in Correct invoice (choice 3) — about 30 calls

The 19 November plan's Task 5, with `invoice_correction.explain` at en `strings.ts:173`, es `:2504`:

```sh
pnpm --filter @waitron/till exec vitest run src/widgets/invoice-correction-dialog.test.ts src/widgets/tender-refund-dialog.test.ts src/widgets/bill-refund-dialog.test.ts src/i18n/strings.test.ts
```

### Task 11: guides, adviser's list, backlog — about 20 calls

Section 4.8. Then:

```sh
pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts
pnpm exec vitest run scripts/guide-links.test.ts scripts/claude-md-pointers.test.ts
```

`docs/` is ignored by prettier: check with `pnpm exec prettier --file-info <file>` (prints
`"ignored": true`); the guide files under `apps/server` take `prettier --check`. The PR's first
section is section 0 of this plan.

## 8. Size, and whether to split

| Part | Production (+/−) | Tests |
| --- | --- | --- |
| Task 1 shared allocation | +35 / −20 | +40 |
| Task 2 `shareFreeItems` | +45 | +120 |
| Task 3 issuance wiring | +10 | +200, plus section 6's changed figures |
| Task 4 reprints | +4 / −2 | +120 |
| Task 5 choice 2 | +2 / −10 (core, till) | +80 / −5 |
| Task 6 choice 1 | +55 | +200, group C rewritten (14 tests) |
| Task 7a–7b fixtures | — | a helper of about +40, and one setup call in each of 10 files (245 tests, setup only) |
| Tasks 8–10 choice 3 | +60 / −5 | +200 |
| Task 11 docs | — | guides +12, sheet +12, backlog −15 / +8 |

About 210 production lines added and 40 removed: under the 300-line line for one pull request, so
**one PR**, as the watcher asked. If the build passes about 300 production lines, split after
Task 7b: PR 1 is Tasks 1–7b and 11 (both items and the adviser's list), PR 2 is choice 3 (Tasks
8–10); each leaves `main` working. Choice 1's fixture work (Tasks 7a–7b) is the largest part of the
review by line count, but setup only.

## 9. Open pull requests touching the same files

`gh pr list --state open` on 2026-11-23 lists two; `gh pr diff <n> --name-only` for each:

| PR | Overlap | How they interact |
| --- | --- | --- |
| #4118 (`feat/series-split-correctives-2`) | `apps/till/src/i18n/codes.ts` (a hunk at `:402`), `docs/backlog.md`, `docs/backlog/fiscal.md` (hunks near `:287` and `:1296`), `seed.madrid-baseline.test.ts` (near `:847`), `packages/core/src/record-correction.ts`; it also rebuilds core's starting migration, so every venue resets when it lands | Different keys and paragraphs from this plan's; text-only rebase. This plan does not touch `record-correction.ts` |
| #4140 (`fix/h-translation-abandon-box`) | `docs/backlog.md`, other sections | None |

## 10. Decisions, with defaults

| # | Decision | Default | Whose |
| --- | --- | --- | --- |
| D1 | Where the one allocation lives | `shareByWeight` in `@waitron/shared`, used by `allocateCorrectionAmounts` and `shareFreeItems` | watcher asked for one; place is mine |
| D1b | A correction's weights | what is left of each dish's filed price | **my call** |
| D2 | A445's scope | free items only, on tickets at two or more rates; partial discounts asked of the adviser | owner ("split by menu price"), adviser 1.10 |
| D2b | Other lines' weight when a free item is present | menu price, discounts included | **my call** |
| D3 | Receipt lines | as sold; VAT rows as filed | follows from the code's split, `bill-payments.ts:1286` |
| D3a | Find a bill and A4 reprints | print the filed menu price | **my call** |
| D3b | Full invoice table | existing rules, looked at | **my call** |
| D3c | Cancel and refund after payment | follows the filed share | **my call** |
| D4 | Stored data | nothing changes; no reset | pre-live rule |
| D5 | Choice 1 | section 4.6, `tender.refund_needs_correction`, #3993's rule first | watcher (19 and 22 November) |
| D5b | Refund window line | none added | **my call** |
| D6 | Tests | section 6 | — |
| D7 | Adviser's list | question 14, both parts | watcher's relay |
| D8 | Guides and backlog | section 4.8 | — |
| D9 | Choice 3 | 19 November design, last, for the watcher to confirm or replace with (0) or (b) | **watcher to confirm** |

## 11. Not established

- What the full invoice's A4 table prints for a shared free item (D3b): read, not rendered.
- The `invoice-document.ts` half of D3a, and every till and dashboard suite: not run on the probe.
- The ~1,350 `apps/server` suites outside the 84 run: a comp on a ticket at two rates elsewhere
  would change figures there too; Task 3 runs the package's suites that the grep in section 6 names,
  and CI's scoped run covers the rest.
- Whether the refund helper of Tasks 7a–7b disturbs a suite that counts lines or adjustments: to be
  found per suite, with the stop rule there.
- Choice 3 has no owner word of its own (section 0).
