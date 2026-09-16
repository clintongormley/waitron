# Product editor rework

> **2026-09-14 — the tenant column is gone.** The tenant-id removal this document anticipates has
> landed: every `tenant_id` column, every tenant argument and the `withTenant` helper are gone
> (`withTransaction` replaces it), one database holds one taxpayer as the single row of `tenants`,
> and nothing filters by a tenant. Read every tenant-carrying signature, tenant predicate and
> "a by-id read scopes to the tenant" rule below as the shape at the time of writing. Spec:
> [drop-tenant-id](2026-09-14-drop-tenant-id-design.md).

Owner brainstorm, 2026-09-15. Supersedes the layout and the naming model in
[2026-09-12-product-editor-design.md](2026-09-12-product-editor-design.md); that spec's rules on
menus, variant pricing precedence, tax choice, allergens, dietary suitability and nested creation
still stand unless a line below says otherwise.

## Why

The product editor that landed in #345 is one long stack of cards. Everything a product can carry
is shown at once, translated names take one box per language at the very top, and a variant is a
block of loose fields with Up/Down buttons. The owner wants a short form: the fields that change
often always visible, the rest folded away with a summary line, a real variants table, and the
same drag-to-sort the modifier choices table already has.

Two lines of the request change the model, not just the layout: a product's **Name** is no longer
translated, and a variant gains its own kitchen name, customer-facing names and image.

## The three names

A product (and a variant) now has up to three names. Every screen picks one by this table:

| Surface                                                                                            | Shows                                                         |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Dashboard lists and editor, till product buttons and basket, sales reports                         | **Name** — plain text, staff-facing, required                 |
| Receipt lines, invoice line descriptions filed with AEAT, customer display, customer-facing menus | **Customer-facing name** in the customer's language; blank falls back to Name |
| Kitchen ticket and kitchen display                                                                 | **Kitchen name**; blank falls back to Name                    |

A variant's name is appended to the product's with " · " ("Coffee · Large"), and each of the
variant's three names falls back independently by the same rule: a variant with a customer-facing
name but no kitchen name prints "Café c/leche · Large" on the kitchen ticket. The resolvers in
`packages/catalogue/src/product-presentation.ts` carry this rule; nothing else re-implements it.

## Data model

Pre-production rule (CLAUDE.md §3): no compatibility code, drop and recreate. The migration replaces
columns; `wa-wt reset demo` rebuilds the shared dev database.

**`products`** (`packages/db/src/schema/catalogue.ts`):

- `descriptions` (jsonb, the translated name) is removed.
- `name text not null` — the staff-facing name.
- `customer_name jsonb null` — translations keyed by language; null or a blank entry means "same as
  Name".
- `description`, `kitchen_name`, `image`, `station_id`, `course_id` are unchanged.

**`product_variants`** (`packages/catalogue/src/schema/variants.ts`):

- `name` becomes `text not null` (staff-facing).
- New: `customer_name jsonb null`, `kitchen_name text null`, `image text null` (the same
  path-reference shape as `products.image`, and the same media-reference rule: a real database
  reference, so the library refuses to delete a picture a variant still uses).
- A variant still shares the product's unit, tax rate, categories, modifiers, allergen and dietary
  declarations. No per-variant unit.

