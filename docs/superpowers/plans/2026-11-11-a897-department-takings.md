# A897: Takings and sales by department

## Settled attribution

Owner, 2026-11-11 14:47, chose “All under Restaurant (Recommended)” through the watcher, recorded in `~/waitron-campaign-d/questions.md`. Count a whole bill under its recorded department: a Restaurant bill with €80 food and €20 drinks, paid €40 cash and €60 card, contributes all €100 and one closed bill to Restaurant. No per-line split.

## Request and conditions

Owner, 2026-11-11 14:01: "is the total per venue or per department? i don't care what till it comes from, but there should be sub-totals by department", then "All takings by department". Recorded in `/Users/clintongormley/waitron-campaign-d/queue.md`, A897; background: `docs/backlog/service-periods.md#a897-sales-by-department`.

Author: Codex. Claude read the draft (223 seconds); findings applied. Watcher 2026-11-11 14:35 required storing department figures in the close and directed no further read. No owner approval of this approach is claimed.
Watcher 2026-11-11 19:52 cleared build after #2819 landed at `8c085bc57a50656827e29efc781280455eaa09ca`. The owner answer and dependency conditions are met. The driver rebased this plan onto main before build. Visible wording is **Deferred payment / Pago aplazado**.

## Later review direction, 2026-11-11 22:09

Both built reviews questioned the saved/live reader because no production route records a daily close yet. The owner answered through the watcher: “we're building towards proper reporting. just rejecting all steps along the way seems counterproductive”. The watcher withdrew its 22:08 removal note and directed keeping the 21:40 reader, testing merged tips, and recording the later-write question in the close-day backlog. This is the owner's direction to retain that step, not a claim that the owner approved the full plan. The one fresh read of fixes follows; no new whole-branch wave.

## Smallest usable finish line

On Takings today and the Sales daily report, retain venue totals and add one By department table for cash, card, Deferred payment, and both the count and value of bills closed. Combine tills within each department; keep the existing Sales tender-by-device table. Retain existing received-money and tip figures without adding a separate tip breakdown.
Use **Unallocated** for absent/null recorded departments, including payments on bills not yet invoiced. Once the invoice exists, those payments move to its recorded department, including in earlier live-day reads; explain this on screen. Never use today's product, zone or till settings to guess history. Department subtotals must sum to the corresponding live venue figure, including refunds and zero/negative net movements.
**Frozen days:** store the department rows when the day closes and render those retained rows beside its stored venue figures, never a fresh breakdown. Watcher 2026-11-11 14:35 requires this for “All takings by department”. Pre-live test venues are reset: no conversion, backwards-compatible reader or “not recorded” message for older closes.

## One slice, one PR

1. Reporting: edit `packages/reporting/src/cash-up.ts`, `closed-bills.ts`, `daily-close.ts`, `types.ts`, `index.ts`. Reuse `computeCashUp`, #2819's settlement-window query, `TenderMethodLine`, `ClosedBills`, `DailyCloseInput`, `businessDayWindow`, `nodeScopeClause` and exact cents conversion. Factor existing reads without copying money rules. Add shared department rows as `DailyClose.departmentTakings`; `computeDailyClose` supplies them, so existing `recordDailyClose` retains them in `snapshot.close`. Keep drawer reconciliation unchanged. `daily-close-hash.ts:78` already serializes the whole `snapshot.close`; order the new rows deterministically and verify they are covered by the hash, without changing the hash algorithm.
2. Attribute direct tenders and tender refunds through their sale's header; bill payments/refunds through the sale linked to their working order. Use left joins so missing headers survive. Count closed bills using #2819's settlement window and sale header. Group by recorded department id, not name; mark inactive departments so reused names remain distinguishable. Preserve existing source, date, refund and node-scope rules. Source constraints supporting join cardinality: one header per sale (`service.ts:122`), one sale per working order (`sales.ts:143`); recheck A275's additional joins on its landed tree.
3. Frozen reader (`packages/reporting/src/read-daily-close.ts`, with a focused test): watcher 2026-11-11 21:40 cleared a bounded reader because Sales has no stored-close path yet. Use each frozen node/day snapshot plus one computed read for still-live nodes, combine venue and department figures by id, and leave top sellers live. No other reader. Server: extend the existing overview and daily-close answers in `apps/server/src/report-api.ts`; reuse `summariseClosures` for received versus deferred amounts. Live reads return computed department rows; frozen reads return `snapshot.close.departmentTakings`. Await reads in turn in the existing transaction, under the existing report permission. No new endpoint.
4. Dashboard: extend `SalesOverview`, `DailyCloseDto`, `CashUpDto` as needed and reuse `ClosureSummaryDto` in `apps/dashboard/src/api/client.ts`. Render the breakdown in `apps/dashboard/src/screens/dashboard-overview-screen.ts` and `dashboard-sales-screen.ts`; add EN/ES labels and a short attribution explanation in `apps/dashboard/src/i18n/strings.ts`. Reuse existing cards, tables, money formatting, tokens and live queries.
5. At build completion, remove the completed A897 entry from `docs/backlog/service-periods.md` and its pointer in `docs/backlog.md`. Do not remove it if the owner answer leaves requested behaviour undelivered.

