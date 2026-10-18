# A788: the business day's start changes at the next changeover

**Status:** design, waiting for the owner's answers (questions in section 9, to be asked one at a
time). No product code is changed by this document.

**Inspected base:** `ee59f461c` (main, 2026-10-18). Every `file:line` below is at that commit.
"Probe" means a script or a temporary test that was run on 2026-10-18 on Node v26.11.1 against
that base; the scripts are kept outside the repository in
`/Users/clintongormley/waitron-campaign/a788-mockups-src/probe/`, and the temporary test file was
deleted after it ran.

## The owner's request

Verbatim, 2026-10-17:

> "This seems weird. I would want to schedule a change from eg next week. Then change the shifts
> first next week to match. This doesn't allow me to do it. Why doesn't it? That said we don't base
> the opening hours off the cutover time. Eg we close at 1am and cut over at 3am. I'm not sure we
> need scheduling. Why not just make it that it just affects the next cutover. So it is 10pm I
> change it from 5am to 3am, it changes at 3am tomorrow. I change it to 9pm it changes at 9pm
> tomorrow."

Follow-up: "No need to cancel changes then" — no Replace or Cancel actions; a new Save simply sets
the start the next changeover uses.

## 1. Words used here

- **Business day**: the stretch of time a day's sales and reports belong to. It is named after the
  calendar date on which it **starts**.
- **Start** (the code calls it the *cutover*): the clock time at which one business day ends and the
  next begins, such as 05:00.
- **Changeover**: the moment that happens. With a 05:00 start, Tuesday's business day ends and
  Wednesday's begins at 05:00 on Wednesday morning.
- **Waiting change**: a new start that has been saved but whose changeover has not happened yet.
  A755 calls this a *scheduled* or *pending* change.

How the code decides a sale's business day, which every example below depends on: business day `d`
runs from date `d` at `d`'s start to date `d+1` at `d+1`'s start
(`boundsAt`, `packages/shared/src/business-day-clock.ts:85-90`); the start of a date is the last
saved change whose date is on or before it, else the venue's first start (`cutoverAt`, `:50-57`);
an instant belongs to the day whose bounds contain it (`businessDayAt`, `:110-129`). A sale stores
only the moment it was issued; its day is worked out from those bounds whenever a report is read.

## 2. What happens today, and why opening hours are frozen

### What the Business-day card does (A755, #1809)

- The Change start dialog asks for a **From business date** and a time
  (`apps/dashboard/src/screens/business-day-start-editor.ts:461-484`).
- The earliest date allowed is today's business date plus 2, the latest plus 366
  (`assertFutureDate`, `apps/server/src/business-day-start.ts:106-111`).
- A waiting change can be replaced or cancelled only until the start of the day before it takes
  effect, shown as **Editable until** (`locksAt`, `business-day-start.ts:90-95`; refusal
  `transition_started`, `:102-105`; card row, `business-day-start-editor.ts:430-437`).
- The card offers **Replace change** and **Cancel scheduled change** while a change waits
  (`business-day-start-editor.ts:388-410`). Saving today's start while a change waits is refused
  with `cancel_required` (`business-day-start.ts:242-245`).
- While a change waits, every time-related opening-hours write is refused with
  `hours.clock_change_pending` (`packages/venue-service/src/business-day-schedule.ts:501-508`).
  The writes that ask: period last-orders offsets (`menu-timetable.ts:526`, `:660`), deleting a
  period (`period-delete.ts:214`), special days (`special-days.ts:1044`, `:1203`), seasons
  (`seasons.ts:139`), season weeks (`season-weeks.ts:373`) and zone closed times
  (`zone-closed-times.ts:45`). The dialog says so: "Opening hours cannot change while this is
  pending." (`apps/dashboard/src/i18n/strings.ts:838-839`).

