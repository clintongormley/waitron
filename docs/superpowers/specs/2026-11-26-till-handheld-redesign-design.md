# Till and handheld redesign — the floor, the order, the menu and payment

Status: **pass 1 approved by the owner on 2026-11-26** (design decided with the owner the same day;
the write-up approved as written); its build is under way in lanes F, D and I. **Pass 2 (the floor,
and changes to pass 1) decided with the owner on the evening of 2026-11-26, and this write-up approved
by the owner the same evening.** Where pass 2 changed a pass-1 decision, the section says so with "(pass 2)".

This is a complete redesign of the till and the handheld. Pass 1 covered the overall map of the app,
the order screen, the menu, dish options, the table's and the bill's menus, and payment. Pass 2
covers the floor (§9: zones, the map and the list of jobs, seating, joining and moving tables, counter
zones, ☰, the kitchen screens and what the screens do when something goes wrong), and changed a few
pass-1 decisions. What is still to come is in §10.

Every decision below was taken one at a time with the owner from drawn pictures. Where the owner
changed a picture, the owner's words are quoted. The pictures are not in the repository (mock-ups
never are); where they are kept is in §11.

## 1. Why

A critique of the till's counter screen on 2026-11-26 scored it 21 out of 40 on the usual ten
usability tests. The main findings:

- The basket is laid out like a form, not an order ticket: two or three rows per dish, and on the
  counter every repeat tap adds a new line (`apps/till/src/widgets/product-pick.ts:33` calls
  `addProduct`, while a table draft merges repeats, `apps/till/src/state/draft-sync.ts:53`).
- The payment column rebuilds itself after the first dish, and before any dish it shows a test-card
  panel, a guest counter reading "No line" and seven greyed-out buttons.
- Choosing options and paying are dashboard forms: small radio buttons, a typed cash amount.
- At phone width the till is the tablet layout piled into one long scroll: the tabs are hidden in a
  strip about 100 pixels wide, Pay is below the bottom of the screen, and every choice is a dialog.
- A phone or tablet gets only the Floor tab whatever its profile allows, because the screens are
  fixed by the device's type (`apps/till/src/built-in-screens.ts:5-10`, and the "Order" tab is
  removed in `apps/till/src/widgets/till-shell.ts:1536-1540`). So a handheld cannot make a counter
  sale or see parked or waiting orders.

The owner's aim: the handheld can do pretty much everything the till can, in an interface that
suits a phone completely, with full-screen panels instead of dialogs.

## 2. Principles agreed

1. **Phone first.** The order, menu and payment are designed as phone screens; the till is the same
   pieces laid side by side (owner, 2026-11-26).
2. **The layout follows the screen's width, not the device's type.** About 800 pixels wide and
   more: menu and order side by side. Narrower: the phone layout. A till held upright and a large
   phone held sideways both work (owner, 2026-11-26, raising portrait tills because an on-screen
   keyboard takes much of a landscape screen).
3. **Keep the look, rebuild the structure.** Waitron teal, the system font and the `--wt-*` tokens
   stay; the layout, controls and flow change (owner, 2026-11-26).
4. **No dialogs on a phone.** Every choice that is a dialog today opens as a full-screen panel with a
   Back arrow; every pop-up menu becomes a list rising from the bottom of the screen.

## 3. The map: where everything lives

**(pass 2) There are no tabs.** Pass 1 had a bar of tabs (Tables / Counter / Orders / Kitchen /
More); pass 2 removed it. Everything a device does is reached from the floor:

- **The zone dropdown** lists every zone on this device, table zones and counter zones together,
  each with its most urgent job, plus "All zones" and, at its foot, "Choose zones for this phone…".
  On a device whose profile shows kitchen screens, the pass and each station are listed under the
  zones too (§9.9).
- **A table zone** shows its map or its list of jobs (§9.2, §9.3). **A counter zone** shows its
  counter screen (§9.8).
- **☰** holds everything else (§9.9).
- The pass-1 **Orders** list has no place of its own: dishes not yet sent and transfers waiting to be
  accepted are jobs on the floor; waiting and parked counter orders sit on their counter zone.

This replaces the rule that a device's type fixes its screens (design-system.md, "Fixed device
screens"; `builtInScreensFor`): which zones and kitchen screens a device shows comes from its
profile and from its own choice of zones (today's "Zones on this device",
`apps/till/src/widgets/device-zones-dialog.ts`, reached from the zone dropdown). A phone today has no
counter zones at all (`apps/till/src/state/device-zones.ts`), so a phone serving a counter zone is
new behaviour.

**One order screen for counter and table orders** (owner, 2026-11-26). The same basket, rows,
menu and payment everywhere. A counter order simply has no guests and no bills to choose between.
(pass 2) Whether a counter order is sent before or after paying follows its zone, as today: a zone
paid before preparation shows Pay, and a zone that prepares first and is paid at collection shows
Send and then Pay.

## 4. The order screen

