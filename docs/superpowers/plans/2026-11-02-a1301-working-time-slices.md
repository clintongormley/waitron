# A1301 — Remove the location concept: the working-time slices (S13, S14, S15, S12d) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as
> `subagent_type: "implementer"`.

**Parent plan:** `docs/superpowers/plans/2026-11-01-a1301-remove-location.md`. Its "Rules every slice
follows" (the fiscal pair, the guard groups, the shared done-check, the global constraints,
"Cross-location tests are deleted, not rewritten", "A database with a second venue row", "Calls into
another slice's file", "Exported functions behind a module contract keep their `cfg`", "Scope-blind
tests") and its "Review focus" and "Execution notes" apply to every slice here unchanged. This plan
replaces that plan's "Not covered: S13, S14, S15" point and its `### Task S12d` section.

**Spec:** `docs/superpowers/specs/2026-11-01-a1301-remove-location-design.md` §6 (rows S13, S14, S15,
S12; "How A1301 meets A1268") and §7 question 4, answered (a).

**Plan head:** main `2c4511d58b` (2026-11-01). A1268 landed as #2375 (squash `6de731dd52`); S1
(#2379) and F1 (#2383) are on main. Every `file:line` below was read at `2c4511d58b`; implementers
re-read at their own head and delete test cases by title, never by line number. Claims were made by
reading and `git grep`, not by running tests: every "fails before" step must be seen failing.

**What A1268 already removed, so no slice here does:** `time_entries.location_id`,
`TimeEntryAppend.locationId`, the location in the entry and closure hashes, closures per location,
`clock.other_location`, `activeLocationId`, `recordAtLocation`, the export's "Workplace reference"
column and its "positions can skip numbers" note. Receipt:
`git grep -n -E 'other_location|activeLocationId|recordAtLocation' -- apps packages scripts` prints
nothing at `2c4511d58b`, and the S13 and S14 sections give the per-file checks.

## Order of landing

All four slices are lane B's, landed by the lane, FULL review path, one at a time:

1. **S13** — `refactor/a1301-s13-working-time` (Tasks S13a, S13b, S13c, S13d1, S13d2, S13e1, S13e2,
   S13f–S13j).
2. **S14** — `refactor/a1301-s14-record-export` (Task S14a), after S13.
3. **S15-1** — `refactor/a1301-s15-1-planned-actual` (Task S15a).
4. **S15-2** — `refactor/a1301-s15-2-attendance-export` (Task S15b).
5. **S15-3** — `refactor/a1301-s15-3-attendance-hours` (Tasks S15c–S15k, one PR).
6. **S12d** — `refactor/a1301-s12d-locations-route` (Task S12d), after S15-1.

A slice may start once the one before it is on `main`; overlap with any other open pull request is
never a reason to wait (whoever lands second rebases).

## Driver's rulings (settle the two parts' open points)

1. **The wire contract.** S13 changes no request parameter and no response field that dashboard or
   till code sends or reads: routes keep their parse (a request without `locationId` is still
   refused) and ignore the value; response fields a client reads are filled from the venue. S15
   changes the wire end to end, server and clients together. **Two exceptions move end to end in
   S13:** the rota warnings query (parent plan's table) and the roster and shift routes with their
   dashboard methods (`getRoster`, `createRosterVersion`, `addShift`, called by no screen), in Task
   S13j. S13 also deletes the client type declarations of the fields it stops sending or taking
   (`RosterVersion.locationId`, `Shift.locationId`, `ShiftInput.locationId`, and `MyShift.locationId` in
   both apps): a declared field no server sends is a false claim.
2. **The "own attendance at another workplace" check is S13's.** Task S13i deletes
   `assertOwnAttendanceLocation` (`apps/server/src/attendance-own-scope.ts`) from **every** route that
   calls it (export options, the worker's own export, the dashboard's and the till's `request` command
   routes, and the hours and day routes in both apps: S13i's table lists each call) and the file itself,
   and deletes or trims the cross-location cases that prove it. Deleting a check that compares a value
   the parse still requires is not a wire change. S15's tasks do not touch it.
3. **S14 follows S13, not S15-2.** The case that blocked S14 ("restricts own workplace, allows one
   where the worker has a question and refuses missing location or person after authority",
   `apps/server/src/attendance-export-api.test.ts`) is trimmed by S13i: its second location row and
   the own-workplace half go, and its "refuses missing location or person" half stays word for word
   until S15b deletes the parse and the `requireLocation` lookup it proves (S13i keeps `requireLocation`). S14 then removes `RecordExportInput.locationId` and stops
   the export routes passing it (the routes still parse it until S15b).
4. **`attendance_source_state` and `attendance_operation_facts` keep an equality on the venue's id**
   (S13's decision 3) wherever S13f's query-plan measurement shows the read would otherwise scan the
   table, until S22 re-keys the indexes that lead with `location_id` (`attendance_source_state`'s
   two, `attendance_operation_facts_day_idx`). Carried to S22 below.
5. **The question and pending cards are headed by their work day**, not the venue's name (S15's
   choice): with one venue the name says nothing. The look check covers it.
6. **`AttendanceInbox.locations` becomes `AttendanceInbox.timeZone`**, the venue's zone, which the
   till's day dialog needs (S15i).
7. **The export's column key is `venueName`**: every display-name column in `record-export.ts` is
   keyed after whose name it is while its label drops "name" (`personName` → "Worker", `authorName` →
   "Author", `:29-80`), so the label stays "Workplace / Centro de trabajo". S14's PR says so.
8. **`attendance.time_skipped` is reworded in S15** (both apps), so S15's done-check is clean.

## Carried to other slices

- **S12a (lane C).** Once S12a has deleted `admit`'s location refusal
  (`till-attendance-api.ts:101-102`, `till-clock-api.ts:79-80`) and S13 has landed, nothing reads
  `TillAttendanceApiDeps.cfg.locationId` or `TillClockApiDeps.cfg.locationId`: whichever of S12a and
  S13 lands second drops the two fields. S13d2 removes the session fact's `locationId` in
  `till-api.ts` whatever S12a left there.
- **S18.** If S2 (#2384, owner-landed) lands after S13, its `bill-payments.ts` and `till-sale.ts`
  calls still pass `locationId` to the attendance recorder's ignored optional field, with
  `captureBillPaymentAttendance`'s `requested.locationId` parameter; S18 removes them.
- **S22.** Re-key `attendance_source_state_scope_uq` and `_watch_idx`, and
  `attendance_operation_facts_day_idx` (`location_id, business_day, person_id, at`,
  `packages/workforce/src/schema/attendance.ts:121`), without `location_id`, and delete the venue
  equalities S13e2 and S13f keep on both tables. Delete `AttendanceResponseReceipt.locationId`
  (`packages/workforce/src/attendance-contract.ts:43`) with the stored column it mirrors
  (`attendance_response_commands.location_id`). Replace `packages/workforce/src/personal-data.ts`'s join of `locations`
  through `shifts.location_id` (S13 leaves it, because reading `readVenue` there adds a table scan
  that `personal-data.test.ts`'s "prepare's reads find every row they read through an index" case
  refuses): either list `locations` in that test as a stated exception, or drop the field and reword
  the export README (`apps/server/src/i18n/personal-data-readme.ts`, EN and ES).

---

## S13 — Working time that A1268 leaves

**Goal.** The workforce code stops taking, passing and filtering by a location. Roster versions and
shifts are the venue's; the working-time rules (`convenio_config`) are read for the venue with no
id; the business day comes from `readVenueClock(tx)`; attendance facts, attendance days, questions,
discovery, the end-of-day pass, reminder emails, the clock state, the inbox, hours and the
correction commands carry no location; the "own attendance at another workplace" check is deleted
from every route that calls it (S13i). A `location_id` column that still exists is filled with
`await venueLocationId(tx)`. Two things move end to end: the rota warnings query (staffing
dashboard, staffing read, server route; S13c), and the roster and shift routes with their
dashboard methods and the client type declarations of the fields S13 stops sending (S13j). Every
other request parameter and response field the dashboard and till send or read stays exactly as
it is (see "Left for S15").

- **Depends on:** S1 (landed, #2379) and A1268 (landed, #2375, squash `6de731dd52`). Lands first:
  S14 waits for S13, and S15 for S14. S12d waits for S15-1, not for S13.
- **Lands:** lane.
- **Branch:** `refactor/a1301-s13-working-time`.
- **Review path:** **FULL**. Three triggers: auth and permissions (S13i deletes the
  `assertOwnAttendanceLocation` admission check from the eight routes that call it), a by-id read
  (roster, shift and question reads lose their location condition), and a cross-package contract
  (the staffing dashboard ↔ `GET /management-api/roster/breaches`, the dashboard client ↔ the
  roster and shift routes, and `@waitron/workforce`'s exported signatures that `apps/server` and
  `@waitron/staffing` call).
- **Plan head:** main `2c4511d58b`. Every line below was read there; implementers re-read at their
  own head and delete test cases **by title**, never by line number.

**What A1268 already removed (checked, not planned here).** `git grep` of the design pattern at
`2c4511d58b` over `packages/workforce/src/schema/time-entries.ts`, `schema/pay-period-closures.ts`,
`schema/workforce-chains.ts`, `chain*.ts`, `pay-period*.ts`, `backup-verification.ts`,
`projection.ts`, `corrections.ts`, `record-*.ts` and `effective-entries.ts` prints only test-file
lines; `git grep -n -E 'other_location|otherLocation|activeLocationId' -- apps packages ':!*.test.ts'`
prints nothing. So `time_entries.location_id`, `TimeEntryAppend.locationId`, the location in the
entry and closure hashes, closures per location, `clock.other_location` and `activeLocationId` are
gone. A1268 left: the five `attendance_*` tables' `location_id` columns and every reader of them,
the questions' location, the box-location business day, the inbox's per-location list, the
own-workplace check (`attendance-own-scope.ts`, its "admitted only by a question there" rule), and
everything in roster, shifts and convenio (outside A1268's scope).

### Decisions this section makes (each is restated where it bites)

1. **Wire contract (driver's decision).** S13 changes no request parameter and no response field
   that dashboard or till code sends or reads. Routes keep their parse exactly as it is (a request
   *without* the parameter is still refused, because the clients still send it) and ignore the
   value. Response fields a client reads are filled from the venue (`await venueLocationId(tx)`,
   `readVenue(tx)`). The request parsers `attendance-request.ts`, `hours-request.ts` and
   `attendance-export-request.ts` are not edited at all; S15 owns them. Exceptions: the rota
   warnings query moves end to end in S13c, and the roster and shift routes with their dashboard
   methods in S13j.
2. **Response fields only declared, never read, by a client** are dropped by S13 from the server
   (`RosterVersionRow.locationId`, `ShiftRow.locationId`, `PersonShiftRow.locationId`). Receipt:
   `git grep -n -E 'locationId' -- 'apps/dashboard/src/**' 'apps/till/src/**' ':!*.test.ts'` at
   `2c4511d58b` shows them only in type declarations (`apps/dashboard/src/api/client.ts:1018`,
   `:1029`, `:1117`, `apps/till/src/api/client.ts:2038`); no screen reads them. S13j deletes the
   declarations, with `ShiftInput.locationId` (`apps/dashboard/src/api/client.ts:1044`), which
   the dashboard stops sending.
3. **An index that leads with `location_id` keeps an equality on the venue's id where the columns
   after it are also constrained.** With one venue every row holds the same `location_id`, so
   deleting the condition does not change an answer, but `attendance_source_state`'s only indexes
   lead with it (`packages/workforce/src/schema/attendance.ts:79-80`, read), and its watch rows
   grow with every captured operation; without the equality, `remember`'s and `due()`'s lookups
   scan the table under the write lock. So the discovery code keeps
   `eq(attendanceSourceState.locationId, venue)` with `venue = await venueLocationId(tx)` read once
   per call, until S22 re-keys those indexes. `attendance_operation_facts` is read the same way:
   its `attendance_operation_facts_day_idx` leads with `location_id` (`location_id, business_day,
   person_id, at`, `schema/attendance.ts:121`), and two reads use it: `readAttendanceFacts`'s
   stored-facts select, which reads every person's facts by `location_id` and time
   (`attendance-facts.ts:49-52`), and `reconcileAttendanceDay`'s pending lookup
   (`attendance-discovery.ts:63-73`). Both keep their `location_id` equality, compared with the
   venue's id (S13e2 for the stored-facts select, S13f for the pending lookup), unless S13f's
   Step 3 shows that the plan without it does not scan the table.
   Every other `location_id` filter is deleted (`attendance_day_work` grows by one row a business
   day; `attendance_questions` has person-led indexes). S13f's Step 3 measures all four reads.
4. **A location test that also meant "has an order" keeps the "has an order" half.** Discovery's
   `draft`/`group` sources (`attendance-discovery.ts:140`, `:147`) and the facts reader
   (`attendance-facts.ts:26-34`) answer `null` / no row for an event whose party has **no**
   working order (`having count(distinct o.location_id) = 1` is false for zero rows). The capture
   helpers skip such an event too (`orders.length !== 1`): `recordDraftEvents`
   (`order-drafts.ts:1630-1634`) when the draft's own bill (`orderDrafts.billId`) names no working
   order, and the group-event helper (`order-groups.ts:2445-2449`) when the party has none. S13
   keeps that: "at least one order", never "any". A captured row keeps counting as the venue's
   after its party has lost every order (S13f's `capturedRow` rule).
5. **The recorder's ignored `locationId?`.** `bill-payments.ts:1166-1182` and `till-sale.ts:128-137`
   (S2's files, owner-landed, open as #2384) pass `locationId` to the attendance recorder. While S2
   has not landed, `AttendanceRecorder`'s input keeps an optional, never-read `locationId?: string`
   for those two callers (rule "Calls into another slice's file"); S18 removes it. If S2 has landed
   before S13d2, S13d2 edits the two calls itself, argument only, and there is no optional field.
6. **Revision and fingerprint values change once.** `readAttendanceRevision` stops hashing every
   `locations` row and hashes `readVenueClock(tx)` instead (S13h), and discovery's watch
   fingerprints lose their location (S13f). On a box already recording attendance, a client holding
   the old revision gets `attendance.state_changed` once and re-reads; each watch is remembered once
   more and its days are marked to be evaluated again. Pre-production (CLAUDE.md §3, last rule); the
   PR names both.

### Files (design grep count at `2c4511d58b`)

Pattern and command: the shared done-check's `P`, `git grep -c -E "$P" -- <file>`.

| File | Count | Task | What changes |
| --- | --- | --- | --- |
| `packages/workforce-es/src/convenio.ts` | 5 | S13a | `resolveWorkTimeRuleset(tx)` reads the venue's `convenio_config` row: the `where` (`:64`) compares with `await venueLocationId(tx)` until S20–S28 drop the column, so the read keeps its unique-index lookup (`convenio_config_location_uq`, `schema/convenio-config.ts:100`) and refuses a second venue (`:41`, `:64`); refusal detail `{}` (`:68-70`); comment `:36-37` |
| `packages/workforce-es/src/errors.ts` | 2 | S13a | `"convenio.not_found": Record<string, never>`; comment `:8` |
| `packages/workforce/src/clocking.ts` | 43 | S13b | roster/shift inputs and rows lose `locationId` (`:94-99`, `:102-110`, `:112-121`, `:130-139`); `getPlannedVsActual` and `plannedShiftsInPeriod` (`:222-266`); `createRosterVersion` (`:296-320`), `copyPublishedToDraft` (`:334-349`), `getRoster` (`:379-396`), `getRosterVersion`/`shiftsForVersion` selects (`:401`, `:417`), `addShift` (`:425-449`), `shiftForWrite` select (`:480`), publish attach (`:531`) and supersede (`:583`, `:595`); row types and mappers (`:697-733`); comments `:133`, `:297-299`, `:427`, `:495-497`, `:574` |
| `packages/workforce/src/body-ids.ts` | 3 | S13b | `assertLocationExists` (`:14-17`) deleted (its two callers are `clocking.ts:302,439`) |
| `packages/workforce/src/errors.ts` | 3 | S13b | `"roster.draft_exists": Record<string, never>` (`:41`); comments `:37`, `:40` |
| `packages/workforce/src/schedule-reads.ts` | 4 | S13b | `PersonShiftRow.locationId` (`:20`) and its select (`:60`, `:67`, `:77`) |
| `packages/workforce/src/personal-data.ts` | 4 | — | **left as is** ("Carried to other slices", S22): the rota file's `location` is a join through `shifts.location_id` (`:67`, `:76`, `:187`) |
| `packages/workforce/src/absences.ts`, `shift-swaps.ts` | 1 + 1 | S13b | the comments "Not location-scoped…" (`:88`, `:124`) deleted |
| `packages/staffing/src/rota.ts` | 11 | S13b, S13c | S13b: `getRoster`/`createRosterVersion`/`addShift` calls stop spreading `cfg` (`:251`, `:255`, `:256-261`, `:288`, `:304`, `:360`), `roster.draft_exists` with `{}` (`:363`). `unattachedWeek`'s `cfg` (`:281`), unused once its `getRoster` call (`:288`) stops spreading it, goes with the arguments at `:302` and `:354`. S13c: `RotaWeek`'s `locationId` (`:85`). The rest is S9's |
| `packages/staffing/src/staffing-types.ts` | 4 | S13c | `RotaWeek.locationId` (`:113`); the three comments are S9's |
| `packages/staffing/src/dashboard/client.ts` | 3 | S13c | `watchRotaWarnings(queries, week, apply)` (`:145-159`): no `locationId` parameter, key or query parameter |
| `packages/staffing/src/dashboard/rota-view.ts` | 1 | S13c | the call at `:416` |
| `packages/staffing/src/testing/rota-fixture.ts` | 1 | S13c | `locationId: "location"` (`:35`) leaves the `RotaWeek` literal (crossing: F2's glob) |
| `apps/server/src/workforce-api.ts` | 21 | S13a, S13b, S13c | S13a: the two `resolveWorkTimeRuleset` calls (`:139`, `:304-306`). S13b: the calls into the roster functions (`:127`, `:150`, `:211`, `:234-242`, `:410`), the publish route's previous-version filter (`:315`), the four parse lines become bare validations (`:124`, `:208`, `:225`, `:405`). S13c: the breaches route (`:133-202`) stops parsing `locationId` and filtering unattached shifts by it (`:136`, `:156`). S13j: the three roster validations (`:124`, `:207-208`, `:225`) go. **Not S13:** `:7`, `:108-118` (S12d), `:405` (S15a) |
| `apps/dashboard/src/api/client.ts` | 8 of 27 | S13j | `RosterVersion.locationId`, `Shift.locationId`, `ShiftInput.locationId`, `MyShift.locationId` (`:1018`, `:1029`, `:1044`, `:1117`) deleted; `getRoster` and `createRosterVersion` (`:4199-4211`) send no `locationId`. The other 19 are S12d's, S5's and S15's |
| `apps/till/src/api/client.ts` | 1 of 17 | S13j | `MyShift.locationId` (`:2038`) deleted; the rest is S15's or unrelated words |
| `packages/workforce/src/attendance-types.ts` | 4 | S13e1, S13e2 | S13e1 makes these optional and never read; S13e2 deletes them: `AttendanceFact.locationId` (`:8`), `AttendanceDay.locationId` (`:14`), `PlannedAttendanceShift.locationId` (`:34`); comment `:40` |
| `packages/workforce/src/attendance-state.ts` | 2 | S13e1 | `assertAttendanceDay` (`:11`); `enqueueAttendanceDay`'s scope (`:30-33`) by business day only; its insert (`:44`) fills `locationId: await venueLocationId(tx)` |
| `packages/workforce/src/attendance-rota.ts` | 3 | S13e1 | the two join conditions (`:22`, `:31`) and the day filter (`:37`) |
| `packages/workforce/src/attendance-questions.ts` | 4 | S13e1 | `asQuestion` (`:43`); `upsertAttendanceQuestion`'s lookup (`:118`) and insert (`:140`, fills `venueLocationId`); `mergeAttendanceQuestions`' comparison (`:201`) |
| `packages/workforce/src/end-of-day.ts` | 9 | S13e1 | every `attendanceQuestions.locationId`/`attendanceDayWork.locationId` filter (`:80`, `:129`, `:192`, `:272`, `:370`, `:383`), the fact and plan filters (`:136`, `:145`), the break fact literal (`:308`) |
| `packages/workforce/src/attendance-contract.ts` | 12 | S13e1 (`:73`) | `AttendancePrompt.day` keeps `locationId` on the wire as `(AttendanceDay & { locationId: string }) \| null` (S15i removes it). `AttendanceResponseReceipt.locationId` (`:43`) is S22's. Every other line is a wire field S13 keeps (S15) |
| `packages/workforce/src/attendance-question-responses.ts` | 1 | S13h | the command/question location comparison (`:23`) |
| `packages/workforce/src/attendance-reads.ts` | 32 | S13h | `locationInfo` (`:24-32`) deleted; inbox `locations` is always `[venue]` (`:54-70`); prompts take the venue's id, name and zone (`:76`, `:98-110`, `:119-134`); `readAttendanceDay(tx, { personId, date })` (`:148-179`); `readAttendanceManagerQueue(tx)` (`:180-194`). The response `locationId` fields stay, filled from the venue |
| `packages/workforce/src/hours-reads.ts` | 7 | S13h | `HoursInput.locationId` (`:23`, `:44-45`), the prompt filter (`:109`); `PersonHours.locationId`/`ManagerHours.locationId` filled from the venue (`:100`, `:163`, `:196`) |
| `packages/workforce/src/attendance-responses.ts` | 10 | S13h | `readAttendanceRevision` hashes `readVenueClock(tx)` instead of every `locations` row and every cutover row (`:9-11`, `:30-41`); the settings select keeps its table, loses the location ordering |
| `packages/workforce/src/attendance-response-commands.ts` | 5 | S13h | stored `locationId` is `question ? await venueLocationId(tx) : null` (`:191`, `:270`); `invalid("question_location")` (`:210`) deleted (no test names it: `git grep -n question_location -- apps packages` prints only that line). `:81`, `:88` copy the wire payload's `locationId` (kept, S15) |
| `apps/server/src/attendance-capture.ts` | 12 | S13d1, S13d2, S13e2 | S13d1: `AttendanceRecorder` input with an optional, never-read `locationId` (decision 5); `recordAttendanceFact` (`:57-146`) fills the fact row's `location_id` with `venueLocationId`, reads `readVenueClock`, scopes the day by business day. S13d2: `captureKitchenActivity` reads no order location (`:31-39`). S13e2: its day literals lose `locationId` |
| `apps/server/src/attendance-integrated.ts` | 3 | S13d2 | the order-location select (`:33-36`) and the fact (`:42`) go; the watch insert (`:52`) fills `venueLocationId` |
| `apps/server/src/parties.ts` | 2 | S13d2 | `attendance?: { recorder: AttendanceRecorder }` (`:725`, `:754`) |
| `apps/server/src/attendance-facts.ts` | 20 | S13e2 | `readAttendanceFacts(tx, day)` and `readPlannedAttendanceShifts(tx, day)` read the venue's facts and shifts with no location (decision 4 for `:26-34`), except the stored-facts select's `location_id` equality (`:51`), filled with `await venueLocationId(tx)` until S13f's Step 3 decides it (decision 3); `readVenueClock` (`:3`, `:14`); comment `:15` |
| `apps/server/src/attendance-discovery.ts` | 51 | S13e2 (day literals), S13f | every function's scope loses `locationId`; `readVenueClock`; `scanScope`, `remember`'s predicate, `due()` and `reconcileAttendanceDay`'s pending lookup (`:63-73`) keep the venue equality unless S13f's Step 3 shows no scan without it (decision 3); source fields lose their location column (decision 4); `attendance_day_work` filters deleted; inserts fill `venueLocationId` |
| `apps/server/src/attendance-source-changes.ts` | 15 | S13f | one venue: the per-location map (`:46-57`) becomes one set of days, and the watch is still written only when a watch or a current row exists (today the loop from `:57` writes one only for a location found in either); `readVenueClock`; day-work filter deleted; watch insert fills `venueLocationId` (`:84`); the conflict target (`:93-98`) names the real unique index and stays (S22) |
| `apps/server/src/attendance-loop.ts` | 3 | S13f | `AttendancePassDeps.locationId` (`:11`), its scope (`:28`) and filter (`:48`) |
| `apps/server/src/attendance-email-worker.ts` (`:102-106`) | — | S13f | the `reconcileAttendanceDay` call's literal scope `{ nodeId, locationId: deps.locationId, personId, day }` loses `locationId`, or it does not compile once S13f narrows the scope; the rest of the file is S13g's |
| `apps/server/src/attendance-email-worker.ts` | 6 | S13g | deps lose `locationId` and `locationName` (`:22`, `:28`); the question filter (`:72`) goes; the day literal (`:95-100`, S13e2); the reconcile scope (`:104`) is S13f's; the message's place name is `(await readVenue(tx)).name` (`:131`) |
| `apps/server/src/attendance-email.ts`, `i18n/attendance-email.ts` | 3 + 4 | S13g | parameter `locationName` → `venueName`; both sentences' words unchanged |
| `apps/server/src/till-clock-state.ts` | 5 | S13g | `readTillClockState(tx, { personId }, at)`; `readVenueClock`; `TillClockState.locationId` stays (the till reads it) and is filled with `venueLocationId` |
| `apps/server/src/till-clock-api.ts` | 7 | S13g | the state reads (`:103`, `:129`, `:170`), `writeClock`'s clock (`:152`); `TillClockApiDeps.cfg.locationId` (`:30`) and `admit`'s refusal (`:79-80`) are S12a's (see S13g Step 6) |
| `apps/server/src/management-attendance-api.ts` | 33 | S13h (queue call; `:220`'s `const scope =` becomes a bare validating `parseAttendanceLocationQuery(…)` call, as `noUnusedLocals` refuses an unused `scope`), S13i | S13i: inbox push (`:81-87`), own-workplace checks (`:100-104`, `:119-123`, `:151-156`), the location existence check (`:176-182`), `readLocationClock(scope.locationId)` (`:106`, `:184`), lookups' `locations` (`:197-207`) from the venue, `cfg.locationId` (`:36`) |
| `apps/server/src/till-attendance-api.ts` | 20 | S13i | the same in the till's routes (`:145-151`, `:171-177`, `:190-194`, `:253-257`); `TillAttendanceApiDeps.cfg.locationId` (`:48`) and `admit`'s refusal (`:101-102`) are S12a's |
| `apps/server/src/attendance-own-scope.ts` | 5 | S13i | deleted |
| `apps/server/src/attendance-export-api.ts` | 22 | S13i | the three own checks (`:65-70`, `:90-95`, `:127-132`) deleted; `ExportDeps.cfg` (`:25`) deleted; the exporter's `locationId` (`:106`) is `await venueLocationId(tx)` until S14 removes `RecordExportInput.locationId`. `requireLocation` (`:38-44`, called at `:63`, `:89`) **stays** until S15b: the trimmed export case's kept half proves it (driver's ruling 3) |
| `apps/server/src/attendance-request.ts`, `hours-request.ts`, `attendance-export-request.ts` | 8 + 4 + 5 | — | **not edited** (decision 1); S15 |

**Crossings** (other slices' files, argument-only unless said): `apps/server/src/boot.ts:2056-2093,2447`
(S18's lines, not S16's territory reads), `working-order.ts`, `order-drafts.ts`, `order-groups.ts`,
`bill-refunds.ts`, `adjustments-apply.ts`, `finish-party-service.ts`, `unpaid-departure.ts` (S11),
`till-api.ts:1447` (S12), `packages/staffing/src/routes.ts` and `rota.ts` (S9),
`apps/dashboard/src/i18n/codes.ts` (text, S5 also edits the file), and the fixtures
`packages/workforce/test/attendance-fixture.ts`, `packages/workforce-es/test/fixtures.ts`,
`packages/staffing/src/testing/rota-fixture.ts` (F2) where a changed type forces it.

**Handed off (in the area grep, not S13's).**

| File | To | Why |
| --- | --- | --- |
| `apps/server/src/setup-opening-hours.ts` (4) | S8 | it reads the default department's opening hours at setup; no working-time code |
| `apps/server/src/box-staff-notices.ts` (4) | S10 | printers in trouble |
| `apps/server/src/personal-data-time-record.ts` (3) | S12c | A1268 removed its entry filter; `:26-27` and `:38` are S12c's table rows |
| `apps/server/src/testing/clock-venue.ts` (3), `apps/server/test/attendance-export-fixture.ts` (9) | F5 | test helpers; neither is forced to change by S13 (`clock-venue.ts:96` passes a `cfg` variable, which a narrower `cfg` type accepts) |
| `packages/workforce/src/configuration-transfer.ts`, `packages/workforce-es/src/configuration-transfer.ts` (1 each) | S17 | `locationColumns` |
| `packages/workforce/src/dashboard/live-queries.ts` (4) | S23 | table names |
| `packages/workforce/src/schema/*`, `packages/workforce-es/src/schema/*` | S22, S20 | schema |
| `packages/workforce/test/*.ts`, `packages/workforce-es/test/*.ts` | F2 | except where a type forces an edit (crossings) |
| `packages/workforce-es/src/record-export.ts` (12) | S14 | |
| Shift templates | — | no non-schema code reads `shift_templates` except `configuration-transfer.ts` (`git grep -n -E 'shiftTemplates|shift_templates' -- apps packages ':!*.test.ts' ':!**/drizzle/**'`); nothing for S13 |

### Steps every S13 task runs

- **Code guards** (from the repository root): `pnpm exec vitest run scripts/module-seams.test.ts
  scripts/live-subscriptions.test.ts scripts/errors-reachable.test.ts scripts/personal-log-params.test.ts
  scripts/english-only.test.ts`. Read each `Tests` line.
- **The working-time hashes stay as they are** (no A1301 slice changes one, design §6):
  `git diff --exit-code origin/main -- packages/workforce/src/chain-hash.ts packages/workforce/src/pay-period-chain.ts`
  prints nothing, and `pnpm --filter @waitron/workforce exec vitest run src/chain-hash.test.ts src/pay-period-chain.test.ts`
  passes with neither test file edited.
- `pnpm --filter <pkg> typecheck` for every package touched (crossings included), `pnpm format:check`.
- Browser tests (staffing's `src/dashboard/**`): `memory_pressure | grep free` first.
- **A database with a second venue row** (plan rule): once a function reads through
  `venueLocationId`/`readVenue`/`readVenueClock`, a suite that seeds a second `locations` row
  fails with `provisioning.second_venue`, and one that seeds none fails with `venue.not_found`
  (both thrown by `venueRow`, `packages/db/src/venue.ts:49-50`; S13h reads the venue on every inbox
  and revision read, so its suites meet both). Each task first lists its suites with
  `git grep -c -E 'insert\((schema\.)?locations\)|seedLocation\(|seedVenue\(|insertLocation\(' -- <its test files>`
  and reads every file printing 2 or more (or 1 plus a `locations` insert inside a case). A case
  that only proves a cross-location refusal is deleted (named below); any other seeds one venue
  (`seedVenue` from `@waitron/db/testing/seed.js`, or the setup's first row) without changing an
  assertion. `packages/staffing/src/routes.test.ts:290`, `:672` and `:793` seed a second venue in
  cases about staff roles, seasons and special days (S9's), not S13's roster reads: leave them.
- **Assertions about the one venue's id.** A test asserting `locationId: <the venue's id>` on a
  stored `attendance_*` row keeps passing unchanged (the column is filled with the same id). A test
  asserting `locationId` on an object whose type loses the field (`AttendanceFact`,
  `AttendanceDay`, `PlannedAttendanceShift`, `RotaWeek`, the roster rows) changes only by deleting
  that key, citing design §1 ("Nothing passes a location id") in the commit.
- Done-check: the shared one with `FILES=(…the task's source files…)`.

### Task S13a: the working-time rules are the venue's

**Files:** `packages/workforce-es/src/convenio.ts`, `errors.ts`; `apps/server/src/workforce-api.ts`
(`:139`, `:304-306` only); `apps/dashboard/src/i18n/codes.ts` (`convenio.not_found`, `:969-972`);
tests `packages/workforce-es/src/convenio.test.ts`, `work-summary.test.ts`, `index.test.ts`
(export list, unchanged), `apps/server/src/workforce-api.test.ts` (the publish describe only).

**Produces:** `resolveWorkTimeRuleset(tx: Transaction | Database): Promise<WorkTimeRuleset>`;
`convenio.not_found` with `{}`. Callers: only `workforce-api.ts:139,304`
(`git grep -n resolveWorkTimeRuleset -- apps packages ':!*.test.ts'`).

- [ ] **Step 1: failing test.** In `convenio.test.ts`, add "resolves the venue's rules without
  being told a location": seed one `convenio_config` row (`seedConvenioConfig`), call
  `resolveWorkTimeRuleset(suite.db)`, expect the seeded `workingDaysPerWeek`. FAILS before:
  `params` is `undefined`, so `params.locationId` throws `TypeError`.
- [ ] **Step 2:** `pnpm --filter @waitron/workforce-es exec vitest run src/convenio.test.ts` — FAIL.
- [ ] **Step 3: implement.** The `where` (`:64`) compares with `await venueLocationId(tx)` instead
  of `params.locationId`, not deleted: a `limit 1` with no `where` would pick one of several rows
  without a word, while this keeps the unique-index lookup and refuses a second venue
  (`venueLocationId` takes `Transaction`, and `seedNode` at `packages/db/src/testing/seed.ts:58-61`
  already passes it a `Database | Transaction`); S20–S28 delete the condition with the column. The
  refusal's params become `{}`; the
  error type `Record<string, never>` with its comment reworded to "No `convenio_config` row: the
  venue has not configured its working-time rules"; the two server calls pass no second argument.
  Dashboard text: `en: "Configure the venue's working-time rules first"`, `es: "Configura primero
  las reglas de jornada del local"` (no client reads the params; `git grep -n convenio.not_found --
  apps packages ':!*.test.ts'`).
- [ ] **Step 4: tests.** `convenio.test.ts` shares one database across cases and gives each case
  its own location (its comment `:20-22`): once the read takes the venue's id, a case that adds a
  location fails with `provisioning.second_venue`. Make every case use the one venue and delete its own `convenio_config` row at its
  end (in a `finally`), or switch the suite to `resetPerTest: true` if its setup reseeds; no
  assertion changes except "throws convenio.not_found when no convenio_config row exists for the
  location" (renamed "…for the venue"), whose params expectation becomes `{}` (this decision).
  `work-summary.test.ts:95-116` builds a daily and a period ruleset at two locations in one case:
  read them one after the other on the one venue, replacing the row between the two reads; the
  assertions stay. `workforce-api.test.ts` "publishes without labour warnings when the location has
  no convenio_config (A585-7)" (`:503`): keep its point (no rules → no warnings, publish succeeds)
  by removing the venue's `convenio_config` row for the case and restoring it in a `finally`
  (the suite shares its database, `:28-29`); drop the second location; rename "…when the venue has
  no convenio_config…". Its later `GET /management-api/roster?locationId=${otherLoc}` passes the
  venue's id until S13j.
- [ ] **Step 5:** `pnpm --filter @waitron/workforce-es exec vitest run src/convenio.test.ts
  src/work-summary.test.ts src/index.test.ts`; `pnpm --filter @waitron/server exec vitest run
  src/workforce-api.test.ts -t "publish"`; code guards; typecheck `@waitron/workforce-es`,
  `@waitron/server`, `@waitron/dashboard`; `pnpm format:check`.
- [ ] **Step 6: done-check** over `convenio.ts`, `errors.ts`: prints nothing.
- [ ] **Step 7: commit** "The working-time rules are read for the venue (A1301 S13a)".

### Task S13b: roster versions and shifts belong to the venue

**Files:** `packages/workforce/src/clocking.ts`, `body-ids.ts`, `errors.ts`, `schedule-reads.ts`,
`absences.ts:88`, `shift-swaps.ts:124`; crossings `packages/staffing/src/rota.ts` (the calls listed
in the table; `:363`), `packages/staffing/src/routes.ts` (only if `changeRotaWeek`'s `cfg` becomes
unused), `apps/server/src/workforce-api.ts` (the S13b lines in the table). Tests:
`packages/workforce/src/scheduling.test.ts`, `scheduling.concurrency.test.ts`,
`schedule-reads.test.ts`, `shift-swaps.test.ts`, `personal-data.test.ts`, `pay-period-closure.test.ts:156`,
`record-reads.test.ts:164`; `packages/staffing/src/rota.test.ts`; `apps/server/src/schedule-api.test.ts`,
`me-api.test.ts` (shift rows), `apps/server/src/workforce-api.test.ts` (roster, shift, publish and
planned-vs-actual describes; the warnings describe is S13c's), `venue-details.test.ts:1465-1471`
(`createRosterVersion` and `addShift` with `locationId: venue.cfg.locationId`) and
`attendance-obligations.test.ts` (`createRosterVersion` `:65`, `:99`; `addShift` `:70`): the
compiler refuses their literal `locationId` once the inputs lose it.

**Produces:** `CreateRosterVersionInput = { period }`; `RosterVersionRow`, `ShiftRow`,
`PersonShiftRow` without `locationId`; `AddShiftInput` without `locationId`;
`getRoster(tx, { period })`; `getPlannedVsActual(tx, { period })`; `roster.draft_exists` with `{}`.

- [ ] **Step 1: failing test.** In `scheduling.test.ts`, add "opens and reads a week's draft
  without being told a location": `createRosterVersion(tx, { period: <an unused week> })`, then
  `getRoster(tx, { period })` has that version. FAILS before: `assertLocationExists(tx, undefined)`
  matches no row and throws `management.request_invalid`.
- [ ] **Step 2:** `pnpm --filter @waitron/workforce exec vitest run src/scheduling.test.ts` — FAIL.
- [ ] **Step 3: implement** the table rows for S13b. Inserts into `roster_versions` and `shifts`
  (`:316-317`, `:340-349`, `:442-446`) fill `location_id` with `await venueLocationId(tx)`; the
  copy in `copyPublishedToDraft` stops copying the source rows' `location_id` (rule: never from
  another row). `getRoster`, `createRosterVersion`'s draft check, `copyPublishedToDraft`'s draft
  check, `plannedShiftsInPeriod`, publish's attach (`:531`) and supersede (`:583`, `:595`) lose
  their location condition. `workforce-api.ts`: the calls drop `locationId`; the four parse lines
  stay as statements that still validate (`requireUuidParam(c.req.query("locationId") ?? "",
  "LocationId");`, `requireBodyUuid(body.locationId, "locationId");`). The three roster ones
  (`:124`, `:208`, `:225`) carry no comment, since S13j deletes them in this PR; the
  planned-vs-actual one (`:405`) carries "Validated and ignored: the dashboard still sends it
  (A1301 S15)"; the publish route's
  previous-version query (`:313-320`) loses `eq(rosterVersions.locationId, …)`. Staffing: the
  backend calls stop spreading `cfg`. `unattachedWeek`'s `cfg` parameter (`rota.ts:281`) is then
  unused, which `noUnusedParameters` refuses: drop it and the arguments at `:302` and `:354`. If
  `changeRotaWeek`'s `cfg` is then unused (TS6133), drop it and the argument at its caller in
  `packages/staffing/src/routes.ts`.
- [ ] **Step 4: tests.** Codemod the call arguments (`scheduling.test.ts` names `locationId` on
  114 lines: `git grep -c -E 'locationId' -- packages/workforce/src/scheduling.test.ts`). The suite
  shares one database (`:28-29`) and seeds extra locations per case (`:151`, `:852`, `:874`,
  `:899`, `:933`, `:947-948`, `:964`, `:977`, `:993`): those cases use the setup's venue, and a
  case whose fresh location only kept it apart from the others moves to a week no other case uses.
  **Delete:** `scheduling.test.ts` "refuses a locationId that names no location —
  management.request_invalid, no row written" (both, `:361`, `:541`) and "scopes shifts to the
  queried location — another location's published shifts do not leak in" (`:946`). **Trim:**
  "attaches only same-location, in-period draft shifts (the predicates are not vacuous)" (`:143`):
  keep the in-period predicate's shift, drop the other location's, rename "attaches only in-period
  draft shifts…"; "refuses a second draft for the same (location, week) — roster.draft_exists"
  (`:324`) and "refuses a second draft for the same location and period" (`:1102`): keep, rename
  without "location", params `{}`. `staffing/src/rota.test.ts`: the `roster.draft_exists`
  expectation's params become `{}`. `workforce-api.test.ts`: **delete** "400s a POST /roster whose
  locationId names no location (management.request_invalid, never a 500)" (`:152`) and the
  `["locationId"]` row of the `it.each` at `:399` (the body id is no longer checked against a row);
  **keep** "400s a non-UUID locationId on GET…" (`:132`) and "400s a GET /roster with no
  locationId…" (`:144`), which S13j deletes with the parse they prove, and the planned-vs-actual
  "400s a non-UUID locationId…" (`:722`) and "400s a request with no locationId…" (`:734`): that
  parse is unchanged (decision 1), S15a removes them. Expected
  shift and version rows in every file lose `locationId` (design §1). `personal-data.test.ts`
  seeds a second location (`:156`, `:457`) through direct fixture inserts (`insertRosterVersion`,
  `insertDraftShift`), which S13b does not change, and nothing it runs reads the venue: run it
  unedited and leave the seeds to F2.
- [ ] **Step 5:** `pnpm --filter @waitron/workforce exec vitest run src/scheduling.test.ts
  src/scheduling.concurrency.test.ts src/schedule-reads.test.ts src/shift-swaps.test.ts
  src/personal-data.test.ts src/pay-period-closure.test.ts src/record-reads.test.ts`;
  `pnpm --filter @waitron/staffing exec vitest run src/rota.test.ts src/routes.test.ts`;
  `pnpm --filter @waitron/server exec vitest run src/workforce-api.test.ts
  src/workforce-api.gate-sweep.test.ts src/schedule-api.test.ts src/me-api.test.ts
  src/venue-details.test.ts src/attendance-obligations.test.ts`. The warnings
  describe in `workforce-api.test.ts` ("roster warnings while planning") may still fail on its
  per-case locations: it is S13c's, which runs before the PR. Code guards; the hash steps;
  typecheck `@waitron/workforce`, `@waitron/staffing`, `@waitron/server`; `pnpm format:check`.
- [ ] **Step 6: done-check** over `clocking.ts`, `body-ids.ts`, `errors.ts`, `schedule-reads.ts`,
  `absences.ts`, `shift-swaps.ts`: prints only `venueLocationId`. Over `workforce-api.ts`: only
  `:7`/`:108-118` (S12d), the three roster validation statements (S13j), the planned-vs-actual one
  (S15a), and the breaches route's `:136`, `:156` (S13c).
- [ ] **Step 7: commit** "Roster versions and shifts belong to the venue (A1301 S13b)".

### Task S13c: the rota warnings query, end to end

**Files:** `apps/server/src/workforce-api.ts` (`:133-202`); `packages/staffing/src/rota.ts:85`,
`staffing-types.ts:113`, `dashboard/client.ts:145-170`, `dashboard/rota-view.ts:416`,
`testing/rota-fixture.ts:35`; `docs/backlog/workforce.md:110` ("Retain the existing offset and
location assertions" → "Retain the existing offset assertions"). Tests:
`apps/server/src/workforce-api.test.ts` ("roster warnings while planning", `:769-…`),
`packages/staffing/src/rota.test.ts`, `dashboard/index.test.ts`, `dashboard/rota-planning.test.ts`,
`dashboard/rota-races.test.ts`, `dashboard/rota-view.test.ts`, `dashboard/live-queries.test.ts`.

**Produces:** `GET /management-api/roster/breaches?period=…` (no `locationId`; an extra one is
ignored, since the route reads only `period`); `watchRotaWarnings(queries, week, apply)`;
`RotaWeek` without `locationId`.

- [ ] **Step 1: failing test.** In `workforce-api.test.ts`'s warnings describe, add "reads the
  venue's warnings with no locationId": `GET /management-api/roster/breaches?period=<week>` →
  200 with the seeded breach. FAILS before: `requireUuidParam("")` answers 400 `shared.invalid_id`.
  In `dashboard/rota-view.test.ts`, change the expected request (`:266`) to
  `/management-api/roster/breaches?period=2026-11-30`; FAILS before (the path carries
  `locationId=location`).
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/workforce-api.test.ts -t
  "warnings"`; check free memory, then `pnpm --filter @waitron/staffing exec vitest run
  src/dashboard/rota-view.test.ts` — both FAIL.
- [ ] **Step 3: implement.** The route reads only `period`; the unattached-shift select drops
  `eq(shifts.locationId, locationId)`. Staffing: `RotaWeek.locationId` and its fill go;
  `watchRotaWarnings` drops the parameter, the query key becomes `staffing:rota-warnings:${week}`,
  and the path `…/roster/breaches?period=${encodeURIComponent(week)}`; `rota-view.ts:416` passes
  `week` only. If `readRotaWeek`'s `cfg` becomes unused, drop it and its caller's argument.
- [ ] **Step 4: tests.** The warnings describe makes a fresh location per case
  (`warningLocation()`, `:770-…`) in a shared database: each case seeds its shifts in a week no
  other case uses, on the one venue, with the venue's `convenio_config` set as the case needs and
  restored in a `finally`. **Delete:** "reads unattached shifts by their local calendar date and
  scopes them to this location" (`:897`)'s foreign-location half only: keep its local-date
  assertions, drop `foreignLoc` and the `foreign` expectation, rename "reads unattached shifts by
  their local calendar date". Staffing: `rota.test.ts` "includes its location and clock zone for
  passive warning reads and candidate previews" (`:203`) keeps the zone assertion, renamed
  "includes its clock zone…"; `index.test.ts:298` and `rota-planning.test.ts:203` expect the new
  path; `rota-planning.test.ts:52` and `testing/rota-fixture.ts:35` lose the fixture key;
  `rota-races.test.ts:95`'s wrapper takes `(q, w, apply)`.
- [ ] **Step 5:** `pnpm --filter @waitron/server exec vitest run src/workforce-api.test.ts
  src/workforce-api.gate-sweep.test.ts`; `pnpm --filter @waitron/staffing exec vitest run
  src/rota.test.ts src/routes.test.ts` and, after the memory check, the six `src/dashboard/*.test.ts`
  files above; `pnpm exec vitest run scripts/live-subscriptions.test.ts` and the other code guards;
  typecheck `@waitron/server`, `@waitron/staffing`; `pnpm format:check`.
- [ ] **Step 6: done-check** over `workforce-api.ts`: only S12d's `:7`, `:108-118`, the three
  roster validation statements (S13j) and the planned-vs-actual one (S15a). Over `packages/staffing/src/dashboard/*.ts`, `rota.ts`,
  `staffing-types.ts`: only S9's lines (S9's section lists them) if S9 has not landed.
- [ ] **Step 7: commit** "The rota warnings read the venue's week (A1301 S13c)".

### Task S13d1: the attendance recorder stores the venue whatever it is passed

S13d is split in two (decision 5's optional field makes the halves compile on their own): S13d1
changes the recorder and no caller; S13d2 changes the callers.

**Files:** `apps/server/src/attendance-capture.ts` (`AttendanceRecorder`'s input and
`recordAttendanceFact`, `:57-146`, only). Tests: `attendance-capture.test.ts` and the eight test
files named in Step 4.

**Produces:** `AttendanceRecorder = (tx, fact: Omit<AttendanceFact, "locationId"> & { outcome; locationId?: string })`,
the optional field never read. No caller changes: every call that passes `locationId` still
compiles.

- [ ] **Step 1: failing test.** In `attendance-capture.test.ts`, add "records an operation for the
  venue when given no location": `recordAttendanceFact(tx, { source: "order", key, personId, kind:
  "order", at, offsetMinutes: 0, outcome: "qualified" })`; expect one `attendance_operation_facts`
  row whose `locationId` is the venue's and one `attendance_day_work` row. FAILS before:
  `!fact.locationId` throws `attendance.invalid` ("operation evidence").
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/attendance-capture.test.ts` — FAIL.
- [ ] **Step 3: implement.** `recordAttendanceFact` stops checking and reading `fact.locationId`;
  the insert fills `locationId: await venueLocationId(tx)`; `readVenueClock(tx)` replaces both
  `readLocationClock` calls; the existing-row branch and the saved-day lookup scope
  `attendance_day_work` by business day only; the day literals pass `locationId: await
  venueLocationId(tx)` until S13e2 removes the field.
- [ ] **Step 4: delete or trim** (each seeds or moves to a second location to prove the stored
  location survives a move). They go here, not with the callers in S13d2: once the recorder stores
  the venue's id whatever it is passed, a case that seeds a second `locations` row is refused
  `provisioning.second_venue` (`packages/db/src/venue.ts:50`). **Delete**
  `attendance-adjustments.test.ts` "keeps the removed event's original location after its bill
  moves"; `attendance-amendments.test.ts` "marking an order placed captures its stored location
  with the writer's original clock reading" — but first check whether another case asserts the
  original clock reading; if none does, keep the case with the second location and the
  `{ ...v.cfg, locationId: … }` override removed; `attendance-arriving-groups.test.ts` "keeps the
  snapshot when the destination party later changes location"; `attendance-draft-events.test.ts`
  "captures creation by its event identity and retains the original location after a later move"
  (keep its first half if the event-identity capture is asserted nowhere else:
  `grep -n 'event identity\|eventKey' apps/server/src/attendance-draft-events.test.ts`);
  `attendance-group-commands.test.ts` "a captured group keeps its original location when its
  party's bills move"; `attendance-kitchen-service.test.ts` "a kitchen transition uses its stored
  order location"; `attendance-order-command-routes.test.ts` "%s uses the stored order location
  rather than the caller's config"; `attendance-orders.test.ts` "an edit keeps the order's recorded
  location when configuration points elsewhere" (#2384 already deletes it, and narrows the previous
  case's table to `"invoice-choice"`; skip whichever is gone). **Trim:** `attendance-capture.test.ts`
  "replay cannot replace the original actor, location or human request instant": drop the
  `locationId: elsewhere` replay field and its location expectation, keep actor and instant,
  rename "…the original actor or human request instant". Cases that assert the stored row's
  `locationId` equal to the venue's id stay as they are. A listed case that still passes here may
  instead go in S13d2; say which in the commit.
- [ ] **Step 5:** `pnpm --filter @waitron/server exec vitest run src/attendance-capture.test.ts
  src/attendance-adjustments.test.ts src/attendance-amendments.test.ts
  src/attendance-arriving-groups.test.ts src/attendance-draft-events.test.ts
  src/attendance-group-commands.test.ts src/attendance-kitchen-service.test.ts
  src/attendance-order-command-routes.test.ts src/attendance-orders.test.ts`; code guards; the hash
  steps; `pnpm --filter @waitron/server typecheck` (no caller edited, so it passes as it stands);
  `pnpm format:check`.
- [ ] **Step 6: done-check** over `attendance-capture.ts`: only `venueLocationId`, the transitional
  day literals (S13e2), the optional `locationId?` line, and `captureKitchenActivity`'s order
  location (`:31-39`, S13d2).
- [ ] **Step 7: commit** "The attendance recorder stores the venue's id (A1301 S13d1)".

### Task S13d2: the capture callers pass no location

**Files:** `apps/server/src/attendance-capture.ts` (`captureKitchenActivity`, `:31-39`),
`attendance-integrated.ts`, `parties.ts`; crossings `till-api.ts:1447`, `working-order.ts`
(`captureOrderEdit` `:330-362` and its nine callers, `captureOrderAmendment` `:7180-7200`),
`adjustments-apply.ts:1488`, `order-drafts.ts` (`discardPartyDrafts` `:907`, `:944`; `captureDraft`
`:1286-1304`; `recordDraftEvents` `:1622-1645`), `order-groups.ts:2436-2458`, `bill-refunds.ts`
(`captureRefundAttendance` `:112-135` and its three callers `:731`, `:771`, `:790`),
`finish-party-service.ts:176,233`, `unpaid-departure.ts:187`; S2's `bill-payments.ts:1150-1182` and
`till-sale.ts:120-140` **only if #2384 has landed** (decision 5). Find every site with
`git grep -n -E 'AttendanceRecorder; locationId|recorder.*locationId|captureOrderEdit\(|captureDraft\(|captureRefundAttendance\(' -- 'apps/server/src/*.ts'`
and let `pnpm --filter @waitron/server typecheck` (with `noUnusedParameters`) report the rest.
Tests: the call sites the typecheck reports, among them `attendance-drafts.test.ts:99,135`.

**Produces:** `captureOrderEdit`, `captureDraft`, `captureRefundAttendance` without a location
parameter; `finishTable`/`closeParty`/`discardPartyDrafts` take
`attendance?: { recorder: AttendanceRecorder }`. If #2384 has landed, `AttendanceRecorder` loses
the optional `locationId?` too (decision 5).

- [ ] **Step 1: the failing check is the compiler.** Remove the location parameter from
  `captureOrderEdit`, `captureDraft` and `captureRefundAttendance`, and narrow `parties.ts`'s
  `attendance` option (`:725`, `:754`) to `{ recorder: AttendanceRecorder }`. No behaviour changes
  in this task: S13d1 already stores the venue's id, and the capture suites in Step 5 hold the
  behaviour.
- [ ] **Step 2:** `pnpm --filter @waitron/server typecheck` — FAIL, listing the callers.
- [ ] **Step 3: implement.** Callers drop the property and the order / device selects that only
  fed it; `captureKitchenActivity` reads no order location. **Keep "has an order"** (decision 4):
  `recordDraftEvents` keeps its join on the draft's own bill (`orderDrafts.billId`,
  `order-drafts.ts:1630-1634`) and changes only its select, to one working order's `id … limit 1`;
  the group-event helper selects one working order of the party (`select({ id }) … limit(1)`); each
  skips the event when there is none, instead of `selectDistinct(locationId)` and `length !== 1`.
  `attendance-integrated.ts`: the order-location select (`:33-36`) and the fact's `locationId`
  (`:42`) go, and its watch insert (`:52`) fills `venueLocationId`.
- [ ] **Step 4: test call sites.** `attendance-drafts.test.ts:99,135` pass `{ recorder }` only;
  every other call the typecheck reports drops its location argument, no assertion changed.
- [ ] **Step 5:** `pnpm --filter @waitron/server exec vitest run` on `src/attendance-*.test.ts`
  (the capture files: `ls apps/server/src/attendance-*.test.ts`; check free memory first, the set
  is large), `src/till-api.test.ts`, `src/working-order*.test.ts`, `src/order-drafts*.test.ts`,
  `src/order-groups*.test.ts`, `src/bill-refunds*.test.ts`, `src/finish-party*.test.ts`,
  `src/unpaid-departure*.test.ts`, `src/parties*.test.ts`; code guards; the hash steps;
  `pnpm --filter @waitron/server typecheck`; `pnpm format:check`. If S2 has not landed, also run
  `src/bill-payments*.test.ts` and `src/till-sale*.test.ts` unedited.
- [ ] **Step 6: done-check** over `attendance-capture.ts`, `attendance-integrated.ts`,
  `parties.ts`: only `venueLocationId`, the transitional day literals (S13e2) and, while S2 is
  unlanded, the optional `locationId?` line. `git grep -n -E 'recorder.*locationId|AttendanceRecorder; locationId' -- 'apps/server/src/*.ts' ':!*.test.ts'`
  prints nothing.
- [ ] **Step 7: commit** "Attendance capture callers pass no location (A1301 S13d2)".

### Task S13e1: an attendance day has no location — the workforce half

S13e is split in two. The workforce half stops reading the field while keeping it as an optional,
never-read property, so `apps/server` still compiles without an edit; the server half stops passing
it and deletes the optional fields (the same bridge as decision 5).

**Files:** `packages/workforce/src/attendance-types.ts`, `attendance-state.ts`, `attendance-rota.ts`,
`attendance-questions.ts`, `end-of-day.ts`, `attendance-contract.ts:73`; crossing fixture
`packages/workforce/test/attendance-fixture.ts:39-66`. Tests: `packages/workforce/src/attendance-state.test.ts`,
`attendance-rota.test.ts`, `attendance-questions.test.ts`, `end-of-day*.test.ts`,
`attendance-mail.test.ts`.

**Produces:** `AttendanceDay = { businessDay, startAt, endAt, locationId?: string }`, and
`AttendanceFact` and `PlannedAttendanceShift` with the same optional `locationId?`, which no
workforce code reads (S13e2 deletes all three).

- [ ] **Step 1: failing test.** In `attendance-state.test.ts`, add "saves the venue's day from a day
  with no location": `enqueueAttendanceDay(tx, { businessDay, startAt, endAt })`; one
  `attendance_day_work` row with the venue's `locationId`. FAILS before: `assertAttendanceDay`
  throws `attendance.invalid` (`!day.locationId`, `:11`).
- [ ] **Step 2:** `pnpm --filter @waitron/workforce exec vitest run src/attendance-state.test.ts` — FAIL.
- [ ] **Step 3: implement** the table rows for S13e1. Inserts into `attendance_day_work` and
  `attendance_questions` fill `venueLocationId`; every `attendanceQuestions.locationId` and
  `attendanceDayWork.locationId` filter in these files is deleted (decision 3), and so are
  `end-of-day.ts`'s fact and plan filters (`:136`, `:145`); `mergeAttendanceQuestions` stops
  comparing locations (the composite key `attendance.ts:184-185` still holds, both rows carry the
  venue's id). The contract's prompt day is `(AttendanceDay & { locationId: string }) | null`:
  `attendance-reads.ts:101-106` still fills it from the question row until S13h, and S15i removes it.
- [ ] **Step 4: delete or trim.** **Delete:** `attendance-state.test.ts` "keeps the same business
  date at two locations separate". **Trim:** `attendance-questions.test.ts` "same source key at two
  locations or two people makes separate obligations" → keep the two-people half (expect 2 rows,
  1 own), rename "same source key for two people makes separate obligations";
  `attendance-rota.test.ts` (workforce) "leaves other days, locations, actual clock starts and
  unscheduled activity alone" → drop the `elsewhere` day, rename without "locations";
  `end-of-day.test.ts` "excludes another person, another location and both sides of the
  business-day window" → drop the `elsewhere` fact, rename without "another location". The
  workforce fixture and the workforce tests' day, fact and plan literals lose `locationId`
  (design §1).
- [ ] **Step 5:** `pnpm --filter @waitron/workforce exec vitest run src/attendance-state.test.ts
  src/attendance-rota.test.ts src/attendance-questions.test.ts src/end-of-day.test.ts
  src/end-of-day.concurrency.test.ts src/end-of-day.obligations.test.ts src/attendance-mail.test.ts
  src/attendance-reads.test.ts src/hours-reads.test.ts`; code guards; the hash steps; typecheck
  `@waitron/workforce` and `@waitron/server` (the server passes for the optional fields' sake;
  its suites run in S13e2, which also deletes the server cases this half turns red);
  `pnpm format:check`.
- [ ] **Step 6: done-check** over the five workforce files: only `venueLocationId` and the three
  optional `locationId?` fields (S13e2). `attendance-contract.ts:73`'s `locationId` is S15i's.
- [ ] **Step 7: commit** "An attendance day has no location in the working-time package (A1301 S13e1)".

### Task S13e2: an attendance day has no location — the server half

**Files:** `apps/server/src/attendance-facts.ts`; the day literals in `attendance-discovery.ts`
(`:36-40`, `:238-242`, `:570-575`), `attendance-capture.ts` (S13d1's),
`attendance-source-changes.ts:74-78`, `attendance-email-worker.ts:95-100`; the recorder type in
`attendance-capture.ts`; `packages/workforce/src/attendance-types.ts` (the three optional fields
S13e1 left). Tests: `apps/server/src/attendance-facts.test.ts`,
`attendance-draft-merge-routes.test.ts`, `attendance-rota.test.ts`; the five suites that call
`readAttendanceFacts` with a day literal (`attendance-bill-payments.test.ts:121`,
`attendance-derived-groups.test.ts:133`, `attendance-edit-group-events.test.ts:190`,
`attendance-integrated-payments.test.ts:111`, `attendance-whole-payments.test.ts:198`);
`attendance-export-api.test.ts`'s day literal in "rechecks a %s question-only historical workplace
after formatting" (`:583-588`; S13i deletes the case, but it must compile until then);
`attendance-obligations.test.ts`'s `day()` helper (`:31-36`; not a fresh literal, so the compiler
does not force it, design §1).

**Produces:** `AttendanceDay = { businessDay, startAt, endAt }`; `AttendanceFact` and
`PlannedAttendanceShift` without `locationId`; `readAttendanceFacts(tx, day)` and
`readPlannedAttendanceShifts(tx, day)` for the venue.

- [ ] **Step 1: failing test.** In `apps/server/src/attendance-facts.test.ts`, add "reads the
  venue's facts for a day with no location": seed one order operation on the venue, then
  `readAttendanceFacts(tx, { businessDay, startAt, endAt })` answers it. FAILS before:
  `readLocationClock(tx, undefined)` (`attendance-facts.ts:14`) throws "reporting: no location
  undefined" (`packages/reporting/src/business-day.ts:195`).
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/attendance-facts.test.ts` — FAIL.
- [ ] **Step 3: implement** the table rows for S13e2. `attendance-facts.ts`: the `retained` CTE and
  the stored-facts select carry no location column; the `draft`/`group` branches keep one row per
  event whose party has at least one order (decision 4: the inner join already requires one;
  delete only the `having` clause); the stored-facts select keeps `location_id = ${venue}`, with
  `venue = await venueLocationId(tx)` read once, until S13f's Step 3 decides it (decision 3);
  `readPlannedAttendanceShifts` loses the two location conditions; `readVenueClock(tx)`. The day
  literals lose `locationId`; the three optional fields in `attendance-types.ts` go. The recorder
  input becomes `AttendanceFact & { outcome; locationId?: string }` (or without the optional,
  decision 5).
- [ ] **Step 4: delete or trim.** **Delete:** `attendance-facts.test.ts` "a captured session keeps
  its original location after a device moves" and "does not assign a location to a retained party
  event with conflicting bill locations". **Trim:** `attendance-facts.test.ts` "includes the lower
  day boundary, excludes the upper boundary and another location" → drop the `elsewhere` fact;
  "returns only current published same-location shifts by start-day, retaining split and
  spillover ends" → drop the `elsewhere` version and shift, rename without "same-location";
  `attendance-draft-merge-routes.test.ts` "%s keeps every bill and records nothing; Merge bills
  afterwards snapshots the admitted mover at the trusted instant" → delete the tail that inserts
  `Elsewhere` and moves the open orders (`:235-262`), and the `locationId` key in its
  `readAttendanceFacts` expectation. Calls lose `locationId` from day, fact and plan literals
  (design §1).
- [ ] **Step 5:** `pnpm --filter @waitron/server exec vitest run src/attendance-facts.test.ts
  src/attendance-draft-merge-routes.test.ts src/attendance-rota.test.ts
  src/attendance-discovery.test.ts src/attendance-loop.test.ts src/attendance-email-worker.test.ts
  src/attendance-bill-payments.test.ts src/attendance-derived-groups.test.ts
  src/attendance-edit-group-events.test.ts src/attendance-integrated-payments.test.ts
  src/attendance-whole-payments.test.ts src/attendance-obligations.test.ts
  src/attendance-export-api.test.ts`. One case is expected red until S13i deletes it: the export
  suite's "rechecks a %s question-only historical workplace after formatting", which inserts a
  second `locations` row (`:574-577`), so `upsertAttendanceQuestion`'s venue read refuses it from
  S13e1 on. Code guards; the hash steps; typecheck `@waitron/workforce`, `@waitron/server`;
  `pnpm format:check`.
- [ ] **Step 6: done-check** over `attendance-types.ts` and `attendance-facts.ts`: only
  `venueLocationId` and the stored-facts select's venue equality (S13f, decision 3).
- [ ] **Step 7: commit** "An attendance day has no location in the server (A1301 S13e2)".

### Task S13f: discovery, source changes and the attendance loop run for the venue

**Files:** `apps/server/src/attendance-discovery.ts`, `attendance-source-changes.ts`,
`attendance-loop.ts`, `attendance-facts.ts` (the stored-facts select's venue equality, only if
Step 3 deletes it), `attendance-email-worker.ts:102-106` (the `reconcileAttendanceDay` call's
literal scope `{ nodeId: deps.nodeId, locationId: deps.locationId, personId, day }` loses
`locationId`; the compiler refuses it once the scope narrows); crossing `boot.ts:2056-2070` (the
`beginAttendanceDiscovery` call and `runAttendanceLoop`'s deps). Tests:
`apps/server/src/attendance-discovery.test.ts`, `attendance-loop.test.ts`,
`attendance-integrated-discovery.test.ts`, `attendance-rota.test.ts`,
`attendance-cutover-settings.test.ts`, `attendance-restore.test.ts`, `boot.attendance.test.ts`,
`attendance-email-worker.test.ts`, `attendance-obligations.test.ts` (`nextAttendanceDay` `:38`,
`:157`; `discoverAttendanceDays` `:41`; `beginAttendanceDiscovery` `:95`), and the
`markAttendanceSourceChanged` callers' tests (`workforce-api.test.ts`).

**Produces:** `beginAttendanceDiscovery(tx, { generation })`, `discoverAttendanceDays(tx, { now,
batchSize })`, `nextAttendanceDay(tx, { now })`, `reconcileAttendanceDay(tx, { nodeId, personId,
day }, at)`; `runAttendancePass`/`runAttendanceLoop` deps without `locationId`.
`reconcileAttendanceBeforeClock` keeps `scope.locationId` only to hand to `readTillClockState`
(S13g removes it).

- [ ] **Step 1: failing test.** In `attendance-discovery.test.ts`, add "discovers the venue's day
  without being told a location": seed a session in a past business day, run
  `beginAttendanceDiscovery(tx, { generation })`, `discoverAttendanceDays(tx, { now, batchSize: 2 })`
  until `more` is false, then `nextAttendanceDay(tx, { now })` equals that day. FAILS before:
  `readLocationClock(tx, undefined)` throws "reporting: no location undefined".
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/attendance-discovery.test.ts` — FAIL.
- [ ] **Step 3: measure decision 3 first.** In a scratch test (not committed), on a migrated
  venue database with rows in both tables, run `explain query plan` with and without the
  `location_id` condition on four reads: `remember`'s predicate select (`:277-283`) and `due()`'s
  select (`:467-478`) on `attendance_source_state`, and, on `attendance_operation_facts`,
  `readAttendanceFacts`'s stored-facts select (`attendance-facts.ts:49-52`) and
  `reconcileAttendanceDay`'s pending lookup (`attendance-discovery.ts:63-73`). The failing case
  for "the equality is needed" prints `SCAN attendance_source_state` /
  `SCAN attendance_operation_facts`; the control, with the condition, prints `SEARCH … USING
  INDEX` naming `attendance_source_state_scope_uq` / `_watch_idx` /
  `attendance_operation_facts_day_idx`. **The rule:** keep `eq(…locationId, venue)` on every read
  whose plan without it shows a full table scan; delete it where the plan without it still
  searches an index, and say so. Record all eight plans in the commit message. A probe at plan
  time (`node:sqlite`, SQLite 3.54.0, an empty table carrying only `attendance_operation_facts`'s
  four indexes, no `ANALYZE`) printed `SEARCH attendance_operation_facts USING INDEX
  attendance_operation_facts_pending_idx (outcome=?)` for both `attendance_operation_facts` reads
  without the condition, and the same for the stored-facts select with it: so expect to delete
  those two (even with the condition, the planner did not choose
  `attendance_operation_facts_day_idx` for the stored-facts select).
- [ ] **Step 4: implement.** Every scope loses `locationId`; `readVenueClock(tx)` replaces the five
  `readLocationClock` calls; `attendance_day_work` filters are deleted and its inserts fill
  `venueLocationId`; `attendance_source_state` lookups keep `eq(attendanceSourceState.locationId,
  venue)` (per Step 3), its inserts fill `venue`, and the conflict targets (`:310-315`) stay (they
  name the unique index; S22). Row sources: delete each `… as locationId` column, keeping decision
  4 for `draft`/`group` as a column the gating reads (for example `exists(select 1 from
  working_orders o where o.party_id = d.party_id) as attributed`; the other sources answer 1);
  `remember`'s day gating (`:262-267`) tests that instead of `row.locationId === scan.locationId`,
  and the fingerprint drops `row.locationId` (decision 6); `capturedRow` stops copying
  `fact.locationId` onto the row (`attendance-discovery.ts:310-336`) and marks it as the venue's
  instead (`attributed = 1`), so a captured draft or group event still has its days marked after
  its party has lost every order, as the copied location ensures today; the clock page (`:350`) and the versions' planned shifts (`:386`) lose their
  location; the whole-payment watch lookup in `reconcileAttendanceDay` (`:83-93`) keeps the venue
  equality; the pending lookup (`:63-73`) and the stored-facts select follow Step 3's rule.
  `attendance-source-changes.ts`: one set of days for the venue, `readVenueClock`, insert fills
  `venueLocationId`, and the watch is still written only when a watch or a current row exists
  (`watches.length > 0 || current.length > 0`; today the loop over `byLocation`, `:57`, writes
  nothing when both are empty). `attendance-email-worker.ts:102-106`: the scope loses
  `locationId`. `attendance-loop.ts`: deps and filter. `boot.ts`: drop the two
  `locationId: tradingContext.locationId` arguments.
- [ ] **Step 5: delete or trim.** **Delete:** `attendance-discovery.test.ts` "uses captured location
  instead of a session's moved device and ignores another location". **Trim:** "qualifies a
  captured pending bill at its saved instant and location when the retained outcome arrives"
  (`:756`): the order is created at the venue, not at `otherLocation`; keep the instant and outcome
  assertions; rename "…at its saved instant when…". The suite's second location (`:86-104`,
  `otherLocation`) goes once nothing uses it. Calls lose `locationId` from their scopes.
  **Add** to `attendance-discovery.test.ts` "a captured event still marks its day after its party
  loses every order": capture a draft or group event, move or delete every working order of its
  party, discover; the event's day is marked to be evaluated again. It passes before the change
  too (today `capturedRow` copies the stored location); it fails if `capturedRow` stops marking
  the row as the venue's.
- [ ] **Step 6:** `pnpm --filter @waitron/server exec vitest run` on the test files listed in
  **Files** plus `src/till-clock-api.test.ts src/till-attendance-api.test.ts`; code guards; the
  hash steps; `pnpm --filter @waitron/server typecheck`; `pnpm format:check`.
- [ ] **Step 7: done-check** over the three files and `attendance-facts.ts`: only
  `venueLocationId`, the `attendanceSourceState.locationId` equalities and conflict targets, the
  `attendance_operation_facts` equalities Step 3 kept (S22, decision 3), and
  `reconcileAttendanceBeforeClock`'s scope (S13g).
- [ ] **Step 8: commit** "Attendance discovery and the end-of-day loop run for the venue (A1301 S13f)".

### Task S13g: the till's clock state and the reminder emails read the venue

**Files:** `apps/server/src/till-clock-state.ts`, `till-clock-api.ts` (not `admit`),
`attendance-discovery.ts` (`reconcileAttendanceBeforeClock`'s scope, `:25-54`),
`attendance-email-worker.ts`, `attendance-email.ts`, `i18n/attendance-email.ts`; crossing
`boot.ts:2076-2093` (delete the `locations` name select, which fed only `locationName`, and the
`locationId`/`locationName` arguments). Tests: `till-clock-state.test.ts`, `till-clock-api.test.ts`,
`till-clock-step.test.ts`, `till-clock-attendance.test.ts`, `attendance-email-worker.test.ts`,
`attendance-email.test.ts`, `boot.attendance.test.ts`.

**Produces:** `readTillClockState(tx, { personId }, at)` answering `locationId:
await venueLocationId(tx)`; `reconcileAttendanceBeforeClock(tx, { nodeId, personId }, at)`;
`runAttendanceEmailPass`/`Loop` deps without `locationId`, `locationName`; the sender's message
field `venueName`.

- [ ] **Step 1: failing tests.** `till-clock-state.test.ts`: "reads the state for the venue
  without being told a location": `readTillClockState(tx, { personId }, at)` answers the venue's
  business day and `locationId` equal to the venue's id. FAILS before: `readLocationClock(tx,
  undefined)` throws. `attendance-email-worker.test.ts`: a pass whose deps carry no `locationId`
  or `locationName` sends a message naming the venue's name. FAILS before: the question filter
  `eq(…, undefined)` finds no candidate.
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/till-clock-state.test.ts
  src/attendance-email-worker.test.ts` — FAIL.
- [ ] **Step 3: implement** the rows. The till's `TillClockState.locationId` stays (the till reads
  it, `apps/till/src/till-app.ts:4673`, `:4830`). The email pass reads `(await readVenue(tx)).name`
  inside its claim transaction; the two sentences' words do not change.
- [ ] **Step 4: trim.** `till-clock-state.test.ts` "keeps yesterday's open shift open": delete the
  `Other venue` insert and the read at it (`:225-240`), keep the first read. The S12a cases
  (`till-clock-api.test.ts` "refuses a revoked person, ended session or device moved to another
  location" and the `"location"` row at `:135`) are S12a's; leave them.
- [ ] **Step 5:** run the **Files** tests; code guards; `pnpm exec vitest run
  scripts/personal-log-params.test.ts` (the email's parameters); `pnpm --filter @waitron/server
  typecheck`; `pnpm format:check`.
- [ ] **Step 6: `cfg.locationId`.** If S12a has landed (no `current.locationId !== deps.cfg.locationId`
  in `till-clock-api.ts`), drop `locationId` from `TillClockApiDeps.cfg` (`:30`). If not, leave it:
  S12a's `admit` is its only reader, and "Carried to other slices" (S12a) says whichever lands second drops it.
- [ ] **Step 7: done-check** over the six files: only `venueLocationId`, `TillClockState.locationId`
  (S15), and S12a's `admit` lines and `cfg` field if S12a has not landed.
- [ ] **Step 8: commit** "The clock state and reminder emails read the venue (A1301 S13g)".

### Task S13h: the inbox, a day, hours and corrections read the venue

**Files:** `packages/workforce/src/attendance-reads.ts`, `hours-reads.ts`, `attendance-responses.ts`,
`attendance-response-commands.ts`, `attendance-question-responses.ts`; crossings
`apps/server/src/management-attendance-api.ts:220-221` (`readAttendanceManagerQueue(tx)`; the
`const scope =` at `:220` becomes a bare `parseAttendanceLocationQuery(new URL(c.req.url).searchParams);`
that still validates, since `noUnusedLocals` refuses an unused `scope`) and any call the
typecheck reports. Tests: `packages/workforce/src/attendance-reads.test.ts`,
`hours-reads.test.ts`, `attendance-responses.test.ts`, `attendance-response-commands.test.ts`,
`attendance-response-migration.test.ts` (read only; schema cases are S22's), `correction-groups.test.ts`,
`personal-data.test.ts`.

**Produces:** `readAttendanceInbox(tx, personId)` with `locations: [venue]` always;
`readAttendanceDay(tx, { personId, date })`; `readAttendanceManagerQueue(tx)`;
`readPersonHours(tx, { personId, selection, clock, now })`, `readManagerHours(tx, { selection,
clock, now })`. Every response keeps its `locationId` (and the prompts' `locationName`), now the
venue's (decision 1).

- [ ] **Step 1: failing test.** In `attendance-reads.test.ts`, add "reads a person's day at the
  venue without being told a location": `readAttendanceDay(tx, { personId, date })` answers the
  day's entries with `locationId` equal to the venue's id and the venue's zone. FAILS before:
  `locationInfo(tx, undefined)` throws `attendance.invalid`.
- [ ] **Step 2:** `pnpm --filter @waitron/workforce exec vitest run src/attendance-reads.test.ts` — FAIL.
- [ ] **Step 3: implement** the table rows for S13h. The venue is read once per call (`readVenue`
  and `venueLocationId`); the manager hours read reads it once, not once per person. The
  revision hashes `{ personId, entries, questions, commands, clock: await readVenueClock(tx),
  settings }` (decision 6). `hours-reads.ts`: `HoursInput.locationId` (`:23`) and `windowFor`'s
  empty-location check (`:43-45`) go, and so does the prompt filter (`:109`).
- [ ] **Step 4: delete or trim.** **Delete:** `attendance-reads.test.ts` "retains historical
  locations and their current named zones, excluding locations belonging only to others" and
  "refuses an absent selected location without returning another location's record". **Keep:**
  "keeps recorded history scoped to the inbox subject even in a shared location" (one location,
  two people) and "selects calendar work dates from stored offsets after the location zone
  changes". `attendance-response-commands.test.ts` "stores no location on an approval of a
  manager's proposal and keeps the question's on an answer" stays as it is (the stored value is
  the venue's id). Inbox expectations that listed only the venue when the person had entries now
  list it always: a case asserting `locations: []` for a person with no entries (`attendance-reads.test.ts:139`) changes to the
  venue's row (this decision: the inbox always offers the venue). **Trim** `hours-reads.test.ts`
  "refuses empty scopes and unknown window kinds instead of reading the venue" (`:475`): delete its
  empty-location assertion, `read(undefined, f.personId, now, clock, "")` (`:477-479`), which no
  longer rejects once the check goes; keep the empty-person and unknown-kind assertions. The
  suite's `read()` helper (`:20-36`) drops its `locationId` parameter and property.
- [ ] **Step 5:** run the **Files** tests and `pnpm --filter @waitron/server exec vitest run
  src/management-attendance-api.test.ts src/management-hours-api.test.ts src/till-attendance-api.test.ts
  src/till-hours-api.test.ts src/attendance-till-api.test.ts` (S13i's set; a refusal those still
  expect from the routes' own checks stays red until S13i); code guards; the hash steps; typecheck
  `@waitron/workforce`, `@waitron/server`; `pnpm format:check`.
- [ ] **Step 6: done-check** over the five files: only `venueLocationId`, the response fields the
  table keeps (S15), `attendance-response-commands.ts:81,88` (the wire payload, S15) and
  `attendance-responses.ts`'s `locationBusinessDaySettings` (S23).
- [ ] **Step 7: commit** "The attendance inbox, days, hours and corrections read the venue (A1301 S13h)".

### Task S13i: attendance routes stop checking a workplace

**Files:** `apps/server/src/management-attendance-api.ts`, `till-attendance-api.ts` (not
`admit`), `attendance-export-api.ts`, `attendance-own-scope.ts` (deleted); crossing
`boot.ts:2447` (`cfg: { nodeId: tradingContext.nodeId }`). Tests: `management-hours-api.test.ts`,
`management-attendance-api.test.ts`, `till-attendance-api.test.ts`, `till-hours-api.test.ts`,
`attendance-export-api.test.ts`, `attendance-till-api.test.ts`, `me-api.personal-data-export.test.ts`.
The `cfg` literals the compiler refuses once `ExportDeps.cfg` goes and
`ManagementAttendanceApiDeps.cfg` becomes `{ nodeId }` (only the `cfg` key changes):
`personal-data-export-api.workforce.test.ts:716-720` and `personal-data-time-record.test.ts:120-124`
(both `{ db: suite.db, cfg: { locationId }, exporter }`, S12c's files) drop `cfg`;
`attendance-export-api.test.ts:429-433` (`cfg: { nodeId: fixture.nodeId, locationId:
fixture.locationId }`) becomes `cfg: { nodeId: fixture.nodeId }`.
`apps/server/src/till-api.profile-zones.test.ts` gets a comment-only edit, as the parent plan
allows S12a: its map rows for `GET /api/attendance/hours` (`:102`) and `GET /api/attendance/day`
(`:103`) say "none: own current/historical workplace" and name own-workplace cases; they become
"none: own record" and name surviving cases ("clock-only staff read their own completed hours
passively without recording activity", `till-hours-api.test.ts:60`, for hours; "serves own history
to clock-only staff without service zones and keeps reads passive", `till-attendance-api.test.ts:139`,
for day). `till-api.profile-actions.test.ts` runs unedited.

**Every caller of the own-workplace check** (`git grep -n assertOwnAttendanceLocation -- apps packages`
at `2c4511d58b`, ran: nine calls in eight routes, plus the three imports and the definition):

| Route | Call (file:line) |
| --- | --- |
| `GET /management-api/me/attendance/export-options` (only for a viewer without `report.export`) | `attendance-export-api.ts:65-70` |
| `GET /management-api/me/attendance/export` (the `own` mode of the shared export handler; the manager route `GET /management-api/attendance/export` never calls it) | `attendance-export-api.ts:90-95`, and again after formatting `:127-132` |
| `GET /management-api/me/attendance/hours` | `management-attendance-api.ts:100-104` |
| `GET /management-api/me/attendance/day` | `management-attendance-api.ts:119-123` |
| `POST /management-api/me/attendance/commands` (action `request`) | `management-attendance-api.ts:151-156` |
| till `GET /api/attendance/hours` | `till-attendance-api.ts:145-149` |
| till `GET /api/attendance/day` | `till-attendance-api.ts:190-194` |
| till `POST /api/attendance/commands` (action `request`) | `till-attendance-api.ts:252-257` |

The manager's `POST /management-api/attendance/commands` (action `propose`) does not call it
(`management-attendance-api.ts:251-272`, read).

**Produces:** the routes in "Left for S15", answering for the venue whatever `locationId` the
request names (the export routes still refuse an id that names no `locations` row, through
`requireLocation`, until S15b); `ManagementAttendanceApiDeps.cfg = { nodeId }`; `ExportDeps`
without `cfg`; no `assertOwnAttendanceLocation`.

- [ ] **Step 1: failing test (scope-blind).** `management-hours-api.test.ts` "refuses an unknown
  manager workplace with the same domain refusal as queue and day" (`:587`) becomes "answers the
  venue's hours, queue and day whatever workplace id the query names": the same three paths with
  `crypto.randomUUID()` answer 200, each body's `locationId` the venue's id. Mark it
  `// A1301: deleted with the parameter in S15`. FAILS before (400 `attendance.invalid`).
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/management-hours-api.test.ts` — FAIL.
- [ ] **Step 3: implement.** Delete all nine calls in the table above, their three imports, and
  `attendance-own-scope.ts`; the manager hours' location check and both inbox "push the current
  location" blocks; clocks from `readVenueClock(tx)`; lookups' `locations` =
  `[{ id: await venueLocationId(tx), name, timeZone }]` from `readVenue`; the exporter's
  `locationId` is `await venueLocationId(tx)`; the routes still call the unchanged parsers
  (decision 1) and ignore the parsed `locationId`. **Keep `requireLocation`** in
  `attendance-export-api.ts` (`:38-44`, its calls `:63`, `:89`, and the `locations` import it
  uses): the kept half of the trimmed export case below asserts its refusal word for word (driver's
  ruling 3), and S15b deletes it with the parse. **Auth note for the review:** the own routes still
  answer only the signed-in person's own record and the manager routes still require
  `workforce.correct` / `report.export`; what goes is the 403 `attendance.not_permitted` for a
  request naming an id other than the venue's.
- [ ] **Step 4: delete or trim** (each proves the own-workplace check or isolation between two
  places). **Delete:** `management-hours-api.test.ts` "admits another own workplace only where a
  person with no clock entries has a question" (`:416`) and "refuses a person with clock entries
  everywhere once a second location row exists" (`:439`), with the helpers only they use
  (`otherWorkplace` `:393`, `askQuestionAt` `:400`; `grep -n -E 'otherWorkplace|askQuestionAt'`
  shows no other caller at `2c4511d58b`); `till-attendance-api.test.ts` "refuses arbitrary
  workplaces but permits a workplace where the worker has a question" (`:315`);
  `till-hours-api.test.ts` "refuses a random workplace, and a person with clock entries everywhere
  once a second location row exists" (`:151`); `attendance-export-api.test.ts` "rechecks a %s
  question-only historical workplace after formatting" (both `it.each(["retained", "removed"])`
  variants, `:571-572`). **Trim:** `attendance-export-api.test.ts` "restricts own workplace, allows
  one where the worker has a question and refuses missing location or person after authority"
  (`:224`): delete the `unrelated` location insert (`:225-228`), its 403 line (`:229`), and
  everything after `expect(provider.prepare).not.toHaveBeenCalled();` (the `alternate` and
  `historical` mounts with the `cfg: { …, locationId: unrelated }` rebuild, the question insert and
  the three closing status checks, `:242-268`). The "refuses missing location or person" half stays
  word for word: the random-location 400 `attendance.invalid` line (`:230`), the two manager
  `personId` refusals (`:231-240`) and the not-called check (`:241`). Rename the case "refuses
  missing location or person after authority". Drop imports only the deleted lines used (the lint
  run names them). **Keep:** `management-hours-api.test.ts` "ordinary staff read only their own
  record and configured workplace without the manager permission" and `till-attendance-api.test.ts`
  "offers the configured workplace for a first correction before any clock history" (both assert
  the venue's row; S15 trims their wire half). The S12a variants (`"location"` rows of the
  `it.each` tables at `till-attendance-api.test.ts:230` and `till-hours-api.test.ts:94`) are
  S12a's.
- [ ] **Step 5:** run the **Files** tests, `src/personal-data-export-api.workforce.test.ts
  src/personal-data-time-record.test.ts`, and `src/till-api.profile-zones.test.ts
  src/till-api.profile-actions.test.ts` (`git diff --stat` shows no change to
  `profile-actions`, and `git diff -U0` of `profile-zones` shows only the two comment rows, no
  assertion; the commit and PR name that edit); the text
  guards (`apps/server/src/guide-content.test.ts`, `scripts/guide-links.test.ts`,
  `scripts/claude-md-pointers.test.ts`); code guards; the hash steps;
  `pnpm --filter @waitron/server typecheck`; `pnpm format:check`.
- [ ] **Step 6: `cfg.locationId`.** As S13g Step 6, for `TillAttendanceApiDeps.cfg` (`:48`).
- [ ] **Step 7: done-check.** `git grep -n -E 'assertOwnAttendanceLocation|attendance-own-scope' -- apps packages scripts`
  prints nothing (it prints 13 lines at `2c4511d58b`, ran). Over `management-attendance-api.ts`,
  `till-attendance-api.ts`, `attendance-export-api.ts`: only the lines in "Left for S15" below,
  `venueLocationId`, `requireLocation` and its `locations` import (S15b), and S12a's `admit` lines
  and `cfg` field while S12a is unlanded.
- [ ] **Step 8: commit** "Attendance routes answer for the venue and check no workplace (A1301 S13i)".

### Task S13j: the roster and shift routes and their dashboard methods take no location

**Files:** `apps/server/src/workforce-api.ts` (the three validation statements S13b left in
`GET /management-api/roster` `:124`, `POST /management-api/roster` `:207-208` and
`POST /management-api/roster/:versionId/shifts` `:225`); `apps/dashboard/src/api/client.ts`
(`RosterVersion.locationId` `:1018`, `Shift.locationId` `:1029`, `ShiftInput.locationId` `:1044`,
`MyShift.locationId` `:1117`; `getRoster` `:4199-4204`, `createRosterVersion` `:4206-4211`;
`addShift` `:4213-4218` sends its `ShiftInput` whole, so only the type changes);
`apps/till/src/api/client.ts` (`MyShift.locationId` `:2038`); `docs/backlog.md` (the A1301
entry: "S13 landed (#…)"; S14 can start). Tests: `apps/server/src/workforce-api.test.ts` (the
describes "mountWorkforceApi — locations + roster read/create" `:104` and "mountWorkforceApi —
shift routes" `:224`, and the publish describe's roster requests), `workforce-api.gate-sweep.test.ts`
("refuses every roster write route to a staff-role session — 403 authorization.not_permitted",
`:162`); `apps/dashboard/src/api/client.test.ts` (describe "DashboardApi — roster" `:949`, and
"listMyShifts GETs my shifts over the [from, to) window" `:1170`),
`screens/my-schedule-screen.test.ts:17`, `.a11y.test.ts:16`, `.save-state.test.ts:22`,
`.unsaved.test.ts:34`; `apps/till/src/api/client.test.ts` ("listMyShifts GETs the schedule shifts
window and returns the rows", `:2040`), `screens/till-schedule-screen.test.ts:14`,
`.a11y.test.ts:15`, `.save-state.test.ts:20`, `.unsaved.test.ts:32`.

No screen calls the three methods: `git grep -n -E 'getRoster\(|createRosterVersion\(|addShift\(' -- apps/dashboard packages ':!*.test.ts'`
prints, in `apps/dashboard`, only their definitions in `api/client.ts` (ran at `2c4511d58b`; the
`packages/` lines are the server-side `@waitron/workforce` and `@waitron/staffing` functions of the
same names). `api/live-queries.ts:494` lists `getRoster`'s tables (S23's, unchanged) and three
`dashboard-app*.test.ts` files stub it with `vi.fn()` (unchanged). No screen reads the four
declared fields: `git grep -n locationId -- apps/dashboard/src/screens/my-schedule-screen.ts apps/till/src/screens/till-schedule-screen.ts`
prints nothing (ran). After S13b the server sends none of them (decision 2).

**Produces:** `GET /management-api/roster?period=…`, `POST /management-api/roster` with
`{ period }`, `POST /management-api/roster/:versionId/shifts` with no `locationId` (each route
reads only its named query or body fields, so an extra `locationId` is ignored:
`workforce-api.ts:121-249`, read); `DashboardApi.getRoster(period)`,
`createRosterVersion(period)`; `RosterVersion`, `Shift`, `ShiftInput` and `MyShift` (both apps)
without `locationId`. Depends on S13b's backend signatures; runs last in this plan's order, though
any point after S13b works.

- [ ] **Step 1: failing tests.** In `workforce-api.test.ts`: "GET /management-api/roster returns
  { version: null, shifts: [] } for an empty week" (`:112`) requests `?period=2026-03-02` only;
  "POST /management-api/roster creates a draft and returns { versionId } (201)" (`:122`) sends
  `{ period: "2026-03-09" }`; the shift describe's `draftVersion` (`:225-230`) and `shiftBody`
  (`:231-238`) drop `locationId`, so "POST …/roster/:versionId/shifts adds a shift (201) and GET
  roster shows it" sends none. FAIL before: 400 `shared.invalid_id` on the GET
  (`requireUuidParam("")`) and 400 `management.request_invalid` `{ field: "locationId" }` on both
  POSTs (`requireBodyUuid(undefined)`). In dashboard `api/client.test.ts`, "getRoster GETs the
  snapshot with the location + period query" (`:950`) becomes "getRoster GETs the snapshot for the
  period": `api.getRoster("2026-03-02")` requests `/management-api/roster?period=2026-03-02`;
  "createRosterVersion POSTs { locationId, period }" (`:965`) becomes "createRosterVersion POSTs
  { period }": `api.createRosterVersion("2026-03-02")` sends `JSON.stringify({ period:
  "2026-03-02" })`. FAIL before (the old methods put the one argument where `locationId` goes).
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/workforce-api.test.ts` — FAIL
  on those cases; check free memory (`memory_pressure | grep free`), then
  `pnpm --filter @waitron/dashboard exec vitest run src/api/client.test.ts -t "DashboardApi — roster"`
  — FAIL.
- [ ] **Step 3: implement.** Server: delete the three validation statements; the
  `POST /management-api/roster` body type becomes `{ period?: unknown }`. Dashboard: `getRoster(period)`
  with path `/management-api/roster?period=${period}`; `createRosterVersion(period)` posting
  `{ period }`; delete the four `locationId` fields. Till: delete `MyShift.locationId`.
- [ ] **Step 4: tests.** **Delete** in `workforce-api.test.ts` "400s a non-UUID locationId on GET
  (shared.invalid_id, never a 500)" (`:132`) and "400s a GET /roster with no locationId
  (shared.invalid_id)" (`:144`): they prove only the parse this task deletes. Every other request
  in the file to `GET /management-api/roster`, `POST /management-api/roster` or
  `…/roster/:versionId/shifts` drops `locationId` from its path or body (the breaches requests are
  S13c's, the planned-vs-actual ones S15a's); no assertion changes. In "400s a POST /roster with a
  MALFORMED body (never a 500)" (`:173`) the comment "so `requireBodyUuid` rejects the missing
  locationId" becomes "so `requirePeriod` rejects the missing period" (`requirePeriod(undefined)`
  throws `management.request_invalid`, `packages/server-kit/src/request-screens.ts:23-26`, read);
  its 400 assertion stays. `workforce-api.gate-sweep.test.ts`: the roster GET path (`:176`), the
  `POST /management-api/roster` body (`:189-192`) and the add-shift body (`:195-…`) drop
  `locationId`; the 403 expectations stay. Dashboard `client.test.ts`: "addShift POSTs the shift
  under the version and returns { shiftId }" drops `locationId` from `input` (`:980`); "listMyShifts
  GETs my shifts over the [from, to) window" drops it from its row (`:1174`). Each `MyShift` literal
  in the eight schedule-screen test files and in the till's "listMyShifts GETs the schedule shifts
  window and returns the rows" (`:2046`) loses its `locationId` key (design §1); the typecheck
  finds any literal missed, since a literal typed `MyShift` with an undeclared key does not
  compile.
- [ ] **Step 5:** `pnpm --filter @waitron/server exec vitest run src/workforce-api.test.ts
  src/workforce-api.gate-sweep.test.ts src/me-api.test.ts src/schedule-api.test.ts`; after the
  memory check, `pnpm --filter @waitron/dashboard exec vitest run src/api/client.test.ts
  src/screens/my-schedule-screen.test.ts src/screens/my-schedule-screen.a11y.test.ts
  src/screens/my-schedule-screen.save-state.test.ts src/screens/my-schedule-screen.unsaved.test.ts`
  and `pnpm --filter @waitron/till exec vitest run src/api/client.test.ts
  src/screens/till-schedule-screen.test.ts src/screens/till-schedule-screen.a11y.test.ts
  src/screens/till-schedule-screen.save-state.test.ts src/screens/till-schedule-screen.unsaved.test.ts`
  — each prints a `Tests` line with no failures; code guards; typecheck `@waitron/server`,
  `@waitron/dashboard`, `@waitron/till`; `pnpm format:check`.
- [ ] **Step 6: done-check for the task.**
  `awk '/^export interface (RosterVersion|Shift|ShiftInput|MyShift) \{/{f=1} f&&/locationId/{print FILENAME":"FNR} /^\}/{f=0}' apps/dashboard/src/api/client.ts apps/till/src/api/client.ts`
  prints nothing (control: at `2c4511d58b` it prints dashboard `:1018`, `:1029`, `:1044`,
  `:1117` and till `:2038`, ran); `git grep -n -E 'roster\?locationId|(getRoster|createRosterVersion)\(locationId' -- apps/dashboard/src`
  prints nothing (it prints four lines at `2c4511d58b`, ran); `git grep -n -E 'locationId|LocationId' -- apps/server/src/workforce-api.ts`
  prints only the planned-vs-actual validation statement (S15a).
- [ ] **Step 7: done-check for the whole slice.**
  `FILES=($(git grep -l -E "$P" -- 'packages/workforce/src/*.ts' 'packages/workforce-es/src/*.ts' apps/server/src/attendance-*.ts apps/server/src/management-attendance-api.ts apps/server/src/till-attendance-api.ts apps/server/src/till-clock-*.ts apps/server/src/workforce-api.ts apps/server/src/hours-request.ts apps/server/src/i18n/attendance-email.ts apps/server/src/parties.ts 'packages/staffing/src/rota.ts' 'packages/staffing/src/staffing-types.ts' 'packages/staffing/src/dashboard/*.ts' ':!*.test.ts'))`,
  then the shared done-check over `"${FILES[@]}"`. It may print only: `venueLocationId`; the
  `attendanceSourceState.locationId` equalities and conflict targets, and the
  `attendance_operation_facts` equalities S13f's Step 3 kept (S22, decision 3);
  `attendance-source-changes.ts`'s conflict target (S22); `personal-data.ts:1,67,76,187` (S22,
  "Carried to other slices"); `attendance-responses.ts`'s `locationBusinessDaySettings` (S23);
  `configuration-transfer.ts` ×2 (S17); `dashboard/live-queries.ts` (S23); `record-export.ts`
  (S14); `workforce-api.ts:7,108-118` (S12d); `attendance-export-api.ts`'s `requireLocation` and
  its `locations` import (S15b); every line in "Left for S15" below; S12a's `admit` lines and the
  two `cfg` fields while S12a is unlanded; the recorder's optional `locationId?` while S2 is
  unlanded; S9's lines in `packages/staffing` while S9 is unlanded. Anything else is unfinished.
- [ ] **Step 8: commit** "The roster and shift routes and their dashboard methods take no location (A1301 S13j)".

### Left for S15 (wire contract)

Read at `2c4511d58b`. "Refuses without it" means the route's parse answers 400 to a request that
omits the parameter; S13 keeps that parse unchanged (decision 1), so S15 must change the server
parse and the client sender together.

**Request parameters S13 keeps (server parse → client sender):**

| Route | Server parse | Refuses without it | Client sender |
| --- | --- | --- | --- |
| `GET /management-api/planned-vs-actual` | `workforce-api.ts:405` | yes, 400 `shared.invalid_id` | `apps/dashboard/src/api/client.ts:4258-4262`, from `screens/planned-actual-screen.ts:123-124` |
| `GET /management-api/me/attendance/export-options` | `attendance-export-request.ts:41-44` | yes, 400 (`query`) | `apps/dashboard/src/api/attendance-export.ts:10-12` |
| `GET /management-api/me/attendance/export`, `GET /management-api/attendance/export` | `attendance-export-request.ts:19-24`, `:35` | yes | `attendance-export.ts:20`, `:31`, `:39`, from `widgets/attendance-export-dialog.ts:276` |
| `GET /management-api/me/attendance/hours`, `GET /management-api/attendance/hours`, till `GET /api/attendance/hours` | `hours-request.ts:13-16` | yes | `apps/dashboard/src/api/hours.ts:18-35`; `apps/till/src/api/client.ts:2729-2739` |
| `GET /management-api/me/attendance/day`, `GET /management-api/attendance/day`, till `GET /api/attendance/day` | `attendance-request.ts:150-165` | yes (`query`) | `apps/dashboard/src/api/own-attendance.ts:15-17`, `api/attendance.ts:32-33`; till `client.ts:2743-2748` |
| `GET /management-api/attendance/queue` | `attendance-request.ts:166-169` | yes | `apps/dashboard/src/api/attendance.ts:29-30` |
| `POST …/me/attendance/commands`, `POST /management-api/attendance/commands`, till `POST /api/attendance/commands` (actions `request`, `propose`) | `attendance-request.ts:94-113` | yes (`command`) | dashboard `widgets/my-hours-panel.ts:446`, `screens/attendance-corrections-screen.ts:576`; till `till-app.ts:4893`, `:4930`, `:4950` |

`GET /management-api/roster/breaches` is not here: S13c moved it end to end. Nor are
`GET /management-api/roster`, `POST /management-api/roster` and
`POST /management-api/roster/:versionId/shifts`: S13j moved them end to end with the dashboard's
`getRoster`, `createRosterVersion` and `addShift`. Each of these routes now ignores an extra
`locationId`. The export routes also keep `requireLocation` (`attendance-export-api.ts:38-44`),
which refuses an id naming no `locations` row; S15b deletes it with the parse (driver's ruling 3).

**Response fields S13 keeps (filled from the venue) → client readers:**

| Field (contract or server type) | Filled at (after S13) | Read by |
| --- | --- | --- |
| `AttendanceInbox.locations` (`packages/workforce/src/attendance-contract.ts:85`) | `attendance-reads.ts` (always `[venue]`) | dashboard `widgets/my-hours-panel.ts:244`; till `till-app.ts:4828`, `screens/till-hours-screen.ts:107`, `widgets/attendance-day-dialog.ts:70` |
| `AttendanceLookups.locations` (`:103`) | `management-attendance-api.ts` lookups | `screens/attendance-corrections-screen.ts:248-249` |
| `AttendancePrompt.locationId`, `.locationName` (`:70-71`) | `attendance-reads.ts` | dashboard `my-hours-panel.ts:397`, `:402`, `:556`, `widgets/hours-record.ts:153`; till `till-app.ts:4893`, `screens/till-attendance-questions.ts:96`, `till-hours-screen.ts:177` |
| `AttendancePrompt.day.locationId` (`:73`; S15i removes it) | `attendance-reads.ts` | no client reads it; the client fixtures `apps/dashboard/test/attendance-fixtures.ts:37`, `apps/till/test/attendance-fixtures.ts:37`, `apps/till/src/api/client.attendance.test.ts:57` type it |
| `AttendanceDayView.locationId` (`:89`) | `attendance-reads.ts` | dashboard `my-hours-panel.ts:350`, `:402`, `:446`, `attendance-corrections-screen.ts:480`, `:576`; till `state/attendance.ts:144`, `widgets/attendance-day-dialog.ts:89`, `:172`, `till-app.ts:4910`, `:4930` |
| `AttendanceManagerQueue.locationId` (`:97`) | `attendance-reads.ts` | typed by `apps/dashboard/src/api/attendance.ts:29`; no read found |
| `PersonHours.locationId` (`:134`) | `hours-reads.ts` | dashboard `my-hours-panel.ts:271`, `attendance-corrections-screen.ts:307`, `hours-record.ts:100`; till `state/hours.ts:93`, `till-hours-screen.ts:112`, `:289` |
| `ManagerHours.locationId` (`:152`) | `hours-reads.ts` | `attendance-corrections-screen.ts:306` |
| `AttendanceExportSelection.locationId` (`:161`), `AttendanceCommandPayload` `locationId` (`:16`, `:23`) | request types (above) | the senders above |
| `AttendanceResponseReceipt.locationId` (`:43`; S22 removes it with the column, not S15) | the stored command row (`attendance_response_commands.location_id`, S22) | served by `GET …/attendance/commands/:commandId`; no client read found |
| `TillClockState.locationId` (`apps/server/src/till-clock-state.ts:11`) | `venueLocationId` | till `till-app.ts:4673`, `:4830`; type `apps/till/src/api/client.ts:145` |

**Server lines S15 changes with the clients:** the three parser files (whole); `workforce-api.ts`'s
planned-vs-actual validation statement (`:405`); `attendance-export-api.ts`'s `requireLocation`; the
response fillers listed above; the contract fields above.

### Open PRs touching S13's files

`gh pr list --state open` at 2026-11-01 lists one: **#2384** (S2, owner-landed, head `a8d285eab5`).
Of S13's files it changes `bill-payments.ts` and `till-sale.ts` (decision 5), `working-order.ts`
(hunks at `:4465`, `:4510`, `:7139`, not the recorder lines S13d2 edits),
`attendance-orders.test.ts` (deletes "an edit keeps the order's recorded location when configuration
points elsewhere") and `attendance-order-command-routes.test.ts` (narrows "%s uses the stored order
location rather than the caller's config" to `"invoice-choice"`). Whoever lands second rebases.
S9 (parked), S11 and S12 (pending) touch `packages/staffing/src/rota.ts`, the S11 crossing files
and `till-attendance-api.ts`/`till-clock-api.ts`/`till-api.ts` respectively; none is a PR yet.

---

## S14 — The working-time export names the venue from the venue row; its input carries no location

**Goal.** The art. 34.9 working-time export (the legal record of hours Spain requires an employer to
keep and show) takes no location from its caller. Its opening table's first column, already labelled
"Workplace / Centro de trabajo" by A1268, is filled from `readVenue(tx).name` instead of a
`locations` row looked up by an id the caller passes. `RecordExportInput.locationId` goes, with every
writer of it; the export routes still parse a `locationId` until S15b and no longer pass it on. The
table's column key, which the CSV file prints as its header cell, is renamed `locationName` →
`venueName`. No official workplace code is added (owner's answer (a) to design question 4).

**The column key (driver's ruling 7).** The ruling's `workplace` does not fit the file's spelling,
so S14 follows the file and says so in its PR. In `LABELS` (`packages/workforce-es/src/record-export.ts:29-80`,
read) every column holding a display name is keyed `<whose>Name` while its label drops "name":
`personName` → "Worker" (`:37`), `authorName` → "Author" (`:63`), today's `locationName` →
"Workplace" (`:30`). The key names whose name it is, not the label's word; this name comes from the
venue row, so the key is `venueName`.

- **Depends on:** A1268 (landed), S1 (landed), and **S13** (landed; driver's ruling 3). Reason,
  read and not run: once `prepareTimeRecordExport` reads `readVenue`, any suite that runs the real
  exporter on a database holding two `locations` rows fails with `provisioning.second_venue`. At
  `2c4511d58b`, `apps/server/src/attendance-export-api.test.ts` inserts a second row in two cases:
  "restricts own workplace, allows one where the worker has a question and refuses missing location
  or person after authority" (`:225-228`, then `200` from the real exporter at `:267-268`;
  `provider` is `vi.fn(WORKFORCE_ES_RECORD_EXPORT.prepare)`, `:34`) and "rechecks a %s
  question-only historical workplace after formatting" (`:575`). S13i deletes the second case and
  trims the first to "refuses missing location or person after authority", without its second
  row, so after S13 neither seeds one. Step 1 below confirms that instead of trusting it.
- **Lands:** lane (no owner rule a–d: the export is not an invoice record).
- **Branch:** `refactor/a1301-s14-record-export`.
- **Review path:** FULL — a cross-package contract (`RecordExportInput` in `@waitron/shared`, typed
  by `@waitron/module`, filled by `@waitron/server`, read by `@waitron/workforce-es`).

### Files

| File | Matches at head | What changes |
| --- | --- | --- |
| `packages/shared/src/record-export-types.ts` | 1 (`:5`) | `RecordExportInput.locationId` deleted |
| `packages/workforce-es/src/record-export.ts` | 12 | `locations` import (`:2`) and `eq` if unused; `selected.locationId` copy (`:147`) deleted; the `locations` read by id with the id as fallback name (`:178-182`) becomes `const { name: venueName } = await readVenue(tx)`; `formatTimeRecordExport`'s 4th parameter `locationName` → `venueName` (`:191`); `LABELS.locationName` → `LABELS.venueName` (`:30`, labels unchanged: "Workplace" / "Centro de trabajo"); the metadata section's key list and cell (`:331`, `:333`) |
| `packages/module/src/record-export.ts` | 0 | none (it only types `prepare`'s input; no location read) |
| `apps/server/src/attendance-export-api.ts` | crossing (S13i's and S15b's file) | the `prepare` call's `locationId:` line (after S13i it reads `locationId: await venueLocationId(tx)`) deleted, and the `venueLocationId` import if nothing else uses it. The route keeps parsing `selection.locationId` and checking it with `requireLocation` until S15b |
| `apps/server/src/personal-data-time-record.ts` | crossing, S12c's file | the `prepare` call's `locationId` line (`:38` at head; `locationId: await venueLocationId(tx)` once S12c has landed) deleted, with its import if unused. **If S12c has not landed**, lines `:26-27` (`const { locationId } = subject; if (locationId === null) …`) stay: they read `PersonalDataSubject.locationId`, which is S12c's |
| `apps/server/test/attendance-export-fixture.ts` | test fixture | `prepareTimeRecordExport(tx, { locationId, period, audience, locale })` (`:94`) drops `locationId` |
| `packages/workforce-es/src/record-export.test.ts` | test | the `input()` helper drops `locationId` (`:68-69`); the metadata case below |
| `docs/backlog.md` | docs | A1301's entry says S14 has landed (Step 7) |

Readers of `RecordExportInput`, from
`git grep -n -E 'RecordExportInput|\.prepare\(tx, \{|prepareTimeRecordExport|formatTimeRecordExport' -- apps packages scripts`:
the type in `packages/shared/src/record-export-types.ts:4`, re-exported at
`packages/shared/src/index.ts:255`; typed by `packages/module/src/record-export.ts:7`; built by
`apps/server/src/attendance-export-api.ts:105`, `apps/server/src/personal-data-time-record.ts:37`,
`apps/server/test/attendance-export-fixture.ts:94` and `packages/workforce-es/src/record-export.test.ts:68`;
read only by `packages/workforce-es/src/record-export.ts:147,181`. The brief's list missed
`attendance-export-api.ts:105`; it is a writer, so S14 edits it.

**What a reader of the export sees change:** nothing in the PDF. The CSV's header row, which prints
the column keys and not the labels (`apps/server/src/attendance-export-csv.ts:13-16`), says
`venueName` where it said `locationName`. No test pins that header cell:
`git grep -n -E '"section","row"|section,row' -- 'apps/server/src/*.test.ts' 'packages/*/src/*.test.ts'`
prints nothing, and `git grep -n locationName -- 'apps/server/src/attendance-export*' 'apps/server/src/personal-data*'`
prints nothing. Say so in the PR.

**Guides:** none describes the export's columns.
`git grep -n -i -E "location|workplace|ubicaci|centro de trabajo" -- apps/server/src/guide` prints only
`backup-recovery.md:106`, `content-and-images.md:103,105` and `time-zone.md:9` (EN and ES), none about
working time. No guide edit.

### Task S14a: the export names the venue from the venue row

**Produces:** `RecordExportInput` = `{ personId?, period, audience, locale }`;
`formatTimeRecordExport(record, input, people, venueName)`.

- [ ] **Step 1: confirm the order.** At the task's head, run
  `git grep -n -E 'insert\((schema\.)?locations\)' -- apps/server/src/attendance-export-api.test.ts`
  (it prints `:226` and `:575` at `2c4511d58b`, ran). If it prints any line, S13 has not landed, or
  S13i left a second row: stop and tell the driver. If it prints nothing, carry on. Also confirm the
  kept half is there: `git grep -n "refuses missing location or person after authority" -- apps/server/src/attendance-export-api.test.ts`
  prints one line.
- [ ] **Step 2: failing test.** In `packages/workforce-es/src/record-export.test.ts`, drop `locationId`
  from the `input()` helper (`:68-69`), and in "names the venue once and gives entries and closures no
  workplace column" (`:488`) expect the metadata keys to start `"venueName"` (was `"locationName"`,
  design §1: the venue, not a location) and add
  `expect(cells(english, "metadata")[0]!.venueName).toBe("Deli")` (the suite's one venue row is named
  "Deli", `:42`). FAILS before: the key is `locationName`, and the exporter looks the name up by the
  `locationId` the helper no longer passes.
- [ ] **Step 3:** `pnpm --filter @waitron/workforce-es exec vitest run src/record-export.test.ts` —
  FAIL on that case.
- [ ] **Step 4: implement** the table above.
- [ ] **Step 5:** run `pnpm --filter @waitron/workforce-es exec vitest run src/record-export.test.ts src/index.test.ts`;
  `pnpm --filter @waitron/server exec vitest run src/attendance-export-api.test.ts src/attendance-export-csv.test.ts src/attendance-export-pdf.test.ts src/boot.attendance-export.test.ts src/personal-data-time-record.test.ts src/personal-data-export-api.workforce.test.ts`;
  `pnpm --filter @waitron/module exec vitest run src/record-export.test.ts`;
  `pnpm --filter @waitron/composition exec vitest run src/composition.test.ts` — each prints a
  `Tests` line with no failures. If a suite fails with `provisioning.second_venue`, apply the plan's
  rule "A database with a second venue row" and name the suite in the PR. Then the code guards;
  typecheck `@waitron/shared`, `@waitron/module`, `@waitron/workforce-es`, `@waitron/server`;
  `pnpm format:check`.
- [ ] **Step 6: done-check** over `packages/shared/src/record-export-types.ts`,
  `packages/workforce-es/src/record-export.ts`, `packages/module/src/record-export.ts`,
  `apps/server/src/attendance-export-api.ts`, `apps/server/src/personal-data-time-record.ts`: prints
  nothing in the first three; in `personal-data-time-record.ts` only `:26-27` if S12c has not landed;
  in `attendance-export-api.ts` only the parse-and-check lines S15b removes (`requireLocation`, its
  `locations` import and the `selection.locationId` passed to it).
  Also `git grep -n "locationId" -- apps/server/test/attendance-export-fixture.ts` prints only the
  fixture's own seed and return lines (`:15`-ish insert, the returned `locationId` other suites read),
  which are F5's.
- [ ] **Step 7: backlog.** Update A1301's entry in `docs/backlog.md` (`:6447` at `2c4511d58b`):
  "S14 landed (#…)"; S15-1 can start.
- [ ] **Step 8: commit** `git commit -s` "The working-time export takes its workplace name from the
  venue (A1301 S14)". The PR body names the CSV header change.

### Open PRs touching S14's files

`gh pr list --state open` at 2026-11-01 lists only #2384 (S2). Its files
(`gh api repos/{owner}/{repo}/pulls/2384/files --paginate --jq '.[].filename'`) include none of
S14's. S12c (lane C, not yet a PR) edits `personal-data-time-record.ts`; whoever lands second
rebases.

---

## S15 — Dashboard and till attendance and hours carry no location, end to end

**Goal.** Nobody picks a location to see hours, attendance, corrections, the working-time export or
planned-versus-actual, and no request or response in those areas names one. On the dashboard the
planned-versus-actual location picker (the `dashboard-location-picker` widget) is deleted, and the
Location dropdowns on the corrections screen and the My hours panel go. On the till the Location
dropdowns on the hours screen and the day dialog go. The question and pending cards stop showing the
place's name as their heading. On the server every route below stops taking `locationId` and stops
returning a location. (S13i already deleted the "own attendance at another workplace" check,
`assertOwnAttendanceLocation`; S15 does not touch it.)

- **Depends on:** S13 and S14 (both landed, in that order). S13 keeps every request parameter and
  response field below unchanged (driver's wire rule), so S15 removes both ends.
- **Lands:** lane.
- **Branches and PRs** (one slice, three PRs, landed in this order, each leaving `main` green on
  its own):
  - **S15-1** `refactor/a1301-s15-1-planned-actual` — Task S15a, after S14. S12d may start once it
    has landed.
  - **S15-2** `refactor/a1301-s15-2-attendance-export` — Task S15b, after S15-1.
  - **S15-3** `refactor/a1301-s15-3-attendance-hours` — Tasks S15c–S15k, one PR, after S15-2. Its
    client tasks stop sending a parameter before its server tasks stop requiring it, so only the PR as a whole
    works against a real server; the intermediate commits pass their own focused tests (the clients'
    tests use mocks, and no test drives the dashboard or till against the real attendance routes:
    `git grep -l -E "apps/(till|dashboard)/src" -- 'apps/server/**/*.test.ts'` lists files none of
    which touches attendance, hours or planned-versus-actual). Do not split S15-3.
- **Review path:** FULL — a cross-package contract (`packages/workforce/src/attendance-contract.ts`,
  read by the server, the dashboard through `@waitron/dashboard-modules`, and the till).
- **Browser-mode tests** (dashboard and till run in real headless Chromium): before every dashboard
  or till run, check free memory with `memory_pressure | grep free` and run beside another browser
  session only when it is well above 15%.

### The wire: every route S15 changes, both ends

Each row: the route, what the client sends or reads, whether today's parser refuses a request
without `locationId` (so S13 leaves it), and the S15 task that removes it. "Client" lines are where
the dashboard or till sends or reads it.

| # | Route (server file:line) | Request `locationId` (parser, refuses without?) | Response location field (built at) | Client senders and readers | Task |
| --- | --- | --- | --- | --- | --- |
| 1 | `GET /management-api/planned-vs-actual` (`workforce-api.ts:402-416`) | query; `requireUuidParam(c.req.query("locationId") ?? "")` `:405` refuses without (`shared.invalid_id`; test "400s a request with no locationId", `workforce-api.test.ts:734`) | none | `apps/dashboard/src/api/client.ts:4258-4261`; `screens/planned-actual-screen.ts:99-124` | S15a |
| 2 | `GET /management-api/me/attendance/export-options` (`attendance-export-api.ts:57-76`) | `parseAttendanceExportOptions` `attendance-export-request.ts:41-44`, `exactKeys(query, ["locationId"])` refuses without; then `requireLocation` `:63` (S13i deleted the own-scope check, `:65-70`) | none | `api/attendance-export.ts:10-12`; `widgets/attendance-export-dialog.ts:199-211`; `screens/attendance-corrections-screen.ts:190-207`; `widgets/my-hours-panel.ts:173-190` | S15b |
| 3 | `GET /management-api/me/attendance/export`, `GET /management-api/attendance/export` (`attendance-export-api.ts:77-147`) | `parseAttendanceExportQuery` `attendance-export-request.ts:15-24`, required key; `requireLocation` `:89` (S13i deleted the own-scope checks, `:90-95`, `:127-132`; S14 deleted `prepare`'s `locationId`, `:106`) | none | `api/attendance-export.ts:18-27`; dialog `:74`, `:104`, `:150`, `:276`, `:323`; `.locationId=` bindings `attendance-corrections-screen.ts:812`, `my-hours-panel.ts:709` | S15b |
| 4 | `POST /management-api/me/attendance/commands` (`management-attendance-api.ts:142-168`) | body, action `request`: `attendance-request.ts:94-113` (`keys(…, "locationId")`, `uuid(body.locationId)`) refuses without (S13i deleted the own-scope check, `:151-156`) | none (the result carries none) | payload `my-hours-panel.ts:446` | S15h |
| 5 | `POST /management-api/attendance/commands` (`:251-272`) | body, action `propose`: same parser, refuses without | none | payload `attendance-corrections-screen.ts:576` | S15h |
| 6 | `POST /api/attendance/commands` (`till-attendance-api.ts:242-…`) | body via `envelope` → same parser (S13i deleted the own-scope check, `:252-257`) | none | payload `till-app.ts:4950`; editor field `:2824`, fills `:4893`, `:4930` | S15h |
| 7 | `GET /management-api/me/attendance/inbox` (`management-attendance-api.ts:73-92`) | none (`noQuery`) | `locations` list (`attendance-reads.ts:53-69,145` and the route's push `:81-87`); each prompt's `locationId`, `locationName` (`attendance-reads.ts:98-99,127-128`) | `my-hours-panel.ts:243-246,284,574` (`inbox.locations`); `:397,402` (`prompt.locationId`); `:556` and `hours-record.ts:153` (`prompt.locationName`) | S15i |
| 8 | `GET /api/attendance/inbox` (`till-attendance-api.ts:157-182`) | none | same, push `:171-177` | `till-app.ts:4827-4837,5024,19371-19381`; `screens/till-hours-screen.ts:107,129-130,177,214`; `screens/till-attendance-questions.ts:96`; `widgets/attendance-day-dialog.ts:70,102,187` | S15i |
| 9 | `GET /management-api/attendance/lookups` (`management-attendance-api.ts:190-213`) | none | `locations` list `:197-200,207` | `attendance-corrections-screen.ts:248-250,718` | S15i |
| 10 | `GET /management-api/me/attendance/hours` (`management-attendance-api.ts:93-111`) | `parseHoursQuery` `hours-request.ts:14-16`, exact keys, refuses without (S13i deleted the own-scope check, `:100-104`); `readLocationClock(tx, scope.locationId)` `:106` | `PersonHours.locationId` (`hours-reads.ts:163`); its `pending.prompts` filtered by location (`hours-reads.ts:109`) | `api/hours.ts:18-30,54-58`; `my-hours-panel.ts:264-271`; `hours-record.ts:100` | S15j |
| 11 | `GET /management-api/attendance/hours` (`:169-189`) | same parser; the location-exists check `:176-182`; `readLocationClock` `:184` | `ManagerHours.locationId` (`hours-reads.ts:196`) and each person's `hours.locationId` | `api/hours.ts:33-38,60-64`; `attendance-corrections-screen.ts:287-307,327` | S15j |
| 12 | `GET /api/attendance/hours` (`till-attendance-api.ts:138-156`) | same parser (S13i deleted the own-scope check, `:145-149`); `readLocationClock` `:151` | `PersonHours.locationId` | `apps/till/src/api/client.ts:2729-2740`; `state/hours.ts:35,54-93`; `till-hours-screen.ts:112,289`; `till-app.ts:4673-4712` | S15j |
| 13 | `GET /api/clock/state`, `POST /api/clock/{in,out,break-start,break-end}` (`till-clock-api.ts:87-139`) | none | `TillClockState.locationId` (`till-clock-state.ts:11,58`; scope from `deps.cfg.locationId` at `till-clock-api.ts:103,129,170` until S13g narrows it) | till type `client.ts:145`; read at `till-app.ts:4673,4830` | S15j (server); S15f (till stops reading) |
| 14 | `GET /management-api/me/attendance/day` (`management-attendance-api.ts:112-128`) | `parseAttendanceDayQuery(…, "worker")` `attendance-request.ts:150-165`, exact keys, refuses without (S13i deleted the own-scope check, `:119-123`) | `AttendanceDayView.locationId` (`attendance-reads.ts:170`, `...scope`); zone from `locationInfo` `:158` | `api/own-attendance.ts:15-20,41-46`; `my-hours-panel.ts:344-350` | S15k |
| 15 | `GET /management-api/attendance/day` (`:226-237`) | same parser, manager keys, refuses without | same | `api/attendance.ts:32-33,68-71`; `attendance-corrections-screen.ts:474-490` | S15k |
| 16 | `GET /api/attendance/day` (`till-attendance-api.ts:183-199`) | worker parser (S13i deleted the own-scope check, `:190-194`) | same | `client.ts:2742-2748`; `state/attendance.ts:140-144`; `till-app.ts:4910` | S15k |
| 17 | `GET /management-api/attendance/queue` (`management-attendance-api.ts:214-225`) | `parseAttendanceLocationQuery` `attendance-request.ts:166-169`, exact key, refuses without; `locationInfo` check `attendance-reads.ts:184` | `AttendanceManagerQueue.locationId` (`attendance-reads.ts:193`) | `api/attendance.ts:29-30,65-66`; `attendance-corrections-screen.ts:273-280` | S15k |
| 18 | `GET /management-api/locations` (`workforce-api.ts:108-119`) | — | the list itself | `planned-actual-screen.ts:99` (last production caller) | S12d |

Not S15's: the roster and shift routes (`/management-api/roster…`, `workforce-api.ts:121-336`), their
dashboard methods (`getRoster`, `createRosterVersion`, `addShift`), and the client declarations
`RosterVersion.locationId`, `Shift.locationId`, `ShiftInput.locationId` and `MyShift.locationId`
(`apps/dashboard/src/api/client.ts:1018`, `:1029`, `:1044`, `:1117`; `apps/till/src/api/client.ts:2038`):
S13j moved them end to end (driver's ruling 1).

### Files (area grep at head; non-test)

| File | Matches | Task(s) |
| --- | --- | --- |
| `apps/dashboard/src/screens/planned-actual-screen.ts` | 26 | S15a |
| `apps/dashboard/src/widgets/location-picker.ts` (deleted) | 18 | S15a |
| `apps/dashboard/src/api/client.ts` (`getPlannedVsActual`, `:4258-4261`) | 2 of 27 | S15a (the rest: S12d, S5; S13j removed the roster lines) |
| `apps/dashboard/src/api/attendance-export.ts` | 3 | S15b |
| `apps/dashboard/src/widgets/attendance-export-dialog.ts` | 9 | S15b |
| `apps/dashboard/src/api/attendance.ts` | 9 | S15c |
| `apps/dashboard/src/api/hours.ts` | 12 | S15c |
| `apps/dashboard/src/api/own-attendance.ts` | 5 | S15c |
| `apps/dashboard/src/screens/attendance-corrections-screen.ts` | 39 | S15b (`:190-207`, `:812`), S15c (call sites), S15d, S15h (`:576`) |
| `apps/dashboard/src/widgets/my-hours-panel.ts` | 38 | S15b (`:173-190`, `:709`), S15c (call sites), S15e, S15h (`:446`) |
| `apps/dashboard/src/widgets/hours-record.ts` | 2 | S15e |
| `apps/till/src/api/client.ts` | 17 (11 working time; `:1113-1164` are "allocation", unrelated; `:167,1322,1401,3177` comments) | S15f (methods, `TillClockState`), S15g (comments) |
| `apps/till/src/state/hours.ts` | 9 | S15f |
| `apps/till/src/state/attendance.ts` | 3 | S15f |
| `apps/till/src/till-app.ts` | 83 (about 30 working time; the rest are "relocation", "allocation", browser `location.*` and comments `:3238,3240,3246,9207`) | S15f (data path), S15g (bindings, comments), S15h (editor and payload), S15i (default date's zone) |
| `apps/till/src/screens/till-hours-screen.ts` | 17 | S15g |
| `apps/till/src/widgets/attendance-day-dialog.ts` | 14 | S15g |
| `apps/till/src/screens/till-attendance-questions.ts` | 1 | S15g |
| `apps/till/src/i18n/strings.ts` | 3 | S15g |
| `apps/till/src/layout.ts`, `screens/till-ticket-view.ts`, `widgets/receipt-language.ts` | 1, 1, 3 (comments: "the location's address / receipt languages") | S15g (comment-only) |
| `apps/dashboard/src/i18n/strings.ts` (`attendance.location`, `planned.location`, `planned.no_location`, `attendance.time_skipped`) | 7 of 15 (`:108`, `:126`, `:2373`, `:2384`, `:3861`, `:6167`, `:6178`; the Spanish `attendance.time_skipped`, `:3879`, says "ubicación", which the pattern does not match, and S15e rewords it too) | S15a, S15e |
| `apps/server/src/workforce-api.ts` (`:401-416` only) | 3 of 21 | S15a |
| `packages/workforce/src/clocking.ts` (`getPlannedVsActual`, `:223-260`, only if S13 left its `locationId` parameter) | — | S15a |
| `apps/server/src/attendance-export-request.ts` | 5 | S15b |
| `apps/server/src/attendance-export-api.ts` | 22 | S15b |
| `apps/server/src/attendance-request.ts` | 8 | S15h (`:94-113`), S15k (`:150-169`) |
| `apps/server/src/hours-request.ts` | 4 | S15j |
| `apps/server/src/management-attendance-api.ts` | 33 | S15i, S15j, S15k |
| `apps/server/src/till-attendance-api.ts` | 20 (`:101-102` is S12a's `admit`) | S15i, S15j, S15k |
| `apps/server/src/till-clock-state.ts`, `till-clock-api.ts` | 5, 7 | S15j (`till-clock-state.ts:11,58`); S13g did `till-clock-state.ts:35,38` and `till-clock-api.ts:103,129,152,170`; `till-clock-api.ts:30,79-80` are S12a's |
| `packages/workforce/src/attendance-contract.ts` | 12 | S15b (`:161`), S15h (`:16,23`), S15i (`:70-71,73,85,103`), S15j (`:134,152`), S15k (`:89,97`); `:43` (`AttendanceResponseReceipt.locationId`) is S22's |
| `packages/workforce/src/attendance-reads.ts` | 32 | S15i (inbox `:53-145`), S15k (`:24-31,150-194`) |
| `packages/workforce/src/hours-reads.ts` | 7 | S15j (`:100,163,196`); S13h did `:23`, `:44-45`, `:109` |
| `packages/workforce/src/attendance-response-commands.ts` | 5 (`:81,88` S15h; `:191,210,270` S13) | S15h |
| `packages/workforce/src/dashboard/live-queries.ts` (`lookups` dependencies) | 4 | S15i (`:13` only; `record` keeps its tables, S23) |
| Test fixture helpers `apps/dashboard/test/{attendance,hours,manager-hours}-fixtures.ts`, `apps/till/test/{attendance-fixtures,clock-app,hours-fixtures}.ts` | 5, 3, 11, 5, 6, 3 | the task that drops the field they mock |

`apps/till/src/state/bill-payment.ts` (6 matches) is not working time: every match is
`AllocationChoice`, `AllocationPreview` or `bill.allocation_changed` ("allocation" matches
`[a-z]Location`'s neighbour `[Ll]ocation[A-Z_]`), the file assignment's "UNRELATED". No slice changes
it; S18's whole-tree done-check lists it as an unrelated word.

### Cross-location cases S15 deletes or trims (by file and title)

S13 deleted or trimmed the cases that prove the own-workplace check (S13i: `management-hours-api.test.ts`
`:416`, `:439`; `till-hours-api.test.ts:151`; `till-attendance-api.test.ts:315`;
`attendance-export-api.test.ts:571-572` and the trim of `:224`) and the two
`attendance-reads.test.ts` cases (`:267`, `:362`, S13h), so none of them is listed here.

Deleted whole (each exists only to prove a refusal or isolation between two places):
- `apps/server/src/management-hours-api.test.ts`: "answers the venue's hours, queue and day whatever
  workplace id the query names" (S13i's rewrite of `:587`, marked for deletion with the parameter;
  nothing passes an id any more, design §1).
- `apps/server/src/attendance-request.test.ts`: "requires a location UUID %#" (`:125`); "requires an
  exact location-only scope for a manager queue" (`:287`, replaced by S15k's "manager queue takes no
  query").
- `apps/server/src/workforce-api.test.ts`: "400s a non-UUID locationId (shared.invalid_id)"
  (planned-vs-actual block, `:722`).
- `apps/dashboard/src/widgets/location-picker.test.ts` and `location-picker.a11y.test.ts` (whole
  files, with the widget).
- `apps/dashboard/src/screens/planned-actual-screen.test.ts`: "reloads on a location change" (`:98`),
  "shows the no-location prompt when the tenant has no locations" (`:128`), "surfaces a rejected
  location change as the error banner" (`:186`), "preserves the selected location across a
  disconnect/reconnect" (`:233`), the whole `describe("planned-actual-screen — location refreshes")`
  (`:280`: "moves to a remaining location when a refresh removes the selected one", "keeps the
  selected location, re-reading its rows once, when a refresh still lists it"), "shows a failed
  locations read's message, not the no-location prompt, until it succeeds" (`:426`), "keeps the
  no-location prompt for a list that loaded empty when a later read fails" (`:450`).
- `apps/dashboard/src/screens/attendance-corrections-screen.test.ts`: "changing location replaces its
  queue and removes the prior day before another read" (`:718`); "a missing selected location blocks
  an edited proposal without overwriting its draft" (`:739`).
- `apps/dashboard/src/screens/attendance-corrections-screen.hours.test.ts`: "drops a held old location
  summary before displaying the new workplace" (`:90`).
- `apps/dashboard/src/widgets/my-hours-panel.export.test.ts`: "reads availability for the newly
  selected historical workplace" (`:145`; S15b's, as it reads the dialog's `locationId`
  property, `:152`), and the `"location-removed"` variant of the `it.each` at `:119` (S15e's).
- `apps/dashboard/src/widgets/attendance-export-dialog.test.ts`: the `"locationId"` variant of
  "suppresses an old download after %s changes" (`:166`; it sets `el.locationId = "other-place"`,
  `:188`), S15b's.
- `apps/dashboard/src/widgets/my-hours-panel.test.ts`: "retires a failed day's load message when its
  location is left" (`:453`).
- `apps/dashboard/src/api/attendance.test.ts`: the `"locations"` variant of "a %s event refreshes
  mounted lookups for eligibility or edit zones" (`:318`).
- `apps/till/src/state/hours.test.ts`: the `"location"` variant of the `it.each` at `:133`.

Trimmed (the other half kept word for word, the second place or the parameter removed):
- `management-hours-api.test.ts` "ordinary staff read only their own record and configured workplace
  without the manager permission" (`:123`): drop the `locations` expectation and the `locationId=`
  from the day path; keep the rest.
- `till-attendance-api.test.ts` "offers the configured workplace for a first correction before any
  clock history" (`:163`): drop the two `locations` expectations and the `locationId` in the day path
  and command body; keep the empty-inbox, empty-day, submitted-request and waiting-manager checks.
- `attendance-export-api.test.ts` "refuses missing location or person after authority" (S13i's trim
  of `:224`): delete its random-location refusal (`ask("own", { locationId: crypto.randomUUID() })`,
  400 `attendance.invalid`), which proves `requireLocation`; keep the two `personId` refusals and
  the "not called" check; rename "refuses a missing person after authority".
- `apps/dashboard/src/widgets/my-hours-panel.test.ts` "month and historical-location selections
  retire a held older summary" (`:303`): keep the month half.
- `apps/till/src/state/hours.test.ts` "an old selection cannot replace a newer location/date or clear
  its reading state" (`:68`): keep the date half.
- `apps/till/src/screens/till-hours-screen.test.ts` "selectors emit only admitted locations and use
  calendar arithmetic for the next window" (`:135`): keep the calendar half.
- `apps/till/src/widgets/attendance-day-dialog.test.ts` "date and location selectors request the
  exact selection and hide stale actions immediately" (`:161`): keep the date half.

A kept case's title may lose the words that named the deleted half; the commit lists each rename.
`till-attendance-api.test.ts`'s `"location"` variant of "rechecks %s admission on every attendance
route" (`:230`) and `till-hours-api.test.ts`'s `"location"` variant of "refuses changed %s admission
without revealing hours" (`:94`) are S12a's (the `admit` refusal), not S15's.

### Task S15a: planned versus actual reads the week with no location; the picker widget goes (PR S15-1)

**Files:** `apps/dashboard/src/screens/planned-actual-screen.ts`, `widgets/location-picker.ts`
(deleted), `api/client.ts` (`getPlannedVsActual`, `:4256-4261`), `api/live-queries.ts` (no change:
`getPlannedVsActual`'s table list stays, S23), `i18n/strings.ts` (`planned.location` EN `:2373` and ES
`:6167`, `planned.no_location` EN `:2384` and ES `:6178` deleted); `apps/server/src/workforce-api.ts`
(`:401-416`); `packages/workforce/src/clocking.ts` (`getPlannedVsActual`'s `query.locationId` and
`plannedShiftsInPeriod`'s `locationId` parameter, `:223-260`, if S13 left them). Tests:
`planned-actual-screen.test.ts`, `planned-actual-screen.a11y.test.ts`, `location-picker*.test.ts`
(deleted), `api/client.test.ts` (the `getPlannedVsActual` case), `api/live-queries.test.ts:114` (args
`["location", "2026-09-01", "2026-09-11"]` → `["2026-09-01", "2026-09-11"]`),
`apps/server/src/workforce-api.test.ts` (planned-vs-actual block `:711-770`),
`workforce-api.gate-sweep.test.ts:292,326` (`packages/workforce/src/pay-period-closure.test.ts:156`
is S13b's, which changes `getPlannedVsActual`'s input).

| Where | What changes |
| --- | --- |
| `planned-actual-screen.ts` | `locations`, `locationId`, `#locationsLoaded` state (`:77-84`), the `getLocations` watch (`:99-113`), `#onSelectLocation` (`:135-144`), the picker element (`:192-198`) and its import (`:6-7`, `LocationSummary` in `:10`) go; `#load` watches `listStaff` and the rows; `#loadRows` watches `getPlannedVsActual` with `[weekMonday, weekEnd(weekMonday)]`; `#renderMain` renders the body, or the error when the first rows read failed (the "no location configured" prompt goes); the CSS comment naming the picker (`:36-38`) goes |
| `client.ts` | `getPlannedVsActual(from, to)`, URL `/management-api/planned-vs-actual?from=…&to=…` |
| `workforce-api.ts` | `:405` deleted; `backend.getPlannedVsActual(tx, { period })`; comment `:401` → "The venue's planned-vs-actual comparison over a half-open [from, to) local window." |
| `clocking.ts` | only if S13 left `locationId` in `getPlannedVsActual`'s query: it goes, with `plannedShiftsInPeriod`'s parameter (S13 deletes the `shifts.location_id` filter) |

- [ ] **Step 1: failing tests.** In `apps/server/src/workforce-api.test.ts`, replace "400s a request
  with no locationId (shared.invalid_id)" with "answers a request with no location": `GET
  /management-api/planned-vs-actual?from=2026-03-02&to=2026-03-09` → `200`, body `[]`. FAILS before
  (`400`). In `planned-actual-screen.test.ts`, change "loads locations, staff and the week's rows on
  connect, resolving the person name" (`:70`) to "loads staff and the week's rows on connect, resolving
  the person name": expect `api.getPlannedVsActual` called with `(Monday, Monday+7)` and no
  `getLocations` call. FAILS before (called with a location id first).
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/workforce-api.test.ts -t "planned-vs-actual"`
  — FAIL; check free memory, then
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/planned-actual-screen.test.ts` — FAIL.
- [ ] **Step 3: implement** the table; delete the picker widget and its two test files.
- [ ] **Step 4: delete the cases** listed under "Cross-location cases" for `planned-actual-screen.test.ts`
  and `workforce-api.test.ts`; update the remaining stubs (no `getLocations`).
- [ ] **Step 5:** run `pnpm --filter @waitron/server exec vitest run src/workforce-api.test.ts src/workforce-api.gate-sweep.test.ts`;
  `pnpm --filter @waitron/workforce exec vitest run src/pay-period-closure.test.ts src/planned-vs-actual.test.ts`;
  after the memory check,
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/planned-actual-screen.test.ts src/screens/planned-actual-screen.a11y.test.ts src/api/client.test.ts src/api/live-queries.test.ts`
  (the dashboard has no `src/i18n/strings.test.ts`)
  — each prints `Tests` with no failures; code guards; typecheck `@waitron/server`,
  `@waitron/workforce`, `@waitron/dashboard`; `pnpm format:check`. Open the screen in the dev stack
  (`wa-wt demo <worktree-name>`) and look at it in both themes and at phone width: the week field
  stands alone where the picker was.
- [ ] **Step 6: done-check** over `planned-actual-screen.ts` and `workforce-api.ts:401-416`: prints
  nothing; `git grep -n -E "location-picker|resolveLocationSelection|dashboard-location-picker|planned\.(no_)?location" -- apps packages`
  prints nothing. `getLocations` and `LocationSummary` remain in `client.ts` and `live-queries.ts`
  for S12d.
- [ ] **Step 7: backlog.** Update A1301's entry in `docs/backlog.md`: "S15-1 landed (#…)"; S15-2
  and S12d can start.
- [ ] **Step 8: commit** "Planned versus actual reads the venue's week with no location picker (A1301 S15a)".

### Task S15b: the working-time export takes no location (PR S15-2)

**Files:** dashboard `api/attendance-export.ts`, `widgets/attendance-export-dialog.ts`,
`screens/attendance-corrections-screen.ts` (`#loadExportOptions` `:188-215` and the `.locationId=`
binding `:812`), `widgets/my-hours-panel.ts` (`#loadExportOptions` `:171-198`, binding `:709`);
`packages/workforce/src/attendance-contract.ts` (`AttendanceExportSelection.locationId`, `:161`);
server `attendance-export-request.ts`, `attendance-export-api.ts`. Tests:
`apps/dashboard/src/api/attendance-export.test.ts`, `widgets/attendance-export-dialog*.test.ts`,
`widgets/my-hours-panel.export.test.ts`, `screens/attendance-corrections-screen.export.test.ts`;
`apps/server/src/attendance-export-request.test.ts`, `attendance-export-api.test.ts`,
`boot.attendance-export.test.ts:120-123`, `personal-data-export-api.workforce.test.ts:715-733`,
`personal-data-time-record.test.ts:118-135` (S12c's files: the query only; S13i dropped their `cfg`).
Two dashboard cases that read the dialog's `locationId` property, which this task deletes:
`attendance-export-dialog.test.ts`'s `"locationId"` variant of "suppresses an old download after %s
changes" (`:166`, `:188`) and `my-hours-panel.export.test.ts` "reads availability for the newly
selected historical workplace" (`:145`).

| Where | What changes |
| --- | --- |
| `attendance-export-request.ts` | `parseAttendanceExportQuery`'s key list and `selection` lose `locationId` (`:21`, `:24`, `:35`); `parseAttendanceExportOptions` takes no query (`exactKeys(query, [])`) and returns nothing |
| `attendance-export-api.ts` | `requireLocation` (`:38-44`, kept by S13i for the case below) and its calls (`:63`, `:89`) and the `locations` import go, so the routes read no location at all (S13i already deleted the own-scope calls and `ExportDeps.cfg`; S14 already stopped passing `locationId` to `prepare`) |
| `attendance-contract.ts` | `AttendanceExportSelection.locationId` deleted |
| dashboard | `options()` takes no argument and sends no query; `#query` sends no `locationId`; the dialog's `locationId` property and its gates (`:74`, `:104`, `:150`, `:199-211`, `:276`, `:323`) go; both screens load export options once when active (no reload keyed on a location) and stop binding `.locationId` |

- [ ] **Step 1: failing tests.** `attendance-export-request.test.ts`: replace "options accepts exactly
  one valid location reference" (`:130`) with "options takes no query": `parseAttendanceExportOptions(new URLSearchParams())`
  does not throw, and `?locationId=<uuid>` throws `management.request_invalid`. In
  `attendance-export-api.test.ts`, the `query()` helper (`:68-76`) drops `locationId`; "exports staff's
  own rich history and frozen snapshots without changing the record" (`:137`) then requests with no
  location. Both FAIL before (the parser requires the key). In `api/attendance-export.test.ts`,
  assert the options URL is `/management-api/me/attendance/export-options` with no query. FAILS before.
- [ ] **Step 2:** run the two server files and (memory check) the dashboard file — FAIL.
- [ ] **Step 3: implement** the table.
- [ ] **Step 4: trim** "refuses missing location or person after authority" as listed under
  "Cross-location cases"; in `attendance-export-request.test.ts` drop the `"locationId"` variant of
  the `it.each` at `:81`. **Delete** `attendance-export-dialog.test.ts`'s `"locationId"` variant of
  "suppresses an old download after %s changes" (the `it.each` row `:166` and its branch `:188`) and
  `my-hours-panel.export.test.ts` "reads availability for the newly selected historical workplace"
  (`:145`): both set or read the property this task deletes.
- [ ] **Step 5:** run `pnpm --filter @waitron/server exec vitest run src/attendance-export-request.test.ts src/attendance-export-api.test.ts src/boot.attendance-export.test.ts src/personal-data-export-api.workforce.test.ts src/personal-data-time-record.test.ts`;
  after the memory check,
  `pnpm --filter @waitron/dashboard exec vitest run src/api/attendance-export.test.ts src/widgets/attendance-export-dialog.test.ts src/widgets/attendance-export-dialog.a11y.test.ts src/widgets/attendance-export-dialog.unsaved.test.ts src/widgets/my-hours-panel.export.test.ts src/screens/attendance-corrections-screen.export.test.ts`
  — PASS; code guards; typecheck `@waitron/workforce`, `@waitron/server`, `@waitron/dashboard`;
  `pnpm format:check`.
- [ ] **Step 6: done-check** over `attendance-export-request.ts`, `attendance-export-api.ts`,
  `api/attendance-export.ts`, `attendance-export-dialog.ts`: prints nothing.
- [ ] **Step 7: backlog.** Update A1301's entry in `docs/backlog.md`: "S15-2 landed (#…)"; S15-3
  can start.
- [ ] **Step 8: commit** "The working-time export takes no location (A1301 S15b)".

### Task S15c: the dashboard's attendance and hours API clients send no location (PR S15-3)

**Files:** `apps/dashboard/src/api/attendance.ts` (`queue()`, `day(personId, date)`, `queueQuery()`,
`dayQuery(personId, date)`, `:29-33,65-71`), `api/hours.ts` (`#path(selection)`, `own(selection)`,
`manager(selection)`, `ownQuery`, `managerQuery`, `:18-64`), `api/own-attendance.ts` (`day(date)`,
`dayQuery(date)`, `:15-20,41-46`); the call sites only (argument removed) in
`attendance-corrections-screen.ts:278,300,479` and `my-hours-panel.ts:268,349`; the mocks that read
`args.get("locationId")` in `apps/dashboard/test/manager-hours-fixtures.ts:120-146` (answer with the
fixture's own constant instead); tests `api/attendance.test.ts`, `api/hours.test.ts`,
`api/own-attendance.test.ts`.

- [ ] **Step 1: failing test.** In `api/hours.test.ts`, the own and manager reads' expected URLs carry
  only `kind` (and `date`); in `api/own-attendance.test.ts`, "a day query distinguishes location and
  date without adding a person to the wire" (`:71`) becomes "a day query names only the date, without
  adding a person to the wire". FAIL before.
- [ ] **Step 2:** (memory check) `pnpm --filter @waitron/dashboard exec vitest run src/api/hours.test.ts src/api/own-attendance.test.ts src/api/attendance.test.ts` — FAIL.
- [ ] **Step 3: implement**; query keys lose the location element (`["hours", "own", kind, date]`,
  `["attendance", "ownDay", date]`). The screens keep their location state until S15d/S15e.
- [ ] **Step 4:** run the three api tests plus every test file that imports
  `test/manager-hours-fixtures.ts`, `test/hours-fixtures.ts` or `test/attendance-fixtures.ts`
  (`git grep -l -E "(manager-hours|hours|attendance)-fixtures" -- 'apps/dashboard/src/**/*.test.ts'`)
  — PASS; code guards; `pnpm --filter @waitron/dashboard typecheck`; `pnpm format:check`.
- [ ] **Step 5: done-check** over the three api files: prints nothing.
- [ ] **Step 6: commit** "The dashboard's attendance and hours requests name no location (A1301 S15c)".

### Task S15d: the corrections screen has no Location field (PR S15-3)

**Files:** `apps/dashboard/src/screens/attendance-corrections-screen.ts`; tests
`attendance-corrections-screen.test.ts`, `.hours.test.ts`, `.a11y.test.ts`, `.unsaved.test.ts`.

| Where | What changes |
| --- | --- |
| state | `locationId` (`:125`) and its reset (`:234`) go |
| lookups watch (`:244-262`) | stops choosing a location from `value.locations`; a person change alone releases the day; the queue is watched once on connect |
| `#watchQueue`, `#watchHours` (`:267-330`) | the `!this.locationId` gates go; the hours watch's check that the answer names the requested place (`:305-308`, "Hours do not match the workplace") goes; the generation and date checks stay |
| `@hours-day` handler (`:421-430`), `#select` (`:458-470`), `#watchDay` (`:474-492`) | the location field branch and every `locationId` comparison go; `day.locationId` is no longer checked |
| render | the `attendanceLocation` dropdown (`:714-721`) goes; the Show button's enable test (`:742-743`) drops `this.locationId` |
| left for S15h | the propose payload's `locationId: this.view.locationId` (`:576`): the contract still requires it |

- [ ] **Step 1: failing test.** In `attendance-corrections-screen.test.ts`, add "has no Location field
  and reads the queue as soon as lookups arrive": after mounting with the fixture,
  `root.querySelector('[name="attendanceLocation"]')` is `null` and the queue request was made. FAILS
  before (the field renders).
- [ ] **Step 2:** (memory check) run it — FAIL.
- [ ] **Step 3: implement** the table.
- [ ] **Step 4: delete** the corrections-screen cases listed under "Cross-location cases";
  `manager-hours-fixtures.ts:164` stops waiting for `[name="attendanceLocation"]` (wait for the
  person field instead).
- [ ] **Step 5:** (memory check) run the four corrections-screen test files and the other files
  importing `manager-hours-fixtures.ts` — PASS; code guards; dashboard typecheck; `pnpm format:check`.
  Look at the screen in both themes and at phone width.
- [ ] **Step 6: done-check** over the screen: prints only `:576` (S15h).
- [ ] **Step 7: commit** "The corrections screen has no Location field (A1301 S15d)".

### Task S15e: My hours and the hours record have no Location field or place heading (PR S15-3)

**Files:** `apps/dashboard/src/widgets/my-hours-panel.ts`, `widgets/hours-record.ts`,
`i18n/strings.ts` (`attendance.location` EN `:108`, ES `:3861` deleted once neither the corrections
screen nor this panel uses it; `attendance.time_skipped` EN `:126` "…on this date in this location." →
"…on this date at this venue.", ES `:3879` "…en esta fecha y ubicación." → "…en esta fecha en este
local."); `apps/dashboard/test/hours-fixtures.ts`, `attendance-fixtures.ts` (mocks only, see below);
tests `my-hours-panel*.test.ts`, `hours-record.test.ts` (the dashboard has no
`i18n/strings.test.ts`).

| Where | What changes |
| --- | --- |
| `my-hours-panel.ts` state | `locationId` (`:90`, reset `:210`) goes |
| inbox watch (`:240-256`) | stops choosing a location from `value.locations`; starts the hours read when active |
| `#watchHours` (`:262-276`), `#select` (`:279-290`), `#openDay`/`#readDay` (`:332-355`), prompt open (`:394-404`) | the location field, gates and every `locationId` comparison go; `#readDay(date)`; a prompt opens its `businessDay` |
| prompt heading `:556`, `hours-record.ts:153` | the heading shows the business day alone (`<h3>${prompt.businessDay}</h3>`, rendered only when `businessDay` is set; a proposal has none, and its text line already says what it is). See driver's ruling 5 |
| `hours-record.ts:100` | the `hours-day` event's detail is `{ date }` |
| render | the `hoursLocation` dropdown (`:570-577`) goes |
| left for S15h | the request payload's `locationId: this.day.locationId` (`:446`) |

The test fixture files keep the response fields (`locationId`, `locationName`, `locations`) while the
contract still declares them; S15h–S15k remove them.

- [ ] **Step 1: failing test.** In `my-hours-panel.test.ts`, add "has no Location field and reads
  hours once the inbox arrives": `root.querySelector('[name="hoursLocation"]')` is `null`; the hours
  read was made. FAILS before.
- [ ] **Step 2:** (memory check) run it — FAIL.
- [ ] **Step 3: implement** the table.
- [ ] **Step 4: delete and trim** the my-hours cases listed under "Cross-location cases".
- [ ] **Step 5:** (memory check) run `my-hours-panel.test.ts`, `.export.test.ts`, `.a11y.test.ts`,
  `.unsaved.test.ts`, `hours-record.test.ts`, and the
  `screens/my-schedule-screen*.test.ts` files that mount the panel — PASS; code guards; dashboard
  typecheck; `pnpm format:check`. Look at My hours with a pending question in both themes and at
  phone width.
- [ ] **Step 6: done-check** over the two widgets: prints only `my-hours-panel.ts:446` (S15h).
  `git grep -n '"attendance.location"' -- apps/dashboard` prints nothing.
- [ ] **Step 7: commit** "My hours has no Location field (A1301 S15e)".

### Task S15f: the till's attendance and hours data path sends and reads no location (PR S15-3)

**Files:** `apps/till/src/api/client.ts` (`TillClockState.locationId` `:145` deleted from the till's
own type; `getHours(selection, options)` `:2729-2740`; `getAttendanceDay(date, options)`
`:2742-2748`), `state/hours.ts` (`#locationId`, `start(personId, selection)`, `select(selection)`,
the answer check `:93`), `state/attendance.ts` (`readDay(date)`, the answer check `:144`),
`till-app.ts` data path: `#startHours` (`:4670-4713`: no longer waits for the clock state's location),
`#openAttendanceDay` (`:4813-4843`: no location chosen; the default date still uses
`inbox.locations[0]?.timeZone` until S15i gives the inbox its own zone), `#selectAttendanceDay`
(`:4853-4861`), `attendanceDayLocation` (`:2812`) and the reads at `:4632`, `:4769`, the answer check
in `#fixAttendanceEntry` (`:4910`). Test helpers `apps/till/test/clock-app.ts` (`:18` clock state,
`:169-181` mocks), `hours-fixtures.ts`; tests `api/client.hours.test.ts`, `api/client.attendance.test.ts`,
`api/client.clock.test.ts`, `state/hours.test.ts`, `state/attendance.test.ts`,
`state/clocking.test.ts`, and the `widgets/till-shell*.test.ts` clock-state literals (`locationId:
"venue"`, e.g. `till-shell.test.ts:43,99,507`).

Left for S15g: the render bindings (`.locations`, `.locationId`, `@hours-select`, `@hours-day`).
Left for S15h: the correction editor's `locationId` (`:2824`, `:4893`, `:4930`, `:4950`).

- [ ] **Step 1: failing tests.** `api/client.hours.test.ts`: `getHours({ kind: "week" })` requests
  `/api/attendance/hours?kind=week`; `api/client.attendance.test.ts`: `getAttendanceDay("2026-01-05")`
  requests `/api/attendance/day?date=2026-01-05`. FAIL before.
- [ ] **Step 2:** (memory check) `pnpm --filter @waitron/till exec vitest run src/api/client.hours.test.ts src/api/client.attendance.test.ts` — FAIL.
- [ ] **Step 3: implement**; the screens' event details still carry `locationId` until S15g, and
  `till-app.ts` ignores it.
- [ ] **Step 4: trim** the `state/hours.test.ts` cases listed under "Cross-location cases".
- [ ] **Step 5:** (memory check) run the files above and every till test importing
  `test/clock-app.ts` or `test/hours-fixtures.ts`
  (`git grep -l -E "(clock-app|hours-fixtures)" -- 'apps/till/src/**/*.test.ts'`) — PASS; code
  guards; `pnpm --filter @waitron/till typecheck`; `pnpm format:check`.
- [ ] **Step 6: done-check** over `client.ts`, `state/hours.ts`, `state/attendance.ts`: prints only
  the four comments (S15g) and the "allocation" lines (S13j deleted `MyShift.locationId`). Over
  `till-app.ts`: the S15g, S15h and S15i lines named above, and the unrelated words.
- [ ] **Step 7: commit** "The till's hours and day reads name no location (A1301 S15f)".

### Task S15g: the till's hours screen, day dialog and question cards have no location (PR S15-3)

**Files:** `apps/till/src/screens/till-hours-screen.ts` (`locations` property `:107`,
`selectedLocation` `:108-112`, `#choose` `:125-146`, the `hours-select` and `hours-day` details
`:146`, `:162`, `:289`, the `hoursLocation` dropdown `:210-216`, the prompt heading `:177`),
`widgets/attendance-day-dialog.ts` (`locations` `:70`, `locationId` `:72`, the checks `:89`, `:172`,
`#select`'s location branch `:97-110`, the `attendanceLocation` dropdown `:182-190`),
`screens/till-attendance-questions.ts:96` (the card's `<h2>` becomes the work day line
`${t("attendance.work_day")}: ${businessDay}` when set, replacing the `<p>` below it; a proposal card
has no heading line, as on the dashboard), `till-app.ts` bindings (`:5024-5026`, `:19371-19392`),
`i18n/strings.ts` (`attendance.location` EN `:170`, ES `:2044` deleted; `attendance.time_skipped`
EN `:192` and ES `:2066` reworded as in S15e). Comment-only rewording, "the location's" → "the
venue's": `client.ts:167,1322,1401,3177`, `till-app.ts:3238,3240,3246,9207`, `layout.ts:15`,
`screens/till-ticket-view.ts:49`, `widgets/receipt-language.ts:4-5,13`. Tests
`till-hours-screen*.test.ts`, `attendance-day-dialog*.test.ts`, `till-attendance-questions.test.ts`,
`i18n/strings.test.ts`.

- [ ] **Step 1: failing test.** In `till-hours-screen.test.ts`, add "has no Location field": with a
  view and an inbox, `[name="hoursLocation"]` is `null`; choosing the next week emits `hours-select`
  with `{ selection }` and no `locationId` key. FAILS before.
- [ ] **Step 2:** (memory check) run it — FAIL.
- [ ] **Step 3: implement.**
- [ ] **Step 4: trim** the till-hours-screen and day-dialog cases listed under "Cross-location cases".
- [ ] **Step 5:** (memory check) run the screen, dialog and questions test files, their `.a11y`
  siblings, `src/i18n/strings.test.ts`, and the till tests importing `test/clock-app.ts` — PASS; code
  guards; till typecheck; `pnpm format:check`. Look at the hours screen, the day dialog and a question
  card in both themes and at phone width.
- [ ] **Step 6: done-check** over the three screens and widgets and the comment files: prints
  nothing; over `till-app.ts`: only S15h's editor lines, S15i's `inbox.locations[0]?.timeZone`, and
  the unrelated words ("relocation", "allocation", `location.reload()`, `location.origin`).
- [ ] **Step 7: commit** "The till's hours and attendance screens have no Location field (A1301 S15g)".

### Task S15h: a correction command carries no location (PR S15-3)

**Files:** `packages/workforce/src/attendance-contract.ts` (`locationId` out of the `request` and
`propose` payloads, `:16`, `:23`), `attendance-response-commands.ts` (`normalize`'s copies `:81`,
`:88`; S13h already deleted the `question_location` refusal, `:210`), `apps/server/src/attendance-request.ts`
(`:94-113`: the key list and `common` lose `locationId`; the two command routes read no
`command.locationId` once S13i deleted their own-scope calls); the clients' payload lines
`attendance-corrections-screen.ts:576`, `my-hours-panel.ts:446`, `till-app.ts` (`attendanceEditor`'s
`locationId` `:2824`, fills `:4893`, `:4930`, payload `:4950`). Tests: every command literal the
typecheck reports (`git grep -c -E 'action: "(request|propose)"'` lists them: in `packages/workforce`
`attendance-reads`, `attendance-response-commands`, `attendance-response-migration`,
`attendance-responses`, `hours-reads`, `personal-data`; in `apps/server` `attendance-request`,
`attendance-email-worker`, `boot.attendance-responses`, `boot.hours`, `hours-request`,
`management-attendance-api`, `management-hours-api`, `personal-data-export-api.workforce`,
`till-attendance-api`; in the dashboard the corrections-screen and my-hours tests).

A command stored before this change keeps `locationId` inside its saved `input`; a replay of that
same command id after the change is refused `command_reused`, because the saved and new payloads are
compared as JSON (`attendance-response-commands.ts:173-179`). Pre-production, no compatibility code
(CLAUDE.md §3, last rule); the PR says so. The command row's own `location_id` column
(`attendance-response-commands.ts:191,270`) is S13's and S22's.

- [ ] **Step 1: failing test.** In `apps/server/src/attendance-request.test.ts`, a worker `request`
  body with no `locationId` parses, and one with `locationId` is refused (the "refuses forged or extra
  %s" table at `:78` gains `"locationId"`). FAIL before.
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/attendance-request.test.ts` — FAIL.
- [ ] **Step 3: implement**; follow `pnpm --filter <pkg> typecheck` in `@waitron/workforce`,
  `@waitron/server`, `@waitron/dashboard`, `@waitron/till` to every literal.
- [ ] **Step 4: delete** `attendance-request.test.ts` "requires a location UUID %#" (`:125`).
- [ ] **Step 5:** run the workforce and server test files listed above
  (`pnpm --filter @waitron/workforce exec vitest run …`, `pnpm --filter @waitron/server exec vitest run …`);
  (memory check) the dashboard corrections-screen and my-hours tests and the till tests importing
  `test/attendance-fixtures.ts` or `test/clock-app.ts` — PASS; code guards; typecheck all four
  packages; `pnpm format:check`.
- [ ] **Step 6: done-check** over `attendance-request.ts:80-145`, `attendance-response-commands.ts`
  and the three client files: prints only `attendance-response-commands.ts:191,270` (S13/S22) and the
  lines S15i–S15k remove.
- [ ] **Step 7: commit** "A correction command names no location (A1301 S15h)".

### Task S15i: the inbox, lookups and prompts carry no location (PR S15-3)

**Files:** `attendance-contract.ts` (`AttendancePrompt.locationId`, `locationName` `:70-71` deleted;
`AttendanceInbox.locations` `:85` replaced by `timeZone: string`, the venue's zone, which the till's
day dialog needs for today's date; `AttendanceLookups.locations` `:103` deleted),
`attendance-reads.ts` (`readAttendanceInbox` `:53-145`: no `locations` list; `timeZone` from
`readVenue(tx)`; each prompt takes `timeZone` from it; the `ownLocations`/`byLocation` maps go; the
prompt's `day` loses the `locationId` S13 kept on it: `attendance-contract.ts:73` becomes
`day: AttendanceDay | null` and `attendance-reads.ts:101-106` stops filling `day.locationId`),
`dashboard/live-queries.ts:13`
(`lookups: ["persons"]`); server `management-attendance-api.ts` (inbox push `:81-87`, lookups
`:197-200,207`, imports), `till-attendance-api.ts` (inbox push `:171-177`); `till-app.ts`
(`#openAttendanceDay`'s zone → `inbox.timeZone`); fixtures `apps/dashboard/test/attendance-fixtures.ts:32-51,121`,
`apps/till/test/attendance-fixtures.ts:32-51,121` (both include the prompt day's `locationId`,
`:37`), `apps/till/test/clock-app.ts:177`, and the prompt day's `locationId` in
`apps/till/src/api/client.attendance.test.ts:57`. Tests:
`packages/workforce/src/attendance-reads.test.ts`, `hours-reads.test.ts`;
`apps/server/src/management-attendance-api.test.ts` ("provides minimal lookups, own viewer
eligibility, an empty queue and a day from the same subject revision", `:123`: drop the `locations`
expectation), `management-hours-api.test.ts`, `till-attendance-api.test.ts`, `boot.hours.test.ts:144`;
`apps/dashboard/src/api/attendance.test.ts` (the lookups dependency expectation `:205`,
`[{ type: "persons" }, { type: "locations" }]` → `[{ type: "persons" }]`, and the `"locations"`
variant at `:318`; the `"locations"` entries at `:201` and `:291` list the queue and day reads'
tables, which keep theirs, S23).

- [ ] **Step 1: failing test.** In `packages/workforce/src/attendance-reads.test.ts`, add "gives the
  inbox the venue's zone and no place list": `readAttendanceInbox` for a person with no entries
  `toEqual`s an object with `timeZone` equal to the venue row's zone and no `locations` key, and each
  prompt has no `locationId` or `locationName` key, nor its `day`. FAILS before.
- [ ] **Step 2:** `pnpm --filter @waitron/workforce exec vitest run src/attendance-reads.test.ts` — FAIL.
- [ ] **Step 3: implement**; follow the four typechecks to every literal.
- [ ] **Step 4: delete** the lookups `"locations"` variant in `api/attendance.test.ts:318` and
  narrow the lookups expectation at `:205` (S13h already deleted `attendance-reads.test.ts:267`); trim `till-attendance-api.test.ts:163` and
  `management-hours-api.test.ts:123` as listed above. Any suite that now fails with
  `provisioning.second_venue` (the inbox reads `readVenue` for every person) gets the plan's
  "second venue row" rule.
- [ ] **Step 5:** run `attendance-reads.test.ts`, `hours-reads.test.ts`, `src/dashboard/*.test.ts` in
  `@waitron/workforce`; `management-attendance-api.test.ts`, `management-hours-api.test.ts`,
  `till-attendance-api.test.ts`, `boot.hours.test.ts`, `boot.attendance-responses.test.ts`,
  `attendance-email-worker.test.ts` in `@waitron/server`; (memory check) the dashboard and till tests
  importing the two `attendance-fixtures.ts` files — PASS; `pnpm exec vitest run scripts/live-subscriptions.test.ts`
  and the other code guards; typecheck the four packages; `pnpm format:check`.
- [ ] **Step 6: done-check** over the inbox and lookups lines of the files above: prints only
  `attendance-reads.ts`'s `locations` import if `locationInfo` still uses it (S15k), S13's lines, and
  `dashboard/live-queries.ts`'s `record` table names (S23).
- [ ] **Step 7: commit** "The attendance inbox and lookups name no location (A1301 S15i)".

### Task S15j: hours and the till's clock state carry no location (PR S15-3)

**Files:** `hours-request.ts` (`parseHoursQuery` returns `{ selection }`; keys `["kind"]` or
`["kind", "date"]`), `attendance-contract.ts` (`PersonHours.locationId` `:134`,
`ManagerHours.locationId` `:152`), `hours-reads.ts` (`:100`, `:163`, `:196`; S13h already removed
`HoursInput.locationId` and its check), `management-attendance-api.ts` (own hours `:99-107`: the parsed
`locationId` goes, `readVenueClock(tx)` if S13 has not already moved `:106`; manager hours `:175-185`: the
location-exists check gone, `readVenueClock(tx)`), `till-attendance-api.ts` (`:141-152` likewise),
`till-clock-state.ts` (`TillClockState.locationId` `:11` and its fill `:58`; S13g already narrowed
the scope and the clock, and `till-clock-api.ts`'s three state reads); fixtures `apps/dashboard/test/hours-fixtures.ts`,
`manager-hours-fixtures.ts`, `apps/till/test/hours-fixtures.ts`, `clock-app.ts:169-170`. Tests:
`hours-request.test.ts`, `management-hours-api.test.ts`, `till-hours-api.test.ts`,
`boot.hours.test.ts`, `till-clock-state.test.ts`, `till-clock-api.test.ts`,
`till-clock-attendance.test.ts`, `packages/workforce/src/hours-reads.test.ts`.

- [ ] **Step 1: failing test.** `hours-request.test.ts`: "reads the exact own %s scope without
  inventing a date" (`:9`) parses `kind=week` with no location and returns `{ selection: { kind: "week" } }`;
  `?locationId=…&kind=week` is refused. FAILS before.
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/hours-request.test.ts` — FAIL.
- [ ] **Step 3: implement**; follow the typechecks.
- [ ] **Step 4: delete** `management-hours-api.test.ts` "answers the venue's hours, queue and day
  whatever workplace id the query names" (S13i's rewrite of `:587`, listed under "Cross-location
  cases").
- [ ] **Step 5:** run the server and workforce files above; (memory check) the dashboard and till tests
  importing the hours fixtures — PASS; code guards; typecheck four packages; `pnpm format:check`.
- [ ] **Step 6: done-check** over `hours-request.ts`, `hours-reads.ts`, `till-clock-state.ts`,
  `till-clock-api.ts`, and the hours routes: prints only `till-clock-api.ts`'s S12a lines (the
  `deps.cfg` field and `admit`) while S12a is unlanded.
- [ ] **Step 7: commit** "Hours and the till's clock state name no location (A1301 S15j)".

### Task S15k: the day and queue reads carry no location (PR S15-3)

**Files:** `attendance-request.ts` (`parseAttendanceDayQuery` keys `["date"]` (worker) or
`["date", "personId"]` (manager), `:150-165`; `parseAttendanceLocationQuery` `:166-169` deleted),
`attendance-contract.ts` (`AttendanceDayView.locationId` `:89`, `AttendanceManagerQueue.locationId`
`:97`), `attendance-reads.ts` (`locationInfo` `:24-32` deleted; `readAttendanceDay` takes
`{ personId, date }` and its zone from `readVenue(tx)`; `readAttendanceManagerQueue(tx)` returns
`{ items }`; the `locations` import), `management-attendance-api.ts` (own day `:118-124`, queue
`:220-221` with `noQuery(c)`, manager day `:232-233`; `locations`/`readLocationClock` imports;
S13i already narrowed the deps' `cfg` to `{ nodeId }`), `till-attendance-api.ts` (`:186-195`);
fixtures
`apps/dashboard/test/attendance-fixtures.ts`, `apps/till/test/attendance-fixtures.ts`,
`apps/till/test/clock-app.ts:179-181`. Comment-only, no assertion edited:
`apps/server/src/till-api.profile-actions.test.ts:74` names the generated title "rejects a profile
without clock-in on day?date=2026-01-05" (the `routes` entry at `till-attendance-api.test.ts:130`
loses `&locationId=LOCATION`). (S13i already rewrote `till-api.profile-zones.test.ts:102-103`.)
Tests: `attendance-request.test.ts` ("parses exact worker and manager day scopes
with normalized identifiers", `:249`), `management-attendance-api.test.ts` (the `paths` table),
`management-hours-api.test.ts`, `till-attendance-api.test.ts` (`routes`, `pathOf`),
`boot.hours.test.ts:135`, `packages/workforce/src/attendance-reads.test.ts`.

- [ ] **Step 1: failing test.** `attendance-request.test.ts` "parses exact worker and manager day
  scopes with normalized identifiers" (`:249`) expects `{ date }` and `{ date, personId }`, and a query
  carrying `locationId` is refused; add "manager queue takes no query". FAIL before.
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/attendance-request.test.ts` — FAIL.
- [ ] **Step 3: implement.**
- [ ] **Step 4: delete** `attendance-request.test.ts` "requires an exact location-only scope for a
  manager queue" (`:287`) (S13i and S13h already deleted `till-attendance-api.test.ts:315` and
  `attendance-reads.test.ts:362`); make the comment-only edit in `till-api.profile-actions.test.ts`.
- [ ] **Step 5:** run `pnpm --filter @waitron/server exec vitest run src/till-api.profile-actions.test.ts src/till-api.profile-zones.test.ts`
  FIRST and confirm `git diff -U0` of `profile-actions` shows only the comment row named above and
  `git diff --stat` shows no change to `profile-zones`, no assertion changed; then the server and workforce files above;
  (memory check) the dashboard and till tests importing the attendance fixtures — PASS; code guards;
  typecheck four packages; `pnpm format:check`.
- [ ] **Step 6: S15's done-check.** Over every S15 non-test file:
  `git grep -n -E "$P" -- apps/dashboard/src/api/attendance.ts apps/dashboard/src/api/hours.ts apps/dashboard/src/api/own-attendance.ts apps/dashboard/src/api/attendance-export.ts apps/dashboard/src/screens/attendance-corrections-screen.ts apps/dashboard/src/screens/planned-actual-screen.ts apps/dashboard/src/widgets/my-hours-panel.ts apps/dashboard/src/widgets/hours-record.ts apps/dashboard/src/widgets/attendance-export-dialog.ts apps/till/src/state/hours.ts apps/till/src/state/attendance.ts apps/till/src/screens/till-hours-screen.ts apps/till/src/screens/till-attendance-questions.ts apps/till/src/widgets/attendance-day-dialog.ts apps/server/src/hours-request.ts apps/server/src/attendance-export-request.ts packages/workforce/src/attendance-contract.ts packages/workforce/src/hours-reads.ts`
  prints nothing, except `attendance-contract.ts:43` (`AttendanceResponseReceipt.locationId`, S22's,
  "Carried to other slices"). In `apps/till/src/api/client.ts` and `till-app.ts` it prints only the
  unrelated words. In `attendance-request.ts`,
  `management-attendance-api.ts`, `till-attendance-api.ts`, `attendance-export-api.ts`,
  `till-clock-api.ts`, `till-clock-state.ts`, `attendance-reads.ts`, `attendance-response-commands.ts`
  it prints only S13's and S12a's lines (the deps `cfg` fields `admit` reads while S12a is
  unlanded, the command row's `location_id`).
  `apps/dashboard/src/api/client.ts` and `live-queries.ts`: S12d's and S5's lines, and S23's table
  names.
- [ ] **Step 7: commit** "Attendance day and queue reads name no location (A1301 S15k)".

### Words S15 makes stale

- Translation keys: `planned.location`, `planned.no_location` (S15a), `attendance.location` in both
  apps (S15e, S15g) deleted; `attendance.time_skipped` reworded in both apps (S15e, S15g).
- Guides: none describes a working-time location picker or column (the guide grep under S14 prints no
  working-time line). No guide edit.
- Backlog: each S15 PR updates A1301's entry in `docs/backlog.md` (`:6447-6461`): S15-1 and S15-2
  name their PR, and S15-3's says S15 has landed;
  no other entry names these pickers
  (`git grep -n -i -E "location.picker|planned.vs.actual.*location|activeLocationId" -- docs/backlog.md 'docs/backlog/*.md' 'docs/developers/*.md'`
  prints nothing).

### Open PRs touching S15's files

At 2026-11-01 only #2384 (S2) is open; none of its files is S15's. S12a (lane C, not yet a PR) edits
`till-attendance-api.ts` (`admit`), `till-clock-api.ts` (`admit`), their tests' `"location"` variants
and `till-api.profile-zones.test.ts:94-98`; S12c edits the two personal-data test files S15b touches.
S13 and S14 land before S15 and edit every server and workforce file above; S15 starts from them.

---

## S12d — Delete `GET /management-api/locations` and the dashboard's `getLocations`

**Goal.** The route that lists the venue's locations, and the dashboard query that read it, go. Its
last caller was the planned-versus-actual picker, which S15a deletes.

- **Depends on:** S15-1 (Task S15a): starts only once `planned-actual-screen.ts` no longer watches
  `getLocations`. Check at the task's head: `git grep -n getLocations -- apps/dashboard/src ':!*.test.ts'`
  prints only `api/client.ts` and `api/live-queries.ts`.
- **Lands:** lane. **Branch:** `refactor/a1301-s12d-locations-route`, its own PR.
- **Review path:** FULL — a cross-package contract (a server route the dashboard calls).

Every reference at head, from
`git grep -n -E 'getLocations|LocationSummary|/management-api/locations([^/]|$)' -- apps packages scripts`:

- server: the route and its comment, `apps/server/src/workforce-api.ts:108-119`, and the `locations`
  import at `:7`, which nothing else in the file uses (its only other matches are the roster and
  planned-vs-actual `locationId` query lines, `:124-416`, which are not the table); tests
  `workforce-api.test.ts` "GET /management-api/locations lists the tenant's locations" (`:105`) and
  "401s an unauthenticated request" (`:207-210`, the one request it makes is to this route; the
  file's only other 401 check is the warnings describe's "refuses staff and unauthenticated reads",
  `:976`, `:991`);
- dashboard: `api/client.ts` `LocationSummary` (`:1074-1078`) and `getLocations` (`:4195-4197`);
  `api/live-queries.ts:492`; test stubs `dashboard-app.a11y.test.ts:79`,
  `dashboard-app.disk-stop.test.ts:87`, `dashboard-app.help.test.ts:86`, `dashboard-app.test.ts:152`,
  and `api/client.test.ts` "getLocations GETs the location list" (`:1029-1039`). The
  `planned-actual-screen*.test.ts` and `location-picker*.test.ts` references are gone with S15a;
- till, setup, `packages/`, `scripts/`: none (the grep prints none).

**Correction to the A1301 plan's S12d text** (its lines 3401-3476, read at `abfe271663`):
`LocationSummary` is read by nothing outside `planned-actual-screen.ts`, `widgets/location-picker.ts`
and their tests (the grep above; S5's catalogue screens use `LocationCatalogueSummary`,
`client.ts:529`), so after S15a only its declaration is left and S12d deletes it. The client line
numbers moved: `LocationSummary` `:1044-1048` → `:1074-1078`, `getLocations` `:4147-4149` →
`:4195-4197`. The comments to reword moved from `:616`, `:620`, `:2407` to `:646`, `:650`, `:2437`.
With the pattern's `([^/]|$)`, the catalogue routes (`/management-api/locations/${id}/catalogues`)
and `print-api*.test.ts`'s retired `/management-api/locations/:id/receipt-print-mode` paths do not
match, so the grep prints nothing at all once S12d is done (the old text said it would print them).

### Task S12d: delete the locations list route and its dashboard query

- [ ] **Step 1: failing test.** In `apps/server/src/workforce-api.test.ts`, replace "GET
  /management-api/locations lists the tenant's locations" (`:105`) with "GET /management-api/locations
  is gone": expect `404`. FAILS before (`200`).
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/workforce-api.test.ts -t "management-api/locations"` — FAIL.
- [ ] **Step 3: delete** the route, its comment (`:108`) and the `locations` import; point "401s an
  unauthenticated request" (`:207-210`) at a surviving route instead of deleting it: `GET
  /management-api/roster?period=2026-03-02` with `{ cookie: null }`, still expecting `401`; rename the describe block "mountWorkforceApi —
  locations + roster read/create" (`:104`) to "mountWorkforceApi — roster read/create". Delete
  `LocationSummary`, `getLocations`, the live-query entry, the four `dashboard-app*.test.ts` stubs and
  the `client.test.ts` case. Reword three comments in `client.ts` to name the venue: `:646` "the
  location's active devices' receipt printers" → "the venue's active devices' receipt printers";
  `:650` "this location's receipts" → "the venue's receipts"; `:2437` "Every active printer at the
  sale's location" → "Every active printer at the venue"; and `live-queries.ts:324` "with the
  location's zone" → "with the venue's zone". The other `"locations"` table names in
  `live-queries.ts` are S23's.
- [ ] **Step 4:** `pnpm --filter @waitron/server exec vitest run src/workforce-api.test.ts src/workforce-api.gate-sweep.test.ts`;
  check free memory (`memory_pressure | grep free`), then
  `pnpm --filter @waitron/dashboard exec vitest run src/api/client.test.ts src/api/live-queries.test.ts src/dashboard-app.test.ts src/dashboard-app.a11y.test.ts src/dashboard-app.disk-stop.test.ts src/dashboard-app.help.test.ts`
  — each prints `Tests` with no failures; `pnpm exec vitest run scripts/live-subscriptions.test.ts`
  and the other code guards; typecheck `@waitron/server`, `@waitron/dashboard`; `pnpm format:check`.
- [ ] **Step 5: done-check:** the grep in this section's first paragraph prints nothing. Over
  `client.ts` and `live-queries.ts`, the design pattern prints only: S5's catalogue lines
  (`client.ts:529`, `:3144-3167`) until S5 lands, and S23's table names in `live-queries.ts` (S13j
  removed the roster and shift lines). `workforce-api.ts` prints nothing: S13 removed the roster
  lines and S15a the planned-vs-actual ones.
- [ ] **Step 6: backlog.** Update A1301's entry in `docs/backlog.md`: "S12d landed (#…)".
- [ ] **Step 7: commit** "Delete the locations list route and its dashboard query (A1301 S12d)".

### Open PRs touching S12d's files

Only #2384 (S2) is open; it touches none of S12d's files. S5 (lane A, building) edits `client.ts`'s
catalogue lines; overlap is a rebase.

---

