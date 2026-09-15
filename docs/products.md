# Build a product once, then decide where to sell it

A product describes what you sell. A menu decides whether that product, its variants and its
modifiers are available in a particular service. Keeping those jobs separate lets you reuse one
coffee on several menus without copying its kitchen name, dietary declarations or choices.

Open **Products** in the management dashboard and choose **Add product**. Give the product a name in
your default content language, enter its price and choose its tax treatment. A product is sold by the
each unless you say otherwise, so choosing a selling unit is optional — pick one only when you sell
the product by weight or volume, such as grams or litres. The tax label shows the same percentage
that Waitron uses to calculate the sale.

Choose **No tax (0%)** when you want the existing zero-rate tax class. This is a real selection, so
leaving the field blank still prevents the product from being saved.

You can add translations, a customer-facing description, a kitchen name and a picture. The kitchen
name is useful when the short label printed or shown to the kitchen should differ from the product
name. If you leave it blank, the kitchen uses the product name.

## Organise the product without changing its route

A product can appear in several categories. You may choose one of them as its **Reporting
Category**, which supplies the single category recorded for reporting, so the same sale is not
counted once for every category membership. A product left without a Reporting Category records no
reporting label at all on its new order lines, and none of its memberships contributes a kitchen
route on its own — the category route is simply absent rather than falling back to any one
membership.

Extra category memberships help people find and organise the product. They do not create extra
kitchen destinations. Once the product exists, use its station and course fields to keep the
existing preparation routing behavior.

You can create a unit, category or modifier without abandoning a product you are editing. Open the
nested form, save the new item and select it when you return. The unsaved product fields remain in
place if the nested save fails or you cancel it.

## Add variants when one product has several sellable forms

Use variants for forms of the same product that need distinct names and prices, such as **Coffee,
single** and **Coffee, double**. Each variant has its own availability. Reordering or editing the
variants keeps their stable identities, so existing menu publications still point to the right one.

Adding a variant to a product does not publish it automatically on an existing menu. Open the menu
offer and publish the variants you want to sell there. A menu can set a different price for each
variant. That menu price wins at the till; changing the product's price later does not overwrite the
menu price.

## Declare allergens and dietary suitability directly

The allergen and dietary sections show only declarations you selected. Choose **Add allergen** or
**Add dietary declaration** to find another entry. An empty reviewed allergen list means you checked
the product and declared none; a pending declaration means it has not been reviewed.

Dietary declarations describe the product as served before optional changes. A modifier choice can
invalidate a claim. For example, adding bacon with a meat-free invalidation stops the till and kitchen
from claiming that the resulting dish is vegan or vegetarian. Halal and kosher remain independent
declarations and are never inferred from vegan or vegetarian.

Recipes and ingredient origins no longer author product declarations in the supported dashboard
workflow. Existing purchasing data and recorded order facts remain available, but you maintain live
product allergens and dietary suitability in **Products**.

## Keep choices reusable

Create reusable choices in **Modifiers**, then attach them to the product in the order you want the
till to ask for them. See [Reuse choices across your products](modifiers.md) for text, extras,
options, yes/no answers, defaults, caps and menu-specific extra prices.

When you park or complete an order, Waitron saves the chosen product and variant names, kitchen name,
prices and modifier answers. Later catalogue edits apply to new selections. The parked order,
kitchen ticket, receipt and reprint continue to show the facts saved with that order.

The demo venue includes a bilingual coffee with two categories, a Reporting Category, a custom unit,
two variants, a separate kitchen name, direct dietary declarations and all four modifier types. Its
menu variant and extra prices deliberately differ from the product definitions, so you can see which
price wins at the till.
