# Dashboard live updates

Implemented on `live-updates`, 2026-09-11; branch validation and review follow the
[implementation plan](../plans/2026-09-11-dashboard-live-updates.md).

When you leave a dashboard open, its displayed lists and reports follow changes made elsewhere.
A completed print updates the printer's last-print time; a newly queued job updates its pending
count. Neither depends on which screen initiated the work.

## Subscriptions follow the data

The event carries resource identities, not business records. The shared browser cache fetches the
current representation through the existing API. Computed values and permission checks stay there.
An identity contains a resource `type` and, for an individual object, an `id`. Collection subscriptions
omit the id, so newly created, removed and changed members invalidate the query too.

`LiveData` shares identical query keys between mounted observers. A key includes every filter and
argument. Queries declare dependencies independently of mutation actions: printer rows depend on
`printers` and `print_jobs`, for example. Several notifications queued together schedule one read;
an event during a read schedules another read afterward. The last observer disconnecting releases
that cache entry and its timer. A late response cannot populate a released entry.

The core dashboard declares dependencies in `apps/dashboard/src/api/live-queries.ts`. Contributed
screens receive the same tab-owned cache through `DashboardModuleContext`; Bookings and Venue
Operations own their query definitions inside their packages. Server module descriptors declare their
own `changes` sources. The root subscription guard checks declared query names against all shipped
server resources; it does not infer missing dependencies from SQL or validate enabled-module subsets.

## Changes come from committed writes

At trading boot the table owner installs a generic PostgreSQL trigger on each declared source.
The trigger emits only the row identity, tenant identity and declared related identities. A print-job
change also identifies its printer. Updates that move a relationship identify both the old and new
parent. An update that changes no values emits nothing.

The trigger uses `NOTIFY`, so rollback discards the notification. `ENABLE ALWAYS` also runs the
trigger when a logical replication worker applies a write on a mirror. A dedicated autocommit
connection listens and reconnects with a delay capped at ten seconds. Initial connection failure
retries independently of HTTP startup. Every successful connection requests a refresh because
notifications missed while disconnected are not replayed.

One authenticated server-sent event connection per tab carries the active subscriptions. The server
filters by tenant and requested identities, checks the session before each delivery and every
fifteen seconds while idle, and closes on expiry, revocation or shutdown. Signed-in venue members
can receive identity hints for declared resources; each API read still applies its own permissions.
A stream holds at most 256 pending identities, replacing an overflowing burst with a reset hint.
The stream is a freshness hint, not durable history or database replication. A browser stream error
refreshes active queries, which also exposes session expiry through the normal API error path. If
the stream is permanently closed, the client retries with exponential delays capped at thirty
seconds; a successful open resets the delay and refreshes missed changes.

The boot-installed generic trigger is outside the migration-text graph guard's scope. Its replicated
behavior is exercised by the two-node change-feed test. Sale-path trigger overhead has not been benchmarked.

## The view stays mounted

`QueryController` applies refreshed snapshots to data fields. It does not rerun a screen's complete
load method or recreate its dialogs. Filters and selections remain owned by the screen. Changing a
query selection releases its former subscription. Modal and structured-editor drafts keep the
snapshot from when you opened them; surrounding lists can continue changing. Scalar row editors
merge clean fields from the server while retaining fields you changed locally. Deleted rows leave
the list; an already open modal retains its draft and its existing API error handling on save.

A failed refresh retains the last successful data and reports an error. Timers provide recovery and
cover changes caused by time or process memory rather than database writes:

| Query | Refresh interval, in addition to database events where applicable |
| --- | --- |
| Overdue orders | 30 seconds |
| Pairing window and discovered printers | 5 seconds |
| Backup status and email inbox | 10 seconds |
| Other observed lists and reports, including recent print jobs | 60 seconds |

The existing discovery scan and paused diagnostics log polling keep their specific timing. These
scheduled reads use the passive request path too.

Automatic reads send `x-waitron-live: 1`. The browser does not count them as human activity, and the
server's request-local context prevents them from touching the management session. Initial screen
requests and explicit mutations retain their normal activity behavior. Mounting a view onto a cached
query issues no request and does not extend the session. Logout, expiry and suspension
stop the connection and clear cached values.

## Verification receipts

- `packages/db/src/change-feed.pg.test.ts` checks commit, rollback, related identities and writes
  under a non-superuser `app_user`, with no business values in the notification.
- `packages/db/src/change-feed-replication.pg.test.ts` copies a row between two real PostgreSQL
  nodes over LAN and WireGuard and observes insert, update and delete notifications from the receiving node, including
  tenant and old/new related printer identities. Without installing the trigger,
  the row arrived but the event assertion failed.
- `packages/db/src/change-listener.test.ts` and `change-feed.pg.test.ts` exercise reconnect,
  malformed messages, failed connections and shutdown races, including terminating a real listener.
- `apps/server/src/print-api.pg.test.ts` enqueues through the printing service and completes the job
  through the agent API. The event stream receives both transitions; API reads change from zero
  pending jobs and no print time, to one pending job, to zero with a print time. Without change-feed
  installation, its event assertion failed.
- Browser screen tests inject identity events independently of UI actions. The printer test also
  checks the visible pending count, print date and preserved unsaved name. Receipt and row-draft
  tests cover preservation of edited fields. Bookings uses the shared module context.
- `apps/server/src/live-api.test.ts` checks authentication, subscription validation, tenant and id
  filters, expiry during idle and active streams, reset, bounded bursts and cleanup.
  Removing the tenant filter fails the collection-subscription test with a distinct foreign row id.
- `packages/identity/src/management-session.test.ts` and dashboard request tests check passive reads
  separately from ordinary session activity. `apps/server/src/boot.test.ts` checks a passive GET,
  an ordinary GET and a POST carrying the passive header through real startup. Disabling the header
  middleware fails the unchanged-session timestamp assertion.

## External provenance

| Source | Source wording | Design consequence |
| --- | --- | --- |
| [PostgreSQL NOTIFY](https://www.postgresql.org/docs/current/sql-notify.html) | “the notifications are not delivered until and unless the transaction is committed” | Notifications are hints about committed changes. A dedicated listener avoids holding a transaction open. The same page warns that exhausting its queue can fail commits; this is not an external delivery service on the sale path. |
| [MDN server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events) | “a one-way connection” | The browser receives hints on one stream and refreshes through existing HTTP reads. |
