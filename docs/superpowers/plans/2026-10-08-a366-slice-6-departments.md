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
> **Green between tasks (owner preference, 2026-10-09).** Run focused behavioural files/cases
> for the changed paths and scoped types before committing. Use
> `pnpm --filter @waitron/venue-service exec vitest run --project node <files>` and
> `pnpm --filter @waitron/server exec vitest run <files>`, plus touched browser files with
> `--project browser`. Check headroom first (`memory_pressure | rg free`); read the `Tests`
> count. Full package suites and coverage belong to current-head CI. Broaden a local run only
> for a justified failure or cross-package concern, naming the reason. Each whole UI task gets
> one full LOOK in EN/ES, light/dark, 1280/390; repeat only after a visual change or failure.
>
> **Audited base, 2026-10-09.** This revision reads the current tree at
> **`87b46b024fcac68a6240949964768b9fbc7d4972`**, landed slice 3A (#1469), after slice 1
> (#1460). Do not rebuild either. The original plan read `c3d037a5d`; numeric citations not
> refreshed below describe that earlier read and must be relocated by identifier before use.
> The dated source inventory below supersedes its independence claims. This is a source audit,
> not runtime verification. Read [slice 1](2026-10-07-a366-slice-1-service-periods.md),
> [slice 2](2026-10-08-a366-slice-2-zone-closed-times-and-named-days.md),
> [slice 3](2026-10-08-a366-slice-3-station-controls.md),
> [slice 4](2026-10-08-a366-slice-4-prep-stations.md),
> [slice 5](2026-10-08-a366-slice-5-monitors.md),
> [slice 7](2026-10-08-a366-slice-7-receipts-per-department.md) and
> [A429](2026-10-08-floor-plan.md) for retained contracts.
>
> **Owner answers are complete.** Lane E `questions.md`, heading `2026-10-09 ~09:40`,
> completed ~10:05, accepts decisions 1–19 with overrides to 4, 8, 12 and 17. The #1462
> Swap answer puts Cancel first, then Save, in every replacement form and dialog.
>
> **Delivery:** Lane E builds Part A, Tasks A1–A15, in one PR now. Parts B and C stay with
> Lane D: B after slice 2; C after Part A and A429's floor-plan editor. Slice 7 is pending
> in Lane E after 6A, with no current slice 7 branch. Do not edit another lane's checkout.

**Goal:** the Departments page becomes a list of departments, each opening its own page with a
Settings tab and a Zones tab, as the approved mock-ups (screens 2 and 3 of `all-screens-v3.html`,
kept outside the tree) describe. The bare address always opens the list, even with one department; every department page has a Departments parent link.
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
order opens, `recordOrderServiceContext`, `:957-975`) is worked out from it: `table_tab` when the
zone starts orders at a table, otherwise the zone's paid-when. The order snapshot
(`order_service_contexts.service_mode`) and the module contract's `ServiceMode` keep their three
values, so order-flow readers retain their behaviour. Receipt-mode types and fixtures on the till do change (decision 17); money, VAT, fiscal hashes, drawer rules and login stay untouched. The old columns
are written beside the new one while the readers and the fixtures move (expand, then contract), and
dropped in the last migration. Receipt modes finish as `auto | on_request` (Always / On request); obsolete `never` retires through Task A2 without converting venue data. The dashboard page is split out of
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
columns, rebuilds the two sale-policy tables for order-start and receipt-mode checks (Tasks A1/A2),
then rebuilds `departments` and `zone_service_policies` to drop two), a changed cross-package contract
(`EffectiveSalePolicy`, `packages/module/src/module.ts:79-88`, and the venue-service routes' bodies
and answers), and what an order's recorded flow is worked out from (decision 3: no order's flow is expected to
change, which Task A3b's tests hold; the zone answers that echoed the stored style do change).

**Venue reset: required for Part A under the owner's pre-live retirement decision.** The last migration drops
`departments.default_service_mode` and `zone_service_policies.service_mode`; both carry a CHECK, so
drizzle-kit rebuilds both tables, and a rebuild of `departments` was refused on a venue holding rows
the last time it shipped: the upgrade walk lists `venue-service/0020_retire_invoice_first` in its
`RESETS` as refused with "DROP TABLE `departments`" and "FOREIGN KEY constraint failed"
(`scripts/migration-upgrade.test.ts:251-253`), and `0027_retire_zone_menus` the same for
`zone_service_policies` (`:254-257`). Expected, not measured for this migration: the same refusal.
Task A2 contracts receipt-mode checks to `auto/on_request`; old `never` rows
require a reset, not conversion SQL. Task A14 runs the walk. Under the pre-live reset authorization,
record only a measured retirement refusal in RESETS; do not change guard instructions or logic
to excuse failure. Part A's first line:
**"venue reset needed — required: service-style columns and obsolete receipt modes are retired"**.
Describe any rebuild refusal as expected until measured, then add the walk's actual words in the PR. Parts B and C add no
migration: "no venue reset needed".

---

## What this slice needs from slices 2 to 5

### 1. Every file this slice changes

**Part A (Tasks A1–A15).**

