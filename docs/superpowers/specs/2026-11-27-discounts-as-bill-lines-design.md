# Discounts held on the bill until the invoice: design

Status: approved by the owner on 2026-11-27 ("sounds great, build it!", ~11:28 CET); section 14's four questions answered by the owner the same day (~11:58 CET)

Decisions marked **owner** were made by the owner in conversation with the watcher on 27 November
2026, about 11:00 to 11:30 CET, and are quoted where the words were relayed. Everything else is
marked **watcher's proposal** (the owner handed the "how" to the watcher; this is the watcher's
pick) or **builder's call** (left to whoever plans and builds it). Statements about today's code
cite `file:line` on `main` at `6e27779ccf` and come from reading the code, not from running it,
unless they say "run". The figures in the worked examples are arithmetic done by hand on the
rounding rules cited, not output of the code.

## 1. Why

Since 24 November three plans in a row (rule C of 26 November, #4441, and the 3c plan) tried to
keep a discount correct by writing it into the bill's line prices the moment it is given, and then
repairing those prices every time the bill changed: a dish cancelled, moved, paid for alone, its
extras or variant changed, or its set menu worked out again. Each repair needed a record of what
came off, a notice, and a rule for the next corner case; the last one (D60) made a guest's bill go
up when a dish was cancelled.

The owner's new model: **a discount is a thing on the bill, like an order line.** It is attached
to the whole bill, a dish, an extra or a set menu. It is remembered, shown, and can be removed at
any time, but it is not written into any line's price until the invoice is made. Only then is it
"crystallised": worked out against the bill as it finally stands and applied to the lines.

The owner, 27 November: "instead of just applying the discounts in the moment, let's make
discounts work a bit like order lines. They get added either to the bill as a whole, or like an
extra to an order line (or a set menu). They can also be removed from the bill at any time before
an invoice is created, which is the moment they get crystalised and applied to the order lines.
That way we can even keep the percentage discounts intact." And: "So the discount(s) are
remembered but not fixed to items until payment."

What the owner wants from it: simple rules staff can predict, a guest's bill that does not go up
when a dish is cancelled, and discounts as first-class things on the bill.

## 2. Goals, non-goals, anti-goals

### Goals

1. A discount is given on one of four things: the whole bill, a dish, an extra on a dish, or a set
   menu (**owner**).
2. A discount is a percentage or an amount, and stays what it was given as until the invoice
   (**owner**: "we can even keep the percentage discounts intact").
3. Until the invoice, a discount can be removed at any time (**owner**).
4. The bill always shows the effect of its discounts, so the guest sees the total they will pay
   (**owner**: "the effects of the discount are displayed on the bill at each point … but this is
   a calculate display artifact").
5. When the invoice is made, each discount is worked out once against the bill as it stands, and
   the lines' prices are lowered then (**owner**).
6. A discount whose condition no longer holds is put to the waiter just before the invoice, with
   two choices: remove it, or replace it with a different discount (**owner**).

### Non-goals

- **100% comps** (**owner**: "we'll leave 100% comps for later"). What that means today: Free is
  its own kind of comp (`comp` in `ADJUSTMENT_ACTIONS`, `packages/shared/src/adjustment-policy-types.ts:6-11`),
  given on a dish, an extra or a set menu but never on the whole bill (only the two discount kinds
  pass `adjustments_bill_level_ck`, `packages/db/src/schema/adjustments/adjustments.ts:135-140`).
  This design does not add a whole-bill Free or change where Free may be given. How Free rides the
  new model is the owner's question Q1 (section 14). The rest of this document assumes the
  **watcher's proposal** there: Free is a pending discount like the others, a third kind beside
  percentage and amount that takes everything its target costs at the invoice (so Free on a burger
  also covers Chips added later, as a 100% percentage would), a dish with its own Free leaves its
  set menu as today, it is worked out first among a target's discounts, and it is crystallised as
  `action = 'comp'` so receipts and reports still say Free. A 100% percentage already counts as
  Free for a reason's permission (`takesEverything`, `packages/adjustments/src/policy.ts:145-149`).
- **Discounts with conditions of their own**, such as "10% on bills over 100€". No reason carries a
  condition today (a reason has only a percentage and an amount limit,
  `packages/db/src/schema/adjustments/reasons.ts:31-32`). The check before the invoice is built so
  such a condition can be added later (section 7.6); adding one is the owner's question Q3.
- Cancellations. A cancel stays what it is today: it takes the dish off at once and is recorded at
  once (`applyAdjustment`'s cancel branch, `apps/server/src/adjustments-apply.ts:1147-1167`).
- Anything after the invoice: refunds, credit notes and corrections read the crystallised records,
  which keep today's shape (section 9).

### Anti-goals: what would make this a failure even if it worked

- A guest's bill goes up because a dish was cancelled.
- Two tills, the printed bill and the invoice disagree about the total.
- A discount shown on the bill is not the discount on the invoice, to the cent.
- A sale is blocked by a discount: the waiter can always remove it and carry on.
- The waiter is asked a question every time an extra is added.

## 3. Constraints

- **VAT is worked out per line only when the invoice is made.** The invoice is priced from the
  stored lines (`priceStoredOrderForIssuance`, `apps/server/src/stored-order-lines.ts:322`, used by
  `priceForIssuance`, `apps/server/src/working-order-invoice.ts:293-317`, and by the payment path,
  `apps/server/src/bill-payments.ts:1165-1168`). So crystallising must write the lowered prices
  before that read, in the same transaction.
- **The fiscal record is append-only** and so are `adjustments` and `adjustment_lines`
  (`packages/db/src/schema/adjustments/adjustments.ts:35-39`,
  `packages/db/src/schema/adjustments/adjustment-lines.ts:5-10`). A discount that is not yet
  crystallised is not a fiscal fact and need not be append-only.
- **Nothing external on the sale path** (CLAUDE.md §5). Working out discounts is local arithmetic.
- **Whole cents** (CLAUDE.md §3, money columns hold whole cents).
- **No venue is live**: no data migration; a schema change rebuilds the starting migration and
  resets venues (CLAUDE.md §3, the last data rule and the starting-migration rule).

## 4. How it works today (read, not run)

- **A discount is written into prices when it is given.** A percentage is turned into an amount
  off the bill or line as it stands then (`requestedDiscount`, `adjustments-apply.ts:275-297`); the
  amount is shared over the lines (`spread` and `spreadOverFiledRows`, `:344-422`), each line's
  price is lowered and its old price kept as its list price (`reprice`, `:1029-1105`), and one
  `adjustments` row plus one `adjustment_lines` row per lowered line are recorded (`:1185-1227`).
- **Rounding.** A percentage is rounded half up to the cent (`percentReduction`,
  `packages/adjustments/src/spread.ts:198-204`). An amount is shared in proportion to each line's
  charge, each share rounded down, the cents left over going one at a time to the largest
  remainders, a tie to the earlier line (`discountShares`, `spread.ts:268-272`; the same rule in
  `shareByWeight`, `packages/shared/src/share-by-weight.ts:17-23`). A line of several units whose
  share does not divide into whole cents per unit is split into two rows at two prices
  (`spreadBillDiscount`, `spread.ts:300-310`; `reprice` splits it, `adjustments-apply.ts:1059-1066`).
- **The set menus are worked out again on every change** and saved: surviving set-menu rows keep
  their ids, new ones are added, unused ones deleted (`writeBillGrouping`,
  `apps/server/src/set-menu-regroup.ts:149-226`). A row a comp or discount lowered is "frozen" and
  left as it is (`frozenLineIdSources`, `apps/server/src/set-menu-freeze.ts:18-45`).
- **Rule C's repairs (3b1, 3b2, #4441).** When a dish's extras or variant change, its own comp or
  discount is ended (`endRepricedDishDiscounts`, `apps/server/src/dish-discount-ending.ts:86-131`)
  and recorded in two append-only tables (`adjustment_endings`, `adjustment_ending_lines`,
  `packages/db/src/schema/adjustments/adjustment-endings.ts:25-84`); each open bill answers
  `discountNotices`, which the till does not yet draw (the till only declares the field,
  `apps/till/src/api/floor-api.ts:137`).
- **A moved line keeps its id** (`apps/server/src/working-order-transfer.ts:186-192`), so anything
  keyed on the line goes with it.
- **The moments an invoice is made**: a payment that completes the bill (`issueWhenFullyPaid`,
  `bill-payments.ts:1052`); printing the bill (`end-meal`, `apps/server/src/meal-end.ts:116-138`);
  Pay for items, which moves the items to a new bill and pays it there (`payForItems`,
  `apps/server/src/pay-for-items.ts:444`); a guest leaving without paying
  (`apps/server/src/unpaid-departure.ts:113-121`); the close of day (`issueBillAtClose`,
  `apps/server/src/close-of-day.ts:83-120`); and a deferred close
  (`apps/server/src/deferred-close.ts:143-153`). An advance ticket for a part payment is its own
  one-line invoice of money, not of dishes (`issueAdvance`, `apps/server/src/bill-advances.ts:80-89`),
  and the final invoice takes its credit off.

## 5. Approaches considered

1. **Discounts as rows of their own, worked out at the invoice (chosen).** A new table holds each
   discount as given: its target, its kind and value, its reason and who gave it. No line price
   changes. One pure function works out what every discount takes off the bill as it stands now;
   every screen, total and check calls it, and the invoice path calls it once more and writes the
   answer into the lines and today's `adjustments` and `adjustment_lines` records. Removing a
   discount deletes its row. Cost: every reader of "what the bill owes before the invoice" has to
   go through the new function (section 7.5), and the till must draw discounts from it.
2. **Today's per-line records, repaired on every change.** Keep writing the discount into prices
   when given, and on every change end it and give it again. This is rule C and the 3c plan: every
   change path needs ending code, the append-only tables grow on every edit, the report has to
   leave out what came off, and percentages cannot survive (they were turned into amounts). It is
   what the owner asked to replace.
3. **Rows of their own, plus a second "provisional" price on each line kept up to date.** Saves
   working the discounts out on each read, but every reader then has to choose between two prices,
   and the second price has to be rewritten on every change exactly as approach 2 rewrites the
   first. Rejected for the same reason as 2.

The owner's decisions pick 1: "remembered but not fixed to items until payment" and "a calculate
display artifact" (**owner**). That the crystallised form is today's `adjustments` and
`adjustment_lines`, so that receipts, reports, refunds and corrections keep reading what they read
now, is the **watcher's proposal**.

## 6. The model

### 6.1 A discount

One row per discount on an open bill (table and column names are the **builder's call**):

- the bill;
- the **target**: the whole bill; a dish line; an extra line; or a set-menu row (the line the
  grouping writes for one set menu, `setMenuRole = "set_menu"`), together with the set menu's type
  so it can still be named once its row is gone;
- the **kind and value**: a percentage (basis points), an amount (cents), or Free (section 2, Q1);
- the reason, its name and its limits as they were (as `adjustments` copies them today,
  `adjustments.ts:56-60`), who asked, who approved, the note and when.

**Watcher's proposal on how the target is held:** a dish or extra target is a foreign key that is
deleted with its line, so cancelling the chips removes the chips' discount by itself (**owner**:
"we should be able to remove this in the moment that the chips are removed"). A set-menu target is
a foreign key that becomes empty when the grouping deletes the row, so the discount stays on the
bill and the check before the invoice can ask about it (section 6.6). Classification `state`, in
core's migration set, and listed in `scripts/write-path-tables.json` (**builder's call**).

**A till row of several portions** (a whole-portion dish is stored as one line per portion,
`expandPortionRows`, `apps/server/src/order-portions.ts:28-35`): a discount given on the row is
stored as one discount per portion, given together, a percentage on each and an amount shared
between them by price at that moment. Each then follows its own line; the till shows them as one
entry and removes them together (**watcher's proposal**). A discount on part of a non-portion line
splits the line first, as the comp window does today (`reprice`'s carve,
`adjustments-apply.ts:1045-1056`), so a discount always covers whole lines (**watcher's proposal**).

### 6.2 What each target covers

The rule (**owner**, accepted from the watcher): **a percentage covers whatever is inside its
target when the invoice is made; an amount stays the amount it was given as.**

| Target | What it covers at the invoice | Decided by |
| --- | --- | --- |
| Whole bill | Every charged line on the bill, dishes ordered later included | **owner** (25 Nov, "seems ok"; 27 Nov) |
| Dish | The dish and every extra on it, extras added later included | **owner** ("i would expect a percentage discount to cover the dish and its extras") |
| Extra | That extra only; it goes when the extra goes | **owner** |
| Set menu | The set menu's price and the supplements of the dishes in it; not the paid extras on those dishes | spec of 24 Nov §6 (writer's call there); kept, **watcher's proposal** |

An amount on a dish is shared over the dish and its extras by price, never more than they cost
(**watcher's proposal**; the owner said only that "2€ off the burger stays 2€").

### 6.3 Life cycle

1. **Added** through the comp window, on its target, after today's checks: the reason must allow
   the kind; the reason's percentage and amount limits and the venue's most-off-one-bill limit
   decide whether a PIN is needed (`evaluateComp`, `packages/adjustments/src/policy.ts:127-143`);
   an amount larger than what its target costs now is refused (**owner**: a discount can't take a
   line below zero, and a bill-wide amount can't exceed the bill; today's
   `adjustment.exceeds_amount`, `packages/adjustments/src/errors.ts:19`).
2. **Shown live** on every till and every read of the bill (section 6.5).
3. **Removed** at any time before the invoice: by staff, or automatically when its dish or extra
   leaves the bill.
4. **Moved** with its dish or extra; a whole-bill discount's share goes with moved items (6.4).
5. **Crystallised** when the invoice is made (section 7), after the check before the invoice.

Limits are checked when a discount is added or replaces another, not again at the invoice, though
a percentage may then cover more (the owner's 25 November answer (b), "no new approval as a
percentage reaches later dishes", lane B `questions.md`, "WATCHER 2026-11-25 20:51").

### 6.4 What each change to the bill does

| Change | Whole-bill discount | Dish or extra discount | Set-menu discount |
| --- | --- | --- | --- |
| Dish or extra added | A percentage covers it; an amount is unchanged | A percentage on the dish covers a new extra; no question (**owner**) | Unchanged |
| Dish cancelled | Unchanged: an amount stays whole (**owner**: "We remove the 10€ discount from the bill, we recalculate the set menu grouping, then we reapply the 10€"; Q2 confirms it for a plain bill) | Removed with the dish, no notice (**owner**) | Kept while its set menu's row survives the grouping; otherwise flagged (6.6) |
| Extra removed | As cancelled | The extra's own discount goes; the dish's stays | Unchanged |
| Variant changed | Follows | A percentage follows the new price, no question; an **amount** makes the till ask "This dish had 2€ off. It's now the large burger: keep the 2€ off, or remove it?" (**owner**) | Follows the grouping |
| Set menus worked out again | Follows; it is worked out after the grouping | A dish with its own discount stays out of the grouping, charged à la carte (spec of 24 Nov §6, **owner**; 3a); an extra's discount leaves its dish in its set menu (plan D34) | Kept while its row survives; otherwise flagged |
| Items moved to another bill, Pay for items, a table split | The moved items take their share (below) | Goes with its line, which keeps its id | Stays on its bill; if every dish placed in it moves, it moves too (below) |
| Bills merged | As moved, every line | Goes with its line | As moved |
| Payment taken in part (an amount, or split equally) | Unchanged; what is still owed is the shown total less what was paid | Unchanged | Unchanged |
| Bill abandoned | Deleted with the bill's other open state | Deleted | Deleted |

**A whole-bill discount when items move** (**owner**: "They tick those two items and they get
transferred to the new bill with their share of the discount. So the new bill now has 3€ of
discount, an 7€ remains on the first bill"; "If a bill has a 10% discount and items get
transferred to a new bill, the 10% discount goes with them").

- A **percentage**: the new bill gets the same percentage, and the first bill keeps it
  (**owner**).
- An **amount**: split between the two bills in proportion to what each charges after the move,
  its set menus worked out again, before discounts (**watcher's proposal**). On a 50€ bill with
  10€ off, two items that make a 15€ bill of their own take 3€ and 7€ stays: the owner's figures.
  Sharing by what the moved dishes charged before the move would give a dish inside a set menu
  (charged 0.00) no share at all.
- **Into a bill that already exists** (Move dishes to another table, a merge): a percentage cannot
  be copied, or the whole destination bill would get it. The moved items' share is worked out as
  an amount at the move and arrives as an amount **on each moved item**, not on the destination
  bill as a whole (**owner**, Q4: "to an existing bill with other items - calculate the amount and
  apply it to the individual items that move"). Into a new bill, the whole-bill percentage is
  carried over as a whole-bill percentage (**owner**: "to a new bill - carry over the 10% discount
  on the bill").
- A **card declined** in Pay for items puts the items back (`putItemsBack`,
  `apps/server/src/bill-payments.ts:2343`); their share of an amount goes back with them and the copied percentage is dropped (**builder's call**).

**A set-menu discount when every dish placed in its set menu moves**: it moves with them and
attaches to the set menu the destination's grouping forms from those dishes, if one of that type
holds them; otherwise it is flagged there (**watcher's proposal**, carrying over plan D51).

### 6.5 What the bill shows before the invoice

The total shown is the stored lines (set menus worked out, at their undiscounted prices) less what
the one shared function works out for every discount now. That function is the same one the
invoice uses (7.2), so the shown total equals the invoice total to the cent (anti-goal 3). The
server answers it in every bill read; the till draws it and runs the same function, from a shared
package, only to preview dishes not yet sent, as it already does for set menus (spec of 24 Nov,
section 2) (**watcher's proposal**).

Each discount is drawn under its target: under the dish or extra, under the set menu in the
set-menu summary, or at the foot for the whole bill, with its value and what it takes off now
("10%  −2.20", "Discount 10.00  −10.00"). Screen design is A1515-4's; the till does not draw
discounts this way today.

Everything that reads "what the bill owes" before the invoice must go through it. Known readers
(read, not exhaustive; the builder lists the rest by following each caller): `totalBeforeEdit`
(`stored-order-lines.ts:280`); the comp window's before-and-after total (`billTotalOf`,
`apps/server/src/adjustment-bill-total.ts:38`); the simplified-invoice limit
(`refuseOrderOverSimplifiedLimit`, imported in `adjustments-apply.ts:101`); the bill's figures for
payments and what is still owed (`billOwes` and `stillOwedOnIssuedBill`, `meal-end.ts:102`, `:125`);
Pay for items' prices for the chosen items and what is left behind (`totalOnOwnBill`,
`totalLeftBehind`, `set-menu-regroup.ts:319-359`); equal splits; the party and counter reads the
till gets; and the two checks that a bill never comes to less than its money,
`assertBillInvariant` (`bill-payments.ts:466`) and `refuseBelowAdvances`
(`bill-advances.ts:372`).

**When the shown total falls below money already taken** (a discount added after a part payment,
or a cancel with a whole-bill amount still standing), the bill is overpaid and goes to the existing
give-back-or-keep-as-tip flow (**owner**, 24 November, spec of 24 Nov §7: "if we end up with too
much money on that bill, we can give a refund or change or take a tip"). An edit that would take
it below its advance tickets is refused as today, the check reading the shown total; the waiter
can remove the discount first (**watcher's proposal**).

**Removing a discount is always allowed**, even when it takes a simplified-invoice bill over its
limit; the edit-time refusal (`refuseOrderOverSimplifiedLimit`, `stored-order-lines.ts:289`) does
not apply to a removal, and the invoice's own refusal (`sale.total_exceeds_simplified_limit`,
`packages/core/src/simplified-limit.ts:7-13`) asks for a full invoice as for any bill over the
limit (**watcher's proposal**).

### 6.6 The check before the invoice

A discount **no longer holds** when (**owner** for the first two kinds' existence; the list is the
**watcher's proposal**):

1. its set menu's row is gone (the grouping broke that set menu up or formed it differently);
2. a condition of its own fails (none exist today; the "10% on bills over 100€" kind, if built);
3. an amount is now larger than what its target costs, so it would be cut down (the bill shrank
   below a 10€ discount).

While one stands, the bill shows it marked as no longer applying (kinds 1 and 2 take nothing off;
kind 3 takes what its target costs) (**watcher's proposal**).

**When it is asked** (**owner**: "we alert the waiter to this just before creating the invoice
and ask if they want to remove it or replace it with a different discount"). Every request that
would make the invoice now is refused with one code (named for the domain, **builder's call**)
that lists the discounts that no longer hold, before any money moves: a payment that would complete
the bill, cash or card (checked when the card payment is started, not when it comes back); printing
the bill; Pay for items, for the new bill; a counter sale; marking that a guest left without
paying. The till shows each one:

> "The 50% off the Menú del día no longer applies: that set menu is no longer on the bill."
> **Remove it** · **Give a different discount**

Remove deletes it; Give a different discount opens the comp window on the bill (or on the dish, set
menu or extra the till can still find), and saving the new one removes the old. Then the waiter
presses Pay or Print again (**watcher's proposal**). Bill edits on an open bill are refused while
a card part payment is pending (`refusePendingPartPayment`,
`apps/server/src/working-order-edit-state.ts:236-244`, read). Adding and removing discounts must
go through the same refusal, and the builder checks by a test that no other edit can make a
discount stop holding between the check and the invoice; if one can, that invoice crystallises as
in the next paragraph.

**Invoices nobody is asked about** (the close of day, a deferred close, a held card payment whose
money has already moved, `issueHeldBill`, `bill-payments.ts:1290`): the discount crystallises as
it stands, so kinds 1 and 2 take nothing and kind 3 takes its target to zero, and an activity entry
says so (**watcher's proposal**).

### 6.7 Set menus

- The grouping runs on undiscounted prices and never looks at discounts, except that a dish with
  its own discount stays out of it (spec of 24 Nov §6) and, between equally cheap answers, the one
  that keeps a discounted set-menu row is preferred, so a discount is not lost for no saving
  (**watcher's proposal**).
- Nothing freezes a set menu because of a discount any more. Freezing by a cancel that kept its
  charge, and by a service cancellation, stays (`set-menu-freeze.ts:25-40`).
- A whole-bill discount is shared at the invoice over what each line is charged, so a dish charged
  0.00 inside its set menu takes none of it and the set-menu row takes the set menu's part. This is
  the owner's point of 27 November ~10:50: "the discount can be applied to the set menu, not to the
  dishes covered by it" (lane B `questions.md`, "WATCHER 2026-11-27 10:50").
- A set menu carries one discount of its own: a second replaces the first and the till says so
  (**owner**, 24 November, spec §6, the 11:21 note). A dish can carry several, each taken off what
  is left after the earlier ones (**owner**: "the staff could add a further discount on that line").

## 7. Crystallising

### 7.1 When

When the invoice is made, in the same transaction, after the check in 6.6 and before the invoice
is priced (**owner**: payment, Pay for items' own invoice, or printing the bill, "yes"). If the
invoice fails to issue, the transaction rolls back and the discounts stay as they were.

### 7.2 How each discount is worked out (watcher's proposal)

1. **Order.** Extras' discounts, then dishes', then set menus', then the whole bill's; within one
   target, Free first (Q1), then in the order they were given. Each is worked out on what its
   target costs after the ones before it. So a percentage on the whole bill is a percentage of
   the bill after the dishes' own discounts, and its set menus are worked out first (the owner's
   25 November example: "the set menus are worked out first, then the discount", lane B
   `questions.md`, 20:02).
2. **How much.** A percentage: that percentage of what its target costs now, rounded half up to the
   cent, as today. An amount: the amount, cut down to what its target costs now (kind 3 in 6.6).
3. **Shared over the target's lines** in proportion to what each is charged, by today's
   `spreadBillDiscount` rule: shares rounded down to the cent, the cents left over to the largest
   remainders, a tie to the lower line number; a line of several units split into two rows at two
   prices when its share does not divide into whole cents per unit.
4. **Written** as today's apply writes a discount: the lines' prices lowered and their list price
   kept, one `adjustments` row per discount (its `line_id` the dish, extra or set-menu row it was
   given on, null for the whole bill) and its `adjustment_lines`. Then the pending row is deleted.

The shown total (6.5) is steps 1 to 3 without step 4, so the two cannot differ.

### 7.3 Worked examples (arithmetic on the rules above, not run)

**The owner's two items.** A 50.00 bill with 10.00 off the whole bill shows 40.00. Two items
costing 15.00 are paid for alone: the new bill shows 15.00 − 3.00 = 12.00; the first shows 35.00 −
7.00 = 28.00.

**A cancel that changes the set menus** (lane B's bill of 25 November 20:20). Soup 6.00 and Hake
16.00 make a Daily at 14.00; Wine 8.00; 5.00 off the bill: 22.00 − 5.00 = 17.00. At the invoice the
5.00 is shared over the Daily row 14.00 and the Wine 8.00: 3.18 and 1.81, the left-over cent to the
Wine's larger remainder, so 3.18 and 1.82 (the same figures lane B's probe printed with the real
functions, "LANE B 2026-11-25 20:20"). The Soup is cancelled first: the Hake alone is still a
Daily, so the bill stays 14.00 + 8.00 − 5.00 = 17.00. Under the 3c plan it would have gone to 17.87
(D60).

**Pay for the Hake alone on the same bill.** New bill: a lone Hake is a Daily, 14.00. Left: Soup
6.00 + Wine 8.00 = 14.00. The 5.00 splits 14 : 14, so 2.50 each: 11.50 and 11.50. The two bills
together rise by 6.00 because the Daily broke up, as they would without a discount (22.00 to
28.00).

**The burger.** Burger 12.00 with Chips +2.00. 10% on the burger takes 1.40, and covers Onion rings
+1.50 added later (1.55). 2.00 off the burger stays 2.00, shared 1.71 and 0.29. Free on the Chips
goes when the Chips are removed. Changed to the half burger at 8.00: 10% follows (0.80); the
2.00 off asks keep or remove.

## 8. Reopen to split and other paths after the invoice

Reopen to split credits the printed ticket and copies its dishes to a new open bill
(`copyBillDishes`, `apps/server/src/split-after-print.ts:366-403`), carrying each line's
crystallised reductions with it (`carryLineReductions`, `order-portions.ts:144-171`). Under this
model the copies take their **list** prices and the printed bill's discounts are given again as
discounts on the new bill, on the same targets (mapped to the copies), with the same kind, value,
reason and approver, so the reopened bill behaves like any open bill (**watcher's proposal**). The
adjustments report must count such a discount once: the new crystallised record names the one it
gives again (today's `reapplies_adjustment_id`, `adjustments.ts:80-81`, repurposed) and the report
counts only the latest (**builder's call** on the mechanism; counting once is the requirement).

Refunds, Cancel and refund, corrections of an invoice and the corrections report read crystallised
records and line prices as they do today; nothing changes there.

## 9. Reports, receipt, refunds

- **Adjustments report**: counts crystallised discounts only. A discount removed before the
  invoice cost nothing and is not in it; an activity entry records that it was given and removed
  (**watcher's proposal**). The rule that leaves out a discount that came off (#4441, D55) goes
  with the endings.
- **Receipt and full invoice**: unchanged. Because every discount is written at once and nothing
  leaves the bill afterwards, the receipt's add-up check (`receipt-adjustments.ts:282`) holds and
  it prints each discount under its dish or at the foot, as today; it falls back to per-dish lines
  only where it does today.
- **Refunds and corrections**: unchanged (section 8).

## 10. Permissions

What exists (`packages/adjustments/src/permissions.ts:3-7`): `adjustment.apply` (staff,
supervisor, manager by default) gives comps and discounts; `adjustment.approve` (supervisor,
manager) approves one past a limit with a PIN; `adjustment.manage` (manager) edits reasons.

- Adding or replacing: as today, `adjustment.apply` plus a PIN when the reason's or the bill's
  limit asks for one.
- Removing (staff, or the check's Remove): `adjustment.apply`, no PIN; removing only raises what the
  guest pays (**watcher's proposal**).
- Each new till route is a profile action like any other: it gets refusing cases and inventory
  rows in `apps/server/src/till-api.profile-actions.test.ts` (CLAUDE.md §3).

## 11. What already landed: kept, replaced, removed

No venue is live, so stored discount data is reset, not carried (CLAUDE.md §3).

| Piece | Fate |
| --- | --- |
| 3a (#4361): a dish with its own comp or discount leaves its set menu and is charged à la carte; the comp window shows "The bill goes from €14.00 to €20.40" | **Kept** as behaviour, driven by the new rows instead of `adjustment_lines` |
| 3a: an extra's own discount leaves its dish in its set menu (D34) | **Kept** |
| 3b1: a set menu's discount covers its supplements; a second replaces the first | **Kept** |
| 3b1: a discounted set menu is frozen; a dish leaving it ends the discount with a notice | **Replaced**: no freeze; the discount stays and is asked about before the invoice (6.6) |
| 3b1: a whole discounted set menu moved keeps its discount (D51) | **Kept**, as 6.4's last paragraph |
| 3b1.4: a free takeaway set menu can be refunded | **Kept** (after the invoice) |
| 3b2 (#4441): a dish's discount comes off with a notice when its extras or variant change | **Replaced** by 6.4: extras never ask; a variant change asks only for an amount |
| 3b2: `discountNotices`, `reapplies` on the comp window, the notice index | **Removed** (the till never drew them) |
| 3b1/3b2: `adjustment_endings`, `adjustment_ending_lines`, `endAdjustment`, the readers that leave ended rows out | **Removed** |
| 3b2: the report leaves out what came off (D55) | **Removed**; the report counts crystallised records |
| Rule C (26 Nov): every discount is an amount, a percentage turned into one when given | **Replaced** (**owner**) |
| 25 Nov answers (D38): a percentage covers dishes ordered later; a guest paying for their own dishes keeps their part | **Kept** (**owner**) |
| 25 Nov answer (D38) example 3: a cancelled dish takes its part of a fixed amount (5.00 off Burger 12.00 and Wine 8.00, Burger cancelled: 6.00 left) | **Replaced**: the 5.00 stays whole, 3.00 left (6.4, the owner's 27 Nov words); the owner's question Q2 confirms |
| The 3c plan, its D60–D63, its 3c-1 branch (unpushed, held by the watcher at 11:17) and `backup/a1515-3c-shares-5e90544ac4` | **Dropped** |
| Spec of 24 Nov §6, "Whole-bill discounts" and "On a set menu" freezing | **Replaced** by this document; a dated pointer is added there |

## 12. Surfaces touched

**Server**: the new table and its writer; the shared working-out function (a pure module, shared
with the till); the comp window's preview and apply for comps and discounts (`adjustments-api.ts`,
`adjustments-apply.ts`), now writing a pending row instead of prices; a remove route; every invoice
path in section 4 crystallising first; the check's refusal on the paths in 6.6; Move dishes, table
split, merge and Pay for items carrying shares; the held-order save asking about an amount on a
swapped variant (`saveHeldOrderIn`, `apps/server/src/working-order-held-write.ts:110`); Reopen to
split; the grouping (no discount freeze, the dish exclusion read from the new rows, the tie-break);
every "what is owed" reader in 6.5; removing the endings, notices and freeze code; the guide's comps
section in English and Spanish (CLAUDE.md §3).

**Till** (A1515-4 or its own piece): the comp window (`apps/till/src/widgets/adjustment-dialog.ts`)
adds a pending discount and can target an extra and a set menu; each discount is drawn under its
target with a way to remove it; the check's dialog before Pay, Print and Pay for items; the
keep-or-remove question on a variant change; the totals from the server's answer.

**Dashboard**: the adjustments report's help text, if it mentions discounts that came off
(`packages/adjustments/src/dashboard/adjustment-report-screen.ts`). The reasons screen is
unchanged unless the owner answers Q3 yes.

## 13. Fiscal check

Nothing touches `computeHuella`, the chain, numbering or the record builders. What is filed is
priced from stored lines exactly as today; only the moment the discount is written into them moves
from "when given" to "just before the invoice". Two things change what a filed invoice can hold:
a percentage now covers dishes ordered after it was given, and a whole-bill amount no longer leaves
with a cancelled dish. Both are the owner's. The golden huella test and `inmutabilidad` must pass
unedited. The pieces touching the invoice paths take the full review and the owner lands them.

## 14. Questions only the owner can answer: answered 2026-11-27

The owner's answers (~11:58 CET), which the rest of this document follows:

- **Q1:** "yes": Free joins the model now.
- **Q2:** settled by the owner's own words the same morning ("We remove the 10€ discount from the
  bill, we recalculate the set menu grouping, then we reapply the 10€"): a whole-bill amount stays
  whole when a dish is cancelled.
- **Q3:** "agreed": no condition rule now; the check before the invoice leaves room for one.
- **Q4:** "if we move items from a bill with a 10% discount on the bill to a new bill that already
  contains other items, then we don't want to apply the 10% discount to those items. Instead: the
  origin bill has a 10% discount against the bill, we move two items: to a new bill - carry over
  the 10% discount on the bill; to an existing bill with other items - calculate the amount and
  apply it to the individual items that move." So the share is an amount on each moved item
  (section 6.4), not an amount on the destination bill.

The questions as they were put:

- **Q1. Free.** "We'll leave 100% comps for later": does Free join this model now, or stay as
  today, written into the price at once? Example: Free on a burger, then Chips are added. Joined
  (recommended): Free covers the Chips too, it can be removed until the invoice, and the old repair
  code (endings, notices, the discount freeze) goes entirely. Kept as today: the Chips are charged,
  and that repair code stays for Free alone.
- **Q2. A cancel on a bill with an amount off.** On 25 November you chose that a cancelled dish
  takes its part of a fixed amount with it (Burger 12.00, Wine 8.00, 5.00 off; Burger cancelled:
  6.00 left). Today's "we reapply the 10€" reads as the opposite: the 5.00 stays whole and 3.00 is
  left. Recommended: the 5.00 stays whole, so a cancel never makes the guest's share of a discount
  smaller; moves and Pay for items still take their share.
- **Q3. Discounts with a condition** ("10% on bills over 100€"). Should a reason be able to carry a
  minimum bill now? Recommended: not now; the check before the invoice is built so one can be
  added later without changing it.
- **Q4. Items carrying a whole-bill 10% moved to a bill that already exists.** Example: Table 4 has
  10% off; two of its drinks move to Table 7, which has none. Recommended: the drinks' 10% is worked
  out at the move (say 0.80) and arrives on Table 7 as 0.80 off its bill. The alternative keeps a
  10% on just those drinks, which needs a fifth kind of target ("these lines from another bill").

## 15. Pieces, for planning (watcher's proposal)

1. **Server: pending discounts and crystallising.** The table, the working-out function, the comp
   window writing pending rows, remove, crystallising on every invoice path, the "what is owed"
   readers, the check's refusal, Reopen to split. Removes endings, notices and the discount freeze.
   Resets venues. Fiscal: the owner lands it.
2. **Server: moves.** Shares on Move dishes, table split, merge, Pay for items and its put-back; a
   set-menu discount moving with all its dishes; the held-order variant question.
3. **Till.** Section 12's till list, with A1515-4.
4. **Guides and demo.** The comps section in both languages; the demo's discounted bills.

## 16. Builder check

A fresh reader was asked, without this conversation, what it would still need answered to plan
this; it read the document and the code it cites and ran nothing. Its four questions, sorted:

- **Answered in the document:** how Free works (section 2's assumption, and Q1); what happens when
  the shown total falls below money already taken, and to the advance check (6.5); whether removing
  a discount may take a simplified-invoice bill over its limit (6.5); whether a guest leaving
  without paying is asked first (6.6, yes).
- **Minor, settled as the watcher's proposal:** the last three of those.
- **The owner's:** Free, as Q1. Q2 to Q4 come from the writer's own reading.
