# Remove the menu-specific offered switch (W90) — implementation plan

> **For agentic workers:** implement each task test-first: write the failing test, run it and watch
> it fail for the reason you expect, then write the least code that passes. Use
> `superpowers:subagent-driven-development`. The branch carries a migration and changes a
> cross-package contract (the menu wire types in `@waitron/catalogue` and `@waitron/module`), so it
> takes the FULL path: a per-task reviewer, then `/finish-branch` with two Codex run-it reviews.

**Goal.** A product is on a menu when the menu's structure places it, directly or through an
included menu; product Active and Available decide whether it sells. Remove the separate per-menu
on/off for products and variants — storage, contracts, combination and clashes, publication, till
and dashboard — and keep price overrides, price inheritance and published-menu behaviour exactly as
they are.

**Spec.** `docs/superpowers/specs/2026-10-05-w90-remove-menu-offered-switch-design.md`, and the
owner's queue item W90 (lane B `queue.md`, 2026-10-04). Read the design's STOP section first.

**Why this task order.** Consumers stop READING the field first (dashboard, till, server contract),
while the catalogue still produces it, so every task compiles and passes. Task 4 then removes the
field at its source, where the domain-boundary tests the item asks for are written first. Doing the
domain first would break the dashboard's and till's typecheck until their removal landed.

**Running tests.** Focused runs only (CLAUDE.md §2); CI owns package suites. Check free memory
first (`memory_pressure | /usr/bin/grep free`) before a browser package run. Read the `Tests`
count, never the exit status of a pipe.

---

## Task 0 — Ask the owner about the STOP items (then carry on)

Post one entry in `/Users/clintongormley/waitron-campaign-b/questions.md` headed
`W90 — two scripts/ guard edits and 25 rows with deleted checks, need a yes`: the two `scripts/` edits (design,
STOP 1 and 2, with the measured failure each fixes) and every `DELETE` row of the table below. Carry
on with Tasks 1–5; the land waits for the answer. Update the ledger
(`docs/handoffs/2026-10-05-w90-remove-offered.md`).

## Task 1 — Dashboard: the offered controls go

**Files.** `apps/dashboard/src/widgets/menu-prices-table.ts`, `menu-preview.ts`,
`apps/dashboard/src/api/client.ts` (`updateMenuItem` input loses `offered`),
`apps/dashboard/src/i18n/strings.ts`, `apps/dashboard/src/i18n/codes.ts`
(`menu.clashes_unresolved` wording); tests `menu-prices-table.test.ts`,
`menu-prices-table.a11y.test.ts`, `apps/dashboard/src/screens/menus-screen.test.ts`,
`apps/dashboard/src/api/client-routes.test.ts`. The catalogue types still carry `offered` until
Task 4, so fixtures and `test-helpers.ts`'s `combinedFixture` keep producing it here; only what the
widget READS changes.

1. Failing tests first, in `menu-prices-table.test.ts`:
   - the table has no `active` ("On this menu") column among its columns and choosable columns;
   - the edit window has no `offered` or `offered-<variantId>` field, and a save that changes only a
     price emits `wt-offer-save` with `item: { grossPrice }` and variants carrying `variantId` and
     `price` only;
   - a row whose `combined.offered` is a clash but whose price is decided is not drawn as a clash
     and has no resolve menu (the widget no longer reads `offered`). This test reads a field Task 4
     removes, so Task 4 deletes it: it exists only to hold the widget's behaviour until then;
   - the price summary for an included menu reads "This menu sets its own price for {n} {items} from
     {menu}" (new English and Spanish wording, no switched-off count);
   - each variant's price counts toward the product's charged range (today only offered variants
     count, `menu-prices-table.ts:313`).
   Run `pnpm --filter @waitron/dashboard exec vitest run src/widgets/menu-prices-table.test.ts` and
   watch them fail.
