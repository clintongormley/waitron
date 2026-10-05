# Prep stations tabs: implementation plan (A261 step 3)

> **For the future implementer:** Execute these test-first tasks inline, in order. Run each new behavioral assertion red for the expected reason, add the smallest implementation, then run it green. Use `superpowers:test-driven-development` before writing code. Preserve existing behavioral assertions; update a check only where the approved spec deliberately changes its behavior, retain equally strict assertions, and record the before/after in the PR and campaign FYI. Stop for controversial changes under the queue's 2026-10-05 rule.

**Goal:** Give Prep stations five subject tabs, with live station health and dish drilldowns, printer and watcher assignments, station settings, and venue-wide late-flag defaults.

**Base:** `9612f05f9130b0dba0f3fd6e3cc55fd60176b37b` (this checkout's main, 2026-10-05). **Landed dependency:** A261 step 2, `c47122f55cb2a8aeb6a655641eab394af43a2f38`. Re-read the landed code before implementation. The owner-approved step 1 and step 2 plans are `2026-10-03-venue-settings-and-navigation.md` and `2026-10-04-departments-and-zones.md`. **Review:** On 2026-10-05 a fresh-context Claude read-only seat compared only this plan and the three source specs. Its findings corrected the storage owner, current-screen predicate, cell editing, creation controls, link destinations, interim hours, category wording, served source, Printing rules handover, live columns and question citations. A narrow third reader checked the fifteen corrections against those specs; its three remaining points led to explicit numeric-control approval, pre/post-W97 test paths and watcher-removal recommendation wording. The driver reread those three edits. This is a documentation review; no production behavior was executed.

**Sources:** `docs/superpowers/specs/2026-10-03-venue-operations-design.md` §§6, 11 step 3, 12; `docs/superpowers/specs/2026-10-03-departments-service-styles-hours-design.md` §6; `docs/superpowers/specs/2026-10-04-devices-menus-and-service-zones-design.md` §§4, 6, 10. The latter moves station and watcher _selection_ to device/profile work; this step only displays current device bindings. The `2026-10-04-device-profile-access-and-switching.md` plan and queued W97 own the new profile choices. W97 may land before or after this build: consume its current read model if landed, without implementing or reverting its selection writes.

**Architecture:** `packages/venue-service` owns the Prep stations page and its live-query dependency list. Core station/ticket/watcher stores and management routes stay with their current owners in `apps/server` and `packages/db`. Add a focused station-health read over current `ticket_items` and related rows; use the same scope and late-band calculation as the kitchen and overdue-order readers. Venue defaults and nullable station overrides feed one effective-threshold resolver used by every existing timing consumer. Existing routing rules and tester remain mounted under Routing until step 4.

**Stack:** TypeScript, Drizzle/SQLite, Hono, Lit and `wt-*` components, Vitest 4 with real Chromium for dashboard tests. Every write is one `withTransaction`; queries inside it are awaited in turn. Use `git commit -s` during the later build.

## Boundaries and decisions for owner review

1. **Routing and hours:** Keep today's routing cards, exceptions, order and tester behavior inside Routing. **Interim placement for owner approval:** keep the existing station-hours editor in a small section below the tab panels, outside Routing, until step 5 creates Hours; Stations shows only today's whole-day override and its schedule-derived state. Step 4 owns the grid and the unanswered “No category” proposal. Step 8 retires Printing rules after this step moves kitchen-printer editing; retain any other Printing rules controls and routes until then.
2. **Live counts:** **Counting recommendation for owner approval:** count eligible dish ticket rows (`ticket_items`), not orders or print jobs, and show the remaining quantity in drilldowns. Confirm row count versus quantity totals before building the summary. **Eligibility recommendation for owner approval:** follow the kitchen queue's current exclusions: exclude `made_here`, abandoned and collected orders and unfired held work; stop counting a ticket when its `working_order_lines.served_quantity >= quantity` (both stored in thousandths; `served_at` marks full service), with partial service retaining it and exposing remaining quantity. For extras use their parent dish service context; do not double-count an extra as a separate dish. Customer collection is the separate order-level `working_orders.collected_at` fact. These sources are read in `working-order.ts` serving and queue paths; this plan has not run them. Show `queued` as Waiting, `preparing` as Being made, `ready` as Ready when at least one active device currently selects that station; a profile merely permitting the station is insufficient. Before W97, use the join binding; after W97, use its current-selection read. Disconnection raises the dark-screen problem rather than changing the configured-screen predicate; without one, show “No screen” for the latter two and keep unserved dishes in Waiting. Classify Late from `ticket_items.queued_at`, including an undelivered printer job. Use the worst of warm/overdue/forgotten for a dish, with three color-matched totals in the Late cell. **Owner review:** confirm whether ready-but-unserved dishes remain in Ready and Late; the spec says waiting lasts until served without a screen and does not separately define this screen-present handover case.
3. **Drilldowns:** A number opens a list scoped to that station and status/band, ordered oldest first, naming the kitchen dish, order/table context, send time and current state. **Oldest recommendation for owner approval:** use all eligible unserved dishes, across states, aged from send time; clicking Oldest opens that population oldest first. Use one captured `now` per health snapshot and a timer so age and late bands change even without a database write. A read-only supervisor can open it; it grants no ability to mark a dish prepared or served.
4. **Assignments:** Tickets edits `station_printers` through existing attach/detach verbs; one printer can serve several stations, but a watcher printer is disabled in the picker with the reason. Watchers edits existing follows/zones/pass and `watcher_printers` through `setPrinterWatcher`; keep exclusive station-versus-watcher use and no duplicate print. **Removal recommendation for owner approval:** preserve the existing `removeWatcher` behavior (`apps/server/src/watchers.ts:160-172`): disable it and release printer mappings. **Display proposal for owner approval:** show an old device binding as retained/inactive rather than silently reassigning the display. Shown on screens links to Devices. Also seen by is read-only and links to the Watchers tab, where follows are edited. Profile-owned permitted/current station and watcher choices belong to W97.
5. **Defaults:** Recommend venue defaults `5/10/15` minutes, matching current core station defaults (`packages/db/src/schema/kitchen-stations.ts:18-20`), so an unset override does not change existing age classification on a reset venue. A populated upgrade keeps its existing numeric station values as explicit overrides; newly created stations inherit. Station fields accept an explicit `null` to inherit independently; omission means leave that field unchanged. Validate the _resulting_ warm < overdue < forgotten values at both station and venue-default writes; venue refusal names the affected station. Preserve exact `station.*` domain-code naming and the existing input type/range rules. Do not silently normalize an invalid combination.

## Open-question dependency check

| Source open item                                                 | Does step 3 depend on it?                    | Boundary                                                                       |
| ---------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------ |
| A254 §6 item 1, whether devices have a department                | No; revised by the 2026-10-04 profile design | Show current screen bindings; W97 owns profile department/access.              |
| A254 §6 item 2, counter-tab rounds, positions and party features | No                                           | Health reads already recorded tickets; create no counter-tab behavior.         |
| A254 §6 item 3, advisor Q21/Q14/Q27 about invoice timing         | No                                           | Do not alter payment, bill or fiscal paths.                                    |
| A254 §6 item 3, advisor Q22 about receipt delivery               | No                                           | Kitchen tickets are distinct from fiscal receipts; make no delivery-law claim. |
| A254 §6 item 4, hiding a sole department on other screens        | No                                           | Prep stations shows stations and zones, not a new department selector.         |
| A254 §6 item 5, converting four-value service styles             | No                                           | Keep current service context and reset policy.                                 |
| A261 §12.1, remaining A254 items                                 | No beyond the rows above                     | No implicit answer.                                                            |
| A261 §12.2, “No category” routing group                          | No                                           | Step 4 owns it; today's routing UI stays.                                      |
| A261 §12.3, venue-detail edits after sales                       | No                                           | Step 7 owns those rules.                                                       |

## Change map and migration gate

- **UI/read seam:** `packages/venue-service/src/dashboard/prep-stations-screen.ts`, its browser and axe suites, `routing-client.ts`, `live-queries.ts`, `strings.ts`, `watcher-form.ts`; add small tab/health components beside them if the current screen cannot stay readable. Preserve its existing routing assertions and `station-hours-form.ts` access. `apps/dashboard/src/screens/venue-settings-screen.ts` owns the Kitchen panel; `apps/dashboard/src/api/client.ts` owns its core client contract.
- **Station/default seam:** `packages/db/src/schema/kitchen-stations.ts` and new `packages/db/src/schema/kitchen-timing-defaults.ts`, `apps/server/src/kitchen.ts`, `management-api.ts`, `errors.ts`; provision defaults where the current venue/station seed writes them. Effective timing reaches `apps/server/src/working-order.ts` (`listStationQueue`, expo and JSON timing paths), `table-signals.ts`, and `packages/reporting/src/overdue-orders.ts`. Search all raw and typed reads of the three threshold columns before changing their meaning. `packages/shared/src/timing.ts` keeps the band algorithm.
- **Assignments/health seam:** `apps/server/src/station-printers.ts`, `watchers.ts`, `print-api.ts`, `kitchen-print.ts`, `station-outputs-down.ts`, `working-order.ts`, and focused tests. `packages/db/src/schema/watchers.ts`, `station-printers.ts`, `ticket-items.ts`, `kitchen-print-jobs.ts`, `print-jobs.ts` define existing rows. Trace print enqueue and watcher-copy resolution through `kitchen-print.ts`, not only management routes.
- **Core migration risk:** Recommend a new **core** `kitchen_timing_defaults` table keyed by `location_id`, with one 5/10/15 default row per location and ordered non-null values; make the three existing station columns nullable overrides and remove their obsolete cross-column CHECK. The defaults table has a declared foreign key to `locations`, belongs to core state classification, and is exposed through the enumerated db exports. Core already owns the stations and their timing readers, and reporting currently depends on db/shared without venue-service (`packages/reporting/package.json`); state that reason in the schema commit. No `locations` change or rebuild is planned. Changing station nullability/removing its CHECK is expected to generate a **core** `kitchen_stations` rebuild; inspect the generated SQL before calling that expectation measured. Before generating, inventory every incoming key to `kitchen_stations`: `ticket_items`, `kitchen_print_jobs`, `station_printers`, `watcher_stations`, `devices`, `device_made_here_stations`, `working_order_lines`, `order_draft_lines`, and venue-service `station_claims`, `route_exceptions`, `station_hours`, `station_fallbacks`, `station_day_states`, `kitchen_notices` (confirm current schema and SQL, including trigger bodies). A generated `CREATE __new_*`/`DROP TABLE` is a stop-and-audit gate: with foreign keys on, populated children may refuse or cascade, and triggers can disappear. Test a previously migrated, populated venue with each class of child, a live change feed, and append-only triggers; compare row values and foreign-key/trigger inventories after upgrade. If the generated rebuild cannot preserve them, redesign the storage before shipping. Do not edit shipped migrations. If a new table is used, classify it and verify manifest/dependencies; run schema, migration-match, upgrade, append-only and behavioral-trigger guards. Record any required reset in the PR's first line. A pre-live reset is permissible, but the populated-upgrade result must be known rather than assumed.

## Test-first tasks

All choice/list values in Tickets, Watchers and Settings use an in-cell dropdown or multi-select as A261 §6 requires. **Numeric-control recommendation for owner approval:** late-flag cells open a shared numeric field inside the cell editor, so a blank value inherits the default (§6.5), rather than limiting minutes to a preset dropdown. Names remain editable through the required Rename row action; no text-input alternative to a specified choice dropdown is introduced. Reuse existing validation logic, not the old whole-record dialog layout. Apply the shared field/refusal contract within the cell editor. Creation dialogs may keep the existing form validation. Replace “folder/carpeta” with “category/categoría” in EN/ES wording on every tab, including Routing; its controls and routing behavior stay unchanged.

### 1. Store and resolve late defaults — schema and write-path risk trigger

**Files:** `packages/db/src/schema/kitchen-stations.ts`, new `packages/db/src/schema/kitchen-timing-defaults.ts` and its test, `packages/db/src/schema/index.ts`, `packages/db/src/classification.ts`, `packages/db/src/index.ts` and enumerated exports if required, generated core migrations, `apps/server/src/kitchen.ts`, `management-api.ts`, `kitchen.test.ts`, `management-api.test.ts`, `packages/db/src/schema/kitchen-stations.test.ts`; existing venue provisioning test.

- [ ] Red: provisioned venue returns 5/10/15; a station with all overrides unset resolves them; an override of warm alone inherits the other two. `PATCH /management-api/stations/:id` with explicit null clears just that override, omission retains it, and an invalid type/refusal changes no row. A station save that reverses the _effective_ order returns a named field error. A venue-default change that invalidates any station is refused with that station's name and leaves all defaults unchanged; a valid change affects only inherited fields. An unknown station id leaves the defaults and other stations unchanged.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/kitchen.test.ts src/management-api.test.ts` and the focused db schema suite; record the expected assertion failures, then implement one transaction per write and rerun. Keep the positive case proving valid inherited values can save. Audit generated SQL and the populated upgrade described above before accepting a rebuild.

### 2. Make every timing consumer use effective values — shared behavior risk trigger

**Files:** `apps/server/src/working-order.ts`, `table-signals.ts`, their existing suites; `packages/reporting/src/overdue-orders.ts` and suite; `apps/server/src/kitchen.test.ts` for the resolver.

- [ ] Red with unequal venue defaults and overrides: kitchen queue, watcher/expo view, table signals and overdue report give the same band at warm, overdue and forgotten boundaries. A stored ticket remains associated with its original station even after a station is switched off; a default change reclassifies inherited live work but leaves overridden work alone. A made-here or served item stays excluded where its existing reader excludes it. Assert the old hard-coded per-station column read would fail these cases.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/working-order.test.ts src/table-signals.test.ts` and `pnpm --filter @waitron/reporting exec vitest run src/overdue-orders.test.ts`; replace all three direct timing reads with one effective-value path or an equivalent single read per operation. Inspect emitted SQL for any correlated subquery, and run both base-table and join shapes when applicable. Rerun the focused suites and typechecks of server/reporting/db.

### 3. Read station health and drilldowns — read scope and live-number risk trigger

**Files:** new `apps/server/src/station-health.ts` and `station-health.test.ts`, `management-api.ts` and test, dashboard `routing-client.ts` and test; core default-table classification/change-source declaration in `packages/db/src/classification.ts` and the existing server subscription registration; verify its current home before adding a name. The new core table must be present in the core module manifest and descriptor classification, not only the migration descriptor.

- [ ] Red against a real venue database: two stations, three states, distinct dish quantities, unfired held, made-here, abandoned, collected, served, and a ticket whose printer has not delivered. Assert dish counts (not quantity/order count), per-band late totals, oldest send age, exact drilldown membership and ordering, partial/full served quantities and extras tied to the served parent, and a fixed-clock boundary transition with no database write. Before W97, seed active join bindings to this station versus another station and assert the configured-screen predicate. If W97 has landed, additionally distinguish a profile permitting a station from a device currently selecting it; a disconnected currently selected screen raises its problem and keeps state columns. With no configured screen, unserved queued/preparing/ready records count as Waiting and the two other columns say “No screen”; a bound screen restores state columns. A supervisor with `venue.view` can read; a user without it cannot; read access does not authorize a write.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/station-health.test.ts src/management-api.test.ts` and confirm the new cases fail. Implement one scoped summary/detail read, use the same eligibility and kitchen wording as `listStationQueue`, and read outputs from `station-outputs-down.ts`. Avoid one query per station or dish. Rerun these suites; inspect its SQL and the route's permission wrapper.

### 4. Put Stations and today's Routing in tabs

**Files:** `packages/venue-service/src/dashboard/prep-stations-screen.ts`, `routing-client.ts`, `live-queries.ts`, `strings.ts`, `prep-stations-screen.test.ts`, `.a11y.test.ts`; `apps/server/src/management-api.test.ts` if the route's read permission changes.

- [ ] Red browser assertions: tabs have stable URL keys/order Stations, Routing, Tickets, Watchers, Settings; an invalid/deep-linked key resolves predictably; the Routing panel still offers every currently tested claim/exception/tester action; the temporary station-hours action below the panels opens its existing editor without adding or moving a Routing control. All tab wording uses categories/categorías, with no folder/carpeta labels. New station and New watcher sit at the right of the tab bar and open their create forms; valid creates add the row, duplicate/empty names show domain/field refusals and retain the draft. Stations lists active rows in order and switched-off rows grey at the bottom, asserts the seven columns Name, Today, Waiting, Being made, Ready, Late, Oldest; Default badge; “Always open” without a button; “Open until 01:00” with Close for today; “Opens at 12:00” with Open for today; “Closed for today, work goes to Kitchen” naming the actual fallback, with Back to the schedule. Assert stopped-printer and dark-screen problems separately, auto-updating counts and the selected drilldown. The default cannot be closed; switch-off keeps historical work and fallback behavior. Row menu includes Rename, Make default, Switch off/on; drag reorder has a keyboard path and persists without corrupting routing priority.
- [ ] Run `pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/prep-stations-screen.test.ts src/dashboard/prep-stations-screen.a11y.test.ts`, observe the new failures, then build with `wt-tabs`, `wt-data-table` and `wt-row-actions`. Extend `QUERY_DEPENDENCIES.routing` in `packages/venue-service/src/dashboard/live-queries.ts` and the corresponding server-side subscription source declaration together; include ticket/order/line/station/device/printer and timing-default sources plus a timer for elapsed age. Run `scripts/live-subscriptions.test.ts` and a behavioral live refresh test so a valid name alone is not evidence of correct SQL dependencies; an observer assigns snapshots and preserves open edits. Passive automatic GETs, recovery, detach and read-versus-action error precedence need browser assertions. Rerun the focused tests.

### 5. Tickets assignments and read-only screen relationships — printing risk trigger

**Files:** Prep screen/client/tests, `apps/server/src/station-printers.ts`, `print-api.ts`, `station-printers.test.ts`, `print-api.printer-wiring.test.ts`, `kitchen-print.watchers.test.ts`.

- [ ] Red: one station chooses several printers; one printer serves two stations; an inactive printer or watcher-owned printer cannot be added and the picker explains why; a failed save leaves the selection editable and does not partly detach old mappings. Shown on screens reflects current device selections and links to Devices; Also seen by lists following watchers and links to Watchers. Assert both destinations separately. All printer choices open as in-cell multi-selects; these cells remain noneditable where specified. Print one fired dish after a changed mapping and assert the destination set and watcher copy are exactly as intended; a reprint uses the current permitted path without opening a drawer or duplicating a watcher copy.
- [ ] Run focused server and browser files, observe failures, then reuse attach/detach validation inside one request transaction for a set replacement (if a new route is needed); keep print enqueue outside the management request. In this task remove the station assignment controls from `apps/dashboard/src/screens/printing-rules-screen.ts` and update its browser tests to require their absence and the surviving unrelated controls. Keep the shared server verbs, used here, until step 8 audits retirement; do not create divergent validation paths. Trace route permission (`printer.manage` for assignment versus `venue.view` for listing) and `kitchen-print.ts` consumers. Rerun focused suites.

### 6. Watchers table and printer choices — output and retention risk trigger

**Files:** Prep screen/client/strings and browser tests, `watcher-form.ts`, `apps/server/src/watchers.ts`, `print-api.ts`, `watchers.test.ts`, `kitchen-print.watchers.test.ts`.

- [ ] Red: Follows, For service zones, Runs the pass and Printers edit in their own cells; every-station versus explicit stations and every-zone versus explicit zones remain exclusive; the pass switch and rename persist; a watcher printer moves only when the target is valid and has no station mapping; a failed multi-printer change leaves the previous set. Once the owner approves the removal recommendation, assert that removal disables the watcher and releases its printers without erasing historical ticket or device records. Screens is read-only; a retained binding is labelled without offering it for a new selection. A zone removed by step 2 no longer appears in For service zones; Follows still lists stations. A fired order in an unfollowed zone yields no watcher copy; one in a followed zone yields the intended copy.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/watchers.test.ts src/kitchen-print.watchers.test.ts` and the focused browser suite red, then implement via current watcher writes and `setPrinterWatcher` in one transaction for each submitted change. Reuse `watcher-form` validation without moving in-cell editing to its whole-record dialog and show per-field/refusal feedback. Remove the watcher-printer controls from Printing rules in this task, assert their absence and the remaining unrelated controls, and retain shared server verbs. Rerun focused suites.

### 7. Settings tab and Venue settings › Kitchen defaults

**Files:** Prep screen/client/tests, `apps/dashboard/src/screens/kitchen-screen.ts` and test, `venue-settings-screen.test.ts`, `apps/dashboard/src/api/client.ts`, `apps/server/src/management-api.ts` and test.

- [ ] Red: Each Settings cell opens its own editor; no whole-station edit form replaces that interaction. Settings shows the effective warm/overdue/forgotten values, grey inherited values and explicit blank-to-inherit controls, Show the rest of the order and fallback target; the default reads “Never closes” and cannot choose a fallback. The Venue settings Kitchen panel reads/saves venue defaults. A venue save that would break one station shows its name; a station save marks the offending field, leaves the draft and keeps Save disabled until valid. A server refusal retains a retryable action. A valid venue save refreshes the inherited display without erasing another open draft or replacing an action error with a read recovery.
- [ ] Run focused dashboard/venue-service browser and server management suites red, add the UI and client contract, then rerun. Follow the shared form contract: required marks, field messages, one localized bottom message, semantic names, primitive inputs, keyboard save/cancel, and no duplicate `h1`.

### 8. Whole-branch evidence and handoff

- [ ] Search the base-to-tip tree, including prose, for old station threshold, watcher/printer, hours and Routing claims. Update `docs/backlog.md` in the build branch to record A261 step 3 and any relevant current developer documentation; add dated pointers to historical specs rather than rewriting their history. Keep step 4's routing grid, step 5's Hours replacement, step 8's Printing rules retirement, and W97's profile selection out of this branch.
- [ ] Run focused behavioral suites above; migration guards `scripts/schema-constraints.test.ts`, `scripts/append-only-triggers.test.ts`, `scripts/behavioural-triggers.test.ts`, `scripts/migrations-match-schema.test.ts`, `scripts/migration-upgrade.test.ts`, plus `packages/fiscal-verifactu/src/inmutabilidad.test.ts` if a core rebuild touches its upgrade path. Run the normal hook once on push and verify current-head CI's selected package tests and coverage before declaring ready. Inspect Prep stations and Venue settings Kitchen in EN/ES, light/dark, phone/desktop, including empty/loading/refusal/no-screen/late/drilldown states; use axe, keyboard and screen-reader labels. A green string/API test does not show that a screen renders. Have the meaningful production branch reviewed once with the prescribed run-it whole-branch review. Report exact test counts and any reset requirement in the PR; never claim a check ran from this planning document.

## Review focus

- A print job stuck before delivery must still make its dish late from send time (Task 3).
- A venue default edit must refuse if one station's partial override would invert the effective order (Tasks 1 and 7).
- A new printer assignment must not send duplicate station or watcher copies, including after reprint (Tasks 5 and 6).
- A supervisor must see live numbers without gaining a configuration or kitchen-state write (Tasks 3 and 4).
- A populated core station-table rebuild must preserve incoming child rows and triggers, or the migration must be redesigned (migration gate and Task 1).

## 2026-10-05 implementation checkpoint: storage redesign

The first generated nullable-column migration rebuilt `kitchen_stations`. On Node v26.7.0,
`pnpm exec vitest run scripts/migration-upgrade.test.ts` failed at its `DROP TABLE kitchen_stations`
with SQLite error 787 (`FOREIGN KEY constraint failed`). The new nullable-storage case passed on a
fresh database, so that pass did not establish a working upgrade. The rejected migration was removed
from this branch before committing; no shipped migration was edited.

Use the redesign option above: `kitchen_timing_defaults` holds venue defaults and
`kitchen_station_timing` holds nullable station overrides. The generated migration creates only
these tables. The original station timing columns remain until their removal can be handled without
rebuilding a referenced parent. Before wiring the readers, decide their retirement and any reset
requirement under the house's pre-live no-data-migration rule; do not add a converter by default.

The schema increment classifies both new tables as core state and exposes them through the schema
and public db barrels. Core already owns stations and their timing readers, and reporting depends on
db/shared rather than venue-service. Its focused upgrade test retains a 2/4/8 station, printer and
watcher mappings, and a device's made-here mapping; it compares every original core application table's row values,
non-internal schema objects and foreign-key inventory with a live change feed and append-only triggers installed.
The cross-module upgrade guard still supplies its separate row-count check. Default provisioning,
write validation, effective timing readers and the screen tasks remain to be built.

## 2026-10-05 implementation checkpoint: venue defaults

New venues provision a `kitchen_timing_defaults` row in the same transaction as their location.
A retry preserves edited defaults. `GET /management-api/kitchen-timing-defaults` requires
`venue.view`; `PUT` requires `venue.configure` and replaces all three defaults. The write validates
positive whole-minute values, their order, and each station's resulting values before updating the
row, including disabled stations. A refusal carries the affected station's id, name and field.
Station override writes and the effective timing readers are still outstanding; this increment
does not change their existing reads.

For the completed build, use the approved pre-live reset option: reprovision the default row and
replace original numeric station settings through the new override contract. Add no converter or
legacy-column fallback. Keep the original columns physically present to avoid the rejected parent
rebuild, but retire their runtime reads together in Task 2. State the reset in the PR's first line.
The original populated-upgrade test remains an inventory/preservation receipt for the additive
schema, not a receipt that original timing settings survive the new runtime contract.

## 2026-10-05 implementation checkpoint: station override writes

Station creation and edits now write `kitchen_station_timing`, leaving the original station columns
untouched. Each positive whole-minute override can be saved independently; explicit null inherits
that field and omission retains it. The write checks the resulting values against the venue defaults
before changing station metadata or timing. The management station list resolves overrides against
the default row. Station/default writes share the effective-order check; an existing station's
refusal carries its id, name and field, while a refused creation carries name and field.

The existing POST/PATCH storage assertions now read the override table. The old partial-trio
refusal is replaced by successful partial-save checks plus refusal of an unordered effective set.
The direct warm=99 update test now checks the named domain refusal instead of a raw database CHECK
error. These are deliberate contract changes under Task 1, recorded for owner retrospective review.
The kitchen fixture adds the default row that provisioning already supplies.

Task 2 remains open: queue, pass, raw table aggregation, table signals and overdue reports still
read original station columns. This checkpoint is not ready to ship. Complete those readers,
then the health, UI and printing tasks before finish-branch.


## 2026-10-05 implementation checkpoint: effective timing consumers

Queue, pass, floor aggregation, table/bill signals and overdue reports now join venue defaults and
nullable overrides, resolving each field with `coalesce` in the existing operation's query. None
reads the original station timing columns. Retained work at disabled stations keeps its station's
resolved values. The raw floor aggregation keeps both new joins on the left so an unfired line
still contributes to its existing non-timing totals.

The seven-case consumer suite checks exact boundaries with different venue/default station values,
a default edit changing inherited live work while retaining explicit settings, and the existing
made-here, collected and served exclusions for their respective readers. In a frozen-installed
disposable candidate, restoring the original queue/pass/floor reader file failed seven tests,
restoring the original table-signal reader failed five, and restoring the report reader failed four;
restoring the candidate's implementation passed all seven. These are reader-file controls rather
than a claim that every expression was individually deleted.

Configuration export/import now carries both timing tables and omits the original station columns.
Its new round-trip case compares venue location remapping, station id references, explicit values
and null inheritance. The importer uses the station/default writer's shared validation before the
transaction commits. Two new cases refused a non-positive warm override and an inverted effective
order, with no target venue/default/override rows left behind. Deleting that import validation in a
disposable checkout made both refusal cases resolve successfully; the valid round-trip still passed.
Restoring it passed all three selected cases.

Working-order, reporting, order-groups, print-problems, split-bill, tabs, station-queue-rest and
working-order-reads manual venue fixtures, plus the shared split-extras venue fixture, add the
provisioned default row. The existing two-station expo fixture writes its same 2/4/6 values into
override storage with all existing assertions retained. The approved reset remains required; there is no converter or
original-column fallback. Tasks 3–8 remain before finishing or shipping this branch.


## 2026-10-05 implementation checkpoint: station-health read contract

`GET /management-api/stations/health` requires `venue.view` and returns one captured time,
station summaries and oldest-first dish detail. Counts are ticket dish rows, with remaining line
quantities in the detail; extras are not another dish. Held, made-here, fully served, abandoned and
collected work is excluded. Ready-but-unserved work remains in Ready and Late. A station without
an active device selecting it puts every eligible state in Waiting and returns null for Preparing
and Ready. A disconnected selected device still supplies those columns, with problems read through
the existing output readers. Disabled stations retain their work. Effective timing uses defaults
and overrides, and the detail uses recorded kitchen names and current party/table context.

The new seven-case HTTP/database suite ran with the unchanged management and output suites:
`pnpm --filter @waitron/server exec vitest run src/station-health.test.ts
src/management-api.test.ts src/station-outputs-down.test.ts` passed 114 tests. The new route first
failed five cases with 404; the extras case failed when a child was counted. Disposable candidate
controls removed read authorization, the held-work filter and the location filter, and replaced
effective timing with original columns. The selected assertions failed; restored checks passed.
The location control initially failed with a runtime error, so its test was strengthened to assert
the wrong-venue query's rows directly before repeating the control. Existing assertions are retained.

The passive `PrepStationsApi.readStationHealth` method and health dependency list have focused
browser checks. The core descriptor already exposes the timing tables through classification and
change sources. Tasks 4–8 remain: the health list is not yet subscribed by the screen, and no UI
timer, tabs, number cells or printing-control handover is implemented by this checkpoint. Keep the
approved reset declaration and earlier changed-test notes when finishing the whole branch.


## 2026-10-05 implementation checkpoint: live health table

Task 4 is partially implemented. `station-health-table.ts` renders seven columns from the health
snapshot, with Default/Disabled labels, disabled rows last, separate printer/screen problems and
read-only drilldowns for station/state, late band and oldest work. Drilldowns retain their selection
while new snapshots change membership. Labels are translated; table-cell styling uses parts and
tokens. Summary and detail regions have distinct accessible names.

The screen watches `QUERY_DEPENDENCIES.health` through its query controller with a fifteen-second
refresh. Without live data it owns the matching interval; disconnect releases observations and
intervals. The controller's recovery callback clears only a read message after the failing reads
recover, instead of an unrelated routing snapshot clearing it. Open station drafts remain.

Focused real-browser validation ran six files and 235 tests; unchanged subscription/style-token/
pinned-action guards ran three files and 17 tests. Venue-service typechecking and focused lint passed.
The initial table cases failed before registration; three screen cases failed before wiring; the
loading and disabled-row cases failed before their changes. In a frozen-installed disposable copy,
removing the detail filters failed two cases, removing the refresh interval failed one, and restoring
both passed five selected cases. Existing test assertions remain; screen and axe API doubles gained
the new passive health-read fixture. A synthetic dialog-cancel probe did not invoke the browser's
Escape behavior; the corrected real Escape check passes. Axe found duplicate region names in the
new drilldown; the named regions passed its light/dark checks.

The component summary and drilldown were opened and inspected in EN/ES, light/dark, 390/1280 widths;
these are component observations, not a completed Prep stations page review. Task 4 still needs the
five URL-backed tabs, the final Today cells/buttons, station row menus/reorder and interim hours
placement. The health table is temporarily mounted above the existing screen; do not land this
checkpoint as the completed step. Tasks 5–8 and the final review/CI/landing gates remain.


## 2026-10-05 implementation checkpoint: tab navigation

The five subject tabs have stable `view` path keys. A bare page defaults to Stations; a legacy
product-tester link defaults to Routing. Invalid keys are replaced with Stations, and browser
Back restores the chosen panel and tester selection. Both the page controller and dashboard's
shared path configuration preserve the tab and tester. Nested tab events do not change the page's
selection. New station and New watcher sit in the strip's action slot; interim station hours and
its existing editor are outside the panels. Categories replace folders in visible wording, and
retained stations/watchers use Disable/Enable in English and Spanish.

This is a navigation checkpoint, not the completed screen: Tickets and Settings are still empty
panels, the routing cards retain legacy station settings/output links, and Watchers retains its
cards. Task 4's Today actions/row menus/reordering and Tasks 5–7's assignments/settings editors
remain before Task 8 review, CI and landing. No empty panel or partial page is authorised to ship.

The hours assertion now checks the same overnight wording in the interim hours section; the
existing dashboard tester-link assertion checks the canonical Routing path with its product
retained. Wording checks retain their previous assertion strength with the approved category and
Disable/Enable text. The timed-tester accessibility fixture selects Routing before measuring its
controls; it retains every size, position, answer and accessibility assertion. The dashboard
fixture supplies the complete station-health response. The build PR must name these changes
alongside the earlier Task 1 changes.

### Today actions checkpoint, 2026-10-05

Task 4 remains partial. The Stations table now renders confirmed Open/Close for today actions and
Back to the schedule for a whole-day override, using the existing write and confirmation path.
Default and unscheduled stations say Always open without an action; disabled stations and an
unreadable clock offer no hours action. A refused write retains the confirmation and permits retry.
The effective fallback still comes from the server's `closedSendsTo`, not the configured first hop.

Six new browser checks failed before implementation and then passed. The four existing screen/table
suites ran 246 tests successfully. Eight new viewport/axe checks cover EN/ES, both themes and
390/1280 widths; their captures were inspected. Unchanged UI guards ran 41 tests successfully.
In a frozen-installed disposable candidate, removing the always-open guard or the disabled-station
guard failed the relevant check; restoring both passed all 14 Today checks. No existing assertion
was changed. Types, focused ESLint/Prettier and `git diff --check` exited zero.

Today still needs schedule-derived next-opening/closing wording; legacy card controls remain until
the routing-only card replacement. Row menus/reorder, Tasks 5–7 and the whole-branch Task 8 gates
remain open. This checkpoint is not ready to finish or land.


## Task 4 schedule-transition checkpoint — 2026-10-05T19:08:03.980056+02:00

The routing snapshot now carries a nullable next schedule transition with venue weekday,
HH:MM and civil days ahead. It uses the same current station-status resolver at weekly interval
boundaries. Actual open/closed changes skip overlapping and adjoining intervals, including
intervals that cover the whole week. Default, disabled, unscheduled, by-hand and unreadable-clock
states have no scheduled transition. Current overrides still use the existing business-day expiry.

The Today cell renders Open until / Opens at in EN/ES, with tomorrow or a later weekday where
needed. A passive minute refresh supplies the new routing snapshot even without a database event;
removing the screen stops its timer. Live-data sessions retain the existing shared query refresh.
Existing assertions are retained. Complete StationTimes fixtures gained nextTransition:null in the
Prep stations browser/axe suites and dashboard folder-made-at/catalogue-browser suites; the Today
visual fixture additionally includes a next closing. No guard, fiscal or schema file changed in
this increment. Red-first database and browser cases, subsequent focused suites, types, lint and
visual/control receipts are recorded in the campaign ledger.

Ruling: a transition on a later civil day names tomorrow or its weekday — the source spec's
01:00 example crosses midnight, and a closed weekly station may next open several days later.
This adds context to the specified Open until / Opens at wording without a new schedule rule.

Task 4 remains partial: station row menus/reorder and routing-only card replacement are next.
Tasks 5–7 still need Tickets/Watchers/Settings cell editors and venue-default UI; Task 8 whole-branch
review, current-head CI and landing remain. The page is not authorised to ship at this checkpoint.


## 2026-10-05 implementation checkpoint: station row actions and ordering

Stations now adds Rename, Make default and confirmed Disable/Enable controls in each Name cell,
retaining its seven data columns. The name-only form validates locally, distinguishes a duplicate
name from a general request refusal, permits retry and closes after the write succeeds before
refreshing. Existing Routing controls remain during the remaining tab handover.

Pointer and Arrow-key moves update active station order; release persists one complete set through
`PUT /management-api/stations/order`. Its transaction validates membership, completeness and
uniqueness before updating display positions. Disabled station rows are outside the set. Keyboard
moves restore the handle's focus and announce the position; disconnect releases drag listeners and
the shared cursor. A refused request resets the optimistic order and displays its action message.

The new order test seeds two extra active stations before reversing the list and compares a
separately read disabled row before/after. The original new test used an active-only list to inspect
disabled rows, so its empty comparison was replaced before this checkpoint. A new red/green HTTP
case establishes `includeDisabled=true`; only the Prep page opts in, and existing active-only list
assertions remain. The client's route expectation is intentionally changed under Task 4's retained
row requirement. Its standalone browser fixture now registers the dashboard's grip and kebab SVG
paths, which `apps/dashboard/src/main.ts` registers in the application.

Focused verification: server management/kitchen 126 tests; browser Prep screen/client 197 tests,
with the preceding five-file health/screen/client/axe run passing 284 tests before the retained-read
and icon-fixture refinements. Eight EN/ES, light/dark, phone/desktop menu/rename checks pass and their
sixteen captures were inspected. Unchanged root guards passed 75 tests. Disposable set-validation
removal accepted an empty incomplete set with 204 instead of 400 while the positive reorder still
passed. Task 4's routing-only replacement and Tasks 5–8 remain; the full branch is not ready to ship.


## 2026-10-05 implementation checkpoint: Tickets selection

Tickets now shows one row per retained station, with Printed on, Shown on screens and Also seen
by. Active station rows open an in-cell printer multi-select; disabled and watcher-owned printers
carry a reason and cannot be added. A retained disabled printer can be deselected. The screen links
to Devices and the Watchers tab separately. Current active kitchen-screen bindings are shown;
this checkpoint does not change device/profile selection writes.

`PUT /management-api/stations/:sid/printers` requires `printer.manage` and applies the entire
selection in the route's transaction, using the existing attach/detach validation. Failed additions
roll back earlier additions and preserve old mappings. An empty set still requires an active
station. Printer refusal stays beneath the picker; general refusal stays at the page, and either
permits retry. A completed write closes the editor before its separate refresh. Live mapping
updates retain an open draft. The picker count and empty search are localized; its refusal wraps
inside a phone-width cell.

The new fired-ticket/reprint case checks exact destination sets after two selection changes,
one watcher copy per operation, document jobs and no drawer pulse. Printing rules still retains
its assignment controls at this checkpoint. Complete their planned handover with equally strict
moved behavior checks, and complete Routing, Watchers, Settings, defaults and supervisor loading,
before the full Task 8 finish/land workflow. No existing behavioral assertion changed here.


## Task 5 Printing rules handover checkpoint — 2026-10-05T20:13:24.940649+02:00

Station printer assignments now have one editor, Prep stations Tickets. Printing rules keeps its
watcher picker and drawer controls until Tasks 6 and A261 step 8 retire those respective controls.
Its watcher refusal points to Tickets, and a live mapping snapshot clears that printer's conflict
only once it has no station mappings. The unrelated page action-error recovery check remains.
Tickets also supplies a localized empty message to its shared table.

The station membership, attach/detach, refusal, empty-state and native-control checks moved to
Tickets with exact saved-set and refreshed-selection assertions. Printing rules instead requires
its old station controls absent while preserving its watcher/drawer assertions. The approved Task 5
handover is the authority for these changed checks; their before/after file locations are retained
in the campaign FYI for the final PR. The shared management verbs and printing code are unchanged
in this checkpoint's diff.

Observed failures: two handover cases before implementation, two wording cases before guidance
changes, and the Spanish empty-state case before the table received its localized message. The
three focused Prep stations browser files passed 288 tests; after strengthening the native-name
and option assertions, all six moved cases passed again. Printing rules passed 36 tests including
eight EN/ES light/dark phone/desktop accessibility cases. All eight captured refusal layouts were
inspected. The three station-printer/fire/reprint consumer files passed 51 tests; three unchanged
root guards passed 41 tests. In a frozen-installed disposable checkout, deleting conflict clearing
failed its case while the unrelated save-error case passed; restoring it passed both. Removing
saved selection initialization failed the moved membership case while Cancel passed; restoring it
passed both. The disposable checkout was removed after byte-comparing its restored changed files.

Task 5's handover is implemented. Task 4 still needs its routing-only replacement; Watchers,
Settings, venue defaults UI, supervisor page-loading and the full Task 8 review/push/CI/land gates
remain. This checkpoint does not make the branch ready to ship.


## Task 6 watcher printer-selection checkpoint — 2026-10-05

Task 6 is partial. The server now accepts a whole watcher printer selection at
`PUT /management-api/watchers/:id/printers`, with `printer.manage` authorization and
one transaction. New assignments reuse `setPrinterWatcher`; the target watcher must be active
and belong to the location even when clearing the selection. Existing disabled printer assignments
can remain or be removed without offering that printer for a new assignment. The Prep client
exposes the write, including from its background instance without making it passive.

Thirteen new real-HTTP cases failed with 404 before the route existed; the client case failed
because the method was absent. The three focused server suites passed 63 tests and the client
suite passed 22. No existing assertion changed. Two initially guessed error names in the new
cases were corrected against `request-screens.ts` and identity's `authorize.ts`; those corrections
are not product fixes. In a frozen-installed disposable candidate, moving the save outside its
transaction failed the three rollback cases while successful replacement passed; restoration
passed all four. Removing only the active-target check initially survived because the printer
verb also rejects a disabled watcher. The new case now also attempts an empty selection: that
mutation failed with 204 instead of 404, with successful replacement still passing; restoration
passed both cases. The candidate's changed files matched the source and the candidate was removed.

The Watchers table and its cell editors, read-only screen relationships, disable action and
Printing rules watcher handover remain open. Settings, Routing cleanup, supervisor loading and
Task 8's whole-branch review/push/CI/land gates also remain. This checkpoint adds no screen and
makes no visual or branch-readiness claim. Campaign-local evidence is kept in the A261-3 ledger.

### 2026-10-05: Task 6 printer-editor increment (build remains partial)

The Watchers printer-selection UI uses the preceding whole-set API. New browser cases cover
multi-printer save/reopen, station conflicts, disabled retained mappings, watcher transfer, Cancel,
refusal/retry, a live read retaining the draft and its save error, and a successful write closing
before a failed refresh. The Escape-cancellation case was observed red without its handler.
The editor is mounted in the existing watcher cards as an intermediate checkpoint; the approved
table, Follows/zones/pass/name cells, retained Screens and Printing rules watcher handover remain.
Do not finish or land this partial page. Browser/server/guard counts and deletion-control outputs
are recorded in the campaign ledger, rather than treating this note as a verification receipt.


### 2026-10-05: Task 6 Watchers table increment (build remains partial)

Watchers now has subject cells for Follows, service zones, Runs the pass, Screens and Printers,
with Rename and Disable in a pinned row menu. The printer picker moved from its temporary card
placement into the table. Choice editors share creation-form validation, keep every and explicit
selections exclusive, and retain drafts/refusals through live reads. Screens remains read-only,
includes retained inactive device bindings and links to Devices. Rename writes the saved values
of other fields rather than including an unsaved choice draft.

The existing relationship checks moved to their corresponding table cells, with exact choice
values; the former whole-watcher update check now verifies Rename's complete request. Its axe
refusal state now reaches the real Rename request rather than injecting a refusal into the old
whole-record form. Their before/after locations are recorded in the campaign's changed-check FYI.
New test-first checks and disposable deletion controls are recorded in the campaign ledger.

Task 6 still needs the Printing rules watcher-printer handover. Task 4's Routing cleanup, Task 7's
Settings/defaults and supervisor page-loading contract, and Task 8's whole-branch review, hook,
current-head CI and landing remain. The full page is not ready to finish or ship.


### 2026-10-05: Task 6 Printing rules handover (build remains partial)

Printing rules now links to Prep stations Tickets and Watchers instead of reading or editing kitchen
printer assignments. Its existing drawer-policy controls remain for step 8. Their saved-choice,
refusal, in-flight gate and action-versus-read recovery checks retain their behavioral assertions;
load fixtures now fail/recover the surviving location read. The watcher assignment checks now run
on Watchers: whole-set choices and transfer, native saved selection, Cancel after refusal, localized
station conflict guidance, phone geometry and light/dark accessibility. The old conflict-recovery
check moved to the Watchers editor with partial/final station-release assertions and no resubmission.
A second selected printer still serving a station keeps the refusal, even after the printer named by
the server has been released. A general save error survives the same live read.

New handover/conflict checks failed before their implementation. The new 320px geometry check first
used a synthetic click on an offscreen table cell; the browser's real click scrolls the cell into
view, and the retained viewport bounds pass. No production geometry change followed that probe.
Tasks 4 (Routing cleanup), 7 (Settings/defaults/supervisor page loading) and 8 (whole-branch review,
current-head CI and landing) remain. This checkpoint does not authorize shipping a partial page.


## 2026-10-05 implementation checkpoint: Venue settings Kitchen late flags

The Kitchen panel now loads venue defaults through its own shared dashboard query and edits all
three values in one form. Every invalid field is marked after a submission; only the form's own
checks or an in-flight write disable Save. A refused effective station order names the station
under the returned field and remains retryable. Saved snapshots and drafts are separate: a live
read changes the saved values without erasing a typed value or a save refusal. A successful write
closes before its refresh, so a failed refresh reports a read failure. Cancel/Escape discards;
Enter saves. Supervisors see saved values without a way to edit them. The query subscribes to
`kitchen_timing_defaults` and its background GET is passive.

The new client and browser assertions failed before the methods and form were added. Focused
browser suites retain the existing Kitchen, Venue settings, client and live-query assertions.
The shell's Kitchen fixtures add the new default-read/write methods without changing existing
checks. Saved, locally invalid and station-refused states passed axe and viewport checks in
English and Spanish, light and dark, at measured widths 390 and 1280; their captures were inspected.
The initial capture showed the Edit button stretched across the panel; a geometry assertion failed,
then passed after the button was allowed to fit its label.

In a frozen-installed complete disposable candidate, deleting the local validation sent invalid
writes; overwriting an open draft on a live read replaced its typed value; including a server
refusal in Save's disabled condition prevented a retry. Each focused control failed with that
change and passed after restoration, alongside its valid-save or Cancel positive control.
The campaign ledger retains the literal commands and counts. This is a Task 7 subtask checkpoint;
station Settings, Routing-only cleanup, supervisor Prep-page loading, whole-branch review and
current-head CI remain before finishing or landing. The approved reset requirement remains.


## 2026-10-05 Settings choice-cell checkpoint

Task 7 now supplies one Settings row per active station and independent choice editors for
Show the rest of the order and When closed, work goes to. The default reads Never closes and
has no fallback picker. A fallback change confirms the existing destination sentence inside
its cell; changing the choice clears that confirmation. The existing station patch and fallback
routes remain the write seams. Cancel/Escape discards, an in-flight write holds the draft, a
request refusal remains retryable, and a successful write closes before a separate refresh.
Local yes/no validation marks and focuses the choice and rechecks after an invalid submission.

`pnpm --filter @waitron/venue-service exec vitest run --project browser
src/dashboard/prep-stations-screen.test.ts src/dashboard/prep-stations-screen.a11y.test.ts
src/dashboard/prep-stations-screen.settings.test.ts src/dashboard/routing-client.test.ts`
ran four files with 359 passing cases. The new cases include eight EN/ES, light/dark, 390/1280px
accessibility/viewport states; their saved, picker, refusal, confirmation and fallback-refusal
captures were inspected. In a frozen-installed disposable candidate, deleting validation,
fallback confirmation, or invalid-field focus separately failed its targeted case while a valid
save still passed; restoring all three passed the four selected cases. Package types, focused
lint/format and the unchanged native-field/token/subscription guards passed. Existing checks and
fixtures were unchanged. The campaign ledger retains commands and logs, including corrections
to the new test harness's URL, field-message expectation and table lookup type.

This is a Task 7 subtask checkpoint. The three timing cells/inheritance display, supervisor
Prep-page loading, Task 4 Routing cleanup and Task 8 whole-branch finish/CI/land remain open.
Do not ship this partial page.


## 2026-10-05 Settings timing-cell checkpoint

Task 7's late-flag cells now read effective values with separate raw overrides and venue defaults
from the existing station list. A same-valued override remains explicit. Each cell saves only its
own field; blank saves null. Local validation checks the latest effective trio, whole positive
minutes and the existing integer bound. Invalid submissions retain/focus the field and recheck on
change; a server refusal remains retryable with a field message and bottom summary. Cancel/Escape
discard. The routing read subscribes to timing defaults and overrides as well as station metadata,
so a venue default change updates inherited values without resetting an open draft or action error.

The two existing whole-station response checks in `apps/server/src/kitchen.test.ts` gain exact
`timingDefaults`/`timingOverrides` objects without changing existing values. Three Prep browser
fixture files gain the same complete response metadata, including the accessibility fixture's
station pair. Campaign-local test and deletion-control logs record the verification.

Routing-only cleanup, supervisor page loading and Task 8 whole-branch review/hook/current-head
CI/landing remain. This checkpoint does not mark the branch ready to ship.


## Supervisor overview checkpoint — 2026-10-05

The dashboard now accepts a module screen's optional read permission and passes its read-only
state to the screen, following the settings-panel contract. Prep stations uses `venue.view` for
Stations health and drilldowns, retaining `venue_service.manage` for configuration. Its overview
client reads station metadata and a separate station-overview venue-service route; it requests no
printer, device, watcher or catalogue management lists. Existing routing and write permissions
remain in place. A saved configuration link and switching an open screen into read-only mode select Stations;
configuration tabs, creation, row actions, reordering and Today writes are absent for viewers.

New route, metadata, client, screen and shell cases failed before implementation. The final focused
commands passed 66 venue-service route tests, 109 server tests, 312 dashboard shell tests and 350
Prep browser tests, including eight EN/ES, light/dark, phone/desktop keyboard, axe and viewport
cases. Sixteen page/drilldown captures were inspected. Three unchanged root guards passed 37
cases; four affected package typechecks and focused lint passed. In a frozen-installed complete
disposable copy, removing the overview authorization made the staff refusal fail while the
supervisor case passed; removing the readonly row-action gate made the hidden-menu check fail
while two manager cases passed; removing the shell read-access branch made the supervisor nav
check fail while the manager tester case passed. Restoring each gate passed its selected cases. A strengthened overview case includes a nondefault
station with scheduled status: removing its readonly Today gate exposes a closure button and fails
that case, while the two manager Today cases pass; restoring it passes all three cases.

The existing Prep placement check gains `readPermission: "venue.view"` under Tasks 3–4's approved
supervisor read access. Its request fixture now supplies a complete empty health snapshot rather
than an array; all existing behavior assertions remain. The first broader browser run passed its
341 assertions but exited with that fixture's unhandled error; it was not a green run. New visual
harness waits and screenshot paths were corrected before the final passing run. This is a subtask
checkpoint: Routing-only cleanup and Task 8 whole-branch review/hook/CI/landing remain open.
