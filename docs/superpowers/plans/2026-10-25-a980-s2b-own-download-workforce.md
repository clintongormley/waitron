# A980 slice S2b: a staff member's own download gains their work records

**Status: plan, 2026-10-25. Nothing was built when this was written.** Design:
[A980 data protection, revision 2](../specs/2026-10-22-a980-data-protection-design.md) §4.2 (the
download and its worked example), §2.1 rows s7 to s11 and s13 (what is held about staff), §2.4 r4
(the configuration export), §5.3 row S2 (its tests), §8 owner answer O5. Overview:
[the build plan](2026-10-24-a980-data-protection-build.md), row S2b and "Notes for each slice →
S2b": "Reuse the existing working-time export rather than a second copy of the record." It builds
on [S2a1](2026-10-24-a980-s2a1-own-download.md) (the seat, the gatherer, the route; its decision 5
says what S2b changes) and [S2a2](2026-10-25-a980-s2a2-own-download-ui.md) (the README, the
Profile button, the guide section; its "Left for later" list says what S2b owes). Branch
`feat/a980-s2b-own-download-workforce`, from `main` at `5ec6563c0`. **No migration; reads only.
FULL review** (personal data, including health data: sick leave): per-task reviews run, then
`/finish-branch`.

## Words used here

- A **seat** is a slot on a module's description (`WaitronModule`) that the module fills with its
  own code, so shared code can call every enabled module without naming any of them. The seat
  here is `personalData` (`packages/module/src/personal-data.ts:20-30`).
- A **part** is one contributor's share of the download: the file names it may add and the code
  that reads and builds them. A **module part** fills the seat; a **server part** is one the
  server adds itself, passed as `serverParts` (`apps/server/src/personal-data-export-api.ts:25-26`),
  for data drawn by code that lives in the server.
- The **subject** is what every part is told about the request: whose data, the moment, the
  venue's time zone and this node's location (`packages/module/src/personal-data.ts:6-14`).
- The **snapshot turn** is the first of the route's two turns holding the venue's write lock, in
  which every part reads, so all files describe the same moment. It is a `withWriteLock` turn, not
  a `withTransaction`, so that a full disk does not refuse the download
  (`personal-data-export-api.ts:63-73`). Files are built after it ends.
- The **working-time record** is the legal record of hours worked, kept as the append-only
  `time_entries` rows. The **working-time export** is the existing download of it, a PDF or a CSV
  file, at `GET /management-api/me/attendance/export` (`apps/server/src/attendance-export-api.ts:77-146`).
- The **rota** is the planned shifts; a **roster version** is one published or draft rota for a
  period. A **swap** is one person offering a shift to another. **Availability** is a stated
  weekly window when a person can work.
- An **attendance question** is the box asking a person about a missing or automatic clock-out;
  its **reminder email** is the message sent about it.
- An **actor column** is one that records who did something to a row (who approved an absence,
  who published a rota), as distinct from whom the row is about.
- A **local wall-clock time** is the time as a clock at the venue showed it, written with its UTC
  offset, such as `2026-10-05T18:00:00+02:00` (`localWallClock`,
  `packages/workforce/src/projection.ts:98-108`).
- The **configuration export** is the encrypted file a manager downloads to set up another box with
  the same menus, staff and settings.

## What this slice builds, and what it leaves

The own download (`GET /management-api/me/personal-data/export`) gains, when the venue uses the
modules that hold them:

```text
marta-lopez-2026-10-05.zip
  README.txt           (S2a2) now describes every file below too
  profile.json         (S2a1, identity)
  sign-in.json         (S2a1, identity)
  employment.json      workforce: contract type, contracted minutes, dates, pay rate
  rota.json            workforce: shifts, availability, swaps
  absences.json        workforce: kind, dates, status, note
  attendance.json      workforce: attendance questions, their reminder emails, answers, activity
  staff-roles.json     staffing: the staff roles held, and each shift's area and role
  time-record.pdf      the existing working-time export, unchanged, as a PDF
  time-record.csv      the same record, as the existing CSV
```

The guide section and the Profile help text say the ZIP can hold these. The README gains each
file's words in English and Spanish.

Left for later, on purpose:

- **S2c** keeps the actions file (`actions.csv`) and an admin's download of another person under
  `personal_data.export`. It also inherits the actor columns this slice leaves out (decision 11).
- **Moving the mount into `boot.ts`** (the backlog point "Mount the own download from `boot.ts`")
  is not done here: the server part is built inside `mountMeApi` from the module names it already
  receives (decision 6).
- **A box with more than one location** gets only this node's location's working-time record
  (decision 6). Today provisioning refuses a second, different location
  (`provisioning.second_venue`, `packages/provisioning/src/venue-apply.ts:281`).

## Decisions this plan makes that the design does not

1. **Who fills which part, and the file names.**
   - **workforce** fills the seat with `WORKFORCE_PERSONAL_DATA`, files `employment.json`,
     `rota.json`, `absences.json`, `attendance.json` (in that order). Its tables hold the
     employment (`packages/workforce/src/schema/employments.ts:11-24`), shifts (`shifts.ts:12-26`),
     availability (`availability.ts:10-22`), swaps (`shift-swaps.ts:19-32`), absences
     (`absences.ts:20-33`) and the attendance tables (`attendance.ts`, `attendance-responses.ts`).
   - **staffing** fills it with `STAFFING_PERSONAL_DATA`, file `staff-roles.json`. It owns
     `person_staff_roles` and `shift_assignments` (`packages/staffing/src/schema/staffing.ts:44-60`,
     `:147-183`); workforce cannot read them, because staffing depends on workforce and not the
     other way round (`packages/staffing/package.json` lists `@waitron/workforce`;
     `packages/workforce/package.json` does not list `@waitron/staffing`).
   - **the server** adds one part, `timeRecordPersonalData(modules)`, files `time-record.pdf` and
     `time-record.csv` (decision 6), because the two renderers live in `apps/server`
     (`attendance-export-pdf.ts:13`, `attendance-export-csv.ts:12`), as S2a1 decision 5 foresaw.
   - **workforce-es** adds nothing of its own. Its only table, `convenio_config`, is one row per
     location of working-time rules and names no person (`packages/workforce-es/src/schema/convenio-config.ts:41-89`).
     Its share is the working-time export it already provides through the `timeRecordExport` seat
     (`packages/composition/src/modules.ts:237`), which the server part calls.
   - Every name passes S2a1's name rule (lower-case ASCII ending `.json`, `.csv` or `.pdf`,
     `packages/module/src/personal-data.ts:39`) and none collides with identity's. Task 8 and
     Task 6 each run `validatePersonalDataParts` over the full list.

2. **The module files are JSON, not the CSV the design's example shows for `rota.csv` and
   `absences.csv`.** S2a1 chose JSON (its decision 10). The rota file holds three different
   shapes (shifts, availability, swaps), which one CSV table cannot; JSON also keeps nulls distinct
   from empty text. The README's existing line "The .json files are a machine-readable copy you
   can take to another service" (`apps/server/src/i18n/personal-data-readme.ts:61`, printed when
   any `.json` file is present, `apps/server/src/personal-data-readme.ts:37`) stays true and is not
   widened to the time record's CSV: the right to a copy to take elsewhere (GDPR article 20) covers
   data processed on the basis of contract or consent, and the design gives the working-time record
   the basis of a legal obligation, 6(1)(c) (design §2.1 row s11; §4.2 quotes article 20 as R15).
   The CSV is described in its own words instead. Each JSON file is
   `JSON.stringify(value, null, 2)` plus a final newline, as S2a1's files are.

3. **A module part builds a file only when it has a row for it.** The identity part always builds
   both its files (S2a1 Task 2, "An empty person"), because every person has a profile. A person
   with no employment, no shift, no availability, no swap, no absence or no attendance record gets
   no file for it, so the ZIP and its README show only what the box holds; the README lists built
   files, not declared ones (S2a2 decision 2; `personal-data-export-api.ts:87`). `rota.json` is
   built when any of its three lists has a row, `attendance.json` likewise.

