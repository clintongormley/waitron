# Venue departments and menus: implementation plan

**Status:** ordering, management and operational-safety slice implemented on branch `menus`; legacy
field removal, hours enforcement, staffing, reporting and replication smoke remain follow-up scope.
**Driver:** Codex direct session.
**Design:** [venue departments, menus and preparation routing](../specs/2026-09-09-venue-departments-and-menus-design.md).
**Branch at preparation:** `menus`, baseline `67047fb3`. Continue in the registered
`waitron-menus` worktree. Read the current `CLAUDE.md` and backlog before execution.

The owner approved the domain direction. The design's section 3 records implementation defaults
chosen during planning; expose any material change to those defaults before building it. This slice
replaces the live ordering path with menu-offer identity and zone service context, including
preparation and transfer behaviour. It also supplies the dashboard management surface, readiness
checks, an exact Restaurant/Deli demo and operational one-venue checks. Later slices can remove the
legacy authoring fields and add hours enforcement, workforce and reporting. Do not merge without a
later owner instruction.

## Execution rules

- Use TDD for each behavioural change: write a focused failing assertion, run it and record the
  expected failure, implement, then rerun. Missing imports alone do not demonstrate the behaviour;
  reach the assertion once the minimal interface exists. Keep existing behavioural assertions.
- Use PGlite for ordinary transactional logic; use real PostgreSQL as non-superuser `app_user` for
  grants, replication, concurrent provisioning/edits and deployment-role trigger behaviour. Use
  lifecycle helpers, not unguarded ad hoc teardown. Local Docker tests need
  `TESTCONTAINERS_RYUK_DISABLED=true`.
- Read every consumer before removing fields or changing null/gating semantics. Each logical write
  runs in the caller's one `withTenant` transaction. Scope every read/write to tenant and venue.
- New tables live in module migration sets, as the design specifies. Use generated/custom migration
  commands from the owning package; inspect SQL and apply real migrations. No snapshot/journal hand
  edits, data backfill, compatibility API or production-data conversion. Do not reset the shared dev
  database just to run tests.
- Keep error codes already shipped. New errors follow domain siblings and import their registry.
  Read `docs/developers/design-system.md` Forms before any UI task. No new input bypasses that contract.
- Commit coherent checkpoints with `git commit -s`; never bypass hooks. Shared wire changes below
  interlock: complete their consumers before claiming a green workspace or pushing a checkpoint.
- Drive ordinary tasks inline. This plan does not require agent delegation or unavailable skills.

## 0. Confirm the consumer map and pin contracts

**Read:** `packages/catalogue/src/{operations,pricing}.ts`, `apps/server/src/{working-order,
till-sale,till-api,till-config,kitchen,tables,catalogue-api,management-api}.ts`,
`apps/till/src/{till-app,api/client,state/working-order,state/order-line}.ts`,
`packages/module/src/module.ts`, `packages/core/src/record-sale.ts`.

- [ ] Run and retain a concise path list for these searches, including tests and prose:

```sh
rg -n 'catalogueId|catalogue_id|locationCatalogues|resolveAccessibleCatalogueIds|listAvailableProducts' packages apps scripts docs .github CLAUDE.md README.md
rg -n 'orderFlow|order_flow|productStationId|categoryStationId|setProductStation|setCategoryStation' packages apps scripts docs .github CLAUDE.md README.md
rg -n 'productId|deliveryTableId|moveTab|mergeTabs|transferLines|splitOffCheck|unjoinTable' apps/server/src apps/till/src packages/module/src packages/bookings/src
```

- [ ] Add the missing paths found to the relevant task, including all exact-body API/boot tests,
  stored basket consumers, translations, fixtures, demo scripts and documentation paraphrases.
- [ ] Define shared structural DTOs: menu offer `{menuItemId, productId, menuId, ...priced display
  fields}`, new-line input `{menuItemId, quantity, options?, ...existing extras}`, service context
  `{zoneId, departmentId, serviceMode}` and explicit routing result `station | no_preparation`.
  `serviceMode` is `table_tab | prepay | invoice_first | ticket_then_pay`; keep its table-tab meaning
  distinct from the old counter-only `orderFlow` contract.
  Keep names unambiguous; do not silently reuse `Product.id` to mean a menu item ID.
