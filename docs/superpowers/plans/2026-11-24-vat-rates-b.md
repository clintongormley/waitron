# VAT rates, piece B: set menus with no VAT of their own, and no VAT labels left — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Every implementer is `subagent_type: "implementer"`.

**Goal:** Taken away, a set menu's price is divided between its dishes in proportion to what each
costs on its own, and each part is charged its dish's own takeaway VAT; nothing about a takeaway set
menu is refused for its VAT; nobody picks a VAT class for a set menu; then the old VAT labels
(`vatClass`, "general"/"reduced"/"super_reduced"/"zero") leave the tree.

**Architecture:** When a ticket is issued, the issuing reader marks each covered dish with its set
menu and its own price. Pricing divides each set menu's charged price between those dishes by
`shareByWeight`, on the day the ticket takes its rates, after a free item's share (A445) and before
the lines are rated. Each filed row records how much of its total is its set menu's price
(`sale_lines.set_menu_part`), so tickets, reprints, refunds, correctives and reports read the division
from the filed rows and nothing works it out again. The labels then go in three steps: stop using
them, sweep the fixtures, drop the columns.

**Tech Stack:** TypeScript 7, drizzle (core migration set), Hono in `apps/server`, `packages/shared`,
`packages/menu`, Lit screens in `apps/till` and `apps/dashboard`, Vitest 4.

**Spec:** [2026-11-21-vat-rates-design.md](../specs/2026-11-21-vat-rates-design.md), "Set menus" and
"The pieces, for planning" B (approved by the owner 21 and 22 November), **as changed by the owner on
24 November** (below): its "cannot be taken away", "The till refuses" and "Payment of that order is
refused" are replaced by the division. Its "Open, with the adviser" says a split by what each item
sells for "is a bigger change, designed then": this plan is that design. Piece A's plan:
[2026-11-22-vat-rates-a.md](2026-11-22-vat-rates-a.md) (landed: #4047, #4091, #4133, #4138).

**Lane and landing:** lane L, fiscal. **The owner lands every PR.** Measured on branch head
`af930f2b30` (main `27c4aecdc0`). Third version, after [read 3](#changed-after-the-reads): the first
two planned a refusal (old D1), which the owner removed. Nobody has approved this version yet; the ★
items are asked before the task that needs them.

## The owner's decision, 24 November

"in that case, let's remove the refusal. we still have to choose between dividing the vat between each
product based upon their takeaway vat prices, and choosing the vat rate of the majority item . the
first is safe, let's go with that instead" (owner, about 11:15, relayed by the watcher in lane L's
`questions.md`, "WATCHER 2026-11-24 11:21 — OWNER: remove the refusal"). The watcher's reading, which
this plan takes as the owner's:

- **O1.** No refusal of a takeaway set menu for its VAT anywhere: not when it is added, not at payment.
  The dashboard note "Can't be taken away" (old D6) and the dashboard save refusal proposed at 11:13 go.
- **O2.** A takeaway set menu's price is divided between its dishes in proportion to their à la carte
  prices, each part at that dish's own takeaway rate on the day the meal ends.
- **O3.** A bill whose ticket is already issued stays payable.

Earlier owner decisions this plan keeps: covered dishes left off the ticket ("It is fine to just list
the "menu del dia" and any supplements", 18 November; the layout "Yes, this layout", A1515 Decision 6);
the category report's "Set menus" group with covered dishes at €0 (A1515 Decision 7, `questions.md`,
21 November). Everything under "Decisions" is mine, approved with the plan unless the owner or the
watcher says otherwise.

## Worked example

A takeaway "Daily menu" at **€14.00**: soup (sold on its own at €5.50, 10%), hake (€12.50, 10%) and
lemonade (€3.50, 21%). The three prices add up to €21.50.

| Dish | Its price | Exact part of 14.00 | Rounded down | + cent | **Part** | Rate | Base |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Soup | 5.50 | 3.5814 | 3.58 | | **3.58** | 10% | 3.25 |
| Hake | 12.50 | 8.1395 | 8.13 | +0.01 | **8.14** | 10% | 7.40 |
| Lemonade | 3.50 | 2.2791 | 2.27 | +0.01 | **2.28** | 21% | 1.88 |
| | 21.50 | | 13.98 | | **14.00** | | |

The two cents left after rounding down go one at a time to the largest remainders (hake's 0.95 of a
cent, then lemonade's 0.91; soup's is 0.14). **VAT rows on the ticket and the AEAT record: 10%,
base 10.65, VAT 1.07 (on 11.72); 21%, base 1.88, VAT 0.40 (on 2.28). VAT 1.47 in all**, against 1.27
if all of it were at 10% and 2.43 if all were at 21%. The customer pays €14.00 either way.

Ran, not worked by hand: the three prices through `shareByWeight` and the four rows (the set menu's
own at 0.00) through `rateLines`, in a throwaway test deleted afterwards; read 3 ran it again and got
the same. The same run gave the adviser sheet's €12.00 burger (9.50, 10%) and cola (3.00, 21%) its 9.12
and 2.88, as question 4 says, and 10.00 over three dishes at 3.00 gave 3.34, 3.33, 3.33 (a tie goes to
the earlier dish).

## Should this exist, and the simplest alternative

- **B1** is the owner's rule (O1–O3). The simplest alternative is today's: a takeaway set menu can be
  rung up and never paid. The owner's other option, the rate of the main item, would be smaller (no
  division, one rate per set menu; it is the owner's own 18 November answer on the adviser sheet); the
  owner chose the division as the safe one, and the adviser is asked to confirm it (B1.5). Smaller than
  this plan, the division could be printed as filed with no new column; read 3 showed that breaks the
  full invoice and the owner's report decision, so the column stays (S8).
- **B2** removes two fields nothing should read once B1 lands (spec, "removed, with their fields").
- **B3–B5 (no labels)** change nothing a person sees ("we should no longer have labels for vat rates", the
  owner). They can be dropped without touching B1 or B2.
- **True cost of the labels** (`git grep -nE 'vat_class|vatClass|VatClass' -- apps packages scripts bench`): **about
  2,600 lines** outside generated SQL: 404 production (74 demo data), 2,182 tests and fixtures. A script cuts 1,163
  fixture and 133 assertion lines (measured); 262 stay as captured demo JSON. Database: 7 columns, 10 checks, 9 trigger lines.
- **B1 is the second case** (after A445) where a filed row's total differs from its stored line's; the
  column is what keeps later readers from having to know both.

## Pull requests

| PR | What | Migration | Tasks left | Production | Tests | Other |
| --- | --- | --- | --- | --- | --- | --- |
| **B1** | A takeaway set menu's price is divided between its dishes; the refusals go | **core rebuild** (one column) | 10 (3 built) | +500/−200 | +1,000/−350 | generated about +20; guides, docs |
| **B2** | Set menus lose their two VAT fields | none | 4 | +60/−185 | +120/−230 | guides +2/−10 |
| **B3** | Nothing reads or fills a label | none | 6 | +45/−330 | +50/−400 | — |
| **B4** | Label fixtures deleted by script (tests only) | none | 2 | 0 | −1,150 | — |
| **B5** | Drop the columns, the types and the rate table | **core rebuild** | 6 | +10/−150 | −420 | generated about −250 |

B1's figures are estimates from the files named; B2–B5's are counts, unchanged from the second version.

**Order:** B1 → B2 → B3 → B4 → B5, each stacked on the one before. **B1 and B5 each rebuild the core
starting migration** (RUNNER H1: no migration PR may start while a lane L PR is parked; the watcher
says whether B1 may). B4 is made the day before B5 and the two land close together, the other lanes
told when B4 starts: after B5 an open PR that adds `vatClass:` breaks `main`'s typecheck.

**First lines:** B1 "Reset test venues: FISCAL: a takeaway set menu's price is divided between its
dishes by their own prices, each part at its dish's VAT (VAT rates, piece B)". B2 and B3: "republish
menus on test venues: a published copy loses its VAT labels, so a menu shows as changed" (publishable
with an empty change list: ran). B4: no reset. B5: "Reset test venues: FISCAL: remove the old VAT
labels (VAT rates, piece B). Configuration exports and backups made before it stop loading
(`setup.request_invalid`, `table:products`); an open pull request that adds `vatClass:` fails `main`'s
typecheck."

