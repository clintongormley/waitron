# Till and handheld redesign — the order, the menu and payment

Status: **approved by the owner on 2026-11-26** (design decided with the owner the same day;
the write-up approved as written). Nothing here is built yet; the build is queued with lane D.

This is the first pass of a complete redesign of the till and the handheld. It covers the overall
map of the app, the order screen, the menu, dish options, the table's and the bill's menus, and
payment, on a phone and on a till. The Tables tab (floor map and list), the Orders list, Kitchen,
More and the other screens come in later passes (§9).

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

**Tabs.** On a phone, a bar along the bottom; on a wide screen, tabs across the top with the current
one underlined in teal. Each tab shows only where the device's profile allows it (owner, 2026-11-26):

| Tab | What is in it | Shown when |
| --- | --- | --- |
| Tables | The rooms as a map or a list; tapping a table opens its order | The device serves table zones |
| Counter | A counter sale, straight into an order | The device serves counter zones |
| Orders | One list of open work: your tables with dishes not yet sent, Parked, Waiting and Transfers | Always |
| Kitchen | Pass and Stations | The profile shows a kitchen screen |
| More | You (clock in, My hours, My schedule), Find a bill, the drawer (cash in or out, close), this device's settings, help, Report a problem, About, Log out | Always |

This replaces the rule that a device's type fixes its screens (design-system.md, "Fixed device
screens"; `builtInScreensFor`). A phone today has no counter zones at all
(`apps/till/src/state/device-zones.ts`), so a phone serving a counter zone is new behaviour.

**One order screen for counter and table orders** (owner, 2026-11-26). The same basket, rows,
menu and payment everywhere. A counter order simply has no guests, no bills to choose between and
no Send step before paying.

## 4. The order screen

**Top bar.** Back to Tables on the left. In the middle the table's name with a ⌄ ("Table 4 ⌄") and
under it the guests and the party's name. Tapping the name opens **the table's menu** (§6).

**The bill.** Under the top bar, on a phone, one dropdown: "Bill 1 · €73.20 · 1 of 4 ⌄", with ⋮
beside it for **the bill's menu** (§6). Tapping the dropdown lists the table's bills with their
amounts, rising from the bottom, and "+ New bill" (owner chose the dropdown over tabs, 2026-11-26).

**The rows.**
- Sent dishes come first under a heading such as "Fired 12 min ago" and a small "Sent" mark, drawn
  quietly; new dishes follow under "New · not sent", in full weight.
- One row per dish: quantity, name with its options as a quiet second line, price.
- Adding the same dish again adds to its row.
- **A row with more than one of a dish carries an arrow (a chevron) at its right edge.** One tap
  unfolds it into rows of one under the group, so each can be made differently; tapping the arrow
  again folds them. Folded, a mixed row reads "3 Burger · 2 Chips · 1 Salad". The owner asked for
  the arrow in place of a "Split into 3" button: "the split needs to be easier. i think it should
  just be a chevron to expand from 1 row into 3 rows". Sent rows carry the arrow too.
- **Tapping a row opens it in place**, with what can be done to that line right under it; tapping
  again closes it (owner, 2026-11-26: "I like the order rows opening up").
  - A new row: − quantity +, Options, Note, Remove.
  - A sent row: how many are served ("0 of 2 served") with "Serve 1" and "Serve 2", then Comp…,
    Move to station… and Void…. An action that needs a manager asks for their PIN at that point, as
    today. Serving part of a row is one tap, where today it takes four (A773's phone trial,
    2026-11-25).
- The row of the dish added last is highlighted.

**The foot of the screen, always visible:** "Menu" on the left, then "Pay €73.20", then "Send 6"
in teal (the number counts the new dishes).

## 5. The menu and dish options

**The menu slides up from the bottom and covers the order** (owner, 2026-11-26: "the order should
be the main screen, with the menu sliding up from the bottom to cover the screen").
- At the top: search, then the section path ("Home › Starters › Cooked starters"), each step
  tappable. The sections are the menu's own sections, not courses.
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
  (a switch), Move to another table, Join a table, Split the table, and "Floor plan: seats, name,
  rotate", which gathers the choices that today only a long-press on the floor map reaches (the
  table details sheet). Finish table sits on its own at the end.