4. **Times.** A time the database stores with its UTC offset is written as a local wall-clock time
   using that stored offset: shift start and end (`shifts.ts:18-21`), an activity's time
   (`attendance.ts`, `at` and `offset_minutes`), a requested change's time (its `at` and
   `offsetMinutes`, `packages/workforce/src/attendance-contract.ts:6-10`). This is what the
   working-time export does for each session's ends (`packages/workforce-es/src/record-export.ts:219-221`),
   and it is right even if the venue's zone setting changed later. A calendar day is written as
   stored (`YYYY-MM-DD`). Every other moment (`created_at`, `decided_at`, a question's window, an
   email's attempt times) is written as stored, ISO 8601 in UTC, as S2a1 decision 10 does.
   Availability's minutes past local midnight are written `HH:MM`, with 1440 as `24:00`
   (`availability.ts:16-17`, checks at `:31-32`). The subject's `timeZone` is used only by the
   server part, for the venue's date (decision 6).

5. **The subject carries the README's language.** `PersonalDataSubject` gains
   `readonly language: "en" | "es"`, and `sendPersonalData` sets it from the `authorize` result it
   already holds (`personal-data-export-api.ts:68`, `:71`, `:82`). Why: the working-time export
   needs a language (`RecordExportInput.locale`, `packages/shared/src/record-export-types.ts:4-10`),
   and the README's language comes from the session, the saved language and `Accept-Language`
   (S2a2 decision 1), which a part reading the database alone cannot repeat. So the PDF and CSV
   are in the README's language. This changes the contract S2a1 decision 5 said S2b would not
   change: one field and one line; the gatherer is untouched. The type is the one
   `RecordExportInput` already uses, so `@waitron/module` gains no new kind of value.

6. **The working-time export is reused through its own seat, not copied.** A new
   `apps/server/src/personal-data-time-record.ts` exports
   `timeRecordPersonalData(modules: readonly WaitronModule[]): PersonalDataPart[]`:
   - It returns `[]` unless a module named `workforce` is in `modules` **and**
     `selectTimeRecordExport(modules)` finds an exporter (`packages/module/src/record-export.ts:9-20`).
     Both, because boot mounts the working-time export only when `workforce` is enabled
     (`apps/server/src/boot.ts:1753-1754`, `:2114-2124`) and the exporter reads workforce's tables
     (`record-export.ts:155-159` calls `WorkforceBackend().timeRecord`), while `workforce-es`
     requires only `core` (`modules.ts:226`), so it can be enabled without `workforce`. Otherwise it
     returns one part, owner `"server"`, files `["time-record.pdf", "time-record.csv"]`.
   - `prepare(tx, subject)`: if `subject.locationId` is null, no files (S2a1 decision 5 left this to
     S2b). Otherwise one query reads the person's first and last local day at that location:
     `min` and `max` of `date(event_at, event_offset_minutes || ' minutes')` over `time_entries`
     where `person_id` and `location_id` match (the same expression `shiftLocalDate` uses,
     `packages/workforce/src/shift-local-date.ts:12`; the `(person_id, event_at)` index is
     `time-entries.ts:164`). No row: no files. Otherwise the period is from the first local day to
     the day after the later of the last local day and the venue's date
     (`civilDateOf(subject.at, subject.timeZone)`). Then, in the same turn, it calls the exporter's
     `prepare` with `{ locationId, personId: subject.personId, period, audience: "standard",
     locale: subject.language }`, exactly the call the own export route makes
     (`attendance-export-api.ts:105-111`). The build function formats the document and renders it
     with `renderAttendancePdf` and `renderAttendanceCsv`, as that route does (`:120-124`).
     Experiment, 2026-10-25, a one-off Node check of that expression: `2026-01-02T00:30:00.000Z`
     with `-120` gave `2026-01-01`, and `2026-01-01T23:30:00Z` with `60` gave `2026-01-02`, so a
     start taken from the UTC date would have dropped the first case's day.
   - **Why this period**: the export cuts sessions and entries to the period
     (`packages/workforce/src/record-period.ts:12-43`) and a session's day is its start's local
     day (`packages/workforce/src/projection.ts:120`), so a period from the first local day to the
     day after the last covers every entry; the export reads all the person's entries at the
     location whatever the period (`packages/workforce/src/record-reads.ts:36-41` reads, then
     cuts), so a long period costs no extra reads. The record's "Keep until" date is the period's
     end plus four years (`packages/workforce-es/src/registro-jornada.ts:170-174`, `:207`), as for
     any period a person chooses in the existing export.
   - **Standard audience**: it is the worker's own full version; the "representatives" version
     leaves out free-text reasons (`record-export.ts:199`, `:275`).
   - **Both PDF and CSV**: the design names "time-record.pdf/.csv the existing working-time
     export" (§4.2). Cost, measured 2026-10-25 on this Mac with a throwaway test (deleted after)
     that rendered a synthetic document of 1,000 sessions and 2,000 history rows through the two
     existing renderers: the PDF took 650 ms (1.5 MB), the CSV 10 ms (1.3 MB). Rendering runs
     after the snapshot turn, outside the write lock, but on the thread that serves sales. The
     existing own export already lets a person pick a period of any length (its query checks only
     that `from` is before `before`, `apps/server/src/attendance-export-request.ts:25-27`), so the
     same cost is reachable today. Not measured on a box; Review focus.
   - **The closure hash stays.** The export's closed-periods section carries each closure's hash
     (`record-export.ts:366-378`). It is the record's tamper-evidence fingerprint, not a secret: it
     signs a closure, not a login, and the person's own export already shows it. The design's "no
     hash string present" test (§5.3 row S2) is about secrets (S2a1's rule: hashes of PINs,
     passwords, tokens and codes); entry hashes (`time_entries.entry_hash`) are not in the export
     (`record-export.ts:93-119` lists its entry columns).
   - **Other people's names in the record** (the author of a correction, `record-export.ts:270-271`)
     are what the existing own export already gives the person; S2b changes nothing in the record.
   - **Not limited to the single primary.** Boot mounts the working-time export only on the
     single primary and never on a mirror (`boot.ts:1753-1754`, `:2115`); the personal-data route
     is mounted everywhere `mountMeApi` is, and this part reads only. On a mirror whose copied
     database has no row for the mirror's node, the location is null and the files are left out
     (S2a1 decision 8). Review focus.
   - **Mounted from `mountMeApi`** (`apps/server/src/me-api.ts:118-130`), which passes
     `serverParts: timeRecordPersonalData(modules)` with the `modulesNamed(deps.modules)` list it
     already builds, so `boot.ts` does not change.
   - **The guard on its words.** S2a2's guard sees module parts only
     (`apps/server/src/personal-data-readme.test.ts:258-273`, "weaker than its name"). Task 7 adds
     the server part's files to it.

