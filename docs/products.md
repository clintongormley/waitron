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

## Organise the product without changing its route

A product can appear in several categories. You may choose one of them as its **Reporting
Category**, which supplies the single category recorded for reporting, so the same sale is not
counted once for every category membership. A product left without a Reporting Category records no
reporting label at all on its new order lines, and none of its memberships contributes a kitchen
route on its own — the category route is simply absent rather than falling back to any one
membership.

Extra category memberships help people find and organise the product. They do not create extra
kitchen destinations. Use the product's station and course fields, under **Kitchen**, to keep the
existing preparation routing behavior. They save with the product now, so you can set them while
creating it, and cancelling the editor leaves them as they were.

You can create a unit, a category, an extras list or an options list without abandoning a product
you are editing. Open the nested form, save the new item and select it when you return. The unsaved
product fields remain in place if the nested save fails or you cancel it.

## Add variants when one product has several sellable forms

Use variants for forms of the same product that need distinct names and prices, such as **Coffee,
single** and **Coffee, double**. Each variant has its own availability. Reordering or editing the
variants keeps their stable identities, so existing menu publications still point to the right one.

Variants appear as a table under the price. Drag a row by the handle at its start to reorder it, or
focus the handle and use the up and down arrow keys. The row menu offers **Edit** and **Remove**, and
each row's **Available** switch takes effect as you flip it. Editing a variant opens a small window
where it gets its own price, image and its own three names — staff, customer-facing and kitchen —
each falling back to the variant's staff name exactly as the product's do. On a receipt or a kitchen
ticket the variant's name is added to the product's after a middot: **Coffee · Large**.

A product has either no variants or at least two — never exactly one. The first time you choose **Add
variant**, the price you already entered becomes a variant called **Regular** and the window opens for
the second one, so you always end up with a pair. Cancel that window and the Regular variant folds
back into the plain price, undoing the whole thing. Remove variants until one is left and its price
folds back the same way.

Adding a variant to a product does not publish it automatically on an existing menu. Open the menu
offer and publish the variants you want to sell there. A menu can set a different price for each
variant. That menu price wins at the till; changing the product's price later does not overwrite the
menu price.

## Declare allergens and dietary suitability directly

The allergen and dietary sections show only declarations you selected. Choose **Add allergen** or
**Add dietary declaration** to find another entry. An empty reviewed allergen list means you checked
the product and declared none; a pending declaration means it has not been reviewed.

Each product and each modifier choice states its own dietary suitability — a positive `suitableFor`
list over vegan, vegetarian, halal and kosher — and its own allergens. The till and kitchen show each
item's own list and no longer compute a combined "as-served" figure across the dish and its extras.

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

The demo venue includes a bilingual coffee with two categories, a Reporting Category, a custom unit,
two variants, a separate kitchen name and direct dietary declarations. Its menu variant and extra
prices deliberately differ from the product definitions, so you can see which price wins at the
till. The demo sirloin carries a seeded options list, **Punto**, asking how the steak should be
cooked.

The coffee also still carries three of the older modifiers — one of each of the retired text, extras
and options types — because the demo seed has not been rewritten
(`apps/server/scripts/demo-seed/seed-options.ts`). They are in the database, but no dashboard screen
shows them any more, so they will not appear on the coffee's **Modifiers** section.
