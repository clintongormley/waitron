# A724 Part 1: staffing guide bands implementation plan

> 2026-10-16: A710 aligns the staffing painter hint, creation action,
> tooltips and headcount controls; short-block labels remain an owner decision; the current contract is in
> [the design system](../../developers/design-system.md#forms).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task, inline. Steps use checkbox (`- [ ]`) syntax for tracking. The owner has approved the design and the runner authorises implementation; no approval pause or agent dispatch.

**Goal:** Give both staffing painters named, coloured opening-period bands, including a prep station's sending departments, and title the season painter “Autumn: standard week”.

**Architecture:** Put the existing station reachability and interval calculation behind one batched venue-service reader with explicit season-week and dated-plan inputs. Staffing adds display metadata to its read contract; its writes and block layout stay independent of the guides. The dated Times reader uses the same calculation while retaining its public default-station answer.

**Tech Stack:** TypeScript, Drizzle/SQLite, Lit, Vitest node and Playwright Chromium projects, existing palette tokens.

**Spec:** `docs/backlog.md:4734`, the complete A724 entry in `docs/backlog/workforce.md:126`, and `docs/backlog/mockups/a718-a727-calendar-and-stations/{README.md,boards.html}` boards 08/09/10 and their PNGs. Retain A585's independence of staffing from opening hours (`docs/superpowers/specs/2026-10-13-a585-staffing-and-rota-design.md:172`).

## Global constraints

- Implement A724 **points 1, 2 and 4 only**. The queue explicitly permits this partial PR. Leave point 3, `staffing-month.ts` and the month day box until **Lane A A720, all parts, has landed**. Do not broaden to A725 ordering or calendar month work.
- Work only in `/Users/clintongormley/workspace/worktrees/waitron-feat-a724-staffing-guide-bands`. No migrations, schema, fiscal code, global rules, root guards, campaign settings, package manifests or dependency changes. A737 Part 2's migration branch is parked.
- Before writing implementation or tests, read `superpowers:test-driven-development/SKILL.md`. Add each behavioral test first, run it and retain its expected assertion failure, implement, then rerun. A missing import or fixture/constraint failure is not the intended red result.
- Use existing real-database fixtures (`useVenueDb`), sequential awaits on a transaction and set-based reads. No per-station, per-department, per-period or per-date database calls. Do not copy the routing decision tree.
- Read the relevant sections of `docs/developers/{conventions-data,conventions-ui,testing-guide,design-system,writing-claims,ci-and-gates,workflow-guide}.md`. Keep comments to invariants and non-obvious reasons. Every implementation commit uses `git commit -s`; never bypass hooks.

## Source trace and decisions

These are source observations at `77f1fb3746dbf1c1ef446df2d53de4cecc13ae61`, not runtime qualification; the tasks below supply that evidence.

- `staffing/paint.ts:141,224–263,289–345` strips period ids to two times, reads every season for the week guides, and returns no station guides. Its special-day path already supplies **this special day's** `readSpecialDayPlan` to `resolveDepartmentsDays`; retain that distinction from whichever repeating special day would ordinarily stand on the date.
- `venue-service/day-resolver.ts:145–251` batches season reads and layers date paint, Closed-all-day and zone open/closed paint. `season-weeks.ts:230–331` accepts `only: {seasonIds, weekdays}`. Read the selected season's seven weekdays directly; a standard week has no real dates, holiday occurrence or scheduled dated cutover.
- `station-service-times.ts:70–225` validates inclusive spans of at most 42 dates, rejects inactive/foreign stations and returns `{always: "default", days: []}` early. Its remaining calculation calls `periodProductIds`, `loadRoutingRules(tx,cfg,null)` and `selectRoutingCell`, subtracts each reaching zone's closures and unions shares **within the same period**. It currently uses raw period ends, without `endOffsetMinutes`.
- `routing-periods.ts:49–95` includes customer and staff menus, walks the menu graph and normalises variants to parent ids. `routing-store.ts` supplies effective categories and category ancestry; `routing.ts:188–245` chooses product/category/ancestor/zone/period-line targets and implicit default. Reuse these paths, including their current active-variant semantics. Planning ignores today's station closures, fallback moves and kept-open extensions; do not substitute live `chooseMaker` behavior.
- `menu-timetable.ts:892` already reads period name, colour, menu and signed end offset. `resolveDepartmentService:413–458` computes sending cutoffs from joined service runs, includes positive grace from the preceding business day and bounds current-day service by its dated next start. Use that wall-minute arithmetic for forecast bands, without changing order acceptance. `service-day-context.ts:12` supplies each dated day's cutover and length; season weeks use `{dayCutover: cutover, endMinute: 1440}`.
- Keep the public default-station “Always open” answer and its tests. Staffing shows **scheduled orders reaching the default**, including implicit-default routes, rather than painting 24 hours. This separates availability from forecast demand and requires bypassing the public reader's early return internally. Board 09's Times agreement applies to the derived ranges; its existing default availability sentence remains deliberate.
- A708's single-ruler behavior on dates with different cutovers remains open (`docs/backlog/workforce.md:43`). Retain the staffing read's baseline `cutover`, block geometry and writes; do not claim to resolve A708. Calculate dated station ranges with the real dated context, as the current department guides do.

## File map and lane boundaries

| Files | Responsibility |
| --- | --- |
| New `packages/venue-service/src/planned-service-guides.ts`; existing `station-service-times.ts`, `index.ts` | Shared batched plan reader; existing dated wrapper delegates; explicit export beside station-service exports. |
| Existing `packages/venue-service/src/{station-service-times.test.ts,routes.test.ts}` | Shared-reader, offset and public-contract assertions; reuse the existing station fixture. |
| Existing `packages/staffing/src/{staffing-types.ts,paint.ts,paint.test.ts,routes.test.ts}` | Rich guide contract and both reads; preserve all staffing-write assertions. |
| Existing `packages/staffing/src/dashboard/{staffing-grid.ts,painter-parts.ts,staffing-season-painter.ts,staffing-special-day-painter.ts,strings.ts}` | Bands, department lanes, shared explanation, season title. |
| Existing staffing `src/testing/{season-staffing-fixture.ts,special-day-staffing-fixture.ts}` and dashboard `staffing-grid{,.a11y}.test.ts`, `staffing-{season,special-day}-painter{,.a11y}.test.ts` | Update every populated guide fixture; test geometry, interaction, copy, accessibility and LOOK. |
| `docs/backlog.md`, `docs/backlog/workforce.md`, `docs/developers/{design-system,conventions-data}.md` | Retire only shipped A724 points and update the directly affected behavior descriptions. |

Read the saved orientation inventory at `/Users/clintongormley/waitron-campaign-f/receipts/orientation-20261016-0321/worktrees.json` and refresh relevant diffs before editing. Inspected `git diff origin/main...feat/a720-3-day-box`: Lane A changes `calendar-day-box`, opening-hours screens, `paint-grid-parts`, `paint-grid`, `painter-frame`, `period-colour-styles`, and the **Calendar** section of design-system. Touch none of that code; consume existing `periodColourStyles`. Its workforce change is A724 point 3's day-box reference: preserve that paragraph byte for byte. Edit only the separate staffing paragraph under Forms. `feat/a743-whole-order-kitchen-note` appends `order-kitchen-notes` at the end of venue-service `index.ts`; add the guide export beside the existing station-service block, not at EOF. Its backlog hunks are elsewhere. `feat/a737-post-invoice-refund` changes db schema/migrations/exports, all outside this plan. Only distinct hunks are allowed; refresh and inspect any later overlap before proceeding.

`rg -n 'StaffingGuideRange|\bguides\b' packages/staffing apps/dashboard` traces the populated consumers to: `paint.ts`, the two guide fixture factories, grid tests and grid accessibility tests, both painter tests, and `paint.test.ts`. `painter-parts.ts` forwards the map through `guidesKeeper`; keep its reference-stability assertions. `staffing-types.ts` supplies both response shapes; `dashboard/client.ts` forwards typed responses and has empty-map fixtures in `client.test.ts`. `routes.test.ts` asserts complete JSON bodies for both responses. Empty maps need no new fields. The grid is not used by the rota or month. Rerun this inventory before changing the contract.

## Review focus

1. Adjacent same-colour periods and short bands must retain distinct names and exact minute endpoints (Task 3).
2. A station fed by two departments on different days must retain the same department lane positions across every column (Tasks 1–3).
3. Negative and positive offsets, zone closures and midnight/cutover boundaries must describe sending time, not selection time or raw opening time (Task 1).
4. Stored special-day editing must retain its own plan when a different repeating day overlaps, including an empty or closed date (Task 2).
5. Guides must remain inert while staffing outside their times stays paintable; keyboard edits and quiet Save behavior must remain intact (Task 3).

## Task 1: share the bounded station forecast calculation

**Files:** venue-service files in the map. Keep the existing public `StationServiceTimes` and `StationServiceDay` interfaces unchanged.

**Interfaces:** Define and export from `planned-service-guides.ts` and `index.ts`:

```ts
type ServiceGuideRequest =
  | { kind: "season"; seasonId: string; cutover: string }
  | { kind: "dates"; dates: readonly LocalDate[]; clock: BusinessDayClock; plan?: DayPlan };
type GuideDepartmentRanges = readonly {
  departmentId: string; ranges: readonly ServiceRange[];
}[];
interface PlannedServiceGuides {
  departments: readonly { id: string; name: string }[];
  periods: readonly {
    id: string; departmentId: string; name: string; colour: CalendarColour;
  }[];
  // Column keys are String(weekday) or a requested local date.
  departmentRanges: ReadonlyMap<string, ReadonlyMap<string, readonly ServiceRange[]>>;
  stationRanges: ReadonlyMap<string, ReadonlyMap<string, GuideDepartmentRanges>>;
}
function readPlannedServiceGuides(
  tx: Transaction, cfg: VenueScope, stationIds: readonly string[], request: ServiceGuideRequest,
): Promise<PlannedServiceGuides>;
```

`departmentRanges` is department id → column → raw opening ranges; `stationRanges` is station id → column → departments in `readActiveDepartments` order. Include empty requested columns. Filter targets to active stations in the location's routing snapshot. Empty `stationIds` skips menu/product/routing work. This internal batch reader returns only requested columns and never changes data; public id/range refusals remain in the existing wrapper.

- [ ] Add `A724 applies signed offsets before zone closures` in `station-service-times.test.ts` using its real fixture. Assert `22:00–02:00` at −30 gives `22:00–01:30`; `12:00–16:00` at +15 gives `12:00–16:15`; at +30, a zone closed at 16:15 trims the latter to 16:15, not 16:45. Move the fixture's next Afternoon start from 16:00 to 17:00 before saving a positive offset, so the production writer accepts it. Use legal quarter-hour schedule/closure fixtures; a −7 offset additionally pins the exact 15:53 endpoint. Offset zero preserves every existing expected range. Add a real route case with a nonzero offset in `routes.test.ts`.
- [ ] Run `pnpm --filter @waitron/venue-service exec vitest run --project=node src/station-service-times.test.ts -t A724 --reporter=verbose`. Expected red: raw `02:00`/`16:00` endpoints differ from `01:30`/`16:15`, before introducing the new reader. Then implement the reader and delegate the non-default wrapper calculation to it.
- [ ] Move, rather than copy, the reachability, subtraction and per-period union code. Load active departments/periods/zones, menu product membership, effective product facts and untimed routing rules once per call, sequentially. Build period → zone → **set of selected station ids** by selecting each offered product's route, distributing ranges to every requested station it reaches. A zone's menu can feed several stations. Restrict product facts to offered parent ids. Never call the single-station public reader in a staffing loop.
- [ ] For a season request, call the two season-week readers with `only: {seasonIds: [seasonId], weekdays: [0,1,2,3,4,5,6]}` and the supplied cutover. No `Date`, representative week, `readDayPlan`, holidays or repeating-day lookup. For dated requests, resolve departments/zones in batches with the supplied clock and plan; never replace supplied special-day entries with calendar occurrences.
- [ ] Compute sending ends on joined same-period service runs using `rangeSpan(...).end + endOffsetMinutes`, **before** subtracting zone closures; never offset a closure-created segment. Intersect with the output day's wall-minute interval, subtract that day's zone closures, then union only same-period shares across zones. Drop nonpositive intersections; do not round minutes to staffing's quarter-hours or merge different periods.
- [ ] Cover positive grace across the cutover: at baseline 06:00, Sunday `22:00–06:00`, +15, contributes Monday `06:00–06:15`. A standard week uses the selected season's preceding weekday cyclically. A dated request batches the requested dates plus their immediate predecessors, resolving missing plan entries once with `readDayPlan` and overlaying supplied entries last. This is a finite set, never every intervening date for a sparse special-day list. Convert a predecessor span into the current day's origin using both cutovers; preserve the existing dated next-start clamp for current runs. Read nothing beyond `9999-12-31`. Keep the public request limit at 42 output dates.
- [ ] Add cases against the exported reader: selected Summer week differs from Winter despite an overlapping repeating closure; two stations share one read; two sending departments remain separate; two zones union and split around closure; implicit default gets scheduled ranges while explicit `no_preparation` does not. Assert category ancestors, period-line overrides and staff-menu variants through real menu/routing fixtures. Retain the existing public default, inactive/foreign, special-day, season-transition, daily-closure/extension-ignore, 42-day and final-date assertions unchanged.
- [ ] Add exact boundary controls: `12:00–16:00` at −30 with the only zone closed `12:00–15:30` emits no range; a full-day 06:00–06:00 range remains full-day at zero offset; a −30 offset uses the authored end before a scheduled earlier next cutover clamps it. Assert predecessor positive grace respects the destination day's zone closure, including a destination with no current department opening. Preserve the existing next-start-clamp case.
- [ ] Extend the existing SQL-spy test: over 42 dates and then multiple requested stations, each source batch (`department_days` season read, `zone_days` season read, active periods, product facts and routing snapshot) remains one, independent of station count. Dated plans are read once when absent; provided plans only read missing predecessor facts once. For the season case, assert selected-season and weekday predicates and no special-day query. Restore spies in `finally`.
- [ ] Run `pnpm --filter @waitron/venue-service exec vitest run --project=node src/station-service-times.test.ts src/routes.test.ts src/station-delete-settings.test.ts --reporter=dot`; require nonzero Tests and zero failures. Commit only this task's files with `git commit -s -m "feat: share planned station order ranges for staffing"`.

## Task 2: return named department and station guides

**Files:** staffing contract, reads, server tests and both fixture factories in the map.

**Interfaces:** Extend `StaffingGuideRange` with required `periodId: string`, `periodName: string`, `periodColour: CalendarColour`, `departmentId: string`, `departmentName: string`; retain `startsAt` and `endsAt` as `HH:MM`. Keep both nested `guides` record shapes and every write interface unchanged. Remove the obsolete prose saying stations have no guides.

- [ ] First add `A724 returns period identity and station sending hours` in `paint.test.ts` for real named periods: department guide equals `{periodId, periodName: "Lunch", periodColour: "blue", departmentId, departmentName: "Dining room", startsAt: "12:00", endsAt: "16:00"}`; station guide has the same identity but ends `15:30` for −30. Set up a zone, menu product and route explicitly; `test/seed.ts` creates none of these. Assert a second sending department is separate and an unused station stays empty.
- [ ] Run `pnpm --filter @waitron/staffing exec vitest run --project=node src/paint.test.ts -t A724 --reporter=verbose`. Expected red: missing metadata and empty station guide, not setup failure.
- [ ] Call Task 1's reader once per read, passing all active station ids. The season path passes the chosen season and current cutover. The special-day path passes its stored dates, clock and **existing own plan**. Reuse returned raw department ranges and period/department metadata for department guides, and returned forecast ranges for station guides. Map actual dates back to `dateId`; filter Closed/null-period ranges rather than fabricating a period. Do not reread schedules or period metadata in staffing.
- [ ] Preserve the old guide tests' time, ordering, inactive-area and closed-date assertions while adding metadata. The season-guide test currently inserts `periodId: null` into a season day (`paint.test.ts:253`); replace that artificial range with a real period, retaining its 19:00–23:30 and inactive-department controls. Empty-menu/no-zone fixtures still produce empty station guides.
- [ ] Extend the special-day cases: own paint plus season remainder; zone `open` paint lifting a season closure; fully closed date; unpainted area; no dates; another repeating special day on the stored date. Assert both raw department ends and station offset ends. Retain `blocks: null` versus `[]`, out-of-hours staffing, save/readback, rollback, location-scoping and area-deactivation assertions. Guides never hide or erase staffing, including on Closed-all-day dates.
- [ ] Update complete response assertions in `routes.test.ts` with one populated guide response for each read. Extend the existing query-count receipt to account explicitly for the one additional predecessor-plan batch, if needed: own special-day lookup once plus at most one missing-predecessor lookup, staffing read once, department and zone season batches once each. Replace its old duplicated-table inventory with exact `from` counts for these batches; do not drop the bounded-query assertion.
- [ ] Update both fixture factories with named department guides and two-department station guides on different columns, including overlaps and −30 endpoints. Update all populated grid/painter fixture literals and expected values inventoried above. Keep empty-map client fixtures and `guidesKeeper` identity assertions. Do not silently make the new metadata optional to avoid updating fixtures.
- [ ] Run `pnpm --filter @waitron/staffing exec vitest run --project=node src/paint.test.ts src/routes.test.ts --reporter=dot` and `pnpm --filter @waitron/staffing typecheck`. Commit with `git commit -s -m "feat: return named period guides for staffing areas"`.

## Task 3: draw bands and explain the two guide modes

**Files:** staffing dashboard files and existing browser tests in the map.

**Interfaces:** Add grid properties `guideKind: "department" | "station" = "department"` and `guideDepartmentIds: readonly string[] = []`. Both painters pass the selected area's kind and all department ids in their existing area-list order. Inside the grid, retain only ids present anywhere in the shown guide map, yielding stable lanes across all columns. Staff-block `laneLayout` stays independent. Add required `guideText: string` to `PaintRowOptions` and export `guideText(area: {area: AreaRef; name: string}): string` from `painter-parts.ts`; both painters use this helper.

- [ ] Add `A724 labels coloured periods in stable department lanes` before UI changes: visible period name and `13:00–16:00` at the band's top; station label additionally says `Dining room`; two departments occupy distinct equal-width lanes; a department absent on Tuesday retains its empty lane there when it sends on Monday. Assert adjacent periods stay separate and the 15:53 offset endpoint is positioned exactly, not snapped.
- [ ] Run `pnpm --filter @waitron/staffing exec vitest run --project=browser src/dashboard/staffing-grid.test.ts -t A724 --reporter=verbose`. Expected red: missing labels/colours and full-width overlapping guide rectangles. Check memory headroom first (`memory_pressure | rg free`, `ps -axo rss,command | sort -nr | head`); run no tests beside a background whole-workspace coverage run.
- [ ] Replace dashed primary-colour guides with solid, faint bands using existing `periodColourStyles` and `data-colour=${range.periodColour}`. Fade only the background pseudo-element (`var(--period-fill)` with the existing token-derived opacity); text uses full-strength `--wt-color-text`, token spacing/font and tabular time numerals. Use token border colour for fine boundaries. Labels wrap within their lane and clip within the band; keep full text available through the day's accessible description. Do not add focus stops or opaque text panels over staffing blocks.
- [ ] Keep `.guide` and its descendants `pointer-events: none`, behind the existing block/preview layers. Department bands fill the column; station bands divide it by the stable department lane list, not by the count of simultaneous intervals. Expose a per-day textual guide summary via `aria-describedby` (alongside existing column refusal ids); leave decorative rectangles `aria-hidden="true"`. A closed department column reads `Closed` and an empty station column `No orders` (EN/ES), without changing the day's staffing or its “Follows the season” state.
- [ ] Set exact copy in `strings.ts`:

  | Key | EN | ES |
  | --- | --- | --- |
  | `staffing.painter.week` | `{season}: standard week` | `{season}: semana estándar` |
  | `staffing.painter.guide_department` | `Shaded: {department}'s opening hours, by period` | `Sombreado: horario de apertura de {department}, por periodo` |
  | `staffing.painter.guide_station` | `Shaded: when {station} gets orders, one lane per department that sends it dishes` | `Sombreado: cuándo recibe pedidos {station}, un carril por cada departamento que le envía platos` |
  | `staffing.grid.closed` | `Closed` | `Cerrado` |
  | `staffing.grid.no_orders` | `No orders` | `Sin pedidos` |

  Render `guideText` in the paint row's trailing `.hint`; wrap it at phone width using local `painterStyles`. Reuse the helper in both painters. Read-only painters retain no paint controls and show the same explanation in a noninteractive `slot="row"` element. A724 point 4 changes the season title only; keep the special-day name as title and preserve Save's existing behavior.
- [ ] Extend both painter tests for title/explanation in EN and ES, switching department/station, guide map identity through paint edits, fresh reads, and read-only mode. Restore language after each locale case. Keep their existing exact PUT body assertions, only-changed-days behavior, quiet Save/undo, retained drafts, save refusal, post-save refresh and unsaved tests.
- [ ] Add real pointer and keyboard regression cases with bands present. Use hit testing at the guide label's coordinates, then pointer-down/move/up through the underlying day to paint 09:00–10:00 both inside and outside shading; assert the exact `staffing-change` blocks. Resize an existing shaded block through its edge. Use `userEvent` for block click/Enter, Escape/refocus, role/headcount changes and Delete; assert guide text creates no tab stop. There is no keyboard creation shortcut today: preserve the existing keyboard editing contract rather than inventing one. Retain the original guide test's faintness, inertness, timing and DOM-before-block assertions.
- [ ] Add token controls in `staffing-grid.test.ts`: change the host's blue palette token and assert the blue guide pseudo-element follows while its text remains full-strength; test a different-colour neighbor too. Extend existing grid/painter axe suites with all six period colours, overlapping department lanes, no orders, read-only and column error plus guide descriptions in **both themes**. Do not narrow axe rules or remove behavior assertions.
- [ ] Run `pnpm --filter @waitron/staffing exec vitest run --project=browser src/dashboard/staffing-grid.test.ts src/dashboard/staffing-grid.a11y.test.ts src/dashboard/staffing-season-painter.test.ts src/dashboard/staffing-season-painter.a11y.test.ts src/dashboard/staffing-season-painter.unsaved.test.ts src/dashboard/staffing-special-day-painter.test.ts src/dashboard/staffing-special-day-painter.a11y.test.ts src/dashboard/staffing-special-day-painter.unsaved.test.ts src/dashboard/client.test.ts --reporter=dot`.
- [ ] Complete **Chrome LOOK**, using the test project's Playwright Chromium, not the built-in browser. Extend the existing painter test harnesses to capture department and station modes in both season and special-day painters at every combination of **light/dark × 390/1280 × EN/ES** (32 states). Use `page.viewport(width,900)` and assert `window.innerWidth === width`; save under sibling `__screenshots__/look/a724-…png`. Include a long department name, two sending departments, neighboring periods, short band, empty day, midnight end and overlapping staffing blocks. View every image; inspect the 390px grid after horizontal scrolling too. Check the actual content width, pinned ruler, complete wrapped explanation/title, labels within lanes, blocks above shading, full-day height, Save visibility and no page-width overflow. Record image paths and observed issues/fixes in the runner's receipts; screenshots alone are not a LOOK result. Restore viewport/theme/language in teardown.
- [ ] After assertions and LOOK pass, commit with `git commit -s -m "feat: label staffing guide bands and sending departments"`.

## Task 4: retire the completed scope and qualify the branch

- [ ] Update only A724 points 1/2/4 in both backlog files. Leave a short open A724 point 3 entry with its existing approved day-box wording and the explicit dependency on **all of A720 landing**. Preserve other lanes' hunks. Update design-system's staffing Forms paragraph and conventions-data's prep-station planning paragraph for the new bands/shared forecast and signed offsets; retain the public default-station and date-only route descriptions. Do not rewrite historical A585 specs or solve A708/A710/A711.
- [ ] Run the focused commands above after any final change. Run `pnpm --filter @waitron/venue-service typecheck` and `pnpm --filter @waitron/staffing typecheck`. Check formatting on changed code files and `git diff --check`; use `pnpm exec prettier --file-info docs/superpowers/plans/2026-10-16-a724-staffing-guide-bands.md` to distinguish ignored docs from checked code. Verify `git diff --name-only` contains none of the prohibited paths and inspect the final hunks against refreshed lane diffs.
- [ ] Commit documentation with sign-off. Announce readiness for `finish-branch`; if the runner has already requested it, continue that authorised workflow. Use the normal pre-push gate once and wait for current-head CI coverage (`test-staffing`, venue-service shard merge and selected consumers). Do not add a whole-workspace local run or change coverage thresholds. Retain red/green logs and LOOK receipts; do not describe source reading as test evidence.

**Owner ambiguity:** None blocks this slice. The default availability/derived-demand distinction, direct season-week input, stable lane order, existing keyboard editing contract and unchanged staffing saves are settled above. Month navigation remains explicitly deferred. The existing A708 ruler decision remains open and is not resolved by this plan.
