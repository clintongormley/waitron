# A1268 part 2 correction validation

After a backward clock step, managers can approve valid corrections for a worker whose history
already has a sequence fault. The owner chose “Small fix (Recommended)” in the watcher window
on 18 November 2026 at 10:13 CET, as recorded in Lane I’s `questions.md`. Claude’s plan review
proposed this smaller fix. The watcher cleared it and waived a further plan read.

1. In `packages/workforce/src/corrections.test.ts`, record a normal shift followed by a reversed
   shift. A retime of the normal shift’s clock-out should go through and change the hours total.
   Moving that clock-out before its own clock-in must still be refused as `unmatched_out`.
   In `packages/workforce/src/correction-groups.test.ts`, request and approve a historical missing
   shift with a later reversed shift in the record. Run both files and observe the unrelated
   retime and missing-shift approvals fail on the old validator.
2. In `packages/workforce/src/corrections.ts`, reuse the event-time order and the existing clock
   state rules. Compare the proposed sequence’s faults with the existing sequence’s faults by
   entry and reason. Refuse a new fault even if a different entry already has the same fault.
   Apply the same rule to single requests, approvals and the shared group check. Preserve a
   retimed entry’s identity during comparison.
3. Run the changed tests and the existing clock-step, correction-lifecycle and correction-readiness
   cases. Keep hours, export and alerts on their existing paths. Close the old §4 backlog proposal
   and record the owner’s decision in the workforce area. Verify with the normal push hook and
   current-head PR CI.

Estimate 20–35 production lines added and about 50 test lines. No second ordering rule, hours
warning, storage or screen change.