- [ ] Define the service contribution in `@waitron/module` with typed, transaction-taking methods
  for resolving zone/order context, listing offers, routing and recording/copying attribution.
  Declare DTOs without importing the new domain implementation; keep browser DTO entrypoints free
  of runtime database imports. Test a fake contribution through generic server wiring.

**Acceptance:** two offers for one product have distinct wire identities. A new order requires
a service zone, and an existing order resolves its stored payment flow rather than the device's.

## 1. Separate products from menu offers

**Change:** `packages/db/src/schema/catalogue.ts`, `packages/catalogue/src/{operations,pricing,index}.ts`;
new `packages/catalogue/src/schema/`, `drizzle/`, `migrations.ts`, `classification.ts`;
`packages/composition/src/modules.ts`, `packages/migrations/migrations.manifest.json`.

- [ ] First test one product on two menus at €9 and €11; independent modifiers/surcharges; menu
  section vs product category; required category; zero price; per-kg quantities; inactive
  product/menu/item; invalid cross-tenant menu/product/option references.
- [ ] Add module-owned menu items, menu sections, menu-item group/choice prices and working-line
  offer references. Keep the existing product-option associations as eligible definitions. Define
  composite tenant/venue keys where needed and uniqueness for one product per menu. Store explicit
  choice prices; eliminate the old global option price as a competing source once callers change.
- [ ] Add catalogue's migration/classification seat, required dependencies and fixture migration
  lists. Core remains owner of existing product/category/menu master rows. No new core tables.
- [ ] Replace product create/update/list contracts: products have no menu owner or selling price.
  Menu authoring controls price, order, sections and offered groups. Preserve allergen/diet fields,
  image handling, recipe linkage, tax classification and the existing money-rounding functions.
- [ ] Keep existing catalogue error codes where their meaning still applies. Remove old product
  price/menu fields only with their callers updated in tasks 3–6; do not ship parallel price sources.

**Focused checks:** catalogue operations/pricing/integration and recipe tests; DB schema tests;
root `classification-complete`, `module-graph-honesty`, `errors-reachable`, `module-seams` and
`coverage-thresholds`. Update every fixture that explicitly lists migration sets.

## 2. Add venue-service configuration and single-venue guards

**Create:** `packages/venue-service/` with schema, migrations, classification, operations,
provisioning seed, routes, permissions, service contribution, tests and browser-safe dashboard entry.
Use `packages/bookings/` as the existing contribution/migration pattern, not copied business logic.
**Integrate:** composition/manifest, `packages/dashboard-modules`, `packages/provisioning/src/{venue-apply,
venue-plan,tenant-guard}.ts`, server setup/adoption/boot and device configuration.

- [ ] First test departments, zone membership/default menu invariants, service inheritance,
  counter/device defaults, no-table zones and same-tenant/wrong-venue rejection. Test missing vs
  explicit no-preparation, all four routing priorities and duplicate-rule refusal.
- [ ] Add department rows; one service-policy extension per core floor zone; explicit zone menu
  assignments; device default-zone extensions; routing rules; order service context; working-line
  department context. Foreign keys point from the module to core/catalogue, never back.
- [ ] Define active/deactivation behaviour: a department with active zones cannot be disabled;
  referenced default zones/menus/stations must be replaced or the consuming configuration made
  inactive. Draft configuration may be incomplete; expose a readiness list before taking orders.
  Use transaction locking/constraints for competing default edits, not a UI-only guarantee.
- [ ] Seed a default department and counter zone idempotently through the provisioning seat in the
  existing provisioning transaction. Repeated node provisioning must not reset authored policies.
- [ ] Guard operational setup against a second distinct venue, including two concurrent requests;
  same-venue reruns and standby adoption pass. Validate one venue at boot/adoption. Keep multi-tenant
  database tests available and tenant predicates intact. A guard failure rolls back the whole setup.
- [ ] Register service routes/permissions and inject its typed contribution through composition.
  Generic server and provisioning code must not import the new module by name. Exercise missing
  contribution as a boot configuration failure, not a null dereference on the first sale.

**Focused checks:** new module logic, real-PG constraints/grants and concurrent guard tests;
provisioning and module contract tests. Module/manifest list changes require the root guards and
the eventual whole-workspace gate, not just the new package's tests.

