# Set menus (A1515): design

Status: approved by the owner in conversation, 17 November 2026 ("yes"), after reading the list
of the writer's calls; the calls stay marked **my call** below. **Revised on 18 November 2026** by
the owner's decisions in conversation: set menus are added by type, and a dish stays where it is
placed (sections 2 and 3, rewritten), so the bill no longer works out a mix of types or reprices
itself, and nothing needs freezing at payment (section 4). The rewritten sections are for the
owner to read. Plans: one per piece, under
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
starter, 1 main or starter, 1 dessert or coffee, 1 bread, 1 drink". The waiter adds set menus to a
table by type ("2 Menú del día, 2 Menú especial") and then orders dishes as ordinary lines, from
set-menu folders in the full menu. Each dish is an ordinary order line with its own options,
extras, variant and course. Each dish goes into the cheapest open place among the bill's set menus
that list it, whichever folder it was tapped in, and stays there. Each set menu is charged as its
own priced line. Covered dishes cost nothing, a surcharge is charged on its dish, and paid extras
are charged as usual.

## Goals

1. A dish ordered as part of a set menu behaves on the till, in the kitchen and on the order exactly
   as the same dish ordered à la carte: options, paid extras, variants, course, firing, moving
   course, cancelling, moving to another bill.
2. The waiter decides how many set menus of each type a table has, but never which set menu a dish
   belongs to: the bill puts each dish in the cheapest open place, and a dish's price never
   changes once it is on the bill.
3. A venue can sell several set menus at different prices that share dishes.
4. A table can mix set menus and à la carte dishes on one bill.
5. The waiter can see at any time which set menu each dish is on and what is still open.
6. Setting up a set menu on the dashboard is one page: its price, its dishes, and what one set menu
   includes.

## Non-goals

- Tying set menus to diners or seats. The bill holds set menus; it never says which person had
  which (**owner**: "not per person").
- The bill choosing set-menu types, or moving dishes between set menus by itself (**owner**, 18
  November: "we may yet come back to automatically reassigning plates, but this seems like a
  simpler place to begin").
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
- A dish's price changes after it is on the bill without the waiter choosing it.
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
  lines. The new work is placing each dish in a set menu and pricing it there, once.
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
mock-up as a whole, so **my call** until the owner approves this document). A set menu is a menu (a row in `menus`), marked as a set menu. It
has no published versions of its own: it is copied into each full menu that holds it (see
**Publishing** below).

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
  its surcharges, into this one. Beside each dish, a **course**: it starts as the product's
  course, and can be changed for this set menu only (**owner**, 18 November 2026: "we should be
  able to change the course they belong to from the default course. for instance we could treat a
  tapa as a starter"; asked whether that course also decides when the dish is sent: "both"). The
  dish then counts as that course on the bill and is sent with it; the same product à la carte is
  unchanged. Until adviser question 26(c) is answered, a product whose eat-in VAT rate differs from
  the set menu's cannot be added ("This product is taxed at 21%, the set menu at 10%"), because a
  covered dish at another rate may need a share of the set menu's price (**owner**, 18 November,
  on lane L's advice). A product with no course is listed under **No course** with "Choose a course for it
  here, or give it one on the product" and a link to the product; a set menu holding a dish with no
  course cannot be published.
- **What one set menu includes.** A list of lines, each "N × course", where a line may accept more
  than one course ("1 × Mains or Starters", "1 × Desserts or Coffee"). It starts as one line per
  course present among the dishes, each "1 ×"; the person joins courses with "or", removes a line,
  or adds one. On the till, these lines are the headings of the set menu's folder ("Starter",
  "Main or a starter", "Dessert or coffee"). A set menu listing a dish whose course no line accepts
  cannot be published, since that dish could never be covered (**my call**).

