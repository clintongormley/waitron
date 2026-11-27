# Build a product once, then decide where to sell it

A product describes what you sell. A menu decides whether that product is sold in a particular
service, and at what price. Keeping those jobs separate lets you reuse one coffee on several menus
without copying its prep station name, dietary declarations or choices.

You can add products before creating a menu. Open **Products** in the management dashboard and choose **Add product**. Give the product a name
and enter its price.

When you open an editor from the Products list, use your browser’s **Back** button to return to
the list. If you’ve made changes, choose **Keep editing** or **Discard changes**. When you open a
variant from its product, **Back** returns to the product.

The editor holds three cards. The first holds Name with its photo, **Category**, and **Available**.
The third holds the price, the variants and the modifiers. Between them, **Details** holds the rest:
the prep station, how the product appears on the menu, allergens and diet, VAT, and ordering.
Details is open when you add a product and closed when you edit one. While it is closed, it shows a line for each of its groups that has
something set, so you can see what is set without opening it. Click its heading to open or close it. If
it contains something you need to fix, it opens itself and stays open until you have fixed it.

In **List**, search by product or variant name. To find dishes in a category and its subcategories,
choose a **Category** in **Filters**. Under **Available**, choose **No** to find dishes or variants that are off sale.
A dish with an unavailable variant can appear under **Yes** and **No**. On a phone, look under
the product name for its category. The switch beside the price controls availability. On a phone,
exit **Select** to see the price and switch again.

To change several products together, turn on **Select**, tick the products and choose
**Mark available** or **Mark unavailable**. The selected count says how many ticks search
or filters hide. In **Tree**, tick a category to include all its products and those in its
subcategories, even when search or filters hide them. After marking a category, a notice
shows how many products the action applied to. In Tree, the heading checkbox ticks the visible matching rows.
To include a category shown because one of its products matches, tick the category itself.

Switch to **Tree** to browse or organise categories. Categories stay in alphabetical order when
you sort products, and matching categories open while you filter. To add directly in a category,
choose **Add product** in that category's ⋮ menu. The button beside the page heading starts a product
without a category.

If no products match or your choices hide a product you just saved, choose **Clear search and
filters**. If a new empty category disappears while you filter in Tree, choose **Clear all** in
**Filters**.

## How VAT is charged {#vat}

Everything eaten or drunk here is charged at one rate, shown in the product editor
("Eaten here: 10% (all food and drink)"). Waitron updates it when the law changes; there is
nothing to set.

Where your region taxes takeaway food differently, **VAT when taken away** holds the rate this
product is charged when it is taken away. Pick it from the list. A new product starts at **New
products start at (VAT when taken away)**, on the **Defaults** card of the **Venue details** tab.
A variant can keep its product's rate. A change applies to every takeaway ticket from then on,
including orders already open; you do not need to publish the menu.

## Set how a product is sold {#selling}

**Available**, under Name, says whether the product is on sale. **Standalone ordering by**, under
**Ordering** in **Details**, says who can order it on its own: Anyone, Staff only or Nobody. The
explanation below the selected choice tells you what it allows. A variant has no Ordering, because
it is ordered as its product is. The Products list shows
**Staff only** or **Not sold separately** beside the product name when either applies. Use
**Standalone ordering by** in **Filters** to find products by this setting.

Choose the pencil-marked thumbnail beside Name to change the image or colour. The square previews
a colour change before you save. Close the panel with Escape to return to the thumbnail.

## Choose a selling unit {#selling-unit}

A product is sold one at a time unless you choose a unit. Choose one when you sell it by weight or
by volume, such as grams or litres. The price field shows **Each** until you do: select it to open
the **Pricing unit** window, which lists **Each** first and then your units, sorted in your
dashboard language. **Add unit** there creates a new unit without leaving the product.

Once you choose a unit, the price is for one of that unit, and the field's label says so, such as
**Price per kg**. Choose **Measures a quantity (ml, g…) — no extras** for a unit you sell by
amount. The till asks for the amount when you tap the product. It also asks for amounts in weight
units or units whose **Precision** allows decimal places. Type the amount into the product's
field or use the till keypad. If the unit has no decimal places, type digits without separators.
The receipt prints the amount and the unit's abbreviation, such as 250 ml. A product entered by amount does not take extras.