So the owner's plan — save a change for next week, then adjust the hours next week to match — is
refused at the second step, for up to 366 days. Staff rota shifts were not blocked: none of the
callers of `assertBusinessDayScheduleWrite` is in `packages/staffing`
(`grep -rn assertBusinessDayScheduleWrite apps packages`, test files excluded, lists only the
venue-service files above and the module seat, `packages/module/src/module.ts:619`).

### Why hours are frozen

Saving a start runs a full check of every opening-hours range against the change
(`writeBusinessDayStart` → `assertBusinessDayClockChange`, `business-day-start.ts:256-262` →
`businessDayClockConflicts`, `business-day-schedule.ts:58-474`). It refuses a change that would
leave a range with one of five problems (`:418-439`):

| Reason (code) | What it means | Example, 05:00 start |
| --- | --- | --- |
| `range` | A range no longer fits inside one business day | Dinner 22:00–04:30 with a new 03:00 start: it would cross the new changeover |
| `all_day` | An "all day" range is written as start-to-start, so it means something else under any other start | 05:00–05:00 with a new 03:00 start |
| `endpoint_day` | A range's end moves to the other calendar date | Lunch 13:00–16:00 with a new 21:00 start: "Monday's lunch" would become Tuesday's |
| `sending_cutoff` | Last orders (the period's end offset) would reach the new changeover or the next period | Dinner 21:00–02:45, last orders +30, with a new 03:00 start |
| `transition_strip` | A range or its last orders falls in the hours between the old and new start on the changeover night | (the strip 03:00–05:00 on the night of a 05:00 → 03:00 change) |

Probe (`a788-probe.test.ts.txt`, run as a temporary test beside
`packages/venue-service/src/business-day-schedule.test.ts`, using its `fixture`, then deleted):
`businessDayClockConflicts` from 05:00 returned `endpoint_day` for 13:00–16:00 → 21:00, `range` for
20:00–00:30 → 21:00, `range` for 22:00–04:30 → 03:00, `all_day` for 05:00–05:00 → 03:00, and no
conflict for 13:00–16:00 → 03:00, 20:00–01:00 → 03:00 and 09:00–17:00 → 07:00
(7 tests passed; the reasons were printed, not asserted).

The opening-hours editors run a much smaller check: each range must parse under **every start the
venue has ever had, plus the waiting one** (`scheduleCutovers`,
`packages/venue-service/src/service-day-context.ts:40-44`, used at `menu-timetable.ts:709`,
`zone-closed-times.ts:86`, `special-days.ts:585-588` and `period-end-offset.ts:106`). That catches
`range` and `all_day` but not `endpoint_day` or `transition_strip`. Probe (`hours.mts`): with a
21:00 start waiting, a 13:00–16:00 range **parses** under both 05:00 and 21:00 — the editors would
accept it — while the Save check above refuses the same range as `endpoint_day`.

So the freeze exists because the Save check runs once, at Save. Without the freeze an hours edit
made afterwards could create exactly the clash the Save check refused, and nothing would look again
before the changeover. A495's design says so: "Time-related schedule editing is paused while a
change is pending; edit hours first, or cancel the pending change"
(`docs/superpowers/specs/2026-10-11-a495-business-day-history-design.md:62`, `:104`).

### Which of those checks still bite if the change applies at the next changeover

All five. Each is about the boundary moving, not about how far ahead the date is: a range that
crosses the new start, an all-day range, a range whose end changes date, last orders reaching the
new changeover, and hours inside the strip between the two starts are all wrong whether the
changeover is tonight or in a year. What changes is only **when** the clash can be created: with a
waiting change that lasts hours rather than months, refusing every hours edit is no longer needed —
refusing the edits that clash is enough (section 3, rule 5).

### Why A755 never let a change touch today

A495 chose "today's business date plus 2" on purpose: "Choosing tomorrow could change today's
ending boundary" (A495 spec `:60`). The owner's model does exactly that, so these readers of
**today's end** now see it move while the day is running:

- the service day's length for opening hours (`serviceDayWallContext`,
  `service-day-context.ts:9-22`, and the clamp in `rangeSpanInDay`,
  `packages/venue-service/src/service-day.ts:128-138`);
