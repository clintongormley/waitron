# A788: the business day's start changes at the next changeover

**Status:** design, waiting for the owner's answers (questions in section 9, to be asked one at a
time). No product code is changed by this document.

**Inspected base:** `ee59f461c` (main, 2026-10-18). Every `file:line` below is at that commit.
"Probe" means a script or a temporary test that was run on 2026-10-18 on Node v26.11.1 against
that base. Copies are kept outside the repository in
`/Users/clintongormley/waitron-campaign/a788-mockups-src/probe/`. The `.ts` and `.mts` scripts run
with the workspace's `tsx` (`node_modules/.pnpm/node_modules/.bin/tsx <script>`, from the
worktree); plain `node` cannot run them, because the source they import names `./errors.js` for a
file that exists only as `.ts`. The `.test.ts.txt` files are tests that ran beside
`packages/venue-service/src/business-day-schedule.test.ts`, using its `fixture`, with `AI_AGENT`
and `CLAUDECODE` unset. `a788-fix-probe.test.ts.txt` (and `dst.ts`, `backup.ts`, `extremes.ts`)
ran in a throwaway copy of the worktree, `/tmp/a788-fix/clone`, whose `.git` link was removed; in
that copy only, `assertBusinessDayScheduleWrite` was given a switch, `A788_FREEZE_OFF=1`, that skips
its "a change is waiting" refusal, so the real editors could be run as they would behave without
the freeze. Each such test was run with the switch on and off.

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
  The writes that ask: a period's last-orders offset (`menu-timetable.ts:526`), a department's
  weekly hours (`menu-timetable.ts:660`, in `replaceMenuWeek`), deleting a period
  (`period-delete.ts:214`), special days (`special-days.ts:1044`, `:1203`), seasons
  (`seasons.ts:139`), season weeks (`season-weeks.ts:373`) and zone closed times
  (`zone-closed-times.ts:45`). The dialog says so: "Opening hours cannot change while this is
  pending." (`apps/dashboard/src/i18n/strings.ts:838-839`).

So the owner's plan — save a change for next week, then adjust the hours next week to match — is
refused at the second step, for up to 366 days. Staff rota shifts were not blocked: none of the
callers of `assertBusinessDayScheduleWrite` is in `packages/staffing`
(`grep -rn assertBusinessDayScheduleWrite apps packages`, test files excluded, lists only the
venue-service files above and the module seat, `packages/module/src/module.ts:619`).

### Why hours are frozen

Saving a start runs a full check of every opening-hours range in the venue against the change
(`writeBusinessDayStart` → `assertBusinessDayClockChange`, `business-day-start.ts:256-262` →
`businessDayClockConflicts`, `business-day-schedule.ts:58-474`, which reads the ranges itself at
`:65-161`). It refuses a change that would leave a range with one of five problems (`:418-439`).
Each example below is a probe result from `a788-probe.test.ts.txt` or `a788-fix-probe.test.ts.txt`
(05:00 start, one season, every range in one period):

