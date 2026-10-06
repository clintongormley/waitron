# Keeping dashboard data current

When you add a dashboard read, subscribe to the data it displays. You should not need to know which
button, background worker or other client will change that data. "Other client" carries one
condition: a change reaches the dashboard only when the write went through `withTransaction` in this
server process. What falls outside that, and what it costs, is in `workflow-guide.md` under _The
development stack from a worktree_.

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
a key request already in flight, so it never replaces a key the screen made. `DraftRows` helps with
scalar row editors by replacing clean fields while retaining locally edited fields. Structured
editors keep their draft until you save or reopen them.

A read error a screen shows must go away once the read succeeds again, for example after the server
restarts. Either clear it in the apply callback (on a screen that shares one field between reads and
actions, clear only a read's message there), or pass `QueryController` (or `DashboardQueries`) a
fourth argument, `recovered(error)`. The controller calls it once every failed read it still watches
has applied a value with no new failure reported while that value applied, passing the last error it
gave the error callback. A screen that shows a read's and an action's failure in one field remembers
whether the message came from a read (Payments' `#readErrorShown`, set only through
`#showError(code, fromRead)`, `apps/dashboard/src/screens/payments-screen.ts`): `recovered` clears
only a read's message; a reload that runs after a successful action and can finish after another
action failed (the screen's actions are not serialised) clears only a read's message too; and a
read's failure does not replace an action's message. A read an action takes before its write
counts as a read's, and when an action writes and then re-reads, a failure after the write counts
as a read's. A screen whose most recent load stopped before it started its later reads (on opening,
on being reattached, or in the reload after a save) runs the unfinished part again from `recovered`,
and only while that load has not completed. That rerun starts the reads the load never reached and
takes its remaining steps, such as opening the item the page's link names; it performs no mutation.

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

Use passive requests for automatic refreshes so leaving a dashboard open does not keep its session
alive. `DashboardQueries` handles that distinction for core screens. A module using `request`
directly passes `{ passive: true }` as its fourth argument for background GETs. An interval is still
appropriate when time passing or process-local state can change a query without a database event.
Reusing an already cached query issues no request and therefore does not extend the session.

Test an external identity event with the view already mounted. Check the displayed value and an
unsaved draft, then disconnect the view and confirm later events stop issuing reads. Query and
transport tests cover sharing, reconnect and missed-event recovery; new data dependencies still
need a screen-level behavioral assertion.
