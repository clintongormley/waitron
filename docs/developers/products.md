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

A variant carries the same three, in `product_variants.name` (also `not null`),
`product_variants.customer_name` and `product_variants.kitchen_name`.

Two rules govern how those six fields become one displayed string, and both of them live in
`packages/catalogue/src/product-presentation.ts`. Nothing else re-implements either one, with one
exception named under _What a sold line freezes_ below.

**Each name falls back on its own.** A blank customer-facing name falls back to Name; a blank kitchen
name falls back to Name. They do not fall back to each other, and a product with a customer-facing
name but no kitchen name still prints its staff Name to the kitchen. The same is true of the
variant's three fields, independently of the product's — which is the part that surprises people. A
variant that has a customer-facing name but no kitchen name, on a product that has both, sends
`Café con leche · Large` to the kitchen: the product half resolved its kitchen name, the variant half
fell back to its staff name.

**The variant's name is appended to the product's with `" · "`.** "Coffee" plus the variant "Large"
is `Coffee · Large`. A line that names no variant renders exactly as it would have before variants
existed — same bytes, no trailing separator.

The three resolvers, one per audience:

- `staffPresentationName` — the staff join. Takes only the two staff names, so a caller holding a
  row with nothing else on it does not have to invent four empty fields.
- `customerPresentationText` — applies the blank-falls-back-to-Name rule to the customer-facing
  maps, and hands back the product's map and the variant's map still separate.
- `kitchenPresentationName` — the kitchen name with its fallback, joined. Like
  `staffPresentationName` it takes no locale: a kitchen name carries no per-language text, so there
  is nothing to resolve against.

Joining two already-resolved customer maps into one is `joinCustomerPresentationText`, which is
separate because its callers are rendering something already *sold* — see below.

## What a sold line freezes

A line freezes what it was sold as and never reads the catalogue again, so editing a product does not
rewrite yesterday's receipt. `working_order_lines` and `sale_lines` each carry:

- `name` — the product's staff name at add time. This is what the basket and a retrieved tab show
  after the product has been renamed or deleted.
- `descriptions` — the customer-facing text, already resolved through `customerPresentationText` and
  then narrowed to exactly the venue's invoice languages by `toInvoiceLineDescriptions`.
- `variant_name`, `variant_descriptions`, `variant_kitchen_name`, `kitchen_name` — the same four
  facts for the chosen variant, plus the product's kitchen name.
- `option_snapshots` — the diner's answers to the options lists this dish offered, each one frozen
  as the list's three names and the chosen label's three names, and no ids at all
  (`OptionSnapshot`, `packages/shared/src/option-selection.ts`). So this column carries
  customer-facing text of its own, alongside the two `descriptions` columns above. An extras pick is
  not in here: it becomes its own priced child line, which carries the picked product's names in the
  columns above like any other line.

Because both halves had their fallback applied *before* being frozen, nothing falls back again at
render time. `joinCustomerPresentationText` only joins.

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
| Receipt line — the goods identification, art. 7.1.e | the two frozen customer maps, joined | `apps/server/src/receipt-lines.ts` |
| Receipt — one `<list>: <label>` line under the dish | each frozen answer's customer maps, falling back to its staff maps | `customerOptionSnapshotLabels`, `packages/catalogue/src/option-snapshot-labels.ts` |
| Kitchen ticket | the four frozen staff and kitchen names, plus each frozen answer's kitchen names falling back to its staff names | `apps/server/src/kitchen-print.ts` |
| Kitchen display and the expediter's pass | the same four names, through the same resolver | `listStationQueue` and `listExpoQueue`, `apps/server/src/working-order.ts` |
| Till buttons and basket | the staff names | `apps/till/src/widgets/product-name.ts` |
| A table tab's line list | the staff names, joined server-side | `readTabLines`, `apps/server/src/working-order.ts` |
| Till screens showing an options ANSWER | the reader each one names at the call site — kitchen on the rail and the pass, customer on the settled ticket, staff in the basket and the tab drawer | `optionAnswers`, `apps/till/src/widgets/option-snapshot.ts` |
| Printed allergen sheet | the live product's customer-facing name | `apps/till/src/screens/till-allergen-screen.ts` |
| Top-sellers report | the frozen staff names, joined | `packages/reporting/src/top-sellers.ts` |

Two of those rows are worth reading twice.

