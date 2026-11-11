# A275 Task 5: a day's reports show a bill closed by transfer once, apart from money received

**Status: built 2026-11-11 on `feat/a275-closed-bills`; cleared by the watcher 2026-11-11 09:08
with the five defaults; the one-total-per-day departure from design §4 is for the owner at
landing.** Every `file:line` below was read at `69a65a106a`.

_2026-11-11 (owner, 13:49): the words people see are now "Deferred payment" / «Pago aplazado», not "To be paid by transfer". Code names keep `transfer` until a follow-up rename._

_2026-11-11 (owner, 14:01): the report shows one total for the venue, with no per-till list; the departure from design §4 named above is settled._

**When this lands, a manager can:** open the dashboard's overview (today) or its Sales report for
any one business day and see a bill closed "to be paid by transfer" exactly once: on its own **To be
paid by transfer / A pagar por transferencia** line, and in a new **Bills closed / Cuentas
cerradas** figure. It is never inside the money received (the cash and card total), and it never
makes anyone count a cash drawer or produces a cash difference. A day already frozen by its daily
close (the stored, hash-chained end-of-day record, "cierre Z") keeps exactly what it stored.

Worked example, one business day: a €220 simplified invoice (€200 base + €20 VAT) closed by
transfer, a €100 bill paid by card, and a €30 bill still open with €10 paid in cash.
**Bills closed** 2 · €320.00; **Tender total** (money received) €110.00; **To be paid by
transfer** €220.00; cash expected in the drawer €10.00.

## Authority

