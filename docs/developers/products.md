# Product names, variants and the product editor

A product is sold by three different audiences at once. The waiter hunting for it on a till button
wants the name the venue uses in the kitchen doorway. The diner reading the receipt wants it in their
own language. The cook reading the ticket wants whatever fits on 42 characters of thermal paper.
Those three are not the same string, and trying to serve all of them from one field is what this
model replaces.

So a product carries up to three names, and so does each of its variants.

## The three names

| Name | Stored as | Who reads it |
| --- | --- | --- |
| **Name** | `products.name` — plain text, `not null` | Staff. The dashboard, the till's product buttons and basket, a table tab's line list, the sales reports, the image library's "what uses this photo" list |
| **Customer-facing name** | `products.customer_name` — a language map (JSON), nullable | Diners. The printed receipt and the printed allergen sheet |
| **Kitchen name** | `products.kitchen_name` — plain text, nullable | Cooks. The kitchen ticket and the kitchen display |

A variant is itself a `products` row whose `parent_id` names its parent, so it carries the same
three in the same three columns.

Two rules govern how those six fields become one displayed string, and both of them live in
`packages/catalogue/src/product-presentation.ts`. Nothing else re-implements either one, with one
exception named under _What a sold line freezes_ below.

**Each name falls back on its own.** A blank customer-facing name falls back to Name; a blank kitchen
name falls back to Name. They do not fall back to each other, and a product with a customer-facing
name but no kitchen name still prints its staff Name to the kitchen.

**A variant is named in full and shown under its own names alone** (spec
`docs/superpowers/specs/2026-09-18-one-product-model-design.md` §15.2). "Wine by the glass" has the
variants "Wine 125" and "Wine 175", and a line sold as Wine 125 reads `Wine 125` on the till, the
tab, the kitchen ticket, the kitchen screens, the receipt and the sales report. A variant's names
are never inherited: a blank customer or kitchen name falls back to the VARIANT's staff name, never
to the parent's. A line that names no variant renders exactly as it did before variants existed.

The three resolvers, one per audience:

- `staffPresentationName` — the variant's staff name, else the product's. Takes only the two staff
  names, so a caller holding a row with nothing else on it does not have to invent four empty fields.
- `customerPresentationText` — applies the blank-falls-back-to-Name rule to the customer-facing
  maps, and hands back the product's map and the variant's map still separate.
- `kitchenPresentationName` — the variant's kitchen name falling back to its staff name, else the
  product's kitchen name falling back to its staff name. Like `staffPresentationName` it takes no
  locale: a kitchen name carries no per-language text, so there is nothing to resolve against.

Turning the two frozen customer maps of a sold line into the one label a receipt prints is
`joinCustomerPresentationText`, which is separate because its callers are rendering something
already *sold* — see below.

## What a sold line freezes

A line freezes what it was sold as and never reads the catalogue again, so editing a product does not
rewrite yesterday's receipt. `working_order_lines` and `sale_lines` each carry:

- `name` — the product's staff name at add time; on a line sold as a variant, the PARENT's. On a
  line with no variant this is what the basket and a retrieved tab show after the product has been
  renamed or deleted; on a variant line they show `variant_name` instead.
- `descriptions` — the customer-facing text, already resolved through `customerPresentationText` and
  then narrowed to exactly the venue's invoice languages by `toInvoiceLineDescriptions`.