| Reason (code) | What it means | Probed example |
| --- | --- | --- |
| `range` | A day's ranges no longer fit inside one business day under the new start | Dinner 22:00–04:30 with a new 03:00 start → `range` |
| `all_day` | An "all day" range is written start-to-start, so under any other start it means something else | 05:00–05:00 with a new 03:00 start → `all_day` |
| `endpoint_day` | A range's start or end moves to the other calendar date | Lunch 13:00–16:00 with a new 21:00 start → `endpoint_day` ("Wednesday's lunch" would become Thursday's) |
| `sending_cutoff` | Last orders (the period's end offset) would reach the next range | Wednesday 22:00–02:45 with last orders +60, Thursday 03:30–04:30, new 03:00 start → `sending_cutoff` for the Wednesday range (last orders at 03:45 run into Thursday's 03:30, which now starts Thursday's day) and `endpoint_day` for the Thursday range |
| `transition_strip` | A range or its last orders falls between the old and new start on the changeover night | 21:00–02:45 with last orders +30, new 03:00 start → `transition_strip` (last orders at 03:15) |

No conflict was found for 13:00–16:00 → 03:00, 20:00–01:00 → 03:00 or 09:00–17:00 → 07:00.

**One crossing range marks its whole day.** The checker parses a day's ranges together and, if that
fails, gives every range of the day the reason `range` (`business-day-schedule.ts:379-393`, `:420`).
Probe: a day with lunch 13:00–16:00 and dinner 22:00–04:30, 05:00 → 03:00, returned both as
`range`, although lunch alone gives no clash. Section 6 changes this.

The opening-hours editors run a much smaller check before they write: each range must parse
(fit, in order, without overlap) under a set of starts (`scheduleCutovers`,
`packages/venue-service/src/service-day-context.ts:40-44`). The normal week
(`menu-timetable.ts:709`), zone closed times (`zone-closed-times.ts:86`), last-orders offsets
(`period-end-offset.ts:106`) and yearly special days are checked against **every start the venue
has ever had, plus the waiting one**; a one-off special day only against its own date's start
(`special-days.ts:585-588` passes the date; `service-day-context.ts:43`). That catches `range` and
`all_day` but not `endpoint_day`, `sending_cutoff` or `transition_strip`. Probe
(`a788-fix-probe.test.ts.txt`, with the freeze switched off): with 21:00 waiting, the real editor
`replaceMenuWeek` **accepted** a Wednesday 13:00–16:00 week, and the Save check then reported that
range as `endpoint_day`; with 03:00 waiting it accepted a Saturday 21:00–02:45 week with last orders
+30, then reported `transition_strip`. With the freeze on, both writes were refused with
`hours.clock_change_pending`. A Saturday 21:00–04:30 week with 03:00 waiting was refused before any
write, freeze on or off, with `menu_timetable.invalid`, reason `order` — the editors' own check.

So the freeze exists because the Save check runs once, at Save. Without the freeze an hours edit
made afterwards could create exactly the clash the Save check refused, and nothing would look again
before the changeover. A495's design says so: "Time-related schedule editing is paused while a
change is pending; edit hours first, or cancel the pending change"
(`docs/superpowers/specs/2026-10-11-a495-business-day-history-design.md:62`, `:104`).

### Which of those checks still bite if the change applies at the next changeover

All five. Each is about the boundary moving, not about how far ahead the date is: a range that
crosses the new start, an all-day range, a range whose end changes date, last orders reaching the
next range, and hours inside the strip between the two starts are all wrong whether the changeover
is tonight or in a year. What changes is only **when** the clash can be created: with a waiting
change that lasts hours rather than months, refusing every hours edit is no longer needed —
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
- the automatic backups: the `"auto"` schedule fires 30 minutes plus 0–10 minutes of jitter after a
  day's start (`nextFireMs`, `apps/server/src/backup-schedule.ts:8`, `:11`, `:59-90`), the archive
  sweep fixes that moment once per cycle and does not recompute it while it waits
  (`backup-sweep.ts:271-288`), and the cloud snapshot worker saves its next moment the same way
  (`cloud-snapshot-worker.ts:185-186`, `:199-206`);
- today's report window.

Section 5 says what each needs.

## 3. The new model

1. **One field; Save moves the changeover that ends today's business day.** This is decided by
   the owner's own example — "So it is 10pm I change it from 5am to 3am, it changes at 3am
   tomorrow" — and the 21:00 example says the same: at 22:00 the next 21:00 is on the next calendar
   date. Today's business day ends at the new start on the following calendar date; in the code's
   terms, the change's effective business date is today's business date plus 1. (Owner: if this
   misreads you and you meant the changeover after that, say so; nothing below would change except
   that every example moves a day later.)
2. **If that moment has already passed, one changeover later.** That can happen only when Save is
   pressed after midnight and before the old changeover, with a new start earlier than the time now
   (at 01:00 with a 05:00 start, choosing 00:30). Then today's business day ends as planned, at the
   old start, and the **following** day ends at the new start: effective date plus 2. (Question 3.)
3. **The changeover day's length is set by the two times, not by when Save is pressed:** it is
   24 h plus (new start − old start), so between 1 minute and 47 h 59 min, because a start can be
   any minute (`business-day-clock.ts:28`; `business-day-start.ts:60`), daylight-saving days aside.
   Probes (`clock.ts`, `extremes.ts`): 05:00 → 03:00 gives 22 h, 05:00 → 21:00 gives 40 h,
   23:59 → 00:00 gives 1 minute and 00:00 → 23:59 gives 2879 minutes. The 1-minute day is reachable
   through rule 2: with a 23:59 start, saving 00:00 at 10:00 on Wed 21 Oct finds Wed 00:00 already
   passed, and Wed 21 Oct then lasts 1 minute.
4. **Saving again replaces.** A second Save before the changeover replaces the waiting change (the
   writer already deletes a waiting row before inserting the new one,
   `business-day-start.ts:263-271`). Saving the start in force while a change waits removes the
   waiting change — that is how a change is undone, so no Cancel button is needed. This replaces
   the `cancel_required` refusal (`:242-245`). Saving the start in force with nothing waiting stays
   a no-op (`:245`).
5. **Opening hours stay editable.** While a change waits, an hours write is refused only if it
   would clash with the waiting start, with one message, `hours.clock_change_conflict`, naming the
   range (mockup 06):
   - a range that does not fit under the waiting start (`range`, `all_day`) is caught by the
     editors' own check before the write (section 2). That check is split: the starts in force and
     in the past keep today's refusal, and a failure under the waiting start alone becomes
     `hours.clock_change_conflict`, instead of today's vague "Check this day's time ranges and
     periods." (`painter-labels.ts:71`, `dashboard/strings.ts:156`);
   - a range that fits but would move date, run its last orders into the next range or sit in the
     strip (`endpoint_day`, `sending_cutoff`, `transition_strip`) is caught after the write: the
     writer re-runs the venue-wide check, `businessDayClockConflicts` (the clock without the waiting
     change against the clock with it), and a clash rolls the write back.
   The check after the write reads every range in the venue, so a clash left by some path that is
   not one of the eight guarded writers would be named on an unrelated edit; the message names the
   clashing range so the person can see which one.
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

### "Tomorrow" in the owner's words

At 22:00 the next 03:00 is five hours away, on the next calendar date — "3am tomorrow" by the
calendar, and the end of tonight's business day. Read that way both of the owner's examples mean
rule 1. The only place the words could be read two ways is a Save made after midnight, when "3am
tomorrow" by the calendar is a day later than the next 03:00; rule 2 covers it, and question 3
asks.

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

Tue 20 Oct runs 05:00 → Wed 03:00: **22 h**. Every day after runs 03:00 → 03:00. A venue whose
Friday and Saturday dinners run to 04:00 and 04:30 cannot save this until those dinners end by
03:00 (mockup 04; probe "mockup 04": both returned `range`).

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
with a 21:00 start, Thu 22 Oct 13:00 belongs to Wed 21). Save is refused while any range starts or
ends between 05:00 and 21:00 (`endpoint_day`, `business-day-schedule.ts:421-425`) or runs across
21:00 (`range`): for most venues every lunch and most dinners. Probes: lunch 13:00–16:00 →
`endpoint_day`; dinners 20:00–23:30 and 20:00–00:30 → `range`; 21:30–23:30 and 02:00–04:00 → no
clash. Question 1 asks whether evening starts should stay allowed.

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
  starts" (`business-day-clock.ts:88`) and the daylight-saving check. The range is 1 minute to
  47 h 59 min (rule 3). A long day keeps a station "closed for today" closed and today's floor plan
  in place until the later changeover; a short day ends them early. Question 2.
