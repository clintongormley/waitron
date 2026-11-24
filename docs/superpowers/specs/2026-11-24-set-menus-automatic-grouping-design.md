# Set menus worked out by the bill (A1515 rework): design

Status: approved by the owner in conversation, 24 November 2026 ("y"), after reading the list of
the writer's calls; those stay marked **my call** below. Replaces the ordering and placing parts of the
[set-menus design of 17 November](2026-11-17-set-menus-design.md) (sections 2 and 3, and the parts
of 1 and 4 named below). What that design built and this one keeps is listed under "What stays".

Decisions marked **owner** were made by the owner in conversation on 24 November 2026 unless
another date is given. Decisions marked **my call** are the writer's, for the owner to check.
Statements about today's code cite `file:line` on `main` at `5a7ee61425` and come from reading the
code, not from running it.

## Why

The owner, 24 November: "A product should be a product. So it doesn't matter how you order it, you
get the same meal." The 17 November design let a set menu change a dish: its course (a tapa
counted as a starter), and which set menu it belonged to depended on the counts the waiter had set.
The waiter had to say how many set menus of each type a table was having, and was asked a question
whenever a dish had no place.

The new model: the waiter only adds dishes. The bill works out the cheapest way to charge them,
some grouped into set menus and the rest à la carte, and keeps working it out as the order changes.

## The model in one paragraph

