# A445 and ADVISER-GOODWILL-CORRECTIVE: a free item takes its share of the price paid, and money given back as goodwill takes a corrective invoice

Status: plan, rewritten 2026-11-23 on `feat/adviser-goodwill-corrective` at `a460d355c4` (plus the
two commits of the 19 November plan this replaces). No product code yet. Every `file:line` below was
read on this branch; every figure marked "run" was produced by a command named beside it.
Revised the same day after one fresh-context read
(`~/waitron-campaign-l/receipts/adviser-goodwill/plan-read-2026-11-23.md`) and the driver's direction
on it: choice 1's rule restated (section 4.6), choice 3 out, owner decisions O1–O6 named (section 10),
test cost re-measured (section 6).

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
- The **record hash** (*huella*) is the fingerprint each filed record carries of itself and the one
  before it; a test that pins one fails if any filed figure moves.
- A **prototype** below is throwaway code built in a separate checkout only to measure, then deleted.
- **O-numbers** are decisions for the owner, **D-numbers** the watcher's; section 10 lists both.

## 0. Who decided what, and what still needs a decision

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
the worked example." The "yes and yes" answered the sheet point that says "split the €5.00 across
the bill in proportion to the menu prices" (`docs/compliance/2026-11-19-adviser-meeting.md:164`,
answer recorded at `:174`).

**Earlier steps.** The three goodwill choices of the 19 November plan were the watcher's
(2026-11-19 08:00). The watcher cleared choice 1 at 09:05 and sent choices 2 and 3 to the owner,
writing "my 08:00 defaults 2 and 3 should not have been settled without the owner"
(`questions.md:161-165`); the owner parked both items at 10:03 (`:167-168`) and unparked them on
21 November as above. On 22 November 05:39 the watcher asked for choice 1 to wait for VAT-RATES PR 3
(#4133, now on `main` at `306194dccd`) and to be rebuilt on top of #3993 (section 4.6).

**This plan replaces part of an owner-approved design, on the owner's later word.** The owner
approved the A802 design on 2026-10-21 "with all three policies"; policy 2 reads "both permissions
and explicit links, goodwill refunds stay money-only"
(`~/waitron-campaign-e/archive/questions-to-2026-10-23.md:6487-6489`), and the design says "An
ordinary goodwill refund remains a money action and does not acquire a fiscal correction merely
because its reason resembles one" and "a served-dish goodwill return can still use ordinary Refund
a payment" (`docs/superpowers/specs/2026-10-20-a802-partial-paid-invoice-correction-design.md:31-32`
and `:301-302`). Choice 1 replaces that. It follows from the owner's decision of 18 November, "Money
given back as goodwill takes a corrective" (sheet `:68`), confirmed on 21 November ("take this as
confirmed"; "yes and yes", `:174`). Task 8 adds a dated pointer to the A802 spec (a historical
document, CLAUDE.md §6).

**Choice 3 is out of this PR.** Letting **Complaint** be chosen as a Correct invoice reason would
override the same A802 approval ("Reason: use A758's Void-reason dropdown", spec `:90`), and no
owner word names it. It is question O6 in section 10, for the owner, with the zero-code way staff can
already do it: pick an existing void reason such as **Other** and type "complaint" in its note.

**Decisions.** Section 10 lists every decision, split into those that need the owner (they decide
what is filed with AEAT or what money staff hand over) and those that are the watcher's call. The
D- and O-numbers below point into it.

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
run). The simplest thing that meets it: Refund a payment refuses exactly the money Correct invoice
would take now (section 4.6), and Correct invoice takes an amount with no dishes ticked on any
ticket. Choice 3 (Complaint as a reason) is not needed for this and is out of the PR (section 0).

**True size** (estimates from the files each task names, not from a build; section 8 has the
breakdown): about 200 production lines added and 40 removed (shared 40, menu 45, server 115, core
and till 15 changed), about 1,100 test lines added or changed (164 of them setup changes in 7 refund
suites), about 60 lines of guides, sheet and backlog. No generated file, no migration, no schema change.

**Who approved:** section 0. Owner: the two needs and "split by menu price". Watcher: choice 1 of
19 November and the 22 November rebase on #3993. The owner decisions O1–O6 and the watcher's calls
are in section 10. One fresh-context read of this plan
(`~/waitron-campaign-l/receipts/adviser-goodwill/plan-read-2026-11-23.md`, 1 Critical, 8 Important,
10 Minor) is folded in; nobody has approved it.

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
  payment** instead for money Correct invoice could give back, the refusal says why and names
  **Correct invoice**. Where Correct invoice cannot correct the ticket (a full invoice naming a
  customer, records that need checking, and the other cases of section 4.6), Refund a payment still
  gives the money back, as today.
- **Changed a little:** a refund naming cancelled dishes is capped at what those dishes still owe;
  a tip can come back on its own while payment money is left (O2's default); Cancel and refund after
  payment on a shared ticket hands back the dish's share of what was paid (O4's default).
- **Unchanged:** tickets eaten here, a discount on one dish with no free item, and a part payment's
  refund as #3993 allows it.

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
and new cases in four test files. **Reused:** the reader's "still owed" query (as the D5c linking
read), the code name, the status, and the test cases that still fit section 4.6's rule. **Not
reused:** its three exemptions, which section 4.6's single rule replaces, and its message. Its SQL
names `tender_refunds` and `tender_refund_id`; on this branch the table is `refunds` and the column
`refund_id` (`refund-links.ts:69-71`). It ran before #3993's gate, not inside it.

## 4. Design

### 4.1 D1: the one allocation, and where it lives

**Default: one function, `shareByWeight(total, weights)`, in `packages/shared/src/share-by-weight.ts`,
exported from `@waitron/shared`.** It is core's `apportionCorrectionCents`
(`correction-allocation.ts:239-257`) moved unchanged: each share rounded down to the cent, the cents
left over one at a time to the largest remainders, a tie to the earlier line. One addition: it
refuses a list whose weights add up to zero while the total is above zero (today it would divide by
zero), and returns zeros for a zero total; Task 1 tests both. Callers:

- `allocateCorrectionAmounts` (`correction-allocation.ts:75` and `:109`), which keeps its
  behaviour — its 94 existing cases are the proof (`pnpm --filter @waitron/core exec vitest run
  src/correction-allocation.test.ts src/correction-history.test.ts`: Tests 94 passed on this branch;
  on the prototype, 93 passed and 1 failed, the row this plan deletes);
- the new `shareFreeItems` (section 4.2).

Why `@waitron/shared`: `@waitron/menu` depends on `@waitron/core` but `@waitron/core` does not
depend on `@waitron/menu` (each `package.json`), and the dashboard imports `@waitron/menu`
(`apps/dashboard/src/api/client.ts`), so the pure decimal helper belongs with the other money
helpers (`packages/shared/src/money.ts`, `cancel-refund-share.ts`). Not merged:
`discountShares` and `spreadBillDiscount` in `packages/adjustments/src/spread.ts:270` and `:308`,
which rewrite stored unit prices to whole cents per unit, a different job.

**What is built: one rounding function, two kinds of weight.**

- **At issuance (A445)** each line weighs its menu price: its stored list total where it has one,
  otherwise its gross. This is the owner's "split by menu price".
- **In a correction (goodwill)** each line weighs what is left of its filed price, as today. On a
  ticket with no discount and no earlier correction that is its menu price; on a ticket A445 shared
  it is in proportion to menu price already (prototype: €1.00 back on the comped ticket shares
  0.83 / 0.17, as 8.33 / 1.67 does).