## Tests by responsibility and build checks

Use TDD at each layer: write a behavioural assertion, run it and see the expected missing-breakdown failure, implement the minimum, then rerun that file. Reuse `useVenueDb` and `packages/reporting/test/fixtures.ts`; keep existing behavioural assertions.

- Reporting, `packages/reporting/src/cash-up.test.ts`, `cash-up-tender-refunds.test.ts`, and #2819's `closed-bills.test.ts`: reuse one source fixture covering direct tenders, bill payments, bill-payment refunds, tender refunds (including refunded bill tenders), and Deferred payment across two departments/tills, a null header and an uninvoiced payment. Assert department rows reconcile to venue figures; one payment moves from Unallocated after invoicing. This layer owns arithmetic; keep existing boundary/node-scope assertions without adding duplicate cases.
- Frozen close, `packages/reporting/src/record-daily-close.test.ts`, `daily-close-hash.test.ts` and `verify-daily-close-chain.test.ts`: retain department figures and names at close, verify the recorded chain, and assert a changed department amount changes the digest. Update affected close fixtures; do not duplicate arithmetic cases. A frozen report must keep its stored rows after later source/name changes.
- Server, `apps/server/src/report-api.overview.test.ts` and #2819's `report-api.transfer-close.test.ts`: both answers carry and correctly map the department rows, including Unallocated and closure summaries. Retain existing access checks; do not repeat the reporting arithmetic matrix.
- Dashboard, `apps/dashboard/src/screens/dashboard-overview-screen.test.ts`, `dashboard-sales-screen.test.ts` and their existing `.a11y.test.ts` siblings: department values render for each requested figure, venue totals and the till table remain, Unallocated explanation, inactive-name distinction and EN/ES wording. A frozen-day case shows its stored breakdown. Update affected typed fixtures.

Focused commands during build, from the repository root (not executed by this plan author):

```sh
pnpm --filter @waitron/reporting test src/cash-up.test.ts src/cash-up-tender-refunds.test.ts src/closed-bills.test.ts
pnpm --filter @waitron/reporting test src/record-daily-close.test.ts src/daily-close-hash.test.ts src/verify-daily-close-chain.test.ts
pnpm --filter @waitron/server test src/report-api.overview.test.ts src/report-api.transfer-close.test.ts
pnpm --filter @waitron/dashboard test src/screens/dashboard-overview-screen.test.ts src/screens/dashboard-sales-screen.test.ts src/screens/dashboard-overview-screen.a11y.test.ts src/screens/dashboard-sales-screen.a11y.test.ts
```

Run every other changed fixture-consumer test file by path. Inspect both screens in light/dark themes and at phone width. Run `finish-branch`, the normal push hook, and require the selected CI jobs to pass on the current head; no whole-package local test run.

## Limits and estimate

Excluded: per-line attribution, schema/migration changes, historical backfill, new reports/exports, VAT or category/top-seller regrouping, new cash metrics in the period-only view, and fiscal/drawer changes. Existing till breakdowns stay. No dedicated Sales/overview guide was found under `apps/server/src/guide/{en,es}`; recheck #2819's landed documentation before choosing any guide edits.
Estimate including frozen rows: production 300–420 changed lines; tests/support 280–420, separately counted. One usable slice and one PR within three working hours appears feasible after the waits; this is an estimate, not measured. A split answer or material growth returns to the watcher before expanding the build.