2. Remove: `#offeredSetting` and its uses, the `active` column, `#offeredField` and its two calls,
   the offered half of `#resolveActions` and of `#resolve`, offered in `#isClash`, `#readLines`'s
   `offered` filter, `#seed`/save's `offered` draft fields, `switchedOff` in the summary. Remove the
   offered branch of the Preview clash list (`menu-preview.ts:579`–`594`): every clash is a price
   clash. Delete the strings the design lists once a grep finds no reader (both languages, same
   keys). Change these, English then Spanish (`strings.ts`, `codes.ts`):

   | Key | English | Spanish |
   | --- | --- | --- |
   | `menu_prices.summary_included` | This menu sets its own price for {prices} {priceItems} from {menu} | Esta carta fija su propio precio para {prices} {priceItems} de {menu} |
   | `menu_prices.variants_help` | Leave a price empty to inherit it. | Deja el precio vacío para heredarlo. |
   | `menu_prices.variants_not_saved` | The menu price for {name} was saved, but its variants were not. {reason} | Se guardó el precio de {name} en esta carta, pero no sus variantes. {reason} |
   | `menu.clashes_unresolved` | Resolve the price clashes before publishing this menu. | Resuelve los conflictos de precio antes de publicar esta carta. |

   `summary_included` keeps `{prices}`, `{priceItems}` and `{menu}` and loses `{off}` and
   `{offItems}`, so the summary code (`menu-prices-table.ts:1020`–`1024`) drops its two
   `{off}`/`{offItems}` replacements; `variants_not_saved` keeps `{name}` and `{reason}`
   (`menus-screen.ts:1557`).
3. Update the existing checks per the table (rows marked Task 1). Run the three files above plus
   `src/widgets/menu-preview.test.ts`, `src/widgets/menu-preview.a11y.test.ts`,
   `src/i18n/codes.test.ts`, `src/i18n/domain.test.ts` with
   `pnpm --filter @waitron/dashboard exec vitest run <files>`; `pnpm --filter @waitron/dashboard
   typecheck`; `pnpm --filter @waitron/dashboard lint`; `pnpm format:check`.
4. **Look at it.** Start the stack with `wa-wt demo waitron-feat-menus-remove-offered`, open a
   menu's Prices tab and the edit window of a product with variants, and a menu that includes
   another, in light and dark themes at 390px and 1280px. Check: no On this menu column, no Sold /
   Offered pickers, the resolve menu shows only prices, the summary reads correctly in Spanish too.
5. Commit (`git commit -s`): "Menus: the Prices tab no longer offers a per-menu on/off switch".

## Task 2 — Till: a variant is sellable when it is Available

**Files.** `apps/till/src/state/menu-refresh.ts`; tests `apps/till/src/state/menu-refresh.test.ts`
and the till suites the table names.

1. Failing tests first in `menu-refresh.test.ts` (fixtures keep their `offered` key until Task 4;
   Task 4 drops the key from this new test, which then is the table's `menu-refresh.test.ts:257`
   rewrite — a variant loaded unavailable becomes available when the set does not list it):
   `withUnavailable` marks a variant whose stored `offered` is false available when its id is not
   in the unavailable set; a line on such a variant gets
   no block from `lineBlock`; a line on a variant missing from the offer still
   gets `variant_removed`; a variant in the unavailable set still gets `unavailable`. Run
   `pnpm --filter @waitron/till exec vitest run src/state/menu-refresh.test.ts`; the first two fail.
2. Change `menu-refresh.ts:68` to `available: !products.has(variant.id)` and `:104` to
   `if (variant === undefined) return { reason: "variant_removed", name };`.
3. Update the checks the table marks Task 2. Run the named till files; `pnpm --filter @waitron/till
   typecheck`, lint, `pnpm format:check`.
4. Commit: "Till: a menu no longer hides a variant; Available decides".

## Task 3 — Management API: `offered` is a retired request key

**Files.** `apps/server/src/catalogue-api.ts`; test `apps/server/src/catalogue-api.test.ts`.

1. Failing tests first: `PATCH /management-api/catalogues/:id/items/:itemId` with
   `{ offered: false }`, `{ offered: null }` and `{ grossPrice: "3.00", offered: true }` each answers
   400 `management.request_invalid` with `params: { field: "offered" }` and writes nothing (read the
   item back: price unchanged); `PUT …/variants` with an entry carrying `offered` answers 400 with
   `field: "variants.0"`; a PUT entry `{ variantId, price: "2.50" }` stores the price and a following
   GET returns `[{ variantId, price: "2.50" }]`-shaped rows. Run
   `pnpm --filter @waitron/server exec vitest run src/catalogue-api.test.ts`.
2. In the PATCH handler, refuse `Object.hasOwn(body, "offered")` beside `active`
   (`catalogue-api.ts:951`); delete the boolean check and the forwarding (`:954`–`966`). In
   `parseMenuVariants` (`:305`–`324`), refuse an entry with an own `offered` key and stop forwarding
   it.
3. Update the checks the table marks Task 3 (they are all in `catalogue-api.test.ts`), including
   the three request bodies that still send `offered` (`:1285`, `:1299`, `:4545`): after this task
   the route refuses them before they reach what each test checks. The expected rows at
   `:1292`–`1293` keep `offered` until Task 4, because the response still carries it. Typecheck
   and lint `@waitron/server`; format check.
