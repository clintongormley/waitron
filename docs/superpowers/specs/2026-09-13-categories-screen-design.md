# Categories screen: tree view, colours, product modal, cascading delete

Read [the categories design](2026-09-12-product-categories-design.md) first; this builds on the
screen and API it landed (#340). The developer guide for the API as it stands today is
[product-categories.md](../developers/product-categories.md). Where this document changes a rule
stated there, this document wins and the guide is updated in the same change.

## What the owner asked for (2026-09-13)

The Categories page at `/manage/categories` gets: a sortable, filterable table (filter by name);
a Tree/Flat mode with collapsible branches; a colour per category, picked from a palette or chosen
freely; a products modal per category with its own sortable, filterable table showing each
product's other categories as coloured lozenges; a delete confirmation that lists everything the
delete will change; "Primary" renamed to "Reporting category"; a round blue add button beside the
heading instead of the kebab menu; and an add-products form that is a checkbox table, not a picker.

## Decisions taken in the brainstorm (owner, 2026-09-13)

- **Deleting a category with products is allowed.** The products lose that membership. A product
  whose reporting category was the deleted one is left with **no reporting category**, even when it
  still has other memberships. This replaces the refusal that #340 built.
- **Child categories move up** to the deleted category's parent (or become top-level). **Kitchen
  preparation routes for the category are removed.** Both are listed in the confirmation first.
- **A product may have memberships and no reporting category, in general.** This follows from the
  first decision: the rule "a product with any categories has a reporting category" is retired
  everywhere, not only on the delete path. The first membership is still selected automatically as
  a convenience, and a reporting category can be cleared without choosing a replacement.
- **Lozenges are filled**, with black or white text chosen for contrast (option A in the visual
  session). The house's existing data-colour idiom (a neutral chip with the colour as a border and
  dot, used by the floor plan and service statuses) was shown and declined for this use: the pale
  swatches nearly vanish as a border in the light theme, and the dark ones in the dark theme.
- **The palette is eight hues in three tones**, 24 swatches, plus a custom colour. The owner saw
  the alternative (three published colour-blind-safe sets stacked: Okabe–Ito plus Paul Tol's muted
  and light schemes) and chose the hue grid for its regularity. **Stated plainly: the hue grid is
  not a published colour-blind-tested set.** Red/green and blue/violet neighbours are the classic
  confusions. This is acceptable because the lozenge always carries the category name; colour is
  never the only signal, which is also the design system's rule for meaning-carrying colour.
- **In the categories table the name is plain text**, preceded by a rounded colour square, not a
  lozenge. Row layout: chevron, image slot, colour square, name. Children indent.
- **Chevrons are large**, roughly the height of the image slot.
- **Every named item in the delete confirmation is a link**: products open the product editor,
  the child category opens its category editor, the route opens the kitchen routing view.

## Data and API

### Colour

`category_details` (catalogue-owned) gains `color text` — null for no colour, otherwise exactly
`#rrggbb` in lower case; the server validates the shape and rejects anything else with
`category.color_invalid` (new code in the catalogue registry). The public shape becomes
`Category { id, name, image, parentId, color: string | null }`, and create/update accept `color`.
One new catalogue migration adds the column. The existing table-level grant on `category_details`
covers a new column (`0005_category_grants.sql` grants the table, not a column list), so no grant
migration. Configuration transfer carries the column with the row it already carries. No backfill:
existing rows read as no colour.

### Reporting category becomes optional

Today four places enforce "categories present ⇒ reporting category present":
`replaceProductCategories` in `packages/catalogue/src/categories.ts` (throws
`category.membership_invalid` / `category.primary_required`), the product-editor input parser in
`packages/catalogue/src/product-editor-input.ts`, the product editor widget's validation in
`apps/dashboard/src/widgets/product-editor.ts`, and the category membership picker in
`apps/dashboard/src/widgets/category-membership-picker.ts`. All four are relaxed:

