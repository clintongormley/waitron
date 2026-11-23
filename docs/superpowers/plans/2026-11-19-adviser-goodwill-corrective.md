# A445 and ADVISER-GOODWILL-CORRECTIVE: a free item takes its share of the price paid, and money given back as goodwill takes a corrective invoice

Status: plan, rewritten 2026-11-23 on `feat/adviser-goodwill-corrective` at `a460d355c4` (plus the
two commits of the 19 November plan this replaces). No product code yet. Every `file:line` below was
read on this branch; every figure marked "run" was produced by a command named beside it.
Revised the same day after one fresh-context read
(`~/waitron-campaign-l/receipts/adviser-goodwill/plan-read-2026-11-23.md`) and the driver's direction
on it: choice 1's rule restated (section 4.6), choice 3 out, owner decisions O1–O6 named (section 10),
test cost re-measured (section 6). Revised again the same day after the one fresh re-read of that
fold (`~/waitron-campaign-l/receipts/adviser-goodwill/plan-reread-2026-11-23.md`, 0 Critical,
5 Important, 12 Minor): a refused filing now makes Refund a payment wait (section 4.6), the till
sends a tip on its own (O2), D5 and D5c are owner questions O7 and O8, Task 7 is rebuilt on run 4
(section 6), and section 12 lists the findings not folded. The owner's answers to O1–O6 (14:15–14:18)
are recorded in section 10, and the three that change the design (O1, O4, O6) are written in
(sections 4.1, 4.3, 4.5, 4.7, Tasks 3, 3b, 3c and 5; the O1 figures come from a prototype run,
section 4.1). O7, O8 and a new O9 are open.

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