**Top bar.** Back to the floor on the left. In the middle the table's name with a ⌄ ("Table 4 ⌄") and
under it the guests and the party's name. Tapping the name opens **the table's menu** (§6).

**The bill.** Under the top bar, on a phone, one dropdown: "Bill 1 · €73.20 · 1 of 4 ⌄", with ⋮
beside it for **the bill's menu** (§6). Tapping the dropdown lists the table's bills with their
amounts, rising from the bottom, and "+ New bill" (owner chose the dropdown over tabs, 2026-11-26).

**The rows.**
- Sent dishes come first under a heading such as "Fired 12 min ago" and a small "Sent" mark, drawn
  quietly; new dishes follow in full weight, (pass 2) under their course headings (below) rather
  than one "New · not sent" heading.
- One row per dish: quantity, name with its options as a quiet second line, price.
- Adding the same dish again adds to its row.
- **A row with more than one of a dish carries an arrow (a chevron) at its right edge.** One tap
  unfolds it into rows of one under the group, so each can be made differently; tapping the arrow
  again folds them. Folded, a mixed row reads "3 Burger · 2 Chips · 1 Salad". The owner asked for
  the arrow in place of a "Split into 3" button: "the split needs to be easier. i think it should
  just be a chevron to expand from 1 row into 3 rows". Sent rows carry the arrow too.
- **Tapping a row opens it in place**, with what can be done to that line right under it; tapping
  again closes it (owner, 2026-11-26: "I like the order rows opening up").
  - A new row: − quantity +, Options, Note.
  - A sent row: how many are served ("0 of 2 served") with "Serve 1" and "Serve 2". Serving part of
    a row is one tap, where today it takes four (A773's phone trial, 2026-11-25).
  - (pass 2) Remove, Comp, Move to station and Void moved to the selection foot (below). An action
    that needs a manager asks for their PIN at that point, as today.
- The row of the dish added last is highlighted.

**(pass 2) Courses, dragging and selecting.** Owner, 2026-11-26: "the order lines need to be
draggable and selectable, and if you expand them then each line needs to be draggable and
selectable - draggable to move them between courses, or to a new course (dragging is preferable to
clicking move), selectable to say 'send these'".
- **What a heading is.** The till keeps two things: a dish's **course** (Starters, Mains), which
  is part of the dish and prints on the kitchen ticket, and its **fire group**, the batch held and
  fired together, which today's "Move to…" and "New group" change (`table.move_line`,
  `table.move_new_group`). **The headings are fire groups, named after their dishes' course**
  ("Mains", or "Mains + 1 starter" when mixed). **Dragging changes only when a dish is fired, never
  its course on the ticket** (owner chose this, 2026-11-26). **+ New course** makes a new fire group.
- Each heading says what Send does to it: "sends now" or "held · fire later". A held group that has
  been sent keeps today's **Fire** button on its heading.
- Every row carries a **grip** at its left edge, and so does each single row of an unfolded group.
  Taking a row by its grip drags it onto another heading, or onto **+ New course** at the end.
  Dishes already sent have no grip: today's "Move to…" works only on dishes not yet sent (read in
  the code by the builder check, not run).
- **Holding a row** (anywhere but its grip) starts selecting; further taps add rows. The foot then
  offers what suits the rows chosen: **Send these N now**, **Move to…**, **Remove** (new dishes),
  **Comp**, **Void** and **Move to station** (sent dishes). Cancel ends it.
- **Opening a row** (a tap) keeps only what makes sense for one dish: quantity, options and the note
  on a new dish; serving part of the row on a sent one. Remove, Comp, Void and Move to station are in
  the selection foot instead (owner chose this split, 2026-11-26); this replaces the pass-1 lists of
  what a new and a sent row open to, above.

**The foot of the screen, always visible:** "Menu" on the left, then "Pay €73.20", then "Send 6"
in teal (the number counts the new dishes). (pass 2) In a table zone set to be paid before sending
(§9.8), Pay and Send become one button, **Pay and send**.

## 5. The menu and dish options

