# A10 workforce period reads implementation plan

A week or month reads a slice of clock history for totals, roster comparisons, records and
pay-period closure. Hours loads the full history once for outstanding work, down from four
reads. Totals, open work, corrections and frozen records keep their current meaning. The
backlog ask (the former "A10 period read cost" entry) requires late answers and
corrections across period boundaries. Keep event order, storage and write paths. Claude reviewed
the plan and the watcher cleared it with the refinements below (Lane I questions.md, 23:42).

1. **Read the period and its pairing context.** Add `readPeriodEntries(tx, { period, personId? })`
   in `packages/workforce/src/record-reads.ts`. Use `(person_id, event_at)` and the stored ±14-hour
   offset limit to seed the local-date window. For venue reads, take ids from `persons` and
   search each person with `indexed by time_entries_person_event_idx`. For each person, extend to the last earlier and
   first later unretimed direct clock-in, with all ties at both instants. An approved replacement
   disqualifies a reset. If there is no reset on a side, keep that side's context. Follow parent
   ids directly, retime children by `corrects_entry_id`, and response children by person and
   the parent's event instant. Correction decisions, worker confirmations and closure markers
   all copy that instant. Keep the existing mapper and projection. This cut depends on
   `compareEvents`. A1268-2 must revisit it if clock pairing moves to write order.
   In `record-reads.test.ts`, compare with the full projection for a pending retime at a reset,
   an out after an in at the same instant, and a sole earlier in retimed across the boundary.
   Keep the late-answer, cross-node and overnight assertions. Check the copied-time invariant
   through the decision and confirmation writers in their existing cases.
2. **Use that slice in the existing callers.** `readTimeRecord` includes the whole period of every
   overlapping closure for the live comparison. It uses the stored snapshots as before, and
   only loads live families selected by the normal window/context rule. `clocking.ts` uses the
   slice in `workSummary` and `getPlannedVsActual`. `pay-period-close.ts` uses it for both
   projections, preserving marker eligibility, replay and hashing. `planned-vs-actual.ts` and
   `pay-period-reads.ts` keep their existing logic, including whole stored snapshots for each
   overlapping closure. Run `record-reads.test.ts`, `clocking.test.ts`, `scheduling.test.ts`,
   `pay-period-closure.test.ts` and `attendance-reads.test.ts`. Compare a closure's snapshot,
   hash and marker ids with the full read across prior and later history, an automatic end
   at the edge and a correction across the period boundary.
3. **Read Hours' outstanding work once.** `hours-reads.ts` keeps its one full person read for
   open shifts, unconfirmed automatic ends and the existing pending item readiness check. Pass
   those entries to the existing prompt/item projection in `attendance-reads.ts`. Only the actual
   inbox reader computes its revision. Hours uses the bounded `readTimeRecord` for the period.
   Keep the existing `hours-reads.test.ts` assertions on open breaks, old pending work, privacy
   and frozen history. Bounding open and outstanding work remains separate.
4. **Measure on a year of history.** In `record-read-budget.test.ts`, reuse `timeRows` to count
   SQLite results, including reads using a CTE. Seed 730 daily entries plus a late request and
   answer for the selected week. Before the change, expect summary and venue comparison to fail
   at 732 and 748 rows against 48, respectively, and Hours at 2,928 rows against 780. Keep the existing eight-row person-scope assertion. Run the same fixture on
   the base in a throwaway worktree and on the candidate. Record counts, equal output and elapsed
   medians. On `node:26-slim` expect `SEARCH seed USING INDEX time_entries_person_event_idx
   (person_id=? AND event_at>? AND event_at<?)` (or COVERING). A `SCAN seed` fails. Run all changed
   tests. Remove the completed period-read entry from `docs/backlog.md`
   and `docs/backlog/workforce.md`, keeping a pointer to the remaining Hours history read.

Estimate 150–220 production lines and 150–230 test lines. No table or index change.
