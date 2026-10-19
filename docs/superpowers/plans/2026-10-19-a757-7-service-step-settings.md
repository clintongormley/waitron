# A757 slice 7 — Service steps: the settings: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Review path: FULL** (a migration; and a new foreign key from a module table into a core table,
`kitchen_courses`, which changes what deleting a course does). **One pull request for the whole
slice.** Branch `feat/a757-7-service-step-settings`, worktree
`/Users/clintongormley/workspace/worktrees/waitron-feat-a757-7-service-step-settings`, from `main`
at `06c851fa4`. Implementers are dispatched as `subagent_type: "implementer"`.

**Goal:** each department keeps its own list of service steps — a name, what starts it, and after
how many minutes — edited in the department dialog's Service tab under "Table states", below Needs
clearing. A new department starts with three steps (Set up, Take order, Anything else?). Nothing on
the till's floor changes: slice 8 shows the steps there.

**Architecture:** a new venue-service table `service_steps` (one row per step, a `position` for the
order, a `start` out of five, an optional `course_id` into the core `kitchen_courses`, and
`minutes`). The department dialog loads the steps and the venue's live courses from the
venue-service model (`GET /management-api/venue-service`) and saves them with the existing
department save (`PUT …/departments/:departmentId/settings`) as an optional `serviceSteps` list, sent only when
the steps changed and written as a change set that keeps each kept step's id. `createDepartment` and the provisioning seed
write the starter set; the configuration export carries the table; deleting a course or a department
deletes the steps that depend on it and says so in the delete dialog.

**Tech stack:** TypeScript, Drizzle on `node:sqlite`, drizzle-kit 0.31.11, Hono routes, Lit
dashboard components, Vitest (browser mode for the dashboard).

**Spec:** `docs/superpowers/specs/2026-10-17-a757-table-states-design.md` §8, §9, §11 item 7, and the
Decided section's Q29, Q30 and Q31. Picture
`docs/backlog/mockups/a757-table-states/10-service-steps.png`.

## Global constraints