**The menu slides up from the bottom and covers the order** (owner, 2026-11-26: "the order should
be the main screen, with the menu sliding up from the bottom to cover the screen").
- At the top: search, then the section path ("Home › Starters › Cooked starters"), each step
  tappable. (pass 2) "Home" is a small home icon, not the word. The sections are the menu's own sections, not courses.
- Below: **today's tiles, three columns on a phone**, sections as plain tiles with a folder mark,
  dishes in the venue's colours. A dish already in this order wears its count on the tile.
- **Search results show as the same tiles**, not as rows (owner, 2026-11-26).
- **"Last added" sits at the bottom**, above the Order bar: the dish just added, with − and + to
  change its quantity (owner chose the bottom, 2026-11-26).
- **The Order bar** at the very bottom reads "Order · 5 new · €50.10" and slides the menu back down.
  It sits in the same spot as the order screen's Menu button, so switching back and forth is the
  same tap.

**Dish options open as a full screen of large buttons**, one group under another ("Doneness —
Choose one", "Side — Choose up to 2", "Sauce — Optional"), extras showing their price, then "Note
for the kitchen". Allergies stay in the table's Allergies, not in this note.
- **The venue's default stays picked** (Medium already chosen), as today.
- **Add is the "done"**: it is usable whenever every required group is satisfied, the default
  counting as a choice, so "Sirloin, Add" is two taps. It greys out only if a required choice is
  emptied. Owner, 2026-11-26: "You have an Add button at the bottom already, it could be that, just
  made active when the requirements have been met".
- A quantity stepper sits beside Add.

## 6. The table's menu and the bill's menu

One menu of about twenty choices was too many; it is split in two, each opening from where the
waiter is looking (owner, 2026-11-26: "we need to either break it into table choices or bill
choices, or have two menus originating from different places").

- **The table's menu**, from the table's name: Allergies, Guests, Name the party, Bill requested
  (a switch), Move to another table, Join tables, Split the table. Finish table sits on its own at
  the end. (pass 2) Pass 1 also had "Floor plan: seats, name, rotate"; it goes, because tables are
  moved and turned on the floor itself (§9.6), and a free table's seats and name until the next service are in
  its long-press menu (§9.5).
- **The bill's menu**, from ⋮ beside the bill: Print the bill, Full invoice, Move dishes, Merge
  bills, Move this bill, Name this bill, Comp the bill, Record unpaid departure. "+ New bill" lives
  in the bill dropdown. (pass 2) **Full invoice stays** (owner, 2026-11-26): it is the only way to
  fill in a customer's invoice details before paying, for example at the start of a business lunch.
  It opens the same screen as Pay's "Full invoice instead" (§7.4), and Pay then shows what was saved
  ("Full invoice · Garcia López SL · Printed on Office", with Change).
- Each menu rises from the bottom. **Each choice opens as a full screen with Back**, never a small
  window. Drawn example, Move dishes: a row per dish with "how many" steppers, then "Move them to"
  (another bill, New bill, Another table…), and a button saying exactly what will happen ("Move 2
  dishes to Bill 2").
- Choices show only where the bill's state allows them, as today.

## 7. Payment

### 7.1 The guest sees the bill first

At a table, **Pay opens a screen for the guest first** when the venue has tips switched on; the
waiter turns the phone round (owner, 2026-11-26). A small "Skip ›" at the top right is for the
waiter: it goes straight to Pay (pass 2: the pass-1 picture left it out). A counter sale, or a venue
without tips, goes straight to the waiter's Pay.

1. **The bill.** The venue's name, "Here is your bill", the table and time, each dish under its
   customer-facing name (`docs/developers/products.md`), and the total. It is in the language the
   waiter chose for the receipt, and the guest can change it at the top. At the bottom: "Leave a
   tip?" and "No tip · hand back to your waiter", the same size.
2. **Leave a tip.** Suggested percentages with their amounts (drawn: 5%, 10%, 15%) and "Custom
   amount".
3. **Custom amount.** "How much would you like to pay?": the guest types the total, and the tip is
   the difference above the bill. Done stays greyed out below the bill's amount.

Then "Done · hand back to your waiter". The tip is shown apart from the bill everywhere, because it
is not part of the invoice. The owner's words: "the first step is to show the bill, with the total.
Then Leave a tip? which takes them to suggested percentages or a custom amount."

The tips design ([2026-10-18-a793-tips-design.md](2026-10-18-a793-tips-design.md)) was never
approved. This decides only how the guest is asked; how tips are recorded and shared out stays
open there.

### 7.2 The waiter's Pay screen

- **The amount to pay, large**, with "Bill €73.20 + tip €7.32" under it, and (pass 2) **Remove
  tip** beside that line, for a guest who would rather leave a tip in cash on the table.
- **How it is paid:** Whole bill, Split equally, Items, An amount, as today, Whole bill first.
  (pass 2) They are full-width buttons one under another, each with a short hint ("between guests",
  "choose dishes", "type it"), not a row of tabs.
- **A receipt is assumed.** A small link, "Full invoice instead", is the only sign of the choice
  (owner, 2026-11-26: "by far the majority will just want a receipt, not an invoice"). Once a full
  invoice is set up, one line shows it — "Full invoice · Garcia Lopez SL · Printed on Office" — with
  Change, and "Receipt instead" undoes it.
- **Card and Cash are the two large buttons**; "Other card machine" is a small link underneath
  (owner, 2026-11-26: "make cash and card big, and other more hidden").
- **The card button names no reader:** "Charge €80.52". This replaces the owner's 2026-10-19 choice
  to name the reader on the button and on a folded reader row
  ([A796](2026-10-19-a796-handheld-payments-design.md), Revision 4, answer 1). Owner, 2026-11-26:
  "they don't actually need to know the name of the devices, just that they are the ones that they
  are holding", and "Drop the name".

### 7.3 Choosing the reader and printers

There is no reader-and-printer row on the Pay screen any more. **Tapping a device on the phone
(NFC) works on any screen** and needs nothing opened. A small button at the top right of Pay opens a
sheet that (owner, 2026-11-26):
- **starts with the camera already on**, so the waiter can scan several QR stickers in a row; each
  scan says what was picked up ("Picked up Reader 3") and the camera stays on;
- lists, under the camera, **a dropdown for each device this payment uses, and only those**: card
  reader; receipt printer, or the invoice printer when a full invoice is printed; payment slip
  printer; and the cash drawer only on a device whose profile may open one.

A sticker tapped or scanned makes that device the phone's own from then on, as today (A796).

### 7.4 The full invoice's details

A full screen with today's fields, tax number first: Customer NIF, NIE or CIF; legal name; street
and number (with today's address suggestions); postcode; city; province. Then **"Send the
invoice": Print it or Email it.** Print has one dropdown listing every printer — A4 printers and
receipt printers alike — defaulting to the office printer; Email swaps it for an address field
(owner, 2026-11-26: "perhaps it is printed vs email, with a dropdown for the printers"). "Use full
invoice" returns to Pay.

### 7.5 Cash

The amount, large; one-tap buttons for Exact and the next notes up (drawn: €75, €80, €100); a
keypad for anything else; the change to give back in large type; and a button saying what happened:
"Took €80.00 · give €6.80". A phone opens no drawer, as today. (pass 2) A tip chosen on the guest's
screen stays in the amount when the guest pays cash: €90 handed over for €73.20 + €7.32 gives back
€9.48.

### 7.6 At the reader

The amount and the reader in large type, how long it has waited, and **nothing to press — no Back
either** — until the reader answers (A796's rule kept). On a split: "Pay the next guest (2 of 3)"
afterwards.

### 7.7 Paid

What was taken and how, where the receipt went, and what is still owed on the table ("Bill 2 · Ana
€21.90"), with "Pay Bill 2 · Ana" and "Back to Table 4". **"Print payment slip"** sits under it:
only if the guest asks, it prints once and then reads "Slip printed", with no reprint, as decided on
2026-11-19 (owner, 2026-11-26: "we need to be able to optionally 'print payment slip' after
payments"). Paying never frees the table; Finish table does, from the table's menu.

### 7.8 Kept from A796

Everything in [A796](2026-10-19-a796-handheld-payments-design.md) not changed above stays: Whole
bill as a way to pay, a presented bill paid whole, "Other card machine" as a deliberate choice, no
Cancel while the card is at the reader, "Pay the next guest" carrying a split on, a declined card's
retry, paying never freeing the table, and a phone never opening the drawer.

## 8. The till: the same pieces side by side

On a screen about 800 pixels wide or more (owner approved the drawing, 2026-11-26):
- (pass 2) No tabs. **The floor** shows the chosen zone's map on the left and a column of jobs for
  every zone on the device on the right (§9.10).
- **In an order, the menu fills the left**: search and the diet filter, the section path, then as
  many tile columns as fit (five on a landscape tablet, three held upright).
- **The order stays open on the right**, with the same top bar, bill dropdown, rows, arrows and
  foot buttons as the phone (Pay and Send). The dish just added is the highlighted row, so the
  phone's "last added" strip is not needed.
- **Pay and every action open in the order's column**, not over the menu.
- With an on-screen keyboard showing, the foot buttons stay above it and search results show above
  it, as tiles.
- A counter sale uses the same screen, with "Counter · Downstairs bar" in place of the table.

## 9. The floor (pass 2)

Decided with the owner on the evening of 2026-11-26, one picture at a time. It answers lane D's
eight points from the bar-seat trial (2026-11-11) and the 18 entries in `docs/backlog/till.md`'s
bundle "For the owner's redesign of the table screens" (§9.12 lists where each went).

### 9.1 The bar at the bottom

A phone opens on the floor. **The controls sit in one bar at the bottom of the screen**, under the
thumb, because the lists they open rise from the bottom (owner, 2026-11-26: "perhaps the zone
selector should be at the bottom too? with map/list and the menu icon"):

- **the zone dropdown**: the zone's name with ⌃; its list rises from the bar (§9.4);
- **one button naming the other view**: "List" while the map shows, "Map" while the list shows
  (owner: "we could save space by showing either Map or List, ie the other choice");
- **☰** (§9.9).

Just above the bar, **one line gives the most urgent job in another zone** ("Terrace · Collect from
Bar 9 min"); a tap goes there. The owner: "i like the Terrace warning (ie the most important thing to
deal with)". It is not shown on "All zones", which already lists every zone. Everything above the bar
is the map or the list.

### 9.2 The map comes first, and each table shows its job

On a phone **the map comes first** (owner chose it over a list first and over a smaller map with a
list under it). **Each table shows the waiter's job and how long it has waited**, not a state name
(owner: "i think this map needs to be an action list"):

**The words are not decided here.** The table states are A757's, already built; the words for them
as jobs are a proposal for the states review the backlog already holds (A893), which is done on the
built till with every state on screen (owner, 2026-11-26: "we have states already, although they need
review"). The proposal:

| State (A757, built) | What it means | Today's word | Proposed job word |
| --- | --- | --- | --- |
| Ready | dishes ready at a station | "2 ready" | Collect from Bar · 9 min |
| Forgotten | fired dishes past 15 min | Forgotten | Chase the Kitchen · 17 min |
| Overdue | fired dishes past 10 min | Overdue | Running late · 11 min |
| Unavailable | a held dish can no longer be sold | Out | Sold out: tell the table |
| Time to fire | the next held course is due | Fire | Fire the mains · now |
| Bill requested | the bill was asked for | Bill | Wants to pay · 4 min |
| Service step | a venue's own reminder (A757 §8) | the step's name | the step's name ("Take the order · 6 min") |
| Not sent | a draft not sent | Unsent | Not sent |
| Waiting | fired dishes past 5 min | Waiting | Food on its way · 6 min |
| Needs clearing | the party has gone | Clear | Clear the table |
| Needs moving | a new layout moves the table | Move | Move the table |
| Held | a held course not yet due | Held 2 · fire in 4 min | Held · fire in 4 min |
| Reserved | a booking within 30 minutes | the time | Booked 21:30 |
| Nothing needed | all served | ✓ | ✓ |

Two jobs are not table states: **Accept transfer · from Bar** (today's Transfers button, with Accept
and Decline) and the booking clash of §9.7. They are proposals for the same review.

- Colours and pulsing stay as A757 built them: what is late or due now pulses.
- **Food waiting to be delivered is the most urgent job** (owner: "delivering stuff is the most
  urgent item, but that can be done with sorting"). This changes A757's order of precedence, where
  Ready came seventh: collecting comes first, then the rest in A757's order.
- A transfer belongs to the zone (and table, when one is named) it is sent to; on a counter zone it
  sits with the orders ready to hand over (§9.8). (A call made in the write-up.)
- A table that needs several things shows the most urgent one; the list (§9.3) and the long-press
  (§9.5) show them all.
- On a small table the word shortens ("Bar 9′"); below the size where the name shows, only the
  colour is left (today's limits, `NAME_MIN_PX` and `CUE_MIN_PX`). Tables already have a **short
  name** ("T12" for "Terrace 12"; A797 slice 1, #2076, in the table data, the dashboard's editor and
  the till's floor read). **The map uses it where the full name does not fit, and kitchen tickets
  always print it** (owner: "yes", A1101); today neither does.
- The handheld's "Ready" strip at the foot of today's floor goes. The owner: "that ready strip is
  pretty much unintelligible, too much info compressed into too little space without a hint as to
  what it means".

### 9.3 The list is one row per job

"List" shows **one row per job, not one row per table**, so a table that wants to pay and has drinks
at the bar shows twice (owner chose this over a separate Stations tab: "i wonder if we need stations
or if it should all be part of the single list view", and "it is nice to see by prep station").

- **To collect** comes first, **grouped by station** (Downstairs bar, Kitchen…), oldest first inside
  each: the table, the dishes and the minutes.
- **Other jobs** follow by urgency: Chase the Kitchen, Fire the mains, Wants to pay, Take the order,
  Clear the table, and the rest.
- Each row's button does the job where one tap can: **Collected** (marks those dishes served, as
  Serve does on the order), **Fire**, **Pay**, **Cleared**. A tap elsewhere on the row opens the table.
- At the end, one line each for the calm tables ("5 tables seated, nothing needed ›") and the free
  ones ("6 tables free ›").
- The list follows the zone chosen; "All zones" lists every zone on the device. On a phone, "All
  zones" has only the list (no Map button); ☰'s section for the zone then shows the zone last
  chosen. (Calls made in the write-up.)
- When nothing needs doing, the list is a calm screen saying how many tables are seated and free.

### 9.4 Zones: one list for tables and counters

**The zone dropdown lists every zone on the device, table zones and counter zones together**, each
row with its name and its most urgent job, and nothing else (owner: "I don't think the zones need
descriptors in the zone chooser"). "All zones" comes first. **"Choose zones for this phone…"** sits at
the foot of the list and nowhere else (owner: "in the selector its right where you need it"); it
opens today's choice of zones for the device (`device-zones-dialog.ts`), which the owner had not
found: "a device should be able to select which zones it shows - not every waiter will cover all
zones, so they should be able to focus". The pass-1 zone chips across the top go: "the chips are
better if there are few zones (esp on the handheld) but they soon become invisible".

### 9.5 A tap and a long-press

- **A tap** does the obvious thing: a free table seats a party (§9.7), a table in use opens its
  order, a table to clear asks to mark it cleared.
- **Hold and let go** opens the table's menu, rising from the bottom, on the map and on a row of the
  list alike:
  - a table in use: a one-line summary (party, guests, amount, bills, seated at), **Open the order**,
    then the same table menu the order screen opens from the table's name (§6);
  - a free table: **Seat a party**, Join tables, Seats, Name, Take off (and Back to saved place on
    a table moved). Like every change made on the till, these last until the next service (§9.6), so
    the menu does not say "for today".
- It replaces today's details sheet, which only a long-press on the map reaches. A double tap does
  not open it: a table that answered a double tap would have to wait after every single tap before
  opening its order (owner chose long-press only).

### 9.6 Moving, turning, joining and taking off tables

There is **no edit mode** (owner, after an edit mode was drawn: "does that mean we can do away with
edit mode entirely?").
- **Hold and slide** picks a table up. Dropped on empty floor it **moves**; dropped on another table
  it **joins** them; dropped on the **"Take off"** area that appears at the bottom while a
  free table is held, it is taken off.
- After a drop the table stays selected with **a turn handle**, the dashboard floor-plan editor's own
  (`wt-floor-plan-canvas`), until a tap elsewhere. **No resize handles** on the till (owner chose move
  and turn only). A line "Table 6 moved · Undo" shows for a few seconds.
- **Every change made on the till lasts until the next service.** The owner: "Tables always get reset
  at the next service (unless still occupied)." That is today's layout change (the "Dinner layout is
  ready" banner and Update layout, `help.floor.layout_due`); the banner becomes a tinted box. The till
  never changes the saved plan.
- **Join tables** from the long-press menu: tap the other tables, then "Join 3 tables"; the button
  says how many guests sit across how many seats. Free tables and tables with guests both work, as
  today. Dragging one onto another does the same.
- **Joined tables keep their own numbers**, inside one band with **one label** for the group: the
  numbers and the party ("4 + 6 + 8 · Garcia"). Seats in a row read as a range ("Bar 2–4 · Ana").
  Today the group's name ("Bar seat1+seat2+seat3") shows only on the first shape and the others lose
  their numbers.
- **Joining a table booked later in the day warns** ("8 is booked at 21:00 · Garcia, 4") and does not
  refuse. **Taking off a table booked later stays refused**, as today (`table.booked`,
  `packages/bookings/src/table-removal.ts`): the refusal names the booking and offers to move it.
- **Joining two tables that both have guests asks first**, because it merges the two parties into
  one (bills and drafts move across): "Join Table 4 (Garcia) and Table 6 (Ana)? Ana's bills move to
  Garcia's party." The party of the table dropped onto survives. Joining involving a free table does
  not ask and can be undone. (Calls made in the write-up.)
- **The zone's ⋮ items move to ☰** under the zone's name, "Dining room · until the next service"
  (owner, 2026-11-26: "why Tonight? it could be afternoon or morning"): **Add a spare table** (the
  zone's spares; Add puts the table on the map at its saved place, picked up, to slide and turn),
  **Taken off** (with Put back), and **Back to the Dinner plan**.

### 9.7 Seating a party

A tap on a free table opens **a full screen**, not today's small window:
- **guests as big buttons** (1 to 7, and "8 +" for a keypad) and **an optional name**; "Seat 3
  guests" opens the new order with the menu already up;
- **a table with a booking in the next 30 minutes shows the booking first**: who, how many, when
  and their note, with one button, "Garcia has arrived · seat 4", that **seats the booking** (marks it
  seated and links it to the party, as the dashboard's seat route does) with the name and guests
  filled in. **A walk-in may still take the table** underneath. The builder check found no booking
  check on today's seat path, so this may already be allowed; it is stated so it stays allowed. The
  booking then stays on the table; if the table is still taken at the booking's time, the floor shows
  the job "Garcia (4) due 21:30 · T8 taken · Move the booking". (Calls made in the write-up.)

This needs the booking's name, party size and note on the till; today the till gets only its time
(`packages/bookings/src/floor.ts`). Keeping them off the till was a deliberate change (#182,
2026-08-31) and the note may hold health details, so **the till reads them only when the seat screen
opens for that table**, never in the floor read. (A call made in the write-up.)

### 9.8 Counter zones, and paying first at a table

- **A counter zone has no floor plan** (owner: "the only reason to have a floor plan is if there is
  table service"). A bar where people sit and are served is set up as **two zones**: the seating, a
  table zone with its plan, and the counter, a counter zone (owner chose two zones over one mixed
  zone). The dashboard offers a floor plan only to a table zone.
- **A counter zone's screen**: first the orders **ready to hand over** ("No. 41 · Marta · 2 min",
  with Handed over; owner: "it's probably more whose orders are ready"), then a large **New order**,
  then the counter's **open orders** (paid and in the kitchen, sent and not yet paid where the zone
  prepares first, waiting, parked). No map.
- **Counter delivery to a table is dropped for now** (owner, 2026-11-26: "drop it for now, keep this
  solution in the backlog in case we need it in the future"). Today a counter order reaches a table
  only through a department transfer the other department accepts, choosing the table
  (`packages/venue-service/src/department-transfers.ts`); the map then marks the table "N to
  deliver". The new screens offer no way to send a counter order to a table and show no "to deliver"
  job. Department transfers stay for moving a tab between departments. The solution drawn and kept in
  the backlog: delivering always means the guests are at that table, so choosing a free table seats a
  party there with the counter order as its first, paid bill, and a seated table's party gets it as
  one more paid bill.
- **A table zone may be set to be paid before its orders are sent.** For guests who order at the bar
  and sit down, the owner: "you choose the bar area. what table are you at? choose food, pay and
  send". The waiter picks the seating zone, taps the seat, takes the order, and the foot's **Pay and
  send** sends it once paid. Each round is a new bill on the same party at that seat. **Paying still
  never frees the seat**: a waiter frees it with Finish table, as everywhere (owner chose this over a
  seat that frees itself once everything is paid). As read from the
  zone settings (not tested), today only counter zones can be paid first (`ServiceMode`:
  `table_tab`, `prepay`, `ticket_then_pay`), so this is new.

### 9.9 ☰ and the kitchen screens

**☰** (rising from the bottom), in this order:
1. **You**: the person signed in, "Clocked in at 17:02", and **Clock out** right there.
2. **The zone, until the next service** ("Dining room · until the next service"): Add a spare
   table, Taken off, Back to the <period> plan (§9.6). No screen says "tonight" or "today": a
   service may be breakfast, lunch or dinner.
3. **Bills and cash**: Find a bill, Cash in or out, Close the drawer (the last two only on a device
   whose profile may open a drawer).
4. **Your time**: My hours, My schedule.
5. **This phone**: Language, Settings, Report a problem, About Waitron, Log out.

**The kitchen screens** (the pass and each station's board) had the pass-1 Kitchen tab. They are
listed in the zone dropdown under the zones, on a device whose profile shows them, each with what is
waiting there ("3 to send out", "5 cooking"); picking one shows that board full screen. A device that
is only a kitchen screen opens straight onto its board, as today.

### 9.10 The floor on a till

At about 800 pixels wide or more: the chosen zone's map on the left and a column of jobs for **every**
zone on the device on the right, so there is no Map/List button and no other-zone line. The bar along
the bottom holds the zone dropdown, the person signed in, help and ☰. A tap on a table or a job opens
the order across the full width (§8).

### 9.11 When something goes wrong, or there is nothing to do

One rule: **say what happened, what still works and the next step, on the screen where it happened.**
The four drawn:
- **The box out of reach**: a strip at the top ("Can't reach the box. Showing the floor as it was at
  21:40. Orders and payments wait until it answers. Check this phone is on the venue's WiFi."), and
  the floor stays visible, greyed. Today this is a page over everything (`offline.*` strings).
- **A declined card**: "Declined. The card was not accepted. Nothing was taken.", with **Try the card
  again** and **Another way to pay**.
- **Nothing to do**: a calm screen with how many tables are seated and free (§9.3).
- **A receipt that did not print**: Paid still says the bill is paid; where the receipt line would
  be, what went wrong ("Bar printer: out of paper. The sale is recorded.") with another printer or
  email. Whether a receipt (not a full invoice) can be emailed today was not checked; the plan checks.

The build applies the same rule to every other error.

### 9.12 Where the held entries and the bar-seat points went

- **Answered by the design:** serving part of a row (§4); the Split and bill panels that opened low
  and the ⋮ list taller than the room (A1359, A1290, A1265: every choice is full screen); Waiting's
  minutes on the map (A936) and a table to move looking like one to clear (A856), both by the jobs
  in words with minutes (§9.2); the review of every table state's look and word (A893) is done on the
  built till, with §9.2's table as its starting proposal; joining one seat at a time, the group's name and lost numbers, and the join list
  showing tables no longer on the plan (lane D points 3, 4 and 7, §9.6); a counter zone with seats
  that never showed (point 6, §9.8).
- **Decided:**
  - **A1333**: a table's service step ("Another order?", "Coffee?") ends when the table's last bill
    leaves it, so an empty table never shows one.
  - **A550**: when a booked table becomes part of a joined table in the dashboard's floor plan,
    bookings from the time that change takes effect move to the joined group automatically, and the
    save says so ("Garcia's booking at 21:00 moves to 4 + 5"); earlier bookings stay. Owner's
    question that led here: "if the booking is at 9pm and it is currently 6pm?"
  - **A857**: the booking screen refuses a table that the layout due at the booking's time puts
    away, naming the layout ("Not in the Dinner layout").
  - **A1101**: short names (§9.2).
- **Wording, fixed in the build:** "Sent !" and "Held ·" (A1108), «Olvidado»/«Olvidada» (A1107),
  "at the pass" under a "Fired" heading, and A470's "Owes €0.00".
- **Checked against the new foot buttons when built:** A1211, the Served message covering them.
- **Out of scope (the dashboard's floor-plan editor):** lane D's points 1, 2 and 5 (a one-seat table
  drawn large, placing each seat by hand, the editor scrolling sideways on a phone), A561/A562, A672
  and the editor looks in A859.
- **A fault, not design:** lane D's point 8, a device-verification warning that stayed after a reload
  in the demo (§13).

## 10. Not designed yet

- The screens behind "Split equally", "Items" and "An amount", and "Other card machine".
- Find a bill, the receipt screen, clock-in, My hours, the drawer, refunds and corrections.
- Loading states, and the Spanish wording.

## 11. Open questions

1. **Finding a returning invoice customer.** Today's invoice form has no way to look one up; that
   would be a new feature. Not decided.
2. **The tip percentages.** Drawn as 5%, 10% and 15%; whether a venue sets its own belongs to the
   tips design.
3. **(pass 2) A tip paid in cash** stays in the amount on the Cash screen (§7.5). How a cash tip is
   recorded and shared out stays with the tips design.

## 12. Pictures

Kept outside the repository, in this session's scratchpad and copied to
`~/waitron-campaign-shared/mockups/2026-11-26-till-handheld-redesign/`, light and dark for each:
`d` the order and menu (last added at the bottom, picture 2), `f` options with the default picked,
`g` unfolding a row, `i` the two menus, `j` bill dropdown versus tabs, `h` frame 3 the Move dishes
screen, `o` the guest's bill and tip, `q` frames 1, 2 and 4 the quiet Pay and invoice destination,
`r` the device sheet, `k` frames 2–4 cash, the reader and Paid (with the payment slip), `m` the
till, `s` the till held upright. Earlier pictures in the same folder show choices the owner turned
down: `a`/`b`/`c`, `e` frame 1, `h` frames 1–2, `k` frame 1, `l`, `n` and `p`.

Pass 2, same folder: `t` the map first (frame A chosen), `u` seating and a booking, `v` the
long-press menus, `x` joining and bar seats, `z` frame 1 the map's jobs, `aa` the list of jobs, `ab`
frame 3 the take-off area while dragging, `ac` frame 2 the zone list (without the descriptions the
owner dropped), `ad` frame 1 the layout of a counter screen (its jobs became ready orders, §9.8),
`af` courses, dragging and selecting, `ag` the bar at the bottom (one Map/List button, not two), `ah`
paying redrawn, `ai` the floor on a till, `aj` ☰ and the kitchen screens, `ak` errors and nothing to
do; `sum-a`, `sum-b`, `sum-c` a storyboard of the phone screens, in which frames 12 and 13 predate the
bill dropdown and frame 4's ☰ still lists "Choose zones". Turned down or superseded: `w` (an edit
mode, dropped), `y` (the Ready strip), `z` frame 2 (a Stations tab), `ab` frame 1 (a zone ⋮ menu,
now in ☰), `ac` frames 1 and 3 and `ad` frame 2 (a counter zone with seats), `ae` and `al` (a
counter order delivered to a table; dropped for now, §9.8).

## 13. Notes for the build

- `apps/till/src/till-app.ts` is about 25,800 lines and `apps/till/src/screens/till-table-order-screen.ts`
  about 7,400. The backlog's "Small files in the till" (SPLIT-TILL-APP-REST) waits for this
  redesign; one order screen for counter and table (§3) is the natural point to start it.
- The backlog's "Check the till above a tablet's own keyboard again" (left open by A1563) applies to
  §8's keyboard behaviour.
- The screens a device shows move from its type to its profile and the screen's width (§2, §3):
  `builtInScreensFor`, `till-shell`, design-system.md's "Fixed device screens" and the till guide
  change with it, in English and Spanish.
- New full-screen panels and bottom sheets are shared pieces in `packages/ui`, not drawn per
  screen, with the token and accessibility tests a new `wt-*` piece needs.
- (pass 2) **Bookings reach the till**: the name, party size and note of a table's next booking
  (§9.7), where today only its time does (`packages/bookings/src/floor.ts`,
  `apps/till/src/api/floor-api.ts`), read only when the seat screen opens (§9.7).
- (pass 2) **Counter delivery to a table** (`workingOrders.deliveryTableId`, the map's
  `delivery-pending` state, a transfer's optional destination table) is not carried into the new
  screens (§9.8). Whether the code behind it is removed now or later is the plan's to propose.
- (pass 2) **A757's order of precedence:** food to collect moves to the top of the
  order of precedence (§9.2), on the map, the list, a zone's most urgent job and the order screen's
  status pin.
- (pass 2) **The dashboard** changes in three places: a zone's floor plan is offered only to a table
  zone (§9.8); the map and kitchen tickets use the short names tables already have (§9.2); and the
  floor-plan editor's save moves later
  bookings to a joined group (§9.12, A550), and the booking screen refuses a table the layout due at
  that time puts away (A857).
- (pass 2) **A zone setting** "paid before it is sent" for table zones (§9.8), with the order screen's
  Pay and send.
- (pass 2) **Lane D's point 8**: in the demo, a device-verification warning stayed after a reload while
  seating, joining and ordering still worked (2026-11-11). Reproduce and fix it in the build.
