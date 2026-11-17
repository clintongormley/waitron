# A1268 part 2 implementation plan

A manager sees both written times when a clock-out comes before its clock-in, sees **Needs a
retime** on that session, and can correct it or another entry. The reversed session counts zero
minutes. [A1268 design §4](../specs/2026-11-01-a1268-clock-ins-per-venue-design.md#4-part-2--readings-that-order-entries-by-time-after-a-backward-clock-step)
sets this behavior. Its recorded owner decisions cover part 1. The watcher decides whether §4
needs an owner decision before the build.

1. **Pair clock entries.** In `packages/workforce/src/effective-entries.ts`, order each person's
   direct entries by chain position on each node. Retimes use the original position and effective
   time. Give a missing-entry correction its place after the last earlier-written entry at or
   before its effective time on its node, with the next direct write as its upper limit. This
   lets a later direct clock-out close a missing clock-in dated ahead of it, as the live read does.
   Merge node streams by their next entry's event time with the existing tie-break. In
   `projection.ts`, keep the session walk and have it return the paired start, end and member
   entry IDs internally beside the session. Count zero minutes for reversed endpoints and clamp
   reversed break durations at zero. In `projection.test.ts`, test both stored times and zero
   minutes, retiming in the original position, the cross-node merge and both missing-correction
   cases from review. Change the old ingest-order check to shuffled reads with intact chain
   positions. Record that check in the PR and add a dated note to the July workforce design about
   the online clock path and its deferred offline-ingest rule.
2. **Use the pairs in reads and corrections.** In `corrections.ts`, validate the proposed effective
   sequence using the position the approval would occupy. Keep invalid-sequence checks and the
   refusal when a retime would reverse a previously valid session. `hours-reads.ts`, `end-of-day.ts`,
   `automatic-entries.ts` and `staff-activity.ts` use pairing order for clock state. Comparisons to
   roster and activity times still use the recorded times. A reversed interval claims no timed
   activity. `record-projection.ts` passes internal membership to `record-period.ts`, so a shift's
   period includes both endpoints, breaks and associated history. An endpoint also appears in its
   own dated period. `automatic-entries.ts` and `pay-period-close.ts` identify the closing entry by
   ID. `record-reads.ts` keeps the indexed live clock-state read. The prepared export passes the
   already-scoped current and frozen history from `packages/workforce-es/src/record-export.ts` to
   `registro-jornada.ts`. Session and hash formats stay as they are. A frozen comparison can show
   a genuine difference when a historical live session was previously lost.
   Start with failing cases in `corrections.test.ts` (another retime succeeds, and the reversed
   shift can be repaired), `end-of-day.test.ts` (a recorded out prevents another close), and
   `record-reads.test.ts` (both endpoints across a period boundary). Check displayed open state,
   automatic-close attribution and overnight activity in their sibling tests. Check frozen period
   membership and impact in `record-closures.test.ts`, and prepared export history in its existing
   tests. Run the existing clocking-step, correction-group and planned-versus-actual controls.
3. **Show the warning.** In `apps/dashboard/src/widgets/hours-record.ts`, show the localized label
   only when the UTC end strictly precedes the UTC start. Use `apps/dashboard/src/i18n/strings.ts`
   and point to the existing correction action in `apps/server/src/guide/{en,es}/staff.md#hours`.
   In `hours-record.test.ts`, check both written times and the warning, with no warning for an
   ordinary session. Check both languages and themes at phone and desktop widths. Remove the
   completed entry from `docs/backlog.md` and `docs/backlog/box.md` after verification.

The warning covers reversed session endpoints on the dashboard. Partial clock steps, reversed
break warnings, till and export labels, schema changes, and period-read performance are outside
this slice. Estimate 260–375 production lines and 200–290 test lines. Run the changed test files,
the normal push hook and current PR CI. Include workforce, dashboard and export in branch review.