Waitron provides millilitres, litres, grams, kilograms and milligrams with the measure switch on.
A unit you create starts with it off. Publish the menus that sell the unit's products to send
your changes to the till.

When you rename a unit used by an extra, the menu preview shows its old and new names even
when the abbreviation stays the same. If the displayed unit label and decimal places are
unchanged, the preview reports that the unit details changed. Publish the menu to use the new
unit facts on future orders.

## Give a product up to three names {#names}

The name you just typed is the **staff** name. It is plain text, in no particular language, and it
is what you and your staff see: the Products list, the till's buttons, the basket, an open table's
line list, a retrieved order and your sales reports. Use whatever the venue actually calls the dish.

Two optional names sit in **Details**:

- A **customer-facing name**, under **On the menu**, with one field per content language. This is
  what a diner reads: the receipt and the invoice. A receipt and an invoice show the default
  language's customer-facing name whatever language they print in, or the staff name when you leave
  that default name blank. A regional field such as **English (United States)** is optional:
  leave it blank to use English, or enter only the wording that differs. Check regional names in
  the menu’s **Preview** tab. Regional names do not replace the default name on a receipt.
- A **prep station name**, under **Prep station**. This is what the station ticket prints and what the station
  screens show. It is useful when the short label a cook needs differs from the name you sell under.
  Leave it blank and the station sees the staff name instead.

The two fall back separately. Filling in a customer-facing name does not change what the station
sees, and filling in a prep station name does not change what the diner reads. While either name is
blank, its field shows the name that will be used instead.

You can also add a customer-facing description, under **On the menu**, and a photo, which sits
beside the name.

## Give the product a main category {#category}

The **Category** field shows the full path, such as **Drinks › Alcoholic drinks › Cocktails**.
Open it to browse or search the category tree. Choose **No category** to leave the product
uncategorised. To create a category while editing, type its name and choose **Add category** at the
top of the list. Choose where it goes in **Inside**, pick a colour if you want one and select
**Add category**. You can cancel the product edit and the new category stays saved.

On the Products screen, turn on **Select** and choose **Move to…** to move products. To drag products
into a category, switch to **Tree** first. The main category also helps choose the prep station a
dish goes to, as described below.

To drop into a subcategory, open its parent categories before you start dragging.
When you drop products or categories, the Move window opens with the destination selected. Review
any preparation station changes and choose **Move** to save. You can also drop onto
**All products** to move items out of their category. Check the station changes when you open
**Move to…** from the toolbar too.

When you delete a category, choose whether to keep its contents or delete them too. Check where
the contents will move if you keep them. Products you ticked yourself are deleted with either
choice.

While you add or rename a category, choose the square beside its name to set its colour.
Pick **Inherit** to follow the colour shown in that choice. Pick a swatch to fix the colour here,
even if it matches the inherited colour.

Where the dish is made is set in the routing grid, on the **Routes** tab of **Prep
stations**. The product's own row decides first, then its category's row and each parent
category's in turn (the **No category** row for a product with no category), then **All
categories**. Within a row, a cell for the order's service zone comes before the row's **Every
zone** cell. When no cell applies, the dish goes to the venue's default station.

The Products list does not show where each dish is made; the **Routes** tab does. A red asterisk
after a category's name in the list means its **Every zone** route reaches no active station. Other
routes on the **Routes** tab can still send some of its dishes to a station. When the routing fails
to load and the list has categories, one line above the list says so, and no category is marked.

You can create a unit, an extras list or an options list without abandoning a product you are
editing. Open the nested form and save the new item: when you return, the product already uses it.
The unsaved product fields remain in place if the nested save fails or you cancel it.

## Choose the course {#course}

New venues in Spain start with **Sharing plates**, **Starters**, **Mains** and **Desserts**.
Their names follow the starter
language. Assign these courses to your products, or edit the list to suit your service.