- `variant_name`, `variant_descriptions`, `variant_kitchen_name`, `kitchen_name` — the chosen
  variant's own three names (`variant_name` and `variant_kitchen_name` as the variant row holds
  them, `variant_descriptions` resolved and narrowed like `descriptions` above), plus the product's
  (the parent's) kitchen name. An invoice locale that neither its own text nor the default
  language's text resolves is filled with the variant's staff name, by
  `fillBlankLocalesWithStaffName` (`packages/catalogue/src/product-presentation.ts`), when the line
  is priced (`priceOrderLines`, `apps/server/src/working-order.ts`).
  Keeping both sets is what lets a report group variant lines under their parent.
- `option_snapshots` — the diner's answers to the options lists this dish offered, each one frozen
  as the list's three names and the chosen label's three names, and no ids at all
  (`OptionSnapshot`, `packages/shared/src/option-selection.ts`). So this column carries
  customer-facing text of its own, alongside the two `descriptions` columns above. An extras pick is
  not in here: it becomes its own priced child line, which carries the picked product's names in the
  columns above like any other line.

The open order's line names what it sells in `working_order_lines.product_id`: the chosen variant,
or the product itself when it has no Active variant — when rung up from a menu offer; the
bare-`productId` path does not check this. The filed `sale_lines` row keeps the frozen names and no
catalogue id at all (spec decision 11); neither table has a `variant_id` column.

Because both customer maps (`descriptions` and `variant_descriptions`) had their fallback applied
*before* being frozen, neither falls back again at render time, except that
`joinCustomerPresentationText` falls back to the variant's frozen staff name for a variant map with
no text at all. The kitchen names are frozen raw and fall back when drawn, through
`kitchenPresentationName`.

**An options answer is the exception to that, deliberately.** `buildLineExtras`
(`apps/server/src/modifier-selection.ts`) freezes the list's and the label's customer-facing map
exactly as the catalogue row holds it — `null` included — and widens each plain staff name into a
one-entry map under the venue's default content language. Nothing has fallen back by the time the
row is written, so the customer-to-staff fallback for an answer runs at RENDER time instead, in
`customerOptionSnapshotLabels` (`packages/catalogue/src/option-snapshot-labels.ts`): it takes the customer
map when `nonBlankTranslations` says that map holds text in some language and the staff map
otherwise, then resolves whichever it picked against the locale it was asked for. The kitchen half
does the same thing a function along, through `kitchenPresentationName`
(`optionSnapshotLabels`, same file).

That customer-to-staff step is the exception the top of this file points at — the one place the
rule is spelled out away from `product-presentation.ts`. A list and a label carry no variant, so
there is no whole `customerPresentationText` to call, only the same
`nonBlankTranslations(…) ?? <the staff name>` fold written out again. Checked by following every
use of `nonBlankTranslations` in the tree: the other callers use it to normalise a map on a write
path and none of them falls back to a staff name. The move `docs/backlog.md` asked for has happened.
These builders lived in `apps/server` until Task 12 (2026-09-21) and went into `packages/catalogue`
there, because the till had to show the same labels on its own settled ticket and a browser cannot
import from `apps/server`. A third builder for the till's own staff wording
(`staffOptionSnapshotLabels`) sits beside them, and the till reaches all three through
`apps/till/src/widgets/option-snapshot.ts`.

None of these columns enters the fiscal hash, and none of them is sent to AEAT either. A filed
Veri\*Factu record has no line list at all — the goods reach it only as the sale's total, its VAT
breakdown, and one `DescripcionOperacion` string for the whole sale. That string is the venue's
configured operation description, which `packages/fiscal-verifactu` offers as "Venta en
establecimiento" (`packages/fiscal-verifactu/src/slot.ts`): `packages/core/src/record-sale.ts` reads
it from `locations.operation_description` and hands it to the fiscal backend as
`descriptionOfOperation`, and `packages/fiscal-verifactu/src/backend.ts` files it. These columns are
presentation columns, like `unit_name`.

Where each one surfaces:

| Surface | Reads | Code |
| --- | --- | --- |
| Receipt line — the goods identification, art. 7.1.e | the variant's frozen customer map on a variant line, else the product's | `apps/server/src/receipt-lines.ts` |
| Receipt — one `<list>: <label>` line under the dish | each frozen answer's customer maps, falling back to its staff maps | `customerOptionSnapshotLabels`, `packages/catalogue/src/option-snapshot-labels.ts` |
| Kitchen ticket | the four frozen staff and kitchen names, plus each frozen answer's kitchen names falling back to its staff names | `apps/server/src/kitchen-print.ts` |
| Kitchen display and the expediter's pass | the same four names, through the same resolver | `listStationQueue` and `listExpoQueue`, `apps/server/src/working-order.ts` |
| Till buttons and basket | the staff names | `apps/till/src/widgets/product-name.ts` |
| A table tab's line list | the staff names, resolved server-side | `readTabLines`, `apps/server/src/working-order.ts` |
| Till screens showing an options ANSWER | the reader each one names at the call site — kitchen on the rail and the pass, customer on the settled ticket, staff in the basket and the tab drawer | `optionAnswers`, `apps/till/src/widgets/option-snapshot.ts` |
| Printed allergen sheet | the live product's customer-facing name | `apps/till/src/screens/till-allergen-screen.ts` |
| Top-sellers report | the product's frozen staff name, with each variant's own frozen staff name on a row nested under it | `packages/reporting/src/top-sellers.ts` |

Two of those rows are worth reading twice.

A cook sees the same name whether the order arrives on paper or on a screen: the ticket, the station
queue and the pass all resolve through `kitchenPresentationName`. What that resolver is *given*,
though, depends on how the line was added. A line added from a menu offer carries the product's and
the variant's kitchen names, so a venue that types a short kitchen name sees it on all three
surfaces, and one that leaves it blank sees the staff name — the variant's, on a variant line.

**A line added by bare `productId` carries neither.** That is the shape the till's three
line-carrying routes — `POST /api/sales`, `POST /api/pay` and `POST /api/working-orders` — fall back
to when the venue has no service zones configured (`resolveHttpOrderZone`,
`apps/server/src/till-api.ts`), and it resolves against the plain catalogue projection:
`AvailableProduct` (`packages/catalogue/src/operations.ts`) has no kitchen-name field at all. So
`apps/server/src/working-order.ts` freezes `kitchen_name` and `variant_kitchen_name` as `null`, and
the kitchen sees the staff name however the product is configured. The paragraph above is about
menu-offer lines; it does not hold for these, and nothing on this path closes the gap today.

The top-sellers report groups lines under the parent's staff name, `sale_lines.name`, ranks those
products by quantity sold (name breaks a tie), and lists
under each one a row per `sale_lines.variant_name` sold with it — so "Wine by the glass" shows its
total with "Wine 175" and "Wine 125" beneath. The product's own row counts every line under its
name, including any sold as the product itself with no variant, and the report's row limit counts
products, not variants. It is a staff-facing report, so it shows the names staff use, not the
wording a diner reads on a receipt.

## The translation gap report

`listContentTranslationGaps` (`packages/catalogue/src/content-languages.ts`) is what refuses to let
you switch your default content language while text is still missing. A product's and a variant's
customer-facing name is **optional** — absent, what is shown is the staff name
(`customerPresentationText`, `packages/catalogue/src/product-presentation.ts`) — so a wholly absent
one (`null` or `{}`) is never a gap. Only a partly filled one is: fill in Spanish and leave English
blank, and that is a gap, because you clearly meant to translate it and stopped. An options list's,
an options label's and an extras list's customer-facing name is optional in the same way and is left
out of the report for the same reason. Two of those three now reach a surface: an options list's and
an options label's customer-facing name are what the printed receipt puts under the dish
(`customerOptionSnapshotLabels`, `packages/catalogue/src/option-snapshot-labels.ts`), which is also where
the fallback to the staff name happens, so a missing one still is not a gap. An extras list's own
name reaches no order or receipt surface at all — a pick becomes its own line carrying the picked
PRODUCT's names, and nothing copies the list's name onto it. The other kinds the
query reports — `category`, `unit` and `section` — have no optional customer-facing name to fall
back from and stay required. An options list contributes two of the report's kinds and not one, both
of them in the optional group: the list's own name (`option_list`) and each of its labels
(`option_label`), each with its own table. An extras list contributes one kind, `extra_list`, and no
second one: each of its items names a product and carries no name of its own, so `extra_list_items`
holds no map for the report to read.

## Variants

The server accepts a product with any number of variants, one included (spec
`docs/superpowers/specs/2026-09-18-one-product-model-design.md` §15.1).
`product.variant_count_invalid` stays registered and nothing throws it.

The editor allows any number too, one included (`apps/dashboard/src/widgets/product-editor.ts`):

- **Add variant** opens the Add window for one variant, and saving that window adds one row.
  Cancelling it adds nothing.
- The price field stays on screen with variants. While at least one variant is Active its label
  reads "Base price per" and the unit (`editor.base_price_unit`), and a variant with no price of its
  own shows the base price as its hint, in its window and in its table row.
- Each row's menu offers **Open**, **Edit** and **Remove** (or **Restore**). **Open** goes to the
  variant's own page and is shown only for a saved variant; it is disabled, with a line saying to
  save first, while the product form has unsaved changes, because opening the page replaces the form.
- **Remove** marks a saved variant Inactive in the draft, and **Restore** marks it Active again; one
  that was never saved is simply dropped from the draft. The table's "Show variants" select filters
  rows by status and starts on Active; it switches to showing every row when a reported problem or a
  newly added unsaved variant would otherwise be hidden (`dashboard-variant-table`,
  `apps/dashboard/src/widgets/variant-table.ts`).

A variant has its own name (all three of them) and availability. Its tax rate, station, course,
image and allergen and dietary declarations are its parent's while it leaves them blank and its own
once it sets them (`effectiveProductColumns`, `packages/catalogue/src/variant-fallback.ts`); its
unit, and its categories with the reporting category among them, are its parent's while it stores
none of its own (`unitOwnerJoin`, `categoryOwnerJoin`, same file). Its extras and options lists are
always its parent's. On a menu it is charged the most specific price set (`resolveOfferPrice`,
`packages/catalogue/src/offer-price.ts`): that menu's price for the variant, else its own price,
else its parent's price on that menu, else its parent's own price. A menu may leave any product's
price blank (`menu_items.gross_price` is nullable), which means the product's own price; the menu
screen shows that price as the empty field's hint. A variant's own price may be blank, which sends
it down that chain to its parent's prices: the product-editor save accepts a blank one both in the
parent's variants list and on the variant's own page (`parseProductEditorInput`,
`packages/catalogue/src/product-editor-input.ts`), and `setProductVariants`
(`packages/catalogue/src/variants.ts`) stores it blank.