4. Commit: "Management API: a menu item or variant body carrying offered is refused".

## Task 4 — Storage, domain and publication: the switch goes at its source

**Files.** `packages/catalogue/src/schema/menu.ts`, `schema/variant-overrides.ts`, a generated
migration under `packages/catalogue/drizzle/`, `menu-types.ts`, `menu-combine-types.ts`,
`menu-combine.ts`, `operations.ts`, `variants.ts`, `menu-structure.ts`, `menu-document.ts`,
`menu-document-types.ts` (no change expected: it derives from `MenuOffer`), `menu-publication.ts`;
`packages/module/src/module.ts`; `apps/server/src/testing/zone-offers.ts:164`; the
`scripts/` edits the owner approved; and the fixture-field removals in every package. Typecheck
finds an `offered` key in a fixture TYPED as one of the changed interfaces; it does not find one in
a `toEqual`/`toMatchObject` expectation, or in a value built untyped and passed in later — only
running the suite does (step 7 lists the runs).

1. **Domain-boundary tests first** (catalogue, real database through `useVenueDb`):
   - `operations.test.ts` (or `menu-structure.test.ts`, beside the existing listMenuOffers cases):
     a product placed in a menu's own section is an offer; a product placed only in an included
     menu is an offer of the parent; an Inactive product is not; an Unavailable product is an offer
     whose live `available` is false after publish; each Active variant is listed with `available`
     equal to its own Available, through an included menu too; an Inactive variant is not listed;
     the offer and its variants carry no `offered` or `ownOffered` key (`expect(offer).not.toHaveProperty("offered")`).
   - `variants.db.test.ts`: `setMenuVariants` with `{ variantId, price: "2.50" }` persists one row
     with that price and `listMenuVariants` returns `{ variantId, price: "2.50" }`; a later save of
     `{ variantId, price: null }` deletes the row; inserting a row with a null price is refused by
     `menu_item_variant_overrides_overrides_ck`.
   - `menu-combine.test.ts`: two included menus disagreeing on a product's price report a price
     clash from `clashesOf`, including when the parent places nothing itself; a variant's price
     clash is reported for every variant; `CombinedOffer` has no `offered`.
   - `migrations.test.ts`: `menu_items` and `menu_item_variant_overrides` have no `offered` column;
     the CHECK body is `price is not null`.
   - `menu-publication.test.ts`: publish then serve a menu whose variant is Unavailable: it is
     listed and not sellable; made Available, it sells without republishing. A preview of a menu
     including another lists price clashes only.
   Run each with `pnpm --filter @waitron/catalogue exec vitest run src/<file>`; watch them fail.
2. **Schema and migration.** Remove `offered` from both tables; keep the CHECK named
   `menu_item_variant_overrides_overrides_ck` with body `${t.price} is not null`, and fix the comment
   above the table ("A row exists only to set this variant's price on this menu."). Generate with
   `pnpm --filter @waitron/catalogue exec drizzle-kit generate --name drop_menu_offered` against the
   current tree: the number is whatever comes next, never chosen by hand. Never edit an existing
   migration file (CLAUDE.md §3). Read the generated SQL: expect a rebuild of
   `menu_item_variant_overrides` with no `offered`, the CHECK as above, an `INSERT … SELECT` of the
   four kept columns, then ``ALTER TABLE `menu_items` DROP COLUMN `offered` ``; no other table.
3. **Domain.** Remove the switch from `combineOffer` and `clashesOf` (report price clashes
   unconditionally); `offerRowsOn` and `offersOn` lose `includeSwitchedOff` and the filters;
   `readOfferVariants` sets `available: row.available`; `offersOn`'s variant mapping
   (`operations.ts:663`–`667`) drops `offered` and sets `available: variant.available` (it is
   `variant.available && offered` today); `menuPrices`, `menuVariantsOfItems`,
   `setMenuVariants` (store a row only for a price), `updateMenuItem`/`writeMenuItemSettings` (price
   only), `MENU_ITEM_COLUMNS`, `menu-structure.ts:199`–`213` (clear `grossPrice` only). Types:
   `menu-types.ts`, `menu-combine-types.ts`, `module.ts:95`, `:128`, `:271`–`272`.