- The reporting category may be null with a non-empty membership set. It must still be a member
  of the set when present; duplicates, missing ids and foreign ids are still rejected.
- When the reporting category is omitted (not sent) on a replace: no memberships ⇒ null; a current
  reporting category that survives in the set is kept; otherwise, if there was none, the first
  submitted id is selected; if the current one was removed, the result is **null** (previously
  `category.primary_required`). That code stays registered and stops being thrown; codes are never
  renamed or deleted once shipped.
- The picker and the editor drop their "reporting category required" validation and offer a "None"
  choice.

Receipts that a missing reporting category is already safe downstream, read on the `categories`
branch head: kitchen routing in `packages/venue-service/src/operations.ts` matches category routes
with an always-false condition when the product's category is null; the sale path copies a nullable label
(`packages/core/src/record-sale.ts`, `sale-line-rows.ts`); the product read joins the category with
a left join (`packages/catalogue/src/operations.ts`). The implementer re-runs the products and
till e2e suites after relaxing the rule rather than trusting this paragraph.

### Delete cascades

`DELETE /management-api/categories/:id` now succeeds when the category has dependants. In one
transaction under the existing per-tenant category lock (`lockCategories`), in this order:

1. Delete the product memberships for the category.
2. Set `products.category_id = null` where it equals the category (the reporting category).
3. Reparent: `category_details.parent_id` of every direct child becomes the deleted category's own
   `parent_id`. A child is by definition a `category_details` row with `parent_id` set, so this is
   an update of existing rows and needs no insert path. (Categories created outside the catalogue
   may have no details row at all: `listCategories` left-joins for that reason. Such a category is
   nobody's child and has no parent, and a delete of it runs steps 1, 2, 4 and 5 unchanged.)
4. Delete `preparation_routes` rows whose `category_id` is the category, if that table exists.
5. Delete the category row.

Step 4 crosses a module boundary. The catalogue already reads `preparation_routes` by raw SQL
behind a `to_regclass` check because venue service is optional (`deleteCategory` today); the delete
follows the same precedent and the same guard, and says so in a comment. The alternative, a
"category dependants" seat on the module contract, is the cleaner shape and is noted in the backlog
rather than built here. The foreign key `preparation_routes_category_fk` has no `ON DELETE` clause,
so without step 4 the delete fails with a foreign-key error; the test suite proves step 4 by
deleting a routed category with venue service migrated, and proves the guard by deleting one
without it.

`category.in_use` stays registered and stops being thrown. The 409 mapping in
`apps/server/src/catalogue-api.ts` can stay.

> **Corrected 2026-09-14 (final review).** The 409 mapping did NOT stay. Once nothing throws the
> code, a status mapping for it is a route that cannot be reached, and it read as evidence that the
> server still refuses a delete — which is what the dashboard's own comment then claimed. The
> mapping is removed; the registry entry in `packages/catalogue/src/errors.ts` stays, as this
> paragraph says, because a shipped code is never removed.

### Delete preview

New read: `GET /management-api/categories/:id/dependants` →

```json
{
  "products": [{ "id": "…", "name": { "en": "Bacon roll" }, "reporting": true }],
  "children": [{ "id": "…", "name": { "en": "Eggs" } }],
  "parentId": "…",
  "routes": [{ "id": "…", "station": "Grill", "zone": null }]
}
```

`reporting` is true when the product's reporting category is this one. `parentId` is where the
children will go (null means top level). `routes` carries the station name from the core
`kitchen_stations` table and the zone name, or null for a route that applies to all zones; a route
marked "no preparation" reports `station: null`. Route rows come only when the route table exists.
Tenant-scoped like every other category read; a manager of another tenant gets `category.not_found`.

### Bulk add

New write: `POST /management-api/categories/:id/products` with `{ "productIds": [ … ] }`, returning
204. One transaction, one lock. For each product: add the membership if absent; if the product has
no reporting category, this category becomes it; otherwise it is left alone. Duplicate ids, unknown
ids and another tenant's ids are rejected as a whole with `category.membership_invalid`, nothing
partially applied. An id already in the category is not an error.

### Deep link into the product editor

The Catalogue page (`/manage/catalogue`, which hosts `dashboard-product-editor` as a modal) opens
the product named by `?product=<id>` on load, once, the way Categories already opens the category
named by `?category=<id>`. An unknown id is ignored. The delete modal's product links, the child
link (`/manage/categories?category=<id>` opening the editor rather than the products modal, see
below) and the route link (`/manage/venue-operations/view/routing`) navigate with the app's normal
client-side navigation and close the modal.

## Shared UI pieces

### `wt-lozenge`

A new primitive in `packages/ui`: `<wt-lozenge color="#dd9e5f">Breakfast</wt-lozenge>`. With a
colour it paints that background and sets the text to pure black or pure white, whichever
contrasts more. With no colour it renders the neutral outlined chip (`--wt-color-surface`
background, `--wt-color-border` border, `--wt-color-text`). Shape, padding and font read tokens.
The colour itself is data, applied as an inline style, which is the same exemption the floor
token's status badge already uses; the chrome around it reads tokens, so the no-hardcoded-chrome
guard still applies to the component file.

`readableTextColor(hex)` lives beside it and is exported. It implements the WCAG relative-luminance
formula and returns `#000000` or `#ffffff`. Receipt for "never needs refusing": black reaches
4.5:1 when the background's luminance L satisfies (L + 0.05) / 0.05 ≥ 4.5, i.e. L ≥ 0.175; white
reaches it when 1.05 / (L + 0.05) ≥ 4.5, i.e. L ≤ 0.183. The two ranges overlap, so every colour
passes with at least one. A test sweeps the RGB cube at a coarse step and asserts the chosen text
colour reaches 4.5:1 for every sample, plus the 24 palette entries exactly.

The two tests every new primitive needs: a token-painting test, and `wt-lozenge.a11y.test.ts`
covering coloured and uncoloured in both themes.

### The palette

`CATEGORY_PALETTE` is exported next to the helper: eight hues (red, orange, yellow, green, teal,
blue, violet, magenta) in three tones (dark, mid, pale), generated from HSL at 65% saturation and
42%, 62% and 80% lightness, pinned as literal hex values in the source so a formula change cannot
silently move a stored colour away from a swatch. The picker shows the grid plus "Custom" (the
browser's native colour input, as `service-status-screen` already uses) plus "No colour".

### Tree support in `wt-data-table`

The table gains an optional `rowParent: (row) => string | null` accessor (returns the parent's
row key). When set:

- Rows render nested: a row's children follow it, indented one step per level.
- A row with children gets a chevron toggle button in the first column, large (the tap-min token
  square), with `aria-expanded`; rows without children keep an empty slot of the same width so
  columns line up. All branches start open. Open/closed state is internal, keyed by row key, and
  survives re-renders of the same rows.
- Sorting orders siblings within each parent, using the same comparator as today, and never moves
  a row out from under its parent.
- The table uses the tree-grid pattern: `role="treegrid"`, `aria-level` on rows, `aria-expanded`
  on rows with children.
- A row whose parent is not in `rows` is treated as top-level. This is what lets the caller filter:
  it passes the matches plus their ancestors and the tree still renders.

Without `rowParent` nothing changes; the existing screens that use the table are unaffected and
their tests prove it.

### Round button

`wt-button` gains a boolean `round` attribute: a circle of `--wt-tap-min` diameter, content
centred, meant for a single icon with an `aria-label`. Variants and hover treatment unchanged. A
`plus` icon is registered in `apps/dashboard/src/icons.ts`.

## The Categories page

Heading `Categories` with the round primary-variant plus button immediately after it
(accessible name "Create category"). Below: a `Filter by name` input and a Tree/Flat toggle
(`wt-tabs` or two buttons with `aria-pressed`, implementer's choice, keyboard operable). The mode is
remembered per browser in `localStorage` under a namespaced key; the default is Tree.

The table:

| Column   | Tree mode                                                                   | Flat mode                     |
| -------- | --------------------------------------------------------------------------- | ----------------------------- |
| Name     | chevron, image slot, colour square, name link; children indented            | image slot, colour square, name link |
| Parent   | hidden (implied by nesting)                                                 | full path, sortable           |
| Products | direct count, sortable                                                      | same                          |
| Actions  | row menu: Edit, Delete                                                      | same                          |

The image slot is the existing thumbnail size and stays empty (same width) when the category has
no image, so squares and names line up down the column. The colour square is a small rounded
square filled with the colour; with no colour, an empty dashed square. The name link opens the
products modal.

> **Corrected 2026-09-13 (Task 18).** The "no colour" square shipped with a solid border, not the
> dashed one called for here: `apps/dashboard/src/screens/categories-screen.ts`'s `.swatch` rule is
> `border: 1px solid var(--wt-color-border)`, and `.swatch.none` only clears the background to
> transparent — it does not switch the border style to dashed. This line is left as the original
> design intent, not the shipped behaviour.
>
> **Follow-up 2026-09-14 (Task 19).** Those two rules kept their declarations but were renamed to
> `wt-data-table::part(swatch)` and `wt-data-table::part(swatch-none)`: as class selectors they had
> never reached the swatch at all, which is rendered inside `wt-data-table`'s shadow root, so no
> square of either kind appeared in the browser. The solid-versus-dashed point above is unaffected.

The filter matches the resolved name only (not the path), case-insensitive, in both modes. In tree
mode the matches' ancestors are included so each match is shown in place; ancestors that do not
match themselves are rendered in muted text.

The category form gains the colour picker described above, between the parent picker and the
image. Field-error key: `color`.

Strings: every "Primary" on this page and in `dashboard-category-membership-picker` becomes
"Reporting category" (Spanish: "Categoría de informes", matching the product editor's existing
term; the implementer greps `editor.reporting_category` for the exact Spanish already in use and
reuses it). The `?category=<id>` deep link now opens the **category editor** for that id (it used
to select the category and show its products below the table; that layout no longer exists).

## The modals

### Products modal

Opens from the name link. Heading "Breakfast · Products" (the category's resolved name). A `Filter by name` input, an
`Add products` primary button, and a table: Name, Reporting category (lozenge or "None"), Other
categories (lozenges, or a muted dash), Actions. All three data columns sort; the filter matches the
name. Row actions: `Edit` opens the existing membership picker for that product (as today), and
`Remove from this category` removes the membership through the existing replace call, clearing the
reporting category when it was this one (no replacement prompt any more). The rows come from the
already-loaded product list, as today.

### Add products

Pressing `Add products` swaps the modal's content (same `wt-modal`, so no nested dialog): a filter,
and a table of every product **not** already in this category with a leading checkbox column, Name,
Reporting category and Other categories (lozenges), sortable. A header checkbox selects all
currently visible rows. The footer reads `Cancel` and `Add N products` (disabled at zero). Save
calls the bulk route once; on success the modal returns to the products view and the page reloads
its data. A failed save shows the error in the modal and keeps the selection.

### Delete confirmation

Opens from the row menu. On open it fetches the dependants preview and shows a spinner until it
arrives; the Delete button is disabled until then. Then:

- "Remove it from N products", listing each product name as a link, with
  "· reporting category, will be cleared" beside those flagged.
- "Move N child categories under Food" (the parent's name, or "to the top level"), each a link.
- "Remove N kitchen routes", each written as "Breakfast → Grill (Terrace)" or
  "Breakfast → Grill (all zones)", as a link to the routing view; "no preparation" in place of the
  station for a route with that flag.
- Sections with zero items are omitted; a category with nothing at all shows only the name.

Following a link closes the modal and navigates. `Delete` (danger variant) calls the delete route;
on success the modal closes and the page reloads. A `category.not_found` on delete (someone else
deleted it) is shown as the ordinary error and the page reloads on close.

## Testing

Server, real PostgreSQL where privileges or the route table matter, PGlite otherwise, stating which
and why in each file:

- Colour: create/update with a valid colour, with `null`, with a bad shape (rejected with
  `category.color_invalid`); the column survives configuration transfer.
- Reporting category optional: replace with memberships and a null reporting category succeeds;
  omitted reporting category after removing the current one yields null; the product-editor input
  parser accepts null with memberships; a product with memberships and no reporting category
  sells and routes (existing till and routing suites re-run, plus one explicit case each).
- Delete cascade, as one transaction: memberships gone, reporting category cleared only on the
  affected products, children under the grandparent, routes gone; a failure in the last step (force
  it with a fake) leaves everything in place. With venue service **not** migrated the delete
  still succeeds and the route step is skipped. The existing two-connection race test for
  category authoring is extended to cover delete-versus-route-insert under the new behaviour.
- Preview: the flag is right, the children and parent are right, routes carry station and zone,
  another tenant's manager gets `category.not_found`.
- Bulk add: adds, sets the reporting category only where absent, ignores already-members, rejects
  a foreign id atomically, another tenant's manager gets `category.not_found`.

UI (browser mode, both themes for the a11y files):

- `wt-lozenge` token-painting and a11y tests; the contrast sweep test for `readableTextColor`.
- `wt-data-table` tree: nesting order, sibling-only sorting, collapse hides descendants and
  `aria-expanded` follows, orphan rows render top-level, flat callers unchanged.
- `wt-button` round: shape reads the tap-min token; a11y test with an icon and label.
- Categories screen: mode toggle persists; filter keeps ancestors; name link opens the products
  modal; the products modal sorts and filters; add-products selection and single save call;
  remove clears the reporting category; the delete modal renders the preview, disables Delete until
  loaded, and its links navigate; `?category=` opens the editor; every "Primary" string is gone.
- Catalogue screen: `?product=<id>` opens the editor once; an unknown id does nothing.

Guards to run after the schema change: `scripts/classification-complete.test.ts` (no new table, but
run it anyway), the catalogue package's grant assertions, and the root guard suite.

## Documentation

In the same change: `docs/developers/product-categories.md` (delete semantics, the optional
reporting category, the new routes, `color`), `docs/developers/design-system.md` (the lozenge, the
tree table, the round button, and the recorded exception that a data colour may be a filled
background when the text colour is computed and the label carries the meaning),
`docs/products.md` (its "Choose one of them as its Reporting Category" paragraph now says the
choice is optional and what a product without one records), and the backlog row for #340 (its
"deletion is refused" sentence becomes stale on merge).

## Acceptance

- The table sorts by every column in both modes; in tree mode a sort never moves a child from
  under its parent, and collapsing a branch hides its descendants.
- Filtering by name shows matches in place in tree mode and as a plain list in flat mode.
- A category can be given a palette colour, a custom colour, or no colour, and the square and the
  lozenges show it in both themes with readable text.
- Clicking a name shows its products in a modal with sortable, filterable columns and lozenges for
  the reporting category and the other categories.
- Adding products is a checkbox table that saves in one request; a product with no reporting
  category gets this one, one with a reporting category keeps it.
- Deleting a category with products, children and routes shows all three lists with links first,
  then performs all of it in one transaction; a product left without a reporting category still
  sells and routes.
- No "Primary" wording remains on the Categories page or in the membership picker.
- The add button is a round primary-colour plus beside the heading with an accessible name.
- Another tenant's manager cannot read the preview, delete, or bulk-add across tenants.

## Out of scope

- Showing category colours on the till, in menus or in reports (the colour is stored; consumers
  can follow).
- A per-column filter beyond name ("start filtering by name" was the brief).
- A "category dependants" seat on the module contract (noted in the backlog instead).
- Measuring the cost of the per-tenant category lock, still an open backlog item from #340.
