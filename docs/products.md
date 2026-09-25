# Build a product once, then decide where to sell it

A product describes what you sell. A menu decides whether that product, its variants and its
modifiers are available in a particular service. Keeping those jobs separate lets you reuse one
coffee on several menus without copying its kitchen name, dietary declarations or choices.

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
  what a diner reads: the receipt, the invoice, and the printed allergen sheet. Leave it blank and
  the receipt shows the staff name instead.
- A **kitchen name**, under **Kitchen**. This is what the kitchen ticket prints and what the kitchen
  screens show. It is useful when the short label a cook needs differs from the name you sell under.
  Leave it blank and the kitchen sees the staff name instead.

The two fall back separately. Filling in a customer-facing name does not change what the kitchen
sees, and filling in a kitchen name does not change what the diner reads.

You can also add a customer-facing description and a picture, both under **Descriptors**.

## Give the product a main category and labels

Each product has one **Main category**, chosen under **Category and labels** in the product editor.
Categories form a tree, so the field shows each category's full path. Leave it empty and the product
is Uncategorised. The main category also plays a part in choosing the kitchen station a dish goes to,
as described below.

Labels are for the groupings a single tree cannot hold, such as **Alcoholic** or **Happy hour
drinks**, which cut across your categories and can overlap each other. A product can carry any
number of labels, or none. A label's name is for staff and is not translated, so it reads the same
in every language. You create, rename and delete labels on the **Labels** tab of the **Categories**
screen, and choose a product's labels in the same editor section as its main category. Labels never
decide where a dish is prepared.

Use the product's **Kitchen station** and **Default course** fields, under **Kitchen**, for its
preparation routing. They save with the product, so you can set them while creating it, and
cancelling the editor leaves them as they were. When a dish is sent to the kitchen, a service route
set for the product or for its main category comes first. After that comes the product's own
**Kitchen station**, then its main category's station, then the venue's default station.

You can create a unit, a category, an extras list or an options list without abandoning a product
you are editing. Open the nested form, save the new item and select it when you return. The unsaved
product fields remain in place if the nested save fails or you cancel it.

## Add variants when one product has several sellable forms

Use variants for forms of the same product that need distinct names and prices, such as **Coffee,
single** and **Coffee, double**. Each variant has its own availability. Reordering or editing the
variants keeps their stable identities, so a menu's settings for a variant keep pointing at it.

Variants appear as a table under the price. Choose **Add variant** to add one. A small window opens
where you give the variant its three names (staff, customer-facing and kitchen), its price, image
and availability; the customer-facing and kitchen names fall back to the variant's staff name
exactly as the product's do. Save the window to add that one variant, or cancel it to add nothing.
On the till, a receipt, a kitchen ticket and the sales report, a variant is shown under its own name
alone, so name it in full: **Large coffee**, not **Large**.

The product keeps its own price field. Once the product has an Active variant, the field's label
starts **Base price**, because a variant you leave without a price of its own sells at it. That
variant's empty price shows the base price greyed out as a hint, in its window and in its row of the
table.

Drag a row by the handle at its start to reorder it, or focus the handle and use the up and down
arrow keys. Each row's **Available** switch marks the variant sold out or back on sale. The row menu
offers **Open**, **Edit** and **Remove**. **Edit** reopens the small window. Changes you make in the
table, including the Available switch, are saved when you save the product.

**Open** takes you to the variant's own page, where it can have its own VAT, main category,
allergens and the other product details. Apart from the names, each detail you leave blank there
shows the product's value greyed out as a hint, and the variant uses the product's value. The
description works as one value across all languages: to use the product's description, leave every
language of the description blank. Once you write the description in one language, the variant uses
only its own description, and the languages you left blank stay blank. A variant has no labels of
its own: its page shows the product's labels as a hint, and it carries the product's labels. The
page has no Modifiers or Variants section, because a variant always uses its product's extras and
options lists.
**Open** appears once the variant has been saved, and it waits while the product has unsaved
changes, because leaving the product would lose them: save the product first.

**Remove** makes a saved variant Inactive once you save the product: the till stops offering it, and
its past sales are kept. A variant you added and have not saved yet is simply dropped. The table
shows only Active variants at first; set **Show variants** to **Inactive** or **Any status** to see
removed ones, and choose **Restore** from a row's menu to make one Active again.

You cannot add or restore an Active variant on a product that an extras list offers, because a
product with Active variants cannot be an extra. The save is refused, and the dashboard names the
extras lists to take the product off first.

The products list shows each variant under its product, with its own name, the price it sells at,
its main category (its own, or the product's when it has none) and the product's labels. If a
variant's VAT differs from its product's, the list notes it under the variant's price. A variant's
row menu offers **Remove** or **Restore** there too, and an Inactive variant is listed once you
change the **Status** filter from **Active**.

A variant follows its product onto every menu the product is on, including a variant you add later.
In the menu offer you can optionally give a variant its own price on that menu, or clear its
**Offered on this menu** box to stop offering it there. An order charges the first of these that is
set: the variant's price on that menu, the variant's own price, then the product's price on that
menu, then the product's own price.

You can leave a menu offer's price empty, with variants or without. The menu then charges the
product's own price, and follows it when you change that price. The empty field shows the product's
price greyed out as a hint. For a product without variants that hint is what the menu charges; for
one with variants, each variant shows its own price hint.

## Declare allergens and dietary suitability directly

The allergen and dietary sections show only declarations you selected. Choose **Add allergen** or
**Add dietary declaration** to find another entry. An empty reviewed allergen list means you checked
the product and declared none; a pending declaration means it has not been reviewed.

Each product states its own dietary suitability — a positive `suitableFor` list over vegan,
vegetarian, halal and kosher — and its own allergens. An extra you can add to a dish is itself a
product, so it brings its own declarations with it. A choice on an options list does not: a label
such as _rare_ or _well done_ carries no allergens and no dietary suitability of its own, because it
is a way of asking for the same dish rather than something extra to eat. The till and kitchen show
each item's own list and no longer compute a combined "as-served" figure across the dish and its
extras.

Recipes and ingredient origins no longer author product declarations in the supported dashboard
workflow. Existing purchasing data and recorded order facts remain available, but you maintain live
product allergens and dietary suitability in **Products**.

## Keep choices reusable

Create reusable extras lists and options lists on the two tabs of **Modifiers**, then attach them in
the product's own **Modifiers** section, in the order you want. See
[Reuse choices across your products](modifiers.md) for what each kind holds, its defaults and
limits, and menu-specific extra prices.

When you park or complete an order, Waitron saves the chosen product and variant names, kitchen name,
prices and modifier answers. Later catalogue edits apply to new selections. The parked order,
kitchen ticket, receipt and reprint continue to show the facts saved with that order.

The demo venue includes a bilingual coffee with a custom unit, two variants, a separate kitchen name
and direct dietary declarations. It also has two labels that overlap: **Alcoholic** on the Negroni,
Tinto casa and Caña, and **Happy hour drinks** on Tinto casa, Caña and the cola, which shows a label
crossing from alcoholic drinks into a soft drink. The demo menus set no price
of their own for anything except the Negroni, at 9.00 on the Menú del Día, so everything else,
including each coffee variant, sells at its own price. The demo sirloin carries a seeded options
list, **Punto**, asking how the steak should be cooked. The demo venue seeds no extras list, so
nothing in it shows an extra being added to a dish.