Use the **Course** field under **Prep station**, in **Details**, to choose the course for new dishes. It saves
with the product. At a table, arrange dishes in **New order**: they can go in **Fire now**, a new
held group or an existing held group. You can change an unsent dish's course before sending it.
Use groups to choose which dishes you fire together, rather than treating each course as one
fixed section for the whole table.

In the department’s **Tables** tab, choose **Fire now** to put new dishes straight into that group at a table.
Choose **Hold for later** to group the first order by course. On later orders, check the proposed
group before sending; you can move dishes between groups. In **Courses**, add one with **Add course**, then
save its name with Enter or by leaving the field. Open the row’s ⋮ menu to rename or delete a
course. Choose **Customer-facing names** in the same menu to name the course in each language.
To publish changes to course names, review and publish the full menu that offers the set menu.

**Edit courses…** at the end of the **Course** list opens the course list in a window that
saves each change as you make it. When you close it, the last course you added becomes the product's
course; if you removed the product's course instead, the product is left with none. Your other
unsaved product fields stay as they were.

In the Products list, open **Customise** to show the **Course** column. If your venue has courses,
use **Course** in **Filters** to choose one or more of them or find products with **No course**.

At a table in the Spanish demo, send a first order with drinks and mains. The drinks go
straight to the bar, and the mains wait for **Fire**. Desserts sent with that first order
wait in their own group.

## Add variants when one product has several sellable forms {#variants}

Use variants for forms of the same product that need distinct names and prices, such as a single and
a double coffee. Each variant has its own availability. Reordering or editing the variants keeps
their stable identities, so a menu's settings for a variant keep pointing at it.

Variants sit below the price, in their own group, **Variants**. Choose **Add variant** to add
one. A small window opens where you give the variant its three names (staff, customer-facing and
station), its price, image and availability; the customer-facing and prep station names fall back to the
variant's staff name exactly as the product's do. Save the window to add that one variant, or cancel
it to add nothing. On the till's order lines, a receipt and a station ticket, a variant is shown
after its product's name, in brackets, such as Coffee (Large), and the sales report lists each
variant under its product. So name a variant by what sets it apart: Large, not Large coffee.

The product keeps its own price field. Once the product has an Active variant, the field's label
starts **Base price**, because a variant you leave without a price of its own sells at it. That
variant's empty price shows the base price with an arrow in its window and in muted text in the
table. Type a price to fix it. On the variant's page, choose **Inherit** for Course or VAT when
taken away to follow its product, or choose a value to fix it. The unit link in the variants'
Price heading opens the same unit dialog
as the unit link in the price field.

Drag a row by the handle at its start to reorder it, or focus the handle and use the up and down
arrow keys. Each row's **Available** switch marks the variant sold out or back on sale. The row menu
offers **Open**, **Edit** and **Delete** (**Remove** for a variant not yet saved). **Edit**, or a click on the variant's row, reopens the small window. Changes you make
in the table, including the Available switch, are saved when you save the product.

**Open** takes you to the variant's own page, where it can have its own VAT when taken away, allergens and the other
product details. Its main category and its unit are always its product's: the page shows both
as plain text. The unit sits beside the price, such as "per kg", or "Each" when the product has none. If one form of a product
needs a different unit, make it a product of its own. Apart from the names, each detail you leave
blank there shows the product's value greyed out as a hint or, where the product has none, what will
be used, such as "Not yet reviewed" for allergens nobody has reviewed, and the variant uses the
product's value. The description works as one value across all languages: to use the product's
description, leave every language of the description blank. Once you write the description in one
language, the variant uses only its own description, and the languages you left blank stay blank.
The page has no Variants or Modifiers, because a variant always uses its product's extras
and options lists. **Open** appears once the variant has been saved, and it waits while the product
has unsaved changes, because leaving the product would lose them: save the product first.

Choose **Delete** on a saved variant to mark it **Deleted when saved**. Choose **Keep** to
undo the choice before saving. **Remove** drops a variant you have yet to save.
Check any extras lists named before you save. Saving removes the variant from those lists.

