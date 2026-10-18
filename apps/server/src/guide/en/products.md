# Build a product once, then decide where to sell it

A product describes what you sell. A menu decides whether that product is sold in a particular
service, and at what price. Keeping those jobs separate lets you reuse one coffee on several menus
without copying its kitchen name, dietary declarations or choices.

Open **Products** in the management dashboard and choose **Add product**. Give the product a name
and enter its price. Its VAT starts on the class chosen as **VAT class for new products**, on the
**Venue details** tab of **Venue settings**; change it here when this product is taxed differently.
For a product with no VAT, choose **No tax (0%)**. A change of VAT class reaches the tills when the
menu is published again; until then they sell the product at the class the menu was published with.

The editor keeps the fields you change often on screen and folds the rest away behind a heading that
summarises what is inside it, so you can see at a glance which sections you have filled in. Open one
by clicking its heading. If a section contains something you need to fix, it opens itself and stays
open until you have fixed it.

## Set how a product is sold {#selling}

Open **Selling** to change Available or **Ordered on its own by**: Anyone, Staff only or Nobody.
The explanation below the selected choice tells you what it allows. A variant has only Available
here. Selling starts closed, with the current settings on its summary line.

Choose the pencil-marked thumbnail beside Name to change the image or colour. The square previews
a colour change before you save. Close the panel with Escape to return to the thumbnail.

## Choose a selling unit {#selling-unit}

A product is sold one at a time unless you choose a unit. Choose one when you sell it by weight or
by volume, such as grams or litres. The price field shows **Each** until you do: select it to open
the **Pricing unit** window, which lists **Each** first and then your units, sorted in your
dashboard language. **Add unit** there creates a new unit without leaving the product.

Once you choose a unit, the price is for one of that unit, and the field's label says so, such as
**Price per kg**. At the till, a product sold in one of the weight units Waitron provides (grams,
kilograms or milligrams), or by a unit whose **Precision** allows decimal places, asks how much each
time, to no more decimal places than the unit allows. Any other product sells one per tap. The
receipt prints the quantity with the unit's abbreviation, such as 0.35 kg. A product the till asks
the quantity of cannot take extras.

## Give a product up to three names {#names}

The name you just typed is the **staff** name. It is plain text, in no particular language, and it
is what you and your staff see: the Products list, the till's buttons, the basket, an open table's
line list, a retrieved order and your sales reports. Use whatever the venue actually calls the dish.

Two optional names sit in sections of their own. **Descriptors** starts folded and **Kitchen**
starts open:

- A **customer-facing name**, under **Descriptors**, with one field per content language. This is
  what a diner reads: the receipt and the invoice. A receipt and an invoice show the default
  language's customer-facing name whatever language they print in, or the staff name when you leave
  every language blank. Once you fill in one language, fill in the default language too, or the
  product will not save.
- A **kitchen name**, under **Kitchen**. This is what the kitchen ticket prints and what the kitchen
  screens show. It is useful when the short label a cook needs differs from the name you sell under.
  Leave it blank and the kitchen sees the staff name instead.

The two fall back separately. Filling in a customer-facing name does not change what the kitchen
sees, and filling in a kitchen name does not change what the diner reads. While either name is
blank, its field shows the name that will be used instead.

You can also add a customer-facing description, under **Descriptors**, and a photo, which sits
beside the name, below the category path.

## Give the product a main category {#category}

Each product has one main category. Categories form a tree, so the product editor shows the
category's full path on the first line under the window's title, such as
**Drinks › Alcoholic drinks › Cocktails**, or **No category** when the product is in none. Choose
**Change** after the path to pick another: the list starts with **No category** and then shows
every category as an indented tree, each subcategory under its parent. You can also move the product
to another category on the Products screen, by turning on **Select** and dragging it, or
with **Move to…**. The main category also plays a part in choosing the kitchen station a dish goes
to, as described below.

Where the dish is made is set in the routing grid, on the **Routes** tab of **Prep
stations**. The product's own row decides first, then its category's row and each parent
category's in turn (the **No category** row for a product with no category), then **All
categories**. Within a row, a cell for the order's service zone comes before the row's **Every
zone** cell. When no cell applies, the dish goes to the venue's default station.

You can create a unit, an extras list or an options list without abandoning a product you are
editing. Open the nested form and save the new item: when you return, the product already uses it.
The unsaved product fields remain in place if the nested save fails or you cancel it.

## Choose the course {#course}

Use the **Default course** field under **Kitchen** to choose the course the dish goes out in. It
saves with the product. On a table's order, the till sorts the dishes into one section per course,
in the venue's course order, and staff can give a dish a different course there.

**Edit courses…** at the end of the **Default course** list opens the course list in a window that
saves each change as you make it. When you close it, the last course you added becomes the product's
course; if you removed the product's course instead, the product is left with none. Your other
unsaved product fields stay as they were.

