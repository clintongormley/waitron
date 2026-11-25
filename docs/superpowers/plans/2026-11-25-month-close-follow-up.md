# Finish monthly Hours

Managers can read the selected month's dates and issues. A later closed month's export carries corrections to earlier totals. Before closing it managers get a reminder if there is work they can act on. Closing writes nothing to the clock record. Tips, cadence editing and reopening stay outside this work. Claude reviewed the plan. The watcher cleared the three-PR split on 25 November 2026 at 16:06. [First plan](2026-11-25-month-close.md), [clocking decisions](../specs/2026-10-12-a10-clocking-in-and-out-design.md#decisions-owner-2026-10-12).

## PR 2a. Readable dates and monthly issues

- In `hours-reads.ts`, filter the existing manager Hours pending work and open shifts for a whole month before attaching their history. Use the shift's recorded local start date even when it ends the next day. Use the expected work date or prompt's business day when no shift exists. Include pending retimes in both affected months and retain the linked history. Group a proposal with its correction item, an automatic out with its prompt, and an open shift with a question about that shift. Personal Hours and the separate Corrections queue retain their existing scope.
- In `attendance-corrections-screen.ts`, put the localized month and year or the shorter period's date range between Previous and Next. Step from the last returned bounds and retain the requested month during loading or failure. Put date formatting in a helper. Use `formatBusinessDate` and the dashboard formatter in that screen, `widgets/hours-record.ts` and its attendance history. Read the Details form date from `wallClock`. Render shifts like “Mon 5 Jan, 10:00–18:00”, identify a next-day finish, and show recorded offsets where a clock change makes the time ambiguous. Preserve the recorded wall time and use the venue or saved closure zone to identify a repeated hour.
- Start with failing cases in `hours-reads.test.ts` and the dashboard Hours tests for an overnight shift with a matching prompt, a retime across the month boundary, a failed read followed by navigation, and ordinary and repeated-hour dates in English and Spanish. Keep access to weekly and fortnightly periods. Update both staff guides and show whole Hours screenshots to the owner before landing. Estimate 180 product and 170 test lines.

## PR 2b. Export adjustments

- In `pay-period-close.ts`, reuse `readTimeRecord`'s `closedPeriodImpacts`, which uses each closure's saved break policy. Subtract adjustments already carried for the person and source month, treating a missing impact as zero. Save positive or negative remainders as optional snapshot rows when the next month closes. Canonicalize them in `pay-period-chain.ts` and filter by person in `record-reads.ts`. In `workforce-es/src/record-export.ts`, collect names from those rows and show the source month and signed minutes.
- Start red in `pay-period-closure.test.ts` for +60, then −60 after reversal. Use `record-export.test.ts` for the adjustment-only leaver's name, amount display and excluding another person's rows. Measure the historical read with the existing budget suite. Update guides and backlog. Estimate 150 product and 125 test lines.

## PR 2c. Reminder

- Reuse `attendance-loop.ts` and `monthly-hours-close.ts` for the calendar date before close, from the venue's day-change boundary. Count missing-time questions and requests waiting for a manager. Send the month, close date and time, count and Hours link to active `workforce.correct` holders through `readStaffEmailRecipients` and `enqueueMail`, using the venue's SMTP. Include the scheduled close time in the mail key and use it as the expiry. Recheck at claim. Add the mail kind, rebuild the core baseline, declare the venue reset in the PR and register the handler in `boot.ts`.
- Start red in `attendance-loop.test.ts` for queueing once, an overdue open shift counting once through its question, a normal open shift with zero grace and a moved close. Use the handler test for claim, wording and recipients. Update guides and backlog and run mail-kind and baseline guards. Estimate 170 product and 145 test lines plus baseline.

Overtime by contract moves with [A586](../../backlog/workforce.md#overtime-when-a-contract-changes)
as the owner chose on 25 November 2026. The two worked examples are there.