4. **Publication.** `menu-document.ts`: the `onMenu` filter keeps every offer; `applyLiveFields`
   variant `available: sellable(row)`; `productFields` drops the two offered comparisons.
   `menu-publication.ts` `refine`: `deleted ? "shared_product" : "this_menu"`.
   **The working hash drops `ownDecisions`** (`menu-document.ts:248`–`263`) and becomes
   `menuDocumentHash(built.document)`. The comment at `:248` gives its only reason: an included
   menu's switched-off offers were left out of the document, so their settings had to be hashed
   beside it. After W90 the document's offers are the same set `ownDecisions` maps
   (`offersByMenu.get(row.menuId)`, now unfiltered), and each frozen offer keeps `grossPrice` and
   each frozen variant keeps `menuPrice` (`freezeOffer`, `menu-document.ts:320`–`330`, strips
   neither; `menu-document.test.ts:137` reads `grossPrice: "2.80"` from a built document). So
   `ownDecisions` holds nothing the document lacks. Checked by reading, not run: the publication
   tests that pin "an included menu's price edit marks its parents changed"
   (`menu-publication.test.ts:1423`, `:1511`, `:1534`, `:1636`) must still pass after the change,
   and that run is the check. Delete or fix the comments that describe the switch:
   `operations.ts:343`, `:436`–`442`, `:695`–`699`; `variants.ts:315`–`319`; `menu-types.ts:28`,
   `:76`–`78`, `:117`; `schema/menu.ts:69`–`70` ("its price and its own switch");
   `menu-document-types.ts:78` ("including their settings for switched-off products");
   `menu-document.ts:248` (goes with `ownDecisions`); `apps/server/src/order-drafts.ts:775` ("its
   variant is not offered or cannot be sold" → "its variant cannot be sold");
   `apps/dashboard/src/widgets/menu-prices-table.ts:30`–`32` and `:106`–`108` (the menu's switch and
   whether each variant is offered).
5. **Approved `scripts/` edits** (only once Task 0 has its answer; until then leave them failing
   locally and do not push): add to `RESETS` in `scripts/migration-upgrade.test.ts`
   the entry below (the tag is the generated file's name)

   ```ts
   "catalogue/<generated tag>": {
     refused: [
       "INSERT INTO `__new_menu_item_variant_overrides`",
       "CHECK constraint failed: menu_item_variant_overrides_overrides_ck",
     ],
   },
   ```

   with a one-line comment in the shape of its neighbours ("Rebuilds `menu_item_variant_overrides`
   with a price required; a copied row's price is null."); in `scripts/menu-sections-upgrade.test.ts`
   drop `offered: true` (`:121`) and `offered` from the select and expected row (`:195`–`196`).
6. **Fixtures.** Remove `offered`/`ownOffered` keys from fixtures and expected objects across
   packages (table rows `F`), and update the `B`/`P` rows as the table says.
7. **Guards**, from the root: `pnpm exec vitest run scripts/schema-constraints.test.ts
   scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts
   scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts
   scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts
   scripts/journal-monotonic.test.ts scripts/menu-sections-upgrade.test.ts
   scripts/dashboard-browser-purity.test.ts`, and `pnpm --filter @waitron/fiscal-verifactu exec vitest
   run inmutabilidad`. No error code is retired, so `scripts/alert-codes.test.ts` and
   `scripts/errors-reachable.test.ts` are not needed for that reason; run them anyway if any
   `errors.ts` changed. Focused package runs — every suite that holds a fixture or an expectation
   with the key, since typecheck misses the expectations:
   - catalogue: the files above, `menu-document.test.ts`, `variant-fallback.test.ts`,
     `variants.test.ts`, `home-layouts.test.ts`, `menu-structure.test.ts`, `operations.test.ts`,
     `menu-publication.test.ts`;
   - server: `catalogue-api.test.ts` (expectations at `:1292`–`1293`, `:3880`, `:3919`, `:3940`),
     `till-api.sell-published.test.ts`, `till-sale.test.ts`, `working-order.test.ts`,
     `till-api.test.ts`, `order-drafts.db.test.ts`;
   - venue-service: `operations.test.ts`;
   - till: `menu-refresh.test.ts`, `api/client.test.ts`, `state/draft-lines.test.ts`,
     `state/working-order.test.ts`, `till-app.test.ts`;
   - dashboard, after `combinedFixture` loses its third argument: `menu-prices-table.test.ts`,
     `menu-prices-table.a11y.test.ts`, `menus-screen.test.ts`, `menus-screen.a11y.test.ts`.
   Typecheck `@waitron/catalogue`, `@waitron/module`, `@waitron/venue-service`, `@waitron/server`,
   `@waitron/till`, `@waitron/dashboard`.
8. **Look at it again** (Task 1's look, plus the till): reset the dev venue first
   (`wa-wt reset demo waitron-feat-menus-remove-offered`, then re-enrol the till with `DEMO`),
   publish a menu with variants, and confirm on the till that every Active, Available variant can be
   sold and an Unavailable one is greyed.
9. Commit: "Menus: the per-menu offered switch is gone from storage, combination and publishing".
   The PR's first line carries the reset note (design, "Reset note").

## Task 5 — Documentation and backlog

1. `docs/developers/products.md`: rewrite `:312`–`317` (a menu stores something for a variant only
   to override its price), `:325`–`333` (no menu switch; drop "with whether that menu offers it" and
   the "switch-off made since" sentence), `:338` ("Each product placed in a menu's published
   structure gets a button"), `:553`–`555` (a variant is listed while Active and sellable while
   Available). State the new rule once, where Active and Available are described.
2. `docs/developers/product-categories.md:105`–`130` and `:187`: the PATCH takes `grossPrice` only
   and refuses `active` and `offered`; rows have no `offered`; `combined` explains the price;
   `variants` is `{ variantId, price }`; "Inactive products are structurally accepted, but publish as
   empty tiles".
3. `docs/backlog.md`: add a DONE entry for W90 beside W88's, with the PR number, the reset note and
   the changed-checks pointer; edit the stale lines it makes wrong — `:520`–`522` (the "switched off
   on the menu" cause of an empty section), `:2418`–`2421` (the held-line raise check no longer has a
   menu switch to check), `:7569`–`7570` (`menu_prices.switched_off` no longer exists). Leave W89 as it
   is (it lives in the lane queue, not the backlog).
4. Grep once more, across `docs/developers`, every `README.md` and `docs/backlog.md`, for
   `offered` beside "menu", "switched off", "on/off", "Sold on this menu", "On this menu"; fix what
   describes the removed switch.
5. Docs-only commit on the same branch: "Docs: a menu has no on/off switch of its own any more".

Then `/finish-branch` with the plan and ledger named. The PR description reuses the table below
under "Changed test checks", and adds the questions.md FYI entry the owner's rule asks for.

---

## Changed test checks

Reasons: **R1** the design's "The rule after W90" (no menu switch; placement plus Active/Available
decide); **R2** "Clashes after W90" (price clashes always reported, no on/off clash); **R3** "Request
contract" (retired key refused); **R4** "Migration" (columns gone, CHECK is `price is not null`);
**R5** "Till". Line numbers are at 746f75fae: the `it(` line, then the assertions. `DELETE` rows are
the owner question of Task 0; every other row keeps a check at least as strict, of the new rule.

Not in the table: about 118 fixture-only edits (an `offered`/`ownOffered` key dropped from a fixture
or an expected object, or `combinedFixture`'s third argument), made in Task 4. Typecheck finds the
ones in typed fixtures; the ones in `toEqual`/`toMatchObject` expectations only fail when the suite
runs — among them `catalogue-api.test.ts:1292`–`1293`, `:3880`, `:3919`, `:3940`,
`variants.test.ts:185`–`186`, `:201`–`202`, `:299`, and `variant-fallback.test.ts:327`. They assert nothing about the switch. No row touches a golden huella, `inmutabilidad` or
fiscal filing test. Four rows are in sale suites that assert money totals (marked **money**): each
changes only HOW a variant or dish is made unsellable, and every total stays the value it is today.

| Task | file:line | Before | After | Why |
| --- | --- | --- | --- | --- |
| 1 | `apps/dashboard/src/widgets/menu-prices-table.test.ts:316` (`:344`) | lemonade charged range excludes the switched-off large | `range(2.50, 3.75)`: every variant counts | R1 |
| 1 | same `:316` (`:345`–`349`) | "On this menu" (`active`) column cells | **DELETE** that expect; Task 1's new test asserts the column is absent | R1 |
| 1 | `…menu-prices-table.test.ts:472` | a product whose variant is only switched off is not "overridden" | a product whose variants set no price is not "overridden" | R1 |
| 1 | `…menu-prices-table.test.ts:646` | the product and each variant have Sold/Switched off pickers | **DELETE** — the pickers no longer exist; Task 1's new test asserts they are absent | R1 |
| 1 | `…menu-prices-table.test.ts:679` (`:692`–`720`) | edit window edits price, the menu's switch and each variant's | combobox steps removed; save expects `item: { grossPrice: "2.80" }` and `{ variantId: "v-large", price: null }` | R1 |
| 1 | `…menu-prices-table.test.ts:725` (`:740`, `:746`) | a flipped switch makes the save send `item` | typing `11.00` makes the save send `item: { grossPrice: "11.00" }, variants: null` | R1 |
| 1 | `…menu-prices-table.test.ts:818` (case `:820`) | "only a variant's offer changed" sends variants alone | **DELETE** that case; the price case stays | R1 |
| 1 | `…menu-prices-table.test.ts:884` (case `"active"`) | a refusal naming `offered` shows at the bottom | **DELETE** that case; the other field cases stay | R3 |
| 1 | `…menu-prices-table.test.ts:939` (`:943`) | changing the switch clears a price refusal's neighbour | changing `variants.0.price` does | R1 |
| 1 | `…menu-prices-table.test.ts:1326` (`:1337`–`1347`) | each variant row shows whether it is offered | **DELETE** that expect; names and prices stay | R1 |
| 1 | `…menu-prices-table.test.ts:1397` (`:1406`–`1414`) | wine range skips the carafe; tea reads "No variant offered" | wine `range(7.00, 15.00)`, tea `eur(2.40)`; the muted tea check goes with the string | R1 |
| 1 | `…menu-prices-table.test.ts:1444` | comment says switched-off variants are skipped | comment fixed; expected order unchanged | R1 |
| 1 | `…menu-prices-table.test.ts:1546` (`:1548`–`1551`) | "15.00" finds the carafe and opens the wine; "1500" finds nothing | "10.00" (the bottle's price before this menu, inside the wine's range) finds `mi-wine, mi-wine:v-bottle`; "1000" finds nothing; added: "15.00" now finds the wine itself, folded (`["mi-wine"]`) | R1 |
| 1 | `…menu-prices-table.test.ts:1567` (`:1581`, `:1591`) | the chooser offers `active` | not offered | R1 |
| 1 | `…menu-prices-table.test.ts:1683` (`:1689`) | wine "now" range skips the carafe | `range(7.00, 15.00)` | R1 |
| 1 | `…menu-prices-table.test.ts:1748` | a menu price on a switched-off variant is ignored | **DELETE** — no switched-off variant exists; a variant's menu price in the range stays pinned at `:1688` | R1 |
| 1 | `…menu-prices-table.test.ts:1778` | "No variant offered" when none is | **DELETE** — that state no longer exists | R1 |
| 1 | `…menu-prices-table.test.ts:1803` (`:1806`–`1814`) | sort order with tea unpriced | tea (2.40) sorts first: `mi-tea, mi-juice, mi-cider, mi-soup, mi-wine, mi-burger, mi-steak` | R1 |
| 1 | `…menu-prices-table.test.ts:1938` | three states for the product and every variant | **DELETE** — the states no longer exist | R1 |
| 1 | `…menu-prices-table.test.ts:1953` (`:1985`–`1986`) | resolving a variant's price clash forwards each variant's stored `offered` | sends `variantId` and `price` only, the same prices | R3 |
| 1 | `…menu-prices-table.test.ts:1996` (`:2045`) | summary counts overrides and switch-offs per included menu | summary counts overrides only, new wording | R1 |
| 1 | `…menu-prices-table.test.ts:2052` | Sell it / Switch it off resolves an on/off clash (2 cases) | **DELETE** — no on/off clash exists | R2 |
| 1 | `…menu-prices-table.test.ts:2115` (`:2152`) | summary text includes "and switches off 0 items" | text without it | R1 |
| 1 | `…menu-prices-table.a11y.test.ts:91` (`:101`–`106`) | muted cell of the switched-off large | muted "no own price" cell of `v-small` | R1 |
| 1 | `…menu-prices-table.a11y.test.ts:171` | axe on the three-state editor with disagreeing sources | **DELETE** — that editor state no longer exists; the window's other states keep their axe runs | R1 |
| 1 | `apps/dashboard/src/screens/menus-screen.test.ts:6509` | sends only an offered reset, leaves variants alone | **DELETE** — no offered reset exists; price-only saves stay pinned in the table's tests | R1 |
| 1 | `apps/dashboard/src/api/client-routes.test.ts:770` (`:783`, `:793`, `:799`) | PATCH body `{ grossPrice: null, offered: … }`; variants `{ variantId, price, offered }` | `{ grossPrice: null }`; variants `{ variantId: "v1", price: "3.50" }` | R3 |
| 2 | `apps/till/src/state/menu-refresh.test.ts:257` (`:262`) | a variant the menu does not offer stays unavailable whatever the set says | a variant loaded unavailable becomes available when the set does not list it | R5 |
| 2 | `…menu-refresh.test.ts:309` (`:319`–`321`) | `offered: false` blocks the line as `variant_removed` | **DELETE** that expect; missing variant → `variant_removed` and unavailable → `unavailable` stay | R5 |
| 3 | `apps/server/src/catalogue-api.test.ts:1093` (`:1139`–`1147`) | PATCH offered on one menu leaves the other | **DELETE** the PATCH step and its expect; price independence stays | R3 |
| 3 | `…catalogue-api.test.ts:1214` (body `:1285`) | the variants PUT sends `offered: true` and expects 200 | the body sends `{ variantId, price: "4.10" }`; still 200 | R3 |
| 3 | `…catalogue-api.test.ts:1214` (body `:1299`) | a malformed body (`price: 4.1`, `offered: true`) is refused 400 | `offered` dropped so the number price is the only fault; still 400 | R3 |
| 3 | `…catalogue-api.test.ts:4545` (body) | a `-1.00` variant price sent with `offered: true` is refused `product.variant_invalid`, field `price` | `offered` dropped from the body; same refusal | R3 |
| 3 | `…catalogue-api.test.ts:3828` | switches a product back on after switching it off | **DELETE** — moved: the `offered` refusal is pinned in the `:5272` case | R3 |
| 3 | `…catalogue-api.test.ts:4000` (`:4016`, `:4028`, `:4036`) | an included on/off clash shows and refuses publish | an included PRICE clash (own 1.00 vs child 2.00) shows as `field: "price"` and refuses publish (409, count 1) | R2 |
| 3 | `…catalogue-api.test.ts:5272` (`:5286`–`5289`) | retired `active` refused; an unset switch preserved | `active` and `offered` both refused 400 with their field | R3 |
| 3 | `…catalogue-api.test.ts:5292` (`:5318`–`5336`) | variant price-only writes preserve the own switch | a variants entry carrying `offered` is refused 400 `variants.<i>`; a price-only entry stores its price | R3 |
| 4 | `packages/catalogue/src/menu-combine.test.ts:63` | on/off disagreement always reported; a price clash hidden when off | **DELETE** — no on/off setting; price clash reporting pinned at `:33` and by Task 4's new case | R2 |
| 4 | `…menu-combine.test.ts:183` | a size's own switch resolves an on/off clash | **DELETE** — no size switch | R2 |
| 4 | `packages/catalogue/src/migrations.test.ts:218` | CHECK body names `offered` | body `price is not null` | R4 |
| 4 | `…migrations.test.ts:575` (`:579`–`593`) | an override that overrides nothing refused; offered-only row accepted | null price refused, `-1` refused, `0` accepted | R4 |
| 4 | `…migrations.test.ts:635` (`:639`) | `offered` is a nullable column | `offered` absent from both tables; `active` absent | R4 |
| 4 | `packages/catalogue/src/home-layouts.test.ts:428` (`:435`) | a shortcut to a switched-off product publishes as an empty slot | the same with the product made Inactive: `addShortcut` checks only structural reach and that the ref is a top-level product (`home-layouts.ts:257`–`259`, `checkRef` in `section-members.ts:72`–`90`), never `active` | R1 |
| 4 | `packages/catalogue/src/menu-structure.test.ts:582` | no own setting until changed, and clearing it | **DELETE** — the setting no longer exists | R1 |
| 4 | `…menu-structure.test.ts:595` | hides a reached product on one menu and turns it back on | **DELETE** — no per-menu hide; the structure change that replaces it is pinned by Task 4's new placement cases | R1 |
| 4 | `…menu-structure.test.ts:618` (`:627`) | an unreached item's offered write is refused | **DELETE** the offered case; the three price writes keep the refusal | R1 |
| 4 | `…menu-structure.test.ts:806` (`:814`–`822`) | prices list a switched-off and a sold-out product, not an inactive one | lists `[Lemonade, Water, Juice]`: sold-out listed, inactive left out | R1 |
| 4 | `packages/catalogue/src/variants.db.test.ts:497` | a price-only write keeps an omitted switch; null clears it | **DELETE** — no switch; the row lifecycle stays pinned at `:550` | R1 |
| 4 | `…variants.db.test.ts:550` (`:576`–`588`) | an offered-only row persists | a null price deletes the row and nothing keeps one | R1 |
| 4 | `…variants.db.test.ts:603` (case `:607`) | `offered: "yes"` refused on field `offered` | **DELETE** that case; the price cases stay | R3 |
| 4 | `packages/catalogue/src/operations.test.ts:96` (`:129`–`134`) | switch off, then on with price 13 | price update to 13.00 on the same row | R1 |
| 4 | `…operations.test.ts:1669` (`:1685`–`1689`) | blank-price offer, and switching it back on | blank-price offer follows the product (retitled) | R1 |
| 4 | `…operations.test.ts:1741` (`:1756`–`1774`) | a variant switched off is unavailable | clearing its price gives 5.50, `menuPrice` null, `available` true | R1 |
| 4 | `…operations.test.ts:1800` (`:1806`–`1807`) | a parent none of whose variants is offered still listed | both variants Unavailable; parent still listed, `[false, false]` | R1 |
| 4 | `packages/catalogue/src/menu-publication.test.ts:1302` (`:1307`) | a switched-off product is this menu's removal | the product removed from the menu's root; same expected change | R1 |
| 4 | `…menu-publication.test.ts:1343` (`:1344`–`1361`) | variant price clash gated by product and variant offered (4 cases) | one case: the clash refuses publish; **DELETE** the three non-refused cases | R2 |
| 4 | `…menu-publication.test.ts:1423` (`:1430`, `:1444`) | own price and off decisions mask an included edit | own price alone masks; parents still "changed" | R1 |
| 4 | `…menu-publication.test.ts:1450` (`:1454`–`1465`) | inherited off products stay in prices; inactive inclusion omitted | **DELETE** the inherited-off half; the inactive-inclusion half stays | R1 |
| 4 | `…menu-publication.test.ts:1473` | masked on/off edits tracked alone | **DELETE** — no on/off edit exists | R1 |
| 4 | `…menu-publication.test.ts:1534` (`:1538`, `:1542`) | a price edit while the included product is off | own 9.00 masks: changed, then current | R1 |
| 4 | `…menu-publication.test.ts:1559` (`:1563`–`1571`) | an inherited off switch is the included menu's removal | lager removed from Drinks' structure: `product_removed`, `included_menu` | R1 |
| 4 | `packages/catalogue/src/menu-document.test.ts:211` (`:214`) | a switched-off product is omitted | a product removed from the structure is omitted | R1 |
| 4 | `…menu-document.test.ts:426` (case `:398`–`402`) | "whether the variant is offered" moves a change | "the variant's menu price" (4.20) does | R1 |
| 4 | `apps/server/src/working-order.test.ts:1614` (`:1636`) | live product changed by `set offered=false` | taken off the menu with `removeMember`; snapshot unit price 3.25 and VAT class unchanged | R1 |
| 4 | `…working-order.test.ts:8358` (`:8393`, `:8406`) | refuses Inactive, Unavailable, not-offered or other parent's variant | **DELETE** the not-offered case; three cases stay | R1 |
| 4 | `apps/server/src/till-sale.test.ts:229` (fixture) | variant "Fuera" switched off on the menu | Fuera made Unavailable where a test needs it unsellable | R1 |
| 4 | `…till-sale.test.ts:299` (`:315`) **money** | an unoffered variant is refused | an Unavailable variant is refused; total 8.20 and unit price 410 unchanged | R1 |
| 4 | `…till-sale.test.ts:2144` (`:2170`) **money** | dishes taken off by the switch | taken off with `removeMember`, republished; 50.00 tender and prices unchanged | R1 |
| 4 | `apps/server/src/till-api.sell-published.test.ts:323` (`:362`–`369`) **money** | version 4 takes Lemonade off by the switch | by `removeMember`; total 5.00, nothing written | R1 |
| 4 | `apps/server/src/till-api.test.ts:1727` (`:1742`–`1751`) | a product switched off and back on | removed from and re-added to the structure, published each time | R1 |
| 4 | `apps/server/src/order-drafts.db.test.ts:210` (fixture), `:1404` (case `:1343`), `:1461` (`:1469`–`1473`) | "a variant the menu does not offer" marked | "a sold-out variant" (bottle `available: false`): still `variant_unavailable` | R1 |
| 4 | `packages/venue-service/src/operations.test.ts:1914` (`:1920`) | an offer switched off leaves the structure, section kept (D5) | the product made Inactive: same assertions | R1 |
| 4 | `scripts/menu-sections-upgrade.test.ts:151` (`:121`, `:195`–`196`) **scripts/** | the override row keeps `offered: 1` across the sections rebuild | keeps `menu_item_id` and `price: 275` | R4 |
| 4 | `scripts/migration-upgrade.test.ts` `RESETS` **scripts/** | (no entry) | one entry for the new step, as above | R4 |

Totals: 72 rows. 45 are rewritten to a check of the new behaviour at least as strict as before; 25
carry a deletion — a whole test, a table case, a test step or a single expect whose behaviour no
longer exists, each marked **DELETE**; 2 are the `scripts/` edits. The **money** rows keep every
amount they assert.