## Add variants when one product has several sellable forms {#variants}

Use variants for forms of the same product that need distinct names and prices, such as a single and
a double coffee. Each variant has its own availability. Reordering or editing the variants keeps
their stable identities, so a menu's settings for a variant keep pointing at it.

Variants have a section of their own, **Variants**, under **Pricing**. Choose **Add variant** to add
one. A small window opens where you give the variant its three names (staff, customer-facing and
kitchen), its price, image and availability; the customer-facing and kitchen names fall back to the
variant's staff name exactly as the product's do. Save the window to add that one variant, or cancel
it to add nothing. On the till's order lines, a receipt and a kitchen ticket, a variant is shown
after its product's name, in brackets, such as Coffee (Large), and the sales report lists each
variant under its product. So name a variant by what sets it apart: Large, not Large coffee.

The product keeps its own price field, above its VAT. Once the product has an Active variant, the
field's label starts **Base price**, because a variant you leave without a price of its own sells at
it. That variant's empty price shows the base price greyed out as a hint, in its window and in its
row of the table. The **Pricing** section then folds to one line, such as **Base price:** €38.00
per kg · **VAT:** Reduced (10%); choose the line to open it. It opens by itself when the base price
or the VAT needs fixing. When you open a product without Active variants, Pricing starts open;
with Active variants, Pricing starts closed and Variants starts open. You can close either section
without losing the draft. The unit link in the variants' Price heading opens the same unit dialog
as the price field's unit button.

Drag a row by the handle at its start to reorder it, or focus the handle and use the up and down
arrow keys. Each row's **Available** switch marks the variant sold out or back on sale. The row menu
offers **Open**, **Edit** and **Archive** (**Remove** for a variant not yet saved). **Edit**, or a click on the variant's row, reopens the small window. Changes you make
in the table, including the Available switch, are saved when you save the product.

**Open** takes you to the variant's own page, where it can have its own VAT, allergens and the other
product details. Its main category and its unit are always its product's: the page shows the
product's category path as plain text, with no **Change**, and the product's unit as plain text
beside the price, such as "per kg", or "Each" when the product has none. If one form of a product
needs a different unit, make it a product of its own. Apart from the names, each detail you leave
blank there shows the product's value greyed out as a hint or, where the product has none, what will
be used, such as "Not yet reviewed" for allergens nobody has reviewed, and the variant uses the
product's value. The description works as one value across all languages: to use the product's
description, leave every language of the description blank. Once you write the description in one
language, the variant uses only its own description, and the languages you left blank stay blank.
The page has no Modifiers or Variants section, because a variant always uses its product's extras
and options lists. **Open** appears once the variant has been saved, and it waits while the product
has unsaved changes, because leaving the product would lose them: save the product first.

**Archive** on a saved variant stages a permanent archive. The row stays visible with
**Archived when saved** and **Keep** until you save the product. Choose Keep to cancel that
staged change. Once saved, the till stops offering the variant, its menu prices are deleted,
and its past sales stay. You cannot bring it back. A variant already archived is hidden from the
editor. Turn on **Show archived** in the Products list to see it. **Remove** drops a variant you
have not saved yet.

If a live or scheduled menu includes the variant, the save is refused and names the menus.
Take the variant out of those menus and publish before archiving it. You cannot add an Active
variant to a product that an extras list offers, because a product with Active variants cannot
be an extra. That refusal names the extras lists to take the product off first.

The products list keeps each product's variants folded away under it. A product with Active variants
says how many under its name, such as **2 variants**, and the small arrow before its name opens
them. The list shows a product's variants in the product's own order, the order of the variant list
in the product editor, whichever column the list is sorted by; drag them in the editor to change it.
Each variant's row shows its photo, its own name, the price it sells at, its availability and its
row menu. A variant with no photo of its own shows its product's or, when neither has one, the same
square as its product's row. Choose the photo or square to open the variant's own page at its photo.
On a phone the photo is hidden. If a variant's VAT differs from its product's, the list notes it
under the variant's price. A variant's row menu offers **Archive** there too, as a product's own row
does. Turn on **Show archived** to list archived products and variants, then choose **View** for
one's plain-text details. View has no Save or availability switch; it keeps the retained record
available without allowing edits.

A variant follows its product onto every menu the product is on, including a variant you add later.
On the menu you can give it a price of its own, or let it follow the menus it comes from. A price
you set for this menu wins. Otherwise, prices set for that size on included menus and on the
product contribute to its price. If there is no size-level price, it follows the combined product
price.

