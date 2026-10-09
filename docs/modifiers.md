# Reuse choices across your products

When several dishes offer the same additions, or the same preparation choice, build the list once in
**Modifiers** and attach it to each product. You edit its names, entries and limits in one place;
each order keeps its own answers.

## Two kinds of list, one per tab

**Modifiers** has two tabs, **Extras** and **Options**, each with its own table and its own button
for adding a list. There is no third kind and nothing to choose between: which tab you are on is
what decides the kind.

Use **Extras** for things a diner adds to a dish. Each entry on an extras list names a product you
have already created, and takes that product's names, tax treatment, allergens, dietary labels and
picture from it — you never retype them here. A product that has Active variants cannot be an
entry, because it is sold only as one of its variants. What you set on the entry is the terms of the
offer: **Maximum quantity**, how many of it one dish may take (1 means "one or none");
**Preselected**, whether it starts chosen; and **Price per portion**, what one pick costs.
Press − from 2 to 1 and then to an empty box to remove the item's limit. The ∞ placeholder marks
that empty value. The list's **Maximum choices** still limits the total picks when you set one.
For a product sold in any unit except Each, also enter the **Portion** that one pick adds, in the
product's own unit, in its own column between **Preselected** and the price. A product counted as
Each always adds one, so its row shows a fixed 1 there. An entered price replaces
the product's price for that portion: 1.50 means 1.50 per pick. Leave the price blank and Waitron
multiplies the portion by the product's unit price, then rounds once to a cent for each pick; the
field shows that calculated price while it is blank. The product's unit is shown with the price
(under it on a phone), or reads Each when the product has no unit. The list itself sets, under a
**Number of choices** heading, **Minimum choices** — left empty the list is optional, 1 or more
makes it required — and **Maximum choices**, at least 1, or left empty for no limit. Each of these
numbers has − and + buttons, and you can also type it. Pressing − on 1 empties the box, which then
shows "None".

Use **Options** when the diner picks exactly one option, such as a cup or a glass. An option carries
names and nothing else: no price, no tax treatment and no allergens. Each option has its own
**Available** switch, and while any option is available, one of them is always the **Default** once the list is saved (the editor picks the first available
option when you open a list that has none).

Each option is a row of text in the list: its name, an **Unavailable** marker when it is switched
off, a **Default** radio button (an unavailable option cannot take it), and a menu with **Edit** and
**Delete**. Drag a row by the handle at its start to move it. **Edit** opens the option in its own
window over the list, and so does clicking the option's name (or pressing Enter or Space on it); **Add option**, under the rows, opens an empty one. Saving that window changes the list
you are editing, not what is stored: nothing is sent until you save the list itself.

## Name a list and decide whether it is active

Give the list a staff name in plain text — what you and your staff call it. A **Kitchen name**,
directly under it, and a **Customer-facing name**, with one field per content language, are both
optional and fall back to the staff name when you leave them blank. On a receipt, an options
list's or an option's customer-facing name left blank in another language uses the default
language's customer-facing name first, and the staff name only when no language has one; an extras
list's own customer-facing name is not printed anywhere today. While a name is blank, its field
shows, in place of the blank, the name it falls back to. The customer-facing names sit in a
**Customer-facing names** section that stays folded until you open it. While it is folded, each
language's name shows under its heading; for a language left blank, the name its field shows in its
place appears in italic. The section opens by itself when one of the names needs correcting.
An option carries the same three names, shown in its own window with nothing folded: **Name**, then
**Kitchen name**, then the customer-facing names under their own heading. See
[content languages](content-and-images.md).

Each list has an **Active** switch, and the list's **Status** column reads **Active** or
**Disabled**. An active list needs something to answer it with, so the form refuses to save an
active extras list with no products on it, or an active options list with no available option. It
tells you to add one (or, for options, add or enable one), or to disable this list.

A **Default** seeds a new selection once. Changing it does not change an order you already started.
Switching the default option off, or deleting it, makes the first available option the default
instead. An extras entry is either preselected or not — there is no starting quantity to set.

## Attach a list to a product

Open the product in **Products** and use its **Modifiers** section, which is always on screen rather
than folded away. One control adds either kind, and the section holds both kinds in a single ordered
list; each row shows the list's staff name and which kind it is. Drag a row by the handle at its
start to move it, or focus the handle and use the up and down arrow keys. That same control lists
extras lists under an **Extras** heading and options lists under **Options**, and each group ends
with its own choice to make a new one, **Add extras list…** or **Add options list…**, so you can
build a list without abandoning the product you are editing.

Every menu offer carries the product's extras and options lists in the order you set here.
An extra uses its list entry's price per portion when you set one. With the price blank, its
portion multiplied by the product's unit price sets the price per pick, rounded once to a cent.
For every unit except Each, enter the amount one pick adds to a dish. An Each extra adds one.
Publish each menu to make these changes available on the till.

## See what uses a list

Each tab's table has a **Used by** column counting the products carrying the list, for example
"2 products". A list that nothing uses reads "Not used". Click the count to see those products.

## Deleting a list detaches it, and nothing refuses the delete

Deleting a list removes it from every product carrying it. The confirmation dialog lists those
products before you confirm. Deleting cannot be undone. Publish a menu again to replace its saved
choices.

**An open order does not block a delete, and you are not told to finish or void one.** It does not
need to: an open order holds no reference back to the list. An extras pick becomes its own order
line naming the product that was picked, and an options answer is stored as the wording that was
chosen. So deleting a list reaches no order that is already open — but it does take the list off
every product at once. To stop a list being asked without deleting it, turn its **Active** switch
off, or remove it from that one product's Modifiers section.

## Allergens and dietary information

An extras entry declares its allergens and its dietary suitability through the product it names, so
you maintain those on that product under **Products**, not here. An option declares neither —
it is wording, not something eaten.

## What the till does with a list

Tapping a dish that carries a list opens the question straight away, one list after another in the
order you arranged them. An extras list shows each entry's price per portion, with a tick box
each, or a stepper where you allowed more than one; a list you made required keeps **Add** shut
until something is picked. An options list shows its options as a set of radio buttons, exactly one
to choose, with your default already selected (nothing is selected on a list that has no stored
default).

The operator reads the staff name throughout. The till is a staff screen: the diner's wording is
what the receipt prints, and the kitchen's is what the ticket prints.

Each extra picked becomes its own indented line under the dish in the basket, with its own price
and its own allergens and dietary labels — never folded into the dish's. An options answer costs
nothing and rides along as wording on the dish's line.

An order stores the answers it was given. A parked order has to be matched up with the dish's
current lists again before it can be changed. An options answer
is stored as wording, all three names of the list and all three of the chosen option, and the till
matches on the staff name of each. An extra keeps the product and the list it was picked from, so
another list offering the same product cannot silently take its place.

Change the staff name of a list or an option, or turn an option off, and an options answer no longer
matches. The till will not guess: it asks the operator to open that line and choose again before the
order can be sent.

Changing only a customer-facing or kitchen name still matches, so nobody is stopped at the till, but
it is not free. The order remembers all three names, and Waitron cannot tell a renamed answer from a
different one, so the next change made to that parked order, even a change of quantity, rebuilds the
whole order from today's catalogue. Every line on it is then charged at today's prices instead of
the prices it was parked at. Do your renaming between services rather than while orders are parked.
An extras list is the exception, because an extra is matched by its product: renaming an extras
list, or the product on it, leaves a parked order alone.