**Placing it.** A set menu is put into a full menu's structure, anywhere in its tree, as a member
the way a folder is (from the writer's first dashboard mock-up, which the owner reacted to without
objecting to this part; **my call** until approved). The
till draws it as a folder named after the set menu with its price. For prices it is not an included menu:
included menus share one price per product with the menu that includes them, and a disagreement is
a clash that blocks publishing (`packages/menu/src/menu-combine.ts:4-13,37-41`; refused at
`packages/menu/src/menu-publication.ts:669-671`). Sirloin at €18 à la carte, +€5 on the del día and
included on the especial would clash. So a set-menu member carries its own dish offers, priced by
the set menu, beside the full menu's own offers and never combined with them.

**Publishing.** A set menu works exactly like an included menu (**owner**, 18 November 2026,
correcting this design: "The set menu should be copied in at the time it is published", then
"Full menu publish, draft" when asked which of three readings was meant). Publishing a full menu
copies in each set menu it holds as it stands on the dashboard, and that copy is what the tills
sell until the full menu is published again. A set menu has no Publish of its own. A change to it
marks every full menu holding it as changed, and a set menu with a problem (a dish no line
accepts, say) stops those full menus being published. Two full menus published at different
times can hold different copies of the same set menu. Detail: decision 3 of the
[piece 1 plan](../plans/2026-11-18-a1515-set-menu-dashboard.md).

**The product's Set lunch switch** is gone (removed by A1515-REMOVE, not by this work).

### 2. Ordering on the till

