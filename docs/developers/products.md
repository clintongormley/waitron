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
tab, the kitchen ticket, the kitchen screens, the receipt and the sales report, where it sits nested
under its product (a screen reader hears the product's name first: "Wine by the glass, Wine 125").
A variant's names are never inherited: a blank customer or kitchen name falls back to the VARIANT's
staff name, never to the parent's. A line that names no variant renders exactly as it did before
variants existed.

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

A line freezes its names and its gross price when it is added and never reads them from the
catalogue again, so editing a product does not rewrite yesterday's receipt. The one exception is the
VAT rate of a line not yet invoiced, below. `working_order_lines` and `sale_lines` each carry:

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
or the product itself when it has no Active variant. The filed `sale_lines` row keeps the frozen
names, and records the same product in its own `product_id` and a variant's parent in
`parent_product_id`, as plain values with no foreign key, so no catalogue edit reaches a filed line
(sales classification spec §3). Neither table has a `variant_id` column.

**An open order's line takes its VAT rate from the catalogue again when the invoice is issued.** A
held order, a tab or an invoice-first order keeps each line's gross price as it was added, but the
pass that issues the invoice record resolves each line's VAT rate from its product's current VAT
class — a variant with no class of its own reads its parent's, and an extras line reads its picked
product's — so the customer pays the same gross and only the VAT split follows the rate in force
(`priceStoredOrderForIssuance`, `apps/server/src/working-order.ts`; menus spec
`2026-09-20-menus-categories-and-home-layouts-design.md` §11.4). The filed `sale_lines` row carries
the resolved rate. That pass also writes the rate and the net `unit_price` back onto
`working_order_lines` while the order is still open; an order issued while placed (a ticket-then-pay
collect) keeps its stored rate there, because `working_order_lines_require_open_parent_update`
refuses an update of a line whose order is not open. A reprint or a replay rebuilds its lines from the stored
lines at their stored rates and never resolves again (`priceStoredOrder`, same file).

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
queue and the pass all resolve through `kitchenPresentationName`. Every line is added from a zone's
menu offer, which carries the product's and the variant's kitchen names (`priceOrderLines`,
`apps/server/src/working-order.ts`), so a venue that types a short kitchen name sees it on all three
surfaces, and one that leaves it blank sees the staff name — the variant's, on a variant line. A
venue with no service zone sells nothing: sent lines with no zone, the till's three line-carrying
routes, `POST /api/sales`, `POST /api/pay` and `POST /api/working-orders`, take the venue's
counter-default zone, and refuse `service_zone.default_missing` when it has none
(`resolveHttpOrderZone`, `apps/server/src/till-api.ts`).

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
PRODUCT's names, and nothing copies the list's name onto it. A library section's customer names
(`sections.names`, kind `library_section`) are optional too, and only a partly filled map is
reported. Only library sections are read: a menu's own lists in `sections` are left out. The other
kinds the query reports — `category` and `unit` —
have no optional customer-facing name to fall back from and stay required. An options list contributes two of the report's kinds and not one, both
of them in the optional group: the list's own name (`option_list`) and each of its labels
(`option_label`), each with its own table. An extras list contributes one kind, `extra_list`, and no
second one: each of its items names a product and carries no name of its own, so `extra_list_items`
holds no map for the report to read.

## Variants

A variant is a `products` row whose `parent_id` names its parent product — "Wine 125" and
"Wine 175" under "Wine by the glass". There is no separate variant table. A variant's parent is a
top-level product in the same catalogue, is fixed when the variant is created, and a variant has no
variants of its own (spec `docs/superpowers/specs/2026-09-18-one-product-model-design.md` §15; the
one-level rule is the core migration `packages/db/drizzle/0004_variant_one_level.sql`). A product
may have any number of variants, one included (§15.1); `product.variant_count_invalid` stays
registered and nothing throws it.

### What a variant reads from its parent

**Every field a variant leaves blank reads its parent's, except its three names.** Among them its
tax rate, station, course, description, image, pricing unit and allergen and dietary declarations
are its parent's while its own column is blank and its own once it sets them
(`effectiveProductColumns`, whose keys are `INHERITED_KEYS`,
`packages/catalogue/src/variant-fallback.ts`), and so is its main reporting category. Its unit is
its parent's while it stores none of its own (`unitOwnerJoin`, same file). Its labels, and its
extras and options lists, are always its parent's (`labelOwnerJoin`, same file, for the labels). Its Name, customer-facing name and kitchen name are never inherited: a blank customer or
kitchen name falls back to the variant's own staff name (_The three names_, above).

A variant's published allergens stay blank, and so read as its parent's, until it sets allergens of
its own, and its published diet likewise until it sets a diet override of its own; once set, each is
computed over the parent's recipe-derived values and recomputed when those change
(`republishOverlays`, `packages/catalogue/src/operations.ts`).

### Price

A variant's own price may be blank. On a menu it is charged the most specific price that is set
(`resolveOfferPrice`, `packages/catalogue/src/offer-price.ts`):

1. that menu's price for the variant (`menu_item_variant_overrides.price`);
2. else the variant's own price (`products.unit_price` on its row);
3. else its parent's price on that menu (`menu_items.gross_price`);
4. else its parent's own price.

A menu may leave any product's price blank (`menu_items.gross_price` is nullable), which means the
product's own price, and the menu screen shows that price as the empty field's hint. The
product-editor save accepts a blank variant price both in the parent's variants list and on the
variant's own page (`parseProductEditorInput`, `packages/catalogue/src/product-editor-input.ts`),
and `setProductVariants` (`packages/catalogue/src/variants.ts`) stores it blank.

A variant follows its parent onto every menu the parent is on; it never gets a `menu_items` row of
its own (`addProductToMenu` refuses one with `menu_item.variant_not_allowed`, and a section refuses
one as a member with `menu_section.membership_invalid`). A menu stores something
for a variant only to override its price or switch it off there: a `menu_item_variant_overrides`
row exists only while it does one of those, keyed by the parent's menu row and the variant
(`setMenuVariants`, `packages/catalogue/src/variants.ts`).

### Active and Available

A variant has the same two states as a product (spec §15.6; _One save, one transaction_ below).
Removing a variant makes it Inactive and keeps its row; a saved variant left out of a product save
is made Inactive too (`setProductVariants`). An Inactive variant is on no menu offer. An Active one
is listed under its parent's offer, and marked available only while it is Available and that menu
has not switched it off (`readOfferVariants` in `listMenuOffers`, `packages/catalogue/src/operations.ts`).
The offer read the till sells from leaves out a parent that is Inactive or Unavailable, and its
variants with it.

### On the till

Every Active, Available, top-level product on a menu gets a button, whether or not it is marked as
sold alone (`listMenuOffers`). A variant never has a button: it is listed only nested under its
parent's offer (`MenuOffer.variants`). The till reads its offers from the zone
(`GET /api/default-service-zone/offers`, `GET /api/service-zones/:zoneId/offers`).

Tapping a parent sold in whole units, and not tied to a scale, opens the picker at once
(`#pick`, `apps/till/src/widgets/product-grid.ts`). A parent sold by weight or in fractions, or
tied to a scale, asks for its quantity on the keypad first and then opens the same picker (`#addWeight`,
`apps/till/src/widgets/tender-pay.ts`). The picker lists the variants in the one variant order,
`products.variant_order`, set by the product editor (`setProductVariants` writes the order the
variants were sent in). The first available one is chosen to start with; an unavailable one stays
listed, drawn disabled; each is labelled with its difference from the parent's price on that menu
("+€1.50") where it has one (`till-modifier-picker`, `apps/till/src/widgets/modifier-picker.ts`;
the difference is worked out in `apps/till/src/api/client.ts`). A product none of whose variants is
available on that menu gets no button (`product-grid.ts`). An extras list does not offer a product
that has an Active variant (`readExtraProducts`, `packages/catalogue/src/offered-modifiers.ts`),
since the order path refuses one picked as an extra (below). The catalogue refuses both ways of
putting one there: an extras list naming such a product (`extras.product_has_variants`), and an
Active variant on a product an extras list offers (`product.offered_as_extra`, which names the
lists). A variant itself may be an extra.

### The sale line

**A product with an Active variant, Available or not, is never sold as itself** (spec §15.1): a
line that rings it up without naming a variant is refused `product.variant_required`, and so is an
extras pick of it. Every sale line names a zone's menu offer, and `selectMenuVariant`
(`packages/catalogue/src/variants.ts`) refuses a dish line that names no variant. An extras pick
cannot name a variant, so `priceOrderLines` (`apps/server/src/working-order.ts`) refuses a pick of
such a product; a pick of a variant itself sells. That refusal comes from one read for the whole
basket's picks (`parentsWithActiveVariants`, `packages/catalogue/src/variants.ts`). A product whose
variants are all Inactive sells as itself.

On the server, an edit of a held order keeps each stored line it names, at its stored price —
including one whose product, or one of whose extras, has since gained an Active variant — and
prices only what the edit adds (menus plan D10; `updateHeldOrder`,
`apps/server/src/working-order.ts`). Lowering or keeping such a line's quantity is allowed; raising
it is refused `product.variant_required`, as a raise of a line whose product has become Inactive or
Unavailable is refused. Paying a held order bills its stored lines at their stored prices, with
each line's VAT rate resolved again, as _What a sold line freezes_ says; a line not yet sent, dish
or extra, whose product is now Inactive or Unavailable is refused `product.unavailable`, while a
sent one is billed whatever its product's availability (`priceStoredOrderForIssuance`, same file;
a card payment already captured is filed as it stands). On the till, retrieving the order keeps
such an extra in the basket, marked "Not offered now" and counted in the total, as it keeps a
sold-out one, because the list the pick was taken from no longer offers it (`deriveExtraSelections`,
`apps/till/src/state/held-extras.ts`) and paying with no edit still bills it: an unedited retrieved
basket sends no update (`#syncIfDirty`, `apps/till/src/till-app.ts`). The till never sends such a
pick, so the first edit takes it off the basket, and the server removes that extra from the line
and keeps the rest at their stored prices.