- "keep open" extensions, whose latest end is checked against the day's end only when they are
  saved (`packages/venue-service/src/keep-open.ts:38-40`, `:133`);
- attendance (the working-time record) rows, which store a day's start and end
  (`attendanceDayWork`, `packages/workforce/src/schema/attendance.ts:21-30`, written by
  `apps/server/src/attendance-capture.ts:122-146`);
- a station's "closed for today" and the floor's plan for today, both stored against a business
  date (`packages/venue-service/src/schema/station-times.ts:10`,
  `packages/db/src/schema/floor-plans.ts:236`);
- today's report window.

Section 5 says what each needs.

## 3. The new model

1. **One field.** The dialog asks only for the new start. Save applies it at the **next
   changeover**: today's business day ends at the new start on the following calendar date. In the
   code's terms, the change's effective business date is today's business date plus 1.
2. **If that moment has already passed, one changeover later.** That can happen only when Save is
   pressed after midnight and before the old changeover, with a new start earlier than the time now
   (at 01:00 with a 05:00 start, choosing 00:30). Then today's business day ends as planned, at the
   old start, and the **following** day ends at the new start: effective date plus 2. (Question 2.)
3. **The changeover day's length is set by the two times, not by when Save is pressed:** it is
   24 h plus (new start − old start), so between just over 0 h and just under 48 h (daylight-saving
   days aside). Probe (`clock.ts`): 05:00 → 03:00 gives 22 h, 05:00 → 21:00 gives 40 h,
   23:00 → 00:00 gives 1 h and 00:00 → 23:00 gives 47 h.
4. **Saving again replaces.** A second Save before the changeover replaces the waiting change (the
   writer already deletes a waiting row before inserting the new one,
   `business-day-start.ts:263-271`). Saving the start in force while a change waits removes the
   waiting change — that is how a change is undone, so no Cancel button is needed. This replaces
   the `cancel_required` refusal (`:242-245`). Saving the start in force with nothing waiting stays
   a no-op (`:245`).
5. **Opening hours stay editable.** While a change waits, an hours write is refused only if,
   after it, the waiting change would clash: the writer re-runs `businessDayClockConflicts` on the
   rows it has just written (the clock without the waiting change against the clock with it) and
   refuses with the clash named, which rolls the write back. The one-line refusal in the painters is
   drawn in mockup 06.
6. **Save keeps today's checks.** History (`protectHistory`, `business-day-start.ts:145-170`), the
   opening-hours check (`:256-262`), and the daylight-saving check (`candidateFor`, `:128-142`).
   It adds one: a "keep open" extension saved for today that ends after the new changeover is
   listed as a clash, "Kept open until 04:30 tonight".
7. **What you saw is what is saved.** The preview tells the browser the effective date it worked
   out; Save sends that date back with the start, and the server works it out again. If the answer
   moved — Save pressed just as the changeover passed — Save is refused with
   `venue.business_day_invalid`, field `dayCutover`, reason `changeover_passed`, and the dialog
   shows the new preview. No date is ever typed.
8. **Earlier days do not change.** Every date before the changeover keeps its start, because the
   start of a date is read from the change in force on that date (`cutoverAt`,
   `business-day-clock.ts:50-57`). Probe (`clock.ts`, "history kept"): with a later change added,
   Tue 20 Oct still runs 05:00 → 03:00.

### Reading "tomorrow" in the owner's words

At 22:00 the next 03:00 is five hours away, on the next calendar date — "3am tomorrow" by the
calendar, and the end of tonight's business day. The 21:00 example says the same: at 22:00 the next
21:00 is on the next calendar date. Both examples therefore mean rule 1: **the changeover that ends
today's business day moves to the new time.** The only place the words could be read two ways is a
Save made after midnight; rule 2 covers it, and question 2 asks. Question 1 confirms rule 1 itself,
because everything else depends on it.