A variant also has its own product page: the product editor's routes read and save a variant's id.
The value it reads is the variant's own row, a field it leaves blank read blank, and its parent's
value for each of those fields in `inherited` — for allergens, the parent's published declaration
(the allergens staff set on it together with those its recipe derives, or no declaration at all
while nothing on the parent has been reviewed or its recipe has an unreviewed ingredient), since
that is what a blank reads as, while the variant's own allergens field holds only what staff set on
the variant. Saving a blank keeps the field inheriting, and saving a value overrides it for that
variant alone. A variant's body may leave its price, tax rate and dietary declarations blank, which
a product with no parent may not; it carries no variants and no extras or options lists of its own;
and its parent never changes, so a body naming a different `parentId` is refused
(`saveProductEditor`, `packages/catalogue/src/product-editor.ts`). A variant's published allergens
stay blank, and so read as its parent's, until it sets allergens of its own, and its published diet
likewise until it sets a diet override of its own; once set, each is computed over the parent's
recipe-derived values and recomputed when those change (`republishOverlays`,
`packages/catalogue/src/operations.ts`).

A variant is sold as the product it is. A product with an Active variant is never sold as itself
when rung up from a menu offer (`product.variant_required`); the bare-`productId` path does not
check this. On the till it is one button, and tapping it opens its variants with the first
available one chosen, each labelled with its difference from the parent's price ("+€1.50") where it
has one; a product none of whose variants is available here gets no button. The line's
`product_id` is the variant, and it is priced and taxed at the variant's effective values above. In
the kitchen it takes its parent's product-level preparation routes (a route can name only a
top-level product, so a variant has none of its own) and the category routes of its effective
category; its station, course, category, allergens and dietary labels are its effective values
(`effectiveProductColumns`; for category, the `categoryOwnerJoin` rule above;
`resolvePreparationRouteOutcomes`, `packages/venue-service/src/operations.ts`; `priceOrderLines`,
`fireLines` and `readQueueSubItems`, `apps/server/src/working-order.ts`). The till splits a tab
line by the unit precision the line froze (`TabLine.unitPrecision`), since a variant is not one of
the till's products.

