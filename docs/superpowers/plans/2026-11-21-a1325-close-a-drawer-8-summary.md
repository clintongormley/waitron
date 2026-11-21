# 8. Send the owner the daily summary

[Shared plan](2026-11-21-a1325-close-a-drawer.md). After PR 7. Estimate 280 production and 260 test
lines. The scheduled email reports Sales, closes since the prior summary, differences and due
warnings. It can still send on a day when nobody closed a drawer.

Move `queueDailyReportMail` scheduling from `apps/server/src/close-of-day.ts` to PR 7's scheduled
check. Preserve the automatic bill-close job. Extend `daily-report-mail.ts` and
`i18n/daily-report-email.ts` in both languages. Reuse the current queue, daily dedupe key and retry
behaviour. Use the previous queued summary and the current due check to select the close interval.
Persist only the selected interval in the existing mail params so a retry reads the same closes.
Verify mail retention first. If the previous summary's boundary can disappear, bring that case to
the watcher before adding storage. Switch off overdue email wording when warnings are disabled.
Daily Sales delivery follows its own mail setting.

The current report has opt-in recipients with `report.view`. The design suggests emailing the
venue's owner. Recommend keeping explicit recipients and making the owner the initial choice
when enabling reports. Confirm this with the watcher before changing recipient behaviour.

Fail first in `drawer-summary-mail.test.ts` for a due check with no close, close intervals across
two checks, a late close, restart and repeated enqueue. The existing `daily-report-mail.test.ts`
owns recipients, language and content. Run those suites, `email-settings-api.test.ts` and
`close-of-day.test.ts`. Reuse existing mail retry tests and check both rendered languages. Waiter
float reporting waits for A240. No schema change.
