# A897: Takings and sales by department

## WATCHER-NEEDED: mixed restaurant and bar bills

**First unresolved decision. The watcher must ask the owner before build.**
Example: one Restaurant bill contains €80 food and €20 bar drinks, paid €40 cash and €60 card.

- **Recommended: count the whole bill under its recorded department.** Restaurant shows €40 cash, €60 card and one closed bill worth €100; Bar shows none of this bill.
- Split food and drinks between Restaurant and Bar. This also needs an owner policy for dividing the cash/card amounts and the closed-bill count; the item prices alone do not decide those figures.

**Owner question:** On both screens, should that bill appear wholly under Restaurant as above, or should the drinks contribute to Bar as well? I recommend the whole bill because it follows the department already recorded for the sale.

Source-only finding, not a runtime verification: `packages/db/src/schema/venue-service/service.ts:119` gives `sale_receipt_headers` one nullable department per sale; `packages/venue-service/src/operations.ts:575` records it from the sale's zone. `packages/db/src/classification.ts:358` declares that header append-only. `packages/db/src/schema/sales.ts:159` defines sold lines without a department. These sources do not establish a per-item split.

## Request and conditions

Owner, 2026-11-11 14:01: "is the total per venue or per department? i don't care what till it comes from, but there should be sub-totals by department", then "All takings by department". Recorded in `/Users/clintongormley/waitron-campaign-d/queue.md`, A897; background: `docs/backlog/service-periods.md#a897-sales-by-department`.

Author: Codex. Claude plan review and watcher clearance are pending; no owner approval of this approach is claimed.
**Build waits for the owner answer, PR #2819 landing, Claude's read and watcher clearance.** Everything below is conditional on whole-bill attribution being chosen. If the owner chooses a split, revise the plan before build; no per-line schema or allocation protocol is planned here.
Dependency inspected only as source: local `feat/a275-closed-bills` at `821e9e90dd`; recheck the landed tree before editing. Its `ClosureSummaryDto` still uses `toBePaidByTransfer` internally. Visible wording must be **Deferred payment / Pago aplazado**.

## Smallest usable finish line

On Takings today and the Sales daily report, retain venue totals and show department subtotals for cash, card, Deferred payment, and both the count and value of bills closed. Show received-money totals and payment tips consistently with those rows. Combine tills within each department; replace the Sales payment table's device grouping with department grouping.
Use **Unallocated** for absent/null recorded departments, including a payment with no issued sale header. Never use today's product, zone or till settings to guess history. The department subtotals must sum to the corresponding venue figure, including refunds and zero/negative net movements.

## One conditional slice, one PR

1. Reporting: edit `packages/reporting/src/cash-up.ts`, `closed-bills.ts`, `types.ts`, `index.ts`. Reuse `computeCashUp`, #2819's `computeClosedBills`, `TenderMethodLine`, `ClosedBills`, `DailyCloseInput`, `businessDayWindow`, `nodeScopeClause` and exact cents conversion. Factor their existing reads to support department grouping without copying the money-movement rules. Keep the existing daily-close snapshot and drawer reconciliation shape intact; expose department results separately for these views.
2. Attribute direct tenders and tender refunds through their sale's header; bill payments/refunds through the sale linked to their working order. Use left joins so missing headers survive. Count closed bills using #2819's settlement window and sale header. Group by recorded department id, not name; resolve names including inactive departments. Preserve each existing source, date, refund and node-scope rule and avoid multiplying rows when joining.
3. Server: extend the existing overview and daily-close answers in `apps/server/src/report-api.ts`; reuse `summariseClosures` for received versus deferred amounts. Await reads in turn in the existing transaction, under the existing report permission. No new endpoint.
4. Dashboard: extend `SalesOverview`, `DailyCloseDto`, `CashUpDto` as needed and reuse `ClosureSummaryDto` in `apps/dashboard/src/api/client.ts`. Render the breakdown in `apps/dashboard/src/screens/dashboard-overview-screen.ts` and `dashboard-sales-screen.ts`; add EN/ES labels and a short attribution explanation in `apps/dashboard/src/i18n/strings.ts`. Reuse existing cards, tables, money formatting, tokens and live queries.
5. At build completion, remove the completed A897 entry from `docs/backlog/service-periods.md` and its pointer in `docs/backlog.md`. Do not remove it if the owner answer leaves requested behaviour undelivered.

## Tests by responsibility and build checks

Use TDD at each layer: write a behavioural assertion, run it and see the expected missing-breakdown failure, implement the minimum, then rerun that file. Reuse `useVenueDb` and `packages/reporting/test/fixtures.ts`; keep existing behavioural assertions.

- Reporting, `packages/reporting/src/cash-up.test.ts`, `cash-up-tender-refunds.test.ts`, and #2819's `closed-bills.test.ts`: two departments across tills; missing/null headers and uninvoiced payments; cash/card/deferred totals; tips, received bill payments and completed returns without double counting; settlement boundaries and node scope; closed count/value; subtotal reconciliation. This layer owns the arithmetic.
- Server, `apps/server/src/report-api.overview.test.ts` and #2819's `report-api.transfer-close.test.ts`: both answers carry and correctly map the department rows, including Unallocated and closure summaries. Retain existing access checks; do not repeat the reporting arithmetic matrix.
- Dashboard, `apps/dashboard/src/screens/dashboard-overview-screen.test.ts`, `dashboard-sales-screen.test.ts` and their existing `.a11y.test.ts` siblings: distinct department values render for every requested figure, venue totals remain, no till grouping, empty/Unallocated states and EN/ES wording. Update existing typed fixtures affected by the added fields.

Focused commands during build, from the repository root (not executed by this plan author):

```sh
pnpm --filter @waitron/reporting test src/cash-up.test.ts src/cash-up-tender-refunds.test.ts src/closed-bills.test.ts
pnpm --filter @waitron/server test src/report-api.overview.test.ts src/report-api.transfer-close.test.ts
pnpm --filter @waitron/dashboard test src/screens/dashboard-overview-screen.test.ts src/screens/dashboard-sales-screen.test.ts src/screens/dashboard-overview-screen.a11y.test.ts src/screens/dashboard-sales-screen.a11y.test.ts
```

Run every other changed fixture-consumer test file by path. Inspect both screens in light/dark themes and at phone width. Run `finish-branch`, the normal push hook, and require the selected CI jobs to pass on the current head; no whole-package local test run.

## Limits and estimate

Excluded: per-line attribution, schema/migration changes, historical backfill, till breakdowns, new reports/exports, VAT or category/top-seller regrouping, new cash metrics in the period-only view, and fiscal/drawer changes. No dedicated Sales/overview guide was found under `apps/server/src/guide/{en,es}`; recheck #2819's landed documentation before choosing any guide edits.
Estimate for the whole-bill option: production 220–320 changed lines; tests/support 240–360, separately counted. One usable slice and one PR within three working hours appears feasible after the waits; this is an estimate, not measured. A split answer or material growth returns to the watcher before expanding the build.
