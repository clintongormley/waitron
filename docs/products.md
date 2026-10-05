# Build a product once, then decide where to sell it

A product describes what you sell. A menu decides whether that product is sold in a particular
service, and at what price. Keeping those jobs separate lets you reuse one coffee on several menus
without copying its kitchen name, dietary declarations or choices.

Open **Products** in the management dashboard and choose **Add product**. Give the product a name,
enter its price and choose its tax treatment. A product is sold by the each unless you say otherwise,
so choosing a selling unit is optional — pick one only when you sell the product by weight or volume,
such as grams or litres. The tax label shows the same percentage that Waitron uses to calculate the
sale.

Choose **No tax (0%)** when you want the existing zero-rate tax class. This is a real selection, so
leaving the field blank still prevents the product from being saved.

The editor keeps the fields you change often on screen and folds the rest away behind a heading that
summarises what is inside it, so you can see at a glance which sections you have filled in. Open one
by clicking its heading. If a section contains something you need to fix, it opens itself and stays
open until you have fixed it.

## Give a product up to three names

The name you just typed is the **staff** name. It is plain text, in no particular language, and it
is what you and your staff see: the Products list, the till's buttons, the basket, an open table's
line list, a retrieved order and your sales reports. Use whatever the venue actually calls the dish.

Two optional names sit beside it, each in its own folded section:

- A **customer-facing name**, under **Descriptors**, with one field per content language. This is
  what a diner reads: the receipt, the invoice, and the printed allergen sheet. Leave it blank in
  every language and the receipt shows the staff name instead. Leave it blank in a language other
  than the default and a receipt in that language shows the default language's customer-facing name.
- A **kitchen name**, under **Kitchen**. This is what the kitchen ticket prints and what the kitchen
  screens show. It is useful when the short label a cook needs differs from the name you sell under.
  Leave it blank and the kitchen sees the staff name instead.

The two fall back separately. Filling in a customer-facing name does not change what the kitchen
sees, and filling in a kitchen name does not change what the diner reads. While either name is
blank, its field shows the name that will be used instead.

You can also add a customer-facing description, under **Descriptors**, and a photo, which sits
beside the name, below the category path.

## Give the product a main category

Each product has one main category. Categories form a tree, so the product editor shows the
category's full path on the first line under the window's title, such as
**Drinks › Alcoholic drinks › Cocktails**, or **Uncategorised** when the product is in none. Choose
**Change** after the path to pick another: the list starts with **Uncategorised** and then shows
every category as an indented tree, each subcategory under its parent. You can also move the product
to another category on the Products screen, by dragging it or with **Move to…**. The main category
also plays a part in choosing the kitchen station a dish goes to, as described below.

Use the **Default course** field under **Kitchen** to decide when the product fires. It saves with
the product. Prep stations choose where the dish is made: an ordered exception applies first, then
the nearest claimed folder, then the venue's default station.

You can create a unit, an extras list or an options list without abandoning a product
you are editing. Open the nested form, save the new item and select it when you return. The unsaved
product fields remain in place if the nested save fails or you cancel it.

Courses are different: **Edit courses…** at the end of the **Default course** list opens the
course list in a window that saves each change as you make it. When you close it, the last course
you added becomes the product's course; if you removed the product's course instead, the product
is left with none. Your other unsaved product fields stay as they were.

## Add variants when one product has several sellable forms

Use variants for forms of the same product that need distinct names and prices, such as **Coffee,
single** and **Coffee, double**. Each variant has its own availability. Reordering or editing the
variants keeps their stable identities, so a menu's settings for a variant keep pointing at it.

Variants have a section of their own, **Variants**, under **Pricing**. Choose **Add variant** to
add one. A small window opens
where you give the variant its three names (staff, customer-facing and kitchen), its price, image
and availability; the customer-facing and kitchen names fall back to the variant's staff name
exactly as the product's do. Save the window to add that one variant, or cancel it to add nothing.
On the till, a receipt, a kitchen ticket and the sales report, a variant is shown under its own name
alone, so name it in full: **Large coffee**, not **Large**.

The product keeps its own price field, above its VAT. Once the product has an Active variant, the
field's label starts **Base price**, because a variant you leave without a price of its own sells at
it. That variant's empty price shows the base price greyed out as a hint, in its window and in its
row of the table. The **Pricing** section then folds to one line, such as **Base price:** €38.00
per kg · **VAT:** Reduced (10%); choose the line to open it. It opens by itself when the base price
or the VAT needs fixing, and on a product that has never been saved.

Drag a row by the handle at its start to reorder it, or focus the handle and use the up and down
arrow keys. Each row's **Available** switch marks the variant sold out or back on sale. The row menu
offers **Open**, **Edit** and **Remove**. **Edit**, or a click on the variant's row, reopens the
small window. Changes you make in the table, including the Available switch, are saved when you save
the product.

