# A10 workforce period reads implementation plan

Managers and workers get the same period totals, roster comparisons and frozen closure records
without loading a year's ordinary clock entries to show one week or month. The
[backlog ask](../../backlog/workforce.md#a10-period-read-cost) requires retaining late answers
and corrections that move work or history across periods. Keep the current event order, record
format and write paths. This change uses the existing indexes and adds no table or index.

1. **Bound the entries that feed period projection.** Add `readPeriodEntries(tx, { period,
   personId? })` beside `readRecordedEntries` in `packages/workforce/src/record-reads.ts`.
   Query the indexed UTC envelope of the local dates using the stored offset limit of ±14 hours.
   Per person, include context from the nearest earlier unretimed direct clock-in through the
   first later unretimed direct clock-in, including every row at either instant. A clock-in resets
   the existing projection even if an earlier shift remains open. An approved replacement means
   the original cannot serve as a reset. Where a reset is absent, keep that side's history. Fetch
   each selected entry's complete same-person correction and response family in both directions,
   regardless of event or recording date. Use the current row mapper, ordering and projection.
   For `readTimeRecord`, also scope to the whole of each intersecting closure, and include its
   frozen entry families for annotations on live rows. Keep each frozen snapshot as saved.
   In `record-reads.test.ts`, keep the late-answer, moved-shift, cross-node, scoped snapshot and
   overnight controls. Add a scoped read of a narrow slice of a longer history and compare the
   full result to the existing projection over the uncut input, including a retimed boundary.
2. **Use the bounded reader in the current product paths.** Replace the summary and actual-side
   reads in `clocking.ts`. Keep the published-roster filter and the comparison in
   `planned-vs-actual.ts`. In `pay-period-close.ts`, use the same slice for both projections and
   keep the automatic-marker eligibility, replay and hash calculation. `pay-period-reads.ts`
   already selects overlapping closures by date and needs no second query or new behavior.
   Run the existing `record-reads.test.ts`, `scheduling.test.ts` and `pay-period-closure.test.ts`
   controls, including late retimes, next-month automatic ends and closed 480 versus live 540.
3. **Keep Hours' independent open and outstanding work.** In `hours-reads.ts`, use bounded
   `readTimeRecord` for the selected period, and a separate event tail from the latest unretimed
   direct clock-in for open work. Load the families of automatic ends that can still appear as
   unacknowledged regardless of date. In `attendance-reads.ts`, share the existing prompt and item
   projection with Hours. Use the active questions, request/response families and their named
   targets to find outstanding work. Load an unresolved question's stored day and families for its
   printed history. Keep full person context when an outstanding request needs the existing
   whole-sequence readiness check. The existing attendance inbox still returns its revision;
   Hours uses only the prompts and items. Keep `hours-reads.test.ts` assertions for old questions,
   disputed and pending changes, unacknowledged ends, open breaks, privacy and frozen totals.
4. **Measure and close.** Seed a year of one worker's daily clock entries, with a narrow week and
   an out-of-window response. Test first with a read-row counter at the query boundary, so the
   old path reports all ordinary history rows and fails, even if the totals match. Run the same
   fixture at the base in a temporary worktree and at the candidate. Record rows loaded, output
   equality and elapsed medians for Hours, summary and comparison reads, and verify closure
   correctness in its database suite. Run changed test files before the branch review. Delete
   the completed entries from `docs/backlog.md` and `docs/backlog/workforce.md`.

Estimate 210–330 production lines and 120–200 test lines. Attendance write validation, general
inbox/manager queue performance, and the A1268-2 write-order change stay outside this work.
