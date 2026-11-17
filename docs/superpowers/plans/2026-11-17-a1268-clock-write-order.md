# A1268 part 2 implementation plan

A manager sees both written times when a clock-out comes before its clock-in, sees **Needs a
retime** on that session, and can correct it or another entry. The reversed session counts zero
minutes. [A1268 design §4](../specs/2026-11-01-a1268-clock-ins-per-venue-design.md#4-part-2--readings-that-order-entries-by-time-after-a-backward-clock-step)
sets this behavior. Its recorded owner decisions cover part 1. The watcher decides whether §4
needs an owner decision before the build.

1. **Pair clock entries.** In `packages/workforce/src/effective-entries.ts`, order each person's
   direct entries by the original entry's node and `sequenceNo`. Retimes keep that position and
   supply their effective time and offset. Merge the next available entry from each node and the
   time-sorted stream of missing-entry corrections with `compareEvents`. Comparing next entries
   preserves chain order even when the dates go backward. In `projection.ts`, keep the existing
   session walk and use its paired entries for membership. Keep both times, count zero minutes
   for a reversed session and give a reversed break zero duration. In `projection.test.ts`, first
   show the missing session on the old code, then prove zero minutes, original times, a retime
   occupying its original position, and the time merge across nodes and missing entries. The old
   out-of-order-arrivals case changes to feed rows out of order while keeping chain positions
   intact. Record the changed check in the PR.
2. **Use that order where the record is read or corrected.** `corrections.ts` validates a proposed
   change in the same order as the projection. Retain the existing checks for invalid entry
   sequences and missing pairs. `hours-reads.ts`, `end-of-day.ts`, `automatic-entries.ts`, and
   `staff-activity.ts` use pairing order for clock state and interval membership, and keep event
   times for elapsed time and comparisons to activity and roster times. In `record-period.ts`,
   include the paired entries and their correction history when the session's start belongs to the
   requested period, even if the clock-out is dated in the previous period. Reuse that membership
   where `packages/workforce-es/src/registro-jornada.ts` filters the export's history again. Keep
   `record-reads.ts`'s indexed live clock-state read and its existing controls. Add failing cases
   first in `corrections.test.ts` (retime an unrelated entry, then repair the reversed shift),
   `end-of-day.test.ts` (the recorded out prevents an automatic close), and `record-reads.test.ts`
   (both endpoints of a reversed session across a period boundary). Use `hours-reads.test.ts`,
   `automatic-entries.test.ts`, `staff-activity.test.ts`, and `registro-jornada.test.ts` to check
   their distinct results. Run existing correction-group, clocking-step and frozen-record tests.
3. **Show the warning.** In `apps/dashboard/src/widgets/hours-record.ts`, derive the label from
   the two UTC times already in the session. Add the English and Spanish strings in
   `apps/dashboard/src/i18n/strings.ts` and name the existing correction action in the English
   and Spanish Hours guides. In `hours-record.test.ts`, assert that both times and the warning
   render for a reversed session and that an ordinary session has no warning. Check both languages
   and themes at phone and desktop widths. Delete A1268 part 2 from `docs/backlog.md` and
   `docs/backlog/box.md` once the behavior is verified.

The stored rows, indexes, clock actions, append-only hashes, frozen snapshots, and export format
stay as they are. Period-read cost belongs to A10. Estimate 250–330 production lines and 180–280
test lines. Run the changed test files in their packages, then the normal push hook and current
PR CI. The workforce-to-dashboard and export callers are part of the whole-branch review.
