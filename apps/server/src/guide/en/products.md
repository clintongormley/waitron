# Build a product once, then decide where to sell it

A product describes what you sell. A menu decides whether that product is sold in a particular
service, and at what price. Keeping those jobs separate lets you reuse one coffee on several menus
without copying its kitchen name, dietary declarations or choices.

Open **Products** in the management dashboard and choose **Add product**. Give the product a name
and enter its price. Its VAT starts on the class chosen as **VAT class for new products**, on the
**Venue details** tab of **Venue settings**; change it here when this product is taxed differently.
For a product with no VAT, choose **No tax (0%)**. A change of VAT class reaches the tills when the
menu is published again; until then they sell the product at the class the menu was published with.
To correct the class on the live menu without publishing your other changes to the products, see
[Patch the live menu in an emergency](products.md#patch-live-menu).
A line already on an order keeps the class it was added with.

The editor keeps the fields you change often on screen and folds the rest away behind a heading that
summarises what is inside it, so you can see at a glance which sections you have filled in. Open one
by clicking its heading. If a section contains something you need to fix, it opens itself and stays
open until you have fixed it.

## Set how a product is sold {#selling}

Open **Selling** to change Available or **Standalone ordering by**: Anyone, Staff only or Nobody.
The explanation below the selected choice tells you what it allows. A variant has only Available
here. Selling starts closed, with the current settings on its summary line. The Products list shows
this setting in its **Standalone** column; the **Standalone ordering by** filter in **Filters** picks
by it.

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
the quantity of cannot take extras. Nor can a product in a unit switched to **Measures a quantity
(ml, g…) — no extras**: when Waitron sets up a venue, the millilitres, litres, grams, kilograms and
milligrams it provides start with it on, a unit you add starts with it off, and a change to it reaches the till when you
next publish the menus that sell the unit's products.

When you rename a unit used by an extra, the menu preview shows its old and new names even
when the abbreviation stays the same. If the displayed unit label and decimal places are
unchanged, the preview reports that the unit details changed. Publish the menu to use the new
unit facts on future orders.

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

While you add or rename a category, the square beside its name shows its own colour, or the colour
it inherits from the nearest coloured category above it, then the venue's default. A dashed border
marks an inherited colour. Choose the square to set a colour of its own; **No colour** keeps
inheritance, so renaming alone does not change where the colour comes from.

Where the dish is made is set in the routing grid, on the **Routes** tab of **Prep
stations**. The product's own row decides first, then its category's row and each parent
category's in turn (the **No category** row for a product with no category), then **All
categories**. Within a row, a cell for the order's service zone comes before the row's **Every
zone** cell. When no cell applies, the dish goes to the venue's default station.

The Products list does not show where each dish is made; the **Routes** tab does. A red asterisk
after a category's name in the list means its **Every zone** route reaches no active station. Other
routes on the **Routes** tab can still send some of its dishes to a station. When the routing cannot
be read and the list has categories, one line above the list says so, and no category is marked.

You can create a unit, an extras list or an options list without abandoning a product you are
editing. Open the nested form and save the new item: when you return, the product already uses it.
The unsaved product fields remain in place if the nested save fails or you cancel it.

## Choose the course {#course}

Use the **Course** field under **Kitchen** to choose the course for new dishes. It saves
with the product. At a table, arrange dishes in **New order**: they can go in **Fire now**, a new
held group or an existing held group. You can change an unsent dish's course before sending it.
Use groups to choose which dishes you fire together, rather than treating each course as one
fixed section for the whole table.

**Edit courses…** at the end of the **Course** list opens the course list in a window that
saves each change as you make it. When you close it, the last course you added becomes the product's
course; if you removed the product's course instead, the product is left with none. Your other
unsaved product fields stay as they were.

The Products list's **Course** column shows each product's course. When the venue has courses, the
**Course** filter in **Filters** picks one or several of them, or **No course**.

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
its parent. The Allergens filter uses that same state for each variant. The **Allergens** and
**Dietary info** columns start hidden. To show them, select the columns button at the right-hand
end of the list's search box; in **Customise**, select the eye beside each column, then **Done**.
Their filters work while the columns are hidden.

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

## Patch the live menu in an emergency {#patch-live-menu}

Use a patch when you find a mistake in the menu that is live now, such as a wrong price, while the
products already hold work for the next menu that you do not want on the till yet. Publishing would
put that work live as well. A patch changes only the values you correct, in the live version of one
menu.

Open the menu in **Products and menus → Menus** and choose **Patch live menu…** beside its live
version in the heading. The button appears only while the menu has a live version, and anyone who
can publish the menu can patch it. The window lists the items in the live menu, with a search box,
and its extras and options lists under **Extras and options**. Pick an item to see what you can
change:

- A dish: its name, customer-facing name, kitchen name, description, image, price and VAT class.
- A variant or an extra: the same, without a description.
- An options list's choice, and the name of an extras list or an options list: its three names.
- A section: its internal name, customer-facing name and image.

Customer-facing names and descriptions show a field for each content language. Choose or remove an
image as you would in the product editor. A dish with variants is charged at each variant's own
price and VAT class, so correct those on its variants, which its form lists with their price and VAT class; correcting the dish never changes them. A
change to an extra, an options list's choice or a list's name is made everywhere that list appears
in this menu. A product sold both as a dish and as an extra is corrected in each place separately. A
section shown inside an included menu's folder keeps any name or picture that folder sets for it,
and a language's name that the folders set in every place the section appears is shown greyed out,
with **The included folder sets this name.** under it, and cannot be changed here.

A patch cannot change anything else. Allergens and diet labels are declared on the product itself;
see [Declare allergens and dietary suitability directly](products.md#allergens). Nor can it change
the unit, availability, course or category, the order of items, colours, or which items and
sections the menu holds.

Each item you change is marked with a dot. A value the patch cannot take is pointed out when you
choose **Review**: its field says what to correct, its item is marked with **!**, and **Review** stays
unavailable until you correct it. If **Put live now** is refused because of one value, the
window goes back to that value's field and says why there; your change stays in the window.
An image deleted from the image library after you chose it is refused this way: choose another, or
remove it.
**Review 1 change**, or **Review** followed by the number of changes, lists each one as the old
value → the new one. Choose **Keep editing** to go back, or **Put live now**. What putting a patch live does:

- It goes live at once as a new version of this menu, under the next number. Lines added to orders
  from then on use the corrected values. Lines already on open orders keep their old price and VAT
  class.
- On a parked counter order, renaming an options list or one of its choices does what it does after
  a publish, as [What the till does with a list](modifiers.md#till) describes: a new staff name
  makes the till ask for that answer to be chosen again, and a new customer-facing or kitchen name
  is saved onto those lines at the next change to the order, which can send a line the kitchen
  already has to it again as a new ticket. Those lines keep their prices.
- It changes nothing else: not the products, not the menu's own items and sections, not your other
  menus. A product on two menus is patched on each one.
- A version scheduled to go live later keeps its date and its content, and goes live then without
  the patch. It is given a new number after the patch's, under **Scheduled versions** on the
  **Preview** tab.
- The next normal publish builds the menu from the products again, so it puts the old values back
  unless you correct the products too.

A field set back to its live value is not counted as a change. If another version goes live while
you have changes or a field to correct in the window, the window keeps showing the version you were
correcting and says so, and **Put live now** is refused: **Reload** opens the version that is live
now and keeps the changes that still fit it. If it goes live while you have neither, the window
moves to it by itself.

## Keep choices reusable {#reusable-choices}

Create reusable extras lists and options lists on the two tabs of **Modifiers**, then attach them in
the product's own **Modifiers** section, in the order you want. See
[Reuse choices across your products](modifiers.md) for what each kind holds, its defaults and
limits, and extra prices.

When you park or complete an order, Waitron saves the chosen product and variant names, kitchen name,
prices and modifier answers. Later catalogue edits apply to new selections. The parked order,
kitchen ticket, receipt and reprint continue to show the facts saved with that order.

When you set up a Madrid demo in English, its staff and kitchen names are in English. The till shows
**Set lunch**, while its customer name is **Lunch menu**. **Salad** uses the kitchen name
**SALAD · LUNCH** and a custom **Portion** unit, abbreviated **ptn**. **House coffee** has two
variants and the kitchen name **COFFEE · DOWNSTAIRS BAR**. Customer names keep the venue's
content languages, so changing staff wording does not replace the words on a receipt.

A demo in Catalonia or the Balearic Islands starts as **Can Delgado**. Its extra
**Especialitats de la casa** section includes **Botifarra amb mongetes**, and its Drinks
menu includes **Copa de cava**. Staff and kitchen names are Catalan even when the screens
are in English or Spanish. Customer wording keeps Catalan, Spanish and English.
In the Valencian Community, your demo starts as **Casa Delgado de l'Horta**. Its
**Especialitats de l'Horta** section includes **All i pebre** and **Paella valenciana**,
and Drinks includes **Copa de vi de Requena**. Staff and kitchen names use Valencian
while the screens remain English or Spanish. Customer text starts in Valencian,
Spanish and English; receipts default to Spanish.

In Galicia, your demo starts as **A Casa Delgado**. Its **Especialidades da casa**
section includes **Empanada galega**, **Lacón con grelos** and **Filloas**, and Drinks
includes **Copa de Albariño**. Staff and kitchen names use Galician in English and
Spanish screens. Customer text starts in Galician, Spanish and English; receipts
default to Spanish.

During setup, the suggested restaurant name follows the postcode or province until you edit it.
Once you type a name, Waitron keeps it when you change the region, including after Review and Back.

Casa Delgado and Set lunch include a **Drinks** menu as a folder. Drinks prices **Beer** at
3.00 instead of its product price of 2.80; both including menus inherit that price. Set lunch
sets its own **House Negroni** price of 9.00. The coffee variants keep their own prices. The
**Sirloin** carries the **Doneness** options list. On **Roast chicken**, you can choose up to
three optional **Sides**: peppers (2.00), salad (1.50) and bread (0.50). These prices apply to
one portion added to the chicken, so you can try an extra priced differently from the same
product sold on its own.

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

## Keep a table's allergy answer with its dishes {#table-allergies}

Before you first send a table's dishes, answer **Any allergies at this table?** Choose **No
allergies**, or choose **Allergies** and enter who needs special care, the allergens they avoid and
an optional kitchen note. You can add several guests. The answer belongs to the people at the
table and is shared by their bills.

For an allergic guest, tick the dishes they will eat. A tick covers the whole order line: a line
with two portions is assigned as one, and a dish can belong to only one guest. A clash shows each
allergen the guest avoids that the dish or one of its extras declares, and lets you choose **Send
anyway**. Check an unreviewed dish or extra yourself; missing nutrition information does not
establish that it is suitable.

Later sends offer new dishes for ticking. A dish you already submitted on hold is not offered
again just because you fire it later. **Change** beside the table's answer, or **Actions →
Allergies**, opens the full editor, including previously sent dishes. You can edit or delete a
guest there; deleting the last guest leaves the Allergies answer until you change it.

Moving a counter bill to a table also checks that table's answer and offers the arriving dishes.
Cancel leaves the bill where it is. If the table changes while you answer, review the refreshed
information and confirm again before the move proceeds.

If the move highlights a guest detail, correct it and continue to the dish assignments. Your
correction stays in place through background refreshes; a new refusal can highlight it again.

The kitchen keeps its first allergy copy with each dish. A later change reaches it as a separate
notice to acknowledge. Read how [kitchen allergy copies and corrections](kitchen-service.md#allergy-copies)
stay with the work.