- **Daylight saving.** `candidateFor` refuses a change when the old or new start does not happen
  exactly once on the day before, the day of or the day after the changeover
  (`business-day-start.ts:128-142`). Under rule 1 that refuses Saves during **three** business days.
  Probe (`dst.ts`): 05:00 → 02:30 is refused for Saves during the business days of 23, 24 and
  25 Oct 2026 and allowed from 26 Oct; 02:30 → 05:00 and 05:00 → 02:00 give the same window;
  05:00 → 02:30 in spring is refused during 26, 27 and 28 Mar 2027 and allowed from 29 Mar;
  05:00 → 03:00 is never refused. So "save again after the change" would send the owner into a
  second refusal on the day the clocks change. The refusal instead names the first moment a Save
  will work, worked out by trying the following business days with the same rule and the same
  three-day check, and gives it as the start of that business day: "The clocks change on Sun
  25 Oct. Save again from Mon 26 Oct, 05:00." (`dst.ts`: business day 26 Oct starts Mon 26 Oct,
  05:00 under a 05:00 start, and Mon 26 Oct, 02:30 under a 02:30 start.) Only starts inside the
  hour the clocks skip or repeat are affected; in Madrid that is 02:00–02:59.
- **A daily close for today.** Save is refused if a daily close (the end-of-day "Z" record, which is
  append-only and hash-chained) exists for the day before the effective date or later
  (`business-day-start.ts:152`, `:157`, `:167`); under rule 1 that day is today. Kept unchanged.
  No product path writes a daily close today: `grep -rln "recordDailyClose(" apps packages`, test
  files excluded, finds only its definition and `apps/server/scripts/daily-close-z-demo.ts`.
