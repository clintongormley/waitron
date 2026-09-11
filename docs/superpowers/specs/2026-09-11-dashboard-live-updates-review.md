# Dashboard live updates review

Claude reviewed `9c026bf3..4254ae2f` in an independent temporary clone. The run took 247 seconds;
the retained report and usage receipt are under `/tmp/waitron-live-review.Xruni3/` on the development
host. This note records decisions rather than treating every review assertion as verified.

## Accepted and corrected

- The original tenant-filter test published the same identity from two tenants, so deduplication
  concealed a missing filter. The replacement collection test uses a distinct foreign identity.
  Deleting the filter now fails that assertion; restoring it passes.
- A permanently closed browser event stream needed explicit recovery. A failing fake-clock test
  now passes with refresh-on-error, exponential reopening and cancellation on logout.
- The passive-read header needed coverage through server startup. The boot test checks unchanged
  session timestamps for passive GETs and changed timestamps for ordinary GETs and POSTs. Disabling
  the middleware fails the passive timestamp assertion; the restored boot and stream suites pass
  56 tests.
- Query names and server resource declarations needed a root guard. Removing the workforce change
  sources makes that guard fail. SQL inspection also found missing dependencies for overdue orders,
  sales reports and planned-versus-actual; five event-driven refresh cases failed before correction
  and pass afterward.
- The cache key and draft merger assumptions are now documented: observers sharing a key share one
  read contract; row drafts are seeded before editing, and missing server rows are removed.

## Findings not taken as defects

- The claim that replicated deletes lose tenant and related identities did not reproduce. The
  two-node PostgreSQL test now checks insert, update and delete notifications from the subscriber
  over both LAN and WireGuard,
  including tenant and old/new printer identities, and passes.
- A cached view issues no request and therefore does not extend a session. That is the chosen
  behavior; a cache hit is not server activity. Automatic refreshes remain passive.
- The background-client fallback supports existing screen test doubles. The module clients carry
  no mutable per-request state requiring memoization. No allocation optimization was added.
- The early released-entry guard also prevents replacing its stored snapshot. It stays alongside
  the later notification guard; deleting one while another assertion remains green is not itself
  a behavioral defect.

## Explicit limits

The migration graph guard reads migration text, so it does not inspect the generic trigger installed
at boot. The two-node test covers that trigger's replication behavior. Sale-path trigger overhead
has not been benchmarked. The subscription-name guard checks shipped names, not SQL completeness
or every enabled-module combination; behavior tests remain necessary for new query dependencies.
