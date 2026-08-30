# Sales/takings screen + real dashboard home — design

_2026-08-29 · demo Tier A #2 (docs/backlog.md)._

## Goal

`packages/reporting` is fully built (daily close, cash-up, VAT summary, cierre Z) but has **no
dashboard surface** — the only wired route is the modelo-303 tax-file export. Meanwhile a
manager/supervisor logging into the dashboard lands on the **staff-admin table**, which the owner
flagged as wrong.

This slice:

1. Wires the reporting data into the dashboard behind new management-api routes.
2. Adds a **business-overview home** ("today at a glance") and makes it the post-login landing for
   every non-staff role.
3. Adds a dedicated **Sales screen** (single-day daily close + period roll-up) with a date-range
   picker.

Out of scope (Tier A #3 and later): the grouped **sidebar** and **email+password login**. This slice
keeps the existing flat nav (adds two buttons) and the existing login screen.

## Data reality (verified 2026-08-29)

| Metric the backlog names | Source | Status |
| --- | --- | --- |
| Takings (by tender) + tips | `computeDailyClose(...).cash` (`CashUp`, per-till) | exists |
| VAT by rate + gross | `computeDailyClose(...).vat`, `computeVatSummaryForPeriod` | exists |
| Sales / corrections / voids counts | `computeDailyClose(...).counts` | exists |
| Open tables | `dining_tables.tab_id IS NOT NULL` (live operational state) | derivable, new tiny query |
| Top sellers | `sale_lines` (frozen `descriptions` + `quantity` + `line_total`; **no `product_id`**) | **new aggregate query** |
| **Covers (guests served)** | — none — `dining_tables.capacity` is seat config, no party-size is captured on any sale/order | **dropped** (§ Decisions) |

## Decisions

- **Covers is dropped.** No guest count is captured anywhere; fabricating one violates the house rule
  against inventing data (CLAUDE.md §3). The home shows only real figures.
- **Top sellers is built now.** New `computeTopSellers` reporting query. `sale_lines` carries no
  `product_id` (filed lines carry frozen snapshots by design), so grouping is by the frozen
  `descriptions` jsonb; the display name is resolved to the viewer's locale in the frontend.
- **Period-range view included**, accepting that over a range only VAT + top sellers are available
  (per-till tender detail is a single-day concept — `computeDailyClose` is node+day scoped).
- **New permission `report.view`** (viewing takings ≠ exporting AEAT tax files), granted to
  SUPERVISOR + MANAGER (admin holds ALL). This makes the overview a safe landing for every non-staff
  role. Codes are never renamed once shipped (CLAUDE.md §3) — this is a permanent addition.

## Backend

Everything is **node-scoped**: this server is exactly one node (`till.nodeId` from env, threaded at
boot — `nodes.ts:26` "one node per venue today"). The routes take **no** `nodeId`/`locationId` param;
`nodeId` is resolved at boot exactly like the catalogue/recipe mounts, and `time_zone`/`day_cutover`
are read from the node's `locations` row (`tenants.ts:128-129`, whose doc block names this route as
their "future wiring").

### 1. `computeTopSellers` — new reporting query

`packages/reporting/src/top-sellers.ts`, exported from the barrel:

```ts
computeTopSellers(tx, input: TopSellersInput): Promise<TopSeller[]>
```

- `TopSellersInput`: `{ tenantId, nodeId?, fromBusinessDay, toBusinessDay, timeZone, dayCutover, limit }`
  (same shape as `PeriodVatInput` + `limit`).
- Mirrors `aggregateVatByRate`'s query: `sale_lines sl` join `sales s` on the composite
  `(tenant_id, sale_id) → (tenant_id, id)`; filter `s.tenant_id`, optional `s.node_id`,
  `businessDayRangeClause(sql\`s.issued_at\`, input)`, and `activeSalesClause` (excludes voids +
  F3-canje substitutes — same exclusion set as VAT, so top sellers and takings agree on which sales
  count).