- **"Keep open" tonight past the new changeover.** Listed as a clash (rule 6), because its limit was
  checked against the old end when it was saved (`keep-open.ts:133`).
- **Attendance.** A day row's stored start and end are refreshed while the day has not been
  evaluated (`apps/server/src/attendance-discovery.ts:526-549`, `:568-582`), and every fact is
  labelled with its business day at the moment it is captured, after the change is committed
  (`attendance-capture.ts:110-121`). No change is planned; the build adds a test that moves
  today's end and evaluates the day.
- **Tonight's automatic backup keeps its old time.** It was timed when the previous one fired, and
  is not recomputed while it waits (`backup-sweep.ts:284-288`). Probe (`backup.ts`, 05:00 start,
  fixed seed): the moment computed on Tuesday after the morning backup is Wed 21 Oct 05:33.
  - 05:00 → 03:00: it still fires at Wed 05:33, two and a half hours after the new changeover; the
    next is computed as Thu 22 Oct 03:33.
  - 05:00 → 21:00: it fires at Wed 05:33 while Tuesday's 40-hour business day is still running,
    and the next is computed as Wed 21 Oct 21:33, so the changeover day gets two backups.
  Accepted: every backup still happens, and the one that fires early only copies a day that is not
  finished yet; the next one copies it finished. Recomputing the waiting moment after a Save would
  mean waking the sweep from the business-day writer, and the sweep deliberately never recomputes
  while it waits (`backup-sweep.ts:284-286`: an interval schedule would be pushed out on every
  wake). The cloud snapshot worker keeps its saved moment
  the same way (`cloud-snapshot-worker.ts:185-186`); the same reasoning applies, but it was not
  probed. The preview's `backupDeadlines` stays `{ archive: null, cloud: null }`
  (`business-day-start.ts:212`) and the card shows no backup time.
- **Configuration export** is refused while a change waits
  (`apps/server/src/configuration-transfer.ts:127-130`). With a change saved through the new
  dialog that lasts at most until the next changeover or the one after; a change already saved with
  A755's date form can still wait up to 366 days (`business-day-start.ts:108`). Kept.
- **The till** works out no boundary itself: `grep` for `dayCutover`, `cutoverChanges` and
  `businessDayAt` in `apps/till/src` finds only display of values the server sends.
- **The card after the changeover.** The panel reads the model when it opens and after a save
  (`venue-details-panel.ts:172`, `:698`); `grep` finds no timer or live subscription in it. The card
  re-reads quietly (a passive read) at the changeover moment so "New start" turns into "Starts at".
- **Starts the venue has had before keep limiting the hours.** Because the normal week is checked
  against every start ever saved (`service-day-context.ts:40-44`), once 03:00 has been a start, no
  normal-week range may cross 03:00 again, and no "all day" range can be saved on the normal week.
  Probe (`hours.mts`, which calls the parse function the editors use): 20:00–00:30 is refused after
  05:00 → 21:00 → back to 05:00; 05:00–05:00 is refused once 03:00 is in the history. Easier changes
  make this bite sooner. Question 4.
