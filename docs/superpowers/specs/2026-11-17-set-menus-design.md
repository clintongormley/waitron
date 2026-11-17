# Set menus (A1515): design

Status: approved by the owner in conversation, 17 November 2026 ("yes"), after reading the list
of the writer's calls; the calls stay marked **my call** below. Plans: one per piece, under
"The pieces, for planning". Replaces the set-lunch design in
[2026-11-12-a1515-set-lunch-proposal.md](2026-11-12-a1515-set-lunch-proposal.md), whose build is
being removed first (A1515-REMOVE, queued on lane D).

Decisions marked **owner** were made by the owner on 17 November 2026. Decisions marked **my call**
are the writer's, for the owner to check. Statements about today's code cite `file:line` on `main`
at `41ced2592e`; they come from reading the code, not from running it, unless they say otherwise.

## Why

Spanish restaurants sell a fixed-price menu at lunch (the menú del día): "primero, segundo, postre o
café, pan y bebida" for one price, often at more than one price level. The set-lunch build modelled
one lunch as one product with its dishes as extras of it. On a demo stack on 17 November the owner
found that this limits what a diner can choose: a dish picked inside the lunch cannot ask its own
questions (a sirloin's doneness, a burger with or without chips) or take its own paid extras. The
cause is that a lunch's dishes are extras, and an extra carries no options or extras of its own
(`apps/server/src/modifier-selection.ts:31-60,127-166`; confirmed on the demo stack).

The owner's requirement (**owner**): ordering a set menu must be as simple and as flexible as
ordering à la carte: options, extras, variants, courses, holding and firing courses, moving a dish
to another course. A set menu is "a fixed price for one of each of the following".

## The model in one paragraph

A **set menu** is a new kind of menu. It has a price, a list of the dishes it covers (each either
included or carrying a surcharge), and a short list of what one set menu includes, such as "1
starter, 1 main or starter, 1 dessert or coffee, 1 bread, 1 drink". The waiter adds a number of set
menus to a table ("4 set menus") and then orders dishes as ordinary lines, from set-menu folders in
the full menu. Each dish is an ordinary order line with its own options, extras, variant and course.
The bill works out, by itself, the cheapest mix of set-menu types that covers the dishes ordered
(say 3 Menú del día and 1 Menú especial). Each set menu is charged as its own priced line. Covered
dishes cost nothing, a surcharge is charged on its dish, and paid extras are charged as usual.

## Goals

1. A dish ordered as part of a set menu behaves on the till, in the kitchen and on the order exactly
   as the same dish ordered à la carte: options, paid extras, variants, course, firing, moving
   course, cancelling, moving to another bill.
2. The waiter never has to decide which set menu a dish belongs to, or which type of set menu a
   diner is having. The bill finds the cheapest outcome for the customer.
3. A venue can sell several set menus at different prices that share dishes.
4. A table can mix set menus and à la carte dishes on one bill.
5. The waiter can see at any time how the bill is counting the set menus and what is still open.
6. Setting up a set menu on the dashboard is one page: its price, its dishes, and what one set menu
   includes.

## Non-goals

- Tying set menus to diners or seats. The bill counts set menus; it never says which person had
  which (**owner**: "leaning towards optimising, not per person", with the worked example under
  "The fit" below).
- Set menus on counter orders. A set menu goes only on the bill of a seated table: a table in a
  table-service zone, which includes a bar whose stools are set up as tables in such a zone
  (**owner**, 17 November: "these set menus are only for tables/bars with seating"). A counter
  order, eaten in or not, is never offered one. Other dishes are not limited this way: whether a
  standing guest can have a dish is the waiter's call (owner, 17 November).
- Set menus on takeaway or delivery orders, while adviser question T17 is open (see "Counter orders and takeaway").
- A selling schedule of the set menu's own. A set menu sells when the full menu it sits in sells,
  under that menu's existing periods (**owner**, 12 November: "with set menus, having a selling
  times section doesn't make sense - that can already be handled with periods and menus").
- Borrowing dishes across set menus automatically. A set menu covers exactly the dishes it lists
  (**owner**: each set menu lists every dish available to it; the especial lists the del día's
  starters too if it accepts them).
- Bundles or promotions in general (two-for-one, meal deals on takeaway). This design is for
  set menus eaten at the venue only.

## Anti-goals: what would make this a failure even if it worked

- A waiter picking the "wrong" folder costs the customer money (**owner**, folder question, answer
  A: a folder is for finding a dish and does not tie it to that set menu).
- A diner's dish choices are narrower inside a set menu than à la carte.
- The total jumps without the waiter being able to see why.
- Payment is blocked because a set menu has a place nobody filled. A table that orders fewer dishes
  than its set menus allow still pays for every set menu it ordered (**owner**: "fewer than 4 still
  pays for 4").

## Approaches considered

The owner chose **A** on 17 November. The other approaches put to the owner that day are not
recorded in the handover ledger; B and C below are the two this design rules out, written up
afterwards.

- **A. Each set menu is its own priced line; its dishes are ordinary lines (chosen).** The bill
  holds "Menú del día €14.00" lines, and the dishes are ordinary lines priced at 0 or at their
  surcharge. Every à la carte feature works on the dishes unchanged, because they are ordinary
  lines. The new work is the calculation that decides each line's price, and keeping it in step
  as the order changes.
- **B. No set-menu line; the set menu's price is shared out over its dishes.** Each covered dish
  would carry a share of €14. Every change to the order would reprice several lines, receipts would
  show odd prices per dish, and a set menu whose places are not all filled would have nowhere to
  put the rest of its price.
- **C. The set menu's dishes are children of the set-menu line (the set-lunch build).** This is
  what is being removed: the dishes are extras of the set menu, so they cannot carry their own
  options or extras, and each set menu is tied to one diner.

## The parts, as decided

### 1. Setting up a set menu (dashboard)

**Creating one.** On Menus, **Add menu** offers **Menu** or **Set menu** (from the writer's
dashboard mock-ups; the owner reshaped the editor, below, but has not yet said yes to the second
mock-up as a whole, so **my call** until the owner approves this document). A set menu is a menu (a row in `menus`, published as versions in
`menu_versions` the way every menu is, `packages/db/src/schema/menu/publication.ts:12-39`), marked
as a set menu.

**The editor is one page** (**owner**: drop the sections, products and "counts as" tabs of the first
mock-up; dishes first, then the rules). Its parts, in order:

- **Name** and **price per set menu** (gross, with VAT).
- **Dishes this set menu covers.** "Add products" adds products to the list. Adding a product
  that has variants lets the person choose which of its variants the set menu includes, and the
  choice can be changed later (**owner**, 17 November: "when we add products to a set menu we
  should be able to add or exclude variants"; for example the glass of wine but not the bottle).
  All variants start included (**my call**). An included variant costs the dish's surcharge, or
  a surcharge of its own; the à la carte price difference between variants does not apply (**my
  call**; per-variant prices already exist for ordinary menus,
  `packages/db/src/schema/menu/variant-overrides.ts`). So the list is held per product and
  variant, and the till's set-menu folder offers only the included variants. The list groups
  itself under each product's course (the dish's course is set on the product, as today). Beside
  each dish, a **surcharge**: empty means included, an amount means the dish costs that much on
  top of the set menu. **Copy dishes from another set menu** copies another set menu's list, with
  its surcharges, into this one. A product with no course is listed under **No course** with "Give
  it a course on the product to use it here" and a link to the product; a set menu holding one
  cannot be published.
- **What one set menu includes.** A list of lines, each "N × course", where a line may accept more
  than one course ("1 × Mains or Starters", "1 × Desserts or Coffee"). It starts as one line per
  course present among the dishes, each "1 ×"; the person joins courses with "or", removes a line,
  or adds one. On the till, these lines are the headings of the set menu's folder ("Starter",
  "Main or a starter", "Dessert or coffee"). A set menu listing a dish whose course no line accepts
  cannot be published, since that dish could never be covered (**my call**).

**Placing it.** A set menu is put into a full menu's structure, anywhere in its tree, as a member
the way a folder is (from the writer's first dashboard mock-up, which the owner reacted to without
objecting to this part; **my call** until approved). The
till draws it as a folder named after the set menu with its price. It is not an included menu:
included menus share one price per product with the menu that includes them, and a disagreement is
a clash that blocks publishing (`packages/menu/src/menu-combine.ts:4-13,37-41`; refused at
`packages/menu/src/menu-publication.ts:669-671`). Sirloin at €18 à la carte, +€5 on the del día and
included on the especial would clash. So a set-menu member carries its own dish offers, priced by
the set menu, beside the full menu's own offers and never combined with them.

**Publishing.** A set menu is published like any menu. The full menu that holds it shows the set
menu's live version, as it does for an included menu.

**The product's Set lunch switch** is gone (removed by A1515-REMOVE, not by this work).

### 2. Ordering on the till

**The count.** The order panel has a **Set menus − N +** count with no type (**owner**: "yes this
works" for the "4 set menus, the bill picks the cheapest mix" design, whose mock-up put the count
at the top of the Set menus folder; moving it to the order panel, so it does not depend on where
set menus sit in the tree, is **my call**). The waiter sets it to the
number of set menus the table is having. The bill decides each one's type.

**Fixing a type when a table asks.** "We're all having the especial": the waiter can fix one or
more set menus to a type, by adding from the top of that set menu's folder ("Add a Menú especial")
or by choosing a type on a row of the unfolded summary. A fixed set menu keeps its type whatever
the dishes; the rest stay free (**my call** on the two ways in; the owner agreed a waiter "can
still fix a type").

**The folders.** Each set menu's folder is laid out like its board: its lines as headings, the
dishes under them, each showing **included** or its surcharge in that set menu (**owner**: one
folder per set menu, shared dishes appear in each). A dish whose course more than one line accepts
is listed under the first such line (**my call**). Tapping a dish opens exactly what it opens à la
carte: its variants, required options and extras.

**What a set-menu dish is.** A line ordered from a set-menu folder is marked as a set-menu dish.
Which folder it came from does not matter to the bill (**owner**, answer A). The same product
ordered from an à la carte folder is an ordinary à la carte line at its à la carte price, and the
bill never turns it into a set-menu dish (**my call**).

**What a dish counts as.** A set-menu dish counts as its product's course **at the moment it was
ordered**, recorded on the line. Moving it to another course to serve it (a starter served as a
main) changes when it is sent, not what it counts as on the bill (**owner**: "classification is
fixed"). An order line already keeps its course (`course_id`) apart from its firing group
(`group_id`) (`packages/db/src/schema/orders.ts:210-226`); the counts-as course is a third,
separate value.

**A dish the set menus cannot cover.** When a set-menu dish would be left uncovered by the set
menus on the bill (none yet, all places of its kind taken, or it is listed only on a type that the
fixed set menus rule out), the till asks before adding it: "Not covered by the set menus on this
bill. Add a set menu?" The waiter adds one, or orders the dish à la carte instead, or cancels
(**owner**, answer A). The à la carte choice is offered only when the dish is on an à la carte menu
selling in that zone now (**my call**). The server refuses a set-menu dish the bill cannot cover,
so the till's question is a convenience, not the guard (**my call**).

**Swaps.** "An extra starter instead of a main: yes. Two mains instead of a starter: no"
(**owner**). These are just lines that accept more than one course: "1 × Mains or Starters" lets a
second starter take the main's place; nothing lets a main take a starter's place.

**The summary.** Above the order's lines, the set menus are summarised in one line that unfolds
(the owner found the one-row-per-set-menu view clearer but said it needs space "unless it
folds"; the fold is **my call**):

```text
4 set menus · charged as 3 Menú del día + 1 Menú especial          ▾ show
open: 4 Dessert or coffee · 4 Bread · 4 Drink
```

Unfolded, one row per set menu, its places filled with the dish the bill has put there or shown as
open:

```text
Menú del día    Soup · Hake · [Dessert or coffee] · [Bread] · [Drink]
Menú del día    Soup · Sirloin +€5 · [Dessert or coffee] · [Bread] · [Drink]
Menú del día    Soup · Sirloin +€5 · [Dessert or coffee] · [Bread] · [Drink]
Menú especial   Soup · Sea bass · [Dessert or coffee] · [Bread] · [Drink]
```

The rows say how the bill is counting, not who is eating what (**owner** agreed the summary must
show which set menu is still missing a dish; the labelling as "how the bill counts" is the
proposal the owner was answering when approach A was chosen, so **my call** until the owner says
otherwise). When a change moves the mix or moves a dish between set menus, the summary marks what
moved, and a note shows once with the change in total ("Sea bass is only on the Menú especial, so
one set menu is now an especial: +€6.00"), so the waiter can tell the table.

**Order lines** show a set-menu dish in its firing group as today, with a small **menu** tag when
covered or its surcharge ("+€5.00") when it carries one (**my call**, drawn in the till mock-ups; the owner has not said yes to it explicitly).

**Reducing the count.** The count cannot go below the number of set menus the set-menu dishes on
the bill need. The refusal says so and how to fix it: remove a dish first, or order it à la carte
(**my call**).

### 3. The fit: how the bill decides

**What it decides.** Given the set menus on the bill (how many; which are fixed to a type), every
set-menu dish on the bill (its product, variant and counts-as course), and the set menus offered to
the bill (each with price, dishes and surcharges, and lines), the fit chooses:

- a type for each set menu that is not fixed, and
- for each set-menu dish, which set menu covers it and in which of its lines,

so that every dish is covered, no line holds more dishes than its "N ×", every dish sits in a line
that accepts its counts-as course of a set menu that lists it, and the total (set-menu prices plus
surcharges) is the lowest possible (**owner**: pooling with the cheapest fit, "i like that").

**Worked example (from the agreed mock-up).** Del día €14 (sirloin +€5), especial €20 (sirloin and
sea bass included; sea bass is not on the del día). Four set menus; ordered 4 soup, 1 hake, 2
sirloin, 1 sea bass. Cheapest: 3 del día + 1 especial + two sirloin surcharges = €42 + €20 + €10 =
€72. Two especials would be €73. The sea bass takes the especial; the sirloins stay on del días
because +€5 costs less than the €6 step up.

**Why not per person (owner's example).** Diner A wants a cheap starter and a starter only on the
especial; diner B a cheap starter and a main only on the especial. Counted per person, both pay the
especial. Counted by the bill, one especial covers both especial-only dishes if its lines accept
them, and the other set menu is a del día.

**Exact, and stable.** The fit must find the true lowest total, not a near one, for any table a
venue meets; the bound to meet is at least 40 set menus, 5 types and 200 set-menu dishes on one
bill, on the till's hardware, fast enough to feel instant (**my call** on the figures). When two
outcomes cost the same, it prefers the one closest to the bill's current outcome, so dishes do not
shuffle between set menus for nothing, and otherwise breaks ties the same way every time.

The set menus of one type are interchangeable, and each set menu's lines are independent of each
other, so for a chosen number of each type the dish placement is a transport problem (dishes to
"type, line" pairs, each pair holding "set menus of that type × N", each edge costing that dish's
surcharge in that type). Placing dishes into individual set menus for the unfolded summary is then
a matter of dealing them out. Trying every split of the set menus between the types and solving
each placement, which this section first suggested, is exact but took 8–12 seconds on random tables
at the bound in a prototype measured on 17 November 2026; the build plan
([2026-11-17-a1515-set-menu-fit.md](../plans/2026-11-17-a1515-set-menu-fit.md)) uses a method that
took 43 ms at worst on the same tables, with the measurements.

**One function, two callers.** The fit is a pure function in a package both the till and the
server use (browser-safe). The till runs it to show the summary and to ask about an uncovered dish
before sending; the server runs it on every change to the bill and its answer is the one stored
(**my call**).

**Which set menus it may use.** The set-menu versions live for that bill's zone when the bill's
first set menu was added, recorded on the bill, for the rest of that bill's life (**my call**: a
set menu republished mid-meal must not reprice a table already eating).

**After the set menu stops selling.** A bill that already holds set menus keeps its set-menu
folders, from the versions it recorded, after the full menu's period ends, so a table that sat down
at 15:30 can order its desserts and coffee at 16:15 (**my call**: the owner's flow has the waiter
"come back for desserts and coffees"). A bill with no set menus cannot start one once the period
has ended. The existing question before sending a dish saved before its menu period ended (#3414)
still applies to any dish saved before the end and sent after it.

**When it stops changing.** The bill is fitted again on every change (a dish added, cancelled or
moved, the count changed, a type fixed) until the first payment, or the first discount or
complimentary adjustment, on that bill. From then on, the set menus already on the bill keep their
types and dishes; a dish added later goes into an open place or into a set menu added for it (**my
call**: a payment and an adjustment both fix amounts that a later refit would contradict;
`apps/server/src/bill-payments.ts:916-993` fixes an item payment's amount, and adjustments overwrite
`unit_price_gross` and keep the list price, `apps/server/src/adjustments-apply.ts:1274-1315`). The
outcome is final when the bill's ticket is issued (today at full payment; at the meal's end once
lane L's meal-end ticket lands, adviser answer 1.3, `docs/compliance/2026-11-15-adviser-answers.md`
Part B1).

**What is stored.** Today a line's price is stored when it is added and never recomputed
(`apps/server/src/working-order.ts:612,1067-1075`). Set-menu lines and set-menu dishes break that
rule on purpose, until the fit stops changing: the fit writes its outcome into the lines it
affects, and every other line keeps today's rule. It writes: each set-menu line's type and price, each set-menu dish's price
(0 or its surcharge) and which set-menu line covers it. Paid extras keep their own prices, untouched
by the fit. Each unit of a set-menu dish may land on a different set menu at a different price, so
a set-menu dish is stored one unit per line, and the till and receipts merge identical lines for
display as they do today (**my call**; `apps/server/src/receipt-lines.ts:150-165`).

### 4. The bill, the receipt and the invoice (passes lane L; the owner lands it)

**VAT at the table.** A set menu eaten at the table is one restaurant service at 10%, drinks
included (the watcher, relaying the owner, 12 November: "At the table, the whole set lunch is one
10% service"; T17's reading, LIVA 91.Uno.2.2.º). The set-menu line takes the eat-in rate the set
menu is given on the dashboard; a surcharge and a paid extra take their dish's eat-in rate, as any
eat-in line does. Covered dishes at 0 carry no VAT. If the product VAT-rate redesign
(`docs/handoffs/2026-11-16-vat-rates-per-product.md`, waiting for the adviser) lands first, the set
menu takes a dated eat-in rate the way a product does.

**Receipt.** The receipt lists the set menus and the surcharges, not every covered dish at 0.00
(**owner**). Paid extras on a set-menu dish are priced lines and are printed. How they are worded
and laid out is lane L's (**my call** to route it there). Today a 0-priced ordinary line prints
with a 0 amount (zero only suppresses the "price each" text, `apps/server/src/receipt-document.ts`
near the line-merging code from `:449`) and nothing hides a line from the
receipt while keeping it on the kitchen ticket, so leaving covered dishes off the receipt is new.

**Invoice and the tax agency.** The Veri*Factu record carries only totals per VAT rate, no lines
(`packages/fiscal/src/backend.ts:97-114`, `packages/fiscal-verifactu/src/backend.ts:251-268`), so
leaving covered dishes off changes nothing sent to AEAT. The printed full invoice lists every line
(`apps/server/src/invoice-document.ts:77-111`, `receipt-document.ts:353-364`). **Lane L confirms
that covered dishes may be left off both the ticket and the full invoice** before the receipt part
lands; if they may not, they print beneath their set menu without a price.

**The kitchen** gets every dish, as an ordinary line. The set-menu line itself is never sent (the
set-lunch parent is left out of service the same way today, `apps/server/src/service-dishes.ts:7-13`).

**Moving dishes to another bill.** A move takes lines, or part of a line by quantity
(`apps/server/src/bill-actions.ts:270,364`, `apps/server/src/working-order.ts:4994,5069-5132`);
set-menu dishes are one unit per line anyway. A set-menu line can be moved like a dish. After a move,
both bills are fitted again; a move that would leave a set-menu dish uncovered on either bill is
refused, and the refusal says how many set menus to move with it (**my call**). The move screen lets
the waiter move set menus as well as dishes.

**Corrections after the ticket.** A correction is an amount spread over chosen lines
(`packages/core/src/correction-allocation.ts:48-120`), so a set menu is corrected through its own
line, and a covered dish at 0 cannot be corrected on its own, as today. No refit happens after the
ticket.

**Sales reports** show each set menu as an item of its own ("Menú del día: 4 sold, €56"), and its
covered dishes as sold at €0; nothing shares a set menu's price across its dishes, in reports or
anywhere else. Staff sales credit follows the lines the same way (**owner**, 17 November, answer
A). Food-versus-drink revenue therefore does not split out for set-menu sales.

### 5. Counter orders and takeaway

A counter order is never offered a set menu, and the server refuses a set menu or a set-menu dish
on one (**owner**, see Non-goals). A till at a counter can still order set menus for a seated
table's bill, since what a bill may hold follows the table's zone, not the till's.

While T17 is open, a takeaway or delivery order refuses a set menu, and switching an order holding
set menus to takeaway is refused, as the set-lunch build did (`order.set_lunch_takeaway`, being
removed with that build). The new refusal names the set menu and offers the à la carte alternative
(**my call** on wording; follows CLAUDE.md §3 "A refusal explains what happened and what each choice
does").

### 6. Courses for drinks, bread and coffee

Courses are the kinds of dish: the owner said courses and kinds have "a lot of overlap", the
writer proposed making them one, and the owner built on that ("classification is fixed") without
objecting. **My call** until the owner approves this document. A set menu that includes a drink, bread or coffee therefore needs those products to have
a course: a venue adds Drinks, Bread and Coffee courses. What a new course does today, read in the
code: at a table it is held until fired unless the department marks it Fire now
(`packages/db/src/schema/venue-service/department-courses.ts:7-30`,
`packages/venue-service/src/provisioning.ts:76-81`); it is named in kitchen ticket group headings
(`apps/server/src/kitchen-print.ts:230-262`); a held course can get a release reminder and service
steps (`apps/server/src/guide/en/table-service.md:358-367`). Today drinks have no course, and a
line with no course is sent straight away. So:

- The demo, and the guide's advice, make Drinks and Bread Fire now in every department (**my
  call**).
- Coffee is an ordinary course like Desserts, and needs nothing special. Ordered with the first
  round it waits in its own group after the desserts; ordered later, once no earlier course is
  still held, it is sent straight away (the till's `placeFor`,
  `apps/till/src/state/draft-place.ts:62-73`, read, not run; the owner asked that coffee be
  "fired straight away like desserts").
- The builder checks what reminders and service steps do with a Fire now course and, if they fire
  for it, stops them (**my call**: a reminder to send the drinks would be noise).
- Ticket headings naming DRINKS or BREAD are accepted (**my call**).

### 7. Demo and guides

- The Madrid demo replaces its "Set lunch" staff menu (`packages/country-es/src/demo/menu.ts:1484`,
  separate dishes in sections) with two set menus, a Menú del día and a Menú especial, sharing
  dishes, with one surcharge on the del día. Its products gain courses (today none has one).
- Guides in English and Spanish: setting up a set menu (`products.md`), ordering one at a table
  (`table-service.md`), and a help bubble on the set menu editor and on the order panel's count.

## The pieces, for planning

1. **Dashboard:** the set-menu kind of menu, its editor, placing it in a full menu, publishing,
   and the published document carrying set-menu offers.
2. **Ordering:** the count, fixed types, set-menu folders on the till, the set-menu-dish mark and
   counts-as course on the line, the uncovered-dish question and refusal, the summary, the
   count-reduction refusal, moves between bills.
3. **The fit:** the shared function, its tests (including the worked example and the owner's
   per-person example), stability, and its performance bound.
4. **Bill, receipt and invoice:** storing the outcome, freezing it, the receipt and invoice
   layout, VAT on the set-menu line. Passes lane L; the owner lands it.
5. **Demo and guides**, including the courses in section 6.

Order: A1515-REMOVE lands first. Then 1 and 3 can go side by side; 2 needs both; 4 needs 2; 5 last.

## Left to the builder

- Table and column names, and whether a set menu's eat-in VAT and its names in the receipt
  languages are held on the menu or on a product that stands behind it.
- The fit's method, provided it is exact and meets the bound.
- Error codes, which follow CLAUDE.md §3 (named for the domain concept).
- Screen layout details within the agreed mock-ups.

## Open, outside this design

- **T17** (takeaway set menus and their VAT split): question 1 on the adviser sheet for
  19 November 2026.
- **Lane L:** whether covered dishes may be left off the ticket and the full invoice; how paid
  extras of a covered dish are worded.
- **The product VAT-rate redesign:** whichever lands second adapts to the first.

## Mock-ups

Shown to the owner in the brainstorming session; kept out of the repository (CLAUDE.md §6). The
agreed ones: `till-ordering-v2`, `order-summary-v3`, `any-set-menu-v4`, `dashboard-v2`, in that
session's scratch folder named in `docs/handoffs/2026-11-17-set-lunch-owner-review.md` (owner's
checkout, not committed).