**O1, for the owner: the goodwill split when a dish was discounted.** The owner's answer was "split
by menu price" (sheet `:164`, `:174`). Weighing by menu price can take more from a dish than is left
of it, and a line below zero makes every later correction of that invoice refuse
(`remainingLines`, `correction-allocation.ts:219-220`, read). The two rules differ only on a ticket
where a dish was discounted or partly corrected before. Worked through the real `allocateCorrectionAmounts` (the "what
is left" column) and by hand (the menu-price column), on a takeaway ticket with a salad (menu €10.00,
4%) and a water (€2.00, 21%), €3.00 given back with no dishes ticked:

| Salad charged | By menu price (10 : 2) | By what is left (built) |
| --- | --- | --- |
| €5.00 (discounted) | salad −2.50 (base −2.40, VAT −0.10); water −0.50 (−0.41, −0.09) | salad −2.14 (−2.06, −0.08); water −0.86 (−0.71, −0.15) |
| €1.00 (discounted) | salad −2.50 — more than the €1.00 left: **cannot be filed** | salad −1.00 (−0.96, −0.04); water −2.00 (−1.65, −0.35) |

**Default: by what is left**, because it is the only one of the two that can always be filed. A
third rule — menu price, each dish capped at what is left of it, the rest shared by what is left —
matches the owner's words more often but adds code to the one function that divides a corrective's
VAT; it is not planned unless the owner asks for it.

### 4.2 D2: A445 — which tickets, and what is shared

