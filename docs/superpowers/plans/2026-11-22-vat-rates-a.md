# VAT rates, piece A: rates from the country pack, and a product's dated takeaway rate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`.

**Goal:** Every ticket files food and drink eaten here at the one dine-in rate Waitron ships with
dates, and food and drink taken away at each product's own dated takeaway rate; no VAT label
("general", "reduced", "super-reduced", "zero") is left on a product, an order line or a published
menu copy.

**Architecture:** Spain's fiscal area in `packages/country-es` carries two lists, the dated dine-in
rate and the rates a person may pick. A new `state` table, `product_takeaway_vat_rates`, holds each
product's dated takeaway rate in basis points. Nothing about VAT is stored on an order line: when a
ticket is issued, each line is given a dated list of rates (the dine-in list when eaten here, its
product's takeaway list when taken away) and `rateLines` picks the entry in force on the day the
meal ended, exactly as it picks a label's entry today. The work lands as four pull requests:
storage first, then the takeaway switch, then the eat-in switch, then a mechanical removal of the
labels nothing reads any more.

**Tech Stack:** TypeScript 7, drizzle (core migration set, `migration-baseline rebuild --set core`),
Hono routes in `apps/server`, `packages/menu`, `packages/country*`, Lit screens in
`apps/dashboard` and `apps/till`, Vitest 4.

**Spec:** [docs/superpowers/specs/2026-11-21-vat-rates-design.md](../specs/2026-11-21-vat-rates-design.md)
(approved by the owner 21 November 2026, "y"; on `main` at `5069c16f65`). Piece A is "The pieces,
for planning", item A. Read the whole spec before Task 1.1.

**Lane and landing:** fiscal — it changes the rate a ticket is filed at. **The owner lands every
PR of this plan.** Every commit `git commit -s`.

---

## What today's code does (read on `main` at `e2f075c59e`)

The spec cites `main` at `58432f9af9`. Every citation it makes was re-read for this plan; they hold
except where noted. All statements in this section come from reading the code, except the
commands quoted, which were run.

- Labels and the rate table: `VAT_CLASSES` and `VatClass` (`packages/shared/src/menu-document/vat-rates.ts:5-6`),
  `ADVANCE_VAT_CLASS = "reduced"` (`:9`), `DatedRate` (`:15-18`), `VAT_RATE_TABLE` (`:26-31`),
  `vatRateOn`/`vatRatesOn` (`:91-115`), `localCalendarDate`/`localToday` (`:117-126`).
- Products: `vat_class`, `takeaway_vat_class` (`packages/db/src/schema/menus.ts:139-142`), with
  `products_top_level_owns_ck` requiring `vat_class` on a top-level product (`:186`) and
  `products_vat_class_ck`/`products_takeaway_vat_class_ck` (`:188-189`). The effective takeaway
  label is `coalesce(takeaway, vat_class, parent.takeaway, parent.vat_class)`
  (`packages/menu/src/variant-fallback.ts:65-73`): a variant that sets only its eat-in label is
  taken away at that label too.
- Set menus: `set_vat_class`, `set_takeaway_vat_class` (`menus.ts:52-53`, checks `:71-76`).
- Order lines: `vat_class`, `takeaway_vat_class`, both NOT NULL (`packages/db/src/schema/orders.ts:238-241`),
  `offer_vat_class` (`:293`), checks `:349-355`, `:430-431`, and the context check pairing
  `offer_vat_class` with `menu_item_id` (`:443`).
- **Spec drift:** the freeze trigger is `working_order_lines_require_open_parent_update`
  (`packages/db/triggers/core.sql:371-605`); it names the three label columns at lines `406-407`,
  `440`, `478-479`, `533`, `565-566` and `600` (the spec's `:430-431` has moved). `sale_lines.vat_rate`
  is `packages/db/src/schema/sales.ts:243` (spec: `:241`).
- Published copies: labels on `MenuOffer`, `MenuOfferVariant`, `AvailableProduct`, `OfferedExtraItem`
  (`packages/shared/src/menu-document/menu-types.ts:35-36, 68-69, 118-119, 167-168`) and on the
  set-menu copy's terms (`set-menu-types.ts:31-32`).
- Where a label becomes a rate: `rateLines` (`packages/menu/src/pricing.ts:214-255`) through
  `issueMoment` (`apps/server/src/issue-moment.ts:35-58`), called by `issueOrderMoment`
  (`apps/server/src/sale-day.ts:49-68`). Stored lines pick a label by the order's way in SQL
  (`apps/server/src/working-order.ts:1204-1206`); a new basket picks it with `appliedVatClass`
  (`working-order.ts:955, 1016`; `packages/shared/src/dining.ts:15-19`). Advances: `ADVANCE_VAT_CLASS`
  on the day paid (`apps/server/src/bill-advances.ts:132-158`).
- **Not "as today" in one respect the spec does not say:** today an order line's LABEL is frozen at
  add time from the published menu version, and only its rate is looked up at issue. The suite
  `apps/server/src/vat-class-at-line-add.test.ts` pins that (describe at `:375`), and
  `docs/developers/products.md:170-190` and the guide (`apps/server/src/guide/en/products.md:17-19`,
  "A change of VAT class reaches the tills when the menu is published") say so. Under the spec
  ("Nothing about VAT is stored on an order line"), a takeaway line takes its product's rate as it
  stands when the ticket is issued: a rate edit reaches open orders at once and needs no publish.
  That suite and those texts are reversed by this plan (decision D11).
- Menu settings: `defaultProductVatClass`, fallback `"general"` (`packages/menu/src/settings.ts:13-47`),
  set from the pack at provisioning (`packages/menu/src/provisioning.ts:58-67`); Spain's pack says
  `"reduced"` (`packages/country-es/src/spain.ts:317`). `takeawayVat` is on `FiscalJurisdiction`
  (`packages/country/src/country.ts:56`), set on `ES-common` (`spain.ts:348`), read through
  `chargesTakeawayVat` (`packages/country-packs/src/registry.ts:107-112`) by
  `venueChargesTakeawayVat` (`packages/venue-service/src/dining.ts:17-21`) from the taxpayer's country
  and the venue settings' `fiscalTerritory` (default `"ES-common"`, `packages/db/src/venue-settings.ts:38`).
- The other supported area is `GB-vat` (`packages/country-gb/src/united-kingdom.ts:19-26`): filing
  and tax `"none"`, not offered for venue setup. Today it issues at Spain's rates, because the table
  is global. Its tests issue through `recordSale` with rates given, or through the server with a
  Spanish taxpayer (`apps/server/src/till-sale-integrated.test.ts:181-200`); the demo seed records
  GB practice sales through `rateLines` (`apps/server/scripts/demo-seed/seed-sales.test.ts:512-537`).

**Premises checked by running a command:**

- *Nothing after a sale reads a label.* `git grep -n -i "vatclass\|vat_class" packages/reporting packages/core packages/fiscal packages/fiscal-verifactu packages/adjustments packages/payments`
  printed only test files and test fixtures (`packages/adjustments/src/*.test.ts`,
  `packages/fiscal-verifactu/src/write-path.e2e.test.ts`, `packages/reporting/test/fixtures.ts`).
  The non-test files naming a label in `apps/server` are exactly `bill-advances.ts`, `menu-api.ts`,
  `modifier-selection.ts`, `set-menu-count.ts`, `upgrade-sale.ts`, `venue-detail-types.ts`,
  `venue-settings-api.ts`, `working-order.ts` and the scripts under `apps/server/scripts/`
  (`git ls-files | /usr/bin/grep -E '\.(ts|sql|json|md)$' | xargs /usr/bin/grep -lE 'vat_class|VAT_CLASSES|vatClass|VatClass|takeawayVatClass'`,
  filtered to non-test paths). No correction, refund, report, receipt or export file is among them.
- *No screen shows the till's `vatBreakdown`.* `git grep -n "\.vatBreakdown" apps/till/src` lists,
  outside tests, only `ticket.vatBreakdown` and correction answers, which are filed figures from the
  server; the getter at `apps/till/src/state/working-order.ts:530` is read by tests only.
- *No set-menu line is filed today.* `git grep -n "refuseSetMenuMoney\|payment_not_ready"` shows
  the refusal at `beginBillPayment`'s check (`apps/server/src/bill-payments.ts:1631`),
  `planAdjustment` (`apps/server/src/adjustments-apply.ts:817`) and `priceStoredOrderForIssuance`
  (`apps/server/src/working-order.ts:1269`). So `set_vat_class` and `set_takeaway_vat_class` decide
  no filed rate today; piece A keeps it that way until piece B (decision D2).

---

## Decisions (the planner's, for the owner)

Each has a recommended default; the plan is written to it. **D10 and D11 need the owner's yes
before the tasks that depend on them start** (named in each task).

- **D1. Four pull requests, in this order.** PR 1 stores the rates (nothing visible changes); PR 2
  switches takeaway to each product's own rate; PR 3 switches eat-in to the dine-in rate; PR 4
  removes the labels, which by then nothing reads. Takeaway goes first because today a blank
  takeaway label falls back to the eat-in label (`variant-fallback.ts:65-73`): removing eat-in first
  would leave takeaway resting on a field nobody can see. Between PR 2 and PR 4 the label columns
  and copy fields still exist and are still filled, but no rate is read from them — the grep in PR 2
  Task 2.8 and PR 3 Task 3.7 is the receipt. *Recommended.*
- **D2. Set menus until piece B.** `menus.set_vat_class`, `menus.set_takeaway_vat_class`, their
  checks, the set-menu form's two fields and the copy's `terms.vatClass`/`terms.takeawayVatClass`
  stay as they are, read by no sale path (set-menu money is refused today, above). Eaten here, a
  set-menu line files at the dine-in rate from PR 3. Taken away, a set-menu line has no product and
  so no rate until piece B: from PR 2 it is given an empty rate list and `rateLines` refuses it with
  `vat_rate.unavailable` — unreachable while `refuseSetMenuMoney` stands. A covered dish line has a
  product and files at that product's rate. PR 4 keeps `VatClass`/`VAT_CLASSES` in
  `packages/shared` for set menus only, deletes `VAT_RATE_TABLE`, and the set-menu form shows the
  label names without a percentage until piece B removes the fields. *Recommended.*
- **D3. Every top-level product has a rate from the beginning of time; a variant may have one.**
  `createProduct` writes it (the requested rate, else the venue default); `seedMenuItem` in
  `packages/db/src/testing/seed.ts:162-170`, which inserts a product raw, writes one; the configuration import refuses a bundle whose
  top-level product lacks exactly one such row; the demo creates products through `createProduct`.
  A line whose product has no rate is never guessed: `rateLines` refuses `vat_rate.unavailable`.
  A variant with no rows of its own takes its parent's (the spec's "my call", kept). An extra is a
  product and has its own. *Recommended.*
- **D4. In piece A, saving a product's or a variant's takeaway rate replaces its whole list with
  one row from the beginning of time.** That is a correction, which is what the one field means
  while piece C's "Change from" does not exist. Consequence: a takeaway meal that ended on an
  earlier day and is ticketed after the edit files at the new rate. Piece C must change this so an
  edit never erases a scheduled row. *Recommended.*
- **D5. The venue default takeaway rate is `defaultTakeawayVatRate: string | null` in the menu
  settings document; null reads as the area's default from the pack (Spain: `"10.00"`).** So the
  default comes only from the pack until a person changes it, and the two cannot disagree (the
  spec's aim). *Recommended.*
- **D6. `GB-vat` gets a dine-in list and a pick list of `"0.00"` only, and a default of `"0.00"`.**
  Its tax module is `"none"`; it is not offered for setup. Nothing a venue can do changes. The GB
  practice-sales demo test asserts the backend only, not a rate. *Recommended; the alternative is to
  give GB no lists and refuse, which breaks the GB demo seed.*
- **D7. The area is the taxpayer's country with the venue settings' `fiscalTerritory`,** as
  `venueChargesTakeawayVat` reads it. With no taxpayer, or an area without lists,
  `readVenueVatRates` refuses `vat_rate.area_unsupported`. A real venue has its taxpayer before any
  product (provisioning writes it first); about eight test files create products with no taxpayer
  and seed one. *Recommended.*
- **D8. The till's `vatBreakdown` is deleted in PR 2,** when the pricer stops taking labels (the
  spec's "my call"). *Recommended.*
- **D9. Where the area has no `takeawayVat`,** the takeaway field is hidden, products still get a
  row (the default), and every order is eaten here (`diningStartOf`, unchanged). The note "Eaten
  here: 10% (all food and drink)" shows in every area that has a dine-in list. *Recommended.*
- **D10. Changed money and VAT checks of the eat-in switch (PR 3) — owner's yes needed.** The spec
  states the new value (eaten here: the dine-in rate, 10% today), so a test that rings an eat-in
  product labelled `"general"` and pins 21% changes to 10% with base and VAT recomputed exactly. A
  test whose subject is two rates on one ticket (a breakdown, a correction across rates, a split by
  rate) instead becomes a takeaway order with two products at those two takeaway rates, keeping its
  figures. About 53 server test files are candidates (list in PR 3). The owner's rule calls a
  money/VAT change controversial unless the spec spells out the value; this asks the owner to
  confirm that "eaten here at 10%" spells it. *Recommended: yes.*
- **D11. Fiscal and guard tests that must change — owner's yes needed, each listed with its exact
  before and after:**
  - (a) `packages/fiscal-verifactu/src/write-path.e2e.test.ts`, "a variant line is filed at its
    own effective VAT rate" (`:697-787`): rewritten for takeaway rates, same filed figures (PR 2
    Task 2.5, exact text there).
  - (b) `apps/server/src/vat-class-at-line-add.test.ts` (all of it): the label-frozen-at-add
    property is reversed by the spec. PR 2 adds the takeaway replacement; PR 3 deletes the file and
    adds the eat-in replacement (Tasks 2.5, 3.1).
  - (c) `scripts/schema-constraints.test.ts`: PR 4 removes the five label check names it lists
    (`products_vat_class_ck` `:743`, `working_order_lines_offer_vat_class_ck` `:825`,
    `working_order_lines_vat_class_ck` `:830`, and the two `takeaway_vat_class` ones), because the
    columns are dropped; PR 1 adds the new table's key, indexes and check.
    `scripts/personal-log-params.test.ts:150` loses the `vat_rate.table_invalid.vatClass` row with
    the error. `scripts/behavioural-triggers.test.ts:231` stops naming the label columns in its
    insert.
  The golden huella case (`write-path.e2e.test.ts:573-695`) and `inmutabilidad.test.ts` stay
  unedited and must pass in every task. *Recommended: yes to all three.*
- **D12. The live-menu patcher (A1151) loses takeaway VAT in PR 2 and eat-in VAT in PR 3,** so
  after PR 3 a patch offers no VAT at all (`packages/menu/src/menu-patch.ts:101-104`). *Recommended.*
- **D13. Wire and storage shapes.** Rates travel as two-place decimal strings (`"7.50"`), as
  `sale_lines.vat_rate` does on the wire; they are stored in basis points through
  `stringToBasisPoints`/`basisPointsToDecimal` (`packages/shared/src/scales.ts:92-117`). The pack's
  lists are decimal strings. *Recommended.*
- **D14. "The rate today" on a screen is the rate in force on the venue's local calendar date,**
  read the way issue reads it (`readIssueZone` + `localCalendarDate`). *Recommended.*
- **D15. Error codes:** `vat_rate.area_unsupported` `{ country: string | null; territory: string }`,
  `vat_rate.unavailable` `{ lineNo: number }`, `vat_rate.schedule_invalid`
  `{ reason: "empty" | "first_entry_missing_or_dated" | "not_oldest_first" }`, all in
  `packages/shared/src/errors.ts`. The till words `vat_rate.unavailable` for the only line that can
  reach it, a takeaway set menu: "A set menu can't be charged when taken away yet. Cancel it and
  order its dishes separately." / "Todavía no se puede cobrar un menú para llevar. Anúlalo y pide
  sus platos por separado." *Recommended.*
- **D16. `product_takeaway_vat_rates` is listed in `scripts/write-path-tables.json` with one
  writer, `packages/menu/src/takeaway-vat-rates.ts`,** so the "every top-level product has a first
  row" rule lives in one file. The configuration import writes it through the generic table import,
  which names no table and so is outside what that guard reads (`scripts/write-path-tables.test.ts`,
  hedge 1). *Recommended.*

---

## Global Constraints

Every place piece A touches. Every task's requirements include this list.

- **Pre-live:** no data-migration or backwards-compatibility code. A schema change edits the
  TypeScript schema (hand-written SQL only in `packages/db/triggers/core.sql`) and rebuilds the core
  set's one starting migration: `pnpm --filter @waitron/server migration-baseline rebuild --set core`
  (on a rebase conflict take main's copy and rerun). **PR 1, PR 2 and PR 4 reset every venue; each
  PR's first line says "Reset test venues: FISCAL: …".** PR 2 resets because the menu settings
  document changes shape (strict parse, CLAUDE.md §3 settings rule). PR 3 changes no schema and no
  document shape.
- **Fiscal gates:** `computeHuella`, the chain, invoice-number allocation, `registros_facturacion`
  and its triggers, `recordSale`/`recordCorrection`/`recordSubstitution` do not change. Every task
  that touches `packages/menu/src/pricing.ts`, `apps/server/src/issue-moment.ts`, `sale-day.ts`,
  `working-order.ts`'s stored-line readers or `bill-advances.ts` runs, unedited and passing:
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts src/write-path.e2e.test.ts`
  (until D11(a) is applied, the variant case in that file is the old one).
- **New table** `product_takeaway_vat_rates` (file `packages/db/src/schema/menu/product-takeaway-vat-rates.ts`):
  `id` (`id`, primary key, `newId`), `product_id` (`id`, NOT NULL, foreign key
  `product_takeaway_vat_rates_product_fk` → `products.id` on delete cascade), `starts_on` (`day`,
  null = from the beginning of time), `rate` (`rate`, basis points, NOT NULL); unique index
  `product_takeaway_vat_rates_product_day_key` on (`product_id`, `starts_on`), partial unique index
  `product_takeaway_vat_rates_product_first_key` on (`product_id`) where `starts_on is null`
  (SQLite treats two nulls as distinct, so the first index alone would admit two first rows), check
  `product_takeaway_vat_rates_rate_ck` (`rate between 0 and 10000`). Classified `state` in
  `CORE_OWN_CLASSIFICATION` (`packages/db/src/classification.ts`, beside `products` at `:128`).
  Transferred: `{ name: "product_takeaway_vat_rates" }` after `products` in
  `CORE_CONFIGURATION_TRANSFER` (`packages/db/src/configuration-transfer.ts:180`). Writer list
  (D16). Column types only from `packages/db/src/schema/columns.ts`.
- **Columns removed in PR 4:** `products.vat_class`, `products.takeaway_vat_class` and their checks
  and the `vat_class` term of `products_top_level_owns_ck`; `working_order_lines.vat_class`,
  `.takeaway_vat_class`, `.offer_vat_class`, their three checks and the `offer_vat_class` term of
  `working_order_lines_context_ck`; the trigger lines named above in
  `working_order_lines_require_open_parent_update`. **Untouched:** `menus.set_*` (piece B),
  `sale_lines.vat_rate`, `sales.vat_breakdown`, every fiscal table.
- **Pack fields (PR 1):** on `FiscalJurisdiction` (`packages/country/src/country.ts`):
  `dineInVatRates?: readonly DatedVatRate[]`, `vatRates?: readonly string[]`,
  `defaultTakeawayVatRate?: string`; `ES-common`: `[{ from: null, rate: "10.00" }]`,
  `["0.00", "2.00", "4.00", "5.00", "7.50", "10.00", "21.00"]`, `"10.00"`; `GB-vat`: D6.
  `CountryPack.defaultProductVatClass` (`country.ts:155`) and Spain's `"reduced"` go in PR 4.
- **Shared names:** new `rateOn` (PR 1). Deleted in PR 4: `VAT_RATE_TABLE`, `VatRateTable`,
  `vatRateOn`, `vatRatesOn`, `ADVANCE_VAT_CLASS`, `appliedVatClass`, error `vat_rate.table_invalid`;
  the label fields of `MenuOffer`, `MenuOfferVariant`, `AvailableProduct`, `OfferedExtraItem`,
  `Product`, `ListedVariant.effective`, `ProductEditorValue`/`InheritedValues`
  (`packages/shared/src/menu-document/product-types.ts:85-86, 120-122, 173-176, 214-217`), and
  `SetMenuCopy.terms` (`packages/shared/src/set-menu-bill.ts:16, 56-62`). **Kept until piece B:**
  `VatClass`, `VAT_CLASSES`, `ServedSetMenuCopy.terms.vatClass/takeawayVatClass`.
- **Pricer (PR 2):** in `packages/menu/src/pricing.ts`, `PriceableProduct.vatClass`,
  `LockedLine.vatClass`, `GrossLine.vatClass`, `SelectedOption.vatClass` become
  `vatRates: readonly DatedRate[]`.
- **Module contract (PR 4):** `packages/module/src/module.ts:252-253, 308, 771` lose the label
  names.
- **Settings:** `MENU_SETTINGS` (`packages/menu/src/settings.ts`) gains `defaultTakeawayVatRate`
  (PR 2) and loses `defaultProductVatClass` (PR 4; hidden from people in PR 3). It is a module
  settings document (`defineSettingsDocument`/`saveSettings`, `transfers: true`), never a `venue`
  key in the configuration bundle.
- **Routes:** `GET /management-api/menu-settings` (`apps/server/src/menu-api.ts:135-142, 987`) gains
  `vatRates`, `defaultTakeawayVatRate` (PR 2) and `dineInVatRate` (PR 3);
  `PUT /management-api/venue-defaults` (`apps/server/src/venue-settings-api.ts:119-142, 419-423`)
  gains `defaultTakeawayVatRate` (PR 2) and loses `defaultProductVatClass` (PR 3);
  `POST /management-api/products`, `POST`/`PUT /management-api/products/…/editor`
  (`menu-api.ts:1564-1700`) take `takeawayVatRate` (PR 2) and refuse `vatClass` (PR 3); the menu
  patch routes lose the VAT fields (PR 2, PR 3). Set-menu routes unchanged (piece B).
- **Screens:** dashboard product editor (`apps/dashboard/src/widgets/product-editor.ts`), product
  list (`product-list.ts`), product details (`product-details.ts`), product browser
  (`product-browser.ts`, passes `takeawayVat`), menu patch dialog and review
  (`menu-patch-dialog.ts`, `menu-patch-review.ts`), venue defaults panel
  (`apps/dashboard/src/screens/venue-defaults-panel.ts`), the products and menus screens that pass
  settings down. Set-menu terms form (`set-menu-terms-form.ts`): unchanged until PR 4's
  names-only display (D2). Till: no screen changes; `apps/till/src/api/client.ts:368-421, 515-516`
  and `apps/till/src/state/draft-lines.ts:199` lose labels (PR 4).
- **Words:** `apps/dashboard/src/i18n/strings.ts` keys `menu_settings.default_vat`,
  `menu_settings.invalid`, `help.products.vat`, `editor.takeaway_vat*`, the `menu_patch.*` lines
  naming VAT classes, and `VAT_CLASS_NAMES`/`vatClassLabel` in `apps/dashboard/src/i18n/domain.ts`;
  `apps/dashboard/src/i18n/codes.ts`; the till's `apps/till/src/i18n/codes.ts` for D15. English and
  Spanish together.
- **Guides:** `apps/server/src/guide/en/products.md` and `es/products.md`: `{#vat}` section
  (`en :15-28`), the variant and price-line examples (`en :166`, `es :173`), the live-patch section
  (`en :347-358`, `es :364-401`). The set-menu sentence (`en :289`, `es :301-302`) is piece B's.
  Developer docs: `docs/developers/products.md:120-190`.
- **Demo data and fixtures:** `packages/country-es/src/demo/menu.ts` and the three regional files
  (`casa-delgado-ca.ts`, `-gl.ts`, `-valencia.ts`), `packages/country/src/demo.ts`, their test
  `packages/country-es/src/demo/data.test.ts:340-428`, the captured JSON under
  `packages/country-es/test-fixtures/demo/`, the demo seed (`apps/server/scripts/demo-seed/seed.ts`,
  `seed-menus.ts`, `seed-sales.ts`, `data-set.ts`, `data-set.typecheck.ts`) and its baseline test
  `seed.madrid-baseline.test.ts` with its transforms under `testing/`, the bench venue
  (`apps/server/scripts/bench/bench-venue.ts:369-376`), server fixtures under
  `apps/server/src/testing/` (`takeaway-menu.ts`, `venue-fixtures.ts`, `bill-venue.ts`,
  `party-venue.ts`, `split-extras-venue.ts`, `zone-payment-venue.ts`, `adjustment-venue.ts`,
  `advance-bills.ts`, `spare-join-scenario.ts`, `stream-pause-scenario.ts`,
  `set-menu-bill-fixture.ts`, `order-writer-fixture.ts`), `packages/db/src/testing/seed.ts`,
  `packages/menu/test/fixtures.ts`, `packages/menu/test/suggestion-fixture.ts`,
  `packages/reporting/test/fixtures.ts`, `packages/venue-service/src/testing/set-menu-fixtures.ts`,
  `packages/provisioning/test/configuration-bundle.ts`, till and dashboard test fixtures.
- **Guards to run when a task touches their area:** `scripts/schema-constraints.test.ts`,
  `scripts/append-only-triggers.test.ts`, `scripts/behavioural-triggers.test.ts`,
  `scripts/starting-migrations.test.ts`, `scripts/classification-complete.test.ts`,
  `scripts/two-file-foreign-keys.test.ts`, `scripts/write-path-tables.test.ts`,
  `scripts/id-columns-are-references.test.ts`, `scripts/english-only.test.ts`,
  `scripts/module-seams.test.ts`, `scripts/live-subscriptions.test.ts`,
  `scripts/personal-log-params.test.ts`, `scripts/errors-reachable.test.ts`,
  `scripts/guide-links.test.ts`, `apps/server/src/guide-content.test.ts`, and
  `packages/fiscal-verifactu/src/inmutabilidad.test.ts`. Root guards run from the worktree root:
  `pnpm exec vitest run scripts/<file>`.
- **Module seams:** generic code reaches the pack only through `@waitron/country-packs`'s registry
  (`scripts/module-seams.test.ts:262-293`: country implementations are named only by the registry);
  `packages/menu` and `apps/server` already import it.
- **Test commands:** `pnpm --filter <pkg> exec vitest run <file>`. Never `pnpm test <file> -t` (it
  drops the `-t`, CLAUDE.md §2). Read the `Tests` count, not the exit status. Each implementer's
  verify step includes `pnpm exec prettier --check` on the changed files, typecheck of each changed
  package (`pnpm --filter <pkg> typecheck`), and the focused suites the task names.
- **A1564 (custom item on the Counter, `docs/superpowers/plans/2026-11-21-counter-custom-item.md`,
  not yet built) — what piece A changes in its Global Constraints:**
  - "Every hidden product has `vat_class = 'reduced'` … each rate one has the class whose rate today
    is that rate" and "The `"unchosen"` one has `takeaway_vat_class = NULL`": after PR 2 a hidden
    product carries no label (PR 4 drops the columns); each rate product has one
    `product_takeaway_vat_rates` row from the beginning at its key's rate, and the `"unchosen"` one
    the venue default (D3 needs a row on every top-level product). Its rate products cover the
    pack's seven rates, not the four a label could name.
  - `customItemProduct`/`customItemRatesOn` (its Task 1) and the till's `customItemRates` (Task 8)
    read the pick list from `readVenueVatRates(tx).pickable` (and the till from the setup read),
    not `VAT_RATE_TABLE`.
  - Its Task 4 (the custom branch writing both VAT columns on the line) writes none; its Task 7
    (repointing at the takeaway switch, writing `takeaway_vat_class`) repoints `product_id` only:
    the rate follows the product at issue.
  - `takeawayRateBp` on the wire, keys `"2100"`, `"1000"` …: unchanged, consistent with basis
    points here.
  - Whichever lands first, the other is refreshed: if A1564 lands first, PR 2 Task 2.1 gives its
    hidden products rows and PR 4 removes their labels.

## Review Focus

The inputs no single task is built around, most likely to bite first; each has its test in the
named task.

1. **A takeaway dish and its extras at different rates** (burger 21%, a lemon-soda extra 0%): each
   line files at its own product's rate, never the dish's. Test in Task 2.5.
2. **A takeaway variant with no rate of its own, whose parent's rate is edited after the order was
   placed:** it files at the parent's new rate when the ticket is issued. Test in Task 2.5.
3. **An order switched between eaten here and taken away after lines were added** (A1522's
   switch, `order-dining.switch.test.ts`): the rate follows the order's way at issue; nothing stored
   goes stale. Tests in Tasks 2.5 and 3.1.
4. **A meal that ended before midnight and is ticketed after it, on the day a dated rate changes:**
   the meal's day's rate, both for the dine-in list (Task 3.1) and a product's dated row (Task 2.5).
5. **A rate that is not a whole percent** (`"7.50"`, 750 basis points) through the editor, the
   API, storage, a bundle export and import, and a filed line. Tests in Tasks 1.3 and 2.4.

---

## PR 1 — Rates and their storage (nothing visible changes)

**When it lands:** Spain's area carries its dine-in list and its pick list; every product created
from then on has a takeaway rate row at the area's default; a configuration bundle carries the rows
and an import refuses a product without one. Nothing reads the rows or the lists yet: tickets,
screens and the demo file exactly as before. First line: "Reset test venues: FISCAL: store each
product's takeaway VAT rate and Spain's rate lists (VAT rates A, PR 1)".

**Risks:** the madrid baseline test sees a new table with rows the seed writes; the configuration
import refusing old bundles (pre-live: there are none to keep).

### Task 1.1: The pack's lists and a dated-list lookup

**Files:**
- Modify: `packages/country/src/country.ts` (add `DatedVatRate`; the three optional fields on
  `FiscalJurisdiction`), `packages/country/src/index.ts` (export)
- Modify: `packages/country-es/src/spain.ts:341-350` (`ES-common` values), `packages/country-gb/src/united-kingdom.ts:19-26` (D6)
- Modify: `packages/country-packs/src/registry.ts` (`vatRatesFor`), `packages/country-packs/src/index.ts`
- Modify: `packages/shared/src/menu-document/vat-rates.ts` (`rateOn`), `packages/shared/src/errors.ts` (D15 codes), `packages/shared/src/index.ts`
- Test: `packages/country-packs/src/registry.test.ts`, `packages/country-es/src/spain.test.ts`,
  `packages/country-gb/src/united-kingdom.test.ts`, `packages/shared/src/menu-document/vat-rates.test.ts`

**Interfaces:**
- Produces: `interface DatedVatRate { readonly from: string | null; readonly rate: string }`
  (`@waitron/country`, structurally the same as shared's `DatedRate`).
- Produces: `interface AreaVatRates { readonly dineIn: readonly DatedVatRate[]; readonly pickable: readonly string[]; readonly defaultTakeaway: string }`
  and `vatRatesFor(country: string, territory: string): AreaVatRates | undefined` (`@waitron/country-packs`).
- Produces: `rateOn(schedule: readonly DatedRate[], date: string): Decimal` (`@waitron/shared`):
  checks `date` as `vatRateOn` does (`vat_rate.date_invalid`, `caller: "rateOn"`), refuses an empty
  list, a dated first entry, or one not oldest first (`vat_rate.schedule_invalid`), and returns the
  last entry whose `from` is null or ≤ `date`.

- [ ] **Step 1: Write the failing tests.**
  - registry: `vatRatesFor("ES", "ES-common")` equals
    `{ dineIn: [{ from: null, rate: "10.00" }], pickable: ["0.00","2.00","4.00","5.00","7.50","10.00","21.00"], defaultTakeaway: "10.00" }`;
    `vatRatesFor("GB", "GB-vat")` the D6 lists; `vatRatesFor("ES", "ES-canary")`, `("XX", "ES-common")`
    and `("ES", "missing")` are `undefined` (same shape as the `chargesTakeawayVat` case at
    `registry.test.ts:52-56`).
  - registry: every supported jurisdiction with `modules` in `COUNTRY_PACKS` has all three fields,
    its dine-in list's first `from` is null and the rest oldest first, every dine-in rate and the
    default are in its pick list.
  - shared: `rateOn([{from:null,rate:"10.00"},{from:"2027-01-01",rate:"4.00"}], "2026-12-31")` is
    `10.00` and `"2027-01-01"` is `4.00`; `rateOn([], "2026-01-01")` throws
    `vat_rate.schedule_invalid` `{ reason: "empty" }`; a dated first entry and an out-of-order list
    throw their reasons; `"2026-02-30"` throws `vat_rate.date_invalid`.
- [ ] **Step 2: Run, see them fail.** `pnpm --filter @waitron/country-packs exec vitest run src/registry.test.ts`
  and `pnpm --filter @waitron/shared exec vitest run src/menu-document/vat-rates.test.ts`.
- [ ] **Step 3: Implement.** `rateOn` reuses `rateIn` and the checks of `assertWellFormed` for one
  list (do not change `vatRateOn`/`vatRatesOn`; PR 4 deletes them).
- [ ] **Step 4: Run** the four test files, `pnpm exec vitest run scripts/module-seams.test.ts scripts/errors-reachable.test.ts scripts/personal-log-params.test.ts`,
  and typecheck `@waitron/country`, `@waitron/country-es`, `@waitron/country-gb`,
  `@waitron/country-packs`, `@waitron/shared`.
- [ ] **Step 5: Commit** — "VAT rates: Spain's dine-in rate and pick list in its pack".

### Task 1.2: The `product_takeaway_vat_rates` table

**Files:**
- Create: `packages/db/src/schema/menu/product-takeaway-vat-rates.ts`; export it through
  `packages/db/src/schema/menu/index.ts` and the `./schema/index.js` block of `packages/db/src/index.ts:385-401`
- Modify: `packages/db/src/classification.ts` (beside `products`), `packages/db/src/configuration-transfer.ts:180`,
  `scripts/write-path-tables.json` and the table list in `scripts/write-path-tables.test.ts`'s doc
  comment (D16), `scripts/schema-constraints.test.ts` (add the key to `EXPECTED_FOREIGN_KEYS`, the
  two indexes to `EXPECTED_UNIQUE_INDEXES`, the check to `EXPECTED_CHECK_CONSTRAINTS`)
- Modify: `packages/db/src/testing/seed.ts:162-170` (`seedMenuItem` writes its product a first row at 1000)
- Regenerate: `packages/db/drizzle/0000_baseline.sql`, `packages/db/drizzle/meta/0000_snapshot.json`
- Modify: `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` and its `testing/` transforms
  (the seed now writes one row per demo product; derive the expected rows from the captured
  fixture's top-level products, all at 1000 — the demo creates them through `createProduct` with
  the default after Task 1.3)
- Test: `packages/db/src/schema/menu/product-takeaway-vat-rates.test.ts`

**Interfaces:**
- Produces: `productTakeawayVatRates` (drizzle table) with `id`, `productId`, `startsOn`, `rate`,
  exported from `@waitron/db`.

- [ ] **Step 1: Write the failing test** (`useVenueDb({ migrations: [CORE_MIGRATIONS] })`, like
  `packages/db/src/schema/menu/migrations.test.ts:29-32`):
  - two rows for one product with `starts_on` null are refused `UNIQUE_VIOLATION`;
  - two rows for one product on the same day are refused; two on different days are accepted;
  - `rate` 10001 and −1 are refused `CHECK_VIOLATION`;
  - a row naming no product is refused `FOREIGN_KEY_VIOLATION`;
  - deleting the product deletes its rows.
- [ ] **Step 2: Run; it fails** (no table): `pnpm --filter @waitron/db exec vitest run src/schema/menu/product-takeaway-vat-rates.test.ts`.
- [ ] **Step 3: Implement** the schema (Global Constraints, "New table"), then
  `pnpm --filter @waitron/server migration-baseline rebuild --set core`.
- [ ] **Step 4: Run** the test, then
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/starting-migrations.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/write-path-tables.test.ts scripts/id-columns-are-references.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts`,
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts`, and
  `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed.madrid-baseline.test.ts`
  (run it after Task 1.3 lands too).
- [ ] **Step 5: Commit** — "VAT rates: a table for each product's dated takeaway rate".

### Task 1.3: The one reader and writer, and every new product gets a row

**Files:**
- Create: `packages/menu/src/takeaway-vat-rates.ts`; export from `packages/menu/src/index.ts`
- Modify: `packages/menu/src/operations.ts:990-1036` (`insertProduct` writes the row after the
  product insert), `packages/menu/src/errors.ts` if a field name is added
- Modify: `packages/menu/src/configuration-transfer.ts:220-270` (import checks)
- Modify: the ~8 test files that create products with no taxpayer (find them with the command in
  Step 4) to seed one (`seedTaxpayer`)
- Test: `packages/menu/src/takeaway-vat-rates.test.ts`, `packages/menu/src/configuration-transfer.test.ts`,
  `packages/provisioning/src/configuration-transfer.json-lists.test.ts` (round trip)

**Interfaces:**
- Consumes: `vatRatesFor` (Task 1.1), `productTakeawayVatRates` (Task 1.2).
- Produces (`@waitron/menu`):
  - `readVenueVatRates(tx: Transaction): Promise<AreaVatRates>` — refuses
    `vat_rate.area_unsupported` (D7).
  - `setTakeawayVatRate(tx: Transaction, productId: string, rate: string | null): Promise<void>` —
    replaces the product's rows with one row from the beginning at `rate` (D4); `null` clears a
    variant's own rows and is refused on a top-level product; a rate not in `pickable` is refused
    `product.invalid` `{ field: "takeawayVatRate" }`.
  - `readTakeawayVatSchedules(tx: Transaction, productIds: readonly string[]): Promise<Map<string, readonly DatedRate[]>>`
    — one query for all ids (CLAUDE.md §3: no per-line reads); oldest first; a variant with no rows
    maps to its parent's; a top-level product with no rows is absent.
  - `CreateProductInput.takeawayVatRate?: string`; `insertProduct` writes
    `input.takeawayVatRate ?? (await readVenueVatRates(tx)).defaultTakeaway` (PR 2 Task 2.1 puts the
    venue setting in front of the pack default).

- [ ] **Step 1: Write the failing tests:**
  - `"a new product starts at the area's default takeaway rate"`: `createProduct` with no rate →
    `readTakeawayVatSchedules` gives `[{ from: null, rate: "10.00" }]`.
  - `"a product created at 7.5% keeps it"`: `takeawayVatRate: "7.50"` → stored 750, read `"7.50"`.
  - `"a rate the area does not offer is refused"`: `"3.00"` → `product.invalid` `{ field: "takeawayVatRate" }`.
  - `"a variant with no rate of its own takes its parent's"`, and with its own row its own.
  - `"saving a rate replaces the whole list"`: a product with a dated row inserted directly, then
    `setTakeawayVatRate(…, "21.00")` → exactly `[{ from: null, rate: "21.00" }]`.
  - `"null clears a variant's own rate and is refused on a product"`.
  - `"no taxpayer refuses"`: `readVenueVatRates` on an empty venue → `vat_rate.area_unsupported`.
  - configuration import: a bundle whose top-level product has no first row is refused
    `setup.request_invalid` `{ field: "product_takeaway_vat_rates" }`; two first rows refused the
    same; a rate outside the importing area's list refused; a variant with no rows accepted; an
    exported venue round-trips its rows including a 750 one.
- [ ] **Step 2: Run; they fail:** `pnpm --filter @waitron/menu exec vitest run src/takeaway-vat-rates.test.ts src/configuration-transfer.test.ts`.
- [ ] **Step 3: Implement.** The import check reads `tables.product_takeaway_vat_rates` beside
  `tables.products` in `packages/menu/src/configuration-transfer.ts`.
- [ ] **Step 4: Run** the package suites `pnpm --filter @waitron/menu exec vitest run` and
  `pnpm --filter @waitron/provisioning exec vitest run src/configuration-transfer`; then find
  product creators without a taxpayer with
  `git grep -l "createProduct(" -- '*.test.ts' | xargs /usr/bin/grep -L "seedTaxpayer\|taxpayer\|applyVenue\|applyHistoricalTestVenue\|seedTenantWithSif\|Venue("`
  and run each listed file. Run `pnpm exec vitest run scripts/write-path-tables.test.ts scripts/english-only.test.ts`
  and `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed.madrid-baseline.test.ts`.
- [ ] **Step 5: Commit** — "VAT rates: every product gets a takeaway rate, and bundles carry them".

**Changed test checks, PR 1:**

| File | Before | After | Spec |
| --- | --- | --- | --- |
| `seed.madrid-baseline.test.ts` | no `product_takeaway_vat_rates` | one row per demo top-level product at 1000 | "A product's takeaway rate" |
| `scripts/schema-constraints.test.ts` | — | gains the table's key, two indexes, one check (adds only) | same |

---

## PR 2 — Taken away, each product's own rate

**When it lands:** a manager sets "VAT when taken away" on a product, a variant and an extra by
picking a percentage (0, 2, 4, 5, 7.5, 10, 21), where the area charges takeaway VAT; a variant can
be left at its product's rate. New products start at "New products start at", a venue default set
in the venue defaults panel. A takeaway ticket files each line at its product's takeaway rate on the
day the meal ended; a change applies to every takeaway ticket issued afterwards, open orders
included, with no publish. The live-menu patcher no longer offers takeaway VAT. The demo deli's
cheeses are 4% to take home, its cola, Coca-Cola Zero and bottled beer 21%, everything else 10%.
Eaten here is unchanged (labels, as today). First line: "Reset test venues: FISCAL: a takeaway line
files at its product's own dated takeaway rate (VAT rates A, PR 2)".

**Known dead data until PR 4:** `products.takeaway_vat_class` is no longer written; the copies'
`takeawayVatClass` and `working_order_lines.takeaway_vat_class` are still filled (by the fallback to
the eat-in label) and read by nothing that decides a rate. Task 2.8's grep is the receipt.

**Risks:** the stored-line reader and the new-basket pricer must load rates once per order, not per
line; the till's pricer type change; a fixture product inserted raw with no row now refuses a
takeaway ticket (`vat_rate.unavailable`) — fix the fixture, never the refusal.

**Order inside the PR:** 2.1 → 2.2 → 2.3 (pricer type change; the till breaks until 2.3, so run
2.2 and 2.3 back to back) → 2.4 → 2.5 (needs D11(a)(b)) → 2.6 → 2.7 → 2.8.

### Task 2.1: The product's own data carries a takeaway rate, not a label

**Files:**
- Modify: `packages/shared/src/menu-document/product-types.ts` (`Product.takeawayVatClass` →
  `takeawayVatRate: string`; `ListedVariant.effective.takeawayVatClass` → `takeawayVatRate: string`;
  the editor value's and inherited values' takeaway label → `takeawayVatRate: string | null` on a
  variant, `string` on a product)
- Modify: `packages/menu/src/operations.ts` (create/update product and `PRODUCT_COLUMNS`/`toProduct`:
  read today's rate via `readTakeawayVatSchedules`, D14; stop reading/writing
  `products.takeaway_vat_class`; drop the `VAT_CLASSES` check at `:1001-1003`), `product-editor.ts`
  (`:36-74, 181-200`), `product-editor-input.ts` (`:111-213`), `variants.ts` (variant save writes or
  clears the variant's own rows), `variant-fallback.ts` (remove `takeawayVatClass` from
  `effectiveProductColumns`; copies keep a `takeawayVatClass` computed as
  `coalesce(products.vat_class, parent.vat_class)` until PR 4)
- Modify: `packages/menu/src/settings.ts`, `settings-types.ts` (`defaultTakeawayVatRate: string | null`,
  D5; `readMenuSettings` returns the effective string; `saveMenuDefaultTakeawayVatRate(tx, rate: unknown, personId)`
  refuses a rate outside `pickable` `product.invalid` `{ field: "defaultTakeawayVatRate" }`),
  `operations.ts` `insertProduct` default → setting, else pack
- Modify: `packages/menu/src/menu-patch.ts:101-104`, `menu-patch-types.ts` (drop `takeawayVatClass`, D12)
- Test: `packages/menu/src/product-editor.test.ts`, `product-editor-input.test.ts`, `operations.test.ts`,
  `variants.db.test.ts`, `variant-fallback.test.ts`, `menu-patch.test.ts`, `settings.test.ts`
  (and the package's other suites the type change breaks)

**Interfaces:**
- Consumes: `setTakeawayVatRate`, `readTakeawayVatSchedules`, `readVenueVatRates` (Task 1.3).
- Produces: `Product.takeawayVatRate: string`; `ListedVariant.effective.takeawayVatRate: string`;
  editor body field `takeawayVatRate` (`string`, or `null` on a variant for "the product's");
  `MenuDefaults.defaultTakeawayVatRate: string`.

- [ ] **Step 1: Write the failing tests:** the editor round-trips `takeawayVatRate: "4.00"` on a
  product and `null` on a variant (effective `"4.00"`); a variant set to `"21.00"` reads its own; a
  `takeawayVatClass` in the editor body is refused as a retired field (`refuseRetiredFields`
  pattern); a patch naming `takeawayVatClass` is refused; with the venue default set to `"4.00"` a
  new product starts at 4%; `saveMenuDefaultTakeawayVatRate(tx, "3.00")` is refused.
- [ ] **Step 2: Run; they fail.** `pnpm --filter @waitron/menu exec vitest run src/product-editor.test.ts src/menu-patch.test.ts src/settings.test.ts src/variants.db.test.ts`.
- [ ] **Step 3: Implement.** Fixtures in this package that pass `takeawayVatClass` to
  `createProduct` now fail to compile: convert each to `takeawayVatRate` with the rate its label
  had (`general` 21.00, `reduced` 10.00, `super_reduced` 4.00, `zero` 0.00); a blank one takes the
  product's eat-in label's rate.
- [ ] **Step 4: Run** `pnpm --filter @waitron/menu exec vitest run` and typecheck `@waitron/menu`
  and `@waitron/shared`.
- [ ] **Step 5: Commit** — "VAT rates: a product and a variant carry a takeaway rate".

### Task 2.2: The pricer takes a list of rates per line; the server gives each line its list

**Files:**
- Modify: `packages/menu/src/pricing.ts` (`PriceableProduct`, `LockedLine`, `GrossLine`,
  `SelectedOption`: `vatClass` → `vatRates: readonly DatedRate[]`; `rateLines` uses `rateOn` per
  line and refuses an empty list `vat_rate.unavailable` `{ lineNo }`; the groups by rate are
  unchanged)
- Create: `apps/server/src/line-vat-rates.ts`
- Modify: `apps/server/src/working-order.ts` (`storedLineColumns` `:1195-1218` selects `dining` and
  the stored `vat_class` instead of the CASE; `toStoredLines` `:1306-1340` and both readers
  `readLockedLines`/`readLockedLinesForIssuance` attach lists from one `readLineVatRates` call;
  `priceOrderLines` `:905-1140` builds `product.vatRates` and each extra's from one call before the
  line loop), `apps/server/src/bill-advances.ts:132-158` (`vatRates: VAT_RATE_TABLE[ADVANCE_VAT_CLASS]`
  until PR 3), `apps/server/scripts/demo-seed/seed-sales.ts:255-280`
- Test: `apps/server/src/line-vat-rates.test.ts`, `packages/menu/src/pricing.test.ts`,
  `pricing.dated.test.ts`, `apps/server/src/issue-moment.test.ts`

**Interfaces:**
- Consumes: `readTakeawayVatSchedules` (Task 1.3), `rateOn` (Task 1.1).
- Produces: `readLineVatRates(tx: Transaction, dining: Dining, lines: readonly { productId: string | null; vatClass: VatClass }[]): Promise<(readonly DatedRate[])[]>`
  — taken away: the product's list, `[]` for a line with no product (a set-menu line, D2) or no
  rows (D3); eaten here: `VAT_RATE_TABLE[vatClass]` (PR 3 replaces this branch). One schedule read
  per call.

- [ ] **Step 1: Write the failing tests:** `rateLines` with one line at
  `[{null,"10.00"},{"2027-01-01","4.00"}]` and one at `[{null,"21.00"}]` on `"2027-01-01"` gives a
  4% and a 21% group; an empty list refuses `vat_rate.unavailable` `{ lineNo: 2 }`;
  `readLineVatRates` for a takeaway order gives a variant its parent's list and an extra its own;
  for a set-menu line `[]`; eaten here the label's table entry.
- [ ] **Step 2: Run; they fail:** `pnpm --filter @waitron/menu exec vitest run src/pricing.test.ts src/pricing.dated.test.ts`
  and `pnpm --filter @waitron/server exec vitest run src/line-vat-rates.test.ts`.
- [ ] **Step 3: Implement.** `priceStoredOrder` and `storedOrderTotal` read gross only and must not
  refuse; only `rateLines` refuses.
- [ ] **Step 4: Run** `pnpm --filter @waitron/menu exec vitest run`, the server's
  `issue-moment.test.ts`, `issuance-pass.test.ts`, `till-sale.test.ts`, `vat-rate-at-issue.test.ts`,
  `order-dining.filing.test.ts` (the last may fail until Task 2.5 converts its fixture), the fiscal
  gate command, and typecheck `@waitron/menu` and `@waitron/server` (the till fails until 2.3).
- [ ] **Step 5: Commit** — "VAT rates: each line is rated from a dated list, takeaway from its product".

### Task 2.3: The till stops pricing a VAT preview

**Files:**
- Modify: `apps/till/src/state/working-order.ts:142-160, 270-320, 504-536` (delete `vatBreakdown`,
  `#pricedOrder`, `#priced`, `#price`, the constructor's `price` parameter and `toPriceable`, D8)
- Modify/delete cases: `apps/till/src/state/working-order.test.ts:448-460, 1262-1272`,
  `working-order.customer-fallback.test.ts:39`, `draft-lines.test.ts:577`, `menu-refresh.test.ts:942`,
  and any `new WorkingOrder(price)` call in tests

- [ ] **Step 1:** Delete the cases that read `vatBreakdown`; keep every `total` assertion beside them.
- [ ] **Step 2: Implement** the deletion.
- [ ] **Step 3: Run** `pnpm --filter @waitron/till exec vitest run src/state` and typecheck `@waitron/till`.
- [ ] **Step 4: Commit** — "Till: drop the unshown basket VAT split".

### Task 2.4: Routes and the till's wording

**Files:**
- Modify: `apps/server/src/menu-api.ts` (`readMenuSettingsAnswer` `:135-142` adds
  `vatRates: string[]` and `defaultTakeawayVatRate: string`; product create `:1625-1700` and the
  editor routes `:1564-1620` take `takeawayVatRate`, refuse `takeawayVatClass`),
  `apps/server/src/venue-settings-api.ts:119-142, 419-423` and `venue-detail-types.ts:50`
  (`defaultTakeawayVatRate` on the venue defaults read and PUT), `apps/server/src/till-api.ts`
  error status for `vat_rate.unavailable` (409, beside `set_menu.payment_not_ready` at `:448`)
- Modify: `apps/till/src/i18n/codes.ts` (D15 words, English and Spanish)
- Test: `apps/server/src/menu-api.test.ts` (product and menu-settings cases, venue defaults
  `:6859-6900`), `apps/server/src/venue-details.test.ts`

- [ ] **Step 1: Write the failing tests:** POST a product with `takeawayVatRate: "7.50"`, read it
  back `"7.50"`; POST with `takeawayVatClass` → `management.request_invalid` `{ field: "takeawayVatClass" }`;
  GET menu settings shows `vatRates` (seven) and `defaultTakeawayVatRate: "10.00"`; PUT venue
  defaults `{ defaultTakeawayVatRate: "4.00" }` then a new product starts at 4%; `"3.00"` refused.
- [ ] **Step 2: Run; they fail:** `pnpm --filter @waitron/server exec vitest run src/menu-api.test.ts src/venue-details.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the two files, `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/english-only.test.ts`.
- [ ] **Step 5: Commit** — "VAT rates: product and venue-default routes take a takeaway rate".

### Task 2.5: Takeaway tickets — behaviour tests (needs the owner's yes on D11(a) and (b))

**Files:**
- Modify: `apps/server/src/testing/takeaway-menu.ts:20-41` (each product's `takeawayVatRate`:
  cola `"21.00"`, cheese `"4.00"`, cheese board `"4.00"`, burger `"21.00"`, lemon soda `"0.00"` — the
  rates their labels give today, so takeaway expectations do not move)
- Modify: `apps/server/src/vat-rate-at-issue.test.ts:495-515` (the takeaway describe: the juice gets
  rows `{null, 1000}` and `{"2027-01-01", 400}` inserted directly instead of the mocked table; same
  expectations `BEER_AT_10_PERCENT`/`BEER_AT_4_PERCENT`)
- Create: `apps/server/src/takeaway-vat-rate-at-issue.test.ts`
- Modify: `packages/fiscal-verifactu/src/write-path.e2e.test.ts:697-787` (D11(a), exact text below)
- Test: `order-dining.filing.test.ts`, `order-dining.switch.test.ts`, `order-dining.start.test.ts`,
  `order-dining.walk-up.test.ts`, `order-dining.read.test.ts`

- [ ] **Step 1: Write the failing tests** in `takeaway-vat-rate-at-issue.test.ts` (copy the setup of
  `vat-class-at-line-add.test.ts:1-370`):
  - `"a takeaway line files its product's rate as it stands when the ticket is issued"`: park a
    takeaway order of a 10% product, set the product to 21%, pay → 21% line. (This replaces the
    frozen-at-add property, D11(b).)
  - `"a variant with no rate of its own files at its parent's rate after the parent changes"`
    (Review Focus 2).
  - `"a dish and its extra file at their own products' rates"`: burger 21% with a lemon-soda extra
    0% → a 21% and a 0% group (Review Focus 1).
  - `"switched to eat here after lines were added, the order files at the eat-in rates"` and back
    (Review Focus 3).
  - `"a takeaway meal that ended on the eve of a dated row, ticketed the next day, files the eve's rate"`
    (Review Focus 4, with `mealEndedAt` through the close of day as
    `close-of-day.later-sale-date.test.ts` does).
  - `"a takeaway line whose product has no rate is refused, never guessed"`: a product inserted raw
    with no row → `vat_rate.unavailable`.
- [ ] **Step 2: Run; they fail** (before Task 2.2 the rate came from the frozen label):
  `pnpm --filter @waitron/server exec vitest run src/takeaway-vat-rate-at-issue.test.ts`.
- [ ] **Step 3: Rewrite the fiscal variant test** (only after the owner's yes on D11(a)). Before
  (`write-path.e2e.test.ts:697, 705-745, 757-758`, abridged to the lines that change):

  ```ts
  describe("a variant line is filed at its own effective VAT rate", () => {
      const parent = await createProduct(tx, { …, unitPrice: "4.00", vatClass: "reduced" });
      …
      await tx.update(products).set({ vatClass: "general" }).where(eq(products.id, wine175!.id));
      …
      return { offer: offer!, wine125: wine125!.id, wine175: wine175!.id };
    function lineFor(offer: MenuOffer, variantId: string): BasketItem {
      …
      return { product: { ...selected, descriptions: text.product, variantDescriptions: text.variant }, quantity: "1" };
    it("files a 10% line for the variant inheriting its parent's VAT and a 21% line for the one setting its own", async () => {
      …
      const priced = priceBasket([lineFor(offer, wine125), lineFor(offer, wine175)]);
  ```

  After (the same property for takeaway rates; the comment's "composed the way the order path
  composes it" now also means its rates come from `readTakeawayVatSchedules`, as
  `readLineVatRates` reads them):

  ```ts
  describe("a takeaway variant line is filed at its own effective takeaway VAT rate", () => {
      const parent = await createProduct(tx, { …, unitPrice: "4.00", vatClass: "reduced", takeawayVatRate: "10.00" });
      …
      await setTakeawayVatRate(tx, wine175!.id, "21.00");
      …
      const schedules = await readTakeawayVatSchedules(tx, [wine125!.id, wine175!.id]);
      return { offer: offer!, wine125: wine125!.id, wine175: wine175!.id, schedules };
    function lineFor(offer: MenuOffer, variantId: string, schedules: Map<string, readonly DatedRate[]>): BasketItem {
      …
      return { product: { ...selected, descriptions: text.product, variantDescriptions: text.variant, vatRates: schedules.get(variantId)! }, quantity: "1" };
    it("files a 10% line for the variant taking its parent's takeaway VAT and a 21% line for the one setting its own", async () => {
      …
      const priced = priceBasket([lineFor(offer, wine125, schedules), lineFor(offer, wine175, schedules)]);
  ```

  The expected Desglose stays exactly
  `[{ TipoImpositivo: "10.00", BaseImponibleOimporteNoSujeto: "4.09" }, { TipoImpositivo: "21.00", BaseImponibleOimporteNoSujeto: "4.55" }]`.
  The `vatClass: "reduced"` argument is removed in PR 4. Control before committing: set wine175's
  rate to `"10.00"` and see the second row come back `10.00`/`5.00`, then restore it.
- [ ] **Step 4: Run** the new file, the five `order-dining.*` files, `vat-rate-at-issue.test.ts`,
  and the fiscal gate command (golden case and `inmutabilidad` unedited).
- [ ] **Step 5: Commit** — "VAT rates: tests for takeaway lines at their products' rates".

### Task 2.6: The dashboard

**Files:**
- Modify: `apps/dashboard/src/api/client.ts` (`MenuSettingsAnswer` `:14` gains `vatRates`,
  `defaultTakeawayVatRate`; product and editor types `takeawayVatRate`; `VenueDefaults` `:710` gains
  `defaultTakeawayVatRate`; `putVenueDefaults` `:4188`), `apps/dashboard/src/api/live-queries.ts`
  (every read that lists `"products"` for a product's values also lists `"product_takeaway_vat_rates"`)
- Modify: `widgets/product-editor.ts` (`renderTakeawayTax` `:1491, 1572` and `:705-720, 960-970`:
  "VAT when taken away" is a list of the `vatRates` percentages, shown only with `takeawayVat`;
  required on a product; on a variant a first option "Same as {product} — {rate}%"),
  `widgets/product-list.ts:1059`, `widgets/product-details.ts:133`, `widgets/menu-patch-dialog.ts`
  (`:700-720, 800-815, 1015-1025`: no takeaway field), `widgets/menu-patch-review.ts`,
  `screens/venue-defaults-panel.ts:300-320` (add "New products start at" — a list of `vatRates`,
  shown only with `takeawayVat`), `screens/products-screen.ts`, `screens/menus-screen.ts` (pass the
  lists down)
- Modify: `apps/dashboard/src/i18n/strings.ts` (English and Spanish: `editor.takeaway_vat_same`
  becomes "Same as {product} — {rate}%"/"Igual que {product} — {rate} %"; `editor.takeaway_vat_gone`
  removed; new `menu_settings.default_takeaway_vat` "New products start at (VAT when taken away)" /
  "Los productos nuevos empiezan con (IVA para llevar)"; `help.products.vat` no longer says a change
  needs a publish), `apps/dashboard/src/i18n/codes.ts` for `takeawayVatRate` field refusals
- Test: `widgets/product-editor.test.ts`, `product-editor.unsaved.test.ts` if present,
  `product-list.test.ts`, `product-list.a11y.test.ts`, `product-details.test.ts`,
  `product-browser.test.ts`, `menu-patch-dialog.test.ts`, `screens/venue-defaults-panel` tests,
  `dashboard-app.settings-panels.test.ts`, `api/client-routes.test.ts`, `api/live-queries.test.ts`

- [ ] **Step 1: Write the failing tests:** the editor offers exactly the seven percentages, saves
  `takeawayVatRate: "7.50"`, shows the field only with `takeawayVat`, marks it required on a product
  (Forms contract), and on a variant offers "Same as" and saves `null`; the patch dialog shows no
  takeaway VAT field; the venue defaults panel saves `defaultTakeawayVatRate`; the a11y tests of
  the changed states pass in both themes.
- [ ] **Step 2: Run; they fail:** `pnpm --filter @waitron/dashboard exec vitest run src/widgets/product-editor.test.ts src/widgets/menu-patch-dialog.test.ts`.
- [ ] **Step 3: Implement** with the field primitives (no native `<select>`, CLAUDE.md §3) and
  `draftScopeFor`/`saveActionState` as the editor already uses them.
- [ ] **Step 4: Run** the listed suites (browser mode; check headroom first), then
  `pnpm exec vitest run scripts/live-subscriptions.test.ts scripts/native-form-fields.test.ts scripts/english-only.test.ts`.
  Open the editor in the dev stack (`wa-wt demo <worktree>`) and look at the field in both themes
  and at phone width.
- [ ] **Step 5: Commit** — "Dashboard: VAT when taken away is a percentage".

### Task 2.7: Demo data, the bundle fixture, the guides

**Files:**
- Modify: `packages/country/src/demo.ts` (demo product type: optional `takeawayVatRate`),
  `packages/country-es/src/demo/menu.ts` (deli cheeses `"4.00"`; the cola, Coca-Cola Zero and
  bottled beer at `:1230, 1266, 1342` `"21.00"`; the rest take the default), the regional files only
  if they set a takeaway label (they set `vatClass` only: leave them for PR 4)
- Modify: `packages/country-es/src/demo/data.test.ts:354-428` (the takeaway-class cases become
  takeaway-rate cases with the same products and the rates above; the eat-in case `:341-352` stays
  until PR 4)
- Modify: `apps/server/scripts/demo-seed/seed.ts:120-131`, `seed-menus.ts:185-195`, `data-set.ts:39-44`
  (pass `takeawayVatRate`), and the madrid baseline transforms (rows at 400 and 2100 for those
  products)
- Modify: `packages/provisioning/test/configuration-bundle.ts` (the table's rows)
- Modify: `apps/server/src/guide/en/products.md` and `es/products.md`: the `{#vat}` section's
  takeaway paragraph (`en :25-28`), the patch section's takeaway lines; `docs/developers/products.md:120-190`
  for takeaway
- Test: `packages/country-es/src/demo/data.test.ts`, `apps/server/scripts/demo-seed/seed.test.ts`,
  `seed-menus.test.ts`, `seed.madrid-baseline.test.ts`, `apps/server/src/guide-content.test.ts`

The new guide paragraph, English (write the Spanish twin from it):

> Where your region taxes takeaway food differently, **VAT when taken away** holds the rate this
> product is charged when it is taken away. Pick it from the list. A new product starts at **New
> products start at** in the venue's defaults. A variant can keep its product's rate. A change
> applies to every takeaway ticket from then on, including orders already open; you do not need to
> publish the menu.

- [ ] **Step 1: Change the demo test first** (the cheeses 4%, the three drinks 21%, every other
  product the default); run it, see it fail:
  `pnpm --filter @waitron/country-es exec vitest run src/demo/data.test.ts`.
- [ ] **Step 2: Implement** the demo data and the seed.
- [ ] **Step 3: Run** the demo and seed suites listed, `guide-content.test.ts`,
  `pnpm exec vitest run scripts/guide-links.test.ts`.
- [ ] **Step 4: Commit** — "Demo: takeaway rates as percentages; guides for VAT when taken away".

### Task 2.8: The receipt that no rate is read from a takeaway label

- [ ] **Step 1: Run** `git grep -n "takeawayVatClass\|takeaway_vat_class" -- 'apps/*/src/*.ts' 'packages/*/src/*.ts' ':!*.test.ts' ':!*/testing/*'`
  and check each hit is a write of the dead copy, a type, or set menus; none feeds `rateLines`.
  Paste the output into the PR description.
- [ ] **Step 2:** Run the server package suites the scoped CI will not (the till, dashboard and
  menu suites run in CI as changed packages); then `/finish-branch`.

**Changed test checks, PR 2:**

| File | Before | After | Spec |
| --- | --- | --- | --- |
| `fiscal-verifactu/src/write-path.e2e.test.ts:697-787` | eat-in labels `reduced`/`general` | takeaway rates 10%/21%, same Desglose | D11(a); "A variant may have its own rows" |
| `apps/server/src/vat-rate-at-issue.test.ts:495-515` | mocked `reduced` table | dated product rows, same figures | "A product's takeaway rate has dates too" |
| `apps/server/src/testing/takeaway-menu.ts` | labels | rates equal to the labels' | "Taken away: each line's product's takeaway rate" |
| `apps/till/src/state/*` `vatBreakdown` cases | basket split | deleted | "deleted rather than ported" |
| `packages/menu` editor/patch/settings suites | labels | rates; patch refuses takeaway VAT | "The dashboard" |
| `packages/country-es/src/demo/data.test.ts:354-428` | takeaway labels | takeaway rates, same rates | "Demo data" |

---

## PR 3 — Eaten here, one rate

**When it lands:** every line eaten or drunk on the premises files at the dine-in rate of the day
the meal ended (10% today), whatever the product; an advance files at the dine-in rate of the day it
was paid. The product editor has no eat-in VAT field; beside "VAT when taken away" it says "Eaten
here: 10% (all food and drink)". The venue defaults panel has no "VAT class for new products". The
patcher offers no VAT. No reset (no schema or document change).

**Known dead data until PR 4:** `products.vat_class` (written from the hidden
`defaultProductVatClass` for new products, because `products_top_level_owns_ck` still requires it),
`working_order_lines.vat_class`/`offer_vat_class` and the copies' `vatClass`: read by nothing that
decides a rate. Task 3.7's grep is the receipt.

**Risks:** the size of the test change (D10); a mock of the dated table in the LATER-SALE-DATE
suites moving to the registry must keep its expected values.

**Order inside the PR:** 3.1 makes the switch and leaves the D10 suites failing; 3.2–3.4 fix them;
the branch is green after 3.4. 3.5–3.7 follow.

### Task 3.1: The switch (needs the owner's yes on D10 and D11(b))

**Files:**
- Modify: `apps/server/src/line-vat-rates.ts` (eaten here: `readVenueVatRates(tx).dineIn` for every
  line; the `vatClass` input goes), its callers in `working-order.ts`; `apps/server/src/bill-advances.ts`
  (`vatRates: dineIn`; `ADVANCE_VAT_CLASS` no longer imported)
- Modify: `apps/server/src/menu-api.ts` (`readMenuSettingsAnswer` adds `dineInVatRate: string`, the
  rate today, D14; product routes refuse `vatClass` as retired), `packages/menu/src/operations.ts`
  and `product-editor-input.ts` (eat-in label no longer accepted from a person; `insertProduct`
  writes `vat_class` from `defaultProductVatClass`; a variant's own `vat_class` is never written),
  `packages/menu/src/menu-patch.ts`/`menu-patch-types.ts` (no `vatClass`, D12),
  `apps/server/src/venue-settings-api.ts` (`defaultProductVatClass` gone from the read and the PUT)
- Delete: `apps/server/src/vat-class-at-line-add.test.ts` (D11(b))
- Create: `apps/server/src/dine-in-vat-rate.test.ts`
- Modify (mock target only, from `@waitron/shared/src/menu-document/vat-rates.js` to the registry's
  `vatRatesFor` with a dated dine-in list; expected values unchanged — stop and ask if one moves):
  `apps/server/src/vat-rate-at-issue.test.ts:54-70`, `close-of-day.later-sale-date.test.ts`,
  `close-of-day.every-path.later-sale-date.test.ts`, `advance-corrections.later-sale-date.test.ts`,
  `issue-moment.test.ts`, `apps/server/scripts/demo-seed/seed-sales.dated.test.ts`
- Test: `apps/server/src/advance-money.test.ts`, `advance-final.test.ts`, `advance-deduction.test.ts`

- [ ] **Step 1: Write the failing tests** in `dine-in-vat-rate.test.ts` (setup from the deleted
  file): a walk-up, a held order, a tab round, a card payment and a card recovery of a product whose
  old label was `general` each file 10%; an extra under it files 10%; a product whose takeaway rate
  is 21% files 10% eaten here; an order switched from takeaway to eaten here after lines were added
  files 10% (Review Focus 3); with the registry mocked to `[{null,"10.00"},{"2027-01-01","5.00"}]`, a
  meal that ended on 31 December and is ticketed on 1 January files 10% (Review Focus 4); an advance
  paid on 1 January files 5%.
- [ ] **Step 2: Run; they fail:** `pnpm --filter @waitron/server exec vitest run src/dine-in-vat-rate.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new file, the mock-target files above, the advance files, `menu-api.test.ts`
  and the fiscal gate command. List the failing server files for Tasks 3.2–3.4 with
  `pnpm --filter @waitron/server exec vitest run` (check headroom first) and record the list in the
  commit message body.
- [ ] **Step 5: Commit** — "VAT rates: everything eaten here files at the dine-in rate".

### Tasks 3.2, 3.3, 3.4: Server tests that pinned an eat-in label's rate (D10)

Candidates (files asserting a 21% figure and building eat-in products labelled `general`, found
with `git grep -lE 'rate: "21\.00"|vatRate: "21\.00"|TipoImpositivo: "21|"21\.00"' -- 'apps/server/**/*.test.ts'`
filtered to files naming `vatClass: "general"` or one of the server fixtures above; 53 files).
Task 3.1's run is the real list; split it into three tasks of about eighteen files in this order:

- **3.2:** `adjustments-apply`, `advance-corrections`, `advance-final`, `advance-money`,
  `bill-lookup-api`, `bill-payments-api`, `bill-payments`, `cancel-invoiced-order`,
  `card-capture-mismatch`, `clock-unconfirmed-gate`, `close-of-day.every-path.later-sale-date`,
  `close-of-day.later-sale-date`, `collect-by-invoice`, `counter-handover`, `deferred-close-refusal`,
  `find-bill-bills`, `fiscal-remedy.staff-refund`, `full-comp.fiscal-identity`.
- **3.3:** `full-invoice-creation-date`, `invoice-correction-api`, `invoice-corrections`,
  `invoice-document`, `invoice-lookup-api`, `menu-api`, `order-dining.filing`,
  `order-portions.adjustments`, `orders-api`, `portion-sale-projection`, `receipt-adjustments`,
  `receipt-guests`, `receipt-issuer`, `receipt-language`, `report-api.categories-reconcile`,
  `report-api.categories`, `served`, `set-menu-bill-moves`.
- **3.4:** `set-menu-bill`, `set-menu-send`, `split-bill.fiscal`, `start-full-disk.e2e`,
  `table-signals`, `till-api.fiscal-sale-paths`, `till-api.move-dishes`, `till-api.receipt`,
  `till-sale-integrated.db`, `till-sale`, `till-sales.disk-full`, `transaction-receipt-api`,
  `unpaid-departure`, `venue-details`, `working-order.pay-and-dispatch`, `zone-core-capabilities`,
  `zone-preservation`, and any file Task 3.1's run lists that is not above.

Each task:
- [ ] **Step 1:** For each failing case decide its class (D10): a rate that is not the subject →
  recompute base and VAT at 10% exactly (`baseFromGross` arithmetic, to the cent); two rates as
  the subject → make the order taken away with two products at those takeaway rates, figures kept.
  Never loosen an assertion (no `toMatchObject` replacing a `toEqual`, no dropped field).
- [ ] **Step 2: Run** each changed file: `pnpm --filter @waitron/server exec vitest run src/<file>.test.ts`.
- [ ] **Step 3: Commit** — "VAT rates: tests expect eat-in lines at the dine-in rate (n of 3)",
  listing in the body every file and which class each case took.

### Task 3.5: Other packages' eat-in expectations

**Files:** the failing cases among `packages/venue-service` (4 candidate files), `packages/menu`
(4), `apps/till` (5), `apps/dashboard` (2) — found with the same grep per package — and
`packages/country-es/src/demo/data.test.ts:341-352` (stays: the labels still exist until PR 4).

- [ ] **Step 1:** Run each package's suite (`pnpm --filter <pkg> exec vitest run`), fix by D10's
  classes, run again, commit — "VAT rates: other packages expect eat-in at the dine-in rate".

### Task 3.6: The dashboard

**Files:**
- Modify: `apps/dashboard/src/widgets/product-editor.ts` (remove the eat-in VAT field for products
  and variants; add the note "Eaten here: {rate}% (all food and drink)" / "Para comer aquí: {rate} %
  (toda la comida y bebida)" from `dineInVatRate`, shown in every area with a list, D9),
  `product-list.ts` and `product-details.ts` (no eat-in VAT), `menu-patch-dialog.ts`/`menu-patch-review.ts`
  (no VAT), `screens/venue-defaults-panel.ts:311` (no "VAT class for new products"),
  `api/client.ts`, `i18n/strings.ts` (remove `menu_settings.default_vat`, `menu_settings.invalid`;
  the `menu_patch.*` lines naming VAT classes `:3860, 4013` and Spanish twins now say "prices"
  without VAT; `:4001` loses "VAT class"), `i18n/codes.ts`
- Test: the dashboard suites Task 2.6 listed, plus the `dashboard-app.*` suites that stub
  `getMenuSettings` (they gain `dineInVatRate`)

- [ ] **Step 1: Write the failing tests:** the editor shows no eat-in field and shows the note with
  `"10"`; the panel has no eat-in default; the patch dialog offers no VAT field.
- [ ] **Step 2–4:** run (fails), implement, run the suites and `scripts/english-only.test.ts`; look
  at the editor in both themes and at phone width.
- [ ] **Step 5: Commit** — "Dashboard: eaten here is one rate, shown beside the takeaway field".

### Task 3.7: Guides, developer docs, backlog, and the receipt

**Files:** `apps/server/src/guide/en/products.md` and `es/products.md` (`{#vat}` section `en :15-24`,
the price-line example `en :166`/`es :173`, the patch section), `docs/developers/products.md:120-190`,
`docs/backlog/fiscal.md` A445 (one sentence: since piece A everything eaten here is at one rate, so
only takeaway bills mix rates; an eaten-in bill would mix again only if the adviser rules that
drinks served without food take 21%, still open with him).

The `{#vat}` section's new first paragraph, English (write the Spanish twin from it):

> Everything eaten or drunk here is charged at one rate, shown beside the product's VAT field
> ("Eaten here: 10% (all food and drink)"). Waitron updates it when the law changes; there is
> nothing to set.

- [ ] **Step 1:** Edit; run `apps/server/src/guide-content.test.ts` and `scripts/guide-links.test.ts`.
- [ ] **Step 2: Receipt:** `git grep -n "vatClass\|vat_class\|VAT_RATE_TABLE\|vatRatesOn\|vatRateOn" -- 'apps/*/src/*.ts' 'packages/*/src/*.ts' ':!*.test.ts' ':!*/testing/*'`;
  check no hit feeds `rateLines` or a filed figure (set menus and dead copies only); paste it into
  the PR description. Then `/finish-branch`.
- [ ] **Step 3: Commit** — "Guides: one rate for eating in".

**Changed test checks, PR 3:**

| File | Before | After | Spec |
| --- | --- | --- | --- |
| `apps/server/src/vat-class-at-line-add.test.ts` | label frozen at add, eat-in | deleted; `dine-in-vat-rate.test.ts` | D11(b); "Nothing about VAT is stored on an order line" |
| the 53 D10 candidates (Tasks 3.2–3.4) | eat-in `general` at 21% | 10%, or takeaway at the two rates | D10; "Eaten here: the dine-in rate" |
| LATER-SALE-DATE and `vat-rate-at-issue` mocks | mocked label table | mocked registry list, same figures | "The ticket takes the rates of the day the meal ends" |
| `advance-*` | `reduced` (10%) | dine-in (10%), same figures | "Advances: the dine-in rate on the day paid" |
| dashboard editor/patch/panel suites | eat-in field | none; note shown | "Product editor" |

---

## PR 4 — No labels left

**When it lands:** nothing a person sees changes. The label columns, checks, trigger lines, type
fields, settings key, pack field, the rate table and every fixture's mention are gone, except set
menus' own two labels (piece B, D2). First line: "Reset test venues: remove VAT labels from
products, order lines and menu copies (VAT rates A, PR 4)".

**Order inside the PR:** 4.1 relaxes (the branch stays green) → 4.2–4.4 stop the source naming
labels → 4.5–4.9 sweep fixtures → 4.10 drops. Each task is green on its own. The sweeps are
deletions of label properties, columns and arguments; a test that asserted a label is deleted only
where the label was its whole subject (list each in the commit body); any other assertion change
stops the task.

### Task 4.1: Relax — the label columns become nullable and the type fields optional

**Files:** `packages/db/src/schema/menus.ts` (`products_top_level_owns_ck` loses the `vat_class`
term), `packages/db/src/schema/orders.ts` (`vat_class`, `takeaway_vat_class` lose NOT NULL; the
context check loses the `offer_vat_class` term), baseline rebuild;
`packages/shared/src/menu-document/menu-types.ts`, `product-types.ts`, `packages/menu/src/pricing.ts`
leftovers, `packages/module/src/module.ts:252-253, 308, 771` (label fields optional).
- [ ] Run `pnpm --filter @waitron/db exec vitest run src/schema`, the schema guards of Task 1.2, the
  fiscal gate command; typecheck every package (`pnpm -r typecheck`). Commit — "VAT labels: optional
  before removal".

### Task 4.2: Shared, menu and country source stop naming labels

**Files:** `packages/shared/src/dining.ts` (delete `appliedVatClass`), `set-menu-bill.ts` (drop the
`terms` pick), `set-menu-bill.fixtures.ts`; `packages/menu/src/` `menu-document.ts`, `menu-copy.ts`,
`menu-navigation.ts`, `offered-modifiers.ts`, `operations.ts`, `product-editor.ts`, `variants.ts`,
`variant-fallback.ts`, `settings.ts`/`settings-types.ts`/`provisioning.ts` (`defaultProductVatClass`
gone), `index.ts`; `packages/country/src/country.ts:155`, `demo.ts`; `packages/country-es/src/spain.ts:317`
and the demo files (`menu.ts`, the three regional files: every `vatClass`/`takeawayVatClass` line).
- [ ] Run `pnpm --filter @waitron/menu exec vitest run`, `@waitron/shared`, `@waitron/country-es`
  suites; commit — "VAT labels: shared, menu and country code stop naming them".

### Task 4.3: Server and venue-service source

**Files:** `apps/server/src/working-order.ts` (line writes `:1128-1133`, moves `:4899-4900, 5102-5103`,
the offer context `:4943`, the retrieved product `:5400, 5664`), `set-menu-count.ts:88-89`,
`modifier-selection.ts:23-24, 41-42, 155-156, 523-524`, `upgrade-sale.ts:95`, `menu-api.ts`
(product routes), `venue-detail-types.ts`, `line-vat-rates.ts` (no label input), the demo seed and
bench scripts; `packages/venue-service/src/operations.ts:1212-1255, 1422`.
- [ ] Run the server suites touching these files and the fiscal gate command; commit.

### Task 4.4: Till and dashboard source

**Files:** `apps/till/src/api/client.ts:368-421, 515-516`, `apps/till/src/state/draft-lines.ts:199`;
`apps/dashboard/src/api/client.ts:569` (`VatClass` stays only for set menus), `i18n/domain.ts`
(`vatClassLabel` shows the name only, D2), product widgets' leftover types.
- [ ] Run the till and dashboard suites for the changed files; commit.

### Tasks 4.5–4.9: Fixture sweeps (one package group each)

- **4.5:** `packages/menu` tests (~69 files), `packages/db` tests, `packages/shared`, `packages/country-es`
  tests, `packages/venue-service` tests, `packages/adjustments`, `packages/reporting`,
  `packages/media`, `packages/provisioning`, `packages/staffing`, `packages/fiscal-verifactu`
  (the `vatClass: "reduced"` argument left in Task 2.5's rewrite).
- **4.6:** `apps/server/src/testing/*` and `apps/server` test files `a…m`.
- **4.7:** `apps/server` test files `n…z` and `apps/server/scripts/**/*.test.ts`.
- **4.8:** `apps/till` tests (~108 files).
- **4.9:** `apps/dashboard` tests (~72 files) and `scripts/behavioural-triggers.test.ts:231`.

Each: list the files with
`git grep -lE 'vat_class|vatClass|takeawayVatClass|offer_vat_class|offerVatClass|defaultProductVatClass' -- <paths>`,
delete the label properties (`set_*` and set-menu `terms` stay), run the group's suites, commit with
the deleted-assertion list. A file that would need more than deletions goes back to the driver.

### Task 4.10: Drop

**Files:** `packages/db/src/schema/menus.ts` and `orders.ts` (drop the five columns and their five
checks), `packages/db/triggers/core.sql` (the trigger lines named in Global Constraints), baseline
rebuild; `packages/shared/src/menu-document/vat-rates.ts` (delete `VAT_RATE_TABLE`, `VatRateTable`,
`vatRateOn`, `vatRatesOn`, `ADVANCE_VAT_CLASS`; keep `VatClass`, `VAT_CLASSES`, `DatedRate`,
`rateOn`, the date helpers), `errors.ts` (`vat_rate.table_invalid` gone), `index.ts`; the label
fields deleted from the types Task 4.1 made optional; `scripts/schema-constraints.test.ts` and
`scripts/personal-log-params.test.ts` (D11(c)); the madrid baseline (dropped-column transforms)
and the captured JSON fixtures if the test reads labels from them; `docs/developers/products.md`
and `conventions-data.md` lines that state the current label model (historical entries keep a dated
pointer, CLAUDE.md §6).
- [ ] Run every guard in Global Constraints, the fiscal gate command, `pnpm -r typecheck`, and the
  receipt `git grep -nE 'vat_class|vatClass|takeawayVatClass|offer_vat_class|offerVatClass|VAT_RATE_TABLE|vatRatesOn|vatRateOn|defaultProductVatClass|appliedVatClass|ADVANCE_VAT_CLASS' -- ':!docs/superpowers' ':!docs/backlog*' ':!docs/compliance'`
  — every remaining hit is set menus (`set_vat_class`, `setVatClass`, `terms.vatClass`,
  `VAT_CLASSES` in set-menu code). Update `docs/backlog/fiscal.md`'s "VAT rates per product, eaten
  in or taken away" entry: piece A done, B and C next. Commit; `/finish-branch`.

**Changed test checks, PR 4:**

| File | Before | After | Spec |
| --- | --- | --- | --- |
| `scripts/schema-constraints.test.ts:743, 825, 830` and the two takeaway checks | listed | removed (columns dropped) | D11(c); "The eat-in label goes" |
| `scripts/personal-log-params.test.ts:150` | `vat_rate.table_invalid.vatClass` | removed with the error | same |
| `packages/country-es/src/demo/data.test.ts:341-352` | every eat-in product `reduced` | deleted (true by construction) | "Eaten here: one rate for everything" |
| every fixture naming a label | label property | deleted | "No labels" |

---

## What this changes elsewhere

- **A445 (a free item on a mixed-VAT bill, `docs/backlog/fiscal.md` A445; adviser answer 1.10,
  `docs/compliance/2026-11-15-adviser-answers.md:255`).** After PR 3 an eaten-in bill has one rate,
  advances included, so a free item on it can never shift VAT between rates: at one rate both
  methods give the same VAT (the adviser sheet says so). A445 still matters for takeaway bills that
  mix rates — the deli's 4% cheese, 10% food, 21% cola — which piece A keeps. It would matter for
  eaten-in bills again only if the adviser rules that drinks served without food take 21%. PR 3 Task
  3.7 adds that sentence to A445; nothing else in A445 changes.
- **A1515-SET-MENU-BILL Task 3** (`docs/superpowers/plans/2026-11-18-a1515-set-menu-bill.md:328-357`,
  giving covered dishes their set menu's labels) **is no longer needed** (the spec's "What this
  changes elsewhere"): eaten here every line is at the dine-in rate; taken away, a set-menu line has
  no rate until piece B, and a covered dish files at its own product's rate. If piece 4 lands
  before piece B, its removal of `refuseSetMenuMoney` must keep refusing a *takeaway* set-menu bill
  until piece B (otherwise `vat_rate.unavailable` is the refusal staff see); its decision 4 and the
  four Task 3 tests are dropped.
- **`docs/backlog/fiscal.md` "VAT rates per product, eaten in or taken away"** is not changed by
  this commit: the split into four PRs changes nothing it says. PR 4 records piece A as done.
- **A1564** — see Global Constraints.
