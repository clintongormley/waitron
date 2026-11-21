# 6. Retire the frozen day report

[Shared plan and Sales decision](2026-11-21-a1325-close-a-drawer.md). After PR 5. Estimate 300 production and 330 test additions/edits, plus deletions and the core
baseline. Sales reads figures for the selected dates, including later writes with those dates.

In `apps/server/src/daily-sales-figures.ts`, use `computeDailyClose` directly. Keep the report route,
existing date rules, node scope, top sellers and outside payments. The daily email uses the same
reader. Remove the saved-day conditions in `deferred-close.ts`, `business-day-start.ts`,
`venue-details.ts` and `packages/db/triggers/core.sql`. Preserve sales/order/future-history refusals
and pending cutover cancellation. Trace `hasDailyClose`, `daily_close` and `day_frozen` through their
dashboard clients, strings and subscription lists.

Remove the db `schema/daily-closes.ts` tables and their classification, manifests, and support
in reporting `{record-daily-close,daily-close-hash,verify-daily-close-chain,close-types,read-daily-close,backup-verification}.ts`.
Remove the retired chain's special comparison from composition `core-backup-verification.ts`.
Keep generic immutable comparisons and surviving guard coverage. Replace the old bench close in
`apps/server/scripts/bench/{trading-day,build-year}.ts` with actual drawer closes. Use an identified
completed benchmark day to select between its saved copies after interruption. Today `copyFor` in
`build-year.ts` uses `max(business_day)` from the table it loses. Check fixture and
schema inventory consumers and add dated pointers to affected historical plans.

Fail first in reporting `daily-close.test.ts` and server `report-api.deferred-close.test.ts` for live
late figures with earlier dates and unchanged drawer facts. Preserve different-day refund and
multi-node assertions. Run the changed report, business-day, backup verification, bench restart,
dashboard and schema suites. The protection list should lose only the old tables and their guards,
including the closed-day cutover trigger. Disclose the reset at the top of the PR. In the Sales guide,
say that a day can change when an entry dated to it is recorded later and a drawer close keeps its facts.