**Default: free items only, and only when the meal's lines carry two or more VAT rates on the issue
day.** That is what answer 1.10 covers ("A free item given with a paid sale … When the items carry
different VAT rates"). A partial discount on one dish, with no free item on the ticket, stays on
that dish's own rate, as today; the adviser's line (section 4.7) says so and asks.

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
- `issueMoment` (`issue-moment.ts:46`) rates `shareFreeItems(gross, earlier ?? issueDay)` instead of
  `gross`, on the same date `rateLines` uses (`:45-46`). It
  still returns the unshared `gross` (`:52`), which the settle receipt prints from
  (`bill-payments.ts:1286`), so the receipt keeps the dishes as sold.
- Nothing else: `filedLines` keeps a line's own list fields when its identity has no list price
  (`receipt-lines.ts:97-98`, `{ ...line }`).

**O3, for the owner: other dishes on a ticket that has a free item.** Default: when a free item is
on the ticket, every line weighs at its menu price, so a partial discount on another dish, or a
whole-bill discount, is shared by menu price too. That is the owner's "split by menu price" taken
literally, and the stored lines cannot tell a whole-bill share from a one-dish discount without
reading the adjustment records. Run on the prototype: water comped then €1.00 off the bill files
4%: 7.21 / 0.29 and 21%: 1.24 / 0.26. The alternative — paid dishes weigh at what they were charged,
the free one at its menu price — gives, by hand, salad 7.36 (base 7.08, VAT 0.28) and water 1.64
(1.36, 0.28). It decides filed VAT, so it is the owner's; question 14 asks the adviser too.

**Not affected, and why:**

- **Eaten here:** one rate, so step 2 returns unchanged (prototype: 10%: 9.09 / 0.91, as the finding).
- **A part payment's ticket** (`bill-advances.ts:133`) and the live basket call `rateLines`
  directly, never `shareFreeItems`.
- **A bill whose advance was paid at an earlier rate** (the VAT-RATES plan's open point,
  `docs/superpowers/plans/2026-11-22-vat-rates-a.md:1222-1223`): the rates counted are the meal's
  lines only; the advance is taken off after (`issue-moment.ts:46-47`).
- **A set menu's covered dish** has no stored list price: the adjustments writer is the one place
  that first sets one (`adjustments-apply.ts:1291`); the other writers copy a line's existing list
  price onto a cancel or credit (`line-cancel.ts:447`, `cancel-credit.ts:110`, `working-order.ts:5186`;
  `git grep -n "listUnitPriceGross:"`). So it is never "free" here and keeps its €0. Comps on set-menu money are refused anyway (`refuseSetMenuMoney`,
  `adjustments-apply.ts:822`).
- **A whole table given free:** the total is €0, so every share is €0 and nothing changes; that
  case is the Given free sheet's, not this one (`docs/backlog/fiscal.md:24-28`).
- **Golden huella and `inmutabilidad`:** neither calls `issueMoment`; the golden cases pass lines
  straight to `recordSale` or through `priceBasket` (`packages/fiscal-verifactu/src/write-path.e2e.test.ts:756`),
  with no comp adjustment (read; a `grep` for "comp" there matches only `computeHuella`). Run on this
  branch:
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`
  → **Test Files 2 passed, Tests 20 passed (20)** (18 + 2). No golden case holds a free item on a
  mixed-rate ticket.
- **The demo seed** calls `rateLines` directly (`apps/server/scripts/demo-seed/seed-sales.ts:288`),
  but its lines carry no list price and no comp (`lineGross: price`, `:285`), so `shareFreeItems`
  would change nothing there; it is left as it is.

**The prototype.** I built `shareFreeItems`, the `issuancePass` and `issueMoment` edits and the D3a
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
| Receipt printed at payment | lines from the unshared `gross` and the order's list prices; VAT rows from the filed breakdown | Lines: no (water still "On the house −€2.00"). VAT rows: yes, the filed split | prototype: receipt lines salad 10.00, water 0.00 list 2.00 with comp 2.00; VAT 8.01/0.32, 1.38/0.29; `bill-payments.ts:1285-1286` |
| Reprint of a settled ticket from the till (`readSettledTicket`) | the order's stored lines | Lines: no; VAT rows: filed | `apps/server/src/till-sale.ts:388-395` (read) |
| Reprint from **Find a bill** (`readTransactionReceipt`) and the A4 document of a simplified ticket (`invoice-document.ts`) | filed line grosses, with **no** list price (`listUnitGross: null`, `transaction-receipt.ts:118`, `invoice-document.ts:116`, since #1778 and #1399) | **D3a, the watcher's call: yes** — pass the filed `list_unit_price_gross` instead of `null`, so the reprint shows the dish as sold | prototype, before: lines 8.33 and 1.67, no comp; after: salad 8.33 list 10.00, water 1.67 list 2.00 with comp 2.00, which prints as 10.00, 2.00, −2.00 (`receipt-document.ts:437`, `listGross ?? gross`). Today a comped ticket's Find a bill reprint already shows no comp; this fixes that too |
| Full invoice naming a customer (A4 table, `receipt-figures.ts`) | each line's filed base, and its list price | **D3b, the watcher's call: keep the existing rules**, decided now: each line still comes to its filed base, and by reading the A4 prints a bare "Discount −1.61" (4%) under the salad and "On the house −0.27" (21%) under the water. Task 4 pins those rows and looks at the rendered page | read, not run (`receipt-figures.ts:39-48`, `invoiceDiscounts` `:82-133`) |
| VAT return and its modelo 303 download | `sales.vat_breakdown` | yes, the filed split | `packages/reporting/src/vat-movements.ts:171-205` |
| Accountant export | `sales.vat_breakdown`; a plain refund's VAT share | yes, the filed split | `apps/server/src/accountant-export.ts:424`, `:552` |
| Given free sheet | adjustment records and order lines | no | `free-items.ts:130-140` |
| Top sellers and category sales reports | `sale_lines.line_total` / `line_gross` | yes: the salad's money falls by the water's share | `packages/reporting/src/top-sellers.ts:67`, `category-sales.ts:212` |
| Dashboard order detail | a bill's own order lines; filed lines only for other kinds | a bill: no | `apps/server/src/orders-list.ts:756` |
| Correct invoice window (till) | each filed dish's gross and what is left of it | yes: salad €8.33, water €1.67 | `invoice-correction-dialog.ts:586-590` (read) |
| Cancel and refund after payment | each dish's filed gross (`byPosition`, `apps/server/src/cancellation-refund-value.ts:89-117`, then `cancelRefundShare`) | **O4, for the owner (default: yes, follow the filed share)** — returning the salad refunds €8.33 instead of €10.00, and returning the free water hands €1.67 in cash for a dish given free. Task 3 pins whichever the owner picks through the real `cancelItem` and `rowRefundValue` | read, not run. The alternative, the dish's price as sold, would refund more than the filed line holds, which A758 §3.8's planned corrective of a cancelled dish could not file (`docs/backlog/fiscal.md:942-947`) and choice 1's cap on named cancels would then let through |

No guide sentence changes for A445: it changes nothing staff do (CLAUDE.md §3, "A guide sentence
earns its place by changing what staff do").

### 4.4 D4: what is already filed or stored

Nothing already filed changes; records are immutable. The rule applies to tickets issued after the
change lands. No schema change (every column used exists), no migration, no venue reset. A
correction of a ticket filed before the change follows that ticket's filed figures: its free line
at €0 gets no share, since it has nothing left at its rate (`correction-allocation.ts:63` counts
only lines above zero for the rate check, and the shares are by what is left).

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

Run on the prototype (refusal removed): €1.00 with no dishes on the comped ticket previews 4%: 0.80 /
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

### 4.6 D5: Goodwill choice 1 — Refund a payment refuses only what Correct invoice would take now

**The rule, stated once (default):** Refund a payment, when it names no correction and returns some
payment money, may give back without a corrective only

- what the cancelled dishes it pays for still owe, plus
- the payment money Correct invoice could **not** give back on this sale right now.

Above that it is refused `tender.refund_needs_correction`. So wherever Correct invoice refuses, for a
reason staff cannot fix there, Refund a payment stays open; wherever Correct invoice would take the
money, Refund a payment sends staff to it. It replaces the 19 November plan's list of exemptions
(which missed every case below except a customer-named invoice: the fresh read's Critical 1).

How it is worked out, in `reserveTenderRefund`, at the existing gate (`tender-refund-reservation.ts:241-242`:
no correction named, payment amount above 0), in one function `refusePlainRefund` that replaces
`refuseRefundOfAdvance` (`:137-147`):

1. **A part payment with its own ticket** (a `bill_advances` row): #3993's rule decides alone
   (`refusePlainRefundOfAdvance`, `advance-taken-off.ts:173-183`), unchanged. A part payment the
   table's ticket took off, with nothing left on that ticket, is still refunded plainly, as the owner
   chose on 21 November 16:36 (sheet question 13, `:281-283`).
2. **What the dishes still owe.** If the request names cancels (`cancellationIds`), what those
   still owe, read as `allocateToCancels` reads it (`:80-104`; `cancelsForSale` already refuses a
   cancel of another order, `:60-78`). **D5c, the watcher's call:** if it names none, every cancel of
   the sale's order with the Refund tick and money still owed counts as named, in the order
   `readCancelsForRefund` gives (`refund-links.ts:75`), and the refund is linked to them as the
   first window's is. That keeps the guide's second window for the rest of a cancelled dish
   (`apps/server/src/guide/en/table-service.md:364-371`) working, now bounded; the PIN rule for a
   window that names no dishes stays as today (coverage is computed only when the request named
   them). The alternative is a till change so the second window carries the cancels' ids.
3. **What Correct invoice could take now:** the sum of what is left of each line of the invoice,
   capped by the payment money left on it, read through Correct invoice's own checks
   (`checkInvoiceCorrectable` and `readCorrectableLines`, `apps/server/src/invoice-corrections.ts:139-182`),
   exported as a new `correctableNow` beside them. Its refusals:
   - **lasting**, so the amount is 0 and Refund a payment stays open: `invoice_correction.not_settled`
     (`:151`), `advance.taken_off_final_invoice`, `invoice_correction.chain_unsound` (`:163`),
     `sale.correction_not_admitted`, `sale.correction_history_unusable` and
     `sale.correction_unsupported` (a full invoice naming a customer,
     `packages/core/src/correction-eligibility.ts:5-9`) — the till's `REFUND_STILL` set and more
     (`apps/till/src/widgets/invoice-correction-dialog.ts:95-100`);
   - **passing**, re-thrown so the plain refund waits as Correct invoice does:
     `invoice_correction.refund_pending` (`:157`; its till message already says "Check it under
     Refund a payment, then try again", `apps/till/src/i18n/codes.ts:512-514`) and the clock refusals
     of `backend.refuseUntilRecordable` (`:164`), which plain refunds already meet on the route
     (`apps/server/src/tender-refund-api.ts:299`). An open correction is refused earlier, by
     `refuseWhileCorrectionOpen` (`tender-refund-reservation.ts:239`).
   - **Cost:** the chain check (`backend.checkIntegrity`, `verifyChain` over the node's records,
     `packages/fiscal-verifactu/src/backend.ts:788-790`) runs last and only when the refund would
     otherwise be refused, so an allowed plain refund never pays for it; a refused one pays what
     opening Correct invoice already pays.
4. A refund that returns only a tip never reaches the gate (payment amount 0); see O2 for what a
   tip may do.

`reserveTenderRefund` has no fiscal backend today; it gains a required `{ backend, reading }`
argument for a request with no correction named. Its product callers are two
(`git grep -n "reserveTenderRefund("`): `beginSettledTenderRefund` (`apps/server/src/tender-refunds.ts:82`),
which holds both (`deps.backend`, `reading` at `:80`), and Correct invoice's cash step
(`invoice-correction-cash.ts:113`), which always names its correction.

**O2, for the owner: tips.** Today a tip comes back only together with all the payment money left,
or once none is left (`refundAmountsFit`, `tender-refund-reservation.ts:149-151`; the fresh read ran
it: a tip alone while payment money is left is refused, `tender.refund_exceeds_payment`). Under the
rule above, "all the payment money with its tip" is refused wherever Correct invoice would take the
money, so a mistyped tip could come back only after a corrective of the whole payment. **Default: a
tip alone may come back at any time, up to what is left of it**, because a tip is not on the invoice
and its return files nothing. The rule's origin (A737 Part 2, a05ad041d7, #1817) gives no reason in
its commit, and its spec is no longer in the tree. The alternative is to keep the rule and say in the
message, the guide and the adviser's list that a tip comes back only after Correct invoice.

**Code name.** `tender.refund_needs_correction`, beside its siblings `tender.refund_of_advance` and
`tender.refund_exceeds_cancelled` (`apps/server/src/errors.ts:980-984`); it names the concept, not the
package (CLAUDE.md §3). Status 409 beside them (`tender-refund-api.ts:141-142`).

**Till message** (`apps/till/src/i18n/codes.ts`, beside `tender.refund_exceeds_cancelled`, `:648`).
It says what happened and what each choice does (CLAUDE.md §3); Correct invoice asks for a PIN itself
when the person may not correct invoices.

| | Text (with O2's default) |
| --- | --- |
| en | Correct invoice can give this money back, so Refund a payment cannot: it files nothing. Close this window and choose Correct invoice: it gives the money back and files a corrective invoice for it. Refund a payment still gives back a tip, or what is still owed for cancelled dishes. |
| es | Rectificar factura puede devolver este dinero, así que Devolver un pago no puede: no presenta nada. Cierra esta ventana y elige Rectificar factura: devuelve el dinero y presenta una factura rectificativa por él. Devolver un pago sigue devolviendo una propina o lo que falta por devolver de platos cancelados. |

It shows as the window's bottom message; a request refusal never disables the button (CLAUDE.md §3,
Forms). **D5b, the watcher's call:** no new line in the window; its existing "This returns money
only. The original invoice is unchanged." (`apps/till/src/i18n/strings.ts:148`, Spanish `:2477`,
shown at `tender-refund-dialog.ts:571-575`) stays true.

**What is left open.** A refund of cancelled dishes still files no corrective of its own (A758 §3.8,
`docs/backlog/fiscal.md:942-947`). Task 7's test setups use a refund that names a cancel and stays
within what it owes, which this rule keeps allowed; when §3.8 lands, those refunds start filing a
corrective, so the suites' counts of filed records change then. Task 8 writes that into the §3.8
backlog entry.

### 4.7 D7, D8: the adviser's list, guides and backlog

**Adviser's list** (`docs/compliance/2026-11-19-adviser-meeting.md`). A new question 14 in both
parts, after question 13 (Part 1 after `:283`, Part 2 after `:430`), one bullet per item, and a
paragraph in "Added after the meeting" (`:468`) saying it was added on 23 November from the owner's
words of 21 November and must be copied into the shared Google Doc. The worked figures are the
prototype's and the correction's sharing code's (sections 4.1, 4.2, 4.5).

Arithmetic, A445: €10.00 × 10/12 = 8.333 → 8.33; €10.00 × 2/12 = 1.666 → 1.66, plus the one cent
left over, which goes to the larger remainder (the water's) → 1.67. 8.33 ÷ 1.04 = 8.0096 → base
8.01, VAT 0.32; 1.67 ÷ 1.21 = 1.3802 → base 1.38, VAT 0.29; VAT 0.61 in all. Today 10.00 ÷ 1.04 =
9.615 → 9.62 and 0.38. Goodwill: €5.00 × 12/20 = 3.00 and × 8/20 = 2.00; 3.00 ÷ 1.21 = 2.479 →
2.48 and 0.52; 2.00 ÷ 1.04 = 1.923 → 1.92 and 0.08. The €3.00 case (salad charged €5.00): 3 × 5/7 =
2.142 → 2.14; 3 × 2/7 = 0.857 → 0.85, plus the cent left over (the water's remainder is larger) →
0.86; 2.14 ÷ 1.04 = 2.0577 → 2.06 and 0.08; 0.86 ÷ 1.21 = 0.7107 → 0.71 and 0.15 — the same as the
real `allocateCorrectionAmounts` printed when run on that history. With €1.00 off the bill as well:
€9.00 × 10/12 = 7.50 and × 2/12 = 1.50; 7.50 ÷ 1.04 = 7.2115 → 7.21 and 0.29; 1.50 ÷ 1.21 = 1.2397 →
1.24 and 0.26 (the prototype's run).

Part 1 (the text follows the defaults of O1–O4; Task 8 rewords it to whatever the owner decides):

> **14. Built since your answers: have we done this right?** (added 23 November)
>
> - **A free item on a ticket with two VAT rates** (your answer 1.10). When such a ticket holds an
>   item given free (a comp, or a discount that takes it to zero), Waitron shares the price paid
>   across all the items, the free one included, in proportion to their menu prices. For example, a
>   salad at €10.00 (4%) and a water at €2.00 (21%) given free, the customer paying €10.00: Waitron
>   files €8.33 at 4% (base €8.01, VAT €0.32) and €1.67 at 21% (base €1.38, VAT €0.29), €0.61 of VAT
>   in all, where before it filed €10.00 at 4% (base €9.62, VAT €0.38) and nothing at 21%. When the
>   same ticket also has a discount, what is paid after it is shared the same way, by menu price:
>   with €1.00 off the bill as well, €7.50 at 4% (base €7.21, VAT €0.29) and €1.50 at 21% (base
>   €1.24, VAT €0.26). On a ticket with nothing free, a discount on one item stays on that item's own
>   rate. The guest's ticket still shows the water as given free, with the shared figures in its VAT
>   rows; the accountant's Given free sheet still lists the water at its menu price. *Have we done
>   this right? Should a discount on one item also be shared when nothing is free?*
> - **Money given back as goodwill** (question 6). Wherever Waitron can correct the ticket, it now
>   gives such money back only through a corrective invoice. A refund with no corrective is kept for
>   a tip, for money still owed on items cancelled after payment, for a part payment as in question
>   13, and for a ticket Waitron cannot correct (a full invoice naming a customer, or a ticket whose
>   records need checking). Money not tied to particular items is shared across them in proportion
>   to what is left of each item's price on the ticket. That is the menu price unless an item was
>   discounted or partly given back before, and there it differs from the split in question 6: a
>   salad at €10.00 (4%) sold at €5.00 and a water at €2.00 (21%), €3.00 given back, files −€2.14 at
>   4% (base −€2.06, VAT −€0.08) and −€0.86 at 21% (base −€0.71, VAT −€0.15), where menu prices would
>   give −€2.50 and −€0.50. We do this because menu prices can take more from an item than is left of
>   it. The €5.00 of question 6's own example files −€3.00 at 21% (base −€2.48, VAT −€0.52) and
>   −€2.00 at 4% (base −€1.92, VAT −€0.08). *Have we done this right?*

Part 2:

> **14. Lo que hemos hecho a partir de sus respuestas: ¿lo hemos hecho bien?** (añadida el 23 de
> noviembre)
>
> - **Un producto gratuito en un tique con dos tipos de IVA** (su respuesta 1.10). Cuando un tique así
>   incluye un producto gratuito (una invitación, o un descuento que lo deja a cero), Waitron reparte
>   el precio pagado entre todos los productos, también el gratuito, en proporción a sus precios de
>   carta. Por ejemplo, una ensalada de 10,00 € (4 %) y un agua de 2,00 € (21 %) gratis, por las que
>   el cliente paga 10,00 €: Waitron presenta 8,33 € al 4 % (base 8,01 €, cuota 0,32 €) y 1,67 € al
>   21 % (base 1,38 €, cuota 0,29 €), 0,61 € de IVA en total; antes presentaba 10,00 € al 4 % (base
>   9,62 €, cuota 0,38 €) y nada al 21 %. Si el mismo tique tiene además un descuento, lo pagado
>   después se reparte igual, por precio de carta: con 1,00 € menos en la cuenta, 7,50 € al 4 % (base
>   7,21 €, cuota 0,29 €) y 1,50 € al 21 % (base 1,24 €, cuota 0,26 €). En un tique sin nada gratuito,
>   un descuento en un producto se queda en el tipo de ese producto. El tique del cliente sigue
>   mostrando el agua como invitación, con las cifras repartidas en sus líneas de IVA; la hoja de
>   invitaciones para el gestor sigue mostrando el agua a su precio de carta. *¿Lo hemos hecho bien?
>   ¿Debería repartirse también un descuento en un producto cuando nada es gratuito?*
> - **Una devolución de cortesía** (pregunta 6). Siempre que Waitron puede rectificar el tique, ese
>   dinero se devuelve solo mediante una factura rectificativa. La devolución sin rectificativa queda
>   para una propina, el dinero pendiente de productos cancelados después del pago, un pago a cuenta
>   como el de la pregunta 13 y un tique que Waitron no puede rectificar (una factura completa a
>   nombre de un cliente, o un tique cuyos registros hay que revisar). El dinero que no corresponde a
>   productos concretos se reparte entre ellos en proporción a lo que queda del precio de cada uno en
>   el tique. Es el precio de carta salvo que un producto tuviera un descuento o una devolución
>   anterior, y ahí difiere del reparto de la pregunta 6: una ensalada de 10,00 € (4 %) vendida a
>   5,00 € y un agua de 2,00 € (21 %), con 3,00 € devueltos, presentan −2,14 € al 4 % (base −2,06 €,
>   cuota −0,08 €) y −0,86 € al 21 % (base −0,71 €, cuota −0,15 €), donde los precios de carta darían
>   −2,50 € y −0,50 €. Lo hacemos así porque los precios de carta pueden quitar a un producto más de
>   lo que le queda. Los 5,00 € del propio ejemplo de la pregunta 6 presentan −3,00 € al 21 % (base
>   −2,48 €, cuota −0,52 €) y −2,00 € al 4 % (base −1,92 €, cuota −0,08 €). *¿Lo hemos hecho bien?*

The repository copy only; the shared Google Doc is copied by the desk, as the sheet's other
additions say.

**Guides** (`apps/server/src/guide/en/table-service.md`, `apps/server/src/guide/es/table-service.md`;
no `{#id}` changes). The words follow O2's default; with the other answer, the tip clause becomes
"a tip once Correct invoice has given back the whole payment".

- `{#refund-receipt}` (en `:338`, es `:357`): a new second paragraph. en: "Refund a payment gives
  money back without correcting the invoice, so it refuses money **Correct invoice** can give back,
  such as for a complaint: use Correct invoice for that. It still gives back a tip, what is still
  owed for dishes cancelled with **Cancel and refund** or **Finish table**, a part payment as below,
  and money on an invoice Correct invoice cannot correct." es: "Devolver un pago devuelve dinero sin
  rectificar la factura, así que rechaza el dinero que **Rectificar factura** puede devolver, como
  por una queja: usa Rectificar factura para eso. Sigue devolviendo una propina, lo que falta por
  devolver de platos cancelados con **Cancelar y devolver** o **Cerrar mesa**, un pago parcial como
  el de abajo y el dinero de una factura que Rectificar factura no puede rectificar."
- The same section's "If you cannot give refunds, it asks for the PIN, and the dishes' entries in the
  report do not show that part" (en `:369-370`, and its Spanish twin at es `:389-390`, "Si no puedes hacer
  devoluciones, pide el PIN, y las entradas de esos platos en el informe no muestran esa parte")
  loses its second half: with D5c, that part now counts against the dishes.
- `{#correct-invoice}` (en `:379-388`, es `:400-409`): first sentence becomes "When a paid bill
  charged too much, or you give money back for a complaint, correct its invoice: …" / "Cuando a una
  cuenta pagada se le cobró de más, o devuelves dinero por una queja, rectifica su factura: …"; the
  second paragraph's "otherwise leave them all unticked" gains ", and it is shared across every
  dish by price" / ", y se reparte entre todos los platos según su precio".
- Nothing for A445 or O4: neither changes what staff do (CLAUDE.md §3, "A guide sentence earns its
  place by changing what staff do"; the Cancel and refund window fills its amount by itself).

**Backlog.**

- Delete A445 from `docs/backlog.md:261-262` and its section `docs/backlog/fiscal.md:20-30`
  (finished entries are deleted). Its other links are historical (`2026-11-15-adviser-answers.md`)
  or plans (`2026-11-19-adviser-corrections-report.md:767`, the VAT-RATES plan); CLAUDE.md §6 says
  historical docs keep what was true.
- Add to `docs/backlog/fiscal.md` `## Decisions and deliberate limits` (`:1097`), each dated and
  marked owner or watcher as section 0 and section 10 record: the free-item rule and O3; the goodwill
  split and O1; choice 1's rule, O2 and D5c; O4.
- Replace the goodwill bullet (`docs/backlog/fiscal.md:948-958`) and its sentence in
  `docs/backlog.md:371-372` with: goodwill goes through Correct invoice since this PR; Refund a
  payment refuses what Correct invoice would take; the adviser is asked (question 14). The
  cancelled-dish entry beside it (`docs/backlog/fiscal.md:942-947`) gains: "When this lands, the
  refund suites whose setups refund a named cancel (Task 7 of the goodwill plan) start filing
  correctives, so their counts of filed records change."
- Add O6 (Complaint as a Correct invoice reason) as a short question entry in `docs/backlog/fiscal.md`
  near the goodwill bullet, with the zero-code way staff do it today: a person would notice it.

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

So A445, choice 2 and D3a change one server assertion. Choice 1's count under the rule this plan now
uses is run 3, below. The core run is section 4.1's (one
row). The till rows are read, not run (browser suites were not run on the prototype). Not run at all:
the other ~1,350 `apps/server` suites, `apps/till`, `apps/dashboard`; CI's scoped run covers the
changed packages, and Task 3 and Task 6 each run their package's affected suites in full.

**A445, choice 2 and D3a**

| File:line | Before | After | Decision | For the watcher |
| --- | --- | --- | --- | --- |
| `apps/server/src/full-comp.fiscal-identity.test.ts:288-327`, "files the full comps' sale with these figures" | takeaway bill, Burger comped, Bottle and Bread discounted to €0, Water €2.00 paid: 21% 1.65 / 0.35, 10% 0.00 / 0.00 (comment: "a zero row at 10%"), `cuota_total` 0.35, record hash `60A40E87…`, XML sha256 `b2e296be…` | run 2 received: 21% **1.57 / 0.32**, 10% **0.10 / 0.01**, `cuota_total` **0.33**, record hash `4951AAE8E3C6B41946208115DD7F26028DD0D25178FE54A526901E7428B3D57D`; the XML sha256 line is not reached after the first failure, so Task 3 takes its new value from a run. The comment becomes "Bread: its share of the price paid at 10%" | D2, O3 | **Controversial: a pinned filed record and its hash change.** By hand: €2.00 shared 12 : 30 : 2.50 : 2.00 is 0.52, 1.29, 0.11, 0.08 (the two cents left over go to Bread and Burger, the largest remainders); at 21% 0.52 + 1.29 + 0.08 = 1.89, bases 0.43 + 1.07 + 0.07 = 1.57; at 10% 0.11, base 0.10. The test's other case (the receipt's words never reach the record, `:275-286`) is unchanged and still passes |
| `packages/core/src/correction-allocation.test.ts:217` | `[undefined, "required"]`: no dishes on two rates refused | row deleted; new case: no dishes equals all dishes on `mixedRates()` (the figures already pinned at `:52-60`) | choice 2 | **Controversial: decides how a corrective's VAT is divided** |
| `apps/till/src/widgets/invoice-correction-dialog.test.ts:238-253` | after ticking `steak`, `rice` (other rate) is disabled | `rice` stays enabled; ticking both previews with both ids | choice 2 | no money |
| `invoice-correction-dialog.test.ts:358-361` | mocked refusal carries `reason: "required"` | `reason: "missing"`; the message is the new text | choice 2 | no money |

**Choice 1, re-measured under section 4.6's rule.** Run 1 was the 19 November rule (three
exemptions): 259 failing tests in 17 files. After the fresh read I built the new rule in a second
throwaway worktree (`git worktree add --detach`, `pnpm install`, removed afterwards): the gate of
section 4.6 with the two "still owed" readings (named cancels, and unnamed ones linked as D5c says),
Correct invoice's own `readInvoiceCorrectionLines` for "what it could take now" (every refusal it
raised counted as lasting, a little wider than the plan, which re-throws a pending refund), and O2's
tip change in `refundAmountsFit`; A445 and choice 2 were left out (run 2 already measured them).