**Choice 3 was out of this PR until the owner added it on 2026-11-23 14:18.** Letting
**Complaint** be chosen as a Correct invoice reason overrides the same A802 approval ("Reason: use
A758's Void-reason dropdown", spec `:90`). It was question O6; the owner answered "Add it"
(`questions.md:1404`), so Task 5 builds it.

**Owner, 2026-11-23, relayed by the watcher** in `~/waitron-campaign-l/questions.md`:

- O1, entry "WATCHER 2026-11-23 14:15" (`:1393-1395`): "what i mean is if item A (10%) is on the
  menu for 10€ and item B (21%) is on the menu for 4 €, then the 10/14 of the discount has 10% vat
  and 4/14 has 21% vat. does that work?" and "its the proportions which matter". The watcher's
  build note: where a dish's share would exceed what is left of it, cap that dish and spread the
  rest over the others in the same menu-price proportions.
- O4, entry "WATCHER 2026-11-23 14:17" (`:1400`), on returning the €10 salad from a ticket with a
  free €2 water: "they would have to return both, and get the 10€ back."
- O6, entry "WATCHER 2026-11-23 14:18" (`:1404`): "Add it".

**Decisions.** Section 10 lists every decision, split into those that need the owner (they decide
what is filed with AEAT or what money staff hand over) and those that are the watcher's call. The
D- and O-numbers below point into it. The watcher cleared D1–D8 at the plan's defaults at 13:47
(`questions.md:1388-1391`), under this plan's label "no effect on what is filed or the money handed
back". That label was wrong for D5 and D5c: D5 decides when money goes back with no corrective
invoice, and D5c caps how much a second Refund a payment window hands back (the re-read's I-4). They
are now owner questions O7 and O8, with the same defaults (D5's list corrected as section 4.6 says),
and still open. O9 (section 10) is new in the revision that wrote in O1, O4 and O6, and open.

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
ticket. Choice 3 (Complaint as a reason) is not needed for this; it is in the PR because the owner
asked for it (O6, section 0).

**True size** (estimates from the files each task names, not from a build; section 8 has the
breakdown): about 440 production lines added and 55 removed (shared 40, menu 45, server about 250,
core about 25, till about 85), about 1,650 test lines added or changed (setup changes for 177 tests
in 8 refund suites among them, section 6), about 90 lines of guides, sheet and backlog. No generated
file, no migration, no schema change. That passes the 300-line split line, so section 8 splits it
into two PRs: a free item's share with O4, then goodwill.

**Who approved:** section 0. Owner: the two needs, "split by menu price", and answers to O1–O6
(section 10). Watcher: choice 1 of 19 November, the 22 November rebase on #3993, and D1–D8 at 13:47.
O7, O8 and O9 are open. One fresh-context read
(`~/waitron-campaign-l/receipts/adviser-goodwill/plan-read-2026-11-23.md`, 1 Critical, 8 Important,
10 Minor) and its one re-read (`plan-reread-2026-11-23.md` beside it, 0 Critical, 5 Important,
12 Minor) are folded in; nobody has approved the plan as a whole.

## 2. What people will see when it lands

- **A takeaway ticket with a free item at another rate.** Salad €10.00 at 4%, water €2.00 at 21%
  given free; the guest pays €10.00. The receipt still lists the salad at €10.00 and the water at
  €2.00 with "On the house −€2.00" beneath it; its VAT rows now read 4%: base €8.01, VAT €0.32 and
  21%: base €1.38, VAT €0.29 (today 4%: €9.62 and €0.38, and a 21% row of €0.00). The total does
  not change.
- **Goodwill.** A guest complains after paying; on the past receipt the manager chooses **Correct
  invoice**, types the money back, leaves the dishes unticked, picks a reason and presses **Correct
  and refund**, on any ticket. Waitron shares the amount across the dishes in proportion to their
  menu prices (no dish gives back more than is left of it; the rest goes to the others) and files a
  corrective. Staff may also tick dishes at different rates, and the reason list now holds every
  reason, **Complaint** included (O6). If the manager chooses **Refund a
  payment** instead for money Correct invoice could give back, the refusal says why and names
  **Correct invoice**. Where Correct invoice cannot correct the ticket (a full invoice naming a
  customer, a ticket filed by another box, records that need checking, and the other cases of
  section 4.6), Refund a payment still gives the money back, as today. While a filing the tax agency
  refused is being fixed, neither gives it back until the filing has been sent again and accepted.
- **Changed a little:** a refund naming cancelled dishes is capped at what those dishes still owe;
  a tip can come back on its own while payment money is left, and the till's window now lets staff
  send one (O2, owner: "Yes").
- **A dish given free comes back with the last paid dish** (O4, section 4.3). On a ticket where a
  free item holds a share, Cancel and refund of the last paid dish lists the free item under it,
  cancels both and hands back what was paid (salad and free water: €10.00). A free item cannot be
  refunded on its own; while other paid dishes stay, each paid dish hands back its own share.
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
and new cases in four test files. **Reused:** the reader's "still owed" query (as the O8 linking
read), the code name, the status, and the test cases that still fit section 4.6's rule. **Not
reused:** its three exemptions, which section 4.6's single rule replaces, and its message. Its SQL
names `tender_refunds` and `tender_refund_id`; on this branch the table is `refunds` and the column
`refund_id` (`refund-links.ts:69-71`). It ran before #3993's gate, not inside it.

## 4. Design

### 4.1 D1: the one allocation, and where it lives

**Default: one function, `shareByWeight(total, weights)`, in `packages/shared/src/share-by-weight.ts`,
exported from `@waitron/shared`.** It is core's `apportionCorrectionCents`
(`correction-allocation.ts:239-257`) moved unchanged: each share rounded down to the cent, the cents
left over one at a time to the largest remainders, a tie to the earlier line. A list whose weights
add up to zero while the total is above zero stays refused `shared.invalid_decimal`, as today
(`divideDecimal`'s refusal of a zero divisor, `packages/shared/src/money.ts:104-105`). One addition:
a zero total returns zeros, even when every weight is zero. Task 1 tests both. Callers:

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

**What is built: one rounding function, one weight (menu price), and a cap in corrections.**

- **At issuance (A445)** each line weighs its menu price: its stored list total where it has one,
  otherwise its gross. This is the owner's "split by menu price".
- **In a correction (goodwill, O1)** each line weighs its menu price too, and no line takes more than
  is left of it (section below). Today it weighs what is left of its filed price
  (`correction-allocation.ts:75-78`). The two agree on a ticket with no discount and no earlier
  correction, and on a ticket A445 shared (the O1 prototype: €1.00 back on the comped ticket shares
  0.83 / 0.17 either way).

**O1, the owner's rule (answered 23 November 14:15, section 0).** An amount given back is shared
across the dishes in proportion to their menu prices. Where a dish's share would be more than is
left of it (an earlier discount or correction), that dish takes exactly what is left, and the rest
is shared over the other dishes in the same menu-price proportions, repeating until no dish's share
is more than is left of it. No dish ever goes below zero, which would make every later correction of
the invoice refuse (`remainingLines`, `correction-allocation.ts:219-220`).

- **Weight:** a line's menu price is its filed `sale_lines.list_gross` where stored, otherwise its
  filed `line_gross`. `list_gross` is stored only where it differs from the gross (`listGrossOf`
  returns nothing when they are equal, `apps/server/src/receipt-lines.ts:104-118`). Weights that add
  up to zero while money is left stay refused `shared.invalid_decimal`, as `shareByWeight` refuses
  them (Task 1).
- **The same rule for ticked dishes.** When staff tick dishes, the amount is shared over the ticked
  dishes by the same rule. Otherwise ticking every dish would give a different split from ticking
  none on a ticket with a discounted dish, and Task 5 pins that the two are equal. This applies the
  owner's "its the proportions which matter" beyond the unticked case the question asked about, so
  it is listed as O9 (section 10) with this as its default.
- **Rounding:** each pass is `shareByWeight` (Task 1): each share rounded down to the cent, the cents
  left over to the largest remainders, a tie to the earlier line.

**Measured, not reasoned.** In a throwaway worktree (`git worktree add --detach /tmp/ag-o1/wt HEAD`,
`pnpm install --frozen-lockfile --offline`, removed afterwards) I gave `CorrectionAmountLine` a
menu price, filled it in `readHistory` (`packages/core/src/correction-history.ts:257-263`) as above,
replaced the call at `correction-allocation.ts:75-78` with the capped loop over the same rounding
function, and removed the `required` refusal (choice 2). A probe suite of hand-built histories,
`env -u CLAUDECODE -u AI_AGENT pnpm exec vitest run src/zz-probe-o1.test.ts` in `packages/core`
(Tests 1 passed), printed, no dishes ticked:

| Ticket | Given back | Corrective (gross, base, VAT) |
| --- | --- | --- |
| The owner's example: A menu €10.00 at 10%, B menu €4.00 at 21% | €7.00 | A −5.00 (−4.55, −0.45); B −2.00 (−1.65, −0.35) |
| Same | €1.00 | A −0.71 (−0.65, −0.06); B −0.29 (−0.24, −0.05) |
| Salad menu €10.00 at 4% charged €5.00 (discounted), water €2.00 at 21% | €3.00 | salad −2.50 (−2.40, −0.10); water −0.50 (−0.41, −0.09) |
| Salad charged €1.00 instead | €3.00 | salad −1.00 (−0.96, −0.04), capped; water −2.00 (−1.65, −0.35) |
| Salad €10.00 at 4% with €8.00 of it corrected before, water €2.00 at 21% | €3.00 | salad −2.00 (−1.93, −0.07), capped; water −1.00 (−0.83, −0.17) |
| Three lines, A menu €10.00 left €1.00 (4%), B menu €5.00 left €2.00 (10%), C menu €5.00 left €10.00 (21%) | €6.00 | A −1.00 (capped in the first pass), B −2.00 (capped in the second), C −3.00 |
| The sheet's example: wine €12.00 at 21%, cheese €8.00 at 4% | €5.00 | wine −3.00 (−2.48, −0.52); cheese −2.00 (−1.92, −0.08), as today |
| Section 4.2's comped ticket (salad 8.33 list 10.00, water 1.67 list 2.00) | €1.00 | 4%: −0.80 / −0.03; 21%: −0.14 / −0.03, as today |

The €1.00 row is the rounding check: €1.00 × 10/14 = 0.714 and × 4/14 = 0.286 round down to 0.71
and 0.28; the cent left over goes to the larger remainder, B's (0.0057 against 0.0043), so B takes
0.29. The old rule, by what is left, gave the discounted-salad row −2.14 / −0.86 (the real
`allocateCorrectionAmounts`, run by the re-read).

The same prototype ran the existing suites: `pnpm exec vitest run src/correction-allocation.test.ts
src/correction-history.test.ts` in `packages/core`, **Tests 3 failed, 91 passed (94)**: the
`required` row choice 2 deletes and two cases that pin "by what is left" (section 6); and the 16
`apps/server` suites that make or read corrections (`git grep -ln
"correctInvoice\|invoice-corrections\|previewCorrectionAmounts\|openInvoiceCorrection" --
'apps/server/src/*.test.ts'`, plus `corrections-report.test.ts`), `env -u CLAUDECODE -u AI_AGENT
pnpm exec vitest run <the 16 files> --reporter=json`: **686 tests, 686 passed**. Applying the rule
to ticked dishes changed no existing assertion in either run.

### 4.2 D2: A445 — which tickets, and what is shared

**Default: free items only, and only when the meal's lines with a menu price or a gross above zero
carry two or more VAT rates on the issue day.** That is what answer 1.10 covers ("A free item given
with a paid sale … When the items carry different VAT rates"). A partial discount on one dish, with no free item on the ticket, stays on
that dish's own rate, as today; the adviser's line (section 4.7) says so and asks.

`shareFreeItems(gross: GrossLines, on: string): GrossLines`, new in `packages/menu/src/pricing.ts`:

1. If any line has an empty rate list, return `gross` unchanged (`rateLines` then refuses it as
   today, `pricing.ts:223`).
2. Take the rate on `on` of each line with a menu price or gross above 0 with `rateOn`, as
   `rateLines` does (`:224`). If fewer than two rates, or no line is free (gross 0, `listGross`
   above 0), return `gross` unchanged.
3. Weights: `listGross` where set, else `lineGross`. Shares: `shareByWeight(gross.total, weights)`.
4. Each line whose share differs from its gross gets `lineGross` = its share and, where it had none,
   `listGross` = its old gross and `listUnitPriceGross` = its old `grossUnitPrice`, so the filed line
   still records the price it was sold at. `grossUnitPrice`, `total` and every other field stay.
   So the filed net unit price is still worked out from the price as sold (`rateLines`,
   `pricing.ts:235`): the salad files a unit price of €9.62 beside a line base of €8.01, and the water
   €0.00 beside €1.38. The AEAT record carries no unit price, but anything that multiplies unit price
   by quantity sees the price as sold. (D3b's "Discount −1.61" comes from the kept list price
   instead: `beforeVatFigures` subtracts the filed base from the list price's base,
   `apps/server/src/receipt-figures.ts:39-48`.)

Wiring (three small server edits):

- `issuancePass` (`issuance-pass.ts:51-64`) adds each line's `listGross` from its identity's
  `listUnitGross`, through `listGrossOf` (`receipt-lines.ts:104-118`, exported). `GrossLine`
  already carries an optional `listGross` (from `RecordSaleLine`, `packages/core/src/sale-line.ts:52`).
- `issueMoment` (`issue-moment.ts:46`) rates `shareFreeItems(gross, earlier ?? issueDay)` instead of
  `gross`, on the same date `rateLines` uses (`:45-46`). It
  still returns the unshared `gross` (`:54`), which the settle receipt prints from
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
(1.36, 0.28). It decides filed VAT, so it is the owner's; question 14 asks the adviser too. The
watcher took the default on 23 November 14:17 as covered by the owner's O1 words ("its the
proportions which matter", `questions.md:1399`); those words were about O1, so this is the
watcher's reading, put back to the watcher on 23 November for the owner's own word.

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
| Cancel and refund after payment | each dish's filed gross (`byPosition`, `apps/server/src/cancellation-refund-value.ts:89-117`, then `cancelRefundShare`) | each dish's value stays its filed share (salad €8.33, water €1.67); **O4 (owner): the free item comes back with the last paid dish**, so returning both hands back €10.00 in one refund, and a free item is never refunded alone (section 4.3.1) | read; Task 3 pins the values through the real `rowRefundValue`, Task 3b the pairing through the real `cancelItem`. Not the dish's price as sold: that would refund more than the filed line holds, which A758 §3.8's planned corrective of a cancelled dish could not file (`docs/backlog/fiscal.md:942-947`) |

No guide sentence changes for A445's filing: it changes nothing staff do (CLAUDE.md §3, "A guide
sentence earns its place by changing what staff do"). O4 does change what staff do; its guide
sentences are in section 4.7.

#### 4.3.1 O4: a dish given free comes back with the last paid dish

The owner: "they would have to return both, and get the 10€ back" (section 0). Each dish keeps its
filed share as its Cancel and refund value, so every cancel's refund stays within its own filed
line, as A758 §3.8's planned corrective of a cancelled dish needs; what changes is which dishes must
come back together.

**Words.** On a settled bill whose sale has a filed record:

- a **free item holding a share** is a dish line (no parent line) charged €0 with a menu price above
  €0 — the Given free sheet's test (`free-items.ts:137-139`) — whose filed value
  (`byPosition` or `byPortion`, `cancellation-refund-value.ts:89-152`) is above €0. Only a ticket
  A445 shared has one: before it, such a line files €0 (section 3, finding section 1);
- a **paid dish** is any other dish line whose filed value is above €0;
- the **last paid dish** is a cancel with Refund ticked after which no paid dish of the bill has a
  portion that is not cancelled. A served portion counts as not cancelled: after payment only
  unserved portions can be cancelled (`availableOf`, `apps/server/src/line-cancel.ts:210-213`).

**The rule for several paid dishes and one free item: the free item goes with the last paid dish.**
While the guest keeps any paid dish, the free item stays theirs and its share stays on the ticket;
when the last paid dish comes back, the free item comes back with it. So the money handed back never
exceeds what was paid, and is all of it once everything has come back. Example: salad €10.00 and
soup €6.00 at 4%, water €2.00 at 21% given free, €16.00 paid; the filed shares by menu price are
8.89, 5.33 and 1.78 (`shareByWeight(16.00, [10, 6, 2])`: 8.888, 5.333, 1.777 round down to 8.88,
5.33, 1.77, and the two cents left over go to the largest remainders, the salad's and the water's;
the O1 prototype printed the same through that rounding). Returning the salad first hands back
€8.89; returning the soup after it, with the water, hands back €5.33 + €1.78 = €7.11; €16.00 in all.
With one paid dish, the owner's case, the salad is the last paid dish and returning it with the
water hands back €8.33 + €1.67 = €10.00.

**Server** (`cancelItem`'s keep-the-charge branch, `line-cancel.ts:372-540`, only when the refund
handoff stands, `:408`, and the sale has a free item holding a share; a new reader beside
`refundValues`, `cancellation-refund-value.ts:40-87`, which already reads the bill's stored lines and
the sale's filed lines at `:46-55`, answers which lines are free items holding a share, which are
paid dishes, and what each has left to cancel):

1. A free item's own cancel with Refund ticked is refused `tab.free_item_with_dish` (new code,
   beside `tab.cancel_context_changed`, `apps/server/src/errors.ts:1087`; 409 beside it,
   `apps/server/src/till-api.ts:631`), reason `free_item`. Cancelling it without Refund stays
   allowed: no money moves, and its share then stays on the ticket.
2. The last paid dish's cancel with Refund ticked takes with it every free item holding a share that
   still has a portion not cancelled. The request lists them in a new optional `withFree` (line ids)
   on `CancelItemAsk` (`line-cancel.ts:64-82`); a list that differs from the server's is refused,
   reason `not_listed`, and a free item with a served portion is refused, reason `served` (it cannot
   come back, so Cancel and refund does not apply; the message says to untick Refund and give the
   money back with Correct invoice). Otherwise the server cancels each listed free item in the same
   command: their lines join `taken`, so `serviceCancellationFamilies` (`:389`),
   `dishKitchenItems` (`:388`), `enqueueServiceCancellation` (`:482`) and
   `writeServiceCancellations` (`:525`) cover them; each gets its own cancel record through
   `recordAdjustment` (`:439`) with its own filed share as refund value
   (`cancellationRefundValue`, `:418`), and its own entry in the answer's `refundLinks` (`:538`, one
   entry today).
3. Every other cancel is as today.

**Consent.** The cancellation read (`apps/server/src/line-cancel-api.ts:150-193`) answers
`withFree: { lineId, name, quantity, refundAmount }[]` when the dish would be the last paid dish if
all of its cancellable portions were cancelled, and `givenFree: true` for a free item holding a
share, so the till can show both before anything is sent.

**Finish table** (`apps/server/src/finish-party-service.ts:124-207`). Every unserved dish of a
finished bill is in its request (`:154-169` refuses one that leaves a dish out), so a last paid dish
and its unserved free items are always cancelled together; only the Refund ticks can disagree. The
pairing is checked over the whole request before the loop at `:171`: a free item's tick is refused
(reason `free_item`) unless the same request cancels its ticket's last paid dish with Refund ticked,
and then each of the ticket's free items must be ticked (reason `not_listed`) and none may have a
served portion (reason `served`, as for one dish's cancel: Finish writes nothing). The loop then
cancels free items after paid dishes and tells `cancelItem` the pairing was checked over the
request. Finish is deliberately stricter than cancelling one dish at a time when a paid dish is
left unticked: one at a time, that dish could be cancelled without Refund and the water would then
come back with the last one, but Finish refuses the water's tick (`free_item`); staff void the
unticked dish first, or untick the water. The difference is deliberate: it errs towards handing
back less.

**Till.**

- The Cancel item window (`apps/till/src/widgets/cancel-item-dialog.ts`): when the consent carries
  `withFree`, Refund is ticked and the quantity takes every cancellable portion, it lists them
  under the tick (en "Comes back with it, given free: {dishes}" / es "Vuelve con él, por
  invitación: {dishes}", in `apps/till/src/i18n/strings.ts` beside `cancel_item.title`, `:90`, and
  its Spanish twin, `:2418`), adds their values to the amount (`#refundAmount`, `:218`), and sends
  their ids as `withFree`. For a `givenFree` dish it offers no Refund tick (`#canRefund`, `:203`) —
  exactly what a comped dish already gets on any ticket filed before A445, whose value is €0.
- `#cancelRefundFill` (`apps/till/src/till-app.ts:17388`): the refund window's amount adds the free
  items' values, and `cancellationIds` takes every link of the answer, not only the dish's
  (`:17402`).
- `tab.free_item_with_dish` reason `not_listed` re-reads the consent as `tab.cancel_context_changed`
  does (`:17419`), so the window then lists the free items.
- The Finish table window (refund amounts built per dish at `till-app.ts:20520-20575`): a free item
  has no tick of its own; it is ticked, and its value counted, exactly when every paid dish of its
  receipt in the list is ticked and the consent of its ticket's paid dishes names it in `withFree`.
- Messages (`apps/till/src/i18n/codes.ts`, a table by reason beside `CORRECTION_NOT_ADMITTED`,
  `:1051`, read in `codeMessage` as at `:1179-1184`):

| Reason | en | es |
| --- | --- | --- |
| `free_item` | This dish was given free, so it gives money back only together with the last paid dish on the bill. Untick Refund to cancel it on its own, or choose Void… on the last paid dish: its window brings this dish back with it. | Este plato fue por invitación, así que solo devuelve dinero junto con el último plato pagado de la cuenta. Desmarca Devolución para cancelarlo solo, o elige Cancelar… en el último plato pagado: su ventana lo devuelve con él. |
| `served` | A dish given free with this one has been served, so it cannot come back with it. Untick Refund to cancel this dish, then give the money back with Correct invoice on the receipt. | Un plato por invitación que iba con este ya se ha servido, así que no puede volver con él. Desmarca Devolución para cancelar este plato y después devuelve el dinero con Rectificar factura en el recibo. |
| `not_listed` | A dish given free comes back with this one. The window now lists it: check the amount and choose again. | Un plato por invitación vuelve con este. La ventana ya lo muestra: revisa el importe y vuelve a elegir. |

The words **Void…** / **Cancelar…**, **Refund** / **Devolución** and **Correct invoice** /
**Rectificar factura** are the till's and the guide's own (en guide `:292-311`, es guide
`:309-328`; `strings.ts:172`, `:2503`).

**Smaller alternative not taken:** keep each dish's value and add the free items' shares to the
last paid dish's value, cancelling nothing else. It needs no new request field, but it hands back
€10.00 while the guest keeps the free item, against "they would have to return both", and puts more
on one cancel than its filed line holds.



### 4.4 D4: what is already filed or stored

Nothing already filed changes; records are immutable. The rule applies to tickets issued after the
change lands. No schema change (every column used exists), no migration, no venue reset. A
correction of a ticket filed before the change follows that ticket's filed figures: its free line
filed at €0 has nothing left, so O1's cap gives it no share (the O1 prototype skips a line with
nothing left before sharing). Nor does O4 touch such a ticket: its free line's filed value is €0, so
it is not a free item holding a share (section 4.3.1).

### 4.5 Goodwill choice 2: no dishes ticked shares the amount; the till drops its one-rate lock

**Server.** Delete the refusal at `correction-allocation.ts:61-66` (keep the `else` branch's
checks), and `"required"` from `refuseScope`'s parameter (`:58`) and from the reason type of
`sale.correction_scope_invalid` (`packages/core/src/errors.ts:14`). With no dishes, every remaining
dish takes a share by O1's rule (section 4.1), which ticked dishes take too.
Consumers traced: HTTP status (`apps/server/src/invoice-correction-api.ts:56`, unchanged), the
till's field placement by code (`invoice-correction-dialog.ts:617`), the till message
(`apps/till/src/i18n/codes.ts:528-531`). Nothing branches on the `required` reason
(`git grep -n '"required"' -- packages/core/src apps/till/src/widgets apps/server/src/invoice-correction*`
finds only the test row and the type).

Run on the prototype (refusal removed): €1.00 with no dishes on the comped ticket previews 4%: 0.80 /
0.03 and 21%: 0.14 / 0.03; the sheet's example (wine €12.00 at 21%, cheese €8.00 at 4%, €5.00
back) gives −3.00 at 21% (−2.48 / −0.52) and −2.00 at 4% (−1.92 / −0.08), through
`allocateCorrectionAmounts` itself. The O1 prototype printed the same two (section 4.1).

**Till.** Delete the clause `(picked !== undefined && picked.rate !== line.rate)`
(`invoice-correction-dialog.ts:595`) and the now-unused `picked` (`:577`). The message for
`sale.correction_scope_invalid`, now reached only when the dish list no longer matches the invoice:

| | Text |
| --- | --- |
| en | The dishes chosen are not on this invoice. Close this window and choose Correct invoice again. |
| es | Los platos elegidos no están en esta factura. Cierra esta ventana y vuelve a elegir Rectificar factura. |

**O6 (owner, 2026-11-23 14:18, "Add it"): Correct invoice offers every reason.** A venue's reasons
are of two kinds, Void and Comp (`REASON_KINDS`, `packages/shared/src/adjustment-policy-types.ts:3`);
the starter **Complaint** is a Comp reason (`packages/adjustments/src/provisioning.ts:56`).

- **Server:** delete the refusal `if (reason.kind !== "void") throw new
  AppError("adjustment.action_not_allowed", {})` (`apps/server/src/invoice-corrections.ts:236`).
  With two kinds, nothing is left for it to refuse. The note rule beside it (`:237`) stays.
  Correct invoice reads only a reason's name and note rule; a Comp reason's amount and percentage
  limits (`maxAmount`, `maxPercent`) are not applied to it, as no limit is applied to a Void reason
  today. `adjustment.action_not_allowed` keeps its other raisers (for example `line-cancel.ts:380`),
  so `scripts/errors-reachable.test.ts` still passes.
- **Till:** the shared picker offers only reasons whose actions include `cancel`
  (`voidReasons`, `apps/till/src/widgets/reason-picker.ts:10-12`, applied inside `reasonPicker` at
  `:29`), and Refund a payment and the bill refund use it too
  (`tender-refund-dialog.ts:145`, `:148`, `:399`; `bill-refund-dialog.ts:259`, `:407`). So
  `reasonPicker` gains an optional `every` flag that offers every reason, Correct invoice passes it
  (`invoice-correction-dialog.ts:657`), and its two lookups, `#reason` (`:361`) and the reason it
  hands to the card step (`:775-778`), read every reason instead of `voidReasons`. The card step
  opens the Refund a payment window with `correcting` set (`tender-refund-dialog.ts:111`) and that
  reason to start on (`till-app.ts:9972`, `:10019`); in that mode the window passes `every` too, and
  its `#reason` and `#startReason` (`:144-151`) read every reason, or a correction opened with
  **Complaint** would start its card step with no reason chosen. (The server takes a correction
  leg's reason from the correction, `tender-refund-reservation.ts:360`.) Otherwise Refund a payment
  and the bill refund are unchanged.

### 4.6 O7 and O8 (D5 and D5c until the re-read): Goodwill choice 1 — Refund a payment refuses only what Correct invoice would take now

**The rule, stated once (default):** Refund a payment, when it names no correction and returns some
payment money, may give back without a corrective only

- what the cancelled dishes it pays for still owe, plus
- the payment money Correct invoice could **not** give back on this sale right now.

Above that it is refused `tender.refund_needs_correction`. So wherever Correct invoice refuses for
good, Refund a payment stays open; where Correct invoice only has to wait (step 3's passing
refusals), Refund a payment waits too; wherever Correct invoice would take the money, Refund a
payment sends staff to it. It replaces the 19 November plan's list of exemptions
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
   cancel of another order, `:60-78`). **D5c, now owner question O8 (it caps the money handed
   back):** if it names none, every cancel of
   the sale's order with the Refund tick and money still owed counts as named, in the order
   `readCancelsForRefund` gives (`refund-links.ts:75`), and the refund is linked to them as the
   first window's is. That keeps the guide's second window for the rest of a cancelled dish
   (`apps/server/src/guide/en/table-service.md:364-371`) working, now bounded; the PIN rule for a
   window that names no dishes stays as today (coverage is computed only when the request named
   them). The alternative is a till change so the second window carries the cancels' ids.
3. **What Correct invoice could take now:** the sum of what is left of each line of the invoice,
   capped by the payment money left on it, read through Correct invoice's own checks
   (`checkInvoiceCorrectable` and `readCorrectableLines`, `apps/server/src/invoice-corrections.ts:139-182`),
   exported as a new `correctableNow` beside them. **O7, for the owner** (D5 until the re-read's
   I-4), decides which of its refusals leave Refund a payment open; the default:
   - **lasting**, so the amount is 0 and Refund a payment stays open: `invoice_correction.not_settled`
     (`:151`), `advance.taken_off_final_invoice`, `invoice_correction.chain_unsound` (`:163`),
     `sale.correction_history_unusable`, `sale.correction_unsupported` (a full invoice naming a
     customer, `packages/core/src/correction-eligibility.ts:5-9`), and `sale.correction_not_admitted`
     for every reason but one: `replaced` (a full invoice replaced the ticket), `missing` (no filing
     record), `wrong_node` (filed by another box: every ticket from before a box switch), `voided`,
     `not_simplified`, `unsupported`, `filing_versions_unusable` and the two filed-figures reasons
     (`packages/fiscal-verifactu/src/correction-admission.ts:45-63`;
     `packages/core/src/correction-history.ts:108-115`, `:178`, `:195`). Three of these are choices:
     - `not_settled` (a ticket not fully paid) stays lasting because such a ticket may never be
       fully paid, and Correct invoice refuses it too (A802's admission table: "unsettled/part-paid
       bill … Unavailable", spec `:350`), so waiting would leave the money with no way back.
     - `voided` stays lasting although the till does not suggest Refund a payment for it
       (`NOT_ADMITTED_NO_REFUND`, `invoice-correction-dialog.ts:101`): Correct invoice never takes a
       cancelled invoice, so refusing would leave its money with no way back.
     - `filing_versions_unusable` stays lasting, as the till treats it (it is not in
       `NOT_ADMITTED_NO_REFUND`, so the till adds "Refund a payment still gives money back",
       `:95-101`, `:385-389`): two unfixed versions of one sale do not resolve on their own.
   - **passing**, re-thrown so the plain refund waits as Correct invoice does:
     - `sale.correction_not_admitted` reason `filing_refused`: the original filing is anything but
       queued, sending or accepted (refused, stopped or held, `correction-admission.ts:10-15`, `:63`).
       The till already treats it as "wait", not "use Refund a payment"
       (`invoice-correction-dialog.ts:101`, used at `:385-389`), its message says "Try again once it
       has been sent again" (`apps/till/src/i18n/codes.ts:1077-1080`), and the owner-approved A802
       policy 3 has Correct invoice wait on "refused/stopped/held" (archive `:6489`; spec `:347`).
       Counted lasting, a held filing would open the plain refund, the money would go back with no
       corrective, and once the filing is fixed and accepted the invoice would declare the full price
       for good (the re-read's I-1).
     - `invoice_correction.refund_pending` (`:157`; its till message already says "Check it under
       Refund a payment, then try again", `apps/till/src/i18n/codes.ts:512-514`).
     - the clock refusals of `backend.refuseUntilRecordable` (`:164`), which a new plain refund
       already meets after reserving (`carryNewTenderRefund`, `apps/server/src/tender-refund-completion.ts:40`).
     An open correction is refused earlier, by `refuseWhileCorrectionOpen` (`tender-refund-reservation.ts:239`).
   - **Order:** `correctableNow` reads the invoice's admission and lines (`readCorrectableLines`)
     **before** the pending-refund check, then the chain, then the clock. `checkInvoiceCorrectable`
     checks a pending refund before reading the lines (`invoice-corrections.ts:153-160`); reused in
     that order, a plain refund on a ticket Correct invoice can never take would wait for another
     payment's pending refund, where today it is served. Run 4 measured it: in that order 5 group A
     cases answered `invoice_correction.refund_pending`; lines first, they pass (section 6).
   - **Cost:** the chain check (`backend.checkIntegrity`, `verifyChain` over the node's records,
     `packages/fiscal-verifactu/src/backend.ts:788-790`) runs after the lines and the pending check,
     and only when the refund would otherwise be refused, so an allowed plain refund never pays for it; a refused one pays what
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
and its return files nothing. The owner answered "Yes" on 23 November 14:17 (`questions.md:1398`).
The alternative was to keep the rule and say in the message, the guide and the adviser's list that a
tip comes back only after Correct invoice.

Where the rule came from: the tender rule with A737 Part 2 (a05ad041d7, #1817), the bill rule earlier
with B14 (#721, ca5aa51dd4, 2026-09-27), whose commit says only "a tip only with the whole payment, as
for cash" (`git log --all --oneline -S"tip comes back only with the whole"` finds #721 and #2919; the
split-bill design deleted in be4e98ce7c mentions a tip on one line and never with "refund": `git show
be4e98ce7c^:docs/superpowers/specs/2026-08-17-table-service-ts5-split-bill-design.md | grep -i tip |
grep -ic refund` prints 0). No reason is recorded.

**How O2 is built** (the re-read's I-2: the server alone would not reach staff):

- **The till's form.** It refuses a tip with less than all the payment amount, a payment amount of
  0 included, before anything is sent (`apps/till/src/widgets/tender-refund-dialog.ts:265-272`,
  `tender_refund.tip_requires_all`, pinned by `tender-refund-dialog.test.ts:287-294`). The condition
  becomes "a tip above 0 with a payment amount that is neither 0 nor all of it", and the message
  (`apps/till/src/i18n/strings.ts:157`, Spanish `:2486`) becomes en "Return a tip on its own, or
  with all the remaining payment amount." / es "Devuelve una propina sola o junto con todo el importe
  restante del pago."
- **The server.** `refundAmountsFit` (`tender-refund-reservation.ts:149-151`) has a second caller:
  the refund of a payment on a bill with no invoice yet (`apps/server/src/bill-refunds.ts:240`,
  documented "its tip comes back only with the whole of what is left of it" at `:144-145`, pinned by
  `bill-payments-api.test.ts:4322-4366`). Bill refunds keep today's rule unchanged: no invoice exists
  there, so Correct invoice never takes that money and the old rule costs staff nothing. The tender
  refund (`tender-refund-reservation.ts:252`) gets its own rule beside it: a tip alone up to what is
  left of it, or the old rule.
- Picked over changing O2's default to what today's till allows (which costs no code) because that
  default would let a mistyped tip come back only by handing back the whole payment through Correct
  invoice; the till change is a few lines and one test.

**Code name.** `tender.refund_needs_correction`, beside its siblings `tender.refund_of_advance` and
`tender.refund_exceeds_cancelled` (`apps/server/src/errors.ts:980-984`); it names the concept, not the
package (CLAUDE.md §3). Status 409 beside them (`tender-refund-api.ts:141-142`).

**Till message** (`apps/till/src/i18n/codes.ts`, beside `tender.refund_exceeds_cancelled`, `:648`).
It says what happened and what each choice does (CLAUDE.md §3); Correct invoice asks for a PIN itself
when the person may not correct invoices.

| | Text |
| --- | --- |
| en | Correct invoice can give this money back, so Refund a payment cannot: it files nothing. Close this window and choose Correct invoice: it gives the money back and files a corrective invoice for it. Refund a payment still gives back a tip, or what is still owed for cancelled dishes. |
| es | Rectificar factura puede devolver este dinero, así que Devolver un pago no puede: no presenta nada. Cierra esta ventana y elige Rectificar factura: devuelve el dinero y presenta una factura rectificativa por él. Devolver un pago sigue devolviendo una propina o lo que falta por devolver de platos cancelados. |

It shows as the window's bottom message; a request refusal never disables the button (CLAUDE.md §3,
Forms). **D5b, the watcher's call:** no new line in the window; its existing "This returns money
only. The original invoice is unchanged." (`apps/till/src/i18n/strings.ts:148`, Spanish `:2477`,
shown at `tender-refund-dialog.ts:571-575`) stays true.

**What is left open.** A refund of cancelled dishes still files no corrective of its own (A758 §3.8,
`docs/backlog/fiscal.md:942-947`). Task 7's setups for groups B and D use a refund that names a
cancel and stays within what it owes, which this rule keeps allowed; when §3.8 lands, those refunds start filing a
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
2.48 and 0.52; 2.00 ÷ 1.04 = 1.923 → 1.92 and 0.08. The owner's example, €7.00 back on A €10.00
at 10% and B €4.00 at 21%: 7 × 10/14 = 5.00 and 7 × 4/14 = 2.00; 5.00 ÷ 1.10 = 4.545 → 4.55 and
0.45; 2.00 ÷ 1.21 = 1.653 → 1.65 and 0.35. The €3.00 case (salad menu €10.00 charged €5.00, water
€2.00): 3 × 10/12 = 2.50 and 3 × 2/12 = 0.50, the salad's 2.50 within the 5.00 left of it; 2.50 ÷
1.04 = 2.4038 → 2.40 and 0.10; 0.50 ÷ 1.21 = 0.4132 → 0.41 and 0.09. With the salad charged €1.00,
its 2.50 is more than the 1.00 left, so it takes 1.00 (0.96 and 0.04) and the water the other 2.00
(1.65 and 0.35). All three as the O1 prototype printed (section 4.1). With €1.00 off the bill as well:
€9.00 × 10/12 = 7.50 and × 2/12 = 1.50; 7.50 ÷ 1.04 = 7.2115 → 7.21 and 0.29; 1.50 ÷ 1.21 = 1.2397 →
1.24 and 0.26 (the prototype's run).

Part 1 (the text follows the owner's answers to O1–O4 and the defaults of O7, O8 and O9; Task 8
rewords it to whatever the owner decides on those three):

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
>   rows; the accountant's Given free sheet still lists the water at its menu price. On a full
>   invoice naming a customer for the same ticket, the salad's line shows its menu price less a
>   discount of €1.61 and the water's less "On the house" of €0.27, though only the water was given
>   free. *Have we done this right? Should a discount on one item also be shared when nothing is
>   free? Is the full invoice's discount line under the salad acceptable?*
> - **Money given back as goodwill** (question 6). Wherever Waitron can correct the ticket, it now
>   gives such money back only through a corrective invoice. A refund with no corrective is kept for
>   a tip, for money still owed on items cancelled after payment, for a part payment as in question
>   13, and for a ticket Waitron cannot correct: one filed by another Waitron box (every ticket from
>   before a switch to another box), one replaced by a full invoice, one with no filing record, one
>   cancelled with the tax agency, one not yet fully paid, a full invoice naming a customer, and one
>   whose records need checking. While the tax agency has refused a ticket's filing and it is being
>   fixed, neither way gives money back until the filing is accepted. Money given back is shared
>   across the items in proportion to their menu prices, and no item gives back more than is left
>   of it on the ticket: where an earlier discount or correction left an item less than its share,
>   it takes what is left and the rest is shared over the others in the same proportions. For
>   example, items of €10.00 (10%) and €4.00 (21%) and €7.00 given back file −€5.00 at 10% (base
>   −€4.55, VAT −€0.45) and −€2.00 at 21% (base −€1.65, VAT −€0.35). A salad at €10.00 (4%) sold at
>   €5.00 and a water at €2.00 (21%), €3.00 given back, file −€2.50 at 4% (base −€2.40, VAT −€0.10)
>   and −€0.50 at 21% (base −€0.41, VAT −€0.09); had the salad been sold at €1.00, it would give back
>   only that €1.00 (base −€0.96, VAT −€0.04) and the water −€2.00 (base −€1.65, VAT −€0.35). The
>   €5.00 of question 6's own example files −€3.00 at 21% (base −€2.48, VAT −€0.52) and −€2.00 at 4%
>   (base −€1.92, VAT −€0.08). *Have we done this right?*

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
>   invitaciones para el gestor sigue mostrando el agua a su precio de carta. En una factura completa
>   a nombre de un cliente para el mismo tique, la línea de la ensalada muestra su precio de carta
>   menos un descuento de 1,61 € y la del agua menos una invitación de 0,27 €, aunque solo el agua
>   fue gratis. *¿Lo hemos hecho bien? ¿Debería repartirse también un descuento en un producto cuando
>   nada es gratuito? ¿Es aceptable la línea de descuento bajo la ensalada en la factura completa?*
> - **Una devolución de cortesía** (pregunta 6). Siempre que Waitron puede rectificar el tique, ese
>   dinero se devuelve solo mediante una factura rectificativa. La devolución sin rectificativa queda
>   para una propina, el dinero pendiente de productos cancelados después del pago, un pago a cuenta
>   como el de la pregunta 13 y un tique que Waitron no puede rectificar: uno presentado por otro
>   servidor de Waitron (todos los tiques de antes de pasar a otro servidor), uno sustituido
>   por una factura completa, uno sin registro presentado, uno anulado ante la Agencia Tributaria, uno
>   aún no pagado del todo, una factura completa a nombre de un cliente y uno cuyos registros hay que
>   revisar. Mientras la Agencia Tributaria ha rechazado la presentación de un tique y se está
>   corrigiendo, ninguna de las dos vías devuelve dinero hasta que se acepte. El dinero devuelto se
>   reparte entre los productos en proporción a sus precios de carta, y ningún producto devuelve más
>   de lo que le queda en el tique: si un descuento o una rectificación anterior le dejó menos que su
>   parte, devuelve lo que le queda y el resto se reparte entre los demás en las mismas proporciones.
>   Por ejemplo, productos de 10,00 € (10 %) y 4,00 € (21 %) con 7,00 € devueltos presentan −5,00 € al
>   10 % (base −4,55 €, cuota −0,45 €) y −2,00 € al 21 % (base −1,65 €, cuota −0,35 €). Una ensalada de
>   10,00 € (4 %) vendida a 5,00 € y un agua de 2,00 € (21 %), con 3,00 € devueltos, presentan −2,50 €
>   al 4 % (base −2,40 €, cuota −0,10 €) y −0,50 € al 21 % (base −0,41 €, cuota −0,09 €); si la ensalada
>   se hubiera vendido a 1,00 €, devolvería solo ese 1,00 € (base −0,96 €, cuota −0,04 €) y el agua
>   −2,00 € (base −1,65 €, cuota −0,35 €). Los 5,00 € del propio ejemplo de la pregunta 6 presentan
>   −3,00 € al 21 % (base −2,48 €, cuota −0,52 €) y −2,00 € al 4 % (base −1,92 €, cuota −0,08 €).
>   *¿Lo hemos hecho bien?*

The repository copy only; the shared Google Doc is copied by the desk, as the sheet's other
additions say. The full-invoice figures (€1.61, €0.27) are read, not rendered (D3b); Task 8 copies
them, and the line labels, from the page Task 4 renders.

**Guides** (`apps/server/src/guide/en/table-service.md`, `apps/server/src/guide/es/table-service.md`;
no `{#id}` changes). The words follow O2's answer ("Yes") and O7's default.

- `{#refund-receipt}` (en `:338`, es `:357`): a new second paragraph. en: "Refund a payment gives
  money back without correcting the invoice, so it refuses money **Correct invoice** can give back,
  such as for a complaint: use Correct invoice for that. It still gives back a tip, what is still
  owed for dishes cancelled with **Cancel and refund** or **Finish table**, a part payment as below,
  and money on an invoice Correct invoice cannot correct. While the tax agency has refused the
  invoice's filing, neither gives money back: try again once it has been sent again." es: "Devolver
  un pago devuelve dinero sin rectificar la factura, así que rechaza el dinero que **Rectificar
  factura** puede devolver, como por una queja: usa Rectificar factura para eso. Sigue devolviendo
  una propina, lo que falta por devolver de platos cancelados con **Cancelar y devolver** o **Cerrar
  mesa**, un pago parcial como el de abajo y el dinero de una factura que Rectificar factura no puede
  rectificar. Mientras la Agencia Tributaria haya rechazado la presentación de la factura, ninguno de
  los dos devuelve dinero: vuelve a intentarlo cuando se haya enviado de nuevo."
- The same section's "If you raise the amount or add a tip, you need refund permission or a fresh
  approval PIN." (en `:357-358`; es `:376-377`, "Si subes el importe o añades propina, necesitas
  permiso para devolver o una nueva aprobación con PIN.") becomes untrue on a receipt Correct invoice
  can correct: above what the cancels owe, section 4.6 refuses everyone, PIN or not (the re-read's
  I-3). Replace it with en "To give back more than the cancelled dishes' remaining value, use
  **Correct invoice**. Where it cannot correct the receipt, raising the amount needs refund permission
  or a fresh approval PIN, and adding a tip always does." / es "Para devolver más que el valor
  pendiente de los platos cancelados, usa **Rectificar factura**. Si no puede rectificar el recibo,
  subir el importe necesita permiso para devolver o una nueva aprobación con PIN, y añadir propina
  siempre lo necesita." The next sentence ("The refund still counts against the cancelled dishes, up
  to their value.") stays. "Adding a tip always does": a refund with a tip is never covered by the
  cancels (`tender-refund-reservation.ts:331-332`, `tipAmount === 0`).
- The same section's "If you cannot give refunds, it asks for the PIN, and the dishes' entries in the
  report do not show that part" (en `:369-370`, and its Spanish twin at es `:389-390`, "Si no puedes hacer
  devoluciones, pide el PIN, y las entradas de esos platos en el informe no muestran esa parte")
  loses its second half: with O8, that part now counts against the dishes.
- `{#correct-invoice}` (en `:379-388`, es `:400-409`): first sentence becomes "When a paid bill
  charged too much, or you give money back for a complaint, correct its invoice: …" / "Cuando a una
  cuenta pagada se le cobró de más, o devuelves dinero por una queja, rectifica su factura: …"; the
  second paragraph's "Choose a **Reason**" gains ", such as **Complaint**" / "Elige un **Motivo**"
  gains ", como **Queja**" (the starter reason's names, `packages/adjustments/src/provisioning.ts:56`,
  `starter-content.ts:36`), true once Task 5 offers every reason (O6; the re-read's M-1); the
  second paragraph's "otherwise leave them all unticked" gains ", and it is shared across every
  dish by menu price" / ", y se reparte entre todos los platos según su precio de carta".
- `{#cancel-paid-dish}` (en `:292-311`, es `:309-328`), after the paragraph on the **Refund** tick:
  en "A dish given free comes back with the last paid dish on the bill: that dish's window lists it,
  and the amount includes it. Cancelled on its own, a dish given free gives no money back." / es "Un
  plato por invitación vuelve con el último plato pagado de la cuenta: la ventana de ese plato lo
  muestra y el importe lo incluye. Cancelado solo, un plato por invitación no devuelve dinero." And
  in `{#finish-paid-table}` (en `:312-337`, es `:329-356`), after "Tick **Refund** beside each
  dish…": en "A dish given free has no tick of its own: its money comes back with the bill's paid
  dishes when you tick them all." / es "Un plato por invitación no tiene marca propia: su dinero
  vuelve con los platos pagados de la cuenta cuando los marcas todos." (O4; both change what staff
  do.)
- Nothing for A445's filing: it changes nothing staff do (CLAUDE.md §3, "A guide sentence earns its
  place by changing what staff do").

**Backlog.**

- Delete A445 from `docs/backlog.md:261-262` and its section `docs/backlog/fiscal.md:20-30`
  (finished entries are deleted). Its other links are historical (`2026-11-15-adviser-answers.md`)
  or plans (`2026-11-19-adviser-corrections-report.md:767`, the VAT-RATES plan); CLAUDE.md §6 says
  historical docs keep what was true.
- Add to `docs/backlog/fiscal.md` `## Decisions and deliberate limits` (`:1097`), each dated and
  marked owner or watcher as section 0 and section 10 record: the free-item rule and O3; the goodwill
  split, O1 and O9; choice 1's rule, O2, O7 and O8; O4; O6.
- Replace the goodwill bullet (`docs/backlog/fiscal.md:948-958`) and its sentence in
  `docs/backlog.md:371-372` with: goodwill goes through Correct invoice since this PR; Refund a
  payment refuses what Correct invoice would take; the adviser is asked (question 14). The
  cancelled-dish entry beside it (`docs/backlog/fiscal.md:942-947`) gains: "When this lands, the
  refund suites whose setups refund a named cancel (Task 7 of the goodwill plan) start filing
  correctives, so their counts of filed records change."

## 5. Fiscal boundary, and the checks every task runs

What changes in what is filed: the per-rate base and VAT of a takeaway ticket mixing rates with a
free item (A445), the corrective's split when no dishes are ticked on a two-rate ticket
(choice 2), and which dish lines a corrective's amount is shared over where a dish was discounted
or partly corrected before (O1, O9: by menu price, capped at what is left). `CuotaTotal` follows the breakdown, so the hash input changes for those tickets, but
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

**A445, choice 2, D3a, O1 and O6**

| File:line | Before | After | Decision | For the watcher |
| --- | --- | --- | --- | --- |
| `apps/server/src/full-comp.fiscal-identity.test.ts:288-327`, "files the full comps' sale with these figures" | takeaway bill, Burger comped, Bottle and Bread discounted to €0, Water €2.00 paid: 21% 1.65 / 0.35, 10% 0.00 / 0.00 (comment: "a zero row at 10%"), `cuota_total` 0.35, record hash `60A40E87…`, XML sha256 `b2e296be…` | run 2 received: 21% **1.57 / 0.32**, 10% **0.10 / 0.01**, `cuota_total` **0.33**, record hash `4951AAE8E3C6B41946208115DD7F26028DD0D25178FE54A526901E7428B3D57D`; the XML sha256 line is not reached after the first failure, so Task 3 takes its new value from a run. The comment becomes "Bread: its share of the price paid at 10%" | D2, O3 | **Controversial: a pinned filed record and its hash change.** By hand: €2.00 shared 12 : 30 : 2.50 : 2.00 is 0.52, 1.29, 0.11, 0.08 (the two cents left over go to Bread and Burger, the largest remainders); at 21% 0.52 + 1.29 + 0.08 = 1.89, bases 0.43 + 1.07 + 0.07 = 1.57; at 10% 0.11, base 0.10. The test's other case (the receipt's words never reach the record, `:275-286`) is unchanged and still passes |
| `packages/core/src/correction-allocation.test.ts:217` | `[undefined, "required"]`: no dishes on two rates refused | row deleted; new case: no dishes equals all dishes on `mixedRates()` (the figures already pinned at `:52-60`) | choice 2 | **Controversial: decides how a corrective's VAT is divided** |
| `apps/till/src/widgets/invoice-correction-dialog.test.ts:238-253` | after ticking `steak`, `rice` (other rate) is disabled | `rice` stays enabled; ticking both previews with both ids | choice 2 | no money |
| `invoice-correction-dialog.test.ts:358-361` | mocked refusal carries `reason: "required"` | `reason: "missing"`; the message is the new text | choice 2 | no money |
| `packages/core/src/correction-allocation.test.ts:96-109` "counts consumed allocation against line and rate capacity" | two €11.00 lines at 10%, €9.90 of the first corrected before, €2.20 back with no dishes: 0.20 and 2.00, by what is left | 1.10 and 1.10, by menu price (11 : 11), the first exactly at what is left of it; same rate, so the corrective's VAT row is unchanged (2.00 / 0.20) | O1 | **Controversial: changes which line a corrective names**; O1 prototype run (section 4.1) |
| `correction-allocation.test.ts:418-425` "weights remaining gross after an earlier return" | two €10.00 lines at 0%, €5.00 of the first corrected before, €3.00 back: 1.00 and 2.00 | 1.50 and 1.50; renamed "weighs menu price after an earlier return" | O1 | same rate, no VAT change |
| `apps/server/src/invoice-correction-api.test.ts:439-450` "refuses a reason that is not a Void reason, and one asking for a note without it" | a Comp reason answers 409 `adjustment.action_not_allowed` | a Comp reason (the starter **Complaint**) opens the correction (200); the note case is unchanged | O6 | no money |
| `apps/server/src/invoice-corrections.test.ts:898-911` "a reason that is not a Void reason, and opens with a Void reason" | the Comp reason is refused with nothing written | both open; renamed "opens with a Comp reason such as Complaint, and with a Void reason" | O6 | no money |

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

**Run 4 (this revision): why groups A and B fail.** Run 3 said each fails "only because it refunds
payment money that Correct invoice could take"; the re-read (I-5) doubted it, so I rebuilt the gate
in a throwaway worktree (`git worktree add --detach /tmp/ag-probe.0UJN/wt HEAD`, `pnpm install
--frozen-lockfile`, removed afterwards): section 4.6's gate in `reserveTenderRefund`, reading Correct
invoice's `readInvoiceCorrectionLines`, refusals sorted lasting or passing as section 4.6 now says
(`filing_refused` passing), with no O8 linking, no O2 and no replay change, and one log line per decision
(the test name, and the refusal or the amounts). `beginSettledTenderRefund` passed it `{ backend,
reading }`; direct callers passed nothing. Each run: `PROBE_LOG=<file> env -u CLAUDECODE -u AI_AGENT
pnpm exec vitest run <files> --reporter=json --outputFile=<file>` in `apps/server`.

- **Control,** the seven files of groups A and B on this branch unchanged: 486 tests, **486
  passed**. **Prototype:** 486 tests, **322 passed, 164 failed**, the same per-file counts as run 3.
- **Causes, from the log:**
  - `tender-refunds.test.ts` (93): "no such table: fake_fiscal_records". The suite builds a
    `FakeFiscalBackend` (`:134`) but never installs its tables, which `checkIntegrity` and
    `filedFiguresFor` read (`packages/fiscal/src/testing/fake-backend.ts:82`, `:275-279`, `:293-301`).
  - `tender-refund-reservation.test.ts` (36) and `tender-refund-authorization.test.ts` (11): they
    call `reserveTenderRefund` directly (`tender-refund-reservation.test.ts:179`, `:391`, `:732`;
    `tender-refund-authorization.test.ts:217`, `:567`) and pass no backend for the new argument.
  - Group B (24): the rule. 23 logged `tender.refund_needs_correction` on real sales with filed
    records (two after the `clock.unconfirmed` refusal they expect); one logged nothing under its name.
  - None of group A fails because of the rule: every group A sale is inserted by hand with
    `fiscalBackend: "none"`, `vatBreakdown: []` and no lines (`tender-refunds.test.ts:153-178`,
    `tender-refund-reservation.test.ts:92-105`, `tender-refund-authorization.test.ts:153-170`).
- **Group A with a truthful backend:** a `FakeFiscalBackend` answering `setCorrectionAdmission({
  eligible: false, reason: "missing" })` (`fake-backend.ts:341`), which is what the real backend
  answers for a sale with no record (`correction-admission.ts:48`), set in `tender-refunds.test.ts`
  and passed at the five direct calls: 197 tests, **192 passed, 5 failed**, all five
  `invoice_correction.refund_pending` from Correct invoice's check order. With the gate reading the
  lines before the pending check (section 4.6, "Order"): **197 passed**, and group B unchanged at 24
  (486 tests, 462 passed). No cancel added, so every permission assertion in group A runs as today
  (`grep -c not_permitted`: 7 in `tender-refund-authorization.test.ts`, 1 in `tender-refunds.test.ts`).
- **With `filing_refused` waiting** (I-1), on the five files run 3's log covered (named above as the
  four that turned green plus `invoice-correction-api.test.ts`; run 3 did not list them, but run 4's
  refusal counts there match its log within one: `missing` 72 against 71, `filing_refused` 13,
  `sale.correction_history_unusable` 3, `wrong_node` 1): 208 tests,
  **193 passed, 15 failed**: `fiscal-remedy.staff-refund.test.ts` 13 (all logged `filing_refused`:
  its setup refunds the whole sale after the tax agency rejected the filing: `cancelAndRefund` at
  `:129` after `rejectOriginal` at `:176`) and `invoice-correction-api.test.ts` 2 (group C's rows
  already). The suite then cancels
  the sale through `recordVoid`, which has no product caller (`git grep -n "recordVoid(" --
  'apps/server/src/*.ts' ':!*.test.ts'` finds only `testing/order-venue.ts:240`), so its order of
  refund then cancel is a test-built scenario, not a staff flow. Run 3 counted the suite as passing.

| Group | Files (failing tests in run 4) | Why |
| --- | --- | --- |
| A. Refund mechanics called directly or through the command, on hand-inserted sales with no record | `tender-refunds.test.ts` (93), `tender-refund-reservation.test.ts` (36), `tender-refund-authorization.test.ts` (11) | the fake backend's missing tables, and the missing backend argument; not the rule |
| B. Refund mechanics through the route, on real sales | `clock-unconfirmed-gate.test.ts` (12), `conflict-issuance.test.ts` (5), `till-device-proof.test.ts` (5), `clock-behind-stop.refunds.test.ts` (2) | the rule |
| C. Tests whose subject includes a plain refund or a refund naming cancels (run 3's count) | `tender-refund-links.test.ts` (7), `advance-corrections.test.ts` (3), `advance-final.test.ts` (1), `invoice-correction-alerts.test.ts` (2), `invoice-correction-api.test.ts` (2), `invoice-correction-cards.test.ts` (2), `invoice-corrections.test.ts` (2) | the rule |
| D. A refund after the tax agency refused the filing | `fiscal-remedy.staff-refund.test.ts` (13) | O7's default (`filing_refused` waits) |

Groups A, B and D (177 tests in 8 files) keep every assertion about the refund itself; only how the
suite builds its backend or its sale changes (Task 7). Group C (19 tests in 7 files) is rewritten in
Task 6, and its behaviour rows are for the watcher:

| Test | Before | After |
| --- | --- | --- |
| `advance-final.test.ts:511` "the €90 given back from the rest's invoice, then the €30 advance back in cash by Refund a payment" (#3993's own) | the €90 goes back by a plain refund of the table's ticket | the €90 goes back by Correct invoice on that ticket (as the till's `advance.taken_off_final_invoice` message already tells staff, `apps/till/src/i18n/codes.ts:664-667`); the €30 of the part payment stays a plain refund and still passes |
| `advance-corrections.test.ts:1172` "a plain refund of €20 of the settled €120 leaves €120 received …" | a plain €20 refund of the table's ticket | asserts `tender.refund_needs_correction` for the €20, and keeps the received figures for the €90 Correct invoice part |
| `advance-corrections.test.ts:850-874` `goodwill(…)` helper, reason "Goodwill" (two cases) | a plain refund used as goodwill | Correct invoice, which is now the goodwill route |
| `tender-refund-links.test.ts` "a second refund naming the same cancels links only what is left", "fresh approval permits excess amount or tip …", "does not cap a person who holds the refund permission", "refuses a second one over what the first left", "refuses a linked refund without new approval €0.01 above its cancels" | a refund naming cancels may give back more than they owe (a manager, or with an approval PIN); above it without permission, `tender.refund_exceeds_cancelled` | above what the named cancels owe (and what Correct invoice could not take), `tender.refund_needs_correction`, for everyone. `tender.refund_exceeds_cancelled` (raised only for a person without refund permission and no PIN, `tender-refund-reservation.ts:331-349`) keeps one use: on a receipt Correct invoice cannot correct, an amount above what the cancels owe; the till's PIN prompt for it (`apps/till/src/till-app.ts:9878-9883`) stays for that case |
| `tender-refund-links.test.ts` "a refund naming no cancels links nothing and fingerprints as before" | nothing linked | with O8, linked to the cancel still owed; the fingerprint part is unchanged |
| `invoice-corrections.test.ts:280-292` helper ("refuses an ordinary refund on a ticket with an unfinished correction, and allows it once the correction ends"; "… naming €7.00 after €3.00 of €10.00 went back") | an ordinary plain refund on a correctable ticket | the refusal while a correction is open is unchanged; the refund "allowed once the correction ends", and the €3.00 refund before Correct invoice, name a cancel within what it owes |
| `invoice-correction-api.test.ts` "answers invoice_correction.money_short with 409" and "answers invoice_correction.refund_pending with 409" | set up with a plain refund | the same setup through a cancel or a Correct invoice step; the 409 assertions are unchanged |
| `invoice-correction-alerts.test.ts` (2), `invoice-correction-cards.test.ts` (2) | set up with a plain refund | the same, through a named cancel |

O1 and O6 rows come from the O1 prototype run (section 4.1: 3 core cases, 0 of 686 in the 16
correction suites) and from reading the two O6 tests. O4 changes no existing assertion that I know
of: run 2 found none on a free item holding a share, which only exists once A445 lands; not run.
Also to be listed in the PR, not measured: the full-invoice A4 suites the `invoice-document.ts` half
of D3a can change, the till's suites, and any O4 or O6 assertion outside the files named here. Any other
assertion that has to change is listed in the PR with file:line, before and after.

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
new ones Tasks 1, 3 and 3b create. Each task is sized for one implementer well under 100 tool calls (estimates
given).

**Order.** VAT-RATES's remaining work (PR 3b and piece B's PR L) does not touch the code this plan
changes except `packages/menu/src/pricing.ts`, where PR L removes the label fallback
(`productRates`, `:263-266`) and this plan adds a new function; `shareFreeItems` reads each line's
rate list exactly as `rateLines` does, so it follows whatever list VAT-RATES supplies. This plan may
go first (say so in `progress.log`). VAT-RATES Task 3b.4 adds a sentence to A445
(`vat-rates-a.md:1226`); if this lands first, that sentence is dropped.

**Which tasks wait on which owner decision** (the re-read's M-10). O1–O6 are answered and written in;
O7, O8 and O9 are open (section 10).

| Task | Owner decisions | What depends on them |
| --- | --- | --- |
| 1 | none | — |
| 2 | O3 (answered, default kept) | only the "water comped, then €1.00 off the bill" case: what the discounted salad weighs |
| 3 | O3 (answered) | the €1.00-off case. The water-comped, eaten-here, counter-sale, close-of-day and Cancel-and-refund-value cases and the `full-comp` row depend on none (every discounted line there is free) |
| 3b, 3c | O4 (answered) | all of them: the free item comes back with the last paid dish |
| 4 | none | D3b is the watcher's |
| 5 | O1 and O6 (answered); O9 (open) | O1's cases; offering every reason (O6); the ticked-dishes case after a discount (O9's default). The no-dishes case on `mixedRates()` and the till's lock depend on none |
| 6 | O2 (answered), O7 and O8 (open) | the tip cases and the message's tip clause (O2); which refusals lift and which wait (O7); the unnamed-cancel cases (O8). The gate, the code and the status depend on none |
| 7 | O7 | group D exists only with O7's default; groups A and B depend on none |
| 8 | O1–O4, O6 (answered); O7, O8, O9 (open) | question 14, the guides and the backlog entries |

### Task 1: one allocation in `@waitron/shared` — about 25 calls

1. Tests first: `packages/shared/src/share-by-weight.test.ts` — shares by weight with the cent to
   the largest remainder (10.00 by 10:2 → 8.33, 1.67); a tie goes to the earlier weight; a zero
   total gives zeros, also when every weight is zero; weights adding up to zero with a total above
   zero are refused `shared.invalid_decimal`; a zero weight gets nothing. Run, watch it fail (no module).
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
   (`close-of-day.ts:101`) file the same split; after payment, the cancellation read
   (`line-cancel-api.ts:176-181`) values the salad at €8.33 and the water at €1.67, their filed
   shares (`cancellationRefundValue` and `rowRefundValue`), which section 4.3.1 keeps; which dishes
   must come back together is Task 3b's. Run, watch them fail.
2. Export `listGrossOf`; add `listGross` in `issuancePass`; call `shareFreeItems` in `issueMoment`.
3. Fix every other assertion section 6 lists for A445, changing expected figures only where the
   table says.
4. ```sh
   pnpm --filter @waitron/server exec vitest run src/free-item-share.test.ts src/issuance-pass.test.ts src/free-items.test.ts src/receipt-adjustments.test.ts src/full-comp.fiscal-identity.test.ts src/adjustments-apply.test.ts src/line-cancel.test.ts
   ```

### Task 3b: the free item comes back with the last paid dish, server — about 60 calls

Section 4.3.1. Tests first, in a new `apps/server/src/free-item-cancel.test.ts` on Task 3's setup
(a takeaway bill, `takeawayRates({Salad:"4.00", Soup:"4.00", Water:"21.00"})`, the water comped,
paid in cash, nothing served), cancelling through `cancelItemHttp`
(`apps/server/src/testing/cancel-line.ts:279`) with the Refund tick (`keep_charge`,
`refundHandoff`). Each refusal asserts the code, the reason and that no cancel record, service
cancellation or kitchen correction was written:

- **the owner's case:** salad €10.00 and the free water; the cancellation read for the salad answers
  `withFree` with the water and €1.67, and for the water `givenFree: true`; cancelling the salad with
  `withFree: [water]` cancels both lines, writes two cancel records with refund values €8.33 and
  €1.67 and answers both refund links; a Refund a payment naming both cancellation ids for €10.00
  is accepted through the real route;
- the salad alone (no `withFree`): `tab.free_item_with_dish` reason `not_listed`;
- the water alone with Refund: reason `free_item`; without Refund it is cancelled and no refund link
  is answered; the salad's later cancel then needs no `withFree` and hands back €8.33;
- the water marked served first: the salad's cancel with Refund, reason `served`;
- **several paid dishes:** salad €10.00, soup €6.00, free water; the salad alone hands back €8.89 with
  no `withFree`; the soup after it is the last paid dish: €5.33 and €1.78 with `withFree: [water]`;
- a served paid dish stays: salad served, the soup's cancel with Refund is not the last paid dish,
  so it is accepted without `withFree` and the water stays;
- part of the last paid dish (a row of two salads, cancelled through the row): one portion alone
  hands back €9.09 with no `withFree`; the other, with `withFree: [water]`, €9.09 and €1.82; a
  €20.00 refund naming all three is accepted;
- the water's cancel record and kitchen correction carry its own kitchen state, not the salad's;
- **unchanged:** a ticket eaten here with the water comped (one rate, so the water files €0 and holds
  no share): the salad's cancel with Refund needs no `withFree`, as today;
- **Finish table** (`apps/server/src/finish-party-service.test.ts`, on a takeaway table bill,
  `seatedTakeaway`, `apps/server/src/testing/advance-bills.ts:85-88`): salad ticked and water not,
  reason `not_listed`; water ticked and salad not, reason `free_item`; both ticked, accepted with
  both refund links; the water fully served, and one of two water lines served, each reason
  `served` with nothing written.

Run, watch them fail. Then the change: the reader beside `refundValues`, the three rules in
`cancelItem`, `withFree` on `CancelItemAsk` and its parsing (`apps/server/src/line-cancel-input.ts`),
the consent fields in `line-cancel-api.ts`, the request-wide check and the loop order in
`finish-party-service.ts`, the code in `errors.ts` and 409 in `till-api.ts`.

```sh
pnpm --filter @waitron/server exec vitest run src/free-item-cancel.test.ts src/free-item-share.test.ts src/line-cancel.test.ts src/line-cancel-api.test.ts src/line-cancel-context.test.ts src/finish-party-service.test.ts src/finish-party-collect.test.ts src/tender-refund-links.test.ts
pnpm exec vitest run scripts/errors-reachable.test.ts
```

### Task 3c: the free item comes back with the last paid dish, till — about 50 calls

Section 4.3.1, Till. Tests first:

- `apps/till/src/widgets/cancel-item-dialog.test.ts`: a consent with `withFree` lists the water under
  the Refund tick in English and Spanish, the amount reads €10.00 when the quantity takes every
  portion and the dish's own share otherwise, and `withFree` is sent only in the first case; a
  `givenFree` consent offers no Refund tick;
- `apps/till/src/api/line-cancel-client.test.ts`: `withFree` is sent and the consent fields are read;
- the refund window filled after the cancel (`till-app.ts:17388`): amount €10.00 and both
  cancellation ids; reason `not_listed` re-reads the consent and shows its message;
- `apps/till/src/widgets/finish-table-dialog.test.ts`: the water has no tick of its own, follows the
  bill's paid dishes, and its value is counted only when they are all ticked;
- `apps/till/src/i18n/codes.test.ts` and `strings.test.ts`: the three messages and the window line,
  English and Spanish.

Run, watch them fail; then the change. Check `memory_pressure | grep free` first (real Chromium).

```sh
pnpm --filter @waitron/till exec vitest run src/widgets/cancel-item-dialog.test.ts src/widgets/cancel-item-dialog.a11y.test.ts src/widgets/finish-table-dialog.test.ts src/widgets/finish-table-dialog.a11y.test.ts src/api/line-cancel-client.test.ts src/i18n/codes.test.ts src/i18n/strings.test.ts
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

### Task 5: Correct invoice shares an unticked amount by menu price, offers every reason; the till drops its lock — about 65 calls

1. Tests first:
   - `packages/core/src/correction-allocation.test.ts`: the test helper `line()` (`:16-22`) takes an
     optional menu price, defaulting to the line's gross. Delete the `[undefined, "required"]` row
     (`:217`); add "shares an amount with no dishes chosen across every rate, as choosing them all
     does" on `mixedRates()` (`{ gross: "2.00" }` equals `{ gross: "2.00", lineIds: ["wine",
     "dish"] }`), and the same equality on the discounted-salad history below (O9's default). Add
     O1's cases with section 4.1's printed figures: **the owner's example** (A menu €10.00 at 10%,
     B €4.00 at 21%, €7.00 back: A −5.00, base −4.55, VAT −0.45; B −2.00, −1.65, −0.35), its €1.00
     rounding case (A −0.71, B −0.29: the cent to the larger remainder), the discounted salad at
     €5.00 (salad −2.50, water −0.50) and at €1.00 (salad −1.00 capped, water −2.00), the salad with
     €8.00 corrected before (−2.00 capped, −1.00), and the three-line case that caps in two passes
     (−1.00, −2.00, −3.00). Change the two rows section 6 lists for O1 (`:96-109`, `:418-425`).
     Add: weights adding up to zero with money left are refused `shared.invalid_decimal`.
   - `packages/core/src/correction-history.test.ts`: the history read gives each line its filed
     `list_gross` as menu price where stored, its `line_gross` otherwise (the case at `:94` stores a
     `listGross` of 11.00).
   - `apps/server/src/invoice-corrections.test.ts`: "files a corrective split across both rates when
     no dishes are chosen": `soldForCash(["Rib steak", "Cold soup"], ["17.60"], "0.00", "takeaway")`
     (as at `:479`), open €8.80 with no `lineIds`, give the cash, file; the corrective's
     `vat_breakdown` is `[{10.00, −2.50, −0.25}, {21.00, −5.00, −1.05}]`, total −8.80, and
     `checkIntegrity` reports nothing. On Task 3's comped ticket, €1.00 with no dishes previews
     4%: 0.80 / 0.03, 21%: 0.14 / 0.03. **O1 through the real writers:** a takeaway ticket with the
     salad discounted to €5.00 by a line discount (`free-items.test.ts`'s `adjust` helper) and a
     water at €2.00, paid; €3.00 with no dishes files salad −2.50 and water −0.50 and
     `checkIntegrity` reports nothing. **O6:** the two rows section 6 lists, and a correction opened
     with the starter **Complaint** files with that reason's name on it.
   - `apps/till/src/widgets/invoice-correction-dialog.test.ts:238`: rename to "previews dishes
     picked at both VAT rates"; the dish at the other rate stays enabled and both ids are sent.
     `:358-361`: `reason: "missing"`, and the message is the new text. **O6:** with a Comp reason in
     `REASONS` (`:26-36` builds only Void ones), the picker offers it, choosing it sends its id, and
     the card step starts on it; `apps/till/src/widgets/tender-refund-dialog.test.ts`: opened with
     `correcting`, it starts on a Comp reason; opened without, it still offers only Void reasons.
     `apps/till/src/i18n/codes.test.ts`: the new English and Spanish text.
   Run, watch them fail.
2. The change:
   - choice 2: delete the refusal and `"required"` (section 4.5); delete the till clause and
     `picked`; replace the message;
   - O1: `CorrectionAmountLine` (`correction-allocation.ts:20-26`) gains `menu`, filled in
     `readHistory` (`correction-history.ts:257-263`) from `listGross ?? lineGross`; the call at
     `correction-allocation.ts:75-78` becomes a private capped loop over `shareByWeight` (section
     4.1): share by menu price over the lines with something left, give each line whose share is more
     than is left exactly what is left, and share the rest again over the others, until none is over.
     The base split at `:109-112` stays by each line's corrected gross;
   - O6: delete `invoice-corrections.ts:236`; `reasonPicker`'s `every` flag, passed by Correct
     invoice and by Refund a payment opened with `correcting`, and their lookups (section 4.5).
3. ```sh
   pnpm --filter @waitron/core exec vitest run src/correction-allocation.test.ts src/correction-history.test.ts
   pnpm --filter @waitron/server exec vitest run src/invoice-corrections.test.ts src/invoice-correction-api.test.ts src/invoice-correction-cards.test.ts src/advance-corrections.test.ts src/corrections-report.test.ts
   pnpm --filter @waitron/till exec vitest run src/widgets/invoice-correction-dialog.test.ts src/widgets/invoice-correction-dialog.a11y.test.ts src/widgets/tender-refund-dialog.test.ts src/widgets/cancel-item-reasons.test.ts src/i18n/codes.test.ts
   pnpm exec vitest run scripts/errors-reachable.test.ts
   ```

### Task 6: Refund a payment refuses only what Correct invoice would take — about 75 calls

1. Tests first, reusing `b95a643c19`'s cases where they fit (`git show b95a643c19 --
   apps/server/src/tender-refund-reservation.test.ts apps/server/src/tender-refund-api.test.ts
   apps/server/src/tender-refund-links.test.ts packages/adjustments/src/refund-links.test.ts
   apps/till/src/i18n/codes.test.ts`). Each refusal asserts the code and that no `refunds` row and
   no drawer job were written:
   - a plain €10 refund on a cash sale with no cancels: refused (409 through the route);
   - **the refusal lifts wherever Correct invoice refuses for good** (O7's lasting list), one case
     each: `invoice_correction.chain_unsound` (the existing `invoice-correction-api.test.ts:264` keeps
     its assertion that the plain refund succeeds), `sale.correction_unsupported` (a sale naming a
     customer), `sale.correction_not_admitted` with reasons `missing`, `wrong_node`, `replaced` and
     `voided`, `sale.correction_history_unusable`, `invoice_correction.not_settled`,
     `advance.taken_off_final_invoice` (where no fixture reaches a code, say so in the handover rather
     than inserting rows by hand);
   - **passing refusals stay:** with the original's filing rejected (`rechazado`, as
     `fiscal-remedy.staff-refund.test.ts:176-189` sets it), the plain refund answers
     `sale.correction_not_admitted` reason `filing_refused`; with another payment's refund pending on
     an admitted sale, it answers `invoice_correction.refund_pending`;
   - **order:** on a sale with no filing record and another payment's refund pending, the plain
     refund of this payment is accepted (run 4's five cases; in Correct invoice's own order it would
     wait);
   - after Correct invoice gave back part, a plain refund of more than the payment money left beyond
     what Correct invoice could still take: refused; of exactly that much: accepted;
   - **cancelled dishes:** naming a cancel that owes €6, €6 is accepted and €20 is refused (today
     `tender-refund-links.test.ts`'s "a second refund naming the same cancels" accepts €20 with €6
     linked — that assertion changes, a behaviour row in section 6); naming no cancel on a sale whose
     cancel owes €6, €6 is accepted and linked to it, €7 refused; a fully refunded cancel adds
     nothing;
   - **the PIN case that stays** (the re-read's I-3): a person without refund permission naming a
     cancel that owes €6 and asking €8, with no PIN, gets `tender.refund_exceeds_cancelled` on a sale
     naming a customer (Correct invoice cannot correct it) and `tender.refund_needs_correction` on a
     correctable sale;
   - **tips (O2):** a tip alone while payment money is left is accepted; a refund of all the payment
     money with its tip is refused where Correct invoice would take the money; a bill refund before
     the invoice still refuses a tip with part of the payment (`bill-payments-api.test.ts:4322-4366`,
     unchanged); in the till, `tender-refund-dialog.test.ts:287-294` becomes "returns a tip on its own
     or with all remaining applied money": payment 0 with tip 1 is sent, payment 10 of 40 with tip 1
     still shows the (new) `tender_refund.tip_requires_all` text and sends nothing;
   - **replays** (the re-read's M-3): a refund linked by O8 (no cancels named) and replayed by a
     person without refund permission is refused `authorization.not_permitted`, as its first send
     was; a covered refund that named its cancels still replays as today;
   - **the till's saved attempt** (the re-read's M-4): after `tender.refund_needs_correction`, and
     after #3993's `tender.refund_of_advance` and `advance.taken_off_final_invoice`, the till drops
     the saved attempt (`apps/till/src/state/tender-refund.test.ts`);
   - with a correction named (card and cash steps): unchanged;
   - **#3993's cases unchanged:** `advance-final.test.ts` and `advance-corrections.test.ts` keep their
     part-payment assertions (not taken off: `tender.refund_of_advance`; taken off with money left on
     the table's ticket: `advance.taken_off_final_invoice`; nothing left: accepted, never
     `tender.refund_needs_correction`).
   Run, watch them fail.
2. The change:
   - `correctableNow` in `invoice-corrections.ts`: admission and lines first, then the pending
     refund, then the chain (only when the refund would otherwise be refused), then the clock
     (section 4.6);
   - `refusePlainRefund` in the reservation with its required `{ backend, reading }`, passed from
     `beginSettledTenderRefund`;
   - the unnamed-cancel linking (O8) with coverage computed only for named cancels;
   - **replays:** `authorizeStoredTenderRefund` (`tender-refund-reservation.ts:111-129`) works
     "covered" out from the stored links, so an O8-linked refund would count as covered when sent
     again though its first send was not. The retry route rebuilds its request from the stored row
     with no cancel ids (`tender-refund-api.ts:274-282`), so the request cannot tell. Instead,
     covered also needs the stored `fingerprint` to match neither fingerprint of the same stored
     fields with no `cancellationIds`, one with `manualConfirmed` true and one false (`:217-226`
     builds it; the row stores the tender's `manual`, not the request's flag, `:223`, `:364`). A
     request that named no cancels matches one of the two. No schema change;
   - the tender refund's own tip rule beside `refundAmountsFit`, which bill refunds keep unchanged
     (O2, section 4.6);
   - the till's form condition and the `tender_refund.tip_requires_all` text, en and es (section 4.6);
   - in `apps/till/src/state/tender-refund.ts:255-266`, `tender.refund_needs_correction`,
     `tender.refund_of_advance` and `advance.taken_off_final_invoice` drop the saved attempt, as an
     `invoice_correction.*` refusal does: the server raises all three only after it has looked for
     the submission id (`tender-refund-reservation.ts:228-235`, before the gate), so the refusal
     proves no refund was made under it;
   - the code in `errors.ts`; 409 in `tender-refund-api.ts`; the message in `codes.ts`.
   `tender.refund_exceeds_cancelled` and the till's PIN prompt for it (`till-app.ts:9878-9883`)
   stay, for a receipt Correct invoice cannot correct.
3. Rewrite section 6's group C here. Commit at a point where only groups A, B and D are red, and hand
   over to Task 7.
4. ```sh
   pnpm --filter @waitron/server exec vitest run src/tender-refund-reservation.test.ts src/tender-refund-api.test.ts src/tender-refund-links.test.ts src/advance-final.test.ts src/advance-corrections.test.ts src/invoice-correction-api.test.ts src/invoice-corrections.test.ts src/bill-payments-api.test.ts
   pnpm --filter @waitron/adjustments exec vitest run src/refund-links.test.ts
   pnpm --filter @waitron/till exec vitest run src/i18n/codes.test.ts src/widgets/tender-refund-dialog.test.ts src/state/tender-refund.test.ts
   pnpm exec vitest run scripts/errors-reachable.test.ts scripts/write-path-tables.test.ts
   ```

### Task 7: test setups the new rule changes — about 25 calls (7a) and 60 (7b)

Run 4 (section 6) sorted the failures by cause; each half fixes its own cause and nothing else.
Change setup and the request body only; every assertion about the refund itself stays.

**7a — group A: a truthful backend, no cancel** (`tender-refunds.test.ts`,
`tender-refund-reservation.test.ts`, `tender-refund-authorization.test.ts`; 140 tests). Every sale
there is inserted by hand with `fiscalBackend: "none"` and no lines, so the real backend would answer
`sale.correction_not_admitted` reason `missing` (`correction-admission.ts:48`), Correct invoice can
take nothing, and Refund a payment stays open. So:

- in `tender-refunds.test.ts`, the suite's `FakeFiscalBackend` (`:134`) answers
  `setCorrectionAdmission({ eligible: false, reason: "missing" })` (`fake-backend.ts:341`);
- in `tender-refund-reservation.test.ts` (`reserve` at `:179`, and `:391`, `:732`) and
  `tender-refund-authorization.test.ts` (`:217`, `:567`), every direct `reserveTenderRefund` call
  passes the new `{ backend, reading }` with such a backend and the suite's own clock reading.

No cancel is added, so who may refund is checked exactly as today (7 `not_permitted` assertions in
`tender-refund-authorization.test.ts`, 1 in `tender-refunds.test.ts`). Run 4 measured this shape:
197 of 197 pass once `correctableNow` reads the lines before the pending-refund check. If a case
still fails, stop and report it; do not add a cancel to these suites.

**7b — groups B and D: the refund names a cancel** (`clock-unconfirmed-gate.test.ts`,
`conflict-issuance.test.ts`, `till-device-proof.test.ts`, `clock-behind-stop.refunds.test.ts`,
`fiscal-remedy.staff-refund.test.ts`; 37 tests). Real sales with filed records, which the rule
refuses (B) or makes wait while the filing is refused (D, under O7's default). The shape, decided
before starting, does **not** lean on a gap this plan closes or on one a later item will close: one
helper in `apps/server/src/testing/` (for example `refundableCancel(venue, billId)`) that cancels
the refunded dish **keeping its charge with the Refund tick**, through the real `cancelItem` (as
`free-items.test.ts:103-123` cancels with `"keep_charge"`, adding the Refund tick), and the suite's
refund then **names that cancel** and stays within what it owes — the path the first Refund a payment
window takes after Cancel and refund. Where a suite's refund is larger than one dish, cancel enough
dishes to cover it. Prove the helper first: a suite's case without it fails with
`tender.refund_needs_correction` (or, in group D, `sale.correction_not_admitted` `filing_refused`),
with it passes.

- A cancel within what it owes lets a person without refund permission through on the canceller's
  authority (`tender-refund-authorization.ts:159-179`, `tender-refund-reservation.ts:331-336`). None
  of the five suites asserts a permission (`grep -c not_permitted` prints 0 for each), and the helper
  is never used in a suite whose subject is who may refund. Where a suite's refunder lacks
  `sale.refund`, say so in the handover.
- If a suite counts dish lines or adjustments that the cancel changes (group D compares sale lines
  and drawer and print jobs, `fiscal-remedy.staff-refund.test.ts:115-127`, `:156-172`), or its sale
  has no bill to cancel on, stop and report it rather than inserting rows by hand or editing its
  assertions.

Commands: each half's files, then Task 6's command; read the "Test Files" count.

### Task 8: guides, adviser's list, backlog, A802 pointer — about 25 calls

Section 4.7, and a dated pointer at the top of
`docs/superpowers/specs/2026-10-20-a802-partial-paid-invoice-correction-design.md` saying that
policy 2's "goodwill refunds stay money-only" is replaced by this PR, on the owner's 18 and 21
November words. Question 14 follows the owner's answers as written in and O7, O8 and O9's answers;
its full-invoice figures and labels come from the page Task 4 rendered. Then:

```sh
pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts
pnpm exec vitest run scripts/guide-links.test.ts scripts/claude-md-pointers.test.ts
```

`docs/` is ignored by prettier: check with `pnpm exec prettier --file-info <file>` (prints
`"ignored": true`); the guide files under `apps/server` take `prettier --check`. The PR's first
section is section 0 and section 10 of this plan.

## 8. Size, and whether to split

Estimates from the files each task names, not from a build. The O1 lines are the prototype's
(section 4.1: the capped loop was 20 lines); the O4 and O6 lines are estimated from the sites
section 4.3.1 and section 4.5 cite.

| Part | Production (+/−) | Tests |
| --- | --- | --- |
| Task 1 shared rounding function | +40 / −20 | +50 |
| Task 2 `shareFreeItems` | +45 | +120 |
| Task 3 issuance wiring | +10 | +230 |
| Task 3b O4, server (the free-item reader about 40, `cancelItem`'s three rules and the free items' own cancel records about 45, the consent fields about 12, Finish table's request-wide check and loop order about 20, parsing `withFree`, code, status) | +125 / −2 | +300 |
| Task 3c O4, till (the Cancel item window's list, amount and `withFree` about 25, the refund window's fill and links, the re-read on `not_listed`, the Finish window's tie about 20, client types, three messages and a window line in two languages) | +75 / −3 | +150 |
| Task 4 reprints | +4 / −2 | +120 |
| Task 5 choice 2, O1 (menu price on the line, read from the filed line, the capped loop) and O6 (the server line, the picker's flag and four lookups) | +32 / −18 (core, server, till) | +220 / −10 |
| Task 6 choice 1 (`correctableNow`, the gate, O8 linking, the replay check, O2's tender rule and till form, the till's saved attempt, code, status, message, the new argument) | +110 / −10 | +280, and group C rewritten (19 tests in 7 files) |
| Task 7 fixtures | — | 7a: a backend at five calls and one setter (about +20 / −5); 7b: a helper of about +40 and setup changes for 37 tests in 5 files (about +60 / −25) |
| Task 8 docs | — | guides +30 / −4, sheet +45, backlog −15 / +15, A802 pointer +2 |

About **440 production lines added and 55 removed**, about **1,650 test lines** added or changed,
about 90 lines of guides, sheet and backlog; no generated file, no migration. The driver's brief set
the split line ("If the whole is more than about 300 production lines, split into two PRs"), so this
is **two PRs**, split by subject:

- **PR 1 — a free item takes its share, and comes back with the last paid dish:** Tasks 1, 2, 3, 3b,
  3c and 4, and Task 8's A445 parts (question 14's first bullet, the two O4 guide sentences, A445's
  backlog deletion, the decision entries for the free-item rule, O3 and O4). About **299 production
  lines**. It depends on no open owner question, so it can be built now. A445 and O4 land together,
  so `main` never lets a free item be refunded on its own.
- **PR 2 — goodwill takes a corrective:** Tasks 5, 6 and 7 and the rest of Task 8. About **142
  production lines**. Task 5 can start at once; Tasks 6 and 7 wait for O7 and O8. Task 5's one case
  on the comped ticket needs PR 1's A445, which lands first.

PR 1 sits at the split line by estimate. If its build passes about 300, Tasks 3b and 3c become a PR
of their own, landed straight after Tasks 1–4; between the two, `main` would let a free item be
refunded on its own, which no venue meets while none is live (CLAUDE.md §3, "No
backwards-compatibility or data-migration code until Waitron is in production"). Each PR leaves
`main` working.

## 9. Open pull requests touching the same files

`gh pr list --state open` on 2026-11-23 lists two; `gh pr diff <n> --name-only` for each:

| PR | Overlap | How they interact |
| --- | --- | --- |
| #4118 (`feat/series-split-correctives-2`) | `apps/till/src/i18n/codes.ts` (a hunk at `:402`), `docs/backlog.md`, `docs/backlog/fiscal.md` (hunks near `:287` and `:1296`), `packages/core/src/record-correction.ts`; it also rebuilds core's starting migration, so every venue resets when it lands | Different keys and paragraphs from this plan's; text-only rebase. This plan does not touch `record-correction.ts` |
| #4140 (`fix/h-translation-abandon-box`) | `docs/backlog.md`, other sections | None |

## 10. Decisions, with defaults

**For the owner** — each decides what is filed with AEAT or what money staff hand over:

| # | Decision | Recommended default | Owner's answer (`~/waitron-campaign-l/questions.md`) |
| --- | --- | --- | --- |
| O1 | How a goodwill amount with no dishes ticked is split when a dish was discounted or partly given back before (section 4.1) | by what is left of each dish's price; menu price can take more than is left | 14:15 (`:1393-1395`): by menu-price proportions, a dish capped at what is left of it and the rest spread in the same proportions. Written in (section 4.1, the O1 prototype's figures; Task 5) |
| O2 | A tip given back on its own while payment money is left (section 4.6) | allowed, up to what is left of the tip; a tip is not on the invoice | 14:17 (`:1398`): "Yes". Written in (section 4.6, Task 6) |
| O3 | On a ticket with a free item, what other discounted dishes weigh (section 4.2) | their menu price, so their discounts are shared too | 14:17 (`:1399`): the default, as the watcher's reading of the owner's O1 words, not the owner's own answer (asked again 23 November) |
| O4 | Money handed back by Cancel and refund after payment on a ticket A445 shared (section 4.3) | the dish's filed share (salad €8.33, free water €1.67), pinned by a Task 3 test | 14:17 (`:1400`): "they would have to return both, and get the 10€ back". Written in (section 4.3.1; Tasks 3b and 3c): each dish keeps its filed share; the free item comes back with the last paid dish and cannot be refunded alone; €10.00 in the owner's case. With several paid dishes, the free item goes with the last paid dish (chosen in this revision, section 4.3.1); a free item already served makes the last paid dish's Cancel and refund refuse, pointing to Correct invoice |
| O5 | Choice 1 replaces A802's "goodwill refunds stay money-only" (section 0) | yes, on the owner's 18 and 21 November words — recorded here for the owner to see, not to re-decide | 14:18 (`:1403`): shown, no objection |
| O6 | Complaint as a Correct invoice reason (section 0) | not built; staff pick **Other** with a note | 14:18 (`:1404`): "Add it". Written in (section 4.5, Task 5): Correct invoice, and its card step, offer every reason |
| O7 | Which refusals of Correct invoice leave Refund a payment open, giving money back with no corrective, and which make it wait (section 4.6; D5 until the re-read) | wait while a filing the tax agency refused, stopped or held is being fixed, as the till and A802 policy 3 do; stay open for a ticket filed by another box, replaced by a full invoice, with no filing record, cancelled, not fully paid, a full invoice naming a customer, or records that need checking | open |
| O8 | A Refund a payment naming no dishes on a ticket whose cancelled dishes still owe money (section 4.6, step 2; D5c until the re-read) | it counts against those cancels and is capped by them, which caps the money handed back; the PIN rule stays as today | open |
| O9 | When staff tick dishes in Correct invoice, how the amount is shared over them (section 4.1; new in this revision) | the owner's O1 rule over the ticked dishes, so ticking every dish equals ticking none; it differs from today's "by what is left" only where a ticked dish was discounted or partly given back before | open; Task 5 builds the default |

The watcher's 14:18 entry cleared the plan to build once the re-read was folded and the O1 cap rule
and O4 return-together rule written in (`:1405`); with O6's "Add it", all three are written in by
this revision. O7 and O8 were asked after 14:18 and are open; O9 is new here and open. Nothing in
section 5's fiscal boundary moves: O1 changes only how `allocateCorrectionAmounts` divides an amount
before `recordCorrection` files it, O4 changes which cancels may be asked together, and O6 a reason
check; none touches `recordSale`, `computeHuella`, the chain, numbering, series or the records
table.

**The watcher's call** (cleared at 13:47, `questions.md:1388-1391`). D2 decides which tickets' filed
VAT changes, within the scope of the adviser's answer 1.10, and question 14 asks the adviser about
it; the others decide neither what is filed nor the money handed back:

| # | Decision | Default |
| --- | --- | --- |
| D1 | Where the one rounding function lives | `shareByWeight` in `@waitron/shared` |
| D2 | A445's scope | free items only, on tickets at two or more rates (the adviser's answer 1.10) |
| D3a | Find a bill and A4 reprints | print the filed menu price, so they match the receipt printed at payment |
| D3b | The full invoice's discount rows on a shared ticket | the existing rules, which print, by reading, "Discount −1.61" under the salad and "On the house −0.27" under the water; Task 4 pins them |
| D5b | A new line in the Refund a payment window | none |
| D7 | The adviser's list | question 14, both parts |
| D8 | Guides and backlog | section 4.7 |

## 11. Not established

- What the full invoice's A4 table prints for a shared free item (D3b): read, not rendered.
- The `invoice-document.ts` half of D3a, and every till and dashboard suite: not run on either
  prototype.
- The ~1,350 `apps/server` suites outside the 84 run: a comp on a ticket at two rates, or a plain
  refund of a correctable sale, elsewhere would change there too; CI's scoped run covers them.
- Run 4 built the gate without O8's linking, O2's tip rule or the replay check, and reran only
  groups A and B and the five files of run 3's log; the other 72 of the 84 files, six of group C's
  among them, were not rerun under section 4.6's corrected lists.
- How Task 7b's helper sits with suites that count dish lines or adjustments: found per suite, with
  the stop rule there.
- The reason for today's whole-tip rule (O2): not recorded in #721's commit or the deleted split-bill
  design (section 4.6).
- O4 (section 4.3.1): read, not prototyped. In particular, how Finish table's request-wide check
  and its till window's tie sit with the existing Finish flow, and whether a free item's own
  cancel record joins the dish's kitchen corrections cleanly, are found in Tasks 3b and 3c.
- O1 through the real writers (a line discount, then a correction with no dishes): the prototype
  ran hand-built histories and the existing correction suites only; Task 5 adds the real case.
- O6 in the till: read, not run; the card step's start reason is found in Task 5's till cases.

## 12. Re-read findings not folded

The re-read's findings were each checked against the code before folding. Every code claim held
except two details, I-5's on the authorisation suite and M-9's last clause, both below. These parts
were not folded, with why:

- **I-1, counting `filing_versions_unusable` as temporary.** Kept lasting. The till treats it as
  "Refund a payment still gives money back": `REFUND_STILL` holds `sale.correction_not_admitted`
  and only `voided` and `filing_refused` are excepted (`apps/till/src/widgets/invoice-correction-dialog.ts:95-101`,
  `:385-389`); two unfixed versions of one sale do not resolve on their own, so waiting would leave
  the money with no way back. O7 puts the whole list to the owner.
- **I-4, leaving D5c with the watcher if reworded.** The driver's direction moves it to the owner
  instead, as O8.
- **I-5, the canceller's authority in `tender-refund-authorization.test.ts`.** True for suites that
  go through `beginSettledTenderRefund`, but that suite decides the authority itself: it calls
  `authorize(cancelledBy)` and hands the reservation a fixed `authorizedBy`
  (`tender-refund-authorization.test.ts:209-224`), so a cancel there would not have changed who
  authorises. Moot: Task 7a adds no cancel to any group A suite.
- **M-2, the cost of O4's default.** Recorded at the O4 row; the owner's answer (return both, €10.00
  back) replaces the default, so no plain top-up is needed.
- **M-11** is folded as a question to the adviser only; D3b stays as cleared.
- **M-9's last clause** ("D3b's 'Discount −1.61' comes from this", the unit price). Not folded: the
  A4 takes its discount from the list price, not the unit price (`beforeVatFigures`,
  `apps/server/src/receipt-figures.ts:39-48`: list base 9.62 less filed base 8.01). The rest of M-9
  is folded at section 4.2, step 4.