A variant's own photo is `products.image` on its row. The image library lists it among a photo's
uses as a `variant` of its parent and refuses to delete a photo one still uses (`listImageUsages`
and `deleteImage` in `packages/media/src/images.ts`); a variant with no photo of its own shows its
parent's and holds no use of it.

`products.image` is protected by the database, variant rows included, but not by a real foreign
key: on PostgreSQL it was
`products_media_image_fk`, `REFERENCES media_images (filename) ON DELETE RESTRICT`, written by hand
into the media set's baseline; regenerating every migration set for the storage switch dropped it,
and `packages/media/drizzle/0001_image_references.sql` brings it back as **four triggers** instead —
one on insert, one on an update of `image`, one on deleting the parent image, one on renaming it.
That file's own header states what a trigger is not, and two of its points matter to anyone reading
this page: `pragma foreign_key_list('products')` does not list the rule, so nothing that enumerates
keys from the engine sees it; and the refusal arrives as errcode 1811
(`SQLITE_CONSTRAINT_TRIGGER`), not 787 (`SQLITE_CONSTRAINT_FOREIGNKEY`). Guard:
`packages/media/src/image-references.test.ts`, whose cases use top-level products. For a variant
row, measured 2026-09-23 with a throwaway suite over the core, catalogue and media migration sets:
inserting a variant naming a photo that does not exist, and deleting with raw SQL a photo a variant
uses, were each refused with errcode 1811 by `products_media_image_fk`, while a variant naming a
photo that exists was accepted.