## 3. Carry offer and service identity through every order path

**Change:** `apps/server/src/{working-order,till-api,till-config,till-sale}.ts`,
`packages/module/src/module.ts` (`CoreServices.openTab`), booking adapters/tests;
module-owned working-order extensions from tasks 1–2.

- [ ] Reproduce the product-ID ambiguity with two offers of the same product. Test an allowed
  offer and a crafted inaccessible offer through the real API boundary. Include cross-tenant IDs,
  stale/inactive offers and a choice belonging only to the other menu item.
- [ ] Resolve table/delivery/device zones server-side. Freeze service flow when opening the order.
  Use effective order context for every place/collect/pay/card-recovery decision; remove process-wide
  `cfg.orderFlow` as authority for an existing order. Device defaults apply only to new orders.
- [ ] Preserve running table tabs as `table_tab`; implement explicit mode compatibility checks for
  new table tabs vs counter deliveries. Test all four modes, including a department override and a
  zone override, without changing when the existing counter modes issue their invoices.
- [ ] Price new selections by `menuItemId`; key option caches by offer, not product. Preserve existing
  gross/net calculations, option parent-child expansion, notes, doneness, courses and locale locks.
- [ ] Store line offer references and department/category/menu label snapshots atomically with the
  working lines. Persist stable line IDs through edits. Unchanged/quantity-only edits keep prices;
  changed product/modifier selections are explicitly replaced at current prices.
- [ ] Trace and update park, retrieve, update, openTab, addTabRound, moveTabLines, moveTab, joinTable,
  mergeTabs, transferLines, splitOffCheck, unjoinTable, void and cancellation paths. Preserve child
  groups, original selling departments and price locks. Refuse incompatible flow merges/transfers
  and cross-zone joined tables without partially moving rows.
- [ ] Test moving to another zone before/after sending, changing settings between park and pay,
  paying at a device assigned elsewhere, deleted/deactivated live offers, concurrent edits, duplicate
  submission and card retry/recovery. Never re-price an issued order or require active configuration
  merely to settle an already issued bill.

**Focused checks:** `working-order.test.ts`, `working-order.pg.test.ts`, till API/sale suites,
card collection/recovery suites and bookings seating tests. Run server unfiltered before calling
the wire change green. Keep a written matrix of supported table/counter payment flows.

## 4. Route preparation from service context, including counter sales

**Change:** `apps/server/src/{working-order,kitchen,kitchen-print,kitchen-ticket,till-sale}.ts`,
station/expo reads and till station/expo screens; replace fixed category/product station editing.

- [ ] First test one Negroni sent from upstairs/downstairs, a zone product exception, a venue
  fallback, explicit no-preparation, missing/inactive routes and a shared-kitchen deli/restaurant pair.
- [ ] Replace `product.stationId ?? category.stationId ?? defaultStationId` with the contributed
  resolver. Retire fixed-routing columns and APIs only after their fixtures/UI/callers change.
  Keep station/printer identity and existing course timing behaviour.
- [ ] Save the station at send time. Make counter/walk-up food actually reach preparation: the
  backlog's #193 counter-fire follow-up is part of this acceptance, not a deferred broken path.
  For new prepay sales, preparation validation and ticket writes share the sale transaction;
  outbound printing remains queued. Cover invoice-first and ticket-then-pay paths too.
- [ ] Test duplicate sends, concurrent retries, failed sale rollback, no-preparation-only orders,
  mixed preparation orders, held courses, recall and cancel. Existing issued bills remain payable
  even if station configuration later changes. Do not re-fire because a payment is retried.
- [ ] Show department, service destination and existing notes/modifiers on screens and tickets.
  Destination updates must not reassign a fired station. Verify actual print payloads, not just UI.

**Focused checks:** routing/working-order, kitchen-print including concurrency, counter sale tests,
station/expo browser tests. Prove the upstairs rule by removing zone matching and watching the
downstairs/upstairs test fail for different station IDs.

## 5. Make the till use zone offers and stored order context

**Change:** `apps/till/src/{api/client,till-app,state/working-order,state/order-line,menu-filter}.ts`,
counter/table/allergen screens, menu-switcher, product-grid, modifier-picker and payment widgets.

