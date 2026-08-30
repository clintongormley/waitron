# Dashboard Sales/Takings + Business-Overview Home — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface `packages/reporting` in the dashboard — a business-overview home (post-login landing for non-staff) and a Sales screen (daily close + period roll-up), backed by new node-scoped management-api routes and a new top-sellers query.

**Architecture:** Backend-first. A new `report.view` permission and two new reporting functions (`computeTopSellers`, `currentBusinessDay`) feed three new `/management-api/reports/` GET routes wrapped in the existing `gated` helper. The dashboard gains two Lit screens following the `planned-actual-screen` template, three typed `DashboardApi` methods, and a changed post-login landing.

**Tech Stack:** TypeScript, Drizzle/Postgres, Hono (server), Lit + Vite (dashboard), Vitest (+ Playwright browser mode for the dashboard).

**Spec:** `docs/superpowers/specs/2026-08-29-dashboard-sales-takings-design.md`

## Global Constraints

- **Every commit uses `git commit -s`** (CI `dco` job walks the range).
- **No hardcoded chrome in dashboard screens** — only `wt-*` primitives and `var(--wt-*)` tokens (enforced by `packages/ui/src/no-hardcoded-chrome.test.ts`).
- **Never import `@waitron/*` server types into the dashboard bundle** (#70 rule) — re-declare response shapes locally in `apps/dashboard/src/api/client.ts`.
- **Money crosses the wire as decimal strings** — reporting `Decimal` is a branded string; dashboard types declare `string`.
- **Error codes name the domain concept, never the package**; permission codes are never renamed once shipped.
- **Spanish domain terms only where the vocabulary guard allows**; new dashboard identifiers (screen keys, i18n key namespaces, data-test) are English — Spanish only as i18n *values* (`english-only` guard skips `apps/`, so this is by-hand discipline).
- **Coverage gates:** reporting/identity/server 98/98/98/95; dashboard 95/95/90/88. Run `pnpm --filter <pkg> test:coverage`, not `test`.
- **Prove every new guard by deletion** (remove the check, watch the test fail, restore).

---

### Task 1: `report.view` permission

**Files:**
- Modify: `packages/identity/src/permissions.ts`
- Test: `packages/identity/src/permissions.test.ts` (existing)

**Interfaces:**
- Produces: the string literal permission `"report.view"`, held by SUPERVISOR, MANAGER (inherits), admin (ALL); NOT staff. Consumed by Tasks 4 & 5 as `authorizeManager({ permission: "report.view" })`.

- [ ] **Step 1: Read `permissions.ts`** to confirm the `PERMISSIONS` `as const` tuple, the `SUPERVISOR`/`MANAGER`/`ALL` sets, and `roleHasPermission`. Read `permissions.test.ts` for the assertion style.

- [ ] **Step 2: Write failing tests** in `permissions.test.ts`:

```ts
it("grants report.view to supervisor, manager and admin, not staff", () => {
  expect(roleHasPermission("supervisor", "report.view")).toBe(true);
  expect(roleHasPermission("manager", "report.view")).toBe(true);
  expect(roleHasPermission("admin", "report.view")).toBe(true);
  expect(roleHasPermission("staff", "report.view")).toBe(false);
});
```

(Match the exact role-string spelling used elsewhere in the file — `supervisor`/`manager`/`admin`/`staff` or uppercase constants.)

- [ ] **Step 3: Run, expect FAIL** (`report.view` not assignable / assertion fails).
  Run: `pnpm --filter @waitron/identity test permissions`

- [ ] **Step 4: Implement** — append `"report.view"` to the `PERMISSIONS` tuple and add it to the `SUPERVISOR` permission set (MANAGER inherits via `...SUPERVISOR`, admin via `ALL`).

- [ ] **Step 5: Run, expect PASS.** Then `pnpm --filter @waitron/identity test:coverage`.

- [ ] **Step 6: Commit** `feat(identity): add report.view permission (supervisor+manager)`.

---

### Task 2: `currentBusinessDay` reporting helper

**Files:**
- Modify: `packages/reporting/src/business-day.ts`
- Test: `packages/reporting/src/business-day.test.ts`

**Interfaces:**
- Consumes: existing `businessDayLocalDate` (private, in same file), `validateTimeZone`, `validateCutover`.
- Produces: `currentBusinessDay(tx: Transaction, input: { timeZone: string; dayCutover: string }): Promise<string>` — today's venue-local business day as `"YYYY-MM-DD"`. Consumed by Task 4's overview route.

- [ ] **Step 1: Read `business-day.ts`** (already partly known: `businessDayLocalDate(column, input)` returns `(col at time zone tz - cutover::interval)::date`). Confirm `Transaction` import source (`@waitron/db`).

- [ ] **Step 2: Write failing test** in `business-day.test.ts` (use the suite's existing DB harness — mirror the target `daily-close.test.ts`/`vat-summary.test.ts` use). Test the cutover shift: insert nothing; just assert the computed day matches a hand-computed expectation for a fixed clock, OR (simpler, deterministic) assert two known tz/cutover pairs by comparing against the same expression run inline. Concrete deterministic case:

```ts
it("returns the venue-local business day, shifted by the cutover", async () => {
  // 2026-03-01 04:30 UTC, Europe/Madrid (UTC+1 in winter) = 05:30 local.
  // With a 06:00 cutover, 05:30 local still belongs to the PREVIOUS business day.
  await tx.execute(sql`set local timezone to 'UTC'`);
  const day = await currentBusinessDayAt(tx, {
    now: "2026-03-01 04:30:00+00", timeZone: "Europe/Madrid", dayCutover: "06:00",
  });
  expect(day).toBe("2026-02-28");
});
```

If injecting `now` is awkward, expose the core as an internal `businessDayOf(nowSql, input)` and have `currentBusinessDay` call it with `sql\`now()\``; test `businessDayOf` with a literal timestamp so it is deterministic, plus one `currentBusinessDay(tx, …)` smoke test asserting a valid `YYYY-MM-DD` shape.

- [ ] **Step 3: Run, expect FAIL.** Run: `pnpm --filter @waitron/reporting test business-day`

- [ ] **Step 4: Implement:**

```ts
export async function currentBusinessDay(
  tx: Transaction,
  input: { timeZone: string; dayCutover: string },
): Promise<string> {
  validateTimeZone(input.timeZone);
  validateCutover(input.dayCutover);
  const { rows } = await tx.execute<{ day: string }>(
    sql`select ${businessDayLocalDate(sql`now()`, input)} as day`,
  );
  return rows[0]!.day;
}
```

(`businessDayLocalDate` already takes an arbitrary `SQL` column — pass `sql\`now()\``. Confirm `tx.execute` returns `day` as a `"YYYY-MM-DD"` string for a `::date`; node-postgres parses `date` OID to a string.)

- [ ] **Step 5: Run, expect PASS.** Then `pnpm --filter @waitron/reporting test:coverage`.

- [ ] **Step 6: Commit** `feat(reporting): currentBusinessDay helper (cutover-shifted today)`.

---

### Task 3: `computeTopSellers` reporting query

**Files:**
- Create: `packages/reporting/src/top-sellers.ts`
- Create: `packages/reporting/src/top-sellers.test.ts`
- Modify: `packages/reporting/src/types.ts` (add `TopSellersInput`, `TopSeller`)
- Modify: `packages/reporting/src/index.ts` (barrel)

**Interfaces:**
- Consumes: `businessDayRangeClause`, `activeSalesClause`, `validateTimeZone`, `validateCutover`, `validateBusinessDayRange` (business-day.ts); `Decimal`, `decimal` (`@waitron/shared`); `Transaction` (`@waitron/db`).
- Produces:
  - `TopSellersInput = { tenantId: TenantId; nodeId?: NodeId; fromBusinessDay: string; toBusinessDay: string; timeZone: string; dayCutover: string; limit: number }`
  - `TopSeller = { descriptions: Record<string, string>; quantity: Decimal; total: Decimal }`
  - `computeTopSellers(tx, input: TopSellersInput): Promise<TopSeller[]>` — top `limit` products by summed quantity over the business-day range, node-scoped when `nodeId` given. Consumed by Task 4 & 5 routes.

- [ ] **Step 1: Re-read `vat-summary.ts`** (`aggregateVatByRate`) as the exact pattern to mirror — the `sales s` filter, `nodeClause`, `activeSalesClause`, tenant predicate. Read `sale_lines` schema (`packages/db/src/schema/sales.ts:217`): columns `tenant_id, sale_id, descriptions jsonb, quantity numeric(12,3), line_total numeric(12,2)`.

- [ ] **Step 2: Add types** to `types.ts` (`TopSellersInput`, `TopSeller` as above).

- [ ] **Step 3: Write failing tests** in `top-sellers.test.ts` (same DB target/harness as `vat-summary.test.ts`; seed sales + sale_lines via the same fixtures those tests use). Cover:
  - ranks by summed quantity desc, respects `limit`;
  - sums quantity + line_total per frozen `descriptions`; two sales of the same product collapse into one row;
  - `nodeId` scoping: a line under another node is excluded;
  - excludes voided sales and F3-canje substitutes (`activeSalesClause`) — seed one of each and assert it is absent;
  - signed quantity: a correction (negative quantity) nets the total down;
  - empty range → `[]`;
  - returns the `descriptions` map intact (so the frontend can localize).

  Representative:

```ts
it("ranks products by total quantity sold over the range", async () => {
  // seed: 3× "Café" and 1× "Tostada" filed on 2026-08-04 for (tenant, node)
  const rows = await computeTopSellers(tx, {
    tenantId, nodeId, fromBusinessDay: "2026-08-04", toBusinessDay: "2026-08-04",
    timeZone: "Europe/Madrid", dayCutover: "05:00", limit: 5,
  });
  expect(rows.map((r) => r.descriptions.es)).toEqual(["Café", "Tostada"]);
  expect(rows[0]!.quantity).toBe("3.000");
});
```

- [ ] **Step 4: Run, expect FAIL** (module not found). Run: `pnpm --filter @waitron/reporting test top-sellers`

- [ ] **Step 5: Implement** `top-sellers.ts`:

```ts
import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { decimal } from "@waitron/shared";
import {
  activeSalesClause,
  businessDayRangeClause,
  validateBusinessDayRange,
  validateCutover,
  validateTimeZone,
} from "./business-day.js";
import type { TopSeller, TopSellersInput } from "./types.js";

export async function computeTopSellers(
  tx: Transaction,
  input: TopSellersInput,
): Promise<TopSeller[]> {
  validateTimeZone(input.timeZone);
  validateCutover(input.dayCutover);
  validateBusinessDayRange(input);
  if (!Number.isInteger(input.limit) || input.limit <= 0) {
    throw new Error(`reporting: top-sellers limit must be a positive integer: ${JSON.stringify(input.limit)}`);
  }
  const nodeClause = input.nodeId ? sql`and s.node_id = ${input.nodeId}` : sql``;
  const { rows } = await tx.execute<{ descriptions: Record<string, string>; quantity: string; total: string }>(sql`
    select
      sl.descriptions as descriptions,
      sum(sl.quantity)::numeric(12, 3)::text as quantity,
      sum(sl.line_total)::numeric(12, 2)::text as total
    from sale_lines sl
    join sales s on s.tenant_id = sl.tenant_id and s.id = sl.sale_id
    where s.tenant_id = ${input.tenantId}
      ${nodeClause}
      and ${businessDayRangeClause(sql`s.issued_at`, input)}
      and ${activeSalesClause({ tenantId: input.tenantId })}
    group by sl.descriptions
    order by sum(sl.quantity) desc, sl.descriptions::text asc
    limit ${input.limit}
  `);
  return rows.map((r) => ({
    descriptions: r.descriptions,
    quantity: decimal(r.quantity),
    total: decimal(r.total),
  }));
}
```

Notes for the implementer: `activeSalesClause` assumes the outer sales table is aliased `s` — this query does. `businessDayRangeClause` reads `fromBusinessDay`/`toBusinessDay`/`timeZone`/`dayCutover` off `input`. Verify `tx.execute` deserializes a `jsonb` column to an object (node-postgres parses jsonb) — if it returns a string, `JSON.parse` it. The `sl.descriptions::text asc` tiebreak makes ordering deterministic for equal quantities.

- [ ] **Step 6: Add to barrel** `index.ts`: `export { computeTopSellers } from "./top-sellers.js";` and export the two types from `types.ts` alongside the existing type re-exports.

- [ ] **Step 7: Run, expect PASS.** Prove the `activeSalesClause` and `nodeClause` filters by deletion. Then `pnpm --filter @waitron/reporting test:coverage`.

- [ ] **Step 8: Commit** `feat(reporting): computeTopSellers over sale_lines by frozen description`.

---

### Task 4: report-api — extend deps, boot wiring, overview route

**Files:**
- Modify: `apps/server/src/report-api.ts`
- Modify: `apps/server/src/boot.ts:878` (pass `nodeId`)
- Test: `apps/server/src/report-api.test.ts` and/or `report-api.rls.test.ts` (existing)

**Interfaces:**
- Consumes: `computeDailyClose`, `computeTopSellers`, `currentBusinessDay` (`@waitron/reporting`); `report.view` (Task 1); existing `gated`/`requireManagementSession`/`createErrorBoundary`/`withTenant`/`asAppUser`/`authorizeManager`; `dining_tables`, `nodes`, `locations`, `eq` (`@waitron/db`).
- Produces: `GET /management-api/reports/overview` returning the overview JSON (spec §3); `ReportApiDeps.cfg.nodeId: string`. Consumed by Task 6.

- [ ] **Step 1: Read `report-api.ts` end to end** — the `ReportApiDeps` shape, the `gated` helper, `createErrorBoundary`/`STATUS`, the `brandTenantId` usage, and how `computeVatReturn` is called. Read the boot mount at `boot.ts:876-878`. Identify `brandNodeId` (from `@waitron/shared`) for branding `cfg.nodeId`.

- [ ] **Step 2: Add a helper** `resolveVenueClock(tx, nodeId)` that reads `time_zone`/`day_cutover` from the node's location:

```ts
async function resolveVenueClock(tx: Transaction, nodeId: string): Promise<{ timeZone: string; dayCutover: string }> {
  const { rows } = await tx.execute<{ time_zone: string; day_cutover: string }>(sql`
    select l.time_zone, l.day_cutover
    from nodes n join locations l on l.tenant_id = n.tenant_id and l.id = n.location_id
    where n.id = ${nodeId}
  `);
  const row = rows[0];
  if (!row) throw new AppError("report.node_unknown"); // register the code if none fits; else reuse an existing not_found
  // day_cutover is a `time` → "HH:MM:SS"; computeDailyClose wants "HH:MM".
  return { timeZone: row.time_zone, dayCutover: row.day_cutover.slice(0, 5) };
}
```

Confirm whether an error code is needed (a missing node is an invariant break, not user input) — prefer reusing an existing `server.*`/`report.*` code or registering one in `report-api`'s error registry per the errors.ts convention. If a registered code is added, add it to `apps/server/src/errors.ts` (or wherever report codes live) and import the registry.

- [ ] **Step 3: Write failing tests** for the overview route (mirror the modelo-303 test's session/tenant setup): 401 without a management session; 403 for a role lacking `report.view` (e.g. staff/supervisor-without — actually supervisor now HAS it, so test the 403 path with a session whose person lacks the permission, following how the existing 403 test is built); 200 returns `{ businessDay, takings, counts, openTables, topSellers }` with the right shape and values for seeded sales + open tables. Assert `openTables.open`/`total` from seeded `dining_tables` (one with `tab_id` set, one without).

- [ ] **Step 4: Run, expect FAIL.** Run: `pnpm --filter @waitron/server test report-api`

- [ ] **Step 5: Implement**: extend `ReportApiDeps.cfg` with `nodeId: string`; add the overview route inside `mountReportApi`:

```ts
app.get("/reports/overview", (c) =>
  run(c, () =>
    gated(c, "report.view", async (tx) => {
      const tenantId = brandTenantId(deps.cfg.tenantId);
      const nodeId = brandNodeId(deps.cfg.nodeId);
      const clock = await resolveVenueClock(tx, deps.cfg.nodeId);
      const businessDay = await currentBusinessDay(tx, clock);
      const input = { tenantId, nodeId, businessDay, timeZone: clock.timeZone, dayCutover: clock.dayCutover };
      const close = await computeDailyClose(tx, input);
      const topSellers = await computeTopSellers(tx, { ...input, fromBusinessDay: businessDay, toBusinessDay: businessDay, limit: 5 });
      const openTables = await countOpenTables(tx, tenantId, nodeId);
      return c.json({
        businessDay,
        takings: { tenderTotal: close.cash.tenderTotal, tipTotal: close.cash.tipTotal, grossTotal: close.vat.grossTotal },
        counts: close.counts,
        openTables,
        topSellers,
      });
    }),
  ),
);
```

(Adapt `gated`'s exact call shape to the existing helper's signature — the existing helper takes `(sessionId-derived) permission` internally; refactor `gated` to accept a `permission` parameter if it currently hardcodes `REPORT_EXPORT_PERMISSION`, mirroring `workforce-api.ts`'s parameterized `gated`.) Add `countOpenTables(tx, tenantId, nodeId)`:

```ts
async function countOpenTables(tx: Transaction, tenantId: TenantId, nodeId: NodeId) {
  // dining_tables is location-scoped, not node-scoped; scope by the node's location.
  const { rows } = await tx.execute<{ total: string; open: string }>(sql`
    select count(*)::text as total,
           count(*) filter (where dt.tab_id is not null)::text as open
    from dining_tables dt
    join nodes n on n.tenant_id = dt.tenant_id and n.location_id = dt.location_id
    where dt.tenant_id = ${tenantId} and n.id = ${nodeId} and dt.active = true
  `);
  return { total: Number(rows[0]!.total), open: Number(rows[0]!.open) };
}
```

Verify `dining_tables` scoping: it is keyed by `(tenant_id, location_id)`; a node maps to one location. Confirm the app role holds SELECT on `dining_tables` (TS-1 grants — it does).

- [ ] **Step 6: Wire boot** — `boot.ts:878`: `mountReportApi(app, { db, cfg: { tenantId: till.tenantId, nodeId: till.nodeId } }, log)`.

- [ ] **Step 7: Run, expect PASS.** Then `pnpm --filter @waitron/server test:coverage`.

- [ ] **Step 8: Commit** `feat(server): reports/overview route + node-scoped ReportApiDeps`.

---

### Task 5: report-api — daily-close + period routes

**Files:**
- Modify: `apps/server/src/report-api.ts`
- Test: `apps/server/src/report-api.test.ts`

**Interfaces:**
- Consumes: `computeDailyClose`, `computeVatSummaryForPeriod`, `computeTopSellers`; `resolveVenueClock`, `gated` (Task 4).
- Produces: `GET /management-api/reports/daily-close?businessDay=` → `{ businessDay, vat, cash, counts, topSellers }`; `GET /management-api/reports/period?from=&to=` → `{ from, to, vat, topSellers }`. Consumed by Task 6.

- [ ] **Step 1: Write failing tests**: daily-close 200 shape for a seeded day (vat.byRate, cash.byTill, counts, topSellers); daily-close 400 on missing/invalid `businessDay`; period 200 shape for a range; period 400 on `from > to` or invalid dates; both 403 without `report.view`.

- [ ] **Step 2: Run, expect FAIL.** Run: `pnpm --filter @waitron/server test report-api`

- [ ] **Step 3: Implement** both routes. Read `businessDay`/`from`/`to` from `c.req.query(...)`; a missing/empty param → throw the `management.request_invalid` error (the reporting validators throw plain `Error` on malformed dates — catch and map to 400 via the error boundary, or pre-validate the presence and let the reporting `validateBusinessDay*` throw; ensure the STATUS map turns these into 400, mirroring how the existing modelo-303 route validates `year`/`period`). Skeleton:

```ts
app.get("/reports/daily-close", (c) =>
  run(c, () => gated(c, "report.view", async (tx) => {
    const businessDay = c.req.query("businessDay");
    if (!businessDay) throw new AppError("management.request_invalid");
    const tenantId = brandTenantId(deps.cfg.tenantId);
    const nodeId = brandNodeId(deps.cfg.nodeId);
    const clock = await resolveVenueClock(tx, deps.cfg.nodeId);
    const input = { tenantId, nodeId, businessDay, timeZone: clock.timeZone, dayCutover: clock.dayCutover };
    const close = await computeDailyClose(tx, input);
    const topSellers = await computeTopSellers(tx, { ...input, fromBusinessDay: businessDay, toBusinessDay: businessDay, limit: 10 });
    return c.json({ businessDay, vat: close.vat, cash: close.cash, counts: close.counts, topSellers });
  })));

app.get("/reports/period", (c) =>
  run(c, () => gated(c, "report.view", async (tx) => {
    const from = c.req.query("from"), to = c.req.query("to");
    if (!from || !to) throw new AppError("management.request_invalid");
    const tenantId = brandTenantId(deps.cfg.tenantId);
    const nodeId = brandNodeId(deps.cfg.nodeId);
    const clock = await resolveVenueClock(tx, deps.cfg.nodeId);
    const common = { tenantId, nodeId, fromBusinessDay: from, toBusinessDay: to, timeZone: clock.timeZone, dayCutover: clock.dayCutover };
    const vat = await computeVatSummaryForPeriod(tx, common);
    const topSellers = await computeTopSellers(tx, { ...common, limit: 10 });
    return c.json({ from, to, vat, topSellers });
  })));
```

Ensure a reporting-validator `Error` (bad date) becomes a 400, not a 500 — either pre-validate with the reporting `validateBusinessDay`/`validateBusinessDayRange` and translate to `management.request_invalid`, or extend the error boundary. Match whatever the modelo-303 route does for its `parsePeriodToken` failure.

- [ ] **Step 4: Run, expect PASS.** Then `pnpm --filter @waitron/server test:coverage`.

- [ ] **Step 5: Commit** `feat(server): reports/daily-close + reports/period routes`.

---

### Task 6: DashboardApi client methods + local types

**Files:**
- Modify: `apps/dashboard/src/api/client.ts`
- Test: `apps/dashboard/src/api/client.test.ts` (if one exists; else add focused tests, or rely on screen tests)

**Interfaces:**
- Consumes: the three route shapes (Tasks 4 & 5).
- Produces (local interfaces + methods on `DashboardApi`):

```ts
export interface SalesOverview {
  businessDay: string;
  takings: { tenderTotal: string; tipTotal: string; grossTotal: string };
  counts: { sales: number; corrections: number; voids: number };
  openTables: { open: number; total: number };
  topSellers: TopSellerRow[];
}
export interface TopSellerRow { descriptions: Record<string, string>; quantity: string; total: string }
export interface VatRateRow { rate: string; base: string; tax: string }
export interface VatSummaryDto { byRate: VatRateRow[]; baseTotal: string; taxTotal: string; grossTotal: string }
export interface TenderMethodRow { method: string; amount: string; tip: string }
export interface TillCashUpRow { tillId: string; byMethod: TenderMethodRow[]; cashTakings: string }
export interface CashUpDto { byTill: TillCashUpRow[]; tenderTotal: string; tipTotal: string }
export interface DailyCloseDto { businessDay: string; vat: VatSummaryDto; cash: CashUpDto; counts: SalesOverview["counts"]; topSellers: TopSellerRow[] }
export interface SalesPeriodDto { from: string; to: string; vat: VatSummaryDto; topSellers: TopSellerRow[] }
```

Methods (mirror `getPlannedVsActual`): `getSalesOverview(): Promise<SalesOverview>` → `GET /management-api/reports/overview`; `getDailyClose(businessDay: string): Promise<DailyCloseDto>` → `.../reports/daily-close?businessDay=`; `getSalesPeriod(from, to): Promise<SalesPeriodDto>` → `.../reports/period?from=&to=`.

- [ ] **Step 1: Read `client.ts`** `getPlannedVsActual` (~line 1535) and the local-interface convention (lines 19-771). Confirm the exact reporting DTO field names against Tasks 4/5 JSON (esp. `cash.byTill[].byMethod[].{method,amount,tip}` from `types.ts` `CashUp`/`TenderMethodLine`).

- [ ] **Step 2: Write failing test** (if `client.test.ts` exists) — inject a stub `fetchImpl` returning a canned overview JSON, assert the method calls the right path and returns the parsed shape. Else defer coverage to the screen tests and note it.

- [ ] **Step 3: Run, expect FAIL** (method missing). Run: `pnpm --filter @waitron/dashboard test client`

- [ ] **Step 4: Implement** the interfaces + three methods funnelling through `#request`.

- [ ] **Step 5: Run, expect PASS.** Then `pnpm --filter @waitron/dashboard test:coverage` (whole app — screen tests may be needed to hit thresholds; if so, this task's coverage completes in Tasks 7-9).

- [ ] **Step 6: Commit** `feat(dashboard): DashboardApi sales/takings methods`.

---

### Task 7: Business-overview home screen

**Files:**
- Create: `apps/dashboard/src/screens/dashboard-overview-screen.ts`
- Create: `apps/dashboard/src/screens/dashboard-overview-screen.test.ts`
- Create: `apps/dashboard/src/screens/dashboard-overview-screen.a11y.test.ts`

**Interfaces:**
- Consumes: `api.getSalesOverview()` (Task 6); `wt-card`/`wt-*` (`@waitron/ui`); `t`/`currentLocale` (i18n); `codeOf`/`codeMessage` (codes).
- Produces: custom element `dashboard-overview-screen` (registered by side-effect import in Task 9).

- [ ] **Step 1: Read `planned-actual-screen.ts`** as the template (injected `.api`, `connectedCallback → #load`, `@state`, `try/catch → errorKey`, `baseStyles`/`selectStyles` + `css` with `var(--wt-*)`), and a `wt-card` usage for the card layout.

- [ ] **Step 2: Write failing tests** (`stubApi` returning canned `SalesOverview`; `mountWidget("dashboard-overview-screen", { api })`; `flush()`): renders takings total, sales count, `open/total` tables, a top-seller row (name resolved from `descriptions` via current locale); empty top-sellers → `[data-test=empty]`; `getSalesOverview` rejection → `[data-test=error]`. Plus the a11y test (axe, mirror a sibling `.a11y.test.ts`).

- [ ] **Step 3: Run, expect FAIL.** Run: `pnpm --filter @waitron/dashboard test overview`

- [ ] **Step 4: Implement** the screen: `#load` calls `api.getSalesOverview()` into `@state overview`; render `wt-card`s for takings (tenderTotal + tip + gross), counts, open tables, and a top-sellers list. A `#name(descriptions)` helper: `descriptions[currentLocale()] ?? Object.values(descriptions)[0] ?? ""`. Sole `<h1>${t("overview.title")}</h1>`. Money is a preformatted string from the server — render as-is (a currency-format helper is out of scope; if one exists in the app, use it). `data-test` hooks on every asserted node.

- [ ] **Step 5: Run, expect PASS** (both test files). Then `pnpm --filter @waitron/dashboard test:coverage`.

- [ ] **Step 6: Commit** `feat(dashboard): business-overview home screen`.

---

### Task 8: Sales screen (daily close + period)

**Files:**
- Create: `apps/dashboard/src/screens/dashboard-sales-screen.ts`
- Create: `apps/dashboard/src/screens/dashboard-sales-screen.test.ts`
- Create: `apps/dashboard/src/screens/dashboard-sales-screen.a11y.test.ts`

**Interfaces:**
- Consumes: `api.getDailyClose(day)`, `api.getSalesPeriod(from, to)` (Task 6); `today`/date utils (`src/date-utils.ts`); `wt-*`, i18n, codes.
- Produces: custom element `dashboard-sales-screen`.

- [ ] **Step 1: Read `planned-actual-screen.ts`** date-picker handling (`<input type=date>`, `#onSelectWeek`) and `date-utils.ts` (`today`).

- [ ] **Step 2: Write failing tests**: default (from=to=today) calls `getDailyClose(today)` and renders the per-till tender table + VAT-by-rate table + counts + top sellers; changing `to` to a later date switches to `getSalesPeriod(from,to)` and renders VAT + top sellers + the per-day note (`[data-test=period-note]`) and NO tender table; error path; a11y test.

- [ ] **Step 3: Run, expect FAIL.** Run: `pnpm --filter @waitron/dashboard test sales-screen`

- [ ] **Step 4: Implement**: `@state from`, `@state to` (default `today()`), `@state close?`, `@state period?`, `@state errorKey`. `#load` branches on `from === to`: single-day → `getDailyClose(from)` into `close`, clear `period`; range → `getSalesPeriod(from, to)` into `period`, clear `close`. Two `<input type=date>` with change handlers that set state and re-`#load`. Render helpers: `#renderClose(close)` (tender table over `cash.byTill[].byMethod`, VAT table over `vat.byRate`, counts, top sellers), `#renderPeriod(period)` (VAT table + top sellers + `<p class="muted" data-test="period-note">${t("sales.periodNote")}</p>`). Reuse the `#name(descriptions)` locale helper (factor to a shared `src/screens/…` util or `person-utils`-style module if both screens need it — a small `src/i18n/localized.ts` `localizedName(map)` is cleanest; if added, unit-test it).

- [ ] **Step 5: Run, expect PASS** (both files). Then `pnpm --filter @waitron/dashboard test:coverage`.

- [ ] **Step 6: Commit** `feat(dashboard): sales screen (daily close + period roll-up)`.

---

### Task 9: Register screens + change landing + i18n

**Files:**
- Modify: `apps/dashboard/src/dashboard-app.ts` (union, imports, `#renderScreen`, `#nav`, `#applyMe`)
- Modify: `apps/dashboard/src/i18n/strings.ts` (en + es)
- Test: `apps/dashboard/src/dashboard-app.test.ts`

**Interfaces:**
- Consumes: `dashboard-overview-screen` (Task 7), `dashboard-sales-screen` (Task 8).
- Produces: navigable `overview`/`sales` screens; non-staff post-login landing on `overview`.

- [ ] **Step 1: Read `dashboard-app.ts`** — `Screen` union (`:42`), side-effect imports (`:11`), `#renderScreen` (`:471`), `#nav` (`:374`), `#applyMe` (`:258-270`, landing at `:266`), and `#renderScreen` default (`:508`). Read `strings.ts` `nav.*` (en `:30`, es `:373`) and a screen `*.title` key.

- [ ] **Step 2: Write/adjust failing test** in `dashboard-app.test.ts`: after boot with a non-staff `getMe` (e.g. `manager`), the mounted screen is `dashboard-overview-screen` (was `staff`). Add a test that clicking `nav-sales` mounts `dashboard-sales-screen`. Keep the staff→my-schedule assertion.

- [ ] **Step 3: Run, expect FAIL.** Run: `pnpm --filter @waitron/dashboard test dashboard-app`

- [ ] **Step 4: Implement**: add `"overview" | "sales"` to the `Screen` union; two side-effect imports; two `#renderScreen` cases (`<dashboard-overview-screen .api=${this.api}>`, `<dashboard-sales-screen .api=${this.api}>`); two `#nav` `<wt-button data-test="nav-overview"/"nav-sales">`; change `#applyMe` line 266 to `this.screen = me.role === "staff" ? "my-schedule" : "overview"`; make `overview` the `#renderScreen` default. Add i18n `nav.overview`/`nav.sales`, `overview.title`/`overview.*` labels, `sales.title`/`sales.periodNote`/table headers to **both** `en` and `es` (every `StringKey` must exist in `es`).

- [ ] **Step 5: Run, expect PASS.** Then the whole app unfiltered: `pnpm --filter @waitron/dashboard test:coverage`.

- [ ] **Step 6: Commit** `feat(dashboard): register overview+sales screens, land non-staff on overview`.

---

### Task 10: Full gate + backlog

**Files:**
- Modify: `docs/backlog.md`

- [ ] **Step 1:** Run the whole gate from the repo root over the workspace: `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`, then per-package `test:coverage` for `identity`, `reporting`, `server`, `dashboard`.
- [ ] **Step 2:** Update `docs/backlog.md` — mark demo Tier A #2 as LANDED (screen + home + routes), leaving covers/party-size noted as not-built; note top-sellers now exists as `computeTopSellers`.
- [ ] **Step 3: Commit** `docs(backlog): sales/takings + overview home LANDED (Tier A #2)`.

---

## Self-Review

- **Spec coverage:** covers → dropped (no task, by decision); top sellers → T3; period view → T5/T8; report.view → T1; overview route + node scoping + timezone/cutover → T4; daily-close/period routes → T5; two screens → T7/T8; api client → T6; registration + landing + i18n → T9; tests → each task; backlog → T10. All spec sections map to a task.
- **Placeholder scan:** SQL, types, route skeletons, and representative tests are concrete. The two soft spots are deliberately flagged for the implementer to confirm against live code (jsonb deserialization in T3; the `gated` helper's exact parameterization + the bad-date→400 mapping in T4/T5) rather than guessed — each names the sibling to copy.
- **Type consistency:** `TopSellersInput`/`TopSeller` (T3) → `TopSellerRow`/DTOs (T6) field names align (`descriptions`/`quantity`/`total`). `ReportApiDeps.cfg.nodeId` (T4) consumed by T5. `getSalesOverview`/`getDailyClose`/`getSalesPeriod` names consistent T6→T7/T8. Screen tags `dashboard-overview-screen`/`dashboard-sales-screen` consistent T7/T8→T9.