- `packages/venue-service/src/`: `schema/service.ts`, `operations.ts`, `routes.ts`, `errors.ts`
  (only if a new code is needed — decision 9 says none is), `provisioning.ts`,
  `configuration-transfer.ts` (sale-policy enum validation and round-trip tests; whole-row transfer is tested, not assumed), `index.ts`, `migrations.test.ts`, `operations.test.ts`, `routes.test.ts`,
  `provisioning.test.ts`, `schema/service.test.ts`, `schema/schema-conformance.test.ts:17` (a
  comment naming `default_service_mode`), and the venue-service tests that set the old columns
  (Task A13b's list); `drizzle/` (A1 add-only/checked generations, A2 receipt-mode contraction, A14 style retirement; inspect actual generated steps)
- `packages/venue-service/src/dashboard/`: `client.ts`, `live-queries.ts` (the `operations` list
  gains `department_sale_policies` and `zone_sale_policies`, decision 19) and its test, `strings.ts`, `venue-operations-screen.ts` (becomes the shell), new
  `service-settings-fields.ts`, `departments-list.ts`, `department-page.ts`,
  `department-settings.ts`, `department-zones.ts`, `department-dialogs.ts`, and their `*.test.ts`,
  `*.unsaved.test.ts`, `*.a11y.test.ts`; `venue-operations-screen.test.ts`,
  `.unsaved.test.ts`, `.a11y.test.ts` (pruned to the shell's cases), `venue-navigation.test.ts`,
  `department-transfers.a11y.test.ts` (moved onto the Settings tab), `client.test.ts`,
  `index.test.ts`
- `packages/module/src/module.ts` (`EffectiveSalePolicy`, `:79-88`, gains `orderStart` and narrows receipt mode to `auto | on_request`;
  `ServiceZoneSummary.serviceMode` and `ServiceMode` stay — decision 4; the configuration writers'
  inputs are venue-service's own, not the module contract's)
- `apps/dashboard/src/navigation.ts` (the `venue-operations` children) and `navigation.test.ts`;
  `i18n/domain.ts` and `domain.test.ts` (receipt-mode labels and obsolete-token checks)
- `apps/server/src/`: `till-api.ts` (the offers answers' hand mapping, `:1330-1331`,
  `:1358-1359`, decision 3); `testing/service-zone.ts`, `testing/zone-offers.ts`,
  `testing/order-venue.ts`, `testing/venue-fixtures.ts`; the server tests that set the old columns
  (Task A3a, A12a and A12b lists); `testing/fixtures/configuration-v1-before-printing-retirement.json` (only if the import
  test reads its `default_service_mode`; Task A14 checks)
- All receipt consumer paths/focused checks in the dated inventory below belong to this path set.
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
| The list, the department page, the Settings tab, "How orders start", the service settings in the same words, the tree and old tabs removed (§6, §9.1, §12) | **Slices 1 and 3A already landed; no pending slice 2/4/5 dependency.** | The Setup column's "has no opening periods" reads slice 1's periods through the readiness reader (`listVenueReadiness`, `operations.ts:340-431`, `department.no_periods` at `:377-384`), already on `main`. The actual slice 2/5 diff read on 2026-10-09 found no sale-policy-table change, but shared contracts, configuration transfer, fixtures and journals overlap. See the dated inventory below. |
| Tab transfers on the Settings tab (§9.1) | **Neither slice 5 nor any other.** | The transfer settings and their rules exist today (`routes.ts:893-936`; `department-transfers.ts:76-92`, `:117-162`, which refuse a kitchen-display profile and a profile not scoped to the department). Slice 5 changes which screens a profile's devices may run (the owner's answers of 2026-10-08 ~22:05, `~/waitron-campaign/questions.md`, override its plan: any device may run a kitchen-display working screen or a view-only monitor), not who may receive a transfer. This slice reads the receiving-profile choices from today's route (`GET .../transfers/profiles`, `routes.ts:904-911`) and so shows whatever slice 5 leaves that route answering. |
| The zone's one-line summary of its closed times, linking to Opening hours (§9.1) | **Slice 2 → Part B.** | Closed times do not exist until slice 2 (its Tasks 2, 8: `zone_closed_times`, `replaceZoneClosedWeek`, the `zones` array in `OpeningHoursModel`); slice 2 leaves "the Departments page's Zones tab and its closed-times summary" to this slice (`2026-10-08-a366-slice-2-zone-closed-times-and-named-days.md:70-71`). The link targets slice 2's zone view (its Task 16, `zone` in the Opening hours URL). |
| "Edit floor plan" / "Add a floor plan" and the small plan preview (§9.1) | **A429 slice 2 → Part C.** | A429 decision 12 (`2026-10-08-floor-plan.md:123-127`) puts the action on today's zone row menu and leaves "the plan's preview on the zone page" to this slice; the editor's URL and the canvas primitive arrive in A429 Tasks 2.3–2.4 (`:1113-1132`) and the entry point in Task 2.7 (`:1138-1140`). |
| Manager extensions; station controls (slice 3) | **Neither.** | §10 puts them on the till and the kitchen display only; nothing in §9.1 shows live state. |
| Prep stations (slice 4) | **Neither.** | Slice 4 changes `configureZone` (`operations.ts:433-469`; its Task A5 and decision 10: a zone moved to another department loses its cells' period choices for the old department, `2026-10-08-a366-slice-4-prep-stations.md:767-768`). This slice's "Move to another department" calls the same route and inherits whatever slice 4 decides; its own change to `configureZone` is the input (decision 2), in a different part of the function. |
| Kitchen-display screens and monitors (slice 5) | **Neither.** | As above for transfers; slice 5 touches device profiles' screens and the devices that run them, not departments or zones. |

**Part A** (Tasks A1–A15) starts from landed slices 1 and 3A and may build beside pending
slices 2, 4 and 5 under the explicit overlap waiver (decision 1).
**Part B** (Task B1, the closed-times summary) needs slice 2. **Part C** (Task C1, the floor plan
action and preview) needs A429's slice 2. Slice 7's Part B needs Part A of this slice (its Receipt
tab goes on this slice's department page).

### 3. Files shared with other slices (same files, different areas)

- **Slice 2** (active Lane D branch, pending): `packages/venue-service/src/operations.ts` (`listZoneOffers`, slice 2
  Task 10; this slice changes `resolveZoneContext`, `listServiceZones`, `resolveSalePolicy` and
  the configuration writers), `routes.ts`, `errors.ts`, `index.ts`, `migrations.test.ts`,
  `dashboard/strings.ts`, `apps/dashboard/src/navigation.ts` (slice 2 Task 16 adds `zone` to the
  `opening-hours` children; this slice adds a `venue-operations` entry), `apps/server/src/till-api.ts`
  (slice 2's closed-zone refusals; this slice's one line in the dead-ends route), the venue-service
  journal.
- **Slice 3A** (landed #1469, base above): preserve `keepOpen`, menu `orderable`/`sendable`,
  `ZoneOffers.service: ZoneMenuState["service"]`, station state fields and mounted live APIs.
  Only slice 3 Part B remains pending after slice 2. Do not repeat its build or replace its tests.
- **Slice 4** (unbuilt): `operations.ts` (`configureZone`), `packages/ui/src/components/wt-tabs.ts`
  (its Task A12 adds an overflow mark; this slice's department page uses `wt-tabs` as it is),
  `routes.ts`, the journal.
- **Slice 5** (Part A may land first): `module.ts`, `routes.ts`, the journal,
  `apps/server/src/testing/*` fixtures.
- **Slice 7** (Lane E, pending after 6A; no current branch): `routes.ts` (`departments-and-zones` gains `isDefault`,
  slice 7 decision 14), `dashboard/strings.ts`; slice 7 Part A's Receipts page is where this slice's
  Settings tab links "Edit the receipt" (decision 11), and slice 7 Part B adds the Receipt tab to
  this slice's department page and moves the trading name and its switch onto it.
- **A429** (lane E): its Task 2.7 adds "Edit floor plan" to today's zone row menu
  (`venue-operations-screen.ts:1554-1596`, at `c3d037a5d`; A429 cites the older `:1536-1574`).
  Whichever lands second carries it: if A429's slice 2 lands before Task A10, Task A10 moves the
  action onto the zone panel; if after, A429 Task 2.7 adds it to the zone panel instead (Part C
  then adds only the preview).

**Explicit overlap waiver for 6A.** Slice 2 (Lane D), slice 5 (Lane A) and this branch may
progress in their own checkouts. Whoever lands second rebases and regenerates clashing migrations
from main's journal, never by hand. Run the normal migration guards and focused affected checks
after reconciliation. Do not alter guard instructions, thresholds or exclusions to excuse failures.
Slice 7 later reconciles this same path set; no other-lane edits are authorized.

### 4. Audited source inventory (2026-10-09)

`git rev-parse HEAD` returned the full base above. Read-only `git diff main...HEAD` in active
checkouts and clean `git status --short` returned slice 2 head
`eb8258a220c91fd1fa8d185dd15be42e525e947a` and slice 5 head
`0d3b07d919dbe6e4b8b3e6a07793bd69de219c90`. Lane E's `receipts/a366-6a/*orientation.txt`
locates those branches; actual diffs, not orientation lists alone, inform this audit.

- Slice 2 changes offer/state answers with `zoneOpen`, transfer acceptance, routes, configuration
  validators, live-query dependencies, module contracts, till/server fixtures and dashboard
  navigation (`zone`, `month`). Its compared module/operations shapes lack base slice 3A's
  `keepOpen` and `sendable`; reconcile by retaining both branches' fields and response assertions.
  Its venue-service 0035/0036 journal entries overlap the base's landed station/extension migrations.
  Part B must re-read its eventually landed model.
- Slice 5 removes profile station/watcher tables from `schema/service.ts`, changes configuration
  transfer's profile table list and module kitchen-screen contracts, server/till fixtures/tests,
  and core/venue-service journals. Its venue-service 0034/0035 clash with this base. Its compared
  sale-policy enum still has the old receipt values. Preserve its kitchen-screen changes and
  re-read actual landed transfer-profile eligibility; a plan search does not establish it.
- Current `module.ts:270-289` and `operations.ts:865-910` carry `keepOpen` and menu
  `orderable`/`sendable`; `till-api.ts:1065-1066` mounts live-control APIs. A3b's mapping sites are
  now `till-api.ts:1340-1342`, `:1368-1370`, and context writers `operations.ts:957-1007`.
  Keep all slice 3A fields in combined results and full-response pins.

**Receipt mode path set, Task A2.** Re-run
`rg -n 'receiptPrintMode|receipt_print_mode|ReceiptPrintMode|RECEIPT_PRINT_MODE|receiptMode|on_request' apps packages scripts docs`
before receipt-mode contraction and after rebases. Read each hit by concept; this inventory records source
reads, not runtime proof. Exact test line numbers are refreshed in the Changed test checks commit.

| Consumer / current receipt | Planned change and focused checks |
| --- | --- |
| `packages/venue-service/src/schema/service.ts:97-136` | Remove `never` from the enum and both CHECKs in A2 after its consumers and fixtures move. Keep `on_request`. Keep department default auto and zone default null. `schema/service.test.ts`, `migrations.test.ts`, schema-conformance and migration guards. |
| `packages/venue-service/src/operations.ts:560-719` | Effective/list policy types and writes, explicit defaults and null inheritance. `operations.test.ts`; no stored-row conversion. |
| `packages/venue-service/src/routes.ts:139-153`, `:735-741`, `:864-870` | Enum set and casts, per-field and combined writes accept auto/on_request; obsolete modes and department null refuse with field/code, zone null inherits. `routes.test.ts`. |
| `packages/module/src/module.ts:86` | Narrow `EffectiveSalePolicy.receiptPrintMode`, preserve `ServiceMode` and slice 3A fields. Scoped module/server/till/dashboard/venue-service types. |
| `packages/venue-service/src/dashboard/client.ts:25-37`, `venue-operations-screen.ts:1430-1506`, `strings.ts:314-315`, `:996-997` | Drop Never from the client and old tree before receipt-mode contraction, although A10 later removes tree. Retire receipt-only Never labels; preserve On request text. Client/screen tests, then A5/A8/A9. |
| `apps/dashboard/src/i18n/domain.ts:125-129`, `domain.test.ts:168-173` | `printModeName` maps auto/on_request to Always/On request. Retired never follows the existing unknown-token fallback; on_request keeps its current label. `rg printModeName apps packages` found only definition/tests at this base. |
| `apps/till/src/api/client.ts:381`, `till-app.ts:1936`, `:2437`, `:2826`, `:8336` | Change wire/state types to auto/on_request, retain auto defaults and original-receipt availability. Focused `api/client.test.ts`, `till-app.test.ts` receipt cases, `till-app-boot-and-counter.test.ts`, `till-app-parties.test.ts`. Keep order-flow/login behaviour. |
| `apps/server/src/till-api.ts:1342`, `:1370`, `till-api.test.ts:1811-1839` | Pass-through auto/on_request; preserve response/live fields. Opposing override values, null clear and inherited readback. |
| `apps/server/src/receipt-print.ts:202-225`, `:251` onward | Automatic F2 still gates on auto, no-context default auto; F1 delivery and ungated reprint stay. Helper unions and fixtures in `receipt-print.test.ts`, `till-api.receipt.test.ts`; no drawer/fiscal implementation changes. |
| `apps/server/src/bill-payments.test.ts:1121-1127`, `bill-payments-api.test.ts:1482`, `till-api.fiscal-sale-paths.test.ts:2680` | Never fixtures become on_request; retain F1/F2 document counts and payment/refund/fiscal assertions. No golden/inmutabilidad edits. |
| `packages/venue-service/src/provisioning.ts:44-48`, `apps/server/scripts/demo-seed/seed-floor.ts:97` | Explicit department auto, zone null; `provisioning.test.ts`, demo `seed.test.ts`/`seed-floor.test.ts`. Setup/applyVenue callers reach this module contribution; identifier search found no independent receipt option. |
| `packages/venue-service/src/configuration-transfer.ts`, `apps/server/src/configuration-transfer.ts:558-594`, `:599` onward | Export whole rows; import validates contributions then inserts against schema checks. Add receipt-mode validation in the module with precise `setup.request_invalid` field before writes. Round-trip auto/on_request/null under new ids in server `configuration-transfer.test.ts`; obsolete bundle rejections in module `configuration-transfer.test.ts` and server `configuration-import.test.ts`. |
| Retired-field/route controls: server `configuration-transfer.ts:464`, `configuration-import.test.ts:126-140`, `print-api.printer-wiring.test.ts:619-632`, `venue-details.test.ts:1240` | Keep all retired-location receipt-field inputs refused, including on_request and never; do not weaken their assertions. Historical v1 JSON stays old/refused unless A14's actual failure requires a documented fixture change. |

Other valid auto fixtures in till native-reload/suite fixtures, server device-equipment,
printing-retirement-upgrade and db drawer-opens tests need no semantic change. Keep assertions.
Preserve unrelated `never` prose/types and reprint behaviour. Shipped migrations/snapshots keep
historical values/hashes. A final negative search targets live receipt acceptance/declarations,
not every `never` in the repository.

**Changed receipt checks, decision 17.** Known base sites: venue-service
`operations.test.ts:1077-1147`, `routes.test.ts:776-790`, dashboard
`venue-operations-screen.test.ts:1281-1285`, `:1703-1778`, `:1800`, server
`till-api.test.ts:1814-1833`, `configuration-transfer.test.ts:3417-3473`, and dashboard
`domain.test.ts:169-172`. Replace successful never checks with On request checks,
and add separate never-rejection cases. Keep existing on_request assertions. Use opposing
auto/on_request department and zone values in inheritance and transfer tests: changing a never
zone fixture to on_request while its department is also on_request would hide an override defect.
Receipt/bill/till matrices keep both supported modes and every distinct F1/F2, replay,
original/reprint, missing-printer and drawer assertion.
Record each changed assertion's exact before/after in the dedicated Changed test checks commit
and PR. List fixture-only changes separately, including fiscal-sale-paths, with no changed expect.


---

## Decisions this plan makes that the spec does not

The owner accepted these on 2026-10-09 with the stated overrides. They govern the build; obsolete defaults are retired here.

1. **Three pull requests, Part A now in Lane E, Parts B/C in Lane D.** Part A (everything but the closed-times summary and
   the floor plan) after slice 1, which has landed; Part B after slice 2; Part C after A429's
   slice 2. The owner accepted this departure from the original serial §13 order. Part A uses
   landed slices 1/3A and needs no pending slice 2/4/5 feature; Lane E's slice 7 follows it.
   Parts B/C remain with Lane D.
2. **"How orders start" is stored with the other service settings.** Approved: a column
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
   (`recordOrderServiceContext`, `operations.ts:964-967`; `retargetOrderServiceContext`,
   `:988-991`; offers answers, `apps/server/src/till-api.ts:1340-1342`, `:1368-1370`), so the
   style's `prepay` / `ticket_then_pay` difference never reaches an order. The other readers of
   the zone's style on an order's path compare it with `table_tab` only (`move-bill.ts:244`,
   `:428`; `working-order.ts:1242`; the till's counter zone list, `till-api.ts:1334-1336`). The
   dead-ends route reads the raw zone mode (`till-api.ts:1457-1461`) and computes payment/placing
   dispatch at `:1464-1474`. The earlier plan reviewer evaluated its prior expression for a new
   order and reported equal counter answers; that read is not runtime proof. A3b runs the
   real-route controls against the audited current tree before claiming equivalence. The raw value also
   reaches the old page's Service style column and the zones the routes answer (`routes.ts:592`,
   `:603`; `venue-operations-screen.ts:1719`). Approved: `resolveZoneContext` and
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
4. **The order's own record keeps its three values in slice 6; split it later.** `order_service_contexts.service_mode`
   (`schema/service.ts:263-295`) and the module contract's `ServiceMode`
   (`packages/module/src/module.ts:71`) stay `table_tab | prepay | ticket_then_pay`: they record how
   one order runs (table service, counter paid before preparation, counter paid at collection — the
   spec's three replacements, §6), not a setting. The till (`apps/till/src/api/client.ts:374-396`,
   `till-app.ts:2406-2407`) and every server reader of an order's flow (`move-bill.ts`,
   `working-order.ts:5562-5584`, `:5876-5892`, `till-sale.ts:1547-1559`, `receipt-print.ts:216`) are
   unchanged for order-flow behaviour. Decision 17 separately changes receipt-mode types/fixtures.
   A15 adds the owner-requested future split: served-at (`table/counter`) and payment-due
   (`before-kitchen/collection/end-tab`). Cited readers are `till-sale.ts:1548`,
   `receipt-print.ts:216`, `working-order.ts:3111-3128` (`serviceModesMatch`) and `move-bill.ts:245`.
   No implementation of that split or change to recorded orders belongs to slice 6.
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
   sentences.** Approved: `department.no_periods` for the department (with today's "Set up Opening
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
8. **Always show the department list (owner override).** `/manage/venue-operations` shows
   the list with zero, one or several departments, active or disabled. Every department address
   opens its page with the Departments parent link above its name. Add department is on the
   list; after adding, open its page. A254's single-department bypass is superseded here;
   do not rewrite that historical spec.
9. **One Save per tab, one request per Save.** Approved: two new routes, each one transaction
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
    and the switch "Print a numbered collection ticket"), Print a receipt (Always / On request); a line "Zones that differ: Terrace (Counter service), Bar (Receipt on request)", each
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
    Approved: the trading name and "Print the trading name above the legal name" are in the
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
    with only the localized inherited value as its placeholder (for example "Table service");
    one Save (`PUT .../zones/:zoneId/service-settings`); and a ⋮ menu with **Rename**, Move to
    another department (only when another active department exists), and Disable, or Enable when
    disabled and the department is active (today's rule, `:1582-1595`). **Rename is in the menu
    rather than an editable name field** because a zone's name is a core table renamed through
    `PATCH /management-api/zones/:id` under `venue.configure` with its own clash rules
    (`apps/server/src/management-api.ts:1674-1709`, `tables.ts:293-354`), so one Save could not
    cover both in one transaction (decision 9). Not selected: a name field in the zone's form, saved by
    a second request before the settings. A department with no zones shows "No zones yet." and the
    Add button. **On a zone, "Print a numbered collection ticket" offers Print / Don't print**
    with a clearable empty state. Empty stores null and its placeholder is only the inherited
    Print or Don't print value. The department retains a switch. No inheritance prefix, follow
    option label or explanatory sentence is added to an empty zone field (owner override).
13. **The "Departments ›" line follows the sub-page pattern by hand, as a plain link.** The
    A335/A398 pattern (`docs/developers/design-system.md:3072-3090`) is drawn by the menu and
    canvas editors. The department page draws it the same way: a `nav` named "Departments" holding `<a href="/manage/venue-operations">` and the
    `›`, then the department's name as the one `h1`, then "(Disabled)" in brackets after it when it
    is. The link needs no click handler of its own: the dashboard app catches a click on a
    `/manage/…` anchor in the capture phase (unless the anchor opts out with `data-own-click`, is a
    download, a `#` link, another target or `aria-disabled`), leaves a modifier-click to the browser
    and navigates through the leave guard (`#onAppLink`, `apps/dashboard/src/dashboard-app.ts:862`, `:1545-1574`). The
    pattern names no shared component, so none is added. Not selected: a `wt-*` heading primitive (with
    its token and a11y tests, CLAUDE.md §3) that both pages use.
14. **Addresses.** `/manage/venue-operations` (always the list);
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
    Cancel first, then Save, including all replacement inline forms (the #1462 Swap override),
    and today's refusal mapping: a name clash with a disabled department or zone offers "Enable
    <name>" (`venue-operations-screen.ts:715-726`).
16. **The page stays manager-only, with no read-only view.** `requiresPermission:
    "venue_service.manage"` and no `readPermission` (`packages/venue-service/src/dashboard/index.ts:16-22`),
    as today. Zone rename, disable and enable keep calling the core zone routes under
    `venue.configure`, as today.
17. **Receipt mode is only `auto | on_request` (owner override).** Always is auto; On request
    is on_request. Retire obsolete never from every live receipt enum, CHECK,
    accepted write, reader type, import validator, export fixture and UI choice. The audited path
    list above belongs to Task A2. Preserve automatic F2 gating, F1 delivery, manual originals/
    reprints, drawer, money/VAT/hash and login behaviour. Old venue rows reset before use; no
    conversion SQL or compatibility reader. Move never consumers/fixtures while the storage still accepts never, then narrow
    enum/checks and reject never (Task A2).
18. **A disabled department's page and a disabled zone are read-only.** Approved: the Settings tab
    and a disabled zone's settings show their values with every field disabled, a line "Enable this
    department to change its settings" (or "… this zone …") and the Enable action; no Save. Why: the
    writers refuse an inactive department or zone (decision 9), and enabling first is today's order
    of things. Rename stays offered for both only if its route accepts a disabled one — Task A7
    tests that before relying on it, and hides Rename if not.
19. **The page follows a change made elsewhere.** The page's live query
    (`QUERY_DEPENDENCIES.operations`, `packages/venue-service/src/dashboard/live-queries.ts:68-87`)
    names `departments` and `zone_service_policies` but neither sale-policy table, so today a
    paid-when change made in another tab reaches it only at the 60-second refresh
    (`venue-operations-screen.ts:443`). Approved: add `department_sale_policies` and
    `zone_sale_policies`; `scripts/live-subscriptions.test.ts` says whether the server's change
    feed knows them (CLAUDE.md §3: an unknown name closes the tab's whole stream).

## Current source and the revised spec

- Three service settings already share department/zone sale-policy storage at the audited base;
  order-start still lives in the old service-style columns (decision 2).
- Trading name and its switch stay temporarily in Settings until slice 7 Part B adds the Receipt
  tab. A Rename zone action is in the zone menu because core zone naming has its own route.
- Revised §6 retains the current zone rule. `working-order.ts:1251-1258` refuses seating in a
  counter zone, and `till-api.ts:1344-1345` excludes table zones from the counter picker.
  Per-order choice remains A254's open question, not a slice 6 implementation.
- Revised §12 removes the Ready for service section and the old department/zone table tabs,
  matching `venue-operations-screen.ts`'s current structure.
- Receipt modes in this base still use auto/on_request/never; §6 and decision 17 are the target
  auto/on_request contract. The inventory and ordered A1/A2 checkpoints cover that transition.

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
  de recogida numerado; Print a receipt / Imprimir el recibo; Zones that differ / Zonas con otros ajustes; Edit the receipt /
  Editar el recibo; Departments / Departamentos (the trail's link). Reuse `venue.always`,
  `venue.on_request` as wording for on_request; retire receipt-only `venue.never`. Empty zone
  placeholders contain only the localized inherited value. Every footer has Cancel before Save.
- Coverage stays at 98/98/98/95 in every package touched.
- Comments only for an invariant or a non-obvious why; no history. When the schema's comment "Not
  the enumText/enumCheck pair … here or in the four other checked value-set columns"
  (`schema/service.ts:32-34`, and its pointers at `:64`, `:270`, `:315-317` and
  `schema/schema-conformance.test.ts:17`) loses `default_service_mode`, re-home it on a column that
  keeps it (`order_service_contexts.service_mode`) or cut it — never leave a pointer to a dropped
  column.

## Behaviour this slice removes

Tests pinning these may change, under the commit rule above:

- Single-department list bypass/omitted parent link; receipt-policy never value,
  label and acceptance (On request remains on_request); inheritance-prefix wording and labeled follow
  option. Keep negative obsolete-input controls and unrelated never values.
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
   the Terrace's empty receipt field's placeholder reads "On request" only
   (Tasks A2, A8, A9).
2. **Table or counter decides the till.** A table-service department with a counter-service zone:
   seating a party in that zone is refused (`service_zone.mode_incompatible`,
   `apps/server/src/working-order.ts:1241-1250`); a counter sale there follows the zone's
   paid-when, and `POST /api/dead-ends/sale` agrees with `POST /api/working-orders` about whether
   paying sends the dishes (Task A3b).
3. **The two settings that used to be one.** A department set to counter service and paid at
   collection: a new order's snapshot is `ticket_then_pay`, the collection ticket prints at placing
   when "Print a numbered collection ticket" is on (`working-order.ts`, collection-ticket placing path), and not when it
   is off (Task A3b).
4. **Unsaved edits across addresses.** Edit the Restaurant's receipt setting, then click the Zones
   tab, the Departments parent link then another department, or the browser's back button: the leave question asks;
   Keep stays with the edit; Discard goes. The same on a zone, switching zone. Reconnecting the page
   keeps asking. Escape during a dialog's save does not close it (Tasks A7, A8, A9, A10).
5. **Zero, one, then two departments.** Bare address always shows the list; Open/Add go to
   a department page with its parent link. Disabled departments do not bypass the list. Ordinary
   parent/back navigation guards drafts; modified links retain browser handling (A335/A398, A10).
6. **Retirement on a populated venue.** Read actual upgrade output for both sale-policy
   check rebuilds and style-column retirement; record only a measured authorized refusal,
   preserve guard logic. A fresh reset venue sells at both counter and table (Tasks A1/A2/A14).
7. **Export/import and receipt defaults.** Round-trip order_start, opposing auto/on_request
   department/zone modes and null under remapped ids. Current-version never refuses
   with `setup.request_invalid` and precise table/column field before any write. New/provisioned/
   demo department mode is auto, zone is null; no-order-context printing defaults auto. F2 auto
   queues one original, on_request none; F1 delivery and manual original/reprint stay (Task A2).
8. **Hints and footer order.** Clear every zone field; only its inherited localized value is
   the rendered placeholder. Collection ticket offers Print / Don't print with clear-to-null.
   Cancel precedes Save on all forms/dialogs; save-handler early returns and reconnect preserve
   drafts. Null department receipt mode and obsolete tokens refuse (Tasks A4/A5/A7/A8/A9).

---

## Part A — the department list and page, and "How orders start" (first pull request)

### Task A1: Migration — "How orders start" on the service settings (add only)

**Files:** `packages/venue-service/src/schema/service.ts`, `drizzle/`, `schema/service.test.ts`,
`migrations.test.ts`; server `configuration-transfer.test.ts`. Receipt enums and consumers stay
unchanged in this task. Run schema/migration guards without changing their rules.

**Interfaces:**

```ts
const orderStart = enumType(["table", "counter"]);
// departmentSalePolicies
orderStart: orderStart("order_start").notNull().default("counter"),
check("department_sale_policies_order_start_ck", enumCheck(t.orderStart)),
// zoneSalePolicies: null inherits
orderStart: orderStart("order_start"),
check("zone_sale_policies_order_start_ck", enumCheck(t.orderStart)),
```

- [ ] **Step 1: RED.** Department missing order_start reads counter; zone missing it reads null;
  explicit table/counter values persist; a table department/counter zone bundle remaps both ids.
  Run focused schema/migration and server transfer cases and watch missing-column failures.
- [ ] **Step 2: Add-only generation.** Add order_start columns without checks; leave receipt
  enum/checks unchanged and generate. Do not combine added columns with a table rebuild.
  Read SQL; rerun focused default/transfer cases to green.
- [ ] **Step 3: CHECK RED/GREEN.** Add cases rejecting tab on both policy tables, and department
  null, with valid table/counter and zone null controls. Observe the missing-check failures.
  List incoming foreign keys and trigger-body references to both policy tables, including their
  ON DELETE rules. Add only the order-start checks and generate a second migration. Read the
  SQL and run focused schema/migration/transfer cases and scoped types.
- [ ] **Step 4: Migration verification.** Run
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts`.
  Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad src/write-path.e2e.test.ts`
  with both suites unedited. Read generated SQL and upgrade results; expected row preservation is
  not a receipt. Investigate any refusal rather than hiding it through a guard edit.
- [ ] **Step 5: Commit** signed off: `feat(venue-service): a department and a zone say how orders start (A366)`.

---

### Task A2: Retire Never, contract receipt modes, and carry "How orders start"

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

**Receipt files:** every path in the dated receipt inventory, including schema/drizzle, module,
server/till/dashboard clients and fixtures, provision/demo, and module/server transfer validation.
The existing order-start writer changes below remain in this task after the receipt checkpoints.
Use passing signed-off subcommits for the receipt checkpoints if task size requires it; all remain
inside A2 and the single Part A PR. Keep on_request throughout; no enum expansion or wire rename is needed.

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

- [x] **Receipt checkpoint 1: refuse Never at the boundaries, then move its fixtures.**
  Add RED cases rejecting never through the department/zone per-field routes and current-version
  configuration import, with status/code/field and unchanged rows. Keep auto/on_request/null
  readback and round-trip controls. Remove never from route validators, old tree choices and
  receipt-only labels; add module import validation before writes. Keep the schema temporarily
  unchanged while successful never fixtures move to on_request, preserving opposing department
  and zone values. Keep existing on_request assertions and list changed never checks separately.
  Run focused affected files and scoped types. Preserve fiscal, payment, drawer and login checks.
- [x] **Receipt checkpoint 2: storage refuses Never.** Re-scan every consumer. Add RED raw never
  insert/update refusal tests for both sale-policy CHECKs, then narrow receiptMode and public,
  dashboard and till types to auto/on_request. Department null still refuses; zone null and both
  supported explicit values remain accepted. List incoming foreign keys/triggers, generate the
  receipt-check contraction separately from column additions, read SQL and run A1 migration
  guards. No conversion UPDATE or compatibility reader: reset obsolete pre-live venue data.
- [x] **Receipt checkpoint 3: HTTP/import/printing regressions.** Per-field routes reject never
  with 400 management.request_invalid and field receiptPrintMode; A4 adds the same combined PUT
  regression when those endpoints exist. Arrays/numbers/unknown strings and department null
  refuse; zone null reads the department value. Current-version import rejects never with
  setup.request_invalid and field department_sale_policies.receipt_print_mode or
  zone_sale_policies.receipt_print_mode, leaving the target unchanged. Missing department mode
  defaults to auto, absent/null zone follows, explicit department null refuses. Round-trip opposing
  auto/on_request policies and inherited null under new ids. Keep F2 auto one original /
  on_request none, F1 selected delivery, no-context auto, till on-request original availability,
  ungated originals/reprints, collection-ticket and drawer assertions. Run focused consumer
  cases and scoped types; package suites/coverage remain CI's job.

- [x] **Step 1: Failing tests:** `resolveSalePolicy` answers `orderStart` (department `table`, zone
  override `counter` → `counter`; zone `null` → the department's); the department route writes it,
  and `"tab"` is refused 400 `management.request_invalid` with `field: "orderStart"` (the route
  names the field, `routes.ts:152`, as `routes.test.ts` pins for `paidWhen`); each mirroring rule
  above, both directions, read back from both columns; `createDepartment({ name, orderStart:
  "table" })` stores `table_tab` beside it; the live query lists the two sale-policy tables. Run;
  watch them fail.
- [x] **Step 2: Implement.** One private helper per direction, used by every writer; retain slice 3A
  keepOpen/orderable/sendable fields in all response shapes and existing whole-shape pins.
- [x] **Step 3: Run** focused affected venue-service/server node files, `pnpm exec vitest run
  scripts/live-subscriptions.test.ts`; typecheck venue-service, module, server, dashboard and till.
- [x] **Step 4: Commit** — `feat(venue-service): the service settings carry how orders start (A366)`.

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

- [ ] **Step 1:** make the changes; run focused affected server/venue-service behavioural files:
  green, with `git diff` showing no changed `expect`.
- [ ] **Step 2: Commit** — `test: fixtures that write the service style directly also say how orders start (A366)`.

---

### Task A3b: A zone's order flow comes from "How orders start" and "paid when"

**Files:**
- Modify: `packages/venue-service/src/operations.ts` (`listServiceZones :79-113`,
  `resolveZoneContext :521-555`: LEFT join `department_sale_policies` and `zone_sale_policies`; a
  department with no policy row reads the column defaults, as a fresh row would;
  `recordOrderServiceContext :957-975` and `retargetOrderServiceContext :978-1009` then store the
  context's `serviceMode` directly), `apps/server/src/till-api.ts` (`:1340-1342`, `:1368-1370`: the
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
- [ ] **Step 2: Implement; Step 3: run** focused affected venue-service/server node files; `git diff -- apps/till` contains only A2's
  inventoried receipt changes (order-flow answers keep their shape); typecheck.
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
  collectionNumber: "none" | "numbered"; receiptPrintMode: "auto" | "on_request";
  transfers?: { receivingProfileId: string | null; destinationDepartmentIds: string[] };
}
export async function saveDepartmentSettings(tx: Transaction, cfg: VenueScope, departmentId: string, input: DepartmentSettingsInput): Promise<void>;
export interface ZoneServiceSettingsInput {
  orderStart: "table" | "counter" | null; paidWhen: "prepay" | "ticket_then_pay" | null;
  collectionNumber: "none" | "numbered" | null; receiptPrintMode: "auto" | "on_request" | null;
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
  the zone PUT writes four values and four nulls, including on_request/auto receipt and inherited null;
  each PUT rejects never (400 management.request_invalid, field receiptPrintMode),
  department receipt null refuses and all writes remain unchanged on refusal; a disabled zone → today's refusal
  (`operations.ts:705-719`); the old-style mirror (Task A2) also happens through these routes. Run;
  watch them fail (404, no route).
- [ ] **Step 2: Implement**, reusing the existing validators (`requireName`, the sale-policy value
  sets, the transfer body checks at `routes.ts:913-936`).
- [ ] **Step 3: Run** focused affected venue-service/server behavioural files; typecheck.
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
  collectionNumber: "none" | "numbered" | null; receiptPrintMode: "auto" | "on_request" | null;
}
// <dashboard-service-settings-fields .value .follows=${departmentEffective | undefined}
//   .errors .disabled> — fires `service-settings-change` with { value } (app-owned element:
//   plain event name, CLAUDE.md §3)
```

**Behaviour:** four fields as decision 10 words them, shared `wt-combobox` controls and a
department `wt-switch` for the collection ticket. With follows set (a zone), each choice is
clearable to empty (null); only the placeholder names the inherited localized value. Collection
ticket offers Print / Don't print with that clearable empty state. Without `follows` (a department)
no field is empty. Use the existing combobox empty-value behaviour (`wt-combobox.ts:382-390`,
`:487-490`, `:1018`): an accessible Clear choice can send the empty value while
showEmptyOption stays false, so the closed trigger paints only its inherited-value placeholder.
Clear is a clearing action, not a labeled inheritance choice. Test the actual inner trigger
`.value.placeholder` text, not only the host property; no new primitive is planned.
On a department only, "When counter service is used" carries decision 10's hint when How
orders start is Table service. A zone adds no hint beyond the inherited-value placeholder. Field names per decision 10. `disabled` disables every field (decision 18).

- [ ] **Step 1: Failing tests** (Chromium): a department value draws each field's choice; changing
  each fires the event with the new value; a zone with all `null` shows each placeholder naming the
  department's value only in EN/ES; clearing each fires null; Print/Don't print sends numbered/none;
  receipt choices exactly auto/on_request; assert rendered empty placeholder equals inherited text with
  no prefix/follow option label; the
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
  Assert Cancel precedes Save in every footer, including keyboard order. Run; watch the new ones fail.
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

**Behaviour:** `department-page`: decision 13's parent link and heading (the link always shows), the Setup line (decision 7), "(Disabled)" and an Enable button for a disabled department, and
`wt-tabs` Settings / Zones from a `view` property (it fires `view-change`; the shell owns the URL,
Task A10). `department-settings`: decision 10's form, read-only per decision 18 when disabled; one
Save sending `saveDepartmentSettings` (Task A4), transfers included only when shown; A331's rule
over the whole form; a refusal naming a field (`field` on `management.request_invalid`, or the code
for the name and the transfers) beside that field. Transfers load from `loadDepartmentTransfers`
(`client.ts:135`) when shown; a load failure says so in that section only, and the rest of the form
still saves (without `transfers`).

- [ ] **Step 1: Failing tests** (Chromium) — Review focus 1 and 4: the trail's link and the `h1`;
  parent link present even with one department, modified-click browser handling, long-name h1 wrap;
  Cancel before Save; Save quiet until a change, sends one request with every field; "Zones that differ" names exactly
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
  rendered placeholders show only the inherited values; clear receipt and collection-ticket choices
  to null and read inherited auto/on_request and Print/Don't print; Cancel precedes Save; Save quiet until a change, sends four values with `null`
  for cleared fields that inherit; Move offered only with another active department; Enable only when
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

- [ ] **Step 1: Failing tests** (Chromium) — Review focus 5: bare address lists zero, one or two departments,
  including disabled ones; Open shows the single department with its parent link; Add opens the new
  department with the same link; returning to bare address shows the list;
  an unknown id says it no longer exists; old bookmarks land on the bare address; a browser back
  with an unsaved Settings edit asks. Run; watch them fail.
- [ ] **Step 2: Implement; delete; Step 3: run** focused shell/component/navigation browser
  files (headroom first), affected node files and scoped venue-service/dashboard types. Package
  suites/coverage run in CI; broaden locally only for a named concern.
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

- [ ] **Step 1:** change; run focused affected server files: green with no other `expect` changed.
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

- [ ] **Step 1:** change the inputs only; run focused affected server files: green, no `expect` changed.
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
- [ ] **Step 3: Run** focused affected venue-service/server behavioural files, the venue-service
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

- [ ] **Step 1:** change; run focused affected venue-service/server behavioural files: green; any
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
  their `ON DELETE` (`rg -n 'foreignColumns: \[departments.id\]|foreignColumns: \[zoneServicePolicies' packages --glob '*.ts'`);
  write the list into the commit message.
- [ ] **Step 2:** drop the columns in the schema; generate; read the SQL (two rebuilds).
- [ ] **Step 3:** run `pnpm exec vitest run scripts/migration-upgrade.test.ts`; retain actual
  output. The retirement refusal is expected, not measured. Any RESETS entry is limited to the observed
  retirement refusal under the pre-live reset authorization; no blanket guard exemption. If these rebuilds carry rows,
  add no entry; Part A still requires a pre-live reset for obsolete receipt modes. Report the
  separate reset reasons accurately.
- [ ] **Step 4: Run** the migration guards listed in Task A1, the fiscal pair unedited, focused affected venue-service/server node files,
  the server's `configuration-import.test.ts` and `configuration-transfer.test.ts`; typecheck.
- [ ] **Step 5: Commit** — `feat(venue-service): the service style is retired (A366) — venue reset needed`.
  If the task passes about 100 calls, commit the insert and assertion moves first (they can be
  written while the column still exists only for inserts that do not need it — otherwise keep one
  commit and hand over).

---

### Task A15: Demo, documentation and backlog

**Files:** `docs/developers/design-system.md` (`:425` and `docs/developers/conventions-ui.md:276`
re-pointed to the moved cases; `:676`'s "policy tree" sentence; `:3227-3228`'s addresses; a short
"Departments" section: list/page/tabs, inherited-value-only placeholders, auto/on_request modes
and Cancel-before-Save footers), `docs/developers/testing-guide.md:1128` (only if the a11y file it names was
renamed or emptied), `docs/developers/conventions-data.md` (where the service settings live; an
order's flow is worked out from How orders start and paid-when), `docs/backlog.md` and
`docs/backlog/service-periods.md` (the A366 entry: mark Part A built only after implementation/landing, Parts B/C left with Lane D;
add/retain the separate future order-context split; delete
the "Disabled note not muted" and #1462 Save-before-Cancel entries only when the replacement
behaviour is verified; narrow A331's batch 4b to what venue operations no longer holds), `docs/backlog/dashboard.md:110-119` (the Departments page's dialogs now ignore a close while
busy — narrow the entry).

- [ ] **Step 1:** use the retained A11 whole-task LOOK at the demo venue (`wa-wt demo <worktree>`): Departments lists
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

Run `/finish-branch` with this worktree and this plan. FULL ceremony requires **two completed
Claude run-it whole-branch reviews** on throwaway complete candidate trees. The second reviewer
receives a fresh task with this checklist set aside; then compare findings with requirements.
Retain both reports, triage/fix accepted defects and verify the final reviewed tree. Keep fiscal
golden fixtures and inmutabilidad unedited, run normal signed-off commit/push hooks, and wait
for package suites/coverage on current-head CI. Never bypass a failing guard or hook. Part A's pull request's first line is the
venue-reset line under "Venue reset"; it lists the changed test checks and the fixtures that
changed how they set the service style. Then update the backlog's A366 entry with what remains.
