# The dashboard's Orders screen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Do not start this plan until the owner has approved the spec.** The spec is a draft for the
> owner's review. This plan is built on the spec's RECOMMENDED answer to each of its §12 choices. If
> the owner picks another answer, change the task named below before running it:
>
> | §12 choice                              | Recommended (built here)             | Tasks that change if the owner picks otherwise                                                   |
> | --------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------ |
> | 1. How the till finds a debt            | (a) a "Find a bill" box on the till  | Task 3, whole. (b) needs a new "send to till" mechanism; (c) keeps a list, searchable, on the till. |
> | 2. Who sees the Orders screen           | `report.view`                        | Task 1 (the route's gate, `ORDERS_PERMISSION`); Task 2 (the nav item's `requiresPermission`).     |
> | 3. Dates when filtering Unpaid          | switch to Any date                   | Task 2 only (`withStatus` in `orders-filter.ts` and its test).                                   |
> | 4. Who counts as a bill's staff         | anyone a line is credited to         | Task 1 only (`staffClause` and `readStaff` in `orders-list.ts`, and their tests).                |
> | 5. Reprint and credit from the dashboard | left out                             | None of 1–3 changes; a new Task 4 is written. Task 2's row menu gains the items.                 |
> | 6. Cancelled bills                      | listed when sent or holding lines    | Task 1 only (`LISTED_BILL` in `orders-list.ts` and the cancelled cases in its test).             |
| 7. A sent bill cancelled with its invoice | Cancelled, marked Invoice not credited | Task 1 (`invoiceNotCredited`, its three cancel cases) and Task 2 (the mark, its strings, its case). Whether the till should refuse that cancel is a separate till question, not in this plan. |

**Goal:** A dashboard screen listing every bill, filterable by status (including "Unpaid"), dates,
staff, table and an invoice-number or name search, with a detail dialog; and a "Find a bill" box on
the till that collects a debt, replacing the counter's read-only "Left without paying" list.

**Architecture:**

- **One query module, two consumers.** `apps/server/src/orders-list.ts` reads a page of rows (a bill,
  with its invoice beside it; or an invoice that has no bill) and one row's detail, with a fixed
  number of queries per page. The dashboard's routes (`apps/server/src/orders-api.ts`, Task 1) and
  the till's lookup (`apps/server/src/bill-lookup-api.ts`, Task 3) both call it, so a row's status
  and "still owed" figure are decided in one place.
- **"Still owed" reuses the till's own figures**: `readIssuedSales` (`apps/server/src/sale-due.ts:24`)
  for an invoiced bill, and `readPaymentsByBill` + `outstandingOf`
  (`apps/server/src/bill-payments.ts:488-506`) before an invoice — the same functions the collect
  route and the party's bill list use.
- **The screen reads pages through the live query machinery.** Show more raises the number of pages
  watched; every refresh re-reads all pages shown, passively after the first read.

**Tech Stack:** TypeScript, Hono routes, Drizzle on SQLite (`node:sqlite`), Lit web components,
Vitest (`useVenueDb` real databases for the server; real headless Chromium for the dashboard and
till).

**Spec:** `docs/superpowers/specs/2026-10-01-dashboard-orders-design.md`. Read it whole first. Where
this plan departs from it, the departure is listed under "Decisions this plan makes" below and in
the reply that delivered the plan.

---

## Decisions this plan makes (the spec was corrected to match on 2026-10-01; each still needs the owner's nod)

1. **"Voided" is checked second, not sixth.** The spec's order (§4.2) puts Voided last, after
   Waiting for payment and Paid. `recordVoid` (`packages/core/src/record-void.ts`) writes a
   `sale_voids` row and never changes the bill's own status, so a voided invoice's bill is still
   `placed` or `settled`, and rule 3 or 4 would always win: Voided could never show. Order used:
   Open, Voided, Left without paying, Waiting for payment, Paid, Cancelled. Left without paying
   and Waiting for payment also need the bill's own status to be `placed`, so a debt cancelled at
   the till afterwards reads Cancelled (decision 8) and every open-or-unpaid status comes from a
   bill whose status is `open` or `placed` — which is what lets those filters start from
   `working_orders_tenant_status_idx` (decision 10).
2. **A row with no bill is "an invoice with no bill", not "a walk-up sale".** Read, not run (Task 1
   Step 0 measures it): `POST /api/sales` with no `workingOrderId` goes through `recordTillSale` →
   `payWorkingOrder`, which creates an open working order first (`apps/server/src/till-sale.ts`,
   `createOpenOrder` inside `payWorkingOrder`, around `:483`), and files the sale against it. So a
   till walk-up IS a bill. The sales with no bill are the ones the demo seed and the scripts write
   through core `recordSale` (`apps/server/scripts/demo-seed/seed-sales.ts:278`), less credit notes
   and substitutions. They are kept as rows so the demo venue's history shows.
3. **A full invoice that substitutes a simplified one is not its own row**; it shows in the detail
   of the row it replaced. `sale_substitutions` (`packages/db/src/schema/sales.ts:306`) is left out
   of the no-bill rows the same way the reports leave it out (`notSubstituteClause`,
   `packages/reporting/src/business-day.ts:248-250`).
4. **A debt whose credit notes bring it to nothing** keeps the status Left without paying on the
   dashboard, with a blank Still owed and the "Credited in full" mark; the till's lookup leaves it
   out, as today's till list does (`listUnpaidDepartures`, `apps/server/src/unpaid-departure.ts:265`).
5. **The detail dialog shows no adjustments section.** The core route may not name the adjustments
   module (CLAUDE.md §3, the composition rule), and that module has no read of one bill's
   adjustments. Each line shows the price it had before an adjustment touched it
   (`working_order_lines.list_unit_price_gross`, `packages/db/src/schema/orders.ts:186-188`).
6. **The till's debt payment offers cash and a hand-keyed card**, which is what
   `POST /api/working-orders/:id/collect` takes (`collectOrder`, `apps/server/src/till-sale.ts:1590`).
   It is not the basket's payment step: that step loads the bill through
   `getPlacedCounterOrder`, which refuses a party's bill (`isNull(workingOrders.partyId)`,
   `apps/server/src/working-order.ts:3275-3286`). An integrated reader for a debt is a later item.
7. **The Status filter offers Voided** as its own choice, as spec §4.3 now lists it.
8. **A sent bill cancelled after its invoice was issued** (spec §4.2 rule 6, choice 7) reads
   Cancelled, shows its invoice number, leaves Still owed blank, and carries an "Invoice not
   credited" mark — `invoiceNotCredited: true` on the row — unless the invoice is voided (the row
   then reads Voided) or its credit notes bring it to nothing. Read, not run: `cancelPlacedOrder`
   (`apps/server/src/working-order.ts:4712`) checks the bill is `placed` and never looks for an
   invoice. Task 1 Step 2's cancel case is the run.
9. **A bare number in the search also finds the bill with that order number**
   (`working_orders.order_number`, spec §4.3), on the dashboard and in the till's Find a bill. Order
   numbers repeat over time, so a bare-number search can return several bills.
10. **Any-date reads for Open, Waiting for payment, Left without paying and Unpaid start from bills
    whose own status is `open` or `placed`** (spec §4.6): the bill half of the query gets
    `wo.status in ('open', 'placed')` written into it for those filters, which
    `working_orders_tenant_status_idx` (`packages/db/src/schema/orders.ts:87`) can serve. Task 1
    Step 7 checks the planner's choice with `EXPLAIN QUERY PLAN`, with a control.
11. **The till's lookup leaves out what its dialog cannot collect**: a bill owing nothing, and a bill
    holding a pending or received payment, which `collectOrder` refuses with `bill.payments_received`
    (`refuseBillWithPayments`, `apps/server/src/bill-payments.ts:460-467`, holding states at `:361`).
    Showing them disabled was the other way; leaving them out matches spec §5, where choosing a bill
    "opens a payment dialog that collects through the collect route". Both are dropped in the query,
    before the limit, so a page of them cannot crowd out a collectable debt. The dashboard's Unpaid
    filter still shows them.
12. **The Staff filter lists everyone who appears on a bill** (spec §4.3): a new route,
    `GET /management-api/orders/staff`, reads every person a line is credited to, plus who rang an
    invoice with no bill, whether or not their `persons` row is still active or still there. A person
    with no `persons` row is shown as "Unknown person".

## Global Constraints

- No migration and no new table: `working_orders_opened_at_idx` exists
  (`packages/db/src/schema/orders.ts:88`). If a step seems to need one, stop and ask.
- No new error code. Refusals are `management.request_invalid` with `{ field }` (as
  `apps/server/src/report-api.ts:86`), `working_order.not_found` for an unknown id, and the
  existing till and session codes. If a step seems to need a new code, stop and ask.
- A fixed number of queries per page, never one per row (CLAUDE.md §3, "resolve shared data once").
- Queries on one transaction are awaited in turn, never `Promise.all` (CLAUDE.md §3).
- Automatic dashboard reads are passive after the first: use `DashboardQueries`
  (`apps/dashboard/src/api/query-controller.ts:49-55`).
- Every colour, spacing, radius and font reads a `--wt-*` token. No hex, no `rem`/`em`.
- A refusal that names a shown field is shown under that field; a `wt-data-table` row menu column is
  keyed `actions` and `pinned: "end"`.
- Every new string is added in English AND Spanish (`apps/dashboard/src/i18n/strings.ts`,
  `apps/till/src/i18n/strings.ts`).
- Nothing here writes a fiscal record. The golden huella test and `inmutabilidad` must pass
  UNEDITED: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`.
- Coverage holds `98/98/98/95` in every package touched. Nothing new goes under an ignore comment.
- Every commit is `git commit -s`, with a plain-English message. Each task is its own branch and
  pull request, made with `python3 ~/workspace/tools/worktree.py new waitron <branch> --headless`.
- Server tests produce every status through the product's own write paths (the till routes, or the
  core functions that are the only writers: `recordCorrection`, `recordVoid`, `recordSale`), never
  by inserting rows by hand (spec §9).
- Each task updates `docs/backlog.md`'s B27s entry in the same change.

## Review Focus

1. **A debt credited down to nothing** — the dashboard row reads Left without paying, Credited in
   full, Still owed blank; the till lookup does not offer it. Tests: Task 1 Step 2 ("a debt credited
   to nothing"), Task 3 Step 1 ("leaves out a debt credited to nothing").
2. **Search text a person types loosely** — `mesa 5` must find `Mesa 5`, and a `%` or `_` in the box
   matches only itself, never everything. Test: Task 1 Step 2 ("matches a table in any letter case,
   and a % literally").
3. **The same debt collected from two tills** — the second collect replays the first and no second
   tender is written. Test: Task 3 Step 1 ("collecting twice writes one tender").
4. **A shared link with a filter the screen cannot read** (`/manage/orders/status/bogus/from/2026-13-01`)
   — the screen falls back to the default for that field rather than sending a request the server
   refuses on every refresh. Test: Task 2 Step 1 ("ignores an unreadable status or date in the address").
5. **Two bills opened in the same millisecond on a page boundary** — Show more neither repeats nor
   skips one. Test: Task 1 Step 2 ("pages across two bills opened at the same moment").

---

## Task 1: Server — the list and detail routes

**Branch:** `feat/orders-list-routes`

**Files:**

- Create: `apps/server/src/orders-list.ts` — the page query and the detail read.
- Create: `apps/server/src/orders-api.ts` — `GET /management-api/orders`, `GET /management-api/orders/staff`,
  `GET /management-api/orders/:id`.
- Create: `apps/server/src/testing/order-venue.ts` — a provisioned venue with the routes mounted and
  each status's write path (excluded from coverage: `apps/server/vitest.config.ts`, `src/testing/**`).
- Create: `apps/server/src/orders-list.test.ts`, `apps/server/src/orders-list.reads.test.ts`,
  `apps/server/src/orders-api.test.ts`.
- Modify: `apps/server/src/report-api.ts:83` — export `queryFlag`.
- Modify: `apps/server/src/boot.ts:1549-1553` — mount the new routes beside `mountReportApi`.
- Modify: `docs/backlog.md` — B27s entry: Task 1 landed.

**Interfaces:**

- Produces (Task 2 reads the JSON; Task 3 calls the functions):

```ts
// apps/server/src/orders-list.ts
export const ORDER_STATUSES = ["open", "voided", "left_without_paying", "waiting_for_payment", "paid", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const ORDER_STATUS_FILTERS = ["all", ...ORDER_STATUSES, "unpaid"] as const;
export type OrderStatusFilter = (typeof ORDER_STATUS_FILTERS)[number];
export const DEFAULT_ORDER_PAGE_SIZE = 50;
export const MAX_ORDER_PAGE_SIZE = 200;
export interface OrderCursor { at: string; id: string }
export interface OrderListFilter {
  status: OrderStatusFilter;
  dates: "any" | { from: string; to: string; timeZone: string; dayCutover: string };
  credited: boolean;
  staffId?: string;
  table?: string;
  search?: string;
  limit: number;
  after?: OrderCursor;
  /** One row by id, for the detail read; never set from a request. */
  only?: string;
  /** The till's lookup only (decision 11): rows a collect would take — a bill that owes more than
   * nothing and holds no pending or received payment. Never set from a dashboard request. */
  collectable?: boolean;
}
export interface OrderRow {
  kind: "bill" | "sale";
  id: string;            // the bill's id, or the invoice's id on a "sale" row
  at: string;            // opened_at, or issued_at on a "sale" row
  orderNumber: number | null;
  label: string | null;
  partyId: string | null;
  partyName: string | null;
  tables: string[];      // every table the party held, in the order they joined; or the delivery table
  counter: boolean;      // no party and no delivery table
  saleId: string | null;
  invoiceNumber: string | null;   // "A/12"
  creditNotes: string[];          // "R/3", oldest first
  status: OrderStatus;
  credited: "in_full" | "in_part" | null;
  /** Cancelled with an invoice that is neither voided nor credited to nothing (decision 8). */
  invoiceNotCredited: boolean;
  total: Decimal;
  stillOwed: Decimal | null;
  /** `name` is null for a person with no `persons` row. */
  staff: { id: string; name: string | null }[];
  departedAt: string | null;
}
export interface OrderPage { rows: OrderRow[]; next: OrderCursor | null }
export function listOrders(tx: Transaction, filter: OrderListFilter): Promise<OrderPage>;
export interface OrderDetail { row: OrderRow; lines: OrderLine[]; invoices: OrderInvoice[]; tenders: OrderTender[]; payments: OrderBillPayment[]; party: OrderParty | null; departure: OrderDeparture | null }
export function readOrderDetail(tx: Transaction, id: string): Promise<OrderDetail>;
export function listOrderStaff(tx: Transaction): Promise<{ id: string; name: string | null }[]>;
/** The page query itself, for `listOrders` and for the EXPLAIN check in Step 7. */
export function ordersPageSql(filter: OrderListFilter): SQL;