- [ ] First test two visible offers for one product retaining distinct prices/options in the basket,
  menu switching without losing lines, and a table/handheld selecting the table's zone.
- [ ] Load allowed menus/offers on zone or order selection. Use menu-item identity throughout basket
  serialization. Show the effective service zone, with an explicit counter-zone selector and a
  configured initial default; no silent zone change on a nonempty basket.
- [ ] Reconstruct stored lines from server snapshots, retaining unavailable/deactivated items and
  prices. Never select the first live product with a matching ID. New additions use current offers.
- [ ] Refresh after enrolment, login, zone changes and menu/policy edits. Include the backlog's
  manual-refresh defect in acceptance. Reuse existing update delivery or add a bounded refresh
  mechanism; prevent stale responses from replacing the newly selected zone's offers.
- [ ] Drive payment actions from the current order's frozen flow. Show helpful empty/loading/error
  states and unavailable choices; no broad fallback to every venue menu on fetch failure.

**Focused checks:** state/client tests and affected Chromium interaction/accessibility suites.
Complete API exact-body tests and both counter/table paths before claiming this task done.

## 6. Replace the dashboard's overlapping management screens

**Change:** existing `apps/dashboard/src/{api/client,dashboard-app,i18n/strings}.ts`, product form,
category manager, catalogue/location-menu/floor/kitchen/recipe screens; new module dashboard UI
mounted through `packages/dashboard-modules/src/index.ts`.

- [ ] Write interaction tests before each screen. Products edits the shared identity without menu
  or price; Menus selects products and edits prices, sections and offered modifiers. Recipe editing
  selects products independently of menus. Remove Catalogue and Location menus navigation labels.
- [ ] Add department/zone management and zone menu assignments through the service module's
  contribution. Show one default department implicitly until a second is needed. Preserve the
  existing full-width tenant identity banner and legal seller identity.
- [ ] Add a routing matrix with product exceptions and explicit no-preparation; use Preparation
  stations as the user-facing term for kitchen/bar/deli destinations. Replace old routing controls
  rather than leave two editors for the same decision. Show readiness failures beside their fields.
- [ ] Follow the Forms contract: semantic names/autocomplete, required markers, field errors plus
  localized summary, standard actions/tooltips. Preserve image upload and manual/derived allergen
  editing behaviour. Cover translations and keyboard/screen-reader navigation.

**Focused checks:** changed dashboard tests and accessibility suites; service-module browser tests,
module dashboard registration/purity guards. Test an actual create-product → two-menu workflow.

## 7. Add department hours and shared staffing assignments

**Change:** service-module hours schema/API/UI; `packages/workforce/src/schema/{shifts,
shift-templates}.ts`, `clocking.ts` scheduling methods, `schedule-reads.ts`, `shift-swaps.ts`,
`apps/server/src/schedule-api.ts`, dashboard roster/my-schedule clients and screens.

- [ ] First test split daily hours, an overnight opening, a dated closed exception, zone inheritance
  vs replacement, and unconfigured hours. Use venue-local dates and test a DST transition. Hours
  are descriptive/planning configuration; no new automatic checkout or booking gate.
- [ ] Add validated department/station assignments on shifts and templates in workforce's own
  migrations. Declare the service-module prerequisite in composition and fixture migration lists.
  Both optional means shared venue work; when supplied, IDs must belong to the shift's venue.
- [ ] Preserve assignments in template generation, edits, publication, person reads and swaps.
  Filter by department while including clearly labelled shared shifts. Keep venue-wide publication
  and labour checks. Test one employee scheduled across departments with a conflicting overlap,
  and a kitchen preparation shift outside trading hours. Do not duplicate staff or clock-in chains.

**Focused checks:** hours tests; workforce scheduling, validation, swaps and person reads; schedule
API and roster browser tests. Existing actual-time/chain assertions remain unchanged.

## 8. Preserve department attribution and report sales

**Change:** module-owned sold-line attribution schema/writer/report/API/UI; server issuance,
correction/substitution adapters; reuse existing reporting business-day and active-sales rules.

- [ ] First test a bill with Restaurant and Deli lines plus modifiers. Department totals must sum
  to the comparable venue sales total, without duplicating parents when joining their children.
