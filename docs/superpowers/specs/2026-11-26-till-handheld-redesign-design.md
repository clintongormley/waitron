# Till and handheld redesign — the floor, the order, the menu and payment

Status: **pass 1 approved by the owner on 2026-11-26** (design decided with the owner the same day;
the write-up approved as written); its build is under way in lanes F, D and I. **Pass 2 (the floor,
and changes to pass 1) decided with the owner on the evening of 2026-11-26, and this write-up approved
by the owner the same evening.** Where pass 2 changed a pass-1 decision, the section says so with "(pass 2)".
**Pass 3 (the ways to pay, §7.9) decided with the owner on the evening of 2026-11-26, and this write-up
approved by the owner the same evening. Pass 3's second part (after payment, §7.12) decided the same
evening, and its write-up approved by the owner the same evening.** On 2026-11-27 the owner approved
frame `bi` (a bin for Remove, "Move" for "Move to…", Undo after removing; §4 and §14.4).
§14 says how each piece looks, read off the approved pictures, so the build does not have to guess.

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
- (2026-11-27) **While a row is dragged, the foot gives way to a bin**; dropping the row on it
  removes the dish. Only new dishes can be dragged, so a sent dish never reaches it.
- **Holding a row** (anywhere but its grip) starts selecting; further taps add rows. The foot then
  offers what suits the rows chosen: **Send these N now**, **Move**, a bin that removes them (new
  dishes), **Comp**, **Void** and **Move to station** (sent dishes). Cancel ends it.
  (2026-11-27) **Move** stays beside dragging: it is the way to move without dragging, and moves many
  ticked rows at once. Its button says "Move", not "Move to…"; the sheet it opens is headed "Move
  to" (owner: "less text is less noise").
- (2026-11-27) **Removing asks nothing**: the dishes go at once, and a bar above the foot says
  "Croquettes removed" ("3 dishes removed") with **Undo** for a few seconds, as the floor's "Table 6
  moved · Undo" does. Undo brings them back with their options and notes, where they were.
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
"Took €80.00 · give €6.80". A device opens the drawer only when its profile allows it, a phone included (owner, 2026-11-26 17:20, choosing "follow the device profile"). (pass 2) A tip chosen on the guest's
screen stays in the amount when the guest pays cash: €90 handed over for €73.20 + €7.32 gives back
€9.48.

### 7.6 At the reader

