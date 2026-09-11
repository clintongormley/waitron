# Keeping dashboard data current

When you add a dashboard read, subscribe to the data it displays. You should not need to know which
button, background worker or other client will change that data.

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
server installs those declarations as the table owner at trading boot, including on mirrors.

Keep form drafts separate from query snapshots. Update list rows and report values in the observer;
do not call a whole-screen loader that resets a modal or performs a mutation. `DraftRows` helps with
scalar row editors by replacing clean fields while retaining locally edited fields. Structured
editors keep their draft until you save or reopen them.

Use passive requests for automatic refreshes so leaving a dashboard open does not keep its session
alive. `DashboardQueries` handles that distinction for core screens. A module using `request`
directly passes `{ passive: true }` as its fourth argument for background GETs. An interval is still
appropriate when time passing or process-local state can change a query without a database event.
Reusing an already cached query issues no request and therefore does not extend the session.

Test an external identity event with the view already mounted. Check the displayed value and an
unsaved draft, then disconnect the view and confirm later events stop issuing reads. Query and
transport tests cover sharing, reconnect and missed-event recovery; new data dependencies still
need a screen-level behavioral assertion.
