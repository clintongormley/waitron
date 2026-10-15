# A737 Part 1 — Find a bill page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans, inline. Native implementation is already authorised; do not ask for confirmation or dispatch per-task agents. Steps use checkboxes. This authoring pass changes plans only and makes no commits.

**Goal:** Land the Bills/Transactions page, server search/filter/sort/paging, historical receipt view, Reprint and printing in another language **before** implementing post-invoice Refund.

**Architecture:** Compose bounded list queries in `apps/server`; expose module-owned zone SQL through the venue-service contribution. Consume the already delivered server mode of `wt-data-table`. Navigate into existing order/payment/collection flows and read historical receipts by sale ID without issuing or replaying sales.

**Tech Stack:** TypeScript, Lit, Hono, Drizzle/SQLite, Vitest real venue databases and Chromium.

**Spec:** [A737 approved detail and board 4](../../backlog/till.md#a737-find-a-bill-becomes-a-page-with-bills-and-transactions-tabs), amended by **WATCHER 2026-10-15 22:40** in `/Users/clintongormley/waitron-campaign-f/questions.md`. Text wins over the mockup. [Part 2 plan](2026-10-15-a737-post-invoice-refund.md) preserves Refund acceptance as its own FULL PR, with two Codex run-it reviews, after Part 1 lands.

## Global Constraints

- **Explicit split:** Part 1 is the page/lists/search/filters/receipt/printing PR. No refund schema, migration, route, orchestration, recovery loop, reporting change, refund UI or refund-specific gate belongs here. Existing corrective invoices can be read; no charge correction is built. Do not require Part 2 acceptance before finishing or landing Part 1.
- **50 rows per page.** SQL performs search/rank/filter/sort/count/paging before rows cross into JavaScript. No unbounded held/waiting/order-list hydration. Other tables retain their local behavior.
- **Task 4 is complete:** preserve commits `2716d7fa0` and `50db01968`, including code, tests and table documentation. No replay of their implementation or RED cycle.
- Read `CLAUDE.md` and the relevant UI/data/design-system/testing/writing/workflow topic files before implementation. Read the TDD skill before writing code/tests; observe the expected failing behavior before each remaining implementation step, then GREEN. Signed-off commits only; never bypass hooks.
- Preserve original fiscal records, sales, tenders, settlements, numbering/hashes, append-only guards, shipped migrations and existing behavioral/golden assertions. Read/reprint routes create no new invoice or money movement. Existing collection remains its existing operation.
- Keep person/session, active-device/profile/admission, location and service-zone gates. Reads follow existing session-only action policy; printing and collection retain their own capabilities and permissions. Zone-less records follow `zone-access.ts` policy, including with an empty allowed-zone set.
- A737 precedes A182 under the newer Lane F order: integrate the current canvas shell; do not wait for canvas retirement. A738–A740 and other lanes' shared-file hunks remain separate. Import table types from the component file to avoid UI barrel contention.
- Keep unpaid full-invoice collection available while new full-invoice issuance is disabled; preserve cash/card, partial payments, replay, unknown outcomes, receipts and drawer behavior.

## Review Focus

- Multiple tenders/attempts cannot multiply rows, counts or amounts; every captured card last-four remains searchable (Task 3).
- Empty/error/shrinking pages keep the shared toolbar, filters, date controls and paging recovery usable (Tasks 4–5).
- Venue civil dates, DST and scheduled business-day cutovers govern filtering in another browser time zone (Task 1).
- Corrections, substitutions and orderless invoices retain their own fiscal identity and original access scope (Tasks 3, 6).
- Late reads after navigation/session/profile changes or collection cannot restore old results or restart a collection (Tasks 5–7).

## File map and current interfaces

| Files | Responsibility |
| --- | --- |
| New server `find-bill-types.ts`, `find-bill-query.ts`, `find-bill-dates.ts` | Wire contract, strict parsing, venue date windows. |
| New server `find-bill-bills.ts`, `find-bill-transactions.ts`, `find-bill-api.ts` and sibling tests | Scoped SQL rows/counts/options/by-ID selection and routes. |
| `packages/module/src/module.ts`; venue-service `operations.ts`, `service.ts` and tests | Module-owned `orderZoneIdSql` expression. |
| New till `api/find-bill-types.ts`, A737 hunks of `api/client.ts` and tests | Browser-safe mirror and typed reads/printing. |
| New till `screens/till-find-bill-screen.ts`, behavior/a11y tests | Shared table, tabs, filters/date chips, request lifetime and row events. |
| New server `transaction-receipt.ts`, `transaction-receipt-api.ts` and tests | Read-only sale-ID projection and duplicate printing. |
| Till `till-app.ts`, `navigation.ts`, `widgets/tab-shell.ts`, `screens/till-ticket-view.ts`, `widgets/find-bill-dialog.ts` and focused tests | Full-page destination, existing order/collection handoffs and receipt return. |
| `apps/till/src/i18n/strings.ts`; backlog root/till detail at Part 1 delivery | EN/ES labels; record landed Part 1 and retain Part 2. |
| Existing `wt-data-table.ts`, server-paging/a11y suites and `design-system.md` table contract | **Already delivered, consume unchanged (Task 4).** |

Source checks for this revision: `ReadOptions` is `{signal?:AbortSignal}` (`apps/till/src/api/client.ts:76`); `OrderZoneCondition=(orderId:SQL)=>SQL` and `orderZoneCondition(tx,cfg,profileId)` are in `zone-access.ts:96–109`. `TillConfig`/`DeviceRequestConfig` are in `till-config.ts`; contribution changes belong in `VenueServiceContribution` (`module.ts:568`) and its `VENUE_SERVICE` implementation. These are source observations, not runtime test results.

`orders-list.ts` has a different cursor contract; keep it unchanged. `/api/bills/lookup` and `/api/invoices/lookup` are bounded legacy selection searches, not list sources. `readSettledTicket(backend,tx,cfg,workingOrderId)` calls `replayPrepayMadeHere` (`till-sale.ts:761–767`), so it is unsuitable for the new historical GET. Existing `readTenderBlock(tx,cfg,saleId,workingOrderId|null)` returns `{method:'unpaid'}` without tenders (`:330–354`); filed F1 receipts need not be settled to be viewed.

Keep joins in the server, using exported db/identity/payments schemas and `VENUE_SERVICE` from `apps/server/src/modules.ts`; no reporting/db/venue-service dependency on payments and no server imports in the till.

## Task 1: Pin the wire contract, date windows and zone expression

**Files:** Create the three contract/date/query server files and `apps/till/src/api/find-bill-types.ts`; modify the three contribution files in the map. Test: new `find-bill-dates.test.ts`, `find-bill-query.test.ts`; extend `packages/venue-service/src/operations.test.ts`, `service.test.ts`.

**Interfaces:** Define these server/browser wire types identically; server SQL types never cross the wire. Server imports `BusinessDayClock`, `businessDayAt`/`businessDayBounds` from `@waitron/shared`, and `readLocationClock`/`civilDateOf` from `@waitron/reporting`.

```ts
type FindBillDates = { preset: 'today' | 'yesterday' | 'business-day' | 'last-7-days' | 'this-month' }
  | { preset: 'custom'; from: string; to: string } | { preset: 'any' };
type FindBillSort = { key: string; direction: 'ascending' | 'descending' };
type FindBillQuery = { q: string; page: number; sort: FindBillSort; staffId?: string };
type BillsQuery = FindBillQuery & { zoneId?: string; state?: BillState };
type TransactionsQuery = FindBillQuery & { dates: FindBillDates; method?: TenderMethod; type?: TransactionType };
type BillState = 'unpaid' | 'held' | 'part-paid' | 'paid-not-handed-over';
type TransactionType = 'sale' | 'full-invoice' | 'correction';
type TenderMethod = 'cash' | 'card' | 'voucher' | 'transfer' | 'other';
type FindBillPage<Row> = { rows: Row[]; total: number; page: number; pageSize: 50; openCount: number };
type FindBillOptions = { zones:{id:string;name:string}[]; billStaff:{id:string;name:string}[]; transactionStaff:{id:string;name:string}[] };
type DateWindow = { startAt: string; endAt: string; from: string; to: string } | null;
type TransactionsPage = FindBillPage<TransactionRow> & { dates: DateWindow };
resolveFindBillDates(clock: BusinessDayClock, dates: FindBillDates, now: Date): DateWindow;
parseBillsQuery(params: URLSearchParams): BillsQuery;
parseTransactionsQuery(params: URLSearchParams): TransactionsQuery;
// Added to VenueServiceContribution and implemented in venue-service:
orderZoneIdSql(cfg: { locationId: LocationId }, orderId: SQL): SQL;
```

- [x] Write failing tests: `rejects invalid list query` asserts `management.request_invalid` with the field for negative/fractional/unsafe page or computed page×50 offset, unknown sort/direction/filter enum, malformed UUID/date, reversed or partial custom range, duplicate scalar query parameters and q over 100 trimmed characters. Absent fields alone get defaults: `q=''`, `page=0`, Bills `openedAt/descending`, Transactions `when/descending`, dates `today`; no other filters. Preserve trailing search whitespace. Reject unknown parameters, including offset/page-size/limit, rather than accepting an unbounded size.
- [x] Write `uses venue civil days and historical business boundaries`: Madrid, cutover `05:00`, now `2026-10-15T01:00:00Z`: Today = `[2026-10-14T22:00Z, 2026-10-15T22:00Z)`; business day = `[2026-10-14T03:00Z, 2026-10-15T03:00Z)`. Assert Yesterday, Last 7 days (today plus previous six), This month (first day through next month's first), and inclusive custom From/To converted to exclusive next midnight.
- [x] Add DST cases: Madrid custom `2026-10-25` spans 25 hours; spring day spans 23. Test a scheduled cutover change, exactly start/end, invalid leap date and browser/host zone independence. `any` returns null. Use `readLocationClock`, `civilDateOf`, `businessDayAt`/`businessDayBounds`; civil presets use a midnight clock without business cutover changes.
- [x] Run `pnpm --filter @waitron/server test -- find-bill-dates find-bill-query`; observe the expected missing-function/behavior failures. Run the focused venue-service cases before implementing their expression.
- [x] Implement parsers and `orderZoneIdSql` as a parameterized scalar read of recorded context at this location, null if absent. Require a table-qualified outer ID. Tests execute it with working orders as base and as join, two differently zoned orders, missing context and wrong location; inspect `.toSQL()` for qualification. Wire through `service.ts`; add its contract-key assertion without changing unrelated assertions.
- [x] Rerun those focused suites: named Tests counts and all PASS. No new package or dependency.

## Task 2: Read and count every open bill in SQL

**Files:** Create `find-bill-bills.ts`, `find-bill-bills.test.ts`; add `BillRow` to both contract files.

**Interfaces:** `readFindBills(tx: Transaction, cfg: TillConfig, query: BillsQuery, inZones?: OrderZoneCondition): Promise<FindBillPage<BillRow>>`; `readFindBill(tx: Transaction, cfg: TillConfig, workingOrderId: string, inZones?: OrderZoneCondition): Promise<BillRow>`. The latter uses the same eligibility and scope predicates without list filters and throws `working_order.not_found` when absent/ineligible/outside scope. It supplies fresh selection data for Task 7; `collectionStatus` follows the existing collectable order projection in `orders-list.ts`.

```ts
interface BillRow {
  workingOrderId: string;
  openedAt: string;
  orderNumber: number;
  label: string | null;
  partyId: string | null;
  partyName: string | null;
  tables: string[];
  zoneId: string | null;
  zoneName: string | null;
  staff: { id: string; name: string | null }[];
  itemCount: number;
  total: string;
  paid: string;
  stillOwed: string;
  state: BillState;
  earlierDay: boolean;
  invoiceNumber: string | null;
  departedAt: string | null;
  orderStatus: 'open' | 'placed' | 'settled' | 'abandoned';
  collectionStatus: 'waiting_for_payment' | 'left_without_paying' | null;
}
```

- [x] Write failing real-db cases using `useVenueDb`, `manifestSets` and product writers: 101 visible unfinished orders produce page lengths 50/50/1 and `total=101`; equal opened timestamps have a stable ID tie-break and no repeated IDs. Empty/out-of-range page still returns the filtered total. Candidate order reads return at most 50 rows; child hydration names only that page's IDs. Inspect executed SQL for LIMIT/OFFSET and separate aggregate count, not `.slice()` over all orders.
- [x] Assert set membership: all `open`/`placed` orders plus settled **counter** orders still awaiting handover, across days; exclude abandoned, handed-over settled counter orders and finished table bills. `held` = partyless open order without a net payment; `unpaid` = other unfinished zero-paid order; positive net applied payment wins `part-paid`; settled uncollected counter wins `paid-not-handed-over`. Do not introduce a stored status or infer paid state from mere sale existence.
- [x] Assert each displayed field with distinct staff/table/zone/label fixtures; `itemCount` follows existing held summary's line count, not quantity-thousandths. Open totals sum stored gross line cents; issued totals use filed total plus corrections for debt. Before settlement, net paid sums received bill-payment applied cents less completed refund applied cents; pending/failed/declined payments and tips do not count. After settlement, read tender amount less tip, without double-counting linked bill payments. Existing pre-invoice pending refunds retain the current balance convention; this task adds no refund writer. Cross-check representative rows against `readBillBalance`, `readPaymentsByBill`/`outstandingOf` and `readIssuedSales`, without editing them.
- [x] Assert zone/staff/state filters and their intersections before paging/count; staff matches any credited line person, with retained missing-person labels. Earlier-day flag compares opening to current business-day start, not the host date. Search label, party, table, order and invoice text using `waitron_search_rank`; punctuation-only gives zero, accents/case/multiple words/trailing-space behavior matches shared `textSearch`/`searchRankKey`.
- [x] Assert ascending/descending sort on each Bills column (`openedAt`, `tableName`, `zone`, `staff`, `items`, `total`, `paid`, `state`), numeric amounts 2 < 10, null last both ways, rank first and column sort next; default openedAt descending then ID descending. Zone/staff sortable text uses a deterministic SQL label key, not browser reordering.
- [x] Run `pnpm --filter @waitron/server test -- find-bill-bills` and observe RED. Implement shared filtered relation for page/count, integer-cent arithmetic with text casts only at row output, EXISTS for many-to-many staff/table predicates, and bounded page hydration. All reads require `cfg.locationId` plus profile scope. Count/open badge never depends on page contents; `openCount` counts all eligible accessible Bills before the tab's filters/search, including paid-not-handed-over. Await queries sequentially within one `withTransaction`.
- [x] Rerun for GREEN. Keep dashboard `orders-list.ts` and old lookup signatures unchanged; they have different membership and paging contracts.

## Task 3: Read Transactions with exact counts, metadata and access scope

**Files:** Create `apps/server/src/find-bill-transactions.ts` and `.test.ts`; add `TransactionRow` to both Task 1 contract files.

**Interfaces:** `readFindTransactions(tx:Transaction,cfg:TillConfig,query:TransactionsQuery,inZones?:OrderZoneCondition):Promise<TransactionsPage>`.
`TransactionRow = {transactionId:string;saleId:string;workingOrderId:string|null;scopeOrderIds:string[];issuedAt:string;invoiceNumber:string;type:TransactionType;tableName:string|null;customerName:string|null;methods:{method:TenderMethod;last4:string|null}[];staff:{id:string;name:string|null}|null;amount:string}`.
`transactionId='sale:'+saleId` is the row key. `scopeOrderIds` is display/grouping metadata, never trusted for authorization.
Export `resolveTransactionScope(tx:Transaction,cfg:TillConfig,saleId:string):Promise<{workingOrderIds:string[];locationId:string}>`; throw `sale.not_found` when absent/outside this location. By-ID callers check all returned order subjects through `checkZones` in the same transaction; list/count SQL applies `inZones` to every source order.

- [x] Write RED real-db cases: settled F2 sales, filed F1 invoices (including an unpaid F1 also represented in Bills), negative corrective invoices, voids and unfiled/pending/failed payment attempts. Include filed paid ordinary sales, all filed full invoices and corrections; exclude voids/attempts. Part 1 has no payment-refund source or refund filter; pre-invoice bill refunds stay in existing payment history. A correction is type `correction`, never a money-refund row.
- [x] Assert 101 eligible invoices yield 50/50/1 and exact totals despite three tenders/two competing attempts; empty/out-of-range count; SQL bounds before hydration; search rank before requested sort, stable ID ties and null-last both ways. Test every column key: `when`, `invoice`, `type`, `tableName`, `method`, `staff`, `amount`. Invoice sorting uses series then numeric number; amount is signed filed total excluding tips, never a sum multiplied by payment joins.
- [x] Assert date/method/type/staff intersections before count/paging; method uses EXISTS across all tenders. Captured-card metadata uses `payments.billPaymentId` for split tenders and sale association for whole-order cards, never failed competing attempts. Distinct cards `0091` and `3210` both remain searchable and sort deterministically; absent last-four stays null. Unpaid F1 has no invented method.
- [x] Assert search on actual `formatInvoiceNumber` (`T1/12`), customer, retained order/table/party labels and all card last-four values. Numeric search `0091` must match a card with no matching invoice number. Bound SQL-looking text; preserve shared punctuation/accent/case/multiword/trailing-space rank semantics rather than the legacy number-only bypass.
- [x] Assert correction scope follows `correctsSaleId`; substitution scope follows `saleSubstitutions`. Require all known source zones permitted. Orderless sales use issuing node location and existing no-recorded-zone policy; missing joined person/party/table rows cannot erase an invoice. Use this same resolution for Task 6 and options.
- [x] Run `pnpm --filter @waitron/server test -- find-bill-transactions` for expected RED; implement one filtered invoice relation with preaggregation/EXISTS and page-only hydration; sequential reads inside one transaction. Rerun for GREEN with a Tests count. Resolve dates/openCount within the page request; no dependency on Part 2 tables or routes.

## Task 4: Shared server table paging — COMPLETE (preserve)

**Status:** Implemented in `2716d7fa0`; completion recorded in `50db01968` (confirmed with `git show --stat` during this revision). Consume these interfaces unchanged. Do not reimplement this task or change its code/tests. The checked steps below retain the prior implementation record, not instructions to repeat it.

**Files already delivered:** `wt-data-table.ts`; `wt-data-table.server-paging.test.ts`; sibling `wt-data-table.a11y.test.ts`; optional-mode documentation in `design-system.md`.

**Delivered interfaces:** `serverPaging?: { page:number; pageSize:number; total:number }` (absent preserves local behavior), `pageRangeLabel(from:number,to:number,total:number):string`, `previousPageLabel`, `nextPageLabel`; emit `wt-page-change` detail `{page}` and `wt-query-change` detail `{search:string,sortKey:string,sortDirection:'ascending'|'descending',filters:Record<string,string|string[]>}`. The table owns query controls, never networking. Add `externalFilterCount=0` and `wt-filters-clear` for slotted date controls; keep `filters-start` and `toolbar-bottom` slots. Existing sort/filter events remain.

- [x] Write RED cases: server mode renders the incoming 50 rows in their exact order even when local search/sort/filter values would hide/reorder them; query event reports the complete effective restored state once columns are ready, and once per meaningful edit. Include initial filter values, hidden-sort-column fallback, chooseFilter, Clear all, restore, and storage refusal. Rows/total/loading updates must not emit another query.
- [x] Test footer `51–100 of 2,314`, first/last/zero/single page, disabled Previous/Next while loading, one page event per click, no optimistic slice, no page persistence. Consumer controls page; count shrink requests/clamps only in the consumer. New controls read `--wt-*` tokens; names and range formatting are caller-localized.
- [x] Test server empty/loading/error states retain toolbar, Filters, date slot, chips and retry controls; date-only active filters count and Clear all emits even when no column filter is active. Keep the date panel open during requests and zero results. Focus/Tab includes slotted date fields on phone popover and Escape restores the Filters trigger.
- [x] Run `pnpm --filter @waitron/ui test -- wt-data-table.server-paging` for expected RED. Implement opt-in flat rendering bypass and events at existing query mutation points, avoiding changes to the local tree/search path. Server consumers must supply flat data; no new server-tree semantics.
- [x] Rerun that suite and existing `wt-data-table` suites for GREEN. Extend axe coverage in light/dark for loading, empty, error, page 2, date filters open at phone width; assert actual rendered controls before scanning. Keep existing local assertions intact.

## Task 5: Mount list/options routes and build the full-page screen

**Files:** Create `find-bill-api.ts`, `find-bill-api.test.ts`, `till-find-bill-screen.ts`, `till-find-bill-screen.test.ts`, `till-find-bill-screen.a11y.test.ts`; modify `api/client.ts`, `api/client.test.ts`, `i18n/strings.ts`, and the two profile route-map suites. Mount from `till-api.ts` beside existing lookup mounts.

**Interfaces:** `mountFindBillApi(app:Hono,deps:TillApiDeps,log:Logger,run:Run):void` mounts GET `/api/bills`, `/api/bills/:workingOrderId`, `/api/transactions`, `/api/find-bill/options`. Preserve `/api/bills/lookup`: register the static lookup before the parameterized route. TillApi adds `listBills(query:BillsQuery,options?:ReadOptions):Promise<FindBillPage<BillRow>>`, `listTransactions(query:TransactionsQuery,options?:ReadOptions):Promise<TransactionsPage>`, `getFindBill(workingOrderId:string,options?:ReadOptions):Promise<BillRow>`, `findBillOptions(options?:ReadOptions):Promise<FindBillOptions>` with the corresponding page/options results. `readFindBillOptions(tx:Transaction,cfg:TillConfig,inZones?:OrderZoneCondition):Promise<FindBillOptions>` supplies scoped distinct options from the Bills/Transactions eligibility relations, not page rows. Transactions also returns `dates:DateWindow` for Transactions' resolved chip; Bills has no date filter.

Query encoding: `q`, `page`, `sort`, `direction`, `staffId`; Bills also `zoneId`, `state`; Transactions also `preset`, custom `from`/`to`, `method`, `type`. Page is zero-based, fixed size 50; reject foreign-tab filters. Client returns `FindBillPage<BillRow>`, `TransactionsPage` and typed options respectively. The screen has `.api:TillApi` and `.active:boolean`; leaving deactivates pending reads even if retained for return-state memory.

- [ ] Write API RED cases: missing/ended session, revoked device, changed profile admission; allowed signed-in read without payment/print capability; out-of-scope zone requested gives `service_zone.not_allowed`. Scope page/count/options and by-ID selection in SQL via `orderZoneCondition`; test empty permitted-zone set and the legitimate no-context control. Options include historical staff/zone values represented by accessible rows, including inactive staff, so a filter on page 2 survives page 1. Static method/type/state choices are client-localized. Part 1 offers only sale/full-invoice/correction types; completed money-refund rows and the Refund action arrive in Part 2.
- [ ] Write browser/client RED cases: URL encoding retains trailing query space and leading-zero last four; AbortSignal forwarded; reject HTTP/domain errors. Screen initially opens Bills with every open order and Transactions today; table toolbar/Filters/Customise, separate view keys, all specified columns and filters, newest-first defaults. Date controls use shared `wt-input type=date` and `wt-combobox` in `filters-start`; resolved dates and each column filter appear as removable chips in `toolbar-bottom`.
- [ ] Test Today, Yesterday, This business day, Last 7 days, This month and From/To; invalid custom dates mark fields and send no request; removing date chip/Clear all selects `any`. Clear one chip preserves others. Filters badge includes dates. Search/tab/filter/sort changes reset to page 0; pagination preserves the requested page; Previous/Next asks exactly that server page. Map table filters `zone`→`zoneId`, `staff`→`staffId`, `state`/`method`/`type` unchanged; map table `search`→`q`. An empty effective `sortKey` falls back to the tab default. Listen only to `wt-query-change` for column-query fetches (not also legacy sort/filter events). No client-side filtering/sorting or accumulated page cache.
- [ ] Test deferred responses delivered backward, Back/unmount, logout/profile teardown and aborted loads; only the latest query visit may replace data/error. Debounce typed search 200ms, abort superseded reads, avoid initial unfiltered request before restored table state. Keep controls usable after zero/error; Retry repeats current query. On count shrink, replace with last valid page once, without loop or showing the old range.
- [ ] Run `pnpm --filter @waitron/server test -- find-bill-api` and `pnpm --filter @waitron/till test -- find-bill-screen client` for RED, implement the mount/client/screen, rerun for GREEN. Screen emits `find-bill-back`, `find-bill-open` `{row:BillRow}` and `find-transaction-open` `{row:TransactionRow}`. Use `part` for cell styles, tokens, EN/ES labels and actual shared table; do not build another toolbar.
- [ ] Add route rows/refusal cases to both maps, explicitly recording reads' session-only action policy. Exercise phone keyboard access/Customise and axe both themes. No polling is needed for A737; a manual retry or return from an action reloads the page.

## Task 6: Read and reprint historical invoice receipts by sale ID

**Files:** Create `apps/server/src/transaction-receipt.ts`, `transaction-receipt-api.ts` and sibling tests; extend till wire/client methods and tests. Reuse receipt helpers and `screens/till-ticket-view.ts` without changing issuance or receipt golden assertions.

**Interfaces:** `readTransactionReceipt(backend:FiscalBackend,tx:Transaction,cfg:TillConfig,saleId:string):Promise<TillSaleResult>`; `mountTransactionReceiptApi(app:Hono,deps:TillApiDeps,log:Logger,run:Run):void`. Routes: GET `/api/transactions/:saleId/receipt`; POST `/api/transactions/:saleId/reprint` with `{language?:string}`. Client: `getTransactionReceipt(saleId:string,options?:ReadOptions):Promise<TillSaleResult>` and `reprintTransaction(saleId:string,language?:string):Promise<void>`.

- [ ] Write RED cases for original F2, paid/unpaid F1, correction, substitution and orderless sale IDs with different number/date/lines/amounts. Select each sale's own filed record/QR, signed total, frozen names/extras/discounts/recipient/domicile after catalogue edits. GET changes no fiscal/order/payment rows and creates no print job. Malformed/missing/out-of-location ID gives `sale.not_found`; forbidden original source zones refuse before facts or side effects. Include allowed controls and an empty permitted-zone set's zone-less case.
- [ ] Run `pnpm --filter @waitron/server test -- transaction-receipt` and observe RED. Build the projection from sales/sale_lines plus `backend.filedReceiptFor`, using `invoice-document.ts:30`'s sale-ID mapping as reference; do not import its F1-only refusal or call `readSettledTicket`. Use `readReceiptIssuer`, `readReceiptPresentation`, `receiptLines`, `readTenderBlock`, `readBillTenderLines` and `receiptQr` where their actual signatures apply. Frozen sale facts determine content; Task 3 source orders determine access/grouping. No repricing or fabricated order ID.
- [ ] Write/run RED reprint cases: absent/valid/unknown/nonstring language, filed language no longer offered, names fallback, no printer, forbidden printer/profile/zone/session. Follow `printSaleReceipt` language policy: own filed language or currently offered. GET is session-only; POST follows `/api/sales/:id/reprint` (`till-api.ts:2540–2557`): `requireSession` and `assertDeviceCapability(...,"print-receipt","reprint",session.device)`, with no additional person permission invented. Record these routes and refusal/allowed cases in both profile route-map suites.
- [ ] In the route's transaction resolve Task 3 scope and `checkZones`, then `resolveReceiptPrinter(tx,cfg.origin)` and `enqueueReceiptCopy(tx,cfg,ticket,saleId,printer,language,personId)`. Preserve the existing no-printer no-op. Insert `receiptReprints` only for a returned job, following `orders-reprint.ts:11–46`; F1 delivery enrollment remains in `enqueueReceiptCopy`. Assert one duplicate document/audit job, zero drawer jobs and unchanged fiscal/sale/settlement rows. Rerun new and existing receipt/language suites unchanged for GREEN.

## Task 7: Wire navigation, order opening, unpaid collection and receipt return

**Files:** Modify A737 hunks of `till-app.ts`, `navigation.ts`, `widgets/tab-shell.ts`, `screens/till-ticket-view.ts`, collection dialog and its tests; create `till-app-find-bill.test.ts`. Extend existing till-app unsaved/navigation and collection suites rather than deleting their behavioral assertions.

**Interfaces:** Add `find-bill` as a full-page destination rendered by `#drillBody`; keep per-tab screen state while opening/returning from a transaction. Collection dialog takes `bill:BillLookupRow` (selected-only) and retains `FindBillPayDetail`, `busy`, `error`, `closeSaved()` and the existing three collection events. Historical receipt context = `{saleId:string,workingOrderId:string|null,returnTo:'find-bill'}`; ordinary sale receipt context remains unchanged.

- [ ] Write RED navigation cases: ☰ always opens Find a bill as a page, never a modal or a second header shortcut; Back returns to counter with its basket intact. Browser Back/deep destination, repeated visits and session teardown clear transient requests and restore focus. Route through `#requestLeave`/existing navigation guards; test an edited basket can stay or discard before an order replaces it. Do not implement A738's other menu rearrangements.
- [ ] Test bill activation dispatch after `api.getFindBill(row.workingOrderId, {signal})`: party-linked bill opens that party's order and selected bill through existing table/bill loading (`#onOpenTable`, then `#onTakePayment`); partyless open held order uses `#onRetrieveOrder`; uninvoiced placed counter uses `#onPayWaitingOrder`; paid-not-handed-over opens existing receipt/handover behavior. Stale/settled/changed-zone reads produce the existing refusal without replacing the basket or taking payment. An open partly paid counter bill uses `#openBillPaying('contribution', payLines(this.counterLines?.lines ?? [], (line) => line.name ?? ""), undefined, {surface:'counter',billId,visit:session})` after `api.retrieveWorkingOrder(id)` and guarded basket loading; do not pass part-paid orders through `#onRetrieveOrder`, whose `#refusePaidInPart` deliberately refuses that path; a party bill uses its existing bill-payment controls. Never send either to whole-order tender collection or add A739's new counter payment chooser.
- [ ] Test unpaid issued full invoice opens the selected-only collection dialog with current `stillOwed`; map the fresh BillRow to BillLookupRow, taking its `status` from non-null `collectionStatus`. Include an earlier-day departed bill. Cash comma/dot/leading zeros and short-cash field refusal; manual card reference trimming; double-click busy gate; exact original `collectOrder(id,tender)` payload. On success call `closeSaved()`, preserve the original invoice (`#showTicket(id,false)`), and refresh separately. Lost answer remains unconfirmed; refresh failure never reopens the collector. Keep `find-bill-dialog.unsaved.test.ts` and `payment-leading-zeros.test.ts` assertions after replacing search setup with a selected bill.
- [ ] Test transaction activation opens the sale-ID receipt, Reprint/another-language use Task 6, and Back returns to the same tab/query/page rather than starting a new sale or clearing a basket. Historical context does not run original-print/handover/delivery reads against a nonexistent working-order ID; default post-payment ticket behavior stays unchanged.
- [ ] Retain collection draft protection when switching selection or leaving: its current `leaveCoordinatorFor` registration still owns cash/reference edits and busy dismissal. The new read-only page needs no save draft. Task 5’s by-ID read must finish before opening collection; never turn a stale page amount into an authoritative charge.
- [ ] Run `pnpm --filter @waitron/till test -- till-app-find-bill find-bill-dialog payment-leading-zeros` for RED. Implement these handoffs through the inspected existing handlers, preserving their session/generation and unsaved protections; rerun for GREEN plus the existing bill-payments/drafts/unsaved suites.

## Task 8: Part 1 verification and independent PR handoff

**Files:** New Part 1 suites and existing profile maps; at delivery, only the A737 entries in `docs/backlog.md`/`docs/backlog/till.md`. Preserve shared table code/tests/docs from Task 4.

- [ ] In a disposable candidate checkout remove one gate at a time: session, list scope, count scope independently, by-ID receipt scope, reprint capability, fixed LIMIT, date predicate, last-four association and latest-response guard. Run the owning named case and retain its expected failure; restore between controls. Include permitted controls against deny-all implementations. No refund controls or financial-writer assertion changes belong in this PR.
- [ ] Run focused regressions unchanged: server `bill-lookup-api`, `invoice-lookup-api`, `collect-by-invoice`, `till-api.profile-actions`, `till-api.profile-zones`, `till-api.receipt`, `receipt-language`; till `till-app-bill-payments`, `till-app-drafts`, `till-app.unsaved-changes`, `find-bill-dialog`, `payment-leading-zeros`; UI `wt-data-table` suites. Require real Tests counts. Table tests are regression runs only, not Task 4 reimplementation.
- [ ] Run `pnpm exec vitest run scripts/workspace-cycles.test.ts scripts/module-seams.test.ts scripts/native-form-fields.test.ts scripts/style-token-names.test.ts scripts/pinned-actions-column.test.ts`. Let normal pre-push checks run once; wait for package coverage/merge CI on the current head. No whole-workspace local run solely to finish.
- [ ] Build `pnpm --filter @waitron/till build`; use only `wa-wt demo waitron-feat-a737-find-bill-page` for a needed live stack. LOOK in Chromium: both tabs/themes, desktop/phone, zero/50/51/101 rows, filters/date chips/loading/error, receipt return, Reprint/another language, existing unpaid collector and basket-preserving Back. Check actual controls, focus, range announcements and horizontal scrolling; retain receipts/screenshots. Stop only owned processes.
- [ ] Self-review Part 1 against A737/board 4 and this split. At Part 1 delivery record the split on A737's backlog heading/root entry, remove delivered page detail as appropriate and retain a distinct short Part 2 post-invoice Refund entry linked to its plan. Do not delete all of A737 or close the payments durable-refund entry; Part 2 owns those. Do not change A738–A740 or redesign decisions.
- [ ] Announce readiness for `finish-branch` when Part 1 acceptance/validation is complete. Assess LIGHT/FULL from Part 1's own risk under the active lane rules; Part 2's FULL/two-review requirement is not a Part 1 gate. Follow the applicable normal whole-branch review, signed-off commits, hooks and current-head CI. Open/land Part 1 independently before starting the Part 2 PR; no new confirmation is needed for the authorised native implementation. This plan author does not commit, push, change campaign state or run finish.

## Plan self-review (2026-10-15)

- A737 page/list/date/search/paging/receipt/printing acceptance maps to Tasks 1–8. Refund acceptance is preserved exclusively in Part 2; its absence here is the watcher's explicit delivery split.
- Task 4 commits and current table properties/events were inspected; downstream Task 5 uses their exact interface. No new table implementation task remains.
- Wire types, column sort keys, list/options/by-ID/client results and sale-ID receipt context agree. Static legacy lookup route precedes the new by-ID route; fresh `collectionStatus` maps to existing `BillLookupRow.status`.
- Every Review Focus condition has behavioral cases in its owning task. No refund migration/route/UI/reporting or refund-specific review/omission gate is required by Part 1.
- No unresolved conflict between the A737 detail and the explicit watcher amendment was found. These are plan/source checks; this authoring pass runs no product tests and claims no implementation completion beyond the preserved Task 4 record.