A **set menu** has a price, a list of what one set menu includes ("1 starter, 1 main or starter,
1 dessert or coffee"), and the dishes it accepts, each included or carrying a supplement. A dish
keeps its own course, its own portion and its own à la carte price however it is ordered. The
waiter adds dishes to the order from anywhere on the till. Whenever the order changes, the server
works out the cheapest way to charge every dish on the bill: how many set menus of each type, which
dishes go in each, and which stay à la carte. It saves that answer. The bill, the receipt and the
invoice show the set menus, the supplements and the à la carte dishes.

## Goals

1. The waiter never says how many set menus a table has, and never says which set menu a dish
   belongs to (**owner**).
2. The customer always pays the cheapest way the bill's dishes can be charged, given the set menus
   linked to the bill (**owner**: "provide the most economic solution").
3. A dish is the same dish in or out of a set menu: same course, same portion, same options, extras
   and variants, same kitchen behaviour (**owner**).
4. Anyone at the till can see the grouping and check the sum (**owner**: "If you expand that, then
   you can see what dish is going into each of those menus").
5. Paying for some items stays one flow on the till: Pay > Items > choose > Cash or card, and the
   receipt prints (**owner**).

## Non-goals

- Knowing who ate what. The cheapest grouping may put one guest's starter and another guest's main
  in one set menu. "The only time it matters who ate what is when you're moving dishes to a
  separate bill" (**owner**). Guests who want to be charged apart are split onto their own bills.
- A waiter override that forces a dish in or out of a set menu. Nothing asked for one, and the
  cheapest answer is always the customer's preference (**my call**). A discount on a single dish is
  the one way a dish leaves the grouping (below).
- A set menu changing a dish's course (**owner**: "we don't reassign courses in the set menu").

## Anti-goals: what would make this a failure even if it worked

- A sale is blocked, or a dish refused, because of set menus. A dish that fits no set menu is simply
  charged à la carte.
- Two tills at the same table show different totals.
- The total changes when nothing on the bill changed (a menu republished, a period ending, the
  calculation re-run).
- The grouping shuffles dishes between set menus for no saving, so the unfolded summary jumps about
  as the table orders.

## Approaches considered

The owner chose **1** on 24 November ("yes").

1. **The server works out the grouping on every change and saves it (chosen).** Each time a dish is
   sent, cancelled, moved, discounted or comped, or a menu discount is given or removed, the server
   reruns the calculation for that bill. In the same transaction it rewrites the bill's set-menu
   lines and each dish's place and charged price. The till runs the same shared function to preview
   dishes not yet sent. Every till, the printed bill, payments, the invoice and the reports read one
   saved answer. The cost: a second writer of a line's price. Today a line's price is already
   rewritten after it is on the bill, by every comp and discount (`apps/server/src/adjustments-apply.ts:1262,1292`,
   with the original kept in `list_unit_price_gross`, `packages/db/src/schema/orders.ts:267-269`)
   and by set-menu moves (`apps/server/src/set-menu-moves.ts:115-124`). The regrouping and the
   adjustments must agree on who writes what (section 6).
2. **Work it out only when someone looks, and save it only at payment.** Nothing is rewritten, but
   every screen and printout runs the calculation itself. Two tills could disagree, and a
   republished menu or a new release could change an open bill's total. Wrong for a bill whose
   invoice is filed.
3. **Each till decides and the server checks.** Ruled out: several tills share a table, so the
   server has to be the one authority.

## The parts, as decided

### 1. Setting up a set menu (dashboard)

What stays from the 17 November design: a set menu is a kind of menu, placed in a full menu's tree
and copied in when that full menu is published. Its editor has its name and price, the dishes it
accepts and what one set menu includes. A dish can carry a supplement, and a product with variants
can have some variants left out (the glass of wine but not the bottle).

What changes:

- **No course per set menu.** The per-dish course override goes (the "tapa as a starter" rule of
  18 November, now withdrawn by the **owner**), with its storage (`set_menu_dish_courses`,
  `packages/db/src/schema/menu/set-menus.ts:59-68`). Each dish counts as its product's course. A
  dish with no course, or whose course no line of the set menu accepts, still stops the full menu
  being published, since it could never be covered.
- **What a dish counts as.** Its product's course, always. The course a waiter picks for a line on
  the till (the per-line course choice, `apps/till/src/i18n/strings.ts:1326-1328`) changes only
  when it is sent, never which place it fills (**owner**, 18 November: "classification is fixed";
  24 November: "we don't reassign courses in the set menu").
- **A listed dish must have an à la carte price.** When a dish is not covered it is charged its à
  la carte price. That price, and the line details copied with it (department, VAT, category,
  unit, `packages/db/src/schema/orders.ts:270-293`), come from the full menu holding the set menu:
  its own ordinary offer of the dish if it has one, otherwise the product's own price (and the
  variant's, where variants carry prices), whichever folder the dish was tapped in (**my call**).
  A set menu listing a dish that ends up with no price that way (`products.unit_price` is
  nullable, `packages/db/src/schema/menus.ts:132`) stops that full menu being published (**my
  call**).
- **VAT.** Set menus have no VAT settings of their own, as the [VAT rates
  design](2026-11-21-vat-rates-design.md) already says (lane L's piece B removes the fields).

### 2. Ordering on the till

- **The waiter adds dishes.** From an à la carte folder, a set-menu folder, search, anywhere. Where
  a dish was found never matters (**owner**: "it doesn't matter where they come from").
- **Set-menu folders stay** as a place to find dishes, laid out by the set menu's lines, each dish
  showing "included" or its supplement in that set menu (**my call**).
- **Gone from the till:** the count per set-menu type and its − and + buttons, **Add a Menú
  especial**, the "No place for this dish" question with its suggested moves, and removing an empty
  set menu. None of these mean anything once the bill does the grouping.
- **The summary.** At the top of the order, one folded line with the bill's set menus. Unfolded, it
  shows which dishes are in each set menu and which are à la carte (**owner**):

  ```text
  3 × Menú del día · 1 × Menú especial                     ▾ show
    Menú del día    Soup · Hake · Flan
    Menú del día    Salad · Sirloin +5.00 · Coffee
    Menú del día    Soup · Chicken · (dessert open)
    Menú especial   Croquetas · Sea bass · Cheesecake
    À la carte      Croquetas  8.00
  ```

- **The dish list stays** as today, by course, for sending, firing, cancelling and moving. Each
  dish shows a small tag: in a set menu, or its supplement, or its à la carte price (**my call**).
  The tag can change as the table orders.
- **What counts, and what is previewed.** Every dish on the bill counts towards the saved
  grouping, sent to the kitchen or not: at the counter and for takeaway, a dish is on the bill as
  soon as it is added and can be paid before it is sent
  (`apps/server/src/working-order.ts:7712-7720`). At a table, dishes the waiter has added but not
  yet sent sit in the bill's draft (one open draft per bill, `order_drafts`,
  `packages/db/src/schema/order-drafts.ts`) and are not yet charged; the till shows the grouping
  as it would be with them, and it is saved once they are sent (**my call**).

### 3. Which set menus a bill can use

- **Ordering a dish links every set menu that lists it** and is on sale in the bill's zone at that
  moment. A dish on two set menus links both (**owner**). The bill records the newest copy of each
  linked set menu, with its price, and keeps it until the bill closes (as the 17 November design's
  recorded copy, `packages/venue-service/src/set-menu-copies.ts`).
- **A linked set menu stays usable** after its period ends, so a table that sat down at 15:30 can
  still have the lunch menu with desserts ordered at 16:15 (**owner**, "yes").
  _Changed later on 24 November by the [last orders design](2026-11-24-last-orders-per-station-design.md),
  section 6: the price and grouping stay, but whether a dish can still be ordered follows its station's
  last orders._
- **A dish moved to another bill brings its links**, so a guest's split-off bill can use the same
  set menus at the same prices (**my call**).

### 4. The calculation

**24 November 2026, 11:21 watcher note relaying the owner:** Takeaway dishes may group across VAT
rates. Divide the set menu's price across its dishes in proportion to their à la carte prices and
apply each dish's own takeaway VAT rate. VAT-rates piece B handles that division.

A shared function, the same in the till and the server, extending the one on `main`
(`packages/shared/src/set-menu-fit.ts`, `set-menu-search.ts`, `set-menu-placement.ts`). Today it
places dishes into a number of set menus fixed by the waiter. It has to:

- **choose how many set menus of each linked type** to form, from none upwards;
- **let a dish stay à la carte** at its stored à la carte price;
- charge each set menu its recorded price, less any menu discount on it (section 6), each
  supplement where a dish fills a place that carries one, and every dish left out at its à la carte
  price. Paid extras on a dish are charged as usual whether or not the dish is in a set menu;
- leave out of the grouping every dish carrying a comp or discount of its own (section 6);
- use the same grouping rules for eat-in and takeaway;
- between equally cheap answers, keep the one closest to the saved grouping, so dishes do not jump
  between set menus for no saving. The function on `main` already prefers the arrangement closest to
  the current one;
- **never block a sale.** If a bill is too large to search fully, the function still returns a
  valid answer, and the summary says it may not be the cheapest (**my call**).

**24 November 2026, piece 2 search limit (watcher, 13:06):** At the search limit, compare a grouping
that starts from the saved places with one that starts fresh. Keep the cheaper bill, with ties
going to the saved places. The calculation searches more combinations for up to 60 eligible
portions and five price choices. All 96 sampled bills for 16–20 diners with five offers and 24
diners with four offers matched the cheapest prices the longer search proved. Beyond the raised
limit, a bill can still cost about €10 more than the cheapest. In 24 sampled bills for 21 diners
with five offers, the largest gaps were €10.08 ordered together and €9.36 ordered course by course.

A set menu with an empty place still costs its full price. So removing a dish (a cancel, a comp, a
move away) can never make the cheapest answer dearer, and adding a dish can never make it cheaper.
A discount on a single dish can make the bill dearer (section 6).

### 5. What is saved

On every change the server reruns the calculation and, in the same transaction:

- writes one line per set menu formed, with its type, recorded copy and price;
- writes on each dish whether it is in a set menu, and which, and its charged price: 0, its
  supplement or its à la carte price;
- keeps on each dish its à la carte price, stored once when it is added (section 1). This is new
  for a dish tapped in a set-menu folder: today such a line stores the set menu's supplement and no
  à la carte price (`packages/db/src/schema/menu/menu.ts:6`);
  _Pointer, 2026-11-24: stored in `working_order_lines.a_la_carte_unit_price` (A1515-3 PR 1)._
- credits each set menu, in staff sales, to whoever rang the earliest-added dish in it (**my
  call**; each line records `credited_to`, and a set menu formed from two waiters' dishes has no
  other obvious owner).

What triggers a rerun: a dish sent, cancelled or edited; dishes moved in or out; a comp or
discount added or removed, on a dish or a set menu; a set menu newly linked. Nothing else changes
the saved answer: not a republished menu, not a period ending.

The till reads the saved answer. The set-menu lines are written by the calculation alone and cannot
be cancelled or edited by hand.

### 6. Comps and discounts

- **On a single dish:** the dish leaves the grouping and is charged à la carte, less its discount
  (**owner**: "An individual dish with a discount gets treated as a la carte"). The rest of the bill
  is grouped again without it. The owner's example: soup, two hakes and a dessert are one set menu
  and one à la carte hake, and the venue takes 50% off the à la carte hake. Before a dish discount is
  saved, the till shows the bill's new total, since it can rise: a set menu of soup (6.00), hake
  (15.00) and flan (5.00) at 14.00 becomes 7.50 + 11.00 = 18.50 if the hake is discounted by half
  (**my call**).
- **On a set menu:** the discount applies to that set menu's price (**owner**: "you would apply it
  to the menu, not to the individual dishes"). Its dishes are not locked in (**owner**: "why do we
  need to lock the dishes in? we just take 50% off one menu"). The discount belongs to one set menu
  of that type on the bill; the calculation counts that one as cheaper, so it does not break it up
  for no reason. If the bill ends up with no set menu of that type, the discount falls away and the
  till says so (**my call**).
- **24 November 2026, 11:21 watcher note relaying the owner:** A set menu carries one discount.
  A new discount replaces the old one and the till says so. If two discounted menus of the same
  type become one, keep the larger saving in cents and tell staff which discount fell away.
- **Comps** work the same way: a comped dish leaves the grouping; a comped set menu is one set menu
  of that type at no charge.
- **What a set-menu comp or discount covers:** the set menu's price and the supplements of the
  dishes in it, as the guest sees "the menu"; not the paid extras on those dishes (**my call**).
- **Whole-bill discounts** are not a dish's own discount: a dish's share of one never takes it out
  of the grouping (today's check for "this dish carries a discount", `adjustedDishIds` and
  `reducedLineIds`, `apps/server/src/set-menu-bill.ts:262-299`, counts it, and must stop). A
  percentage stays that percentage of the bill as it is regrouped; a fixed amount stays that
  amount, spread again over the bill's charged lines (`apps/server/src/adjustments-apply.ts:417-432`,
  `:455-510`) whenever the grouping changes (**my call**). How that is stored, given that
  `adjustment_lines` is only ever added to, is the builder's, and the plan says it.

### 7. Moving dishes and paying for some items

- **Moving dishes.** Dishes move to another bill one by one, with their own comps and discounts
  (**owner**, "Could we move any discount on the dishes with them?"). Both bills are grouped again.
  For an ordinary dish this is what happens today (`apps/server/src/working-order.ts:4397-4406`).
  The refusal that stops a discounted set-menu dish moving alone (`set_menu.move_adjusted`,
  `apps/server/src/set-menu-moves.ts:96-99`) goes, and so does moving "a set menu with its dishes".
  A discount given on a set menu stays on the bill it was given on (**my call**).
- **Paying for some items: the same till flow, a different server behaviour.** Today the paid items
  stay on the table's bill, marked paid by the payment's own records
  (`apps/server/src/bill-payments.ts:1969-1997`, `:476-500`). The owner's rule: Pay > Items > choose
  x, y, z > Cash creates a new bill, moves the chosen items onto it, takes the payment, closes it
  with its own invoice and prints its receipt, in one go (**owner**). Both bills are grouped again.
  - The pay screen lists dishes, not set menus, and shows what the chosen items will cost on their
    own bill before the guest pays: splitting can break up a set menu, so the two bills together
    can cost more (**my call**).
  - If the card is declined or the waiter cancels, the items go back to the table's bill as if
    nothing had happened (**my call**). While the card result is awaited, the items are on the new
    bill and the table's bill shows them as being paid; they cannot go back until the card
    terminal's request has ended, and the new bill's invoice is issued only when its payment is
    received, as today's whole-bill payment does (`issueWhenFullyPaid`,
    `apps/server/src/bill-payments.ts:1067,1084`) (**my call**).
  - Paying for part of a line (one of three beers on one line) needs part of a line moved to
    another bill. Today a line is split only within its own bill (`working-order.ts:5110`), so this
    is new.
  - A bill that has already been printed has issued its ticket, so paying for some of its items
    also takes the ticket back (the adviser: "Either a cancellation or correction is acceptable
    here", `docs/compliance/2026-11-19-adviser-meeting.md:116`). It is built in the same flow
    (**owner**, 24 November: "let's just get it built"). **Reopen to split** already does the
    fiscal part (#3876, `apps/server/src/split-after-print.ts`): a whole credit note for the
    printed ticket and copies of its dishes on a new open bill. Pay for items on a printed bill runs
    that first, then moves the chosen items to their own bill as above. Reopen to split refuses
    four cases today (`apps/server/src/split-after-print.ts:57-63,89-109`): a bill not at a table;
    a bill with money already taken (D3); a dish printed with Print anyway and not yet served; and
    anyone without the right to correct a sale, unless an approver enters a PIN (D1). D1 and D3 were
    the lane watcher's choices (`docs/backlog/fiscal.md:1146-1156`). The owner, 24 November:
    - **No PIN**, for Pay for items and for Reopen to split alike (**owner**, "1 A"). Nothing goes
      uncharged: every dish on the credited ticket lands on a bill that must still be paid.
    - **A part-paid printed bill can be split** (**owner**, "2 B - we just remove the items
      somebody wants to pay, and the paid amount remains against the original bill. if we end up
      with too much money on that bill, we can give a refund or change or take a tip"). The chosen
      items move to their own bill and are paid there; the money already taken stays with the
      table's remaining bill, counted towards it. When that bill then owes less than it has been
      paid, the till offers to give the difference back (change for cash, a refund for a card) or
      keep it as a tip.

    The other two refusals stay: a counter bill is paid at once, and the unserved refusal already
    offers **Mark served** (**my call**).
  - Paying an amount, or splitting equally, stays a part payment on the same bill, with the advance
    ticket for a payer who wants their own receipt, as today.
  - What this removes: the "items" kind of payment and its per-line records, the per-line paid
    sums, the guards against editing or moving a paid line (`bill.line_paid`), and the advance
    ticket for an items payer. Afterwards an open bill never holds anything paid for by item, so
    the regrouping never has to work around dishes already paid at a price it would otherwise
    change.

### 8. Where set menus can be sold

- **Tables, takeaway and delivery.** Today a takeaway bill holding a set menu cannot yet be paid,
  comped or discounted (`set_menu.payment_not_ready`, `apps/server/src/set-menu-bill.ts:64-90`)
  until lane L's VAT piece B lands; this design does not change that order.
- **Eat-in orders at the counter** can now form set menus too. The 17 November refusal was the
  owner's ("these set menus are only for tables/bars with seating"); with the bill doing the
  grouping nothing technical needs it, and the owner did not keep it when asked on 24 November
  (**my call** until the owner confirms).

### 9. Bill, receipt, invoice, kitchen and reports

Unchanged from what piece 4 built, except that the counts are worked out:

- The bill, ticket and full invoice list the set menus, the supplements and the à la carte dishes,
  not the covered dishes. Paid extras on a covered dish print.
- The kitchen gets every dish as an ordinary line; set-menu lines are never sent.
- Sales reports show each set menu as an item and covered dishes at 0. They read the lines as saved
  when the sale was issued.
- Nothing about the fiscal record changes: it carries totals per VAT rate, read from the saved
  lines when the invoice is issued.

## What stays from the 17 November design

The set-menu kind of menu, its editor (less the course column), placing it in a full menu,
publishing by copying in, the recorded copy on a bill, variant exclusions and supplements, the
receipt and invoice layout, the kitchen behaviour, reports, and VAT as the VAT rates design sets it.

## The pieces, for planning

1. **Paying for items moves them to a new bill.** Every bill, not only set menus. Includes moving
   part of a line to another bill, putting items back on a failed payment, paying for items on a
   printed bill through Reopen to split (without a PIN, and on a part-paid bill, carrying its money
   over), giving back or keeping as a tip what a bill was overpaid, and removing the "items"
   payment kind. Fiscal: it changes which invoices are issued. Can start now.
2. **The calculation:** choosing counts, à la carte dishes, menu discounts, the takeaway rate rule,
   the closest-to-saved tie-break and the size fallback. Shared code with no screens. Can start now.
3. **The server:** linking set menus when a dish is ordered, rerunning and saving the grouping on
   every change, comps and discounts on dishes and set menus, moves with discounts; removing counts,
   placing at send, the no-place refusal and its moves. Needs 2.
4. **The till:** removing the counts and the no-place question, the summary and tags, the preview,
   the pay-for-items list of dishes with its price on its own bill, menu discounts, the warning
   before a dish discount. Needs 1 and 3.
5. **The dashboard:** removing the course column, the publish check for a listed dish with no price.
   Can go with 3.
6. **Counter eat-in, guides and demo.** Lift the counter refusal; rewrite the products and
   table-service guides in English and Spanish; check the demo's two lunch set menus still make
   sense. Last.

Pieces 1, 3 and 4 touch amounts on invoices, so they take the full review and the owner lands them.
No venue is live, so the stored set-menu data is reset, not carried over.

**Lane L's VAT piece B** removes the set menu's own VAT fields and handles the takeaway price
division in section 4. The owner's 24 November decision retires the mixed-rate refusal.

## Left to the builder

- Table and column names, and how the set-menu lines and dish places are stored.
- How the calculation is extended, within the rules of section 4.
- Error codes, named for the domain (CLAUDE.md §3).
- Screen layout details within the sketches here.