- [ ] Reuse the business-day and active-sale predicates from `packages/reporting/src/business-day.ts`.
  Expose a narrow supported export if needed; do not copy its SQL into a second divergent rule set.
- [ ] At issuance write append-only attribution keyed to the issued sale line in the same
  transaction. Join by explicit `saleId`/`lineNo` or returned IDs, never SELECT order or display text.
  Copy product/menu/department IDs and labels; no FK to mutable catalogue/service state. Keep
  these fields out of fiscal backend inputs and hashes.
- [ ] Cover every `recordSale` call in `till-sale.ts` and `working-order.ts`, plus replays and
  corrections/substitutions. Refund attribution follows explicit original-line mapping; adjustments
  without that mapping are Unallocated. Reuse current void/substitution exclusion rules.
- [ ] Test immutable attribution after renaming/moving a department or deleting draft source rows;
  negative corrections, partial returns, duplicate payment retries, tenant scope and day boundaries.
  Add a department breakdown screen/filter showing Unallocated explicitly when nonzero.
- [ ] Verify PostgreSQL app-role grants and ALWAYS mutation/truncate protection. Test fiscal-input
  and hash invariance by varying only commercial metadata; retain existing write-path e2e assertions.

**Focused checks:** attribution/report tests, issuance/correction suites, real-PG privilege tests
and `packages/fiscal-verifactu/src/write-path.e2e.test.ts`.

## 9. Provision, replicate and run the whole feature

**Change:** `apps/server/scripts/demo-seed/{seed,seed-catalogue,seed-options,seed-floor,menu}.ts`,
other demos/fixtures found in task 0, module provisioning and replication test fixtures; backlog,
current operator docs and affected prose in `CLAUDE.md`/`.github/instructions/`.

- [ ] Seed the design's Restaurant/Deli example, upstairs/downstairs Negroni, two menu prices,
  shared kitchen, distinct service flows, hours and shifts. Shared products must have one ID.
- [ ] Run fresh migrations, provisioning and primary/standby replication with these rows. Exercise
  configuration changes and live orders on the standby, promotion and ledger-only return of sold
  attribution whose old mutable menu/department state is absent on the new primary.
- [ ] Inspect resource headroom (`memory_pressure`, heaviest processes) and other test sessions
  before browser/heavy gates. Chromium runs from the host, with normal sandbox approval if needed.
  Run appropriate changed-package `test:coverage` unfiltered, including packages changed only by
  fixture/migration-list updates. Run the complete repository gate once near the end:

```sh
pnpm lint && pnpm typecheck && pnpm format:check && pnpm test
```

- [ ] Run `pnpm install --frozen-lockfile` because the four-command gate does not check the lockfile.
  Root guards include classification, append-only ALWAYS, module graph/seams, errors, vocabulary,
  browser purity and coverage-package lists. New package coverage uses the repo's ordinary floor;
  do not lower existing package thresholds.
- [ ] Start the development stack with `wa-wt waitron-menus`. If a reseed is needed, follow the
  documented `wa-wt reset` workflow and its shared-database scope; test fixtures are preferred for
  destructive setup experiments. Record browser smoke of all seven design completion examples.
- [ ] Audit old claims across the whole base-to-tip change: location menu ownership, product price,
  default-station routing, venue-wide payment mode and cloud instance per tenant. Historical specs
  keep their text with a dated supersession pointer. Update backlog statuses with actual receipts.
- [ ] Mark tasks complete only with commands/results or file receipts. Announce readiness for
  `finish-branch`; run it when requested, including its whole-branch review and CI. Do not merge.

## Handoff receipts

The `menus` branch delivers this first reviewable slice:

| Area | Result | Receipt |
| --- | --- | --- |
| Menu offers | A product can have separately priced menu offers and offer-specific modifier prices. | `packages/catalogue/src/operations.test.ts`; commits `67fbb417`, `8898d5ce` |
| Venue service | Departments, zone policies, allowed/default menus, preparation rules and frozen order/line context are module-owned. Manager routes expose the configuration operations. | `packages/venue-service/src/operations.test.ts`, `routes.test.ts`; commits `67fbb417`, `9089f1cd`, `bf685c47` |
| Till and server | New lines use `menuItemId`; a counter order selects a service zone; table orders use their table zone; stored service mode governs later actions. | `apps/server/src/working-order.test.ts`, `till-api.test.ts`; `apps/till/src/till-app.test.ts`; commits `8898d5ce` through `198c7f7e` |
| Preparation | Routing resolves from the frozen zone and product/category specificity. Manual and integrated prepay orders fire preparation in the sale transaction. | `apps/server/src/till-sale.test.ts`, `till-sale-integrated.pg.test.ts`; commits `c18df62c`, `7f171d98` |
| Existing orders | Quantity edits keep price and line identity; parked orders restore modifiers and customisation; split, merge and transfer retain service and line context. | `apps/server/src/working-order.test.ts`, `move-merge.test.ts`, `split-bill.test.ts`; commits `44bc72f4`, `7dde626b`, `51fb9b47` |
| Deployment | A same-venue provisioning retry is idempotent; a second distinct venue is refused, including competing real-PostgreSQL requests. | `packages/provisioning/src/venue-apply.test.ts`, `venue-apply.pg.test.ts`; commit `cb96c232` |
| Fresh setup | Provisioning creates an initial menu, default department and counter zone, connects that menu to the zone, and exports both modules' portable configuration. Device-zone defaults are re-enrolled with devices because device rows are deliberately excluded from transfer. | `apps/server/src/provision.test.ts`, `packages/catalogue/src/provisioning.ts`, `packages/{catalogue,venue-service}/src/configuration-transfer.ts` |
| Till defaults | A configured device default selects the initial counter zone; an omitted HTTP zone resolves to the venue default before menu-offer pricing. | `apps/server/src/till-api.test.ts`, `packages/venue-service/src/operations.ts` |
| Dashboard products and menus | Products and categories have their own navigation entry. Menus list offers in the shared data table, create separately priced offers for existing products, edit offer prices and remove offers. | `apps/dashboard/src/screens/catalogue-screen.test.ts`, `widgets/product-list.test.ts`; commits `8c8f6bbe`, `7b4ff039`, `41a4e231` |
| Dashboard venue operations | The contributed Venue operations screen shows departments, zones, hours and preparation routes in shared data tables. Managers can add and remove routes. | `packages/venue-service/src/dashboard/venue-operations-screen.test.ts`; commits `79301a65`, `41a4e231` |
| Readiness and activation | Readiness reports missing department/menu/routing configuration, and an active zone prevents its department from being deactivated. | `packages/venue-service/src/operations.test.ts`, `routes.test.ts`; commit `23a42664` |
| Operational venue boundary | Provisioning refuses any second venue, standby adoption checks before creating a subscription, and trading boot verifies the configured venue is the database's sole venue. | `packages/provisioning/src/tenant-guard.test.ts`, `apps/server/src/adopt.test.ts`, `boot.test.ts`; commit `406f052d` |
| Restaurant/Deli demo | The demo has Restaurant and Deli departments, distinct flows and hours, five zones, shared kitchen preparation, upstairs/downstairs cocktail routing, and one Negroni product offered at two prices. | `apps/server/scripts/demo-seed/*.test.ts`; commits `79301a65`, `c1391fa0`, `f70c045b` |

The following planned work is not part of this branch: removing the legacy product catalogue/price
and fixed-station compatibility fields; enforcing department and zone hours and calendar exceptions;
workforce assignments; immutable sold-line department attribution and department reporting; and
primary/standby replication smoke for the new module rows. The backlog keeps these as explicit
follow-ups rather than describing this slice as the whole plan.

Focused validation recorded during implementation:

- `pnpm --filter @waitron/venue-service test:coverage`: 12 tests passed; statements/lines 99.2%,
  branches 91.33%, functions 100%.
- `pnpm --filter @waitron/composition test`: 15 tests passed.
- `wa-wt reset demo waitron-menus`: rebuilt the database and seeded the exact Restaurant/Deli demo.
  Live management API reads returned five department-bound zones, both Negroni offers, the two
  zone-specific cocktail routes and no readiness findings.
- The final workspace gate, frozen install, whole-branch review and CI belong to `finish-branch` and
  are recorded in the pull request.