- **The bill's menu**, from ⋮ beside the bill: Print the bill, Full invoice, Move dishes, Merge
  bills, Move this bill, Name this bill, Comp the bill, Record unpaid departure. "+ New bill" lives
  in the bill dropdown.
- Each menu rises from the bottom. **Each choice opens as a full screen with Back**, never a small
  window. Drawn example, Move dishes: a row per dish with "how many" steppers, then "Move them to"
  (another bill, New bill, Another table…), and a button saying exactly what will happen ("Move 2
  dishes to Bill 2").
- Choices show only where the bill's state allows them, as today.

## 7. Payment

### 7.1 The guest sees the bill first

At a table, **Pay opens a screen for the guest first** when the venue has tips switched on; the
waiter turns the phone round (owner, 2026-11-26). A small "Skip" at the top is for the waiter. A
counter sale goes straight to the waiter's Pay.

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

- **The amount to pay, large**, with "Bill €73.20 + tip €7.32" under it.
- **How it is paid:** Whole bill, Split equally, Items, An amount, as today, Whole bill first.
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
"Took €80.00 · give €6.80". A phone opens no drawer, as today.

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
- Tabs across the top, the current one underlined in teal; help, the person's name and More on the
  right.
- **The menu fills the left**: search and the diet filter, the section path, then as many tile
  columns as fit (five on a landscape tablet, three held upright).
- **The order stays open on the right**, with the same top bar, bill dropdown, rows, arrows and
  foot buttons as the phone (Pay and Send). The dish just added is the highlighted row, so the
  phone's "last added" strip is not needed.
- **Pay and every action open in the order's column**, not over the menu.
- With an on-screen keyboard showing, the foot buttons stay above it and search results show above
  it, as tiles.
- A counter sale uses the same screen, with "Counter · Downstairs bar" in place of the table.

## 9. Not designed yet (later passes)

- The Tables tab on a phone and a till: the floor map and list, seating, and the table states. The
  18 entries in `docs/backlog/till.md`'s bundle "For the owner's redesign of the table screens", and
  the eight points from lane D's counter-seat trial (2026-11-11), belong to that pass. This pass
  answers three of them: serving part of a row (one tap, §4), A1265's ⋮ list taller than the room
  below it (two shorter menus, §6), and A1290 and A1359's panels that open low (every action full
  screen, §6). A1211, the Served message covering Send all, needs checking against the new foot
  buttons when built.
- The Orders list, Kitchen, More, Find a bill, the receipt screen, clock-in, My hours, the drawer,
  refunds and corrections.
- The screens behind "Split equally", "Items" and "An amount", and "Other card machine".
- Empty, loading and error states throughout (a declined card, the box out of reach, a printer
  that has gone), and the Spanish wording.

## 10. Open questions

1. **Finding a returning invoice customer.** Today's invoice form has no way to look one up; that
   would be a new feature. Not decided.
2. **The tip percentages.** Drawn as 5%, 10% and 15%; whether a venue sets its own belongs to the
   tips design.

## 11. Pictures

Kept outside the repository, in this session's scratchpad and copied to
`~/waitron-campaign-shared/mockups/2026-11-26-till-handheld-redesign/`, light and dark for each:
`d` the order and menu (last added at the bottom, picture 2), `f` options with the default picked,
`g` unfolding a row, `i` the two menus, `j` bill dropdown versus tabs, `h` frame 3 the Move dishes
screen, `o` the guest's bill and tip, `q` frames 1, 2 and 4 the quiet Pay and invoice destination,
`r` the device sheet, `k` frames 2–4 cash, the reader and Paid (with the payment slip), `m` the
till, `s` the till held upright. Earlier pictures in the same folder show choices the owner turned
down: `a`/`b`/`c`, `e` frame 1, `h` frames 1–2, `k` frame 1, `l`, `n` and `p`.

## 12. Notes for the build

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