A line sold as a variant has the variant as its `product_id`. It is priced and taxed at the
variant's effective values above, and freezes the parent's names beside the variant's own
(_What a sold line freezes_, above), so reports can group it under its parent. The filed
`sale_lines` row names the variant and its parent only as plain values, never as keys. In the kitchen it takes its parent's product-level
preparation routes (a route can name only a top-level product, so a variant has none of its own)
and the category routes of its effective category; its station, course, category, allergens and
dietary labels are its effective values (`effectiveProductColumns`; `resolvePreparationRouteOutcomes`,
`packages/venue-service/src/operations.ts`; `priceOrderLines`, `fireLines` and `readQueueSubItems`,
`apps/server/src/working-order.ts`). The till splits a tab line by the unit precision the line
froze (`TabLine.unitPrecision`), since a variant is not one of the till's products.

### In the product editor

The editor allows any number of variants, one included (`apps/dashboard/src/widgets/product-editor.ts`):

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
(`saveProductEditor`, `packages/catalogue/src/product-editor.ts`).

### Photos

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
photo that exists was accepted. That header also has a paragraph about `product_variants.image`: it
was written while that table still existed, and the table has since been dropped
(`packages/catalogue/drizzle/0004_drop_product_variants.sql`). The file is left as it shipped: a
box's boot check compares the hash of each migration the database recorded with the image's files,
and reports an edited file as a migration the image does not have (the case "reports an EDITED
migration, whose hash changed although the count did not", `packages/provisioning/src/schema-ahead.test.ts`).

## The editor form

`dashboard-product-editor` (`apps/dashboard/src/widgets/product-editor.ts`) is one short form. The
fields that change often are always visible; everything else is folded into a `wt-disclosure`
section that shows a one-line summary of what is inside it, so nothing filled in is invisible while
collapsed. Top to bottom: Name, Category and labels, Available, ▸ Kitchen, ▸ Descriptors,
▸ Nutritional info, Price (and the variants table, if there are variants), Modifiers, then Cancel and
Save. An Inactive product's editor also opens with a line saying so, and offers Restore beside
Save. Opened on a variant, the same form is the variant's own page: it has no Modifiers or Variants
section, and each field the variant may leave blank to take the parent's value shows that value as
its hint.

The form's Modifiers section is one ordered list mixing extras lists and options lists, reordered by
each row's handle — a pointer drag or the arrow keys (`reorder-table.ts`'s `handle`) — with each row
naming the list's plain STAFF name and which kind it is. It replaced the option-group
section, which went with the flat `modifierIds`/`optionGroupIds` body fields it wrote; what it sends
is the ordered `modifiers` list the write body carries (below).