Leave a menu price empty to let those contributions decide it. For example, if Drinks prices beer at
€3.00 and Evening includes only Drinks' beer, Evening charges €3.00. If Evening also puts that beer
in its own section at the product's €2.80, the prices disagree. Set Evening's beer price to resolve
that disagreement before publishing. The menu's **Price overrides** tab shows where each price comes
from and which settings still need your decision.

## Declare allergens and dietary suitability directly {#allergens}

**Nutritional info** starts folded, with a summary line such as "Allergens: Not yet reviewed ·
Dietary: None". Open it to choose.

Under **Allergens**, choose each of the 14 allergens the dish contains, or
**Contains none of the 14** once you have checked that it has none. Choosing
**Cereals containing gluten** or **Nuts** opens a row of kinds beneath it, such as **Wheat** or
**Almonds**: choose at least one. Choosing an allergen means the dish contains it; there is no
separate “may contain” choice. Removing the last allergen returns a product to not reviewed, and a
variant to its product's allergens.

Under **Dietary**, choose any of **Vegan**, **Vegetarian**, **Halal**, **Kosher**, **No meat** and
**No fish**. Vegan also ticks Vegetarian, No meat and No fish, and Vegetarian ticks No meat and No
fish; a tick that follows from another of your choices cannot be changed by itself.

Each product states its own allergens and diet labels. A variant uses its product's until you choose
its own on the variant's page. **Same as** followed by the product's name goes back to the product's
allergens, and removing the variant's last diet label goes back to the product's labels. An extra
you can add to a dish is itself a product, so it brings its own declarations with it. A choice on an
options list does not: an option such as _rare_ or _well done_ carries no allergens and no dietary
suitability of its own, because it is a way of asking for the same dish rather than something extra
to eat. The till and kitchen show each item's own list.

In the Products list, **Not reviewed**, **None** and **Declared** distinguish a dish you have not
checked from one you have checked. A variant shows its effective state; italic means it follows
its parent. The Allergens filter uses that same state for each variant.

Before you publish now or schedule a menu, the confirmation lists offered dishes and active
variants whose allergens are unreviewed. Select a name to open that product's own page. You can
still publish or schedule: the warning asks you to check the declarations, rather than refusing
the publication. Cancelling the scheduled confirmation keeps the date and time you entered.

Existing purchasing data and recorded order facts remain available, but you maintain live
product allergens and dietary suitability in **Products**.

## Put a new product on your menus {#menus}

When you save a new product, the editor closes and a window such as **Add Flat white to menus** asks where it goes. It
lists each menu's **Top level** and the sections inside it: tick the places you want and choose
**Add to menus**, or choose **Skip** and place it later. The product is already saved by then, so a
place that refuses it does not undo the save. The window names the places that failed and keeps
them ticked so you can try again. A menu's sections themselves are built under **Products and menus →
Menus**.

## Keep choices reusable {#reusable-choices}

Create reusable extras lists and options lists on the two tabs of **Modifiers**, then attach them in
the product's own **Modifiers** section, in the order you want. See
[Reuse choices across your products](modifiers.md) for what each kind holds, its defaults and
limits, and extra prices.

When you park or complete an order, Waitron saves the chosen product and variant names, kitchen name,
prices and modifier answers. Later catalogue edits apply to new selections. The parked order,
kitchen ticket, receipt and reprint continue to show the facts saved with that order.

The demo venue includes a coffee named in each of the venue's content languages, with two variants,
a separate kitchen name and direct dietary declarations; the Mixed salad has a custom unit. Casa
Delgado and Menú del Día include a **Drinks** menu as a folder. Drinks prices Caña at 3.00 instead
of its product price of 2.80; both including menus inherit that price. Menú del Día sets its own
Negroni price of 9.00. The coffee variants keep their own prices. The demo sirloin carries a seeded
options list, **Punto**, asking how the steak should be cooked. On **Pollo asado**, you can choose
up to three optional sides from **Guarniciones**: Padrón peppers (2.00), mixed salad (1.50) and
house bread (0.50). These prices apply to one portion added to the chicken, so you can try an
extra priced differently from the same product sold on its own.

## Read a dish’s nutrition at the till {#nutrition-at-the-till}

Hold a product button down to open its information window. You see the dish’s allergens, including
its cereals or nuts, and its diet labels. An unreviewed dish says so in the window. Choose **Add to
order** to select the dish, or **Close** to return without adding it.

The small nutrition mark appears only when the dish has declared allergens or diet labels. You
can still hold an unmarked button to check its review state. A short tap anywhere on the button,
including the mark, adds the dish as usual.

Order lines show nutrition icons after the dish’s name. An unreviewed dish shows no icons; check its
information window rather than treating the absence of icons as a declaration. Extras keep their
own nutrition separate from the dish. There is no separate Allergens screen or printed allergen
sheet in the till.

Shift+F10 or the context-menu key opens the same information window for a focused product. Enter
still selects the dish.