7. **What each workforce and staffing file holds.** Rule, as S2a1 decision 10: every column of a
   row about the person, except internal row ids and the `person_id` a read selects by, secrets
   (none here but the email's claim token), copies of another column, and actor columns
   (decision 11). Where a table has another person's id, decisions 8 and 9 say what of that person
   appears. Exact shapes, keys in this order:

   ```text
   employment.json  { employments: [{ contractType, contractedMinutesPerWeek, startDate, endDate,
                                       payRate, createdAt }] }
   rota.json        { shifts: [{ location, startsAt, endsAt, rota, createdAt }],
                      availability: [{ weekday, from, to, effectiveFrom, effectiveTo, createdAt }],
                      swaps: [{ direction, otherPerson, yourShift, status, decidedAt,
                                createdAt }] }
   absences.json    { absences: [{ kind, startsOn, endsOn, status, note, decidedAt, createdAt }] }
   attendance.json  { questions: [{ businessDay, kind, missingKinds, startAt, endAt, createdAt,
                                     active, inactiveReason, reminderEmail }],
                      responses: [{ action, byYou, reason, changes, createdAt }],
                      activity: [{ source, kind, at, businessDay, outcome }] }
   staff-roles.json { staffRoles: [{ name }],
                      shiftRoles: [{ startsAt, endsAt, area, staffRole }] }
   ```

   - `payRate` is the stored whole cents as a two-place decimal string
     (`centsToDecimal(cents).toFixed(2)`, `packages/shared/src/cents.ts:31`; the column is
     `money`, `packages/db/src/schema/columns.ts:55`). No unit or currency is added: the schema
     does not say per what the rate is, and no product code outside the schema and the
     configuration transfer names `payRate` or `employments` for it (searched
     `grep -rln payRate apps/server/src packages/*/src`, tests excluded: only `employments.ts`).
   - `location` is the shift's location's `name`; `rota` is its roster version's `status`
     (`draft`, `published`, `superseded`) or null for a shift on no version (`shifts.ts:22-24`;
     `roster-versions.ts:20`).
   - `weekday` is the stored number 0 to 6. The schema says "Which day `weekday` 0 is, is a
     rendering choice not fixed here" (`availability.ts:7-8`), and no product code writes or
     renders availability: outside tests it is named only by the schema, the classification and
     the configuration transfer (searched 2026-10-25 for imports of the table). The file therefore
     does not name the day; the README says nothing about which day 0 is.
   - `direction` is `requested_by_me` or `offered_to_me`, the self-service read's own words
     (`packages/workforce/src/schedule-reads.ts:29`, `:103`); `otherPerson` is decision 8;
     `yourShift` is `{ startsAt, endsAt }` of the person's own shift in the swap (the `from_shift`
     when they asked, the `to_shift` when it was offered to them, which is null for a give-away).
     Approving a swap changes only its status (`packages/workforce/src/shift-swaps.ts:95-102`), so
     the `from_shift` stays the requester's.
   - `reminderEmail` is null or `{ recipient, status, outcome, claimedAt, nextAttemptAt }` from
     the question's one `attendance_mail` row (`attendance_mail_question_uq`).
   - `byYou` is whether `requested_by_person_id` is the person; `reason` is the command input's
     `reason` where its action has one, else null; `changes` is the input's `changes`, each as
     `{ at, missingKind }` (local wall-clock time; the target's missing kind or null), empty where
     the action has none (`attendance-contract.ts:11-28`).
   - `area` is the department's or kitchen station's name and `staffRole` the role's name, the
     join `describeShifts` already makes (`packages/staffing/src/describe-shifts.ts:18-23`), here
     selected by the shift's `person_id`.
   - **Order of every list**, by stored values then row id so the output is the same on every run:
     employments by `start_date`, `created_at`; shifts by `starts_at`, `created_at`; availability
     by `weekday`, `available_from_minute`, `effective_from`; swaps by `created_at`; absences by
     `starts_on`, `created_at`; questions by `business_day`, `created_at`; responses by
     `created_at`; activity by `at`, `sequence`; staff roles by `name`; shift roles by the shift's
     `starts_at`. Fixtures give every row a distinct explicit time.

   **Column by column** (every column of every table that reaches `persons` through a foreign key;
   the list was printed on 2026-10-25 from drizzle's `getTableConfig` by a throwaway test in each
   package, deleted after):

   | Table | In (as) | Out, and why |
   | --- | --- | --- |
   | `employments` | `contract_type`, `contracted_minutes_per_week`, `start_date`, `end_date`, `pay_rate`, `created_at` | `id`, `person_id` |
   | `absences` | `absence_kind` (as `kind`), `starts_on`, `ends_on`, `status`, `note`, `decided_at`, `created_at` | `id`, `person_id`; `decided_by_person_id` (actor, decision 11) |
   | `availability` | `weekday`, `available_from_minute` (as `from`), `available_to_minute` (as `to`), `effective_from`, `effective_to`, `created_at` | `id`, `person_id` |
   | `shifts` | `location_id` (as `location`), `starts_at` + `starts_offset_minutes` (as `startsAt`), `ends_at` + `ends_offset_minutes` (as `endsAt`), `roster_version_id` (as `rota`), `created_at` | `id`, `person_id` |
   | `roster_versions` | `status` (as each shift's `rota`) | `id`, `location_id`, `period_start`, `period_end`, `published_at`, `created_at` (the rota's, not the person's); `published_by_person_id` (actor) |
   | `shift_swaps` | `requested_by_person_id` and `to_person_id` (as `direction` and `otherPerson`), `from_shift_id` / `to_shift_id` (as `yourShift`), `status`, `decided_at`, `created_at` | `id`; `decided_by_person_id` (actor); the other person's shift (decision 8) |
   | `attendance_questions` | `business_day`, `kind`, `missing_kinds`, `start_at`, `end_at`, `created_at`, `active`, `inactive_reason` | `id`, `person_id`, `location_id`, `canonical_question_id`; `shift_key`, `evidence_keys` (internal references to the rows the box compared); `open_entry_id`, `automatic_entry_id`, `resolved_by_entry_id` (time-entry references; the entries are in the working-time record) |
   | `attendance_mail` | `recipient`, `status`, `outcome`, `claimed_at`, `next_attempt_at` (as the question's `reminderEmail`) | `id`, `question_id` (it is listed under its question); `claim_token` (a lock token for the sender) |
   | `attendance_response_commands` | `action`, `requested_by_person_id` (as `byYou`), `input` (its `reason` and `changes`), `created_at` | `id`, `person_id`, `location_id`, `question_id`, `entry_ids` (row references); `authorized_by_person_id` (actor); the input's ids |
   | `attendance_operation_facts` | `source`, `kind`, `at` + `offset_minutes` (as `at`), `business_day`, `outcome` | `sequence`, `person_id`, `location_id`; `key` (the source row's internal key) |
   | `time_entries` | the whole table, through the working-time record files (decision 6) | not read by the workforce part |
   | `workforce_chains` | nothing | the head of a location's chain of entries; it reaches `persons` only through `last_entry_id` |
   | `person_staff_roles` | `staff_role_id` (as the role's `name`) | `person_id` |
   | `shift_assignments` | `department_id` / `station_id` (as `area`), `staff_role_id` (as `staffRole`), `shift_id` (as the shift's `startsAt`, `endsAt`) | none |

   Reviewers may move a column; the defaults favour the person's own facts and leave out row
   references, which mean nothing outside the box.

8. **What of another person appears.** Only their current display name, and only where the row is
   about the two of them: the other side of a swap. The person's own My schedule screen already
   shows that name for each swap (`apps/dashboard/src/screens/my-schedule-screen.ts:491-496`) and
   no more, not the other person's shift. So `otherPerson` is the other side's `display_name`, and
   the other person's shift times are left out: they are the other person's rota, and article 15(4)
   says the copy must not harm the rights of others (design §4.2, R11 paragraph 4). The working-time
   record's author names are decision 6's.

9. **Absences, health and notes.** Every absence of the person is included, sick leave too, with
   its free-text note: it is the person's own data, the design lists it (§2.1 row s10, "including
   sick leave and a free note"), and giving health data to the person it is about is what article
   15 asks. Nothing about another person is in it except the actor column, which is left out
   (decision 11).

10. **Draft shifts are included.** The self-service read lists only shifts on a published rota
    (`schedule-reads.ts:69-70`), but the download is a copy of what the box holds about the person,
    and a draft shift assigned to them is held about them. Each shift carries its rota's state, so
    nothing pretends a draft is final. Review focus: this shows a person a draft rota line before
    a manager publishes it.

11. **Actor columns are left out of this slice.** Who decided an absence or a swap, who published a
    rota and who authorised an attendance answer name the manager, not the person the row is
    about. From the manager's side, "the absences you decided" is a record of what that person did,
    the design's "who did what" row (§2.1 row s12), which S2c's actions part starts. Default: S2b
    reads none of them (`absences.decided_by_person_id`, `shift_swaps.decided_by_person_id`,
    `roster_versions.published_by_person_id`, `attendance_response_commands.authorized_by_person_id`),
    and Task 12 adds a backlog point for S2c to decide them. The working-time record's own author
    columns stay as the existing export shows them (decision 6).

12. **Attendance questions and their emails are included** (`attendance.json`). The design lists
    missing-clock emails as staff data held (§2.1 row s13) and its S2 test asks for "a distinct
    value in every table that names the person" (§5.3). This goes beyond the overview row's list
    (employment, rota, availability, swaps, absences, working time). If the reviewers or the owner
    want S2b narrower, Task 4 is the one to drop, and Task 8's guard then lists the four attendance
    tables under a "not yet" entry with a backlog pointer.

13. **A disabled module adds nothing.** The gatherer's loop is over the enabled set
    (`personalDataParts`, `packages/module/src/personal-data.ts:41-46`; the route passes
    `modulesNamed(deps.modules)`, `me-api.ts:123`), and the server part has its own check
    (decision 6). Staffing's part joins workforce's `shifts` and venue-service's departments, which
    is safe because staffing requires both (`modules.ts:366`) and the migration order refuses a
    module whose requirement is missing (`module.dependency_missing`,
    `packages/module/src/module.ts:1635`, called by boot at `apps/server/src/boot.ts:963`).

14. **The completeness guards know a person's table by foreign key.** S2a1's identity guard knows a
    person column only by the name `person_id` (`packages/identity/src/personal-data.coverage.test.ts:1-3`).
    Workforce's person columns have other names (`to_person_id`, `requested_by_person_id`), and
    `attendance_mail` and `shift_assignments` reach a person only through another table. So the
    new guards (Task 8) take every drizzle table in the package's schema whose foreign keys reach
    `persons`, directly or through other tables, and require each to be classified, column by
    column, as decision 7's table does. The experiment that printed decision 7's table also showed
    `getTableConfig` reports keys declared both ways, inline `.references()` (on
    `attendance_operation_facts`) and the `foreignKey({...})` form (on `employments`). Weaker than
    its name: a person id held without a declared key, or inside a JSON column
    (`attendance_response_commands.input`, `pay_period_closures.snapshot`), is not seen.

## Global constraints

- **English only** in code, identifiers, comments, fixtures and tests. Spanish appears only in
  `apps/server/src/i18n/personal-data-readme.ts`, `apps/server/src/guide/es/staff.md` and the
  Spanish half of `apps/dashboard/src/i18n/strings.ts`. A test of Spanish text reads its expected
  words from the words file or `t()`, never a Spanish literal of its own.
- **One snapshot turn.** Every part reads in the route's snapshot turn and opens no transaction of
  its own; queries are awaited in turn, never `Promise.all`; the build functions do not touch the
  database. Rendering the PDF happens in the build function.
- **Every database test uses `useVenueDb`.** A refused request asserts the domain error code. No
  new error code is added, so no registry, `scripts/errors-reachable.test.ts` or
  `scripts/alert-codes.test.ts` change is due.
- **Exact shapes** are asserted with `toEqual` or `toBe`, never `toMatchObject`.
- **Fixtures use values the two sides could treat differently**: a shift whose UTC date differs
  from its local date; an offset that is not zero; a pay rate whose cents matter (`1234` →
  `"12.34"`, not a whole number); a colleague with different distinct values in every table, so
  "only hers" fails if a person condition is dropped; a self-swap is not used as the swap fixture.
- **No secret in the download**: the existing no-secrets cases search every unzipped file
  (the cases at `apps/server/src/personal-data-export-api.test.ts:171` and `:190`); Task 9's end-to-end case adds
  the attendance email's claim token and a time entry's `entry_hash`, with a positive control.
- **Existing assertions** that pin a whole shape and change on purpose are named in their task:
  the three whole-subject assertions (`personal-data-export-api.test.ts:166-168`, `:270`, `:284`,
  Task 1) and the composition list (`packages/composition/src/composition.test.ts:353-357`,
  Task 8). No other existing assertion changes; the pull request names these.
- **Coverage**: `@waitron/module`, `@waitron/workforce`, `@waitron/staffing`,
  `@waitron/composition` and `@waitron/server` each hold 98/98/98/95. No exclude or ignore comment
  is added. None of them is mutation-tested.
- **Same files as open pull requests** (`gh pr list`, then `gh api …/pulls/<n>/files`,
  2026-10-25): #2025 changes `apps/dashboard/src/i18n/strings.ts` and `docs/backlog.md`; #1986
  changes `docs/backlog.md`. This slice changes one value in `strings.ts` (Task 10) and adds a
  pointer in `docs/backlog/data-protection.md`; whichever lands later rebases. S2c, when built in
  parallel, edits the same README words file, guide section, help string and composition test.
- Commits `git commit -s`; `pnpm format:check` before each commit.
- An implementer that passes about 150 tool calls with its task unfinished stops at a passing or
  cleanly failing point, commits, and hands over: what is done, what is left, the files, each
  check's state.

## Review focus

- **Whose data.** Each part selects by the subject's person id only; every task has an "only hers"
  case with a colleague who has distinct values in the same tables. The route is unchanged: no
  query, the person id compared after building (S2a1 decision 7).
- **Other people in the files** (decision 8): the other side of a swap appears by display name
  only; their shift times do not. Decision 11 leaves every actor column out; reviewers may judge
  that "who approved my absence" belongs in the person's copy.
- **Health data** (decision 9): sick leave and the absence note are included; nothing about them
  reaches anyone but the person.
- **Draft shifts** (decision 10) are in the copy before publication.
- **The working-time record is the existing export**, called through the same seat with the same
  arguments the own export route passes; Task 6 compares the CSV byte for byte with that route's
  answer. Its period rule, the closure hash and the authors' names are decision 6.
- **Rendering cost**: 650 ms for the PDF of a synthetic 1,000-session record on a Mac, on the thread
  that serves sales; not measured on a box. The same cost is reachable through the existing export.
- **Single primary and mirrors** (decision 6): the part runs wherever the route does.
- **Every README sentence against its source** (Task 7's table). A sentence that claims more than
  its row is a defect: for example "deleted" where a row is only ended, or a statement about which
  day `weekday` 0 is.
- **The guards** (decision 14): what the foreign-key reach misses.
- **Codex run-it seat**: personal data is a risk trigger, so `/finish-branch` runs two Codex
  reviews, the second told to set this plan aside and test what it does not name.

## Task 1 — the subject carries the README's language

Files: `packages/module/src/personal-data.ts`, `packages/module/src/personal-data.test.ts`,
`apps/server/src/personal-data-export-api.ts`, `apps/server/src/personal-data-export-api.test.ts`,
`packages/identity/src/personal-data.test.ts`.

Interface (decision 5): `PersonalDataSubject` gains `/** The README's language; a part that writes
text uses it. */ readonly language: "en" | "es";`. In `sendPersonalData` the subject becomes
`{ personId: who.personId, language: who.language, at, ...place }` (`personal-data-export-api.ts:71`).

Fixtures that grow, because the type requires the field: `packages/module/src/personal-data.test.ts:16-21`
and `packages/identity/src/personal-data.test.ts:298-303` gain `language: "en"`. The whole-subject
assertions at `apps/server/src/personal-data-export-api.test.ts:166-168`, `:270` and `:284` gain
`language: "en"`; every other value in them is unchanged.

1. Tests first, in `personal-data-export-api.test.ts`: a new case where Marta's saved `locale` is
   `es-ES` (set by SQL) and the request sends `Accept-Language: en-GB`: the stub part's subject has
   `language: "es"`, the same language as the README's first line (`PERSONAL_DATA_README_WORDS.es.title`
   with the venue filled in). Update the three assertions above. Run
   `pnpm --filter @waitron/server exec vitest run src/personal-data-export-api.test.ts`; watch the
   new case and the three updated ones fail.
2. Add the field and the one line.
3. Omission control, run and reverted: set `language: "en"` in the subject regardless → the new
   case fails.
4. Run `pnpm --filter @waitron/module exec vitest run src/personal-data.test.ts`,
   `pnpm --filter @waitron/identity exec vitest run src/personal-data.test.ts`, and `typecheck` in
   `@waitron/module`, `@waitron/identity` and `@waitron/server`. Read each test count.

## Task 2 — the workforce part: `employment.json` and `absences.json`

Files: `packages/workforce/src/personal-data.ts` (new), `packages/workforce/src/personal-data.test.ts`
(new), `packages/workforce/src/index.ts` (export `WORKFORCE_PERSONAL_DATA`). Not wired into
`ALL_MODULES` yet (Task 8), so no README words are needed until Task 7.

Interface: `export const WORKFORCE_PERSONAL_DATA: ModulePersonalData` with
`files: ["employment.json", "rota.json", "absences.json", "attendance.json"]` declared now (a part
may build fewer than it declares, `packages/module/src/personal-data.ts:21-22`); this task builds
the first and third. `prepare` runs one query per table, each awaited in turn, keyed by
`subject.personId`; the build function only shapes and serialises (decision 7).

1. Tests first (`useVenueDb` with core, identity and workforce migrations; helpers from
   `packages/workforce/test/fixtures.ts`, which already inserts employments at `:70-78`):
   - **Fixture.** Marta with two employments (one ended, pay rate `1234` cents, distinct contract
     types and minutes) and three absences: a `sick_leave` with a note, an approved `holiday`
     decided by a manager, a `requested` `unpaid` with no note; every row with a distinct explicit
     `created_at`. A colleague with one employment and one absence carrying different distinct
     values; the manager as decider.
   - **Exact files.** Prepare, build, parse: `toEqual` the full objects of decision 7, lists in its
     order; `payRate` is `"12.34"`.
   - **Only hers.** None of the colleague's values (contract type, note, dates) in either file.
   - **No decider.** The manager's id and display name are in neither file.
   - **Nothing held, no file.** A person with no employment and no absence gets neither file
     (decision 3); with an absence only, only `absences.json`.
   Run `pnpm --filter @waitron/workforce exec vitest run src/personal-data.test.ts`; watch it fail.
2. Write the part and export it.
3. Omission controls, each run and reverted, the failing case recorded for the pull request: drop
   the `person_id` condition from the absences query → "only hers" fails; build `employment.json`
   with an empty list instead of leaving it out → "nothing held" fails; write `payRate` as the raw
   cents → "exact files" fails.
4. Run `pnpm --filter @waitron/workforce exec vitest run src/personal-data.test.ts` and
   `pnpm --filter @waitron/workforce typecheck`.

## Task 3 — the workforce part: `rota.json`

Files: `packages/workforce/src/personal-data.ts`, `packages/workforce/src/personal-data.test.ts`.

1. Tests first, in the same file:
   - **Fixture.** Marta with three shifts: one on a published version, one on a draft version, one
     on no version; one shift in summer time and one in winter time (offsets `120` and `60`), and
     one whose start is `2026-01-02T00:30:00.000Z` with offset `-120`, so its local start reads
     `2026-01-01T22:30:00-02:00`. Two availability windows, one ending at minute `1440`. Three
     swaps: one she asked for (her shift to the colleague, two-sided), one offered to her as a
     give-away (no `to_shift`), one offered to her two-sided and approved. A colleague with their
     own shifts at distinct local times (for example `03:17`) and their own availability.
   - **Exact file.** `toEqual` decision 7's `rota.json`: `startsAt` and `endsAt` as local
     wall-clock times from the stored offsets; `rota` `published`, `draft` and null; availability
     `to` `"24:00"`; each swap's `direction`, the colleague's display name as `otherPerson`, and
     `yourShift` her own shift's times (null for the give-away).
   - **Only hers, and not the colleague's shift.** None of the colleague's shift times (in local or
     UTC form) and none of their availability values appear; their display name appears only in
     `otherPerson`.
   - **No decider.** The manager who approved the swap is not named.
   - **Built when any list has a row.** A person with only availability gets `rota.json` with two
     empty lists; a person with none of the three gets no `rota.json`.
   Run the focused command of Task 2; watch the new cases fail.
2. Add the three reads and the file.
3. Omission controls: take `yourShift` from `from_shift` always → the offered-to-her two-sided
   case fails; format `startsAt` in UTC → "exact file" fails (the `-120` shift's day changes); join
   only published versions → the draft shift drops out and "exact file" fails.
4. Run the focused file and `pnpm --filter @waitron/workforce typecheck`.

## Task 4 — the workforce part: `attendance.json`

Files: `packages/workforce/src/personal-data.ts`, `packages/workforce/src/personal-data.test.ts`.
The part reads `attendance_questions`, `attendance_mail` (joined through its question),
`attendance_response_commands` and `attendance_operation_facts`
(`packages/workforce/src/schema/attendance.ts`, `attendance-responses.ts`).

1. Tests first:
   - **Fixture.** Marta with two attendance questions (an `automatic-out` and a `missing-times`,
     one inactive with an `inactive_reason`), a reminder email for one of them (a distinct
     recipient address and a `claim_token`), two response commands (a `request` with a `reason`
     and one change, written by her; a `confirm` written by a manager on her behalf, if the
     command rules allow it, otherwise a second of her own), and two activity facts with a
     non-zero offset. Write the rows the way the module's own tests do (read
     `attendance-questions.test.ts` and `attendance-response-commands.test.ts` for the helpers); a
     direct insert is acceptable where a helper needs more setup than the case is about. A
     colleague with one of each.
   - **Exact file.** `toEqual` decision 7's `attendance.json`; the email under its question; the
     other question's `reminderEmail` null; `byYou` true and false; `changes` as local times.
   - **Only hers.** None of the colleague's values (their email recipient, reason, times).
   - **No secret.** The `claim_token` is in no file; the recipient address is (positive control).
   - **Nothing held, no file.**
   Run the focused command; watch them fail.
2. Add the reads and the file.
3. Omission controls: drop the question join's person condition on the email read → "only hers"
   fails; write `claim_token` into `reminderEmail` → "no secret" fails.
4. Run the whole package's suite once, `pnpm --filter @waitron/workforce exec vitest run`, and
   `typecheck`. Read the count.

## Task 5 — the staffing part: `staff-roles.json`

Files: `packages/staffing/src/personal-data.ts` (new), `packages/staffing/src/personal-data.test.ts`
(new), `packages/staffing/src/index.ts` (export `STAFFING_PERSONAL_DATA`).

Interface: `files: ["staff-roles.json"]`; built when the person holds a role or has a shift with an
assignment (decision 3).

1. Tests first (`useVenueDb` with the migrations staffing's own tests use; read
   `packages/staffing/src/staff-roles.test.ts` and `rota.test.ts` for the setup and helpers):
   - **Fixture.** Two staff roles held by Marta and one she does not hold; two of her shifts with
     assignments, one to a department and one to a kitchen station, at local times from a
     non-zero offset; one of her shifts with no assignment; a colleague's shift assigned to a third
     role in a third area.
   - **Exact file.** `toEqual` decision 7's `staff-roles.json`: her two roles by name, in name
     order; two `shiftRoles` with the department's and the station's names.
   - **Only hers.** The third role's name and area appear in neither list.
   - **Nothing held, no file.**
   Run `pnpm --filter @waitron/staffing exec vitest run src/personal-data.test.ts`; watch it fail.
2. Write the part and export it.
3. Omission controls: select assignments without the shift's person condition → "only hers" fails;
   read only departments (no station join) → "exact file" fails.
4. Run the focused file and `pnpm --filter @waitron/staffing typecheck`.

## Task 6 — the server's working-time part

Files: `apps/server/src/personal-data-time-record.ts` (new),
`apps/server/src/personal-data-time-record.test.ts` (new).

Interface (decision 6):

```ts
export const TIME_RECORD_FILES = ["time-record.pdf", "time-record.csv"] as const;
export function timeRecordPersonalData(modules: readonly WaitronModule[]): PersonalDataPart[];
```

1. Tests first (`useVenueDb` with core, identity, workforce and workforce-es migrations; a tenant,
   a location in `Europe/Madrid`, a node there; Marta and a colleague with time entries written
   through `WorkforceBackend` `clockIn`/`clockOut`, as `apps/server/src/attendance-export-api.test.ts`
   does; a management session for Marta):
   - **The same bytes as the existing export.** Prepare and build the part for Marta with
     `ALL_MODULES` (subject: her id, `language: "en"`, the location, `at` a fixed instant). Mount
     `mountAttendanceExportApi` in the same test with `exporter: selectTimeRecordExport(ALL_MODULES)`
     and `cfg.locationId` the location, and request
     `/management-api/me/attendance/export?locationId=…&from=<start>&before=<end>&format=csv&audience=standard&locale=en`
     with her session, where `start` and `end` are the period decision 6 gives. The part's
     `time-record.csv` equals the answer's body byte for byte. With `language: "es"` and
     `locale=es`, the same. `time-record.pdf` starts with `%PDF-`.
   - **The period.** Her first entry is at `2026-01-02T00:30:00.000Z` with offset `-120`, so its
     local day is `2026-01-01`; the CSV equals the existing export's for `from=2026-01-01` and
     differs from the one for `from=2026-01-02`. One entry dated after the subject's venue date:
     it is in the CSV (the period runs to the day after it).
   - **Only hers.** The colleague's name and times are in neither file.
   - **No files**, each case asserting `[]`: `locationId: null`; a person with no entry at the
     location; `modules` without `workforce` (workforce-es alone) gives no part at all;
     `modules` without `workforce-es` gives no part at all.
   - **The names are valid and unique** beside every module part:
     `validatePersonalDataParts([...personalDataParts(ALL_MODULES), ...timeRecordPersonalData(ALL_MODULES)])`
     does not throw.
   Run `pnpm --filter @waitron/server exec vitest run src/personal-data-time-record.test.ts`;
   watch it fail.
2. Write the module.
3. Omission controls: take the period's start from the UTC date (`substr(event_at, 1, 10)`) →
   "the period" fails; pass `audience: "representatives"` → "the same bytes" fails; drop the
   `workforce` check → the workforce-es-alone case throws or returns a part, and fails.
4. Run `pnpm --filter @waitron/server typecheck`.

## Task 7 — the README's words for every new file, and the guard on the server's files

Files: `apps/server/src/i18n/personal-data-readme.ts`, `apps/server/src/personal-data-readme.test.ts`.

Each file's words follow S2a2's shape (`holds`, `use`, optional `sentTo` and `kept`,
`apps/server/src/i18n/personal-data-readme.ts:1-8`). The time record's shared "who else receives
it" and "how long it is kept" lines sit on `time-record.pdf` only: the builder prints every
present file's lines (`apps/server/src/personal-data-readme.ts:42-44`), and the part always builds
both files together, so putting them on both would print each twice.

**English:**

| Key | Text |
| --- | --- |
| `files["employment.json"].holds` | `your employment contracts: the contract type, contracted minutes per week, start and end dates and pay rate.` |
| `…use` | `Used to manage your employment and pay; your contracted minutes are the baseline for overtime.` |
| `…sentTo[0]` | `A manager or admin can download a configuration export that holds your employment contracts, pay rate included, including after you leave.` |
| `…kept[0]` | `An employment contract ends when it is given an end date; nothing in the box deletes it.` |
| `files["rota.json"].holds` | `your shifts (their times, location and the state of the rota each is on), the availability recorded for you, and the shift swaps you asked for or were offered, with the other person's name and your own shift.` |
| `…use` | `Used to plan the rota.` |
| `…sentTo[0]` | `A manager or admin can download a configuration export that holds your availability, including after you leave.` |
| `…kept[0]` | `A shift can be deleted only while it is not on a published rota, and deleting it deletes the swaps that offer it; nothing in the box deletes your availability or your other swaps.` |
| `files["absences.json"].holds` | `your absences: the kind (holiday, sick leave, other leave or unpaid), the dates, whether it was approved and any note.` |
| `…use` | `Used to plan the rota around your time off.` |
| `…kept[0]` | `Nothing in the box deletes an absence.` |
| `files["attendance.json"].holds` | `the questions the box asked you about a missing or automatic clock-out, the reminder email about each, the answers you or a manager gave, and the activity (sign-ins, orders, payments, breaks) it used to notice them.` |
| `…use` | `Used to keep your working-time record complete.` |
| `…sentTo[0]` | `Reminder emails are sent through the email service the venue set up, when it has one.` |
| `…kept[0]` | `Nothing in the box deletes these questions, emails, answers or activity records.` |
| `files["staff-roles.json"].holds` | `the staff roles you can fill, and the area and staff role of each of your shifts.` |
| `…use` | `Used to plan who covers each area.` |
| `…sentTo[0]` | `A manager or admin can download a configuration export that holds the staff roles you can fill, including after you leave.` |
| `…kept[0]` | `A staff role is taken from you when a manager changes who holds it or deletes the role; a shift's area and role are deleted with the shift.` |
| `files["time-record.pdf"].holds` | `your working-time record at this venue: when you started and finished work, your breaks, every correction and decision, and the closed periods, as the working-time export shows it.` |
| `…use` | `Kept as the venue's record of the hours you worked.` |
| `…sentTo[0]` | `Managers who may export reports can download the working-time record, yours included; the record names who has the right to see it.` |
| `…kept[0]` | `The box refuses to change or delete an entry in the working-time record: a correction is added as a new entry. The record shows the date until which it is kept.` |
| `files["time-record.csv"].holds` | `the same working-time record as time-record.pdf, as a spreadsheet file.` |
| `…use` | `Kept as the venue's record of the hours you worked.` |

**Spanish** (the box is «el servidor Waitron del local» the first time in a line, as S2a2's words
do; «turno», «cambio de turno», «ausencia», «cuadrante», «registro de jornada», «asiento» and «rol
de personal» are the dashboard's and the export's own words: `apps/dashboard/src/i18n/strings.ts`
`myschedule.*`, `approvals.*`, `attendance_export.heading`; `packages/staffing/src/dashboard/strings.ts`
`staffing.rota.back`; `packages/workforce-es/src/record-export.ts:46`; `apps/server/src/guide/es/staff.md`
"Eliminar un rol de personal"):

| Key | Text |
| --- | --- |
| `files["employment.json"].holds` | `tus contratos: el tipo de contrato, los minutos semanales contratados, las fechas de inicio y fin y la retribución.` |
| `…use` | `Sirve para gestionar tu contrato y tu retribución; tus minutos contratados son la base para calcular las horas extra.` |
| `…sentTo[0]` | `Un gerente o un administrador puede descargar una exportación de la configuración que contiene tus contratos, con la retribución, también después de que te vayas.` |
| `…kept[0]` | `Un contrato termina cuando se le pone fecha de fin; nada en el servidor Waitron del local lo borra.` |
| `files["rota.json"].holds` | `tus turnos (sus horas, el centro y el estado del cuadrante en que está cada uno), la disponibilidad registrada para ti y los cambios de turno que pediste o te ofrecieron, con el nombre de la otra persona y tu propio turno.` |
| `…use` | `Sirve para planificar el cuadrante.` |
| `…sentTo[0]` | `Un gerente o un administrador puede descargar una exportación de la configuración que contiene tu disponibilidad, también después de que te vayas.` |
| `…kept[0]` | `Un turno solo se puede borrar mientras no está en un cuadrante publicado, y al borrarlo se borran los cambios de turno que lo ofrecen; nada en el servidor Waitron del local borra tu disponibilidad ni tus demás cambios de turno.` |
| `files["absences.json"].holds` | `tus ausencias: el tipo (vacaciones, baja por enfermedad, otro permiso o sin sueldo), las fechas, si se aprobó y cualquier nota.` |
| `…use` | `Sirve para planificar el cuadrante teniendo en cuenta tus ausencias.` |
| `…kept[0]` | `Nada en el servidor Waitron del local borra una ausencia.` |
| `files["attendance.json"].holds` | `las preguntas que te hizo el servidor Waitron del local sobre un fichaje de salida que faltaba o que se hizo automáticamente, el correo de aviso de cada una, las respuestas que diste tú o un gerente y la actividad (inicios de sesión, comandas, cobros, descansos) con la que las detectó.` |
| `…use` | `Sirve para que tu registro de jornada esté completo.` |
| `…sentTo[0]` | `Los correos de aviso se envían a través del servicio de correo que configuró el local, si tiene uno.` |
| `…kept[0]` | `Nada en el servidor Waitron del local borra estas preguntas, correos, respuestas ni registros de actividad.` |
| `files["staff-roles.json"].holds` | `los roles de personal que puedes cubrir y el área y el rol de personal de cada uno de tus turnos.` |
| `…use` | `Sirve para planificar quién cubre cada área.` |
| `…sentTo[0]` | `Un gerente o un administrador puede descargar una exportación de la configuración que contiene los roles de personal que puedes cubrir, también después de que te vayas.` |
| `…kept[0]` | `Un rol de personal se te quita cuando un gerente cambia quién lo tiene o borra el rol; el área y el rol de un turno se borran con el turno.` |
| `files["time-record.pdf"].holds` | `tu registro de jornada en este local: cuándo empezaste y terminaste de trabajar, tus descansos, cada corrección y decisión y los períodos cerrados, tal como lo muestra la exportación del registro de jornada.` |
| `…use` | `Se guarda como el registro del local de las horas que trabajaste.` |
| `…sentTo[0]` | `Los gerentes que pueden exportar informes pueden descargar el registro de jornada, incluido el tuyo; el propio registro indica quién tiene derecho a verlo.` |
| `…kept[0]` | `El servidor Waitron del local no permite cambiar ni borrar un asiento del registro de jornada: una corrección se añade como un asiento nuevo. El registro indica hasta qué fecha se conserva.` |
| `files["time-record.csv"].holds` | `el mismo registro de jornada que time-record.pdf, como archivo de hoja de cálculo.` |
| `…use` | `Se guarda como el registro del local de las horas que trabajaste.` |

**What backs each sentence.** The implementer re-checks every row against the code on the branch
and fixes the sentence, not the row, where they disagree; a sentence with no row is not shipped.

| Sentence | Source |
| --- | --- |
| employment holds | decision 7's `employment.json` shape; `employments.ts:15-23` |
| employment use | design §2.1 row s8 ("employment, payroll"); the contracted minutes are "the overtime baseline" (`employments.ts:16`), read at `packages/workforce/src/clocking.ts:646` and `pay-period-close.ts:147-150` |
| employment sentTo | workforce's configuration transfer carries `employments` and `availability` (`packages/workforce/src/configuration-transfer.ts:1-9`); the export route needs `system.manage` (`apps/server/src/configuration-export-api.ts:46-49`), which managers hold (`packages/identity/src/permissions.ts:55-62`) and admins hold with every permission (`:76`, `:82`); "including after you leave": re-check that the transfer reads these tables with no status filter, as S2a2 found for `persons` (`packages/provisioning/src/configuration-transfer.ts:251-290`). Not checked for these tables by this plan |
| employment kept | "An employment ends by setting `end_date`, never by deleting the row" (`employments.ts:6-9`); no product code deletes it: `grep -rnE "delete\s+from\s+\"?(shifts\|absences\|availability\|employments\|shift_swaps\|attendance_[a-z_]+\|person_staff_roles\|shift_assignments\|roster_versions)\b\|\.delete\((shifts\|absences\|availability\|employments\|shiftSwaps\|attendance[A-Za-z]+\|personStaffRoles\|shiftAssignments\|rosterVersions)\b" packages apps --include='*.ts'`, test, `testing/` and `test/` paths excluded, run 2026-10-25, printed three lines: `clocking.ts:479` (a shift), `staff-roles.ts:199` (a role's holders) and `attendance-discovery.ts:222` (`attendance_source_state`, which names no person). The configuration import's run-time table names are S2a2's caveat (setup only) |
| rota holds | decision 7's `rota.json` shape |
| rota use | design §2.1 row s9 ("planning") |
| rota sentTo | `configuration-transfer.ts:5` (availability); shifts and swaps are not in it (`:1-9`) |
| rota kept | `removeShift` deletes a shift (`clocking.ts:476-480`) only after `shiftForWrite` refuses one on a version that is not a draft (`:492-495`; a shift on no version passes); a swap offering the shift is deleted with it and one taking it in return keeps going as a one-sided offer (`shift-swaps.ts` schema `:44-55`, `cascade` and `set null`); the grep above finds no delete of availability or swaps |
| absences holds | decision 7's `absences.json` shape; the kinds `absences.ts:7` |
| absences use | design §2.1 row s10 ("leave") |
| absences kept | the grep above; absences are not in the configuration transfer (`configuration-transfer.ts:1-9`) |
| attendance holds | decision 7's `attendance.json` shape; question kinds `attendance.ts` (`questionKind`), activity kinds (`activityKind`) |
| attendance use | design §2.1 row s13 ("remind staff"); the questions are about a missing or automatic clock-out (`questionKind`: `automatic-out`, `missing-times`) |
| attendance sentTo | the email worker sends only through the venue's configured delivery and stops when it is `unconfigured` (`apps/server/src/attendance-email-worker.ts:64-65`, `:121`, `:140`) |
| attendance kept | the grep above: the only attendance delete is of `attendance_source_state` |
| staff-roles holds | decision 7's `staff-roles.json` shape |
| staff-roles use | design §2.1 row s7 (staff roles: "permissions", "while employed"); the roles fill the rota's areas (`staffing.ts:147`) |
| staff-roles sentTo | staffing's configuration transfer carries `person_staff_roles` (`packages/staffing/src/configuration-transfer.ts:7`); permission as the employment row |
| staff-roles kept | replacing a role's holders deletes and re-inserts them (`packages/staffing/src/staff-roles.ts:183-201`); deleting a role deletes its holders (`person_staff_roles_role_fk`, `cascade`, `staffing.ts:54-58`); a shift's assignment goes with the shift (`shift_assignments_shift_fk`, `cascade`, `staffing.ts:157-161`) |
| time-record holds | the export's sections (`record-export.ts:130-143`, titles) |
| time-record use | design §2.1 row s11 ("the legal daily record"); the README does not name the law, because Spain-only legal wording belongs in a country pack (design §5.3) |
| time-record sentTo | the manager route needs `report.export` (`attendance-export-api.ts:45-55`), in the manager set (`permissions.ts:68`) and held by admins (`:76`, `:82`); the record lists its access holders (`record-export.ts:24-28`, `:333-350`) |
| time-record kept | the append-only triggers refuse an update or delete of `time_entries` (`packages/workforce/src/schema/time-entries.ts:38-42`; `classification.ts`, `appendOnly("time_entries", …)`); "Keep until" (`record-export.ts:338-349`; `registro-jornada.ts:170-174`) |
| time-record.csv holds | the CSV is rendered from the same document as the PDF (decision 6) |

1. Tests first, in `personal-data-readme.test.ts`:
   - **Every server file has words.** Beside the existing module-files case (`:258-273`, unedited):
     for every name in `timeRecordPersonalData(ALL_MODULES).flatMap((p) => p.part.files)` (not
     empty), both languages have words. The existing case's "the two languages have the same keys
     and list lengths" half already covers the new entries.
   - **The new files, every section.** `files: ["profile.json", "sign-in.json", "employment.json",
     "rota.json", "absences.json", "attendance.json", "staff-roles.json", "time-record.pdf",
     "time-record.csv"]` in English: `toBe` the whole expected text written out in the test, as the
     existing English case does; the same in Spanish, built from `PERSONAL_DATA_README_WORDS.es`.
   - **The time record's lines once.** With both time-record files present, the "Managers who may
     export reports…" line appears exactly once.
   Run `pnpm --filter @waitron/server exec vitest run src/personal-data-readme.test.ts`; watch it
   fail.
2. Add the words.
3. Omission control: delete `time-record.csv`'s Spanish entry → the server-files case fails (and
   the existing same-keys check too); put the time record's `sentTo` on the CSV as well → "once"
   fails.
4. Run `pnpm --filter @waitron/server typecheck`.

## Task 8 — wire both modules, and the completeness guards

Files: `packages/composition/src/modules.ts` (workforce's entry gains
`personalData: WORKFORCE_PERSONAL_DATA` beside `:220`; staffing's gains
`personalData: STAFFING_PERSONAL_DATA` beside `:378`), `packages/composition/src/composition.test.ts`,
`packages/workforce/src/personal-data.coverage.test.ts` (new),
`packages/staffing/src/personal-data.coverage.test.ts` (new).

1. Tests first:
   - **The guards** (decision 14). In each package: from `./schema/index.js`'s exports keep the
     drizzle tables (`is(value, SQLiteTable)`, as the identity guard does); a table is about a
     person when one of its foreign keys (`getTableConfig(t).foreignKeys`, each `reference()`)
     points at `persons`, or at a table that is (follow `foreignTable` across packages: staffing's
     `shift_assignments` reaches `persons` through workforce's `shifts`). The set found must equal
     the test's classified list, and each table's full column set must equal its "in" plus "out"
     lists from decision 7, with no column in both; `time_entries` is listed as read by the
     working-time files, its columns not checked. A comment at the top says what it is weaker
     than (decision 14).
   - In `composition.test.ts` (`:346-362`): workforce and staffing carry their parts by
     reference; the "no other module" case becomes the list `["identity", "workforce",
     "staffing"]`, in `ALL_MODULES` order (named in the pull request: it pins the whole list);
     `validatePersonalDataParts(personalDataParts(ALL_MODULES))` still does not throw.
   Run `pnpm --filter @waitron/workforce exec vitest run src/personal-data.coverage.test.ts`,
   `pnpm --filter @waitron/staffing exec vitest run src/personal-data.coverage.test.ts` and
   `pnpm --filter @waitron/composition exec vitest run src/composition.test.ts`; watch the
   composition cases fail.
2. Wire the two entries.
3. Omission controls: remove `attendance_mail` from workforce's classified list → the tables check
   fails (it is found only through `attendance_questions`); move `absences.note` out of both lists
   → the columns check fails; follow direct keys only → staffing's guard no longer finds
   `shift_assignments` and fails.
4. Run `pnpm --filter @waitron/composition exec vitest run`, then
   `pnpm --filter @waitron/server exec vitest run src/personal-data-readme.test.ts` (the S2a2
   module-files guard now sees the new files and must pass with Task 7's words), and from the
   repository root `pnpm exec vitest run scripts/module-seams.test.ts scripts/english-only.test.ts scripts/workspace-cycles.test.ts`.

## Task 9 — mount the working-time part, and the whole ZIP end to end

Files: `apps/server/src/me-api.ts` (the mount call, `:118-130`, gains
`serverParts: timeRecordPersonalData(modules)` with the `modulesNamed(deps.modules)` list computed
once), `apps/server/src/personal-data-export-api.workforce.test.ts` (new),
`apps/server/src/me-api.personal-data-export.test.ts`, `apps/server/src/boot.personal-data-export.test.ts`.

1. Tests first:
   - **The whole ZIP**, in the new file (`useVenueDb` with every set, `migrationOptionsFor(manifestSets(), null)`;
     mounted through `mountMeApi` with every module's name): Marta with a distinct value in every
     table of S2a1 decision 10 and of decision 7 here, and time entries; a colleague with
     different distinct values in the same places. The ZIP's entries are, in order, `README.txt`,
     `profile.json`, `sign-in.json`, `employment.json`, `rota.json`, `absences.json`,
     `attendance.json`, `staff-roles.json`, `time-record.pdf`, `time-record.csv`. Each of Marta's
     distinct values is found in some unzipped file (the design's S2 test, §5.3); none of the
     colleague's is, except the colleague's display name inside `rota.json`'s `otherPerson`; the
     README is `toBe` `personalDataReadme(...)` over exactly those nine file names.
   - **No secret, end to end.** Marta's PIN hash, the asking session's token hash, the attendance
     email's `claim_token` and one of her time entries' `entry_hash` are in no unzipped file; her
     email address is (positive control).
   - **Spanish.** With her saved locale `es-ES`, the README is Spanish and `time-record.csv` equals
     the existing export's `locale=es` answer for the same period.
   - In `me-api.personal-data-export.test.ts`: the existing `["core", "identity"]` and `["core"]`
     cases pass unedited (no workforce, so no working-time part).
   - In `boot.personal-data-export.test.ts`, one more assertion in the existing case: with a
     clock-in written before the server starts (the file's fixture has workforce and workforce-es
     enabled and staffing disabled, `:20-21`; write through the fixture's helpers before
     `startServer`, home CLAUDE.md §4), the ZIP holds `time-record.csv` and `time-record.pdf`,
     and no `staff-roles.json`.
   Run `pnpm --filter @waitron/server exec vitest run src/personal-data-export-api.workforce.test.ts src/me-api.personal-data-export.test.ts src/boot.personal-data-export.test.ts`;
   watch the new cases fail.
2. Add the mount argument.
3. Omission control: remove `serverParts` from the mount → the whole-ZIP case and the boot
   assertion fail.
4. Run, assertions unedited: `pnpm --filter @waitron/server exec vitest run src/personal-data-export-api.test.ts src/personal-data-export-api.readme.test.ts`,
   and `pnpm --filter @waitron/server exec vitest run src/start-full-disk.e2e.test.ts -t "personal-data"`
   (its mount passes `ALL_MODULES` and a node id with no row, `:306-310`, so the workforce and
   staffing parts read on a full disk and the working-time part builds nothing; on macOS it makes
   its own small disk with `hdiutil`). Then `pnpm --filter @waitron/server typecheck`. Read each
   count.

## Task 10 — the guide section and the Profile help text

Files: `apps/server/src/guide/en/staff.md`, `apps/server/src/guide/es/staff.md` (the `own-data`
section, `:25-31` and `:27-33`), `apps/dashboard/src/i18n/strings.ts` (`profile.data_copy_help`,
`:1086-1087` and `:4400-4401`).

The section's paragraph becomes:

> Open **Account settings** from the account menu and, on **Your details**, press **Download**
> beside **Copy of your data**. You get a ZIP file with your profile and sign-in details as `.json`
> files. If the venue plans staff or records working time in Waitron, it also holds your employment
> details, rota, absences, staff roles and attendance questions as `.json` files, and your
> working-time record as a PDF and a `.csv` spreadsheet. A `README.txt` explains each file, who
> else receives the data, how long it is kept and your rights. It never holds a secret such as your
> PIN or password. For anything else about your data, ask the venue.

> Abre **Configuración de la cuenta** desde el menú de cuenta y, en **Tus datos**, pulsa
> **Descargar** junto a **Copia de tus datos**. Recibes un archivo ZIP con tus datos de perfil y de
> acceso en archivos `.json`. Si el local planifica el personal o registra la jornada en Waitron,
> también contiene tus datos de contrato, tus turnos, tus ausencias, tus roles de personal y las
> preguntas sobre tus fichajes en archivos `.json`, y tu registro de jornada en PDF y en una hoja
> de cálculo `.csv`. Un `README.txt` explica cada archivo, quién más recibe los datos, cuánto
> tiempo se guardan y tus derechos. Nunca contiene secretos como tu PIN o tu contraseña. Para
> cualquier otra cosa sobre tus datos, pregunta al local.

`profile.data_copy_help`: English `Your profile and sign-in details, your work records if the venue
keeps them in Waitron, and a README.txt that explains them and your rights.`; Spanish `Tus datos
de perfil y de acceso, tus datos de trabajo si el local los guarda en Waitron, y un README.txt que
los explica junto con tus derechos.`

1. The existing suites read the pages and strings as they are; run them before and after, no edit
   to them: `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts src/guide-pages.test.ts`,
   `pnpm --filter @waitron/dashboard exec vitest run src/screens/profile-screen.personal-data.test.ts`
   (browser: check `memory_pressure | grep free` first; it reads the help text through `t()`),
   and from the root `pnpm exec vitest run scripts/guide-links.test.ts scripts/english-only.test.ts`.
   No new test: the change is text whose structure those suites already check, and a test pinning
   a sentence would only repeat it.
2. Write the two paragraphs and the two strings; check each bold label against `strings.ts`.
3. Run the suites of step 1 again and `pnpm --filter @waitron/dashboard typecheck`.

## Task 11 (visual) — LOOK at the README, the files and the help text

Scripts and shots live outside the worktree: `/Users/clintongormley/waitron-campaign-b/a980-s2b-scripts/`
and `/Users/clintongormley/waitron-campaign-b/a980-s2b-shots/`. Nothing here is committed.

1. A throwaway copy of Task 9's whole-ZIP case, which writes the English and the Spanish ZIP to the
   shots folder, run once and deleted (`git status --short` shows nothing of it). `unzip -l` each;
   `unzip -p` the README of each into the shots folder; read both READMEs whole, every JSON file
   and `time-record.csv`; open `time-record.pdf` with the Read tool. Look for: each file named in
   the README once, in ZIP order; the time-record lines once; no sentence that claims a file the
   ZIP lacks; local times showing the offset; nothing of the colleague except the swap name.
2. A throwaway browser look test built like S2a2 Task 6a (`profile-screen.a11y.test.ts:85-88`
   style): the Profile row with help on and the "?" opened, English and Spanish, light and dark,
   1280 and 390 px; check the longer help text wraps inside the tooltip at 390 px. Deleted after.
3. Write what was seen, one line per picture or file, for the pull request's **LOOK** section.

## Task 12 — backlog and the overview

Files: `docs/backlog/data-protection.md` (the A980 S2 point), `docs/backlog.md` (the A980 entry,
`:6169-6172`), `docs/superpowers/plans/2026-10-24-a980-data-protection-build.md`.

1. Grep the siblings first: `grep -rn "S2b\|personal-data\|time-record" docs/backlog.md docs/backlog/data-protection.md docs/superpowers/plans/2026-10-24-a980-*.md docs/superpowers/plans/2026-10-25-a980-*.md`.
2. In `data-protection.md`, the S2 point says the download now also holds the workforce and
   staffing files and the working-time record when those modules are on; **delete the S2b
   sub-point**; keep S2c, and add to it, as its own short line: decide the actor columns S2b left
   out (decision 11: who decided an absence or a swap, who published a rota, who authorised an
   attendance answer). Add a short point for the working-time record of a box with more than one
   location (only this node's location is exported, decision 6), and one for measuring the
   whole-history PDF on a box (decision 6's 650 ms was on a Mac). The "Mount the own download from
   `boot.ts`" point stays and gains: `mountMeApi` now also builds the working-time part from
   `modulesNamed`.
3. `docs/backlog.md`'s A980 entry does not name S2b; change it only if the grep finds it stale.
4. In the overview's status paragraph, after the S2a2 sentence: "2026-10-25: S2b is built
   ([its plan](2026-10-25-a980-s2b-own-download-workforce.md)): the own download also holds the
   employment, rota, absences, attendance and staff-role files and the working-time record, in
   the README's language. The module files are JSON, not the design's `rota.csv` and
   `absences.csv` (S2b decision 2), and the actor columns are left for S2c (S2b decision 11)."
5. `pnpm exec prettier --file-info <file>` on each changed doc: `docs/` is ignored, so each prints
   `"ignored": true` and no format step applies.