Sections always start collapsed; open and closed state is not remembered. A section holding a
validation error opens itself and cannot be collapsed until the error is fixed — that is
`wt-disclosure`'s `has-error`, described in
[the design system](design-system.md).

The main category and the labels are chosen in the editor itself, through the two field templates
in `apps/dashboard/src/widgets/classification-fields.ts`: a single-choice main-category picker and a
labels picker. The Categories screen uses the same main-category picker when it moves a product. A
variant shows its parent's main category as "Same as …" and its parent's labels as a note, because
it carries no labels of its own. See [Product categories](product-categories.md).

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
`null`), `description`, `kitchenName`, `image`, the price and tax fields, `primaryCategoryId` (the
main reporting category), `labelIds`, `modifiers` (the ordered attachment list, each entry a `kind` of `extras` or
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
it is both (`listMenuOffers` and `readExtraProducts` in
`packages/catalogue/src`, and `resolveBasketModifiers` in `apps/server/src/working-order.ts`) —
except that an edit of a held order may keep a line at or below its quantity although its dish or
an extra has since become Inactive or Unavailable (a raise is checked in `updateHeldOrder`, and a
change to the note, options or extras of a line the kitchen already has is refused
`product.unavailable` too, because the changed line is sent to the kitchen again — `applyLineEdits`),
and paying bills such a line only once it has been sent; unsent, it is refused `product.unavailable`
(`priceStoredOrderForIssuance`).
`listMenuOffers` keeps an Unavailable product's offer only when its caller passes
`includeUnavailable`, as the menu management route and the venue readiness check do. A variant is
listed only under its parent's offer, only while Active, and as available only while Available and
offered on that menu.