// apps/server/src/orders-api.ts
export function mountOrdersApi(app: Hono, deps: { db: Database; cfg: { nodeId: string } }, log: Logger): void;
// GET /management-api/orders?status&from&to&anyDate&credited&staff&table&q&limit&after
//   → { rows: OrderRow[]; next: string | null; from: string | null; to: string | null }
//   `next` and `after` are "<at>_<id>". `from`/`to` are the business days applied; null for Any date.
// GET /management-api/orders/staff → { staff: { id: string; name: string | null }[] }
// GET /management-api/orders/:id → OrderDetail
```

- [ ] **Step 0: Re-map.** Run `gh pr list --state open` and, for each open pull request,
  `gh pr diff <n> --name-only`. Stop and report if one touches `apps/server/src/report-api.ts`,
  `boot.ts`, `sale-due.ts`, `bill-payments.ts` or `unpaid-departure.ts`. On the `main` you branched
  from, re-read each fact below at its citation and say in the PR description which still hold:
  - `resolveVenueClock` is exported (`apps/server/src/report-api.ts:137-155`) and `queryFlag` is not
    (`:83`); `STATUS` maps `management.request_invalid` to 400 (`:64-73`).
  - `mountReportApi` is called at `apps/server/src/boot.ts:1549` with `dataNodeId`.
  - `readIssuedSales` (`apps/server/src/sale-due.ts:24-48`) answers `amountDue` = total plus credit
    notes; `readPaymentsByBill` and `outstandingOf` are exported (`apps/server/src/bill-payments.ts:488-506`).
  - `formatInvoiceNumber` is `"<code>/<number>"` (`packages/core/src/record-sale.ts:87`).
  - `validatedRangeWindow` and `currentBusinessDay` are exported by `@waitron/reporting`
    (`packages/reporting/src/index.ts:2-7`).
  - The test harness `provisionBillVenue`, `seatedWith`, `send`, `inTx` exists
    (`apps/server/src/testing/bill-venue.ts:99,302,322,383`).
  - **Measure two facts this task relies on**, as the first cases of `orders-list.test.ts` (Step 2,
    the "facts this list relies on" block): an open bill abandoned with `DELETE /api/working-orders/:id`
    keeps its lines (spec §4.1 asks this; read, not run: `abandonHeldOrder`,
    `apps/server/src/working-order.ts:4485-4502`, updates the status only); and `POST /api/sales`
    with no `workingOrderId` files a sale WITH a `working_order_id` (decision 2). If the first fails,
    drop the "holding lines" half of `LISTED_BILL` and record it in the PR; if the second fails,
    tell the owner before going on.

- [ ] **Step 1: Write the venue helper.** Create `apps/server/src/testing/order-venue.ts`:

```ts
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { invoiceSeries, sales } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { recordCorrection, recordSale, recordVoid } from "@waitron/core";
import { hashPin, loginWithPin, persons, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { saleId as brandSaleId, seriesId as brandSeriesId } from "@waitron/shared";
import type { Logger } from "../logger.js";
import { mountOrdersApi } from "../orders-api.js";
import { SESSION_COOKIE } from "../till-session.js";
import { parkOrder, placeOrder } from "../working-order.js";
import { inTx, provisionBillVenue, seatedWith, send, type Answer, type BillVenue } from "./bill-venue.js";
import { offerProducts } from "./zone-offers.js";

/** {@link provisionBillVenue} with a supervisor, the Orders routes, and an invoice-first counter. */
export interface OrderVenue extends BillVenue {
  invoiceFirstZone: string;
  supervisorId: string;
  /** The supervisor's till session on the first till's device. */
  supervisorTill: string;
  /** The supervisor's dashboard session: holds `report.view`. */
  supervisorDashboard: string;
  /** The staff operator Ana's dashboard session: holds nothing. */
  staffDashboard: string;
  orders: Hono;
}

const quiet: Logger = () => {};

export async function provisionOrderVenue(db: Database): Promise<OrderVenue> {
  const venue = await provisionBillVenue(db);
  const invoiceFirstZone = (
    await inTx(venue, (tx) => offerProducts(tx, venue.cfg, { zone: "counter", serviceMode: "invoice_first" }))
  ).zoneId;
  const made = await inTx(venue, async (tx) => {
    const [person] = await tx
      .insert(persons)
      .values({ displayName: "Sofía", pinHash: hashPin("7777"), role: "supervisor" })
      .returning({ id: persons.id });
    const till = await loginWithPin(tx, { tillId: venue.cfg.tillId, personId: person!.id, pin: "7777" });
    const dashboard = await startManagementSession(tx, { personId: person!.id });
    const staff = await startManagementSession(tx, { personId: venue.operatorId });
    return { supervisorId: person!.id, till: till.token, dashboard: dashboard.token, staff: staff.token };
  });
  const device = venue.cookie.split("; ").slice(1);
  const orders = new Hono();
  mountOrdersApi(orders, { db, cfg: { nodeId: venue.cfg.nodeId } }, quiet);
  return {
    ...venue,
    invoiceFirstZone,
    supervisorId: made.supervisorId,
    supervisorTill: [`${SESSION_COOKIE}=${made.till}`, ...device].join("; "),
    supervisorDashboard: `${MANAGEMENT_COOKIE}=${made.dashboard}`,
    staffDashboard: `${MANAGEMENT_COOKIE}=${made.staff}`,
    orders,
  };
}

/** A counter bill of the named dishes, sent under invoice-first, so it is invoiced and unpaid. */
export async function placedInvoiceFirst(venue: OrderVenue, ...names: string[]): Promise<string> {
  const id = randomUUID();
  const deps = { db: venue.db, backend: venue.backend, clock: venue.clock };
  await parkOrder(deps, venue.cfg, {
    id,
    lines: names.map((name) => ({ menuItemId: venue.offerFor(name), quantity: "1" })),
    zoneId: venue.invoiceFirstZone,
    operatorId: venue.operatorId,
  });
  await placeOrder(deps, venue.cfg, id, venue.operatorId, venue.cfg.tillId);
  return id;
}

/** An open counter bill of the named dishes, never sent, its lines credited to Ana. */
export function parked(venue: OrderVenue, ...names: string[]): Promise<string> {
  return parkedBy(venue, venue.operatorId, ...names);
}

/** {@link parked}, its lines credited to `operatorId`. */
export async function parkedBy(venue: OrderVenue, operatorId: string, ...names: string[]): Promise<string> {
  const id = randomUUID();
  await parkOrder({ db: venue.db, backend: venue.backend, clock: venue.clock }, venue.cfg, {
    id,
    lines: names.map((name) => ({ menuItemId: venue.offerFor(name), quantity: "1" })),
    zoneId: venue.invoiceFirstZone,
    operatorId,
  });
  return id;
}

/** A party seated with the named dishes that then left without paying. */
export async function departed(venue: OrderVenue, ...names: string[]) {
  const party = await seatedWith(venue, ...names);
  const answer = await send(venue.app, venue.supervisorTill, "POST", `/api/parties/${party.partyId}/unpaid-departure`, {
    expectedPartyRevision: party.revision,
    reason: "Se marcharon sin pagar",
  });
  if (answer.status !== 200) throw new Error(`departed: answered ${answer.status}`);
  return party;
}

export function collect(venue: OrderVenue, billId: string, amount: string): Promise<Answer> {
  return send(venue.app, venue.cookie, "POST", `/api/working-orders/${billId}/collect`, {
    tender: { method: "cash", amount },
  });
}

async function invoiceOf(venue: OrderVenue, billId: string): Promise<string> {
  const [sale] = await inTx(venue, (tx) =>
    tx.select({ id: sales.id }).from(sales).where(eq(sales.workingOrderId, billId)),
  );
  return sale!.id;
}

function adminSession(venue: OrderVenue, tx: Transaction) {
  return loginWithPin(tx, { tillId: venue.cfg.tillId, personId: venue.adminId, pin: "1234" });
}

/** A credit note of `base` at 21% totalling `total` against the bill's invoice, through `recordCorrection`. */
export async function credit(venue: OrderVenue, billId: string, base: string, total: string): Promise<void> {
  const saleId = await invoiceOf(venue, billId);
  await inTx(venue, async (tx) => {
    const [series] = await tx
      .select({ id: invoiceSeries.id })
      .from(invoiceSeries)
      .where(and(eq(invoiceSeries.nodeId, venue.cfg.nodeId), eq(invoiceSeries.purpose, "rectificative")));
    const session = await adminSession(venue, tx);
    await recordCorrection(tx, venue.backend, {
      tillId: venue.cfg.tillId,
      nodeId: venue.cfg.nodeId,
      seriesId: brandSeriesId(series!.id),
      correctsSaleId: brandSaleId(saleId),
      total,
      lines: [{ lineNo: 1, name: "Descuento", descriptions: { [venue.cfg.locale]: "Descuento" }, quantity: "-1", unitPrice: base, vatRate: "21.00", lineTotal: `-${base}` }],
      clock: venue.clock,
      authz: { sessionId: session.id },
    });
  });
}

/** Voids the bill's invoice through `recordVoid`, the only writer of `sale_voids`. */
export async function voidInvoice(venue: OrderVenue, billId: string): Promise<void> {
  const saleId = await invoiceOf(venue, billId);
  await inTx(venue, async (tx) => {
    const session = await adminSession(venue, tx);
    await recordVoid(tx, venue.backend, brandSaleId(saleId), "Error de cobro", { sessionId: session.id });
  });
}

/** A cash contribution of `amount` taken on an open bill before its invoice, through the till's
 * bill-payment route (body as `contribute` in `apps/server/src/bill-payments-api.test.ts:377-387`). */
export async function contribute(venue: OrderVenue, billId: string, amount: string): Promise<void> {
  const answer = await send(venue.app, venue.cookie, "POST", `/api/working-orders/${billId}/payments`, {
    submissionId: randomUUID(), kind: "contribution", amount, method: "cash", tendered: amount, applied: amount, tip: "0.00",
  });
  if (answer.status !== 200) throw new Error(`contribute: answered ${answer.status}`);
}

/** An invoice with no bill, written as the demo seed writes one (`recordSale`, no `workingOrderId`). */
export async function billlessSale(venue: OrderVenue): Promise<string> {
  const { saleId } = await inTx(venue, (tx) =>
    recordSale(tx, venue.backend, {
      tillId: venue.cfg.tillId,
      nodeId: venue.cfg.nodeId,
      seriesId: venue.cfg.seriesId,
      locale: venue.cfg.locale,
      invoiceLocales: venue.cfg.invoiceLocales,
      total: "12.10",
      lines: [{ lineNo: 1, name: "Venta suelta", descriptions: { [venue.cfg.locale]: "Venta suelta" }, quantity: "1", unitPrice: "10.00", vatRate: "21.00", lineTotal: "10.00" }],
      clock: venue.clock,
      settlement: { kind: "immediate", tenders: [{ method: "cash", amount: "12.10", tipAmount: "0.00", settledAt: new Date() }] },
      operatorId: venue.operatorId,
    }),
  );
  return saleId;
}
```

  The `credit` body is the one in `apps/server/src/unpaid-departure.test.ts:213-248`; the supervisor
  setup is the one at `:68-113`. `contribute` was not run when this plan was written: if the route
  answers anything but 200 (a party bill may be required, or a field named differently), read
  `apps/server/src/bill-payments-api.ts:248` and adjust the body, not the assertion.

- [ ] **Step 2: Write the failing list tests.** Create `apps/server/src/orders-list.test.ts`. Rows
  are read one at a time through the detail route, so cases do not depend on how many bills earlier
  cases left behind (`resetPerTest: false`, as `unpaid-departure.test.ts:72` does):

```ts
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { sales, tenders, withTransaction, workingOrderLines } from "@waitron/db";
import { inTx, seatedWith, send } from "./testing/bill-venue.js";
import {
  billlessSale, collect, credit, departed, parked, placedInvoiceFirst, provisionOrderVenue, voidInvoice, type OrderVenue,
} from "./testing/order-venue.js";
import { listOrders } from "./orders-list.js";
import "./errors.js";

let venue: OrderVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => { venue = await provisionOrderVenue(db); },
});

type Row = Record<string, unknown>;
async function rowOf(id: string): Promise<Row> {
  const answer = await send(venue.orders, venue.supervisorDashboard, "GET", `/management-api/orders/${id}`);
  expect(answer.status).toBe(200);
  return (answer.json as { row: Row }).row;
}
async function list(query: string): Promise<{ rows: Row[]; next: string | null; from: string | null; to: string | null }> {
  const answer = await send(venue.orders, venue.supervisorDashboard, "GET", `/management-api/orders?${query}`);
  expect(answer.status).toBe(200);
  return answer.json as never;
}
const ids = (rows: Row[]) => rows.map((row) => row.id);

describe("facts this list relies on", () => {
  it("an open bill abandoned from the till keeps its lines", async () => {
    const id = await parked(venue, "Caña");
    const deleted = await send(venue.app, venue.cookie, "DELETE", `/api/working-orders/${id}`);
    expect(deleted.status).toBe(200);
    const lines = await inTx(venue, (tx) => tx.select().from(workingOrderLines).where(eq(workingOrderLines.workingOrderId, id)));
    expect(lines).toHaveLength(1);
  });

  it("a till sale rung with no bill id is filed against a bill the sale made", async () => {
    const answer = await send(venue.app, venue.cookie, "POST", "/api/sales", {
      lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }],
      tender: { method: "cash", amount: "3.00" },
      zoneId: venue.zoneId,
    });
    expect(answer.status).toBe(200);
    const [sale] = await inTx(venue, (tx) =>
      tx.select({ bill: sales.workingOrderId }).from(sales).orderBy(sql`${sales}.rowid desc`).limit(1),
    );
    expect(sale!.bill).not.toBeNull();
  });
});

