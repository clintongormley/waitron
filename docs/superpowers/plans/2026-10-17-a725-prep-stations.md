# A725 Prep Stations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan inline, task by task. Native execution is authorised; no brainstorm or plan-approval gate. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver all seven A725 requirements: sidebar placement, two tabs, name ordering, unused default colours, row swatches, clearer editing, and the shared popup chooser.

**Architecture:** Keep station identity, routing and default-station behaviour; retire only stations' hand-set order. Reuse `wt-colour-chooser` and the twelve station tokens, share colour selection between browser and database writers, and move the Times tab's meaningful coverage to A722's Calendar surfaces before retiring it.

**Tech Stack:** TypeScript, Lit, shared `wt-*` controls, Drizzle/node:sqlite, Vitest real Chromium and `useVenueDb`.

**Spec:** [A725, all seven points](../../backlog/kitchen.md#a725-prep-stations-up-the-sidebar-no-times-tab-or-drag-handles-colours-that-differ-a-clearer-station-editor), [backlog summary](../../backlog.md), [mockup README](../../backlog/mockups/a718-a727-calendar-and-stations/README.md), `boards.html#b14` and `14-prep-stations.png` in that directory. Text overrides the drawing, including the later popup decision. A756/A773's later settings redesign is separate.

## Global Constraints

- Implement in registered `feat/a725-prep-stations`, inline at the runner's implementation effort. Read the TDD skill before writing any implementation or test code. This document records planned REDs, not tests already run by its author.
- Every feature/fix starts with a behavioural test and an observed failure for the intended reason; retain the command, exit status and assertion output, then implement minimally and observe GREEN with a nonzero Tests count. Missing imports, compilation failures and zero selected tests are not the behavioural RED.
- Follow root `CLAUDE.md` and relevant sections of `docs/developers/{workflow-guide,conventions-ui,conventions-data,testing-guide,design-system,writing-claims,ci-and-gates}.md`. Preserve real browser/database helpers, meaningful old assertions, save/leave/refusal contracts, passive reads and concurrent-edit protection.
- Never change protected fiscal writers/tests (`computeHuella`, allocation/hash-chain/alta, `registros_facturacion`, `registerSif`, `restoreFiscal`, golden huella or `inmutabilidad`), house rules, root-guard assertions, exclusions/thresholds or shipped migrations. Run required protected tests unchanged; an unexpected protected failure is a blocker, not permission to edit it.
- Every commit uses `git commit -s`; never bypass hooks. Coverage stays `98/98/98/95`; mutation floors stay unchanged. Focused local checks during work; normal hook and current-head CI provide the full gate, without a gratuitous workspace test run.
- A725 explicitly asks for matching Spanish wording and its queue records no open design questions. Implement and verify EN/ES copy; record changed wording in the test-check FYI. A668's separate wording-approval gate does not apply here.
- Planning alone leaves the queue/backlog OPEN. The publishing runner may add a plan link under the docs-only workflow; delete completed A725 entries only with implementation. This author changes only this plan and does not publish it.

## Review Focus

1. All twelve colours occupied, explicit duplicates, inactive/other-location stations, and concurrent creates: omitted colour uses the first available active-local colour, or deterministic red, without recolouring saved explicit choices (Task 2).
2. Live printer/default changes or a later edit while Save is in flight: preserve the submitted baseline, current draft, retryable refusals and leave question (Tasks 1/3).
3. Default station alphabetically last, historical station slots and destination choices: name order must never become a default-first or active-only filter where history is currently included (Tasks 3/4).
4. Popover Escape, long used-by names, Spanish at 390px and dark tokens: close only the chooser, keep the editor/draft and readable controls within the window (Tasks 1/5).
5. Removing a parent-table column with referencing rows and a configuration from the old format: no silent cascade loss or generic import failure; document the pre-live reset and reject the old format deliberately (Task 4).

## Execution boundaries and file map

Read these sources again at each task's starting SHA; line numbers below describe the authoring base `18cbe6f1212e311b7dfeb7d5e0e482cb2349a5a1`, not a permanent address.

| Area | Exact files and responsibility |
| --- | --- |
| Independent editor | `packages/venue-service/src/dashboard/station-editor.ts`, `strings.ts`; new `station-colour-choices.ts` for chooser options and `StationColourUser` |
| Shared palette choice | `packages/shared/src/station-colours.ts`, `index.ts`; new `packages/db/src/station-colour.ts`, exported by `packages/db/src/index.ts` |
| Production writers/import | `apps/server/src/kitchen.ts`, `management-api.ts`, `configuration-transfer.ts`; `packages/provisioning/src/venue-apply.ts`; `apps/server/scripts/demo-seed/seed-catalogue.ts`; `packages/db/src/configuration-transfer.ts` |
| Prep/Calendar browser | `packages/venue-service/src/dashboard/{prep-stations-screen,station-table,routing-client,index,station-show,calendar-show}.ts`; `station-colour-styles.ts` remains the token map; `apps/dashboard/src/navigation.ts`, `api/client.ts`; `apps/till/src/api/client.ts` |
| Other ordered readers | `apps/server/src/{kitchen-timing,station-outputs-down,device-api,table-signals}.ts`; `packages/venue-service/src/{kitchen-screens,station-times}.ts`; `packages/staffing/src/paint.ts` |
| Schema | `packages/db/src/schema/kitchen-stations.ts`; **new** generated `packages/db/drizzle/*_retire_station_order.sql`, matching generated snapshot/journal entries only |
| Retire after replacements | `packages/venue-service/src/dashboard/station-colour-picker.ts`, its `.test.ts`/`.a11y.test.ts`; `station-times-tab.ts`, its `.test.ts`/`.a11y.test.ts` |
| Implementation documentation | `docs/backlog.md`, `docs/backlog/kitchen.md`, `docs/developers/design-system.md`; audit other prose references found by the consumer search, dating pointers in historical specs/plans |

**Reservations:** Task 1 FIRST, without editing `prep-stations-screen.ts`. Lane A `feat/a722-3-show-stations`/PR #1834 changes that screen's sorting, `station-table.ts`, `station-times-tab.ts`, Calendar and strings, introducing `station-show.ts::activeStationsInOrder` (still displayOrder then name). Wait for A722's actual merge before Tasks 3–4 sorting/Times hunks; then rebase and install. Task 2 may proceed on independent hunks. If A722 still waits, checkpoint these independent tasks; the queue permits a separately documented remaining Times follow-up, never claim all A725 done early.

Lane G `feat/a773-1-unsent-list` currently changes `kitchen.ts`/`kitchen.test.ts` course fields (`heldUntilFired`) and adds core migrations 0167–0172. Those are observed branch-diff facts, not a reservation of every server hunk; inspect its **committed and dirty** diff before Task 2/4 and generation. Preserve its course order/retention work. Recheck Lane B's staffing-editor and Lane C's till opening/loading diffs before touching their consumers; wait for same-hunk changes, rebase disjoint keys/passages. Never edit another lane's worktree or queue.

## Assertion and consumer inventory — required before deletion

- [ ] Save an implementation ledger inventory of matcher locations and fixture-only edits from the base-to-tip diff; final PR **Changed test checks** lists every changed/retired assertion as `file:line`, old → new and A725 point. Add the required lane FYI with its pointer. Controversial or unrelated assertions remain blocked under the 2026-10-05 policy.
- [ ] Search the whole tree, including prose and fixtures: `rg -n 'reorderStations|kitchenStations\.displayOrder|station-colour-picker|station-times-tab|when_gets_orders|prep\.tab\.times' apps packages scripts docs`; then inspect **all** station-related `displayOrder`/`display_order`, `stations/order`, `isDefault` sorting, raw station SQL, `$inferSelect`, `Station`/`PrepStation`/`StationInput`, insert/import/export consumers. Courses, zones, menu periods and other domains retain their order fields.
- [ ] Initial inventory requiring deliberate expectation changes: `apps/server/src/kitchen.test.ts:95` station full rows/order/default-red and `management-api.test.ts:1093–1195` reorder contracts/default-red; station parts only of both suites. Replace reorder endpoint assertions with strict retirement/no-write assertions; keep other auth, rollback, default and course checks.
- [ ] Browser inventory: `station-table.test.ts` grip/default/name order and link checks; `prep-stations-screen.test.ts` Add order field, reorder pointer/keyboard/rollback, Times address/navigation/live cases; `.unsaved.test.ts` displayOrder draft cases; `routing-client.test.ts` reorder wire body; `index.test.ts` sidebar/search; `apps/dashboard/src/navigation.test.ts` Times children. Replace removed-control checks with strict absence/new workflow checks; preserve routing navigation, output readouts, notices and other unsaved fields. Use pushState/replaceState spies for changed address checks.
- [ ] Editor/picker inventory: `station-editor.test.ts` colour save/usedBy/self exclusion/refusal, timing hints and moved wording; `.save-state.test.ts`, `.unsaved.test.ts`, `.a11y.test.ts`. Old picker's four-column inline geometry is deliberately replaced by popup geometry; palette names/tokens, required/error semantics, selection, keyboard/focus, usage names, bounded width, EN/ES and themed accessibility move to Add/Edit integration or already-equivalent `packages/ui/src/components/wt-colour-chooser*.test.ts` assertions. Record the destination for each before deleting old suites.
- [ ] Ordered consumer suites: `apps/server/src/{table-signals,station-outputs-down,management-api}.test.ts`, new `kitchen-timing.test.ts` if needed; `packages/venue-service/src/{kitchen-screens,station-times,hours-station-model}.test.ts`; `packages/staffing/src/paint.test.ts`; till station-choice/queue/table-order fixtures and dashboard kitchen-screen fixtures. Existing quantity, timing, membership, active/history, permission and default-label assertions stay; only station sequence/order metadata changes.
- [ ] Schema/transfer/seed inventory: `packages/db/src/schema/kitchen-stations.test.ts:97` becomes a strict absence-of-column check retaining its other defaults; `packages/db/src/configuration-transfer.test.ts` missing colour refusal becomes allocation on absence with explicit-null/invalid refusal retained; `apps/server/src/configuration-{transfer,import}.test.ts` format and station rows; `packages/provisioning/src/venue-apply.test.ts`; `apps/server/scripts/demo-seed/{seed,seed-floor}.test.ts`. Inventory all additional typed fixtures found by typecheck; do not weaken assertions to make them compile.

### Task 1: Independent Edit station chooser and clear layout (A725.6–7)

**Files:** Editor/choices/strings above; `station-editor{,.save-state,.unsaved,.a11y}.test.ts`; new `station-colour-choices.test.ts` under the same dashboard directory. Keep the old picker until Add migrates in Task 3.

**Interfaces:** `station-colour-choices.ts` exports `StationColourUser = { id: string; name: string; colour: StationColour }` and `stationColourChoices(stations: readonly StationColourUser[], excludeId?: string): ColourChoice[]`. Build options in `STATION_COLOURS` order, `fill: STATION_COLOUR_TOKENS[colour].dot`, localized `prep.colour.*` labels and other stations' `usedBy` names. Evaluate localization at render time. Editor's `StationEditorSave`, `saved(): boolean`, station-save payload and generation guards stay unchanged.

- [ ] **RED:** Add real-browser `A725 editor uses the station popup` assertions: field starts closed with selected square/name; opening offers exactly twelve ordered values; blue used by Bar/Coffee but never the edited station; click teal then Save emits exactly `{ colour: "teal" }`. Escape with the popup open closes it and keeps the edited modal/draft. Add long names plus a colour refusal; assert retry remains possible. Observe failure at missing chooser/current inline UI, not at a selector dereference.
- [ ] **RED:** `A725 groups late minutes and uses plain wording`: at 390/1280 all three labelled inputs share one rendered row under **Late flags (minutes)**; one note **Leave a field blank to use the venue setting** follows. Empty inputs keep distinct inherited placeholders; invalid order still names the bad field and bottom correction message. Assert the exact switch/hint and three moved choices below, with both venue defaults. Current vertical/repeated hints and old copy must fail.
- [ ] Run `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/station-editor.test.ts -t A725`; retain both REDs. Add equivalent matching Spanish checks, preserving locale restoration.
- [ ] Implement a required `wt-colour-chooser name="colour"`, controlled `value`, the choices helper, existing error mapping and localized `usedByLabel` via `prep.colour_used_by`; consume `wt-change.detail.value`, stop propagation, validate with `isStationColour`, and respect the editor's current-generation guard. Keep editing during Save, matching the existing submitted/newer-draft contract.
- [ ] Group the three short shared inputs with a semantic fieldset/legend and one described note; use declared tokens, keep semantic names and 1..int4 whole-minute/order checks. Preserve accessible inheritance explanation and existing placeholder-contrast assertions at the group/field seam. Set switch **Also list the order's dishes from other stations**, hint **On this station's tickets and kitchen screen**; moved label **Print a slip when sent dishes move table**, options **Venue setting: Print** / **Venue setting: Don't print**, **Print**, **Don't print**; retain `null/true/false` wire values. Never use “As the venue”.
- [ ] GREEN: run the four complete editor suites plus new choices suite; verify unchanged Save/Keep/Discard, printer set equality/deletion/permissions, timing clearing to null, refusal placement/retry and edit-during-save assertions. Add closed/open chooser axe states in both themes. Sign off commit `feat: clarify the station editor and use the shared colour chooser`.

The popup test's decisive assertions use the mounted editor and its captured station-save events:
```ts
expect(editor.shadowRoot!.querySelector("wt-colour-chooser[name=colour]")).not.toBeNull();
expect(chooser.choices.map(({ value }) => value)).toEqual([...STATION_COLOURS]);
expect(chooser.choices.find(({ value }) => value === "blue")!.usedBy).toEqual(["Bar", "Coffee"]);
expect(saves.map((event) => event.detail)).toEqual([{ colour: "teal" }]);
```

### Task 2: Transactional unused colours through every creation path (A725.4)

**Files/tests:** Shared/database palette files above with `packages/shared/src/station-colours.test.ts` and new `packages/db/src/station-colour.test.ts`; writer files above and their inventory suites. No station-order removal in this task.

**Interfaces:** Shared `firstUnusedStationColour(used: Iterable<StationColour>): StationColour` returns the first unused `STATION_COLOURS` member, else `"red"`; export through shared barrel. Database `nextStationColour(tx: Transaction, locationId: string): Promise<StationColour>` reads active stations of that location and calls it; export through the existing enumerated public barrel, no new deep-import path. It opens no transaction; each writer selects and inserts sequentially inside its existing write transaction.

- [ ] **RED:** Existing server kitchen suite: create omitted-colour Kitchen then omitted-colour Bar in one transaction → red/orange; separate concurrent `withTransaction` creates → distinct first two colours; occupied red/blue → orange; all twelve used → red; explicit blue duplicate remains blue; inactive/other-location rows do not consume a choice. Assert persisted rows, not merely helper calls. Current repeated-red behaviour must fail.
- [ ] **RED:** Seed real provisioning Kitchen and assert red; exercise script/helper-style creation with omitted colour and an existing red row → orange. Import current-format station rows missing colour with explicit red/blue rows later in the bundle → orange/amber, preserving explicit rows and remapped station memberships. Explicit `null`, array, wrong type or unknown colour still yields `setup.request_invalid` for `kitchen_stations.colour` and no partial import. Keep timing/printer rollback checks. Add helper palette/fallback tests before exports/implementation.
- [ ] Run the new named cases in `@waitron/server` kitchen/configuration-transfer and `@waitron/db` configuration-transfer suites; capture intended assertion REDs. New helper imports may be introduced only after a reachable behavioural RED exists.
- [ ] Implement shared/db helpers; `createStation` always supplies explicit valid colour or `await nextStationColour(tx, cfg.locationId)`. Provisioning's direct Cocina insert uses the same database helper; explicit demo station colours stay as designed. Trace raw SQL/Drizzle inserts and make every production omission path use this helper without importing server code into provisioning/db. Test helpers may retain explicit fixture colours.
- [ ] Permit only absent imported colour in `validateCoreConfiguration`; normalize station rows inside `importConfigurationTables`' existing transaction before generic insert. Reserve **all explicit active-local bundle colours before allocating omitted ones**, then allocate in bundle order using shared selection and reserve each new choice. Do not default null or recolour explicit duplicates. Keep existing column-name, other import validators and permissions unchanged.
- [ ] GREEN: run complete affected shared/db palette and configuration suites, server `kitchen.test.ts`, `configuration-transfer.test.ts`, provisioning `venue-apply.test.ts`, and demo `scripts/demo-seed/seed.test.ts`. Confirm Kitchen, scripts and imports with actual stored colours; no claim based on the helper alone. Sign off commit `feat: allocate unused station colours across creation paths`.

For a fresh location, assert the created IDs' persisted colours in creation order, independently of alphabetical listing:
```ts
expect([kitchen.colour, bar.colour]).toEqual(["red", "orange"]);
expect(importedMissing.map(({ colour }) => colour)).toEqual(["orange", "amber"]);
expect(fullPaletteFallback.colour).toBe("red");
```

### Task 3: Name-sorted UI, row squares and two Prep tabs (A725.1–3,5,7)

**Dependency:** A722/PR #1834 is on main; rebase/install and inspect its final helper/Calendar tests before editing. If it has changed names, record the mapping in the ledger instead of implementing a parallel Calendar.

**Files/tests:** Browser file-map paths; `prep-stations-screen{,.unsaved,.a11y}.test.ts`, `station-table{,.a11y}.test.ts`, `routing-client.test.ts`, `index.test.ts`, A722 `station-show.test.ts`, `opening-hours-screen{,.week}.test.ts`, `opening-hours-{month,week}{,.a11y}.test.ts`; `apps/dashboard/src/navigation.test.ts`. Retire picker/Times files only after coverage mapping.

**Interfaces:** Keep A722 `activeStationsInOrder<S extends { active: boolean; name: string }>(stations: readonly S[]): S[]`, remove its displayOrder dependency and sort by the existing name comparison. Preserve object identity/data and active filtering. `PrepStation`/`StationInput`, dashboard/till `Station` types and dashboard create/update inputs lose only station `displayOrder`; `PrepStationsApi.reorderStations` disappears.

- [ ] **RED:** With legacy order opposed to names, default Zulu plus Alpha/Bar and an inactive station render Alpha, Bar, Zulu, retain Default, and offer no grips/order controls. Assert square computed colour for every row using the station dot token; menu remains in `actions`, pinned end, with original outputs/status text. Assert Calendar Show and station-choice UI offer the same alphabetical active order, without moving the default first.
- [ ] **RED:** Assert operations sidebar Departments and zones immediately followed by Prep stations then Calendar; only Stations/Routes tabs and search destinations; no “When it gets orders” anchors. Opening retired `/manage/prep-stations/view/times/station/bar` canonically replaces the address with `/manage/prep-stations/view/stations`, no station child/new history entry, while valid Routes navigation and dirty-draft Keep/Discard remain intact. Current tab/link/order must fail before implementation.
- [ ] **RED:** Add station uses the shared chooser, twelve station tokens/usage labels and `firstUnusedStationColour`; chosen colour survives refusal and Save, and picking it back quiets Save. No displayOrder field/request key. Preserve name/timing/printer validation and required semantics. Run the selected A725 cases in venue-service before changing product code.
- [ ] Implement the helper/UI contracts; use contribution order **12** for Prep between existing Departments **10** and Calendar **15**. Remove station reorder state/controller/drag/keyboard plumbing and order input/checks only; keep any routing use of shared machinery. Add `part="station-colour"`/`data-station-colour` to the square and style through `wt-data-table::part(...)`, not screen classes reaching into the table. Reuse `stationColourStyles` and dot tokens.
- [ ] Move Add to `stationColourChoices`/`wt-colour-chooser`, including busy/error/current-opening guards; update the first-unused call. Preserve edit/Add scopes, live-snapshot replacement checks, action/load error ownership, submitted baselines and close-before-refresh behaviour. Remove obsolete picker imports/type declarations after all consumers move.
- [ ] Remove Times rendering/state/API binding from Prep and its contribution, station links, retired navigation child and only unreferenced strings/dependencies. Migrate meaningful Times assertions to Calendar Month/Week/shared `station-show` tests: one/multiple departments, overlapping/equal ranges, empty tracks/No orders, stepping whole weeks, pending/mismatched dates, station switch, always-open default, no active stations, read failure/recovery and reconnect. Preserve themed EN/ES axe states and Calendar read-only permissions. Then delete Times/picker source and suites; no lost assertion without an equal new check.
- [ ] GREEN: run complete changed browser suites (not only `-t A725`) and relevant till station-choice/dashboard navigation suites. Use real pointer/keyboard events and await native dialog close events. Record intentional assertion replacements, then sign off commit `feat: simplify prep station navigation and list stations by name`.

### Task 4: Retire backend station order, schema column and old export shape (A725.3)

**Files/tests:** Schema, backend ordered readers and client contracts from file map; inventory backend/seed/transfer/fixture suites. New `apps/server/src/station-order-migration.test.ts` for a populated migration exercise; new `kitchen-timing.test.ts` only if its refusal-sequence case has no existing home. `packages/db/src/schema/schema-conformance.test.ts` and root guards run unchanged.

**Interfaces:** `Station`, `createStation(tx,cfg,input)`, `updateStation(tx,cfg,id,patch)` keep current signatures minus station displayOrder. `listStations(tx,cfg): Promise<Station[]>` and SQL station readers order by name then id; `table-signals` sorts ready stations by name with id tie-break, retaining counts/bands. Remove `reorderStations` and `PUT /management-api/stations/order`; station POST/PATCH explicitly refuse a supplied retired displayOrder as `management.request_invalid` with `field: "displayOrder"`. Keep `parseDisplayOrder` and ordering for courses/zones.

- [ ] **RED:** Add `A725 backend station lists use names`: seed Zulu(default)/Bar/Alpha with reversed legacy orders in the predecessor-to-candidate migration fixture; read the candidate through list/till-ready/dark-screen/destination/device/staffing interfaces and assert exact alphabetical sequences. Keep a fresh-schema reverse-creation-order case too. Final-schema fixtures must not attempt writes to the deleted column. For timing defaults invalidating two overrides, assert the alphabetically first station refusal. Preserve history/closed/inactive inclusion, default semantics, quantities and all zone/course sequences. Run each owning suite with `-t A725`; current code must produce assertion failures.
- [ ] **RED:** Management API removed-order route returns 404 with a complete station-row before/after equality check; POST/PATCH with displayOrder refuses exact domain code without writes, while legitimate create/rename/default/printer/timing operations work. Assert `pragma_table_info('kitchen_stations')` lacks display_order and all other schema defaults/index/FK assertions remain. Run these checks before removal.
- [ ] Implement backend name sorting in **every** consumer inventory path, removing station order projections and request fields. `stationDestinations` loses its default-first prefix; `kitchen-screens` keeps historical removals in name order; staffing keeps departments first and its existing department order. Also give the printer-down list an explicit station-name/id then printer-name/id order, testing it beside dark-screen ordering. Update demo/provision inserts, till/dashboard wire fixtures and inferred schema fixtures; retain Lane G's course additions unchanged.
- [ ] Before generation, enumerate incoming keys using `pragma_foreign_key_list` for **every table in a real fully composed database**, recording child columns/delete actions and triggers reading kitchen_stations. Source inventory: `ticket_items.station_id`; `ticket_item_moves.from_station_id/to_station_id`; `kitchen_print_jobs.station_id`; `device_made_here_stations.station_id`; `order_draft_lines.make_at_station_id`; `working_order_lines.make_at_station_id`; `kitchen_station_timing.station_id`; `station_printers.station_id`; venue-service `kitchen_notices`, `routing_cells`, `routing_cell_periods`, both station_day_states keys, `device_profile_kitchen_screen_stations`, `device_kitchen_screen_stations`, `device_kitchen_screen_removals`; staffing `staffing_days`/`shift_assignments` (cascade). Recheck actual Lane G additions. Do not infer safety from migrating an empty database.
- [ ] Remove only `displayOrder` from `kitchen-stations.ts`. Run `pnpm --filter @waitron/db db:generate --name retire_station_order` after inspecting current main/G numbers. Inspect generated SQL: prefer native `ALTER TABLE kitchen_stations DROP COLUMN display_order`; if the generator emits a parent rebuild, replace **only the new unshipped migration's SQL** with the native drop and verify it on the product engine with populated referencing rows. Preserve generated schema metadata; never hand-edit snapshots/journal, shipped files, turn off FK enforcement or ship cascading data loss. A native drop refusal requires investigation/checkpoint, not a guessed migration workaround.
- [ ] Migration test uses `useVenueDb` with predecessor core plus current module sets, writes representative referencing rows, applies the new migration through the real migrator, compares every child's rows and runs `foreign_key_check`; include both staffing cascade and non-cascade children. Confirm column absence and constraints. Reproduce failure before implementing migration SQL. This is a safety experiment, not a promise of supported old-venue upgrade.
- [ ] **RED → GREEN transfer:** Change export/configuration bundle `version` **3 → 4** in `apps/server/src/configuration-transfer.ts` (build, literal type and validator) and inventory fixtures together. Tests assert version-3 files with/without display_order get `setup.configuration_outdated` before staged files or venue rows change; version 4 round-trips colours, printers, timings, default and remapped references with no display_order. No compatibility conversion. Keep version/future-format refusal assertions equally strict.
- [ ] **Release evidence:** Decide whether a venue reset is needed from the populated migration and upgrade-walk results, and state that measured result in the PR first line with its command/receipt. Do not claim a reset is necessary before running those experiments or add an unapproved root-guard reset exception. Configuration exports use bundle `version: 4`; older exports must be exported again from a compatible source. Never edit shipped migrations. If another lane lands a bundle-version change first, use its current version plus one and inventory that remapping explicitly.
- [ ] GREEN: run owning complete focused suites plus `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts scripts/journal-monotonic.test.ts`; protected `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts src/write-path.e2e.test.ts` unchanged. On migration-number collision, reset **own unlanded** generated migration state to main, regenerate from kept schema and rerun these checks; never renumber metadata by hand. Sign off commit `feat: retire stored preparation station order`.

Pin the new schema and list contract with strict assertions, retaining every other field in existing full-row comparisons:
```ts
expect(columns.map(({ name }) => name)).not.toContain("display_order");
expect(stations.map(({ name }) => name)).toEqual(["Alpha", "Bar", "Zulu"]);
expect(stations.every((station) => !Object.hasOwn(station, "displayOrder"))).toBe(true);
expect(foreignKeyCheckRows).toEqual([]);
```

### Task 5: Close documentation, LOOK, review, CI and authorised landing

**Files:** Implementation documentation paths only, plus scoped fixes proven by new REDs. No amendments to house rules/root guards/fiscal tests to obtain green.

- [ ] Audit changed prose across the full base-to-tip path set. Update the design-system Times description to Calendar Show and current station/name/chooser behaviour, leaving dated pointers in historical documents. Delete the obsolete backlog browser-current-month note; replace the supervisor-Times question with who may open Calendar's station view unless A722 already settled it, preserving its actual permission policy. Remove the stale reorder-filter cleanup note. Delete A725's summary/detail only when all seven points are delivered; otherwise keep precise remaining points and the plan link OPEN.
- [ ] Run all complete focused suites touched above, including configuration transfer, provisioning/demo and cross-package reader tests. Use a bounded deadline/retained log, check browser memory headroom, avoid overlapping package coverage folders, stop only recorded own process IDs. In an installed disposable candidate, delete the colour-allocation call and alphabetical comparator separately: named persisted-row/order tests must fail for the intended reason; restore and observe GREEN. Do not mutate protected fiscal paths for controls.
- [ ] Repeat the full consumer search and inspect every remaining match. Retired names may remain only in immutable migration history, dated historical prose, explicit refusal/absence tests and the plan; no live consumer of station order or either retired component remains. Typecheck affected consumers through the normal scoped gate; a fixture compile failure is not grounds to relax an assertion.
- [ ] Start only via `wa-wt demo waitron-feat-a725-prep-stations` (reset this instance if required). Open and **LOOK** at authenticated sidebar, Stations/Routes, Add/Edit closed/open chooser, used-colour/refusal/invalid states and Calendar Show in **EN/ES × light/dark × 390/1280**. Inspect each capture, measure inner viewport and computed dialog background/text with theme on document root, and record row alignment, swatches, one-row late flags, menu visibility, chooser containment/focus/Escape and long-name wrapping. Include axe states; screenshots alone are not assertions.
- [ ] Final changed-assertion/fixture inventory goes in PR **Changed test checks** and lane FYI; record the matching Spanish strings and their captures, without adding an owner gate or reopening the approved A725 design. Announce ready for `finish-branch`, then run the already-authorised skill: initial rebase, own dependency-installed temporary candidate, **one Claude whole-branch run-it review** through `claude-seat.sh review-run`, completed findings read and triaged, scoped fixes/re-read. Retain review approval across routine later rebases; no repeated whole-review cycle merely for BEHIND.
- [ ] Push through the normal hook. Wait for all required **current-head** CI coverage/merge/licence checks and inspect selected affected consumers, including db/shared/provisioning/staffing/venue-service/server/dashboard/till. Do not equate skipped jobs with evidence. No duplicate full local workspace run solely to finish this Waitron branch. A red required check gets a reproduced fix and fresh current-head results.
- [ ] Lane F's existing queue authorises land after all required checks and review findings are resolved. Acquire H11 `~/waitron-campaign-shared/main.lock` by atomic mkdir; retry every 30 seconds up to ten minutes, checkpoint if unavailable; remove only an empty stale lock over 30 minutes and reacquire. Hold **your acquired** lock around the entire `land-branch` operation from `~/workspace/repos/waitron`, main update, `pnpm install`, own registered worktree/local+remote branch cleanup and remote-deletion verification. Release only your lock; no new owner gate is added here.
- [ ] H12: confirm a main CI run for the **exact merge SHA**, record run ID/result, and read it next firing if pending. Missing/cancelled/red is reported precisely, never called green. Only then reconcile completion receipts/queue/backlog and remove remaining own temporary resources. Plan-only publication never performs this product completion sequence.


## Delivery verification — 2026-10-17

Tasks 1–4 are implemented. The permanent A725 decisions now live under
[Kitchen decisions](../../backlog/kitchen.md#a725-prep-stations-up-the-sidebar-no-times-tab-or-drag-handles-colours-that-differ-a-clearer-station-editor).
The native core0167 column drop retained the populated fully composed predecessor's recorded
values except station order; the schema/upgrade guard group passed 414 cases and the unedited
protected fiscal group passed 20. Configuration exports use version 4 and version-3 staging is
refused with and without the old column. The native execution ledger and campaign receipts retain
RED/GREEN commands, assertion changes and independent installed controls. Final authenticated-app
LOOK, whole-branch review, hook/current-head CI and authorised landing complete Task 5.


### Review ruling — 2026-10-17

The completed Claude run-it review found raw database character order differed from browser
alphabetical order. Within A725's name-order requirement, the driver chose one explicit Spanish
comparison for every station surface, independent of interface language. This is an implementation
choice, not a new owner decision. Literal accent/lowercase/ñ tests failed before the fix; the shared
comparison now covers readers, Calendar, device choices, staffing, alerts and shared kitchen paper.
All fifteen installed sort/locale omission controls failed their intended assertions; restored
candidate checks passed and all 6666 compared source paths matched. The redundant retired-field
Omit was removed. The same whole-branch review is retained; no second review was run.

Authenticated native checks and capture inspection cover EN/ES × light/dark × 390/1280 for
Stations/Routes, Add/Edit and colour popups, used colours, long names, refusals, invalid fields,
Calendar choices and Unicode ordering. Final hook/current-head CI and landing remain pending.


### Owner palette update — 2026-10-17 15:10

The owner's campaign answer supersedes the twelve-colour list: stations use the same shared palette
as periods, staff roles and seasons. A725 adopts the existing shared thirteen; Lane B's A783 expands
the shared list to sixteen and owns the four-column chooser layout. The palette constant moves to
shared with the existing hours-types export retained. Station validation, allocation, choices and
additional swatches follow the list; no station count is fixed. The station column has no colour
CHECK, so this update adds no migration. Existing station tints remain; new shared colours use the
period's dot and a tint over the surface. Grey/Gris allocation, import, rendering and saving have
observed REDs before implementation. Earlier twelve-colour receipts describe the earlier tree.
