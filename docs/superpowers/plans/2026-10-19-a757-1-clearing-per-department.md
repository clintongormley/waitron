# A757 slice 1 — Needs clearing per department: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Review path: FULL** (a migration, and a change to a cross-package contract: the venue-service seat in
`packages/module/src/module.ts`). **One pull request for the whole slice.** Branch
`feat/a757-1-clearing-per-department`, worktree
`/Users/clintongormley/workspace/worktrees/waitron-feat-a757-1-clearing-per-department`, from `main`
at `203561a74`. Implementers are dispatched as `subagent_type: "implementer"`.

**Goal:** the "Needs clearing" switch moves from one venue-wide value to each department, set in the
department dialog's Service tab; when a party leaves, each of its tables follows its own department.

**Architecture:** a `needs_clearing` flag on venue-service's `departments` table replaces
`service_settings.clearing_workflow`. The contract seat `readClearingWorkflow(tx)` becomes
`readTablesNeedingClearing(tx, tableIds)`, which answers for all the leaving tables in one query
(table → its zone → the zone's department). The department dialog saves the flag through the
existing department save (`PUT …/departments/:departmentId/settings`). The venue switch, its route
and the Venue settings › Tables tab's clearing panel go.

**Tech stack:** TypeScript, Drizzle on `node:sqlite`, drizzle-kit 0.31.11, Hono routes, Lit
dashboard components, Vitest (browser mode for the dashboard).

**Spec:** `docs/superpowers/specs/2026-10-17-a757-table-states-design.md` §1.1, §3, §3.1 and §11
item 1.

## Global constraints

- Not live, so the venue value is **dropped, not copied** (CLAUDE.md §3, "No backwards-compatibility
  or data-migration code until Waitron is in production").
- A table whose zone has no `zone_service_policies` row reads **off** (spec §3.1 "expected: off").
- The department set is resolved **once for all the leaving tables**, never a query per table.
- A department reads off until switched on: `flag("needs_clearing").notNull().default(false)`.
- Product text, quoted from the approved picture, not paraphrased (owner: concise product text,
  quote approved mock-ups): A757 picture 10 (`docs/backlog/mockups/a757-table-states/10-service-steps.png`)
  draws the Service tab's section `Table states`, the switch `Needs clearing`, and under it
  `A table stays “Needs clearing” after the party leaves, until marked cleared.` So:
  EN section `Table states`, switch `Needs clearing`, hint
  `A table stays “Needs clearing” after the party leaves, until marked cleared.`
  ES section `Estados de la mesa`, switch `Por recoger`, hint
  `Una mesa queda «Por recoger» cuando el grupo se va, hasta que se marca como recogida.`
  ("Por recoger" and "recogida" are the till's own words, `apps/till/src/i18n/strings.ts:2442-2443`;
  “…” in English and «…» in Spanish as the till's strings quote, `apps/till/src/i18n/strings.ts:1181,2730`.)
  **Why picture 10 and not A756's mock-up 03.** Mock-up 03
  (`docs/backlog/mockups/a756-kitchen-settings/03-department-service-tab.png`, committed 2026-10-16
  with the owner's A756 queue) draws a `Tables` section with the switch "A table needs clearing after
  a party leaves", and says under it "Other optional table states arrive here once the table
  lifecycle review settles them" — it hands the section to A757. Picture 10 was drawn for A757's
  revision on 2026-10-17 (commit 0ae96792a), and the owner agreed that revised design with Q29–Q34
  all A at about 15:50 the same day (`~/waitron-campaign-shared/watcher-handoff.md`, "OWNER A757
  Q29–Q34 all A", "design agreed"); A757 §3.1 and §8 also name the section "Table states". Picture
  10 is the later, owner-agreed picture, so its words are used as drawn.
- Coverage bars 98/98/98/95 hold in every package touched.
- **Changing an existing test assertion is a stop** unless this slice's spec changes what it checks.
  Every assertion this plan changes is listed in its task under "Assertions changed"; anything else
  that turns red is a stop and a report, not an edit. Setup changes are fine and are listed too.
- Every commit `git commit -s`. Do not touch lane G's branch `feat/a773-1-unsent-list` or its worktree.
- Every task ends with: the task's focused tests, `pnpm --filter <pkg> typecheck` for each package
  it touched, and `pnpm exec prettier --check <changed files>`. An implementer past about 150 tool
  calls with the task unfinished stops at a passing or cleanly red point, commits, and hands over.

## Decisions (with receipts)

1. **Home: a column on `departments`** (`packages/venue-service/src/schema/service.ts:25-48`), not on
   `department_sale_policies`, which the A756 plan suggested ("`department_sale_policies` is the
   natural home", `docs/superpowers/plans/2026-10-18-a756-kitchen-tab-split.md:627`). Why: Needs
   clearing is a table state, not a sale rule; and the model reads `department_sale_policies` with a
   bare `select()` and sends each row as it is (`listSalePolicies`,
   `packages/venue-service/src/operations.ts:661-670`), so a column there would appear in every
   `salePolicies.departments` row of the model and in every dashboard fixture typed
   `DepartmentSalePolicy` (`packages/venue-service/src/dashboard/client.ts:25-34`), while
   `listDepartments` names its columns (`operations.ts:71-78`) and the `departments` column reaches
   only the code this plan writes. (Corrected in plan review: every department does get a sale-policy
   row — `createDepartment` inserts one, `operations.ts:205-207`, as provisioning does,
   `provisioning.ts:70` — so the row's existence is not a reason; a zone's `effective` value is built
   field by field, `operations.ts:682-687`, so it would not spread there either.)
   **What A756 PR 4 does instead:** its reminder minutes go on `departments` beside `needs_clearing`
   as one ADD COLUMN with **no CHECK** — a CHECK on `departments` makes drizzle rebuild it, and
   foreign keys in venue-service's and staffing's schemas point at `departments.id`
   (`git grep -n "foreignColumns: \[departments\.id\]" -- packages`; CLAUDE.md §3 rebuild trap) — range-checked at
   the route as `requireReleaseReminderMinutes` does today; or PR 4's plan says why another table.
   Task 6 Step 6b writes this into the A756 plan's PR 4 note.
2. **One generation, no table rebuild.** Measured 2026-10-19 in this worktree (then reverted): with
   the column added to `departments` and `clearingWorkflow` removed from `serviceSettings`,
   `packages/venue-service/node_modules/.bin/drizzle-kit generate --name probe` wrote `0061_probe.sql`
   holding exactly
   ``ALTER TABLE `departments` ADD `needs_clearing` integer DEFAULT false NOT NULL;`` and
   ``ALTER TABLE `service_settings` DROP COLUMN `clearing_workflow`;`` — no `__new_` table, so no
   rebuild, no cascading delete and no expression-index rewrite. With that file in place
   `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts`
   printed `Test Files 7 passed (7)`, `Tests 407 passed (407)`;
   `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad` `2 passed`; and
   `pnpm --filter @waitron/venue-service exec vitest run src/schema/schema-conformance.test.ts`
   `68 passed`. So `scripts/migration-upgrade.test.ts` needed no new `CANDIDATES` value for the
   boolean column. Nothing else names `clearing_workflow` in SQL: `git grep clearing_workflow -- '*.sql'`
   finds only `0002_clearing_workflow.sql` and `0006_kitchen_ticket_grouping_check.sql`.
   Task 1 generates the ADD alone; Task 3 regenerates the two statements as one migration (see Task 3).
   **Re-run in plan review, 2026-10-19,** in a scratch copy (`cp -c -R` of this worktree, its `.git`
   pointer removed, deleted after): the same generate wrote the same two statements; the seven root
   guards printed `Tests 407 passed (407)` and venue-service's schema conformance `68 passed`.
   **Why the DROP COLUMN survives the change feed:** `service_settings` is a change-feed source
   (`VENUE_SERVICE_CHANGE_SOURCES` maps every classified table, `packages/venue-service/src/classification.ts:54-55`),
   and the feed's update trigger names every column (`packages/db/src/change-feed.ts:116-129`).
   Control, Node v26.11.1 `node:sqlite`: a table with such a trigger refused
   `alter table s drop column a` ("error in trigger t after drop column: no such column: new.a") and
   accepted it once the trigger was dropped. `scripts/migration-upgrade.test.ts` installs the feed
   before each step (`:272-285`), so its pass shows `applyMigrations` removed the feed before
   `clearing_workflow` was dropped. No migration SQL names `service_settings` or `departments` in a
   trigger (`git grep -n -i trigger -- 'packages/*/drizzle/*.sql'`).
3. **How a table maps to a department.** Every leaving table id is a `dining_tables.id` (callers:
   `parties.ts:730` via `memberTables`, `table-actions.ts:111` and `:288`,
   `floor-today-split-group.ts:116`). `dining_tables.zone_id` is `notNull`
   (`packages/db/src/schema/dining-tables.ts:21`); the zone's department is
   `zone_service_policies.department_id`, keyed by `zone_id` (`schema/service.ts:50-78`), and a zone
   may have no such row (readiness names that case: `zone.department_missing`, `client.ts:58`). A
   party across a today's merge has one `party_tables` row per member table, so each member resolves
   its own zone; a saved joined table is a dining table with its own `zone_id`. So: inner join
   `dining_tables` → `zone_service_policies` → `departments` with `needs_clearing = 1`; a table with no
   policy row drops out of the join and reads off. `departments.active` is **not** filtered: the table
   follows the department its zone names. Not tested, because deleting a department deactivates its
   zones in the same step (`service-delete.ts:342-345`).
4. **The seat:** `readClearingWorkflow(tx): Promise<boolean>` (`module.ts:1340-1341`) is replaced by
   `readTablesNeedingClearing(tx, tableIds): Promise<ReadonlySet<string>>`. Its only consumer is
   `leaveForClearing` (`apps/server/src/parties.ts:665`); its only implementation is venue-service's
   `VENUE_SERVICE` (`packages/venue-service/src/service.ts:127`, `:230`) — `git grep readClearingWorkflow`.
5. **The management API:** the existing department save carries the flag as an **optional**
   `needsClearing` boolean, as it already carries optional `transfers` (`routes.ts:829-869`); absent
   leaves the stored value, so route callers that do not send it are unaffected. The dashboard
   reads it from a new model field `needsClearingDepartmentIds: string[]` (the active departments
   with the switch on) rather than a field on each department, so each model fixture changes one line
   (`clearingWorkflow: false` → `needsClearingDepartmentIds: []`) instead of every department literal.
6. **The form:** the Service tab already runs on `draftScopeFor` and `saveActionState`
   (`department-settings.ts:314`, `:422`, `:476`); `needsClearing` joins the same draft, `equal`,
   `fieldTab` and refusal mapping, so Save stays quiet and disabled until the switch changes, and
   the existing `department-settings.unsaved.test.ts` gains the switch's case.
7. **The Tables tab's clearing panel goes; the tab stays** (slice 2 removes it with venue-made
   statuses). The panel is venue-service's `venue-service-tables` settings panel
   (`packages/venue-service/src/dashboard/index.ts:157-176`), which renders
   `dashboard-venue-service-settings subject="tables"`, whose `#tables` section holds only the switch
   (`service-settings-panel.ts:178-196`). With it gone the `subject` property has one value, so it goes
   too and the panel always draws its Kitchen section.
8. **Test setup:** one helper, `setNeedsClearingInEveryDepartment(tx, on)`, in a new file
   `apps/server/src/testing/needs-clearing.ts` (outside coverage: `apps/server/vitest.config.ts`
   excludes `src/testing/**`). It switches every department in the test database and throws when
   there is none. Every server test that switched the venue value uses venues whose tables all sit in
   departments that exist by then: `setupPartyVenue` gives its tables zone a department
   (`testing/zone-offers.ts:113-132`), `tableServiceZone` copies it (`testing/floor-today-venue.ts:53-69`),
   `createZone` reuses the first active one (`testing/service-zone.ts:5-18`), and
   `party-move-bill.test.ts:103-108` adds "Comedor", which "every department" also covers. Three
   cases switch before the department their table ends up in exists, and each moves its switch line
   below the table's creation (Task 2 Step 4). **Measured in plan review, 2026-10-19,** in a scratch
   copy of this worktree with a throwaway join in `leaveForClearing` and this helper: the fifteen
   files with only the two reorders first planned printed `Tests 2 failed | 624 passed (626)` —
   `booking-seat.test.ts` threw the helper's "no department yet", and `floor-catch-up.test.ts`'s
   "with clearing on, a table shows Needs clearing first and Needs moving once cleared" read
   `readyToMove: true` because its table's department is created inside `threeSeatedAcrossDinner()`,
   after the switch (a logged run: the switch saw one department, the leaving table's was another).
   With the third reorder: `Test Files 15 passed (15)`, `Tests 626 passed (626)`; and the same files
   filtered to `-t "[Cc]lear"`, so each clearing case runs without the cases before it, `Tests 51
   passed | 575 skipped`. `till-api.parties.test.ts`'s reorder is needed only in isolation: its
   "POST /api/tables/:id/cleared frees it with a 204…" run alone threw "no department yet". A helper keyed by table would
   need the tables first, which most call sites create after switching, so it would move more lines in
   files lane G's branch also edits.
9. **The configuration fixture `apps/server/src/testing/fixtures/configuration-v1-before-printing-retirement.json`
   is left as it is.** It is a version-1 export that the import refuses as `setup.configuration_outdated`
   before reading any table (`apps/server/src/configuration-import.test.ts:96-198`;
   `configuration-transfer.ts:483-486` accepts only version 4). A bundle from before this change cannot
   reach the column check either: its `modules["venue-service"]` count differs and is refused as
   `module:venue-service` (`configuration-transfer.ts:600-603`). The new column travels with no code:
   `departments` is a declared transfer table (`packages/venue-service/src/configuration-transfer.ts:730`)
   and import accepts any column the target table has (`apps/server/src/configuration-transfer.ts:655-686`).
   Task 2 adds the case that shows it.
10. **No live-query change.** The department dialog's model watch is `QUERY_DEPENDENCIES.operations`
    (`venue-operations-loader.ts:64-69`), which already lists `departments` and `service_settings`
    (`live-queries.ts:144-157`), and the model's GET still reads `service_settings` for the other
    settings. No error code is added or retired.

## Review focus

1. **A party across two departments leaves:** each table follows its own department — test in Task 2.
2. **A table whose zone has no department:** it is left free even with every department on — tests
   in Tasks 1 and 2.
3. **Switching a department off after its tables were marked:** they stay marked until Mark cleared,
   and still refuse seating, as with the venue switch (`kitchen-notices.ts:340-345` wrote only the
   switch) — test in Task 2.
4. **Another dashboard changes the switch while the dialog is open:** a clean dialog shows the new
   value; a dirty one keeps the draft — test in Task 5.
5. **A refusal naming `needsClearing` while Details is showing:** Service is shown, marked, and the
   switch is focused — test in Task 5.

---

### Task 1: venue-service stores and serves each department's switch (additive)

**Files:**
- Modify: `packages/venue-service/src/schema/service.ts` (the `departments` table, after `active`)
- Create (generated): `packages/venue-service/drizzle/NNNN_department_needs_clearing.sql` plus its
  snapshot and journal entry, by `pnpm --filter @waitron/venue-service exec drizzle-kit generate --name department_needs_clearing` — never number or edit by hand
- Create: `packages/venue-service/src/table-clearing.ts`, `packages/venue-service/src/table-clearing.test.ts`
- Modify: `packages/venue-service/src/index.ts` (add `export * from "./table-clearing.js";`)
- Modify: `packages/module/src/module.ts:1340-1341` (add the new seat beside the old one)
- Modify: `packages/venue-service/src/service.ts` (import and list the new seat), `service.test.ts` (seat key list)
- Modify: `packages/venue-service/src/operations.ts:740-772` (`DepartmentEditInput`, `saveDepartmentEditSettings`)
- Modify: `packages/venue-service/src/routes.ts:707-732` (GET model field), `:829-869` (PUT body)
- Test: `packages/venue-service/src/routes.test.ts` (new cases in "whole service settings saves")

**Interfaces — produces:**
- schema: `needsClearing: flag("needs_clearing").notNull().default(false)` on `departments`
- `readTablesNeedingClearing(tx: Transaction, tableIds: readonly string[]): Promise<ReadonlySet<string>>`
  — of these dining tables, those whose zone's department has the switch on. Empty input returns an
  empty set without a query. One select: `dining_tables` inner join `zone_service_policies` on
  `zone_id` inner join `departments` on `department_id`, `where dining_tables.id in (…) and departments.needs_clearing`.
- `listNeedsClearingDepartmentIds(tx: Transaction, cfg: VenueScope): Promise<string[]>` — active
  departments of `cfg.locationId` with the switch on, ordered by id.
- module seat (beside `readClearingWorkflow` until Task 3):
  `readTablesNeedingClearing(tx: Transaction, tableIds: readonly string[]): Promise<ReadonlySet<string>>`,
  doc comment: "Which of these dining tables need clearing once their party leaves: those whose
  zone's department has Needs clearing on. A table whose zone has no department is not among them."
- GET `/management-api/venue-service` gains `needsClearingDepartmentIds: string[]`.
- PUT `/management-api/venue-service/departments/:departmentId/settings` accepts optional
  `needsClearing: boolean`; any other type → 400 `management.request_invalid` `{ field: "needsClearing" }`;
  absent → stored value unchanged. Server `DepartmentEditInput` gains `needsClearing?: boolean`.

- [ ] **Step 1: Write the failing tests.** `table-clearing.test.ts`, set up as `operations.test.ts` is
  (`useVenueDb` with core, catalogue and venue-service migrations, `seedTenant`, a `locations` row,
  `createDepartment`, `createServiceZone`, `diningTables` rows inserted directly). Cases:
  - `"reads a table in a department with Needs clearing on, and not one in a department with it off"`:
    departments A (on, set by `update departments set needs_clearing = 1`) and B (off), a zone and a
    table in each → `toEqual(new Set([tableA]))`.
  - `"leaves out a table whose zone has no department"`: a `floor_zones` row with no policy and a
    table in it, every department on → the set lacks it.
  - `"answers an empty list with an empty set"` → `size` 0.
  - `"leaves out an id that is no table"` → `randomUUID()` not in the set.
  - `listNeedsClearingDepartmentIds`: `"lists the active departments with Needs clearing on"` — A on,
    B off, C on but `active = 0` → `toEqual([A])`.
  In `routes.test.ts`, using `settingsFixture()` and `departmentSettings` (`:250-268`):
  - `"saves a department's Needs clearing switch and lists it in the model"` — PUT with
    `{ ...departmentSettings, needsClearing: true }` → 204; GET model
    `needsClearingDepartmentIds` `toEqual([fx.departmentId])`; PUT with `false` → `[]`.
  - `"leaves the switch as it was when the save does not name it"` — on, then PUT
    `departmentSettings` alone → still `[fx.departmentId]`.
  - `"refuses a switch that is not true or false, naming it, and writes nothing"` — for each of
    `"true"`, `1`, `null`, `[true]`: 400, `toEqual({ error: { code: "management.request_invalid", params: { field: "needsClearing" } } })`,
    and `rawSettingsSnapshot()` unchanged.
  - In `service.test.ts` add `"readTablesNeedingClearing"` to the sorted key list.
- [ ] **Step 2: Run them and watch them fail.**
  `pnpm --filter @waitron/venue-service exec vitest run src/table-clearing.test.ts src/routes.test.ts src/service.test.ts`
  Expected: FAIL (no `table-clearing.js`; model lacks `needsClearingDepartmentIds`; seat key missing).
- [ ] **Step 3: Add the column and generate the migration.** Run the generate command above; read the
  SQL: it must be the single `ALTER TABLE \`departments\` ADD \`needs_clearing\` …` line, no
  `__new_departments`. Anything else is a stop.
- [ ] **Step 4: Implement** `table-clearing.ts`, the seat, the PUT body field (add `"needsClearing"`
  to `onlyKeys`; a write in `saveDepartmentEditSettings` only when defined, after
  `updateDepartment` has checked the department), and the GET field.
- [ ] **Step 5: Run the tests again.** Same command. Expected: PASS.
- [ ] **Step 6: Guards.** `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts`,
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad`,
  `pnpm --filter @waitron/venue-service exec vitest run src/schema/schema-conformance.test.ts`. Read the
  `Tests` count of each; all pass. Then typecheck `@waitron/venue-service` and `@waitron/module`, prettier.
- [ ] **Step 7: Commit** — `git commit -s -m "A department stores its own Needs clearing switch (A757 slice 1)"`.

**Assertions changed:** `service.test.ts`'s key list gains one name (the spec adds the seat).

### Task 2: the server leaves each table as its own department says

**Files:**
- Modify: `apps/server/src/parties.ts:653-669` (`leaveForClearing` and its comment only — leave the
  closing brace and everything after it untouched; lane G's branch edits from line 672)
- Modify: `apps/server/src/table-actions.ts:73-74` (the comment only: "the tables left behind need
  clearing where the venue's setting says so" → "…where their department has Needs clearing on";
  lane G's hunks in this file start at its lines 58 and 117, not here)
- Create: `apps/server/src/testing/needs-clearing.ts`
- Create: `apps/server/src/leave-for-clearing.test.ts`
- Modify: `apps/server/src/configuration-transfer.test.ts` (one new case)
- Modify (setup only): `booking-seat`, `floor-catch-up`, `floor-today-flatten-api`,
  `floor-today-mark-moved`, `floor-today-split-group`, `floor-today-split`, `floor-today-state`,
  `parties`, `party-main-bill`, `party-move-bill`, `party-table-actions`, `table-signals`,
  `till-api.parties`, `till-api.today-joins`, `unpaid-departure` — each `apps/server/src/<name>.test.ts`

**Interfaces:**
- Consumes: `VENUE_SERVICE.readTablesNeedingClearing` (Task 1); `departments` from `@waitron/venue-service`.
- Produces: `setNeedsClearingInEveryDepartment(tx: Transaction, on: boolean): Promise<void>` —
  `update departments set needs_clearing = on`, returning ids; throws
  `new Error("setNeedsClearingInEveryDepartment: the database has no department yet")` when none.
- `leaveForClearing` body: `leaveTables`; `const clearing = await VENUE_SERVICE.readTablesNeedingClearing(tx, tableIds)`;
  the existing update sets `{ statusId: null }` for all `tableIds`; a second update sets
  `needsClearingSince: at` where `id in clearing`, skipped when `clearing` is empty. Comment:
  "…and each table whose department has Needs clearing on needs clearing from `at` until
  {@link markTableCleared}."

- [ ] **Step 1: Write the failing tests** in `leave-for-clearing.test.ts` (`useVenueDb` +
  `setupPartyVenue`, as `parties.test.ts` does). A second department and zone come from
  `createDepartment` + `createServiceZone`; a zone with no department is a `floorZones` row inserted
  directly, its table inserted as `tableAt` does (`testing/party-venue.ts:181-189`); departments are
  switched with direct `update departments` statements. Call `leaveForClearing` directly inside `inTx`:
  - `"leaves each table as its own department says when a party spans two"` — table in A (on) and in B
    (off), `leaveForClearing(tx, [a, b], at)` → `needsClearingSince` of a `=== at`, of b `null`; both `statusId` null.
  - `"leaves a table whose zone has no department free, even with every department on"` → `null`.
  - `"asks venue-service once for all the leaving tables"` — `vi.spyOn(VENUE_SERVICE, "readTablesNeedingClearing")`;
    one call, with `[a, b, c]`.
  - `"keeps a table marked after its department is switched off, until Mark cleared"` — with A on,
    `leaveForClearing(tx, [a], at)`; switch A off → `condition` still `needs_clearing` and `seatTable`
    refused `table.needs_clearing`; after `markTableCleared` → `free`. Not through `finishTable`:
    lane G's `feat/a773-1-unsent-list` adds a required `expectedEdits` to `finishTable` and routes
    tests through `apps/server/src/testing/party-close-fixture.ts`, so a new caller here would break
    whichever branch lands second.
  In `configuration-transfer.test.ts`, modelled on `"leaves a table's clearing state behind"`
  (`:2610-2646`) and the import case above it: `"carries a department's Needs clearing switch to the importing venue"`
  — source venue gets a department via `createDepartment`, switched on; build, import into a second
  venue; the imported department of the same name reads `needsClearing: true`.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/leave-for-clearing.test.ts src/configuration-transfer.test.ts -t "department|spans two|no department|once for all|switched off"`
  Expected: FAIL on the per-department cases (the transfer case may pass already; it pins Decision 9).
- [ ] **Step 3: Implement** `leaveForClearing` and the helper.
- [ ] **Step 4: Switch the setup of the fifteen test files.** In each, replace
  `import { writeClearingWorkflow } from "@waitron/venue-service";` with
  `import { setNeedsClearingInEveryDepartment } from "./testing/needs-clearing.js";` (in
  `table-signals.test.ts` keep `writeReleaseReminderMinutes` on the old import; in
  `floor-today-state.test.ts` drop the name from its multi-line import) and each
  `writeClearingWorkflow(` with `setNeedsClearingInEveryDepartment(`, arguments unchanged.
  `floor-catch-up.test.ts:1111` keeps its local `clearingWorkflow` name; only its body changes. Three
  reorders, because the table's department does not exist yet at the old call (measured, Decision 8):
  `booking-seat.test.ts:214` moves after the `createTable(...)` in the same transaction; in
  `till-api.parties.test.ts:712-722` (`finishedWithClearing`) the switch moves inside the `try`,
  after `await seat()`; in `floor-catch-up.test.ts:1153-1156` ("with clearing on, a table shows
  Needs clearing first and Needs moving once cleared") `await clearingWorkflow(true)` moves inside
  the `try`, after `const z = await threeSeatedAcrossDinner();`. Reword the claims that name the
  venue's switch: test names `parties.test.ts:558` → `"frees the tables at once when their department has Needs clearing off (P8)"`,
  `"frees the tables at once in a venue with no service settings row"` → `"frees the tables at once in a department that never switched Needs clearing on"`,
  `party-table-actions.test.ts:302` → `"leaves the tables behind free when their department has Needs clearing off"`,
  `unpaid-departure.test.ts:323` → `"leaves the table needing clearing when its department has Needs clearing on"`;
  comments `party-table-actions.test.ts:142`, `till-api.parties.test.ts:712`, `party-move-bill.test.ts:493`
  say "every department's Needs clearing" for "the venue's clearing setting".
- [ ] **Step 5: Run every touched file.**
  `pnpm --filter @waitron/server exec vitest run src/leave-for-clearing.test.ts src/configuration-transfer.test.ts src/booking-seat.test.ts src/floor-catch-up.test.ts src/floor-today-flatten-api.test.ts src/floor-today-mark-moved.test.ts src/floor-today-split-group.test.ts src/floor-today-split.test.ts src/floor-today-state.test.ts src/parties.test.ts src/party-main-bill.test.ts src/party-move-bill.test.ts src/party-table-actions.test.ts src/table-signals.test.ts src/till-api.parties.test.ts src/till-api.today-joins.test.ts src/unpaid-departure.test.ts`
  (check free memory first, `memory_pressure | grep free`). Expected: every file passes; read the count.
  `git grep -n writeClearingWorkflow -- apps` prints nothing.
- [ ] **Step 6:** typecheck `@waitron/server`, prettier, commit —
  `"Each table a party leaves follows its own department's Needs clearing switch (A757 slice 1)"`.

**Assertions changed:** none. Setup changed in the fifteen files above as listed (three reorders);
four test names and three test comments reworded, and one code comment in `table-actions.ts`.

### Task 3: the venue switch goes from the server and the data

**Files:**
- Modify: `packages/venue-service/src/schema/settings.ts:17-18` (drop the column and its comment)
- Regenerate: `packages/venue-service/drizzle/` (see Step 2)
- Modify: `packages/venue-service/src/kitchen-notices.ts:331-345` (delete `readClearingWorkflow`,
  `writeClearingWorkflow`), `service.ts:87,230`, `packages/module/src/module.ts:1340-1341` (delete
  the old seat), `routes.ts:38,44,728,745,806-817`
- Test: `packages/venue-service/src/kitchen-notices.test.ts`, `routes.test.ts`, `service.test.ts`

- [ ] **Step 1: Edit the tests first** (they describe the removal): delete `describe("the clearing-workflow setting")`
  (`kitchen-notices.test.ts:1329-1359`) and `describe("the clearing setting")` (`routes.test.ts:2439-2513`);
  remove the listed assertions below; remove `"readClearingWorkflow"` from the seat key list. Add to
  `routes.test.ts` `"no longer serves the venue-wide clearing switch"`: GET `/management-api/venue-service`
  and GET `/management-api/venue-service/settings` bodies `not.toHaveProperty("clearingWorkflow")`, and
  PUT `/management-api/venue-service/settings/clearing-workflow` answers 404.
- [ ] **Step 2: Drop the column and regenerate ONE migration for the slice.** Reset venue-service's
  migrations to the branch base and regenerate (CLAUDE.md §3: regenerate, never hand-edit
  `_journal.json` or snapshots):
  `git checkout $(git merge-base HEAD origin/main) -- packages/venue-service/drizzle && git clean -fd packages/venue-service/drizzle`,
  then the generate command from Task 1. The new file must hold exactly the two `ALTER TABLE`
  statements of Decision 2; anything else is a stop.
- [ ] **Step 3: Delete the old code** (functions, seat, route, the two GET fields, imports).
- [ ] **Step 4: Run.** `pnpm --filter @waitron/venue-service exec vitest run src/kitchen-notices.test.ts src/routes.test.ts src/service.test.ts src/table-clearing.test.ts`
  — PASS. Then the guard suites and schema-conformance of Task 1 Step 6, plus
  `pnpm exec vitest run scripts/module-seams.test.ts`. `git grep -n -E 'readClearingWorkflow|writeClearingWorkflow|clearing_workflow' -- packages apps ':!*/drizzle/*'`
  prints only the dashboard hits Tasks 4–5 remove and the JSON fixture of Decision 9.
- [ ] **Step 5:** typecheck `@waitron/venue-service`, `@waitron/module`, `@waitron/server`; prettier; commit —
  `"The venue-wide Needs clearing switch goes; one migration for slice 1 (A757)"`.

**Assertions changed** (all because the column and route are removed): `kitchen-notices.test.ts` —
the `clearingWorkflow` key leaves the five `serviceSettings` row `toEqual`s (`:1316`, `:1384`,
`:1428`, `:1466`, `:1499`) and the two `readClearingWorkflow(tx)` expectations at `:1371` and `:1413`
go; `routes.test.ts` — `clearingWorkflow: false` leaves the `toMatchObject` at `:2140`, and the
`clearingWorkflow` type line and expectation at `:2429` and `:2435` go; `service.test.ts` — one key leaves the list.

### Task 4: the Tables tab's clearing panel goes

**Files:**
- Modify: `packages/venue-service/src/dashboard/index.ts:157-176` (delete the `venue-service-tables`
  panel; drop `subject="kitchen"` at the kitchen panel)
- Modify: `packages/venue-service/src/dashboard/service-settings-panel.ts` (delete `subject`, `#tables`,
  the `"clearingWorkflow"` field name; `render` draws `#kitchen` alone)
- Modify: `packages/venue-service/src/dashboard/client.ts` (`VenueServiceSettingsView` loses
  `"clearingWorkflow"`; `loadSettings` loses its line; delete `saveClearingWorkflow`)
- Modify: `packages/venue-service/src/dashboard/strings.ts:516-518,1413-1415` (delete the two old keys)
- Test: `index.test.ts`, `service-settings-panel.test.ts`, `service-settings-panel.a11y.test.ts`,
  `service-settings-panel.exempt.test.ts`, `client.test.ts` (all in `packages/venue-service/src/dashboard/`),
  `apps/dashboard/src/dashboard-app.test.ts:1744-1780`

- [ ] **Step 1: Edit the tests.** Delete: `index.test.ts`'s `"renders the tables panel on the context's request and live data"`;
  `service-settings-panel.test.ts`'s `describe("the Needs clearing setting")` (`:808-892`) and the
  `tables` half of the two read-only cases at `:44-80`; the a11y case that sets `subject = "tables"`
  (`a11y.test.ts:171`); the `clearingWorkflow` choice in `exempt.test.ts:142-148`; the
  `saveClearingWorkflow` case `"stores whether tables need clearing after Finish table"` in `client.test.ts` (`:197`). Drop the `subject`
  parameter from the mount helpers and `clearingWorkflow` from the settings-view fixtures. Change the
  panel list in `index.test.ts:23-45` to the kitchen panel alone and rename it
  `"adds a kitchen panel for venue service managers"`. In `dashboard-app.test.ts:1744` rename to
  `"leaves Tables to its core statuses panel and puts venue service's kitchen panel after the core one"`
  and expect `panelsOn(el, "tables")` `toEqual(["dashboard-service-status-screen"])`.
- [ ] **Step 2: Run and watch the panel cases fail.**
  `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/index.test.ts src/dashboard/service-settings-panel.test.ts src/dashboard/service-settings-panel.a11y.test.ts src/dashboard/service-settings-panel.exempt.test.ts src/dashboard/client.test.ts`
  and `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test.ts -t "Tables"`.
- [ ] **Step 3: Remove the panel, the property and the client method.**
- [ ] **Step 4: Run both commands again** — PASS (check free memory first; these are browser runs).
- [ ] **Step 5:** typecheck `@waitron/venue-service` and `@waitron/dashboard`, prettier, commit —
  `"Venue settings' Tables tab no longer holds the Needs clearing switch (A757 slice 1)"`.

**Assertions changed** (the spec retires the panel): `index.test.ts`'s panel list; the deleted
cases listed in Step 1; `dashboard-app.test.ts`'s Tables panel list, and its supervisor read-only
case, which now expects one venue-service settings panel instead of two.

### Task 5: the department dialog's Service tab holds the switch

**Files:**
- Modify: `packages/venue-service/src/dashboard/client.ts` (`VenueServiceModel`: delete
  `clearingWorkflow`, add `needsClearingDepartmentIds: string[]`; `DepartmentSettingsInput` gains
  `needsClearing: boolean`)
- Modify: `packages/venue-service/src/dashboard/department-settings.ts` (`fieldTab` `needsClearing: "service"`;
  `equal`; `source` in `willUpdate` reads `this.model!.needsClearingDepartmentIds.includes(row.id)`;
  the refusal field list; a `<section aria-label=…><h3>…</h3>` after "Orders and payment" in the
  Service panel, holding `<wt-switch name="needsClearing" label=… .description=${hint} .checked=… ?disabled=…
  aria-invalid=${errors.needsClearing ? "true" : nothing}>`, a visible `<p class="hint">` and, when
  refused, `<p class="error" data-field-error="needsClearing">` under it as the receipt editor draws a
  switch's error (`apps/dashboard/src/screens/department-receipt-editor.ts:656-667`). The
  `aria-invalid` is what lets `showFirstInvalid` focus it: `wt-switch` has no `error` property and
  marks nothing itself (`packages/ui/src/components/wt-switch.ts:113-122`), and `focusFirstInvalid`
  focuses only an element carrying `aria-invalid="true"` (`packages/ui-core/src/interactive.ts:52-66`)
  — read, not run; the refusal case in Step 1 is the check.)
- Modify: `packages/venue-service/src/dashboard/strings.ts` — keys `venue.table_states`,
  `venue.needs_clearing`, `venue.needs_clearing_hint`, EN and ES as in Global constraints
- Modify (one line each, `clearingWorkflow: false` → `needsClearingDepartmentIds: []`): every model
  fixture still naming `clearingWorkflow` — `git grep -l clearingWorkflow -- packages/venue-service apps/dashboard`
  after Task 4 lists them (`testing/department-zones-fixture.ts`, `test/service-delete-test-helpers.ts`,
  `apps/dashboard/src/testing/department-receipt-app-fixture.ts`, `apps/dashboard/src/dashboard-app.test.ts`
  and the dashboard test files of the consumer map)
- Test: `department-settings.test.ts`, `department-settings.unsaved.test.ts`, and the exact-body files below

- [ ] **Step 1: Write the failing tests** in `department-settings.test.ts`:
  - `"shows Needs clearing under Table states on the Service tab, off for a department the model does not list"` —
    `h3` text `Table states`; `wt-switch[name=needsClearing]` label `Needs clearing`, unchecked; the
    hint's text as in Global constraints.
  - `"shows it on for a department the model lists"` — `needsClearingDepartmentIds: ["d1"]` → checked.
  - `"switching it on enables Save and saves it with the department"` — Save goes from disabled to
    `primary`; the write's body `toMatchObject({ needsClearing: true })`.
  - `"a refusal naming the switch, sent while Details shows, brings back Service and marks it"` —
    PUT answers 400 `management.request_invalid` `{ field: "needsClearing" }` → tab `service`,
    marked, error text under the switch, the switch focused (the switch's `shadowRoot.activeElement`
    is its `input[role=switch]`), and Save not disabled by the refusal alone.
  - `"follows a change another dashboard makes while the form is clean, and keeps a draft while it is not"` —
    model update listing d1 → checked; after a local toggle, a model update leaves the draft.
  - `"reads in Spanish"` — `Estados de la mesa`, `Por recoger`, the Spanish hint.
  In `department-settings.unsaved.test.ts`: `"toggling Needs clearing dirties the form, toggling it back cleans it, and leaving asks only while dirty"`.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/department-settings.test.ts src/dashboard/department-settings.unsaved.test.ts`
- [ ] **Step 3: Implement** the types, fixtures, component and strings.
- [ ] **Step 4: Run the whole venue-service dashboard and the dashboard app.**
  `pnpm --filter @waitron/venue-service exec vitest run src/dashboard` and
  `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test.ts`. The failures expected
  are exact-body assertions on a department save, which now carry the switch. In each, add only
  `needsClearing: false` (the fixture's value) to the expected body: `client.test.ts:437-460` (its
  input too), `department-settings.test.ts:236-248`, `department-settings.unsaved.test.ts` (the
  bodies near `:476`, `:535`, `:607`, `:692`), `department-edit-dialog.test.ts:45-55`,
  `service-edit-dialog.legacy.test.ts:378`, `venue-departments-policy.test.ts:47,142`,
  `venue-departments-shell.actions.test.ts:500-510`, `venue-departments-shell.unsaved.test.ts:254`.
  Any other red case is a stop.
- [ ] **Step 5:** typecheck `@waitron/venue-service` and `@waitron/dashboard`; prettier; commit —
  `"The department dialog's Service tab switches Needs clearing for its tables (A757 slice 1)"`.

**Assertions changed:** the exact-body expectations listed in Step 4 gain `needsClearing: false`
(the spec adds the switch to the department save); nothing else.

### Task 6: docs that described one venue switch

**Files:** `docs/superpowers/specs/2026-10-17-a757-table-states-design.md`, `docs/backlog.md`,
`docs/backlog/till.md`, `docs/developers/design-system.md:5013-5015`,
`docs/superpowers/specs/2026-10-16-a664-personal-data-audit.md:162,170`,
`docs/superpowers/plans/2026-10-18-a756-kitchen-tab-split.md` (PR 4's note, Step 6b)

- [ ] **Step 1: The spec.** Keep the status line; add under it a dated line:
  "**2026-10-19:** Q29–Q34 were all answered A by the owner on 2026-10-17, and the build depends only
  on A756's first pull request, #1852, which landed; slice 1 is built on `feat/a757-1-clearing-per-department`."
  Add to "Decided" a bullet list "The owner's answers (2026-10-17), second round" — Q29–Q34, each
  "A" with its option's one line from the Open questions section. Under "## Open questions
  (Q29–Q34)": "Answered 2026-10-17: all A." In §3.1 after "(expected: off)": "Settled 2026-10-19 by
  the slice 1 plan: off — such a table drops out of the join from table to department
  (`docs/superpowers/plans/2026-10-19-a757-1-clearing-per-department.md`, Decision 3)."
- [ ] **Step 2: `docs/backlog.md`'s A757 entry** (`:2095-2106`): replace "six new questions, Q29–Q34,
  are open.** The build waits for those answers (…)" with "Q29–Q34 answered A, A, A, A, A, A on
  2026-10-17.** Slice 1, Needs clearing per department, is on `feat/a757-1-clearing-per-department`;
  slices 2–8 are left (design §11)." Links unchanged.
- [ ] **Step 3: A new till-area entry** under "### The till, devices and table service". Take its
  id from `~/waitron-campaign-shared/next-item-number` (read it, use it, write back the next number).
  In `docs/backlog.md`, at most four lines: "**A<n>. Owner review of every table state and its look,
  after A757 lands (owner, 2026-10-18).** Show the owner each state on the map and the card, both
  themes, with the pulses and zone tabs, and settle the two suggestions in the detail. Waits for A757
  slices 3–5. [Detail](backlog/till.md#…)". In `docs/backlog/till.md`, a `##` section of the same title:
  what to show — every row of A757 §4 on the floor map and on the list card, light and dark, at 390
  and 1280 px; the two pulse speeds and their reduced-motion looks; the zone tabs and the toolbar
  edge; Nothing needed's calm look — and the owner's open suggestions quoted, with where each
  belongs: "Dashes should maybe be used for any table which is unoccupied" (owner, 2026-10-18,
  Q42 notes, to weigh in the A797 revision with a picture), and "It feels like we need a key of the
  different states when we click the ?" (owner, 2026-10-18, assigned to A582 slice 4).
- [ ] **Step 4: `docs/backlog/till.md`'s A757 section** (`:1292-1325`): replace "Nothing is built until
  Q29–Q34 are answered and A756 has landed." with "Q29–Q34 were answered on 2026-10-17; slice 1 is
  on `feat/a757-1-clearing-per-department`." Under "Today Venue settings' Tables tab … holds two
  things" add a dated line: "Since A757 slice 1 (2026-10-19), Needs clearing is switched per
  department, in the department dialog's Service tab under Table states; the Tables tab holds only the
  venue's own statuses, which slice 2 retires."
- [ ] **Step 5: `design-system.md:5013-5015`**: "today the one section is “Orders and payment”, with
  the service settings and the zones that differ" → "two sections: “Orders and payment”, with the
  service settings and the zones that differ, and “Table states”, with the Needs clearing switch".
- [ ] **Step 6: The A664 audit** is a dated reading of the `0055` snapshots and is not rewritten. Add
  dated pointers in the two cells: `departments` R gains "`needs_clearing` (added 2026-10-19, A757
  slice 1)"; `service_settings` R's `clearing_workflow` gains "(dropped 2026-10-19, A757 slice 1)".
- [ ] **Step 6b: The A756 plan's PR 4 note.** In `docs/superpowers/plans/2026-10-18-a756-kitchen-tab-split.md`
  → "Parts that wait" → PR 4, which says the reminder minutes go "on the same venue-service table
  A757 slice 1 gives the clearing switch (coordinate; `department_sale_policies` is the natural
  home)", add one dated line after that paragraph: "**2026-10-19 (A757 slice 1):** the clearing
  switch went on `departments` (`needs_clearing`), not `department_sale_policies` — see
  `docs/superpowers/plans/2026-10-19-a757-1-clearing-per-department.md`, Decision 1. Put
  `release_reminder_minutes` beside it as an ADD COLUMN with no CHECK (a CHECK makes drizzle rebuild
  `departments`, which other tables' foreign keys point at), range-checked at the route, or say why
  another table."
- [ ] **Step 7: Check for missed claims.**
  `git grep -n -i -E "clearing (setting|workflow|switch)|whole venue|venue-wide" -- docs/backlog.md docs/backlog docs/developers apps/server/src/guide`
  — every remaining hit about Needs clearing is either rewritten here or is history inside a dated
  plan/spec (left alone). The user guides hold no Needs clearing text today (`git grep -i clearing apps/server/src/guide`
  finds only unrelated "clears"). `pnpm exec prettier --file-info` on each changed doc (`docs/` is ignored whole).
- [ ] **Step 8: Commit** — `"Docs: Needs clearing is per department; A757's answers and the owner's review entry"`.

### Task 7: LOOK — the Service tab in real Chromium

**Files:** a throwaway test in `apps/dashboard/src/` (deleted, never committed); pictures in
`/Users/clintongormley/waitron-campaign-c/a757-1-shots/`; notes in
`/Users/clintongormley/waitron-campaign-c/a757-1-look-report.md`, following
`/Users/clintongormley/waitron-campaign-c/a756-3-look-report.md`.

- [ ] **Step 1:** Mount the whole dashboard with `mountReceiptApp` (`apps/dashboard/src/testing/department-receipt-app-fixture.ts`)
  at `path: "/manage/venue-operations/department/bar/view/service"`. For each of light and dark (the
  `data-theme` on the `[data-wt-theme-root]` element) and `page.viewport(1280, 900)` and
  `page.viewport(390, 900)`: a picture with the switch off (Save quiet), then one after tapping it on
  (Save primary) — `service-<width>-<theme>-off.png`, `…-on.png`. Read `window.innerWidth` inside the
  test and record it.
- [ ] **Step 2:** Look at every picture. Check: the "Table states" heading sits under "Orders and
  payment" at the same level; the label and hint wrap inside the dialog at 390 with no sideways
  scroll (`document.documentElement.scrollWidth` equals the viewport width); the switch, hint and Save
  are readable in dark. Write per-picture notes and any concern into the report. A defect found is
  fixed with a failing test first, in the component's own test file, and committed.
- [ ] **Step 3:** Delete the throwaway test; `git status` shows it gone.

---

## Open questions (each with the default this plan uses)

1. **Where the switch lives.** The A756 plan named `department_sale_policies`
   (`2026-10-18-a756-kitchen-tab-split.md:627`) and expects A756 PR 4's reminder minutes on "the same
   table A757 slice 1 gives the clearing switch". **Default: `departments`** (Decision 1); Task 6
   Step 6b tells A756 PR 4 to put its reminder there too, with no CHECK, or say why not. A storage
   choice inside the build, so not put to the owner.
2. **The switch's words — settled in plan review, not open.** The owner-agreed A757 picture 10 is
   quoted as drawn: section "Table states", switch "Needs clearing", hint "A table stays “Needs
   clearing” after the party leaves, until marked cleared." Reasoning under Global constraints.
3. **Shown for every department.** A counter-only department still shows the section. **Default:
   yes** — a zone can start orders at tables even when its department does not (`zone_sale_policies.order_start`).