- `group by sl.descriptions`; `sum(quantity)::numeric(12,3)`, `sum(line_total)::numeric(12,2)`;
  `order by sum(quantity) desc, <stable tiebreak>` `limit ${limit}`.
- Returns `TopSeller[]`: `{ descriptions: Record<string,string>; quantity: Decimal; total: Decimal }`
  (frontend resolves `descriptions` to the current locale). Corrections net in via signed quantity;
  a product whose net quantity is ≤ 0 is still returned if it ranks — the caller/limit decides.
- Input validation reuses `validateTimeZone` / `validateCutover` / `validateBusinessDayRange` and
  throws a plain `Error` (caller precondition), matching `computeVatSummaryForPeriod`. `limit` is
  validated (positive integer) and throws likewise.

### 2. `currentBusinessDay` — new business-day helper

`packages/reporting/src/business-day.ts`, exported:

```ts
currentBusinessDay(tx, input: { timeZone: string; dayCutover: string }): Promise<string>  // "YYYY-MM-DD"
```

Runs `select (now() at time zone $tz - $cutover::interval)::date` — reusing the existing
`businessDayLocalDate` shift expression on `now()` rather than a column, so the overview route's
"today" uses the identical DST-correct cutover maths as every aggregate. Validates its inputs.

### 3. `ReportApiDeps` extension + routes

`ReportApiDeps.cfg` gains `nodeId` (today it is tenant-only because modelo-303 aggregates all nodes).
Boot passes `cfg: { tenantId: till.tenantId, nodeId: till.nodeId }` (`boot.ts:878`). The route reads
`time_zone`/`day_cutover` by joining the node's `locations` row once per request.

Three GET routes under `/management-api/reports/`, each wrapped in the **existing `gated` helper**
verbatim (management session → `withTenant` → `asAppUser` → `authorizeManager({ permission:
"report.view" })`) and the existing `createErrorBoundary` status map:

- **`GET .../overview`** — no params. Resolves today's business day (`currentBusinessDay`), returns:
  ```jsonc
  {
    "businessDay": "2026-08-29",
    "takings": { "tenderTotal": "…", "tipTotal": "…", "grossTotal": "…" },
    "counts":   { "sales": 0, "corrections": 0, "voids": 0 },
    "openTables": { "open": 0, "total": 0 },
    "topSellers": [ { "descriptions": { "en": "…" }, "quantity": "…", "total": "…" } ]
  }
  ```
  `takings` is derived from `computeDailyClose(today)` (`cash.tenderTotal`, `cash.tipTotal`,
  `vat.grossTotal`); `counts` from the same call; `openTables` from a `dining_tables` count
  (`count(*)` total, `count(*) filter (where tab_id is not null)` open); `topSellers` from
  `computeTopSellers(today, today, limit 5)`.
- **`GET .../daily-close?businessDay=YYYY-MM-DD`** — full `DailyClose` (`vat`, `cash`, `counts`) plus
  `businessDay` echo and `topSellers` for that day. Bad/absent `businessDay` → `management.request_invalid` (400).
- **`GET .../period?from=YYYY-MM-DD&to=YYYY-MM-DD`** — `{ from, to, vat: VatSummary, topSellers }` for
  the range. Range validation errors → 400.

Money crosses the wire as decimal **strings** (reporting's `Decimal` is a branded string;
`JSON.stringify` emits the string). The dashboard types declare `string`.

### 4. `report.view` permission

`packages/identity/src/permissions.ts`: append `"report.view"` to the `PERMISSIONS` `as const` tuple
and add it to the `SUPERVISOR` set (MANAGER inherits via `...SUPERVISOR`; admin via `ALL`). Gate all
three new routes on it.

## Frontend (`apps/dashboard`, Lit + `wt-*` primitives)