- **The staffing painters read the venue's first start, not today's.** `currentCutover`
  (`packages/staffing/src/paint.ts:139-140`), `paint.ts:341-342`, `routes.ts:165-166`, `rota.ts:56`
  and `month.ts:27` read `clock.dayCutover`, which is the first start
  (`packages/reporting/src/business-day.ts:178`, `:193`). `git blame` dates `currentCutover` to
  `c6a01ad40`, 2026-10-14. Dated start changes and the resolver that reads them had already landed
  on 2026-10-12 (`c373162e2`, #1563), and A755's card followed on 2026-10-16 (`1d1c76c07`). Not part
  of A788; it should be its own backlog entry, because it shows wrongly as soon as any venue changes
  its start.

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
  extension for today past the new changeover is added to the conflict list. The `clock_transition`
  refusal carries the date the clocks change and the first moment a Save will work.
- `venue-detail-types.ts` and `apps/dashboard/src/api/client.ts:116`, `:129`: `pending` loses
  `locksAt` and `editable`.
- Refusal reasons `transition_started`, `cancel_required` and `future_date` go; `changeover_passed`
  is added, with English and Spanish copy.

### Venue service (`packages/venue-service`)

- `businessDayClockConflicts` names only the ranges that fail. When a day's ranges do not parse
  together, each range is parsed on its own under the old and new start; a range that fails alone
  gets `range` ("Crosses the new start"), and the others on that day are not listed. Only when no
  range fails alone — overlapping rows no writer accepts, which the existing case "rejects
  overlapping raw ranges" (`business-day-schedule.test.ts:396-409`) stores directly — is every range
  of the day marked, with a new reason `overlap` and today's label "Invalid or overlapping range".
  Probe (`a788-fix-probe.test.ts.txt`, "per-range parse"): under 03:00, 13:00–16:00 alone parses
  and 22:00–04:30 alone is refused with reason `order`. Chosen over relabelling the whole day
  because the owner has to know which range to change.
- `assertBusinessDayScheduleWrite` keeps its revision check but no longer refuses because a change
  waits (`business-day-schedule.ts:501-508`). The editors' parse check runs the waiting start
  separately, and each of the eight callers (section 2) runs the clash check after its write while
  a change waits; both refuse with a new `hours.clock_change_conflict` (409,
  `{ dayCutover, startsAt, conflicts, conflictCount }`). `hours.clock_change_pending` and its copy
  (`dashboard/strings.ts:377`, `:1228`) go; the painters' handling of it moves to the new code
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
  (mockups 02, 04). The lines keep today's shape, season first
  (`business-day-start-editor.ts:347-361`). The "I have reviewed the transition" button goes: the
  preview sits beside Save, and the dialog now has one field. This reverses a planner's default from
  A495, not an owner decision (A495 spec `:5`, `:147`).

### Data: no migration

The two tables keep their shape and meaning. `location_day_cutover_changes` holds one row per dated
start (`packages/db/src/schema/business-day-clock.ts:22-42`); a waiting change is still simply a row
whose changeover is in the future, and history rows are still never deleted.
`location_business_day_settings.revision` (`:6-20`) still guards against two editors. A row saved by
A755's form for a later date stays valid and shows as a waiting change until a Save replaces it.

### What stays

The resolver in `@waitron/shared`, every report reader, the history check, the opening-hours
conflict check and its five reasons (with `range` narrowed to the ranges that fail), the revision
guard, the time-zone lock once a change exists (`apps/server/src/venue-details.ts:101-103`,
`:243-245`), the venue-details PATCH refusing a changed start (`venue-details.ts:206-212`), the
backup timing, and the export refusal.

## 7. Text, English and Spanish

Spanish uses "día de trabajo" throughout, as the card heading and dialog title already do
(`apps/dashboard/src/i18n/strings.ts:3760`, `:3853`); the field label, today "El día de actividad
empieza a las" (`:3794`), changes to match.

| Key | English | Spanish |
| --- | --- | --- |
| `venue_details.dayCutover` (Spanish only changes) | Business day starts at | El día de trabajo empieza a las |
| `business_day.new_start` (row label) | New start | Nuevo inicio |
| `business_day.new_start_value` | {time}, from {when} | {time}, desde {when} |
| `business_day.day_length` | Business day {day} lasts {hours} h. | El día de trabajo {day} dura {hours} h. |
| `business_day.takes_effect` | Changes at the next changeover: {when}. | Cambia en el próximo cambio de día: {when}. |
| `business_day.today_runs` | Today's business day ({day}) runs {start} → {end}: {hours} h. | El día de trabajo de hoy ({day}) va de {start} a {end}: {hours} h. |
| `business_day.history` (replaces today's) | Earlier reports keep their days. | Los informes anteriores conservan sus días. |
| `business_day.conflicts` (replaces today's) | Opening hours that clash with the new start: | Horarios que chocan con el nuevo inicio: |
| `business_day.conflict_range` (replaces today's) | Crosses the new start | Cruza el nuevo inicio |
| `business_day.conflict_overlap` (today's `conflict_range` text) | Invalid or overlapping range | Tramo inválido o solapado |
| `business_day.conflict_endpoint` (replaces today's) | Moves to another day | Pasa a otro día |
| `business_day.conflict_kept_open` | Kept open until {time} tonight | Abierto hasta las {time} esta noche |
| `venue.business_day_invalid` / `changeover_passed` | That changeover has just passed. Check the new time and save again. | Ese cambio de día acaba de pasar. Revisa la nueva hora y vuelve a guardar. |
| `venue.business_day_invalid` / `clock_transition` | The clocks change on {date}. Save again from {when}. | La hora oficial cambia el {date}. Vuelve a guardar desde {when}. |
| `hours.clock_change_conflict` | {range} clashes with the new business-day start, {time} from {when}: {reason}. | {range} choca con el nuevo inicio del día de trabajo, {time} desde {when}: {reason}. |

`{reason}` is one of the conflict labels above, or today's `business_day.conflict_all_day`,
`conflict_sending` or `conflict_strip` (`apps/dashboard/src/i18n/strings.ts:844-846`). Removed:
`business_day.scheduled`, `business_day.none`, `business_day.locks`, `business_day.locked`,
`business_day.date`, `business_day.date_invalid`, `business_day.replace`,
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
   refusal still biting, the `DELETE` route gone, a Save during the business day the clocks change
   refused with the first working moment named, and the automatic backup moment before and after a
   Save (section 5). Then `business-day-start.ts`, the route, the model, the error copy.
2. **Venue service: hours stay editable, and clashes name their range.** Failing tests first: a day
   with lunch 13:00–16:00 and dinner 22:00–04:30, 05:00 → 03:00, lists only the dinner; the
   overlapping-rows case still marks both; each of the eight writers accepts a time edit while a
   change waits, and refuses one that clashes with `hours.clock_change_conflict` naming the range,
   with nothing written — one case before the write (a range that crosses the waiting start) and one
   after it (the `transition_strip` case of mockup 06). Then the checker change, the split parse
   check, the post-write check, the error code, and the painters' refusal line.
3. **Dashboard: card and dialog.** The rows and dialog in mockups 01–05, the strings, the passive
   re-read at the changeover, the unsaved-changes test the dialog already needs. Look at both themes
   and 390 px before the slice is done.
4. **Attendance and docs.** The test that moves today's end and evaluates the attendance day; then
   `docs/developers/conventions-data.md:660`, `:676`, `:1202-1210`, a dated pointer at the head of
   the A495 spec, and the backlog.

If question 4 is answered "yes", it becomes slice 5, after slice 2.

## 9. Questions for the owner, one at a time

Rule 1 (which changeover a Save moves) is decided from the owner's own example and is not asked.
The first question is the one the next depends on: limiting starts to the morning would also cap
how short or long a changeover day can be.

### Question 1 of 4 — evening starts such as 21:00

At 22:00 on Tuesday you change 05:00 to 21:00. Tuesday's business day lasts 40 h, until Wednesday
21:00. From then on a business day is named after the evening it starts on: Thursday's lunch is in
Wednesday's report. Save is refused while any opening-hours range starts or ends between 05:00 and
21:00, or runs across 21:00 — for most venues every lunch and most dinners — so those hours would
have to be changed first; hours such as 21:30–23:30 or 02:00–04:00 could stay as they are.

- **A (recommended).** Keep allowing any time, as today. The clash list stops a harmful change, and
  a venue that really trades from evening to evening can use it.
- **B.** Allow only starts from 00:00 to 12:00, so a business day is always named after the date
  most of its trading happens on. This takes back the "9pm" in your own example.

### Question 2 of 4 — very short or very long changeover days

The changeover day lasts 24 h plus the difference between the new and the old start: 05:00 → 03:00
gives 22 h. At the extremes, 23:59 → 00:00 gives a day of **1 minute** and 00:00 → 23:59 gives
**47 h 59 min**. A 47-hour day keeps a station closed "for today" and today's floor plan in place
that long; a 1-minute day gets a report of its own. (If question 1 was answered B, starts between
00:00 and 12:00 already keep every changeover day between 12 h and 36 h.)

- **A (recommended).** No limit. A limit would not avoid an odd day, only spread the move over
  several nights, each with its own odd day.
- **B.** Refuse a changeover day shorter than 12 h or longer than 36 h ("Move the start in steps of
  up to 12 hours").

### Question 3 of 4 — a Save after midnight, when the new time has already passed

It is 01:00 on Wednesday, still Tuesday's business day, which ends at 05:00. You change the start
to 00:30. Wednesday 00:30 has already passed.

- **A (recommended).** Tuesday's day ends at 05:00 as planned; Wednesday's day runs 05:00 →
  Thursday 00:30 (19.5 h); from Thursday the day starts at 00:30. The card shows "00:30, from Thu
  22 Oct, 00:30" so you see when it takes effect.
- **B.** Refuse: "That time has already passed tonight. Save again after 05:00."

### Question 4 of 4 — old starts keep limiting the opening hours

Your day started at 05:00. You try 21:00 for a week, then go back to 05:00. Today, from then on no
normal-week range may ever cross 21:00 again, so a 20:00–00:30 dinner is refused for good; and once
any change has been made, no "all day" range can be saved on the normal week. This is because the
hours editors check every start the venue has ever had, so that past days still draw correctly in
Opening hours. This is true today, with or without A788.

- **A (recommended).** Check new hours only against the start in force and a waiting one. Past days
  in the Opening hours calendar draw a range that does not fit their own start cut at that day's
  ends. Built as a fifth slice.
- **B.** Keep it as it is, and leave it as a backlog entry.

## Mockups

In `docs/backlog/mockups/a788-business-day/`, drawn with the repository's tokens
(`packages/ui-core/src/tokens/colors.css`, `structure.css`) from static pages kept outside the
repository (`/Users/clintongormley/waitron-campaign/a788-mockups-src/`); the Business, Venue and
Defaults cards copy A755's mockups. Department, period and season names are examples; the probes
used a fixture's own names.

- `01-card-light.png`, `01-card-dark.png` — nothing waiting.
- `02-change-dialog-light.png` — the dialog, 05:00 → 03:00 at 22:00 on Tuesday.
- `03-waiting-light.png`, `03-waiting-dark.png` — a new start waiting for the changeover.
- `04-clash-light.png`, `04-clash-dark.png` — Save refused by Friday 21:00–04:00 and Saturday
  21:00–04:30 dinners, the input of probe "mockup 04" (both `range`).
- `05-waiting-phone-light.png` — the waiting card at 390 px.
- `06-hours-refusal-light.png` — an opening-hours painter refusing a Saturday dinner 21:00–02:45
  with last orders +30 while 03:00 waits, the input of probe "editor, 03:00 waiting, Sat
  21:00–02:45 +30" (accepted by the editor, then `transition_strip`); only the refusal line is new,
  the painter itself is not redrawn.
