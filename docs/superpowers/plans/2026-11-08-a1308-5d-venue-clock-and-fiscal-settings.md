# A1308 slice 5d: the venue's clock, fiscal territory and operation description leave `locations` — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Every rule in
> [the slice rules](2026-11-08-a1308-slice-rules.md) applies ("rules §n"). The sweep's order and
> shared words: [5a](2026-11-08-a1308-5a-service-and-staff-location-columns.md#the-location-sweep-in-one-place).
> The 1b-i API names: [5b](2026-11-08-a1308-5b-venue-document.md#the-api-this-slice-uses-slice-1b-i-exact-names).

**Lands: the owner** (rules §6), for four reasons, each a value on a fiscal path whose storage moves:

1. **The time zone** sets every invoice's time offset since A696: `readIssueZone` reads it through
   `readVenue` (`packages/fiscal/src/issue-clock.ts:7-13`) and `prepareIssueClock` freezes the offset
   that `FechaHoraHusoGenRegistro` carries and the huella hashes (`:14-28`; A1301 design §2.4). The
   rules name it (§6).
2. **The operation description** reaches AEAT as `DescripcionOperacion` when a caller supplies none
   (`operationDescriptionFor`, `packages/core/src/operation-description.ts:4-7`). One production
   caller supplies none: the fiscal readiness test sale
   (`packages/provisioning/src/fiscal-readiness-runner.ts:112-138`), which files to AEAT's test
   environment. (The corrective remedy's one production caller refuses a missing or empty description
   before it records, `packages/fiscal-verifactu/src/record-remedy-corrective-http.ts:80-95`.) Read,
   not run.
3. **The fiscal territory** chooses the filing module at setup and restore (A1301 design §2.1,
   "decides the fiscal module at setup and restore"; tables-venuebox §7, "`nodes.filing_module` is
   chosen at setup from `fiscalTerritory`").
4. **One edit to the fiscal pair's set-up** (item 6): A1301 kept both files unedited; this slice
   must change five set-up lines of `write-path.e2e.test.ts` (32 and 552–555). **Owner, 2026-11-09:**
   accepted (no assertion changes); the pull request's second line still states it.

The rest of the sweep (5e) can then be landed by the lane.

**Pull request's first line:** "Every venue is reset: core; backups from before this cannot be restored." Configuration exports remain version 17 with the same venue fields and existing version 17 exports still import (watcher, 2026-11-11 08:57, Lane H questions.md). Second line: "Owner: this changes five set-up lines of the fiscal
pair's `write-path.e2e.test.ts` (line 32 and lines 552–555); no assertion changes."

**Needs before it:** 5c.

**Watcher correction, 2026-11-11 07:19:** the business-day parser accepts every stored string verbatim, including `""`; only non-strings are refused. The existing saved-zone classifier retains `venue.time_zone_invalid` / `missing`, and input writers keep their validation. This supersedes the non-empty parser requirement and its new empty-string refusal test below. Recorded in Lane H questions.md.

**Watcher correction, 2026-11-11 07:40:** repair the shared fiscal fixture first and keep both protected fiscal files unedited if they pass. The shared helper now seeds the clock document and preserves its original operation description; the unedited pair passes 20 tests (`receipts/a1308-5d/fiscal-pair-helper-green.log`, Lane H). This supersedes the protected-file edit in item 6 and the PR second-line instruction above. The still-used `locationId` brand remains with those protected setup lines. The watcher cleared continuation up to about 2,400 authored additions, excluding the separate pure fixture-script commit; this is watcher clearance, not a new owner approval.

## What it builds

1. **`settings.business_day`, version 1, owned by core** (tables-venuebox §2.2), in
   `packages/db/src/venue-settings.ts`:

   ```ts
   export interface BusinessDaySettings { timeZone: string }  // as stored, never validated
   export const BUSINESS_DAY_SETTINGS: SettingsDocument<BusinessDaySettings>; // module "business_day", version 1, transfers: false
   ```

   `parse` checks only that `timeZone` is a non-empty string: the zone repair must be able to read an
   invalid saved zone (`packages/db/src/venue.ts:19`, "As stored and never validated"); new input is
   still checked by its writers (`venue-details.ts:75-77`, `venue-zone-repair.ts:72`).
   `defaults()` is `{ timeZone: "Europe/Madrid" }` (`DEFAULT_TIME_ZONE`, `schema/tenants.ts:19`), and
   is never served: `readVenue` and `readVenueClock` answer `venue.not_found` when the row is absent
   (setup writes it with the venue document).
   **This row's `revision` is the venue clock's revision** (tables-venuebox §2.2), replacing
   `location_business_day_settings`. A new `readBusinessDayRevision(tx): Promise<number>` in
   `packages/db/src/venue.ts` replaces the four reads of that table:
   `apps/server/src/business-day-start.ts:82`, `venue-zone-context.ts:38`,
   `packages/venue-service/src/business-day-schedule.ts:382-383`,
   `packages/workforce/src/attendance-responses.ts:26`.
2. **`day_cutover_changes`** (tables-venuebox §1.9), core set, classified `state` (as
   `location_day_cutover_changes`, `packages/db/src/classification.ts:105`; the commit cites design
   §5 U1 and A1301 design §2's "Reason for entering the core migration set", rules §9), a change source
   of type `day_cutover_changes`:
   `effective_business_day` (`day("…")`, primary key), `day_cutover` (`timeOfDay("…")`), CHECKs
   `day_cutover_changes_date_ck` and `day_cutover_changes_time_ck` with today's expressions
   (`packages/db/src/schema/business-day-clock.ts:33-40`). `location_business_day_settings` and
   `location_day_cutover_changes` are deleted.
   - **It absorbs `locations.day_cutover`** (tables-venuebox §6.1): setup writes the first row. The
     first row's `effective_business_day` is the constant `FIRST_DAY_START = "2000-01-01"` (exported
     from `venue-settings.ts`), not the day of setup. Reason: the clock treats the earliest row as the
     start for every day before it, so the first row must stay the earliest whatever a test's fixed
     clock or a box clock set back says when the editor adds a change; the editor only ever adds days
     after "today" (`planBusinessDayStart`, `apps/server/src/business-day-changeover.ts:30-67`), so
     any date before the first possible trading day keeps today's meaning exactly.
   - **The clock keeps its shape** (`BusinessDayClock`, `packages/shared/src/business-day-clock.ts:4-8`):
     `readVenueClockAndPlace` (`venue.ts:78-116`) answers `dayCutover` = the first row's cutover and
     `cutoverChanges` = the rows after it, ordered by day, each `HH:MM:00` cut to `HH:MM` as today.
     No reader of the clock changes. **Decided:** with no `day_cutover_changes` row the reader answers
     `venue.not_found` (setup always writes the first row; a venue without one is a fault, the same
     state as no venue).
3. **Writers move with it:**
   - first setup (`venue-apply.ts`, `create-venue`): `saveSettings(tx, BUSINESS_DAY_SETTINGS,
     { doc: { timeZone }, expectedRevision: 0, personId: null })` and the first `day_cutover_changes`
     row; the re-apply comparison (`:265-295`) reads the clock through `readVenueClock`; the
     `requireSavedZones` (`venue-apply.ts:125-133`), which runs before the venue exists and loops over
     zero `locations` rows today, reads `readSettings(db, BUSINESS_DAY_SETTINGS)` and checks the zone
     only when the revision is above 0 (no venue yet: nothing to check, as today);
   - the business-day editor (`business-day-start.ts:173-224`): `pendingScope` and the inserts drop the
     location; `bumpRevision` becomes `saveSettings(tx, BUSINESS_DAY_SETTINGS, { doc: current,
     expectedRevision: model.revision, personId })` — a save of the same document raises the
     revision, which is what the old counter did;
   - venue details (`venue-details.ts:254-263`): a time-zone change saves the document with
     `expectedRevision: model.businessDayClock.revision`;
   - the zone repair (`venue-zone-repair.ts:77-85`): saves the document; its answer's
     `clockRevision` is the revision `saveSettings` returns.
   - **Stale saves keep today's code and words** (coordinator's note 2): the editor's and the repair's
     own revision checks stay (`business-day-start.ts:106-109`, `venue-zone-repair.ts:73-74`) and
     still refuse a stale screen with `venue.business_day_changed`. `saveSettings` is then handed the
     revision the same transaction read, under the venue file's one write lock
     (`packages/db/src/tenancy.ts:35`), so `settings.out_of_date` cannot reach these routes; a case
     pins that a stale `expectedClockRevision` is still answered `venue.business_day_changed`.
4. **Fiscal territory and operation description join `settings.venue`** (tables-venuebox §2.1 for the
   territory). `VenueSettings` gains `fiscalTerritory: string` (not empty) and
   `operationDescription: string`. **The operation description is a temporary field:** the design
   deletes the venue's copy and makes the description a required input to record a sale
   (tables-venuebox §6.5), a fiscal change the venue-and-box area slice owns and the owner lands.
   This slice keeps the value readable until then, so `readVenue(…).operationDescription` and every
   byte `DescripcionOperacion` can carry stay as they are. Why not do §6.5 here: its two production
   callers that pass no description (owner-landing reason 2) need a decision about what they pass,
   which belongs with the department's description column that the same area slice creates
   (tables-venuebox §1.10); and making the field required changes the input of every
   `recordSale`/`recordCorrection`/`recordSubstitution` caller (`git grep -l -P "\brecord(Sale|Correction|Substitution)\(" -- apps packages`
   lists 137 files at `a086eedfb7`), which is a sweep of its own. The field's declaration says, in
   one line, that vb6 removes it ([plan](2026-11-08-a1308-vb6-operation-description.md)).
   Writer: setup (`venue-apply.ts`) only; venue details shows the territory read-only
   (`readOnlyVenueFields`, `venue-details.ts:33-38`) and does not change. `seedVenueSettings`' defaults
   gain `fiscalTerritory: "ES-common"` and `operationDescription: "Restaurant"`. The bundle's `venue` keeps both keys (`configuration-transfer.ts:38-56`),
   so the export format does not change.
5. **`locations` keeps only `id`, `bump_mode` and `fire_control`.** `time_zone`, `day_cutover`,
   `fiscal_territory` and `operation_description` go. `readVenue` reads nothing else from it;
   `venueLocationId` still reads its id until 5h.
6. **The fiscal pair stops reading a location** (before 5e drops `devices.location_id`):
   `packages/fiscal-verifactu/src/write-path.e2e.test.ts:552-555` read the first device's
   `location_id` and seed a second device there. They become one line,
   `const second = await seedDevice(pg.db);` — `seedDevice` already places a device at the venue
   when no location is given (`packages/db/src/testing/seed.ts:95-97`) — and `:32` stops importing
   `locationId as brandLocationId`. The test's assertions (`:557-566`, "files the same huella and
   chain position from two devices, and from no device") do not change. Then the brand has no user:
   `LocationId` and `locationId` leave `packages/shared/src/ids.ts:11,53`, `index.ts:11,24`, and their
   rows in `ids.test.ts:3,23,105-…`; the two other importers unwrap it —
   `apps/server/src/testing/handover-placed-copy.ts:38,47` and `apps/server/src/handover-preparation.test.ts:49,108`
   change `locationId(TENANT_A.locationId)` to `TENANT_A.locationId` and drop the import (the backlog A1301 entry: "The `locationId` brand stays … for the
   fiscal pair's `write-path.e2e.test.ts` alone").
7. **§8.5, measured** (tables-venuebox §8 item 5): two triggers in `packages/db/triggers/core.sql`
   make "a day start in force is history" a database refusal where SQL can know it:

   ```sql
   CREATE TRIGGER day_cutover_changes_no_update
   BEFORE UPDATE ON day_cutover_changes
   FOR EACH ROW
   BEGIN
     SELECT raise(abort, 'day start history cannot change');
   END;
   -- A1325 replaces daily_closes: its pull request changes this trigger in the same pull request.
   CREATE TRIGGER day_cutover_changes_keep_closed
   BEFORE DELETE ON day_cutover_changes
   FOR EACH ROW
   WHEN exists (SELECT 1 FROM daily_closes c
                 WHERE c.business_day >= date(old.effective_business_day, '-1 day'))
   BEGIN
     SELECT raise(abort, 'day start history cannot change');
   END;
   ```

   The message is a constant `DAY_START_HISTORY_REFUSAL` beside the other trigger messages in
   `packages/db/src/trigger-refusals.ts:36-39`. The delete rule is the time-free half of
   `protectHistory` (`business-day-start.ts:116-131`, its `closed` test); the other half (history
   after the boundary) needs the zone and stays in code. Nothing writes an update today (the editor
   deletes and inserts), and the first row is protected by both once a day has been closed. Weaker
   than its name, said at the trigger: a row whose day has passed but which no daily close covers can
   still be deleted by SQL; `protectHistory` refuses it in the product. **Decided:** deleting the first
   row before any daily close exists is not refused by the database (SQL cannot know the day has
   passed without the zone); no product path does it (the editor deletes only days after "today", and
   setup never deletes), and readers would then answer `venue.not_found`.
   **The trigger names `daily_closes`.** A1325 (closing a drawer,
   `docs/superpowers/specs/2026-11-06-a1325-close-a-drawer-design.md`) later replaces that table, so
   A1325's pull request must change this trigger in the same pull request; the one-line comment above
   the trigger says so. This slice owns the pair (vb3 no longer builds one; coordinator, 2026-11-08).
   **Failing result** (the design's): the editor's replace-a-pending-change path is refused. Then
   the design's fallback is to keep the protection in code only; the watcher confirms whether
   `day_cutover_changes_no_update` alone stays.
8. **Live types** (rules §9): `"location_business_day_settings"` → `"settings.business_day"`,
   `"location_day_cutover_changes"` → `"day_cutover_changes"`, and every remaining `"locations"`
   dependency → `"settings.business_day"` (deduplicated: after this slice `locations` holds nothing a
   screen shows). Core's descriptor declares `settings: [VENUE_SETTINGS, BUSINESS_DAY_SETTINGS]`.
   Files: `apps/dashboard/src/api/live-queries.ts`, `apps/dashboard/src/screens/business-day-start-editor.ts:172,178`,
   `apps/dashboard/src/screens/department-receipt-editor.ts:268`, and the dashboard `live-queries.ts`
   of adjustments, venue-service and workforce.

## What it leaves out

| Left out | Taken by |
| --- | --- |
| §6.5: deleting the venue's operation description and making it required to record a sale | vb6, owner-landed ([plan](2026-11-08-a1308-vb6-operation-description.md)) |
| `nodes.location_id` | 5f (owner), with the backup copy reads that join `nodes` to `locations` |
| `location_id` on devices, orders, refunds, floor, kitchen and printing tables | 5e |
| `bump_mode`, `fire_control`, the `locations` table, `venueLocationId` | 5h |
| The live-venue guard | 5f |
| The default menu | 5e |

## Work beside this slice (rules §8)

- 3a-ii's plan reads the time zone through `readVenueTimeZone(db)` (`apps/server/src/venue-time-zone.ts`,
  which reads `readVenue`); it needs nothing from this slice. Any other new reader of
  `locations.time_zone` or `location_business_day_settings` on `main` at the base is a stop (rules
  §5.5): `git grep -n -E "locations\.timeZone|time_zone|locationBusinessDaySettings|locationDayCutoverChanges" -- apps packages ':!**/drizzle/**'`.

## Files

```zsh
git grep -l -w -E "locationBusinessDaySettings|location_business_day_settings|locationDayCutoverChanges|location_day_cutover_changes" -- apps packages scripts ':!**/drizzle/**' ':!*.md'
# 8 + 5 source files, 19 + 24 test files at a086eedfb7 (the greps overlap)
```

Modify — schema and core: `packages/db/src/schema/business-day-clock.ts` (the two tables give way to
`day_cutover_changes`; rename the file `day-cutover-changes.ts`), `schema/tenants.ts` (four columns
go; `DEFAULT_TIME_ZONE` stays), `schema/index.ts`, `index.ts`, `classification.ts:104-105`,
`venue.ts`, `venue-settings.ts`, `trigger-refusals.ts`, `triggers/core.sql`, `testing/seed.ts`.

Modify — writers and readers: `packages/provisioning/src/venue-apply.ts`,
`apps/server/src/business-day-start.ts`, `venue-details.ts`, `venue-zone-repair.ts`,
`venue-zone-context.ts`, `packages/venue-service/src/business-day-schedule.ts`,
`packages/workforce/src/attendance-responses.ts`, `packages/composition/src/modules.ts`.

Modify — the fiscal pair and the brand: `packages/fiscal-verifactu/src/write-path.e2e.test.ts:32,552-555`,
`packages/shared/src/ids.ts`, `index.ts`, `ids.test.ts`, `apps/server/src/testing/handover-placed-copy.ts:38,47`,
`apps/server/src/handover-preparation.test.ts:49,108`.

Modify — tests: `packages/fiscal/src/issue-clock.test.ts:23-61` (set-up writes the document instead
of `update locations set time_zone`), the business-day, venue-details, zone-repair and venue-apply
suites, the 43 test files above (script plus hand edits), `scripts/behavioural-triggers.test.ts`
(the two new triggers in its pinned list and their cases), `scripts/schema-constraints.test.ts`,
`apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts`.

Modify — scripts: `scripts/a1308/drop-location-id.mjs` gains `--rename-identifier <old>=<new>`
(identifier tokens and import specifiers, never property names or strings; idempotent). **Decided:**
within one run the table rules match the old name first, on the unchanged text, and the rename is
applied last, so `--tables locationDayCutoverChanges --rename-identifier locationDayCutoverChanges=dayCutoverChanges`
works in one pass. Cases in its test; `scripts/a1308/venue-document-fixtures.mjs` is re-run.

Docs: `docs/developers/conventions-data.md` (the business-day clock's home; the temporary
operation-description field), the time-zone guides only if they name a table
(`git grep -n -i -E "location_business|day_cutover" apps/server/src/guide`), the backlog.

Regenerated: `packages/db/drizzle/**`, `scripts/migration-baseline-epoch.json`.

## Size

| Part | Counted |
| --- | --- |
| `business_day` document, `readBusinessDayRevision`, clock reader, their cases | ~90 + ~90 |
| `day_cutover_changes` schema | ~25 |
| Writers (setup, editor, details, repair, context) and their cases | ~120 + ~110 |
| Territory and operation description fields, setup writer, cases | ~40 + ~40 |
| §8.5 triggers and cases | ~25 + ~60 |
| Fiscal pair lines, brand and its two other importers | ~10 |
| Issue-clock set-up and the daylight-saving case | ~60 |
| Script option and its cases; fixture hand edits | ~45 + ~120 |
| Live types, descriptor, guards, docs | ~50 |
| Madrid (5b's transform, extended: zone into `business_day`, day start into a `day_cutover_changes` row, territory and description into `venue`, the two old tables' captured rows) and its cases | ~50 + ~30 |
| **Total** | **~965** |

## Finish line

1. **The fiscal pair, in every task** (A1301 plan, "The fiscal pair"):
   `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts` and
   `… vitest run inmutabilidad` print a `Tests` line with no failure; `git diff origin/main -- packages/fiscal-verifactu/src/write-path.e2e.test.ts`
   shows only lines 32 and 552–555 (item 6), and `inmutabilidad.test.ts` is unchanged.
2. `pnpm --filter @waitron/fiscal exec vitest run src/issue-clock.test.ts` passes with the new case
   "freezes each invoice's offset from the business-day document across the spring change".
3. `pnpm --filter @waitron/server exec vitest run src/business-day-start.test.ts src/venue-details.test.ts src/venue-zone-repair.test.ts src/first-fiscal-setup.e2e.test.ts src/configuration-transfer.test.ts` passes.
4. `pnpm --filter @waitron/provisioning exec vitest run src/venue-apply.test.ts` and
   `pnpm --filter @waitron/db exec vitest run src/venue-settings.test.ts src/testing` pass.
5. `pnpm exec vitest run scripts/behavioural-triggers.test.ts scripts/schema-constraints.test.ts scripts/starting-migrations.test.ts scripts/live-subscriptions.test.ts scripts/classification-complete.test.ts scripts/migration-upgrade.test.ts scripts/a1308/drop-location-id.test.mjs scripts/a1308/venue-document-fixtures.test.mjs` passes.
6. `git grep -n -P "locationBusinessDaySettings|locationDayCutoverChanges|location_business_day_settings|location_day_cutover_changes|\bLocationId\b|brandLocationId" -- apps packages scripts ':!**/drizzle/**'`
   prints nothing (`-P`: git 2.56's `-E` does not take `\b`). Control, on the base first: it prints
   `packages/shared/src/ids.ts:11` and `packages/db/src/venue.ts:5`.
7. §8.5's result is in the pull request.
8. `pnpm protection-list compare` prints exactly the next section.

## Expected protection-list difference

Under each of the six headers, except `waitron_change_*` lines (change-feed only), and
`day_cutover_changes_*` trigger lines, which appear in every phase (they are hand-written SQL in
core's migration). Written from the schema change and the tool's naming; not simulated.

```text
missing index location_business_day_settings.primary key(location_id)
missing index location_day_cutover_changes.primary key(location_id,effective_business_day)
missing table location_business_day_settings
missing table location_day_cutover_changes
changed table locations.columnOrder
missing table locations.columns[operation_description]
missing table locations.columns[fiscal_territory]
missing table locations.columns[time_zone]
missing table locations.columns[day_cutover]
missing trigger waitron_change_location_business_day_settings_delete
missing trigger waitron_change_location_business_day_settings_insert
missing trigger waitron_change_location_business_day_settings_update
missing trigger waitron_change_location_day_cutover_changes_delete
missing trigger waitron_change_location_day_cutover_changes_insert
missing trigger waitron_change_location_day_cutover_changes_update
changed trigger waitron_change_locations_update.when
extra index day_cutover_changes.primary key(effective_business_day)
extra table day_cutover_changes
extra trigger day_cutover_changes_keep_closed
extra trigger day_cutover_changes_no_update
extra trigger waitron_change_day_cutover_changes_delete
extra trigger waitron_change_day_cutover_changes_insert
extra trigger waitron_change_day_cutover_changes_update
```

In the tool's order: missing and changed objects by name, then extras (`compare.ts:292-302`); a
table's missing columns in the table's own column order. `location_business_day_settings` sorts
before `locations` because `_` comes before `s`.

Reasons: tables-venuebox §4 (`location_business_day_settings` → `settings.business_day`'s revision;
`location_day_cutover_changes` → `day_cutover_changes`, absorbing `locations.day_cutover`) and §5
(the date and time CHECKs kept, "key without location"; the revision CHECK becomes the `settings`
row's own); §2.1 for the territory; §6.5 and this plan's item 4 for the description; §8 item 5 for
the two new triggers. Gained: the two §8.5 triggers.

## Stop points (beyond rules §5)

1. **§8.5's failing result** (item 7).
2. The fiscal pair needs any change beyond item 6, or its run fails: tell the owner, do not edit
   (A1301 plan, "The fiscal pair").
3. The daylight-saving case shows a different offset from today's for the same saved zone (a value
   that feeds the huella moved).
4. A clock reader outside the files listed needs a change (the clock's shape would have moved).
5. A test needs a revision number other than the "by design" one below.

## Assertions that change, by design

- **The clock's revision after setup is 1, not 0.** Today the counter is absent until the first
  change and reads 0 (`venue-zone-context.ts:46`, `settings?.revision ?? 0`); the `settings` row's
  revision is at least 1 once setup saves it (1b-i's `settings_revision_ck`). Every later save still
  adds one. Cases that pin an absolute revision after setup add one; cases that compare before and
  after keep their shape (tables-venuebox §2.2: "This row's `revision` IS the venue clock's revision").
- `issue-clock.test.ts`'s set-up writes the zone into the document; its assertions stay.
- Cases that inserted a `location_day_cutover_changes` row now insert a `day_cutover_changes` row
  after the first row; the clock they read is the same.

---

### Task 1: The documents and the clock reader, test first

- [ ] **Step 1:** Base protection list (rules §3).
- [ ] **Step 2: Failing cases** in `packages/db/src/venue-settings.test.ts`:
  - "the business-day document keeps an invalid zone as stored" (`"Europe/Nowhere"` saves and reads
    back); `""` is refused;
  - "the clock's start is the first day-start row and later rows are its changes": rows
    `2000-01-01 06:00:00`, `2026-12-01 05:00:00` → `{ dayCutover: "06:00", cutoverChanges: [{ "2026-12-01", "05:00" }] }`;
  - "readVenue reads the zone, territory and description from the documents";
  - "with no business-day document the venue is not found";
  - "readBusinessDayRevision is the document's revision";
  - "parse refuses an empty fiscal territory".
- [ ] **Step 3:** Run; fail. Write the definitions, `FIRST_DAY_START`, `readBusinessDayRevision` and
  the reader changes. Update `seedVenue` (writes both documents and the first row) and add
  `seedBusinessDay(db, { timeZone?, dayCutover? })` (the document and the first row only, for tests
  with their own `locations` row). Run; pass.

### Task 2: The schema and the writers

- [ ] **Step 1: Failing cases:** `venue-apply.test.ts` "first setup writes the zone document and the
  first day-start row"; "re-applying the same request reuses the venue"; `business-day-start.test.ts`
  "a saved change raises the clock revision by one" and "a stale revision is refused
  `venue.business_day_changed`" (item 3, last bullet); `venue-details.test.ts` "a zone change raises
  the clock revision"; `venue-zone-repair.test.ts` "the repair answers the saved revision".
- [ ] **Step 2:** Schema (item 2, item 5); rebuild core
  (`pnpm --filter @waitron/server migration-baseline rebuild --set core`).
- [ ] **Step 3:** Writers (items 3 and 4) and the four revision readers (item 1).
- [ ] **Step 4:** Run; pass. Commit.

### Task 3: The fiscal path, proved

- [ ] **Step 1:** In `packages/fiscal/src/issue-clock.test.ts`, change the set-up that wrote
  `locations.timeZone` to `saveSettings` on `BUSINESS_DAY_SETTINGS`. Add "freezes each invoice's
  offset from the business-day document across the spring change": with `Europe/Madrid` saved,
  `prepareIssueClock` at `2026-03-29T00:30:00Z` freezes 60 and at `2026-03-29T01:30:00Z` freezes 120;
  then with `America/New_York` saved, `2026-01-15T12:00:00Z` freezes −300. The second half is the
  control: changing only the document changes the offset, so the reader cannot be reading anywhere
  else (A1301 design §8 item 3).
- [ ] **Step 2:** Item 6: the five lines of `write-path.e2e.test.ts`, then delete the brand and its
  `ids.test.ts` rows.
- [ ] **Step 3:** Finish lines 1 and 2. Commit, naming the fiscal pair lines in the message.

### Task 4: §8.5

- [ ] **Step 1: Failing cases** in `scripts/behavioural-triggers.test.ts` (its connection has foreign
  keys and CHECKs off, `:425-435`, so the trigger alone refuses):
  - "a day-start row cannot be updated" — refused with `DAY_START_HISTORY_REFUSAL`;
  - "a day-start row a daily close covers cannot be deleted" — with a `daily_closes` row for the day
    before, refused;
  - "a waiting day-start row can be deleted when the last close is older" — with a `daily_closes` row
    two days before the row's day (outside the rule's one-day reach), the delete succeeds (rules §4).
    A trigger that refused whenever any close exists fails this case.
  Add both triggers to the file's pinned list.
- [ ] **Step 2:** Add the triggers to `core.sql`; rebuild core; run; pass.
- [ ] **Step 3: Measure** (item 7): run `pnpm --filter @waitron/server exec vitest run src/business-day-start.test.ts`
  — every case that replaces or removes a waiting change must pass unchanged. A refusal there is the
  failing result: stop (stop point 1). Paste the run into the pull request.
- [ ] **Step 4:** Commit.

### Task 5: Fixtures

Split point for a fresh implementer.

- [ ] **Step 1:** Add `--rename-identifier` to `scripts/a1308/drop-location-id.mjs` with cases (a
  rename of an import and its uses; a property named the same left alone; a second run changes
  nothing).
- [ ] **Step 2:** Run, over 5a's `$FILES` list (one file list for every run and re-run):
  `drop-location-id.mjs --tables locationDayCutoverChanges --rename-identifier locationDayCutoverChanges=dayCutoverChanges --write`,
  then `venue-document-fixtures.mjs --move fiscalTerritory,operationDescription=seedVenueSettings --move timeZone,dayCutover=seedBusinessDay --write`.
  The fixture script always adds a `seedBusinessDay(x, {})` after each `insert(locations)`, even when
  nothing moves (5b Task 3's rule): most tests inserting `locations` rely on the column defaults for
  the zone and day start, and after this slice `readVenue` answers `venue.not_found` without the
  document. Prettier; commit the output alone (the schema commit before it is the reviewer's starting
  point, 5a).
- [ ] **Step 3:** Hand edits from the reports: `locationBusinessDaySettings` inserts become
  `seedBusinessDay` or a `saveSettings` call; raw SQL naming the deleted columns or tables (each
  file's own values), and each raw-SQL `locations` insert 5b edited gains a `settings` row
  `business_day` and a first `day_cutover_changes` row; revision numbers as under "Assertions that change, by design". List them in
  the pull request.
- [ ] **Step 4:** Run the touched suites by package (check free memory first). Commit.

### Task 6: Lists, docs, finish

- [ ] **Step 1:** Live types and descriptor (item 8), `schema-constraints`, docs. Madrid: extend
  5b's `apps/server/scripts/demo-seed/testing/madrid-documents.ts`, test first, so the captured
  `locations` row's `time_zone` becomes the `business_day` document, its `day_cutover` a
  `day_cutover_changes` row dated `FIRST_DAY_START`, its territory and description fields of the
  `venue` document, and the captured rows of the two deleted tables move the same way
  (`REMOVED_TABLES` alone requires them empty, `seed.madrid-baseline.test.ts:129-135`).
- [ ] **Step 2:** Backlog: in the A1301 entry delete the `locationId` brand sentence; the A1301
  working-time note "`attendance-responses.ts`'s `locationBusinessDaySettings` (S23)" is done.
- [ ] **Step 3:** Protection list: compare, paste, mark.
- [ ] **Step 4:** `pnpm format:check`; commit; `/finish-branch`. The owner lands it.


## WATCHER 2026-11-11 09:19 — 5d: keep the planned move; the review fixes may pass 3,000; next stop 3,400
- **Simpler alternative ("change nothing until locations is removed"):** it does not stand. 5d is a slice of the owner-approved A1308 build order (docs/superpowers/plans/2026-11-08-a1308-build-order.md, owner 2026-11-09: "build all of it as planned"). Keeping operationDescription readable until vb6 is part of that plan, and moving it now avoids changing fiscal readiness inside 5d. Answer review B in the PR with this.
- **Review fixes:** approved. Repoint the 9 raw-SQL fixtures, keeping their original values in the existing documents; snapshot the full business_day row beside the no-repair assertion; remove the duplicate dependency, the stale prose and the unused reads. Run those exact files, including payments (54/54 red now), plus the protected fiscal pair. Next stop about 3,400 authored additions; the target is zero failing cases.

