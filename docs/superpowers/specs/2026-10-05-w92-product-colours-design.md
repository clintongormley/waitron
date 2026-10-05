# W92 — One product colour everywhere, inherited from reporting categories (design)

Status: design, 2026-10-05, amended the same day after the plan review. Branch
`feat/product-colours`, rebased onto `main` c2b886e99, which holds W72e (#1241, f556de968: the
Products tree's category name box keeps its refusal in view at 390 px). Its own PR, before W93. W88
(the Structure tree this item adds swatches to) landed as #1209, so there is nothing left to
coordinate with it beyond building on its tree.

## The owner's item

> W92. Give products one colour everywhere, with reporting-category inheritance.
> - Add an optional colour to reporting categories and an optional explicit colour to products. A
>   product's effective colour is its own explicit colour, otherwise its main reporting category's
>   colour (or the nearest coloured ancestor if its category is uncoloured), otherwise a neutral
>   default. A variant inherits its parent product's effective colour unless the product model
>   explicitly supports a variant override as a separate decision. A product has one effective
>   colour wherever it appears; no colour is stored on a menu placement or on the Price overrides
>   page.
> - Replace category Rename with Edit in the Products tree. Its edit UI includes the existing shared
>   colour chooser, reachable from a visible colour swatch beside the category. Product details
>   gains the same chooser and a clear "Use category colour" reset. Product swatches in Menu
>   Structure and the Device Home Page area may open that same global product-colour editor in
>   context, with copy explaining that the change affects every menu using the product. Editing a
>   menu section uses its existing optional section colour for that section's tile only; it does
>   not recolour products inside it. Show an Edit action and colour swatch for menu sections as well.
> - Trace category, product and section colour through schema, catalogue reads and writes,
>   media-independent tile presentation, published menu documents, preview and till consumers.
>   Follow current publication rules: a global colour edit appears in draft previews and in each
>   affected live menu after that menu is published. Do not add compatibility code for
>   pre-production data; document a development-venue reset if schema changes require one. Add a
>   dated superseding pointer to the approved 2026-09-30 catalogue design's "no category colour"
>   decision rather than silently rewriting its history.
> - Test-first for category inheritance, explicit product override and reset, a product repeated
>   across sections/menus, nested categories, sections retaining their own colour, variants,
>   draft-versus-live colour, and readable tile labels in both themes. Inspect the
>   category/product/section editor and tile swatches at desktop and phone widths. Update
>   `docs/developers/products.md`, `docs/developers/design-system.md` and `docs/backlog.md` in the
>   PR. Own PR before W93; coordinate with W88 where Menu Structure editing overlaps.

## Questions for the owner (work carries on; none blocks the build)

1. **Add category still names a new category inline**, with no colour; its colour is then set from
   the swatch or Edit. The item replaces Rename only. Should Add category open the same dialog
   instead? (Not done here: it would replace the inline create flow, which the item does not ask.)
2. **Deleted or reshaped test checks** (the plan's "Changed test checks" table): the inline rename
   box goes, so the checks pinning it are rewritten against the Edit dialog; three concurrency checks
   that used a rename box beside a create box are rewritten to use two create boxes; and W72e's
   five phone-width checks that open a rename box (`apps/dashboard/src/widgets/product-list.test.ts`,
   from `:1521`) move to the box for a new category, which keeps W72e's fit, with the same
   assertions. No check is deleted outright and none is under `scripts/`. One check in another
   package changes meaning: `packages/media/src/image-references.test.ts:116` pins
   "category_details has no image or colour column", the 2026-09-30 decision this item reverses; it
   keeps the "no image column, no image trigger" half and expects the colour column.
3. **The Home page tab's tile preview stays uncoloured in W92.** The item says a global colour edit
   appears in draft previews. In W92 it shows in the Preview tab's change list ("colour" against
   each product it changes) and on the till once the menu is published, but not on the Home page
   tab's tiles (`apps/dashboard/src/widgets/home-layout-editor.ts`): a `HomeTile` carries no colour
   (`packages/catalogue/src/section-types.ts:34-43`), and W93, the next item, replaces that tab with
   the Device Home Page. Default: leave the tile preview to W93. Say if it should be coloured here
   instead.

## Decisions

1. **Storage.** `category_details.color` (catalogue set; the parent already lives there,
   `packages/catalogue/src/schema/categories.ts:4-24`) and `products.color` (core set,
   `packages/db/src/schema/catalogue.ts:33`), both nullable text through the vocabulary's `label`,
   as `sections.color` is (`packages/catalogue/src/schema/sections.ts:39`). No CHECK: a CHECK makes
   drizzle rebuild the table (`packages/db/src/schema/catalogue.ts:76-80` says so for `products`,
   whose children a rebuild deletes or refuses). Validation lives in code, lowercase `#rrggbb`, as
   the section's does (`packages/catalogue/src/sections.ts:72-74`, `:86-90`). Measured 2026-10-05
   in this worktree, drizzle-kit 0.31.11, Node v26.7.0: with `color: label("color")` added to both
   tables, `drizzle-kit generate` wrote exactly ``ALTER TABLE `products` ADD `color` text;`` (core
   `0100`) and ``ALTER TABLE `category_details` ADD `color` text;`` (catalogue `0025`), no rebuild;
   with those two files present `scripts/migration-upgrade.test.ts`,
   `scripts/migrations-match-schema.test.ts` and `scripts/schema-constraints.test.ts` passed
   (23 tests). The probe was then reverted; the plan regenerates for real and reads the SQL again.
2. **The rule, in one pure function.** `effectiveColor(own, categoryId, categories)` in a new
   import-free file `packages/catalogue/src/color-inheritance.ts`: the own colour, else the first
   colour met walking from the main category up its parents, else null. The walk stops at a missing
   category and is bounded by the tree's size, as `classifyLine` bounds its walk
   (`packages/catalogue/src/sale-classification.ts:55-63`), because a loop can exist in stored data
   (`apps/server/src/report-api.categories.test.ts:223` writes one). The server's document builder
   and the dashboard both call it, so the rule has one implementation; the dashboard already
   deep-imports browser-safe catalogue files (five non-test files under `apps/dashboard/src`
   import `@waitron/catalogue/src/modifier-limits.js`). `null` is the neutral default in data;
   each consumer draws its existing neutral look for it. The same file holds `isStoredColor`, which
   `sections.ts` then uses in place of its private `isHexColor`.
3. **Variants have no colour of their own.** `color` joins `effectiveProductColumns` as a
   parent-always field, like `categoryId` (`packages/catalogue/src/variant-fallback.ts:78-83`,
   `:105`), so a variant reads its parent's whatever it stores, and `blankInherited`
   (`packages/catalogue/src/variants.ts:55-58`) writes it null on every variant write. The editor
   parser refuses a variant body with a non-null `color` as `product.invalid` with
   `field: "color"`, the code it already uses for a variant naming a category
   (`packages/catalogue/src/product-editor-input.ts:148-150`). Setting a colour by product id goes
   through `setProductColor`, which, like `setMainReportingCategory`, finds top-level products only,
   so a variant's id answers `product.not_found` (`packages/catalogue/src/categories.ts:142-151`).
   Its effective colour is its parent's: the published offer carries one colour, and its frozen
   variants carry none. No variant is drawn as a tile today (the till offers them as choices in the
   modifier picker).
4. **Writes.** Categories: `CategoryInput` gains `color?: string | null`; create and the PATCH route
   take it (`apps/server/src/catalogue-api.ts:142-151`, `:1156-1162`); a value that is not a string
   or null answers `management.request_invalid` `{ field: "color" }`, and a string that is not
   lowercase `#rrggbb` answers `category.invalid` `{ field: "color" }` (its params type widens from
   `"name"`). Products: the editor body takes `color`, absent or null meaning none, as `image` and
   `kitchenName` are (the body is a complete replacement); the editor parser refuses a value that is
   not lowercase `#rrggbb`, `""` included, as `product.invalid` `{ field: "color" }`, as categories
   and sections refuse `""`; and the product PATCH
   (`apps/server/src/catalogue-api.ts:1392`) takes `color` for the Menu Structure dialog; both reach
   `setProductColor`, which refuses a bad value `product.invalid` `{ field: "color" }`. Reads:
   `Category` and `CategorySummary` gain `color`; `Product` (`listProducts`), `ProductEditorInput` and
   so `ProductEditorValue` gain the product's own `color`.
5. **Published document.** Effective colour is resolved when a document is built: one batched read
   of every offered product's own colour and main category, one read of the category tree, then the
   pure rule (`readEffectiveColors`, no per-product query). `FrozenOffer` and `LiveOffer` gain an
   OPTIONAL `color?: string | null` beside `image` and `description`, which they already add to
   `MenuOffer` (`packages/catalogue/src/menu-document-types.ts:35-46`, `:118-123`). Optional
   because a version published before W92 holds none and is never rewritten: the same reason
   `ordering` is optional there (`PublishedOrdering`, `:31-33`). `MENU_DOCUMENT_FORMAT` stays 2
   (`packages/catalogue/src/menu-document.ts:37`): `readLiveDocuments` serves only a version in the
   current format (`packages/catalogue/src/menu-publication.ts:159`), so raising it would stop every
   menu published before W92 from selling until it was published again, as a version in the earlier
   format is not served today (`packages/catalogue/src/menu-publication.test.ts:470`). `freezeOffer`
   (`packages/catalogue/src/menu-document.ts:302-326`) sets it; `applyLiveFields` spreads the frozen
   offer (`:507-512`), so colour is never live. `ProductChangeField` gains `"color"`, compared on the
   dish alone, as `description` is (`:723`). So a product or category colour edit changes the working
   document of every menu holding an affected product, reads as a shared-product change, "colour",
   in each menu's preview with the other published menus in `alsoOn`, and reaches a till only when
   that menu is published. `ZoneMenuOffer` (`packages/module/src/module.ts:98-146`) is left alone: it
   carries no `image` either, and the till reads offers as `LiveOffer`
   (`apps/till/src/api/client.ts:363`).
6. **Sections keep their own colour, for their own tile.** Unchanged in storage and document
   (`menu-document.ts:198`); nothing applies it to the products inside.
7. **Till.** `menuOfferToTillProduct` (`apps/till/src/api/client.ts:405`) copies `color`;
   `TillProduct.color` is optional, absent on a retrieved held line as the other offer-only fields
   are, and absent for an offer from a version published before W92, as `ordering` is
   (`apps/till/src/api/client.ts:247-249`, `:412`). A product tile and a section tile
   (`apps/till/src/widgets/menu-browser.ts:327-347`) whose
   colour passes `isHexColor` paint it as the button's background with `readableTextColor`'s black
   or white as every label's colour, through two local custom properties set on the tile, as the
   grid already sets `--columns` (`:314`). The muted price, "Section" and "Sold out" labels
   (`:160-164`) take the tile's ink on a painted tile, or they would fall below contrast. A tile
   whose colour is absent, null or not a hex colour draws today's neutral look. The painted rule sets
   only the background, border colour and text colour; `wt-button`'s own feedback is opacity alone
   (a hover dip, `packages/ui-core/src/components/wt-button.ts:52-54`, and the disabled fade,
   `:44-46`), and it draws no pressed state of its own, so a painted tile should keep its hover dip
   and a sold-out painted tile its fade and its "Sold out" label (pinned in the plan's Task 4). The check also keeps a
   stored value out of a style attribute unless it is a colour. Product and section tiles stay told
   apart by the section icon and "Section" label, not colour. This is design-system.md's
   user-chosen data colour exception (`docs/developers/design-system.md:188-197`).
8. **Dashboard.**
   - **Products tree.** The category row's Rename becomes Edit (`action.edit`), opening a new
     `dashboard-category-details-form` dialog (`category-details-form.ts`, named as
     `dashboard-section-details-form` is): Name (required) and `colorField`. A swatch button beside the
     category name opens the same dialog. Save sends `{ name, color }` and never `parentId`, so a
     move made meanwhile is kept (today's rename sends the name alone for that reason,
     `apps/dashboard/src/widgets/catalogue-browser.test.ts:1015`). The inline name box stays for
     Add category; only its rename use goes (`CategoryNameDraft`'s `rename` kind,
     `apps/dashboard/src/widgets/product-list.ts:55-56`). W72e's fit at phone width
     (`#fitNameBox`, `:646-663`) stays, serving the box for a new category; the swatch makes a
     category row's name cell wider, so W72e's phone-width checks run again after it lands, and the
     Edit dialog's Name refusal is checked in view at 390 px.
   - **Product editor.** A colour group after the name and photo (`renderName`,
     `apps/dashboard/src/widgets/product-editor.ts:1021-1049`) on a product with no parent. Its "no
     colour" choice reads "Use category colour" and shows the colour that would then apply, worked
     out from the draft's category (so it follows an unsaved category change), or says the category
     has none. That sentence, "Its category has no colour.", is the choice's own second line, inside
     the button and read as its description, never a line under the field: design-system.md → Forms
     says "A field's hint is its placeholder, not a line under it" (`docs/developers/design-system.md:1394`).
     A variant's editor shows no colour group. `colorField` gains two optional settings,
     the no-colour label and the inherited colour; the section form passes neither and is unchanged.
   - **Menu Structure.** Each product row gets a swatch of its effective colour; on an editable row
     it opens `dashboard-product-color-form`, which edits the product's global colour and says
     "Changes this product's colour on every menu that uses it." Each section row gets a swatch of
     its own colour that opens the existing section form, which already has Edit in the row's menu
     (`apps/dashboard/src/widgets/menu-structure-table.ts:677-679`). On a read-only row (inside an
     included menu) both swatches are shown and are not buttons.
   - **Live refresh.** The menu status and preview reads gain `categories` and `category_details`,
     whose comment says today a category change moves neither answer
     (`apps/dashboard/src/api/live-queries.ts:182-187`); after this item it does.
   - **Not changed:** the Home page tab's named layouts (`home-layout-editor.ts`), including its
     tile preview, which stays uncoloured (Question 3). W93 replaces that tab with the Device Home
     Page; the item says swatches there "may" open the editor, so that part waits for the area to
     exist. In W92 a colour edit shows in the Preview tab's change list and on the till. The Price
     overrides tab stores no colour.
9. **Forms and dialogs** follow design-system.md → Forms: required Name marked, a refusal beside its
   field, one message at the end of the dialog body, every input a semantic `name`
   (`category-name`, `category-color`, `product-color`). Both new dialogs use `size="standard"`, the
   W70 size the section form uses, so the 24-swatch palette lays out as in that form. A refused colour
   is shown under the chooser with the sentence the product editor already gives a refused field,
   `editor.field_rejected` (`apps/dashboard/src/screens/catalogue-screen.ts:537-548`); the chooser
   only produces valid values, so only another caller reaches it.

## Data flow

Category or product colour saved → `category_details.color` / `products.color` → dashboard reads
(`listCategories`, `listProducts`, the editor) → dashboard swatches and previews via
`effectiveColor` → `buildMenuDocuments` resolves each offer's effective colour → the working hash
changes for every menu holding an affected product → preview lists "colour", status "changed" →
publish freezes it into `menu_versions.document` → `listZoneOffers` serves it → till tile paints it.
A section's colour follows its existing path: `sections.color` → document section member → till
section tile.

## Migration, reset and upgrade

- Two added nullable columns, no rebuild (measured above), so a development venue migrates in place;
  the plan's schema task re-runs the upgrade guard before this is claimed.
- A configuration bundle exported before W92 is refused on import: its core and catalogue migration
  counts are one short, and the import compares each module's count first
  (`apps/server/src/configuration-transfer.ts:365`). Export again after upgrading.
- A version published before W92 holds no `color`, and the working document holds a `color` on
  every offer (null when nothing is coloured), so every published menu with an offer reads
  "changed", listing "colour" for each product, until it is published again (`menuStatus` compares hashes; `canonicalJson` drops an
  undefined key but keeps a null, `menu-document.ts:329-337`). Nothing rewrites old versions, and
  such a version is still served, because the format stays 2; its offers reach the till with no
  colour and draw neutral. Pinned by the plan's Task 3 case "a live version published before W92
  holds no colour" (`menu-publication.test.ts`: status `changed`, `["color"]` for its offers, the
  served offer has no `color`) and Task 4's cases for an offer with no `color` key (`client.test.ts`,
  `menu-browser.test.ts`). The PR's first line says: republish every menu after upgrading.