- **Run 3**, the same 84 files, same command: 4157 tests, **3974 passed, 183 failed, in 14 files.**
- Why 76 fewer: the suites whose sales have no admitted record (their fixtures file none) now pass,
  because Correct invoice refuses those sales and Refund a payment stays open. A logged rerun of
  five of the files counted the refusals that opened the gate: `sale.correction_not_admitted`
  reason `missing` 71, `filing_refused` 13, `sale.correction_history_unusable` 3, `wrong_node` 1,
  `invoice_correction.refund_pending` 1. `tender-refund-api.test.ts`, `tender-refund-management.test.ts`,
  `fiscal-remedy.staff-refund.test.ts` and `handover-controlled.e2e.test.ts` went from failing to
  passing, `invoice-correction-api.test.ts:264` among them.
- Not measured: a prototype difference — it gave the D5c-linked refunds the "no extra PIN" of named
  ones, which the plan does not; one `tender-refund-links.test.ts` case ("omitting the cancellation
  IDs grants no saved approval") failed only because of that and is expected to pass on the build.

| Group | Files (failing tests in run 3) |
| --- | --- |
| A. Refund mechanics called directly or through the command (`bill-payment-fixture`, a fake fiscal backend) | `tender-refunds.test.ts` (93: its fake backend has no table for Correct invoice's checks, "no such table: fake_fiscal_records"), `tender-refund-reservation.test.ts` (36), `tender-refund-authorization.test.ts` (11) |
| B. Refund mechanics through the route | `clock-unconfirmed-gate.test.ts` (12), `conflict-issuance.test.ts` (5), `till-device-proof.test.ts` (5), `clock-behind-stop.refunds.test.ts` (2) |
| C. Tests whose subject includes a plain refund or a refund naming cancels | `tender-refund-links.test.ts` (7), `advance-corrections.test.ts` (3), `advance-final.test.ts` (1), `invoice-correction-alerts.test.ts` (2), `invoice-correction-api.test.ts` (2), `invoice-correction-cards.test.ts` (2), `invoice-corrections.test.ts` (2) |

Groups A and B (164 tests in 7 files) keep every assertion about the refund itself; only the sale
they refund changes shape (Task 7). Group C (19 tests in 7 files) is rewritten in Task 6, and its
behaviour rows are for the watcher:

| Test | Before | After |
| --- | --- | --- |
| `advance-final.test.ts:511` "the €90 given back from the rest's invoice, then the €30 advance back in cash by Refund a payment" (#3993's own) | the €90 goes back by a plain refund of the table's ticket | the €90 goes back by Correct invoice on that ticket (as the till's `advance.taken_off_final_invoice` message already tells staff, `apps/till/src/i18n/codes.ts:664-667`); the €30 of the part payment stays a plain refund and still passes |
| `advance-corrections.test.ts:1172` "a plain refund of €20 of the settled €120 leaves €120 received …" | a plain €20 refund of the table's ticket | asserts `tender.refund_needs_correction` for the €20, and keeps the received figures for the €90 Correct invoice part |
| `advance-corrections.test.ts:850-874` `goodwill(…)` helper, reason "Goodwill" (two cases) | a plain refund used as goodwill | Correct invoice, which is now the goodwill route |
| `tender-refund-links.test.ts` "a second refund naming the same cancels links only what is left", "fresh approval permits excess amount or tip …", "does not cap a person who holds the refund permission", "refuses a second one over what the first left", "refuses a linked refund without new approval €0.01 above its cancels" | a refund naming cancels may give back more than they owe (a manager, or with an approval PIN); above it without permission, `tender.refund_exceeds_cancelled` | above what the named cancels owe (and what Correct invoice could not take), `tender.refund_needs_correction`, for everyone. Whether `tender.refund_exceeds_cancelled` keeps any use is decided in Task 6 (today it is raised only for a person without refund permission and no PIN, `tender-refund-reservation.ts:331-349`) |
| `tender-refund-links.test.ts` "a refund naming no cancels links nothing and fingerprints as before" | nothing linked | with D5c, linked to the cancel still owed; the fingerprint part is unchanged |
| `invoice-corrections.test.ts:280-292` helper ("refuses an ordinary refund on a ticket with an unfinished correction, and allows it once the correction ends"; "… naming €7.00 after €3.00 of €10.00 went back") | an ordinary plain refund on a correctable ticket | the refusal while a correction is open is unchanged; the refund "allowed once the correction ends", and the €3.00 refund before Correct invoice, name a cancel within what it owes |
| `invoice-correction-api.test.ts` "answers invoice_correction.money_short with 409" and "answers invoice_correction.refund_pending with 409" | set up with a plain refund | the same setup through a cancel or a Correct invoice step; the 409 assertions are unchanged |
| `invoice-correction-alerts.test.ts` (2), `invoice-correction-cards.test.ts` (2) | set up with a plain refund | the same, through a named cancel |

Also to be listed in the PR, not measured: the full-invoice A4 suites the `invoice-document.ts` half
of D3a can change, and the till's suites. Choice 3's assertions no longer change: it is out of the
PR. Any other assertion that has to change is listed in the PR with file:line, before and after.

## 7. Tasks

Risk triggers: fiscal invariants (what is filed), money (a refund refused) and permissions (who may
refund what), so the full path:
per-task review, and `/finish-branch` with two Codex run-it reviews side by side. Each task:
failing test first, watch it fail, then the change; then
`pnpm exec prettier --check <changed files>` and the fiscal command of section 5. Till and
dashboard suites run real headless Chromium: check `memory_pressure | grep free` first. Run every
Vitest command with `env -u CLAUDECODE -u AI_AGENT` when you need a passing test's output, and read
both the "Test Files" and the "Tests" count: a file name that does not exist is skipped silently
and the run still passes. Every file named below was checked with `ls` on this branch, except the
two new ones Tasks 1 and 3 create. Each task is sized for one implementer well under 100 tool calls (estimates
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

1. Tests first in `packages/menu/src/pricing.test.ts`: the prototype's three cases as pure inputs
   (`GrossLines` with `vatRates` and `listGross`); a ticket at one rate is returned unchanged
   (same object); two rates and no free line, unchanged; a line with an empty list, unchanged; a
   shared line with no list price gets `listGross` = its old gross and `listUnitPriceGross` = its
   old unit price; `total` and line order unchanged; `rateLines(shareFreeItems(g, on), on)` gives
   the prototype's breakdowns. Run, watch them fail.
2. Write `shareFreeItems` (section 4.2), with a one-line comment naming answer 1.10.
3. ```sh
   pnpm --filter @waitron/menu exec vitest run src/pricing.test.ts
   ```

### Task 3: issuance files the share — about 50 calls

1. Tests first, through the real writers, in a new `apps/server/src/free-item-share.test.ts` on the
   `free-items.test.ts` setup (copy its `adjust` and `pay` helpers): the prototype's three cases,
   asserting `sales.vat_breakdown`, the record's breakdown (`backend.checkIntegrity` reports no
   issue) and the `sale_lines` gross, base and list columns; the receipt `paySavedBillInCash`
   returns lists the salad at 10.00 and the water at 0.00 with "comp 2.00", and its VAT rows are
   the filed ones; a counter sale (`working-order.ts:7867`) and the close-of-day issue
   (`close-of-day.ts:101`) file the same split; **O4:** after payment, Cancel and refund of the salad
   and of the water, through the real `cancelItem` and `rowRefundValue`, fill €8.33 and €1.67 (or the
   owner's other answer). Run, watch them fail.
2. Export `listGrossOf`; add `listGross` in `issuancePass`; call `shareFreeItems` in `issueMoment`.
3. Fix every other assertion section 6 lists for A445, changing expected figures only where the
   table says.
4. ```sh
   pnpm --filter @waitron/server exec vitest run src/free-item-share.test.ts src/issuance-pass.test.ts src/free-items.test.ts src/receipt-adjustments.test.ts src/full-comp.fiscal-identity.test.ts src/adjustments-apply.test.ts src/line-cancel.test.ts
   ```

### Task 4: reprints and the full invoice show the dish as sold — about 40 calls

1. Tests first: in `apps/server/src/transaction-receipt-api.test.ts` (Find a bill's reprint) and
   `apps/server/src/invoice-document.test.ts` (the A4 document), the comped mixed-rate ticket
   reprints with the salad at list 10.00, the water at list 2.00 and "comp 2.00" beneath it; a
   comped ticket eaten here reprints with its comp (today it prints none). A full invoice naming a
   customer for the same basket: the A4 table's lines come to the filed bases, and its rows read as
   D3b says (a discount row of 1.61 at 4% under the salad, an "On the house" row of 0.27 at 21% under
   the water). Run, watch the first two fail.
2. Pass the filed `list_unit_price_gross` at `transaction-receipt.ts:118` and
   `invoice-document.ts:116`.
3. Render the full invoice and the simplified reprint to files and open them in the workspace's
   Playwright Chromium, in both themes and at phone width (CLAUDE.md §4, "A page asserted as a
   STRING"); if the A4 rows read differently from D3b, stop and report before changing the test.
4. ```sh
   pnpm --filter @waitron/server exec vitest run src/transaction-receipt-api.test.ts src/invoice-document.test.ts src/invoice-document.issue-clock.test.ts src/receipt-document.test.ts src/receipt-ticket.test.ts
   ```

### Task 5: Correct invoice shares an unticked amount; the till drops its lock — about 40 calls

1. Tests first:
   - `packages/core/src/correction-allocation.test.ts`: delete the `[undefined, "required"]` row
     (`:217`); add "shares an amount with no dishes chosen across every rate, as choosing them all
     does" on `mixedRates()` (`{ gross: "2.00" }` equals `{ gross: "2.00", lineIds: ["wine",
     "dish"] }`); add O1's two cases (salad charged €5.00 and €1.00, section 4.1's table, "by what is
     left" column).
   - `apps/server/src/invoice-corrections.test.ts`: "files a corrective split across both rates when
     no dishes are chosen": `soldForCash(["Rib steak", "Cold soup"], ["17.60"], "0.00", "takeaway")`
     (as at `:479`), open €8.80 with no `lineIds`, give the cash, file; the corrective's
     `vat_breakdown` is `[{10.00, −2.50, −0.25}, {21.00, −5.00, −1.05}]`, total −8.80, and
     `checkIntegrity` reports nothing. And on Task 3's comped ticket, €1.00 with no dishes previews
     4%: 0.80 / 0.03, 21%: 0.14 / 0.03.
   - `apps/till/src/widgets/invoice-correction-dialog.test.ts:238`: rename to "previews dishes
     picked at both VAT rates"; the dish at the other rate stays enabled and both ids are sent.
     `:358-361`: `reason: "missing"`, and the message is the new text. `apps/till/src/i18n/codes.test.ts`:
     the new English and Spanish text.
   Run, watch them fail.
2. Delete the refusal and `"required"` (section 4.5); delete the till clause and `picked`; replace
   the message.
3. ```sh
   pnpm --filter @waitron/core exec vitest run src/correction-allocation.test.ts src/correction-history.test.ts
   pnpm --filter @waitron/server exec vitest run src/invoice-corrections.test.ts src/invoice-correction-api.test.ts
   pnpm --filter @waitron/till exec vitest run src/widgets/invoice-correction-dialog.test.ts src/widgets/invoice-correction-dialog.a11y.test.ts src/i18n/codes.test.ts
   pnpm exec vitest run scripts/errors-reachable.test.ts
   ```

### Task 6: Refund a payment refuses only what Correct invoice would take — about 60 calls

1. Tests first, reusing `b95a643c19`'s cases where they fit (`git show b95a643c19 --
   apps/server/src/tender-refund-reservation.test.ts apps/server/src/tender-refund-api.test.ts
   apps/server/src/tender-refund-links.test.ts packages/adjustments/src/refund-links.test.ts
   apps/till/src/i18n/codes.test.ts`). Each refusal asserts the code and that no `refunds` row and
   no drawer job were written:
   - a plain €10 refund on a cash sale with no cancels: refused (409 through the route);
   - **the refusal lifts wherever Correct invoice refuses for good**, one case each:
     `invoice_correction.chain_unsound` (the existing `invoice-correction-api.test.ts:264` keeps its
     assertion that the plain refund succeeds), `sale.correction_unsupported` (a sale naming a
     customer), `sale.correction_not_admitted`, `sale.correction_history_unusable`,
     `invoice_correction.not_settled`, `advance.taken_off_final_invoice` (where no fixture reaches a code, say so in the handover rather than inserting rows by hand);
   - **passing refusals stay:** with another payment's refund pending, the plain refund answers
     `invoice_correction.refund_pending`;
   - after Correct invoice gave back part, a plain refund of more than the payment money left beyond
     what Correct invoice could still take: refused; of exactly that much: accepted;
   - **cancelled dishes:** naming a cancel that owes €6, €6 is accepted and €20 is refused (today
     `tender-refund-links.test.ts`'s "a second refund naming the same cancels" accepts €20 with €6
     linked — that assertion changes, a behaviour row in section 6); naming no cancel on a sale whose
     cancel owes €6, €6 is accepted and linked to it, €7 refused; a fully refunded cancel adds
     nothing;
   - **tips (O2's default):** a tip alone while payment money is left is accepted; a refund of all
     the payment money with its tip is refused where Correct invoice would take the money;
   - with a correction named (card and cash steps): unchanged;
   - **#3993's cases unchanged:** `advance-final.test.ts` and `advance-corrections.test.ts` keep their
     part-payment assertions (not taken off: `tender.refund_of_advance`; taken off with money left on
     the table's ticket: `advance.taken_off_final_invoice`; nothing left: accepted, never
     `tender.refund_needs_correction`).
   Run, watch them fail.
2. `correctableNow` in `invoice-corrections.ts` (the chain check last, and only when the refund would
   otherwise be refused); `refusePlainRefund` in the reservation with its required `{ backend,
   reading }`, passed from `beginSettledTenderRefund`; the unnamed-cancel linking (D5c) with
   coverage computed only for named cancels; `refundAmountsFit` for O2; the code in `errors.ts`; 409 in
   `tender-refund-api.ts`; the message in `codes.ts`.
3. Rewrite section 6's group C here. Commit at a point where only groups A and B are red, and hand
   over to Task 7.
4. ```sh
   pnpm --filter @waitron/server exec vitest run src/tender-refund-reservation.test.ts src/tender-refund-api.test.ts src/tender-refund-links.test.ts src/advance-final.test.ts src/advance-corrections.test.ts src/invoice-correction-api.test.ts src/invoice-corrections.test.ts
   pnpm --filter @waitron/adjustments exec vitest run src/refund-links.test.ts
   pnpm --filter @waitron/till exec vitest run src/i18n/codes.test.ts
   pnpm exec vitest run scripts/errors-reachable.test.ts scripts/write-path-tables.test.ts
   ```

### Task 7: setups whose refund Correct invoice would now take — about 70 calls (7a) and 50 (7b)

Section 6's group A (7a: `tender-refunds.test.ts`, `tender-refund-reservation.test.ts`,
`tender-refund-authorization.test.ts`) and group B (7b: `clock-unconfirmed-gate.test.ts`,
`conflict-issuance.test.ts`, `till-device-proof.test.ts`, `clock-behind-stop.refunds.test.ts`).
Each fails only because it refunds payment money that Correct invoice could take (run 3 below).
The shape, decided before starting, does **not** lean on a gap this plan closes or on one a later
item will close: one helper in `apps/server/src/testing/` (for example `refundableCancel(venue,
billId)`) that cancels the refunded dish **keeping its charge with the Refund tick**, through the
real `cancelItem` (as `free-items.test.ts:103-123` cancels with `"keep_charge"`, adding the Refund
tick), and the suite's refund then **names that cancel** and stays within what it owes — the path
the first Refund a payment window takes after Cancel and refund. Where a suite's refund is larger
than one dish, cancel enough dishes to cover it. Change setup and the request body only; every
assertion about the refund itself stays. Prove the helper first: a suite's case without it fails
with `tender.refund_needs_correction`, with it passes. `tender-refunds.test.ts` also uses a fake
fiscal backend that has no answer for Correct invoice's checks (run 3: "no such table:
fake_fiscal_records"); give the fake the refusal a sale with no record gets
(`sale.correction_not_admitted`, reason `missing`) only if that is what the suite's sales really
are, and say which in the handover. If a suite counts dish lines or adjustments that the cancel
changes, or its sale has no bill to cancel on, stop and report it rather than inserting rows by hand
or editing its assertions.

Commands: each group's files, then Task 6's command; read the "Test Files" count.

### Task 8: guides, adviser's list, backlog, A802 pointer — about 25 calls

Section 4.7, and a dated pointer at the top of
`docs/superpowers/specs/2026-10-20-a802-partial-paid-invoice-correction-design.md` saying that
policy 2's "goodwill refunds stay money-only" is replaced by this PR, on the owner's 18 and 21
November words. Reword question 14 to the owner's answers to O1–O4 if they differ from the
defaults. Then:

```sh
pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts
pnpm exec vitest run scripts/guide-links.test.ts scripts/claude-md-pointers.test.ts
```

`docs/` is ignored by prettier: check with `pnpm exec prettier --file-info <file>` (prints
`"ignored": true`); the guide files under `apps/server` take `prettier --check`. The PR's first
section is section 0 and section 10 of this plan.

## 8. Size, and whether to split

| Part | Production (+/−) | Tests |
| --- | --- | --- |
| Task 1 shared rounding function | +40 / −20 | +50 |
| Task 2 `shareFreeItems` | +45 | +120 |
| Task 3 issuance wiring | +10 | +230 |
| Task 4 reprints | +4 / −2 | +120 |
| Task 5 choice 2 | +2 / −10 (core, till) | +100 / −5 |
| Task 6 choice 1 (`correctableNow`, the gate, D5c linking, O2, code, status, message, the new argument) | +100 / −10 | +250, and group C rewritten (19 tests in 7 files) |
| Task 7 fixtures | — | a helper of about +40, and setup changes for 164 tests in 7 files (about +150 / −60) |
| Task 8 docs | — | guides +15 / −3, sheet +30, backlog −15 / +15, A802 pointer +2 |

About **200 production lines added and 40 removed**, about **1,100 test lines** added or changed,
about 60 lines of guides, sheet and backlog; no generated file. The driver's brief for this plan set
the split line ("If the whole is more than about 300 production lines, split into two PRs"), so this
is **one PR**, as the watcher asked. If the build passes about 300, split after Task 5: PR 1 is A445,
choice 2 and their adviser bullet (Tasks 1–5, part of 8); PR 2 is choice 1 (Tasks 6–7, the rest of
8). Each leaves `main` working.

## 9. Open pull requests touching the same files

`gh pr list --state open` on 2026-11-23 lists two; `gh pr diff <n> --name-only` for each:

| PR | Overlap | How they interact |
| --- | --- | --- |
| #4118 (`feat/series-split-correctives-2`) | `apps/till/src/i18n/codes.ts` (a hunk at `:402`), `docs/backlog.md`, `docs/backlog/fiscal.md` (hunks near `:287` and `:1296`), `packages/core/src/record-correction.ts`; it also rebuilds core's starting migration, so every venue resets when it lands | Different keys and paragraphs from this plan's; text-only rebase. This plan does not touch `record-correction.ts` |
| #4140 (`fix/h-translation-abandon-box`) | `docs/backlog.md`, other sections | None |

## 10. Decisions, with defaults

**For the owner** — each decides what is filed with AEAT or what money staff hand over:

| # | Decision | Recommended default |
| --- | --- | --- |
| O1 | How a goodwill amount with no dishes ticked is split when a dish was discounted or partly given back before (section 4.1) | by what is left of each dish's price; menu price can take more than is left |
| O2 | A tip given back on its own while payment money is left (section 4.6) | allowed, up to what is left of the tip; a tip is not on the invoice |
| O3 | On a ticket with a free item, what other discounted dishes weigh (section 4.2) | their menu price, so their discounts are shared too |
| O4 | Money handed back by Cancel and refund after payment on a ticket A445 shared (section 4.3) | the dish's filed share (salad €8.33, free water €1.67), pinned by a Task 3 test |
| O5 | Choice 1 replaces A802's "goodwill refunds stay money-only" (section 0) | yes, on the owner's 18 and 21 November words — recorded here for the owner to see, not to re-decide |
| O6 | Complaint as a Correct invoice reason (section 0; out of this PR) | not built; staff pick **Other** with a note. If the owner wants it, the smallest version offers every reason in Correct invoice (about 10 lines) |

**The watcher's call** — no effect on what is filed or the money handed back:

| # | Decision | Default |
| --- | --- | --- |
| D1 | Where the one rounding function lives | `shareByWeight` in `@waitron/shared` |
| D2 | A445's scope | free items only, on tickets at two or more rates (the adviser's answer 1.10) |
| D3a | Find a bill and A4 reprints | print the filed menu price, so they match the receipt printed at payment |
| D3b | The full invoice's discount rows on a shared ticket | the existing rules, which print, by reading, "Discount −1.61" under the salad and "On the house −0.27" under the water; Task 4 pins them |
| D5 | Choice 1's rule | section 4.6: refuse only what Correct invoice would take now |
| D5b | A new line in the Refund a payment window | none |
| D5c | A refund naming no dishes on a sale with cancels still owed | counts against those cancels and is capped by them; the PIN rule stays as today |
| D7 | The adviser's list | question 14, both parts |
| D8 | Guides and backlog | section 4.7 |

## 11. Not established

- What the full invoice's A4 table prints for a shared free item (D3b): read, not rendered.
- The `invoice-document.ts` half of D3a, and every till and dashboard suite: not run on either
  prototype.
- The ~1,350 `apps/server` suites outside the 84 run: a comp on a ticket at two rates, or a plain
  refund of a correctable sale, elsewhere would change there too; CI's scoped run covers them.
- Run 3 counted every refusal of Correct invoice as lasting; the plan re-throws a pending refund and
  the clock refusal, so a few cases in groups A and B may differ on the build.
- How Task 7's helper sits with suites that count dish lines or adjustments: found per suite, with
  the stop rule there.
- The reason for today's whole-tip rule (O2): not recorded in its commit, and its spec is gone.