**Open** takes you to the variant's own page, where it can have its own VAT, allergens and the
other product details. Its main category and its unit are always its product's: the page shows the
product's category path as plain text, with no **Change**, and the product's unit as plain text
beside the price, such as "per kg", or "Each" when the product has none. If one form of a product
needs a different unit, make it a product of its own.
Apart from the names, each detail you leave blank there
shows the product's value greyed out as a hint or, where the product has none, what will be used
("None"; "Not yet reviewed" for allergens nobody has reviewed), and the variant
uses the product's value. The
description works as one value across all languages: to use the product's description, leave every
language of the description blank. Once you write the description in one language, the variant uses
only its own description, and the languages you left blank stay blank. The page has no Modifiers
or Variants section, because a variant always uses its product's extras and options lists.
**Open** appears once the variant has been saved, and it waits while the product has unsaved
changes, because leaving the product would lose them: save the product first.

**Remove** makes a saved variant Inactive once you save the product: the till stops offering it, and
its past sales are kept. A variant you added and have not saved yet is simply dropped. The table
shows only Active variants at first. While some variant is Inactive, a link beside **Add variant**
says how many, such as **Show 1 inactive**: choose it to see them in the table, and choose **Hide
inactive** to hide them again. Choose **Restore** from an Inactive row's menu to make it Active
again.

You cannot add or restore an Active variant on a product that an extras list offers, because a
product with Active variants cannot be an extra. The save is refused, and the dashboard names the
extras lists to take the product off first.

The products list keeps each product's variants folded away under it. A product with Active
variants says how many under its name, such as **2 variants**, and the small arrow just before
its drag handle opens them. The list shows a product's variants in the product's own order, the
order of the variant list in the product editor, whichever column the list is sorted by; drag them
in the editor to change it.
Each variant's row shows its own name, the price it sells at, its status and its
row menu. If a variant's VAT differs
from its product's, the list notes it under the variant's price. A variant's row menu offers
**Remove** or **Restore** there too, and an Inactive variant is listed once you change the
**Status** filter from **Active**.

A variant follows its product onto every menu the product is on, including a variant you add later.
On the menu you can give it a price of its own, or let it follow the menus it comes from. A price
you set for this menu wins. Otherwise, prices set for that size on included menus and on the
product contribute to its price. If there is no size-level price, it follows the combined product
price.

Leave a menu price empty to let those contributions decide it. For example, if Drinks prices beer
at €3.00 and Evening includes only Drinks' beer, Evening charges €3.00. If Evening also puts that
beer in its own section at the product's €2.80, the prices disagree. Set Evening's beer price to
resolve that disagreement before publishing. The Prices view shows where each price comes from
and which settings still need your decision.

## Declare allergens and dietary suitability directly

**Nutritional info** shows two lines, **Allergens** and **Dietary preferences**, each followed by
what you have chosen, or "None specified". Click a line, or press Enter on it, to choose from the
full list; press Escape or move on when you are done.

Each product states its own dietary suitability — a positive `suitableFor` list over vegan,
vegetarian, halal and kosher — and its own allergens. An empty reviewed allergen list means you
checked the product and declared none; a pending declaration means it has not been reviewed. An
extra you can add to a dish is itself a product, so it brings its own declarations with it. A choice
on an options list does not: an option such as _rare_ or _well done_ carries no allergens and no
dietary suitability of its own, because it is a way of asking for the same dish rather than
something extra to eat. The till and kitchen show each item's own list and no longer compute a
combined "as-served" figure across the dish and its extras.

Recipes and ingredient origins no longer author product declarations in the supported dashboard
workflow. Existing purchasing data and recorded order facts remain available, but you maintain live
product allergens and dietary suitability in **Products**.

## Put a new product on your menus

When you save a new product, the editor closes and a window such as **Add Flat white to menus** asks where it goes. It
lists each menu's **Top level** and the sections inside it: tick the places you want and choose
**Add to menus**, or choose **Skip** and place it later. The product is already saved by then, so a
place that refuses it does not undo the save — the window names the places that failed and keeps them
ticked so you can try again. A menu's sections themselves are built under **Products and menus →
Menus**.

## Keep choices reusable

Create reusable extras lists and options lists on the two tabs of **Modifiers**, then attach them in
the product's own **Modifiers** section, in the order you want. See
[Reuse choices across your products](modifiers.md) for what each kind holds, its defaults and
limits, and extra prices.

When you park or complete an order, Waitron saves the chosen product and variant names, kitchen name,
prices and modifier answers. Later catalogue edits apply to new selections. The parked order,
kitchen ticket, receipt and reprint continue to show the facts saved with that order.

The demo venue includes a bilingual coffee with a custom unit, two variants, a separate kitchen name
and direct dietary declarations. Casa Delgado and Menú del Día include a
**Drinks** menu as a folder. Drinks prices Caña at 3.00 instead of its product price of 2.80; both
including menus inherit that price. Menú del Día sets its own Negroni price of 9.00. The coffee
variants keep their own prices. The demo sirloin carries a seeded options
list, **Punto**, asking how the steak should be cooked. The demo venue seeds no extras list, so
nothing in it shows an extra being added to a dish.

