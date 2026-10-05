# W90 — Remove the menu-specific offered switch (design)

Status: design, 2026-10-05. Branch `feat/menus-remove-offered`, off `main` 746f75fae. Its own PR,
before W89.

## STOP — owner confirmation needed before the land (work continues meanwhile)

Under the owner's 2026-10-05 test rule (lane B queue, "a test check may change when the item's spec
changes what it checks"), a guard under `scripts/` and a deleted check are controversial. This item
needs both:

1. **`scripts/migration-upgrade.test.ts` needs one new `RESETS` entry.** Measured below: the new
   migration cannot carry a variant-override row whose price is blank, and this test writes exactly
   such a row (it leaves a nullable column null wherever the CHECK allows). Adding a step to `RESETS`
   is the guard's own extension point (#1164, #1170 and #1174 each added one), but it is still an
   edit to a `scripts/` guard.
2. **`scripts/menu-sections-upgrade.test.ts` needs `offered` taken out of one insert and one
   `select`** (lines 116–122 and 194–196). Its check that the sections rebuild carried the override
   row keeps `menu_item_id` and `price: 275`; it can no longer name a column that no longer exists.
3. **Some checks are deleted because what they check no longer exists** (the "Changed test checks"
   table in the plan marks each one `DELETE`). Each is listed so the owner can confirm.

No golden huella, `inmutabilidad` or fiscal filing test changes (the plan's classification read
every hit; `served-at-huella.test.ts` and `split-bill.fiscal.test.ts` use other meanings of the
word). Four checks in sale suites that assert money totals change only HOW a dish or variant is made
unsellable (removed from the structure, or made Unavailable, instead of switched off); every amount
they assert stays the value it is today. They are marked **money** in the plan's table.
`scripts/schema-constraints.test.ts` stays unedited because the design keeps the CHECK's name
(below).

## What goes

A menu's own on/off for a product and for a variant, and everything that only served it:

- Columns `menu_items.offered` (`packages/catalogue/src/schema/menu.ts:80`) and
  `menu_item_variant_overrides.offered` (`schema/variant-overrides.ts:15`).
- Wire and type fields: `MenuItem.offered`, `MenuVariant.offered`, `MenuVariantWrite.offered`,
  `MenuPriceRow.offered`, `MenuOfferVariant.offered` and `ownOffered`
  (`packages/catalogue/src/menu-types.ts:29`, `:76`–`77`, `:96`–`99`, `:118`); `CombinedOffer.offered`
  and `CombinedOffer.variants[].offered`, `CombineInput.own.offered`, and `"offered"` as a
  `MenuClash.field` (`menu-combine-types.ts:16`, `:20`, `:29`–`30`, `:38`); `ZoneMenuOffer.offered`,
  `ZoneMenuOfferVariant.offered` and `ownOffered` (`packages/module/src/module.ts:95`, `:271`–`272`).
- The `includeSwitchedOff` option and the filter it bypasses (`operations.ts:454`, `:520`–`522`,
  `:687`–`689`, and its callers `:580`, `:704`, `:708`, `menu-document.ts:126`).
- The PATCH body key `offered` on `/management-api/catalogues/:id/items/:itemId` and the entry key
  `offered` on `PUT …/variants` (`apps/server/src/catalogue-api.ts:305`–`324`, `:954`–`966`).
- Dashboard: the "On this menu" column, the "Sold on this menu" and per-variant "Offered on this
  menu" pickers in the edit window, the "Sell it" / "Switch it off" clash buttons, the switched-off
  count in the price summary (`apps/dashboard/src/widgets/menu-prices-table.ts:279`–`283`,
  `:298`–`302`, `:313`, `:352`–`356`, `:389`–`404`, `:453`–`470`, `:509`–`514`, `:694`–`710`,
  `:795`–`814`, `:824`–`853`, `:899`, `:928`, `:1012`–`1023`); the offered branch of the Preview's
  clash list (`apps/dashboard/src/widgets/menu-preview.ts:579`–`594`); `offered` in
  `updateMenuItem`'s input (`apps/dashboard/src/api/client.ts:1871`).
