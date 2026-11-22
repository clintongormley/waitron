# VAT rates, piece A: rates from the country pack, and a product's dated takeaway rate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`.

**Goal:** Every ticket files food and drink eaten here at the one dine-in rate Waitron ships with
dates, and food and drink taken away at each product's own dated takeaway rate; nobody sees or
picks a VAT label ("general", "reduced", "super-reduced", "zero") for a product. The label columns
and fields nothing reads any more are removed by piece B's last PR (see "What piece A leaves in
place at its end").

**Architecture:** Spain's fiscal area in `packages/country-es` carries two lists, the dated dine-in
rate and the rates a person may pick. A new `state` table, `product_takeaway_vat_rates`, holds each
product's dated takeaway rate in basis points. Nothing about VAT is stored on an order line: when a
ticket is issued, each line is given a dated list of rates (the dine-in list when eaten here, its
product's takeaway list when taken away) and `rateLines` picks the entry in force on the day the
meal ended, exactly as it picks a label's entry today. Piece A lands as four pull requests: storage,
the takeaway switch, the eat-in switch, and the eat-in screens and guides.

**Size (estimated, lines added/removed):**

| PR | Tasks | Production | Tests | Other |
| --- | --- | --- | --- | --- |
| 1 Storage | 5 | +400/−10 | +750 | baseline +200 (generated), backlog +6 |
| 2 Takeaway | 11 | +750/−450 | +1,250/−650 | guides +15/−10 |
| 3 Eat-in switch | 14 | +30/−30 | +900/−1,700 | golden JSON ~262 lines changed |
| 3b Eat-in screens | 4 | +80/−250 | +150/−200 | guides +10/−25 |
| L (piece B's, below) | 19 | +40/−600 | −2,500 | baseline −100 (generated) |

Estimates from the files each task names and the measured fixture counts, not from a build.

**Tech Stack:** TypeScript 7, drizzle (core migration set, `migration-baseline rebuild --set core`),
Hono routes in `apps/server`, `packages/menu`, `packages/country*`, Lit screens in
`apps/dashboard` and `apps/till`, Vitest 4.

**Spec:** [docs/superpowers/specs/2026-11-21-vat-rates-design.md](../specs/2026-11-21-vat-rates-design.md)
(approved by the owner 21 November 2026, "y"; on `main` at `5069c16f65`). Piece A is "The pieces,
for planning", item A. Read the whole spec before Task 1.1. **This plan is approved by nobody
yet**; its first fresh read is `~/waitron-campaign-l/receipts/vat-rates-a-plan-read-1.md`, whose
findings are folded in below.

**Lane and landing:** fiscal — it changes the rate a ticket is filed at. **The owner lands every
PR of this plan.** Every commit `git commit -s`.

---

## What today's code does (read on `main` at `e2f075c59e`)

The spec cites `main` at `58432f9af9`; every citation it makes was re-read. Statements here come
from reading the code, except the commands quoted, which were run.

- Labels and the rate table: `VAT_CLASSES`/`VatClass` (`packages/shared/src/menu-document/vat-rates.ts:5-6`),
  `ADVANCE_VAT_CLASS = "reduced"` (`:9`), `DatedRate` (`:15-18`), `VAT_RATE_TABLE` (`:26-31`),
  `vatRateOn`/`vatRatesOn` (`:91-115`), `localCalendarDate`/`localToday` (`:117-126`).
- Products: `vat_class`, `takeaway_vat_class` (`packages/db/src/schema/menus.ts:139-142`);
  `products_top_level_owns_ck` requires `vat_class` on a top-level product (`:186`); checks
  `:188-189`. The effective takeaway label is `coalesce(takeaway, vat_class, parent.takeaway,
  parent.vat_class)` (`packages/menu/src/variant-fallback.ts:65-73`): a variant that sets only its
  eat-in label is taken away at that label too. Piece A changes that: such a variant takes its
  product's takeaway rate (pre-live, no data carries it).
- Set menus: `set_vat_class`, `set_takeaway_vat_class` (`menus.ts:52-53`, checks `:71-76`). A
  set-menu line copies them from the copy's terms (`apps/server/src/set-menu-count.ts:88-89`).
- Order lines: `vat_class`, `takeaway_vat_class`, NOT NULL (`packages/db/src/schema/orders.ts:238-241`),
  `offer_vat_class` (`:293`), checks `:349-355`, `:430-431`, context check `:443`. The freeze
  trigger `working_order_lines_require_open_parent_update` (`packages/db/triggers/core.sql:371-605`)
  names them at `406-407`, `440`, `478-479`, `533`, `565-566`, `600` (spec said `:430-431`).
  `sale_lines.vat_rate` is `sales.ts:243` (spec: `:241`).
- Published copies: labels on `MenuOffer`, `MenuOfferVariant`, `AvailableProduct`, `OfferedExtraItem`
  (`menu-types.ts:35-36, 68-69, 118-119, 167-168`) and the set-menu copy's terms (`set-menu-types.ts:31-32`).
- Where a label becomes a rate: `rateLines` (`packages/menu/src/pricing.ts:214-255`; it groups by
  the rate's literal, `:216`). Its only callers are `issue-moment.ts:46`, `bill-advances.ts:132` and
  `apps/server/scripts/demo-seed/seed-sales.ts:275` (grep, run). The gross lines it rates come only
  from `priceStoredOrderForIssuance` (`working-order.ts:1441-1458`, through `priceOrderInvoice`
  `:7691-7721`) and from a new basket priced by `priceOrderLines` (`:905-1140`). `readLockedLines`
  (`:1235-1246`) also feeds `storedOrderTotal` on every edit (`:1366-1419`), the adjustment grouping
  (`adjustments-apply.ts:470, 659, 766`) and rebuilt tickets, none of which rates anything.
- **Not "as today" in one respect the spec does not say:** a line's LABEL is frozen at add time from
  the published menu, and only its rate is looked up at issue (`apps/server/src/vat-class-at-line-add.test.ts`
  pins it; `docs/developers/products.md:170-190`; the guide, `apps/server/src/guide/en/products.md:17-19`).
  Under the spec ("Nothing about VAT is stored on an order line"), a takeaway line takes its
  product's rate as it stands when the ticket is issued: a rate edit reaches open orders at once,
  needs no publish, and also reaches an order issued again after its invoice was credited (split
  after print, a cancelled invoiced order), whose new invoice can then differ in rate from the one
  it replaces (D4, D11(b)).
- Menu settings: `defaultProductVatClass`, fallback `"general"` (`packages/menu/src/settings.ts:13-47`),
  set from the pack at provisioning (`provisioning.ts:58-67`); Spain says `"reduced"` (`spain.ts:317`).
  `takeawayVat` (`packages/country/src/country.ts:56`, `spain.ts:348`) is read through
  `chargesTakeawayVat` (`country-packs/src/registry.ts:107-112`) from the taxpayer's country and the
  venue settings' `fiscalTerritory` (default `"ES-common"`, `packages/db/src/venue-settings.ts:38`).
- `GB-vat` (`packages/country-gb/src/united-kingdom.ts:19-26`): filing and tax `"none"`, not offered
  for setup; it issues at Spain's rates today because the table is global.
- **The Spanish practice-sales golden** (`apps/server/scripts/demo-seed/seed-sales.golden.test.ts`)
  compares a Spanish venue's practice sales, records and hashes included, with
  `testing/spanish-practice-sales.golden.json`; its header says "stop; never re-record to make it
  pass" (`:5-8`). Its five products are eaten in at `general`, `reduced`, `super_reduced`, `zero`,
  `reduced` (`:134-170`); it gives no deli products, so every sale is eaten in (`seed-sales.ts:231`).
  Read with Python: 31 sales, 68 lines, 40 lines not at 10%, 25 sales with such a line, the first
  record (secuencia 1) among them, VAT summed over the copy €73.66.

- **The VAT return reports four rates.** `mapModelo303` (`packages/reporting/src/modelo-303.ts:35-59`)
  has boxes for `4.00`, `10.00`, `21.00` and `0.00` only, and throws a plain `Error` for any other
  rate ("modelo 303 has no devengado box for rate …"); its comment says the 5% row is gone from the
  2026 form. The route `GET /management-api/reports/modelo-303` calls it (`apps/server/src/report-api.ts:315`).
  `pnpm --filter @waitron/reporting exec vitest run src/modelo-303.test.ts` passed 11, including
  "refuses a rate with no verified box (the retired 5%)" (`:152-162`). Labels could only reach those
  four rates; the owner's pick list of seven could not (D18). The spec's "reports … None of them
  needs to change" does not hold for this one.

**Premises checked by running a command:**

- *Nothing after a sale reads a label.* `git grep -n -i "vatclass\|vat_class" packages/reporting packages/core packages/fiscal packages/fiscal-verifactu packages/adjustments packages/payments`
  printed only test files and fixtures. The non-test `apps/server` files naming a label are exactly
  `bill-advances.ts`, `menu-api.ts`, `modifier-selection.ts`, `set-menu-count.ts`, `upgrade-sale.ts`,
  `venue-detail-types.ts`, `venue-settings-api.ts`, `working-order.ts` and `scripts/`. No correction,
  refund, report, receipt or export file is among them.
- *No screen shows the till's `vatBreakdown`.* `git grep -n "\.vatBreakdown" apps/till/src`: outside
  tests only filed figures (`ticket.vatBreakdown`, correction answers); the getter at
  `apps/till/src/state/working-order.ts:530` is read by tests only.
- *A set-menu line IS filed today, on the path that records money already moved.* (The first draft
  of this plan said otherwise; the plan read disproved it.) `refuseSetMenuMoney` sits at
  `bill-payments.ts:1631`, `adjustments-apply.ts:817` and `working-order.ts:1269`, but the issuing
  reader skips it when `refuseUnsentUnavailable` is false (`working-order.ts:1269`), which is how
  money already captured is recorded (`bill-payments.ts:1170`, `:1323`, `:2343`).
  `pnpm --filter @waitron/server exec vitest run src/set-menu-money.test.ts` passed 17, including
  "recovers a captured card payment that covers the whole set-menu bill without another charge"
  (`:307-352`), which files one sale of 26.00 on a set-menu bill. A takeaway set-menu bill is
  allowed (`set-menu-bill.ts:88-91`). So the set-menu line's labels decide a filed rate today (D2).

---

## Decisions (the planner's, for the owner)

Each has a recommended default; the plan is written to it. **D10, D11 and D17 need the owner's yes
before the tasks that depend on them start** (each task names its gate).

- **D1. Four pull requests in piece A, in this order:** PR 1 storage (no visible change); PR 2
  takeaway at each product's own rate; PR 3 eat-in at the dine-in rate; PR 3b the screens and guides
  for it. Takeaway goes first because a blank takeaway label falls back to the eat-in label
  (`variant-fallback.ts:65-73`). Removing the labels nothing reads any more is **not** in piece A:
  it is piece B's last PR ("PR L", the section "For piece B's planner"), after piece B removes set
  menus' own labels and so the last reader of `VatClass`, `VAT_RATE_TABLE` and `vatRateOn` (the
  watcher's call, 2026-11-22). After PR 3b the label columns and copy fields still exist and are
  filled, but no product line's rate is read from them; Tasks 2.11 and 3b.4 paste the grep that
  shows it. *Recommended.*
- **D2. Set-menu lines until piece B.** A set-menu line has no product. Eaten here it files at its
  `vat_class` label until PR 3, and at the dine-in rate from PR 3. **Taken away it files at its set
  menu's own takeaway label, as today** (`set-menu-count.ts:89`), read from the line's
  `takeaway_vat_class`, so money already moved on a takeaway set-menu bill is still stored. Piece B
  replaces that read with its own rule before PR L drops the column; piece A adds no other read.
  `menus.set_vat_class`/`set_takeaway_vat_class`, their checks, the set-menu form's two fields
  (still showing percentages), the copy's terms labels, and in `packages/shared` `VatClass`,
  `VAT_CLASSES`, `VAT_RATE_TABLE`, `vatRateOn` and `vat_rate.table_invalid` stay until piece B, for
  set menus only. Piece B replaces the takeaway source with its rule (the one rate a set menu's
  products share). A covered dish line has a product and files at its own product's rate. The
  set-menu form's eat-in field decides nothing from PR 3; piece B removes it (hiding it earlier
  would need a stand-in value for `menus_set_terms_ck`, `menus.ts:71-72`). *Recommended.*
- **D3. Every top-level product has a rate from the beginning of time; a variant may have one.**
  `createProduct` writes it (the requested rate, else the venue default); the five fixtures that
  insert top-level products raw write one — `seedMenuItem` (`packages/db/src/testing/seed.ts`),
  `packages/venue-service/src/testing/set-menu-fixtures.ts`, `plantStoredProduct`
  (`packages/menu/test/fixtures.ts`), `addPlainProducts` (`packages/menu/test/suggestion-fixture.ts`)
  and `seedFiredLine` (`packages/reporting/test/fixtures.ts`); the
  configuration import refuses a top-level product without exactly one such row; the demo creates
  products through `createProduct`. A product line with no rate is refused `vat_rate.unavailable`,
  never guessed — no venue can reach it. A variant with no rows takes its parent's (the spec's "my
  call", kept). An extra is a product and has its own. *Recommended.*
- **D4. In piece A, saving a product's or a variant's takeaway rate replaces its whole list with one
  row from the beginning of time** — a correction, which is what the one field means until piece C.
  Consequences: a takeaway meal ended on an earlier day and ticketed after the edit files at the new
  rate, and so does a re-issued credited order (above). Piece C must change this so an edit never
  erases a scheduled row. *Recommended.*
- **D5. The venue default is `defaultTakeawayVatRate: string | null` in the menu settings document;
  null reads as the area's default from the pack (Spain `"10.00"`).** *Recommended.*
- **D6. `GB-vat` gets a dine-in list, a pick list and a default of `"0.00"` only.** This is a
  stand-in for an area with no tax regime, not UK law. Its practice sales move from Spain's 10%/21%
  to 0%; `seed-sales.test.ts:512-537` asserts only the backend, not a rate (read). *Recommended;
  the alternative, no lists and a refusal, breaks the GB demo seed.*
- **D7. The area is the taxpayer's country with the venue settings' `fiscalTerritory`.** No
  taxpayer, or an area without lists: `vat_rate.area_unsupported`. *Recommended.*
- **D8. The till's `vatBreakdown` is deleted in PR 2** (the spec's "my call"). *Recommended.*
- **D9. Where the area has no `takeawayVat`,** the takeaway field is hidden, products still get the
  default row, every order is eaten here; the note "Eaten here: 10% (all food and drink)" shows in
  every area with a dine-in list. *Recommended.*
- **D10. Changed money and VAT checks of the eat-in switch (PR 3) — needs the owner.** A test that
  rings an eat-in product labelled `general` and pins 21% changes to 10% with base and VAT
  recomputed to the cent; a test whose subject is two rates on one ticket (a breakdown, a
  correction across rates, a split by rate) becomes a takeaway order with two products at those
  takeaway rates, figures kept. About 53 server files are candidates (Tasks 3.4–3.12). This asks
  the owner to confirm that "eaten here: the dine-in rate, 10% today" spells out the new value.
  *Recommended: yes.*
- **D11. Fiscal and guard tests that change — needs the owner** ((c) lands with PR L, in piece B):
  - (a) `packages/fiscal-verifactu/src/write-path.e2e.test.ts` "a variant line is filed at its own
    effective VAT rate" (`:697-787`, eaten in, a variant with its own `general` label at 21%). PR 2
    leaves it untouched, so a variant with its own eat-in label stays covered while eat-in still
    reads labels, and ADDS a takeaway twin beside it (Task 2.4, exact text there; adding a test
    needs no yes). PR 3 Task 3.1 DELETES the eat-in describe, because from PR 3 no line eaten in
    has a variant rate; its replacement is Task 3.1's "a variant with its own `general` label files
    10% eaten here". The deletion is what needs the owner's yes.
  - (b) `apps/server/src/vat-class-at-line-add.test.ts` deleted in PR 3: its label-frozen-at-add
    property is reversed by the spec (consequences in D4). Replaced by Task 2.3's takeaway file and
    Task 3.1's eat-in file.
  - (c) `scripts/schema-constraints.test.ts` lists three label checks (`products_vat_class_ck`
    `:743`, `working_order_lines_offer_vat_class_ck` `:825`, `working_order_lines_vat_class_ck`
    `:830`); PR L removes those three entries with their columns (the two takeaway checks are not
    listed). PR 1 adds the new table's key, two indexes and check. `scripts/behavioural-triggers.test.ts:231`
    stops naming the label columns in its insert (PR L). `scripts/personal-log-params.test.ts:150`
    is unchanged: `vat_rate.table_invalid` stays with set menus (D2).
  The golden huella case (`write-path.e2e.test.ts:573-695`) and `inmutabilidad.test.ts` stay
  unedited and pass in every task. *Recommended: yes to all three.*
- **D12. The live-menu patcher loses takeaway VAT in PR 2 and eat-in VAT in PR 3.** *Recommended.*
- **D13. Rates travel as two-place decimal strings (`"7.50"`) and are stored in basis points**
  (`stringToBasisPoints`/`basisPointsToDecimal`, `packages/shared/src/scales.ts:92-117`). **One rate
  has one spelling:** `rateOn` returns `toScale(decimal(rate), RATE_SCALE)`, so a list entry written
  `"7.5"` and a stored 750 both group as `"7.50"` in `rateLines` (`pricing.ts:216` keys its groups by
  the literal); the registry test also asserts every pack entry equals
  `basisPointsToDecimal(stringToBasisPoints(entry))`. *Recommended.*
- **D14. "The rate today" on a screen is the rate in force on the venue's local date,** read as
  issue reads it (`readIssueZone` + `localCalendarDate`). *Recommended.*
- **D15. Error codes** in `packages/shared/src/errors.ts`: `vat_rate.area_unsupported`
  `{ country: string | null; territory: string }`, `vat_rate.unavailable` `{ lineNo: number }`,
  `vat_rate.schedule_invalid` `{ caller: "rateOn"; reason: "first_entry_missing_or_dated" | "not_oldest_first" }`
  (an empty list reports `first_entry_missing_or_dated`).
  No till words: after D2 no venue can reach either refusal, and the till's table already degrades a
  code it does not list to its generic sentence (`apps/till/src/i18n/codes.ts:5-6`). *Recommended.*
- **D16. `product_takeaway_vat_rates` is listed in `scripts/write-path-tables.json` with one writer,
  `packages/menu/src/takeaway-vat-rates.ts`;** the configuration import writes it through the generic
  table import, which names no table and so is outside that guard (`write-path-tables.test.ts:26-40`,
  hedge 1). *Recommended.*
- **D17. The Spanish practice-sales golden after PR 3 — needs the owner.** Its header forbids
  re-recording to make it pass, so the owner decides. Today: 31 eaten-in sales whose lines are at
  21%, 10%, 4% and 0%. Options:
  - **(a, recommended)** keep its inputs and re-record once, in Task 3.2: every line eaten in at
    10%. Unchanged: the 31 sales, their instants, invoice numbers, products, quantities, gross
    totals (`sales.total`, `line_gross`, `importe_total`), tenders and `envios` — the seed's random
    draws do not depend on a rate. Changed: `sales.vat_breakdown` (one 10% entry each),
    `sale_lines.vat_rate` (all 1000), `unit_price` and `line_total` (net) on the 40 lines not at
    10% today, and in `registros_facturacion` `desglose` and `cuota_total` of the 25 sales holding
    one, and `huella` of all 31 and `anterior_huella` of records 2–31 (the first record changes,
    and each record hashes the previous one). Total VAT across the copy goes from €73.66 to €46.34
    by this plan's arithmetic on the copy's `line_gross` (half away from zero, as `divideDecimal`
    rounds); the run is the receipt. Re-captured with
    `WAITRON_WRITE_GOLDEN=1 pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed-sales.golden.test.ts`,
    then checked by a throwaway script comparing the old and new JSON: every column outside the
    "changed" list identical, every new `vat_rate` 1000, the VAT total €46.34. The PR description
    shows that script's output.
  - (b) also pass the five products as `deliProducts` with takeaway rates 21, 10, 4, 0 and 10, so
    records still cover four rates. Every row changes (the takeaway draw consumes the random
    sequence), so nothing above can be checked as unchanged.

- **D18. Which takeaway rates a person may pick while the VAT return reports four — needs the
  owner.** The pack's `vatRates` is the owner's seven (0, 2, 4, 5, 7.5, 10, 21), but modelo 303 can
  carry only 0, 4, 10 and 21 today (above), so one product taken away at 5% would make that
  period's modelo 303 download fail with a server error.
  - **(a, recommended)** Spain's pack lists the pickable rates itself, beside `vatRates`:
    `pickableVatRates: ["0.00", "4.00", "10.00", "21.00"]`, with a note at that site saying it is
    limited to what the VAT return can report and pointing at a new backlog entry, "Offer 2%, 5% and
    7.5% taken away once modelo 303 can report them" (Task 1.1 adds it to `docs/backlog/fiscal.md`).
    A Spanish rule belongs in Spain's pack, so no generic package reads modelo 303 for this (the
    watcher's call, 2026-11-22). The editor, the API, the venue default and the bundle import all
    take `pickable` from `readVenueVatRates`. A server test (Task 1.1), in `apps/server`, which
    already depends on both the registry and `@waitron/reporting`, checks that every supported
    area's pickable rate has a modelo 303 box, so a list widened without mapping fails there. This
    plan does not say whether the form has boxes for 2, 5 or 7.5 (no source read).
  - (b) map 2, 5 and 7.5 in modelo 303 inside piece A. Cost: reading the committed AEAT record
    design (`packages/reporting/reference/DR303e26.xlsx`) and its layout for rows at those rates;
    if they exist, boxes in `DEVENGADO_BOXES`, the DR303 writer and its tests; if one does not
    exist (the code says the 5% row is gone), that rate cannot be reported at all and (a)'s limit
    is needed anyway. Changing a filing document makes this an owner-landed fiscal change of its
    own, outside the approved design's piece A.
  - **PR 1 builds the same under either answer:** the field and its check exist either way. Under
    (a) the list holds four; under (b) it also holds four until the modelo 303 mapping lands, and
    that change widens it to seven in one line of `spain.ts`.

---

## Global Constraints

Every place piece A touches. Every task's requirements include this list.

- **Pre-live:** no data-migration or backwards-compatibility code. A schema change edits the
  TypeScript schema (hand-written SQL only in `packages/db/triggers/core.sql`) and rebuilds the core
  set's starting migration: `pnpm --filter @waitron/server migration-baseline rebuild --set core`
  (on a rebase conflict take main's copy and rerun). **PR 1 and PR 2 reset every venue; each PR's
  first line says "Reset test venues: FISCAL: …".** PR 2 resets because the menu settings document
  changes shape (strict parse). PR 3 and PR 3b change no schema and no document shape.
- **"Sale-path read changed:"** (CLAUDE.md §4, the A1308 rule) — PR 2's description carries
  "Sale-path read changed: issuing a takeaway order, and pricing a new takeaway basket, read the
  products' takeaway rates in one query (`readTakeawayVatSchedules`)." PR 3's carries "Sale-path
  read changed: issuing an order, pricing a new basket and issuing an advance read the venue's area
  (taxpayer row and venue settings) once for the dine-in list." Rates are read **only** by `readLockedLinesForIssuance` and `priceOrderLines`;
  `readLockedLines` and every gross-only reader read none.
- **Compiling:** each task says which packages do not typecheck until which later task in the same
  PR. No PR ends with a package that does not typecheck: each PR's last task runs `pnpm -r typecheck`.
  Suites failing at runtime inside a PR are named in the task that starts them (only PR 3's D10
  window, Tasks 3.1–3.14).
- **Failing test first:** every task that adds behaviour starts with a test that fails. Tasks that
  only delete or sweep, or that only rewrite tests, have none and say so: 2.5 and 3.2–3.14 in piece
  A (and, for piece B's planner, PR L's L.3, L.4, the sweeps and the drop).
- **Fiscal gates:** `computeHuella`, the chain, invoice numbering, `registros_facturacion` and its
  triggers, `recordSale`/`recordCorrection`/`recordSubstitution` do not change. Every task touching
  `packages/menu/src/pricing.ts`, `issue-moment.ts`, `sale-day.ts`, the issuing reader or
  `bill-advances.ts` runs, unedited and passing:
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts src/write-path.e2e.test.ts`.
- **New table** `product_takeaway_vat_rates` (`packages/db/src/schema/menu/product-takeaway-vat-rates.ts`):
  `id` (`id`, primary key, `newId`), `product_id` (`id`, NOT NULL, foreign key
  `product_takeaway_vat_rates_product_fk` → `products.id` on delete cascade), `starts_on` (`day`,
  null = from the beginning of time), `rate` (`rate`, basis points, NOT NULL); unique index
  `product_takeaway_vat_rates_product_day_key` on (`product_id`, `starts_on`) and partial unique
  index `product_takeaway_vat_rates_product_first_key` on (`product_id`) where `starts_on is null`
  (SQLite treats two nulls as distinct; precedent for a partial index `menus.ts:78-80`); check
  `product_takeaway_vat_rates_rate_ck` (`rate between 0 and 10000`). `state` in
  `CORE_OWN_CLASSIFICATION` beside `products` (`classification.ts:128`), which also makes it a live
  change source. Transferred: `{ name: "product_takeaway_vat_rates" }` after `products` in
  `CORE_CONFIGURATION_TRANSFER` (`packages/db/src/configuration-transfer.ts:180`). Writer list (D16).
- **Columns left in place at piece A's end, removed by PR L (piece B):** `products.vat_class`, `products.takeaway_vat_class`, their checks and
  the `vat_class` term of `products_top_level_owns_ck`; `working_order_lines.vat_class`,
  `.takeaway_vat_class`, `.offer_vat_class`, their three checks and the `offer_vat_class` term of
  `working_order_lines_context_ck`; the trigger lines named above. **Untouched:** `menus.set_*`
  (piece B), `sale_lines.vat_rate`, `sales.vat_breakdown`, every fiscal table.
- **Pack fields (PR 1)** on `FiscalJurisdiction`: `dineInVatRates?: readonly DatedVatRate[]`,
  `vatRates?: readonly string[]`, `pickableVatRates?: readonly string[]` (D18),
  `defaultTakeawayVatRate?: string`. `ES-common`:
  `[{ from: null, rate: "10.00" }]`, `["0.00", "2.00", "4.00", "5.00", "7.50", "10.00", "21.00"]`,
  `pickableVatRates` `["0.00", "4.00", "10.00", "21.00"]`, `"10.00"`; `GB-vat`: D6 (`"0.00"` in every
  list). `CountryPack.defaultProductVatClass` (`country.ts:155`) and Spain's value
  go in PR L.
- **Shared names:** new `rateOn` (PR 1). Left in place at piece A's end, deleted in PR L (piece B): `vatRatesOn`, `ADVANCE_VAT_CLASS`,
  `appliedVatClass`; the label fields of `MenuOffer`, `MenuOfferVariant`, `AvailableProduct`,
  `OfferedExtraItem`, `Product`, `ListedVariant.effective`, `ProductEditorValue`/`InheritedValues`
  (`product-types.ts:85-86, 120-122, 173-176, 214-217`), and `SetMenuCopy.terms`
  (`set-menu-bill.ts:16, 56-62`). **Kept until piece B (D2):** `VatClass`, `VAT_CLASSES`,
  `VAT_RATE_TABLE`, `vatRateOn`, `vat_rate.table_invalid`, `ServedSetMenuCopy.terms` labels.
- **Pricer (PR 2):** `GrossLine` and `SelectedOption` carry `vatRates: readonly DatedRate[]` instead
  of `vatClass`. `LockedLine` loses `vatClass` and carries no rate: the issuing reader passes one
  list per line to `grossLockedLines(lines, rates?)`, and without `rates` every gross line's list
  is `[]` (which `rateLines` refuses). `PriceableProduct` gains optional `vatRates` (rated by its
  `vatClass` label when absent, until PR L removes the label and makes `vatRates` required).
- **Module contract (PR L):** `packages/module/src/module.ts:252-253, 308, 771`.
- **Settings:** `MENU_SETTINGS` gains `defaultTakeawayVatRate` (PR 2) and loses
  `defaultProductVatClass` (PR L; hidden from people in PR 3). It is a module settings document
  (`defineSettingsDocument`/`saveSettings`, `transfers: true`), never a `venue` key in a bundle.
- **Routes:** `GET /management-api/menu-settings` (`menu-api.ts:135-142, 987`) gains `vatRates`,
  `defaultTakeawayVatRate` (PR 2) and `dineInVatRate` (PR 3); `PUT /management-api/venue-defaults`
  (`venue-settings-api.ts:119-142, 419-423`) gains `defaultTakeawayVatRate` (PR 2), loses
  `defaultProductVatClass` (PR 3); the product routes (`menu-api.ts:1564-1700`) take
  `takeawayVatRate` and refuse `takeawayVatClass` (PR 2) and `vatClass` (PR 3); the patch routes
  lose the VAT fields (PR 2, PR 3). Set-menu routes unchanged.
- **Screens:** dashboard `product-editor.ts`, `product-list.ts`, `product-details.ts`,
  `product-browser.ts`, `menu-patch-dialog.ts`, `menu-patch-review.ts`,
  `screens/venue-defaults-panel.ts`, and the products and menus screens that pass settings down.
  Set-menu terms form unchanged (D2). Till: no screen; `apps/till/src/api/client.ts:368-421, 515-516`
  and `state/draft-lines.ts:199` lose labels (PR L).
- **Words:** dashboard `i18n/strings.ts` keys `menu_settings.default_vat`, `menu_settings.invalid`,
  `help.products.vat`, `editor.takeaway_vat*`, the `menu_patch.*` lines naming VAT classes,
  `i18n/domain.ts` (`vatClassLabel` stays for the set-menu form), `i18n/codes.ts`. English and
  Spanish together.
- **Guides:** `apps/server/src/guide/{en,es}/products.md` — `{#vat}` (`en :15-28`), the price-line
  example (`en :166`, `es :173`), the live-patch section (`en :347-358`, `es :364-401`); the
  set-menu sentence (`en :289`, `es :301-302`) is piece B's. `docs/developers/products.md:120-190`.
- **Demo data and fixtures:** `packages/country-es/src/demo/menu.ts` and the regional files,
  `packages/country/src/demo.ts`, `country-es/src/demo/data.test.ts:340-428`, the captured JSON in
  `packages/country-es/test-fixtures/demo/`, the demo seed (`apps/server/scripts/demo-seed/seed.ts`,
  `seed-menus.ts`, `seed-sales.ts`, `data-set.ts`, `data-set.typecheck.ts`), its tests
  `seed.madrid-baseline.test.ts` (with `testing/` transforms), `seed-sales.golden.test.ts` and its
  golden JSON, `seed-sales.dated.test.ts`; `apps/server/scripts/bench/bench-venue.ts:369-376`; the
  server fixtures under `apps/server/src/testing/`; `packages/db/src/testing/seed.ts`;
  `packages/menu/test/fixtures.ts`, `suggestion-fixture.ts`; `packages/reporting/test/fixtures.ts`;
  `packages/venue-service/src/testing/set-menu-fixtures.ts`;
  `packages/provisioning/test/configuration-bundle.ts`; till and dashboard fixtures.
- **Guards** (run when a task touches their area): `scripts/schema-constraints.test.ts`,
  `append-only-triggers`, `behavioural-triggers`, `starting-migrations`, `classification-complete`,
  `two-file-foreign-keys`, `write-path-tables`, `id-columns-are-references`, `english-only`,
  `module-seams`, `live-subscriptions`, `personal-log-params`, `errors-reachable`, `guide-links`,
  `native-form-fields` (all `pnpm exec vitest run scripts/<name>.test.ts` from the worktree root),
  `apps/server/src/guide-content.test.ts`, and `packages/fiscal-verifactu/src/inmutabilidad.test.ts`.
- **Module seams:** generic code reaches the pack only through `@waitron/country-packs`
  (`scripts/module-seams.test.ts:262-293`); `packages/menu` and `apps/server` already import it.
- **Test commands:** `pnpm --filter <pkg> exec vitest run <file>`; never `pnpm test <file> -t`
  (CLAUDE.md §2). Read the `Tests` count. Each implementer verifies with
  `pnpm exec prettier --check <changed files>`, `pnpm --filter <pkg> typecheck` for each changed
  package, and the task's focused suites. Browser suites: check `memory_pressure | grep free` first.
- **A1564 (custom item on the Counter, `docs/superpowers/plans/2026-11-21-counter-custom-item.md`,
  not built) — what piece A changes in its Global Constraints:**
  - Hidden products' `vat_class = 'reduced'` and the `"unchosen"` one's `takeaway_vat_class = NULL`:
    after PR 2 each rate product has one `product_takeaway_vat_rates` row from the beginning at its
    key's rate and the `"unchosen"` one the venue default (D3); PR L drops the labels. The rate
    products cover `readVenueVatRates(tx).pickable` (0, 4, 10, 21 under D18(a)).
  - `customItemProduct`/`customItemRatesOn` (its Task 1) and the till's `customItemRates` (Task 8)
    take the pick list from `readVenueVatRates(tx).pickable` (the till from the setup read), not
    `VAT_RATE_TABLE`.
  - Its Task 4 writes no VAT column on the line; its Task 7 repoints `product_id` only.
  - `takeawayRateBp` and keys `"2100"`, `"1000"` … stay.
  - Whichever lands first, the other is refreshed; if A1564 lands first, Task 1.4 gives its hidden
    products rows and PR L removes their labels.

## Review Focus

1. **A takeaway dish and its extra at different rates** (burger 21%, lemon-soda extra 0%): each
   line at its own product's rate. Test in Task 2.3.
2. **A takeaway variant with no rate of its own, whose parent's rate is edited after the order was
   placed:** the parent's new rate at issue. Task 2.3.
3. **An order switched between eaten here and taken away after lines were added:** the rate
   follows the order's way at issue. Tasks 2.3 and 3.1.
4. **A meal that ended before midnight, ticketed after it, on the day a dated rate changes:** the
   meal's day's rate — a product's dated row (Task 2.3) and the dine-in list (Task 3.1).
5. **A rate the pack lists but the VAT return cannot report** (2, 5, 7.5, D18): not offered by the
   editor (Task 2.9) or the venue default (2.10), refused by the API (2.8), `setTakeawayVatRate`
   (1.3) and the bundle import (1.5); and `"7.5"` written in a list reads `"7.50"`, one spelling
   with a stored 750 (1.1).

---

## PR 1 — Rates and their storage (nothing visible changes)

**When it lands:** Spain's area carries its dine-in list and its pick list; every product created
from then on has a takeaway rate row at the area's default; bundles carry the rows and an import
refuses a product without one. Nothing reads the rows or lists yet. First line: "Reset test venues:
FISCAL: store each product's takeaway VAT rate and Spain's rate lists (VAT rates A, PR 1)".
**Risks:** creating a product now needs a taxpayer (D7); the test files that lack one seed one (Task 1.4).

**Size (estimated):** production about +400/−10 lines (pack and registry +80, `rateOn` and errors
+40, the table and its wiring +60, `takeaway-vat-rates.ts` +150, `insertProduct` +10, import checks
+60); generated baseline and snapshot about +200; tests about +750 (the table +120, the module
+200, registry and `rateOn` +110, import +120, the modelo 303 cross-check +30, taxpayer seeding
about +60, madrid transform +40, operations +40, schema-constraints entries +6); backlog +6.

### Task 1.1: The pack's lists and a dated-list lookup

**Compiles:** every package, throughout.

**Files:**
- Modify: `packages/country/src/country.ts`, `index.ts`; `packages/country-es/src/spain.ts:341-350`;
  `packages/country-gb/src/united-kingdom.ts:19-26`; `packages/country-packs/src/registry.ts`,
  `index.ts`; `packages/shared/src/menu-document/vat-rates.ts`, `errors.ts`, `index.ts`;
  `docs/backlog/fiscal.md` (the D18 entry, "Offer 2%, 5% and 7.5% taken away once modelo 303 can
  report them", in the VAT area; the note beside `pickableVatRates` in `spain.ts` links to it)
- Test: `packages/country-packs/src/registry.test.ts`, `packages/shared/src/menu-document/vat-rates.test.ts`,
  `packages/country-es/src/spain.test.ts`, `packages/country-gb/src/united-kingdom.test.ts`; create
  `apps/server/src/vat-rates-reportable.test.ts` (every supported area's `pickable` rate maps in
  `mapModelo303`: build a `VatReturn` with one `byRate` row per rate and expect no throw — the
  server already depends on `@waitron/country-packs` and `@waitron/reporting`)

**Interfaces (produces):**
- `interface DatedVatRate { readonly from: string | null; readonly rate: string }` (`@waitron/country`).
- `interface AreaVatRates { readonly dineIn: readonly DatedVatRate[]; readonly accepted: readonly string[]; readonly pickable: readonly string[]; readonly defaultTakeaway: string }`
  (`accepted` from the pack's `vatRates`, `pickable` from its `pickableVatRates`);
  `vatRatesFor(country: string, territory: string): AreaVatRates | undefined` (`@waitron/country-packs`).
- `rateOn(schedule: readonly DatedRate[], date: string): Decimal` (`@waitron/shared`): checks the
  date (`vat_rate.date_invalid`, caller `"rateOn"`), refuses an empty, dated-first or out-of-order
  list (`vat_rate.schedule_invalid`), returns the last entry with `from` null or ≤ `date`, at two
  places (D13).

- [ ] **Step 1: Failing tests.** `vatRatesFor("ES", "ES-common")` equals the Global Constraints
  values; `("GB", "GB-vat")` D6; `("ES", "ES-canary")`, `("XX", "ES-common")`, `("ES", "missing")`
  are `undefined`. Every supported jurisdiction with `modules` has all four fields, a null-first
  oldest-first dine-in list, `pickable` within `accepted`, its dine-in rates and default within
  `pickable`, and every entry equal to `basisPointsToDecimal(stringToBasisPoints(entry))`. The
  server cross-check passes for `ES-common` and `GB-vat`, and fails if `"5.00"` is added to a
  pickable list in the test (control, then removed). `rateOn` on the two-entry list gives `"10.00"`
  on `"2026-12-31"` and `"4.00"` on `"2027-01-01"`; `rateOn([{ from: null, rate: "7.5" }], …)` is
  `"7.50"`; the three refusals and `"2026-02-30"`.
- [ ] **Step 2: Run; they fail** (`pnpm --filter @waitron/country-packs exec vitest run src/registry.test.ts`,
  `pnpm --filter @waitron/shared exec vitest run src/menu-document/vat-rates.test.ts`).
- [ ] **Step 3: Implement.** `rateOn` reuses `rateIn` and `assertWellFormed`'s checks for one list;
  `vatRateOn`/`vatRatesOn` unchanged.
- [ ] **Step 4: Run** the five files, `module-seams`, `errors-reachable`, `personal-log-params`;
  typecheck the five packages.
- [ ] **Step 5: Commit** — "VAT rates: Spain's dine-in rate and pick list in its pack".

### Task 1.2: The `product_takeaway_vat_rates` table

**Compiles:** every package, throughout.

**Files:**
- Create: `packages/db/src/schema/menu/product-takeaway-vat-rates.ts`; export through
  `packages/db/src/schema/menu/index.ts` and the `./schema/index.js` block of `packages/db/src/index.ts:385-401`
- Modify: `packages/db/src/classification.ts`, `configuration-transfer.ts:180`,
  `scripts/write-path-tables.json` and the table list in `scripts/write-path-tables.test.ts`'s doc
  comment (D16), `scripts/schema-constraints.test.ts` (adds only), and
  `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts`'s `ADDED_TABLES` (`:319`; the seed
  writes no row yet)
- Regenerate: `packages/db/drizzle/0000_baseline.sql`, `meta/0000_snapshot.json`
- Test: `packages/db/src/schema/menu/product-takeaway-vat-rates.test.ts`

- [ ] **Step 1: Failing test** (`useVenueDb({ migrations: [CORE_MIGRATIONS] })`, as
  `packages/db/src/schema/menu/migrations.test.ts:29-32`): two first rows for one product refused
  `UNIQUE_VIOLATION`; two rows on one day refused, on two days accepted; rate 10001 and −1 refused
  `CHECK_VIOLATION`; a row for no product refused `FOREIGN_KEY_VIOLATION`; deleting the product
  deletes its rows.
- [ ] **Step 2: Run; it fails** (`pnpm --filter @waitron/db exec vitest run src/schema/menu/product-takeaway-vat-rates.test.ts`).
- [ ] **Step 3: Implement**, then `pnpm --filter @waitron/server migration-baseline rebuild --set core`.
- [ ] **Step 4: Run** the test; `schema-constraints`, `starting-migrations`, `classification-complete`,
  `two-file-foreign-keys`, `write-path-tables`, `id-columns-are-references`, `append-only-triggers`,
  `behavioural-triggers`; the fiscal gate command; `seed.madrid-baseline.test.ts`.
- [ ] **Step 5: Commit** — "VAT rates: a table for each product's dated takeaway rate".

### Task 1.3: The one reader and writer

**Compiles:** every package, throughout (nothing calls the new module yet).

**Files:**
- Create: `packages/menu/src/takeaway-vat-rates.ts`; export from `packages/menu/src/index.ts`
- Test: `packages/menu/src/takeaway-vat-rates.test.ts`

**Interfaces:**
- Consumes: `vatRatesFor`, `rateOn` (1.1), `productTakeawayVatRates` (1.2).
- Produces (`@waitron/menu`): `readVenueVatRates(tx): Promise<AreaVatRates>` — D7 refusal; the
  pack's lists as `vatRatesFor` gives them (`pickable` is the pack's own D18 list). `setTakeawayVatRate(tx, productId: string, rate: string | null): Promise<void>` — D4
  replacement; null clears a variant's rows and is refused on a top-level product; a rate outside
  `pickable` refused `product.invalid` `{ field: "takeawayVatRate" }`.
  `readTakeawayVatSchedules(tx, productIds: readonly string[]): Promise<Map<string, readonly DatedRate[]>>`
  — one query, oldest first, two-place rates; a variant without rows maps to its parent's; a
  top-level product without rows is absent.

- [ ] **Step 1: Failing tests:** `readVenueVatRates` on a Spanish venue gives `pickable` 0, 4, 10,
  21 and `accepted` the seven; with no taxpayer it refuses `vat_rate.area_unsupported`;
  `setTakeawayVatRate(…, "21.00")` stores 2100; `"5.00"`, `"7.50"` and `"3.00"` are refused; a row of
  750 inserted directly reads back `"7.50"`; a variant without rows takes its parent's, with its own
  row its own; saving replaces a list holding a dated row with exactly one first row; null clears a
  variant and is refused on a product.
- [ ] **Step 2: Run; they fail** (`pnpm --filter @waitron/menu exec vitest run src/takeaway-vat-rates.test.ts`).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file, `pnpm exec vitest run scripts/write-path-tables.test.ts`, typecheck
  menu.
- [ ] **Step 5: Commit** — "VAT rates: one reader and writer for products' takeaway rates".

### Task 1.4: Every new product gets a row

**Compiles:** throughout (`CreateProductInput.takeawayVatRate?` is optional). Suites that create a
product with no taxpayer fail at runtime until this task's Step 4 fixes them.

**Files:** `packages/menu/src/operations.ts:990-1036` (`insertProduct` writes
`input.takeawayVatRate ?? (await readVenueVatRates(tx)).defaultTakeaway`; Task 2.1 puts the venue
setting in front); the five raw fixtures (D3); the madrid baseline (the table moves from
`ADDED_TABLES` to a transform: one row at 1000 per captured top-level product); the test files that
now create a product with no taxpayer. Test: `packages/menu/src/operations.test.ts`.

- [ ] **Step 1: Failing tests:** a new product reads `[{ from: null, rate: "10.00" }]`; one created
  with `takeawayVatRate: "4.00"` reads `"4.00"`; a variant created by `setProductVariants` has no
  row.
- [ ] **Step 2–3:** run (fails), implement.
- [ ] **Step 4:** 134 server test files call `createProduct` (`git grep -l "createProduct(" -- apps/server | wc -l`),
  so run the server package once (`pnpm --filter @waitron/server exec vitest run`, headroom first),
  and the menu, venue-service, media, staffing and fiscal-verifactu suites that call it (list:
  `git grep -l "createProduct(\|updateProduct(" -- packages apps`). Seed a taxpayer (`seedTaxpayer`)
  in each file that now refuses. **If more than 20 files need one, stop at a green point, commit,
  and hand the rest to a Task 1.4b with the list.** Run `seed.madrid-baseline.test.ts`.
- [ ] **Step 5: Commit** — "VAT rates: every new product starts at the area's takeaway rate".

### Task 1.5: Bundles carry the rows

**Compiles:** throughout.

**Files:** `packages/menu/src/configuration-transfer.ts:220-270`; `packages/provisioning/test/configuration-bundle.ts`.
Tests: `packages/menu/src/configuration-transfer.test.ts`,
`packages/provisioning/src/configuration-transfer.json-lists.test.ts`.

- [ ] **Step 1: Failing tests:** a top-level product with no first row, or two, is refused
  `setup.request_invalid` `{ field: "product_takeaway_vat_rates" }`; a rate outside the importing
  venue's `pickable` (a 500 row) is refused the same; a variant without rows is accepted; an
  exported venue round-trips its rows.
- [ ] **Step 2–4:** run (fails), implement, run both files and `pnpm --filter @waitron/provisioning exec vitest run src/configuration-transfer`.
- [ ] **Step 5: Commit** — "VAT rates: configuration bundles carry products' takeaway rates".
  Then `pnpm -r typecheck` and `/finish-branch`.

**Changed test checks, PR 1:** madrid baseline — new table, rows at 1000 per demo product
("A product's takeaway rate"); `scripts/schema-constraints.test.ts` — gains entries only.

---

## PR 2 — Taken away, each product's own rate

**When it lands:** a manager picks "VAT when taken away" as a percentage (0, 4, 10 or 21 under
D18(a); the pack's 2, 5 and 7.5 wait for modelo 303) for a product, a variant and an extra, where the area charges takeaway VAT; a variant can keep its
product's rate; new products start at the venue default "New products start at". A takeaway ticket
files each product line at its product's takeaway rate on the day the meal ended; a change applies
to every takeaway ticket issued afterwards, open orders and re-issued credited orders included, with
no publish. A takeaway set-menu line still files at its set menu's takeaway label (D2). The patcher
no longer offers takeaway VAT. The demo deli's cheeses are 4% to take home; its cola, Coca-Cola Zero
and bottled beer 21%; everything else 10%. Eaten here is unchanged. First line: "Reset test venues:
FISCAL: a takeaway line files at its product's own dated takeaway rate (VAT rates A, PR 2)". The
description carries the "Sale-path read changed:" line (Global Constraints).

**Size (estimated):** production about +750/−450 lines (pricer and line rates +200/−110, menu
product data and patcher +150/−120, settings and routes +90/−20, dashboard +170/−130, demo data
and seed +40/−20, the till −60, live queries +10); tests about +1,250/−650 (the new takeaway file
about +350, the fiscal twin +60, dashboard +250/−150, menu fixtures +150/−150, server conversions
+100/−80, the till −120, the rest +340/−150); guides about +15/−10.

**Dead data until PR L:** `products.takeaway_vat_class` is no longer written; copies'
`takeawayVatClass` and `working_order_lines.takeaway_vat_class` are still filled (the coalesce falls
back to the eat-in label) and read only for set-menu lines (D2).

**Order:** 2.1 → 2.2 → 2.3 → 2.4 (owner's yes on D11(a)) → 2.5 → 2.6 → 2.7 → 2.8 → 2.9 → 2.10 → 2.11.

### Task 2.1: The venue's default takeaway rate

**Compiles:** throughout.

**Files:** `packages/menu/src/settings.ts`, `settings-types.ts` (D5; `readMenuSettings` returns the
effective string; `saveMenuDefaultTakeawayVatRate(tx, rate: unknown, personId: string | null): Promise<MenuDefaults>`,
a rate outside `pickable` refused `product.invalid` `{ field: "defaultTakeawayVatRate" }`),
`operations.ts` (`insertProduct` default: setting, else pack); `apps/server/src/menu-api.ts:135-142`
(answer gains `vatRates: string[]` — `readVenueVatRates(tx).pickable`, so four in Spain under
D18 — and `defaultTakeawayVatRate: string`),
`venue-settings-api.ts:119-142, 419-423`, `venue-detail-types.ts:50`. Tests: `packages/menu/src/settings.test.ts`,
`apps/server/src/menu-api.test.ts` (venue-defaults cases `:6859-6900`), `venue-details.test.ts`.

- [ ] **Step 1: Failing tests:** with no saved default the answer shows `"10.00"` and the rates
  `0.00, 4.00, 10.00, 21.00`; PUT `{ defaultTakeawayVatRate: "4.00" }` then a new product starts at
  4%; `"5.00"` and `"3.00"` refused.
- [ ] **Step 2–4:** run (fails), implement, run the three files and `errors-reachable`.
- [ ] **Step 5: Commit** — "VAT rates: a venue default for new products' takeaway rate".

### Task 2.2: Each line carries a list of rates (nothing files differently)

**Compiles:** `apps/server` does not typecheck between Step 3's menu change and its server change,
inside this task only; every package at the end. `priceBasket` and `PriceableProduct.vatClass` keep
working, so the till and the fiscal suite are untouched.

**Files:** `packages/menu/src/pricing.ts` (`GrossLine`, `SelectedOption`: `vatClass` → `vatRates`;
`LockedLine` loses `vatClass` and carries no rate; `PriceableProduct.vatRates?`; `rateLines` uses `rateOn` and refuses an empty list
`vat_rate.unavailable` `{ lineNo }`; `grossLockedLines(lines, rates?: readonly (readonly DatedRate[])[])`
— without `rates` every line's list is `[]`); `apps/server/src/working-order.ts`
(`readLockedLinesForIssuance` `:1250-1278` and `priceOrderLines` `:905-1140` pass
`VAT_RATE_TABLE[label]`, the label picked by dining exactly as today; `readLockedLines` passes no
rates); `bill-advances.ts:132-158` (`VAT_RATE_TABLE[ADVANCE_VAT_CLASS]`); `scripts/demo-seed/seed-sales.ts:255-280`
(the input product's label's table entry). Server tests that build priced lines by hand move to
`vatRates` (`git grep -lE "GrossLine|LockedLine|grossLockedLines|rateLines" -- apps packages ':!packages/menu'`,
then those naming `vatClass`): `portion-sale-projection.test.ts:53-81` (its `locked()` helper),
`receipt-document.test.ts:740-743`, `adjustments-apply.test.ts:254-262` (`breakdownOf`, cast, so
it fails at runtime, not typecheck), `advance-deduction.test.ts:25-38`, and
`vat-class-at-line-add.test.ts` (its `rateLines` use). Tests: `packages/menu/src/pricing.test.ts`,
`pricing.dated.test.ts`, `apps/server/src/issue-moment.test.ts`.

- [ ] **Step 1: Failing tests** (they fail to compile against today's pricer): `rateLines` with one
  line at `[{null,"10.00"},{"2027-01-01","4.00"}]` and one at `[{null,"21.00"}]` on `"2027-01-01"`
  gives a 4% and a 21% group; an empty list refuses `{ lineNo: 2 }`; `grossLockedLines` without rates
  gives `[]` lists.
- [ ] **Step 2–3:** run (fails), implement.
- [ ] **Step 4: Run** the menu package, `issue-moment`, `issuance-pass`, `till-sale`,
  `vat-rate-at-issue`, `order-dining.filing`, `set-menu-money`, `portion-sale-projection`,
  `receipt-document`, `adjustments-apply`, `advance-deduction`, `vat-class-at-line-add`,
  `seed-sales.golden` (must pass unchanged), the fiscal gate command; `pnpm -r typecheck`.
- [ ] **Step 5: Commit** — "VAT rates: lines are rated from a list of dated rates".

### Task 2.3: Taken away, each product line at its product's rate

**Compiles:** throughout.

**Files:** create `apps/server/src/line-vat-rates.ts` and `takeaway-vat-rate-at-issue.test.ts`;
modify `working-order.ts` (the two rating readers call it once per order or basket; its two
`appliedVatClass` calls at `:955, 1016` and the import at `:36` go), `packages/shared/src/dining.ts`
and `index.ts` (delete `appliedVatClass`, now unused, with its test),
`testing/takeaway-menu.ts:20-41` (each product gets `takeawayVatRate` equal to its label's rate:
cola `"21.00"`, cheese `"4.00"`, cheese board `"4.00"`, burger `"21.00"`, lemon soda `"0.00"`),
`vat-rate-at-issue.test.ts:495-515` (the juice gets rows `{null, 1000}` and `{"2027-01-01", 400}`
directly instead of the mocked table; same expectations).

**Interfaces:** `readLineVatRates(tx, dining: Dining, lines: readonly { productId: string | null; setMenuRole: "set_menu" | "dish" | null; vatClass: VatClass; takeawayVatClass: VatClass }[]): Promise<(readonly DatedRate[])[]>`
— eaten here `VAT_RATE_TABLE[vatClass]`; taken away a set-menu line `VAT_RATE_TABLE[takeawayVatClass]`
(D2), any other line its product's list from one `readTakeawayVatSchedules` call, `[]` without rows.

- [ ] **Step 1: Failing tests** (setup copied from `vat-class-at-line-add.test.ts:1-370`; they fail
  because lines still take their frozen label):
  - a takeaway line files its product's rate as it stands at issue (park at 10%, set 21%, pay → 21%);
  - a variant without its own rate files at its parent's new rate (Review Focus 2);
  - a burger at 21% with a lemon-soda extra at 0% gives a 21% and a 0% group (Review Focus 1);
  - switched to eaten here after lines were added, the order files at the eat-in labels, and back
    (Review Focus 3);
  - a takeaway meal ended on the eve of a dated row, ticketed next day, files the eve's rate
    (Review Focus 4, `mealEndedAt` as in `close-of-day.later-sale-date.test.ts`);
  - a product inserted raw with no row refuses `vat_rate.unavailable`;
  - a takeaway set-menu bill paid by a captured card (as `set-menu-money.test.ts:307-352`, made
    takeaway) files its set-menu line at its set menu's takeaway label (D2) — this one passes
    before and after: it guards that D2 keeps today's behaviour.
- [ ] **Step 2–3:** run (fails), implement.
- [ ] **Step 4: Run** the new file, the five `order-dining.*` files, `vat-rate-at-issue`,
  `set-menu-money`, `set-menu-bill`, the fiscal gate command.
- [ ] **Step 5: Commit** — "VAT rates: a takeaway line files at its product's own rate".

### Task 2.4: A takeaway twin of the fiscal variant test

**Compiles:** throughout (`PriceableProduct.vatRates` is optional). Adds a describe; the eat-in
describe at `:697-787` stays untouched until Task 3.1 (D11(a)).

**Files:** `packages/fiscal-verifactu/src/write-path.e2e.test.ts` (a new describe after `:787`).

The existing eat-in describe, which PR 3 deletes (the lines the twin differs in):

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

The twin added now:

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

The twin expects the same Desglose as the eat-in describe, exactly
`[{ TipoImpositivo: "10.00", BaseImponibleOimporteNoSujeto: "4.09" }, { TipoImpositivo: "21.00", BaseImponibleOimporteNoSujeto: "4.55" }]`;
its comment says the basket's rates come from `readTakeawayVatSchedules`, as `readLineVatRates`
reads them. Its `vatClass: "reduced"` argument is removed in PR L.

- [ ] **Step 1:** Write the twin with wine175's row left at the parent's 10% and see it fail (the
  second row reads 10.00/5.00, not 21.00/4.55); add the `setTakeawayVatRate` line; it passes.
  **Step 2:** run the fiscal gate command (golden, `inmutabilidad` and the eat-in describe
  untouched). **Step 3: Commit** — "Fiscal test: a takeaway variant files at its own or its parent's rate".

### Task 2.5: The till stops pricing a VAT preview

**Compiles:** throughout.

**Files:** `apps/till/src/state/working-order.ts:142-160, 270-320, 504-536` (delete `vatBreakdown`,
`#pricedOrder`, `#priced`, `#price`, the constructor's `price`, `toPriceable`); delete the cases
reading `vatBreakdown` in `working-order.test.ts:448-460, 1262-1272`, `working-order.customer-fallback.test.ts:39`,
`draft-lines.test.ts:577`, `menu-refresh.test.ts:942`, keeping every `total` assertion; any
`new WorkingOrder(price)` in tests.

- [ ] Delete; run `pnpm --filter @waitron/till exec vitest run src/state`; typecheck; commit —
  "Till: drop the unshown basket VAT split".

### Task 2.6: The demo's takeaway rates

**Compiles:** throughout (`CreateProductInput.takeawayVatClass` still exists until 2.7; the demo
stops passing it).

**Files:** `packages/country/src/demo.ts` (demo product `takeawayVatRate?: string` replaces
`takeawayVatClass?`); `packages/country-es/src/demo/menu.ts` (deli cheeses `"4.00"`, the drinks at
`:1230, 1266, 1342` `"21.00"`; the cheeses keep their `super_reduced` eat-in label until PR L);
`country-es/src/demo/data.test.ts:354-428` (the takeaway-class cases become takeaway-rate cases,
same products and rates; `:341-352` stays until PR L); `apps/server/scripts/demo-seed/data-set.ts:39-44`,
`seed.ts:120-131`, `seed-menus.ts:185-195`, `seed-sales.ts` (`deliProducts` becomes
`readonly (SeedSalesProduct & { takeawayVatRate: string })[]`, so a deli product cannot lack a
rate; its takeaway lines are rated `[{ from: null, rate: takeawayVatRate }]`; eaten-in lines keep
their label's table entry until Task 3.2); the madrid baseline transform (rows at 400 and 2100
for those products); `packages/provisioning/test/configuration-bundle.ts`.

- [ ] **Step 1:** Change `data.test.ts` first; run; it fails. **Step 2:** implement. **Step 3:** run
  the demo test, `seed.test.ts`, `seed-menus.test.ts`, `seed-sales.test.ts`, `seed-sales.golden.test.ts`
  (unchanged: no deli products), `seed.madrid-baseline.test.ts`. **Step 4: Commit** — "Demo:
  takeaway rates as percentages".

### Task 2.7: The product's own data carries a rate, not a label (menu package and routes)

**Compiles:** test files outside `packages/menu` that pass `takeawayVatClass` to `createProduct`,
`updateProduct` or an editor body do not typecheck (mainly `apps/server`) until Task 2.8;
`packages/menu` and `apps/server/src` typecheck at the end of this task.

**Files:** `packages/shared/src/menu-document/product-types.ts` (`Product.takeawayVatRate: string`,
`ListedVariant.effective.takeawayVatRate: string`, editor and inherited values `takeawayVatRate`:
`string` on a product, `string | null` on a variant); `packages/menu/src/operations.ts` (inputs lose
`takeawayVatClass` and the label check at `:1001-1003` goes; `toProduct` reads today's rate, D14), `product-editor.ts`
(`:36-74, 181-200`), `product-editor-input.ts` (`:111-213`), `variants.ts`, `variant-fallback.ts`
(copies keep `takeawayVatClass` as `coalesce(products.vat_class, parent.vat_class)` until PR L),
`menu-patch.ts:101-104`, `menu-patch-types.ts`; `apps/server/src/menu-api.ts:1564-1700`; the menu
package's tests. Tests: `product-editor.test.ts`, `product-editor-input.test.ts`, `operations.test.ts`,
`variants.db.test.ts`, `variant-fallback.test.ts`, `menu-patch.test.ts`.

- [ ] **Step 1: Failing tests:** the editor round-trips `"4.00"` on a product and `null` on a
  variant (effective `"4.00"`); a variant set to `"21.00"` reads its own; an editor body or patch
  naming `takeawayVatClass` is refused as a retired field (the `refuseRetiredFields` pattern).
- [ ] **Step 2–3:** run (fails), implement; convert this package's fixtures from labels to rates
  (`general` 21.00, `reduced` 10.00, `super_reduced` 4.00, `zero` 0.00; a blank takeaway takes its
  eat-in label's rate).
- [ ] **Step 4: Run** `pnpm --filter @waitron/menu exec vitest run`; typecheck menu, shared, and
  `apps/server` sources. **Step 5: Commit** — "VAT rates: a product and a variant carry a takeaway rate".

### Task 2.8: Server and other callers move to rates

**Compiles:** ends 2.7's window; every package typechecks at the end.

**Files:** every test file and fixture outside `packages/menu` that `pnpm -r typecheck` reports for
`takeawayVatClass` on a product input (raw `working_order_lines` inserts keep the column until
PR L) — measured beforehand: 14 server files and 6 elsewhere (`packages/media/src/images.test.ts`,
five in `packages/venue-service`) call a product function and name `takeawayVatClass`; convert only
the lines the typecheck reports, label to rate (`general` 21.00, `reduced` 10.00, `super_reduced`
4.00, `zero` 0.00); `apps/server/src/menu-api.test.ts` product cases.

- [ ] **Step 1: Failing tests** in `menu-api.test.ts`: POST a product with `"21.00"` and read it
  back; `"5.00"` refused `product.invalid` `{ field: "takeawayVatRate" }` (D18); `takeawayVatClass`
  refused `management.request_invalid` `{ field: "takeawayVatClass" }`.
- [ ] **Step 2–3:** run (fails), convert. **Step 4:** run `pnpm -r typecheck` and each changed file.
- [ ] **Step 5: Commit** — "VAT rates: callers name a takeaway rate".

### Task 2.9: Dashboard — the product editor's field

**Compiles:** throughout (the dashboard has its own client types).

**Files:** `apps/dashboard/src/api/client.ts` (product and editor types, `MenuSettingsAnswer` `:14`);
`widgets/product-editor.ts` (`:705-720, 960-970, 1491, 1572`: "VAT when taken away" lists the
`vatRates` percentages, shown only with `takeawayVat`, required on a product; on a variant a first
option "Same as {product} — {rate}%"); `i18n/strings.ts` (`editor.takeaway_vat_same` →
"Same as {product} — {rate}%" / "Igual que {product} — {rate} %"; `editor.takeaway_vat_gone` removed;
`help.products.vat` no longer says a change needs a publish), `i18n/codes.ts`. Tests:
`widgets/product-editor.test.ts`, its `*.unsaved.test.ts` and `*.a11y.test.ts`.

- [ ] **Step 1: Failing tests:** exactly the answer's `vatRates` (0%, 4%, 10%, 21% under D18);
  saves `"4.00"`; hidden without `takeawayVat`; required on a product (Forms contract); "Same as" on a variant saves `null`; axe in
  both themes.
- [ ] **Step 2–4:** run (fails), implement with the field primitives, run, and look in the dev
  stack (`wa-wt demo <worktree>`) in both themes and at phone width.
- [ ] **Step 5: Commit** — "Dashboard: VAT when taken away is a percentage".

### Task 2.10: Dashboard — list, details, patch, venue defaults

**Files:** `widgets/product-list.ts:1059`, `product-details.ts:133`, `product-browser.ts`,
`menu-patch-dialog.ts` (`:700-720, 800-815, 1015-1025`: no takeaway field), `menu-patch-review.ts`,
`screens/venue-defaults-panel.ts:300-320` ("New products start at (VAT when taken away)" / "Los
productos nuevos empiezan con (IVA para llevar)", shown only with `takeawayVat`), `products-screen.ts`,
`menus-screen.ts`, `api/client.ts` (`VenueDefaults` `:710`, `putVenueDefaults` `:4188`),
`api/live-queries.ts` (every product read listing `"products"` also lists
`"product_takeaway_vat_rates"`), strings. Tests: `product-list.test.ts`, `product-list.a11y.test.ts`,
`product-details.test.ts`, `product-browser.test.ts`, `menu-patch-dialog.test.ts`,
`dashboard-app.settings-panels.test.ts`, `api/client-routes.test.ts`, `api/live-queries.test.ts`.

- [ ] **Step 1: Failing tests:** the list shows the rate; the patch dialog has no takeaway VAT; the
  panel saves `defaultTakeawayVatRate`. **Step 2–4:** run (fails), implement, run the suites and
  `live-subscriptions`, `native-form-fields`, `english-only`. **Step 5: Commit** — "Dashboard:
  takeaway rates in the product list, patch and venue defaults".

### Task 2.11: Guides, developer docs, receipt

**Files:** `apps/server/src/guide/{en,es}/products.md` (the `{#vat}` takeaway paragraph `en :25-28`,
the patch section's takeaway lines), `docs/developers/products.md:120-190` (takeaway).

English paragraph (write the Spanish twin from it):

> Where your region taxes takeaway food differently, **VAT when taken away** holds the rate this
> product is charged when it is taken away. Pick it from the list. A new product starts at **New
> products start at** in the venue's defaults. A variant can keep its product's rate. A change
> applies to every takeaway ticket from then on, including orders already open; you do not need to
> publish the menu.

- [ ] Edit; run `guide-content.test.ts`, `guide-links`. Receipt:
  `git grep -n "takeawayVatClass\|takeaway_vat_class" -- 'apps/*/src/*.ts' 'packages/*/src/*.ts' ':!*.test.ts' ':!*/testing/*'`
  — every hit is a dead copy, a type, or set menus; paste it in the PR description. Commit;
  `/finish-branch`.

**Changed test checks, PR 2:**

| File | Before | After | Spec |
| --- | --- | --- | --- |
| `write-path.e2e.test.ts` (D11(a)) | eat-in describe | unchanged; a takeaway twin added, same Desglose | "A variant may have its own rows" |
| `vat-rate-at-issue.test.ts:495-515` | mocked `reduced` table | dated product rows, same figures | "A product's takeaway rate has dates too" |
| `testing/takeaway-menu.ts` | labels | rates equal to the labels' | "Taken away: each line's product's takeaway rate" |
| till `vatBreakdown` cases | basket split | deleted | "deleted rather than ported" |
| menu editor/patch/settings suites | labels | rates; patch refuses takeaway VAT | "The dashboard" |
| `country-es/src/demo/data.test.ts:354-428` | takeaway labels | takeaway rates, same rates | "Demo data" |

---

## PR 3 — Eaten here, one rate

**When it lands:** every line eaten or drunk on the premises, set-menu lines included, files at the
dine-in rate of the day the meal ended (10% today); an advance files at the dine-in rate of the day
it was paid; the demo's practice sales are eaten in at 10% (D17). Screens are unchanged until PR 3b:
in between, the product editor still offers an eat-in label that no filed rate reads, so PR 3b
should land soon after. No reset. The description carries the "Sale-path read changed:" line.

**Size (estimated):** production about +30/−30 lines; tests about +900/−1,700 (the new eat-in file
about +200; `vat-class-at-line-add.test.ts` −787; the fiscal eat-in describe −91; the D10 and
mock-target changes about +600/−600; the golden JSON about 262 changed lines of 4,142).

**Dead data until PR L:** `products.vat_class` (written from the hidden `defaultProductVatClass`,
because `products_top_level_owns_ck` requires it), `working_order_lines.vat_class`/`offer_vat_class`,
copies' `vatClass`; none decides a rate.

**Order:** 3.1 (needs D10, D11(a), D11(b)) makes the switch and leaves the D10 suites failing at
runtime; 3.3–3.14 fix them; the branch is green after 3.14, and the PR ends there. 3.2 (needs D17)
any time after 3.1. Every package typechecks after every task.

### Task 3.1: The switch (needs the owner's yes on D10, D11(a) and D11(b))

**Compiles:** throughout. The D10 suites fail at runtime from here until Task 3.14.

**Files:** `apps/server/src/line-vat-rates.ts` (eaten here: `readVenueVatRates(tx).dineIn` for every
line, set-menu lines included; `vatClass` leaves the input), its two callers; `bill-advances.ts`
(`vatRates: dineIn`); delete `vat-class-at-line-add.test.ts` (D11(b)) and the eat-in describe at
`packages/fiscal-verifactu/src/write-path.e2e.test.ts:697-787` (D11(a); Task 2.4's takeaway twin
stays); create `dine-in-vat-rate.test.ts`.
Tests also: `advance-money`, `advance-final`, `advance-deduction`.

- [ ] **Step 1: Failing tests** (setup from the deleted file), one per path that rates:
  - **the issuing reader** (`readLockedLinesForIssuance`): an order started taken away and switched
    to eaten here (Review Focus 3), holding a dish labelled `general` with an extra and a variant
    given its own `general` label (the replacement for the deleted fiscal describe), all of whose
    takeaway rates are 21%, paid in cash → every line 10%;
  - **new-basket pricing** (`priceOrderLines`): a walk-up of a product labelled `general` → 10%;
  - **advances:** with `vatRatesFor` mocked to `[{null,"10.00"},{"2027-01-01","4.00"}]`, an advance
    paid on 31 December files 10% and one paid on 1 January 4%;
  - **D2's captured-money case:** an eaten-in set-menu bill recovered from a captured card (as
    `set-menu-money.test.ts:307-352`) files its set-menu line at 10%.
  The meal-end day for dine-in rates (Review Focus 4) stays pinned by the LATER-SALE-DATE suites
  Task 3.3 moves to the pack, figures unchanged.
- [ ] **Step 2–3:** run (fails), implement.
- [ ] **Step 4: Run** the new file, the advance files, `set-menu-money`, the fiscal gate command; list
  the failing server files with one package run (headroom first) and put the list in the commit body.
- [ ] **Step 5: Commit** — "VAT rates: everything eaten here files at the dine-in rate".

### Task 3.2: The demo's practice sales (needs the owner's yes on D17)

**Files:** `apps/server/scripts/demo-seed/seed-sales.ts` (eaten-in lines rated by
`readVenueVatRates(tx).dineIn`, read once per seed run), `testing/spanish-practice-sales.golden.json`
(re-recorded, D17(a)), `seed-sales.dated.test.ts` (mock target moves to `vatRatesFor`, figures
unchanged).

- [ ] **Step 1:** Run `seed-sales.golden.test.ts`; it fails after the seed change. **Step 2:**
  re-record with the D17 command; run the throwaway comparison script (in `mktemp -d`, not
  committed) and paste its output into the commit body. **Step 3:** run `seed-sales.test.ts`,
  `seed-sales.dated.test.ts`, `seed.test.ts`. **Step 4: Commit** — "Demo: practice sales eaten in at
  the dine-in rate (golden re-recorded with the owner's yes)".

### Task 3.3: Dated-rate suites move their mock to the pack

**Files:** `apps/server/src/vat-rate-at-issue.test.ts:54-70` (and its eat-in describes),
`close-of-day.later-sale-date.test.ts`, `close-of-day.every-path.later-sale-date.test.ts`,
`advance-corrections.later-sale-date.test.ts`, `issue-moment.test.ts`. The mock moves from
`@waitron/shared/src/menu-document/vat-rates.js` to `@waitron/country-packs`'s `vatRatesFor`;
**expected values unchanged — a moved figure stops the task.**

- [ ] Change; run each file; commit — "Tests: dated dine-in rates mocked at the pack".

### Tasks 3.4–3.12: Server tests that pinned an eat-in label's rate (D10)

The 53 candidates (files asserting a 21% figure and building `general` eat-in products, from
`git grep -lE 'rate: "21\.00"|vatRate: "21\.00"|TipoImpositivo: "21|"21\.00"' -- 'apps/server/**/*.test.ts'`
filtered to files naming `vatClass: "general"` or a server fixture), six per task, in
`apps/server/src/`; files already handled in 3.3 are skipped; any file 3.1's run lists that is not
below joins 3.12:

- **3.4:** `adjustments-apply`, `advance-corrections`, `advance-final`, `advance-money`, `bill-lookup-api`, `bill-payments-api`
- **3.5:** `bill-payments`, `cancel-invoiced-order`, `card-capture-mismatch`, `clock-unconfirmed-gate`, `collect-by-invoice`, `counter-handover`
- **3.6:** `deferred-close-refusal`, `find-bill-bills`, `fiscal-remedy.staff-refund`, `full-comp.fiscal-identity`, `full-invoice-creation-date`, `invoice-correction-api`
- **3.7:** `invoice-corrections`, `invoice-document`, `invoice-lookup-api`, `menu-api`, `order-dining.filing`, `order-portions.adjustments`
- **3.8:** `orders-api`, `portion-sale-projection`, `receipt-adjustments`, `receipt-guests`, `receipt-issuer`, `receipt-language`
- **3.9:** `report-api.categories-reconcile`, `report-api.categories`, `served`, `set-menu-bill-moves`, `set-menu-bill`, `set-menu-send`
- **3.10:** `split-bill.fiscal`, `start-full-disk.e2e`, `table-signals`, `till-api.fiscal-sale-paths`, `till-api.move-dishes`, `till-api.receipt`
- **3.11:** `till-sale-integrated.db`, `till-sale`, `till-sales.disk-full`, `transaction-receipt-api`, `unpaid-departure`, `venue-details`
- **3.12:** `working-order.pay-and-dispatch`, `zone-core-capabilities`, `zone-preservation`, and the leftovers.

Each task:
- [ ] **Step 1:** Sort each failing case by D10: a rate that is not the subject → recompute base and
  VAT at 10% to the cent; two rates as the subject → takeaway order with two products at those
  takeaway rates, figures kept. Never loosen an assertion.
- [ ] **Step 2:** Run each file (`pnpm --filter @waitron/server exec vitest run src/<file>.test.ts`).
- [ ] **Step 3: Commit** — "Tests: eat-in lines at the dine-in rate (group n)", listing each case's
  class in the body.

### Task 3.13: Venue-service and menu expectations

The failing cases among `packages/venue-service` (4 candidate files) and `packages/menu` (4), by
D10's classes. Run each package; commit.

### Task 3.14: Till and dashboard expectations

The failing cases among `apps/till` (5 candidates) and `apps/dashboard` (2), by D10's classes. Run;
commit.

**Changed test checks, PR 3:**

| File | Before | After | Spec |
| --- | --- | --- | --- |
| `vat-class-at-line-add.test.ts` (D11(b)) | label frozen at add | deleted; `dine-in-vat-rate.test.ts` | "Nothing about VAT is stored on an order line" |
| `write-path.e2e.test.ts:697-787` (D11(a)) | eat-in variant with its own label at 21% | deleted; Task 3.1's eat-in variant case at 10%; Task 2.4's takeaway twin stays | "Eaten here: one rate for everything" |
| `spanish-practice-sales.golden.json` (D17) | eat-in at 21/10/4/0 | re-recorded, all 10% | "Eaten here: the dine-in rate" |
| the D10 files (3.4–3.14) | eat-in `general` at 21% | 10%, or takeaway at the two rates | same |
| LATER-SALE-DATE, `vat-rate-at-issue`, `seed-sales.dated` | mocked label table | mocked pack list, same figures | "the day the meal ends" |
| `advance-*` | `reduced` (10%) | dine-in (10%), same figures | "Advances: the dine-in rate on the day paid" |

---

## PR 3b — Screens and guides for one eat-in rate

**When it lands:** the product editor has no eat-in field and says "Eaten here: 10% (all food and
drink)"; the venue defaults panel has no "VAT class for new products"; the patcher offers no VAT;
the guides say everything eaten or drunk here is at one rate. No reset; no filed figure changes.

**Size (estimated):** production about +80/−250 lines (server and menu +20/−60, dashboard +40/−150,
strings +20/−40); tests about +150/−200; guides about +10/−25.

### Task 3b.1: People can no longer set an eat-in label

**Compiles:** throughout (`CreateProductInput.vatClass` stays optional until PR L).

**Files:** `apps/server/src/menu-api.ts` (answer gains `dineInVatRate: string`, D14; product routes
refuse `vatClass` as retired), `packages/menu/src/product-editor-input.ts`, `operations.ts`
(`insertProduct` writes `vat_class` from `defaultProductVatClass`; a variant's own `vat_class` is
never written), `menu-patch.ts`/`menu-patch-types.ts` (no `vatClass`, D12),
`apps/server/src/venue-settings-api.ts` and `venue-detail-types.ts:50` (no `defaultProductVatClass`). Tests: `menu-api.test.ts`,
`product-editor-input.test.ts`, `menu-patch.test.ts`.

- [ ] **Step 1: Failing tests:** the answer carries `dineInVatRate: "10.00"`; a body naming
  `vatClass` is refused; a patch naming it is refused; the venue-defaults PUT refuses
  `defaultProductVatClass`. **Step 2–4:** run (fails), implement, run. **Step 5: Commit.**

### Task 3b.2: Dashboard — the editor

**Files:** `widgets/product-editor.ts` (no eat-in field for products or variants; the note
"Eaten here: {rate}% (all food and drink)" / "Para comer aquí: {rate} % (toda la comida y bebida)"
from `dineInVatRate`, shown in every area with a list, D9), `api/client.ts`, strings. Tests: the
editor's suites and the `dashboard-app.*` suites stubbing `getMenuSettings` (they gain
`dineInVatRate`).

- [ ] Failing test first (no eat-in field; note shows `"10"`), implement, run, look in both themes
  and at phone width, commit.

### Task 3b.3: Dashboard — list, details, patch, panel

**Files:** `product-list.ts`, `product-details.ts` (no eat-in VAT), `menu-patch-dialog.ts`,
`menu-patch-review.ts` (no VAT), `screens/venue-defaults-panel.ts:311` (no eat-in default), strings
(remove `menu_settings.default_vat`, `menu_settings.invalid`; the `menu_patch.*` lines at `:3860,
4001, 4013` and their Spanish twins stop naming VAT classes), `i18n/codes.ts`.

- [ ] Failing tests first, implement, run with `english-only`, commit.

### Task 3b.4: Guides, docs, backlog, receipt

**Files:** `guide/{en,es}/products.md` (`{#vat}` `en :15-24`, `en :166`/`es :173`, the patch
section), `docs/developers/products.md:120-190`, `docs/backlog/fiscal.md` A445 (see "What this
changes elsewhere") and the "VAT rates per product, eaten in or taken away" entry (piece A done;
the label removal is piece B's last PR).

English paragraph (Spanish twin from it):

> Everything eaten or drunk here is charged at one rate, shown beside the product's VAT field
> ("Eaten here: 10% (all food and drink)"). Waitron updates it when the law changes; there is
> nothing to set.

- [ ] Edit; run `guide-content.test.ts`, `guide-links`. Receipt:
  `git grep -n "vatClass\|vat_class\|VAT_RATE_TABLE\|vatRatesOn\|vatRateOn" -- 'apps/*/src/*.ts' 'packages/*/src/*.ts' ':!*.test.ts' ':!*/testing/*'`
  — no hit feeds a product line's rate; paste it in the PR description. Commit; `/finish-branch`.

**Changed test checks, PR 3b:** dashboard editor, patch and panel suites — eat-in field → none,
note shown ("Product editor").

---

## What piece A leaves in place at its end

After PR 3b, every filed rate comes from the dine-in list or a product's takeaway rows, except a
takeaway set-menu line (its set menu's label, D2). Still in the tree, read by no product line's
rate, for piece B to remove:
- the columns `products.vat_class` (written from the hidden `defaultProductVatClass` for a new
  product, because `products_top_level_owns_ck` requires it), `products.takeaway_vat_class` (no
  longer written), `working_order_lines.vat_class`, `.takeaway_vat_class` (still read, for set-menu
  lines only, D2) and `.offer_vat_class`, their checks and the freeze-trigger lines;
- the copies' `vatClass`/`takeawayVatClass` on offers, variants, extras and products, still filled;
- `PriceableProduct.vatClass` (the label fallback beside `vatRates`), `LockedLine`-era label inputs
  in `line-vat-rates.ts`, the settings key `defaultProductVatClass`, `CountryPack.defaultProductVatClass`;
- in `packages/shared`: `VatClass`, `VAT_CLASSES`, `VAT_RATE_TABLE`, `vatRateOn`, `vatRatesOn`,
  `ADVANCE_VAT_CLASS`, `vat_rate.table_invalid`;
- set menus' own two labels, form fields and copy terms (piece B's own subject);
- about 1,400 single-line label properties in test fixtures (measured below).

---

## For piece B's planner: PR L — No labels left (moved out of piece A)

The watcher moved this PR out of piece A on 2026-11-22: it becomes piece B's last PR, after piece B
has removed set menus' own labels and given a takeaway set-menu line its own rule, so nothing reads
`VatClass`, `VAT_RATE_TABLE` or `vatRateOn` any more. It is kept here as planned against `e2f075c59e`;
piece B's planner re-measures it and folds it in. Piece B's set-menu rule replaces D2's line-label
read, so this PR needs no new read of the recorded copy.

**Size (estimated):** production about +40/−600 lines; tests about −2,500 lines (≈1,400 scripted
single-line deletions plus hand edits); generated baseline and snapshot about −100.

**When it lands:** nothing a person sees changes. The product and order-line label columns, their
checks and trigger lines, the type fields, the settings key, the pack field, `vatRatesOn`,
`ADVANCE_VAT_CLASS` and every fixture's mention go (`appliedVatClass` went in Task 2.3); set menus
keep theirs (D2). First line: "Reset test venues: remove VAT labels from products, order lines and
menu copies (VAT rates, PR L)".

**Order, so every package typechecks after every task:** L.1 makes the columns nullable → L.2–L.3
stop every reader (the fields still exist and are still filled) → L.4 stops the producers and makes
the type fields optional → L.5–L.18 sweep fixtures (an optional field still accepts a fixture that
names it) → L.19 deletes the fields and drops the columns.

**The sweep script** (Tasks L.5–L.18), run on the group's listed files only:
`perl -0pi -e 's/^[ \t]*(vatClass|takeawayVatClass|offerVatClass|defaultProductVatClass|vat_class|takeaway_vat_class|offer_vat_class):[ \t]*[^,{\n]*,[ \t]*\n//mg' <files>`.
It deletes single-line properties only (measured: 280 of 287 label mentions in `apps/till`, 196 of
413 in `apps/dashboard`, 371 of 615 in `packages/menu`, 551 of 829 in `apps/server`). Then: revert
any deletion inside a set-menu `terms` object or naming `set_*` (`git diff -U3 | /usr/bin/grep -n terms`),
hand-edit the rest (raw SQL column lists, inline objects), run the group's suites. A test that
asserted a label is deleted only where the label was its whole subject, listed in the commit body;
any other assertion change stops the task. If a group needs more than about 40 hand edits, stop at
a green point, commit, and hand the rest on.

### Task L.1: The label columns become nullable

**Files:** `packages/db/src/schema/menus.ts` (`products_top_level_owns_ck` loses `vat_class`),
`orders.ts` (`vat_class`, `takeaway_vat_class` lose NOT NULL; the context check loses
`offer_vat_class`), baseline rebuild; any server line that the nullable select types break (cast
sites in `working-order.ts`).
- [ ] **Failing test first** (`packages/db/src/schema/menus.test.ts`, `orders.test.ts`): a top-level
  product with no `vat_class` and an order line with no label are accepted. Run the db schema suites,
  the Task 1.2 guards, the fiscal gate command, `pnpm -r typecheck`; commit.

### Task L.2: Server and venue-service stop reading and writing labels

**Files:** `apps/server/src/working-order.ts` (line writes `:1128-1133`, moves `:4899-4900,
5102-5103`, offer context `:4943`, retrieved product `:5400, 5664`), `line-vat-rates.ts` (no label
input; by now piece B's rule rates a takeaway set-menu line),
`set-menu-count.ts:88-89`, `modifier-selection.ts:23-24, 41-42, 155-156, 523-524`, `upgrade-sale.ts:95`,
`menu-api.ts`, demo seed and bench scripts; `packages/venue-service/src/operations.ts:1212-1255, 1422`.
- [ ] No failing test (deletions; piece B's set-menu tests pin the rate). Run the server suites for
  these files, `set-menu-money`, the fiscal gate command, `pnpm -r typecheck`; commit.

### Task L.3: Till and dashboard stop reading labels

**Files:** `apps/till/src/api/client.ts:368-421, 515-516`, `state/draft-lines.ts:199`;
`apps/dashboard/src/api/client.ts:569` (`VatClass` kept for set menus), product widgets' leftover
types. No failing test (deletions). Run the changed files' suites, `pnpm -r typecheck`; commit.

### Task L.4: Producers stop; the type fields become optional

**Files:** label fields optional in `packages/shared/src/menu-document/menu-types.ts`,
`product-types.ts`, `packages/menu/src/pricing.ts`, `packages/module/src/module.ts:252-253, 308, 771`;
producers stop: `packages/shared/src/set-menu-bill.ts` (drop the `terms` pick),
`set-menu-bill.fixtures.ts`; `packages/menu/src/` `menu-document.ts`, `menu-copy.ts`,
`menu-navigation.ts`, `offered-modifiers.ts`, `operations.ts`, `product-editor.ts`, `variants.ts`,
`variant-fallback.ts`, `settings.ts`/`settings-types.ts`/`provisioning.ts` (no
`defaultProductVatClass`), `pricing.ts` (`priceBasket` rates by `vatRates` only);
`packages/country/src/country.ts:155`, `demo.ts`; `packages/country-es/src/spain.ts:317` and the
demo files. No failing test (deletions). Run the menu, shared and country-es suites,
`pnpm -r typecheck`; commit.

### Tasks L.5–L.18: Fixture sweeps

List each group's files with
`git grep -lE 'vat_class|vatClass|takeawayVatClass|offer_vat_class|offerVatClass|defaultProductVatClass' -- <paths>`.
File counts measured on `e2f075c59e`:

- **L.5:** `apps/till` (107; almost all scripted).
- **L.6:** `apps/dashboard` tests `a…m`. **L.7:** `apps/dashboard` tests `n…z` and
  `scripts/behavioural-triggers.test.ts:231` (62 together).
- **L.8:** `packages/menu` tests `a…m`. **L.9:** `packages/menu` tests `n…z` and
  `packages/menu/test/` (68 together).
- **L.10:** `packages/db` (21), `shared` (13), `adjustments` (3), `reporting` (1), `media` (3),
  `provisioning` (1), `staffing` (1), `fiscal-verifactu` (1: Task 2.4's `vatClass: "reduced"`).
- **L.11:** `packages/venue-service` (19) and `country-es` (10; the captured JSON only if the
  madrid test reads labels from it).
- **L.12:** `apps/server/src/testing/*` (12) and server tests `a…b` (13).
- **L.13:** server tests `c…f` (18). **L.14:** `g…m` (34). **L.15:** `n…r` (31).
- **L.16:** `s` and `u…z` (27). **L.17:** `t` (38).
- **L.18:** `apps/server/scripts/**/*.test.ts` (12), with the madrid baseline's dropped-column
  transforms.

Each: script, revert set-menu deletions, hand-edit, run the group's suites, `pnpm -r typecheck`,
commit with the deleted assertions listed.

### Task L.19: Drop

**Files:** `menus.ts`, `orders.ts` (drop the five columns and their checks), `core.sql` (the trigger
lines), baseline rebuild; `vat-rates.ts` (delete `vatRatesOn`, `ADVANCE_VAT_CLASS`; keep `VatClass`,
`VAT_CLASSES`, `VAT_RATE_TABLE`, `vatRateOn`, `DatedRate`, `rateOn`, the date helpers — D2),
`index.ts`; delete the optional label fields from the types (a missed fixture fails typecheck and
is fixed here); `scripts/schema-constraints.test.ts` (D11(c)); `docs/developers/products.md` and
`conventions-data.md` lines stating the current label model (history keeps a dated pointer).
- [ ] Run every guard in Global Constraints, the fiscal gate command, `pnpm -r typecheck`, and the
  receipt `git grep -nE 'vat_class|vatClass|takeawayVatClass|offer_vat_class|offerVatClass|vatRatesOn|defaultProductVatClass|appliedVatClass|ADVANCE_VAT_CLASS' -- ':!docs/superpowers' ':!docs/backlog*' ':!docs/compliance'`
  — every hit is set-menu code. Commit; `/finish-branch`.

**Changed test checks, PR L:** `scripts/schema-constraints.test.ts:743, 825, 830` removed with
their columns (D11(c)); `country-es/src/demo/data.test.ts:341-352` deleted (true by construction:
"Eaten here: one rate for everything"); every fixture's label property deleted ("No labels").

---

## What this changes elsewhere

- **A445** (`docs/backlog/fiscal.md`; adviser answer 1.10, `docs/compliance/2026-11-15-adviser-answers.md:255`).
  After PR 3 an eaten-in bill has one rate, advances included, so a free item on it cannot shift VAT
  between rates (at one rate both methods give the same VAT, as the adviser sheet says). A445 still
  matters for takeaway bills mixing rates (the deli's 4%, 10%, 21%), and would matter for eaten-in
  bills again only if the adviser rules that drinks served without food take 21%. Task 3b.4 adds
  that sentence to A445.
- **A1515-SET-MENU-BILL Task 3** (`docs/superpowers/plans/2026-11-18-a1515-set-menu-bill.md:328-357`)
  **is no longer needed**: eaten here every line is at the dine-in rate; taken away, until piece B a
  set-menu line files at its set menu's own takeaway label (D2) and a covered dish at its own
  product's rate. That plan's decision 4 and the four Task 3 tests are dropped. If it lands before
  piece B, a takeaway set-menu bill then pays at that label until piece B's check replaces it.
- **`docs/backlog/fiscal.md` "VAT rates per product, eaten in or taken away"** is unchanged by this
  commit. Task 3b.4 records piece A as done and names PR L as piece B's last step; Task 1.1 adds the
  D18 entry for 2%, 5% and 7.5%.
- **A1564** — see Global Constraints.