- **Not live**, so no data is carried forward: departments that already exist get no steps (no
  backfill in the migration), as CLAUDE.md §3 allows ("No backwards-compatibility or data-migration
  code until Waitron is in production").
- **Nothing on the floor changes.** No server read the till makes, no till file, no
  `table-signals.ts` change. Each party's done steps are slice 8's (Decision 7).
- **Product text is quoted from picture 10, not paraphrased** (owner rule: quote approved mock-ups;
  concise product text). The picture draws, under "Table states": the sub-heading `Service steps`,
  the column heads `Step` and `Starts`, the rows `Set up` / `When seated · 0 min`, `Take order` /
  `After the step before · 2 min`, `Dessert?` / `Mains served · 10 min`, `Anything else?` /
  `Everything served · 10 min`, and the button `+ Add step`. So: sub-heading `Service steps`; column
  heads `Step`, `Starts`; start labels `When seated`, `After the step before`, `{course} served`
  (the picture's "Mains served"), `Everything served`; minutes shown with the unit `min`; button
  `Add step`. The "+" is drawn as text in the picture; the spec says its symbols stand in for icons
  (spec lines 11-14), and the Courses page's own button reads "Add course" with no "+"
  (`docs/backlog/mockups/a756-kitchen-settings/02-courses-page.png`), so the button reads
  `Add step`. The picture's paragraph under the list ("Starts: when seated · … (Q29); Dessert? is
  one this venue added.") and its caption are notes for the owner, naming a question number, not
  product text; they are not shown.
- **Words the picture does not draw** (each is a candidate owner question, open question 1, with
  this default):
  - fifth start (Q31, "every N minutes since the last order"): `Repeats after the last order`, read
    with its minutes as "Repeats after the last order · 20 min";
  - empty list: `No service steps.`;
  - the row menu: `Actions: {name}` and `Delete`, as the venue-service strings already say
    (`packages/venue-service/src/dashboard/strings.ts:6,213`);
  - the reorder handle: `Reorder: {name}`, announcement `{name} is now {index} of {total}.`, as the
    prep stations say (`strings.ts:214-215`);
  - messages: name blank → the existing `This field is required.` (`strings.ts:479`); minutes →
    `Whole minutes, 0 to 120.`; the repeating start with 0 → `At least 1 minute.`; first step
    "after the step before" → `The first step has no step before it.`; a course deleted while the
    dialog was open → `That course was deleted. Choose another start.`; a step deleted or replaced
    on another screen while the dialog was open → `A step was changed elsewhere. Cancel to see the latest.`;
    the course delete window, for a step that becomes its department's first and started "after
    the step before" (Decision 3) → `1 service step now starts When seated.` /
    `{count} service steps now start When seated.`;
  - Spanish: sub-heading `Pasos de servicio`; heads `Paso`, `Empieza`; starts `Al sentarse`,
    `Tras el paso anterior`, `Al servir {course}`, `Al servirlo todo`,
    `Se repite tras el último pedido`; button `Añadir paso`; empty `Sin pasos de servicio.`;
    messages `Minutos enteros, de 0 a 120.`, `Al menos 1 minuto.`,
    `El primer paso no tiene paso anterior.`, `Ese curso se ha eliminado. Elige otro inicio.`,
    `Un paso se ha cambiado en otra pantalla. Cancela para ver lo último.`,
    `1 paso de servicio pasa a empezar Al sentarse.` /
    `{count} pasos de servicio pasan a empezar Al sentarse.`
    ("curso" is the dashboard's Spanish word for a course: `"kitchen.delete_course": "Eliminar curso"`,
    `apps/dashboard/src/i18n/strings.ts:4282`); reorder `Cambiar orden: {name}` and
    `{name} está ahora en la posición {index} de {total}.` as the prep stations say
    (`strings.ts:1103-1104`).
  - Starter step names in Spanish: `Montar mesa`, `Tomar nota`, `¿Algo más?` — "Tomar nota" is the
    till's own Spanish for Take order (`"signal.take_order": "Tomar nota"`,
    `apps/till/src/i18n/strings.ts:2479`); the other two have no existing term.
- Coverage bars 98/98/98/95 hold in every package touched.
- **Changing an existing test assertion is a stop** unless this slice's spec changes what it checks.
  Every assertion this plan changes is listed in its task under "Assertions changed", and every
  fixture that grows under "Fixtures grown"; anything else that turns red is a stop and a report,
  not an edit.
- Every commit `git commit -s`. Do not touch lane G's branch `feat/a773-1-unsent-list` or its
  worktree.
- Every task ends with: the task's focused tests, `pnpm --filter <pkg> typecheck` for each package
  it touched, and `pnpm exec prettier --check <changed files>`. Read each run's `Tests` count (a run
  that prints none proves nothing). An implementer past about 150 tool calls with the task
  unfinished stops at a passing or cleanly red point, commits, and returns a handover (done, left,
  files, each check's state).
- Browser runs (the `browser` project of `@waitron/venue-service`, and `@waitron/dashboard`): check
  free memory first (`memory_pressure | grep free`), as CLAUDE.md §2 says.

## Decisions (with receipts)

1. **The table, measured.** `packages/venue-service/src/schema/service-steps.ts`:

   ```ts
   export const SERVICE_STEP_STARTS = [
     "seated", "after_previous", "course_served", "all_served", "since_last_order",
   ] as const;
   export type ServiceStepStart = (typeof SERVICE_STEP_STARTS)[number];
   const serviceStepStart = enumType(SERVICE_STEP_STARTS);
   export const serviceSteps = table("service_steps", {
     id: id("id").primaryKey().$defaultFn(newId),
     departmentId: id("department_id").notNull(),
     position: count("position").notNull(),
     name: label("name").notNull(),
     start: serviceStepStart("start").notNull(),
     courseId: id("course_id"),
     minutes: count("minutes").notNull(),
   }, (t) => [
     foreignKey({ columns: [t.departmentId], foreignColumns: [departments.id], name: "service_steps_department_fk" }),
     foreignKey({ columns: [t.courseId], foreignColumns: [kitchenCourses.id], name: "service_steps_course_fk" }),
     index("service_steps_department_position_idx").on(t.departmentId, t.position),
     check("service_steps_start_ck", enumCheck(t.start)),
     check("service_steps_course_ck", sql`(${t.start} = 'course_served') = (${t.courseId} is not null)`),
     check("service_steps_minutes_ck",
       sql`${t.minutes} between 0 and 120 and (${t.start} <> 'since_last_order' or ${t.minutes} >= 1)`),
   ]);
   ```

   The column builders come from `@waitron/db`, as CLAUDE.md §3 requires (`enumType`/`enumCheck`
   `packages/db/src/schema/columns.ts:113,128`; `kitchenCourses` exported at
   `packages/db/src/index.ts:133`); `index` from `drizzle-orm/sqlite-core` as other modules use it
   (`packages/catalogue/src/schema/extras.ts:66`). **No unique index on `(department_id, position)`**:
   the save rewrites positions row by row, and a unique index the final state satisfies can break
   mid-way (CLAUDE.md §3); rows are read `order by position, id`. **No unique name**: the spec does
   not ask for one. `minutes` caps at 120, the bound the venue's reminder minutes already use
   (`MAX_RELEASE_REMINDER_MINUTES = 120`, `packages/venue-service/src/routes.ts:229`).

   **Measured 2026-10-19** in a scratch copy of this worktree (`cp -c -R`, its `.git` pointer file
   removed, deleted after) with the schema above exported from `src/schema/index.ts` and
   `classify("service_steps", "state", STATE)` added: `packages/venue-service/node_modules/.bin/drizzle-kit generate --name probe`
   (run from `packages/venue-service`) wrote `drizzle/0062_probe.sql` holding exactly one
   `CREATE TABLE \`service_steps\`` with the two foreign keys (`ON DELETE no action`) and the three
   CHECKs, then `CREATE INDEX \`service_steps_department_position_idx\``. No `__new_` table, no
   other table touched. With it in place:
   - `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts scripts/module-graph-honesty.test.ts scripts/id-columns-are-references.test.ts`
     printed `Test Files 9 passed (9)`, `Tests 448 passed (448)`. Run alone with `CLAUDECODE` and
     `AI_AGENT` unset, `scripts/migration-upgrade.test.ts` printed `221 tables hold rows after the
     last step.` and `309 steps`, `Tests 4 passed (4)`. **So no new `CANDIDATES` value was needed.**
     That pass says less than it sounds: the upgrade test fills only tables the step before already
     had (`scripts/migration-upgrade.test.ts:246`), so `service_steps`, created by the newest step,
     holds no rows in it; it shows the new migration applies on top of a database holding rows in
     every other table. If a later regeneration makes the test ask for one, the owner allows sample
     values for a new table; say so in the PR.
   - `pnpm --filter @waitron/venue-service exec vitest run src/schema/schema-conformance.test.ts`
     printed `Tests 70 passed (70)`; the unchanged worktree prints `68 passed (68)`, so the shared
     conformance suite picked up the new table.
   - `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad` printed `Tests 2 passed (2)`.
   - **Controls:** with the `classify` line removed, `scripts/classification-complete.test.ts` failed
     with `venue-service: created table "service_steps" is not classified`, and
     `scripts/live-subscriptions.test.ts` failed with `venue-service:operations:service_steps`
     (the change-feed source comes from the classification list,
     `packages/venue-service/src/classification.ts:54-55`).
   - **The CHECKs, run** (Node v26.11.1 `node:sqlite`, the generated SQL on an empty database):
     accepted `seated`/no course/0, `course_served`/a course/10, `since_last_order`/1,
     `all_served`/120; refused `seated` with a course and `course_served` without one
     (`service_steps_course_ck`), `since_last_order`/0 and `all_served`/121
     (`service_steps_minutes_ck`), and a start `later` (`service_steps_start_ck`).

   **Classification `state`**, beside `departments` (`packages/venue-service/src/classification.ts:8`):
   configuration, copied to a standby, never drained back. `kitchen_courses` is `state` too
   (`packages/db/src/classification.ts:131`), so the foreign key joins two `state` tables and the
   local/ledger/state rule (CLAUDE.md §3, "no foreign key may join a `local` table to a
   `ledger`/`state` one") is not touched; `scripts/two-file-foreign-keys.test.ts` passed above.
   **`requires`:** venue-service's SQL already references core tables (`kitchen_stations`,
   `packages/venue-service/src/schema/routing.ts:52-55`), and `scripts/module-graph-honesty.test.ts`
   passed with the new reference into `kitchen_courses`; no descriptor change. Task 1 generates the
   real migration with `--name service_steps`.

2. **The five starts and what the numbers mean.** `start` is one of `seated` (When seated),
   `after_previous` (After the step before), `course_served` (`{course} served`, naming
   `course_id`), `all_served` (Everything served), `since_last_order` (Q31's fifth start). `minutes`
   is how long after the start the step shows; 0 is at once (spec §8 "each plus a number of minutes
   (0 = at once)"). For `since_last_order` the minutes are Q31's N, so 0 is refused (a step that
   repeats every 0 minutes). **The first step of a department may not start "after the step
   before"** — it has none: the route refuses it (`serviceSteps.0.start`) and the dialog marks it.
   Not a CHECK: it is a rule across rows. What each start means on the floor (when it fires again,
   which order clears it) is slice 8's (spec §8, Q30).

3. **The course reference, and what deleting a course does.** Courses belong to the venue
   (`kitchen_courses.location_id`, `packages/db/src/schema/kitchen-courses.ts:16`), so a step names
   any live course of its venue. Deleting a course today either deletes the row or, when an order,
   draft or ticket still names it, marks it inactive (`deleteCourse`,
   `apps/server/src/course-delete.ts:71-85`; `COURSE_REFERENCES` `:16-21`). Measured on the
   generated SQL with foreign keys on (Node v26.11.1 `node:sqlite`): deleting a course a step names
   was refused `FOREIGN KEY constraint failed`; after deleting the step the course delete was
   accepted; a step naming no course row was refused the same way. **Decision: deleting a course
   deletes the steps that start from it, and the delete dialog
   lists them under "Settings that are removed"** (`"printers.delete_removes"`,
   `apps/dashboard/src/i18n/strings.ts:1396`), as the course's product defaults are listed today
   (`key: "course_products"`, `course-delete.ts:57`). It follows the station delete, which asks
   venue-service for the module rows a core delete must clear (`readStationDeleteSettings` /
   `clearStationDeleteSettings`, `apps/server/src/station-delete.ts:26,54,184`;
   `packages/venue-service/src/station-delete-settings.ts:136-150`). Refusing the delete instead
   would send the manager to every department's dialog first; keeping an inactive course on the step
   would show a start the picker no longer offers. Because steps go with their course, **no step
   ever names an inactive course**, so the dialog needs no "deleted course" display beyond the race
   in Decision 10.
   **The course row itself is kept inactive, not deleted, when a step named it**, because
   `service_steps.course_id` joins `COURSE_REFERENCES`: `apps/server/src/in-use-references.test.ts:28-31`
   holds that list equal to every foreign key into `kitchen_courses`, and with the new table it
   failed naming `service_steps.course_id` (measured, see "Whole-suite measurement"). Products
   already work this way — "Product-only references retain the row too, even though deletion clears
   those settings" (`course-delete.ts:43-44`) — so steps follow the same rule: `retained` is worked
   out before the clearing, the steps and product defaults are cleared, and the course goes inactive.
   With the reference added, `in-use-references.test.ts` and `course-delete.test.ts` printed
   `Tests 16 passed (16)` in the scratch copy.
   **A step left first with "after the step before" becomes When seated** (plan review,
   2026-10-19). Example: a department's steps are [Dessert? · Mains served, Coffee · After the step
   before]; deleting Mains deletes Dessert?, and Coffee is now first with no step before it. Left so,
   the dialog would block every Save until that row changed (Decision 10's first-row rule), and an
   export of the venue would be refused when imported: `validateServiceSteps` refuses
   `after_previous` at a department's lowest position (Decision 6), and every bundle passes through
   the module validators before an import is staged or applied (`validateConfigurationBundle`,
   `apps/server/src/configuration-transfer.ts:591-615`, called at `:625` and from
   `apps/server/src/boot.ts:1087`). So `clearCourseDeleteSettings`, after deleting the steps, looks
   at each department it touched and turns a first remaining step that starts `after_previous`
   into `seated`, keeping its minutes; `readCourseDeleteSettings` counts those steps the same way,
   and the course delete window says `1 service step now starts When seated.` beside the removed
   steps. **No other delete path can leave such a first step:** a department delete takes all of
   its steps (Decision 4), the dialog's save refuses it (Decision 8), and the import refuses it
   (Decision 6); `kitchen_courses` loses a live row only through `deleteCourse` (`updateCourse`
   refuses `active`, `apps/server/src/kitchen.ts:403-405`). **A step lower in the list that starts
   "after the step before" now follows whichever step is above it; the window does not say so.**
   "After the step before" means the step above it in the list (spec §8, start 2), which stays
   true, and the window already lists the steps removed; a further line per follower would repeat
   that.

4. **What deleting a department does.** A department delete marks the department inactive and
   deletes its own settings rows — sale policy, transfer desks, periods, days
   (`packages/venue-service/src/service-delete-settings.ts:430-455`) — listing each kind in the
   impact (`:327-344`, zero counts dropped at `:358`). **Decision: it deletes the department's steps
   too, listed as `{ key: "service_steps", count, targets: [] }` after `department_policy`.**
   Measured in a scratch copy with starter steps in `createDepartment` and this item added:
   venue-service's `src/service-delete*` tests `Tests 56 passed (56)`; the server's
   `service-delete.history`, `service-delete.integration`, `service-delete.disabled-bookings`,
   `floor-delete`, `floor-delete.bookings` and `delete-impact` suites passed, and
   `management-api.service-delete.test.ts`'s "returns the exact full department preview and
   recomputed delete impact" failed only by the new `{ "count": 3, "key": "service_steps",
   "targets": [] }` — the one assertion Task 4b changes.

5. **Where the starter set is written.** The writers of `departments` outside tests
   (`git grep -n "insert(departments)" -- packages apps` without test files): `createDepartment`
   (`packages/venue-service/src/operations.ts:194`), the provisioning seed
   (`packages/venue-service/src/provisioning.ts:55`), and the demo seed's deli
   (`apps/server/scripts/demo-seed/seed-floor.ts:78`); the configuration import writes rows from
   the bundle (`apps/server/src/configuration-transfer.ts:700-760`). Every department gets a
   sale-policy row in both product paths (`operations.ts:205-207`, `provisioning.ts:68-71`) and an
   open menu period (`operations.ts:209-214`, `provisioning.ts:149-153`), and the spec expects a
   department that does not visit tables to delete its steps ("a bar that does not visit tables
   deletes them all", spec §8). **Decision:**
   - `createDepartment` writes the starter set for every department it creates.
   - The provisioning seed writes it **only in the branch that inserts a new department**. The seed
     re-runs on re-registration (`apps/server/src/provision-till.ts:81-88`,
     `apps/server/scripts/register-till.ts:1-2`), and it keeps an existing default or promotes
     another active department instead of inserting (`provisioning.ts:28-50`); writing steps there
     would put back steps a venue deleted. The seed's `summary` (`provisioning.ts:18-19`, read by no
     test: `git grep -n "four seasons, and give each profile"` finds only the file) gains "with its
     starter service steps".
   - The demo seed's deli gets the starter set through the same function; its restaurant is the
     provisioned default department and already has it. The demo makes no courses
     (`git grep -n -i "course" -- apps/server/scripts/demo-seed/*.ts` outside tests finds none), so
     picture 10's "Dessert? · Mains served" is not seeded.
   - The configuration import gets none: it replaces the venue's steps with the bundle's
     (Decision 6).
   - Existing departments get none (Global constraints).

   **Names in the venue's language.** The step name is venue data shown to staff. Provisioning
   already names seeded rows in the venue's first receipt language with Spanish as the fallback
   (`defaultProfileName`, `packages/layouts/src/device-profile.ts:152-157`, called with
   `locales[0]` at `packages/provisioning/src/venue-plan.ts:176`). The starter set does the same from
   `locations.invoice_locales[0]` (`packages/db/src/schema/tenants.ts:74`): `en` → Set up, Take
   order, Anything else?; anything else → Montar mesa, Tomar nota, ¿Algo más?. (Seasons and the
   Counter zone are seeded in English only, `packages/venue-service/src/season-rules.ts:29-32`,
   `provisioning.ts:104`; the device-profile rule is the one that names something staff read on a
   till.)

   **Measured** in a scratch copy with the table declared for transfer. With the three English rows
   written by `createDepartment` alone: the server's `configuration-transfer`,
   `configuration-import`, `configuration-import.previous-export`, `configuration-transfer.clock`,
   `configuration-export-api`, `service-delete.*`, `management-api.service-delete`, `course-delete`,
   `floor-delete.bookings` and `invoice-email-contact` suites printed `Tests 271 passed (271)`. With
   the seed's insert branch writing them too: venue-service's node project
   `Test Files 78 passed (78)`, `Tests 2668 passed (2668)`; `@waitron/provisioning`
   `Tests 301 passed (301)`. The whole
   `apps/server` suite under the same change: "Whole-suite measurement", at the end of this
   section.

6. **Configuration transfer: the table travels with departments.** Declared as
   `{ name: "service_steps" }` right after `departments` in
   `VENUE_SERVICE_CONFIGURATION_TRANSFER` (`packages/venue-service/src/configuration-transfer.ts:727-756`).
   It must be declared: the import deletes every row of every declared table before inserting
   (`apps/server/src/configuration-transfer.ts:700-711`, with foreign-key checks deferred to commit),
   so an undeclared `service_steps` row would still name a deleted department at commit. **Control,
   measured** in a scratch copy with starter steps written by the provisioning seed and the table NOT
   declared: `configuration-transfer.test.ts` and `configuration-import.test.ts` printed
   `Tests 59 failed | 106 passed (165)`, `Error: FOREIGN KEY constraint failed`; with it declared,
   those two plus `configuration-import.previous-export` and `configuration-transfer.clock`
   printed `Tests 167 passed (167)`. Ids are rewritten on import for every foreign-key column
   (the id columns are read from `pragma_foreign_key_list` at `apps/server/src/configuration-transfer.ts:670-677` and rewritten at `:729-731`), so `department_id` and `course_id` arrive
   pointing at the imported rows; `scripts/id-columns-are-references.test.ts` passed above. A step of
   an inactive department, or of an inactive course (none exist, Decision 3), is left behind by the
   foreign key (`leaveBehindReferences`, `apps/server/src/configuration-transfer.ts:423-460`), as a
   routing cell of an inactive station is today (`routing_cells.station_id` → `kitchen_stations`,
   declared `leaveBehindWhenFalse: "active"` at `packages/db/src/configuration-transfer.ts:31-35`).
   The bundle's version stays 4: slice 1 added a column the same way with no version change
   (Decision 9 of the slice 1 plan). `validateVenueServiceConfiguration` gains
   `validateServiceSteps`, refusing `setup.request_invalid` with `field` `service_steps.department_id`
   (not a bundle department), `service_steps.course_id` (set for a non-course start, missing for
   `course_served`, or not a bundle `kitchen_courses` id — the validator already reads core tables,
   `kitchen_stations` at `:546`), `service_steps.start` (not one of five, or `after_previous` at a
   department's lowest position), `service_steps.minutes` (not a whole number 0–120, or 0 for
   `since_last_order`), `service_steps.name` (not a string, or blank once trimmed — the save stores
   names trimmed and refuses a blank one, Decision 8) and `service_steps.position` (not a whole
   number at or above 0: the lowest-position rule above reads it), as `validateOrderStarts` checks
   an enum a CHECK also holds (`:701-710`).

   **Data-retention inventories.** `docs/superpowers/specs/2026-10-16-a664-personal-data-audit.md`
   and `…-retention-table-inventory.md` are dated readings of the snapshots; slice 1 added dated
   pointers rather than rewriting them (`a664-personal-data-audit.md:162`). Task 8 adds one dated
   line under each document's venue-service table: `service_steps` (added 2026-10-19, A757 slice 7)
   — L: `id`, `department_id`, `course_id`; U: `name`; R: `position`, `start`, `minutes`; retention
   as `departments` (configuration).

7. **Each party's done steps are slice 8's.** Nothing writes them until the Done route exists
   (spec §11 item 8), and slice 8 carries a migration of its own. **What this slice owes slice 8:**
   the save keeps a kept step's id. It is a change set — delete the rows no longer sent, update the
   sent rows with ids, insert the rest — not "delete all, insert all", because slice 8's done-step
   rows will hold step ids, and CLAUDE.md §3 says replacing a set needs nothing outside the table to
   hold a key into it. Renaming "Dessert?" will then not reset a step already done at a table.
   **Also slice 8's:** whether "Take order" keeps today's extra rule (it clears when an order is
   started, spec §8) and how the code knows which step it is. No column marks it now; if slice 8
   needs one, a boolean with a default is a plain ADD COLUMN.

8. **The management API.** No new route: the department save
   (`PUT /management-api/venue-service/departments/:departmentId/settings`,
   `packages/venue-service/src/routes.ts:814-858`) accepts an optional `serviceSteps`, as it accepts
   optional `transfers` and `needsClearing` (`:848-851`); absent leaves the stored steps alone, so
   no other caller changes. Its permission is the route's (`MANAGE_VENUE_SERVICE` through `gated`,
   `:443-455`). Body: `serviceSteps: { id?: string; name: string; start: ServiceStepStart;
   courseId?: string | null; minutes: number }[]`, at most 20 entries. The route
   (`requireServiceSteps`, beside `requireTransferSettings` at `:202`) refuses the shape and the
   per-row rules; the operation refuses what needs the database. **The codes:**
   - A malformed body — `management.request_invalid` (declared in `packages/shared/src/errors.ts:58`)
     with `field` `serviceSteps` (not an array, more than 20) or
     `serviceSteps.<index>.<id|name|start|courseId|minutes>`; an entry that is not an object or has
     an unknown key → `serviceSteps.<index>`; the same id twice → `serviceSteps.<index>.id` (the
     second). This is the code the route already throws for every other malformed field of this
     save (`requireName`, `routes.ts:256-260`; `needsClearing`, `:828-829`). **`requireServiceSteps`
     does not call `onlyKeys` on an entry:** `onlyKeys` names the extra key itself as the field
     (`{ field: extra }`, `packages/venue-service/src/request-keys.ts:5-8`), which would say
     `field: "colour"` rather than which entry; it checks entry keys itself and throws
     `serviceSteps.<index>`. (The body's own keys still go through `onlyKeys`, with `serviceSteps`
     added to its list, `:819-827`.)
   - A step id that is not a step of this department — **`service_step.not_found`
     `{ stepId }`** (new, declared in `packages/venue-service/src/errors.ts`, `404` in `STATUS`
     beside `department.not_found`, `routes.ts:103`): another manager deleted the step, or the
     department's steps were replaced, while this dialog was open.
   - A course that is not a live course of the venue — **`course.not_found` `{ courseId }`**,
     the code a course read already uses (`apps/server/src/errors.ts:845`; dashboard message
     `apps/dashboard/src/i18n/codes.ts:658`). venue-service declares it again in its own
     `errors.ts` with the same params, because venue-service cannot import `apps/server`'s
     registry and every file that throws a code imports its registry (CLAUDE.md §3). Two identical
     declarations merge: checked 2026-10-19 with the packages' `tsc` 7.0.2 on a scratch file
     declaring one property twice in two merged interfaces — the identical pair compiled, and a
     control pair with different types failed `TS2717: Subsequent property declarations must have
     the same type`. `404` in `STATUS`. (`device.not_found` is the reverse case: declared in
     venue-service's `errors.ts:13`, thrown by `apps/server/src/device-api.ts:720`.)
   **Why not one domain code for everything, as transfers have?** The same save refuses transfer
   settings with `department_transfer.settings_invalid` (`packages/venue-service/src/department-transfers.ts:135,149`,
   mapped in the dialog's `fieldRefusal`, `department-settings.ts:459-468`) because
   `setDepartmentTransferSettings` is also called by the transfers route of its own
   (`routes.ts:1150`), and every one of its refusals is a database fact. The steps have one
   writer, and the split above gives the dialog what it needs: a shape refusal it cannot fix by
   editing (the dialog checks the same rules first), and two facts that each need their own
   message. `scripts/errors-reachable.test.ts` keeps holding (venue-service's `errors.ts` stays
   reachable from its barrel); `scripts/alert-codes.test.ts` is about recorded incident codes, and
   neither code is recorded as one.
   **The dialog sends `serviceSteps` only when its steps differ from the ones it opened with**
   (plan review, 2026-10-19), compared with the same entry-by-entry rule as the draft's `equal`
   (Task 5). A save that changes only the name, a sale setting or Needs clearing leaves the steps
   to whoever last changed them, so a dialog opened before another manager's step change does not
   undo it. When both managers change steps, the later save wins, as it does for every other field
   of this form; if the later one names a step the earlier one deleted, it is refused
   `service_step.not_found` and told so (Decision 10). The model gains `serviceSteps: ServiceStep[]` (the steps of
   the venue's active departments, ordered by department id, then position, then id) and
   `courses: { id: string; name: string }[]` (the venue's active courses in firing order, as
   `listCourses` orders them, `apps/server/src/kitchen.ts:351-362`), next to
   `needsClearingDepartmentIds` (`routes.ts:727`). `ServiceStep` is
   `{ id; departmentId; name; start; courseId: string | null; minutes }`.

9. **Live updates.** The dialog's model watch is `QUERY_DEPENDENCIES.operations`
   (`packages/venue-service/src/dashboard/venue-operations-loader.ts:64-69`;
   `packages/venue-service/src/dashboard/live-queries.ts:229`); it gains `"service_steps"` and
   `"kitchen_courses"`, so a step saved or a course renamed on another screen reaches an open
   dialog. The course delete impact's watch gains `"service_steps"`
   (`getCourseDeleteImpact: ["kitchen_courses", "products"]`, `apps/dashboard/src/api/live-queries.ts:478`).
   Measured with both names added to `operations`: `pnpm exec vitest run scripts/live-subscriptions.test.ts`
   `Tests 1 passed (1)`; with `"service_stepz"` it failed naming
   `venue-service:operations:service_stepz`.

10. **The form.**
    - **Where:** inside the Service tab's "Table states" section, after the Needs clearing block
      (`packages/venue-service/src/dashboard/department-settings.ts:694-712`), an `<h4>` sub-heading
      `Service steps` and the list — picture 10 draws it there, under Table states, with the reminder
      to fire between them; A756 PR 4 adds that reminder later (Decision 12).
    - **A component of its own,** `packages/venue-service/src/dashboard/department-service-steps.ts`
      (`<department-service-steps>`), because `department-settings.ts` is already 791 lines. It
      draws the rows and reports each change with a plain `steps-change` event (an app-owned
      component may name its events plainly, CLAUDE.md §3); the dialog holds the steps in its one
      draft, so the existing draft scope (`draftScopeFor`, `:320-334`), Save's quiet state
      (`saveActionState`, `:484`) and the leave guard cover them with no new scope.
    - **The list is a `<table>` whose `<tbody>` holds one `<tr>` per step, in draft order, keyed by
      the row's draft key** (a saved step's id, or a key made when the row is added): the controller
      requires it — "The tbody renders one `<tr>` per id in this order — the invariant the pointer
      geometry relies on" (`ReorderModel.order`, `packages/ui/src/reorder-table.ts:105-108`) — and
      `ReorderController.tableStyles` styles that table (`:199`). Each row has three cells: the
      handle, one cell holding the name, start and minutes in a wrapping flex box, and the menu. At
      390 px the box wraps inside its cell — the name on its own line, the start and minutes on the
      next — so the row stays one `<tr>` and nothing scrolls sideways.
    - **Rows, as the Courses page draws them:** a drag handle driven by `ReorderController` from
      `@waitron/ui` (keyboard and pointer; the Courses page wires it at
      `apps/dashboard/src/widgets/course-list.ts:143-157`, and the in-form precedent that reorders a
      draft rather than saving each move is `apps/dashboard/src/widgets/option-list-form.ts:228`); the
      name in a `wt-input` (`name="serviceStepName"`, label `Step`, `hide-label`); the start in a
      `wt-combobox` (`name="serviceStepStart"`, label `Starts`, as the reminder minutes use one,
      `packages/venue-service/src/dashboard/service-settings-panel.ts:184-216`) offering When seated,
      After the step before, one `{course} served` per live course in firing order, Everything
      served, and Repeats after the last order; the minutes in a `wt-input type="number"`
      (`name="serviceStepMinutes"`, label `Minutes`, `hide-label`, the unit `min` in its `end` slot);
      and a `wt-row-actions` menu (`Actions: {name}`) holding `Delete`. **Delete is in the row menu,
      not a trash icon:** the design system puts Delete "in each row's menu"
      (`docs/developers/design-system.md:4636-4642`) and the Courses page does
      (`02-courses-page.png`; `course-list.ts:467`); no trash icon is registered
      (`git grep -n '"trash"' -- packages/ui packages/ui-core` finds none). Delete takes the row out
      of the draft at once — no confirmation, since Cancel brings it back — and focus moves to the
      next row's name, or to Add step when none is left.
    - **Add step** (a quiet `wt-button` under the list) appends a row — `seated` when the list is
      empty, else `after_previous`; 0 minutes; empty name — and focuses its name. It is disabled at
      20 rows (Decision 8's bound) and in the read-only dialog.
    - **Validation**, shown after a Save attempt as the dialog's other fields are
      (`this.attempted`, `:487`): name blank; minutes not a whole number 0–120 (a fraction such as
      `2.5` is refused, CLAUDE.md §3 "try a fraction"); 0 for Repeats; the first row After the step
      before; a course no longer in `model.courses` (deleted while the dialog was open). Each message
      sits under its own field, the form's one message stays at the bottom, and Save stays disabled
      until they are fixed, as the form contract says (CLAUDE.md §3 Forms).
    - **Refusals from the server:** `management.request_invalid` with
      `serviceSteps.<index>.<name|start|courseId|minutes>` marks that row's field with the existing
      `This value was not accepted. Change it and save again.` (`strings.ts:480`; a `courseId`
      shape refusal goes under the start); `serviceSteps`, `serviceSteps.<index>` or
      `serviceSteps.<index>.id` marks the list with the same words. `course.not_found` marks the
      start of every submitted row naming that `courseId` with `That course was deleted. Choose
      another start.` — only this code shows that message. `service_step.not_found` marks the list
      with `A step was changed elsewhere. Cancel to see the latest.` (Cancel restores the opened
      copy, and the clean dialog then follows the model). Service is shown and the first marked
      field focused, as `fieldRefusal` and `showFirstInvalid` do today (`:437-473`, `:227`). A
      refusal never disables Save by itself.
    - **After a save**, the model's copy (with the new rows' ids) replaces the clean draft through
      the existing "follow while clean" path (`:337-345`), so the next save that changes the steps
      sends the ids.
    - **Read-only** (a supervisor): no handles, no menus, fields disabled, no Add step.
    - **Every department shows the list**, as it shows Needs clearing (slice 1 plan, open question
      3): a zone can take table orders when its department does not (`zone_sale_policies.order_start`).
    - **No help tooltip:** the dialog has none (`git grep -n "help-tooltip" packages/venue-service/src/dashboard/department-settings.ts`
      finds none), and a short explanation is a hint, not a "?" (CLAUDE.md §3). **No user guide
      change:** the guides cover products, modifiers and content only (`ls apps/server/src/guide/en`:
      `content-and-images.md`, `modifiers.md`, `products.md`).

11. **Overlap with lane G (`feat/a773-1-unsent-list`).** `git diff --stat main...feat/a773-1-unsent-list`
    (2026-10-19) touches, of this slice's files: `apps/server/src/course-delete.test.ts` (imports and
    two cases), `apps/server/src/kitchen.ts` (the `Course` type and course writers),
    `apps/dashboard/src/i18n/strings.ts` (two keys at `@@ -1264` and `@@ -4271`),
    `apps/dashboard/src/widgets/course-list.ts`, `packages/venue-service/src/service.ts` and
    `service.test.ts`, and `packages/db/src/schema/kitchen-courses.ts` (a `held_until_fired`
    column). So: this slice's course-delete tests go in a **new file**,
    `apps/server/src/course-delete.service-steps.test.ts`; it does not edit `kitchen.ts`,
    `course-list.ts`, `service.ts` or `kitchen-courses.ts`; `course-delete.ts` itself is not on lane
    G's list. Its dashboard keys go after `"kitchen.delete_course_products_one"` (`:1276`, `:4284`),
    eight lines past lane G's hunk; I believe git merges that cleanly, not checked. The model's
    `courses` reads `id` and `name` only, so lane G's new column does not reach it. Whoever lands
    second rebases.

12. **A756 PR 4** (reminder minutes per department) waits for A773-1 and will add its field to the
    same Service tab (`docs/superpowers/plans/2026-10-18-a756-kitchen-tab-split.md:622-633`, and
    slice 1's dated note after it). This slice adds no column to `departments`, so the two
    migrations do not collide beyond drizzle's numbering, which is fixed by regeneration (CLAUDE.md
    §3). Picture 10 draws the reminder between Needs clearing and Service steps; PR 4 inserts it
    there.

**Whole-suite measurement.** Measured 2026-10-19 in the scratch copy with Task 1's table and
transfer declaration and Task 3's starter set (English names, written by `createDepartment` and the
seed's insert branch), but none of Tasks 4a and 4b: `pnpm exec vitest run` in `apps/server` printed
`Test Files 3 failed | 753 passed (756)`, `Tests 8 failed | 17954 passed | 25 skipped (17987)`.
The three files, each read:
- `src/in-use-references.test.ts` — the course reference list lacks `service_steps.course_id`
  (Decision 3). Caused by the new foreign key, so Task 1 adds the reference.
- `src/canvas-retirement-upgrade.test.ts` "records the no-holder admission-rule loss and retains
  every other surviving value" — its expected tables (`retained`, `:421-430`) list each table created
  after its starting point as empty, and the new table is not listed: received `"service_steps": []`.
  Caused by the new table, so Task 1 adds `service_steps: []` there.
- `src/provision.test.ts` — six cases ("clears a venue's routing cells before its stations" and
  five siblings) fail `FOREIGN KEY constraint failed` in `clearProvisionFixture`
  (`apps/server/src/testing/clear-provision-fixture.ts:5-71`), which deletes a fixed list of tables
  and reaches `departments` while the seeded steps remain. Setup, not an assertion: Task 3 adds
  `"service_steps"` before `"departments"` in that list; with it, `provision.test.ts` printed
  `Tests 22 passed (22)`.
No other server file failed. Task 4b's delete-impact item adds the one assertion change Decision 4
measured.

## Review focus

1. **A course a step names is deleted:** the steps go, the dialog listed them, the course is kept
   inactive (it was in use) and the delete succeeds; a course nothing names is still deleted
   outright — Task 4a.
2. **A save keeps ids:** a renamed or moved step keeps its id; a removed one is deleted; a new one
   gets a new id — Task 2.
3. **A step id from another department, or a course from nowhere, sent to the save** is refused and
   nothing is written — Task 2.
4. **A re-run of the provisioning seed** does not put back deleted steps — Task 3.
5. **Another dashboard deletes the course a dirty draft's step names:** the step is marked with the
   deleted-course message and Save stays disabled until it changes — Task 7.
6. **Deleting a course leaves a step first with "after the step before":** it becomes When seated,
   the window said so, and an export of the venue still imports — Task 4a.
7. **A save that does not touch the steps** sends no `serviceSteps`, so it cannot undo another
   manager's step change — Tasks 5 and 7.

---

### Task 1: the table, its migration, and the configuration transfer

**Files:**
- Create: `packages/venue-service/src/schema/service-steps.ts` (Decision 1)
- Modify: `packages/venue-service/src/schema/index.ts` (add `export * from "./service-steps.js";`)
- Modify: `packages/venue-service/src/classification.ts` (`classify("service_steps", "state", STATE)` after `departments`)
- Create (generated): `packages/venue-service/drizzle/NNNN_service_steps.sql`, its snapshot and
  journal entry, by `cd packages/venue-service && ./node_modules/.bin/drizzle-kit generate --name service_steps`
  — never number or edit by hand
- Modify: `packages/venue-service/src/configuration-transfer.ts` (declaration after `departments`;
  `validateServiceSteps` called from `validateVenueServiceConfiguration`)
- Modify: `apps/server/src/course-delete.ts:16-21` (`COURSE_REFERENCES` gains
  `{ table: serviceSteps, column: serviceSteps.courseId }`, imported from `@waitron/venue-service`;
  Decision 3)
- Test: `packages/venue-service/src/schema/service-steps.test.ts` (new),
  `packages/venue-service/src/configuration-transfer.test.ts`,
  `apps/server/src/canvas-retirement-upgrade.test.ts` (one expected table)

- [ ] **Step 1: Write the failing tests.** `service-steps.test.ts`, set up as
  `packages/db/src/schema/kitchen-courses.test.ts` is (`useVenueDb` with the manifest's migration
  sets), a location, a department (`createDepartment`) and a course row:
  - `"stores a step with each start, a course only for a course start"` — one row per start; the
    `course_served` row names the course; read back `order by position`.
  - `"refuses a course start with no course and another start with one"` — each insert rejects with
    a message containing `service_steps_course_ck` (a CHECK refusal is code 1811 and is identified
    by its words, CLAUDE.md §3), caught outside the transaction.
  - `"refuses minutes past 120, and 0 for a repeating start"` — `service_steps_minutes_ck`.
  - `"refuses a step naming no department or no course"` — `FOREIGN KEY constraint failed`.
  In `configuration-transfer.test.ts`, a `describe("validateServiceSteps")` calling
  `VENUE_SERVICE_CONFIGURATION_TRANSFER.validate` with a minimal bundle (`departments`,
  `kitchen_courses`, `service_steps`): accepts the three starter rows and a course row; refuses,
  each `toMatchObject({ code: "setup.request_invalid", params: { field } })`:
  `service_steps.department_id` (unknown department), `service_steps.course_id` (three cases),
  `service_steps.start` (`"later"`; `after_previous` at a department's lowest position),
  `service_steps.minutes` (`121`, `2.5`, `0` with `since_last_order`); and
  `"lists service_steps right after departments"` on the declaration's table names.
- [ ] **Step 2: Run them and watch them fail.**
  `pnpm --filter @waitron/venue-service exec vitest run --project node src/schema/service-steps.test.ts src/configuration-transfer.test.ts`
  Expected: FAIL (no `service-steps.js`; no declaration; no validator).
- [ ] **Step 3: Add the schema, classification, and generate.** Read the SQL: one `CREATE TABLE
  \`service_steps\`` and one `CREATE INDEX`, nothing else (Decision 1). Anything else is a stop.
- [ ] **Step 4: Add the transfer declaration and `validateServiceSteps`.**
- [ ] **Step 5: Run Step 2's command.** Expected: PASS.
- [ ] **Step 6: Guards.**
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts scripts/module-graph-honesty.test.ts scripts/id-columns-are-references.test.ts`
  (expect `Tests 448 passed` or main's count at the time plus none failing),
  `pnpm --filter @waitron/venue-service exec vitest run src/schema/schema-conformance.test.ts`
  (expect 70), `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad` (2). Then
  `pnpm --filter @waitron/server exec vitest run src/configuration-transfer.test.ts src/configuration-import.test.ts`
  (unchanged pass: no product code writes steps yet), and
  `pnpm --filter @waitron/server exec vitest run src/in-use-references.test.ts src/canvas-retirement-upgrade.test.ts`
  — both fail until the reference and the expected table are added (Whole-suite measurement), then
  pass. Typecheck `@waitron/venue-service` and `@waitron/server`, prettier.
- [ ] **Step 7: Commit** — `git commit -s -m "Departments get a table of service steps (A757 slice 7)"`.

**Assertions changed** (the slice adds a table and a foreign key into `kitchen_courses`):
`apps/server/src/canvas-retirement-upgrade.test.ts` — the `retained` expectation (`:421-430`) gains
`service_steps: []` beside `department_floor_plan_sets: []`. `in-use-references.test.ts` itself is
unchanged; the list it compares against grows. **Fixtures grown:** none.

### Task 2: the server reads and saves a department's steps

**Files:**
- Create: `packages/venue-service/src/service-steps.ts`, `packages/venue-service/src/service-steps.test.ts`
- Modify: `packages/venue-service/src/index.ts` (export the new functions and types)
- Modify: `packages/venue-service/src/operations.ts:746-783` (`DepartmentEditInput.serviceSteps?`;
  `saveDepartmentEditSettings` calls `saveServiceSteps` after `updateDepartment`)
- Modify: `packages/venue-service/src/routes.ts` (`requireServiceSteps` near `:202` — it checks an
  entry's keys itself and does not call `onlyKeys`, which would name the extra key rather than the
  entry, `packages/venue-service/src/request-keys.ts:5-8`; `serviceSteps` joins the body's
  `onlyKeys` list at `:819-827`; the body at `:830-852`; the GET model at `:706-731`; `STATUS`
  gains `"service_step.not_found": 404` and `"course.not_found": 404`, `:95-150`)
- Modify: `packages/venue-service/src/errors.ts` (declare `"service_step.not_found": { stepId: string }`
  and `"course.not_found": { courseId: string }`, Decision 8)
- Test: `packages/venue-service/src/routes.test.ts` (new cases in `describe("whole service settings saves")`, `:297`)

**Interfaces — produces:**
- `type ServiceStep = { id: string; departmentId: string; name: string; start: ServiceStepStart; courseId: string | null; minutes: number }`
- `type ServiceStepInput = { id?: string; name: string; start: ServiceStepStart; courseId: string | null; minutes: number }`
- `listServiceSteps(tx, cfg: VenueScope): Promise<ServiceStep[]>` — active departments of
  `cfg.locationId`, `order by department_id, position, id`.
- `listStepCourses(tx, cfg): Promise<{ id: string; name: string }[]>` — active `kitchen_courses` of
  `cfg.locationId`, `order by display_order, name`.
- `saveServiceSteps(tx, cfg, departmentId, steps: readonly ServiceStepInput[]): Promise<void>` —
  checks ids (each a step of this department, else `service_step.not_found` `{ stepId }`) and
  courses (each a live course of the venue, else `course.not_found` `{ courseId }`) before writing
  anything (the same id twice is refused by the route, Decision 8); then deletes the department's steps not sent, updates each sent one
  (`name`, `start`, `courseId`, `minutes`, `position` = its index), inserts the new ones.
- GET model gains `serviceSteps` and `courses` (Decision 8). PUT accepts optional `serviceSteps`.

- [ ] **Step 1: Write the failing tests.** `service-steps.test.ts` (setup as `operations.test.ts`):
  - `"lists each active department's steps in order, and none of a deleted department"`.
  - `"lists the venue's live courses in firing order"` — two courses, one inactive.
  - `"keeps a renamed or moved step's id, deletes one not sent, and gives a new one an id"` — save
    three; save again with the second renamed and moved first, the first dropped, a new one added;
    read back: ids of the kept step unchanged, the dropped id gone, positions 0..n-1.
  - `"refuses a step id of another department, naming it, and writes nothing"` →
    `toMatchObject({ code: "service_step.not_found", params: { stepId } })`;
    `"refuses a course that is inactive or of no venue, naming it, and writes nothing"` →
    `toMatchObject({ code: "course.not_found", params: { courseId } })`; each with the
    department's rows unchanged (read before and after).
  - `"an empty list deletes the department's steps"`.
  In `routes.test.ts`, using `settingsFixture()` and `departmentSettings` (`:230-268`):
  - `"saves a department's service steps and lists them in the model"` — PUT with
    `{ ...departmentSettings, serviceSteps: [three rows, one course_served naming a course the test makes] }`
    → 204; GET model `serviceSteps` `toEqual` the three with ids, `courses` lists the course.
  - `"leaves the steps as they were when the save does not name them"`.
  - `"refuses a malformed list, naming the field, and writes nothing"` — `it.each` over: `"x"` →
    `serviceSteps`; 21 rows → `serviceSteps`; `[1]` → `serviceSteps.0`; an extra key →
    `serviceSteps.0`; `id: "nope"` → `serviceSteps.0.id`; name `"  "` → `serviceSteps.0.name`;
    start `"later"` → `serviceSteps.0.start`; first row `after_previous` → `serviceSteps.0.start`;
    `courseId` on a `seated` row and missing on a `course_served` row → `serviceSteps.<i>.courseId`;
    minutes `121`, `-1`, `2.5`, `"2"`, and `0` with `since_last_order` → `serviceSteps.<i>.minutes`;
    the same id in two entries → `serviceSteps.1.id`.
    Each: 400, `toEqual({ error: { code: "management.request_invalid", params: { field } } })`,
    and `rawSettingsSnapshot()` (`:283`) unchanged plus the department's steps unchanged.
  - `"answers 404 naming a step another manager deleted, and a course deleted meanwhile"` — the two
    database refusals through the route: 404 with `service_step.not_found` `{ stepId }` and
    `course.not_found` `{ courseId }`.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/venue-service exec vitest run --project node src/service-steps.test.ts src/routes.test.ts`
- [ ] **Step 3: Implement** the reads, the save, the route validation and the model fields. Names
  are stored trimmed.
- [ ] **Step 4: Run Step 2's command** — PASS.
- [ ] **Step 5:** typecheck `@waitron/venue-service`, prettier, commit —
  `"The department save reads and writes its service steps, keeping each step's id (A757 slice 7)"`.

**Assertions changed:** none. **Fixtures grown:** none on the server (the dashboard model
fixtures grow in Task 5).

### Task 3: a new department starts with the starter set

**Files:**
- Modify: `packages/venue-service/src/service-steps.ts` (add `addStarterServiceSteps(tx, cfg, departmentId)`)
- Modify: `packages/venue-service/src/operations.ts:183-215` (`createDepartment` calls it after the sale-policy insert)
- Modify: `packages/venue-service/src/provisioning.ts:17-71` (call it only when the seed inserts the
  department — restructure the `replacement?.id ?? (await tx.insert(...))` expression so the insert
  branch is a branch; update `summary`)
- Modify: `apps/server/scripts/demo-seed/seed-floor.ts:78-91` (the deli gets it)
- Modify (test setup): `apps/server/src/testing/clear-provision-fixture.ts` (`"service_steps"`
  before `"departments"`; Whole-suite measurement)
- Test: `packages/venue-service/src/service-steps.test.ts`, `packages/venue-service/src/provisioning.test.ts`,
  `apps/server/scripts/demo-seed/seed-floor.test.ts`

**Interfaces — produces:** `addStarterServiceSteps` reads `locations.invoice_locales` for
`cfg.locationId`; language subtag `en` → `Set up` (seated, 0), `Take order` (after_previous, 2),
`Anything else?` (all_served, 10); any other → `Montar mesa`, `Tomar nota`, `¿Algo más?` with the
same starts and minutes (Decision 5).

- [ ] **Step 1: Write the failing tests.**
  - `service-steps.test.ts`: `"a department created in an English venue starts with Set up, Take order and Anything else?"`
    (`update locations set invoice_locales = '["en"]'` first) — `listServiceSteps` for it `toEqual`
    the three with their starts and minutes; `"…in a Spanish venue starts with Montar mesa, Tomar nota and ¿Algo más?"`;
    `"a venue whose first receipt language is neither starts with the Spanish names"` (`["fr"]`).
  - `provisioning.test.ts`: `"the seed gives the department it creates the starter steps"`;
    `"a second run of the seed puts back no step the venue deleted"` (seed, delete the steps, seed
    again → none); `"the seed adds no steps to the department it promotes to default"` (an active
    department inserted directly with no steps, no default → seed → still none).
  - `seed-floor.test.ts`: `"each demo department starts with the three starter steps"`.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/venue-service exec vitest run --project node src/service-steps.test.ts src/provisioning.test.ts`
  and `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed-floor.test.ts`
  (the server's Vitest config sets no `include`, so Vitest's default `**/*.test.ts` takes
  `scripts/demo-seed/` too, `apps/server/vitest.config.ts:3-31`).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run Step 2's commands** — PASS. Then the suites Decision 5 measured:
  `pnpm --filter @waitron/venue-service exec vitest run --project node` and
  `pnpm --filter @waitron/provisioning exec vitest run`, the server files Decision 5 names, and
  `src/provision.test.ts` (fails without the setup change above, `Tests 22 passed` with it). The
  whole server suite was measured with this change (Whole-suite measurement); a failure outside
  what it lists is a stop.
- [ ] **Step 5:** typecheck `@waitron/venue-service` and `@waitron/server`, prettier, commit —
  `"A new department starts with Set up, Take order and Anything else? (A757 slice 7)"`.

**Assertions changed:** none. **Fixtures grown:** none; one test setup list grows
(`clear-provision-fixture.ts`).

### Task 4a: deleting a course deletes the steps that start from it

An implementer past about 150 tool calls with this task unfinished stops at a passing or cleanly
red point, commits, and returns a handover (done, left, files, each check's state); a fresh
implementer continues from it.

**Files:**
- Create: `packages/venue-service/src/course-delete-settings.ts` (`readCourseDeleteSettings(tx, cfg, courseId): Promise<DeleteImpactItem[]>`,
  `clearCourseDeleteSettings(tx, cfg, courseId): Promise<void>`), its test
  `packages/venue-service/src/course-delete-settings.test.ts`; export both from `src/index.ts`
  beside `readStationDeleteSettings` (`:71-75`)
- Modify: `apps/server/src/course-delete.ts:27-85` (`courseDeleteRules` adds the items to
  `removes`; `deleteCourse` calls `clearCourseDeleteSettings` after `retained` is worked out and
  before the deactivation — a course a step named is always retained, Decision 3)
- Create: `apps/server/src/course-delete.service-steps.test.ts` (not `course-delete.test.ts`, which
  lane G edits — Decision 11)
- Modify: `apps/dashboard/src/widgets/course-delete-copy.ts` (`item` chooses its text by
  `item.key`), `apps/dashboard/src/widgets/count-text.ts` (the key union),
  `apps/dashboard/src/i18n/strings.ts` after `:1276` and `:4284`:
  `"kitchen.delete_course_service_steps": "{count} service steps that start when it is served."`,
  `_one`: `"1 service step that starts when it is served."`;
  `"kitchen.delete_course_seated_steps": "{count} service steps now start When seated."`,
  `_one`: `"1 service step now starts When seated."`; ES
  `"{count} pasos de servicio que empiezan al servirlo."`, `"1 paso de servicio que empieza al servirlo."`,
  `"{count} pasos de servicio pasan a empezar Al sentarse."`, `"1 paso de servicio pasa a empezar Al sentarse."`
- Modify: `apps/dashboard/src/api/live-queries.ts:478` (`getCourseDeleteImpact` gains `"service_steps"`)
- Test: the course delete dialog's dashboard test (find it: `git grep -ln courseDeleteCopy -- apps/dashboard/src`)

**Interfaces — produces:** `readCourseDeleteSettings` answers, with zero counts dropped,
`[{ key: "course_service_steps", count, targets: [] }, { key: "course_seated_steps", count, targets: [] }]`
— the second counts the departments whose first step left after the deletion starts
`after_previous` (Decision 3). `clearCourseDeleteSettings` deletes the steps naming the course,
then, for each department it touched, sets `start = 'seated'` (minutes kept) on the first remaining
step (`order by position, id`) when it starts `after_previous`.

- [ ] **Step 1: Write the failing tests.**
  - `course-delete-settings.test.ts`:
    `"counts the steps that start when the course is served, in every department"` (steps in two
    departments) → `[{ key: "course_service_steps", count: 2, targets: [] }]`;
    `"reports nothing when no step names it"` → `[]`; `"clears them and leaves other steps"`;
    `"a step left first that started after the step before now starts When seated, its minutes kept"`
    — [Dessert? · course_served · 10, Coffee · after_previous · 5]; read → also
    `{ key: "course_seated_steps", count: 1, targets: [] }`; clear → Coffee is `seated`, 5 minutes;
    `"a step that stays below another keeps After the step before"` — [Set up · seated,
    Dessert? · course_served, Coffee · after_previous] → Coffee unchanged, no `course_seated_steps`;
    `"a first step that does not start after the step before is left as it is"` —
    [Dessert? · course_served, Anything else? · all_served] → unchanged.
  - `course-delete.service-steps.test.ts` (setup as `course-delete.test.ts`: `useVenueDb`,
    `setupPartyVenue`, `inTx`): `"deleting a course nothing names deletes the row outright"`;
    `"deleting a course only a step names deletes the step and keeps the course inactive, as a product default does"`
    (the department's other steps stay; Decision 3);
    `"deleting a course an order still names keeps it inactive and still deletes its steps"`
    (a working-order line names the course first, as `course-delete.test.ts`'s retained cases do);
    `"the delete impact lists the steps beside the product defaults"` — `readCourseDeleteImpact`'s
    `removes` `toEqual([{ key: "course_products", … }, { key: "course_service_steps", count: 1, targets: [] }])`;
    `"after the delete the venue's export still imports"` — the Dessert?/Coffee case, then
    `validateConfigurationBundle` (`apps/server/src/configuration-transfer.ts:591`) on a bundle
    built from the venue does not throw (build it as `configuration-transfer.test.ts`'s cases do).
  - Dashboard: the course delete copy renders `1 service step that starts when it is served.` for a
    `course_service_steps` item, `1 service step now starts When seated.` for a
    `course_seated_steps` item, and keeps the product sentence for `course_products`.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/venue-service exec vitest run --project node src/course-delete-settings.test.ts`,
  `pnpm --filter @waitron/server exec vitest run src/course-delete.service-steps.test.ts src/course-delete.test.ts`,
  and the dashboard test file (a browser run; check memory first).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run Step 2's commands, plus**
  `pnpm --filter @waitron/server exec vitest run src/in-use-references.test.ts src/kitchen-delete.integration.test.ts src/management-api.kitchen-delete.test.ts`
  and `pnpm exec vitest run scripts/live-subscriptions.test.ts` — PASS.
- [ ] **Step 5:** typecheck `@waitron/venue-service`, `@waitron/server`, `@waitron/dashboard`;
  prettier; commit — `"Deleting a course deletes the service steps that start from it, and says so (A757 slice 7)"`.

**Assertions changed:** none. **Fixtures grown:** none.

### Task 4b: deleting a department deletes its steps

An implementer past about 150 tool calls with this task unfinished stops at a passing or cleanly
red point, commits, and returns a handover (done, left, files, each check's state); a fresh
implementer continues from it.

**Files:**
- Modify: `packages/venue-service/src/service-delete-settings.ts` (the `service_steps` item after
  `department_policy`, `:338`; the delete beside `departmentSalePolicies`, `:440-442`)
- Modify: `packages/venue-service/src/dashboard/service-delete-copy.ts:24` and `strings.ts`
  (`"venue.delete_item_service_steps": "Removes {count} service steps."` /
  `"Quita {count} pasos de servicio."`, beside `venue.delete_item_department_policy`, `:36`, `:908`)
- Test: `packages/venue-service/src/service-delete-settings.test.ts`,
  `apps/server/src/management-api.service-delete.test.ts:187`, and the venue-service dashboard test
  that renders `service-delete-copy` items (`git grep -ln serviceDeleteCopy -- packages/venue-service/src/dashboard`)

- [ ] **Step 1: Write the failing tests.**
  - `service-delete-settings.test.ts`: `"lists and deletes a deleted department's service steps"`
    (and another department's steps stay).
  - Dashboard: the service delete copy renders `Removes 3 service steps.`
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/venue-service exec vitest run --project node src/service-delete-settings.test.ts`,
  `pnpm --filter @waitron/server exec vitest run src/management-api.service-delete.test.ts`, and the
  dashboard test file (a browser run).
- [ ] **Step 3: Implement**, then change the one assertion below.
- [ ] **Step 4: Run Step 2's commands, plus** `pnpm --filter @waitron/server exec vitest run src/service-delete.history.test.ts src/service-delete.integration.test.ts src/service-delete.disabled-bookings.test.ts src/floor-delete.test.ts src/floor-delete.bookings.test.ts src/delete-impact.test.ts`
  — PASS.
- [ ] **Step 5:** typecheck `@waitron/venue-service`, `@waitron/server`; prettier; commit —
  `"Deleting a department deletes its service steps and says so (A757 slice 7)"`.

**Assertions changed** (the spec's steps belong to a department, and Decision 4 deletes them with
it): `apps/server/src/management-api.service-delete.test.ts:187` — the department case's expected
`removes` gains `{ key: "service_steps", count: 3, targets: [] }` after `department_policy`
(measured, Decision 4). Anything else red is a stop. **Fixtures grown:** none.

### Task 5: the dialog's model and save carry the steps (no list drawn yet)

**Files:**
- Create: `packages/venue-service/src/dashboard/service-step-draft.ts` — the draft's row shape and
  its helpers, so Tasks 6 and 7 import them and do not reshape the draft:
  `type ServiceStepDraft = { key: string; id: string | null; name: string; start: ServiceStepStart; courseId: string | null; minutes: string }`
  (`minutes` is text so a blank or a fraction can be shown and refused; `key` is the saved id, or
  one made when a row is added); `toStepDrafts(rows: ServiceStep[]): ServiceStepDraft[]`;
  `stepsEqual(a, b)` (entry by entry, in order: `id`, trimmed `name`, `start`, `courseId`, and
  `minutes` compared as the numbers they spell when both are whole numbers, else as trimmed text);
  `toStepInputs(drafts): ServiceStepInput[]` (`id` left out when null, names trimmed, minutes as
  numbers). Its own test file, `service-step-draft.test.ts` (node or browser project, wherever the
  package's other pure dashboard helpers are tested).
- Modify: `packages/venue-service/src/dashboard/client.ts` (`VenueServiceModel` gains
  `serviceSteps: ServiceStep[]` and `courses: { id: string; name: string }[]`;
  `DepartmentSettingsInput` gains the **optional** `serviceSteps?: ServiceStepInput[]`)
- Modify: `packages/venue-service/src/dashboard/department-settings.ts` — the draft becomes
  `DepartmentDraft = Omit<DepartmentSettingsInput, "serviceSteps"> & { serviceSteps: ServiceStepDraft[] }`
  from this task on: `fieldTab.serviceSteps = "service"`; `copy` deep-copies the list; `equal` adds
  `stepsEqual`; `source` in `willUpdate` takes this department's steps from `model.serviceSteps`
  through `toStepDrafts`; `save` adds `serviceSteps: toStepInputs(draft.serviceSteps)` **only when
  `!stepsEqual(draft.serviceSteps, baseline.serviceSteps)`** (Decision 8)
- Modify: `packages/venue-service/src/dashboard/live-queries.ts:229` (`operations` gains
  `"service_steps"`, `"kitchen_courses"`)
- Modify (fixtures, one change each): every model fixture naming `needsClearingDepartmentIds`
  gains `serviceSteps: [], courses: []` — `git grep -l needsClearingDepartmentIds -- packages/venue-service apps/dashboard`
  lists them (2026-10-19: `apps/dashboard/src/dashboard-app.test.ts`,
  `apps/dashboard/src/testing/department-receipt-app-fixture.ts`,
  `packages/venue-service/src/testing/department-zones-fixture.ts`,
  `packages/venue-service/test/service-delete-test-helpers.ts`, and the dashboard test files
  `client.test.ts`, `department-dialogs.a11y`, `department-dialogs`, `department-dialogs.unsaved`,
  `department-edit-dialog-transfers.a11y`, `department-settings.a11y`, `department-settings`,
  `department-settings.unsaved`, `departments-list-readiness.a11y`, `departments-list.a11y`,
  `departments-list`, `index`, `venue-departments-shell.actions`, `venue-departments-shell`,
  `venue-departments-shell.unsaved`, `venue-navigation`, `venue-operations-loader` under
  `packages/venue-service/src/dashboard/`)
- Test: `service-step-draft.test.ts`, `department-settings.test.ts`, `client.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - `service-step-draft.test.ts`: `toStepDrafts` keys each row by its id and turns minutes into
    text; `stepsEqual` is true for the same rows, and false for a renamed, moved, added or removed
    row, a changed start or course, or minutes `"2"` against `"3"`; true for `"2"` against `"02"`
    and for names differing only in outer spaces; `toStepInputs` leaves out a null id, trims names
    and turns minutes into numbers.
  - `department-settings.test.ts`, through the dialog's public surface only (the `model` property,
    the name field, Save — no private method):
    `"a save that does not touch the steps sends none"` — model with two steps for d1 (one naming a
    course in `courses`) and one for d2; change the name field; Save; the body
    `not.toHaveProperty("serviceSteps")`.
  - `client.test.ts`: `"saveDepartmentSettings sends the steps when given"` — the PUT body carries
    `serviceSteps` as passed.
  The cases that need a step edited — the steps sent when they change, following another
  dashboard's change while clean, and the new ids after a save — are Task 7's, once the list can be
  edited.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/service-step-draft.test.ts src/dashboard/department-settings.test.ts src/dashboard/client.test.ts`
  (browser runs; check memory first).
- [ ] **Step 3: Implement**, update the fixtures.
- [ ] **Step 4: Run the whole venue-service dashboard and the dashboard app.**
  `pnpm --filter @waitron/venue-service exec vitest run --project browser` and
  `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test.ts src/dashboard-app.receipt-tab.test.ts`.
  **No exact save body should change:** a save that leaves the steps alone sends no
  `serviceSteps`, so the existing exact department-save bodies stay as they are. Re-grepped
  2026-10-19 (`git grep -n "needsClearing: false" -- packages/venue-service/src/dashboard apps/dashboard/src`),
  they are `client.test.ts:423` (the input) and `:442` (the body), `department-edit-dialog.test.ts:55`,
  `department-settings.test.ts:246`, `department-settings.unsaved.test.ts:484`, `:544`, `:617`,
  `:703`, `venue-departments-policy.test.ts:153` and `venue-departments-shell.actions.test.ts:510`.
  Any of them turning red, or any other red case, is a stop. Then
  `pnpm exec vitest run scripts/live-subscriptions.test.ts`.
- [ ] **Step 5:** typecheck `@waitron/venue-service` and `@waitron/dashboard`; prettier; commit —
  `"The department dialog loads its service steps and saves them only when they change (A757 slice 7)"`.

**Assertions changed:** none. **Fixtures grown:** the model fixtures listed gain
`serviceSteps: []` and `courses: []`.

### Task 6: the step list component, on its own

An implementer past about 150 tool calls with this task unfinished stops at a passing or cleanly
red point, commits, and returns a handover (done, left, files, each check's state); a fresh
implementer continues from it.

**Files:**
- Create: `packages/venue-service/src/dashboard/department-service-steps.ts`,
  `department-service-steps.test.ts`, `department-service-steps.a11y.test.ts`
- Modify: `packages/venue-service/src/dashboard/strings.ts` (the keys below, EN and ES, from
  Global constraints)

**Interfaces — produces:** `<department-service-steps>` with properties
`steps: ServiceStepDraft[]` (Task 5's `service-step-draft.ts`), `courses: { id; name }[]`,
`errors: Record<string /* key */, Partial<Record<"name" | "start" | "minutes", string>>>`,
`listError: string`, `disabled: boolean`; event `steps-change` (`detail: { steps }`, `bubbles`,
`composed`); inner `wt-change` events are stopped. Keys: `venue.service_steps`,
`venue.service_step`, `venue.service_step_starts`, `venue.service_step_minutes`,
`venue.service_step_min`, `venue.service_step_start.seated`, `.after_previous`, `.course_served`
(`{course} served`), `.all_served`, `.since_last_order`, `venue.add_service_step`,
`venue.no_service_steps`, `venue.reorder_service_step`, `venue.service_step_reordered`,
`venue.service_step_minutes_invalid`, `venue.service_step_minutes_repeat`,
`venue.service_step_first_after_previous`, `venue.service_step_course_gone`.

- [ ] **Step 1: Write the failing tests** (`department-service-steps.test.ts`, mounted bare with
  English strings unless stated):
  - `"draws each step's name, start and minutes under Step and Starts"` — the picture's four rows
    (Set up / When seated / 0; Take order / After the step before / 2; Dessert? / Mains served /
    10, with a course "Mains"; Anything else? / Everything served / 10): column heads `Step`,
    `Starts`; each combobox's shown label; the minutes' unit `min`.
  - `"offers the five starts, one per course in the order given"`.
  - `"says No service steps. when there are none"`.
  - `"typing a name, choosing a start or changing minutes sends the whole list"` — `steps-change`
    detail; choosing `{course} served` sets `courseId`; choosing another start clears it.
  - `"Add step adds an empty row, When seated in an empty list and After the step before otherwise, and focuses its name"`.
  - `"Add step is disabled at 20 steps"`.
  - `"Delete in the row menu removes the step and moves focus to the next name, or to Add step"`.
  - `"moves a step with the keyboard and announces its place"` — the handle's keyboard move (as
    `course-list.test.ts` drives it), `steps-change` with the new order, the announcement
    `{name} is now 2 of 4.`.
  - `"drags a step into place"` — pointer, as `option-list-form`'s tests drive the controller.
  - `"shows each error under its own field"` — `errors` for a name and a minutes field;
    `aria-invalid` on both; `listError` under the list.
  - `"draws one table row per step, in order, keyed by the step's key"` — the `<tbody>`'s `<tr>`s
    carry the keys in `steps` order (what the controller reads).
  - `"read-only: no handles, no menus, no Add step, fields disabled"`.
  - `"reads in Spanish"` — `Pasos de servicio`, `Paso`, `Empieza`, `Al servir Principales`,
    `Añadir paso`; restore the language after (CLAUDE.md §4).
  `department-service-steps.a11y.test.ts`: axe in both themes for the list with rows, the empty
  list, a row with errors, and the read-only list (as `courses-screen.a11y.test.ts` does).
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/department-service-steps.test.ts src/dashboard/department-service-steps.a11y.test.ts`
- [ ] **Step 3: Implement.** The list is a `<table>` with one `<tr>` per step's `key` in its
  `<tbody>`, in `steps` order — `ReorderController` requires it (`packages/ui/src/reorder-table.ts:105-108`)
  — styled with `ReorderController.styles` and `.tableStyles` as `course-list.ts` is (`:50-53`).
  Three cells per row: handle; one cell whose flex box (`flex-wrap: wrap`) holds the name, start and
  minutes; the row menu. At 390 px the box wraps inside its cell — the name on its own line, the
  start and minutes on the next — so the row stays one `<tr>` and nothing scrolls sideways; Task 9
  looks. A new row's `key` comes from `crypto.randomUUID()`. Use `wt-input`, `wt-combobox`,
  `wt-row-actions`, `wt-button` — no native `<select>`/`<input>` (`scripts/native-form-fields.test.ts`);
  every colour and space from a `--wt-*` token.
- [ ] **Step 4: Run Step 2's command** — PASS; then `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/style-token-names.test.ts`.
- [ ] **Step 5:** typecheck `@waitron/venue-service`, prettier, commit —
  `"A service step list: add, edit, reorder and delete steps (A757 slice 7)"`.

**Assertions changed:** none. **Fixtures grown:** none.

### Task 7: the Service tab shows the list, checks it, and maps refusals

An implementer past about 150 tool calls with this task unfinished stops at a passing or cleanly
red point, commits, and returns a handover (done, left, files, each check's state); a fresh
implementer continues from it.

**Files:**
- Modify: `packages/venue-service/src/dashboard/department-settings.ts` (the draft already has
  Task 5's shape; this task adds the `<h4>` and `<department-service-steps>` after the Needs
  clearing block, `:694-712`, wiring `steps-change` into the draft; the validation in `errors`,
  `:431-436`; refusal mapping in `fieldRefusal`, `:437-473`, for the codes of Decision 10;
  `showFirstInvalid` reaches the list's marked field)
- Test: `department-settings.test.ts`, `department-settings.unsaved.test.ts`,
  `department-settings.a11y.test.ts`

- [ ] **Step 1: Write the failing tests** in `department-settings.test.ts`:
  - `"shows Service steps under Table states, below Needs clearing, with this department's steps"`.
  - `"adding a step enables Save; saving sends the whole list, the new step without an id"`.
  - `"follows a change to the steps another dashboard makes while the form is clean, and keeps the draft while it is not"`.
  - `"after a save, the model's copy with the new step's id replaces the clean draft, and the next step change sends that id"`.
  - `"changing a step and changing it back sends no steps"` — then change the name and Save: the
    body `not.toHaveProperty("serviceSteps")`.
  - `"a blank name, a fraction of a minute, 0 for a repeating step and a first step after the step before are each marked after Save, and Save stays disabled until fixed"`
    — one case per rule; the message under the field; the bottom message; Save disabled; fixing it
    enables Save.
  - `"a step whose course another dashboard deleted is marked That course was deleted. Choose another start."`
    — dirty draft naming course c1; a model update without c1; Save attempted → marked; choosing
    Everything served clears it.
  - `"a refusal naming a step's field, sent while Details shows, brings back Service, marks that field and focuses it"`
    — PUT 400 `management.request_invalid` `{ field: "serviceSteps.1.name" }` → the refused words
    under that name; `{ field: "serviceSteps.0.courseId" }` → the refused words (not the
    deleted-course message) under the start; `{ field: "serviceSteps" }` → the list's message. Save
    not disabled by the refusal alone.
  - `"a course deleted meanwhile is named under every step that starts from it"` — PUT 404
    `course.not_found` `{ courseId: c1 }` → `That course was deleted. Choose another start.` under
    each submitted row naming c1, and nowhere else.
  - `"a step another manager deleted says so, and Cancel brings back the latest"` — PUT 404
    `service_step.not_found` → `A step was changed elsewhere. Cancel to see the latest.` under the
    list; Cancel → the model's steps and a quiet Save.
  - `"the read-only dialog shows the steps without handles, menus or Add step"`.
  - `"reads in Spanish"` — `Pasos de servicio` under `Estados de la mesa`.
  In `department-settings.unsaved.test.ts`:
  `"adding, renaming, moving or deleting a step dirties the form, undoing it cleans it, and leaving asks only while dirty"`.
  In `department-settings.a11y.test.ts`: the Service tab with steps, in both themes, and with a
  marked step field.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/department-settings.test.ts src/dashboard/department-settings.unsaved.test.ts src/dashboard/department-settings.a11y.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the whole venue-service browser project and the dashboard app** (commands of
  Task 5 Step 4) — PASS, nothing else red.
- [ ] **Step 5:** typecheck `@waitron/venue-service`, `@waitron/dashboard`; prettier; commit —
  `"The department dialog's Service tab lists its service steps under Table states (A757 slice 7)"`.

**Assertions changed:** none. **Fixtures grown:** none beyond Task 5's.

### Task 8: docs

**Files:** `docs/superpowers/specs/2026-10-17-a757-table-states-design.md`, `docs/backlog.md`
(A757 at `:2073-2085`, A893 at `:2087-2090`), `docs/backlog/till.md` (A757 at `:1292-1350`),
`docs/developers/design-system.md` (the Service tab's sections, the line slice 1 changed — find it
with `git grep -n "Table states" docs/developers/design-system.md`),
`docs/superpowers/specs/2026-10-16-a664-personal-data-audit.md`,
`docs/superpowers/specs/2026-10-16-a664-retention-table-inventory.md`.

- [ ] **Step 1: The spec.** Status line: "slices 1 and 7 built; 2–6 and 8 left (§11)" (or whatever
  is true when this lands — check `git log --oneline main | grep A757`). Under §8's "What it
  stores", a dated line: "**2026-10-19:** slice 7 stores the steps in `service_steps` (plan
  `docs/superpowers/plans/2026-10-19-a757-7-service-step-settings.md`): five starts, minutes 0–120
  (at least 1 for the repeating start), a course start names a `kitchen_courses` row and goes when
  that course is deleted; a new department starts with the three starter steps, named in the
  venue's first receipt language. Each party's done steps are slice 8's."
- [ ] **Step 2: `docs/backlog.md`'s A757 entry:** "Slice 1, Needs clearing per department, landed
  (…); slices 2–8 are left" → "Slices 1 (Needs clearing per department) and 7 (service steps: the
  settings) landed (plans `…a757-1-…`, `…a757-7-…`); slices 2–6 and 8 are left (design §11)." A893's
  "(slices 2–8 are left)" → "(slices 2–6 and 8 are left)". If slice 7's open questions are not
  answered by landing, add one short entry under the till area for them (id from
  `~/waitron-campaign-shared/next-item-number`: read, use, write back), linking this plan's "Open
  questions".
- [ ] **Step 3: `docs/backlog/till.md`'s A757 section:** the sentence naming slice 1 gains "slice 7,
  the service steps' settings in the department dialog's Service tab, landed (plan …)".
- [ ] **Step 4: `design-system.md`:** the Service tab's "Table states" section now holds "the Needs
  clearing switch and the department's service steps (a list with drag handles, a row menu with
  Delete, and Add step)".
- [ ] **Step 5: The A664 documents:** one dated line each under the venue-service table
  (Decision 6).
- [ ] **Step 6: Check for missed claims.**
  `git grep -n -i -E "service step|check-back" -- docs/backlog.md docs/backlog docs/developers apps/server/src/guide`
  — every hit about where steps are set or what exists today is true after this slice, or is
  history inside a dated plan or spec (left alone). `pnpm exec prettier --file-info <file>` on each
  changed doc (`docs/` is ignored whole).
- [ ] **Step 7: Commit** — `"Docs: A757 slice 7, service steps per department, is built"`.

### Task 9: LOOK — the Service tab's steps in real Chromium

**Files:** a throwaway test in `apps/dashboard/src/` (deleted, never committed); pictures in
`/Users/clintongormley/waitron-campaign-c/a757-7-shots/`; notes in
`/Users/clintongormley/waitron-campaign-c/a757-7-look-report.md`, following
`/Users/clintongormley/waitron-campaign-c/a757-1-look-report.md` if it exists, else
`/Users/clintongormley/waitron-campaign-c/a756-3-look-report.md`.

- [ ] **Step 1:** Mount the whole dashboard with `mountReceiptApp`
  (`apps/dashboard/src/testing/department-receipt-app-fixture.ts`), as slice 1's LOOK did, with a
  model holding picture 10's four steps for the department and a course "Mains", at
  `path: "/manage/venue-operations/department/bar/view/service"`. For each of light and dark (the
  `data-theme` on the `[data-wt-theme-root]` element) and `page.viewport(1280, 900)` and
  `page.viewport(390, 900)`: a picture of the list as loaded (Save quiet); one with the start
  combobox open on the Dessert? row; one after Add step and a Save attempt with the new name blank
  (the error under the field, Save disabled); one with a row menu open —
  `steps-<width>-<theme>-<state>.png`. Read `window.innerWidth` and record it.
- [ ] **Step 2:** Look at every picture beside picture 10. Check: "Service steps" sits under the
  Needs clearing block inside Table states; the rows read as picture 10's do; at 390 nothing scrolls
  sideways (`document.documentElement.scrollWidth` equals the viewport width) and each row's
  controls stay reachable; handles, menus, the unit and the error text are readable in dark. Write
  per-picture notes and any concern into the report. A defect found is fixed with a failing test
  first, in the component's own test file, and committed.
- [ ] **Step 3:** Delete the throwaway test; `git status` shows it gone.

---

## Open points for the owner at land

Where the build departs from picture 10, and why:

1. **Delete is in each row's ⋮ menu, not a trash icon beside the row.** The design system puts
   Delete "in each row's menu" (`docs/developers/design-system.md:4636-4642`); A756's approved
   Courses page does the same (`docs/backlog/mockups/a756-kitchen-settings/02-courses-page.png`);
   and no trash icon is registered (`git grep -n '"trash"' -- packages/ui packages/ui-core` finds
   none).
2. **The button reads "Add step", not "+ Add step".** The spec says the pictures' symbols stand in
   for icons (spec lines 11-14), and the Courses page's button reads "Add course" with no "+".
3. **Each row has two fields for its start — a start list and a minutes box — where the picture
   draws one box reading "When seated · 0 min".** Editing needs both values; one box would have to
   be a new kind of field primitive (CLAUDE.md §3: a screen does not draw its own field). The row
   still reads in the picture's order: name, start, minutes.

The candidate owner points this plan builds with a default:

4. **The fifth start's wording:** "Repeats after the last order" (Spanish "Se repite tras el último
   pedido"), with the other Spanish words in Global constraints.
5. **A department added later also gets the starter set** (Decision 5), on the spec's "a bar that
   does not visit tables deletes them all".
6. **Deleting a course deletes its steps** rather than refusing the delete, and a step left first
   with "after the step before" becomes When seated (Decision 3); the delete window lists both.

## Open questions (each with the default this plan uses)

1. **Words the picture does not draw** (Global constraints): the fifth start's label (default
   `Repeats after the last order` / `Se repite tras el último pedido`), the Spanish starter names
   (default `Montar mesa`, `Tomar nota`, `¿Algo más?`) and the Spanish labels. Built with the
   defaults; a candidate owner question for the watcher to batch, since changing a string later
   costs one line.
2. **Starter names in the venue's language** (Decision 5) rather than English everywhere, as
   seasons are. Default: the venue's first receipt language, as device profiles are named. A
   storage-free choice; not put to the owner.
3. **A department added later gets the starter set** (Decision 5), on the spec's "a bar that does
   not visit tables deletes them all". Default: yes. Not put to the owner unless the review
   disagrees.
4. **Deleting a course deletes its steps** rather than refusing (Decision 3). Default: delete, listed
   in the dialog. A behaviour choice inside the build; the owner sees it at land.
