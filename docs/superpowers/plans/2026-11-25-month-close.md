# Close monthly hours automatically

Managers can adjust the grace period in Hours, see the closing date and download frozen totals. The owner chose “3 working days of grace, adjustable” on 24 November. The watcher’s definition counts weekdays and skips holidays in the venue calendar. The research proposed 0–10 days. Zero closes at the venue’s business-day boundary starting 1 December. With three days and no holiday on 1–3 December, November 2026 closes at the boundary starting 4 December. Show the existing calendar coverage notice when holiday data is unavailable and count weekdays using the data available.

## 1. Preserve frozen hours when a spare takes over

In `packages/workforce/src/handover-return.ts` send each original closure before its dependent clock entries, including closures with no dependent entries. Verify its ID, hash and chain link. Include closure-chain heads in `handover-holdings.ts` so the old database cannot be discarded while a closure is missing. Measure a realistic large month before choosing the encoding. Try one compressed closure with an explicit expanded-size cap within the existing signed return request limit. Bring an over-limit result to the watcher before adding a transport. Test a missing unreferenced closure, a closure followed by its counting marker, replay and the measured large month in the Workforce return and holdings tests. Exercise old-box return and safe set-aside in `apps/server/src/handover-two-boxes.test.ts`. This slice can land independently.

## 2. Close and display monthly hours

Add the grace setting to the existing `pay_period_settings` in `pay-periods.ts`, with the workforce baseline rebuild. Keep cadence editing out. In `apps/server/src/attendance-loop.ts` close after due attendance processing for that month, including after a restart. On a primary with an open destination handover, wait for completion or the manager’s existing **Will not return** decision. If an abandoned box later returns a competing snapshot, keep the existing frozen record and keep the old database set aside. Show the reason for a delayed close in Hours. Start at a month agreed with the watcher before enabling the job. I recommend the first month whose date of close falls on or after activation.

Share the due calculation between the job and Hours. Server supplies calendar dates and venue clock. `pay-period-close.ts` takes the calculated boundary and records the actual close time. Reuse the working-time rules and include the paid-break policy in new hashed snapshots so `record-projection.ts` compares closed months using the same policy. Keep existing hashes valid. Use `hours-reads.ts` and `attendance-contract.ts` to present closed totals, later corrections and a separate month-only list of missing clock-outs, unanswered corrections and disputes. Count already automatic clock-outs without adding them to that list. Read the closure once per window. Use `management-attendance-api.ts` and the existing dashboard Hours screen with its shared save controls. Saving requires `system.manage`.

Test holiday, weekend, zero and exact boundary in Workforce. Test restart, attendance order, handover hold and role in Server. Test permissions and the Hours display through the route and browser. Update both staff guides and add a dated pointer to decision 10 of the October design. Send pictures to the owner before landing. Tips and cadence editing remain separate backlog work.

## 3. Reminder and later adjustments

Ask the watcher to confirm this research scope separately. Reuse the outgoing queue for one reminder per permitted manager on the day before close when the month has unresolved items. Decide which late changes belong to which period before changing `packages/workforce-es/src/record-export.ts`, including a returned old-box entry. No manual close or reopening action.

Estimated additions are 300 product and 250 test lines for return, and 390 product and 330 test lines for closing and Hours, plus the generated baseline. Size the reminder and export after the scope decision.