## What today's code does

Read on `af930f2b30`; "ran" marks what was run.

- A takeaway set-menu bill refuses all money: `refuseTakeawaySetMenuMoney` (`apps/server/src/set-menu-bill.ts:66-90`),
  called at `bill-payments.ts:1643`, `adjustments-apply.ts:822` (not for a cancel) and `working-order.ts:1268`.
  Automatic issue catches its code and leaves the bill unpaid (`bill-payments.ts:1187`); captured money skips it.
  Ran (money-moved receipt): every takeaway bill holding a set menu is refused, rates agreeing or not.
- A set-menu line files at its own `takeaway_vat_class` (`line-vat-rates.ts:37`); a covered dish, its
  surcharge and extras at their own products' rates (`:38`). A covered dish's line stores its supplement
  as its price (`set-menu-bill.ts:383-391`), so its own price is not on the line. On a set menu,
  `menu_items.gross_price` is a surcharge; on an ordinary menu, a blank one means the product's own price
  (`packages/db/src/schema/menu/menu.ts:5-7`), so a menu can price a dish differently from the product.
- **The A445 share is the precedent.** `shareFreeItems` (`packages/menu/src/pricing.ts:274`), called in
  `issueMoment` (`apps/server/src/issue-moment.ts:48`), shares the price paid by menu price with
  `shareByWeight` (`packages/shared/src/share-by-weight.ts`) and files the shares as the rows' totals.
  The first print shows the lines as sold (`issue-moment.ts:14`, `free-item-share.test.ts:139`); a reprint
  prints the filed amounts and pairs them with the stored lines only to find their comps and discounts
  (`transaction-receipt.ts:83-176`). Goodwill corrections (#4192, `packages/core/src/correction-allocation.ts`)
  share an amount over the filed rows the same way, and refuse an amount with no lines named on a ticket
  with two rates (`:61-65`).
- `filedLines` runs `withReceiptListPrices` on the rated lines (`working-order.ts:7796-7803`): a row whose
  list price differs from its filed total files that list price, which the full invoice prints as a
  discount (`receipt-figures.ts:40-48`). At issue the full invoice decides "covered dish, not printed"
  from the as-sold amount (`receipt-adjustments.ts:185-218`, `receipt-lines.ts:227-247`).
- Every issuing path rates its lines in `readLockedLinesForIssuance` (`working-order.ts:1243`) and then
  `issueMoment`: payment of every kind, a captured card, a bill totalling nothing, Print, walk-out, deferred
  close, close of day, a split's bills (money-moved receipt, section 6). Advances take the dine-in rate.
- A whole-invoice credit copies the filed rows reversed (`cancel-credit.ts:82`, `satisfies
  Required<RecordSaleLine>`, so a new field must be copied). A cancel after payment refunds a line's filed
  value, read by position (`cancellation-refund-value.ts:224`).
- The category report puts a set menu's own line under "Set menus" and its dishes under their categories
  (`packages/reporting/src/category-sales.ts:315-320`); top sellers (`top-sellers.ts:98-103`) and a sale's
  order detail (`orders-list.ts:959-982`) read the filed money of each row.
- `rateLines` makes a VAT row for every rate a line has, so a 0.00 line at a rate nothing else has gives
  an empty row (read 3 ran it: `{21.00, 0.00, 0.00}`).
- **Built on this branch:** B1.1 (`6891065463`: `highestRates`, `setMenuProductIds`, and the
  `takeawayVatRatesToday` export), B1.3 (`51737cc9a8`: refusal on adding), B1.4 (`a096d486a1`,
  `af930f2b30`: the Counter pays a set-menu order in the payment window; an invoiced order's window knows
  it is invoiced). B1.3's code files reverse cleanly (`git apply -R --check`: ran; read 3 rehearsed the
  whole revert in a throwaway worktree); its plan lines do not, and are not wanted.

## Decisions

**★ = the owner should see it.** The old D1, D2, D4, D5, D6 and D14 are withdrawn by O1–O3; D7–D13 stand.

- **★ S1. Where, and a free item beside it.** In `issueMoment`, on the day the ticket takes its rates:
  `rateLines(shareSetMenus(shareFreeItems(gross, on), on), on)`. `shareSetMenus` is a pure function in
  `packages/menu/src/pricing.ts` beside `shareFreeItems`, built on `shareByWeight`; nothing else divides.
  Eaten here nothing is divided. **On a takeaway ticket with a free item (A445), the set menu counts as
  one item at its price, and the share it is given is then divided between its dishes.** This decides a
  case that was waiting on the adviser (A1515 bill plan Task 3, `questions.md`, 21 November 15:25), so it
  goes to the owner and into the adviser's question; until answered B1.2a builds it this way.
- **S2. Its own price** (the weight) is the dish's ordinary offer in the menu copy its line records
  (`menu_version_id`): that offer's price, or a variant's menu price, else its own. A line whose copy has
  no ordinary offer of it takes the product's own price (a variant's
  own, else its dish's). This is A1515's rule for "its à la carte price" (its section 1). A1515 piece 3
  (#4258) stores that price on the line when the dish is added, and the reader takes it from there (B1.2h,
  24 Nov): a product price changed after the dish was added does not move its weight.
- **S3. Only when the rates differ.** A set menu is divided only when its covered dishes with a weight above
  0 have two or more rates that day. Otherwise its own row files the whole price at that one rate and its
  dishes stay at 0.00 at that rate: today's shape, so the common all-10% set menu files, prints and reports
  exactly as an eaten-in one does.
- **S4. Rounding and empty rows.** `shareByWeight` in line order: each part rounded down to the cent, the
  cents left over to the largest remainders, a tie to the earlier dish. The parts always add up to what
  the set menu is charged. The set menu's own row then files 0.00 at its **lead rate**, the rate of its
  largest part (a tie, the earlier). **A 0.00 row whose rate has no money on the ticket** files at its dish's
  rate if it is an extra, else at its set menu's lead rate, so no empty VAT row is made (read 3's M11; this
  also covers a free extra on an à la carte takeaway dish, which can make one today).
- **S5. Supplements, extras, comps.** A supplement stays on its dish's row at the dish's rate, and is not
  part of the weight. A paid extra keeps its own price and rate and is not divided. What is divided is what
  the set menu's row is charged after its own comps and discounts (and its A445 share, S1).