**Sale snapshots** (`working_order_lines`, `sale_lines`). A line freezes what it was sold as and never
reads the catalogue again. Today it carries `descriptions` (customer-facing text in exactly the
venue's invoice languages), `variant_name` (jsonb) and `kitchen_name`. Now:

- `descriptions` stays, filled at add time from the customer-facing name with fallback to Name
  through `toInvoiceLineDescriptions`.
- `name text not null` — the product's staff name at add time, so the basket and the sales report
  can show it after the product is edited or gone.
- `variant_name` becomes `text null` (the variant's staff name); `variant_descriptions jsonb null`
  carries the variant's customer-facing text per invoice language; `variant_kitchen_name text null`.
- `kitchen_name` stays as the product's kitchen name.

None of these is in the fiscal hash; they are presentation columns like `unit_name`. The
trigger that checks `descriptions` holds exactly the invoice languages applies to
`variant_descriptions` too when it is not null.

**Translation-gap report** (`listContentTranslationGaps` in
`packages/catalogue/src/content-languages.ts`). A missing customer-facing name is not a gap — it
falls back. A product or variant is a gap for language X only when its customer-facing name has a
non-blank entry in some language and none in X. Description follows the same rule.

**API and clients.** Product read and write bodies carry `name: string`,
`customerName: LocalizedText | null`; a variant carries `name`, `customerName`, `kitchenName`,
`image`. The till's product payload drops `descriptions` for `name` plus `customerName`. Seeds,
fixtures and `configuration-transfer.ts` follow.

**Server-side rules:**

- A product has either no variants or at least two. The write refuses exactly one with a new code
  in `packages/catalogue/src/errors.ts`, named by the domain concept in the shape its siblings use
  (grep them first). This is what stops an API caller bypassing the editor's "Regular" rule.
- Station and course are saved in the product write. The product route already opens one
  transaction for the product, its variants and memberships; it calls the venue-operations
  module's existing routing write inside that same transaction. If any part is rejected, nothing is
  written. The two save-on-change events (`wt-set-product-station`, `wt-set-product-course`) and
  their routes' use from the editor are removed.

**Sequencing.** The pending tenant-id removal (`2026-09-14-drop-tenant-id-design.md`, plan not yet
written) touches these tables. This branch leaves `tenant_id` alone; whichever lands second
rebases.

## The editor

Order, top to bottom. "▸" is a collapsed section.

1. **Name** — one plain text field, required.
2. **Categories** — the chosen categories as lozenges (`wt-lozenge`, coloured as on the Categories
   screen), the reporting category drawn filled and the others outlined, plus a "+" lozenge.
   Clicking any of them opens the categories modal.
3. **Available** — switch.
4. ▸ **Kitchen** — kitchen name, station, course. Summary: the three values, e.g. "Café c/leche ·
   Bar · Drinks". Station and course are offered for a new product too, now that they save with it.
5. ▸ **Descriptors** — customer-facing name (one field per enabled language), customer-facing
   description (one per language), image. Summary names what is set: "customer name (es, en) ·
   image".
6. ▸ **Nutritional info** — the allergen picker and the dietary picker as they are today. Summary:
   the selected allergens and dietary labels.
7. **Price** — the VAT rate dropdown first, then either the single price field with its "@ unit"
   button (no variants) or the variants table (two or more), then **Add variant**.
8. **Modifiers** — the attached modifiers as a table with a drag handle and a ⋯ row menu (Edit,
   Remove), then **Add modifier**.
9. Cancel / Save.

**Collapsed sections** are always collapsed when the editor opens and show a summary of their
contents in the header, so nothing filled in is invisible. Open/closed state is not remembered. A
section holding a field with a validation error opens itself and focus goes to that field.

**Price and unit.** The price field shows the amount with a trailing "@ each" button. Clicking the
button swaps it for the existing unit dropdown, which still carries *Add unit*; choosing a unit
turns it back into the button. With variants, the unit button sits in the table's price column
header and applies to every variant.

**Variants.** The table has columns Name · Price @ unit · Available · ⋯. Rows drag by the handle at
the start, or move with the up and down arrow keys while the handle is focused, exactly as the
modifier choices table does (`reorder.ts` and the handle code in `modifier-form.ts` are shared, not
copied). A polite live region announces "Large moved to position 2 of 3" after a keyboard move;
the same shared table code gives the modifier choices table that announcement, closing the gap the
backlog records for #352. The Available switch is live in the row. ⋯ offers Edit and Remove.

The **"Regular" rule** lives in the editor's draft: the first *Add variant* on a product with a
plain price turns that price into a variant named with the translated default "Regular" (editable
like any name) and opens the window for the new one; removing variants down to one folds its price
back into the plain price field and deletes the variant row. The draft never holds exactly one
variant.

**Add / Edit variant** is a small window over the editor, one flat list: Name (required), Price
(required; the unit is shown but not editable), Available, Kitchen name, Customer-facing name (one
per language), Image. Its Add/Save changes only the product draft; nothing is written until the
product's own Save. Validation happens on Add/Save and a failed one keeps the window and its draft.
While it is open the editor's Save and Enter are suspended, as for every nested window.

**Categories modal** is the existing `dashboard-category-membership-picker` (the Categories
screen's picker: a multi-select combobox, the chosen categories as lozenges, a reporting-category
dropdown, Save/Cancel) inside a `wt-modal`. Save updates the draft's memberships; Cancel discards.

**Modifiers.** *Add modifier* opens a picker: a `wt-combobox` over the modifiers not yet attached,
with a *Create new…* entry that opens the existing modifier form nested, as nested creation works
today (durable on its own save; returns the new modifier attached). *Edit* on a row opens the same
modifier form nested for that modifier. *Remove* detaches the modifier from this product only; the
definition is untouched. The Modifiers screen remains the only place a modifier is deleted.

## Pieces and who owns what

| Piece                        | Where                                    | Owns                                                                                                                                                                   |
| ---------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wt-disclosure`              | `packages/ui/src/components` (new)       | A collapsible section: heading, optional summary, `open`, a `<button aria-expanded>` header, a `has-error` input that forces it open. Two mandatory tests (token painting, a11y in both themes for open/closed/error) and a `design-system.md` entry. |
| `wt-price-input`             | `packages/ui/src/components` (new)       | A money field with a trailing unit button. Events: `wt-change` `{ value }`, `wt-unit-click`. Same two mandatory tests.                                                |
| `dashboard-variant-table`    | `apps/dashboard/src/widgets` (new)       | The table, drag and keyboard reorder, the live region, the row menu. Takes the draft's variants and emits `wt-reorder`, `wt-edit`, `wt-remove`, `wt-toggle-available`. |
| `dashboard-variant-form`     | `apps/dashboard/src/widgets` (new)       | The Add/Edit variant window. Emits `wt-submit { value }` / `wt-cancel`.                                                                                                |
| shared reorder table code    | `apps/dashboard/src/widgets`             | The handle, pointer drag, arrow-key move and live region, extracted from `modifier-form.ts` so both tables use one implementation.                                     |
| `dashboard-product-editor`   | existing, slimmed                        | The draft, field order, summaries, validation, Save/Cancel, and opening the modals above.                                                                              |

Custom events follow the house rule: `wt-*`, `detail`, `bubbles: true, composed: true`, and the
triggering event is stopped before re-emitting.

## Validation and errors

In the editor, then again on the server:

- Name required. Every price a valid money amount. VAT rate and unit chosen. Every variant has a
  name and a valid price. A reporting category, if set, is one of the chosen categories.
- Customer-facing name and description may be blank in any language; a translation for a language
  the venue no longer enables is rejected by the server as today.
- The server refuses exactly one variant (above).

The error summary at the top lists every problem as it does now. A collapsed section with an error
opens; focus goes to the first bad field. A rejected product save keeps the editor open with its
errors; a successful save followed by a failed list refresh closes the editor and reports a load
error outside it (the existing rule).

## Testing

- `wt-disclosure` and `wt-price-input`: token-painting test, `*.a11y.test.ts` in both themes, and
  behaviour tests for open/close, summary, `has-error` opening the section (proven by deleting the
  behaviour and watching the test fail), the unit button's event.
- Variant table: reorder by drag and by arrow keys, the live region's text read after a key press;
  the "Regular" conversion in both directions; Edit and Remove; the Available switch.
- Product editor: field order and summaries; the categories modal round-trip; modifier attach,
  create, edit, remove and reorder; station and course saved with the product; a collapsed
  section opening on error.
- Catalogue and server (real PostgreSQL where a transaction is the thing under test): the routing
  write rolls back with the product when one variant is rejected; the single-variant refusal; the
  three-name resolution for till, receipt and kitchen ticket with **different** text in every slot
  so a wrong fallback shows; the translation-gap rule; snapshot columns frozen and unchanged by a
  later product edit; a variant's image counted as a media reference.
- Both screens opened and looked at in both themes and at phone width before finish-branch.

## Out of scope

Per-variant units; deleting a modifier definition from inside the product; remembering
open/closed state; the tenant-id removal.