## 4. Worked examples

All in Madrid, away from the 25 Oct 2026 change of clocks. Save is pressed on **Tuesday 20 Oct
2026 at 22:00**; the start in force is 05:00, so today's business day is Tue 20 Oct. Every row was
checked with `businessDayAt` in the probe `clock.ts`.

### Example 1: 05:00 → 03:00

Takes effect **Wed 21 Oct at 03:00**, five hours after Save.

| A sale at | Business day before | Business day after |
| --- | --- | --- |
| Tue 20, 23:00 | Tue 20 | Tue 20 |
| Wed 21, 02:00 | Tue 20 | Tue 20 |
| Wed 21, 04:00 | Tue 20 | **Wed 21** |
| Wed 21, 13:00 | Wed 21 | Wed 21 |
| Thu 22, 02:00 | Wed 21 | Wed 21 |
| Thu 22, 04:00 | Wed 21 | **Thu 22** |

Tue 20 Oct runs 05:00 → Wed 03:00: **22 h**. Every day after runs 03:00 → 03:00.

### Example 2: 05:00 → 21:00

Takes effect **Wed 21 Oct at 21:00**.

| A sale at | Business day before | Business day after |
| --- | --- | --- |
| Tue 20, 23:00 | Tue 20 | Tue 20 |
| Wed 21, 02:00 | Tue 20 | Tue 20 |
| Wed 21, 04:00 | Tue 20 | Tue 20 |
| Wed 21, 13:00 | Wed 21 | **Tue 20** |
| Wed 21, 22:00 | Wed 21 | Wed 21 |
| Thu 22, 02:00 | Wed 21 | Wed 21 |
| Thu 22, 13:00 | Thu 22 | **Wed 21** |

Tue 20 Oct runs 05:00 → Wed 21:00: **40 h**. From then on a business day runs 21:00 → 21:00 and is
named after the evening it starts on, so **Thursday's lunch is reported under Wednesday** (probe:
with a 21:00 start, Thu 22 Oct 13:00 belongs to Wed 21). In practice this Save is refused for any
venue with daytime hours: every range with an end between 05:00 and 21:00 changes date
(`endpoint_day`, probe 13:00–16:00), and a dinner crossing 21:00 does not fit (`range`, probe
20:00–00:30). Question 3 asks whether evening starts should stay allowed.

### Example 3: Save after midnight, new start already passed