- Products are transferred with `select *` and imported against the target's columns
  (`apps/server/src/configuration-transfer.ts:228`, `:421`), so both new columns travel with no
  descriptor change; the plan adds a round-trip test.

## Out of scope

A variant colour override; colour on a menu placement or the Price overrides tab; the Device Home
Page and the till's Colours/Thumbnails choice (W93); colour on the Home page tab's tile preview
(Question 3; W93 replaces the tab); colours in reports, receipts or kitchen tickets; seeding demo
colours.

## Tests (test-first; each clause of the item names its test)

| Item clause | Test |
| --- | --- |
| category inheritance | `color-inheritance.test.ts`: own wins; main category's colour; null when nothing in the chain is coloured; a missing category and a loop each end at null |
| nested categories | same file: an uncoloured category under an uncoloured one under a coloured one gives the top one's; `menu-document.test.ts`: an offer in a grandchild category carries the coloured grandparent's |
| explicit product override and reset | `product-editor.test.ts` (catalogue): saving `#256bb1` reads back and the document carries it; saving null reads null and the document carries the category's; `catalogue-api.test.ts`: PATCH `{ color }` then `{ color: null }`; dashboard `product-editor.test.ts`: "Use category colour" sends null and shows the category's colour |
| product repeated across sections/menus | `menu-document.test.ts`: Lemonade in two lists of Lunch and in Dinner has one offer per menu, each the same colour; `menu-publication.test.ts`: one product colour edit marks both published menus changed, each listing it with the other in `alsoOn` |
| sections retaining their own colour | `menu-document.test.ts`: a red section holding a blue product, and holding an uncoloured one, keeps red on the section and blue / null on the offers; till `menu-browser.test.ts`: a product tile inside a coloured section paints its own colour or none |
| variants | `product-editor-input.test.ts`: a variant body with a colour is refused `product.invalid` `color` (and any body with `""` or `"#B12525"`); `variant-fallback.test.ts`: `color` is parent-always; `categories.db.test.ts` (or `operations.test.ts`): `setProductColor` on a variant id answers `product.not_found`; `menu-document.test.ts`: frozen variants carry no `color` |
| draft-versus-live colour | `menu-publication.test.ts`: after publish, a category colour edit makes status "changed" and the preview list "colour", the served offer (`applyLiveFields`) keeps the old colour, and after publishing again it carries the new one; a live version published before W92 (no `color` in its offers) is `changed`, lists `["color"]` and is served with no colour |
| readable tile labels in both themes | till `menu-browser.test.ts`: on a dark (`#256bb1`) and a pale (`#edabab`) tile every label computes the readable colour, a null or absent colour keeps the neutral look, and a painted tile keeps `wt-button`'s hover dip and sold-out fade; `menu-browser.a11y.test.ts`: axe in light and dark with coloured product and section tiles |

Also: `categories.test.ts` (colour stored, patched alone, refused when malformed); the category
dialog and the swatches (dashboard, browser mode, both themes in the `*.a11y.test.ts` files);
`live-queries.test.ts` (status and preview refresh on a category change); a configuration transfer
round trip carrying both colours.

## Docs in the PR

`docs/developers/products.md` (one colour per product and how it is chosen, and that a variant reads
its parent's, under _What a variant reads from its parent_), `docs/developers/design-system.md` (the
data-colour exception now has users: swatches and till tiles), `docs/developers/product-categories.md`
(a category has an optional colour; the Edit dialog; storage), a dated superseding pointer in
`docs/superpowers/specs/2026-09-30-catalogue-menus-routing-design.md` at its "no colour" lines (25, 51,
514), and a DONE entry in `docs/backlog.md`.
