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
offer: **Maximum quantity**, how many of it one dish may take (at least one, so 1 means "one or
none"); **Preselected**, whether it starts chosen; and **Price**, what the diner is charged for it.
That price REPLACES the product's own rather than adding to it, so 1.50 against a 3.00 product bills
1.50. Leave it blank and the product's own price is what gets charged — the field shows you that
price, greyed, while it is blank. The product's unit is shown after the price (under it on a phone), so
you can see what one of it is; a product with no unit reads Each. The list itself sets **Minimum choices** — 0 makes the list optional, 1 or more makes
it required — and **Maximum choices**, left blank for no limit. Each of these numbers has − and +
buttons, and you can also type it.

Use **Options** when the diner picks exactly one option, such as a cup or a glass. An option carries
names and nothing else: no price, no tax treatment and no allergens. Each option has its own
**Available** switch, and while any option is available, one of them is always the **Default** once the list is saved (the editor picks the first available
option when you open a list that has none).

Each option is a row of text in the list: its name, an **Unavailable** marker when it is switched
off, a **Default** radio button (an unavailable option cannot take it), and a menu with **Edit** and
**Delete**. Drag a row by the handle at its start to move it. **Edit** opens the option in its own
window over the list; **Add option**, under the rows, opens an empty one. Saving that window changes the list
you are editing, not what is stored: nothing is sent until you save the list itself.

## Name a list and decide whether it is active

Give the list a staff name in plain text — what you and your staff call it. A **Customer-facing
name**, with one field per content language, and a **Kitchen name** are both optional and fall back
to the staff name when you leave them blank. They sit in a **Customer and kitchen names** section
that stays folded until you open it; its heading says how many are filled in, and it opens by
itself when one of them needs correcting. An option carries the same three names, in the same
folded section of its own window. See [content languages](content-and-images.md).

Each list has an **Active** switch, and the list's **Status** column reads **Active** or
**Inactive**. An active list needs something to answer it with, so the form refuses to save an
active extras list with no products on it, or an active options list with no available option. It
tells you to add or enable one, or to make the list inactive.

A **Default** seeds a new selection once. Changing it does not change an order you already started.
Switching the default option off, or deleting it, makes the first available option the default
instead. An extras entry is either preselected or not — there is no starting quantity to set.

## Attach a list to a product

Open the product in **Products** and use its **Modifiers** section, which is always on screen rather
than folded away. One control adds either kind, and the section holds both kinds in a single ordered
list; each row shows the list's staff name and which kind it is. Drag a row by the handle at its
start to move it, or focus the handle and use the up and down arrow keys. That same control offers
**New extras list…** and **New options list…**, so you can build a list without abandoning the
product you are editing.

A product attachment and a menu offer's extras lists are separate. Attaching a list to the product does not
change an existing menu offer. A menu offer can carry its own price for one of an extras list's
products, and that price wins over the price on the list entry, which in turn wins over the
product's own price — though no dashboard screen sets a menu price for an extra yet.

## See what uses a list

Each tab's table has a **Used by** column. For an extras list it counts the products that carry the
list and the menu offers that carry it, for example "2 products · 1 menu item". Each menu offer is
one dish on one menu, so a list offered with two dishes on the same menu counts as two menu items.
An options list is attached to products only, so its count is products alone. A list that nothing
uses reads "Not used". Click the count to open the list of what uses it; a menu offer there is
named by its dish and then its menu.

## Deleting a list detaches it, and nothing refuses the delete

Deleting a list removes it from every product carrying it, and an extras list also from every menu
offer carrying it. The confirmation dialog shows what the delete reaches before you confirm: the
products, and for an extras list the menu offers, each named by its dish and its menu. Deleting
cannot be undone.

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
order you arranged them. An extras list shows its entries at the price you set, with a tick box
each, or a stepper where you allowed more than one; a list you made required keeps **Add** shut
until something is picked. An options list shows its options as a set of radio buttons, exactly one
to choose, with your default already selected (nothing is selected on a list that has no stored
default).

The operator reads the staff name throughout. The till is a staff screen: the diner's wording is
what the receipt prints, and the kitchen's is what the ticket prints.

Each extra picked becomes its own indented line under the dish in the basket, with its own price
and its own allergens and dietary labels — never folded into the dish's. An options answer costs
nothing and rides along as wording on the dish's line.

An order stores the answers it was given and not a link back to the list they came from, so a parked
order has to be matched up with the dish's lists again before it can be changed. An options answer
is stored as wording, all three names of the list and all three of the chosen option, and the till
matches on the staff name of each. An extra is stored as the product that was picked, so the till
finds its list by that product instead.

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