describe("each status, from the product's own write paths", () => {
  it("reads an open bill as Open, owing its lines, credited to who rang them", async () => {
    const party = await seatedWith(venue, "Caña");
    expect(await rowOf(party.tabId)).toMatchObject({
      kind: "bill", status: "open", total: "3.00", stillOwed: "3.00", invoiceNumber: null,
      staff: [{ id: venue.operatorId, name: "Ana" }], tables: [expect.stringMatching(/^Mesa /)], counter: false,
    });
  });

  it("reads a bill sent under invoice-first as Waiting for payment, with its invoice", async () => {
    const id = await placedInvoiceFirst(venue, "Tarta");
    expect(await rowOf(id)).toMatchObject({
      status: "waiting_for_payment", invoiceNumber: expect.stringMatching(/^A\/\d+$/), total: "18.00", stillOwed: "18.00", counter: true,
    });
  });

  it("reads a debt as Left without paying, then as Paid once collected, keeping when it left", async () => {
    const party = await departed(venue, "Botella tinto");
    const before = await rowOf(party.tabId);
    expect(before).toMatchObject({ status: "left_without_paying", stillOwed: "30.00", departedAt: expect.any(String) });

    expect((await collect(venue, party.tabId, "30.00")).status).toBe(200);

    expect(await rowOf(party.tabId)).toMatchObject({ status: "paid", stillOwed: null, departedAt: before.departedAt });
  });

  const cancel = (id: string) =>
    send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/cancel`, { reason: "Error" });

  it("reads a sent bill cancelled at the till as Cancelled, keeping its invoice, marked Invoice not credited", async () => {
    const id = await placedInvoiceFirst(venue, "Caña");
    expect((await cancel(id)).status).toBe(200);
    expect(await rowOf(id)).toMatchObject({
      status: "cancelled", invoiceNumber: expect.stringMatching(/^A\/\d+$/), stillOwed: null, invoiceNotCredited: true,
    });
  });

  it("drops the Invoice not credited mark once credit notes bring the invoice to nothing", async () => {
    const id = await placedInvoiceFirst(venue, "Caña");
    await credit(venue, id, "2.48", "-3.00");
    expect((await cancel(id)).status).toBe(200);
    expect(await rowOf(id)).toMatchObject({ status: "cancelled", credited: "in_full", invoiceNotCredited: false });
  });

  it("reads a debt cancelled at the till afterwards as Cancelled, not Left without paying", async () => {
    const party = await departed(venue, "Caña");
    expect((await cancel(party.tabId)).status).toBe(200);
    expect(await rowOf(party.tabId)).toMatchObject({ status: "cancelled", invoiceNotCredited: true, departedAt: expect.any(String) });
  });

  it("lists an open bill abandoned with lines as Cancelled, and leaves out an empty one never sent", async () => {
    const held = await parked(venue, "Caña");
    await send(venue.app, venue.cookie, "DELETE", `/api/working-orders/${held}`);
    expect(await rowOf(held)).toMatchObject({ status: "cancelled" });

    const empty = await seatedWith(venue);
    const finished = await send(venue.app, venue.cookie, "POST", `/api/parties/${empty.partyId}/finish`, { expectedPartyRevision: empty.revision });
    expect(finished.status).toBe(200);
    const answer = await send(venue.orders, venue.supervisorDashboard, "GET", `/management-api/orders/${empty.tabId}`);
    expect(answer).toMatchObject({ status: 404, json: { code: "working_order.not_found" } });
  });

  it("reads a voided invoice's bill as Voided, ahead of Waiting for payment", async () => {
    const id = await placedInvoiceFirst(venue, "Caña");
    await voidInvoice(venue, id);
    expect(await rowOf(id)).toMatchObject({ status: "voided", stillOwed: null, invoiceNotCredited: false });
  });

  it("lists an invoice with no bill as its own row, by its issue time", async () => {
    const saleId = await billlessSale(venue);
    expect(await rowOf(saleId)).toMatchObject({
      kind: "sale", id: saleId, saleId, status: "paid", total: "12.10", staff: [{ id: venue.operatorId, name: "Ana" }],
    });
  });
});

describe("credit notes and what is still owed", () => {
  it("marks a part credit, and owes what the till's collect then charges, to the cent", async () => {
    const id = await placedInvoiceFirst(venue, "Botella tinto");
    await credit(venue, id, "2.00", "-2.42");
    const row = await rowOf(id);
    expect(row).toMatchObject({ credited: "in_part", stillOwed: "27.58", creditNotes: [expect.stringMatching(/^R\/\d+$/)] });

    // 400: `sale.tender_shortfall` in the till's STATUS map (`apps/server/src/till-api.ts:291`).
    expect(await collect(venue, id, "27.57")).toMatchObject({ status: 400, json: { code: "sale.tender_shortfall" } });
    expect((await collect(venue, id, row.stillOwed as string)).status).toBe(200);
    const [tender] = await inTx(venue, (tx) =>
      tx.select({ amount: tenders.amount }).from(tenders).innerJoin(sales, eq(sales.id, tenders.saleId)).where(eq(sales.workingOrderId, id)),
    );
    expect(tender).toEqual({ amount: 2758 });
  });

  it("a debt credited to nothing stays Left without paying, Credited in full, owing nothing", async () => {
    const party = await departed(venue, "Botella tinto");
    await credit(venue, party.tabId, "24.79", "-30.00");
    expect(await rowOf(party.tabId)).toMatchObject({ status: "left_without_paying", credited: "in_full", stillOwed: null });
  });
});

describe("filters and search", () => {
  it("Unpaid takes Waiting for payment and Left without paying, and nothing else", async () => {
    const waiting = await placedInvoiceFirst(venue, "Caña");
    const debt = await departed(venue, "Caña");
    const open = await seatedWith(venue, "Caña");
    const found = ids((await list("status=unpaid&anyDate=true&limit=200")).rows);
    expect(found).toEqual(expect.arrayContaining([waiting, debt.tabId]));
    expect(found).not.toContain(open.tabId);
  });

  it("finds an invoice by A/12, by its bare number, and by its credit note's number", async () => {
    const id = await placedInvoiceFirst(venue, "Croquetas");
    await credit(venue, id, "2.00", "-2.42");
    const row = await rowOf(id);
    const [, number] = (row.invoiceNumber as string).split("/");
    for (const q of [row.invoiceNumber as string, number!, (row.creditNotes as string[])[0]!]) {
      expect(ids((await list(`anyDate=true&limit=200&q=${encodeURIComponent(q)}`)).rows), q).toContain(id);
    }
  });

  it("finds a bill by its order number, before it has any invoice", async () => {
    const party = await seatedWith(venue, "Caña");
    const row = await rowOf(party.tabId);
    expect(row.invoiceNumber).toBeNull();
    expect(ids((await list(`anyDate=true&limit=200&q=${row.orderNumber as number}`)).rows)).toContain(party.tabId);
  });

  it("matches a table in any letter case, and a % literally", async () => {
    const party = await seatedWith(venue, "Caña");
    const label = (await rowOf(party.tabId)).tables as string[];
    expect(ids((await list(`anyDate=true&limit=200&table=${encodeURIComponent(label[0]!.toUpperCase())}`)).rows)).toEqual([party.tabId]);
    expect((await list("anyDate=true&limit=200&q=%25")).rows).toEqual([]);
  });

  it("finds a party by its name", async () => {
    const party = await seatedWith(venue, "Caña");
    const named = await send(venue.app, venue.cookie, "PUT", `/api/parties/${party.partyId}/name`, { name: "Familia Ortega", expectedPartyRevision: party.revision });
    expect(named.status).toBe(200);
    expect(ids((await list("anyDate=true&limit=200&q=ortega")).rows)).toEqual([party.tabId]);
  });

  it("filters by who a line is credited to, and by having a credit note", async () => {
    const id = await placedInvoiceFirst(venue, "Pulpo");
    await credit(venue, id, "2.00", "-2.42");
    expect(ids((await list(`anyDate=true&limit=200&staff=${venue.operatorId}`)).rows)).toContain(id);
    expect(ids((await list(`anyDate=true&limit=200&staff=${venue.supervisorId}`)).rows)).not.toContain(id);
    const credited = (await list("anyDate=true&limit=200&credited=true")).rows;
    expect(ids(credited)).toContain(id);
    expect(credited.every((row) => row.credited !== null)).toBe(true);
  });
});

describe("dates and pages", () => {
  // `opened_at` is written from `new Date()` (`nowIso`), so only `Date` is faked. Madrid is UTC+1 on
  // 2026-03-14; the venue's cut-over is 05:00 (bill-venue.ts:125).
  it("puts a bill opened a second before the cut-over on the previous business day", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-03-14T03:59:59.000Z") });
    let before: string, after: string;
    try {
      before = await parked(venue, "Caña");
      vi.setSystemTime(new Date("2026-03-14T04:00:00.000Z"));
      after = await parked(venue, "Caña");
    } finally {
      vi.useRealTimers();
    }
    const page = await withTransaction(venue.db, (tx) =>
      listOrders(tx, { status: "all", dates: { from: "2026-03-14", to: "2026-03-14", timeZone: "Europe/Madrid", dayCutover: "05:00" }, credited: false, limit: 200 }),
    );
    expect(ids(page.rows)).toEqual([after!]);
    expect(ids(page.rows)).not.toContain(before!);
  });

  it("pages across two bills opened at the same moment, newest first, then by id", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-02-02T12:00:00.000Z") });
    let pair: string[];
    try {
      pair = [await parked(venue, "Caña"), await parked(venue, "Caña")];
    } finally {
      vi.useRealTimers();
    }
    const query = "from=2026-02-02&to=2026-02-02&limit=1";
    const first = await list(query);
    expect(first.next).toMatch(/^2026-02-02T12:00:00\.000Z_/);
    const second = await list(`${query}&after=${encodeURIComponent(first.next!)}`);
    expect([...ids(first.rows), ...ids(second.rows)]).toEqual([...pair!].sort().reverse());
    expect(second.next).toBeNull();
  });

  it("defaults to today's business day and says which days it read", async () => {
    const page = await list("");
    expect(page.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(page.to).toBe(page.from);
    expect((await list("anyDate=true")).from).toBeNull();
  });
});
```

- [ ] **Step 3: Run it; watch it fail.**
  `pnpm --filter @waitron/server exec vitest run src/orders-list.test.ts`
  Expected: FAIL at import, `Cannot find module './orders-list.js'` (and `./orders-api.js` from the helper).

- [ ] **Step 4: Write `apps/server/src/orders-list.ts`.**

```ts
import { and, asc, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import { formatInvoiceNumber } from "@waitron/core";
import {
  billPaymentRefunds, billPayments, diningTables, invoiceSeries, parties, partyTables, saleLines, sales, tenders,
  unpaidDepartures, workingOrderLines,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { persons } from "@waitron/identity";
import { validatedRangeWindow } from "@waitron/reporting";
import { AppError, addDecimal, centsToDecimal, compareDecimal, rawCentsToDecimal, thousandthsToDecimal } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import { outstandingOf, readPaymentsByBill } from "./bill-payments.js";
import { readIssuedSales } from "./sale-due.js";
import "./errors.js";

// …the exported constants and types from the Interfaces block above…

const ZERO = centsToDecimal(0);
const OWING: readonly OrderStatus[] = ["open", "waiting_for_payment", "left_without_paying"];

/** Choice 6: an abandoned bill is listed only if it was sent or still holds lines. */
const LISTED_BILL = sql`(wo.status <> 'abandoned'
  or exists (select 1 from order_amendments oa where oa.working_order_id = wo.id and oa.kind = 'order_placed')
  or exists (select 1 from working_order_lines l where l.working_order_id = wo.id))`;

/**
 * Spec §4.2, with Voided second: `recordVoid` never changes the bill's own status. Left without
 * paying also needs the bill `placed` (decision 1), so a debt cancelled afterwards reads Cancelled,
 * and every open-or-unpaid status comes from an `open` or `placed` bill (decision 10).
 */
const BILL_STATUS = sql`case
  when wo.status = 'open' then 'open'
  when sv.id is not null then 'voided'
  when ud.id is not null and ss.id is null and wo.status = 'placed' then 'left_without_paying'
  when wo.status = 'placed' and ss.id is null then 'waiting_for_payment'
  when wo.status = 'settled' or ss.id is not null then 'paid'
  else 'cancelled' end`;

const CORRECTIONS = sql`cast(coalesce((select sum(c.total) from sales c where c.corrects_sale_id = s.id), 0) as text)`;

/** The statuses that only an `open` or `placed` bill can have (BILL_STATUS above). */
const LIVE_FILTERS: readonly OrderStatusFilter[] = ["open", "waiting_for_payment", "left_without_paying", "unpaid"];

/**
 * Decision 10: for those filters the bill half reads only `open` and `placed` bills, written into it
 * so `working_orders_tenant_status_idx` can serve the read; the status filter on `r` still decides.
 */
function billScope(filter: OrderListFilter): SQL {
  return LIVE_FILTERS.includes(filter.status) ? sql` and wo.status in ('open', 'placed')` : sql``;
}

// Money columns are cast to text: `rawCentsToDecimal` refuses the number an uncast integer arrives as.
function rowsSql(filter: OrderListFilter): SQL {
  return sql`
  select 'bill' as kind, wo.id as id, wo.opened_at as at, wo.order_number as order_number, wo.label as label,
         wo.party_id as party_id, p.name as party_name, dd.label as delivery_label,
         s.id as sale_id, sr.code as series_code, s.invoice_number as invoice_number,
         cast(s.total as text) as sale_total,
         cast((select coalesce(sum(l.line_total), 0) from working_order_lines l where l.working_order_id = wo.id) as text) as lines_total,
         ${CORRECTIONS} as corrections, null as operator_id, null as operator_name,
         ${BILL_STATUS} as status, ud.recorded_at as departed_at
  from working_orders wo
  left join parties p on p.id = wo.party_id
  left join dining_tables dd on dd.id = wo.delivery_table_id
  left join sales s on s.working_order_id = wo.id
  left join invoice_series sr on sr.id = s.series_id
  left join sale_settlements ss on ss.sale_id = s.id
  left join sale_voids sv on sv.sale_id = s.id
  left join unpaid_departures ud on ud.working_order_id = wo.id
  where ${LISTED_BILL}${billScope(filter)}
  union all
  select 'sale', s.id, s.issued_at, null, null, null, null, null, s.id, sr.code, s.invoice_number,
         cast(s.total as text), '0', ${CORRECTIONS}, s.operator_id, op.display_name,
         case when sv.id is not null then 'voided' when ss.id is not null then 'paid' else 'waiting_for_payment' end,
         null
  from sales s
  join invoice_series sr on sr.id = s.series_id
  left join sale_settlements ss on ss.sale_id = s.id
  left join sale_voids sv on sv.sale_id = s.id
  left join persons op on op.id = s.operator_id
  where s.working_order_id is null and s.corrects_sale_id is null
    and not exists (select 1 from sale_substitutions sub where sub.substitution_sale_id = s.id)`;
}

interface RawRow {
  kind: "bill" | "sale"; id: string; at: string; order_number: number | null; label: string | null;
  party_id: string | null; party_name: string | null; delivery_label: string | null;
  sale_id: string | null; series_code: string | null; invoice_number: number | null;
  sale_total: string | null; lines_total: string; corrections: string;
  operator_id: string | null; operator_name: string | null; status: OrderStatus; departed_at: string | null;
  credited: number;
}

function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

/**
 * `A/12` names a series and a number. A bare number names that number in every series AND the bill
 * with that order number (decision 9): the ticket shows the order number, and a bill sent under
 * ticket_then_pay has no invoice number yet.
 */
function searchClause(search: string): SQL {
  const invoice = /^([^/\s]+)\s*\/\s*(\d{1,9})$/.exec(search);
  const bare = /^\d{1,9}$/.test(search) ? Number(search) : undefined;
  if (invoice !== null || bare !== undefined) {
    const number = invoice !== null ? Number(invoice[2]) : bare!;
    const code = invoice !== null ? sql` and xs.code = ${invoice[1]} collate nocase` : sql``;
    const byInvoice = sql`exists (select 1 from sales x join invoice_series xs on xs.id = x.series_id
      where (x.id = r.sale_id or x.corrects_sale_id = r.sale_id) and x.invoice_number = ${number}${code})`;
    return bare === undefined ? byInvoice : sql`(${byInvoice} or (r.kind = 'bill' and r.order_number = ${bare}))`;
  }
  // LIKE folds ASCII letter case only; a non-ASCII letter matches in its own case.
  const pattern = likePattern(search);
  return sql`(r.party_name like ${pattern} escape '\\'
    or r.delivery_label like ${pattern} escape '\\'
    or exists (select 1 from party_tables pt join dining_tables dt on dt.id = pt.table_id
               where pt.party_id = r.party_id and dt.label like ${pattern} escape '\\'))`;
}

/** Choice 4: a bill's staff are the people its lines are credited to; an invoice with no bill's is who rang it. */
function staffClause(staffId: string): SQL {
  return sql`((r.kind = 'bill' and exists (select 1 from working_order_lines l
                 where l.working_order_id = r.id and l.credited_to = ${staffId}))
           or (r.kind = 'sale' and r.operator_id = ${staffId}))`;
}

function tableClause(table: string): SQL {
  return sql`(r.delivery_label = ${table} collate nocase
    or exists (select 1 from party_tables pt join dining_tables dt on dt.id = pt.table_id
               where pt.party_id = r.party_id and dt.label = ${table} collate nocase))`;
}

function filterClauses(filter: OrderListFilter): SQL[] {
  const clauses: SQL[] = [];
  if (filter.only !== undefined) clauses.push(sql`r.id = ${filter.only}`);
  if (filter.status === "unpaid") clauses.push(sql`r.status in ('waiting_for_payment', 'left_without_paying')`);
  else if (filter.status !== "all") clauses.push(sql`r.status = ${filter.status}`);
  if (filter.dates !== "any") {
    const { from, to, timeZone, dayCutover } = filter.dates;
    clauses.push(validatedRangeWindow({ fromBusinessDay: from, toBusinessDay: to, timeZone, dayCutover })(sql`r.at`));
  }
  if (filter.credited) clauses.push(sql`exists (select 1 from sales c where c.corrects_sale_id = r.sale_id)`);
  if (filter.staffId !== undefined) clauses.push(staffClause(filter.staffId));
  if (filter.table !== undefined) clauses.push(tableClause(filter.table));
  if (filter.search !== undefined) clauses.push(searchClause(filter.search));
  if (filter.collectable === true) {
    // The same sums `readIssuedSales` and the lines total give, and `holdsPayment`'s states
    // (`apps/server/src/bill-payments.ts:361`), so the limit counts only what the till can collect.
    clauses.push(sql`r.kind = 'bill'
      and (case when r.sale_id is not null
                then cast(r.sale_total as integer) + cast(r.corrections as integer)
                else cast(r.lines_total as integer) end) > 0
      and not exists (select 1 from bill_payments bp
                      where bp.working_order_id = r.id and bp.state in ('pending', 'received'))`);
  }
  if (filter.after !== undefined) {
    const { at, id } = filter.after;
    clauses.push(sql`(r.at < ${at} or (r.at = ${at} and r.id < ${id}))`);
  }
  return clauses;
}

/**
 * One page of rows, newest first by `at` then id. At most seven queries whatever the page holds:
 * the page, then the invoices' amounts due, payments before an invoice (two), credit-note numbers,
 * tables and staff, each for the whole page and each skipped when the page has nothing to ask.
 */
export function ordersPageSql(filter: OrderListFilter): SQL {
  const clauses = filterClauses(filter);
  const where = clauses.length === 0 ? sql`1` : sql.join(clauses, sql` and `);
  return sql`
    with r as (${rowsSql(filter)})
    select r.*, exists (select 1 from sales c where c.corrects_sale_id = r.sale_id) as credited
    from r where ${where}
    order by r.at desc, r.id desc
    limit ${filter.limit + 1}`;
}

export async function listOrders(tx: Transaction, filter: OrderListFilter): Promise<OrderPage> {
  const { rows: read } = await tx.execute<RawRow>(ordersPageSql(filter));
  const raw = read.slice(0, filter.limit);
  const last = raw[filter.limit - 1];
  const next = read.length > filter.limit ? { at: last!.at, id: last!.id } : null;

  const bills = raw.filter((row) => row.kind === "bill");
  const owing = bills.filter((row) => OWING.includes(row.status));
  // Awaited in turn: they share one transaction (CLAUDE.md §3).
  const issued = await readIssuedSales(tx, owing.filter((row) => row.sale_id !== null).map((row) => row.id));
  const uninvoiced = owing.filter((row) => row.sale_id === null).map((row) => row.id);
  const { received } = uninvoiced.length === 0 ? { received: new Map<string, Decimal>() } : await readPaymentsByBill(tx, uninvoiced);
  const notes = await readCreditNotes(tx, raw.flatMap((row) => row.sale_id ?? []));
  const tables = await readPartyTables(tx, [...new Set(bills.flatMap((row) => row.party_id ?? []))]);
  const staff = await readStaff(tx, bills.map((row) => row.id));

  const rows = raw.map((row): OrderRow => {
    const total = rawCentsToDecimal(row.sale_id === null ? row.lines_total : row.sale_total!);
    const net = addDecimal(total, rawCentsToDecimal(row.corrections));
    let owed: Decimal | null = null;
    if (OWING.includes(row.status)) {
      owed = row.kind === "sale" ? net
        : row.sale_id !== null ? issued.get(row.id)!.amountDue
        : outstandingOf(total, received.get(row.id));
    }
    return {
      kind: row.kind,
      id: row.id,
      at: row.at,
      orderNumber: row.order_number,
      label: row.label,
      partyId: row.party_id,
      partyName: row.party_name,
      tables: row.party_id !== null ? (tables.get(row.party_id) ?? []) : row.delivery_label !== null ? [row.delivery_label] : [],
      counter: row.party_id === null && row.delivery_label === null && row.kind === "bill",
      saleId: row.sale_id,
      invoiceNumber: row.sale_id === null ? null : formatInvoiceNumber(row.series_code!, row.invoice_number!),
      creditNotes: row.sale_id === null ? [] : (notes.get(row.sale_id) ?? []),
      status: row.status,
      credited: row.credited === 1 ? (compareDecimal(net, ZERO) === 0 ? "in_full" : "in_part") : null,
      // A voided invoice's row reads Voided, so Cancelled here means the invoice stands.
      invoiceNotCredited: row.status === "cancelled" && row.sale_id !== null && compareDecimal(net, ZERO) !== 0,
      total,
      stillOwed: owed !== null && compareDecimal(owed, ZERO) > 0 ? owed : null,
      staff: row.kind === "sale"
        ? row.operator_id === null ? [] : [{ id: row.operator_id, name: row.operator_name }]
        : (staff.get(row.id) ?? []),
      departedAt: row.departed_at,
    };
  });
  return { rows, next };
}

async function readCreditNotes(tx: Transaction, saleIds: readonly string[]): Promise<Map<string, string[]>> {
  const notes = new Map<string, string[]>();
  if (saleIds.length === 0) return notes;
  const rows = await tx
    .select({ of: sales.correctsSaleId, code: invoiceSeries.code, number: sales.invoiceNumber })
    .from(sales)
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .where(inArray(sales.correctsSaleId, [...saleIds]))
    .orderBy(asc(sales.issuedAt), sql`${sales}.rowid`);
  for (const row of rows) notes.set(row.of!, [...(notes.get(row.of!) ?? []), formatInvoiceNumber(row.code, row.number)]);
  return notes;
}

/** Every table each party ever held, once each, in the order they joined it. */
async function readPartyTables(tx: Transaction, partyIds: readonly string[]): Promise<Map<string, string[]>> {
  const tables = new Map<string, string[]>();
  if (partyIds.length === 0) return tables;
  const rows = await tx
    .select({ partyId: partyTables.partyId, label: diningTables.label })
    .from(partyTables)
    .innerJoin(diningTables, eq(diningTables.id, partyTables.tableId))
    .where(inArray(partyTables.partyId, [...partyIds]))
    .orderBy(partyTables.joinedAt, partyTables.id);
  for (const row of rows) {
    const held = tables.get(row.partyId) ?? [];
    if (!held.includes(row.label)) tables.set(row.partyId, [...held, row.label]);
  }
  return tables;
}

type Person = { id: string; name: string | null };

/** Left join: a person whose `persons` row is gone still counts, with no name (decision 12). */
async function readStaff(tx: Transaction, billIds: readonly string[]): Promise<Map<string, Person[]>> {
  const staff = new Map<string, Person[]>();
  if (billIds.length === 0) return staff;
  const rows = await tx
    .selectDistinct({ bill: workingOrderLines.workingOrderId, id: workingOrderLines.creditedTo, name: persons.displayName })
    .from(workingOrderLines)
    .leftJoin(persons, eq(persons.id, workingOrderLines.creditedTo))
    .where(and(inArray(workingOrderLines.workingOrderId, [...billIds]), isNotNull(workingOrderLines.creditedTo)))
    .orderBy(persons.displayName, workingOrderLines.creditedTo);
  for (const row of rows) staff.set(row.bill, [...(staff.get(row.bill) ?? []), { id: row.id!, name: row.name }]);
  return staff;
}

/**
 * Everyone the Staff filter offers (decision 12): each person a line was ever credited to, and
 * whoever rang an invoice with no bill, active or not, with or without a `persons` row. One read
 * over every line; the screen refreshes it on a timer, not on each line written (Task 2 Step 2).
 */
export async function listOrderStaff(tx: Transaction): Promise<Person[]> {
  const { rows } = await tx.execute<{ id: string; name: string | null }>(sql`
    select x.id as id, p.display_name as name
    from (select credited_to as id from working_order_lines where credited_to is not null
          union
          select operator_id from sales
          where working_order_id is null and corrects_sale_id is null and operator_id is not null) x
    left join persons p on p.id = x.id
    order by p.display_name is null, p.display_name, x.id`);
  return rows;
}
```

  Then the detail read, in the same file:

```ts
export interface OrderLine { lineNo: number; name: string; variantName: string | null; quantity: Decimal; total: Decimal; listUnitPrice: Decimal | null; creditedTo: string | null }
export interface OrderInvoice { kind: "invoice" | "credit_note" | "substitution"; number: string; issuedAt: string; total: Decimal; rungBy: string | null }
export interface OrderTender { method: string; amount: Decimal; tip: Decimal }
export interface OrderBillPayment { method: string; state: string; applied: Decimal; tip: Decimal; createdAt: string; refunds: { applied: Decimal; tip: Decimal; state: string; reason: string; createdAt: string }[] }
export interface OrderParty { name: string | null; guestCount: number | null; openedAt: string; closedAt: string | null; openedBy: string | null; closedBy: string | null; tables: string[] }
export interface OrderDeparture { recordedAt: string; reason: string; recordedBy: string | null; authorizedBy: string | null; amount: Decimal }

/** One row as the list shows it, and what it is made of. An id the list would not show is `working_order.not_found`. */
export async function readOrderDetail(tx: Transaction, id: string): Promise<OrderDetail> {
  const { rows } = await listOrders(tx, { status: "all", dates: "any", credited: false, limit: 1, only: id });
  const row = rows[0];
  if (row === undefined) throw new AppError("working_order.not_found", { workingOrderId: id });
  return {
    row,
    lines: row.kind === "bill" ? await readBillLines(tx, id) : await readSaleLines(tx, id),
    invoices: row.saleId === null ? [] : await readInvoices(tx, row.saleId),
    tenders: row.saleId === null ? [] : await readTenders(tx, row.saleId),
    payments: row.kind === "bill" ? await readBillPayments(tx, id) : [],
    party: row.partyId === null ? null : await readParty(tx, row.partyId, row.tables),
    departure: row.kind === "bill" ? await readDeparture(tx, id) : null,
  };
}
```

  Write the seven readers named there with `tx.select(...)`, each one query, each left-joining
  `persons` for a name where the row holds a person id (`working_order_lines.credited_to`,
  `sales.operator_id`, `parties.opened_by`/`closed_by`, `unpaid_departures.recorded_by`/`authorized_by`
  through two `alias(persons, …)` as `apps/server/src/unpaid-departure.ts:236-260` does).
  `readBillLines` reads `working_order_lines` ordered by `line_no` (frozen once the bill is sent:
  `packages/db/src/schema/orders.ts:28-30`), with `quantity` through `thousandthsToDecimal` and the
  money columns through `centsToDecimal`; `listUnitPrice` is `list_unit_price_gross` or null.
  `readSaleLines` reads `sale_lines` (`line_gross ?? line_total` as `total`). `readInvoices` reads the
  invoice, then every `sales` row whose `corrects_sale_id` is it (`credit_note`), then every
  `sale_substitutions.substitution_sale_id` naming it (`substitution`), in one query with a `union all`
  or three ordered queries — three is still a fixed number. `readBillPayments` reads `bill_payments`
  for the bill ordered by `created_at, rowid`, then their `bill_payment_refunds` in one `inArray` query.

- [ ] **Step 5: Write `apps/server/src/orders-api.ts`, export `queryFlag`, mount it.**

  In `apps/server/src/report-api.ts:83` change `function queryFlag(` to `export function queryFlag(`.

```ts
// apps/server/src/orders-api.ts
// Registers `management.request_invalid`.
import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError, isUuid } from "@waitron/shared";
import { withTransaction, type Database, type Transaction } from "@waitron/db";
import { currentBusinessDay } from "@waitron/reporting";
import { authorizeManager, type Permission } from "@waitron/identity";
import { createErrorBoundary, requireEnum, requireManagementSession, requireRange } from "@waitron/server-kit";
import { queryFlag, resolveVenueClock } from "./report-api.js";
import {
  DEFAULT_ORDER_PAGE_SIZE, MAX_ORDER_PAGE_SIZE, ORDER_STATUS_FILTERS, listOrderStaff, listOrders, readOrderDetail,
  type OrderCursor, type OrderListFilter,
} from "./orders-list.js";
import type { Logger } from "./logger.js";

/** Choice 2. */
const ORDERS_PERMISSION: Permission = "report.view";

const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
  "working_order.not_found": 404,
};
// The report routes' server-fault code: no new code (spec §7).
const run = createErrorBoundary(STATUS, "report.failed");

const CURSOR = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)_(.+)$/;
const PAGE_SIZE = /^[1-9]\d{0,2}$/;
const TEXT_MAX = 100;

const invalid = (field: string) => new AppError("management.request_invalid", { field });

function optionalText(raw: string | undefined, field: string): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length > TEXT_MAX) throw invalid(field);
  return trimmed === "" ? undefined : trimmed;
}

function requireCursor(raw: string | undefined): OrderCursor | undefined {
  if (raw === undefined) return undefined;
  const match = CURSOR.exec(raw);
  if (match === null || !isUuid(match[2]!)) throw invalid("after");
  return { at: match[1]!, id: match[2]!.toLowerCase() };
}

/** Each refusal names the query field, so the screen can show it under that control. */
export function parseOrdersQuery(query: (name: string) => string | undefined): {
  dates: "any" | { from: string; to: string } | undefined;
  filter: Omit<OrderListFilter, "dates">;
} {
  const status = requireEnum(query("status") ?? "all", "status", ORDER_STATUS_FILTERS);
  const from = query("from");
  const to = query("to");
  const anyDate = queryFlag(query("anyDate"), "anyDate");
  if (anyDate && (from !== undefined || to !== undefined)) throw invalid("anyDate");
  const dates = anyDate ? "any" : from === undefined && to === undefined ? undefined : requireRange(from, to);
  const staff = query("staff");
  if (staff !== undefined && !isUuid(staff)) throw invalid("staff");
  const limit = query("limit");
  if (limit !== undefined && (!PAGE_SIZE.test(limit) || Number(limit) > MAX_ORDER_PAGE_SIZE)) throw invalid("limit");
  return {
    dates,
    filter: {
      status,
      credited: queryFlag(query("credited"), "credited"),
      staffId: staff?.toLowerCase(),
      table: optionalText(query("table"), "table"),
      search: optionalText(query("q"), "q"),
      limit: limit === undefined ? DEFAULT_ORDER_PAGE_SIZE : Number(limit),
      after: requireCursor(query("after")),
    },
  };
}

export function mountOrdersApi(app: Hono, deps: { db: Database; cfg: { nodeId: string } }, log: Logger): void {
  const gated = <T>(sessionId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTransaction(deps.db, async (tx) => {
      await authorizeManager(tx, { managementSessionId: sessionId, permission: ORDERS_PERMISSION });
      return fn(tx);
    });

  app.get("/management-api/orders", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const { dates, filter } = parseOrdersQuery((name) => c.req.query(name));
      const answer = await gated(sessionId, async (tx) => {
        let range: { from: string; to: string } | null = null;
        let window: OrderListFilter["dates"] = "any";
        if (dates !== "any") {
          const clock = await resolveVenueClock(tx, deps.cfg.nodeId);
          const today = currentBusinessDay(clock);
          range = dates ?? { from: today, to: today };
          window = { ...range, ...clock };
        }
        const page = await listOrders(tx, { ...filter, dates: window });
        return { ...page, range };
      });
      return c.json({
        rows: answer.rows,
        next: answer.next === null ? null : `${answer.next.at}_${answer.next.id}`,
        from: answer.range?.from ?? null,
        to: answer.range?.to ?? null,
      });
    }),
  );

  // Registered before `/:id`, which would otherwise take "staff" as an id.
  app.get("/management-api/orders/staff", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      return c.json({ staff: await gated(sessionId, listOrderStaff) });
    }),
  );

  app.get("/management-api/orders/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = c.req.param("id").toLowerCase();
      if (!isUuid(id)) throw new AppError("working_order.not_found", { workingOrderId: id });
      return c.json(await gated(sessionId, (tx) => readOrderDetail(tx, id)));
    }),
  );
}
```

  In `apps/server/src/boot.ts`, import `mountOrdersApi` and, directly after the `mountReportApi(...)`
  call at `:1549-1553`, add `mountOrdersApi(app, { db, cfg: { nodeId: dataNodeId } }, log);` — the
  same data node the reports use (see the comment above that call).

- [ ] **Step 6: Run the list tests; watch them pass.**
  `pnpm --filter @waitron/server exec vitest run src/orders-list.test.ts` → PASS. A case that fails
  on a status is a finding about the spec or this plan: stop and report it, do not bend the case.

- [ ] **Step 7: The query count, and which index a read starts from.** Create
  `apps/server/src/orders-list.reads.test.ts` with its own venue, so no other file's bills change
  which reads run. No single row can make every read run — an invoiced bill asks for amounts due,
  an uninvoiced one for payments — so the smallest page that asks all seven is three bills, one of
  each shape below. The test compares that page with fifty rows of the same shapes, and checks a
  one-row page asks no more:

```ts
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withTransaction } from "@waitron/db";
import { seatedWith } from "./testing/bill-venue.js";
import { contribute, credit, departed, placedInvoiceFirst, provisionOrderVenue, type OrderVenue } from "./testing/order-venue.js";
import { listOrders, ordersPageSql, type OrderListFilter } from "./orders-list.js";

let venue: OrderVenue;
useVenueDb({ resetPerTest: false, migrations: migrationOptionsFor(manifestSets(), null), timeoutMs: 60_000,
  setup: async (db) => { venue = await provisionOrderVenue(db); } });

const ANY: OrderListFilter = { status: "all", dates: "any", credited: false, limit: 50 };

/**
 * Three bills, oldest first, that between them make `listOrders` ask every read: a party's open bill
 * holding a cash payment (payments, refunds, tables, staff), an invoiced bill with a credit note
 * (amounts due, credit notes), and a debt (a departure).
 */
async function oneOfEach(): Promise<void> {
  const party = await seatedWith(venue, "Caña", "Tarta");
  await contribute(venue, party.tabId, "5.00");
  const invoiced = await placedInvoiceFirst(venue, "Botella tinto");
  await credit(venue, invoiced, "2.00", "-2.42");
  await departed(venue, "Croquetas");
}

async function readsFor(limit: number) {
  return withTransaction(venue.db, async (tx) => {
    const spies = [vi.spyOn(tx, "select"), vi.spyOn(tx, "selectDistinct"), vi.spyOn(tx, "execute")];
    const page = await listOrders(tx, { ...ANY, limit });
    return {
      statuses: page.rows.map((row) => row.status),
      reads: spies.reduce((sum, spy) => sum + spy.mock.calls.length, 0),
    };
  });
}

describe("reads per page", () => {
  it("asks the same seven reads for three rows of every shape as for fifty", async () => {
    for (let n = 0; n < 17; n++) await oneOfEach();
    const three = await readsFor(3);
    expect(three.statuses).toEqual(["left_without_paying", "waiting_for_payment", "open"]);
    expect(three.reads).toBe(7);
    const fifty = await readsFor(50);
    expect(fifty.statuses).toHaveLength(50);
    expect(fifty.reads).toBe(7);
    expect((await readsFor(1)).reads).toBeLessThanOrEqual(7);
  });
});

/**
 * Read, not run, when this plan was written: the spec's receipt (§4.6) is the review's own
 * `EXPLAIN QUERY PLAN` on `node:sqlite`. The planner's wording and choice can change with the SQLite
 * version Node ships and with ANALYZE statistics (none are kept). If a case fails, print the plan in
 * the PR and report it; do not loosen the pattern.
 */
describe("which index a read starts from", () => {
  async function plan(filter: Partial<OrderListFilter>): Promise<string> {
    return withTransaction(venue.db, async (tx) => {
      const { rows } = await tx.execute<{ detail: string }>(sql`explain query plan ${ordersPageSql({ ...ANY, ...filter })}`);
      return rows.map((row) => row.detail).join("\n");
    });
  }

  it("Unpaid at any date reads bills through the status index", async () => {
    expect(await plan({ status: "unpaid" })).toMatch(/working_orders_tenant_status_idx/);
  });

  it("a date range reads bills through the opened-at index", async () => {
    expect(await plan({ dates: { from: "2026-03-01", to: "2026-03-02", timeZone: "Europe/Madrid", dayCutover: "05:00" } }))
      .toMatch(/working_orders_opened_at_idx/);
  });

  // The control: if this one also names an index, the two above prove nothing.
  it("All at any date reads every bill, through neither index", async () => {
    expect(await plan({ status: "all" })).not.toMatch(/working_orders_(tenant_status|opened_at)_idx/);
  });
});
```

  Run: `pnpm --filter @waitron/server exec vitest run src/orders-list.reads.test.ts` → PASS. Then
  prove both by deletion, and say in the PR what you ran: move `readStaff`'s query inside the
  `raw.map` (one per row) and watch the fifty-row count exceed seven; delete `${billScope(filter)}`
  from `rowsSql` and watch the Unpaid plan stop naming the status index. Put both back.

- [ ] **Step 8: Route refusals and the detail.** Create `apps/server/src/orders-api.test.ts`, with
  `provisionOrderVenue` as above, covering:
  - no cookie → 401 `management_session.required`; Ana's (`staffDashboard`) → 403
    `authorization.not_permitted`; the supervisor's → 200.
  - each malformed filter → 400 `management.request_invalid` with that `field`, one `it.each` row
    each: `status=bogus` → `status`; `from=2026-02-30&to=2026-03-01` → `from`;
    `from=2026-03-02&to=2026-03-01` → `range`; `from=2026-03-01` alone → `to`;
    `anyDate=true&from=2026-03-01&to=2026-03-01` → `anyDate`; `anyDate=yes` → `anyDate`;
    `credited=1` → `credited`; `staff=nobody` → `staff`; `table=` + 101 × `x` → `table`;
    `q=` + 101 × `x` → `q`; `limit=0`, `limit=201` → `limit`; `after=2026-03-01_x` → `after`.
  - `GET /management-api/orders/not-a-uuid` and an unknown uuid → 404 `working_order.not_found`.
  - `GET /management-api/orders/staff` names someone since deactivated: insert a person as Step 1
    inserts Sofía, `parkedBy(venue, theirId, "Caña")` a bill (the lines are credited to the
    operator: `ParkOrderRequest`'s comment, `apps/server/src/working-order.ts`, above
    `export interface ParkOrderRequest`), then deactivate them with `deactivatePerson`
    (`@waitron/identity`, as `apps/server/src/management-api.ts:950-959` calls it, on an admin
    management session) → the answer still lists them by name. A person with no `persons` row cannot
    be made by any product path (no route deletes one — read, not run), so the "Unknown person" case
    is not tested; say so in the PR. Ana's session → 403.
  - the detail of a departed, part-credited, collected bill (`departed` → `credit` → `collect`)
    holds: its lines with `creditedTo: "Ana"`; `invoices` `[invoice, credit_note]` in that order;
    one cash tender of the amount `row.stillOwed` read just before collecting; `party.tables`
    naming the table; and `departure` with `reason`, `recordedBy: "Sofía"`, `authorizedBy: "Sofía"`.
  Run: `pnpm --filter @waitron/server exec vitest run src/orders-api.test.ts` → PASS.

- [ ] **Step 9: The whole check for this task.**
  - `pnpm --filter @waitron/server exec vitest run src/orders-list.test.ts src/orders-list.reads.test.ts src/orders-api.test.ts src/report-api.test.ts src/unpaid-departure.test.ts`
  - `pnpm --filter @waitron/server test:coverage` — only if a coverage figure needs chasing; CI
    runs it. The bar is `98/98/98/95`; read the per-file table for `orders-list.ts` and
    `orders-api.ts`, not the exit code.
  - `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts` — unedited, PASS.
  - `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts` — no code
    changed, so both pass as they did.
  - `pnpm --filter @waitron/server typecheck && pnpm lint && pnpm format:check`.

- [ ] **Step 10: Commit and finish.** Update `docs/backlog.md`'s B27s entry ("Task 1, the Orders
  routes, is on `feat/orders-list-routes`"), then:

```bash
git add apps/server/src/orders-list.ts apps/server/src/orders-api.ts apps/server/src/testing/order-venue.ts \
  apps/server/src/orders-list.test.ts apps/server/src/orders-list.reads.test.ts apps/server/src/orders-api.test.ts \
  apps/server/src/report-api.ts apps/server/src/boot.ts docs/backlog.md
git commit -s -m "Dashboard Orders, part 1: the server lists every bill with its status and what it still owes

GET /management-api/orders lists bills newest first, filtered by status (Unpaid included), the
business day each bill was opened, staff, table and a search by invoice number, order number or
name, a page at a time. GET /management-api/orders/:id reads one bill's lines, invoices, payments,
party and departure, and GET /management-api/orders/staff names everyone who appears on a bill. All
need report.view. What a bill still owes comes from the same readIssuedSales and readPaymentsByBill
the till's collect uses. A voided invoice's bill reads Voided ahead of Waiting for payment, because
voiding never changes the bill's own status; a sent bill cancelled with its invoice standing is
marked Invoice not credited."
```

  Then run `/finish-branch` with this worktree. This diff touches a by-id read and authorization, so
  it takes the full review path (`~/.claude/CLAUDE.md`, risk triggers).

---

## Task 2: Dashboard — the Orders screen

**Branch:** `feat/orders-screen` (from `main` after Task 1 has landed)

**Files:**

- Create: `apps/dashboard/src/screens/orders-filter.ts` — the filter, read from and written to the address.
- Create: `apps/dashboard/src/screens/orders-screen.ts` — `dashboard-orders-screen`.
- Create: `apps/dashboard/src/widgets/order-detail-dialog.ts` — `dashboard-order-detail-dialog`.
- Create: `apps/dashboard/src/screens/orders-filter.test.ts`, `apps/dashboard/src/screens/orders-screen.test.ts`,
  `apps/dashboard/src/screens/orders-screen.a11y.test.ts`.
- Modify: `apps/dashboard/src/api/client.ts` — types and `listOrders`, `listOrderPages`,
  `listOrderStaff`, `getOrder` (beside `getSalesPeriod`, `:2709`).
- Modify: `apps/dashboard/src/api/live-queries.ts:25-210` — `listOrderPages`, `listOrderStaff`,
  `getOrder` dependencies.
- Modify: `apps/dashboard/src/navigation.ts:6-15` — `orders` children.
- Modify: `apps/dashboard/src/dashboard-app.ts` — `CORE_SCREENS` (`:86-117`), `NAV_GROUPS` reports
  group (`:145-151`), `#renderScreen` (`:1612`), and the screen's import (`:41-42`).
- Modify: `apps/dashboard/src/dashboard-app.test.ts` — the nav cases.
- Modify: `apps/dashboard/src/i18n/strings.ts` (en `:1` and es `:1939`), `apps/dashboard/src/i18n/codes.ts`
  (`working_order.not_found`).
- Modify: `docs/backlog.md` — B27s entry.

**Interfaces:**

- Consumes: Task 1's two routes and JSON shapes (Interfaces of Task 1).
- Produces (client.ts):

```ts
export const ORDER_STATUS_FILTERS = ["all", "open", "waiting_for_payment", "left_without_paying", "unpaid", "paid", "cancelled", "voided"] as const;
export type OrderStatusFilter = (typeof ORDER_STATUS_FILTERS)[number];
export type OrderStatus = Exclude<OrderStatusFilter, "all" | "unpaid">;
export interface OrdersQuery { status: OrderStatusFilter; from?: string; to?: string; anyDate: boolean; credited: boolean; staff?: string; table?: string; q?: string }
export interface OrderRowDto {
  kind: "bill" | "sale"; id: string; at: string; orderNumber: number | null; label: string | null;
  partyId: string | null; partyName: string | null; tables: string[]; counter: boolean;
  saleId: string | null; invoiceNumber: string | null; creditNotes: string[]; status: OrderStatus;
  credited: "in_full" | "in_part" | null; invoiceNotCredited: boolean; total: string; stillOwed: string | null;
  staff: { id: string; name: string | null }[]; departedAt: string | null;
}
export interface OrdersPageDto { rows: OrderRowDto[]; next: string | null; from: string | null; to: string | null }
export interface OrderDetailDto {
  row: OrderRowDto;
  lines: { lineNo: number; name: string; variantName: string | null; quantity: string; total: string; listUnitPrice: string | null; creditedTo: string | null }[];
  invoices: { kind: "invoice" | "credit_note" | "substitution"; number: string; issuedAt: string; total: string; rungBy: string | null }[];
  tenders: { method: string; amount: string; tip: string }[];
  payments: { method: string; state: string; applied: string; tip: string; createdAt: string; refunds: { applied: string; tip: string; state: string; reason: string; createdAt: string }[] }[];
  party: { name: string | null; guestCount: number | null; openedAt: string; closedAt: string | null; openedBy: string | null; closedBy: string | null; tables: string[] } | null;
  departure: { recordedAt: string; reason: string; recordedBy: string | null; authorizedBy: string | null; amount: string } | null;
}
listOrders(query: OrdersQuery, page?: { after?: string }): Promise<OrdersPageDto>;
listOrderPages(query: OrdersQuery, pages: number): Promise<OrdersPageDto>;
listOrderStaff(): Promise<{ staff: { id: string; name: string | null }[] }>;
getOrder(id: string): Promise<OrderDetailDto>;
```

- [ ] **Step 0: Re-map.** `gh pr list --state open`; stop and report if one touches
  `apps/dashboard/src/dashboard-app.ts`, `navigation.ts`, `api/client.ts`, `api/live-queries.ts` or
  `i18n/strings.ts` in a way that conflicts (a sibling key added beside yours is not a conflict).
  Re-verify on `main`: Task 1's routes are mounted (`apps/server/src/boot.ts`, beside `:1549`);
  `DashboardQueries.watch` passes the API on the first read and `background` after
  (`apps/dashboard/src/api/query-controller.ts:11-16`); `dashboardPath` children shape
  (`apps/dashboard/src/navigation.ts:3-16`); `#mayOpen` honours `requiresPermission`
  (`apps/dashboard/src/dashboard-app.ts`, the method above `#permittedScreen`, `:1365-1372`);
  `GET /management-api/orders/staff` exists (Task 1); the shared controls are as cited below
  (`selectStyles`, `packages/ui/src/base-styles.ts:34-55`; `wt-switch`,
  `packages/ui/src/components/wt-switch.ts:97-110`, which `docs/developers/design-system.md:196-199`
  names among the shared fields); and whether A178's filled fields have landed
  (`grep -n A178 docs/backlog.md`). If they have, use them for the filter controls in place of the
  ones below, and say so in the PR. The Staff filter does NOT read `/management-api/staff-roster`
  (`apps/server/src/management-api.ts:604-611`): that lists active staff only, and spec §4.3 wants
  everyone who appears on a bill.

- [ ] **Step 1: Write the failing filter tests.** `apps/dashboard/src/screens/orders-filter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_ORDERS_FILTER, readOrdersFilter, withStatus, writeOrdersFilter, type OrdersFilter } from "./orders-filter.js";

const reader = (values: Record<string, string>) => (key: string) => values[key] ?? null;

describe("orders filter in the address", () => {
  it("round-trips every field", () => {
    const filter: OrdersFilter = { status: "paid", from: "2026-09-01", to: "2026-09-30", anyDate: false, credited: true,
      staff: "1b4e28ba-2fa1-41d2-883f-0016d3cca427", table: "Mesa 5", q: "A/12" };
    const written = writeOrdersFilter(filter);
    expect(readOrdersFilter(reader(Object.fromEntries(Object.entries(written).filter(([, v]) => v !== null)) as Record<string, string>))).toEqual(filter);
  });

  it("writes nothing for the defaults, so the plain address means today, all statuses", () => {
    expect(Object.values(writeOrdersFilter(DEFAULT_ORDERS_FILTER)).every((v) => v === null)).toBe(true);
  });

  it("ignores an unreadable status or date in the address", () => {
    expect(readOrdersFilter(reader({ status: "bogus", from: "2026-13-01", to: "2026-09-02", staff: "x" }))).toEqual(DEFAULT_ORDERS_FILTER);
  });

  it("switches to any date when Unpaid or Left without paying is chosen (choice 3), and leaves dates alone otherwise", () => {
    const dated = { ...DEFAULT_ORDERS_FILTER, from: "2026-09-01", to: "2026-09-02" };
    expect(withStatus(dated, "unpaid")).toMatchObject({ status: "unpaid", anyDate: true, from: undefined, to: undefined });
    expect(withStatus(dated, "left_without_paying")).toMatchObject({ anyDate: true });
    expect(withStatus(dated, "paid")).toMatchObject({ status: "paid", anyDate: false, from: "2026-09-01" });
  });
});
```

  Run `pnpm --filter @waitron/dashboard exec vitest run src/screens/orders-filter.test.ts` → FAIL
  (module missing).

- [ ] **Step 2: Write `orders-filter.ts`** and the client types it imports.

```ts
// apps/dashboard/src/screens/orders-filter.ts
import { ORDER_STATUS_FILTERS, type OrderStatusFilter, type OrdersQuery } from "../api/client.js";

export type OrdersFilter = OrdersQuery;
export const DEFAULT_ORDERS_FILTER: OrdersFilter = { status: "all", anyDate: false, credited: false };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const realDay = (v: string | null): v is string =>
  v !== null && DAY.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** Anything the server would refuse is dropped here, so a bad link shows the defaults. */
export function readOrdersFilter(read: (key: string) => string | null): OrdersFilter {
  const status = read("status");
  const from = read("from");
  const to = read("to");
  const datesOk = realDay(from) && realDay(to) && from <= to;
  const staff = read("staff");
  const text = (key: string) => {
    const value = read(key)?.trim();
    return value === undefined || value === "" || value.length > 100 ? undefined : value;
  };
  return {
    status: (ORDER_STATUS_FILTERS as readonly string[]).includes(status ?? "") ? (status as OrderStatusFilter) : "all",
    ...(datesOk ? { from, to } : {}),
    anyDate: read("dates") === "any",
    credited: read("credited") === "yes",
    ...(staff !== null && UUID.test(staff) ? { staff } : {}),
    ...(text("table") === undefined ? {} : { table: text("table") }),
    ...(text("q") === undefined ? {} : { q: text("q") }),
  };
}

export function writeOrdersFilter(f: OrdersFilter): Record<string, string | null> {
  return {
    status: f.status === "all" ? null : f.status,
    from: f.anyDate ? null : (f.from ?? null),
    to: f.anyDate ? null : (f.to ?? null),
    dates: f.anyDate ? "any" : null,
    credited: f.credited ? "yes" : null,
    staff: f.staff ?? null,
    table: f.table ?? null,
    q: f.q ?? null,
  };
}

/** Choice 3: a debt from last week is still owed today. */
export function withStatus(f: OrdersFilter, status: OrderStatusFilter): OrdersFilter {
  const debts = status === "unpaid" || status === "left_without_paying";
  return debts ? { ...f, status, anyDate: true, from: undefined, to: undefined } : { ...f, status };
}
```

  `readOrdersFilter` with `anyDate: true` and dates present keeps `anyDate` and drops nothing; the
  request builder below sends dates only when `anyDate` is false, matching the server's
  `anyDate`-with-dates refusal.

  In `apps/dashboard/src/navigation.ts` add the screen's address fields:
  `orders: { status: "status", from: "from", to: "to", dates: "dates", credited: "credited", staff: "staff", table: "table", q: "q" },`

  In `apps/dashboard/src/api/client.ts`, beside `getSalesPeriod` (`:2709`), add the Interfaces
  block's types and:

```ts
  listOrders(query: OrdersQuery, page: { after?: string } = {}): Promise<OrdersPageDto> {
    const params = new URLSearchParams();
    if (query.status !== "all") params.set("status", query.status);
    if (query.anyDate) params.set("anyDate", "true");
    else if (query.from !== undefined && query.to !== undefined) {
      params.set("from", query.from);
      params.set("to", query.to);
    }
    if (query.credited) params.set("credited", "true");
    if (query.staff !== undefined) params.set("staff", query.staff);
    if (query.table !== undefined) params.set("table", query.table);
    if (query.q !== undefined) params.set("q", query.q);
    if (page.after !== undefined) params.set("after", page.after);
    return this.#request<OrdersPageDto>(`/management-api/orders?${params}`, "GET");
  }

  /** The first `pages` pages, one request each, so a refresh re-reads every row shown. */
  async listOrderPages(query: OrdersQuery, pages: number): Promise<OrdersPageDto> {
    let page = await this.listOrders(query);
    const rows = [...page.rows];
    for (let n = 1; n < pages && page.next !== null; n++) {
      page = await this.listOrders(query, { after: page.next });
      rows.push(...page.rows);
    }
    return { ...page, rows };
  }

  /** Everyone who appears on a bill, active or not (decision 12). */
  listOrderStaff(): Promise<{ staff: { id: string; name: string | null }[] }> {
    return this.#request<{ staff: { id: string; name: string | null }[] }>("/management-api/orders/staff", "GET");
  }

  getOrder(id: string): Promise<OrderDetailDto> {
    return this.#request<OrderDetailDto>(`/management-api/orders/${encodeURIComponent(id)}`, "GET");
  }
```

  In `apps/dashboard/src/api/live-queries.ts`, add to `QUERY_DEPENDENCIES` (every name is a core or
  identity change source: `packages/db/src/classification.ts:203-208`, `packages/identity/src/classification.ts:58`):

```ts
  // `listOrders` (apps/server/src/orders-list.ts): the page, then amounts due, payments before an
  // invoice, credit notes, tables and staff.
  listOrderPages: [
    "working_orders", "working_order_lines", "order_amendments", "sales", "invoice_series", "sale_settlements",
    "sale_voids", "sale_substitutions", "unpaid_departures", "parties", "party_tables", "dining_tables",
    "bill_payments", "bill_payment_refunds", "persons",
  ],
  // `listOrderStaff` reads every line; following `working_order_lines` would re-read it on each line
  // rung, so it follows `persons` only and catches new names on the query's 60-second timer
  // (`refreshMs`, `dashboardQuery`, this file).
  listOrderStaff: ["persons"],
  getOrder: [
    "working_orders", "working_order_lines", "order_amendments", "sales", "sale_lines", "invoice_series",
    "sale_settlements", "sale_voids", "sale_substitutions", "tenders", "unpaid_departures", "parties",
    "party_tables", "dining_tables", "bill_payments", "bill_payment_refunds", "persons",
  ],
```

  Run the filter test → PASS. Run `pnpm exec vitest run scripts/live-subscriptions.test.ts` → PASS.

- [ ] **Step 3: Write the failing screen tests.** `apps/dashboard/src/screens/orders-screen.test.ts`,
  in the shape of `apps/dashboard/src/screens/alerts-screen.test.ts:36-80` (a stub API with a real
  `LiveData`, `mountWidget`, `history.replaceState` to `/manage/orders`):

```ts
const ANA = "0f8fad5b-d9cb-469f-a165-70867728950e";
// Someone a line was credited to whose `persons` row is gone: the server sends a null name.
const GONE = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

function stubApi(overrides: Partial<Record<keyof DashboardApi, unknown>> = {}): DashboardApi {
  const page: OrdersPageDto = { rows: [debtRow], next: "2026-09-30T20:00:00.000Z_" + debtRow.id, from: null, to: null };
  const api = {
    listOrderPages: vi.fn().mockResolvedValue(page),
    getOrder: vi.fn().mockResolvedValue(debtDetail),
    listOrderStaff: vi.fn().mockResolvedValue({ staff: [{ id: ANA, name: "Ana" }, { id: GONE, name: null }] }),
    liveData: new LiveData(),
    ...overrides,
  };
  return { ...api, background: { ...api, listOrderPages: vi.fn().mockResolvedValue(page), getOrder: vi.fn().mockResolvedValue(debtDetail) } } as unknown as DashboardApi;
}
```

  Cases, each asserting what a person would see or what the address holds:
  - "writes the chosen status to the address and reads it back": choose Paid in the status select →
    `location.pathname` is `/manage/orders/status/paid`; remount on `/manage/orders/status/paid` →
    the select shows Paid and `listOrderPages` was called with `{ status: "paid", … }`.
  - "Unpaid switches the dates to Any date": choose Unpaid → the Any date switch is on, the two date
    fields are disabled, the address is `/manage/orders/status/unpaid/dates/any`.
  - "the date fields say the range is by the day the bill was opened": their labels read
    "Opened from" and "Opened to".
  - "the Staff filter offers everyone the server names, a person with no name as Unknown person":
    the staff `<select>` holds Anyone, Ana and "Unknown person".
  - "the row menu column is pinned to the end": `table.columns.find((c) => c.key === "actions")?.pinned === "end"`.
  - "Show more reads one more page": click `[data-test=show-more]` → the newest call of
    `listOrderPages` has `pages` 2.
  - "a refresh after the first read is passive": after the first read, `api.liveData.invalidate([{ type: "working_orders" }])`
    → `background.listOrderPages` was called and `api.listOrderPages` was called once only.
  - "a refusal naming a field is shown under that field, in that field's words": `it.each` over
    `table`, `q`, `staff`, `range`: `listOrderPages` rejects with
    `{ code: "management.request_invalid", params: { field } }` → the matching control (To for
    `range`) shows that field's own sentence from Step 7's table (for example "Keep the table to 100
    characters or fewer"), no other control shows one, and the table's error line reads
    `form.fix_fields`.
  - "a debt row shows its status, its mark and what it owes": the row reads "Left without paying",
    "Credited in part", the still-owed money formatted for the locale.
  - "a cancelled bill with an invoice shows the invoice and Invoice not credited": a row with
    `status: "cancelled"`, an invoice number and `invoiceNotCredited: true` shows the number, the
    mark, and a blank Still owed; the same row with `invoiceNotCredited: false` shows no mark.
  - "the detail dialog shows each section": click the row → `getOrder` called with its id; the dialog
    shows the lines with who served each, the invoice and credit note numbers, the cash tender, the
    party's tables, and the departure's reason and who recorded and authorised it.
  - one case in Spanish (`setLocale("es-ES")`): the column headings and statuses read in Spanish.

  Add `orders-screen.a11y.test.ts` with axe over the loaded screen and over the open detail dialog,
  in both themes (copy the theme loop of an existing `*.a11y.test.ts` under `apps/dashboard/src/screens`).

  Run `pnpm --filter @waitron/dashboard exec vitest run src/screens/orders-screen.test.ts` → FAIL
  (element not defined).

- [ ] **Step 4: Write the screen.** `apps/dashboard/src/screens/orders-screen.ts`. It imports
  `baseStyles`, `selectStyles` and `UrlStateController` from `@waitron/ui`, and the components it
  draws by path, as `canvas-editor-screen.ts:5-8` does (`wt-data-table`, `wt-input`, `wt-switch`,
  `wt-button`, `wt-row-actions`). Its shape:

```ts
@customElement("dashboard-orders-screen")
export class OrdersScreen extends LitElement {
  // `selectStyles` (packages/ui/src/base-styles.ts:34) styles the native selects, as
  // canvas-editor-screen.ts:5,47 uses it; nothing here restyles a select or a switch.
  static override styles = [baseStyles, selectStyles, css`
    :host { display: block; }
    .filters { display: flex; flex-wrap: wrap; gap: var(--wt-space-3); align-items: end; margin-bottom: var(--wt-space-4); }
    .filters label { display: flex; flex-direction: column; gap: var(--wt-space-1); color: var(--wt-color-text); }
    .field-error { color: var(--wt-color-danger); margin: 0; }
    .more { margin-top: var(--wt-space-3); }
    wt-data-table::part(owed) { font-weight: var(--wt-font-weight-bold); }
    wt-data-table::part(mark) { display: block; color: var(--wt-color-text-muted); }
  `];

  @property({ attribute: false }) api!: DashboardApi;
  @state() private filter: OrdersFilter = DEFAULT_ORDERS_FILTER;
  @state() private pages = 1;
  @state() private page?: OrdersPageDto;
  @state() private loadingMore = false;
  @state() private refusal: { field: OrdersField | null; message: string } | null = null;
  @state() private staff: { id: string; name: string | null }[] = [];
  @state() private openId: string | null = null;
  #textTimer?: ReturnType<typeof setTimeout>;

  readonly #queries = new DashboardQueries(this, () => this.api, (error) => this.#refused(error));
  readonly #url = new UrlStateController(this, () => {
    if (this.#url.read("dashboard") !== "orders") return;
    this.filter = readOrdersFilter((key) => this.#url.read(key));
    this.pages = 1;
    this.#watch();
  }, dashboardPath);

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#queries.watch("listOrderStaff", [], ({ staff }) => { this.staff = staff; }).catch(() => undefined);
  }

  #watch(): void {
    if (!this.filter.anyDate && this.filter.from !== undefined && this.filter.to !== undefined && this.filter.from > this.filter.to) {
      this.#queries.release("listOrderPages");
      this.refusal = { field: "to", message: t("orders.range_backwards") };
      return;
    }
    void this.#queries.watch("listOrderPages", [this.filter, this.pages], (page) => {
      this.page = page;
      this.loadingMore = false;
      this.refusal = null;
    }).catch(() => undefined);
  }

  #apply(next: OrdersFilter): void {
    this.filter = next;
    this.pages = 1;
    this.page = undefined;
    this.#url.write(writeOrdersFilter(next));
    this.#watch();
  }

  /**
   * A refusal naming a shown field is said under it in that field's own words, as the Backups screen
   * turns `{ field: "retention" }` into `backup.retention_invalid` (backup-screen.ts:357-362, :978);
   * `range` is the server's name for a backwards range (packages/server-kit/src/request-screens.ts:38),
   * said under To. Anything else gets the code's own message in the table.
   */
  #refused(error: unknown): void {
    this.loadingMore = false;
    const raw = (error as { params?: { field?: unknown } } | null)?.params?.field;
    const field = codeOf(error) === "management.request_invalid" && typeof raw === "string" ? FIELD_OF[raw] : undefined;
    this.refusal = field === undefined
      ? { field: null, message: codeMessage(codeOf(error)) }
      : { field: field.control, message: t(field.message) };
  }
  // …render(): the filter bar, the table, Show more, the dialog…
}
```

  `OrdersField` is `"status" | "from" | "to" | "anyDate" | "credited" | "staff" | "table" | "q"`, and
  above the class:

```ts
const FIELD_OF: Record<string, { control: OrdersField; message: StringKey }> = {
  status: { control: "status", message: "orders.refused.status" },
  from: { control: "from", message: "orders.refused.date" },
  to: { control: "to", message: "orders.refused.date" },
  range: { control: "to", message: "orders.range_backwards" },
  anyDate: { control: "anyDate", message: "orders.refused.any_date" },
  credited: { control: "credited", message: "orders.refused.credited" },
  staff: { control: "staff", message: "orders.refused.staff" },
  table: { control: "table", message: "orders.refused.table" },
  q: { control: "q", message: "orders.refused.search" },
};
```

  While a field shows a refusal, the table's `errorMessage` is `t("form.fix_fields")`
  (`apps/dashboard/src/i18n/strings.ts:389`, the forms rule's one message for the whole bar).
  The filter bar, in this order, each control with a semantic `name`:
  - `<select name="status">` with one `<option>` per `ORDER_STATUS_FILTERS`, each marked with
    `.selected=${s === this.filter.status}` (CLAUDE.md §3: a Lit `<select>` with templated options
    needs `.selected`), `@change` → `this.#apply(withStatus(this.filter, value))`.
  - `<wt-input type="date" name="from" label=${t("orders.opened_from")}>` and `name="to"`
    (`orders.opened_to`) — "opened", because a bill belongs to the day it was opened while the Sales
    screen counts an invoice on the day it was issued (spec §4.3) — `?disabled=${this.filter.anyDate}`,
    `.value` from `this.filter.from ?? this.page?.from ?? ""`; on `wt-change`, apply only once both
    hold a day.
  - `<wt-switch name="any-date" label=${t("orders.any_date")} .checked=…>` and
    `<wt-switch name="credited" label=${t("orders.credited_only")}>`, each applying on its
    `wt-change` (`detail.checked`), as `canvas-editor-screen.ts:956-962` reads one.
  - `<label>${t("orders.staff")}<select name="staff">` with "Anyone" and one option per entry of
    `this.staff`, a null name shown as `orders.staff_unknown`, each `.selected` as above.
  - `<wt-input name="table">` and `<wt-input name="q" placeholder=${t("orders.search_hint")}>`; on
    `wt-change` set a 400 ms timer (cleared on each keystroke and in `disconnectedCallback`) that
    applies the trimmed value, and apply at once on Enter.
  - Each control shows `this.refusal.message` under it when `this.refusal.field` is its field
    (`wt-input` through its `error` property; a select or a `wt-switch`, which has no `error`
    property (`wt-switch.ts:97-104`), through a `<p class="field-error" id=… role="alert">` after it,
    linked by `aria-describedby` on the select). A refusal naming no shown field goes in the
    table's `errorMessage`.

  The table follows `apps/dashboard/src/widgets/product-list.ts`'s `render()` (`:693`):
  `<wt-data-table viewKey="waitron.orders.table" columnsLabel=${t("table.columns")} .rows=${rows} .columns=${this.#columns()}
  .rowKey=${(r) => r.id} .rowClick=${(r) => (this.openId = r.id)} .rowClickLabel=${(r) => t("orders.view")}
  .loading=${this.page === undefined && this.refusal === null} .loadingMessage=${t("orders.loading")}
  .emptyMessage=${t("orders.empty")} .errorMessage=${this.refusal?.field === null ? this.refusal.message : ""}>`.
  It is NOT `searchable` and declares no column filters: filtering is the server's
  (`wt-data-table` filters only the rows it holds — spec §4.6).

  `#columns()` returns, in order: `opened` (date and time in `currentLocale()`), `bill` (`No. 12`
  from `orders.order_number`, or the label), `table` (`tables.join(", ")`, or "Counter" when
  `counter`, else blank), `invoice` (the number, then each credit note on its own line),
  `status` (`choosable: "shown"`; the status label, and under it in `part="mark"` the credited mark,
  "Invoice not credited" when `invoiceNotCredited`, and, for a Paid or Cancelled row with
  `departedAt`, "Left without paying on <date>"), `total`
  (`formatMoney(row.total, currentLocale())`), `owed` (`choosable: "shown"`; blank when `stillOwed`
  is null; `part="owed"`), `staff` (`choosable: "shown"`; names joined, a null name as
`orders.staff_unknown`), and:

```ts
      {
        key: "actions",
        label: t("orders.col.actions"),
        align: "end",
        pinned: "end",
        cell: (row) => html`<wt-row-actions align="end" data-test=${`actions-${row.id}`}
            label=${`${t("orders.col.actions")}: ${row.invoiceNumber ?? row.label ?? row.id}`}
          ><wt-button align="start" variant="secondary" data-test=${`view-${row.id}`}
            @click=${(event: Event) => { event.stopPropagation(); this.openId = row.id; }}
            >${t("orders.view")}</wt-button></wt-row-actions>`,
      },
```

  Below the table: when `this.page?.next` is not null, a `<wt-button class="more" variant="secondary"
  data-test="show-more" ?loading=${this.loadingMore}>` that sets `loadingMore`, raises `this.pages`
  by one and calls `#watch()`. Last: `<dashboard-order-detail-dialog .api=${this.api} .orderId=${this.openId} @wt-close=${() => (this.openId = null)}>`.

- [ ] **Step 5: Write the detail dialog.** `apps/dashboard/src/widgets/order-detail-dialog.ts`:
  a `LitElement` with `api` and `orderId: string | null` properties and its own `DashboardQueries`;
  in `willUpdate`, when `orderId` changes, `watch("getOrder", [orderId], …)` or `release("getOrder")`
  when null. It renders `<wt-dialog ?open=${this.orderId !== null} heading=…>` whose body has one
  `<section>` each for: the lines (name, variant, quantity, total, "was {price}" when
  `listUnitPrice` differs from the unit price, "Served by {name}"); the invoices (number, issue time,
  total, "Rung by {name}"; a credit note labelled as one; a substitution labelled as the full
  invoice that replaced it); payments (tenders with method and tip; bill payments before the
  invoice with their state, and each refund); the party (name, guest count, tables, opened and
  closed, by whom); and, when there is one, the departure (when, reason, who recorded, who
  authorised, amount then). A `working_order.not_found` answer shows `codeMessage` in the body.
  `wt-dialog` dispatches `wt-close` (`packages/ui/src/components/wt-dialog.ts:147`); let it bubble.

- [ ] **Step 6: Wire the screen into the app.** In `apps/dashboard/src/dashboard-app.ts`:
  - add `import "./screens/orders-screen.js";` beside `:42`;
  - add `"orders"` to `CORE_SCREENS` after `"sales"` (`:90`);
  - add `{ screen: "orders", labelKey: "nav.orders", requiresPermission: "report.view" }` to the
    reports group after Sales (`:150`) — choice 2;
  - add `case "orders": return html\`<dashboard-orders-screen .api=${this.api}></dashboard-orders-screen>\`;`
    to `#renderScreen` (`:1621`).
  In `apps/dashboard/src/dashboard-app.test.ts` add: a supervisor session (`permissions: ["report.view"]`)
  sees `nav-orders` after `nav-sales`; a session without it does not, and `/manage/orders` lands it on
  Overview. Check the expectation at `:4544` (`["nav-overview", "nav-sales"]`): its session holds no
  permissions, so it should stay as it is — if it changes, find out why before editing it.

- [ ] **Step 7: Strings.** Add to `en` and `es` in `apps/dashboard/src/i18n/strings.ts`:

| Key                                  | English                                   | Spanish                                       |
| ------------------------------------ | ----------------------------------------- | --------------------------------------------- |
| `nav.orders`, `orders.title`         | Orders                                    | Pedidos                                       |
| `orders.status`                      | Status                                    | Estado                                        |
| `orders.status.all`                  | All                                       | Todos                                         |
| `orders.status.open`                 | Open                                      | Abierta                                       |
| `orders.status.waiting_for_payment`  | Waiting for payment                       | Pendiente de pago                             |
| `orders.status.left_without_paying`  | Left without paying                       | Se fueron sin pagar                           |
| `orders.status.unpaid`               | Unpaid                                    | Sin pagar                                     |
| `orders.status.paid`                 | Paid                                      | Pagada                                        |
| `orders.status.cancelled`            | Cancelled                                 | Cancelada                                     |
| `orders.status.voided`               | Voided                                    | Anulada                                       |
| `orders.opened_from` / `orders.opened_to` | Opened from / Opened to              | Abierta desde / Abierta hasta                 |
| `orders.any_date`                    | Any date                                  | Cualquier fecha                               |
| `orders.credited_only`               | Only credited                             | Solo con abono                                |
| `orders.staff` / `orders.staff_anyone` | Staff / Anyone                          | Personal / Cualquiera                         |
| `orders.staff_unknown`               | Unknown person                            | Persona desconocida                           |
| `orders.invoice_not_credited`        | Invoice not credited                      | Factura sin abonar                            |
| `orders.refused.status`              | Choose a status from the list             | Elige un estado de la lista                   |
| `orders.refused.date`                | Enter a date as day, month and year       | Escribe la fecha con día, mes y año           |
| `orders.refused.any_date`            | Choose Any date or a range, not both      | Elige Cualquier fecha o un intervalo, no ambos |
| `orders.refused.credited`            | Turn Only credited on or off              | Activa o desactiva Solo con abono             |
| `orders.refused.staff`               | Choose a person from the list             | Elige una persona de la lista                 |
| `orders.refused.table`               | Keep the table to 100 characters or fewer | Usa 100 caracteres como mucho para la mesa    |
| `orders.refused.search`              | Keep the search to 100 characters or fewer | Usa 100 caracteres como mucho para la búsqueda |
| `orders.table`                       | Table                                     | Mesa                                          |
| `orders.search` / `orders.search_hint` | Search / Invoice number, name or table  | Buscar / Número de factura, nombre o mesa     |
| `orders.range_backwards`             | Pick a To date on or after From           | Elige una fecha final igual o posterior a la inicial |
| `orders.col.opened`                  | Opened                                    | Apertura                                      |
| `orders.col.bill`                    | Bill                                      | Cuenta                                        |
| `orders.col.table`                   | Table or counter                          | Mesa o barra                                  |
| `orders.col.invoice`                 | Invoice                                   | Factura                                       |
| `orders.col.status`                  | Status                                    | Estado                                        |
| `orders.col.total`                   | Total                                     | Total                                         |
| `orders.col.owed`                    | Still owed                                | Pendiente                                     |
| `orders.col.staff`                   | Staff                                     | Personal                                      |
| `orders.col.actions`                 | Actions                                   | Acciones                                      |
| `orders.counter`                     | Counter                                   | Barra                                         |
| `orders.order_number`                | No. {number}                              | N.º {number}                                  |
| `orders.credited_in_full` / `_in_part` | Credited in full / Credited in part     | Abonada por completo / Abonada en parte       |
| `orders.left_on`                     | Left without paying on {date}             | Se fueron sin pagar el {date}                 |
| `orders.view`                        | View details                              | Ver detalle                                   |
| `orders.empty`                       | No orders match these filters             | Ningún pedido coincide con estos filtros      |
| `orders.loading`                     | Loading orders                            | Cargando pedidos                              |
| `orders.show_more`                   | Show more                                 | Mostrar más                                   |
| `orders.detail.lines`                | Items                                     | Artículos                                     |
| `orders.detail.served_by`            | Served by {name}                          | Servido por {name}                            |
| `orders.detail.was`                  | was {price}                               | antes {price}                                 |
| `orders.detail.invoices`             | Invoices                                  | Facturas                                      |
| `orders.detail.credit_note`          | Credit note                               | Factura rectificativa                         |
| `orders.detail.substitution`         | Full invoice replacing it                 | Factura completa que la sustituye             |
| `orders.detail.rung_by`              | Rung by {name}                            | Cobrada por {name}                            |
| `orders.detail.payments`             | Payments                                  | Pagos                                         |
| `orders.detail.cash` / `.card`       | Cash / Card                               | Efectivo / Tarjeta                            |
| `orders.detail.tip`                  | Tip {amount}                              | Propina {amount}                              |
| `orders.detail.before_invoice`       | Paid before the invoice                   | Pagado antes de la factura                    |
| `orders.detail.refund`               | Refund {amount}                           | Devolución {amount}                           |
| `orders.detail.party`                | Party                                     | Grupo                                         |
| `orders.detail.opened_closed`        | Opened {opened} by {by}; closed {closed}  | Abierto el {opened} por {by}; cerrado el {closed} |
| `orders.detail.departure`            | Left without paying                       | Se fueron sin pagar                           |
| `orders.detail.departure_line`       | {date}: {reason}. Recorded by {recorder}, authorised by {approver}. Owed {amount} then. | {date}: {reason}. Registrado por {recorder}, autorizado por {approver}. Debía {amount} entonces. |

  Interpolate with `t(key).replace("{name}", …)`, as `apps/dashboard/src/screens/alerts-screen.ts:212`
  does. In `apps/dashboard/src/i18n/codes.ts` add `"working_order.not_found": { en: "That bill was not found", es: "No se encontró esa cuenta" }`.

- [ ] **Step 8: Run the screen tests; watch them pass.**
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/orders-filter.test.ts src/screens/orders-screen.test.ts src/screens/orders-screen.a11y.test.ts src/dashboard-app.test.ts`
  Check free memory first (`memory_pressure | grep free`): these run in Chromium.

- [ ] **Step 9: LOOK at it.** Start the dev stack from the worktree with `wa-wt demo <worktree-name>`
  (never a bare `pnpm dev`), sign in as the demo manager, and open Orders. With the demo seed's
  history, and after ringing one open bill, one departed bill and one paid bill at the dev till
  (`localhost:5190`, enrolment code `DEMO`), check by eye, in light AND dark theme, at desktop width
  AND at 390 px wide, in English AND Spanish: the filter bar wraps without overlapping; the row menu
  stays on screen at 390 px; statuses, marks and money read correctly; Unpaid switches to Any date;
  Show more appears and adds rows; the detail dialog's sections all read and scroll. Take a
  screenshot of each of the eight combinations for the PR description.

- [ ] **Step 10: Guards and the rest.**
  - `pnpm exec vitest run scripts/live-subscriptions.test.ts scripts/pinned-actions-column.test.ts scripts/style-token-names.test.ts scripts/english-only.test.ts`
  - `pnpm --filter @waitron/dashboard test:coverage` only if chasing a figure; the bar is
    `98/98/98/95`, read the table for `orders-screen.ts`, `orders-filter.ts`, `order-detail-dialog.ts`.
  - `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts` — unedited, PASS.
  - `pnpm --filter @waitron/dashboard typecheck && pnpm lint && pnpm format:check`.

- [ ] **Step 11: Commit and finish.** Update `docs/backlog.md`'s B27s entry, then:

```bash
git add apps/dashboard/src/screens/orders-filter.ts apps/dashboard/src/screens/orders-screen.ts \
  apps/dashboard/src/widgets/order-detail-dialog.ts apps/dashboard/src/screens/orders-filter.test.ts \
  apps/dashboard/src/screens/orders-screen.test.ts apps/dashboard/src/screens/orders-screen.a11y.test.ts \
  apps/dashboard/src/api/client.ts apps/dashboard/src/api/live-queries.ts apps/dashboard/src/navigation.ts \
  apps/dashboard/src/dashboard-app.ts apps/dashboard/src/dashboard-app.test.ts \
  apps/dashboard/src/i18n/strings.ts apps/dashboard/src/i18n/codes.ts docs/backlog.md
git commit -s -m "Dashboard Orders, part 2: an Orders screen lists every bill, with Unpaid as one filter

The new Orders page, under Overview and Sales, lists bills from the server a page at a time, filtered
by status, dates, staff, table and a search box. The filters live in the address, so a link to
'unpaid, any date' can be shared, and choosing Unpaid switches the dates to Any date. Clicking a bill
opens its lines, invoices, payments, party and, for a debt, when the table left and why. The list
refreshes when a bill changes, without keeping the session signed in."
```

  Then `/finish-branch` with the worktree path.

---

## Task 3: Till — "Find a bill", and the counter's list removed

**Branch:** `feat/till-find-a-bill` (from `main` after Task 2 has landed)

**Files:**

- Create: `apps/server/src/bill-lookup-api.ts` — `GET /api/bills/lookup?q=`.
- Create: `apps/server/src/bill-lookup-api.test.ts`.
- Modify: `apps/server/src/till-api.ts:829` — mount it beside `mountUnpaidDepartureApi`.
- Modify: `apps/server/src/unpaid-departure-api.ts:75-80` — delete the `GET /api/unpaid-departures` route.
- Modify: `apps/server/src/unpaid-departure.ts:212-296` — delete `UnpaidDepartureView` and `listUnpaidDepartures`.
- Modify: `apps/server/src/unpaid-departure.test.ts` — delete the two list blocks (`:257-269`,
  `:1281-1431`); their behaviours move to `bill-lookup-api.test.ts` (Step 1).
- Create: `apps/till/src/widgets/find-bill-dialog.ts`, `find-bill-dialog.test.ts`, `find-bill-dialog.a11y.test.ts`.
- Modify: `apps/till/src/api/client.ts` — add `lookUpBills`; delete `UnpaidDeparture` (`:975-988`)
  and `listUnpaidDepartures` (`:2278-2280`).
- Modify: `apps/till/src/widgets/tab-shell.ts:13,186-198` — a `find-bill` affordance and button.
- Modify: `apps/till/src/till-app.ts` — open the dialog, collect from it; remove the departures list.
- Modify: `apps/till/src/widgets/card-grid.ts:43,99,269-270,360-365` and
  `apps/till/src/screens/till-counter-screen.ts:16,127,291` — remove the list.
- Delete: `apps/till/src/widgets/unpaid-departures.ts`, `unpaid-departures.test.ts`, `unpaid-departures.a11y.test.ts`.
- Modify: every till test naming the list (`grep -rln "listUnpaidDepartures\|unpaidDepartures\|till-unpaid-departures\|refresh.departures" apps/till/src`).
- Modify: `apps/till/src/i18n/strings.ts` — add `find_bill.*`, delete `departures.*` and
  `refresh.departures*`, reword `departure.probably_recorded`.
- Modify: `docs/backlog.md` — the B17 and B27s entries.

**Interfaces:**

- Consumes: `listOrders`, `OrderRow` from `apps/server/src/orders-list.ts` (Task 1). The till's
  existing `TillApi.collectOrder(id, tender)` (`apps/till/src/api/client.ts:2013-2015`).
- Produces:

```ts
// apps/server/src/bill-lookup-api.ts
export const BILL_LOOKUP_LIMIT = 20;
export interface BillLookupRow {
  workingOrderId: string; orderNumber: number | null; label: string | null; partyName: string | null;
  tables: string[]; invoiceNumber: string | null; openedAt: string; departedAt: string | null;
  status: "waiting_for_payment" | "left_without_paying"; stillOwed: string;
}
export function lookUpBills(tx: Transaction, q: string): Promise<BillLookupRow[]>;
export function mountBillLookupApi(app: Hono, deps: TillApiDeps, log: Logger, run: Run): void;
// GET /api/bills/lookup?q=  → { bills: BillLookupRow[] }   (a till session; no permission)

// apps/till/src/api/client.ts
lookUpBills(q: string, opts?: { signal?: AbortSignal }): Promise<{ bills: BillLookupRow[] }>;

// apps/till/src/widgets/find-bill-dialog.ts — <till-find-bill-dialog>
//   properties: api: TillApi; busy: boolean; error: StringKey | undefined
//   events: "find-bill-pay" FindBillPayDetail, "find-bill-close"
export interface FindBillPayDetail {
  workingOrderId: string;
  tender: Tender;
  /** The bill had an invoice when it was found; false for a ticket-then-pay bill, which the
   * collect invoices now. */
  invoiced: boolean;
}
```

- [ ] **Step 0: Re-map.** `gh pr list --state open`; stop and report if one touches
  `apps/till/src/till-app.ts`, `widgets/card-grid.ts`, `widgets/tab-shell.ts`, `api/client.ts`,
  `apps/server/src/unpaid-departure*.ts` or `till-api.ts`. Check lane B's B29 in `docs/backlog.md`:
  if it has landed and lets a handheld collect, give handhelds the Find a bill button too (Step 4)
  and say so in the PR. Re-verify on `main`:
  - the counter list is rendered at `apps/till/src/widgets/card-grid.ts:269-270` and fed from
    `apps/till/src/till-app.ts:1623-1626`; `"departures"` is a `RefreshList` (`:222`);
  - `POST /api/working-orders/:id/collect` refuses a handheld (`assertNotHandheld`,
    `apps/server/src/till-api.ts:1553`) and replays a settled bill (`collectOrder`,
    `apps/server/src/till-sale.ts:1602-1604`); 2026-10-02 (B29, feat/service-handheld-permissions):
    the collect route no longer refuses a handheld, so expect a handheld to collect;
  - `#affordances()` gives a handheld none (`apps/till/src/till-app.ts:5752-5756`);
  - the tab shell's header is the only header in use (`till-counter-screen.ts`'s own header is
    test-only: its `embedded` comment, `:154-158`);
  - `departure.probably_recorded` names the list (`apps/till/src/i18n/strings.ts:787-788`);
  - nothing outside `apps/till` calls `GET /api/unpaid-departures`
    (`grep -rn "unpaid-departures" apps packages scripts docs --include='*.ts' --include='*.md'`).

- [ ] **Step 1: Write the failing lookup tests.** `apps/server/src/bill-lookup-api.test.ts`, on
  `provisionOrderVenue` (Task 1), through `venue.app` (the till routes) with `venue.cookie`. These
  carry over every behaviour the deleted list cases asserted (`unpaid-departure.test.ts:1289-1431`),
  plus the lookup's own:

```ts
async function lookUp(q: string, cookie = venue.cookie) {
  return send(venue.app, cookie, "GET", `/api/bills/lookup?q=${encodeURIComponent(q)}`);
}
// Imports as `orders-list.test.ts`, plus `sql` from drizzle-orm and `namedDebt` below.
const found = async (q: string) => ((await lookUp(q)).json as { bills: { workingOrderId: string }[] }).bills.map((b) => b.workingOrderId);

/** A party named `name` that then left without paying. Named first: a closed party cannot be renamed. */
async function namedDebt(name: string, ...dishes: string[]) {
  const party = await seatedWith(venue, ...dishes);
  const named = await send(venue.app, venue.cookie, "PUT", `/api/parties/${party.partyId}/name`, { name, expectedPartyRevision: party.revision });
  expect(named.status).toBe(200);
  const [row] = venue.db.all<{ revision: number }>(sql`select revision from parties where id = ${party.partyId}`);
  const left = await send(venue.app, venue.supervisorTill, "POST", `/api/parties/${party.partyId}/unpaid-departure`, {
    expectedPartyRevision: row!.revision,
    reason: "Se marcharon sin pagar",
  });
  expect(left.status).toBe(200);
  return party;
}

it("finds a debt by its invoice number, its table and its party's name, with what it owes", async () => {
  const party = await namedDebt("Familia Ruiz", "Botella tinto");
  const { row } = (await send(venue.orders, venue.supervisorDashboard, "GET", `/management-api/orders/${party.tabId}`)).json as { row: { invoiceNumber: string; tables: string[] } };
  for (const q of [row.invoiceNumber, row.tables[0]!, "ruiz"]) expect(await found(q), q).toContain(party.tabId);
  expect((await lookUp(row.invoiceNumber)).json).toMatchObject({
    bills: [expect.objectContaining({ workingOrderId: party.tabId, status: "left_without_paying", stillOwed: "30.00", departedAt: expect.any(String) })],
  });
});
```

  Then, one `it` each:
  - "leaves a debt out once it is collected, and collecting settles the invoice" (from `:1289`).
  - "collecting twice writes one tender" — `collect` twice with the same amount; both answer 200;
    one `tenders` row for the bill.
  - "leaves out a debt whose invoice has been voided" (from `:1337`, via `voidInvoice`).
  - "answers what the invoice owes now after a credit note" — `stillOwed: "27.58"` (from `:1357`).
  - "leaves out a debt credited to nothing" (from `:1370`) — Review Focus 1.
  - "keeps a debt whose invoice a full invoice substituted, at what it owes" (from `:1380`; copy its
    `recordSubstitution` call).
  - "lists the newest first" (from `:1416`) — by when the bill was opened, which for a seated party
    is just before it departed.
  - "finds a counter bill sent and not paid, and not an open or paid one".
  - "finds a debt by its order number" — the bare `orderNumber` of a departed bill finds it
    (decision 9; numbers repeat, so `toContain`).
  - "fills its twenty from what it can collect" (decision 11): make 21 debts, credit the newest to
    nothing, and look them up by a word in all 21 party names (name them through `namedDebt`) → the
    answer holds 20 bills, the credited one not among them and the oldest one present. With the
    limit applied before dropping, the oldest would be missing.
  - "leaves out a bill holding a payment, which collecting refuses" (decision 11). Read, not run:
    a departure refuses an open bill holding a payment (`recordUnpaidDeparture`,
    `apps/server/src/unpaid-departure.ts:107-114`), so the case must place a bill that holds one some
    other way — try `contribute` on a seated party's bill, then `POST /api/working-orders/:id/place`
    (`apps/server/src/till-api.ts:1304`). If no product path can put a pending or received payment on
    a placed bill, delete this case, keep the clause (it mirrors `collectOrder`'s own refusal), and
    say in the PR that the case is unreachable today and what you ran to find that out.
  - "refuses an empty search" → 400 `management.request_invalid` `{ field: "q" }`, and one over 100
    characters likewise.
  - "answers a caller with no session with session.required" (from `:1427`).
  - "asks the same number of queries for twenty bills as for one" — spy as in
    `orders-list.reads.test.ts`, around `lookUpBills` directly.

  Run: `pnpm --filter @waitron/server exec vitest run src/bill-lookup-api.test.ts` → FAIL (module missing).

- [ ] **Step 2: Write `apps/server/src/bill-lookup-api.ts`; mount it; remove the old list.**

```ts
import type { Hono } from "hono";
import { AppError } from "@waitron/shared";
import { withTransaction, type Transaction } from "@waitron/db";
import type { Logger } from "./logger.js";
import { listOrders } from "./orders-list.js";
import type { Run, TillApiDeps } from "./till-api.js";
import { requireSession } from "./till-session.js";
import "./errors.js";

export const BILL_LOOKUP_LIMIT = 20;
// …BillLookupRow from the Interfaces block…

/**
 * The bills still to pay that match `q`, newest first: the Orders list's Unpaid filter at any date,
 * narrowed in the query (`collectable`, decision 11) to what the collect route takes, so the limit
 * counts only those.
 */
export async function lookUpBills(tx: Transaction, q: string): Promise<BillLookupRow[]> {
  const { rows } = await listOrders(tx, {
    status: "unpaid", dates: "any", credited: false, search: q, limit: BILL_LOOKUP_LIMIT, collectable: true,
  });
  return rows.flatMap((row): BillLookupRow[] =>
    // Never true once `collectable` held; it narrows the types.
    row.stillOwed === null || (row.status !== "waiting_for_payment" && row.status !== "left_without_paying")
      ? []
      : [{
          workingOrderId: row.id, orderNumber: row.orderNumber, label: row.label, partyName: row.partyName,
          tables: row.tables, invoiceNumber: row.invoiceNumber, openedAt: row.at, departedAt: row.departedAt,
          status: row.status, stillOwed: row.stillOwed,
        }],
  );
}

export function mountBillLookupApi(app: Hono, deps: TillApiDeps, log: Logger, run: Run): void {
  app.get("/api/bills/lookup", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const q = c.req.query("q")?.trim() ?? "";
      if (q === "" || q.length > 100) throw new AppError("management.request_invalid", { field: "q" });
      return c.json({ bills: await withTransaction(deps.db, (tx) => lookUpBills(tx, q)) });
    }),
  );
}
```

  `lookUpBills` asks for `status: "unpaid"`, so its read starts from `open` and `placed` bills
  through the status index exactly as the dashboard's Unpaid does (decision 10, checked in Task 1
  Step 7); nothing more to test here. `management.request_invalid` answers 400 through the till's `run`: it is in the till's `STATUS`
  map (`apps/server/src/till-api.ts:329`, read on `5b725d672`; Step 1's empty-search case is what
  checks it). In `till-api.ts`, call
  `mountBillLookupApi(app, deps, log, run);` beside `:829`. Delete the list route
  (`unpaid-departure-api.ts:75-80`, and the `listUnpaidDepartures` import), `UnpaidDepartureView` and
  `listUnpaidDepartures` (`unpaid-departure.ts:212-296`, and the imports only they used), and the two
  list blocks in `unpaid-departure.test.ts`.

  Run `pnpm --filter @waitron/server exec vitest run src/bill-lookup-api.test.ts src/unpaid-departure.test.ts` → PASS.

- [ ] **Step 3: Write the failing dialog tests.** `apps/till/src/widgets/find-bill-dialog.test.ts`
  (browser mode; follow `unpaid-departure-dialog.test.ts` for mounting):
  - typing `A/12` and pressing Search calls `api.lookUpBills("A/12")` and lists each bill with its
    invoice number, tables or label, the party's name, and "€30.00 owed";
  - a debt shows "Left without paying on <date>";
  - no result shows "No unpaid bill matches"; a failed read shows "The search failed. Try again."
    and keeps the typed text; an empty box shows the query-required message under the box and
    calls nothing;
  - choosing a bill, then Cash with "50.00", then Collect dispatches `find-bill-pay` with
    `{ workingOrderId, tender: { method: "cash", amount: "50.00" }, invoiced: true }`; for a found
    bill whose `invoiceNumber` is null, `invoiced: false`; a cash amount below what is
    owed shows "Enter at least €30.00" under the field and dispatches nothing;
  - Card on the terminal with an operation number dispatches `{ method: "card", amount: "30.00", externalRef: "123456" }`;
  - Back returns to the results; Escape or Close dispatches `find-bill-close`;
  - with `busy` set the Collect button is loading; with `error` set its text shows above the buttons.
  And `find-bill-dialog.a11y.test.ts`: axe over the results step and the pay step, both themes.

  Run `pnpm --filter @waitron/till exec vitest run src/widgets/find-bill-dialog.test.ts` → FAIL.

- [ ] **Step 4: Write the dialog; add the client method and the shell button.**
  - `apps/till/src/api/client.ts`: add `BillLookupRow` (as the server's) and

```ts
  /** `GET /api/bills/lookup`: the bills still to pay matching an invoice number, a table or a name. */
  lookUpBills(q: string, opts: { signal?: AbortSignal } = {}): Promise<{ bills: BillLookupRow[] }> {
    return this.#request<{ bills: BillLookupRow[] }>(`/api/bills/lookup?q=${encodeURIComponent(q)}`, "GET", undefined, opts);
  }
```

    (match the argument order of a neighbouring `#request` call that passes a `signal`, e.g.
    `retrievePlacedOrder`). Delete `UnpaidDeparture` and `listUnpaidDepartures`.
  - `apps/till/src/widgets/find-bill-dialog.ts`: a `wt-dialog` with two steps held in `@state`:
    **search** (a `wt-input name="bill-search"` and a Search button inside a `<form>` whose submit
    calls `api.lookUpBills`, guarded by a request generation so a late answer to an older search is
    dropped; then one `<button>` per result) and **pay** (the chosen bill's summary; a
    `segmented-control-styles` choice of Cash or Card on the terminal; for cash a
    `wt-price-input name="cash-received"` defaulting to `stillOwed`; for card an optional
    `wt-input name="terminal-reference"`; Back; Collect `{amount}`). The amount check compares in
    cents with `stringToCents` from `@waitron/shared`. Events are dispatched
    `bubbles: true, composed: true`.
  - `apps/till/src/widgets/tab-shell.ts`: `ShellAffordance` gains `"find-bill"`; in the header, before
    the Allergens button, when `this.affordances.includes("find-bill")`:
    `<wt-button class="find-bill" variant="secondary" @click=${() => this.#emit("find-bill")}>${t("find_bill.open")}</wt-button>`.
  - `apps/till/src/till-app.ts` `#affordances()` (`:5752-5756`): append `"find-bill"` to the list
    (a handheld still gets none, because collecting refuses it today — `till-api.ts:1553`).
    2026-10-02 (B29, feat/service-handheld-permissions): collecting no longer refuses a handheld;
    see Step 0.

- [ ] **Step 5: Wire it in `till-app.ts` and remove the list.**
  - State: `@state() private findingBill = false; @state() private findBillBusy = false; @state() private findBillError?: StringKey;`
  - Listen for `find-bill` on the app root beside `@open-drawer` (`:5982`): set `findingBill = true`,
    clear the error. Render `<till-find-bill-dialog .api=${this.api} .busy=${this.findBillBusy} .error=${this.findBillError} @find-bill-pay=… @find-bill-close=${() => (this.findingBill = false)}>`
    when `findingBill`.
  - The pay handler, after `#onCollectOrder` (`:2386-2411`):

```ts
  /**
   * A bill found with Find a bill is collected as a sent bill is. The original receipt is offered
   * only when this collect filed the invoice (`#showTicket`'s second argument, `:5634-5636`): a
   * ticket-then-pay bill, found with no invoice number. A counter bill collected here leaves the
   * waiting list and may sit on the prep queue, so both are re-read, as a collect from the waiting
   * list does (`#onCollectOrder`, `:2386-2401`).
   */
  async #onFindBillPay(event: Event): Promise<void> {
    if (this.submitting) return;
    const { workingOrderId, tender, invoiced } = (event as CustomEvent<FindBillPayDetail>).detail;
    this.submitting = true;
    this.findBillBusy = true;
    this.findBillError = undefined;
    try {
      this.result = await this.api.collectOrder(workingOrderId, tender);
      this.findingBill = false;
      this.#showTicket(workingOrderId, !invoiced);
      await this.#refreshAfterWrite("station", "refresh.station_after_sale");
      await this.#refreshAfterWrite("waiting", "refresh.waiting_after_sale");
    } catch (error) {
      this.findBillError = isPermanentSaleRefusal(error) ? "sale.refused" : isNetworkFailure(error) ? "sale.unconfirmed" : "sale.error";
    } finally {
      this.submitting = false;
      this.findBillBusy = false;
    }
  }
```

  - Close the dialog in `#endOperatorSession` (`:5085-5096`) as `#closeDeparting()` is.
  - Remove the list: `"departures"` from `RefreshList` (`:222`) and `#refreshGeneration` (`:1325-1330`);
    `unpaidDepartures` state (`:1150`); `#refreshDepartures` (`:1591-1594`, the method at `:1592`) and its call and await in
    the login path (`:1547` and the `finally` below it); the `"departures"` branch of `#loadList`
    (`:1623-1626`); the refresh in `#onDepartureRecorded` (`:4942-4943` — the table still leaves
    the screen; nothing else to refresh); `.unpaidDepartures=` at `:5782` and `:5816`; and
    `#renderRefreshNotice("departures")` at `:6061`. Remove the property and its uses from
    `till-counter-screen.ts` (`:16,127,291`) and `card-grid.ts` (`:43,99,270`, and the
    `unpaidDepartures` term in `#currentState`, `:360-365`). Delete the three `unpaid-departures*`
    widget files.
  - Fix every till test the grep in Files names: delete each `listUnpaidDepartures` stub and each
    assertion about the list; where a test asserted the held-orders card shows "has-parked" because of
    a departure, delete that case — the card now holds held and waiting orders only. Do not weaken
    any other assertion in those files.
  - Add to `apps/till/src/till-app.test.ts`: "a debt found with an invoice shows a copy of its
    receipt, and a ticket-then-pay bill found with none offers the original" (the ticket's
    `originalReceiptAvailable`, set by `#showTicket`); "collecting from Find a bill re-reads the
    waiting list" (`listCounterWaiting` called again after `collectOrder`); "Find a bill collects a debt and shows its ticket"
    (stub `lookUpBills` and `collectOrder`; open from the shell button; choose; Cash; Collect →
    `collectOrder` called with the bill's id and tender, the ticket drill shows); "a refused collect
    keeps the dialog open with its reason"; "a handheld has no Find a bill button"; "the held-orders
    card shows no Left without paying list" (no `till-unpaid-departures` element anywhere).

- [ ] **Step 6: Strings.** In `apps/till/src/i18n/strings.ts`, `en` and `es`:

| Key                         | English                                          | Spanish                                              |
| --------------------------- | ------------------------------------------------ | ---------------------------------------------------- |
| `find_bill.open`, `.title`  | Find a bill                                      | Buscar cuenta                                        |
| `find_bill.search`          | Invoice number, name or table                    | Número de factura, nombre o mesa                     |
| `find_bill.search_action`   | Search                                           | Buscar                                               |
| `find_bill.query_required`  | Type an invoice number, a name or a table        | Escribe un número de factura, un nombre o una mesa   |
| `find_bill.none`            | No unpaid bill matches                           | Ninguna cuenta sin pagar coincide                    |
| `find_bill.search_failed`   | The search failed. Try again.                    | La búsqueda falló. Inténtalo de nuevo.               |
| `find_bill.owes`            | {amount} owed                                    | Debe {amount}                                        |
| `find_bill.left_on`         | Left without paying on {date}                    | Se fueron sin pagar el {date}                        |
| `find_bill.cash`            | Cash                                             | Efectivo                                             |
| `find_bill.cash_received`   | Cash received                                    | Efectivo recibido                                    |
| `find_bill.cash_short`      | Enter at least {amount}                          | Introduce al menos {amount}                          |
| `find_bill.card`            | Card on the terminal                             | Tarjeta en el datáfono                               |
| `find_bill.card_reference`  | Terminal operation number (optional)             | Número de operación del datáfono (opcional)          |
| `find_bill.confirm`         | Collect {amount}                                 | Cobrar {amount}                                      |
| `find_bill.back`            | Back to results                                  | Volver a los resultados                              |
| `find_bill.close`           | Close                                            | Cerrar                                               |

  Delete `departures.title`, `departures.invoice`, `departures.recorded_by`,
  `departures.recorded_approved`, `refresh.departures`, `refresh.departures_after_record` from both.
  In `departure.probably_recorded`, replace "Check the Left without paying list." with "Look it up
  with Find a bill." and, in Spanish, the matching sentence with "Búscala con Buscar cuenta.".

- [ ] **Step 7: Sweep every claim about the list.** The list's removal retires every sentence that
  describes it. Run `grep -rn "Left without paying list\|unpaid-departures\|listUnpaidDepartures\|GET /api/unpaid-departures\|read-only" docs apps packages --include='*.md' --include='*.ts'`
  and read each hit: update `docs/backlog.md`'s B17 entry (the list is gone; debts are collected
  with Find a bill; the Orders screen's Unpaid filter shows them) and B27s (done); add a dated
  pointer, not a rewrite, in a historical spec or plan that describes the list.

- [ ] **Step 8: Run everything this task touched.**
  - `pnpm --filter @waitron/server exec vitest run src/bill-lookup-api.test.ts src/unpaid-departure.test.ts src/orders-list.test.ts`
  - `pnpm --filter @waitron/till exec vitest run src/widgets/find-bill-dialog.test.ts src/widgets/find-bill-dialog.a11y.test.ts src/widgets/card-grid.test.ts src/widgets/tab-shell.test.ts src/till-app.test.ts src/api/client.test.ts`
    and every other till test file the Step 5 grep listed (check free memory first).
  - `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts scripts/english-only.test.ts scripts/style-token-names.test.ts`
  - `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts` — unedited, PASS.
  - `pnpm --filter @waitron/server typecheck && pnpm --filter @waitron/till typecheck && pnpm lint && pnpm format:check`.
  - Coverage `98/98/98/95` for `@waitron/server` and `@waitron/till` (CI runs it; locally only to
    chase a figure). Deleting `listUnpaidDepartures` must not leave an uncovered helper behind.

- [ ] **Step 9: LOOK at it.** With `wa-wt demo <worktree-name>`, at the dev till: seat a table,
  order, record that it left without paying; then press Find a bill, search by the invoice number on
  the screen, by the table and by a name, collect it in cash, and see the ticket; confirm the counter
  has no Left without paying list; on the dashboard, Orders → Unpaid no longer shows it. Check the
  dialog in both themes, at a 390 px wide window, in English and Spanish. Screenshots in the PR.

- [ ] **Step 10: Commit and finish.**

```bash
git add apps/server/src/bill-lookup-api.ts apps/server/src/bill-lookup-api.test.ts apps/server/src/till-api.ts \
  apps/server/src/unpaid-departure-api.ts apps/server/src/unpaid-departure.ts apps/server/src/unpaid-departure.test.ts \
  apps/till/src docs/backlog.md
git status   # check: only this task's files, and the three deleted widget files, are staged
git commit -s -m "Dashboard Orders, part 3: the till finds and collects a debt; the counter's unpaid list goes

A Find a bill button in the till's header searches unpaid bills by invoice number, table or the
party's name (GET /api/bills/lookup, the Orders list's own Unpaid query), and collects the chosen one
in cash or by card on the terminal through the existing collect route. The read-only Left without
paying list on the counter, and GET /api/unpaid-departures behind it, are removed in the same change,
so there is never a till with no way to see a debt."
```

  Then `/finish-branch` with the worktree path.

---

## Self-review notes

- **Spec coverage.** §4.1 rows (Task 1 `rowsSql`, decisions 2 and 3); §4.2 statuses and Credited mark
  (Task 1 `BILL_STATUS`, decision 1); §4.3 filters and search (Task 1 `filterClauses`; Location is
  hidden and not built, §8); §4.4 columns (Task 2 `#columns`); §4.5 detail (Task 1
  `readOrderDetail`, Task 2 dialog; adjustments per decision 5); §4.6 server, paging, fixed reads
  (Task 1, Step 7); §4.7 screen, live, passive, address (Task 2); §5 till (Task 3, decision 6); §6
  permissions (Task 1 gate, Task 2 nav); §7 refusals (Task 1 Step 8, Task 2 Step 3); §9 tests (each
  named in its task); §10 build order (three tasks).
- **Types.** `OrderRow`, `OrderStatus`, `ORDER_STATUS_FILTERS` (server) and the dashboard's copy
  must hold the same names; Task 2's `OrderRowDto` mirrors Task 1's `OrderRow` with `Decimal` as
  `string`. `BillLookupRow` is defined once on the server and copied into the till client.
