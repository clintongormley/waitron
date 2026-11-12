# Keeping dashboard data current

Management (`/management-api/events`) and enrolled devices (`/api/live/events`) use the shared
server loop in `live-stream.ts`. Wake checks read committed session/device state without taking
the write lock or updating activity stamps. Management events carry resource identities; device
events carry resource types only and need no person signed in. Keepalives remain every 15 seconds.

Tills open the device connection after reading their identity and keep it across sign-out. Transfer
interests follow the signed-in person; transfer reads still check that person's access. Menu,
equipment and floor reads refresh on changes and retain their timers because their answers depend
on time or server memory. Transfers keep their timer to detect ended person sessions; table-allergy
timed reads stay quiet while connected and resume when thirty seconds of silence counts the
connection down. Payment-owned equipment changes use the equipment timer, so disabling payments
does not leave a rejected subscription. Handhelds and kitchen displays retain
timed reads under jr11's measured tills-only fallback, including handheld pending-payment reads.
On tills, station and pass screens, clocking, receipt delivery and the open bill draft also refresh
on their declared changes. Kitchen, clocking and delivery timers remain because their answers age
with time. Clocking interests follow the available clocking controller, so workforce-disabled
setups never request workforce resources. Bill drafts quiet their fifteen-second chain while
connected and refresh on reconnect or loss; their draft, bill-family and balance reads use stored
rows. Kitchen event bursts have one read in flight and one queued; their timed reads retain their
independent bounded overlap for recovery.

At a venue with one logical box, the till pauses its five-second primary-server probe while its
device connection is ready and the last probe found a primary. A lost or stopped connection
restores a paused timer and probes immediately. A box last seen unavailable keeps being checked
until it answers as primary. A silent connection counts as lost after thirty seconds.
A list with more than one box keeps probing, including handing the held membership chart to a box
that reports an older term. The list itself updates when the till re-reads its start-up data.

The dashboard treats thirty seconds without an event as a lost connection, re-reads its watched
queries and reconnects with back-off. Keepalives keep the connection alive. Queries marked
`quietWhileConnected` skip timed re-reads while the stream is ready. Only audited database reads
(and values fixed until restart) receive that mark; clock-dependent, in-memory and external reads
keep their timers. New queries keep their timers unless explicitly marked.

Pairing holds, changed printer discovery descriptions, practice-inbox deliveries, archive outcomes
and bucket-copy state transitions publish their own resource changes. Printer scan timers and
invoice-delivery timers remain because their answers also age with time.

When you add a dashboard read, subscribe to the data it displays. You should not need to know which
button, background worker or other client will change that data. "Other client" carries one
condition: a database change reaches the dashboard only when the write went through `withTransaction`
in this server process. What falls outside that, and what it costs, is in `workflow-guide.md` under _The
development stack from a worktree_.

The shared `LiveConnection` owns the document lifecycle. When you leave the document, `pagehide`
closes its stream and pauses the shared cache's queued and timed reads without clearing observers
or snapshots. `pageshow` reconnects; the new stream's `open` refreshes the retained views once.
If the cache has no stream interests, `pageshow` refreshes it directly. A cancelled leave prompt
never reaches `pagehide`, so its views keep receiving updates.

`stop()` clears session data and detaches the lifecycle listeners in a visible document. When you
stop it while the document is away, it retains only the return listener. That listener records the
return and detaches itself without reading or reconnecting. A later explicit `start()` can then
release the cache pause. A stop and start before that return keep both reads and streams paused.

An EventSource error recovery waits one task before refreshing and rechecks its stream and session
generation. The task lets `pagehide` cancel recovery during unload. Keep that delay: the native
Chromium reload regression in `apps/dashboard/test/live-connection-native.test.ts` catches the
error-before-pagehide ordering. `packages/dashboard-kit/src/live-connection.lifecycle.test.ts`
also covers queued reads, timers, cached restoration and a generation change during that wait.

Declare the API method's dependencies in `apps/dashboard/src/api/live-queries.ts`. Include every
source of computed fields: a printer's pending count depends on print jobs, not just its printer
record. Use `DashboardQueries.watch` to assign the resulting snapshot to the screen's data fields.
Its key includes the method arguments, so changing a filter replaces the old subscription. Use
`watchGroup` when a single displayed list combines the same query for several arguments.

A contributed module receives `liveData` alongside `request` in `DashboardModuleContext`. Use
`QueryController` with that shared cache and export `QUERY_DEPENDENCIES` from your module's
`src/dashboard/live-queries.ts`. The root subscription guard checks these names against the shipped
server resources; behavioral tests must still check that your query lists every contributing table. Your server
module's `changes` declaration identifies its tables and any related objects a write affects. The
server installs those declarations at trading boot, including on mirrors.