**Adding set menus, by type** (**owner**, 18 November 2026: "a count per menu", with set menus
added by type, chosen over a single count whose types the bill would work out, for fear of
"complexity and unintended consequences"). The order panel shows a count for each set menu the
bill can take: "Menú del día − 2 +", "Menú especial − 1 +". The waiter sets how many of each the
table is having; the folder of each set menu also has **Add a Menú especial** at its top. Each tap
is saved straight onto the bill, so every till at the table sees the same counts (**owner**,
18 November, answer to the writer's question). The bill never changes a set menu's type.

**The folders.** Each set menu's folder is laid out like its board: its lines as headings, the
dishes under them, each showing **included** or its surcharge in that set menu (**owner**: one
folder per set menu, shared dishes appear in each). A dish whose course more than one line accepts
is listed under the first such line (**my call**). Tapping a dish opens exactly what it opens à la
carte: its variants, required options and extras.

**What a set-menu dish is.** A line ordered from a set-menu folder is a set-menu dish. The same
product ordered from an à la carte folder is an ordinary à la carte line at its à la carte price,
and is never turned into a set-menu dish (**my call**).

**Where a dish goes** (**owner**, 18 November: "if the same dish appears on both menus, then you
can order it from either menu - it would get priced according to the menu it gets assigned to. so
somebody orders the especial, then adds the steak from the standard menu (with 5€ surcharge). it
gets added to the especial menu (where it is included) without the surcharge.").
- A set-menu dish goes into an open place in one of the bill's set menus that lists it, whichever
  folder it was tapped in, and is priced by that set menu: included, or its surcharge there.
- When several open places fit, it takes the cheapest for the customer. Between equally cheap
  places it takes a line that accepts fewer courses, which keeps "Mains or Starters" free for
  either; then the set menu added first (**my call**).
- **Once placed, a dish stays where it is** (**owner**, 18 November: "leave the dish where it was
  added … we may yet come back to automatically reassigning plates, but this seems like a simpler
  place to begin"). Nothing added, cancelled or paid later moves it or changes its price, unless
  the waiter chooses a move (below).
- A dish is placed when it goes on the bill, at Send, in the order the waiter added the dishes.
  While the waiter is ordering, the till shows where each draft dish will go, worked out the same
  way (**my call**).

**What a dish counts as.** A dish fills a place by the course the set menu it lands in gives it.
That is the set menu's own course for the dish if it gives one (**owner**, 18 November: "we could
treat a tapa as a starter", and "both" for counting and sending); otherwise it is the product's
course, as copied when the full menu holding the set menu was last published (**owner**, 18
November: "The menu should freeze the definition"). So bravas are a starter on an especial that
makes them one, and a sharing plate on a del día, whichever folder they were tapped in (**owner**,
18 November: "each set menu decides", after the Fable review showed that taking it from the folder
let the folder change the price). The folder tapped decides the course the dish is sent with.
Moving a dish to another course to serve it changes when it is sent, not what it counts as
(**owner**: "classification is fixed"). An order line already keeps its course (`course_id`)
apart from its firing group (`group_id`) (`packages/db/src/schema/orders.ts:210-226`).

**A dish with no place.** When a tapped set-menu dish fits no open place in the bill's set menus,
the till asks at once, before the dish's choices (**owner**, 18 November: "as soon as tapped"):
"No place for Sea bass in the set menus on this bill." It offers:
- **Add a Menú especial (20.00)**, for each set menu that lists the dish; the dish goes in the new
  one;
- **Move Steak to the Menú del día (+5.00) and put Sea bass in its place**, when moving dishes
  already on the bill to other open places would make room. It shows what each moved dish will
  cost, and is the cheapest such rearrangement (**owner**, 18 November: "add this"). It is the
  waiter's choice; the bill never moves dishes by itself. A dish carrying a discount, a comp or a
  payment of its own is never moved (**my call**).
- **Order it à la carte (18.00)**, when the dish is on an à la carte menu selling in that zone now
  (**my call**);
- **Cancel**.

A choice made afterwards (a bottle where the set menu covers only a glass) can leave the dish with
no place; the till asks again then. The server refuses a set-menu dish it cannot place, so the
till's question is a convenience, not the guard (**my call**).

**Swaps.** "An extra starter instead of a main: yes. Two mains instead of a starter: no"
(**owner**). These are just lines that accept more than one course: "1 × Mains or Starters" lets a
second starter take the main's place; nothing lets a main take a starter's place.

**The summary.** Above the order's lines, the set menus are summarised in one line that unfolds
(the fold is **my call**):

```text
4 set menus · 2 Menú del día + 2 Menú especial                   ▾ show
open: 4 Dessert or coffee · 4 Bread · 4 Drink
```

Unfolded, one row per set menu, its places filled with the dishes placed there or shown as open:

```text
Menú del día    Soup · Hake · [Dessert or coffee] · [Bread] · [Drink]
Menú del día    Soup · Sirloin +€5 · [Dessert or coffee] · [Bread] · [Drink]
Menú especial   Soup · Sirloin · [Dessert or coffee] · [Bread] · [Drink]
Menú especial   Soup · Sea bass · [Dessert or coffee] · [Bread] · [Drink]
```

The rows are the bill's set menus, not people (**owner**: "not per person").

**Order lines** show a set-menu dish in its firing group as today, with a small **menu** tag when
included or its surcharge ("+€5.00") when it carries one (**my call**, drawn in the till mock-ups).

**Reducing a count.** − on a type removes one set menu of that type that holds no dishes; Cancel on
a set-menu line removes that set menu the same way, without asking a reason or telling the kitchen
(**owner**, 18 November: "cancel works too"). A set menu that holds dishes cannot be removed; the
refusal names its dishes and says what to do: cancel them, or move them to another set menu or
à la carte (**my call**).

### 3. Placing a dish: the calculation

**One function, two uses.** The calculation already on `main`
(`packages/shared/src/set-menu-fit.ts`, piece 3, #3730) does both, with every set menu on the bill
fixed to its type:
- **Placing a dish:** every dish already placed is pinned to its place, and the new dish is free.
  The answer is the new dish's cheapest open place, or none.
- **The suggested move:** no dish is pinned except those carrying a discount, a comp or a payment.
  The cheapest arrangement, compared with today's places, names the dishes that would move; the
  fit's preference for the arrangement closest to the current one keeps the moves few.

With every type fixed there is one mix to consider, so the size bound the fit was built for is not
reached. Keeping the full calculation leaves the door open to the owner's "we may yet come back
to automatically reassigning plates". The till runs it to preview and to ask; the server runs it
when dishes are sent and its answer is the one stored (**my call**). What a dish counts as comes
from the set menu, so each offered dish in the calculation carries its own counts-as course; this
is a small change to the landed function.

**Which set menus a bill may use.** A bill records one copy of each set menu: the newest on sale
in its zone when that set menu is first added to the bill (**owner**, 18 November, "ok", after the
Fable review showed that recording every copy on sale let an older, cheaper price win). It keeps
that copy for the rest of the bill's life, so a full menu republished mid-meal does not reprice a
table already eating (**owner**, 18 November, "keep what the bill started with").

**After the set menu stops selling.** A bill that already holds a set menu can still add more of
that type and order its dishes after the full menu's period ends, so a table that sat down at
15:30 can order its desserts and coffee at 16:15. A set menu not yet on the bill cannot be added
once nothing is selling it (**owner**, 18 November, same answer). The existing question before
sending a dish saved before its menu period ended (#3414) still applies.

**What is stored.** Each set-menu line holds its set menu's copy and its price. Each set-menu dish
holds the set-menu line it is placed on, its place, its price (0 or its surcharge) and its
counts-as course, written once when it is placed and changed only by a move the waiter chooses.
This keeps today's rule that a line's price is stored when it is added and never recomputed
(`apps/server/src/working-order.ts:612,1067-1075`). Each unit of a set-menu dish is placed on its
own, so a set-menu dish is stored one unit per line; the till and receipts merge identical lines
for display as they do today (**my call**; `apps/server/src/receipt-lines.ts:150-165`).

### 4. The bill, the receipt and the invoice (passes lane L; the owner lands it)

**VAT at the table.** A set menu eaten at the table is one restaurant service at 10%, drinks
included (the watcher, relaying the owner, 12 November: "At the table, the whole set lunch is one
10% service"; T17's reading, LIVA 91.Uno.2.2.º). The set-menu line takes the eat-in rate the set
menu is given on the dashboard; a surcharge and a paid extra take their dish's eat-in rate, as any
eat-in line does. Covered dishes at 0 carry no VAT. If the product VAT-rate redesign
(`docs/handoffs/2026-11-16-vat-rates-per-product.md`, waiting for the adviser) lands first, the set
menu takes a dated eat-in rate the way a product does. A covered dish takes its set menu's VAT
class while it is covered, so that a 0.00 line at another rate adds no empty rate row to the
breakdown (piece 4's plan, decision 7, confirmed by lane L on 18 November).

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
set-menu dishes are one unit per line anyway. A set menu moves with the dishes placed on it. A
set-menu dish moved on its own is placed again on the target bill, as if added there, and the move
screen shows its new price first; a dish with no place there is refused, and the refusal says to
move a set menu with it (**my call**). Nothing moves on the bill it left.

**Corrections after the ticket.** A correction is an amount spread over chosen lines
(`packages/core/src/correction-allocation.ts:48-120`), so a set menu is corrected through its own
line, and a covered dish at 0 cannot be corrected on its own, as today.

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
2. **Ordering:** a count per set menu, set-menu folders on the till, placing each dish and storing
   its place and price, what it counts as, the no-place question with its suggested move, the
   summary, removing set menus, and moves between bills. Until piece 4 lands, a bill holding set
   menus cannot be paid, comped or discounted.
3. **The calculation:** landed (#3730). It needs one change: what a dish counts as comes from each
   offered set menu, not from the dish (section 2, "What a dish counts as").
4. **Bill, receipt and invoice:** letting such a bill be paid, comped and discounted, the receipt
   and invoice layout, VAT on the set-menu line and on covered dishes, and sales reports. Passes
   lane L; the owner lands it.
5. **Demo**, including the courses in section 6. (The set-up guide lands with piece 1 and the
   table-service guide with piece 2, with their screens.)

Order: A1515-REMOVE lands first. Then 1 and 3 can go side by side; 2 needs both; 4 needs 2; 5 last.

## Left to the builder

- Table and column names, and whether a set menu's eat-in VAT and its names in the receipt
  languages are held on the menu or on a product that stands behind it.
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