- Design approved by the owner 2026-10-22 ("A275 looks fine";
  [design §4](../specs/2026-10-22-a275-final-transfer-close-design.md#4-close-history-and-accountant-export):
  show the transfer line apart from Cash and Card, include it once in **Bills closed**, never in cash
  expectation, cash difference or card totals; reuse the frozen close's own line; no rewrite of past
  closes, no change to the close's hash). This cuts the
  [master plan's Task 5](2026-10-22-a275-final-transfer-close.md#task-5-closure-day-totals-frozen-close-and-analytics)
  to current `main` and to the lane rules (owner 2026-11-08/09: smallest safe path, real events only,
  test a dependency once, tests about twice the code). Order "Tasks 4–6": owner's lane walk
  2026-11-10 22:05 (lane L `questions.md`).
- No schema change, no migration. The fiscal core (hash, chain, numbering, `registros_facturacion`,
  the invoice writers) is untouched. `DailyCloseSnapshot`, `computeCloseEntryHash`, the close-hash
  fixtures and every existing assertion stay as they are. With no schema change, the A1308 rule on
  schema work beside its slices does not apply.

## What a transfer-closed bill does to the reports today

**Measured** 2026-11-11 with a throwaway test (deleted, not committed): a real
`closeBillByTransferTx` of an €18.00 Counter bill, then the reports. Had the overview already left
transfers out, `tenderTotal` would have read `0.00`; it read **`18.00`**. The daily close's cash part
read `byMethod: [{ method: "transfer", amount: "18.00" }]`, `cashTakings: "0.00"`. A frozen close with
no cash counts at all succeeded with `byDevice: []`, `nodeVariance: "0.00"`. The transfer row, the
tender, the order and the sale's settlement all carried the same instant
(`2026-11-11T07:54:04.213Z`), and the stored `businessDay` was the day that instant falls in.
The rest of the table is read, not run.

| Where | Today | Receipt |
| --- | --- | --- |
| Overview, "Takings today" | **Tender total / Total cobrado** includes the transfer | `report-api.ts:281–285` passes `cash.tenderTotal`; `cash-up.ts:82` adds every method; screen `dashboard-overview-screen.ts:211`; words `strings.ts:2512`, `:6398` |
| Sales report, "Tender by device / Cobros por dispositivo" | a row reading the raw word `transfer`, counted in **Tender total** | `dashboard-sales-screen.ts:672–690` (`<td>${line.method}</td>` at `:679`); `strings.ts:6424`, `:6429` |
| A "Bills closed" figure | does not exist; **Sales** counts issued invoices | `counts.ts` via `daily-close.ts:26` |
| Cash count and difference at a frozen close | not forced, not affected: only a device with a `cash` line must be counted, and the difference reads only the cash line | `record-daily-close.ts:184–191`; `cash-up.ts:89`; tested for a card-only device, `record-daily-close.test.ts:348`, `:588` |
| A new transfer close into a frozen day | refused, nothing written; an exact repeat still answers | built in Tasks 0–3: `transfer-close.ts:100–106`; tests `transfer-close-refusal.test.ts:542–558`, `transfer-close.replay.test.ts:309–322` (both compare every table before and after) |
| Who freezes a day | no product route: `recordDailyClose`'s only callers are the bench (`apps/server/scripts/bench/trading-day.ts:504`) and the test fixture; no screen reads a stored close | grep of `apps` and `packages` for `recordDailyClose` |

## What changed since the master plan

- **No change to which day a transfer counts on.** The master plan selected transfer rows by the
  stored `businessDay` "not by recomputing". On `main` the two cannot differ in a real event: the
  close dates its tender, order and settlement with the one instant its `businessDay` comes from
  (`transfer-close.ts:97–99`, `:190`, `:193`; `till-sale.ts:2405`; measured above); the venue's
  time zone is refused once any sale exists (`venue-details.ts:238–249`); and a change of the day's
  start time is refused once any tender sits past the moved boundary (`business-day-start.ts:110–133`,
  tenders at `:125`). So `cash-up.ts` is not edited, and no summer-time or start-time cases are added.
- **The frozen-day refusal and its exact repeat are built and tested** (table above). One write
  transaction runs at a time (`record-daily-close.ts:25–27`), so the master plan's "both queue
  orders" are those two cases plus "closed, then frozen", and the frozen document is
  `computeDailyClose`'s output (`record-daily-close.ts:43–49`, tested at
  `record-daily-close.test.ts:183`). Nothing new to build or test there.
- **No frozen-close screen exists** (table above), so the master plan's "frozen-close views render
  stored content" has nothing to change.
- **"Bills closed" is simpler.** A bill is closed on day D when its order's `settled_at` falls in D.
  A database rule ties `settled_at` to the settled status (`orders.ts:130–135`), so a cancelled bill
  (`working-order.ts:7517–7519` sets `abandoned`) never counts; an order has at most one sale
  (`sales.ts:143`), so nothing counts twice; and correction and replacement invoices are written
  without an order (`record-correction.ts:319–336`, `record-substitution.ts:173–192`, read only), so
  the master plan's two exclusions need no clause.
- **The new figures sit in a new `closureSummary` object**, not inside `takings` or `cash`: two
  existing assertions pin `takings` whole (`report-api.overview.test.ts:355–359`, `:398–402`).
  Line numbers in the master plan (`cash-up.ts:39–49`) are now `:42–48`; the reason not to relabel
  `tenderTotal` as Bills closed stands (it includes part-payments on bills still open).
- Two nodes, two devices and failover cases are dropped: a venue has one node today.

## Changes (one PR, two commits)

**5a, reporting.** New `packages/reporting/src/closed-bills.ts`:
`computeClosedBills(tx, input: DailyCloseInput): Promise<ClosedBills>`. One
query: `working_orders wo join sales s on s.working_order_id = wo.id`, `businessDayWindow(input)` on
`wo.settled_at`, `nodeScopeClause(input.nodeIds, sql\`wo.node_id\`)`, `count(*)` and
`cast(coalesce(sum(s.total), 0) as text)` through `rawCentsToDecimal`. The total is the invoices'
totals as issued, tips not included. Export it, and its `ClosedBills` result type from
`types.ts`, from `index.ts`.

**5b, report API and dashboard.**

1. `report-api.ts`: one helper builds
   `closureSummary: { billsClosed: { count, total }, toBePaidByTransfer, received }` from
   `computeClosedBills` and the cash-up: `toBePaidByTransfer` sums the `transfer` lines,
   `received` sums every other line (equal to `tenderTotal` minus the transfer). The overview route
   (`:255`) and the daily-close route (`:296`) add it beside their existing fields, awaited in turn on
   the one transaction. Nothing existing changes.
2. Dashboard twin: `ClosureSummaryDto` in `api/client.ts` (near `:1463–1498`), required on
   `SalesOverview` and `DailyCloseDto`.
3. Overview, "Takings today": **Bills closed** "{count} · {total}" first; **Tender total** shows
   `closureSummary.received`; a new **To be paid by transfer** line; Tips and Gross total unchanged.
4. Sales report: the per-device table leaves out `transfer` rows, and its **Tender total** shows
   `closureSummary.received` (so the table holds money only); under it, **To be paid by transfer**;
   in Records, **Bills closed** as "{count} · {total}", the same text as the overview. All through
   `renderMetric` (`widgets/metric-row.ts:9`). **A stated departure from design §4, for the PR to
   repeat:** §4 asks for the transfer line "by closure business day using the venue's
   clock/changeover rules and originating node/device scope"; the day and the box are honoured,
   but the screens show the day's one transfer total, not one per device. The frozen close keeps
   the per-device line (`cash.byOrigin[].byMethod`), unchanged.
5. Words, EN and ES: `overview.bills_closed`, `overview.to_be_paid_by_transfer`,
   `sales.bills_closed`, `sales.to_be_paid_by_transfer` — "Bills closed" / "Cuentas cerradas", "To be
   paid by transfer" / "A pagar por transferencia".
6. `api/live-queries.ts` (which tables make an open screen read again): `getDailyClose` (`:220`)
   gains `working_orders`, which the new read uses. A loose end fixed here: the cash-up also reads
   `bill_payments` and `bill_payment_refunds` (`cash-up.ts:42–56`), and neither `getDailyClose` nor
   `getSalesOverview` (`:183`) lists them, so both lists gain both tables. Both names are already
   known sources (`live-queries.ts:135–136`), so `scripts/live-subscriptions.test.ts` (which checks
   only that a name is known, `:10–33`) passes as it is.
   `getDailyClose` also gains `devices`: the Sales report names each device through
   `namedCashUp` (`report-api.ts`), so renaming a device did not refresh it.
7. Docs: the A275 lines in `docs/backlog.md` and `docs/backlog/fiscal.md` say Task 5 is built; a
   dated note under the master plan's Task 5 points here.

**Overlap with Task 4 (#2797, not landed):** it also edits `apps/dashboard/src/api/client.ts`
(`ORDER_STATUS_FILTERS`, near `:2256`), `i18n/strings.ts` (`orders.*` keys) and the same A275 lines in
both backlog files. The code edits are in different places; the backlog lines will conflict, so
rebase after #2797 lands and extend its wording.

## Tests (red first; `useVenueDb`)

- `packages/reporting/src/closed-bills.test.ts`, seeded rows on 2026-08-04, Europe/Madrid, day starting
  05:00. Reuse `test/fixtures.ts` (`seedVenueWithSeries`, `seedOpenOrder`, `seedSale`,
  `seedBillPayment`, `seedNodeAndSeries`); `seedSale` gains an optional `workingOrderId`, plus a short
  `settleOrder(db, orderId, at)`. Three cases:
  1. Two settled bills (€220, €100), a €30 open bill with €10 received, and an issued €50 invoice
     whose bill is not settled: `{ count: 2, total: "320.00" }`.
  2. Issued on D, settled on D+1: D reads `{ 0, "0.00" }`, D+1 reads `{ 1, "100.00" }`.
  3. A settled bill on a second box: left out for `nodeIds: [first]`, counted venue-wide.
- `apps/server/src/report-api.transfer-close.test.ts` (new; its own database, because the case
  closes today's bills). `transferCloseVenue` and the admin's management session — the probe showed
  this pair answers 200. One case, three €18.00 Counter bills (Tarta): one closed by transfer through
  the real `closeBillByTransferTx`, one paid in cash and one by card with a €2.00 tip, both through
  the till's existing pay path (`payWorkingOrder` from `testing/whole-payment-fixture.ts`, as
  `attendance-whole-payments.test.ts:105` calls it). Then the overview's `businessDay` equals the
  close's, and its `closureSummary` is
  `{ billsClosed: { count: 3, total: "54.00" }, toBePaidByTransfer: "18.00", received: "38.00" }`
  beside `takings.tenderTotal` "56.00": cash 18 + card 20 is received; the bills' total leaves the tip
  out; dropping the card reads 18, dropping the cash 20, and copying `tenderTotal` 56. `counts.sales`
  3 and `takings.grossTotal` "54.00" are unchanged (issued invoices). The daily close for that day has
  the same summary and one `transfer`, one `cash` and one `card` line; the day before reads all
  zeros. If the pay path takes no tip, pay the card bill without one and the controls still differ
  (18 vs 36 vs 54). Like
  `report-api.overview.test.ts`, it reads "today", so a run that straddles the day's start time
  fails on the first assertion, plainly.
- `dashboard-overview-screen.test.ts`: a summary of 2 · €320.00 / €220.00 / €110.00 against
  `takings.tenderTotal` €330.00 shows `bills-closed` "2 · €320.00", `transfer-total` "€220.00" and
  `tender-total` "€110.00".
- `dashboard-sales-screen.test.ts`: a device with cash €10 and transfer €220 shows no
  `tender-row-device-1-transfer`, `tender-total` €110.00, `transfer-total` €220.00, and `bills-closed`
  "2 · €320.00"; one check in Spanish reads "A pagar por transferencia" and "Cuentas cerradas".
- `apps/dashboard/src/api/live-queries.test.ts`: six new rows in the existing "refreshes %s when its
  contributing %s query changes" table (`:95–218`): `getDailyClose` through `working_orders`,
  `bill_payments`, `bill_payment_refunds` and `devices`; `getSalesOverview` through
  `bill_payments` and `bill_payment_refunds`.
- About 14 dashboard test stubs gain `closureSummary` (setup only; each stub's `received` equals its
  `tenderTotal`, so every existing assertion holds unedited). The a11y suites rerun on the same
  `renderMetric` primitive; no new a11y case.
- Deletion controls, recorded in the PR, not committed: the window on `s.issued_at` (case 2 fails);
  no node clause (case 3); `received` = `tenderTotal` (server case reads "56.00"); `received`
  leaving out card (reads "18.00"); the overview reading `takings.tenderTotal`; the Sales table
  keeping transfer rows; the Sales footer reading `cash.tenderTotal`; each new live-refresh table
  removed again (its row fails).
- Commands:
  `pnpm --filter @waitron/reporting exec vitest run src/closed-bills.test.ts src/cash-up.test.ts src/record-daily-close.test.ts src/daily-close-hash.test.ts src/verify-daily-close-chain.test.ts`;
  `pnpm --filter @waitron/server exec vitest run src/report-api.transfer-close.test.ts src/report-api.overview.test.ts src/report-api.reports.test.ts src/business-day-history.test.ts src/device-delete.history.test.ts src/venue-details.test.ts src/transfer-close-refusal.test.ts src/transfer-close.replay.test.ts`;
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`
  with `git diff main -- packages/fiscal-verifactu/src/write-path.e2e.test.ts packages/fiscal-verifactu/src/inmutabilidad.test.ts packages/reporting/src/daily-close-hash.ts packages/reporting/src/close-types.ts`
  empty; after `memory_pressure` shows headroom, the dashboard overview, Sales, their a11y suites,
  the edited `dashboard-app*.test.ts` files and the i18n tests. Typecheck reporting, server, dashboard.

**Implementer dispatches** (each well under 100 tool calls): (i) 5a; (ii) 5b items 1 and the server
test; (iii) 5b items 2–7 and the dashboard tests.

## Size

One PR, about 105 production lines (reader ~30 with its export, API ~25, dashboard types, screens,
words and six live-refresh entries ~50) and about 235 test lines (reporting ~85 with fixtures,
server ~75 with the cash and card bills, dashboard ~40 plus ~30 of stub setup, live-refresh rows
~6). Under 150 production lines, so 5a and 5b are two commits, not
two PRs. Review weight: the API response and its dashboard twin are a contract between packages, so
the full `/finish-branch` wave.

## Left out, and why

- **Changing `cash-up.ts` or what a frozen close stores**: the transfer line is already there, on
  the right day, and forces no count (measured above); changing it would change future snapshots.
- **Day-start-time, summer-time, two-box, two-device and failover cases**: no real event makes the
  stored day and the report window differ (see "What changed"); one node today.
- **A per-device transfer line on screen**: the frozen close keeps one per device; the screens show
  the day's total (the stated departure from §4 under change 4).
- **The demo seed's sales**: it records sales with no bill behind them
  (`apps/server/scripts/demo-seed/seed-sales.ts:283–300`, no `workingOrderId`), so a demo stack shows
  "Bills closed 0 · €0.00" beside hundreds of euros in Tender total. The till's sale path always runs
  under a bill, minting one when the request names none (`till-sale.ts:2412–2415`; read, not run),
  so this is not a real-venue event; the seed is not changed, and the PR says so; it is listed in
  `docs/backlog.md`'s Setup section.
- **New frozen-close race tests**: already tested in Tasks 0–3 (table above).
- **Top sellers, categories, VAT and period reports**: they count invoices on the day they were
  issued (`business-day.ts:229–233`) and say nothing about money received; nothing to change.
- **A guide change**: no guide page describes the overview or Sales report (grep of
  `apps/server/src/guide/` for "Tender total", "Takings" and their Spanish words: none), and
  nothing staff do changes until Task 7.
- **The accountant export**: Task 6.

## Open questions (each with a default the build follows unless told otherwise)

1. **Bills closed total is the invoices as issued**, not net of a later credit note and without
   tips. Example: a €100 bill credited €20 and then paid €80 reads Bills closed €100, Tender total
   €80, the credit in Corrections. Default: as stated (the master plan's rule).
2. **"To be paid by transfer" shows even at €0.00.** Default: always shown; hiding it at zero is one
   more branch and test.
3. **`takings.tenderTotal` stays in the overview's response though no screen draws it.** Removing it
   edits two existing assertions. Default: keep; it goes when someone next changes that suite.
4. **The new read scans `working_orders` by `settled_at`, which has no index** (`orders.ts:115–116`),
   as the cash-up already scans `tenders` (`sales.ts:289`). Not measured. Default: no index here (it
   is a schema change); add it in A1308's orders-and-sales slice if the bench shows a cost.
5. **A settled €0.00 bill (everything given away) counts as a closed bill**, so it adds
   "1 · €0.00". Default: yes, it was closed.

## For the watcher

Questions 1–5 have defaults; nothing blocks the build. Rebase onto `main` after #2797 lands.