The amount and the reader in large type, how long it has waited, and **nothing to press — no Back
either** — until the reader answers (A796's rule kept), with one exception: while a SumUp payment
is still waiting, a small "Cancel payment" link stays, as built in #3959 after the owner's report of
20 November (owner, 2026-11-26 21:48: "Keep it as a small link"). On a split: "Pay the next guest (2 of 3)"
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
Back while the card is at the reader (a SumUp payment still waiting keeps its small Cancel payment
link, §7.6), "Pay the next guest" carrying a split on, a declined card's
retry, paying never freeing the table, and the drawer opening only on a device whose profile allows it, a phone included (owner, 2026-11-26 17:20).

### 7.9 (pass 3) The ways to pay

Decided with the owner on the evening of 2026-11-26 from pictures `ba`–`bd` (§12). The example
throughout is Table 4.

**Tips when a table splits.** The guest's bill (§7.1) still opens first and asks about a tip on the
whole bill. When the guests then split, **each guest is asked again on their own share**. The owner:
"ask twice, the waiter can just skip the screen". A table that agreed a tip together ("as a table we
agree to 10% tip so then we divide that total between all of us") chooses it on the first screen. Each
guest's share screen then opens with that guest's part of the tip already added, to leave or change.
A table whose guests tip one by one skips the first screen and chooses on each share. The waiter's
Skip works on both.

**Split equally.**
1. The waiter sets the number of guests with − and + (today it is typed). The shares are listed
   straight away. Where the bill does not divide, the first shares carry the extra cent: €73.30 for 3
   is €24.44, €24.43, €24.43 (today's rounding, kept).
2. When tips are on, each guest sees "Your share" in large type with the tip choices worked out on
   that share, as on §7.1, including "Custom amount", where the guest types the total they want to
   pay and the tip is the difference.
3. The waiter charges that guest on the same Pay screen as a whole bill ("Guest 1 of 3"), with Card,
   Cash and Remove tip. A list of the shares shows who has paid, who is paying and who is still to pay.
4. Between guests: what the last guest paid and where the receipt went, who has paid (with how and
   their tip), "Next: Guest 3 · €24.43", "Print payment slip", and "Change the number of guests",
   which shares out what is left again.

**Each share is fixed, so a guest's tip cannot be lost.** The owner's case: a €90 bill split between
3, the first two hand over €35 each meaning €5 tips, and the last asks what is left and pays €20, so
the tips disappear. Under Split equally each share is €30, so €35 is €30 plus a €5 tip, and the last
guest is told €30. Both the till and the phone keep the split from guest to guest. Today only the
phone does; the till clears it after each payment. The owner: "a lot can be solved by the waiter
saying 'do you want to split it evenly' at the start of payment".

**Items.**
1. The bill's dishes, each with a tick box; "Tap the dishes this guest is paying for". A row of more
   than one gets "Paying for 1 of 3" with − and + underneath, and its price for that many.
2. "Pay for 2 dishes · €17.70" leads to this guest's tip screen (when tips are on), then the Pay
   screen for those dishes, which says once: "These dishes move to a bill of their own with its own
   receipt. The rest stays on Bill 1." (as today, A1515).
3. Paid: what was taken, "Bill 2 · paid" with its dishes and tip, then what is still on Bill 1.
   "Next guest: choose dishes" is the main button, "Pay the rest · €55.50" the second.

A row of identical dishes is several order lines shown as one (A803 §3.1: one order line is one
portion), so the stepper picks lines, and a dish with options can be paid for one at a time like any
other. Today's till offers a dish with options only whole; the owner: "the group of it as 3 x burger
with onions is a display artifact only. if that isn't the way it works, then it should be". A dish
sold by weight is still paid whole. Editing one of a group (unfold, open, change) regroups it when the
row folds again (§4).

**An amount.**
1. "How much is this guest paying?" with the Cash keypad, and "Still to pay after this" updating as
   the waiter types. More than is owed: cash gives change, a card takes the extra as a tip (today's
   rule).
2. **"Their own receipt for €20.00"** is a switch on the same screen, off by default ("Otherwise it
   goes on the bill's receipt at the end"). Today the till asks a question after the amount.
3. **No tip screen is turned to the guest.** The amount goes towards the bill. The owner: "it feels a
   bit obvious to hand over just an amount and 'WANNA TIP???'". A small "Add a tip" link is there for
   the waiter, for a guest who says "€30, and €5 for you" (a call made in the write-up).
4. Paid: what was taken, then a box with the bill's total, each payment on it and "Still to pay".
   "Pay the rest · €35.50" first, "Another amount" second.

**Other card machine.**
1. The amount to type on the machine in large type, and three steps: type it on the machine, wait
   until it says the payment went through, then tap the button.
2. **"Which card machine"**: a dropdown of the venue's other card machines, starting on the one this
   phone used last. With only one machine, there is nothing to choose and its name is shown. The
   owner: "maybe the 'other card machine' should be a list maintained in waitron so we can just
   select from the dropdown".
3. "Operation number (optional)" stays in view (owner: "so the person doesn't have to tap in").
4. "It went through · €80.52" records it; "It was declined" goes back to Pay with nothing recorded.

The list replaces today's typed machine name and the "Card taken on" question a venue with SumUp sees.
Each machine on the list says where its payments go: the venue's SumUp account, or another bank. A card
reader paired with Waitron is not on it: it cannot take a card on its own when the box cannot reach it
(owner, 2026-11-26). A hand-keyed card still opens the drawer for its slip, on a device whose profile may open
one (§7.8).

### 7.10 (pass 3) How the ways to pay look

What the pictures `ba`–`bd` show, element by element, so the build does not have to guess. The
colours and sizes are the design-system tokens (`--wt-*`); "lifted" is
`--wt-color-surface-lifted`, "muted" is `--wt-color-text-muted`, "line" is a 1px
`--wt-color-border`. Every screen is full screen on a phone, with the app bar of §4: a back link on
the left (chevron-left icon and the previous screen's name, in the primary text colour), a centred
title with a muted subtitle (the bill, and what is left where it matters), and on a screen that
charges a card the device button on the right (a 44px square with a line border and the NFC icon,
three arcs). Buttons at the foot sit in a bar with a line above it, full width, one under another,
52px high: the main one filled in `--wt-color-primary`, the others plain (`--wt-color-surface`) with a line border, and a
text link (primary text colour, no border) last.

**The amount block** (`ba` 3, `bb` 2, `bd`): a muted label ("To pay", "Charge on the other
machine") above, the amount centred in 42px bold with tabular figures, and a muted line under it
("Share €24.44 + tip €2.44", "Dishes €17.70 + tip €1.77"). "Remove tip" sits on the same line,
after it, as a bold text link in the primary text colour. On a Paid screen (`ba` 4, `bb` 3, `bc` 2)
the amount is 30px and reads as a sentence ("€24.43 by card"), with where the receipt went under it.

**Guest count** (`ba` 1): a muted question above; a round 56px button with "−" (line border, plain),
the number in 44px bold, a round 56px "+"; centred on one row.

**The list of shares** (`ba` 1, 3, 4): one card with a line border and rounded corners (10px), rows
divided by lines. Each row: a round 22px marker on the left, the guest's name with a muted second
line (what they did: "to pay", "paying now", "card · tip €2.44", "next"), and the share at the right
end in tabular figures. The marker is an empty ring (line colour) for "to pay", a filled
primary-colour dot for the guest paying now or next (that row's background lifted, its text bold),
and a primary-colour ring with a tick (check icon) for a guest who has paid (that row's text muted).
Under the card, a muted centred note when shares differ by a cent (`ba` 1), or a text link
("Change the number of guests", `ba` 4).

**The guest's share** (`ba` 2): the §7.1 guest screen. The language pill (line border, rounded) at
the top left and "Skip ›" (muted text) at the top right; the venue's name (muted) above "Your share"
in 24px bold, a muted line with the table, "Guest 1 of 3" and the bill; the share centred in 42px;
"Leave a tip?" (muted) above the tip choices drawn as §7.11's step 2 (one under another, full
width, 64px, the percentage at the left and its amount on the share at the right end), then "Custom
amount"; one plain button at the foot, "No tip · hand back to your waiter". `ba` 2 draws the three
percentages side by side; they follow step 2 so the two tip screens match (owner, 2026-11-26: "A", the column on both).

**The dish rows** (`bb` 1): rows the full width, plain, with a line under each, at least 52px high.
Left to right: a 24px square tick box with rounded corners, the quantity (bold), the name with any
options muted under it, and the row's price at the right end (the whole row's price). The tick box
is empty (line border) when not chosen, filled in the primary colour with a tick in the surface colour when the whole
row is chosen, and primary-bordered with a "−" when part of it is. A chosen-in-part row gets a lifted
strip under it, indented to the name: "Paying for" (muted), a stepper (− and +, rounded, line border)
showing "1 of 3", and that part's price at the right end. On the Pay and Paid screens (`bb` 2, 3) the
same rows show without tick boxes; a muted section label ("Paying for", "Still on Bill 1 · €55.50")
heads them.

**The paid bill card** (`bb` 3): a card with a line border, "Bill 2 · paid" in bold with its amount
at the right end, and a muted line naming the dishes and the tip.

**An amount** (`bc` 1): a muted question; the amount in a field 40px bold, centred, with a 2px
primary border while it is being typed into; under it "Still to pay after this" on the left and the
figure in bold at the right end; then a card with a line border holding "Their own receipt for
€20.00" with a muted explanation under it and a switch at the right end (off: grey track); then
the keypad of §7.5 (three columns, 46px keys with line borders, the decimal point bottom left and
backspace bottom right).

**The bill box** (`bc` 2): a card with a line border; "Bill 1" and its total; each payment as a
muted row with its amount after a minus sign at the right end; a line, then "Still to pay" in bold.

**Other card machine** (`bd`): under the amount block, a lifted panel with rounded corners holding
the three numbered steps; then "Which card machine" (muted label) over a 48px dropdown with a line
border: the machine's name in bold, where its payments go (muted, "bank", "SumUp") near the right
end, then the chevron-down icon. Open, the list hangs under it in a card with a line border, the
chosen machine's row lifted and bold. Then "Operation number (optional)" (muted label) over a 44px
field with a line border and a muted placeholder ("from the machine's slip"). The foot holds "It went
through · €80.52" (filled) over "It was declined" (plain).

### 7.11 How the Pay screens of §7.1–§7.8 look

What the pictures `o`, `q`, `r`, `k` and `ah` show, element by element, so the build does not have
to guess. Where a later decision changed a picture, this follows the decision and names the frame
that still draws the look. The tokens, the app bar and the foot bar are as in §7.10 ("lifted",
"muted", "line" and "plain" as named there): a back link on the left, a centred title with a muted
subtitle, and on a screen that charges a card the 44px device button on the right (line border, 8px
corners, the NFC icon: three arcs). Foot buttons are full width, 52px high, one under another, 8px
apart, the main one filled in `--wt-color-primary`, the others plain with a line border, a text link
last.

**The guest's bill, step 1** (`ah` 1). No app bar. A top row on the page ground (`--wt-color-bg`):
the language pill at the left (36px high, fully rounded, line border, the language name in bold 14px
with the chevron-down icon after it) and "Skip ›" at the right (bold 14px, muted, no border). Under
it, the venue's name (16px, muted, bold), "Here is your bill" (24px bold) and a muted 13px line with
the table and the date and time. The dishes follow as plain rows the full width, a line under each:
the quantity in a 28px column, the customer-facing name, and the price at the right end, 15px. Then
"Total" and the amount on one row, 20px bold, the amount at the right end. The foot holds "Leave a
tip?" (filled) over "No tip · hand back to your waiter" (plain), the same size.

**Step 2, Leave a tip** (`o` 2). "Leave a tip" (26px) and a muted line, "On a bill of €73.20." Then
four buttons one under another, full width, 64px high, 10px apart, with 16px margins: the percentage
in bold 20px at the left and its amount, muted 17px, at the right end; the last reads "Custom
amount" with nothing at its right. A chosen percentage has a 2px primary border and a lifted
background; the others are plain with a line border. The foot holds "Done · hand back to your
waiter" (filled) over "Back to the bill" (plain). The top row is step 1's; `o` 2 predates it and
puts the venue's name there instead. Skip shows on step 1 only; steps 2 and 3 go back with their
plain button. Done is the design system's disabled button until a choice is made (calls made in the
write-up).

**Step 3, Custom amount** (`o` 3). "How much would you like to pay?" (26px, it wraps) and a muted
line, "Your bill is €73.20. Anything above it is a tip." A field 16px in from each side with a 2px
primary border (it is being typed into), 8px corners and a plain background: "You pay" muted 14px at
the left, the amount in 34px bold with tabular figures at the right end. Under it, one row: "Bill
€73.20" muted at the left, "Tip €6.80" at the right with the figure bold in the text colour. Then
the keypad of Cash (below). The foot holds "Done · hand back to your waiter" (filled) over "Back to
the percentages" (plain). Below the bill's amount Done is the design system's disabled button.

**Pay** (`ah` 2). App bar: "‹ Table 4", "Pay" over "Bill 1", the device button. The amount block:
muted 13px "To pay", the amount centred in 42px bold with tabular figures, and a muted 14px line
"Bill €73.20 + tip €7.32" with "Remove tip" after it on the same line, a bold primary text link.
The ways to pay sit under it, 12px in from each side, 8px apart: four full-width buttons, each 56px
high with 10px corners, a line border and a plain background. In each, left to right: a 22px column
holding the check icon (primary text colour) on the chosen one and empty on the others, so the names
line up; the name in bold 17px; and at the right end a muted 14px hint ("between guests", "choose
dishes", "type it"), or on Whole bill the amount. The chosen one has a 2px primary border and a
lifted background. Under them, "Full invoice instead", a centred bold 14px primary text link. The
foot holds "Charge €80.52" (filled, the card icon beside the text, before it), "Cash" (plain) and
"Other card machine" (a centred text link). `q` 1's segmented row of four tabs is not used.

**Pay with a full invoice set up** (`q` 2). The link is replaced by one line in a box 12px in from
each side (line border, 8px corners, plain, 14px text): "Full invoice" in bold text colour, then
muted "· Garcia Lopez SL" and, on a second line, "Printed on Office"; "Change" at the right end, a
bold primary text link 40px high. Under the box, "Receipt instead" as a centred text link. The rest
of Pay is as above.

**The device sheet** (`r` 1–3), opened by the device button, which turns lifted while the sheet is
open. The screen behind is dimmed (a 40% black scrim) and the sheet rises from just under the app
bar, plain, with 16px top corners and a grab handle (40 by 5px, `--wt-color-surface-sunken`). At the
top, the live camera, 230px high, 16px in from each side, 12px corners, with four corner brackets
framing the middle and a caption along its foot: "Point at a device's QR sticker · scan as many as
you need". The camera's dark ground, the brackets and the caption are drawn in fixed colours, as a
camera view would be. Under it, a muted 13px hint: "Or choose below. Tapping a device on the phone
works on any screen." After a scan (`r` 2) the hint gives way to a notice with 8px corners, the
check icon beside "Picked up Reader 3" in bold 14px; it is drawn with a fixed pale green background
and dark green text, and the build takes it from `--wt-color-success`. Then one dropdown per device
this payment uses, 56px high, 16px in from each side, 8px apart, with a line border, 8px corners and
a plain background: a muted 12px label ("Card reader", "Receipt printer", "Payment slip printer", or
"Invoice printer" in the receipt printer's place, `r` 3) over the device's name in 16px, and the
chevron-down icon at the right end. The dropdown a scan just changed has a 2px primary border and a
lifted background (`r` 2). The cash drawer's dropdown, where the profile allows one, is the same,
labelled "Cash drawer". At the sheet's foot, "Done"
(filled, full width, 52px), with no line above it.

**The full invoice's details** (`q` 4). App bar: a back link, "Full invoice" over "Bill 1", nothing
on the right. `q` 4's back link reads "Table 4"; by §7.10's rule it names the screen before, "Pay".
The fields come one under another, 12px in from each side and 10px apart, postcode and city side by
side, each with a muted 12px label over the value and the required mark; the picture draws them with
a muted 2px underline and the asterisk in a fixed red, but they are the shared field primitives and
take their look from there. Then "Send the invoice" as a muted 12px label in capitals, and a
two-part switch, "Print it" and "Email it", 44px high with a line border and 8px corners, the chosen
half filled in the text colour with its words in the surface colour. Under it, with Print chosen, a
"Printer" dropdown with the chevron-down icon at the right end, showing "Office (A4)". With Email chosen, an "Email address" field
(the shared field primitive) takes the dropdown's place. The foot holds "Use full invoice" (filled) alone.

**Cash** (`ah` 3). App bar: "‹ Pay", "Cash" over "Bill 1", no device button. The amount block as on
Pay, without Remove tip. Then the quick amounts in a 2-by-2 grid, 8px apart, 12px in from each side:
"Exact" and the next notes up, each 56px high, 10px corners, line border, plain, bold 18px; the one
chosen has a 2px primary border and a lifted background. Under them a lifted panel with 10px
corners: "Give back" (16px) at the left and the change at the right end in 26px bold. Then the
keypad: three columns, 6px apart, 46px keys with 8px corners, line borders, plain, 18px figures; 1
to 9, then the decimal mark bottom left, 0, and the backspace icon bottom right. The foot holds one
filled button saying what happened: "Took €90.00 · give €9.48". An amount typed on the keypad shows
in a field above the quick amounts, drawn as An amount's field (§7.10), and clears the quick choice
(a call made in the write-up).

**At the reader** (`k` 3). App bar: no back link and no device button; the title names the way to
pay, with a muted subtitle ("Split equally" over "Bill 1 · guest 1 of 3"). One centred column in the
middle of the screen: a 96px ring with a 4px edge in `--wt-color-surface-sunken`, its top quarter in
the primary colour, with the card icon inside; "Tap or insert the card" (22px bold); the amount in
44px bold with tabular figures; the reader's name in 22px bold, as §7.6 asks (`k` 3 draws it at 15px; the spec wins); a muted 15px
line "waiting 0:14"; and a muted 13px note, "The reader is in charge now: this screen moves
on by itself when the card is accepted or declined." There is no foot bar. The one thing to press is "Cancel payment", shown only while a SumUp payment
is still waiting: a centred text link, 14px bold in the primary text colour with no border, 44px tall
to tap, 24px under the note. Once tapped it becomes muted 14px text, "Stop requested. Checking the
payment…", and cannot be tapped again; if the reader is not ready or refuses, today's message takes
its place (`bill_pay.stop_unavailable`, `bill_pay.stop_refused`). The ring's primary quarter turns while it waits, and
stands still when the device asks for reduced motion. "Pay the next guest (2 of 3)" afterwards is §7.10's between-guests screen.

**Paid** (`k` 4, brought into line with §7.10's Paid screens). One layout for every Paid screen,
whole bill or part (a call made in the write-up: `k` 4 and pass 3's `ba` 4, `bb` 3 and `bc` 2 were
drawn differently). App bar: "‹ Table 4", "Paid" over the bill and what is left on it, nothing on the
right. A centred column near the top: a 56px filled circle with the check icon (`k` 4 draws 96px in
a fixed pale and dark green; the build uses `--wt-color-success`), then what was taken as a sentence
in 30px bold ("€80.52 by card"), and where the receipt went in muted 14px under it ("Receipt printed
on Bar"). Then the facts as `k` 4's full-width list, a line above and a line under each row, 15px,
the label muted at the left and the value at the right end: how it was paid ("Card · Reader 2"),
any tip, and "Still to pay on Table 4" with "Bill 2 · Ana €21.90". On a part payment the bill box of
§7.10 (`bc` 2) or the share list (`ba` 4) takes the list's place. The foot holds the next step
(filled: "Pay Bill 2 · Ana", "Next: Guest 3 · €24.43", "Pay the rest · €35.50"), then "Back to Table
4" (plain) where the next step is not already that, then "Print payment slip" as a centred text link
with a muted 13px note under it, "Only if the guest asks. It prints once." Once printed, the link
becomes muted text, "Slip printed", and does nothing. With nothing left owed on the table, the foot
holds "Back to Table 4" (filled) and the slip link; the table is freed by Finish table, never here.

### 7.12 (pass 3) After payment: Find a bill, the receipt, refunds and corrections

Decided with the owner on the evening of 2026-11-26 from pictures `be`–`bh` (§12).

**"Refund" everywhere.** Every "Give money back" and "Give back" on the till becomes "Refund" (owner,
2026-11-26: "refund everywhere, i don't like 'give money back'"), carrying out A803 §3.10. "Money back
under way" becomes refunds wording too.

**Find a bill** (`be`), from ☰ → Bills and cash (§9.9).
- **Finished sales only.** Today's "Bills" tab of open bills goes: open bills live on the floor's
  jobs and the counter zones' order lists (owner: "i think only closed bills are needed").
- One list, newest first. Each row: the time, where (table, or the counter's order number), how it
  was paid (with a card's last four digits) and who served, the amount at the right end with the
  invoice number under it. A full invoice and a refund carry a small label.
- One search box: "Number, table, name, card digits or amount". **Searching by amount is new**: a
  guest who says "you charged me €80.52" is found by typing it.
- Chips for the days (Today by default; Yesterday, This business day, Last 7 days, This month, From /
  To, Any date, as today), the staff member and the kind (sale, full invoice, corrective receipt or
  invoice, refund).
- Refunds still waiting on the card company sit in a strip on top, opening today's list of them.

**The receipt screen** (`bf`), from a row of Find a bill: the receipt as printed, then three
full-width actions, each with a hint at its right end, plus a fourth (below):
1. **Print again**, with this phone's printer as its hint. It opens a sheet with a printer dropdown
   and the language (starting on the guest's), and "Print on Bar".
2. **Make it a full invoice**, hint "for a company". **New.** It opens §7.4's details screen and
   issues a full invoice in place of this simplified receipt (AEAT's F3, "sustitutiva"). The
   receipt is not cancelled and the new invoice is not a second sale; it names the receipt it
   replaces and the customer. It is built on the best reading of the rules
   (`docs/compliance/verifactu-findings.md` §10.2): the same series as full invoices, as AEAT's own
   invoicing app has it, and any simplified receipt may be replaced. The adviser's open question
   Q5(d) is asked for confirmation rather than waited on (owner, 2026-11-26: "let's build it and ask
   for confirmation instead of waiting"). A receipt already replaced cannot be replaced again.
3. **Refund**, hint "up to €80.52".
4. **Change how it was paid** (below).

**Refund** (`bg`).
1. "What is the refund for?": three choices with a line each: **Dishes** ("Something never came, or
   was not right."), **An amount** ("For example, for a complaint."), **The tip** ("Some or all of the
   €7.32 paid on top of the bill."). Today's "A dish", "Goodwill or a complaint" and "Extra paid on
   top of the bill".
2. Dishes: the Items list of §7.9 (tick dishes, a stepper for part of a row), "Why" from the venue's
   reasons, and the amount, worked out and editable as today.
3. "How it goes back": each way back with the most that can go there ("Card ··4821 · up to €80.52",
   "Cash · up to €80.52"), and one sentence saying what will happen, including the corrective receipt
   Waitron chooses ("€14.50 is refunded to card ··4821. A corrective receipt prints on Bar."). Staff
   never choose the tax record, as today.
4. When the person signed in may not refund, a sheet: **"Supervisor approval required"**, "Refunds
   need a supervisor or manager. Hand them the phone.", who approves, and their PIN. Today's rule.
5. Refunded: "€14.50 refunded on card ··4821", the corrective receipt's number and printer, "Back to
   the receipt" and "Find a bill". A card refund still waiting says so here and in Find a bill's strip.

Refunding on another card machine, a refund waiting on the card company, and refunding the rest stay
as today, under the new words.

**Change how it was paid** (`bh`). **New.** For a sale recorded as cash that was really paid on
another card machine, or the reverse, so the drawer count comes out right.
1. "How it was paid": the receipt's payments. Cash and other-card-machine payments have "Change" at
   their right end. A payment taken on a reader Waitron drives is shown muted and cannot change ("the
   card company holds it").
2. "Change to": Cash or Other card machine, with §7.9's machine dropdown and operation number, and
   one sentence: "The drawer will expect €12.40 less at the close. The receipt and its invoice number
   stay the same." Saving: "Save · paid on BBVA terminal".
3. Changed: "Now paid on BBVA terminal", what it was, who changed it and when, and "Print the receipt
   again".

**Any waiter may change it, and the change is recorded** (owner, 2026-11-26: "any waiter with a
record of the change"); no supervisor is asked. A payment can change only until its drawer is closed
for the day (a call made in the write-up). How a sale was paid is not part of its tax record
(`SaleForFiscalRecord`, `packages/fiscal/src/backend.ts`, carries no payment method), so the change
never touches what is filed.

**Corrections otherwise stay as built**: a dish or price is put right with Refund; a printed bill
not yet paid is reopened or cancelled from the bill's menu ("Reopen bill", "Nothing was served").

### 7.13 (pass 3) How the after-payment screens look

As §7.10 (tokens, app bar, foot bar); pictures `be`–`bh`.

**Find a bill** (`be`). Under the app bar ("‹ Back", "Find a bill" over "Paid today" or "2 found"), a
plain band with a line under it holding the search field: 44px, 8px corners, line border on the page
ground, a magnifier icon (search) before the muted placeholder; while typing, a 2px primary border and
the text in the text colour. Under it, on the same band, the chips: 36px, fully rounded, line border,
bold 14px, the chevron-down icon after the words. Then the refunds strip: lifted, 10px corners, 12px
in from each side, "1 refund under way" bold 15px over a muted 13px line, the chevron-right icon at
the right end. A muted bold 13px label ("Newest first", "Matching the amount") heads the rows. Each
row is plain with a line under it, three columns: the time, muted 14px in tabular figures, 48px wide;
the place in bold 15px over a muted 13px line that starts with an 18px icon (card, cash: a note with a
circle, or the refund's undo arrow) then the way and the person; and at the right end the amount, bold
in tabular figures, over the invoice number in muted 12px. A label ("Full invoice", "Refund") is a
small fully rounded pill, bold 11px on `--wt-color-surface-sunken`, before the line's words. A
matched amount is set on a lifted background.

**The receipt screen** (`bf`). App bar "‹ Find a bill", the receipt number over "Table 4 · 22:58 ·
Ana". The receipt itself on a plain card with a line border, 4px corners and `--wt-shadow-1`, in a
monospace face at 12.5px, dashed lines between its parts, as the printer lays it out. The foot holds
the actions one under another, 52px, 8px corners, line border, plain: a 20px icon in the primary text
colour first (printer, a page with lines for the full invoice, the undo arrow for Refund, and for
Change how it was paid a cash note), the action in bold 16px, and the hint muted 13px at the right
end. Print again's sheet: §7.11's sheet (scrim, 16px top corners, grab handle), "Print again" bold
18px, two 48px dropdowns with muted labels (Printer; Language), and a filled "Print on Bar" with the
printer icon before the words.

**Refund** (`bg`). Choices are §7.9's option cards: 10px corners, line border, plain; the name bold
17px over a muted 13px line, and at the right end, where there is one, the limit in bold tabular
figures ("up to €80.52"); chosen, a 2px primary border on a lifted background. "Why" is a 48px
dropdown under a muted label; the amount is a 44px field at the right end of a "Refund" row, bold 18px,
the figure right-aligned. The sentence of what will happen sits in a lifted panel, 10px corners, 14px.
"Supervisor approval required": §7.11's sheet; bold 18px title, a muted line, a "Who approves"
dropdown, four PIN dots (14px circles, filled in the text colour as digits arrive), and the keypad of
§7.5. Refunded: a 64px circle in `--wt-color-success` with the check icon in the surface colour, the
outcome as a 30px bold sentence, the corrective receipt in muted 14px; the foot "Back to the receipt"
(filled) over "Find a bill" (plain).

**Change how it was paid** (`bh`). A muted 14px label over each group ("Payments on this receipt",
"Taken on a card reader Waitron drives"). Each payment is a card, 10px corners, line border, plain:
the way in bold 16px over a muted 13px line (time and person, or the reason it cannot change), the
amount bold in tabular figures, and "Change" as a bold text link in the primary text colour at the
right end. A payment that cannot change has no link, a transparent background and muted text. "Change
to" uses the option cards, §7.9's dropdown and operation number field, and the lifted sentence panel;
the foot holds "Save · paid on BBVA terminal" (filled). Changed: the success circle, "Now paid on BBVA
terminal" 26px bold, a muted 14px line of what it was, by whom and when; the foot "Back to the receipt"
(filled) and "Print the receipt again" (a text link).

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

- Clock-in, My hours and the drawer.
- Loading states, and the Spanish wording.

## 11. Open questions

1. **Finding a returning invoice customer.** Today's invoice form has no way to look one up; that
   would be a new feature. Not decided.
2. **The tip percentages.** Drawn as 5%, 10% and 15%; whether a venue sets its own belongs to the
   tips design.
3. **(pass 2) A tip paid in cash** stays in the amount on the Cash screen (§7.5). How a cash tip is
   recorded and shared out stays with the tips design.
4. **The guest's tip choices are drawn two ways** (`o` frame 2 a column, `ba` frame 2 a row of
   three). Settled by the owner, 2026-11-26, shown both frames side by side and asked "column,
   row, or each its own?": "A" (the column), on both screens, so the guest's two tip screens match.

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
do; (pass 3) `ba` Split equally, `bb` Items, `bc` An amount, `bd` Other card machine, `be` Find a bill, `bf` the
receipt screen, `bg` Refund, `bh` Change how it was paid, `tipcmp` the two tip screens compared; `sum-a`, `sum-b`, `sum-c` a storyboard of the phone screens, in which frames 12 and 13 predate the
bill dropdown and frame 4's ☰ still lists "Choose zones"; (2026-11-27) `bi` removing and moving new
dishes: the bin and "Move" in the selection foot, the bin while dragging, and Undo after removing. Turned down or superseded: `w` (an edit
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
- (pass 3) **Split equally is kept by the screen** from guest to guest on the till as on the phone
  (today `#startAgain` in `apps/till/src/widgets/bill-pay-dialog.ts` clears it on the till); the
  server keeps no record of a split, and §7.9 needs none.
- (pass 3) **Items offers a dish with options a line at a time**: today `unitTotal` is null for any
  line with extras (`apps/till/src/state/bill-payment.ts`); the server's part-line check reads as
  allowing it (`checkLinePart(..., { splitExtras: true })` in `apps/server/src/pay-for-items.ts`),
  not tried.
- (pass 3) **"Other card machines" is a new venue list on the dashboard's card readers page**
  (name, and where its payments go), read by the till; it replaces the free-text machine name and
  the SumUp radio in `apps/till/src/widgets/outside-card.ts`. What a stored payment keeps of the
  machine is the plan's to propose.
- (pass 3) **"Refund" replaces "Give money back" and "Give back"** in every till string (the
  `give_back.*` and `bill_refund.*` keys' English and Spanish), as §7.12 says. (2026-11-27, the
  watcher: in Spanish "Devolver dinero" becomes "Devolución" and the button stays "Devolver"; see
  [the R1 plan](../plans/2026-11-27-o-r1-refund-wording.md).)
- (pass 3) **Find a bill searches by amount** (new on `apps/server/src/find-bill-transactions.ts`) and
  drops the Bills tab (`apps/till/src/screens/till-find-bill-screen.ts`).
- (pass 3) **Make it a full invoice** is the F3 build deferred in
  [2026-10-03-full-invoices-at-till-design.md](2026-10-03-full-invoices-at-till-design.md) ("F3
  conversion is later"): `recordSubstitution` (`packages/core/src/record-substitution.ts`) has no
  route yet; it needs lookup, the recipient, a refusal of a second exchange, delivery and report
  tests. A fiscal change: it lands only with the owner's approval. The adviser is asked Q5(d) for
  confirmation in parallel.
- (pass 3) **Change how it was paid** is new: a recorded, any-staff change of a payment's way (cash ↔
  other card machine) until its drawer is closed, reflected in the drawer's expected cash and on a
  reprint; never on a reader payment, never on the tax record.
- (pass 2) **Lane D's point 8**: in the demo, a device-verification warning stayed after a reload while
  seating, joining and ordering still worked (2026-11-11). Reproduce and fix it in the build.

## 14. How it looks

Read off the approved pictures (§12), so that a lane builds what the owner approved rather than
guessing. Added on 2026-11-26 at the watcher's request, after lanes drew ☰'s rows with icons and
Clock out as a link. Each line names its picture and frame: "`aj` 1" is frame 1 of picture `aj`,
frames counted from the left. The sizes for passes 1 and 2 come from the stylesheets the pictures
were drawn with; pass 3's (`ba` to `bd`) were read off the pictures by eye.

How to read it:

- **The paying screens are given in more detail in §7.10 and §7.11**, read from the stylesheets;
  §14.5 agrees with them, and where it does not, they win.
- **The text wins over a picture.** Where a frame and §3 to §9 differ, the text is the decision. The
  known cases are in §14.1.
- **Sizes** are as drawn, in pixels. Build them with the declared values: drawn 12 or 13 is
  `--wt-font-size-sm`, 14 or 15 `--wt-font-size-md`, 16 to 18 `--wt-font-size-lg`, 20 and over
  `--wt-font-size-xl`; drawn bold (700) is `--wt-font-weight-bold`. Nothing tappable is smaller than
  `--wt-tap-min`. (A call made in this write-up.)
- **Colours**, in the words used below: **teal** is `--wt-color-primary` with
  `--wt-color-on-primary` text; **light blue** (chosen, selected, last added) is
  `--wt-color-surface-lifted`; **outlined** is `--wt-color-surface` with a 1px `--wt-color-border`;
  **dark** is `--wt-color-text` with `--wt-color-surface` text; **muted** text is
  `--wt-color-text-muted`; **small capitals** are headings in upper case, 12 or 13, bold, muted,
  slightly letter-spaced. Tables' and jobs' colours, rings and pulsing are A757's as built (§9.2);
  the pictures only imitate them. A warning or danger tint means today's.
- **Icons** are `wt-icon` names. Already registered: `hamburger` (☰), `kebab` (⋮), `close`, `plus`,
  `minus`, `check`, `chevron-down`, `menu-section` (a menu folder) and `floor-plan-rotate` (the turn
  handle), and for the grip `column-grip`, the drag handle `wt-data-table` registers. An icon
  marked **new** has no name yet: it is added once, in `packages/ui`, with the shape given. **No row in a list or menu starts with an icon**
  unless its line below says so; the `menu-*` icons are not used on these screens.

### 14.1 Where a picture is out of date

- `ag` 1 to 3 and `aj`: Map and List are drawn as two joined halves. Build **one** outlined button
  naming the other view (§9.1), as `ak` 1 and `ak` 3 draw it.
- `aj` 1: the headings "Tonight in the Dining room" and "You" are built as "Dining room · until the
  next service" and "Your time", and "Taken off tonight" as "Taken off" (§9.9).
- `v`, `x`, `z` 1, `ab` and `ad` were drawn before the bar at the bottom: their top bar ("Tables",
  zone chips, Map/List) and the tab bar at their foot are gone. Take only their sheets, tables and
  rows. `ab` 3's "Take off for tonight" is "Take off"; `v` 2's "Seats for today", "Name for today"
  and "Take off for today" are "Seats", "Name" and "Take off" (§9.5).
- `i` 2, `h` 1 and `v` 1: "Floor plan: seats, name, rotate" is gone (§6). `v` 1 draws Finish table
  as a teal row; it is built as `i` 2 draws it (§14.4).
- `d` and `m`: the menu path's "Home" is a home icon (§5).
- `d`, `f`, `g`, `i`, `j`, `u`: back reads "‹ Tables". With the tabs gone it reads "‹ Floor", as
  `af` draws it (§4: "back to the floor").
- `f` 2 and 3, `g` 3: an opened new row shows Remove and "Split into 3". Remove moved to the
  selection foot and splitting is the row's arrow (§4), so an opened new row holds only the
  quantity, Options and Note.
- `af` 1 draws "Menu" in the foot without its ⌃; it keeps it, as `d`, `g`, `i` and `j` draw it.
- `af` 3 draws the selection foot as "Move to…" and "Send these 3 now". It is `bi` 1's: a bin, "Move"
  and "Send these 3 now" (2026-11-27). `af` 2's foot gives way to `bi` 2's bin while a row is dragged.
- `i` 1: one tab per bill; built as `j` frame B's dropdown (§4).
- `q` 1 and 2, `k` 1: the ways to pay as four joined buttons; built as `ah` 2's column (§7). `q` 3
  was turned down; the device sheet is `r`.
- `m`: the tabs across the top are gone; a till's bar is `ai`'s, at the bottom (§9.10).
- `ak` 3 draws a Map button on "All zones"; a phone shows none there (§9.3). The tick meant to sit
  above "Nothing needs doing" did not draw, and the owner approved the frame without it: there is
  none.

### 14.2 Pieces used on every screen

- **Top bar** (`af`, `ah`, `k`): white, 56 tall, a line under it. Left: back, a ‹ (`chevron-left`,
  new) and the word, teal text, 15 bold, no box around it. Centre: the title 17 bold, a subtitle 12
  muted under it. Right, where the screen has one: an icon button, outlined, 44 square, 8 radius. On
  the order screen a `chevron-down` follows the table's name.
- **Selecting or joining header** (`af` 3, `x` 1): takes the top bar's place, dark, with the title
  at the left, 18 bold ("3 selected", "Join Table 4 with…"), and **Cancel** at the right as a button
  outlined in the header's text colour, 40 tall, not a link.
- **A sheet rising from the bottom** (`aj`, `i`, `j`, `v`, `r`): white, its top corners rounded 16,
  a grab handle centred at its top (40 by 5, `--wt-color-surface-sunken`), a shadow above it; the
  screen behind it dimmed (black at 40%). Its sections start with small capitals.
- **Menu row** (`aj` 1, `i` 2 and 3, `h` 1 and 2, `v`): full width, 46 to 60 tall, a line between
  rows, the label 16 regular at the left and **no icon before it**. At the right, muted 14: a value
  or a count where there is one ("Nuts", "3", "Garcia"), then › (`chevron-right`, new) on a row that
  opens a screen. A row that acts at once has no › ("Print the bill", `i` 3). A yes-or-no setting
  has today's switch at the right instead ("Bill requested"), teal when on.
- **The foot** (`d`, `ah`, `k`): a white bar with a line above it; buttons 52 tall, 8 radius, 16
  bold; the main action teal, the others outlined. Side by side on the order screen (Menu, Pay,
  Send); stacked full width on Pay and the guest's screens. The lesser way sits under the stack as a
  teal link, 14 bold, centred, with no border ("Other card machine").
- **Course heading** (`d`, `af`): small capitals on the page background, with a pill at the right,
  13, fully rounded: "✓ Sent" (`check`) in today's quiet green, "sends now" teal, "held · fire
  later" grey (`--wt-color-surface-sunken`).
- **Choice tile** (`f` 1, `ah` 2 and 3, `o` 2, `u`): outlined, 8 to 10 radius, 56 tall. Chosen: a
  2px teal border and light blue, with a teal `check` at the right on an option and at the left on a
  way to pay. A hint, muted, at the right ("between guests", "+€1.50").
- **Keypad** (`ah` 3, `o` 3, `bc` 1): three across, outlined keys 46 tall, 18 regular. Bottom row:
  the decimal separator, 0, and ⌫ (new: a tag shape with an ×). The pictures draw "," (`ah`, `o`)
  and "." (`bc`); the key shows the language's own separator. (A call made in this write-up.)
- **Stepper** (`d`, `f`, `g`, `h` 3): one outlined box 44 tall: `minus`, the number 16, `plus` in
  teal. Two other shapes are drawn where they appear: the number of guests (`ba` 1) as round − and +
  buttons, 52 across, either side of the number 40 bold; part of a row (`bb` 1) as a small rounded
  "− 1 of 2 +".

### 14.3 The floor

- **The bar at the bottom** (`ak` 1, `ag` 1): white, a line above it. Left to right: the zone button
  (takes the free width, 48 tall, outlined, 10 radius, the name 17 bold, then ⌃ (`chevron-up`,
  new)); the Map or List button (48 tall, outlined, the word 14 semibold); ☰ (`hamburger`, 48
  square, outlined). On a till (`ai`): the zone button about 300 wide, then, pushed right, the
  person's name (semibold), help (new: ? in a circle) and ☰, each 48 square and outlined.
- **The other zone's job** (`ag` 1): just above the bar, a box 44 tall, 10 radius, in today's
  warning tint: a dot in the job's colour, "**Terrace** · Collect from Bar 9 min" 15, › at the
  right.
- **The map** (`ag` 1, `ai`): the plan in a white card with a line around it, 12 radius, filling the
  screen above the bar. On each table: the number 17 bold, the job 13 bold under it, the minutes 12
  semibold under that. Today's red "!" badge at a corner stays.
- **The zone list** (`ag` 2, `aj` 2): a sheet rising from the bar. Rows 60 tall: a teal `check`
  before the zone chosen (the others keep the space empty), the name 17 semibold, its most urgent
  job at the right as a filled pill in the job's colour, 13 bold; the chosen row light blue. "All
  zones" first; kitchen screens under small capitals. At the foot, above a line: "Choose zones for
  this phone…" as a centred teal link, 15 semibold, not a row.
- **The list of jobs** (`ag` 3, `ai`): small capitals "To collect" and "Other jobs"; each station as
  a white sub-heading (its name 15 bold, "1 table" muted at the right). A job row: a 6-wide strip in
  the job's colour down its left edge; first line the job or the table, 16 bold, then the minutes 14
  in the job's colour; second line 14 muted, the table's name bold ("**Table 4** · 3 guests ·
  €73.20"); at the right, where one tap does the job, an outlined button 44 tall, 14 semibold
  ("Collected", "Fire", "Pay", "Cleared"). The calm lines at the end are muted 15 with ›.
- **A long-press** (`v`): at the top of the sheet, a square in the table's colour with its number
  (52, 10 radius), the name 18 bold and one muted line beside it; then the main action as a
  full-width teal button ("Open the order", "Seat a party"); then menu rows.
- **Holding a table** (`ab` 3): across the bottom of the map, a box 72 tall, 14 radius, with a 2px
  dashed red border and a pale red fill: a bin (new) and "Take off", red, bold.
- **Joined tables** (`x` 2): the tables inside one rounded band (a pale fill with an outline in the
  group's colour), each keeping its number; one label on the band, a pill 26 tall, 13 bold ("4 + 6 +
  8 · Garcia"). Seats in a row the same ("Bar 2–4 · Ana").
- **Joining** (`x` 1): the joining header; a muted hint under it; each table picked has a thick teal
  outline and a small teal circle with a `check` at its corner, the rest dimmed; above the teal
  "Join 3 tables", one muted sentence ("Garcia (4 guests) will sit across 4 + 6 + 8 · 12 seats").
- **☰** (`aj` 1): first the person: a teal circle 44 with their initials, the name 17 bold, "Clocked
  in at 17:02" 13 muted, and **Clock out** at the right as an outlined button 40 tall, 14 semibold,
  not a link. Then the sections, each under small capitals, as menu rows with no icons; a count sits
  muted before the › ("Add a spare table 3 ›", "Taken off 1 ›"). Language: two joined buttons at the
  right, "Español" and "English", the one in use teal. Log out last: teal text, semibold, no ›.
- **Add a spare table** (`ab` 2): a full screen. Each row: a rounded square, 44 across, in the
  free-table colour with the short name ("S1"), the name 16 and "2 seats · round" muted, an outlined
  **Add** at the right. Under "Taken off", the same with **Put back**.
- **Seating a party** (`u`): the guests as four across, two rows of outlined tiles 60 tall, the
  number 22; the one picked teal; "8 +" smaller. The name field under them. Teal "Seat 3 guests" in
  the foot. A booking (`u` 2) comes first as a card in the booked colour: a calendar (new) and
  "Booked for 21:30" in small capitals, the name 22 bold, the guests and where it was booked, the
  note in quotes, and a teal button inside the card. Then a thin line with "or a walk-in" in its
  middle; the walk-in's foot button stays outlined and greyed until a number is picked.
- **A counter zone** (`ad` 1): no map and no Map or List. "To do" rows as job rows; then **New
  order** across the full width, teal and taller than the foot's buttons; then "Open orders · 4" in
  small capitals and one row per order ("**Seats 2–3 · Ana**" bold, "5 items · sent" muted under it,
  the amount at the right).
- **When something goes wrong** (`ak`): the box out of reach is a strip at the top in today's danger
  tint, a wifi-off (new) in red, a bold first line and then the rest, with the floor under it greyed
  (faded to about half and drained of colour). Declined: centred, a circled × (new) in red, 44;
  "Declined" 22 bold; the sentence muted; the amount 40 bold; teal "Try the card again" and outlined
  "Another way to pay" in the foot. Nothing to do: a heading 22 bold and one muted line, centred,
  with no icon. A receipt that did not print: on Paid, a box in today's warning tint with a printer
  (new) and a bold heading, the reason under it, and two outlined buttons side by side.

### 14.4 The order and the menu

- **The bill** (`j` B, `af`): under the top bar, an outlined box 44 tall: "Bill 1" bold, the amount
  muted, "1 of 4" 13 muted at the right, then `chevron-down`; beside it ⋮ (`kebab`) in an outlined
  44 square. Its list (`j` B, opened) is a sheet headed "Bills on Table 4": a teal `check` before
  the current bill, the amounts at the right, "+ New bill" in teal at the foot.
- **Rows** (`af` 1): the grip at the left edge (muted, 36 wide), the quantity 16 semibold, the name
  16 medium with its options 13 muted under it, the price 15 at the right, and a `chevron-down` at
  the far right on a row of more than one. Sent rows sit on the page background, muted, regular
  weight, with no grip. The row added last is light blue.
- **Unfolded rows** (`g` 2): indented under their row, on the page background.
- **An opened row** (`g` 3): the row and its controls inside a box with a 2px teal border and
  rounded corners; the controls are outlined: the stepper, Options, Note.
- **Dragging** (`af` 2): the row lifts (a shadow, a teal outline, tilted slightly), leaving a dashed
  empty slot; the heading under it turns light blue with a dashed teal outline. "+ New course" at
  the end is a box 48 tall with a dashed border, a teal `plus` and teal words.
- **The bin while dragging** (`bi` 2): in the foot's place, a box 72 tall, 14 radius, 12 in from
  each side, with a 2px dashed `--wt-color-danger` border and a pale red fill (the colours of
  `--wt-color-tab-danger-tint`, in both themes, until the floor's Take off names a token): the `delete`
  icon and "Remove", 16 bold, in the danger colour, as `ab` 3's "Take off". With a row over it the
  border turns solid and thicker, and the lifted row's outline turns red.
- **Selecting** (`af` 3, `bi` 1): the selecting header; a checkbox takes each grip's place (24
  square, rounded 6, a 2px border; ticked, it is teal with a white `check`); chosen rows light blue;
  the foot becomes, from the left, a square 52 by 52 bin button (the `delete` icon in the danger
  colour, a 1.5px danger border, named "Remove 3" for a screen reader), an outlined "Move" and a teal
  "Send these 3 now".
- **Undo after removing** (`bi` 3): a bar in the page's colours reversed (`--wt-color-text` fill,
  surface-coloured text; dark in the light theme, light in the dark one) 52
  tall, 10 radius, 12 in from each side and 10 above the foot, with a shadow: "Croquettes removed"
  15 at the left, **Undo** 15 bold at the right, 44 tall.
- **The menu** (`d` 2): an outlined search field 44 tall with a magnifier; the path under it, a home
  (new) then "› Starters › Cooked starters", the earlier steps teal links, the current one dark.
  Tiles three across, 76 tall, 8 radius, in their section's colour as today; a section is a white
  outlined tile with `menu-section` over its name; a count as a teal circle at a tile's top right
  corner. The last added strip (`d` 2) is light blue, just above the foot: "Last added" in small
  capitals over the name 17 bold, the stepper at the right. The foot: an outlined "⌄ Order" with "5
  new · €50.10" muted at its right.
- **Options** (`f` 1): `close` at the top left; each group's name bold with "Choose one" muted at
  the right; the choices as tiles two across, 56 tall; the note as a field 52 tall with a dashed
  border and a pencil (new); the foot a stepper and a teal "Add · €21.50".
- **The table's and the bill's menus** (`i` 2 and 3, `h` 1 and 2): menu rows under "Table 4" and
  "Bill 1 · €73.20". **Finish table** stands apart at the end as an outlined full-width button, not
  a row (`i` 2).
- **Move dishes** (`h` 3): one row per dish with a stepper at the right; a row above 0 is light
  blue. "Move them to" as rounded pills, the chosen one dark. The teal foot says what will happen.
- **The till** (`m`): the menu on the left; on the right the order column with its own top bar, bill
  dropdown and foot (Pay outlined, Send teal).

### 14.5 Paying

- **The guest's bill** (`ah` 1): at the top, the language as a rounded outlined pill 36 tall
  ("English ⌄") at the left and "Skip ›" at the right, muted 14 semibold, with no box. Under it the
  venue's name muted 18, "Here is your bill" 24 bold, one muted line, the dishes, and "Total" 20
  bold. The foot: teal "Leave a tip?" over an outlined "No tip · hand back to your waiter".
- **The tip** (`o` 2): the percentages as a column of tiles, the percent 20 bold at the left and the
  amount muted at the right, with "Custom amount" as one more tile. A split share (`ba` 2) uses the
  same column, though `ba` 2 draws a row of three (§7.10; settled, §11, 4).
- **Pay** (`ah` 2): "To pay" 13 muted, the amount 42 bold, and under it a muted line with "Remove
  tip" as a teal link. The ways to pay as a column of choice tiles 56 tall, each with its hint.
  "Full invoice instead" as a teal link. At the top right, the reader and printer button (new: a
  phone with waves). The foot: teal "Charge €80.52" with a card (new) before the words, outlined
  "Cash", and "Other card machine" as a teal link.
- **Cash** (`ah` 3): the quick amounts as choice tiles two across (18 semibold); "Give back" in a
  light blue box, its amount 26 bold at the right; the keypad; the teal foot "Took €90.00 · give
  €9.48".
- **The device sheet** (`r`): the camera, dark, with white corner marks and a white caption; a muted
  line under it; one dropdown per device (a label 13 muted over the value 17, `chevron-down` at the
  right). A device just scanned: its dropdown light blue with a teal border, and above it a pale
  green line with a `check`, "Picked up Reader 3". Teal Done.
- **At the reader** (`k` 3): no back. A ring 96 across (4px, grey with a teal arc) turning around a
  card, "Tap or insert the card" 22 semibold, the amount 44 semibold, the reader's name 22 bold (§7.6
  asks for it large; `k` 3 draws it small), "waiting 0:14" muted, a muted note. Nothing to press
  but a small "Cancel payment" link while a SumUp payment is waiting (§7.6; its look in §7.11).
- **Paid**: one layout for every Paid screen, whole bill or part, given in full in §7.11: a
  `check` in a success-coloured circle, what was taken as a 30 bold sentence ("€80.52 by card"),
  where the receipt went, `k` 4's rows of facts (muted label at the left, value at the right); the
  foot: the next step in teal, an outlined "Back to Table 4", and "Print payment slip" as a teal
  link that becomes muted "Slip printed".
- **The full invoice** (`q` 4): today's labelled fields; under "Send the invoice", two joined
  buttons, Print it and Email it, the chosen one dark; teal "Use full invoice".
- **Split equally** (`ba`): the guests' stepper (§14.2); the guests in a white card, each row with a
  circle at the left (empty: still to pay; filled teal on a light blue row: paying now or next;
  circled tick: paid), "Guest 1" 15 semibold with a muted second line, the share bold at the right.
  Between guests (`ba` 4): "Guest 2 paid" muted, "€24.43 by card" 30 bold, the receipt line muted;
  "Change the number of guests" as a teal link under the list; the foot teal "Next: Guest 3 ·
  €24.43" with "Print payment slip" as a teal link.
- **Items** (`bb`): a muted line "Tap the dishes this guest is paying for"; each row starts with a
  checkbox (empty, ticked, or a minus for part of a row), then the quantity, name and price. A row
  paid in part opens a light blue line under it: "Paying for" muted, the small stepper, the amount
  bold at the right. The teal foot "Pay for 2 dishes · €17.70". After paying (`bb` 3): the paid part
  as a white card ("Bill 2 · paid" and its dishes), "Still on Bill 1 · €55.50", then the rows; the
  foot teal "Next guest: choose dishes", outlined "Pay the rest · €55.50", and "Print payment slip"
  as a teal link.
- **An amount** (`bc`): "How much is this guest paying?" muted; the amount in a box with a 2px teal
  border, 40 bold, centred; "Still to pay after this" with the figure bold at the right; a white
  card holding the switch "Their own receipt for €20.00" with a muted second line; the keypad; the
  teal foot. After paying (`bc` 2): a white card listing the bill, each payment muted and negative,
  a line, then "Still to pay" bold.
- **Other card machine** (`bd`): the amount as on Pay; three numbered steps in a light blue box;
  "Which card machine" as a dropdown (the name bold, its kind muted, `chevron-down`) whose list
  opens in place under it, the chosen row light blue; "Operation number (optional)"; the foot teal
  "It went through · €80.52" over an outlined "It was declined".
