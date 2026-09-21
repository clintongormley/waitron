# Reuse choices across your products

When several dishes offer the same additions, or the same preparation choice, build the list once in
**Modifiers** and attach it to each product. You edit its names, entries and limits in one place;
each order keeps its own answers.

## Two kinds of list, one per tab

**Modifiers** has two tabs, **Extras** and **Options**, each with its own table and its own button
for adding a list. There is no third kind and no **Type** to choose: the old Text modifier, and the
type field that went with it, are not on this page any more.

Use **Extras** for things a diner adds to a dish. Each entry on an extras list names a product you
have already created, and takes that product's names, tax treatment, allergens, dietary labels and
picture from it — you never retype them here. What you set on the entry is the terms of the offer:
**Maximum quantity**, how many of it one dish may take (at least one, so 1 means "one or none");
**Preselected**, whether it starts chosen; and **Price**, what the diner is charged for it. That
price REPLACES the product's own rather than adding to it, so 1.50 against a 3.00 product bills
1.50. Leave it blank and the product's own price is what gets charged — the field shows you that
price, greyed, while it is blank. The list itself sets **Minimum choices** — 0 makes the list optional, 1 or
more makes it required — and **Maximum choices**, left blank for no limit.

Use **Options** when the diner picks exactly one label, such as a cup or a glass. A label carries
names and nothing else: no price, no tax treatment and no allergens. Each label has its own
**Available** switch, and one of the available labels can be the **Default**.

## Name a list and decide whether it is in use

Give the list a staff name in plain text — what you and your staff call it. A **Customer-facing
name**, with one field per content language, and a **Kitchen name** are both optional and fall back
to the staff name when you leave them blank. An options label carries the same three names. See
[content languages](content-and-images.md).

Each list has an **In use** switch. A list that is in use needs something to answer it with, so the
form refuses to save an extras list in use with no products on it, or an options list in use with no
available label. It tells you to add or enable one, or to take the list out of use.

A **Default** seeds a new selection once. Changing it does not change an order you already started.
Making the default label unavailable clears the default. An extras entry is either preselected or
not — there is no starting quantity to set.

## Attach a list to a product

Open the product in **Products** and use its **Modifiers** section, which is always on screen rather
than folded away. One control adds either kind, and the section holds both kinds in a single ordered
list; each row shows the list's staff name and which kind it is. Drag a row by the handle at its
start to move it, or focus the handle and use the up and down arrow keys. That same control offers
**New extras list…** and **New options list…**, so you can build a list without abandoning the
product you are editing.

A product attachment and a menu publication are separate. Attaching a list to the product does not
change an existing menu offer. A menu offer can carry its own price for one of an extras list's
products, and that price wins over the price on the list entry, which in turn wins over the
product's own price — though no dashboard screen sets a menu price for an extra yet.

## Deleting a list detaches it, and nothing refuses the delete

Deleting a list removes it from every product carrying it and from the menu offers of those dishes.
The confirmation dialog shows both sets before you confirm, and deleting cannot be undone.

**An open order does not block a delete, and you are not told to finish or void one.** It does not
need to: an open order holds no reference back to the list. An extras pick becomes its own order
line naming the product that was picked, and an options answer is stored as the wording that was
chosen. So deleting a list reaches no order that is already open — but it does take the list off
every product at once. To stop a list being asked without deleting it, turn its **In use** switch
off, or remove it from that one product's Modifiers section.

## Allergens and dietary information

An extras entry declares its allergens and its dietary suitability through the product it names, so
you maintain those on that product under **Products**, not here. An options label declares neither —
it is wording, not something eaten.

## What the till does with a list

Tapping a dish that carries a list opens the question straight away, one list after another in the
order you arranged them. An extras list shows its entries at the price you set, with a tick box
each, or a stepper where you allowed more than one; a list you made required keeps **Add** shut
until something is picked. An options list shows its labels as a set of radio buttons, exactly one
to choose, with your default already selected.

The operator reads the staff name throughout. The till is a staff screen: the diner's wording is
what the receipt prints, and the kitchen's is what the ticket prints.

Each extra picked becomes its own indented line under the dish in the basket, with its own price
and its own allergens and dietary labels — never folded into the dish's. An options answer costs
nothing and rides along as wording on the dish's line.

An order stores the answers it was given and not a link back to the list they came from, so a parked
order has to be matched up with the dish's lists again before it can be changed. An options answer
is stored as wording, all three names of the list and all three of the chosen label, and the till
matches on the staff name of each. An extra is stored as the product that was picked, so the till
finds its list by that product instead.

Change the staff name of a list or a label, or turn a label off, and an options answer no longer
matches. The till will not guess: it asks the operator to open that line and choose again before the
order can be sent.

Changing only a customer-facing or kitchen name still matches, so nobody is stopped at the till, but
it is not free. The order remembers all three names, and Waitron cannot tell a renamed answer from a
different one, so the next change made to that parked order, even a change of quantity, rebuilds the
whole order from today's catalogue. Every line on it is then charged at today's prices instead of
the prices it was parked at. Do your renaming between services rather than while orders are parked.
An extras list is the exception, because an extra is matched by its product: renaming an extras
list, or the product on it, leaves a parked order alone.
