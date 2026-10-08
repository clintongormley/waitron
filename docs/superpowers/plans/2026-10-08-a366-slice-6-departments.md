# Departments, slice 6 — the department list and page, "How orders start", one set of service settings (A366)

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax. Each task is test-first: write the failing behavioural test, run it,
> watch it fail for the stated reason, then the minimal implementation.
>
> **Existing assertions.** The campaign queue's owner decision of 2026-10-05 governs: a check that
> pins behaviour this plan removes (listed under "Behaviour this slice removes") is changed to check
> the new behaviour at least as strictly, in a separate commit whose message begins
> `Changed test checks (A366 slice 6):` and lists each `file:line` with its before and after, and
> the pull request repeats the list under "Changed test checks". Any other assertion that turns out
> to need changing is a STOP: report it, do not edit it. Adding fixture rows, or a key to a
> whole-shape pin, is allowed. **Changing how a fixture says "table service"** — a test that set
> `default_service_mode = 'table_tab'` now sets `order_start = 'table'`, and one that set
> `'prepay'` or `'ticket_then_pay'` now sets `order_start = 'counter'` and leaves paid-when as it
> was (decision 3: the style's `prepay` / `ticket_then_pay` difference never reached an order) — is
> a fixture change, not an assertion change, provided no `expect` in the test changes; list each
> such file in the pull request under "Fixtures that changed how they set the service style".
>
> **Size.** Each task is sized for one implementer well under 100 tool calls. An implementer past
> about 150 calls with the task unfinished stops at a passing or cleanly red point, commits, and
> returns a handover: done, left, files, each check's state.
>
> **Green between tasks.** Before its commit, every task runs its package's whole node project
> (`pnpm --filter @waitron/venue-service exec vitest run --project node`;
> `pnpm --filter @waitron/server exec vitest run` for `apps/server`, which has one project), the
> browser files it touched (`pnpm --filter @waitron/venue-service exec vitest run --project browser
> <files>`), and the typecheck of every package it touched. A task touching a browser package checks
> headroom first (`memory_pressure | grep free`). Read each run's `Tests` count.
>
> **What this plan was read against.** `main` at **`c3d037a5d`**, which already holds slice 1
> (#1460, merged as `685a6074b`), so there is no slice 1 branch to read and every `file:line` below
> is a `main` line. It builds on the [slice 1 plan](2026-10-07-a366-slice-1-service-periods.md)
> (landed) and the unbuilt [slice 2](2026-10-08-a366-slice-2-zone-closed-times-and-named-days.md),
> [slice 3](2026-10-08-a366-slice-3-station-controls.md),
> [slice 4](2026-10-08-a366-slice-4-prep-stations.md),
> [slice 5](2026-10-08-a366-slice-5-monitors.md) and
> [slice 7](2026-10-08-a366-slice-7-receipts-per-department.md) plans, and on the floor plan's
> [A429 plan](2026-10-08-floor-plan.md) (decision 12 and Task 2.7). Before each part, re-read every
> cited line in a file another slice has changed since `c3d037a5d`
> (`git diff --stat c3d037a5d HEAD -- <path>`).
>
> **Start Part A at once (it needs slice 1 only, which has landed); Part B only after slice 2 has
> merged; Part C only after Part A and A429's slice 2 (the floor plan editor) have merged.**

**Goal:** the Departments page becomes a list of departments, each opening its own page with a
Settings tab and a Zones tab, as the approved mock-ups (screens 2 and 3 of `all-screens-v3.html`,
kept outside the tree) describe. A venue with one department opens that department straight away.
A department and a zone set the same four service settings in the same words — How orders start,
When counter service is used (with "Print a numbered collection ticket"), and Print a receipt — and
a zone leaves a setting empty to follow its department. The service style (`table_tab`, `prepay`,
`ticket_then_pay` on `departments.default_service_mode` and a zone's `service_mode`) goes: "How
orders start" (table or counter) joins the sale-policy settings, and the counter's two flavours are
the paid-when setting that already exists. The policy tree, the "Ready for service" section, the
older Departments / Service zones tables and the "?" help on Order number go.

**Architecture:** "How orders start" is a new column, `order_start` (`table` or `counter`), on the
two tables that already hold the other service settings per department and per zone override
(`department_sale_policies` and `zone_sale_policies`, `packages/venue-service/src/schema/service.ts:99-138`),
resolved by the reader that already resolves them (`resolveSalePolicy`,
`packages/venue-service/src/operations.ts:570-611`). The zone's order flow that the till and the
server read (`resolveZoneContext(...).serviceMode`, `:521-555`, and the snapshot written when an
order opens, `recordOrderServiceContext`, `:947-965`) is worked out from it: `table_tab` when the
zone starts orders at a table, otherwise the zone's paid-when. The order snapshot
(`order_service_contexts.service_mode`) and the module contract's `ServiceMode` keep their three
values, so the till and every server path that reads an order's flow do not change. The old columns
are written beside the new one while the readers and the fixtures move (expand, then contract), and
dropped in the last migration. The dashboard page is split out of the 2030-line
`venue-operations-screen.ts` into a list element, a department page element and its two tab
elements, built beside the old page and switched in one task.

**Tech stack:** TypeScript, drizzle on SQLite (`node:sqlite`), Hono, Lit, Vitest (node and real
Chromium browser projects).

**Spec:** [Service times, departments, zones and prep stations](../specs/2026-10-07-service-times-departments-and-stations-design.md)
§3 (Department, Zone), §6 (service settings; not "Closed times"), §9.1 (all but the Receipt tab),
§12 (the service style, the tree table and the "Ready for service" tabs, the "?" help on Order
number), §13 item 6. Backlog: A366, and three open entries this slice closes or narrows: "The
'Disabled' note a zone or department can show is not muted" (`docs/backlog.md:1290-1294`), the
Departments and zones screen's missing busy check on close
(`docs/backlog/dashboard.md:110-119`), and the venue-operations part of A331's batch 4b
(`docs/backlog.md:3438-3445`).

**Risk path:** FULL ceremony, two run-it reviews per pull request: migrations (Part A adds two
columns, rebuilding the two sale-policy tables to add their checks, and rebuilds `departments` and
`zone_service_policies` to drop two), a changed cross-package contract
(`EffectiveSalePolicy`, `packages/module/src/module.ts:79-88`, and the venue-service routes' bodies
and answers), and what an order's recorded flow is worked out from (decision 3: no order's flow is expected to
change, which Task A3b's tests hold; the zone answers that echoed the stored style do change).

**Venue reset: needed — required for Part A.** The last migration drops
`departments.default_service_mode` and `zone_service_policies.service_mode`; both carry a CHECK, so
drizzle-kit rebuilds both tables, and a rebuild of `departments` was refused on a venue holding rows
the last time it shipped: the upgrade walk lists `venue-service/0020_retire_invoice_first` in its
`RESETS` as refused with "DROP TABLE `departments`" and "FOREIGN KEY constraint failed"
(`scripts/migration-upgrade.test.ts:251-253`), and `0027_retire_zone_menus` the same for
`zone_service_policies` (`:254-257`). Expected, not measured for this migration: the same refusal.
Task A14 runs the walk and adds the `RESETS` entry with what it prints. Part A's first line:
**"venue reset needed — required: the migration that retires the service style is refused on a
venue with departments and zones"** (with the walk's words if they differ). Parts B and C add no
migration: "no venue reset needed".

---

## What this slice needs from slices 2 to 5

### 1. Every file this slice changes

**Part A (Tasks A1–A15).**

- `packages/venue-service/src/`: `schema/service.ts`, `operations.ts`, `routes.ts`, `errors.ts`
  (only if a new code is needed — decision 9 says none is), `provisioning.ts`,
  `configuration-transfer.ts` (only its test: whole rows are copied, so the new column travels;
  checked by test), `index.ts`, `migrations.test.ts`, `operations.test.ts`, `routes.test.ts`,
  `provisioning.test.ts`, `schema/service.test.ts`, `schema/schema-conformance.test.ts:17` (a
  comment naming `default_service_mode`), and the venue-service tests that set the old columns
  (Task A13b's list); `drizzle/` (three generated migrations)
- `packages/venue-service/src/dashboard/`: `client.ts`, `live-queries.ts` (the `operations` list
  gains `department_sale_policies` and `zone_sale_policies`, decision 19) and its test, `strings.ts`, `venue-operations-screen.ts` (becomes the shell), new
  `service-settings-fields.ts`, `departments-list.ts`, `department-page.ts`,
  `department-settings.ts`, `department-zones.ts`, `department-dialogs.ts`, and their `*.test.ts`,
  `*.unsaved.test.ts`, `*.a11y.test.ts`; `venue-operations-screen.test.ts`,
  `.unsaved.test.ts`, `.a11y.test.ts` (pruned to the shell's cases), `venue-navigation.test.ts`,
  `department-transfers.a11y.test.ts` (moved onto the Settings tab), `client.test.ts`,
  `index.test.ts`
- `packages/module/src/module.ts` (`EffectiveSalePolicy`, `:79-88`, gains `orderStart`;
  `ServiceZoneSummary.serviceMode` and `ServiceMode` stay — decision 4; the configuration writers'
  inputs are venue-service's own, not the module contract's)
- `apps/dashboard/src/navigation.ts` (the `venue-operations` children) and `navigation.test.ts`
- `apps/server/src/`: `till-api.ts` (the offers answers' hand mapping, `:1330-1331`,
  `:1358-1359`, decision 3); `testing/service-zone.ts`, `testing/zone-offers.ts`,
  `testing/order-venue.ts`, `testing/venue-fixtures.ts`; the server tests that set the old columns
  (Task A3a, A12a and A12b lists); `testing/fixtures/configuration-v1-before-printing-retirement.json` (only if the import
  test reads its `default_service_mode`; Task A14 checks)
- `apps/server/scripts/demo-seed/seed-floor.ts` (`:81-131`), `seed.test.ts` (`:414-439`,
  `:553-558`), `seed-floor.test.ts:124`
- `scripts/migration-upgrade.test.ts` (`RESETS`), `scripts/schema-constraints.test.ts` (`:480` and
  `:660` name the two dropped checks), `scripts/live-subscriptions.test.ts` (run)
- `docs/developers/design-system.md` (`:425`, `:676`, `:3227-3228`, and a Departments section),
  `docs/developers/conventions-ui.md:276`, `docs/developers/testing-guide.md:1128` (only if the a11y
  file it names is renamed), `docs/developers/conventions-data.md` (the service settings),
  `docs/backlog.md`, `docs/backlog/service-periods.md`, `docs/backlog/dashboard.md`

**Part B (Task B1).** `packages/venue-service/src/dashboard/department-zones.ts` and its tests,
`strings.ts`, and slice 2's `opening-hours-client.ts` (read only).

**Part C (Task C1).** `department-zones.ts` and its tests, `strings.ts`; `packages/venue-service/src/dashboard/venue-operations-screen.ts`
only if A429 Task 2.7 put the floor plan action there; A429's canvas primitive (a read-only
property, if it has none).

### 2. Does this slice need slice 2, 3, 4 or 5?

| What (spec) | Needs | What was checked |
| --- | --- | --- |
| The list, the department page, the Settings tab, "How orders start", the service settings in the same words, the tree and old tabs removed (§6, §9.1, §12) | **Slice 1 only (landed).** | The Setup column's "has no opening periods" reads slice 1's periods through the readiness reader (`listVenueReadiness`, `operations.ts:340-431`, `department.no_periods` at `:377-384`), already on `main`. The service settings are today's sale-policy tables plus one column (`schema/service.ts:99-138`); none of slices 2–5's plans changes those tables (a search of the four plan files for `department_sale_policies`, `zone_sale_policies`, `default_service_mode`, `salePolic`, `serviceMode` and `venue-operations` found no line, run 2026-10-08 on the four files at `c3d037a5d`). |
| Tab transfers on the Settings tab (§9.1) | **Neither slice 5 nor any other.** | The transfer settings and their rules exist today (`routes.ts:893-936`; `department-transfers.ts:76-92`, `:117-162`, which refuse a kitchen-display profile and a profile not scoped to the department). Slice 5 adds monitors to profiles and keeps profile kinds (its decision 2, `2026-10-08-a366-slice-5-monitors.md:167-168`: "only a `kds` profile lists monitors"), so the receiving-profile choices do not change. |
| The zone's one-line summary of its closed times, linking to Opening hours (§9.1) | **Slice 2 → Part B.** | Closed times do not exist until slice 2 (its Tasks 2, 8: `zone_closed_times`, `replaceZoneClosedWeek`, the `zones` array in `OpeningHoursModel`); slice 2 leaves "the Departments page's Zones tab and its closed-times summary" to this slice (`2026-10-08-a366-slice-2-zone-closed-times-and-named-days.md:70-71`). The link targets slice 2's zone view (its Task 16, `zone` in the Opening hours URL). |
| "Edit floor plan" / "Add a floor plan" and the small plan preview (§9.1) | **A429 slice 2 → Part C.** | A429 decision 12 (`2026-10-08-floor-plan.md:123-127`) puts the action on today's zone row menu and leaves "the plan's preview on the zone page" to this slice; the editor's URL and the canvas primitive arrive in A429 Tasks 2.3–2.4 (`:1113-1132`) and the entry point in Task 2.7 (`:1138-1140`). |
| Manager extensions; station controls (slice 3) | **Neither.** | §10 puts them on the till and the kitchen display only; nothing in §9.1 shows live state. |
| Prep stations (slice 4) | **Neither.** | Slice 4 changes `configureZone` (`operations.ts:433-469`; its Task A5 and decision 10: a zone moved to another department loses its cells' period choices for the old department, `2026-10-08-a366-slice-4-prep-stations.md:767-768`). This slice's "Move to another department" calls the same route and inherits whatever slice 4 decides; its own change to `configureZone` is the input (decision 2), in a different part of the function. |
| Monitors (slice 5) | **Neither.** | As above for transfers; slice 5 touches device profiles' monitors and the till's monitor screens, not departments or zones. |

**Conclusion.** **Part A** (Tasks A1–A15) needs slice 1 only, which has landed, so it can be built
now, beside slices 2–5; building it before slices 2–5 departs from the spec's order (decision 1).
**Part B** (Task B1, the closed-times summary) needs slice 2. **Part C** (Task C1, the floor plan
action and preview) needs A429's slice 2. Slice 7's Part B needs Part A of this slice (its Receipt
tab goes on this slice's department page).

### 3. Files shared with other slices (same files, different areas)

- **Slice 2** (unbuilt): `packages/venue-service/src/operations.ts` (`listZoneOffers`, slice 2
  Task 10; this slice changes `resolveZoneContext`, `listServiceZones`, `resolveSalePolicy` and
  the configuration writers), `routes.ts`, `errors.ts`, `index.ts`, `migrations.test.ts`,
  `dashboard/strings.ts`, `apps/dashboard/src/navigation.ts` (slice 2 Task 16 adds `zone` to the
  `opening-hours` children; this slice adds a `venue-operations` entry), `apps/server/src/till-api.ts`
  (slice 2's closed-zone refusals; this slice's one line in the dead-ends route), the venue-service
  journal.
- **Slice 3** (unbuilt): `operations.ts`, `routes.ts`, `till-api.ts`, `module.ts`, the journal.
- **Slice 4** (unbuilt): `operations.ts` (`configureZone`), `packages/ui/src/components/wt-tabs.ts`
  (its Task A12 adds an overflow mark; this slice's department page uses `wt-tabs` as it is),
  `routes.ts`, the journal.
- **Slice 5** (Part A may land first): `module.ts`, `routes.ts`, the journal,
  `apps/server/src/testing/*` fixtures.
- **Slice 7** (Part A may land first): `routes.ts` (`departments-and-zones` gains `isDefault`,
  slice 7 decision 14), `dashboard/strings.ts`; slice 7 Part A's Receipts page is where this slice's
  Settings tab links "Edit the receipt" (decision 11), and slice 7 Part B adds the Receipt tab to
  this slice's department page and moves the trading name and its switch onto it.
- **A429** (lane E): its Task 2.7 adds "Edit floor plan" to today's zone row menu
  (`venue-operations-screen.ts:1554-1596`, at `c3d037a5d`; A429 cites the older `:1536-1574`).
  Whichever lands second carries it: if A429's slice 2 lands before Task A10, Task A10 moves the
  action onto the zone panel; if after, A429 Task 2.7 adds it to the zone panel instead (Part C
  then adds only the preview).

A drizzle migration-number clash in the venue-service journal is repaired by regeneration, never
by hand (CLAUDE.md §3).

---

## Decisions this plan makes that the spec does not

Each is the DEFAULT to build; the owner may override any when reviewing the plan.

1. **Three pull requests, the first now.** Part A (everything but the closed-times summary and
   the floor plan) after slice 1, which has landed; Part B after slice 2; Part C after A429's
   slice 2. This departs from §13's order (slices 2–5 before 6). Why: Part A needs nothing from
   slices 2–5 (section 2), and slice 7 Part B waits on it. Override: one pull request after slice
   5, in the spec's order.
2. **"How orders start" is stored with the other service settings.** DEFAULT: a column
   `order_start` (`'table'` or `'counter'`) on `department_sale_policies` (not null, default
   `'counter'`) and on `zone_sale_policies` (null = follow the department), read by
   `resolveSalePolicy` as the zone's value else the department's, exactly as `paid_when` is
   (`operations.ts:570-611`). `departments.default_service_mode` and
   `zone_service_policies.service_mode` are dropped (Task A14). The configuration writers'
   inputs change from `defaultServiceMode` / `serviceMode` (three values) to `orderStart`
   (two values): `createDepartment` and `updateDepartment` (`operations.ts:145-189`),
   `configureZone` (`:433-469`), and the routes that feed them (`routes.ts:697-724`, `:798-814`,
   `:836-853`). Considered and rejected: keeping the stored column and showing its three values in
   new words — the column would keep a third value (`ticket_then_pay` vs `prepay`) that orders
   already ignore (decision 3) and §12 says the service style goes.
3. **A counter order's flow is its paid-when — as it already is.** Today an order's record is
   `table_tab` when the zone's service style is `table_tab`, else the zone's paid-when
   (`recordOrderServiceContext`, `operations.ts:954-957`; `retargetOrderServiceContext`,
   `:978-981`; the offers answers, `apps/server/src/till-api.ts:1330-1331`, `:1358-1359`), so the
   style's `prepay` / `ticket_then_pay` difference never reaches an order. The other readers of
   the zone's style on an order's path compare it with `table_tab` only (`move-bill.ts:244`,
   `:428`; `working-order.ts:1242`; the till's counter zone list, `till-api.ts:1334-1336`). The one
   order-path reader that takes the raw value, `POST /api/dead-ends/sale` (the read at
   `till-api.ts:1447-1451`), gives the same answer for `prepay` and `ticket_then_pay` on a new order
   (the plan's reviewer evaluated the route's expression, `:1454-1463`, for each value: `table_tab`
   pay false, place true; `prepay` and `ticket_then_pay` pay true, place true). The raw value also
   reaches the old page's Service style column and the zones the routes answer (`routes.ts:592`,
   `:603`; `venue-operations-screen.ts:1719`). DEFAULT: `resolveZoneContext` and
   `listServiceZones` answer `serviceMode` as `orderStart === "table" ? "table_tab" : paidWhen`,
   which keeps every order's flow as today; the zone ANSWERS change where a zone's stored style was
   `ticket_then_pay` with paid-when `prepay` (they now say `prepay`), and the checks pinning that
   are listed in Task A3b. So a fixture that set the style to `ticket_then_pay` becomes
   `order_start = 'counter'` with its paid-when untouched. Setting its paid-when to
   `ticket_then_pay` instead would CHANGE those tests: for example the `offerProducts(...)` callers
   at `receipt-language.test.ts:423`, `parties.test.ts:1260`, `cancel-invoiced-order.test.ts:177`,
   `:549`, `:581`, `collect-by-invoice.test.ts:46`, `till-api.move-bill.test.ts:38`,
   `venue-details.test.ts:1342`, `location-settings-api.orders-open.test.ts:387`, `:427` and
   `unpaid-departure.test.ts:83` pass that style with no paid-when and sell prepaid today. The two tests that update the style to `ticket_then_pay`
   (`apps/server/src/till-api.fiscal-sale-paths.test.ts:2969`, `:3021`, which call `/api/sales`
   and `/prep`) are run first with the update deleted: if they pass, the update is deleted (it had
   no effect); if one fails, find what read the style before changing anything — STOP if it is not
   explained.
4. **The order's own record keeps its three values.** `order_service_contexts.service_mode`
   (`schema/service.ts:263-295`) and the module contract's `ServiceMode`
   (`packages/module/src/module.ts:71`) stay `table_tab | prepay | ticket_then_pay`: they record how
   one order runs (table service, counter paid before preparation, counter paid at collection — the
   spec's three replacements, §6), not a setting. The till (`apps/till/src/api/client.ts:374-396`,
   `till-app.ts:2406-2407`) and every server reader of an order's flow (`move-bill.ts`,
   `working-order.ts:5562-5584`, `:5876-5892`, `till-sale.ts:1547-1559`, `receipt-print.ts:216`) are
   not changed.
5. **A new department starts with counter service, paid before preparation, no collection
   ticket, receipt always.** These are the columns' defaults today (`schema/service.ts:103-106`)
   plus decision 2's `'counter'`; today's Add department dialog defaults the style to `prepay`
   (`venue-operations-screen.ts:1835`), which is the same thing. Provisioning's first department
   (`provisioning.ts:36-49`) gets the same. The demo's Restaurant gets table service and its bar
   zones counter service, as today (`seed-floor.ts:81-131`, Task A15).
6. **The list.** Columns: Department (its name, a link that opens it), Trading name, Zones (the
   names of its active zones, comma-separated, or "No zones"), Setup. The ⋮ menu (key `actions`,
   pinned at the end — CLAUDE.md §3) holds Open, Rename and Disable, or Enable for a disabled
   department (§9.1). "+ Add department" above the table. A disabled department's row says
   "Disabled" in the Setup column (§9.1) and, in muted text, after its name (closing the backlog's
   "not muted" entry). The Transfers and Opening hours row actions go: transfers move to the
   Settings tab (§9.1) and Opening hours has its own department picker (slice 1).
7. **The Setup column shows the readiness reader's issues for that department, in today's
   sentences.** DEFAULT: `department.no_periods` for the department (with today's "Set up Opening
   hours" link, using the path form `/manage/opening-hours/department/<id>`, which the Opening hours
   screen reads; today's query form, `venue-operations-screen.ts:49-50`, cannot select the
   department, because `UrlStateController` reads path segments only,
   `packages/ui/src/url-state.ts:58-76`), and each of its zones' `zone.menu_unpublished` and `zone.menu_empty`, prefixed by the
   zone's name; nothing when there is none; "Disabled" for a disabled department. The spec's
   example ("'Counter' period has no menu") cannot arise as worded: a period's menu is required
   (`menu_periods.menu_id` not null, `schema/menus.ts:28`), so no new readiness code is added.
   The venue-wide issues have no department: `venue.default_station_missing` shows as one line
   above the list linking to Prep stations. `venue.department_missing` fires when no department is
   ACTIVE (`operations.ts:357-362`): with no departments at all it is the list's empty state ("No
   departments yet." stays the empty sentence, `design-system.md:676`); with only disabled ones it
   is a line above the list, "No department is enabled: enable one to take orders". A zone in no
   department (`zone.department_missing`, today's "Not configured" rows,
   `venue-operations-screen.ts:1025-1029`) is listed in one line under the table, "Zones in no
   department: Patio", each with "Add to a department" (a dialog choosing an active department,
   `configureZone`). The page's department view shows the same issues for itself, on a line under
   its heading.
8. **One department: the page opens it.** DEFAULT: when the venue has exactly one department,
   active or not, `/manage/venue-operations` shows that department's page with no "Departments ›"
   line (there is no list to go back to) and with "+ Add department" beside the heading; adding a
   second one opens the new department's page, and from then on the bare address shows the list.
   A department address (`/manage/venue-operations/department/<id>`) always shows that department.
   A254 §2 and §9.1 ("A venue with one department skips the list") do not say how a second is added;
   this is the default.
9. **One Save per tab, one request per Save.** DEFAULT: two new routes, each one transaction
   (CLAUDE.md §3: one `withTransaction` per request):
   `PUT /management-api/venue-service/departments/:departmentId/settings`, body
   `{ name, tradingName, printTradingName, orderStart, paidWhen, collectionNumber, receiptPrintMode,
   transfers?: { receivingProfileId, destinationDepartmentIds } }` (strict keys; `transfers` only
   when the Settings tab shows them, decision 10), and
   `PUT /management-api/venue-service/zones/:zoneId/service-settings`, body
   `{ orderStart, paidWhen, collectionNumber, receiptPrintMode }`, each a value or `null` to follow.
   Both require `venue_service.manage` like the routes they replace (`routes.ts:272-284`) and reuse
   today's validators and codes (`department.name_taken`, `department.name_disabled`,
   `department.not_found`, `management.request_invalid` with `field`,
   `department_transfer.settings_invalid`, `service_zone.not_found`); no new error code. Like the
   sale-policy and transfer writers they reuse, both refuse a disabled department or zone
   (`setDepartmentSalePolicyField` needs an active department, `operations.ts:688-697`;
   `setDepartmentTransferSettings` too, `department-transfers.ts:119`; `setZoneSalePolicyOverride` a
   live zone, `:712`; `updateDepartment` itself checks no active flag, `:176-189`), so decision 18
   makes those forms read-only. The per-field sale-policy routes (`routes.ts:726-769`, `:855-891`)
   stay, gaining `orderStart`. `PATCH .../departments/:id` (`:697-724`, which today needs name,
   trading name and style together) keeps `{ active }` and, after Task A13a, takes any of
   `{ name, tradingName }`, so the list's Rename and slice 7 Part B's Receipt tab (its Task B2 keeps
   "their current routes … unless slice 6 changed them") can each write their own field.
10. **The Settings tab.** In order: Name; "Service settings" — How orders start (Table service /
    Counter service), "When counter service is used" (Paid before preparation / Paid at collection,
    and the switch "Print a numbered collection ticket"), Print a receipt (Always / On request /
    Never); a line "Zones that differ: Terrace (Counter service), Bar (Receipt on request)", each
    zone a link to the Zones tab with that zone chosen, or nothing when none differs; "On the
    receipt" — Trading name and the switch "Print the trading name above the legal name" (today's
    "Print it", `venue-operations-screen.ts:1234-1268`), and a link "Edit the receipt" (decision
    11); "Tab transfers" — "Allowed destinations" (checkboxes, the other active departments) and
    "Receiving desk profile" (`wt-combobox`, "None" first), shown only when the venue has two or
    more ACTIVE departments (§9.1 says "two or more departments"; a disabled one cannot be a
    destination, `venue-operations-screen.ts:1755-1757`). "When counter service is used" stays
    editable when How orders start is Table service, with the hint "Also used by zones set to
    counter service": a zone can override to counter and follow the rest (§6). The field names are
    `name`, `orderStart`, `paidWhen`, `collectionNumber`, `receiptPrintMode`, `tradingName`,
    `printTradingName`, `transferDestination-<id>`, `receivingProfileId`.
11. **Where the trading name, its switch and the receipt's print mode live until slice 7 Part B.**
    DEFAULT: the trading name and "Print the trading name above the legal name" are in the
    Settings tab's "On the receipt" section; "Print a receipt" is a service setting (§6, §9.1) on
    the Settings tab and on each zone; "Edit the receipt" links to
    `/manage/venue-settings/view/receipts?departmentId=<id>` (today's "Preview" link,
    `venue-operations-screen.ts:1199-1202`; after slice 7 Part A that page edits this department's
    receipt). Slice 7 Part B moves the trading name, its switch and the link onto the Receipt tab
    and shows "Print a receipt" there as a read-out with the zones that differ (its Task B2); this
    slice's Settings tab is written so that removing the "On the receipt" section is one block.
12. **The Zones tab.** A row of buttons, one per zone of this department in `display_order`
    (`aria-pressed` on the chosen one; a disabled zone's button says "(disabled)" in muted text),
    then "+ Add zone". The chosen zone (in the URL as `zone`; the first zone when none is named)
    shows: its name as an `h2`; its service settings, each empty field following the department
    with the department's value as its placeholder ("Same as the department: Table service");
    one Save (`PUT .../zones/:zoneId/service-settings`); and a ⋮ menu with **Rename**, Move to
    another department (only when another active department exists), and Disable, or Enable when
    disabled and the department is active (today's rule, `:1582-1595`). **Rename is in the menu
    rather than an editable name field** because a zone's name is a core table renamed through
    `PATCH /management-api/zones/:id` under `venue.configure` with its own clash rules
    (`apps/server/src/management-api.ts:1674-1709`, `tables.ts:293-354`), so one Save could not
    cover both in one transaction (decision 9). Override: a name field in the zone's form, saved by
    a second request before the settings. A department with no zones shows "No zones yet." and the
    Add button. **On a zone, "Print a numbered collection ticket" is a three-way choice** (Same as
    the department / Print / Don't print), not the department's switch, because a switch cannot
    say "follow"; §6 calls it a switch without saying how a zone follows it.
13. **The "Departments ›" line follows the sub-page pattern by hand, as a plain link.** The
    pattern (`docs/developers/design-system.md:3058-3067`) is drawn by one page today, by hand
    (`apps/dashboard/src/screens/menus-screen.ts:2899-2918`). DEFAULT: the department page draws it
    the same way: a `nav` named "Departments" holding `<a href="/manage/venue-operations">` and the
    `›`, then the department's name as the one `h1`, then "(Disabled)" in brackets after it when it
    is. The link needs no click handler of its own: the dashboard app catches a click on a
    `/manage/…` anchor in the capture phase (unless the anchor opts out with `data-own-click`, is a
    download, a `#` link, another target or `aria-disabled`), leaves a modifier-click to the browser
    and navigates through the leave guard (`#onAppLink`, `apps/dashboard/src/dashboard-app.ts:862`, `:1545-1574`). The
    pattern names no shared component, so none is added. Override: a `wt-*` heading primitive (with
    its token and a11y tests, CLAUDE.md §3) that both pages use.
14. **Addresses.** `/manage/venue-operations` (the list, or decision 8's single department);
    `/manage/venue-operations/department/<id>` (the Settings tab);
    `/manage/venue-operations/department/<id>/view/zones[/zone/<zoneId>]`. `apps/dashboard/src/navigation.ts`
    gains `"venue-operations": { department: "department", view: "view", zone: "zone" }`, and the
    screen's own `UrlStateController` config (`venue-operations-screen.ts:415-422`) matches it.
    Old bookmarks (`/view/departments`, `/view/zones`, `/view/status`, … pinned by
    `venue-navigation.test.ts:54-87`) still land on the bare address, as today. An unknown or other
    venue's department id shows "This department no longer exists." with a link to the list.
    Switching department, tab or zone with unsaved edits asks first (the leave coordinator), as
    every dashboard address change does.
15. **Dialogs.** Add department (Name; trading name defaults to the name, `operations.ts:156`),
    Rename department (Name), Add zone (Name; the department is this one), Rename zone (Name), Move
    zone (Department: the other active departments), Add to a department (decision 7), and the
    Disable confirmation with today's removal impact (`venue-operations-screen.ts:932-960`,
    `:1889-1904`). Each is a `wt-modal` (`compact` for Disable, `standard` otherwise) that follows
    A331's save rule (`draftScopeFor`, `saveActionState`, an early return in the save handler),
    sets `.dismissible=${false}` while its request runs (`packages/ui/src/components/wt-dialog.ts:120-132`;
    closes the backlog entry at `docs/backlog/dashboard.md:110-119` for this screen), and keeps
    today's refusal mapping: a name clash with a disabled department or zone offers "Enable
    <name>" (`venue-operations-screen.ts:715-726`).
16. **The page stays manager-only, with no read-only view.** `requiresPermission:
    "venue_service.manage"` and no `readPermission` (`packages/venue-service/src/dashboard/index.ts:16-22`),
    as today. Zone rename, disable and enable keep calling the core zone routes under
    `venue.configure`, as today.
17. **"Print a receipt"'s three values keep today's meaning.** On request and Never behave the same
    today (`enqueueSaleReceipt`, `apps/server/src/receipt-print.ts:202-225`, prints automatically
    only for `auto`; the till offers "Print receipt" whenever the mode is not `auto`,
    `apps/till/src/till-app.ts:8289`). This slice changes the words only. Recorded for the owner,
    not changed.
18. **A disabled department's page and a disabled zone are read-only.** DEFAULT: the Settings tab
    and a disabled zone's settings show their values with every field disabled, a line "Enable this
    department to change its settings" (or "… this zone …") and the Enable action; no Save. Why: the
    writers refuse an inactive department or zone (decision 9), and enabling first is today's order
    of things. Rename stays offered for both only if its route accepts a disabled one — Task A7
    tests that before relying on it, and hides Rename if not.
19. **The page follows a change made elsewhere.** The page's live query
    (`QUERY_DEPENDENCIES.operations`, `packages/venue-service/src/dashboard/live-queries.ts:68-87`)
    names `departments` and `zone_service_policies` but neither sale-policy table, so today a
    paid-when change made in another tab reaches it only at the 60-second refresh
    (`venue-operations-screen.ts:443`). DEFAULT: add `department_sale_policies` and
    `zone_sale_policies`; `scripts/live-subscriptions.test.ts` says whether the server's change
    feed knows them (CLAUDE.md §3: an unknown name closes the tab's whole stream).

## Where the code differs from what the spec assumes

- §6 says a department "sets each one" of the service settings and a zone "leaves the field empty
  to follow it": three of the four already work this way (`department_sale_policies` /
  `zone_sale_policies`, `schema/service.ts:99-138`); the service style is the one with a different
  home (decision 2).
- §9.1's "Settings tab: name; the Service settings of section 6": the trading name and its switch
  are not in §9.1's Settings list but are on today's tree; §11 puts them on the Receipt tab, which
  slice 7 Part B builds (decision 11).
- §9.1's Zones tab ⋮ menu lists "Move to another department and Disable"; a zone's rename needs
  the menu too (decision 12).
- §6 says How orders start "is the default; staff can still choose per order (A254 §3.1)". Today it
  is a rule, not a default: seating a party in a counter zone is refused
  (`service_zone.mode_incompatible`, `apps/server/src/working-order.ts:1241-1250`), and a table zone
  is left out of the till's counter zone list (`till-api.ts:1334-1336`). Choosing per order is
  A254 §3.1's open question, which the spec leaves open (§14). This slice keeps today's rule.
- §12's "the 'Ready for service' tabs": the readiness is a section, not tabs
  (`venue-operations-screen.ts:978-997`); the tabs below it are the older Departments / Service
  zones tables (`:2009-2020`). Both go.

## Global constraints

- Every commit `git commit -s`. Never `--no-verify`.
- Work in this branch's worktree; never commit to `main`.
- A shipped migration file is never edited. New migrations only, generated by drizzle-kit against
  the current tree; the number is whatever it assigns. drizzle-kit 0.31.11: a generation that
  rebuilds a table must not also add a column to it (CLAUDE.md §3), so a new column and its CHECK
  are two generations.
- Before generating a migration that rebuilds a table, list the foreign keys pointing at it and
  their `ON DELETE` (CLAUDE.md §3: the rebuild runs with foreign keys on).
- No data-migration code before go-live (CLAUDE.md §3): the old style is not converted into
  `order_start`; the reset recreates.
- Columns come from `packages/db/src/schema/columns.ts` (`enumType` and `enumCheck` as the other
  sale-policy columns, `schema/service.ts:95-97`); guard `scripts/column-vocabulary.test.ts`.
- Every foreign key and unique index is declared in the TypeScript schema.
- Error codes name the domain concept; this slice adds none (decision 9).
- venue-service functions take `cfg: VenueScope`. Multi-table writes take one `tx: Transaction`;
  queries on one transaction are awaited in turn, never `Promise.all`.
- New UI reads `--wt-*` tokens only; a screen does not draw its own `<select>`, `<textarea>` or
  text `<input>` (guard `scripts/native-form-fields.test.ts`, which does not count a checkbox,
  `:20-31`; there is no `wt-checkbox` in `packages/ui`, so the transfer destinations stay native
  `<input type="checkbox">` as today, `venue-operations-screen.ts:1766-1772`); forms follow `docs/developers/design-system.md` → Forms and A331's save rule
  (`draftScopeFor` + `saveActionState` + an early return in the save handler, `packages/ui/src/leave-controller.ts:115`,
  `:141`), each with an `*.unsaved.test.ts` holding the reconnect case. A `wt-data-table` row menu
  column is keyed `actions` and pinned at the end.
- Markup handed to `wt-data-table` as a cell is styled with `part=`, never a class (CLAUDE.md §3).
- Strings in English and Spanish. New words: How orders start / Cómo empiezan los pedidos; Table
  service / Servicio de mesa; Counter service / Servicio en mostrador; When counter service is used
  / Cuando se usa el servicio en mostrador; Paid before preparation / Se paga antes de preparar;
  Paid at collection / Se paga al recoger; Print a numbered collection ticket / Imprimir un tique
  de recogida numerado; Print a receipt / Imprimir el recibo; Same as the department: {value} /
  Como el departamento: {value}; Zones that differ / Zonas con otros ajustes; Edit the receipt /
  Editar el recibo; Departments / Departamentos (the trail's link). Reuse `venue.always`,
  `venue.on_request`, `venue.never`.
- Coverage stays at 98/98/98/95 in every package touched.
- Comments only for an invariant or a non-obvious why; no history. When the schema's comment "Not
  the enumText/enumCheck pair … here or in the four other checked value-set columns"
  (`schema/service.ts:32-34`, and its pointers at `:64`, `:270`, `:315-317` and
  `schema/schema-conformance.test.ts:17`) loses `default_service_mode`, re-home it on a column that
  keeps it (`order_service_contexts.service_mode`) or cut it — never leave a pointer to a dropped
  column.

## Behaviour this slice removes

Tests pinning these may change, under the commit rule above:

- The service style as a department and zone setting: `departments.default_service_mode`,
  `zone_service_policies.service_mode`, their checks, the `defaultServiceMode` / `serviceMode`
  inputs and answers (`listDepartments`, `listServiceZones`' `serviceModeOverride`, the
  departments POST/PATCH and zone PUT bodies), and the dashboard's "Service style" field and columns.
- The zone's answered `serviceMode` coming from the stored style rather than from How orders start
  and paid-when (decision 3: no order's flow is expected to change; a zone stored as
  `ticket_then_pay` with paid-when `prepay` now answers `prepay` — `operations.test.ts:569-571`,
  `:584-588`, `apps/server/src/testing-zone-offers.test.ts:286`).
- `PATCH .../departments/:id` requiring name, trading name and style together (decision 9).
- The policy tree, its inline name, trading name and cell editors; the "Ready for service" section;
  the Departments / Service zones tables and their column choosers; the department row's
  Transfers, Edit and Opening hours actions; the transfers modal (now a Settings tab section); the
  Order number "?" help (`venue-operations-screen.ts:1358-1363`, `strings.ts:314-315`).
- The demo's departments and zones pinned by style (`seed.test.ts:414-439`, `:553-558`;
  `seed-floor.test.ts:124` orders by `default_service_mode`).

Tests that pin behaviour this slice KEEPS move to the new elements and must still pass there,
unchanged in what they assert (Tasks A6–A9 name each): a name clash offering Enable ("reserved venue
names", `venue-operations-screen.test.ts:3546`); enabling a disabled zone and department (`:848`,
`:984`); an editor's refusals beside their fields and its bottom message (`:2671`, `:2690`); Enter
submitting (`:3020`); focus returning to the Add button (`:3145`); the shared field components
(`:3243`); phone width (`:3397`); transfer configuration (`:3813`); a write followed by a failed
refresh closing the editor and showing a load error ("refreshing the list fails", cited at
`docs/developers/conventions-ui.md:276`); the 1280 px field-width case cited at
`docs/developers/design-system.md:425`; and every case in `venue-operations-screen.unsaved.test.ts`
whose behaviour survives (leave questions on an unsaved editor, reconnect).

## Review focus

The conditions most likely to bite a person that no single task's happy path exercises. Each has
its test in the task named.

1. **A zone following its department.** The Restaurant is table service with receipts always; its
   Terrace overrides to counter service, paid at collection; its Bar follows everything. Change the
   Restaurant to receipts on request: the Bar's receipt follows, the Terrace keeps its own counter
   setting and follows the receipt; the Settings tab's "Zones that differ" names only the Terrace;
   the Terrace's empty receipt field's placeholder reads "Same as the department: On request"
   (Tasks A2, A8, A9).
2. **Table or counter decides the till.** A table-service department with a counter-service zone:
   seating a party in that zone is refused (`service_zone.mode_incompatible`,
   `apps/server/src/working-order.ts:1241-1250`); a counter sale there follows the zone's
   paid-when, and `POST /api/dead-ends/sale` agrees with `POST /api/working-orders` about whether
   paying sends the dishes (Task A3b).
3. **The two settings that used to be one.** A department set to counter service and paid at
   collection: a new order's snapshot is `ticket_then_pay`, the collection ticket prints at placing
   when "Print a numbered collection ticket" is on (`working-order.ts:5580-5582`), and not when it
   is off (Task A3b).
4. **Unsaved edits across addresses.** Edit the Restaurant's receipt setting, then click the Zones
   tab, another department in the trail, or the browser's back button: the leave question asks;
   Keep stays with the edit; Discard goes. The same on a zone, switching zone. Reconnecting the page
   keeps asking. Escape during a dialog's save does not close it (Tasks A7, A8, A9, A10).
5. **One department, then two.** A fresh venue opens straight on its department; "+ Add
   department" makes a second and opens it; the bare address now shows the list; disabling the
   second still shows the list (two departments exist) (Task A10).
6. **The retirement migration on a populated venue.** The upgrade walk shows the refusal Task A14
   records in `RESETS`, and a freshly migrated venue sells at a counter and at a table (Task A14).
7. **Export and import.** A configuration bundle carries each department's and zone's
   `order_start` under the importing venue's ids (Task A1).

---

## Part A — the department list and page, and "How orders start" (first pull request)

### Task A1: Migration — "How orders start" on the service settings (add only)

**Files:**
- Modify: `packages/venue-service/src/schema/service.ts` (`departmentSalePolicies :99-118`,
  `zoneSalePolicies :120-138`), `packages/venue-service/drizzle/` (two generated migrations)
- Test: `packages/venue-service/src/schema/service.test.ts`, `migrations.test.ts`,
  `apps/server/src/configuration-transfer.test.ts` (a round trip),
  `scripts/schema-constraints.test.ts` (run; edit only if it lists these tables' checks)

**Interfaces:**

```ts
const orderStart = enumType(["table", "counter"]);
// departmentSalePolicies gains
orderStart: orderStart("order_start").notNull().default("counter"),
check("department_sale_policies_order_start_ck", enumCheck(t.orderStart)),
// zoneSalePolicies gains (null = follow the department)
orderStart: orderStart("order_start"),
check("zone_sale_policies_order_start_ck", enumCheck(t.orderStart)),
```

- [ ] **Step 1: Failing tests:** a department policy row without `order_start` reads `counter`; a
  zone row reads `null`; `'tab'` is refused by each table's check; a configuration bundle exported
  with a department at `table` and a zone at `counter` imports with both values under the new ids.
  Run `pnpm --filter @waitron/venue-service exec vitest run --project node src/schema/service.test.ts src/migrations.test.ts`;
  watch them fail (no such column).
- [ ] **Step 2: Generate twice.** First the two columns without their checks (`pnpm --filter
  @waitron/venue-service exec drizzle-kit generate`), then add the two checks and generate again —
  the second generation rebuilds both tables. Before it, list the foreign keys pointing at
  `department_sale_policies` and `zone_sale_policies` (`grep -rn "departmentSalePolicies\.\|zoneSalePolicies\." packages/*/src/schema`);
  expected none, so the rebuilds carry their rows. Read the generated SQL.
- [ ] **Step 3: Run; see them pass;** the venue-service node project; from the root
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts`
  (the walk must carry both tables' rows through both steps); `pnpm --filter
  @waitron/fiscal-verifactu exec vitest run inmutabilidad src/write-path.e2e.test.ts` unedited;
  the server's `configuration-transfer.test.ts`; typecheck.
- [ ] **Step 4: Commit** — `feat(venue-service): a department and a zone say how orders start (A366)`.

---

### Task A2: The service settings carry "How orders start"; the old style is written beside it

**Files:**
- Modify: `packages/venue-service/src/operations.ts` (`createDepartment :145-174`,
  `updateDepartment :176-189`, `configureZone :433-469`, `createServiceZone :472-519`,
  `resolveSalePolicy :570-611`, `listSalePolicies :650-679`, `setDepartmentSalePolicyField
  :681-703`, `setZoneSalePolicyOverride :705-719`, the field unions `:642-647`), `routes.ts`
  (`requireSalePolicyField` and the value sets `:134-153`, the two sale-policy routes `:726-769`,
  `:855-891`), `provisioning.ts`, `packages/module/src/module.ts` (`EffectiveSalePolicy :79-88`),
  `dashboard/client.ts` (`DepartmentSalePolicy`, `ZoneSalePolicy`, `setDepartmentSalePolicyField`,
  `setZoneSalePolicyOverride` accept `orderStart`), `dashboard/live-queries.ts` (decision 19)
- Test: `operations.test.ts`, `routes.test.ts`, `provisioning.test.ts`, `dashboard/client.test.ts`,
  `dashboard/live-queries.test.ts`; run `scripts/live-subscriptions.test.ts`

**Behaviour:** `resolveSalePolicy` and `listSalePolicies` answer `orderStart` (zone's else
department's). The sale-policy routes accept the field `orderStart` (`table`/`counter`, `null` on a
zone). Writing `orderStart` through any writer also writes the old style beside it, so the two
agree for every row written through a writer: `table` → `table_tab`; `counter` → `prepay` unless the
stored style is already `prepay` or `ticket_then_pay`; on a zone `null` → `null`. And the reverse:
the old inputs (`defaultServiceMode` on `createDepartment` / `updateDepartment`, `serviceMode` on
`configureZone`) still work and also write `order_start` (`table_tab` → `table`, `prepay` /
`ticket_then_pay` → `counter`, `null` → `null`). The writers also accept `orderStart` as an input in
place of the old one (Tasks A12–A13 move the callers onto it); given neither, `createDepartment`
writes `counter` (style `prepay`). Provisioning writes `counter`.
Nothing READS `order_start` for an order's flow yet.

- [ ] **Step 1: Failing tests:** `resolveSalePolicy` answers `orderStart` (department `table`, zone
  override `counter` → `counter`; zone `null` → the department's); the department route writes it,
  and `"tab"` is refused 400 `management.request_invalid` with `field: "orderStart"` (the route
  names the field, `routes.ts:152`, as `routes.test.ts` pins for `paidWhen`); each mirroring rule
  above, both directions, read back from both columns; `createDepartment({ name, orderStart:
  "table" })` stores `table_tab` beside it; the live query lists the two sale-policy tables. Run;
  watch them fail.
- [ ] **Step 2: Implement.** One private helper per direction, used by every writer.
- [ ] **Step 3: Run** both node projects (venue-service, server), `pnpm exec vitest run
  scripts/live-subscriptions.test.ts`; typecheck venue-service, module, server, dashboard.
- [ ] **Step 4: Commit** — `feat(venue-service): the service settings carry how orders start (A366)`.

---

### Task A3a: Fixtures that bypass the writers set both words

**Files** (decision 3's mapping; no `expect` changes; re-grep at the start:
`grep -rnE "default_service_mode|service_mode *=|insert\((departments|zoneServicePolicies)\)" apps packages --include='*.ts'`,
and read each hit — the grep also matches assertions, which are NOT changed):
- raw SQL that sets the style: `apps/server/src/till-api.test.ts:1747`, `:1765`, `:1784`, `:1873`;
  `working-order.test.ts:233`, `:1033`, `:1066`, `:1089`, `:1149`, `:3205`;
  `served-at-huella.test.ts:339`; `tabs.test.ts:1007`; `packages/venue-service/src/provisioning.test.ts:180`;
  `migrations.test.ts:461` — each also writes the matching `order_start` on the policy row
- drizzle inserts of `departments` / `zone_service_policies` in tests (`till-api.test.ts:215`,
  `:3504-3515`, `:4318-4330`; `tabs.test.ts:998`; `configuration-transfer.test.ts:3813`;
  `hours-routes.test.ts:120`; `hours-station-model.test.ts:47`, `:401`, `:410`; `hours.test.ts:120`,
  `:1215`; `hours-service-calendar.test.ts:39`; `migrations.test.ts:301`; `hours.live.test.ts:76`):
  where the test needs a zone's flow (it seats, sells or moves), give the department and the zone
  a sale-policy row with `order_start` matching the style — `till-api.test.ts:3504-3515` and
  `:4318-4330` insert neither row today; `tabs.test.ts:998-1007` inserts no department row, while
  its zone already has one from `createZone` (`operations.ts:465-468`), which is UPDATED, not
  inserted again
- `till-api.fiscal-sale-paths.test.ts:2969`, `:3021`: decision 3's run-first rule
- `apps/server/scripts/demo-seed/seed-floor.ts:81-131`: write `order_start` beside the raw style
  (Restaurant `table`; Deli and the two bars `counter`) so the demo keeps its table service once the
  readers switch

- [ ] **Step 1:** make the changes; run the server package and the venue-service node project:
  green, with `git diff` showing no changed `expect`.
- [ ] **Step 2: Commit** — `test: fixtures that write the service style directly also say how orders start (A366)`.

---

### Task A3b: A zone's order flow comes from "How orders start" and "paid when"

**Files:**
- Modify: `packages/venue-service/src/operations.ts` (`listServiceZones :79-113`,
  `resolveZoneContext :521-555`: LEFT join `department_sale_policies` and `zone_sale_policies`; a
  department with no policy row reads the column defaults, as a fresh row would;
  `recordOrderServiceContext :947-965` and `retargetOrderServiceContext :968-999` then store the
  context's `serviceMode` directly), `apps/server/src/till-api.ts` (`:1330-1331`, `:1358-1359`: the
  mapping they do by hand is the context's own value now; the answers keep their shape)
- Test: `operations.test.ts`, `apps/server/src/working-order.test.ts`, `till-api.test.ts`

**Behaviour:** `resolveZoneContext(...).serviceMode` and `listServiceZones`' `serviceMode` are
`table_tab` when the zone's effective `orderStart` is `table`, else the zone's effective `paidWhen`.
`serviceModeOverride` answers the zone's `orderStart` override mapped the same way (`table` →
`table_tab`; `counter` → the zone's own paid-when override, else the department's; `null` → `null`)
until Task A13a removes it. Nothing reads the old columns for behaviour after this task; Task A2's
writers keep them in step for the old page.

- [ ] **Step 1: Failing tests** — cases where the new and old words DISAGREE, written directly:
  `order_start = 'table'` with the old style `prepay`: seating a party works (fails today:
  `service_zone.mode_incompatible`); `order_start = 'counter'` with the old style `table_tab`:
  seating is refused `service_zone.mode_incompatible` (assert status and code) and the zone is in
  the till's counter zone list (`till-api.ts:1334-1336`); a zone overriding to `counter` in a
  `table` department is refused the same way; a department with no sale-policy row reads as counter.
  Regression cases that pass before and after (Review focus 2 and 3): a department at counter, paid
  at collection, records `ticket_then_pay` on a new order and prints the collection ticket at
  placing when "Print a numbered collection ticket" is on, and not when off; `POST
  /api/dead-ends/sale` and `POST /api/working-orders` agree about whether paying sends. Run; watch
  the disagreeing ones fail. Changed test checks (decision 3; separate commit):
  `operations.test.ts:569-571` and `:584-588` and `apps/server/src/testing-zone-offers.test.ts:286`
  expect a zone stored as `ticket_then_pay` with paid-when `prepay` to answer `ticket_then_pay`; they
  now expect `prepay`, and each gains a case where paid-when is `ticket_then_pay` answering
  `ticket_then_pay`, so the check stays as strict.
- [ ] **Step 2: Implement; Step 3: run** both node projects; `git diff --stat -- apps/till` empty
  (the till's answers keep their shape); typecheck.
- [ ] **Step 4: Commit** — `feat(venue-service): a zone's order flow follows how orders start and when counter orders are paid (A366)`.

---

### Task A4: One request saves a department's settings; one saves a zone's

**Files:**
- Modify: `packages/venue-service/src/operations.ts` (new `saveDepartmentSettings`,
  `saveZoneServiceSettings`), `routes.ts` (two routes, decision 9), `department-transfers.ts`
  (`setDepartmentTransferSettings` is called inside the same transaction — read it first; it must
  take the caller's `tx`), `dashboard/client.ts` (`saveDepartmentSettings`, `saveZoneServiceSettings`)
- Test: `routes.test.ts`, `operations.test.ts`, `department-transfers.test.ts`, `dashboard/client.test.ts`

**Interfaces:**

```ts
export interface DepartmentSettingsInput {
  name: string; tradingName: string; printTradingName: boolean;
  orderStart: "table" | "counter"; paidWhen: "prepay" | "ticket_then_pay";
  collectionNumber: "none" | "numbered"; receiptPrintMode: "auto" | "on_request" | "never";
  transfers?: { receivingProfileId: string | null; destinationDepartmentIds: string[] };
}
export async function saveDepartmentSettings(tx: Transaction, cfg: VenueScope, departmentId: string, input: DepartmentSettingsInput): Promise<void>;
export interface ZoneServiceSettingsInput {
  orderStart: "table" | "counter" | null; paidWhen: "prepay" | "ticket_then_pay" | null;
  collectionNumber: "none" | "numbered" | null; receiptPrintMode: "auto" | "on_request" | "never" | null;
}
export async function saveZoneServiceSettings(tx: Transaction, cfg: VenueScope, zoneId: string, input: ZoneServiceSettingsInput): Promise<void>;
```

- [ ] **Step 1: Failing tests:** one PUT saves every field and reads back through
  `GET /management-api/venue-service`; a name taken by another department → 409
  `department.name_taken`, and NOTHING of the body is written (the sale policy and transfers read
  back unchanged — the one-transaction check); a disabled department's name → 409
  `department.name_disabled`; a blank name → 400 `management.request_invalid`, `field: "name"`; an
  unknown key → 400; a transfer to itself → 400 `department_transfer.settings_invalid`, nothing
  written; another venue's department → 404 `department.not_found`; a disabled department → the
  refusal its writers give today (assert the code the test observes and name it in the commit);
  the zone PUT writes four values and four nulls; a disabled zone → today's refusal
  (`operations.ts:705-719`); the old-style mirror (Task A2) also happens through these routes. Run;
  watch them fail (404, no route).
- [ ] **Step 2: Implement**, reusing the existing validators (`requireName`, the sale-policy value
  sets, the transfer body checks at `routes.ts:913-936`).
- [ ] **Step 3: Run** the venue-service node project and the server package; typecheck.
- [ ] **Step 4: Commit** — `feat(venue-service): save a department's settings and a zone's service settings in one request each (A366)`.

---

### Task A5: The service settings fields, shared by a department and a zone

**Files:**
- Create: `packages/venue-service/src/dashboard/service-settings-fields.ts`, `.test.ts`,
  `.a11y.test.ts`
- Modify: `dashboard/strings.ts`

**Interfaces:**

```ts
export interface ServiceSettingsValue {
  orderStart: "table" | "counter" | null; paidWhen: "prepay" | "ticket_then_pay" | null;
  collectionNumber: "none" | "numbered" | null; receiptPrintMode: "auto" | "on_request" | "never" | null;
}
// <dashboard-service-settings-fields .value .follows=${departmentEffective | undefined}
//   .errors .disabled> — fires `service-settings-change` with { value } (app-owned element:
//   plain event name, CLAUDE.md §3)
```

**Behaviour:** four fields as decision 10 words them, `wt-combobox` for the three choices and
`wt-switch` for the collection ticket. With `follows` set (a zone), each field has an empty first
choice whose label and the field's placeholder read "Same as the department: <value>"; empty is
`null`; the collection ticket is decision 12's three-way choice. Without `follows` (a department)
no field is empty. "When counter service is used" carries decision 10's hint when How orders start
is Table service. Field names per decision 10. `disabled` disables every field (decision 18).

- [ ] **Step 1: Failing tests** (Chromium): a department value draws each field's choice; changing
  each fires the event with the new value; a zone with all `null` shows each placeholder naming the
  department's value, in English and Spanish; choosing "Same as the department" fires `null`; the
  names are semantic; `disabled` disables all four. a11y: department, zone and disabled states,
  both themes. Run; watch them fail.
- [ ] **Step 2: Implement; Step 3: run** the venue-service browser files; LOOK in EN and ES, both
  themes, 1280 and 390.
- [ ] **Step 4: Commit** — `feat(venue-service): the service settings fields a department and a zone share (A366)`.

---

### Task A6: The department list

**Files:**
- Create: `packages/venue-service/src/dashboard/departments-list.ts`, `.test.ts`, `.a11y.test.ts`
- Modify: `dashboard/strings.ts`

**Behaviour:** decisions 6 and 7: the table (`viewKey="waitron.venue.departments"`, a new key),
its four columns and the ⋮ menu; the Setup column's sentences and links; the venue-wide lines
above and the "Zones in no department" line below; "+ Add department" (fires `add-department`);
the name link and Open fire `open-department` with the id; Rename, Disable, Enable and "Add to a
department" fire their own events (the dialogs are Task A7). Input: the `VenueServiceView` the page
already loads (`client.ts:60-88`).

- [ ] **Step 1: Failing tests** (Chromium): rows and columns for two departments, one disabled
  (its "Disabled" note muted — assert the computed colour equals `--wt-color-text-muted`'s); Setup
  shows "has no opening periods" with the path-form link, a zone's unpublished menu prefixed by its
  name, nothing for a ready department; the default-station line; the "No department is enabled"
  line (a model handed in directly: the disable route refuses the last active department,
  `department.last_active`, `operations.ts:273-275`, so a real venue reaches it only by import or
  direct write); enabling a disabled department from its menu (carried from
  `venue-operations-screen.test.ts:984`, assertions unchanged); the zones-in-no-department line; each event; the menu column keyed `actions`, pinned at
  the end; at 390 px the menu stays on screen (carried from `venue-operations-screen.test.ts:3397`,
  "the venue tables at phone width", its assertion kept). a11y both themes, with and without
  issues. Run; watch them fail.
- [ ] **Step 2: Implement; Step 3: run;** LOOK in EN and ES, both themes, 1280 and 390.
- [ ] **Step 4: Commit** — `feat(venue-service): the department list with a Setup column (A366)`.

---

### Task A7: The department and zone dialogs

**Files:**
- Create: `packages/venue-service/src/dashboard/department-dialogs.ts`, `.test.ts`,
  `.unsaved.test.ts`, `.a11y.test.ts`
- Modify: `dashboard/strings.ts`

**Behaviour:** decision 15's dialogs, each taking the `VenueServiceApi` and firing `saved` with what
it saved (the new department's or zone's id). Requests: `createDepartment` (name only),
`updateDepartment(id, { name })` (until Task A13a narrows the route, the dialog sends today's full
body with the stored trading name and style, as the tree's inline rename does,
`venue-operations-screen.ts:1162`), `createZone`, `updateZone(id, { name })`, `configureZone(id,
{ departmentId })` for Move and "Add to a department" (until Task A13a, send the zone's stored
`serviceModeOverride` so the route does not clear it, `routes.ts:845-848`), and
`deactivateDepartment` / `deactivateZone` after the removal impact. A331's rule;
`.dismissible=${false}` while busy; the clash "Enable <name>" offer; refusals beside fields and one
bottom message.

**Carried cases** (move each from `venue-operations-screen.test.ts` with its assertions unchanged,
re-pointed at the dialog; delete it from the old file in the same commit): reserved venue names
(`:3546`), incomplete forms (`:2671`), an editor's messages (`:2690`), the keyboard (`:3020`), focus
after an Add dialog closes (`:3145`), the shared field components (`:3243`), the 1280 px field
width (`:2131`, cited at `docs/developers/design-system.md:425`), "refreshing the list fails" (cited at
`docs/developers/conventions-ui.md:276`); and the `.unsaved.test.ts` cases for the old department,
zone and new-zone editors.

- [ ] **Step 1: Failing tests** (Chromium), beside the carried ones: each dialog's Save is quiet and
  disabled until its draft changes; a real Escape pressed during a save leaves the dialog open
  (`userEvent.keyboard("{Escape}")` in Chromium, not a hand-built event); the move dialog lists only
  the other active departments and keeps the zone's override; renaming a disabled department and a
  disabled zone (decision 18: if a route refuses it, hide Rename for the disabled one and say so in
  the commit); the unsaved file's leave question and reconnect case. a11y each dialog, both themes.
  Run; watch the new ones fail.
- [ ] **Step 2: Implement; Step 3: run** the browser files touched (old and new); LOOK in EN and
  ES, both themes, 1280 and 390.
- [ ] **Step 4: Commit** — `feat(venue-service): the department and zone dialogs (A366)`.

---

### Task A8: The department page and its Settings tab

**Files:**
- Create: `packages/venue-service/src/dashboard/department-page.ts`, `department-settings.ts`, and
  `.test.ts`, `.unsaved.test.ts`, `.a11y.test.ts` for each
- Modify: `dashboard/strings.ts`; move `department-transfers.a11y.test.ts`'s cases onto the
  Settings tab (and the transfer cases of `venue-operations-screen.test.ts:3813`, assertions
  unchanged, re-pointed from the modal to the section)

**Behaviour:** `department-page`: decision 13's trail and heading (no trail when decision 8 says
so), the Setup line (decision 7), "(Disabled)" and an Enable button for a disabled department, and
`wt-tabs` Settings / Zones from a `view` property (it fires `view-change`; the shell owns the URL,
Task A10). `department-settings`: decision 10's form, read-only per decision 18 when disabled; one
Save sending `saveDepartmentSettings` (Task A4), transfers included only when shown; A331's rule
over the whole form; a refusal naming a field (`field` on `management.request_invalid`, or the code
for the name and the transfers) beside that field. Transfers load from `loadDepartmentTransfers`
(`client.ts:135`) when shown; a load failure says so in that section only, and the rest of the form
still saves (without `transfers`).

- [ ] **Step 1: Failing tests** (Chromium) — Review focus 1 and 4: the trail's link and the `h1`;
  Save quiet until a change, sends one request with every field; "Zones that differ" names exactly
  the zones whose stored overrides differ, each a link firing the zone; transfers hidden with one
  active department and shown with two; a name clash beside the name with Enable; a transfer
  refusal beside the destinations; a disabled department read-only with Enable; the unsaved file:
  the leave question on a tab switch event and on reconnect. a11y both themes: Settings with and
  without transfers, disabled, a refusal shown. Run; watch them fail.
- [ ] **Step 2: Implement; Step 3: run;** LOOK in EN and ES, both themes, 1280 and 390.
- [ ] **Step 4: Commit** — `feat(venue-service): the department page and its Settings tab (A366)`.

---

### Task A9: The Zones tab

**Files:**
- Create: `packages/venue-service/src/dashboard/department-zones.ts`, `.test.ts`,
  `.unsaved.test.ts`, `.a11y.test.ts`
- Modify: `dashboard/strings.ts`

**Behaviour:** decision 12. The zone buttons and "+ Add zone"; the chosen zone (a `zone` property;
fires `zone-change`); its service settings through Task A5's fields with `follows` set to the
department's values, read-only per decision 18 when the zone is disabled; one Save sending
`saveZoneServiceSettings`; the ⋮ menu firing Rename, Move, Disable, Enable (dialogs from Task A7).
A zone the Settings tab linked to is chosen.

- [ ] **Step 1: Failing tests** (Chromium) — Review focus 1 and 4: buttons in display order with
  `aria-pressed`; a disabled zone muted with "(disabled)" and read-only; the chosen zone's empty
  fields show the department's values; Save quiet until a change, sends four values with `null`
  for "same as the department"; Move offered only with another active department; Enable only when
  the department is active (carried from `venue-operations-screen.test.ts:848`, assertions
  unchanged); switching zone with an unsaved edit fires the leave question;
  reconnect keeps asking; "No zones yet." with the Add button. a11y both themes. Run; watch them
  fail.
- [ ] **Step 2: Implement; Step 3: run;** LOOK in EN and ES, both themes, 1280 and 390.
- [ ] **Step 4: Commit** — `feat(venue-service): the Zones tab (A366)`.

---

### Task A10: The page switches over; the tree and the old tables go

**Files:**
- Modify: `packages/venue-service/src/dashboard/venue-operations-screen.ts` (becomes the shell:
  load, URL, list or department, dialogs; everything from `#policyTree` to `#zones` and the old
  editors goes), `venue-operations-screen.test.ts`, `.unsaved.test.ts`, `.a11y.test.ts` (left with
  the shell's own cases), `venue-navigation.test.ts`, `dashboard/strings.ts` (retire unused keys —
  the strings guard and the Spanish twin tell which), `apps/dashboard/src/navigation.ts` and
  `navigation.test.ts` (decision 14), `apps/dashboard/src/dashboard-app.test.ts` and
  `dashboard-app.venue-settings-unsaved.test.ts` only if they name the removed parts (grep
  `venue-operations`)

**Behaviour:** decisions 8 and 14. The shell reads `department`, `view` and `zone` from the URL,
writes them on the children's events (a push for a department or tab, a replace for a zone), opens
the dialogs on the children's events and, after a dialog saves, follows it (a new department opens
its page; a moved zone leaves the tab and the first remaining zone is chosen). If A429's slice 2
has landed and put "Edit floor plan" on the tree's zone menu, move it to the zone's ⋮ menu here
with its test.

By this task Tasks A6–A9 have moved every case that pins kept behaviour; what is left in the old
files pins removed behaviour (the lists and their column choosers, `:2572`, `:2603`; the tree's
cells; the readiness section) and is deleted under "Changed test checks", each named.

- [ ] **Step 1: Failing tests** (Chromium) — Review focus 5: one department opens straight on its
  page with no trail and an Add button; Add opens the new department; the bare address then shows
  the list; with a disabled second department the list still shows; a department address shows it;
  an unknown id says it no longer exists; old bookmarks land on the bare address; a browser back
  with an unsaved Settings edit asks. Run; watch them fail.
- [ ] **Step 2: Implement; delete; Step 3: run** the venue-service browser project in full
  (headroom first), its node project, the dashboard app's navigation tests; typecheck venue-service
  and dashboard.
- [ ] **Step 4: Commit** — `feat(venue-service): Departments opens a list of departments, each with its own page (A366)`,
  with the `Changed test checks (A366 slice 6):` commit before it.

---

### Task A11: Phone width, both themes and the look pass

**Files:** the Task A5–A10 elements and their tests, as needed.

**Behaviour:** at 390 px: the list's menu column stays on screen; the trail, the `h1` and a long
one-word department name break inside the `h1` (the pattern's rule); the tabs; the zone buttons
wrap; every form field at the body's width; the dialogs. In Spanish, every tab, button and label
shows whole.

- [ ] **Step 1: Failing tests** (Chromium, measured — not screenshots): each point above as a
  bounding-box check, in English and Spanish. Run; watch any that fail fail.
- [ ] **Step 2: Fix; Step 3:** LOOK at the list, a department's Settings and Zones tabs, each
  dialog and a refusal, in EN and ES, light and dark, 1280 and 390; keep the screenshots outside the
  repository (`~/waitron-campaign-<lane>/a366-6-shots/`) and name them in the pull request.
- [ ] **Step 4: Commit** — `fix(venue-service): the department pages at phone width (A366)`.

---

### Task A12a: The server's helpers and the demo say "orderStart"

**Files:** `apps/server/src/testing/service-zone.ts:15`, `testing/zone-offers.ts:38-67`,
`:97-147`, `testing/order-venue.ts:53-54`,
`apps/server/scripts/demo-seed/seed-floor.ts:81-131` (stops writing the raw style except where a
`NOT NULL` insert still needs it until Task A14), `seed.test.ts:414-439`, `:553-558`,
`seed-floor.test.ts:124`.

**Behaviour:** none. Each helper accepts `orderStart` beside its old input (decision 3's mapping:
`table_tab` → `table`; `prepay`, `ticket_then_pay` → `counter`; `null` → nothing); its callers move
in Task A12b, which then removes the old input from the helpers. The demo seed's two pins move from the style columns
to `order_start` (changed test checks: the same departments and zones, the same table/counter
split, read from the new column).

- [ ] **Step 1:** change; run the server package: green with no other `expect` changed.
- [ ] **Step 2: Commit** — `test(server): helpers and the demo say how orders start (A366)`.

---

### Task A12b: The server's tests say "orderStart"

**Files:** every remaining `apps/server` caller of the old inputs —
`grep -rnE "defaultServiceMode|serviceMode: (\"|null)" apps/server --include='*.ts'` (about 35
files at `c3d037a5d`). The grep also matches ANSWERS a test asserts (for example
`till-api.test.ts:1729`, `:1854`, a zone list's `serviceMode`), and the `defaultServiceMode:` keys
of drizzle inserts into `departments`, which the column's `NOT NULL` needs until Task A14; both
stay. When every caller has moved, remove the helpers' old input. If the list is over about 20
files, split it in two commits by file.

- [ ] **Step 1:** change the inputs only; run the server package: green, no `expect` changed.
- [ ] **Step 2: Commit** — `test(server): tests say how orders start (A366)`.

---

### Task A13a: The routes and the dashboard client drop the old words

**Files:** `packages/venue-service/src/routes.ts` (departments POST `:798-814`, PATCH `:697-724`,
zone PUT `:836-853`), `operations.ts` (`updateDepartment :176-189` takes a partial input, as it
calls `.set(input)`; `configureZone :433-469` keeps the zone's override when none is given — today
`input.serviceMode ?? null` clears it, `:459-463`; `listDepartments :58-71` and `listServiceZones
:79-113` drop the old answers), `dashboard/client.ts` (`Department`, `ServiceZone`, `createDepartment`,
`updateDepartment`, `configureZone`), `routes.test.ts`, `dashboard/client.test.ts`, the Task A7
dialogs (drop their transitional bodies).

**Behaviour:** the departments POST takes `{ name, tradingName? }`; the PATCH takes `{ active }` or
any of `{ name, tradingName }` (decision 9; a body naming `defaultServiceMode` is refused 400
`management.request_invalid`, `field: "defaultServiceMode"`); the zone PUT takes `{ departmentId }`
and keeps the zone's settings (it no longer clears an override when the field is missing,
`routes.ts:845-848`); the answers drop `defaultServiceMode` and `serviceModeOverride`.

- [ ] **Step 1: Failing tests:** the refusal (status and code); a PATCH with only `{ tradingName }`
  changes the trading name and nothing else; moving a zone keeps its `order_start` override. Run;
  watch them fail.
- [ ] **Step 2: Implement; move `routes.test.ts`'s inputs** (decision 3's mapping; `expect`s that
  pin the removed inputs and answers are changed test checks, each listed).
- [ ] **Step 3: Run** the venue-service node project, the server package, the venue-service
  browser files that stub the API; typecheck venue-service and dashboard.
- [ ] **Step 4: Commit** — `refactor(venue-service): the department and zone routes speak of how orders start (A366)`.

---

### Task A13b: The writers take "orderStart" only

**Files:** `packages/venue-service/src/operations.ts` (`createDepartment`, `updateDepartment`,
`configureZone`: the old inputs go), `index.ts`, and the
venue-service tests that still pass the old inputs (`operations.test.ts`, `routing-store.test.ts`,
`routing-cells.test.ts`, `menu-timetable.test.ts`, `profile-access.test.ts`,
`menu-timetable-routes.test.ts`, `department-transfers.test.ts`, `routing-store.reach.test.ts`,
`hours-station-model.test.ts` and the rest the grep finds).

**Behaviour:** the writers take `orderStart` only and still write the old style beside it (the
column is `NOT NULL` until Task A14). The greps also match drizzle inserts' `defaultServiceMode:`
keys; those stay until Task A14. If `operations.test.ts`'s inputs alone pass about 60
changes, commit it separately from the other files.

- [ ] **Step 1:** change; run the venue-service node project and the server package: green; any
  `expect` that pinned a removed input or answer is a listed changed check.
- [ ] **Step 2: Commit** — `refactor(venue-service): the configuration writers take how orders start (A366)`.

---

### Task A14: Migration — the service style goes (venue reset)

**Files:**
- `packages/venue-service/src/schema/service.ts` (drop `defaultServiceMode` and its check `:36`,
  `:51-54`; drop `serviceMode` and its check `:65`, `:88-91`; re-home or cut the comment `:32-34`
  and its pointers, Global constraints), `operations.ts` and `provisioning.ts:36-41` (stop writing
  the old columns), `drizzle/` (one generated migration)
- Every insert that still names the old columns, because they are `NOT NULL` with no default until
  now (`schema/service.ts:36`): the drizzle inserts listed in Task A3a, `seed-floor.ts:87`,
  `provisioning.ts:36`, raw SQL `working-order.test.ts:233`, `migrations.test.ts:461`; the raw SQL
  that still sets the old style beside `order_start` (Task A3a's list)
- Assertions on the old columns: `provisioning.test.ts:187-193`, `schema/service.test.ts:41`, `:65`,
  `operations.test.ts:2807-2815` (the old checks' cases become `order_start`'s), `migrations.test.ts`
- `scripts/schema-constraints.test.ts:480`, `:660` (the two dropped checks),
  `scripts/migration-upgrade.test.ts` (`RESETS`), `schema/schema-conformance.test.ts:17`
- `apps/server/src/testing/fixtures/configuration-v1-before-printing-retirement.json` only if
  `configuration-import.test.ts` fails on its `default_service_mode` (read the failure first: an old
  bundle is already refused for its migration version, `apps/server/src/configuration-transfer.ts:573-577`)

- [ ] **Step 1:** list the foreign keys that point at `departments` and `zone_service_policies` and
  their `ON DELETE` (`grep -rn "foreignColumns: \[departments.id\]\|foreignColumns: \[zoneServicePolicies" packages/*/src/schema`);
  write the list into the commit message.
- [ ] **Step 2:** drop the columns in the schema; generate; read the SQL (two rebuilds).
- [ ] **Step 3:** run `pnpm exec vitest run scripts/migration-upgrade.test.ts`: expected to fail at
  this step with a refusal (section "Venue reset"). Add the `RESETS` entry with the words it
  prints, as `0020`'s and `0027`'s are. If it carries the rows instead, add nothing and change
  Part A's first line to "no venue reset needed".
- [ ] **Step 4: Run** the guards of Task A1 step 3, the fiscal pair unedited, both node projects,
  the server's `configuration-import.test.ts` and `configuration-transfer.test.ts`; typecheck.
- [ ] **Step 5: Commit** — `feat(venue-service): the service style is retired (A366) — venue reset needed`.
  If the task passes about 100 calls, commit the insert and assertion moves first (they can be
  written while the column still exists only for inserts that do not need it — otherwise keep one
  commit and hand over).

---

### Task A15: Demo, documentation and backlog

**Files:** `docs/developers/design-system.md` (`:425` and `docs/developers/conventions-ui.md:276`
re-pointed to the moved cases; `:676`'s "policy tree" sentence; `:3227-3228`'s addresses; a short
"Departments" section: the list, the page, the two tabs, the service settings' follow rule and
placeholder wording), `docs/developers/testing-guide.md:1128` (only if the a11y file it names was
renamed or emptied), `docs/developers/conventions-data.md` (where the service settings live; an
order's flow is worked out from How orders start and paid-when), `docs/backlog.md` and
`docs/backlog/service-periods.md` (the A366 entry: slice 6 Part A built, Parts B and C left; delete
the "Disabled note not muted" entry; narrow A331's batch 4b to what venue operations no longer
holds), `docs/backlog/dashboard.md:110-119` (the Departments page's dialogs now ignore a close while
busy — narrow the entry).

- [ ] **Step 1:** LOOK once more at the demo venue (`wa-wt demo <worktree>`): Departments lists
  Restaurant and Deli; the Restaurant's Settings say Table service; its bar zones differ with
  Counter service. Screenshots outside the repository.
- [ ] **Step 2:** the docs; run `pnpm exec vitest run scripts/claude-md-pointers.test.ts` after any
  path a doc names moved.
- [ ] **Step 3: Commit** — `docs: departments and their service settings (A366)`.

---

## Part B — the zone's closed times on the Zones tab (second pull request, after slice 2)

### Task B1: A zone says when it is closed, with a link to Opening hours

**Files:** `packages/venue-service/src/dashboard/department-zones.ts` and its tests,
`dashboard/strings.ts`; reads slice 2's `OpeningHoursApi` model (`zones[].week`, slice 2 Task 8).
Re-read slice 2's landed shape before writing the test.

**Behaviour:** under the chosen zone's name, one line: "Open whenever the department is" when the
zone's normal week has no closed ranges; otherwise the days grouped by identical ranges, at most
two groups ("Closed from 23:30 Monday to Thursday and Sunday; from 01:00 Friday and Saturday", the
spec's example, §6), else "Closed at some times on {n} days"; and the link "Opening hours" to the
zone's normal week (slice 2's `department` and `zone` address). Named days are not summarised (the
line says "normal week" in its link text).

- [ ] Steps: failing tests (the spec's Terrace example; no closed times; three different groups;
  the link's address); watch them fail; implement; the browser files; LOOK in EN and ES, both
  themes, 1280 and 390; commit `feat(venue-service): a zone says when it is closed (A366)`. Docs
  and backlog in the same pull request. First line: "no venue reset needed".

---

## Part C — the floor plan on the Zones tab (third pull request, after A429's slice 2)

### Task C1: "Edit floor plan" and the plan's preview

**Files:** `packages/venue-service/src/dashboard/department-zones.ts` and its tests,
`dashboard/strings.ts`; A429's canvas primitive (`wt-floor-plan-canvas`, A429 Task 2.3) — a
`readonly` property if it has none, with its own test; A429's master-plan read (A429 Task 1.10 /
1.14).

**Behaviour:** §9.1: a zone with tables shows a small read-only preview of its master plan, fitted
to the panel, and "Edit floor plan", which opens A429's editor (`/manage/floor-plan/<zoneId>`); a
zone without tables shows "Add a floor plan". If A429 Task 2.7 put the action in the zone's ⋮ menu
or panel, keep its test and its permission rule (hidden without `venue.configure`, A429 Task 2.7).

- [ ] Steps: failing tests (preview present with tables, absent without; the link; hidden without
  `venue.configure`); watch them fail; implement; the browser files; LOOK in EN and ES, both themes,
  1280 and 390; commit `feat(venue-service): a zone's floor plan on its Zones tab (A366)`. Docs and
  backlog in the same pull request. First line: "no venue reset needed".

---

## After the last task of each part

Run `/finish-branch` with this worktree and this plan. Part A's pull request's first line is the
venue-reset line under "Venue reset"; it lists the changed test checks and the fixtures that
changed how they set the service style. Then update the backlog's A366 entry with what remains.