Two new screens in `src/screens/`, each following the `planned-actual-screen` template exactly:
injected `@property .api!: DashboardApi`, `connectedCallback → #load`, `@state` fields, every async
path `try/catch → errorKey` rendered as `<p class="error" role="alert" data-test="error">`, sole
`<h1>`, `wt-*` primitives and `--wt-*` tokens only (no hardcoded chrome — enforced by
`no-hardcoded-chrome.test.ts`).

- **`dashboard-overview-screen`** (home): a grid of `wt-card`s — takings today (total + tender lines +
  tips), sales/corrections/voids counts, open/total tables, and a top-sellers list. Single fetch:
  `api.getSalesOverview()`.
- **`dashboard-sales-screen`** (Sales): a date-range picker (two `<input type=date>`, default
  today/today, mirroring `planned-actual`'s date handling). `from === to` → `api.getDailyClose(from)`
  renders the full close (a per-till tender table, a VAT-by-rate table, counts, top sellers).
  `from < to` → `api.getSalesPeriod(from, to)` renders VAT-by-rate + top sellers, with a `muted` note
  that per-till tender detail is available per day. Top-seller names resolve `descriptions` to
  `currentLocale()` with a first-value fallback.

`DashboardApi` (`src/api/client.ts`) gains `getSalesOverview()`, `getDailyClose(day)`,
`getSalesPeriod(from, to)`, funnelling through the existing private `#request`, with response shapes
**re-declared locally** (the #70 browser-bundle rule — never import `@waitron/*` server types into the
bundle).

`dashboard-app.ts`: add `"overview"` and `"sales"` to the `Screen` union, a side-effect import each, a
`#renderScreen` case each, a `#nav` `<wt-button>` each, and `nav.*` + `*.title` i18n strings (en + es
in `src/i18n/strings.ts`). **Landing:** `#applyMe` — non-staff roles set `screen = "overview"` instead
of `"staff"`; staff still land on `my-schedule`. `overview` becomes the sensible `#renderScreen`
default.

## Testing

- **reporting:** `top-sellers.test.ts` (aggregation, node scoping, void/substitute exclusion,
  ordering, limit, signed-quantity netting, empty result; same target as `vat-summary` tests) and a
  `currentBusinessDay` case in `business-day.test.ts` (cutover shift correctness). Prove each new
  guard/filter by deletion.
- **identity:** extend the permissions test — `roleHasPermission` for `report.view` across
  supervisor/manager/admin (holds) and staff (does not).
- **server:** extend `report-api` tests for the three routes — auth gating (401 no session, 403
  without `report.view`), tenant/node scoping (RLS test), shape of each response, 400 on bad
  date params.
- **dashboard:** `dashboard-overview-screen.test.ts` + `.a11y.test.ts` and
  `dashboard-sales-screen.test.ts` + `.a11y.test.ts` (stub the injected `DashboardApi`, real-browser
  Vitest, `data-test` hooks, error path via `mockRejectedValue({ code })`); update
  `dashboard-app.test.ts`'s post-login landing assertion to `overview` for a non-staff role.

Coverage gates: reporting/identity/server 98/98/98/95; dashboard 95/95/90/88.

## Files touched

- `packages/reporting/src/top-sellers.ts` (new) + `.test.ts`; `business-day.ts` (+`currentBusinessDay`)
  + test; `index.ts` (barrel); `types.ts` (`TopSellersInput`, `TopSeller`).
- `packages/identity/src/permissions.ts` + test.
- `apps/server/src/report-api.ts` (+3 routes, `ReportApiDeps.nodeId`) + tests; `boot.ts` (pass nodeId).
- `apps/dashboard/src/api/client.ts` (+3 methods + local types); `src/screens/dashboard-overview-screen.ts`,
  `dashboard-sales-screen.ts` (+ each `.test.ts`/`.a11y.test.ts`); `src/dashboard-app.ts` (register +
  landing) + test; `src/i18n/strings.ts` (en + es).