Keep form drafts separate from query snapshots. Update list rows and report values in the observer;
do not call a loader that resets a modal or performs a mutation. An observer may take one narrow
action a first load would have taken, when the screen still lacks its result: the Backups screen's
status watcher asks for a recovery key at most once, only while the screen has made none, and shares
a key request already in flight, so it never replaces a key the screen made. Its watchers also
refill a form nobody has changed from the latest read (`#openStoredOff` for switched-off stored
settings, `#reopenUnchanged` when the stream's bucket changes), and leave a form holding a change
alone. `DraftRows` helps with
scalar row editors by replacing clean fields while retaining locally edited fields. Structured
editors keep their draft until you save or reopen them, except the opening-hours painters, which take
in stored changes on the days the draft has not changed.

A read error a screen shows must go away once the read succeeds again, for example after the server
restarts. Either clear it in the apply callback (on a screen that shares one field between reads and
actions, clear only a read's message there), or pass `QueryController` (or `DashboardQueries`) a
fourth argument, `recovered(error)`. The controller calls it once every failed read it still watches
has applied a value with no new failure reported while that value applied, passing the last error it
gave the error callback. To tell which read failed, `failing(slot)` answers whether that slot's latest
read, or the apply of its answer, failed: it turns true when one fails and false when a later answer
for the slot starts applying, and an older apply that finishes after a newer read failed leaves it
true. The controller asks the screen to update whenever this answer changes, so a screen need not
request an update itself, even when the error callback receives the code it already shows. A screen that shows a read's and an action's failure in one field remembers
whether the message came from a read (Payments' `#readErrorShown`, set only through
`#showError(code, fromRead)`, `apps/dashboard/src/screens/payments-screen.ts`): `recovered` clears
only a read's message; a reload that runs after a successful action and can finish after another
action failed (the screen's actions are not serialised) clears only a read's message too; and a
read's failure does not replace an action's message, except the period delete dialog's changed-clock
refusal, whose impact the refusal dropped (design-system.md → Periods window). A read an action takes before its write
counts as a read's, and when an action writes and then re-reads, a failure after the write counts
as a read's. A screen whose most recent load stopped before it started its later reads (on opening,
on being reattached, or in the reload after a save) runs the unfinished part again from `recovered`,
and only while that load has not completed. That rerun starts the reads the load never reached and
takes its remaining steps, such as opening the item the page's link names; it performs no mutation.

Cost, before a screen sharing one field remembered which one set it: a recovery that matched the
message's code, or cleared on any successful read, wiped a save's `connection.failed` (A224).

**Historical receipt, 2026-10-06 (Station hours).**

A screen that waits for the change feed to show its own save shows the old data when the stream
the browser holds open delivers nothing, as after a tablet wakes or the Wi-Fi changes: a review
probe on the Hours page reproduced it: the old data stayed, with no error shown, until the page's
60-second timer read again. After a successful write, invalidate through the shared `LiveData`
(`invalidate`) the types the screen's reads depend on. Hours, in `HoursApi.rereadWatches`
(`packages/venue-service/src/dashboard/hours-client.ts`), invalidates every type its read depends
on (`QUERY_DEPENDENCIES.hours`), not only the types the save wrote: every watched query depending
on them reads again through the shared cache. Without live data it has each attached Hours watch
read again itself, so that read is ordered with the watch's timer reads: a timer read that started
before it and answers after it is not applied. The feed's own update
can still arrive and read again; on Hours with the calendar open that measured two passive reads
per save with the feed silent and four with it delivering (2026-10-06).

2026-10-09: A366 slice 4 removes the Station hours page. The shared calendar, Hours client and
its read-ordering tests remain while Opening hours uses the calendar.

2026-10-10: A366 slice 4 Part B removes the legacy Hours client and Calendar mode.
2026-10-13, A506-5: Opening hours Calendar uses `SpecialDaysApi`
(`packages/venue-service/src/dashboard/special-days-client.ts`) and the query dependencies it
names. The Hours read counts above describe the retired page, not the current Calendar.
2026-10-13, A506-6: the Calendar is gone. The Year reads `/opening-hours/year` through
`OpeningHoursApi.watchYear` on the `named-days` dependencies.
2026-10-13, A506-7: the Month reads `/opening-hours/month` through `OpeningHoursApi.watchMonth`
on the `opening-hours-month` dependencies (`packages/venue-service/src/dashboard/live-queries.ts`):
the `named-days` tables plus `zone_service_policies` and `floor_zones`.
2026-10-14, A601: `ModelWatches` (`packages/venue-service/src/dashboard/model-watch.ts`) numbers
each read when it starts. A write's `reread` returns a hold-back point, and this client's watches it
asks to read again then apply no successful read that started before it; with live data, nor does a
watch this client attaches later on any of the types the write named. The season painter takes in
the first model read that started after its save answered, while no other save is in flight, day by
day: a day repainted since the save was sent keeps its new paint (`rebaseDays`,
`packages/venue-service/src/paint-model.ts`).
2026-10-14, A637: every other live update reaching the season painter is taken in day by day too:
a day the draft has not changed takes the stored paint, and a day it changed keeps the draft
(`refresh` and `mayFollow`, `packages/venue-service/src/dashboard/season-painter.ts`). A save in
flight, and the time until the first read that started after the latest successful save answered,
still hold the edited weeks whole.
2026-10-14, A506-11: the Periods page reads `/menu-periods/painted-in` through
`OpeningHoursApi.watchPaintedIn` on the `menu-periods-painted-in` dependencies. Its delete dialog
reads `…/delete-impact` again, passively, when a page read (the hours model or Painted in) that
started after its last impact read answers (`rereadImpact`, `periods-screen.ts`; `nextReadNumber`,
`model-watch.ts`), and after a delete refused as `hours.clock_changed`. The impact answer carries
the clock revision it was read under, and the delete sends that one, so the order the page's reads
answer in decides nothing about the revision sent.
2026-10-14, A506-12: Prep stations' Times tab reads `/opening-hours/month` through
`OpeningHoursApi.watchMonth`, as the Month does, and the station's `…/service-times` through
`watchStationTimes`, on the `routing`, `opening-hours` and `opening-hours-month` dependencies
together.
2026-10-15, A585-3: the page itself is now titled Calendar; "the Calendar" in the A506 lines above
is the old view A506-6 removed. The Calendar's Staffing view reads `/management-api/staffing/month`
through `StaffingApi.watchMonth` on the `staffing-month` dependencies
(`packages/staffing/src/dashboard/live-queries.ts`), which spread venue-service's
`CALENDAR_MONTH_PLAN_READS`.
2026-10-17, A722-3: the Calendar's Month and Week read `/management-api/stations` through
`OpeningHoursApi.watchStations` on the `prep-stations-list` dependencies, and a shown station's
`…/service-times` through `watchStationTimes`, as the Times tab does; a read-only Calendar reads
neither.
2026-10-17, A725: Prep stations' Times tab is retired. Its month, station-change, read-recovery
and reconnect checks now exercise the Calendar in `calendar-station-month.test.ts`; the Calendar
continues to use the watches described in A722-3 above.
2026-10-17, A719: the Periods page is retired. Its list is `periods-list` (`periods-list.ts`) in the
Calendar's Periods window, and reads and re-reads as the A506-11 line above says. When a refreshed
model no longer lists a period that a department still in it listed before, both painters take
that period's blocks out of their draft and their saved state (`removedPeriods`,
`painter-labels.ts`; `withoutPeriods`, `paint-model.ts`). Wherever one of those blocks overlapped
a block of the same period saved on the same day, that stretch takes whatever the stored paint now
holds there — the replacement the delete named, which the server moved the saved blocks to — even
where the draft had split, shortened or lengthened the saved block, and on a day the draft changed
as well as one it did not (`savedBlocks` and `refill`, `paint-model.ts`). The season painter fills
it in from the refreshed model. The special-day painter fills it when its re-read of the stored day
lands (`merge`); Save stays as it would be without the wait. A Save pressed while a stretch still
waits shows the save in progress, asks for a re-read unless one is already out, and sends only
once `merge` has filled it (`fillVacated`). If that re-read fails, the press ends with the
generic refusal beside Save, Save stays enabled, and the stretch keeps waiting for the next press
or the next model the painter is handed (`follow`). A save that was already out when the delete
arrived, and is then refused, asks for the re-read itself. Paint made on the special day before
the re-read lands keeps its stretch, and the fill takes only the rest. The rest of a
deleted-period block, with nothing saved behind it, is dropped.

Use passive requests for automatic refreshes so leaving a dashboard open does not keep its session
alive. `DashboardQueries` handles that distinction for core screens. A module using `request`
directly passes `{ passive: true }` as its fourth argument for background GETs. An interval is still
appropriate when time passing or process-local state can change a query without a database event.
Reusing an already cached query issues no request and therefore does not extend the session.

2026-10-21, A841 slice 3: the shell's venue theme read (`DashboardApi.getVenueTheme`, watched from
`dashboard-app.ts`) sends EVERY read passively, its first included, through
`DashboardApi.background`, unlike `DashboardQueries`' usual active first read. Do not move it back
to the active client. Its reads go through `readVenueTheme` (`packages/ui/src/venue-theme.ts`): the
first after the page's start takes the start-up fetch's answer when that fetch got one, and sends
nothing; the live stream's `open` re-reads every watched query, which is what applies a theme
switched since start-up ("sign-in takes the start-up answer…" in
`apps/dashboard/src/dashboard-app.venue-theme.test.ts`). An answer the read hands in is dropped if a
theme was applied after that read was sent.

Test an external identity event with the view already mounted. Check the displayed value and an
unsaved draft, then disconnect the view and confirm later events stop issuing reads. Query and
transport tests cover sharing, reconnect and missed-event recovery; new data dependencies still
need a screen-level behavioral assertion.