A cook sees the same name whether the order arrives on paper or on a screen: the ticket, the station
queue and the pass all resolve through `kitchenPresentationName`. What that resolver is *given*,
though, depends on how the line was added. A line added from a menu offer carries the product's and
the variant's kitchen names, so a venue that types a short kitchen name sees it on all three
surfaces, and one that leaves it blank sees the staff name.

**A line added by bare `productId` carries neither.** That is the shape the till's three
line-carrying routes — `POST /api/sales`, `POST /api/pay` and `POST /api/working-orders` — fall back
to when the venue has no service zones configured (`resolveHttpOrderZone`,
`apps/server/src/till-api.ts`), and it resolves against the plain catalogue projection:
`AvailableProduct` (`packages/catalogue/src/operations.ts`) has no kitchen-name field at all. So
`apps/server/src/working-order.ts` freezes `kitchen_name` and `variant_kitchen_name` as `null`, and
the kitchen sees the staff name however the product is configured. The paragraph above is about
menu-offer lines; it does not hold for these, and nothing on this path closes the gap today.

The top-sellers report groups on the staff names — `sale_lines.name` and `sale_lines.variant_name` —
and returns them through `staffPresentationName`. It is a staff-facing report, so it shows the name
staff use, not the wording a diner reads on a receipt.

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

A product has **no variants, or at least two**. Exactly one is refused with
`product.variant_count_invalid` (`minimum: 2`), thrown by `parseProductEditorInput`
(`packages/catalogue/src/product-editor-input.ts`) — on the server, so an API caller cannot get to a
state the editor will not let a person reach.

The editor keeps that rule with a fold, in its own draft:

- Pressing **Add variant** on a product with a plain price turns that price into a variant named with
  the translated default "Regular", and opens the Add window for the *second* one. So the first Add
  always produces two, never one.
- The plain price is validated before the fold, while its field is still on screen. Once the price
  has become a variant the field is gone, and a bad value would have nowhere left to be corrected.
- Cancelling that first Add folds the lone "Regular" back into the plain price, which is what makes
  Cancel a true undo.
- Removing variants down to one folds that one's price back into the plain price field and drops the
  row.

A variant shares the product's unit, tax rate, categories, modifiers and allergen and dietary
declarations. It has its own name (all three of them), price, availability and image.

The image library refuses to delete a photo a variant still uses, and lists the variant among the
uses it shows you — `listImageUsages` and `deleteImage` in `packages/media/src/images.ts` both cover
`product_variants.image`. **That protection is application-level only**, and the contrast with
`products.image` is narrower than it used to be.

`products.image` is protected by the database and `product_variants.image` is not. But
`products.image` no longer carries a real foreign key: on PostgreSQL it was
`products_media_image_fk`, `REFERENCES media_images (filename) ON DELETE RESTRICT`, written by hand
into the media set's baseline; regenerating every migration set for the storage switch dropped it,
and `packages/media/drizzle/0001_image_references.sql` brings it back as **four triggers** instead —
one on insert, one on an update of `image`, one on deleting the parent image, one on renaming it.
That file's own header states what a trigger is not, and two of its points matter to anyone reading
this page: `pragma foreign_key_list('products')` does not list the rule, so nothing that enumerates
keys from the engine sees it; and the refusal arrives as errcode 1811
(`SQLITE_CONSTRAINT_TRIGGER`), not 787 (`SQLITE_CONSTRAINT_FOREIGNKEY`). Guard:
`packages/media/src/image-references.test.ts`.

`product_variants.image` has no rule at all — neither a key nor a trigger. It is a plain label
column declared in the TypeScript schema (`packages/catalogue/src/schema/variants.ts`), which says
so at the column, and the image-references migration says in as many words that leaving it
unguarded is deliberate: it carried no key on PostgreSQL either, so guarding it now would be a new
rule rather than a restoration. So a delete that does not go through `deleteImage` is not stopped by
the database.

## The editor form

`dashboard-product-editor` (`apps/dashboard/src/widgets/product-editor.ts`) is one short form. The
fields that change often are always visible; everything else is folded into a `wt-disclosure`
section that shows a one-line summary of what is inside it, so nothing filled in is invisible while
collapsed. Top to bottom: Name, Categories, Available, ▸ Kitchen, ▸ Descriptors, ▸ Nutritional info,
Price (and the variants table, if there are variants), Modifiers, then Cancel and Save.

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
dietary declarations, and `variants` — each
variant carrying `name`, `customerName`, `kitchenName`, `image`, `unitPrice` and `available`, plus
`id` when it already exists. A customer-facing name whose every entry is blank parses to `null`, so
"I typed spaces" and "I left it empty" store identically.
