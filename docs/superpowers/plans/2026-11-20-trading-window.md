# Count and email the trading day's Sales & takings report

A Monday bill issued by the automatic close at Tuesday's 03:00 changeover, or on Thursday after an outage, counts in Monday's **Sales & takings**. A new Tuesday 04:00 sale belongs to Tuesday. A venue can opt in to email its daily report after the close. The owner asked for the original trading day and optional email on 20 November at 14:43. The watcher kept one changeover. Leave the fiscal issue path and backup schedule alone.

Claude reviewed the plan on 20 November. The watcher cleared two pull requests at 18:45 that day. [#3398](https://github.com/clintongormley/waitron/pull/3398) is the only build dependency and owns invoice operation dates. Use the same trusted opening and business-day boundaries as its `closeOfDayEnd`.

## PR 1 · Put automatic close bills in the original report

- In `packages/reporting/src/business-day.ts`, share one sale-day filter between `issuedSalesClause` and `reversedSalesClause`. Select sale IDs in two indexed ranges. Ordinary sales use `issued_at`. Sales whose source is `business_day_close` use their order's `trusted_opened_at`. In `closed-bills.ts`, apply the rule to zero-total bills the automatic close settles on issue. Later settlements, payments and voids use their event time. Invoice, tax and accounting dates keep their own rules.
- Add the trusted-opening index in `packages/db/src/schema/orders.ts` and the daily report mail kind in `packages/db/src/schema/outgoing-mail.ts` in one core baseline rebuild. Verify both range scans on the box's Node/SQLite build and run the five schema suites.
- Test Monday catch-up, a new Tuesday 04:00 sale and a Tuesday void of a Monday sale in `business-day.test.ts`. Test zero-total settlement in `closed-bills.test.ts` and a real catch-up pass reaching the report in `close-of-day-job.test.ts`. Run #3398's close-date case unchanged. Update the table-service guides and backlog. Keep late arrivals for a saved daily close in A1325.
- Estimate about 90 production lines and 150 test lines, including fixture changes, plus generated schema output and guides.

## PR 2 · Offer a daily email after the close

- Save an off-by-default venue setting and selected staff IDs in `daily-report-mail-settings.ts`. Add the switch and picker through `email-settings-api.ts`, the dashboard client and `email-settings-panel.ts`. Require `system.manage` and `report.view` to change it. Reuse `manager-email-recipients.ts` with `report.view` to find active recipients with an address and their own language. Use the configured venue mail server. The screen says the email needs a configured mail server.
- In `close-of-day.ts`, enqueue after the primary completes a pass for the most recent ended day. A clock hold, an interrupted scan, a failed issue or money still moving postpones it. Keep earlier catch-up days available on demand and say which day the email covers in the guide. Use `daily-report-mail.ts`, `enqueueMail` and `mail-sender.ts` with one key per day and recipient, the existing retry pattern and a one-day lifetime. Recheck the setting and access when claiming the message. Share the daily reader from `report-api.ts` with the plain-text render of the same figures. The existing sender delivers outside the close pass. This PR uses the mail kind added in PR 1.
- Test the enqueue in `close-of-day-job.test.ts` after a completed, interrupted and retried pass. In `daily-report-mail.test.ts`, test its duplicate key and per-recipient access check. Test save permissions in `email-settings-api.test.ts` and the form in `email-settings-panel.test.ts`. Verify both email guides and the browser form.
- Estimate about 430 production lines and 230 test lines, plus guides.
