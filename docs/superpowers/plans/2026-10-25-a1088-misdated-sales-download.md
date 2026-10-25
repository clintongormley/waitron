# A1088: wrongly dated sales stay listed after "handled", download for the adviser, and a note

> **Revision 3 (2026-10-25): round 3 folded** (`~/waitron-campaign-b/a1088-plan-review/round3-check.md`,
> I1 and m1–m11, read at `85473b4d2`; `8520199cc`'s pointer fixes kept). I1, under the controller's
> option (a): the "Sales dated wrongly" section and the Handled lists fold write each sale's time at
> its stored offset, as the CSV and the emails do (new Task 9, its changed assertions listed); the
> false sentence that the Box status table already did so, behind R1, is corrected. M6 applied in
> full: a note is checked only after the session, visibility and claim checks (Tasks 4a, 4b). Also:
> a malformed body is refused, not read as "no note" (m5); both note paths take
> `clock.records_misdated` only (m7); one file-name rule for server and browser (m8); the bound is
> written rounded up to the minute (m3); "about one episode per closing" (m2); the fallback offset's
> false citation dropped (m1); "by the confirmed clock" (m9); Task 2's test lives in `apps/server`
> (m6); the query-plan receipt saved with and without the index (m10); two pointers (m11).
>
> **Revision 2 (2026-10-25): round 1 folded.** Review `~/waitron-campaign-b/a1088-plan-review/round1-review.md`
> (I1–I4, M1–M14), claim check `round1-claim-check.md` (every FALSE, OVERSTATED and gap line),
> under the controller's rulings `round1-rulings.md` (R1–R9). What changed:
> - **Times and the day mark come from each record's stored offset and stored issue date** (R1,
>   I1), not the venue's time zone; a cancellation's mark is "Not applicable"; an Invoice date
>   column is added. Decisions 7, 9; Tasks 5–7.
> - **The "made before" bound is widened by the confirmation's one-minute tolerance** (R2, I2),
>   with a case across midnight inside it. Decisions 8, 9, 12.
> - **The shared CSV cell function is not changed**; the amount cell alone is written by a local
>   function (R3, I3). Decision 10; Task 6.
> - **A note can be added once to a handled list** ("Add note"), and a note sent with Mark handled
>   on an already-handled alert is refused; three new `alert.*` codes (R4, I4). Decisions 3, 4;
>   Tasks 3, 4a, 4b, 10a, 10b.
> - **An index `incidents(code, detected_at)` in the same migration, and the history loads on
>   demand**, not on the 15-second poll (R5). Decision 1; Tasks 1, 2, 9a.
> - **Every existing assertion that changes is listed with why**, and two named by the ruling stay
>   unchanged because the open-list route keeps its meaning (R6). Global constraints.
> - **`alert.not_found` is mapped to 404 in `box-health-api.ts`, which imports the registry** (R7,
>   M1). Task 7.
> - **VAT sentences narrowed** to Q60 (b), unanswered (R8). **Pointers, counts and line numbers
>   fixed** (R9; claim check #6, #11, #15, #30, #43, #52, #54, #68, #80, #83, #84).
> - Minors folded: M2 (two more deps builders), M5 (the bottom message), M6 (validation after the
>   session check), M7 (the change-feed triggers), M8 (the migration's name), M9 (the golden case's
>   lines, `backend.ts` diff), M10 (a backend-level case), M11 (count from the rows), M12 (no shared
>   time-zone write any more), M13 (a Spanish spreadsheet in the LOOK task), M14 (Tasks 4, 9 and 10
>   split).

**Status: plan, 2026-10-25, revision 3. Nothing was built when this was written.** Item A1088
(lane B's queue, `~/waitron-campaign-b/a1088-plan-review/item.md`, owner-approved scope). Builds on
A798-B slice 9 (#2025, `3a242a11e`): design
[§4.9 f](../specs/2026-10-19-a798-degraded-trading-design.md#f-wrongly-dated-records-go-to-the-owner),
plan [2026-10-23-a798-9-clock-restart.md](2026-10-23-a798-9-clock-restart.md) (its revision 8
block governs). Branch `feat/a1088-misdated-sales-download`, worktree
`waitron-feat-a1088-misdated-sales-download`, from `main` at `f0c5a44a7`.

**One migration, in the core set (`packages/db/drizzle`, the next number, 0190 today,
`incident_acknowledged_note`): one nullable column and one index on `incidents`. Nothing in
`registros_facturacion` is written or changed**: the only new fiscal code is a reader. **FULL
review** (fiscal records read; by-id reads; a migration; a cross-package seat contract): per-task
reviews run, then `/finish-branch`, which runs **two Codex run-it reviews**, the second told to set
this plan aside and test what it does not name. The pull request's first line says no fiscal record
is written; if any task finds it must touch how a record is written, it stops and the pull request
is parked for the owner.

## Words used here

- An **episode** is one `clock.records_misdated` alert: one closing of a clock check that found
  sales dated wrongly (a **list**), or found that the box cannot tell which (**cannot tell**). The
  alert's params name the closing (`confirmationId`) and the from–to times
  (`packages/fiscal-verifactu/src/clock-stop-incidents.ts:66-75`, `:78-88`).
- The **corrected start** is the time the closing worked out for the start of the payment stop,
  stored in `proof.closing.correctedStart` (`packages/fiscal-verifactu/src/clock-checks.ts:75-89`,
  `:148-162`).
- The **bound** is the corrected start plus `CLOCK_WITNESS_MARGIN_MS` (60 000 ms,
  `packages/fiscal/src/clock-witnesses.ts:1`): the latest moment a listed sale can really have been
  made (decision 8).
- **Handled** means the incident's `acknowledged_at` is set (`packages/core/src/incidents.ts:306-314`).
- The **seat** is the fiscal module's slot on `FiscalBackend` (`packages/fiscal/src/backend.ts`);
  `misdatedRecords` (`:367`) is one of the eight optional methods slice 9 added
  (`git show 3a242a11e -- packages/fiscal/src/backend.ts`, claim check #6).

## What the code does today (receipts)

- `readMisdatedOpen` selects only incidents whose `acknowledged_at` is null
  (`apps/server/src/box-health.ts:195-203`), and `GET /api/box/clock-misdated` gives a list only
  for those (`apps/server/src/box-health-api.ts:115-142`). **The item calls point 1 inferred; it
  is in fact asserted**: the case "lists the sales a closing found dated wrongly … until its alert
  is handled" marks the alert handled (`apps/server/src/clock-confirm.route.test.ts:1314-1321`) and
  expects the list gone from both the list route and `misdatedOpen` (`:1322-1326`). Run on
  `f0c5a44a7`:
  `pnpm --filter @waitron/server exec vitest run src/clock-confirm.route.test.ts -t "until its alert is handled"`
  → 1 passed, 36 skipped (re-run by the claim check, #10).
- **No note field exists on an acknowledgement**: `incidents` has `acknowledged_at` and
  `acknowledged_by` only (`packages/db/src/schema/incidents.ts:40-41`), and the mark-handled route
  reads no body (`apps/server/src/alerts-api.ts:89-103`). So the note is a column, hence a
  migration.
- **`incidents` has no trigger that guards it, and is not append-only**: classified
  `classify("incidents", "state", …)` (`packages/db/src/classification.ts:141`); no migration
  creates a trigger on it (claim check #15, #21). Its only triggers are the change feed's three,
  `waitron_change_incidents_{insert,update,delete}`, because it is a change source
  (`classification.ts:269-277`). Boot installs them from the table's live column list after
  migrating (`packages/db/src/change-feed.ts:103-133`, `apps/server/src/boot.ts:1667`), and the
  migrator drops them first (`packages/migrations/src/apply.ts:65`). So: the ADD COLUMN needs
  nothing more; after the next boot the update trigger compares the new column too
  (`change-feed.ts:116`), and an UPDATE that sets the acknowledgement or the note records a change
  of `incidents`, which is what makes the dashboard's `incidents` queries re-read.
- **Acknowledging is today the one permitted change** (`incidents.ts:14-16`). Decision 4 widens it
  by one: adding a note once to a handled incident. Task 2 rewrites that comment and cuts its stale
  "the table carries no trigger".
- **A rebuild of `incidents` would break its expression index** (`incidents.ts:60-63`; claim check
  #17 generated the rebuild a CHECK causes and saw the quoted expression). A nullable column with no
  CHECK generates exactly ``ALTER TABLE `incidents` ADD `acknowledged_note` text;`` (review
  experiment 1; claim check #18).
- **The history read is a full scan without an index**: `where code = … order by detected_at` on
  today's indexes plans `SCAN` (claim check #84), and nothing deletes incidents. With an index on
  `(code, detected_at)` the handled read, the open read and the handled count each plan
  `SEARCH … USING INDEX incidents_code_detected_idx (code=?)`; without it the handled read and the
  count plan `SCAN` (`~/waitron-campaign-b/a1088-scripts/eqp2-with-index.mjs` and
  `eqp2-without-index.mjs`, `node:sqlite`, 5 000 rows, run 2026-10-25; round 3 repeated it on the
  schema built from every core migration up to a generated 0190, with and without `ANALYZE`,
  `a1088-plan-review/scratch/r3/eqp3.mjs`).
- **The real time of a listed sale is not stored anywhere.** A closing stores the corrected start
  and its own readings (`clock-checks.ts:148-162`); the check stores the box's reading when the stop
  began, which is after the clock was put back (`clock-checks.ts:257-273`). Neither gives the error
  the clock had when a listed sale was stamped. What is known: every listed record was written
  before the check opened and stamped more than a minute after the corrected start
  (`packages/fiscal-verifactu/src/clock-misdated.ts:21-26`, `:54-66`).
- **The corrected start is only as right as the confirming clock.** It is `confirmedAt − elapsed`
  (`clock-checks.ts:85-87`), and `confirmedAt` is the box's own reading. Every source that can close
  a check with a list accepts the box within `CLOCK_WITNESS_MARGIN_MS` = 60 000 ms counting the
  reading's uncertainty: AEAT's and the devices' readings through `agrees`
  (`clock-witnesses.ts:42-44`), the administrator's through `adminAgrees`
  (`packages/fiscal-verifactu/src/clock-confirmation.ts:133-138`). A closing by `elapsed` is
  unconfirmed (`clock-checks.ts:353`) and lists nothing (`clock-misdated.ts:42`). So a listed sale
  was really made before the corrected start plus 60 000 ms. The boot-time clock's own drift while
  a check waits is not counted; it was not measured.
- **The stored issue date and offset.** A record stores `fecha_expedicion_factura` and
  `offset_minutos` (`packages/fiscal-verifactu/src/schema/registros.ts:63`, `:97`). The issue date
  is built from the sale's time at the reading's offset (`packages/fiscal-verifactu/src/backend.ts:280`;
  `registro-row.ts:143`), and on the box that offset is the **server process's** zone,
  `-instant.getTimezoneOffset()` (`apps/server/src/till-backend.ts:14-25`), not
  `locations.time_zone`: measured in `docs/backlog/fiscal.md:11-24` (at `2026-10-14T23:30:00Z`,
  `2026-10-14` under `TZ=UTC`, `2026-10-15` under `TZ=Europe/Madrid`; the deployment sets no `TZ`).
  The owner chose the venue's zone for new records (A696, `docs/backlog/fiscal.md:37-40`); not
  built, and old records stay as they are. **A cancellation stores the cancelled invoice's date**
  (`backend.ts:405-414`; `docs/backlog/fiscal.md:31`).
- **The emails write each time at the record's stored offset** (`apps/server/src/box-alert-email.ts:93-104`,
  `receiptDateTimeNumeric`, `apps/server/src/receipt-dates.ts:44-53`, which formats date and time
  separately and joins them with a space: `25/10/2026 00:30`; one `Intl.DateTimeFormat` with both
  gives `25/10/2026, 00:30`, claim check #68). **The Box status table does not**: its time cell and
  its range label use `formatIsoMinute` (`apps/dashboard/src/screens/box-status-screen.ts:700`,
  `:733-738`), which reads the browser's zone with `getHours()` and never the stored offset
  (`packages/dashboard-kit/src/date-format.ts:5-9`); the same instant printed `2026-10-24 22:30`,
  `2026-10-25 00:30` or `2026-10-25 07:30` under `TZ=UTC`, `Europe/Madrid` and `Asia/Tokyo`
  (round 3, `scratch/r3/fim.mts`). Task 9 moves that section onto the stored offset with the
  dashboard's existing `wallClock` (`apps/dashboard/src/date-utils.ts:24-28`, "a stored instant plus
  the wall offset recorded beside it"), already used by `my-schedule-screen.ts:389-390`. The
  dashboard's browser tests run Chromium in UTC (`apps/dashboard/vitest.config.ts:60`, `:85`) and its
  Node tests in `America/New_York` (`:101`).
- **The venue's language** is worked out at boot as `venueLocale === "es-ES" ? "es" : "en"` for the
  managers' emails (`apps/server/src/boot.ts:1738`, `:2297`), read once.
- **The amount a record holds** is `registros_facturacion.importe_total`, plain text because it is
  a hashed input, null on an anulación (`registros.ts:78-85`). Only the Veri\*Factu module reads it:
  the writer (`registro-row.ts:160`, `:185`) and `fromRegistroRow`, which rebuilds the record for
  the drainer and `computeHuella` (`registro-row.ts:253`, `:399`). No screen, report or route reads
  it today.
- **The shared CSV cell guard prefixes any text starting with `-`**: `"-5.00"` comes out
  `"'-5.00"` (`apps/server/src/attendance-export-csv.ts:3-10`; review experiment 2; claim check
  #70). CSV pattern otherwise: every cell quoted, BOM, CRLF (`:37`); headers
  (`attendance-export-api.ts:134-143`); the dashboard saves a blob through a link
  (`apps/dashboard/src/screens/vat-return-screen.ts:122-128`; `downloadVatReturnFile`,
  `apps/dashboard/src/api/client.ts:4142-4151`).
- **No printable page exists in the reporting area**: in code, `git grep -n "window.print\|@media print"`
  finds only `apps/dashboard/src/screens/node-recovery-print.ts:46` and the custodian tool in
  `packages/fiscal-verifactu/src/custodian/` (claim check #34). The reports print to receipt
  printers (`printCategorySales`, `client.ts:4133-4139`).
- **The "cannot tell" alert can be handled by the box itself**, `personId: null`, when a later
  closing that cannot tell starts earlier (`clock-stop-incidents.ts:100-120`).
- **Error codes**: `alert.not_found` is declared in `apps/server/src/errors.ts:1292-1294`;
  `box-health-api.ts`'s `STATUS` (`:41-50`) does not map it, an unmapped `AppError` answers 400
  (`packages/server-kit/src/error-boundary.ts:42`, `status[cause.code] ?? 400`), and that file does not import `./errors.js`.
  The server's registry has no barrel; every file that throws one of its codes imports it directly
  (`errors.ts:20-21`), and `scripts/errors-reachable.test.ts` walks packages' `src/index.ts` only
  (its header, `:7-18`), so it does not see `apps/server`.

## Decisions this plan makes that the item does not

Each is the DEFAULT this build makes; the owner may override any of them, and the build does not
wait.

1. **The history loads on demand.** The 15-second box read (`getBoxHealth`, polled,
   `apps/dashboard/src/api/live-queries.ts:527-529`, an empty dependency list, so the timer refreshes it) keeps `misdatedOpen` (open alerts, oldest first,
   each gaining `incidentId`) and gains only `misdatedHandledCount`, one index-served count. The
   handled episodes and their lists come from a new `GET /api/box/clock-misdated/handled`, read
   only while the manager has the **Handled lists** fold open, and again on an `incidents` change
   while it is open. Why: the poll stays one indexed count however many episodes a venue gathers,
   and the two reads per episode (`clock-misdated.ts:31-38`, `:46-67`) happen only when asked. The
   on-demand read has no time window and no cap (about one episode per closing of a clock check, and one stop can carry two, a "cannot tell"
   and a list, as `clock-confirm.route.test.ts:1465-1525` builds; the bell's Handled tab
   keeps 30 days, `apps/server/src/alerts.ts:17`, too short for a tax period); a backlog entry
   records it. `GET /api/box/clock-misdated` keeps its meaning: open lists only.
2. **Who handled it.** A person's display name (read from `persons`, as `readHandledAlerts` does,
   `alerts.ts:193-201`); a null `acknowledged_by` is shown as "the box" (the box handles a "cannot
   tell" itself, `clock-stop-incidents.ts:100-120`); a person id with no row shows no name.
3. **The note is a new nullable column `incidents.acknowledged_note`**, in the core set, with no
   CHECK (a CHECK would rebuild the table). The routes trim it; empty or whitespace means no note;
   more than 500 characters is refused `management.request_invalid` with `field: "note"` (the same
   limit as `line-cancel-api.ts:67` and `finish-party-input.ts:29`, review "clean checks").
4. **Where a note comes from.** (a) Box status's own **Mark handled** on an open entry opens a
   dialog with an optional note; the alert and the note are written in one UPDATE. (b) A handled
   entry with no note, whoever handled it (a person here, the bell, the Alerts screen, or the box),
   offers **Add note** once; a second note on the same alert is refused **409 `alert.note_exists`**.
   (c) A Mark handled carrying a note on an alert that is already handled is refused **409
   `alert.already_handled`**, never a silent success; without a note it still answers 204, as
   today (`client.ts:4241`). (d) Add note on an alert not yet handled is refused **409
   `alert.not_handled`**. The three codes are declared in `apps/server/src/errors.ts` beside
   `alert.not_found` and worded in English and Spanish in `apps/dashboard/src/i18n/codes.ts`. The
   bell's and the Alerts screen's Mark handled stay one click, and the Alerts screen's Handled tab
   does not show notes (backlog entry).
5. **CSV only, no printable page**: the reporting area has none to follow (receipt above).
6. **The CSV is in the venue's language** (worked out as the emails' is, `boot.ts:2297`), not the
   signed-in person's dashboard language, and is fixed until the server restarts, as the emails
   are. The file name is English: `misdated-sales-<yyyy-mm-dd>.csv`, the date being the episode's
   `from` at its stored `fromOffsetMinutes` (the first listed record's stamp,
   `clock-stop-incidents.ts:69-70`). Server (`Content-Disposition`) and browser (`link.download`,
   the name the user gets, `vat-return-screen.ts:126`) both compute it from those two params with
   the same rule, and one fixture tests both.
7. **Every time in the CSV is written at the record's own stored offset**, with
   `receiptDateTimeNumeric(at, "en-GB", offsetMinutes)` (`dd/mm/yyyy hh:mm`, as the emails write
   them). The header's confirmation time is written at the offset the check stored when it opened
   (`clock-checks.ts:266`), or, for a check with none, the first listed record's offset (a choice of
   this plan; `recordMisdated`'s own fallback is the closing reading's offset, which is not stored,
   `clock-stop-incidents.ts:77-85`). The bound is written at the same offset, **rounded up to the
   next whole minute** when it has seconds, so "made before {bound}" stays true at minute
   precision. An **Invoice date** column writes the stored `fecha_expedicion_factura` as
   `dd/mm/yyyy`. The venue's saved time zone is not read: the stored date follows the server
   process's zone today (receipt above), and the CSV must agree with what AEAT holds, with the
   emails, and, after Task 9, with the Box status section's times (the same clock time, written
   `yyyy-mm-dd hh:mm` there).
8. **"Real time" reads "Unknown" on every row in this build** (no stored value gives it). The header
   gives the bound instead: every listed sale was made before the corrected start plus one minute,
   the confirmation's tolerance. Slice 9c's change checks are the first place a real time could be
   worked out (design §4.9 f, the e₀ paragraph); a backlog entry says so.
9. **"Different day" is "Yes", "Cannot tell" or "Not applicable", never "No"**: "Yes" when the
   record's stored issue date is later than the bound's calendar date at the record's own offset
   (by the confirmed clock, the sale was then made on an earlier day, so possibly in a different
   VAT period — asesor
   Q60 (b), not answered); otherwise "Cannot tell"; "Not applicable" for a cancellation, whose
   stored date is the cancelled invoice's. A `partial` closing's corrected start is the closing's
   own time (`clock-checks.ts:83-84`), later than the real start, so the bound still holds, only
   looser.
10. **The amount is the record's own `importe_total`**, turned into a `Decimal` with `decimal()`
    (`packages/shared/src/money.ts:16`) and `toScale(…, 2)` (`money.ts:159`), written with two
    places, the venue language's decimal mark, no currency sign and no grouping (`12.30` / `12,30`;
    the column heading names EUR). A cancellation's amount cell says "Cancellation". No `Number()`.
    **The amount cell, and only it, is written by a local `amountCell(value: Decimal, language)`**
    that quotes the text it formats itself without the formula guard, so `-5.00` stays a number in
    a spreadsheet. The shared cell function is not changed; every other cell, the series included,
    goes through it.
11. **A new seat method, `misdatedDetail`, not a wider `misdatedRecords`**, so the closing's write
    path (`recordMisdated`, `clock-stop-incidents.ts:47-98`) and `misdatedRecords`' existing
    assertions (`clock-misdated.test.ts` has 40 `toEqual`, about two dozen on its answer) are
    untouched. It answers the closing's source, person id, confirmation time, corrected start,
    `partial` and the check's stored opening offset, and each listed record with its kind (issue or
    cancellation), stored issue date and stored amount text.
12. **The header line** (one quoted cell, the file's first line), English:
    "{venue}: {count} sales were recorded with a time later than the real one, from {from} to {to}.
    Each was made before {bound}. The clock was confirmed by {confirmedBy} on {confirmedAt}." ("One
    sale was recorded … at {from}. It was made before {bound}." for one.) `{count}` is the number of
    rows written, never the alert's param. `{confirmedBy}` reuses `CLOCK_CONFIRMED_BY_WORDS`
    (`apps/server/src/i18n/box-emails.ts:45-58`), followed by the administrator's name in brackets
    for `admin`. A `partial` closing appends the existing sentence "The box restarted during the
    stop, so the list may be short." (`box-emails.ts:78`, `:88`). The CSV carries no handled line
    and no note.
13. **The download route is keyed by incident id**: `GET /api/box/clock-misdated/:incidentId/download`,
    `system.manage` as the rest of the page (`box-health-api.ts:54-64`). An id that is not a UUID,
    names no incident, names another code, or names a "cannot tell" episode answers 404
    `alert.not_found`. A closing the seat does not know is logged
    `box-clock-misdated.unknown_confirmation`, as the list route does (`box-health-api.ts:123-126`),
    and answers the same 404.
14. **The download is offered for every episode with a list, open or handled; never for "cannot
    tell"**, which has no list.
15. **Mark handled is an action, not a save**: enabled from the start, with or without a note.
    **Add note is a save**: its note is required, and Save is quiet and disabled until the note has
    text (`saveActionState`). Both dialogs take a draft scope because the note is typed input
    (design-system.md → "Protect an edited dialog before closing it").
16. **The section's guidance line changes** from "Go through these with your tax adviser, then
    mark the alert as handled in the bell." to "Download each list for your tax adviser and go
    through it with them, then mark it handled here with a note of what was done."

## Global constraints

- **English only** in code, identifiers, comments, fixtures and tests. Spanish only in
  `apps/server/src/i18n/misdated-sales.ts` (new), the Spanish halves of
  `apps/dashboard/src/i18n/strings.ts` and `codes.ts`, and `apps/server/src/guide/es/box-status.md`.
  A test of Spanish text reads its expected words from the words file, `t()` or `codeMessage`,
  never a Spanish literal of its own. `scripts/english-only.test.ts` does not scan `apps/*`, so
  review greps the diff.
- **Fiscal**: nothing in `registros_facturacion` is written or changed. The new seat method only
  selects. `packages/fiscal-verifactu/src/write-path.e2e.test.ts` (the fixed `GOLDEN` huella at
  `:612-616`, and the recompute case at `:125-131`) and `packages/fiscal-verifactu/src/inmutabilidad.test.ts`
  run **unedited** in Task 5 and again in Task 13, and the pull request quotes both test counts.
- **Reads take no transaction of their own.** The download and the history route, like the list
  route, authorise with `authorizeSystemManager` (its own `withTransaction`, or a read on a full
  disk, `box-health-api.ts:54-64`) and then read everything in **one** `db.withWriteLock` turn, not a
  `withTransaction`, whose closing drain a full disk refuses (`box-health-api.ts:118-119`). The seat
  method opens none. Queries are awaited in turn, never `Promise.all`. The CSV is built after the
  turn.
- **Each note write** is the one `withTransaction` its route opens (`alerts-api.ts:39-49`); the
  body's text is read before the transaction, and the note is checked inside it only after the
  session, visibility and claim checks, before any write (review M6, round 3 m4).
- **Migration**: generated by `pnpm --filter @waitron/db db:generate --name incident_acknowledged_note`,
  never hand-edited; no shipped migration file is touched. A number collision on rebase is fixed by
  regenerating (CLAUDE.md §3).
- **Every database test uses `useVenueDb`.** A refused request asserts the domain error code. Exact
  shapes use `toEqual`/`toBe`, not `toMatchObject`, in new assertions.
- **Fixtures use values the two sides could treat differently**: a record whose stored offset (0)
  and issue date disagree with Madrid's; a corrected start within the margin of local midnight; an
  amount whose trailing zero matters (`"12.30"`) and a negative one (`"-5.00"`); a series beginning
  `=` or `-`; a Spanish decimal mark; a handler's display name that differs from every other
  person's in the suite.
- **Existing assertions that change on purpose** (the pull request names each, with why):
  - `apps/server/src/box-health.test.ts:98-127` (whole-health `toEqual`) gains
    `misdatedHandledCount: 0`: the box read now says how many handled lists exist (decision 1).
  - `box-health.test.ts:366-411`: each open entry gains its `incidentId` (needed to mark it handled
    from Box status, decision 4), and the handled row is counted in `misdatedHandledCount: 1`; it
    is still not in `misdatedOpen`.
  - `apps/server/src/clock-confirm.route.test.ts:1352-1360` (the "cannot tell" open entry's
    `toEqual`) gains `incidentId`, for the same reason.
  - The `health()` / `quietHealth()` fixtures of the six dashboard test files that build a
    `BoxHealth` (Task 8) gain `misdatedHandledCount: 0` and `incidentId` on open entries; a type
    change, no assertion's meaning changes.
  - **Unchanged on purpose**: `clock-confirm.route.test.ts:1322-1326` and `:1519`. Under decision 1
    the open-list route and `misdatedOpen` still drop a handled episode, which is what those lines
    check; the history now lives in the new route, so Task 1 adds assertions after `:1326` rather
    than reversing them.
  No other existing assertion changes (Task 1 step 5 runs both suites whole to show it).
- **Coverage** 98/98/98/95 in `@waitron/db`, `@waitron/core`, `@waitron/fiscal`,
  `@waitron/fiscal-verifactu`, `@waitron/server`, `@waitron/dashboard`; no exclude or ignore comment
  is added. `@waitron/db` and `@waitron/fiscal` are mutation-tested (`packages/db/stryker.config.json`,
  `packages/fiscal/stryker.config.json:7`); this branch adds a column, an index and a comment to
  the first and only types to the second's `backend.ts`.
- **Browser runs** (`apps/dashboard` runs in real headless Chromium): check `memory_pressure | grep
  free` first.
- Commits `git commit -s`; `pnpm format:check` before each commit. Run each focused command with
  `AI_AGENT` and `CLAUDECODE` unset when a test's console output matters, and read the `Tests` count.
- An implementer that passes about 150 tool calls with its task unfinished stops at a passing or
  cleanly failing point, commits, and hands over: what is done, what is left, the files, each
  check's state.

## Review focus

- **The by-id reads**: the download (Task 7) answers 404 `alert.not_found` for an incident id of
  another code, a "cannot tell" episode, a malformed id and an unknown id; the two note paths
  (Tasks 4a, 4b) answer 404 `alert.not_found` for another code, a malformed id and an unknown id,
  and take a note on a "cannot tell" episode; a session without the permission answers 403 before
  any read of the incident's contents, and a note is never checked before that.
- **The migration** (Task 2): the generated SQL is one `ALTER TABLE … ADD` and one plain
  `CREATE INDEX`; no rebuild, no index dropped; the index's query plan is shown.
- **The note's guarded writes** (Tasks 3, 4a, 4b): the first handling writes the note in its own
  UPDATE; Add note writes only where the alert is handled and has none; every refusal is a 409 with
  its own code, never a silent 204 with a note dropped.
- **The seat contract** (Task 5): a new optional method on `FiscalBackend`; `fiscal-none` and the
  fake backend leave it undefined, and the download route is mounted only where it exists.
- **One clock time per sale across the CSV, the emails and the Box status section** (Task 9).
- **Every sentence the CSV, the screen and the guide say about time**: "Unknown", the bound and
  "Cannot tell" are claims (decisions 8 and 9); the review checks the bound against
  `clock-misdated.ts:54-66`, `clock-checks.ts:85-87` and the 60 000 ms margin. VAT is mentioned
  only as "possibly … Q60 (b), not answered".
- **The day mark reads the stored issue date and offset** (decision 7), proved by a fixture whose
  stored offset is 0 while the venue is Madrid, and a case across local midnight inside the margin.
- **Money**: no `Number()` on an amount; `toScale` and the decimal mark only; the formula guard
  still applies to every non-amount cell.
- **The draft scopes and the action rules** on the two dialog modes (decision 15).
- **Performance**: the poll gains one index-served count; the history is read on demand
  (decision 1), unbounded when opened.
- **Personal data**: the note is free text a manager writes, stored in `incidents` and streamed with
  the database; the A664 audit row and the A980 design's Incidents row predate it (Task 13 adds
  pointers).

## Task 1 — the list stays after "handled", on its own route (server)

Files: `apps/server/src/box-health.ts`, `apps/server/src/box-health-api.ts`,
`apps/server/src/clock-confirm.route.test.ts`, `apps/server/src/box-health.test.ts`.

Interface:

```ts
export interface MisdatedOpen { incidentId: string; /* the existing params fields, unchanged */ }
export type MisdatedHandler = { kind: "box" } | { kind: "person"; name: string | null };
export interface MisdatedHandled extends MisdatedOpen { handledAt: string; handledBy: MisdatedHandler }
// BoxHealth gains: misdatedHandledCount: number;
export async function readMisdatedOpen(tx: Transaction): Promise<MisdatedOpen[]>; // + incidentId
export async function countMisdatedHandled(tx: Transaction): Promise<number>;
/** Handled clock.records_misdated alerts, newest first by detection, with who handled them. */
export async function readMisdatedHandled(tx: Transaction): Promise<MisdatedHandled[]>;
```

`readMisdatedHandled` selects by code with `acknowledged_at is not null`, left-joins `persons` on
`acknowledged_by`, orders `detected_at desc, id desc`. `collectBoxHealth` reads the open list and the
count in the same write-lock turn (`box-health.ts:213-243`). New route
`GET /api/box/clock-misdated/handled`, mounted beside the list route under the same
`misdatedRecords` condition (`box-health-api.ts:111-112`), answers
`{ episodes: (MisdatedHandled & { records: ListRecord[] | null })[] }`, where `records` is built as
the list route builds it (`:128-136`) and is null for "cannot tell" and for a closing the seat does
not know (logged as `:123-126` does).

1. **Failing test first (point 1).** In the case at `clock-confirm.route.test.ts:1263`, rename it
   "…, and keeps it, marked handled, on the handled route after its alert is handled". Leave
   `:1322-1326` as they are and add after them: `GET /api/box/clock-misdated/handled` holds an
   episode for `confirmationId` whose `records` `toEqual(listed!.records)` and whose summary
   `toEqual({ incidentId: misdatedIncident(confirmationId), …the open entry's params, handledAt:
   <the alerts app's clock, boxMs, as ISO>, handledBy: { kind: "person", name: "Marta" } })`; and
   `misdatedHandledCount` grew by one. Run
   `pnpm --filter @waitron/server exec vitest run src/clock-confirm.route.test.ts -t "on the handled route"`;
   watch it fail on the missing route. **If the list is somehow already served after handling**,
   stop and report: the receipt section above is wrong and must be corrected before Task 2.
2. More failing cases in `box-health.test.ts` (rewrite the case at `:366-411`, decision-named in
   Global constraints): open entries carry their `incidentId`, oldest first; the handled row is
   counted, not listed. In a new `box-health.test.ts` case for `readMisdatedHandled`: two handled
   rows come newest first by `detected_at`; a null `acknowledged_by` reads `{ kind: "box" }`; one
   naming no person reads `{ kind: "person", name: null }`; another code appears nowhere. In
   `clock-confirm.route.test.ts`, the "cannot tell" replaced by an earlier start
   (`clock-stop-incidents.ts:100-120`; reached as in the case at `:1465`) is on the handled route
   with `{ kind: "box" }` and `records: null`; the route refuses Sergio 403.
3. Update `box-health.test.ts:98-127` and `clock-confirm.route.test.ts:1352-1360` as Global
   constraints says, and nothing else in either file.
4. Implement. Omission controls, each run and reverted: drop the handled route's `records` → step 1
   fails; order handled oldest first → the two-row case fails; map a null handler to
   `{ kind: "person", name: null }` → the "box" case fails.
5. Run `pnpm --filter @waitron/server exec vitest run src/clock-confirm.route.test.ts src/box-health.test.ts src/box-health-api.test.ts src/box-alert-email.test.ts src/box-alert-email.duty.test.ts`
   whole (the email duty still reads open alerts only, `box-alert-email.ts:110-122`) and
   `pnpm --filter @waitron/server typecheck`. Every case outside steps 1–3 passes unedited.

## Task 2 — the note column and the index (db)

Files: `packages/db/src/schema/incidents.ts`, the generated
`packages/db/drizzle/0190_incident_acknowledged_note.sql`, `meta/0190_snapshot.json`,
`meta/_journal.json`, `apps/server/src/box-health.ts`, `apps/server/src/box-health.test.ts`. The
query-plan test lives in `apps/server`: `packages/db` cannot import from `apps/server`, which
depends on it (a loop `scripts/workspace-cycles.test.ts` refuses, round 3 m6).

Schema: `acknowledgedNote: label("acknowledged_note")` beside `acknowledgedBy`, and
`index("incidents_code_detected_idx").on(t.code, t.detectedAt)` with a one-line comment naming the
reads it serves (Task 1's three). The header comment (`incidents.ts:10-22`) is rewritten: an
incident is not rewritten; marking it handled, with an optional note, and adding a note once to a
handled incident with none are the only permitted changes; nothing in the database enforces that,
and the table carries no trigger that guards it (only the change feed's, `change-feed.ts:103-133`).

1. In `box-health.ts`, Task 1's three reads are split into exported builders
   (`misdatedOpenQuery(tx)`, `misdatedHandledQuery(tx)`, `misdatedHandledCountQuery(tx)`, each
   returning the unexecuted drizzle query) and the readers that await them, so a test can take
   `.toSQL()`. Failing test in `box-health.test.ts` (its `useVenueDb`): `explain query plan` on each
   builder's `.toSQL()` (SQL and params, not retyped) contains `USING INDEX
   incidents_code_detected_idx` and no `SCAN incidents`; and an insert with `acknowledged_note`
   reads back. Run `pnpm --filter @waitron/server exec vitest run src/box-health.test.ts`; watch it
   fail.
2. Add the column and the index; run
   `pnpm --filter @waitron/db db:generate --name incident_acknowledged_note`. **Read the SQL: it
   must be exactly ``ALTER TABLE `incidents` ADD `acknowledged_note` text;`` and one
   ``CREATE INDEX `incidents_code_detected_idx` ON `incidents` (`code`,`detected_at`);``. A
   `__new_incidents` table, a dropped index or anything else: STOP** and report (the
   expression-index trap, `incidents.ts:60-63`).
3. Run the migration guards: `pnpm exec vitest run scripts/schema-constraints.test.ts
   scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts
   scripts/migrations-match-schema.test.ts scripts/journal-monotonic.test.ts
   scripts/classification-complete.test.ts scripts/migration-upgrade.test.ts
   scripts/column-vocabulary.test.ts scripts/workspace-cycles.test.ts`, then
   `pnpm --filter @waitron/db exec vitest run`, `pnpm --filter @waitron/server exec vitest run
   src/box-health.test.ts`, and `typecheck` in both. Read every count.

## Task 3 — the note in core

Files: `packages/core/src/incidents.ts`, `packages/core/src/incidents.test.ts`.

Interface: `markIncidentHandled(tx, { id, personId, handledAt, note?: string | null }): Promise<boolean>`
sets `acknowledgedNote: input.note ?? null` in its one UPDATE, whose `acknowledged_at is null`
condition stays, and answers whether it changed a row (the existing callers ignore the answer).
`addIncidentNote(tx, { id, note }): Promise<"added" | "note_exists" | "not_handled" | "not_found">`:
one UPDATE `where id = ? and acknowledged_at is not null and acknowledged_note is null`; when it
changes no row, one select tells which of the other three answers holds.

1. Failing cases in `incidents.test.ts`: marking with a note stores it beside the handler and time
   and answers true; marking again answers false and changes neither handler nor note; marking with
   no note stores null; `addIncidentNote` on a handled incident with none answers "added" and
   stores it; a second answers "note_exists" and keeps the first; on an open incident
   "not_handled"; on an unknown id "not_found". Run
   `pnpm --filter @waitron/core exec vitest run src/incidents.test.ts`; watch them fail.
2. Implement. Control, run and reverted: drop `acknowledged_note is null` from the guard → the
   "note_exists" case fails.
3. Run `pnpm --filter @waitron/core exec vitest run src/incidents.test.ts src/incidents.concurrency.test.ts`
   and `pnpm --filter @waitron/core typecheck`.

## Task 4a — "Mark handled" takes the note (server)

Files: `apps/server/src/alerts-api.ts`, `apps/server/src/alerts-api.test.ts`,
`apps/server/src/errors.ts`, `apps/dashboard/src/i18n/codes.ts`.

Route `POST /management-api/alerts/incidents/:id/handled`: `requireManagementSession` (which only
checks the cookie is there, `alerts-api.ts:43`), then the body's **text** with `c.req.text()`, not
`readRawJsonBody`, which answers null for a malformed body as well as an empty one
(`packages/server-kit/src/read-json-body.ts:17-26`) and would turn `{note:"x"` into a silent "no
note" (round 3 m5). Nothing is judged yet. In `inSession`'s transaction (`:39-49`), after the
session is resolved and the existing visibility and claim checks (`:93-98`), and before any write,
the text is judged: empty → no note; text that does not parse → `management.request_invalid`
`{ field: "body" }`; parsed `null`, `{}` or `{ note: undefined }` → no note; `note` a string →
trimmed, `""` → no note, over 500 characters → `management.request_invalid` `{ field: "note" }`;
`note` any other type, or a body that is not an object → `{ field: "note" }`. A note is taken only
for a `clock.records_misdated` incident: a note on any other code → 404 `alert.not_found` (no
screen shows another code's note, round 3 m7); without a note every code is handled as today.
Then `markIncidentHandled`; when it answers false and a note was given → `alert.already_handled`
`{ id }`. `STATUS` gains `"management.request_invalid": 400` and
`"alert.already_handled": 409`. `errors.ts` declares `alert.already_handled` beside `alert.not_found`
(`:1292-1294`) with a one-line doc; `codes.ts` words it in English and Spanish ("This alert was
already marked handled, so the note was not saved. Add it from Handled lists on the Box status
page." and its Spanish twin).

1. Failing cases in `alerts-api.test.ts`: a note is stored (read back with SQL), 204; 500
   characters accepted, 501 refused with the code and `field`; whitespace-only stores null; a
   number refused; no body still works (the existing case at `:228` stays as it is); a note on an
   already-handled incident answers 409 `alert.already_handled` and stores nothing; the same
   without a note still answers 204 (the case at `:257`, unchanged); with a 501-character note, a
   request with no cookie answers 401, an expired session 401, a session that sees no alerts 404 and
   one without the claim's permission 403, never 400 (review M6); a body `{note:"x"` (unparsable)
   answers 400 `{ field: "body" }` and leaves the incident open; a note on a printer incident answers
   404 `alert.not_found` and leaves it open, while the same request without a note handles it. In `apps/dashboard/src/i18n/codes.test.ts`, the
   new code has an English and a Spanish sentence (read from `codes.ts`, not retyped). Run
   `pnpm --filter @waitron/server exec vitest run src/alerts-api.test.ts src/alerts-api.full-disk.test.ts`
   and `pnpm --filter @waitron/dashboard exec vitest run src/i18n/codes.test.ts`; watch them fail.
2. Implement. Controls, each run and reverted: skip the trim → the whitespace case fails; answer 204
   when `markIncidentHandled` answers false with a note → the 409 case fails; judge the note before
   `inSession` → the expired-session case answers 400 and fails; use `readRawJsonBody` → the
   unparsable case answers 204 and fails.
3. Run the same files and `typecheck` in `@waitron/server` and `@waitron/dashboard`.

## Task 4b — "Add note" on a handled alert, and the note on the history (server)

Files: `apps/server/src/alerts-api.ts`, `apps/server/src/alerts-api.test.ts`,
`apps/server/src/errors.ts`, `apps/dashboard/src/i18n/codes.ts`, `apps/server/src/box-health.ts`,
`apps/server/src/box-health.test.ts`.

Route `POST /management-api/alerts/incidents/:id/note`, body `{ note: string }`. The text is read
as in Task 4a; in one transaction, the session, the same visibility and claim-permission checks as
the handled route (`:92-98`) and a `clock.records_misdated` code (any other → 404
`alert.not_found`) come first; then the note is judged as Task 4a's but required (missing, empty or
whitespace → `management.request_invalid` `{ field: "note" }`; unparsable → `{ field: "body" }`);
then `addIncidentNote`: "added" → 204; "note_exists" → 409 `alert.note_exists` `{ id }`;
"not_handled" → 409 `alert.not_handled` `{ id }`; "not_found" → 404 `alert.not_found`. Both codes
declared in `errors.ts` and worded in `codes.ts` ("This alert already has a note." / "This alert has
not been marked handled yet.", and Spanish). `MisdatedHandled` gains `note: string | null`, read in
`readMisdatedHandled`.

1. Failing cases: the note is added to a handled incident (by a person, and by the box: null
   handler) and read back; a second answers 409 `alert.note_exists` with the first kept; an open
   incident answers 409 `alert.not_handled`; a malformed or unknown id 404; a handled printer
   incident 404 with nothing stored; with an empty note, an expired session answers 401 and a
   session without the claim's permission 403, and only a permitted one 400 with `field`; the handled route's episode carries the
   note, and `null` without one. `codes.test.ts` covers both codes. Run the Task 4a commands plus
   `src/box-health.test.ts`; watch them fail.
2. Implement. Control, run and reverted: call `markIncidentHandled` instead of `addIncidentNote` →
   the "box handled" case fails.
3. Run the same files, `src/clock-confirm.route.test.ts`, and both typechecks.

## Task 5 — the seat's `misdatedDetail` (fiscal, fiscal-verifactu)

Files: `packages/fiscal/src/backend.ts`, `packages/fiscal/src/index.ts`,
`packages/fiscal/src/testing/fake-backend.test.ts`, `packages/fiscal-none/src/backend.test.ts`,
`packages/fiscal-verifactu/src/clock-misdated.ts`, `packages/fiscal-verifactu/src/backend.ts`,
`packages/fiscal-verifactu/src/clock-misdated-detail.test.ts` (new),
`packages/fiscal-verifactu/src/backend.clock-stop.test.ts`.

Interface (in `packages/fiscal/src/backend.ts`, beside `MisdatedRecords`, `:262-271`):

```ts
export interface MisdatedDetailRecord extends MisdatedRecord {
  kind: "issue" | "cancellation";
  /** The stored fecha_expedicion_factura, YYYY-MM-DD; a cancellation's is the cancelled invoice's. */
  issueDate: string;
  /** The record's stored total, as hashed; null on a cancellation. */
  amount: string | null;
}
export type MisdatedDetail =
  | {
      known: true;
      closing: { source: ClockConfirmationSource; personId: string | null; confirmedAt: string;
                 correctedStart: string; partial: boolean;
                 /** The offset the check stored when it opened; null when it stored none. */
                 startOffsetMinutes: number | null };
      records: MisdatedDetailRecord[];
    }
  | { known: false };
// FiscalBackend gains, beside misdatedRecords (:365-367):
/** misdatedRecords' list with each record's kind, issue date and amount, and the closing's own
 * values; reads only. Null when no confirmation has the id. */
misdatedDetail?(tx: Transaction, confirmationId: string): Promise<MisdatedDetail | null>;
```

In `clock-misdated.ts`: `misdatedDetail` calls `misdatedRecords`; null or `known: false` is passed
through; otherwise one select of `clock_confirmations` left-joined to `clock_checks` by id (source,
person id, confirmed at, `proof`, the check's `detail`) and, when the list is not empty, one select
of `registros_facturacion` (`id`, `tipo_registro`, `fecha_expedicion_factura`, `importe_total`) with
`inArray` over the listed ids, awaited in turn, joined in JavaScript in the list's order.
`tipo_registro` `alta` → `issue`, `anulacion` → `cancellation`. `correctedStart` and `partial` come
from `proof.closing`; `startOffsetMinutes` from the check's `detail.offsetMinutes` when it is a
number.

1. Failing cases (`useVenueDb` as `clock-misdated.test.ts` sets it up, `:31`; its fixture shape
   copied into the new file rather than exported): the worked example's list with kinds, issue
   dates and amounts `toEqual`, including one anulación (`amount: null`, `kind: "cancellation"`,
   the original's date) and one amount `"12.30"` kept as written; the closing's values for an admin
   closing (`personId` set) and a devices closing, with the check's offset; a check with no stored
   offset answers `startOffsetMinutes: null`; a `partial` closing; "cannot tell" passes through as
   `{ known: false }`; an unknown id answers null; an empty list answers `records: []` with its
   closing. In `backend.clock-stop.test.ts`, beside `:154-168`, the same known and unknown ids
   through `backend.misdatedDetail!` (review M10). Run
   `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/clock-misdated-detail.test.ts src/backend.clock-stop.test.ts`;
   watch them fail.
2. Implement, and the backend method beside `backend.ts:225-227`. In `fake-backend.test.ts:72` and
   `fiscal-none/src/backend.test.ts:80` add the same "undefined" expectation for `misdatedDetail`.
3. Control, run and reverted: read `amount` through a `Number()` round trip → the `"12.30"` case
   fails.
4. **Fiscal guards, unedited**: `pnpm --filter @waitron/fiscal-verifactu exec vitest run
   src/write-path.e2e.test.ts src/inmutabilidad.test.ts src/clock-misdated.test.ts
   src/clock-stop-incidents.test.ts`; `git diff --stat main -- packages/fiscal-verifactu/src/write-path.e2e.test.ts
   packages/fiscal-verifactu/src/inmutabilidad.test.ts` prints nothing; `git diff main --
   packages/fiscal-verifactu/src/backend.ts` shows only the added delegating method. Then
   `pnpm --filter @waitron/fiscal exec vitest run`, `pnpm --filter @waitron/fiscal-none exec vitest run`,
   and `typecheck` in the three packages.

## Task 6 — the CSV builder and its words (server)

Files: `apps/server/src/attendance-export-csv.ts` (one export line only),
`apps/server/src/misdated-sales-csv.ts` (new), `apps/server/src/misdated-sales-csv.test.ts` (new),
`apps/server/src/i18n/misdated-sales.ts` (new).

Interface:

```ts
// attendance-export-csv.ts: `export { cell as csvCell };` — the function's body is not touched.
// misdated-sales-csv.ts
export interface MisdatedSalesInput {
  venue: string;
  language: "en" | "es";
  confirmedByName: string | null; // the administrator's display name for an admin closing
  episode: { from: string; fromOffsetMinutes: number; to?: string; toOffsetMinutes?: number };
  detail: Extract<MisdatedDetail, { known: true }>;
}
export function renderMisdatedSalesCsv(input: MisdatedSalesInput): Uint8Array;
export function misdatedSalesFileName(episode: { from: string; fromOffsetMinutes: number }): string;
```

Layout: line 1 the header sentence (decision 12) in one cell; line 2 the column headings — Series,
Number, Invoice date, Time recorded, Real time, Amount (EUR), Different day (Spanish in the words
file: Serie, Número, Fecha de factura, Hora registrada, Hora real, Importe (EUR), Otro día); then one
row per record in the list's order; BOM first, CRLF line ends, as `attendance-export-csv.ts:37`.
Series and number through `invoiceNumberParts` (`apps/server/src/invoice-number-parts.ts`), number
empty when null. Invoice date: the stored `YYYY-MM-DD` reordered to `dd/mm/yyyy` as text. Time
recorded: `receiptDateTimeNumeric(generatedAt, "en-GB", offsetMinutes)`. Header times: `from`/`to`
at their params' offsets; the bound (`correctedStart + CLOCK_WITNESS_MARGIN_MS`, the constant
imported from `@waitron/fiscal`, `packages/fiscal/src/index.ts:13`) and `confirmedAt` at
`startOffsetMinutes`, else the first record's offset (decision 7). Real time: "Unknown" /
"Desconocida". Amount: decision 10 through the local `amountCell`, "Cancellation" / "Anulación"
(through `csvCell`) for a cancellation. Different day (decision 9): compare `issueDate` with the
bound's calendar date at the record's own offset (the bound shifted by `offsetMinutes`, then its
UTC date, as `receipt-dates.ts:27-32` shifts) — "Yes"/"Sí", "Cannot tell"/"No se sabe", "Not
applicable"/"No aplicable". `{count}` is `records.length`.

1. Failing cases, the words read from `MISDATED_SALES_WORDS` in each language, never Spanish
   literals in the test:
   - **The stored date decides, not a zone (R1).** Corrected start `2026-10-24T21:00:00.000Z`,
     check offset 120 (bound `2026-10-24T21:01:00.000Z`, 23:01 on the 24th at +02:00). Record A at
     `2026-10-24T22:30:00.000Z`, offset 0, stored issue date `2026-10-24` (what a box with `TZ=UTC`
     stores, `docs/backlog/fiscal.md:15-17`) → Time recorded `24/10/2026 22:30`, Invoice date
     `24/10/2026`, "Cannot tell". Record B at the same instant, offset 120, issue date `2026-10-25`
     → `25/10/2026 00:30`, "Yes". Control, run and reverted: recompute A's date from its timestamp
     in `Europe/Madrid` (`civilDateOf`) → A reads "Yes" and the case fails.
   - **Inside the margin across midnight (R2).** Corrected start `2026-10-24T21:59:30.000Z`, offset
     120 (23:59:30 on the 24th; bound 00:00:30 on the 25th); a record at `2026-10-24T22:30:00.000Z`,
     offset 120, issue date `2026-10-25` → "Cannot tell". Control, run and reverted: compare with
     the unwidened corrected start's date → "Yes", and the case fails.
   - **A cancellation**: issue date of the cancelled invoice, amount "Cancellation", day mark "Not
     applicable".
   - **Amounts (R3)**: `"12.30"` → `"12.30"` (en) and `"12,30"` (es); `"-5.00"` → `"-5.00"` /
     `"-5,00"`, with no leading apostrophe; a record whose series is `=1+1` and one whose series is
     `-1+1` → `"'=1+1"` and `"'-1+1"` (the guard still applies to every other column).
   - **Header**: the exact English sentence for two records from an admin closing named "Mario"
     (`… confirmed by an administrator (Mario) on …`, the bound one minute after the corrected
     start); a bound with seconds is rounded up: corrected start `2026-10-24T21:59:30.000Z`, check
     offset 120, bound `22:00:30Z` → written `25/10/2026 00:01`, never `00:00` (round 3 m3, whose
     run printed `00:00` for plain formatting); the one-sale form, the `partial` sentence appended, and the Spanish header equals the
     Spanish template filled with the same values; `{count}` follows the rows when the alert's
     param says otherwise.
   - **Shape**: BOM first, CRLF line ends, every cell quoted; the file name is
     `misdated-sales-2026-10-25.csv` for an episode whose `from` is `2026-10-24T22:30:00.000Z` at
     `fromOffsetMinutes` 120, and `misdated-sales-2026-10-24.csv` at 0 (decision 6); Task 9b's
     browser case uses the same `from`, offset and expected name.
   Run `pnpm --filter @waitron/server exec vitest run src/misdated-sales-csv.test.ts`; watch it fail.
2. Add the one export line; `pnpm --filter @waitron/server exec vitest run src/attendance-export-csv.test.ts src/attendance-export-api.test.ts`
   stays green with no test edited.
3. Implement. Control, run and reverted: write the amount through `csvCell` → the `-5.00` case
   fails.
4. Run the four files and `pnpm --filter @waitron/server typecheck`.

## Task 7 — the download route (server)

Files: `apps/server/src/box-health-api.ts`, `apps/server/src/box-health.ts` (one by-id reader),
`apps/server/src/boot.ts` (`mountBoxHealthApi`'s deps, `:2412`), `apps/server/src/clock-confirm.route.test.ts`
(the cases, and the deps in `stoppedBox` `:215-234` and `boxApp` `:1222-1245`),
`apps/server/src/box-health-api.test.ts` (deps at `:66-80`), `apps/server/src/start-full-disk.e2e.test.ts`
(deps at `:294`). The last two gain the new field with no assertion changed.

Interface: `BoxHealthApiDeps` gains `venue: { locationId: string; language: "en" | "es" }`; boot
passes `{ locationId: till.locationId, language: venueLocale === "es-ES" ? "es" : "en" }`.
`box-health-api.ts` gains `import "./errors.js";` and `"alert.not_found": 404` in `STATUS`
(`:41-50`). The route `GET /api/box/clock-misdated/:incidentId/download` is mounted only when the
seat has `misdatedDetail`. Inside one `withWriteLock` turn: `readMisdatedEpisode(db, incidentId)` (the
incident's code and params by id, after an `isUuid` check), the seat's `misdatedDetail`, the
location's `name`, and `displayNameOf` (`box-health.ts:122-128`) for an admin closing. After the
turn: `renderMisdatedSalesCsv`; headers `Content-Type: text/csv; charset=utf-8`,
`Content-Disposition: attachment; filename="<misdatedSalesFileName>"`, `Cache-Control: no-store`,
`X-Content-Type-Options: nosniff` (as `attendance-export-api.ts:134-143`). Refusals: decision 13.

1. Failing cases in `clock-confirm.route.test.ts`, on an episode made as in the case at `:1263`:
   - the CSV's rows match the list route's records for the same episode, one for one; each row's
     Time recorded is `receiptDateTimeNumeric(record.at, "en-GB", record.offset)` from `invoiceOf`
     (`:1188-1203`) and its Invoice date the row's stored date; every Real time is the "Unknown"
     word; the header names Mario and the row count; the bytes start with the BOM; the four headers
     are set;
   - the same after the alert is marked handled (decision 14);
   - with `language: "es"` in the deps, the column headings are the Spanish words;
   - 404 `alert.not_found` for a malformed id, an unknown UUID, the incident id of a
     `clock.behind_chain_restarted` alert, and a "cannot tell" episode; 403 for Sergio (supervisor);
   - on a full disk with a change waiting (as the case at `:1395` does), the download still
     answers and the change still waits.
   No case writes `locations` (the shared database is `resetPerTest: false`, `:78-79`). Run
   `pnpm --filter @waitron/server exec vitest run src/clock-confirm.route.test.ts -t "download"`;
   watch them fail.
2. Implement and wire boot.
3. Controls, each run and reverted: drop the code check from the by-id read → the restarted-alert
   case answers 200; remove `"alert.not_found": 404` → the 404 cases answer 400.
4. Run `pnpm --filter @waitron/server exec vitest run src/clock-confirm.route.test.ts src/box-health.test.ts src/box-health-api.test.ts src/start-full-disk.e2e.test.ts src/boot.test.ts`
   and `pnpm --filter @waitron/server typecheck`. If the new or longer files push a server shard
   past 4 minutes in CI, refresh `apps/server/test-durations.json` with `scripts/test-durations.mjs`
   (CLAUDE.md §2).

## Task 8 — the dashboard's client and types

Files: `apps/dashboard/src/api/client.ts`, `apps/dashboard/src/api/client.test.ts`,
`apps/dashboard/src/api/live-queries.ts`, and the `health()` / `quietHealth()` fixtures in the six
files `apps/dashboard/src/screens/box-status-rows.test.ts`, `box-status-rows.tax.test.ts`,
`box-status-screen.test.ts`, `box-status-screen.a11y.test.ts`, `box-status-screen.retry.test.ts`,
`box-status-screen.retry.a11y.test.ts` (claim check #54).

Interface: the LOCAL copies (`client.ts:1749-1775`) gain `incidentId` on `MisdatedOpenView`,
`BoxHealth.misdatedHandledCount`, and a `ClockMisdatedHandledView` (`episodes` with `handledAt`,
`handledBy`, `note`, `records`). `markIncidentHandled(incidentId: string, note?: string)` sends
`{ note }` only when given (the bell's and Alerts screen's calls are unchanged).
`addIncidentNote(incidentId, note)` → `POST …/note`. `clockMisdatedHandled()` → `GET
/api/box/clock-misdated/handled`. `downloadMisdatedSales(incidentId): Promise<Blob>` → the download
path with `{ as: "blob" }`, as `downloadVatReturnFile`. `QUERY_DEPENDENCIES` gains
`clockMisdatedHandled: ["incidents", "persons"]` (the names, as `listHandledAlerts`,
`live-queries.ts:533`); `clockMisdated` and `getBoxHealth` stay as they are (`:529-531`).

1. Failing cases in `client.test.ts`: the note is in the POST body when given and the body absent
   when not; Add note posts to `/note`; the handled read and the download hit their paths with the
   id encoded; the download answers a Blob. Run
   `pnpm --filter @waitron/dashboard exec vitest run src/api/client.test.ts`; watch them fail.
2. Implement; update the fixtures; `pnpm --filter @waitron/dashboard typecheck`;
   `pnpm exec vitest run scripts/live-subscriptions.test.ts`.
3. Run `pnpm --filter @waitron/dashboard exec vitest run src/api/client.test.ts src/screens/box-status-rows.test.ts src/screens/box-status-rows.tax.test.ts`.

## Task 9 — Box status: the section writes each sale's time at its stored offset

Files: `apps/dashboard/src/screens/box-status-screen.ts`, `apps/dashboard/src/screens/box-status-screen.test.ts`,
`apps/dashboard/src/date-utils.test.ts`.

Scope (controller's ruling on round 3 I1, option (a)): only the "Sales dated wrongly" section. The
table's Time recorded cell (`box-status-screen.ts:700`) becomes `` `${date} ${time}` `` from
`wallClock(record.at, record.offsetMinutes)` (`apps/dashboard/src/date-utils.ts:24-28`; the list
route already sends `offsetMinutes`, `apps/server/src/box-health-api.ts:133-134`), and the
several-tables label (`:733-738`) uses `wallClock(open.from, open.fromOffsetMinutes)` and
`wallClock(open.to, open.toOffsetMinutes)`. `formatIsoMinute` and its other callers are not
changed. The "cannot tell" and `partial` sentences come from the shared alert wording
(`alertMessage`, the bell's too) and are not changed.

Existing dashboard assertions that change, each because the section now writes the stored offset
instead of the browser's zone (the fixtures' `offsetMinutes: 120` against the browser tests' UTC,
`apps/dashboard/vitest.config.ts:60`, so each fails on the old code):
- `box-status-screen.test.ts:1149-1150`: the cells expect `wallClock(OPEN.from, 120)`'s
  `2026-10-22 21:00` and `21:05`, not `formatIsoMinute`'s `19:00` and `19:05`;
- `:1221-1238`: the range labels, English and Spanish, built from `wallClock` with the entries'
  `fromOffsetMinutes` and `toOffsetMinutes`;
- `:1260`: the `ODD` row's cell, the same way.
Unchanged on purpose: `:1183-1190` (the "cannot tell" sentence, from `alertMessage`).

1. Change those three assertions, and add a case across midnight: a record at
   `2026-10-22T23:30:00.000Z` with `offsetMinutes: 120` shows `2026-10-23 01:30` (the browser's UTC
   would show `2026-10-22 23:30`). In `date-utils.test.ts` (Node, `America/New_York`), `wallClock`
   of that instant at 120 gives `{ date: "2026-10-23", time: "01:30" }`, whatever the host zone. Run
   (memory first) `pnpm --filter @waitron/dashboard exec vitest run src/screens/box-status-screen.test.ts src/date-utils.test.ts`;
   watch the screen cases fail.
2. Implement. Control, run and reverted: put `formatIsoMinute` back in the cell → the cell cases
   fail.
3. Run both files, `src/screens/box-status-screen.a11y.test.ts`, and the typecheck.

## Task 9a — Box status: the Handled lists fold

Files: `apps/dashboard/src/screens/box-status-screen.ts`, `apps/dashboard/src/i18n/strings.ts`,
`apps/dashboard/src/screens/box-status-screen.test.ts`, `box-status-screen.a11y.test.ts`.

What it draws (decisions 1, 2, 16): the section as today (`box-status-screen.ts:748-770`) with the
new line (`box_status.misdated.line`, both languages); the section is also drawn when
`misdatedHandledCount > 0`. Under the open entries, a `wt-disclosure` (`packages/ui/src/components/wt-disclosure.ts`)
headed "Handled lists ({count})", closed by default. On its `wt-toggle` to open, the screen watches
`clockMisdatedHandled` (released on close and on disconnect); each episode, newest first: a line
"Marked handled by {name} on {time}." / "Marked handled by the box on {time}." / "Marked handled on
{time}." (no name), the note as "Note: {note}" when there is one, the episode's sentence and table
as an open entry draws them (at the stored offset, Task 9). `handledAt` carries no stored offset,
so "on {time}" is written with `formatIsoMinute`, in the viewer's zone, and the guide says so. A
failed read says "The handled lists could not be read." inside the
fold. The several-tables label (`:733-738`) counts the tables drawn. New `box_status.misdated.*`
keys in both languages.

1. Failing browser cases: the fold shows the count and reads nothing until opened; opened, a handled
   entry's table shows with who, when and its note; two entries newest first; "the box" line for a
   box-handled one; the section is drawn when only handled lists exist; the read stops on close;
   a failed read shows its sentence. Spanish case: switch the language, expected words from `t()`,
   restore the language after (CLAUDE.md §4). Run (memory first)
   `pnpm --filter @waitron/dashboard exec vitest run src/screens/box-status-screen.test.ts`; watch
   them fail.
2. Implement. Control, run and reverted: watch the handled read on connect instead of on open → the
   "reads nothing until opened" case fails.
3. `box-status-screen.a11y.test.ts`: the fold closed and open with a noted entry, both themes.
4. Run both files and `pnpm --filter @waitron/dashboard typecheck`.

## Task 9b — Box status: the download button

Files: as Task 9a.

Each open and handled entry with a list gains **Download for your adviser** (`secondary`), never a
"cannot tell" entry (decision 14). It calls `api.downloadMisdatedSales(incidentId)` and saves through
a link as `vat-return-screen.ts:122-128` does, named `misdated-sales-<wallClock(from,
fromOffsetMinutes).date>.csv` (decision 6, the same rule as the server's); `loading` on
its own button while asked; a failure shows `codeMessage(code)` under that entry until the next
press.

1. Failing cases: Download asks for the entry's incident id and clicks a link whose `download` is
   `misdated-sales-2026-10-25.csv` for `from` `2026-10-24T22:30:00.000Z` at offset 120 (Task 6's
   fixture; under the browser tests' UTC a browser-zone date would give `…-10-24`), spied on
   `HTMLAnchorElement.prototype.click`; none for "cannot tell", open or
   handled; a refused download shows the sentence under that entry only. Run as Task 9a; watch them
   fail.
2. Implement; add the open-entry-with-button state to the a11y file, both themes.
3. Run both files and the typecheck.

## Task 10a — the note dialog (widget)

Files: `apps/dashboard/src/widgets/misdated-note-dialog.ts` (new), `misdated-note-dialog.test.ts`,
`misdated-note-dialog.unsaved.test.ts`, `misdated-note-dialog.a11y.test.ts` (new),
`apps/dashboard/src/i18n/strings.ts`.

Built like `apps/dashboard/src/widgets/attendance-export-dialog.ts` (its draft scope and its
`.unsaved.test.ts`). Property `mode: "handle" | "note"`, `incidentId`, the episode line ("{count}
sales from {from} to {to}", or the one-sale or "cannot tell" form). A `wt-dialog`, one `wt-textarea`
`name="note"`, label "Note", placeholder "What your tax adviser said, or what was done" (with
"(optional)" in `handle` mode), `maxlength` 500, `required` in `note` mode, and `wt-form-actions`:
- `handle` mode, heading "Mark handled": Cancel (`secondary`) and **Mark handled** (`primary`,
  enabled from the start, decision 15) → `api.markIncidentHandled(incidentId, note || undefined)`.
- `note` mode, heading "Add a note": Cancel and **Save**, quiet and disabled until the trimmed note
  is not empty (`saveActionState`) → `api.addIncidentNote(incidentId, note)`.
Both: `loading` while sent, both buttons disabled and the dialog not dismissible while sent;
`draftScopeFor(this, owner)`, the draft being the trimmed note against `""`; `beforeClose` through
the coordinator; Cancel and Escape through `requestClose`. On success: `commit`, `closeAfter("saved")`,
and a plain `saved` event for the screen. A refusal `management.request_invalid` with `field:
"note"` puts "Write a note of 500 characters or fewer." (or "Write a note." when empty) under the
field and `t("form.fix_fields")` (`strings.ts:773`) as the bottom message, and moves focus to the
field with `focusFirstInvalid` (design-system.md → Forms, `:2470`, `:2486-2491`), until the note changes;
any other refusal (`alert.already_handled`, `alert.note_exists`, `alert.not_handled`,
`alert.not_found`) shows `codeMessage(code)` as the bottom message; no refusal disables the action.

1. Failing cases: `handle` mode sends the trimmed note and no note when empty, its action enabled on
   open; `note` mode's Save is disabled until text is typed and sends it; a field refusal sits under
   the field with the generic bottom message and focus on the field, and both clear when the note
   changes; `alert.already_handled` shows its sentence at the bottom; success emits `saved` and
   closes. In `.unsaved.test.ts`, closing with a typed note asks, Keep keeps it, Discard closes;
   closing untouched asks nothing. Run (memory first)
   `pnpm --filter @waitron/dashboard exec vitest run src/widgets/misdated-note-dialog.test.ts src/widgets/misdated-note-dialog.unsaved.test.ts`;
   watch them fail.
2. Implement. Control, run and reverted: leave out `changed()` after input → the unsaved case fails.
3. `misdated-note-dialog.a11y.test.ts`: each mode open, with a field refusal, and while sending,
   both themes.
4. Run the three files and `pnpm --filter @waitron/dashboard typecheck`.

## Task 10b — the dialog on Box status

Files: `apps/dashboard/src/screens/box-status-screen.ts`, `box-status-screen.test.ts`,
`box-status-screen.a11y.test.ts`, `apps/dashboard/src/i18n/strings.ts`.

Each open entry gains **Mark handled** (`secondary`) → the dialog in `handle` mode for its incident;
each handled entry with no note gains **Add note** (`secondary`) → `note` mode. On `saved`, the
screen calls `api.liveData.refresh()`, as its other actions do (`box-status-screen.ts:347`), so the
box read, the open lists and an open fold read again.

1. Failing cases: Mark handled opens `handle` mode for that entry's incident; Add note opens `note`
   mode and is absent on an entry that has a note; after `saved`, `liveData.refresh` is called (spy).
   Run `pnpm --filter @waitron/dashboard exec vitest run src/screens/box-status-screen.test.ts`;
   watch them fail.
2. Implement; add the open entry with both buttons and a handled entry with Add note to the a11y
   file, both themes.
3. Run both files and the typecheck.

## Task 11 — the guides

Files: `apps/server/src/guide/en/box-status.md`, `apps/server/src/guide/es/box-status.md`.

1. In `#clock-behind` (`en/box-status.md:214-223` and its Spanish twin), the sentence quoting the
   section's line takes the new line (decision 16), and "then mark the alert as handled" points to
   the new section.
2. Add `## Sales dated wrongly {#sales-dated-wrongly}` to both, after `#clock-behind`, saying in the
   screen's own words: each list stays under **Handled lists** after it is marked handled, with who,
   when and any note, newest first, including the box's own handling when a later check replaced a
   "cannot tell"; **Download for your adviser** gives a CSV in the venue's language with the header
   line, the columns, times as each sale recorded them (the same clock times the section shows; when
   a list was handled is shown in the viewer's own time zone), "Unknown" real times with the "made before"
   time, and "Yes" ("by the confirmed clock, the sale was made on an earlier day than its invoice
   date, so possibly in a different VAT period; ask your tax adviser"), "Cannot tell" or "Not applicable"; amounts as
   recorded; **Mark handled** on this page takes an optional note of up to 500 characters, the
   bell's does not, and a list handled without a note can take one note later with **Add note**. No
   sentence claims more than decisions 3 to 15 deliver; none says "certainly".
3. Run `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
   `pnpm exec vitest run scripts/guide-links.test.ts`.

## Task 12 (visual) — LOOK

Docker Desktop's socket is missing on this machine (`docker info`: "no such file", claim check
#78), so no dev stack starts. Scripts and pictures live outside the worktree:
`~/waitron-campaign-b/a1088-scripts/` and `~/waitron-campaign-b/a1088-shots/`; nothing here is
committed (`git status --short` shows none of it).

1. A throwaway browser test beside `box-status-screen.a11y.test.ts`, gated as
   `department-receipt-editor.a11y.test.ts:66-76` gates its captures, takes `page.screenshot` of:
   the section with an open list (both buttons), the fold open with a noted entry and one with Add
   note, and each dialog mode (empty, with a field refusal), in English and Spanish, light and dark,
   at 1280 and 390 px. Check at 390 px that the buttons and the note wrap inside the page and
   nothing scrolls sideways except the tables. Deleted after.
2. A throwaway copy of Task 7's download case writes the English and the Spanish CSV to the shots
   folder; read both whole. Open the Spanish one in LibreOffice (`/opt/homebrew/bin/soffice`) with
   an es-ES locale, and the English one with en-GB: say whether each opens in columns, whether
   `-5,00` / `-5.00` reads as a number, and whether the accents show. Excel is not installed here;
   say so. If the Spanish file opens in one column, stop and raise it with the owner (`;` for `es`
   is the likely change; the working-time export has the same pattern today).
3. Write one line per picture or file for the pull request's **LOOK** section.

## Task 13 — docs, backlog and the final fiscal run

Files: `docs/backlog.md`, `docs/backlog/box.md`, `docs/developers/design-system.md`,
`docs/developers/conventions-data.md`, `docs/compliance/asesor-questions.md`,
`docs/superpowers/specs/2026-10-19-a798-degraded-trading-design.md`,
`docs/superpowers/specs/2026-10-16-a664-personal-data-audit.md`,
`docs/superpowers/specs/2026-10-22-a980-data-protection-design.md`.

1. Grep the siblings first: `grep -n -i "misdated\|dated wrongly\|readMisdatedOpen\|Q60" docs/backlog.md docs/backlog/*.md docs/developers/*.md`.
   A1088 itself is in lane B's queue, not `docs/backlog.md`. On `f0c5a44a7` the grep hits
   `docs/backlog.md:4627`, `:4631`, `:4635`, `:4652`, `docs/backlog/box.md:1240-1244` and the
   `docs/developers/` lines of steps 4–5; the cast entry `docs/backlog.md:5063-5066` says
   "wrongly-dated-sales" and is found by name (claim check #80). None names the download, the
   history or the note, so nothing is deleted.
2. `docs/backlog/box.md:1238-1247`: the cast point now names `readMisdatedOpen` and
   `readMisdatedHandled`.
3. New short entries in the box area of `docs/backlog.md` (after the A798 follow-ups,
   `:4636-4655`), detail in `docs/backlog/box.md` where longer than three lines:
   - **Correct the sales dated wrongly once the tax adviser answers Q60** — what the correction is
     waits on Q60; A1088 built only the list, its history, the note and the download.
   - **Some sales dated wrongly are in no list** (design §4.9 f): a clock put right from little more
     than a minute ahead, which the 15-second look can miss; and a "cannot tell" episode, which asks
     for every sale since its start to be checked but has no list and no download.
   - **The real time of a sale dated wrongly is unknown**: every row says so (A1088 decision 8);
     slice 9c's change checks are where it could first be worked out.
   - **The CSV's invoice dates follow the server's own time zone until A696 is built**: the stored
     issue date and offset come from the process zone (`apps/server/src/till-backend.ts:14-25`); the
     CSV writes what is stored (A1088 decision 7). Link the A696 entry.
   - **The bell's and the Alerts screen's Mark handled take no note**, and the Handled tab does not
     show notes (A1088 decision 4).
   - **The Handled lists fold reads every handled list when opened, with no limit** (A1088 decision
     1); page it if a venue gathers many.
4. `docs/developers/design-system.md` → Box status page: the "holds no staged input" sentence
   (`:5448-5449`) and the Sales dated wrongly bullet (`:5525-5532`) describe the fold, the buttons
   and the dialog's two modes; the cases list names the new widget's tests.
5. `docs/developers/conventions-data.md:3861-3862`: the list route still answers open alerts only;
   handled ones are on `GET /api/box/clock-misdated/handled` (`readMisdatedHandled`), and the
   download serves either.
6. Dated pointers (historical or unsent text is not rewritten): Q60 in
   `docs/compliance/asesor-questions.md` (after `:3832`): "2026-10-25 (A1088): the list now stays on
   the Box status page after the alert is handled, with who handled it and an optional note, and
   each list downloads as a CSV for the adviser (series and number, invoice date, time recorded,
   real time unknown, amount, and whether the invoice date may differ from the day the sale was
   made)." The spec's §4.9 f, after its last paragraph, one line pointing at this plan. The A664
   audit's `incidents` row (`2026-10-16-a664-personal-data-audit.md:116`) and the A980 design's
   Incidents row (`2026-10-22-a980-data-protection-design.md:199`, pointer d8 at `:209`, "codes,
   parameters, who acknowledged"): one line each that `acknowledged_note`, free text a manager
   writes, was added by A1088.
7. `pnpm exec prettier --file-info` on each changed doc (each prints `"ignored": true`).
8. **Final fiscal run, unedited**: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`;
   record both counts for the pull request; `git diff --stat main -- packages/fiscal-verifactu/src/schema/
   packages/fiscal-verifactu/src/chain.ts packages/fiscal-verifactu/src/clock-stop-incidents.ts`
   prints nothing; `git diff main -- packages/fiscal-verifactu/src/backend.ts` shows only the
   added delegating method.

Then `/finish-branch` (FULL path, two Codex run-it reviews).