- **S6. A dish left out, a 0.00 dish, no dish.** The price is divided over the dishes on the bill, so a set
  menu without its lemonade is all food (the adviser's own question 4 case). A dish with no weight takes no
  share of the price; in a divided set menu its row files a part of 0.00 (S8), so the simplified ticket still
  lists it under that set menu. A set menu with no dish that has a weight files whole at the **highest** takeaway rate among the
  products its recorded copy can hold (B1.1's `setMenuProductIds` and `highestRates`): never less VAT than a
  division could give. Only this case reads the set menu's copy; if it cannot be read the bill is refused
  `menu.reset_required` (it takes an upgrade that changes the menu format with such an order open).
- **S7. Rows grouped from portions** (a dish raised to 3 across three set menus, `groupedByPortion`):
  each working line takes its part in its own set menu; the row files the sum of its lines' parts.
- **S8. The part is stored.** `sale_lines.set_menu_part` (money, nullable, never hashed, never sent to
  AEAT): on a dish's row of a divided set menu, how much of its total is the set menu's price; on the set
  menu's own row, minus the whole amount moved off it; null everywhere else. So every row's **sold amount**
  is `line_gross − set_menu_part` (14.00 for the menu, 0.00 for a covered dish, 2.00 for a supplement),
  whatever happens to the bill afterwards. Without it, a reprint, a refund and the report could recover the
  sold amounts only by pairing with stored lines that a split or a move may have changed (read 3).
- **★ S9. What the documents show.**
  - **80 mm ticket, first print and reprint:** the sold amounts, as today ("Daily menu 14.00", "Hake +2.00",
    its comps and discounts). Under a divided set menu, each covered dish is named with its VAT letter and
    no amount, so the goods at each rate are listed (RD 1619/2012 art. 7.1.e asks a ticket to identify the
    goods; read 3's I4); the menu's own line has no letter. The VAT table shows each rate. A credit note
    prints the same, negated.
  - **Full invoice:** the filed figures. The set menu's row is a heading with no figures; each covered
    dish prints its part, base and rate (soup 3.25 at 10%, 3.58 with VAT; hake 7.40, 8.14; lemonade 1.88
    at 21%, 2.28). A dish's row is "covered, not printed" only when its filed amount is 0.00, at issue as on
    a reprint. A discount on the set menu is not printed as a row of its own: the parts are of what was
    charged. The set menu's row compares its list price with its sold amount, so a 10% discount does not
    print as a full comp (read 3's I2).
  - A menu whose dishes share one rate prints exactly as today.
- **S10. Correctives reuse the filed parts and never divide again.** A whole credit copies the rows reversed
  with their parts negated (a split after print credits exactly what was filed; the new bills are divided at
  their own issue). A goodwill amount is shared over the filed rows (#4192), so on a divided set menu it comes
  off its dishes' parts (a corrective line's part is −min(amount, what earlier correctives left of the part), any rest off the sold amount);
  with no lines named it is shared over the filed rows as on any ticket (`correction-allocation.ts:62-66`;
  corrected 24 Nov after B1.2d: an empty list is what is refused, `sale.correction_scope_invalid`).
  **A covered dish cancelled after payment refunds its sold amount** (its supplement, or nothing), as today
  and as eaten in: the set menu's price did not change, and its part stays filed.
- **S11. Reports keep the owner's 21 November layout** ("Set menus" group; covered dishes at €0): the
  category report and top sellers count each row's sold amount, so a divided set menu's parts count under
  "Set menus"; its net is moved in proportion (the dish keeps the remainder, so totals do not change). A
  sale's order detail shows sold amounts. VAT reports (summary, modelo 303, movements) read the per-rate
  figures and need nothing.
- **S12. The Given free sheet** values a comped takeaway set menu at the highest rate its recorded copy can
  hold, as S6 (an estimate for the accountant; the owner, 18 November: "this should be part of some report
  that we make available to the accountant").
- **S13. A rate changed while a bill is open** changes that bill's division when its ticket is issued, and
  nothing afterwards (O3: a printed bill is paid as printed). Piece C's dated changes arrive the same way.
  No refusal anywhere, so every case in the money-moved receipt (printed, part paid, cash covering after a
  cancellation, captured card, close of day, walk-out, deferred close, split after print) issues or pays
  as an ordinary bill does.

Kept from the second version:

- **D7. Until B5, `createMenu` writes `setVatClass: "reduced"` for a set menu** (`menus_set_terms_ck` requires it).
- **D8. Until B5, `products.vatClass` and the two order-line columns carry
  `.$defaultFn(() => "reduced")`** in the TypeScript schema, so writers and fixtures stop naming them
  (ran: `starting-migrations` and `schema-constraints` pass; a SQL `.default("reduced")` fails `'core': a rebuild
  would change nothing`). `working_order_lines_context_ck` ties `offer_vat_class` to `menu_item_id`, so its writer
  (`packages/venue-service/src/operations.ts:1435`) writes `"reduced"` until B5, and **the split of a line
  copies the stored value (`working-order.ts:5007`, spread at `:5153`) and stays until B5** with the
  contract's field (`packages/module/src/module.ts:779`).
- **D9. In B3 the label fields become optional (types, `createProduct`, `updateProduct`) and are ignored**; B4
  sweeps fixtures against that; B5 deletes them.
- **D10. `defaultProductVatClass` (settings key, pack field, provisioning) goes in B5 with the reset.**
- **D11. `priceBasket` stays** (tests only); its `vatRates` becomes required in B5.
- **D12. Fiscal-test and guard edits.** The golden huella case (`write-path.e2e.test.ts:573-695`) and
  `inmutabilidad.test.ts` stay unedited and pass in every PR (read 3: the golden case calls `recordSale`
  with fixed lines, `:621-658`, so an optional new field leaves it alone). **If the division needs either
  changed, stop and report: it must not.** B1 edits no guard (B1.3's `personal-log-params` row goes with its
  revert). B5's edits as cleared by the watcher (04:31): `personal-log-params.test.ts:145`,
  `behavioural-triggers.test.ts:240-242`, `write-path.e2e.test.ts:699` (setup only), and
  `schema-constraints.test.ts`'s three `*_vat_class_ck` rows (owner, 22 November 10:03).
- **D13.** Both retired-field refusals stay (`menu-api.ts:506-520`, `product-editor-input.ts:161-165`); B2.2
  adds the set-menu fields.

## Questions for the owner (through the watcher)

> **1. What a takeaway set menu's ticket shows (before B1.2c).** Taken away, a €14.00 menu of soup, hake and
> lemonade is now filed as soup €3.58 and hake €8.14 at 10% and lemonade €2.28 at 21%. **Recommended:** the
> ticket still shows "Daily menu 14.00" and any supplement, and lists the soup, hake and lemonade under it
> by name with their VAT letter (A or B) and no amount, so the customer can see which goods are at 21%; the
> VAT of each rate is at the bottom as today. A full invoice lists the three with their part and VAT,
> because those are the figures it is for. A menu whose dishes all have the same VAT is shown and filed
> exactly as today. **Or:** leave the covered dishes off the ticket as now (the ticket then shows a 21% VAT
> row with nothing on it at 21%).
>
> **2. A free item on the same takeaway bill (before B1.2a).** If a manager gives a €2.00 water away free on a
> bill with that set menu and a burger, the price paid is shared over everything by menu price, as for any
> free item. **Recommended:** the set menu counts as one item at €14.00, and whatever share it gets is then
> divided between its dishes as above.

Defaults: recommended. For the watcher, not the owner: whether A1515's takeaway rule should go (below), and
RUNNER H1 for B1's rebuild.

## Global Constraints

- **Fiscal gate**, unedited and passing in B1, B5 and any task touching `pricing.ts`, `line-vat-rates.ts`,
  `issue-moment.ts`, `sale_lines` or the issuing reader:
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts src/write-path.e2e.test.ts`.
  `computeHuella`, the chain, invoice numbering and the record writers do not change.
- **Pre-live:** no data-migration or backwards-compatibility code. B1 and B5 edit the TypeScript schema
  (B5 also `packages/db/triggers/core.sql`), then `pnpm --filter @waitron/server migration-baseline rebuild --set core`.
- **Test commands:** `pnpm --filter <pkg> exec vitest run <file>`, never `pnpm test <file> -t`; read the `Tests` count.
  Each task: `prettier --check <changed>`, the changed packages' typecheck, the focused suites; each PR's last,
  `pnpm -r typecheck`. Before browser suites `memory_pressure | grep free`. **The tree typechecks after every task.**
- **Guards for B1–B4:** `scripts/{personal-log-params,errors-reachable,english-only,module-seams,native-form-fields,guide-links,starting-migrations,claude-md-pointers}.test.ts`
  (from the root) and `guide-content.test.ts`; B1.2s adds the schema guards listed there.
- **English only**; every commit `git commit -s`; **tests restore any product rate or price they change** (shared venues).

## Review Focus

1. **The worked example to the cent, every rounding case** (S4), and A445 then the division on one ticket (S1, S5).
2. **Every issuing path divides, none refuses** (S13), and a printed bill edited then paid keeps its ticket (O3).
3. **No empty VAT row** (S4): a 0.00 dish, the set menu's own row, a free extra, a dish whose set menu is on another bill.
4. **What the 80 mm ticket, the full invoice (at issue and reprinted), a credit note and a reprint print**
   (S9), from the stored part (S8); one-rate set menus unchanged.
5. **Correctives, refunds and reports read the stored part** (S10, S11), and `reversedLines` copies it.

---

## PR B1 — a takeaway set menu's price is divided between its dishes

Order: B1.3r, B1.2a, B1.2s, B1.2b, B1.2e, B1.2c, B1.2f, B1.2d, B1.2g, B1.5. B1.1 and B1.4 are built and kept.
Review: FULL (fiscal, a migration), two Codex angles.

- **B1.1 (`6891065463`): kept.** `highestRates` and `setMenuProductIds` serve S6 and S12.
- **B1.3 (`51737cc9a8`): reverted** by B1.3r (O1).
- **B1.4 (`a096d486a1`, `af930f2b30`): kept.** The Counter still has to open the payment window for a set-menu
  order whose basket totals 0.00, and the invoiced-order fix stands on its own. A set menu with no dish still
  cannot be paid at the Counter (the Pay button needs a dish; the server issues it by Print or close of day).
  Must not land without B1.2e.

### Task B1.3r: Revert the refusal on adding

`git revert --no-commit 51737cc9a8`, then `git checkout HEAD -- docs/superpowers/plans/2026-11-24-vat-rates-b.md`
(read 3: this leaves the revert pending), remove the `takeawayVatRatesToday` export B1.1 added to
`packages/menu/src/index.ts` (no caller is left), then commit ("Takeaway set menus: stop refusing one whose
dishes have different VAT rates", naming O1). This removes `refuseDifferingTakeawayRates`, its call in
`set-menu-count.ts`, `set_menu.takeaway_rates_differ` (errors, 409, till words, `codes.test.ts` row), its
`personal-log-params` row and its tests. Run `till-api.set-menus.test.ts`, `set-menu-count.test.ts`, the
till's `codes.test.ts`, `personal-log-params` and `errors-reachable`; read the `Tests` counts.

### Task B1.2a: The division, pure

**Files:** `packages/menu/src/pricing.ts` (`GrossLine`, `rateLines`, `shareFreeItems`, new `shareSetMenus`),
`packages/menu/src/index.ts`, `apps/server/src/issue-moment.ts:48`; test `packages/menu/src/pricing.set-menus.test.ts` (new).

**Produces:**
```ts
/** On a covered dish's row of a takeaway bill, one entry per working line it stands for. */
setMenuParts?: readonly { setMenuLineNo: number; weight: Decimal }[];   // on GrossLine, dropped by rateLines
setMenuPart?: Decimal;   // on GrossLine and RecordSaleLine: S8's value, set by shareSetMenus
/** Each set menu's charged price divided between its covered dishes by weight when their rates on `on`
 * differ (S3–S7); any other ticket comes back as it is. */
export function shareSetMenus(gross: GrossLines, on: string): GrossLines;
```
`shareFreeItems` counts a set menu's row as its weighted dishes' rates when deciding whether a ticket has two
rates (read 3's probes: as it stands it shares when the row's own rate happens to differ, and not when only
a dish's does). `rateLines` applies S4's rule for a 0.00 row. A divided row's `grossUnitPrice` becomes its
new total divided by its quantity, to the cent (informational, as `rateLines` says; a grouped row of 3 may
not multiply back exactly).

- [ ] **Failing tests:** the worked example (parts 3.58/8.14/2.28, `setMenuPart` 3.58/8.14/2.28 and −14.00;
  the menu's row 0.00 at 10.00; VAT rows `10.00: 10.65/1.07`, `21.00: 1.88/0.40`); one rate (row 14.00 at
  10.00, 12.73/1.27; dishes 0.00 at 10.00; no `setMenuPart`); the tie (10.00 → 3.34/3.33/3.33; `10.00:
  6.07/0.60`, `21.00: 2.75/0.58`); the burger (9.12/2.88); a 2.00 supplement on hake (hake row 10.14 at 10%,
  part 8.14); a paid extra at 21% untouched; a dish with weight 0 at 4% (part 0.00, 0.00 at 10.00, no 4% row);
  a free extra at 4% on an à la carte takeaway dish at 10% (0.00 at 10.00, no 4% row); no dish with a weight
  (row whole at its own list); a comped set menu beside a 6.00 burger at 21% (A445 gives the row its share,
  which is then divided); a set menu whose row is at 21% while its dishes are at 10% beside a comped coffee
  (no A445 share: one rate); two set menus; a grouped row standing for dishes of two set menus; the rated
  lines have no `setMenuParts` key.
- [ ] Run, see them fail (not exported); implement; run this file, `pricing*.test.ts`, `issue-moment.test.ts`
  and the fiscal gate; commit.

### Task B1.2s: The stored part

**Files:** `packages/db/src/schema/sales.ts` (`setMenuPart: money("set_menu_part")`, beside `setMenuRole`),
`packages/core/src/sale-line.ts`, `sale-line-rows.ts`, `correction-history.ts:381`, `apps/server/src/cancel-credit.ts:82`
(`reversedLines` copies it negated); then `migration-baseline rebuild --set core`.

- [ ] **Failing tests:** `sale-line-rows.test.ts` stores a line's `setMenuPart` in cents and null when absent;
  `cancel-credit` reverses it (`−358` for `358`); `record-sale.test.ts` reads it back.
- [ ] Run, fail; implement; rebuild; run these, `scripts/{schema-constraints,append-only-triggers,starting-migrations,classification-complete}.test.ts`,
  `packages/composition/src/composition.test.ts` and the fiscal gate; commit.

### Task B1.2b: The issuing reader

**Files:** `apps/server/src/line-vat-rates.ts` (whole), `takeaway-set-menus.ts` (new: `setMenuWeights` from the
dish lines' recorded menu copies, S2; `recordedProducts` for S6, via `readRecordedDocuments` and
`setMenuProductIds`), `working-order.ts:1243-1300` (selects `setMenuLineId`, `setMenuId`, `setMenuVersionId`,
`menuVersionId`; builds `setMenuParts` for takeaway), `free-items.ts:183` (the same call shape,
so the tree typechecks; its rule is B1.2d's). Test `takeaway-vat-rate-at-issue.test.ts`.

The set menu's own row is given `highestRates` of `recordedProducts` only when none of its dishes has a weight
(S6); otherwise any list, which `shareSetMenus` replaces. Every other row has its product's rates, as today.

- [ ] **Failing tests:** `takeaway-vat-rate-at-issue.test.ts:379`: `"files a set menu at the rate its dishes
  share"` (all at 4.00 → `[{vat_rate: 400}]`); `"divides a set menu whose dishes' rates differ"` (the worked
  example, read through `priceForIssuance`); `"weighs a dish by the price its menu charges for it"` (the menu
  sets soup at 6.00 against a product price of 5.50: soup's part follows 6.00); `"weighs a dish with no
  ordinary offer by its product's price"`; `"a set menu with no priced dish takes the highest rate its copy
  can hold"`, and with the copy unreadable (`readRecordedDocuments` mocked to throw) `menu.reset_required`;
  `"reads no set-menu copy when a dish has a price"` (the mock not called).
- [ ] Run, fail; implement; run the file, `free-items.test.ts`, `dine-in-vat-rate`, `free-item-share` and the
  fiscal gate; typecheck; commit.

### Task B1.2e: No refusal of money

**Files:** `working-order.ts` (`refuseSetMenus` goes), `set-menu-bill.ts:64-90` (delete
`refuseTakeawaySetMenuMoney`), `bill-payments.ts:1178-1191` (the catch goes), `:1643`, `adjustments-apply.ts:822`,
`errors.ts:39`, `till-api.ts:455`, `apps/till/src/i18n/codes.ts:52-55` and its `codes.test.ts` row
(`set_menu.payment_not_ready` deleted). Test `set-menu-money.test.ts`.

- [ ] **Failing tests** (`set-menu-spec-fixture.ts`; Soup, Hake and a Lemonade at 5.50, 12.50 and 3.50,
  Lemonade at 21.00, all put back; the bill set to takeaway right after seating):
  - The `paths` table (its eight ways, plus close of day, a deferred close with a Full invoice and a captured
    card), takeaway: a Daily with Soup, Hake, Lemonade files the worked example's rows; with Lemonade at
    10.00, one 10% row of 12.73/1.27 and the set menu's row at 14.00 (S3).
  - `"a bill printed before its rates changed is paid as printed"`: printed, Lemonade set to 21.00, paid by
    cash, hand-keyed and reader: settled, the ticket unchanged (O3).
  - `"a split after printing credits what was filed and divides the new bill at its own rates"`.
  - `"part paid, then a rate changed, then paid"`, `"cash that covers the bill after a cancel issues it"`,
    `"a rate saved while the reader collects files the division"`: each issues, none refuses.
  - `"a product with no rate refuses as any line does"` (`vat_rate.unavailable`); a captured card then stays
    `pending`, as for any line.
  - `:257-298` becomes `"a takeaway set-menu bill takes money"`; `:446-478` `"…and issues the bill the
    received cash covers"`.
- [ ] Run; see them fail (`set_menu.payment_not_ready`). If a figure differs, stop and report.
- [ ] Implement; run this suite, `set-menu-count`, `till-api.set-menus`, `split-after-print.set-menus`,
  `counter-bill-payments`, the till's `codes.test.ts`, `errors-reachable` and the fiscal gate; commit.

### Task B1.2c: The 80 mm ticket, its reprint and a credit note (owner question 1 first)

**Files:** `packages/orders-sales/src/receipt-lines.ts` (`TillSaleLine.setMenuPart?`; `printsOnTicket`,
`isCoveredDish`, `isSurcharge` and the printed amount read the sold amount on a simplified ticket),
`apps/server/src/receipt-adjustments.ts` (`dishLines`), `receipt-facts.ts` (letters: the covered dishes of a
divided set menu printed by name with their letter, the menu's line without one), `transaction-receipt.ts`
(reads `set_menu_part`; its pairing compares sold amounts in both of its ways, so an A445 share on a divided
set menu still pairs).

- [ ] **Failing tests** (`receipt-facts.test.ts`, `orders-reprint.test.ts`): the worked example's ticket prints
  "Daily menu 14.00" with no letter, then Soup A, Hake A, Lemonade B with no amounts, VAT rows A 10%
  10.65/1.07 and B 21% 1.88/0.40; with a 2.00 supplement on hake, "+2.00" with letter A; a 10% discount on the
  menu prints 14.00 and −1.40 as today; its reprint equals its first print, also after the bill was split
  after printing; its credit note prints the same negated; with a free water on the bill (S1), the reprint
  still pairs; a one-rate set menu prints as today (control).
- [ ] Run, fail; implement; run the receipt and printing suites; **render the ticket and look at it**; commit.

### Task B1.2f: The full invoice

**Files:** `receipt-adjustments.ts:185-218` (on a full invoice, "covered" reads the filed amount),
`receipt-lines.ts:227-247`, `issuance-pass.ts:56` / `working-order.ts:7796-7803` (`withReceiptListPrices` compares
a divided set menu's list price with its sold amount), `invoice-document.ts`, `till-sale.ts:287-340`
(`readSettledTicket`).

- [ ] **Failing tests:** the worked example on a full invoice issued at payment, at a deferred close, read by
  `readSettledTicket` and rebuilt by `invoice-document`: the menu as a heading, Soup 3.25/10%/3.58, Hake
  7.40/10%/8.14, Lemonade 1.88/21%/2.28; with a 10% discount on the menu, no full-comp row and parts of 12.60
  (read 3's probe: today's code would print a 12.73 discount); a one-rate set menu as today.
- [ ] Run, fail; implement; run the invoice suites; **render the A4 invoice and look at it**; commit.

### Task B1.2d: Correctives, refunds, the Given free sheet

**Files:** `apps/server/src/cancellation-refund-value.ts:224` (a row's refund is its sold amount, S10),
`free-items.ts:153-195` (S12, through `recordedProducts`), `packages/core/src/correction-history.ts`
(`correctionLinesFor`: an amount taken off a row comes off its part first, so the corrective line's
`setMenuPart` is −min(amount, what earlier correctives left of the part), and any rest off its sold amount; S10, ruled 24 Nov after B1.2s), and
wherever a replacement's lines are built (find it: only `cancel-credit.ts` and `correction-history.ts` satisfy
`Required<RecordSaleLine>`); tests `split-after-print.set-menus.test.ts`,
`invoice-corrections.test.ts`, `line-cancel.test.ts`, `free-items.test.ts`.

- [ ] **Failing tests:** a whole credit of the worked example has the negated rows, parts and VAT rows; a 2.00
  goodwill on its lemonade row comes off at 21%, and one naming no lines is refused `sale.correction_scope_invalid`;
  Lemonade cancelled with a refund after payment refunds nothing and files no corrective; Hake with a 2.00
  supplement refunds 2.00 at 10%; a replacement (AEAT refusal remedy) repeats the divided rows and parts;
  the Given free sheet values a comped takeaway Daily at 21%.
- [ ] Run, fail; implement; run these suites and the fiscal gate; commit.

### Task B1.2g: Reports and the order detail

**Files:** `packages/reporting/src/category-sales.ts:223-320`, `top-sellers.ts:98-103`,
`apps/server/src/orders-list.ts:959-982`.

- [ ] **Failing tests:** for the worked example, category sales shows "Set menus" 14.00 gross and 12.53 net (the
  three rows' bases, 3.25 + 7.40 + 1.88) and the three dishes' categories 0.00; top sellers
  counts Daily at the net of 14.00 (12.53; top sellers shows net) and the dishes at 0.00; a bill's order detail
  lists Daily 14.00 and the dishes at 0.00 (it reads the bill's own lines);
  with a 2.00 supplement, hake's category 2.00 and "Set menus" 14.00; report totals unchanged.
- [ ] Run, fail; implement; run the reporting suites and `orders-list` tests; commit.

### Task B1.5: Docs, CLAUDE.md, the adviser

**Files:** `apps/server/src/guide/en/table-service.md:548-549`, `es/table-service.md:586-588` (only the Counter
paragraph #3858 wrote and #4143 took out, "At the **Counter**, choose **Take away** …", and its Spanish; no
sentence about VAT, which the code handles by itself); `docs/developers/products.md:120-126, 170-196`;
`docs/developers/conventions-data.md` (beside "A free item's share changes filed line totals": a divided set
menu does the same, and `set_menu_part` gives every row's sold amount) and the matching CLAUDE.md §3 line;
`docs/backlog/fiscal.md:906-911`, `docs/backlog/menu.md:919`; `docs/compliance/2026-11-19-adviser-meeting.md`
question 4: the owner chose the division on 24 November; ask the adviser to confirm it, S1's free item, a
ticket that lists covered dishes by name only (S9), and a covered dish cancelled after payment keeping its
part filed (S10); dated pointers in the spec ("Set menus", "Open, with the adviser") and the a1515 bill plan.

- [ ] Check every guide label against the till's strings; run `guide-content`, `guide-links`,
  `claude-md-pointers`; `pnpm -r typecheck`; commit; `/finish-branch`. PR body: O1–O3 in the owner's words,
  the worked example, "Sale-path read changed: issuing a takeaway bill with a set menu reads its covered
  dishes' menu copies and set menus, and a set menu with no priced dish reads its own copy", and "Changed
  test checks".

---

## PR B2 — set menus without VAT of their own

The label script (B4) with `NAMES=setVatClass,setTakeawayVatClass` cuts 77 fixture properties in 41
files (ran; 34 left by hand over B2, plus the drizzle inserts into `menus` under `packages/db`, which keep theirs until B5).
The second version's B2.3 (`takeawayRates`) and the note in B2.4 are dropped with old D6 (O1).

### Task B2.1: Shared and menu code lose the fields

**Files:** `packages/shared/src/menu-document/set-menu-types.ts:31-32`,
`packages/shared/src/set-menu-bill.ts:16, 56-62` (`SetMenuCopy.terms` goes),
`menu-document-types.ts:265` (`SetMenuChangeField` loses `"vat"`), `set-menu-bill.fixtures.ts`;
`packages/menu/src/set-menu-document.ts:50-51`, `set-menus.ts:44-58, 87-94, 119-120, 344, 355-356, 377-378`,
`operations.ts:127, 204, 211, 365-384, 398, 901-915, 942-943`, `menu-document.ts:207-208, 1323-1327`,
`menu-copy.ts:35-36`, `errors.ts:86-87`; fixtures `packages/venue-service/src/testing/set-menu-fixtures.ts:37-38`.

- [ ] **Failing tests** (`set-menus.test.ts`): `"a set menu's terms are its price, names and lines"`
  (created with no VAT class; `readSetMenu` and the published copy's `terms` have no `vatClass` or
  `takeawayVatClass` key). Run, fail (`set_menu.invalid setVatClass`).
- [ ] Implement with D7; run the menu and shared set-menu suites and venue-service's `zone-offers.set-menus`,
  `set-menu-copies`; commit. The server and dashboard do not typecheck until B2.2 and B2.3, so B2.1–B2.3
  go to one implementer, or B2.1 keeps the fields optional until B2.3.

### Task B2.2: The server refuses the retired fields

**Files:** `apps/server/src/menu-api.ts:506-520, 816-840, 1140-1200`, `set-menu-count.ts:91-92` (writes `"reduced"` until B3),
`apps/server/scripts/demo-seed/seed-set-menus.ts:48`; fixtures `testing/set-menu-bill-fixture.ts:36-37`, `set-menu-spec-fixture.ts:144-145`.

- [ ] **Failing tests** (`menu-api.set-menus.test.ts`): a POST to create a menu and a PATCH naming
  `setVatClass` or `setTakeawayVatClass` is refused `management.request_invalid {field}`, the draft unchanged;
  the answers have neither. `refuseRetiredFields` takes the list to refuse.
- [ ] Run, fail; implement; run `menu-api*.test.ts` and the server's set-menu suites; typecheck; commit.

### Task B2.3: The form

**Files:** `apps/dashboard/src/api/client.ts:576-607`, `widgets/set-menu-terms-form.ts` (the two
fields, `#vatField`, `defaultVatClass`), `screens/menus-screen.ts:93, 728, 1096, 2605`, `i18n/codes.ts:2016-2023`,
`i18n/domain.ts` (`vatClassLabel`, `vatClassName`, `VAT_CLASS_NAMES`, `vatRateOn`), `i18n/strings.ts:3685-3688,
8546-8549` ("Name and price" / "Nombre y precio").

- [ ] **Failing test:** `set-menu-terms-form.test.ts`: `"asks for a name, customer names and a price, and no VAT"`.
- [ ] Run, fail; implement; run the dashboard's set-menu, menus-screen, client-routes and codes suites; look at
  the page in both themes and at phone width; commit.

### Task B2.4: Guide, docs, change-list words

**Files:** `guide/en/products.md:303-307`, `es/products.md:319-326` (before "Publish"): EN "Give it a name and price,
add customer names in the languages you use, then save."; ES the same; the VAT sentence about set menus goes.
`docs/developers/products.md:195`; `docs/backlog/fiscal.md:906`; dashboard words for a set menu's "VAT" change.
_2026-11-24: the guide sentence was cut in B1 (finish-branch review)._

- [ ] Run `guide-content`, `guide-links`, `pnpm -r typecheck`; commit; `/finish-branch`.

---

## PR B3 — nothing reads or fills a label

Deletions, so no failing test except where named. After it the receipt
`git grep -nE 'vatClass|takeawayVatClass|offerVatClass' -- 'apps/*/src' 'packages/*/src' ':!*.test.ts' ':!*testing*'`
shows only optional type fields, schema lines, the D7/D8 stand-ins with `working-order.ts:5007` and
`module.ts:779`, the retired-field refusals, `defaultProductVatClass` and the demo data. **Guard:**
`takeaway-vat-rate-at-issue.test.ts` gains `"files at its product's rate whatever its line's label columns
hold"` (both columns set to `zero` by raw SQL, a 21% product files 2100), which passes from the start.
B1.2b already removed the one label read that decided a filed rate (`line-vat-rates.ts:37`).

Assertions: run the label script with `MODE=A` on the task's packages (measured: menu 54 cuts, server
70, venue-service 3, till 4, dashboard 2), then the hand edits named. **About 40 hand edits a task.**

_2026-11-25: `set-menu-count.ts` and its tests are gone (A1515-3 PR 2b, #4313); `set-menu-regroup.ts` is
the one writer of a set menu's line._

- [ ] **B3.1 Server production.** `working-order.ts:273, 519-520, 916-950, 1062-1063, 1128-1129, 4961-4962,
  5166-5167, 5466, 5731` (**not `:5007`**, D8), `modifier-selection.ts:12, 23-24, 41-43, 156-157, 524-525`,
  `upgrade-sale.ts:95`, `set-menu-count.ts:91-92`, `free-items.ts:161`. D8's `$defaultFn` in
  `packages/db/src/schema/{orders,menus}.ts`; run `starting-migrations` and the two split tests read 1
  named ("retains the set-menu placement metadata when carving a stored dish row", "splits a 50 g child
  with its dish without changing either frozen price"). _2026-11-25: also the placeholder in
  `set-menu-regroup.ts` (arrived with #4278); when the placeholders move to the schema default, repoint
  the two file names in `docs/developers/products.md`._
- [ ] **B3.2 Menu production.** `packages/menu/src/`: `menu-document.ts:1120, 1132, 1138, 1227`,
  `menu-navigation.ts:184, 259, 362`, `offered-modifiers.ts:121-122, 153-154`,
  `operations.ts:225, 268, 321, 500-501, 522-523, 545-546, 1035, 1114, 1137, 1150, 1317-1318, 1364-1365`,
  `product-editor.ts:50, 67, 89, 228-229`, `variants.ts:486-504, 547-548, 563-564`,
  `variant-fallback.ts:67, 71`; `product-types.ts:87, 122, 176, 219`; the `"vat"` member of
  `ProductChangeField` (`menu-document-types.ts:228, 365`) with its dashboard words
  (_2026-11-25: those words are now in `apps/dashboard/src/widgets/menu-preview-labels.ts` (`PRODUCT_FIELDS`), and #4308
  added a reader in `productFields` (`menu-document.ts`, `field === "vat" || DECLARATIONS.includes(field)`, which becomes
  `DECLARATIONS.includes(field)`) and the case "names allergens and VAT on Lemonade and its extra" in
  `menu-publication.test.ts`_). `MODE=A` on
  `packages/menu`; the label cases of `menu-document`, `menu-publication`, `menu-change-navigation` (about 35).
- [ ] **B3.3 Menu's other label cases** (`offered-modifiers`, `operations`, `variant-fallback`,
  `variants.db`, `product-editor`, `settings`, `menu-patch`: about 30 by hand) and
  `packages/venue-service/src/operations.ts:1221-1264` (not `:1435`), `packages/module/src/module.ts:252-253,
  308-309, 454-455, 1208` optional, with `MODE=A` on venue-service.
- [ ] **B3.4 Till and dashboard.** `apps/till/src/api/client.ts:369-372, 405-422, 516-517`,
  `state/draft-lines.ts:199`; `apps/dashboard/src/api/client.ts:21-22, 576`,
  `widgets/product-editor-model.ts:27-38`, `product-editor.ts:198`, `products-screen.ts:34, 409`; `MODE=A` on both.
- [ ] **B3.5 Server tests.** `MODE=A` on `apps/server/src`, then about 35 by hand (the rows under
  "Changed test checks"; `party-venue.ts:446`, `portion` and `advance` fixtures wait for B5).
- [ ] **B3.6 Demo data.** The script on `packages/country/src/demo.ts:41, 71` and
  `country-es/src/demo/{menu,casa-delgado-ca,casa-delgado-gl,casa-delgado-valencia}.ts` (70 lines) and
  by hand `test-fixtures/demo/catalan-names.json` (8, read by `data-set.test.ts` and
  `seed.regional.test.ts`), `scripts/demo-seed/{seed,seed-menus,seed-sales,data-set,data-set.typecheck}.ts`,
  `scripts/bench/bench-venue.ts:379` and the madrid transforms (about 35), which map the captured label
  away. `madrid-before-move.*.json` stay unedited. Then `pnpm -r typecheck`; `/finish-branch` (FULL: cross-package contract).

Each task: make the fields optional where a fixture still names them, delete the rest, run the suites and
typecheck, commit. Past 100 tool calls, stop at a green point and hand on.

---

## PR B4 — label fixtures deleted by script (tests only)

The script is a throwaway TypeScript-AST codemod (`~/waitron-campaign-l/receipts/vat-rates-b-label-codemod.mjs`,
never committed): it cuts `vatClass`/`takeawayVatClass` from object literals and type members, never inside a
matcher's argument, and lists every other mention. Raw SQL, `defaultProductVatClass`, `offerVatClass` (9 test
lines) and `packages/fiscal-verifactu/src/write-path.e2e.test.ts` (in the script's skip list with
`pricing*.test.ts`; ran: 0 cuts) wait for B5. An expected value built outside a matcher counts as a fixture, so
every suite is run. **Measured on `packages/menu`** (D8 in place; files put back): 201 cuts in 60 files, all
parse; 33 of 2,830 tests fail, each a label case B3 or B5 changes; **3 hand edits** beyond D9. Elsewhere: server
457 cuts in 175 files, till 260, dashboard 96, venue-service 70, the seven smaller packages 79.

- [ ] **B4.1 `apps/server`.** List the files (`git grep -lE 'vatClass|takeawayVatClass' -- apps/server | grep -E '\.test\.ts$|testing/|fixture'`,
  without `.json`), run the script, `prettier --write` the changed files, delete the unused parameters
  `tsc` names (about 15, e.g. `testing/takeaway-menu.ts:22`, `till-sale.test.ts:1153`), run the suites, typecheck, commit.
- [ ] **B4.2 Everything else**, the same. `pnpm -r typecheck`; the receipt
  `git grep -nE 'vatClass:|takeawayVatClass:' -- 'apps/**/*.test.ts' 'packages/**/*.test.ts'` shows only
  `pricing*.test.ts`, `write-path.e2e.test.ts`, the retired-field refusals and the B5 files. **No assertion changes**: one that breaks stops the task.

Review: LIGHT (a reviewer re-runs the script and diffs), with the plan read and one Codex run-it seat. The PR
body shows the script and its counts.

---

## PR B5 — drop the labels (the migration)

- [ ] **B5.1 Schema.** `menus.ts:30, 52-53, 71-76, 133, 136, 180, 182-183`, `orders.ts:235, 238, 292,
  348-353, 429-430, 442`, `triggers/core.sql:407-408, 442, 481-482, 541, 574-575, 610`;
  **with the stand-ins**: `working-order.ts:5007`, `venue-service/operations.ts:1435`, `module.ts:779`,
  the `createMenu` value. Rebuild. Failing test first (`packages/db/src/schema/menus.test.ts`): `"a set menu holds only its price"` (an insert
  with `kind 'set_menu'` and a price is accepted; `pragma table_info` of the three tables has no column
  like `%vat_class%`). Raw SQL fixtures in `packages/db` (40 lines), `scripts/behavioural-triggers.test.ts:240-242`.
  Guards: `schema-constraints` (D12), `append-only-triggers`, `behavioural-triggers`,
  `starting-migrations`, `classification-complete`, `two-file-foreign-keys`, `id-columns-are-references`,
  `packages/composition/src/composition.test.ts`, the fiscal gate.
- [ ] **B5.2 Shared and pricing.** `vat-rates.ts` loses `VAT_CLASSES`, `VatClass`, `VatRateTable`,
  `VAT_RATE_TABLE`, `assertWellFormed`, `vatRateOn`, `vatRatesOn` (keep `DatedRate`, `rateOn`,
  `highestRates` and the date helpers); `errors.ts:126-133` (`vat_rate.table_invalid`; `date_invalid`'s
  caller is `"rateOn"`); the optional fields in `menu-types.ts`, `product-types.ts`,
  `pricing.ts:18-45, 298-301, 408, 430` (`priceBasket` and `grossBasketWithOptions` take `vatRates`, required), `module.ts`.
  Tests: `pricing*.test.ts` (figures kept, lists literal), `vat-rates.test.ts`.
- [ ] **B5.3 The default class setting** (D10): `settings*.ts`, `provisioning.ts:10, 58-66`,
  `country.ts:181`, `spain.ts:317`; the script with `NAMES=defaultProductVatClass` (55 cuts, and 29 in
  matchers with `MODE=A`), then about 27 by hand.
- [ ] **B5.4 Server raw SQL**: `order-dining.switch` (12), `menu-api` (8), `working-order` (5),
  `configuration-transfer` (5), `venue-settings-api` (3) and the rest; `advance-deduction`,
  `issue-moment`, `portion-sale-projection` (lists literal, figures kept); `order-portions.filing.test.ts:1450`,
  `order-writer-fixture.ts:322`; `write-path.e2e.test.ts:699`. About 40.
- [ ] **B5.5 Demo seed** raw SQL and the madrid transforms (about 33).
- [ ] **B5.6 Docs and receipt.** The label model in `docs/developers/products.md` and `conventions-data.md`;
  `docs/backlog/fiscal.md` (piece B done; A1564's plan told); the receipt
  `git grep -nE 'vat_class|vatClass|VatClass|VAT_CLASSES|VAT_RATE_TABLE|vatRateOn|vatRatesOn' -- ':!docs' ':!packages/country-es/test-fixtures'`
  shows only the madrid transforms' dropped-column names, and the retired-field refusals and their tests
  (`menu-api.ts:512-518`, `product-editor-input.ts:164`). `pnpm -r typecheck`; `/finish-branch` FULL,
  two Codex angles; the PR's first line is the reset line.

---

## Changed test checks

Under the owner's 2026-10-05 rule. The watcher cleared Q2–Q4 of the second version at 04:31; Q1 and Q5
are answered by O1–O3. **Nothing in this table waits for an answer**; the owner's two questions decide
only what B1.2a's and B1.2c's new expected values are.

| PR | Where | Before → after | Whose words |
| --- | --- | --- | --- |
| B1 | `set-menu-money.test.ts:257-298`, `:446-478` | a takeaway set-menu bill refused money, left unpaid → takes money, issued | O1, O3: "let's remove the refusal" |
| B1 | `takeaway-vat-rate-at-issue.test.ts:379-421` | set-menu line files its label, 2100 → the rate its dishes share, 400 | O2 |
| B1 | `apps/till/src/i18n/codes.test.ts` (`set_menu.payment_not_ready` row) | the old code's words → row deleted with the code | O1 |
| B1 | `apps/till/src/widgets/tender-pay.test.ts:410-424`, `till-app-set-menus.test.ts:367-369` (built, B1.4) | Pay disabled on a set menu → opens the payment window | Q3, cleared 04:31; lane controller, 24 November |
| B1 | any existing case pinning a takeaway à la carte ticket with a free extra at a lone rate (B1.2a's S4 rule; none found by grep, the implementer re-checks) | its extra's row at the extra's rate → its dish's rate, VAT unchanged | S4, mine; asked if one is found |
| B1 | `packages/core/src/correction-history.test.ts:412` ("builds lines in allocation order from the invoice line's frozen facts, negated") | the correction line's whole shape without `setMenuPart` → with `setMenuPart: null`, every other value unchanged | owner's 2026-09-27 rule on whole-shape pins; controller ruling in B1.2a (new field on `RecordSaleLine`) |
| B2 | `packages/menu/src/set-menus.test.ts:43-45, 67-72, 87-123`, `set-menus.refusals.test.ts:113, 189-207` (*del*), `set-menu-document.test.ts:316, 320-335, 570, 636-652` | set-menu VAT classes accepted, refused, frozen, listed as a change → no such field (the patch refusal at `:652` keeps its "nothing changed" check) | spec: "removed, with their fields" |
| B2 | `menu-api.set-menus.test.ts:125-190`, `menu-api.test.ts` (3), `client-routes.test.ts:2619-2665` | classes written, cleared, refused → the fields refused by name; answers without them | same |
| B2 | `set-menu-terms-form.test.ts:50-92`, `menus-screen.set-menu.test.ts:498-505`, `codes.test.ts:1359`, `domain.test.ts:63-69, 144, 192` (*del*) | fields shown and sent → gone; `vatClassName` deleted | same |
| B2 | `zone-offers.set-menus.test.ts:57`, `set-menu-bill.test.ts:129` | `terms` carries labels → does not | same |
| B3 | `working-order.test.ts:615, 913, 5170, 9136-9165, 10242-11315`, `party-bill-actions.test.ts:273, 802, 1252`, `party-move-bill.test.ts:307, 1006, 1014`, `menu-patch-open-lines.test.ts:118-195`, `order-dining.start.test.ts:601`, `order-dining.switch.test.ts:509, 655-660` (*del* 655-660), `split-after-print.test.ts:679`, `till-api.groups.test.ts:2185-2191`, `working-order.customer-fallback.test.ts:250` | the label element of a compared row → left out; every other element kept | spec: "Nothing about VAT is stored on an order line" (Q4) |
| B3 | the label elements `MODE=A` cuts (133, listed in the PR), and the label-only cases of `menu-document.test.ts:330-358, 699-701, 755-840, 1855-1882`, `menu-publication.test.ts:275, 1306-1348, 2136, 2144`, `menu-change-navigation.test.ts:360-364, 691-711`, `offered-modifiers.test.ts:486-558`, `operations.test.ts:321, 1199`, `variant-fallback.test.ts:592, 733-766, 787-788`, `variants.db.test.ts:450-472`, `menu-patch.test.ts:103`, `product-editor.test.ts:186-199`, `settings.test.ts:93-96`, `venue-service/operations.test.ts:2541, 2570`, `till client.test.ts:6048`, `menu-preview.test.ts:579-598` (*del*) | labels in a copy, a product or a change list → absent | spec: "nor in a published menu", "No labels" (Q4) |
| B3 | `country-es/src/demo/data.test.ts:478, 515-541`, `regional.test.ts:69, 201, 335`, `seed*.test.ts` label elements, `madrid-vat-class-changes.*` deleted | demo labels → gone; takeaway rates kept | spec: "No labels" |
| B5 | `vat-rates.test.ts` label half (*del*), `pricing.test.ts` and `pricing.dated.test.ts` label-fallback cases (*del*), `menus.test.ts:77`, `orders.test.ts:744-772, 1106-1140`, `set-menus.test.ts` (db) class cases, `settings.test.ts`/`provisioning.test.ts`/`venue-settings-api.test.ts` default-class cases (*del*), `variants.db.test.ts:467` | checks of removed columns, table and setting → deleted (the `rateOn` half covers dated lists) | spec: "No labels" |
| B5 | `scripts/schema-constraints.test.ts` | three named checks | D11(c), owner 22 November |

Unchanged (D13): `product-editor-input.test.ts:76, 227-233`, `product-editor.test.ts:391`, `menu-api.test.ts:3216-3299`,
`menu-patch.test.ts:761`, `extra-contract.test.ts:168`. B1.3r removes only tests B1.3 added on this branch, none on `main`.

## Changed after the reads

- **Read 1, read 2** (second version): folded in then; what of them concerned the refusal went with it.
- **Owner, 24 November:** the refusal and its cost (old D1, D2, D4–D6, D14, the question, Q1, Q5) replaced by
  O1–O3 and S1–S13.
- **Read 3** (this version's first draft, `34aa2a4d57`; `~/waitron-campaign-l/receipts/vat-rates-b-plan-read-3.md`):
  - **I1** (A1515's takeaway rule and its report decision): the report decision is now kept (S11); the A1515
    rule goes to the watcher (below).
  - **I2, I3** (full invoice): S8's stored part, B1.2f with its tests (discount, at issue, deferred close,
    `readSettledTicket`).
  - **I4** (a 21% row with no 21% goods on the ticket): owner question 1 now recommends naming the covered
    dishes with their letters; it goes to the adviser too.
  - **I5** (a free item beside a set menu was waiting on the adviser): ★ S1, owner question 2, adviser question.
  - **I6** (tasks too big; a typecheck break between tasks): B1.2b split into B1.2b and B1.2e, B1.2c into
    B1.2c and B1.2f, reports as B1.2g; `free-items.ts`'s call kept compiling in B1.2b; B2.1–B2.3 noted.
  - **I7** (menus price dishes): S2 now weighs by the menu's offer, as A1515 will store it.
  - **M1** corrected in "What today's code does"; **M2** (S6 only reads the copy); **M3** (guide sentences
    cut); **M4** (the main-item rule is the owner's); **M5** (credit note, order detail, top sellers named);
    **M6** (goodwill naming no lines: tested, and noted for "Give money back"); **M7** (pairing with an A445
    share: tested); **M8** (export dropped in B1.3r); **M9** (adviser question); **M10** (noted at B1.2a);
    **M11** (S4's 0.00 rule).

## Not established (read, not run)

- Whether the adviser agrees with the division, S1's free item, and a ticket naming covered dishes without
  amounts (B1.5 asks him).
- That every place that can move or split a dish line keeps its `menu_version_id` (S2 reads it); B1.2b's
  tests cover a placed dish, not a moved one.
- Line estimates for B1.

## What this changes elsewhere

- **A1515 (lane F), for the watcher; its spec is not edited here.** Its piece 2 rule "on a takeaway bill,
  form a set menu only from dishes that share one takeaway VAT rate that day. Dishes with mixed rates stay à
  la carte" is marked the owner's, 24 November, "keeping the 21 November limit until the adviser confirms the
  "main item's rate" rule". The owner lifted that limit about an hour later. **Recommended: with B1, piece 2
  drops the rule and groups a takeaway bill as any other**, since its VAT is divided at issue; whether that
  needs the owner's own word is the watcher's call. It decides what a customer pays (21.50 à la carte against
  14.00 for the menu). Piece 3's stored à la carte price becomes B's weight (S2). Its section 9 report layout
  is what S11 keeps. Its own last paragraph says "whichever lands second adapts".
- **"Give money back" (lane L's own next work):** on a divided set menu the money comes off its dishes' rows
  (S10); its line picker lists the filed rows, and a ticket with two rates needs lines named.
- **A1564:** its label writers have no columns after B5. **Piece C:** a dated change reaches the division
  through the same rows (S13).
- **The adviser** (B1.5): question 4 gains the owner's choice and asks him to confirm it; if he answers "the
  main item's rate" instead, `shareSetMenus` and its call are what change, and `set_menu_part` stays null.