Save at **Wed 21 Oct 01:00** (still Tue 20's business day), 05:00 → 00:30. Wed 21 at 00:30 has
passed, so rule 2 applies: Tue 20 ends at Wed 05:00 as planned; Wed 21 runs 05:00 → Thu 00:30,
**19.5 h**; from Thu 22 the day starts at 00:30.

| A sale at | Business day before | Business day after |
| --- | --- | --- |
| Wed 21, 02:00 | Tue 20 | Tue 20 |
| Wed 21, 13:00 | Wed 21 | Wed 21 |
| Thu 22, 00:45 | Wed 21 | **Thu 22** |
| Thu 22, 04:00 | Wed 21 | **Thu 22** |

### Example 4: two Saves before the changeover

Example 1 is saved at 22:00; at 23:30 the owner saves 04:00 instead. The 03:00 change is replaced.
Tue 20 now runs 05:00 → Wed 04:00, **23 h**; a sale at Wed 03:30 belongs to Tue 20 (it would have
been Wed 21 under 03:00).

### Example 5: undoing

Example 1 is saved at 22:00; at 23:45 the owner saves 05:00. The waiting change is removed and Tue
20 runs 05:00 → 05:00, 24 h, as if nothing had been saved. (A history check still runs: nothing
can have been recorded after 03:00 yet.)

## 5. Edge cases

- **Very short and very long days.** Today nothing limits them beyond "a day must end after it
  starts" (`business-day-clock.ts:88`) and the daylight-saving check. The range is 1 h to 47 h
  (rule 3). A long day keeps a station "closed for today" closed and today's floor plan in place
  until the later changeover; a short day ends them early. Question 4.
- **Daylight saving.** `candidateFor` refuses a change when the old or new start is not exactly one
  real time on the day before, the day of or the day after the changeover
  (`business-day-start.ts:128-142`). Under A755 the owner could pick another date; now there is
  none, so the refusal must say to save again after the clocks change. This is from reading the
  code; no probe was run for it.
- **A daily close for today.** Save is refused if a daily close (the end-of-day "Z" record, which is
  append-only and hash-chained) exists for today or later (`business-day-start.ts:157`, `:167`).
  Kept unchanged. No product path writes a daily close today:
  `grep -rln "recordDailyClose(" apps packages`, test files excluded, finds only its definition and
  `apps/server/scripts/daily-close-z-demo.ts`. When one exists, a day closed before its changeover
  will refuse a start change until the next day.
- **"Keep open" tonight past the new changeover.** Listed as a clash (rule 6), because its limit was
  checked against the old end when it was saved (`keep-open.ts:133`).
- **Attendance.** A day row's stored start and end are refreshed while the day has not been
  evaluated (`apps/server/src/attendance-discovery.ts:526-549`, `:568-582`), and every fact is
  labelled with its business day at the moment it is captured, after the change is committed
  (`attendance-capture.ts:110-121`). No change is planned; the build adds a test that moves
  today's end and evaluates the day.
- **Configuration export** is refused while a change waits
  (`apps/server/src/configuration-transfer.ts:127-130`). Now that lasts at most until the next
  changeover. Kept.
- **The till** works out no boundary itself: `grep` for `dayCutover`, `cutoverChanges` and
  `businessDayAt` in `apps/till/src` finds only display of values the server sends.
- **The card after the changeover.** The panel reads the model when it opens and after a save
  (`venue-details-panel.ts:172`, `:698`); `grep` finds no timer or live subscription in it. The card
  re-reads quietly (a passive read) at the changeover moment so "New start" turns into "Starts at".
- **Starts the venue has had before keep limiting the hours.** Because the editors check every
  start ever saved (`service-day-context.ts:40-44`), once 03:00 has been a start, no normal-week
  range may cross 03:00 again, and no "all day" range can be saved on the normal week. Probe
  (`hours.mts`): 20:00–00:30 is refused after 05:00 → 21:00 → back to 05:00; 05:00–05:00 is refused
  once 03:00 is in the history. Easier changes make this bite sooner. Question 5.
- **The staffing painters read the venue's first start, not today's.** `currentCutover`
  (`packages/staffing/src/paint.ts:139-140`), `paint.ts:341-342`, `routes.ts:165-166`, `rota.ts:56`
  and `month.ts:27` read `clock.dayCutover`, which is the first start
  (`packages/reporting/src/business-day.ts:178`, `:193`). `git blame` dates `currentCutover` to
  `c6a01ad40`, 2026-10-14, before A755 landed (`1d1c76c07`, 2026-10-16). Not part of A788; it
  should be its own backlog entry, because it shows wrongly as soon as any venue changes its start.

### Till, reports and fiscal records

- **Fiscal records.** `grep -rln "businessDay\|dayCutover\|cutover"` over
  `packages/fiscal-verifactu/src`, `packages/fiscal/src` and `packages/core/src`, test files
  excluded, finds nothing: Veri\*Factu records carry their issue time and civil date, not a
  business day, so no filed record is touched or re-read.
- **Daily close.** Its hash covers the business date, not its bounds
  (`packages/reporting/src/daily-close-hash.ts:90`); see the edge case above.
- **Pay-period closures** (workforce) put the whole clock, waiting change included, into their hash
  (`packages/workforce/src/pay-period-chain.ts:120-135`). A closure is a snapshot; a later Save does
  not rewrite it. A755 already lets a waiting change be replaced after a closure copied it, so
  nothing new. `closePayPeriod` has no product caller today
  (`grep -rln closePayPeriod apps packages` lists only the workforce package and
  `apps/server/test/attendance-export-fixture.ts`).
- **Reports.** A report's day is worked out from the bounds when it is read. Days before today keep
  their bounds (rule 8); today keeps every sale already made, because Save is refused if anything is
  recorded at or after the earlier of the two changeover times (`protectHistory`,
  `business-day-start.ts:152-169`).

## 6. What changes

### Server (`apps/server`)

- `business-day-start.ts`: `assertFutureDate` (`:106-111`) becomes "the effective date must be the
  next changeover" (rules 1, 2, 7). `assertEditable` and `locksAt` go (`:90-105`). Saving the start
  in force with a change waiting removes it (`:242-245`). `cancelBusinessDayStart` (`:275-298`)
  and its `DELETE` route (`location-settings-api.ts:216-221`) go. The preview takes only
  `dayCutover` and `expectedClockRevision`, and returns the effective date it chose. A "keep open"
  extension for today past the new changeover is added to the conflict list.
- `venue-detail-types.ts` and `apps/dashboard/src/api/client.ts:116`, `:129`: `pending` loses
  `locksAt` and `editable`.
- Refusal reasons `transition_started`, `cancel_required` and `future_date` go; `changeover_passed`
  is added, with English and Spanish copy.

### Venue service (`packages/venue-service`)

- `assertBusinessDayScheduleWrite` keeps its revision check but no longer refuses because a change
  waits (`business-day-schedule.ts:501-508`). Each of its eight callers (section 2) runs the clash
  check after its write while a change waits, refusing with a new `hours.clock_change_conflict`
  (409, `{ dayCutover, startsAt, conflicts, conflictCount }`). `hours.clock_change_pending` and its
  copy (`dashboard/strings.ts:377`, `:1228`) go; the painters' handling of it moves to the new code
  (`season-painter.ts:549`, `special-day-painter.ts:955`, `:1071`, `season-refusal.ts:38`,
  `period-delete-dialog.ts:106`).
- `BusinessDayScheduleStatus.pending` (`service-day-context.ts:31-37`) loses `locksAt` and
  `editable`.

### Dashboard

- The Business-day card: "Starts at" always; a "New start" row only while a change waits, with the
  changeover moment and the changeover day's length; no "Scheduled change: None" row, no
  "Editable until", no Replace or Cancel (mockups 01, 03, 05).
- The dialog: one field; the preview says when it takes effect and how long today's business day
  will be; clashes listed with the link to Opening hours, Save quiet and disabled while any exist
  (mockups 02, 04). The "I have reviewed the transition" button goes: the preview sits beside Save,
  and the dialog now has one field. This reverses a planner's default from A495, not an owner
  decision (A495 spec `:5`, `:147`).

### Data: no migration

The two tables keep their shape and meaning. `location_day_cutover_changes` holds one row per dated
start (`packages/db/src/schema/business-day-clock.ts:22-42`); a waiting change is still simply a row
whose changeover is in the future, and history rows are still never deleted.
`location_business_day_settings.revision` (`:6-20`) still guards against two editors. A row saved by
A755's form for a later date stays valid and shows as a waiting change until a Save replaces it.

### What stays

The resolver in `@waitron/shared`, every report reader, the history check, the opening-hours
conflict check and its five reasons, the revision guard, the time-zone lock once a change exists
(`apps/server/src/venue-details.ts:101-103`, `:243-245`), the venue-details PATCH refusing a changed
start (`venue-details.ts:206-212`), and the export refusal.

## 7. Text, English and Spanish

| Key | English | Spanish |
| --- | --- | --- |
| `business_day.new_start` (row label) | New start | Nuevo inicio |
| `business_day.new_start_value` | {time}, from {when} | {time}, desde {when} |
| `business_day.day_length` | Business day {day} lasts {hours} h. | El día de trabajo {day} dura {hours} h. |
| `business_day.takes_effect` | Changes at the next changeover: {when}. | Cambia en el próximo cambio de día: {when}. |
| `business_day.today_runs` | Today's business day ({day}) runs {start} → {end}: {hours} h. | El día de trabajo de hoy ({day}) va de {start} a {end}: {hours} h. |
| `business_day.history` (replaces today's) | Earlier reports keep their days. | Los informes anteriores conservan sus días. |
| `business_day.conflicts` (replaces today's) | Opening hours that clash with the new start: | Horarios que chocan con el nuevo inicio: |
| `business_day.conflict_range` (replaces today's) | Crosses the new start | Cruza el nuevo inicio |
| `business_day.conflict_endpoint` (replaces today's) | Moves to another day | Pasa a otro día |
| `business_day.conflict_kept_open` | Kept open until {time} tonight | Abierto hasta las {time} esta noche |
| `venue.business_day_invalid` / `changeover_passed` | That changeover has just passed. Check the new time and save again. | Ese cambio de día acaba de pasar. Revisa la nueva hora y vuelve a guardar. |
| `venue.business_day_invalid` / `clock_transition` | The clocks change around then. Save again after the change. | Cambia la hora oficial en esas fechas. Vuelve a guardar después del cambio. |
| `hours.clock_change_conflict` | {range} clashes with the new business-day start, {time} from {when}. | {range} choca con el nuevo inicio del día, {time} desde {when}. |

Removed: `business_day.scheduled`, `business_day.none`, `business_day.locks`,
`business_day.locked`, `business_day.date`, `business_day.date_invalid`, `business_day.replace`,
`business_day.cancel_pending`, `business_day.acknowledge`, `business_day.transition`, and
`hours.clock_change_pending` (`apps/dashboard/src/i18n/strings.ts:829-854` and `:3760-3786`;
`packages/venue-service/src/dashboard/strings.ts:377`, `:1228`). `{when}` is a weekday, date and
time in the venue's time zone, "Wed 21 Oct, 03:00" / "mié 21 oct, 03:00"; today's dialog formats a
year and a zone name instead (`business-day-start-editor.ts:305-317`).

## 8. Build slices and review path

**Review path: FULL.** Business-day boundaries decide which day a sale and its report belong to
(fiscal-adjacent), the change crosses the venue-service seat and a server route contract, and
rule 7 is a race at the changeover moment. Per-task reviews run on slices 1 and 2; `/finish-branch`
runs its full wave with two Codex run-it reviews.

1. **Server: the next-changeover rule.** Failing tests first, written from section 4: both owner
   examples, the after-midnight case, two Saves, undo by saving the start in force, the
   `changeover_passed` race (Save at the changeover instant), the "keep open" clash, the history
   refusal still biting, the `DELETE` route gone. Then `business-day-start.ts`, the route, the
   model, the error copy.
2. **Venue service: hours stay editable.** Failing tests first: each of the eight writers accepts a
   time edit while a change waits, and refuses one that clashes with `hours.clock_change_conflict`
   naming the range, with nothing written. Then the post-write check, the error code, and the
   painters' refusal line.
3. **Dashboard: card and dialog.** The rows and dialog in mockups 01–05, the strings, the passive
   re-read at the changeover, the unsaved-changes test the dialog already needs. Look at both themes
   and 390 px before the slice is done.
4. **Attendance and docs.** The test that moves today's end and evaluates the attendance day; then
   `docs/developers/conventions-data.md:660`, `:676`, `:1202-1210`, a dated pointer at the head of
   the A495 spec, and the backlog.

If question 5 is answered "yes", it becomes slice 5, after slice 2.

## 9. Questions for the owner, one at a time

### Question 1 of 5 — which changeover does a Save move?

It is 22:00 on Tuesday and the day starts at 05:00. You change it to 03:00.

- **A (recommended).** Tonight's changeover moves: Tuesday's business day ends at 03:00 on
  Wednesday, five hours from now, and lasts 22 h. A sale at 04:00 on Wednesday is Wednesday's.
- **B.** Tonight's changeover stays at 05:00, and the one after moves: Wednesday's business day ends
  at 03:00 on Thursday and lasts 22 h. A sale at 04:00 on Wednesday is still Tuesday's.

A is what "it changes at 3am tomorrow" says, and the 21:00 example says the same. B gives a full
day's notice to the tills and the kitchen, but means "the changeover after next".

### Question 2 of 5 — a Save after midnight, when the new time has already passed

It is 01:00 on Wednesday, still Tuesday's business day, which ends at 05:00. You change the start
to 00:30. Wednesday 00:30 has already passed.

- **A (recommended).** Tuesday's day ends at 05:00 as planned; Wednesday's day runs 05:00 →
  Thursday 00:30 (19.5 h); from Thursday the day starts at 00:30. The card shows "00:30, from Thu
  22 Oct, 00:30" so you see when it takes effect.
- **B.** Refuse: "That time has already passed tonight. Save again after 05:00."

### Question 3 of 5 — evening starts such as 21:00

You change 05:00 to 21:00 at 22:00 on Tuesday. Tuesday's business day lasts 40 h, until Wednesday
21:00. From then on a business day is named after the evening it starts on: Thursday's lunch is in
Wednesday's report. Save is refused while any opening-hours range ends between 05:00 and 21:00,
which for most venues is every lunch and dinner, so all hours would have to be cleared first.

- **A (recommended).** Keep allowing any time, as today. The clash list stops a harmful change, and
  a venue that really trades from evening to evening can use it.
- **B.** Allow only starts from 00:00 to 12:00, so a business day is always named after the date
  most of its trading happens on.

### Question 4 of 5 — very short or very long changeover days

The changeover day lasts 24 h plus the difference between the new and the old start: 05:00 → 03:00
gives 22 h, 23:00 → 00:00 gives 1 h, 00:00 → 23:00 gives 47 h. A 47 h day keeps a station closed
"for today" and today's floor plan in place for 47 h; a 1 h day gets a report of its own.

- **A (recommended).** No limit. A limit would not avoid an odd day, only spread the move over
  several nights, each with its own odd day.
- **B.** Refuse a changeover day shorter than 12 h or longer than 36 h ("Move the start in steps of
  up to 12 hours").

### Question 5 of 5 — old starts keep limiting the opening hours

Your day started at 05:00. You try 21:00 for a week, then go back to 05:00. Today, from then on no
normal-week range may ever cross 21:00 again, so a 20:00–00:30 dinner is refused for good; and once
any change has been made, no "all day" range can be saved on the normal week. This is because the
hours editors check every start the venue has ever had, so that past days still draw correctly in
Opening hours.

- **A (recommended).** Check new hours only against the start in force and a waiting one. Past days
  in the Opening hours calendar draw a range that does not fit their own start cut at that day's
  ends. Built as a fifth slice.
- **B.** Keep it as it is, and leave it as a backlog entry.

## Mockups

In `docs/backlog/mockups/a788-business-day/`, drawn with the repository's tokens
(`packages/ui-core/src/tokens/colors.css`, `structure.css`) from static pages kept outside the
repository (`/Users/clintongormley/waitron-campaign/a788-mockups-src/`); the Business, Venue and
Defaults cards copy A755's mockups.

- `01-card-light.png`, `01-card-dark.png` — nothing waiting.
- `02-change-dialog-light.png` — the dialog, 05:00 → 03:00 at 22:00 on Tuesday.
- `03-waiting-light.png`, `03-waiting-dark.png` — a new start waiting for the changeover.
- `04-clash-light.png`, `04-clash-dark.png` — Save refused by two dinner ranges.
- `05-waiting-phone-light.png` — the waiting card at 390 px.
- `06-hours-refusal-light.png` — an opening-hours painter refusing a clashing edit; only the
  refusal line is new, the painter itself is not redrawn.