- Strings, English and Spanish (`apps/dashboard/src/i18n/strings.ts`): `menu_prices.sell_it`,
  `switch_it_off`, `follow_offered`, `sources_disagree`, `sold`, `on_menu`, `sold_here`,
  `switched_off`, `offered`, `not_offered`, `no_variant_offered`, `active`, `variant_offered`
  (English `:1907`–`1911`, `:1935`–`1942`, `:1952`, `:1956`; Spanish `:4072`–`4076`, `:4100`–`4107`,
  `:4117`, `:4121`). Each is
  deleted only if a grep after the change finds no other reader (`sources_disagree` is also read by
  the Preview's offered branch, which goes too).

## What stays, unchanged

- **Price overrides and their inheritance.** `menu_items.gross_price`, the variant override's
  `price`, `resolveOfferPrice`, and the price half of `combineOffer` (`menu-combine.ts:34`–`101`,
  all but the `offered` settings at `:49`–`55` and `:83`–`92`) are untouched.
- **Price clashes between included menus**, and the publish refusal `menu.clashes_unresolved`.
- **Active and Available.** A product or variant is sold only while `active && available`
  (`sellable`, `menu-document.ts:417`), applied when a published document is served
  (`applyLiveFields`, `menu-document.ts:502`) and refused at pricing (`priceOrderLines`,
  `apps/server/src/working-order.ts`). Inactive at publish leaves a product out of the document;
  `listMenuOffers` keeps an Unavailable product's offer.
- **Published-menu behaviour**: what a till sells is the live published version; edits reach tills
  only when the menu is published again.
- `menu_item.variant_not_allowed`, `product.offered_as_extra`, and every other meaning of
  "offered": a list's `offeredModifiers`, extras "Not offered now" in the till, shift swaps. None is
  touched.

## The rule after W90

A product is **on a menu** when that menu's working structure places it — in the menu's own
sections, or inside a menu it includes — and the product is Active (and the menu, and any included
menu it comes through, is active: `offerRowsOn`, `operations.ts:523`, and `offersOn`,
`:620`–`631`). It is **sellable now** when it is also Available. A variant is listed under its
parent's offer while it is Active, and is sellable while it is Available; a menu cannot hide it. An included menu's
products stay read-only within the parent: the parent can override their price, and removes one
only by changing the included menu's structure or not including it.

So `listMenuOffers` returns every reached offer (no switched-off filter), `MenuOfferVariant.available`
is the variant's own Available, and the document's `onMenu` filter (`menu-document.ts:169`) keeps
every offer `offersOn` returned.

## Variant override rows

A row exists only while it overrides the variant's price on that menu. `setMenuVariants`
(`variants.ts:316`–`374`) stores an entry with a price, deletes the row of an entry with a null
price, and no longer reads the stored switch (`ownSwitches`, `:330`–`332`). A row whose only content
was `offered = false` cannot pass the migration (below: the venue is reset); after it, no such row
can be written, and the variant is offered wherever its product is placed.

## Clashes after W90

`clashesOf` (`menu-combine.ts:104`–`124`) reports price clashes only, for the product when it has no
variants and for every variant otherwise. Today the price clash is reported only when the offered
setting is decided true (`:116`–`121`), so a menu could escape a price clash by switching the item
off; that escape goes with the switch. The resolve menu offers the candidate prices and "Set a
price…" (`menu-prices-table.ts:421`–`451`). `menu.clashes_unresolved`'s wording, "Resolve the price
and on/off clashes…" (`apps/dashboard/src/i18n/codes.ts:110`–`112`), becomes price-only in both
languages.

## Publication and preview

- The working hash drops `ownDecisions` (`menu-document.ts:248`–`263`) and is the document's own
  hash. Its comment (`:248`) gives its only reason: an included menu's switched-off offers were left
  out of the document. After W90 the document holds every offer `ownDecisions` maps, with
  `grossPrice` and each variant's `menuPrice` (`freezeOffer`, `:320`–`330`, strips neither), so it
  adds nothing; the publication tests on included price edits are the check (plan, Task 4).
- `productFields` (`menu-document.ts:772`–`774`) loses its two offered comparisons; the price
  comparisons below them stay.
- `refine` (`menu-publication.ts:285`–`298`) attributes a removed-but-still-reached product to an
  included menu from the OFFERED decision's source. After W90 a reached product leaves the document
  only when it is Inactive (shared product) or reached only through an inactive menu, so the branch
  becomes `deleted ? "shared_product" : "this_menu"`. The publication tests decide whether any
  `included_menu` attribution test depended on the offered source (plan, Task 4).
- **Stored documents.** `FrozenOffer` and `FrozenOfferVariant` lose `offered`/`ownOffered`. A
  version published before this change still carries them in `menu_versions.document`, and its
  variant `offered: false` would no longer be read, so that variant would sell. Following the reset
  policy (CLAUDE.md §3, "No backwards-compatibility or data-migration code"), nothing reads or
  rewrites old documents and `MENU_DOCUMENT_FORMAT` stays 2: a venue that published a menu with a
  variant switched off republishes it or is reset. Rejected alternative: bump the format to 3 as
  #720 did (`menu-publication.ts:160` then serves no old version), which would take every venue's
  menus off its tills until republished, for a case a republish already fixes. Every live version
  also reads as changed after the upgrade, because the proposed document no longer has the keys;
  republishing clears it (read, not run: `statusOf`, `menu-publication.ts:67`–`77`, compares the
  working document's `menuDocumentHash` with the live version's `contentHash`).

## Till

`withUnavailable` sets a variant's `available` from the unavailable set alone, and `lineBlock`
returns `variant_removed` only when the variant is missing from the offer
(`apps/till/src/state/menu-refresh.ts:68`, `:104`). Server-side sale checks already read only
`variant.available` (`apps/server/src/order-drafts.ts:780`–`786`), which `applyLiveFields` now
builds from `sellable` alone.

## Request contract

Retired keys are refused, as the sibling routes do: `active` on the same PATCH
(`catalogue-api.ts:951`–`953`) and `modifierIds`, `optionGroupIds`, `soldAlone` on product bodies
(`:372`–`381`). So a PATCH body carrying `offered` (any value, `null` included) answers
`management.request_invalid` with `field: "offered"`, and a variants entry carrying `offered`
answers it with `field: "variants.<index>"` (the existing per-entry shape, `:310`–`316`). No error
code is retired: `management.request_invalid` and `menu.clashes_unresolved` stay.

## Migration

Measured 2026-10-05 in this worktree with drizzle-kit 0.31.11 (`pnpm exec drizzle-kit generate`
in `packages/catalogue`, after a scratch schema edit, then reverted): removing both columns and
changing `menu_item_variant_overrides_overrides_ck` to `price is not null` generates

- `ALTER TABLE menu_items DROP COLUMN offered` — no rebuild. `menu_items` keeps its id, so
  venue-service's `menu_item_id` key into it (`packages/venue-service/drizzle/0000_baseline.sql:86`)
  is untouched.
- a REBUILD of `menu_item_variant_overrides` (the CHECK changes; and SQLite refuses to drop a column a
  CHECK names — measured on `node:sqlite`, Node v26.7.0, SQLite 3.53.4: `alter table t drop column b`
  on a table with `check(a is not null or b is not null)` threw `error in table t after drop column:
  no such column: b`, and the same drop on a table without the CHECK succeeded). No foreign key
  points at that table (``/usr/bin/grep -rn 'REFERENCES `menu_item_variant_overrides`'
  packages/*/drizzle/*.sql`` finds none), and no trigger or index names it: the only migration
  files naming the table are catalogue `0002` and `0016`, and the drizzle snapshot lists 0 indexes.
  Its own keys point at `menu_items` and `products`; the rebuild's `DROP TABLE` acts on no other table. The change feed is
  removed before migrating and reinstalled from the live columns (`packages/db/src/change-feed.ts`,
  `installChangeFeed` at boot), and the table is classified `state` with `classify()`, not `appendOnly()`
  (`packages/catalogue/src/classification.ts:13`), so it has no append-only triggers.
  No column is added, so the "rebuild copies a new column" trap does not apply, and there is no
  expression index.

Keeping the CHECK's NAME with the narrower body keeps `scripts/schema-constraints.test.ts`
unedited: with `.notNull()` instead, that guard failed (`EXPECTED_CHECK_CONSTRAINTS` lists
`menu_item_variant_overrides_overrides_ck`, measured). Its comment moves from "a price or its own
switch" to "a price".

The rebuild refuses any stored row with a blank price: `scripts/migration-upgrade.test.ts` failed
with `CHECK constraint failed: menu_item_variant_overrides_overrides_ck` at that step (measured), and
passed with a `RESETS` entry naming ``INSERT INTO `__new_menu_item_variant_overrides` `` and that
message. A `DELETE … WHERE price IS NULL` before the rebuild was also measured (against the `.notNull()`
variant) and failed the same guard's lost-rows check ("menu_item_variant_overrides: 1 rows before, 0
after"); it would also be data-migration code, so it is not used.

**Reset note (for the PR's first line and the backlog).** A venue whose database holds a variant
override row with a switch and no menu price (switched off, or explicitly on) cannot migrate: boot fails with errcode 275, which
`withDevMigrationHint` (`apps/server/src/dev-migration-hint.ts:12`–`18`) answers in dev with
`wa-wt reset demo <worktree-name>`. Any other venue: reset it, or remove those switches before
upgrading. A fresh demo seed writes no override rows (`apps/server/scripts/demo-seed/` has no
`setMenuVariants` or override insert), so it migrates cleanly. Republish every menu after the
upgrade (stored documents, above). A configuration bundle exported before W90 cannot be imported
after it: export writes `select *` of each table (`apps/server/src/configuration-transfer.ts:230`),
so every `menu_items` row carries an `offered` key, and import refuses a row with a column the table
lacks, `setup.request_invalid` with `field: "table:menu_items"` (`:411`–`418`; read, not run).
Export again after upgrading.