If a live or scheduled menu includes the variant, the save is refused and names the menus.
Take the variant out of those menus and publish before deleting it. You cannot add an Active
variant to a product that an extras list offers, because a product with Active variants cannot
be an extra. That refusal names the extras lists to take the product off first.

The products list keeps each product's variants folded away under it. A product with Active variants
says how many under its name, such as **2 variants**, and the small arrow before its name opens
them. In **Filters**, choose **Has variants** or **No variants** under **Variants**.
The list shows a product's variants in the product's own order, the order of the variant list
in the product editor, whichever column the list is sorted by; drag them in the editor to change it.
Each variant's row shows its photo, its own name, the price it sells at, its availability and its
row menu. A variant with no photo of its own shows its product's or, when neither has one, the same
square as its product's row. Choose the photo or square to open the variant's own page at its photo.
If a variant's VAT when taken away differs from its product's, the list notes it
under the variant's price. Choose **Delete** in a product or variant's row menu to remove it permanently from
Products. Its past sales stay on record.

A variant follows its product onto every menu the product is on, including a variant you add later.
A menu prices a product with variants only through its variants, so adding a product's first
variant removes the price each menu set for the product. A set menu keeps its supplement.
On the menu you can give a variant a price of its own, or let it follow the menus it comes from. A
price you set for this menu wins. Otherwise, prices set for that variant on included menus and on
the variant itself contribute to its price. If none is set, it sells at its product's price.

Leave a menu price empty to let those contributions decide it. For example, if Drinks prices beer at
€3.00 and Evening includes only Drinks' beer, Evening charges €3.00. If Evening also puts that beer
in its own section at the product's €2.80, the prices disagree. Set Evening's beer price to resolve
that disagreement before publishing. In **Structure**, the clash shows which prices disagree.
Expand a dish with variants to set a price on the affected variant's row.

## Declare allergens and dietary suitability directly {#allergens}

Choose them under **Allergens and diet**, in **Details**. Until someone has reviewed a product's
allergens, Details' closed line shows "Allergens: Not yet reviewed" in the warning colour.

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
its own on the variant's page. Choose **Inherit** to use the product's allergens, and removing the variant's last diet label goes back to the product's labels. An extra
you can add to a dish is itself a product, so it brings its own declarations with it. A choice on an
options list does not: an option such as _rare_ or _well done_ carries no allergens and no dietary
suitability of its own, because it is a way of asking for the same dish rather than something extra
to eat. The till and station show each item's own list.