## The editor form

`dashboard-product-editor` (`apps/dashboard/src/widgets/product-editor.ts`) is one short form. The
fields that change often are always visible; everything else is folded into a `wt-disclosure`
section that shows a one-line summary of what is inside it, so nothing filled in is invisible while
collapsed. Top to bottom: Name, Categories, Available, ▸ Kitchen, ▸ Descriptors, ▸ Nutritional info,
Price (and the variants table, if there are variants), Modifiers, then Cancel and Save. An Inactive
product's editor also opens with a line saying so, and offers Restore beside Save. Opened on a
variant, the same form is the variant's own page: it has no Modifiers or Variants section, and each
field the variant may leave blank to take the parent's value shows that value as its hint.

The form's Modifiers section is one ordered list mixing extras lists and options lists, reordered by
each row's handle — a pointer drag or the arrow keys (`reorder-table.ts`'s `handle`) — with each row
naming the list's plain STAFF name and which kind it is. It replaced the option-group
section, which went with the flat `modifierIds`/`optionGroupIds` body fields it wrote; what it sends
is the ordered `modifiers` list the write body carries (below).

Sections always start collapsed; open and closed state is not remembered. A section holding a
validation error opens itself and cannot be collapsed until the error is fixed — that is
`wt-disclosure`'s `has-error`, described in
[the design system](design-system.md).

Categories are chosen through the same `dashboard-category-membership-picker` the Categories screen
uses, opened in a `wt-modal` from any of the category lozenges. The editor no longer has category
controls of its own. See [Product categories](product-categories.md).

## One save, one transaction

**Station and course are saved with the product.** They used to be two save-on-change requests the
editor fired the moment you picked one — written immediately, outside the product's own Save, so
Cancel did not undo them, and only offered at all for a product that already existed (the events
carried `this.value!.id`). Now `applyRouting` runs inside the same transaction the product write
already opened (`apps/server/src/catalogue-api.ts`), so a station or course id the venue does not
have rolls the whole product back rather than leaving a half-saved routing behind, and a brand-new
product can be routed as you create it. The `wt-set-product-station` and `wt-set-product-course`
events are gone.

The product write body carries `name` (required, plain text), `customerName` (a language map or
`null`), `description`, `kitchenName`, `image`, the price and tax fields, `categoryIds`,
`primaryCategoryId`, `modifiers` (the ordered attachment list, each entry a `kind` of `extras` or
`options` and a list id — it replaced the flat `modifierIds` on 2026-09-19), the allergen and
dietary declarations, the two required state flags `active` and `available` (below), and `variants`
— each variant carrying `name`, `customerName`, `kitchenName`, `image`, `unitPrice`, `available` and
a required `active`, plus `id` when it already exists. Each variant's `active` is written as sent,
and a saved variant left out of the body is made Inactive (`setProductVariants`,
`packages/catalogue/src/variants.ts`). A customer-facing name whose every entry is blank parses to
`null`, so "I typed spaces" and "I left it empty" store identically.

A product has two states (spec §15.6). **Active / Inactive** is whether it exists for the venue:
Delete sends `active: false`, Restore sends `active: true`, and Delete removes no row.
**Available / Unavailable** is "sold out for now": the editor's Available switch sends `available`,
and it hides nothing in the dashboard. The till sells a product, or offers it as an extra, only when
it is both (`listMenuOffers`, `listAvailableProducts` and `readExtraProducts` in
`packages/catalogue/src`, and `resolveBasketModifiers` in `apps/server/src/working-order.ts`) —
except that a held order's line kept at or below its quantity is still billed although its dish or
an extra has since become Inactive or Unavailable; a raise is checked in `updateHeldOrder`.
`listMenuOffers` keeps an Unavailable product's offer only when its caller passes
`includeUnavailable`, as the menu management route and the venue readiness check do. A variant is
listed only under its parent's offer, only while Active, and as available only while Available and
offered on that menu.