When you save a change to a product's allergens or diet labels, Waitron asks about any live or
scheduled menus that still show earlier values. Choose **Update now** to correct the live menus and
the scheduled versions you tick. To check for changes still waiting on a live menu, open **Review
and publish**. Publish the menu or use [Patch live menu](products.md#patch-live-menu) to put those
changes live.

In the Products list, **Not reviewed**, **None** and **Declared** distinguish a dish you have not
checked from one you have checked. A variant shows the status of the allergens it uses.
Grey means it follows its parent. The Allergens filter uses the same status. The **Allergens** and
**Dietary info** columns start hidden. To show them, select the columns button at the right-hand
end of the list's search box; in **Customise**, select the eye beside each column, then **Done**.
Their filters work while the columns are hidden.

Before you publish now or schedule a menu, the confirmation lists offered dishes, active
variants and extras whose allergens are unreviewed. An extra lists the dishes that offer it.
Select a name to open that product's own page. You can still publish or schedule after reading
the warning. Cancelling the scheduled confirmation keeps the date and time you entered.

While someone at the till uses **Filter** to hide an allergen, unreviewed dishes and sizes are
hidden too. Review the declarations for each size you sell, or choose **Contains none of the 14**,
save, then publish the menu.

With a diet chosen in the till's **Filter**, only dishes with that tick under **Dietary** are shown,
so tick **No meat** or **No fish** on the dishes that qualify.

Existing purchasing data and recorded order facts remain available, but you maintain product
allergens and dietary suitability in **Products**.

## Put a new product on your menus {#menus}

To remove a menu permanently, find it under **Menus** or **Set menus**. Choose **Delete…** from
its row menu, check the product count and choose any replacements the window asks for.

Under **Filters**, **Status** starts on **All**. Choose **Published** or **Requiring attention** to narrow the list.

Use **Search menus** on the Menus list to find a menu by name.

Check **Main menu** to see which periods open on a menu and **Staff menus** to see where staff can select it. Choose a period name to open its settings if you can edit periods.

**Unpublished changes** under a menu's status means the tills do not have your latest edits yet:
choose it to review them and publish. **Price clashes** there must be fixed before the menu can be
published: choose the link to open **Structure** filtered to those clashes.

When you save a new product, the editor closes and a window such as **Add Flat white to menus** asks where it goes. It
lists each menu's **Top level** and the sections inside it: tick the places you want and choose
**Add to menus**, or choose **Skip** and place it later. The product is already saved by then, so a
place that refuses it does not undo the save. The window names the places that failed and keeps
them ticked so you can try again. A menu's sections themselves are built under **Products and menus →
Menus**.

In **Structure**, open a product’s row menu and choose **Edit product**. Choose its photo where shown to go straight to the image control. **Save** updates the product and returns you to its row in the menu.

In **Structure**, open the menu or section’s row actions to add dishes or sections. Drag a row
by its handle to move it. To move or remove several at once, choose **Select** and tick their
rows. Choose a section row and copy the address if you need to link back to that section.

Enter a price beside a dish to set its price on this menu. Expand a dish with variants to price
each one. Clear an entered price to use the usual price. A price you change applies everywhere
the dish or variant appears on this menu. Choose the clash link on the Menus list or the menu heading,
or choose **Choose a price** in Preview, to open Structure filtered to clashes.

Choose **Save** at the bottom of Structure to keep the arrangement and prices together. Choose
**Cancel** and confirm to go back to the saved menu.

## Set menus {#set-menus}

To sell several courses for one price, open **Set menus** under **Products and menus** and
choose **Add set menu**. Give it a name and price, add customer names in the languages you use,
then save.

In **Dishes**, add the dishes you want to offer. Keep dishes sold by weight on the full menu,
where staff can sell them separately. Use **Variants** to choose which versions are included.
Enter a surcharge beside each dish that costs extra, then choose **Save** under **Dishes**.
Leave the amount blank for a dish that is included in the set-menu price. Set variant surcharges
in **Variants**.

Under **What one set menu includes**, set how many dishes you offer from each course. For example,
use one line for one starter and another for one main. Put two courses on the same line to let
guests choose from either.

If your set menu includes drinks, bread or coffee, [add the courses you need and assign them to
products](products.md#course). In each department, set Drinks and Bread to **Fire now** so you
can send them with the first order.

Check **Offered on** to see which menus sell a set menu. Choose a menu name to open it.

Open the full menu that will offer the set menu. In **Structure**, open the actions for the
menu or section where it belongs, choose **Set menu…** and pick it. Use **Preview** to see the
placement, later edits and anything you need to fix. Publish the full menu to send the current
set menu to the tills. Each later edit reaches the tills when you publish the full menu again.

## Set up the device home page {#menu-home}

Open **Device home page** on the menu you want to change. Choose **Add shortcuts** and pick the
products and sections staff need close at hand. Move a shortcut by dragging the grip in its
top left corner, or remove it using the bin in its top right corner. Under **Shown first**, choose **Shortcuts** or **Full menu**.

Choose **Save** to keep all your changes. Then publish the menu to send them to every till and
handheld that uses it.

## Copy a menu {#copy-menu}

When your next menu is similar to one you already have, start with a copy. In **Products and
menus**, open **Menus** or **Set menus**. Open the menu's ⋮ and choose **Copy…**. Enter a new name, then choose **Copy**.
Use a name no active menu holds. Upper and lower case count as the same name. **Cancel**
discards the name without asking and creates nothing. Escape still asks whether to keep editing
or discard a name you have typed.

The same rule applies when you create or rename a menu. Names ignore surrounding spaces. If an
active menu already holds the name, the message appears under Name.
Menus that already share a name keep it until you rename one.

The copy starts unpublished, with the source menu's working sections, prices and device home page
settings. Published versions and scheduled publications stay with the source. Editing the copy's
own sections leaves the source as it was; included menus still point to the same shared menus.

## Review unpublished menu changes {#preview-undo}

Choose **Review and publish** in the menu heading. If you have unsaved changes in Structure,
choose **Save and review**. In **Fix before publishing**, choose a price or open the set menu
you need to fix. Then open any warning you need to check. Select an item's name in
the change list to find it in the proposed menu. On a phone, switch between **Changes** and **Menu**.
Use the language picker above the menu to check translations or see **Internal names**.
Check **Details** for changes to the menu’s customer names and to course names on set menus.

Use **Publish now** or **Publish later** in the heading when you are ready. To check or change
a waiting publication, find it under **Scheduled versions** below the menu preview. After you
publish, check the version and publication time in the menu heading.

## Check the published customer menu {#customer-menu}

Open **Customer menu** and choose **Phone** or **Computer** to check the published layout. Use
**Language** to check the words for each content language. Use **Search dishes** to find a dish
or set menu by name, or choose a section to jump to it. Open **Allergies and diets** to select
allergens to exclude or choose a diet. Open a dish or set menu to see which choices are marked.
Find the allergen key below the dishes.
Open a dish to check its variants, options and extras. Check the dish's **Allergens** and
**Dietary declarations**. Check an extra's allergen icons beside its name and look for that
extra in **Allergens**. Look below each variant for its declarations.
Check the amounts for measured extras and the full unit name for extras with multiple servings.
Open a set menu to see the courses, choices and any supplements. Check **Allergens** for the
allergens listed beside each choice’s name. When a choice declares
allergens or diets, check the icons beside its name and the dietary declarations below it.
Choose **Menu** to pick up where you left off.
Customers cannot open this page yet. To review or publish your changes, switch to
**Preview**.

## Patch the live menu in an emergency {#patch-live-menu}

Use a patch when you find a mistake in the menu that is live now, such as a wrong price, while the
products already hold work for the next menu that you do not want on the till yet. Publishing would
put that work live as well. A patch changes only the values you correct, in one menu:
its live version and, for allergens and diets, the scheduled versions left ticked.

Find the live menu in **Products and menus → Menus**. Open its row menu and choose
**Patch live menu…**. The window lists the items in the live menu, with a search box,
and its extras and options lists under **Extras and options**. Pick an item to see what you can
change:

- A dish: its name, customer-facing name, prep station name, description, image, price, and
  allergens and diets.
- A variant or an extra: the same, without a description.
- An options list's choice, and the name of an extras list or an options list: its three names.
- A section: its internal name, customer-facing name and image.

Customer-facing names and descriptions show a field for each content language. Choose or remove an
image as you would in the product editor. A dish with variants is charged at each variant's own
price, so correct the price on its variants, which its form lists with their price; correcting the dish
never changes them, except their allergens and diets. A change to an extra, an options list's choice
or a list's name is made everywhere that list appears in this menu. A product sold both as a dish and as an extra, or in two
extras lists, is corrected in each place separately. A section shown inside an included menu's folder keeps any name or picture that folder sets for it,
and a language's name that the folders set in every place the section appears is shown greyed out,
with **The included folder sets this name.** under it, and cannot be changed here.

To correct allergens or diet labels, [change them on the product](products.md#allergens) first, then
select **Use the product's current allergens and diets** on its item in the patch. **Review** shows
what changes, and lists the scheduled versions that differ from the product. Those that still
have the old value are already ticked: untick any to leave as it is, and tick any other to correct.
A dish sold only inside a set menu is not in the list of items: publish the menu to correct it.

A patch cannot change anything else: not the unit, availability, course or category, the order of
items, colours, or which items and sections the menu holds.

Each item you change is marked with a dot. A value the patch cannot take is pointed out when you
choose **Review**: its field says what to correct, its item is marked with **!**, and **Review** stays
unavailable until you correct it. If **Put live now** is refused because of one value, the
window goes back to that value's field and says why there; your change stays in the window.
An image deleted from the image library after you chose it is refused this way: choose another, or
remove it.
**Review 1 change**, or **Review** followed by the number of changes, lists each one as the old
value → the new one. Choose **Keep editing** to go back, or **Put live now**. What putting a patch live does:

- It goes live at once as a new version of this menu, under the next number. Lines added to orders
  from then on use the corrected values. Lines already on open orders keep their old price, but
  kitchen screens show their corrected allergens and diets.
- On a parked counter order, renaming an options list or one of its choices does what it does after
  a publish, as [What the till does with a list](modifiers.md#till) describes: with a new staff name
  the order keeps the answer it holds, and a new customer-facing or prep station name
  is saved onto lines not yet sent at the next change to the order. Those lines keep their prices.
- It changes nothing else: not the products, not the menu's own items and sections, not your other
  menus. A product on two menus is patched on each one.
- A version scheduled to go live later keeps its date and its content, and goes live then without
  the patch, except for the allergens and diets of the versions left ticked. It is given a new number
  after the patch's, under **Scheduled versions** on the **Preview** tab.
- The next normal publish builds the menu from the products again, so it puts the old values back,
  except allergens and diets, unless you correct the products too.

A field set back to its live value is not counted as a change. If another version goes live while
you have changes or a field to correct in the window, the window keeps showing the version you were
correcting and says so, and **Put live now** is refused: **Reload** opens the version that is live
now and keeps the changes that still fit it. If it goes live while you have neither, the window
moves to it by itself.

## Keep choices reusable {#reusable-choices}

Create reusable extras lists and options lists on the two tabs of **Modifiers**, then attach them in
the product's own **Modifiers** group, in the order you want. See
[Reuse choices across your products](modifiers.md) for what each kind holds, its defaults and
limits, and extra prices.

When you park or complete an order, Waitron saves the chosen product and variant names, prep station name,
prices and modifier answers. Later menu edits apply to new selections. The parked order,
station ticket, receipt and reprint continue to show the facts saved with that order. A line not yet
sent takes the new customer-facing or prep station name of an options list or option at the next
change to the order.

When you set up a Madrid demo in English, its staff and prep station names are in English.
At a table at lunch, open **Lunch menus** for the **Menu of the day** (€14) or the **Special
menu** (€20). Try the **Sirloin** for a €5 supplement on the Menu of the day.
**Salad** uses the prep station name
**SALAD · LUNCH** and a custom **Portion** unit, abbreviated **ptn**. **House coffee** has two
variants and the prep station name **COFFEE · DOWNSTAIRS BAR**. Customer names keep the venue's
content languages, so changing staff wording does not replace the words on a receipt.

A demo in Catalonia or the Balearic Islands starts as **Can Delgado**, with regional
dishes and cava. In the Valencian Community, it starts as **Casa Delgado de l'Horta**,
with all i pebre, paella and Requena wine. In Galicia, it starts as **A Casa Delgado**,
with empanada, lacón con grelos, filloas and Albariño.

Staff and prep station names, menus, departments and stations follow the
English or Spanish language used to prepare the demo. Changing your screen language
later does not rename them. Customer wording keeps the region's Catalan, Valencian
or Galician text alongside Spanish and English. Catalonia uses Catalan receipts;
the Balearic, Valencian and Galician demos default to Spanish receipts.

During setup, the suggested restaurant name follows the postcode or province until you edit it.
Once you type a name, Waitron keeps it when you change the region, including after Review and Back.

Casa Delgado and Lunch menus include a **Drinks** menu as a folder. Drinks prices **Beer** at
3.00 instead of its product price of 2.80; both including menus inherit that price. Lunch menus
sets its own **House Negroni** price of 9.00. The coffee variants keep their own prices. The
**Sirloin** carries the **Doneness** options list. On **Roast chicken**, you can choose up to
three optional **Sides**: peppers (2.00), salad (1.50) and bread (0.50). These prices apply to
one portion added to the chicken, so you can try an extra priced differently from the same
product sold on its own.

## Read a dish’s nutrition at the till {#nutrition-at-the-till}

Tap the **Filter** icon beside **Search** to narrow the dishes by diet or allergen. The number
shows how many filters are active.

Hold a product button down to open its information window. You see the dish’s allergens, including
its cereals or nuts, and its diet labels. An unreviewed dish says so in the window. Choose **Add to
order** to select the dish, or **Close** to return without adding it.

Order lines show nutrition icons after the dish’s name. An unreviewed dish shows no icons; check its
information window rather than treating the absence of icons as a declaration. Extras keep their
own nutrition separate from the dish. When you choose a dish’s extras, each extra shows its own
allergens before you add it. An unreviewed extra shows none, which does not
establish that it is suitable. There is no separate Allergens screen or printed allergen sheet in
the till.

Open a sent dish's details to check **Recorded when sent**. These declarations describe the dish
when you sent it, even if a correction is published later. Dishes on hold show what is published now
until you release them. Use the station's current information when preparing food.
To review an earlier bill, open its details in **Orders**. The saved declarations appear beneath
each dish and extra.

When you add a dish with an allergen exclusion active, you can choose only compatible sizes and
extras whose declarations have been reviewed. Optional toppings do not hide the dish. If a
preselected extra conflicts or is unreviewed, check the named extras and choose **Remove extras
and continue**, or **Cancel**. Choose replacements when the extras group requires them. The same
filter applies when adding a weighed dish or adding from its information window; it does not
change dishes already in your order. Option answers, such as doneness, carry no allergen
declarations and remain unfiltered: check them yourself.

Shift+F10 or the context-menu key opens the same information window for a focused product. Enter
selects an available dish; tap or press Enter on a sold-out dish to open its information.

## Keep a table's allergy answer with its dishes {#table-allergies}

Before you first send a table's dishes, answer **Any allergies at this table?** Choose **No
allergies**, or choose **Allergies** and enter who needs special care, the allergens they avoid and
an optional station note. You can add several guests. The answer belongs to the people at the
table and is shared by their bills.

For an allergic guest, tick the dishes they will eat. A tick covers the whole order line: a line
with two portions is assigned as one, and a dish can belong to only one guest. A clash shows each
allergen the guest avoids that the dish or one of its extras declares, and lets you choose **Send
anyway**. Check an unreviewed dish or extra yourself; missing nutrition information does not
establish that it is suitable.

Later sends offer new dishes for ticking. A dish you already submitted on hold is not offered
again just because you fire it later. To edit the answer, tap **Change** beside it or tap the table
name and choose **Allergies**. The full editor includes previously sent dishes. You can edit or
delete a guest there. When you delete the last guest, the Allergies answer stays until you change it.

Moving a counter bill to a table also checks that table's answer and offers the arriving dishes.
Cancel leaves the bill where it is. If the table changes while you answer, review the refreshed
information and confirm again before the move proceeds.

If the move highlights a guest detail, correct it and continue to the dish assignments. Your
correction stays in place through background refreshes; a new refusal can highlight it again.

The station keeps its first allergy copy with each dish. A later change reaches it as a separate
notice to acknowledge. Read how [station allergy copies and corrections](kitchen-service.md#allergy-copies)
stay with the work.

## Mark a dish sold out during service {#sold-out}

In the dashboard, open **Products** and turn off **Available** on the dish or size. Its row shows
**Unavailable**. On a phone, look just below the name. The change takes effect on every menu
that sells it. Turn the switch on when it is ready again.

When the station runs out, hold the dish on Counter or a table order to open its information.
You can still send or fire portions already on a bill.
Choose **Mark sold out** for the dish, one size, an extra or an option choice. You must be signed in on a device that takes
orders. The change applies to every menu in this venue. A sold-out dish stays visible in grey.

Choose **Back on sale** when it is ready again; nothing resets the switch the next day.
Restoring the dish keeps any individually sold-out sizes off sale.
For an option list, put another choice back on sale before marking its last available choice sold out,
even if the list has been disabled on the dashboard but is still on your menu.
