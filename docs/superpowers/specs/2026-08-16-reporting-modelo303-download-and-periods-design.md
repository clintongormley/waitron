# Modelo 303 — DR303 Download Route & Quarterly/Annual Periods — Design Spec

**Date:** 2026-08-16
**Status:** spec for an autonomous run
**Sub-project:** 8 — Reporting (the NON-asesor remainder of modelo 303, after #76 output-VAT and #91
input-VAT/deducible + the byte-exact DR303 writer both landed).
**Depends on (all landed):** `computeVatReturn` (#76, output+deducible net), `computeInputVat`,
`mapModelo303`, `toDr303Record` + `dr303-layout.ts` (#91).
**Suggested branch:** `feat/reporting-modelo303-download-and-periods`

> **Provenance discipline (CLAUDE.md §1).** Every necessity/impossibility claim below carries a
> `file:line` receipt or a run command. Two external fiscal facts (the quarterly período código; the
> absence of an annual modelo-303 código) are pinned to tree receipts (the landed DR303 layout +
> writer) rather than re-derived from AEAT this session; where a product implication rests on them it
> is flagged in §7 (Owner-review), not asserted as an owner decision.

---

## 1. Purpose & scope

Two remaining NON-advisor-blocked pieces of the modelo 303 track, built as one campaign item:

1. **DR303 download route.** Wire the landed byte-exact DR303 writer
   (`toDr303Record`, `packages/reporting/src/dr303.ts`) to an authenticated HTTP route so a manager can
   download the modelo-303 fixed-layout file for a period. It emits ISO-8859-1 bytes — the route sets
   `Content-Type` / `Content-Disposition` / charset correctly and returns the raw file.
2. **Quarterly & annual periods.** `computeVatReturn` / `computeInputVat` are MONTHLY today
   (`packages/reporting/src/vat-return.ts:32`, `input-vat.ts:39`, `period.ts:17`). Add **quarterly** (a
   quarter = the sum of its three months) and **annual** (a whole civil year) aggregation, and thread
   the período into the DR303 writer, which already accepts `1T`–`4T`
   (`dr303.ts:135`; tested `dr303.test.ts:234`).

**Exactness is inherited, never re-derived** — a quarter/year sums the already-filed per-invoice
cuotas, never `round(Σ base × rate)`, exactly as the monthly path does (§4, D3).

### Explicitly EXCLUDED (advisor-blocked — do NOT design or implement here)

- **The prorrata rule** — whether AEAT expects the deducible base unscaled under
  `deductible_proportion < 100`. This is the open #91 pre-filing caveat #2 (asesor-fiscal must
  confirm) and the documented seam at `dr303.ts:35-38`. Untouched.
- **Rectificativas de facturas recibidas** (casilla 40/41) — needs a schema self-FK
  (`corrects_purchase_invoice_id`) + a negative-line relaxation on the purchase tables. Untouched.
- **Intra-community / import boxes** (casillas 10–13, 32–39) — a local deli buys domestically; no data
  source. Untouched.

### The two #91 PRE-FILING CAVEATS remain open and are NOT touched by this item

Restated verbatim from `dr303.ts:29-38` so an executor does not mistake this item for resolving them:

1. **Validate once against the real AEAT sede** — página 2 (régimen simplificado) is omitted; nothing
   in the tree proves the sede "por fichero" uploader accepts a file with it absent. The route
   produces a **CANDIDATE** file, not a proven submission-ready one.
2. **Asesor prorrata** — under `deductible_proportion < 100` the base is emitted in full and only the
   cuota scaled; whether AEAT expects the base unscaled is unconfirmed.

Neither is resolved here. The route's doc comment and the PR must repeat both.

---

## 2. Fiscal safety (H2) — this item is READ-ONLY over the commercial lane

**Claim: nothing in this item writes to the fiscal core.** It does not call `computeHuella`, does not
insert/update/delete `registros_facturacion`, does not touch the hash chain, and does not read or
advance `invoice_series.next_number`. It only READS the already-filed commercial record and produces
an OUTPUT file. Grep-verified receipts (run 2026-08-16 from the repo root):

- **The reporting aggregate modules issue only `SELECT`.**
  `grep -rniE "insert into|update |delete from" packages/reporting/src/vat-return.ts
  packages/reporting/src/input-vat.ts packages/reporting/src/vat-summary.ts
  packages/reporting/src/period.ts` → **zero matches**. The only SQL statements are the two
  `select … from sales …` (`vat-summary.ts:37-49`) and `select … from purchase_invoice_vat join
  purchase_invoices …` (`input-vat.ts:53-70`). Both are pure reads.
- **`mapModelo303` and `toDr303Record` take no `tx` and touch no DB** — they are pure functions over a
  `VatReturn`/`Modelo303` (`modelo-303.ts:59`, `dr303.ts:249`). A DR303 file is manufactured entirely
  in memory from an already-computed aggregate.
- **No fiscal-package import in the reporting reads or the new route.**
  `grep -rn "@waitron/verifactu\|@waitron/fiscal" packages/reporting/src apps/server/src/report-api.ts`
  → the only hits are prose in doc comments (`vat-return.ts:26,38` reference `verifactu/format.ts` to
  explain the civil-date equivalence; no `import`). The new `report-api.ts` imports only `@waitron/db`,
  `@waitron/identity`, `@waitron/reporting`, `@waitron/shared`, `hono` — no `@waitron/verifactu` /
  `@waitron/fiscal-verifactu`.
- **The read source is itself immutable.** `sales.vat_breakdown` is a column on `sales`, which carries
  `REVOKE ALL` + an append-only trigger + a TRUNCATE-blocking trigger (fiscal invariants, CLAUDE.md
  §5). Reading a jsonb column cannot mutate the chain. The purchase tables
  (`purchase_invoices`/`purchase_invoice_vat`) are the deliberately-mutable commercial lane (#91 §2) —
  reading them is likewise inert.
- **The obligado-identity read is a plain `SELECT tenants`**, the exact idiom `till-api.ts:210-213`
  already uses as `app_user` (`.select({ name: tenants.legalName, taxId: tenants.taxId })
  .from(tenants).where(eq(tenants.id, deps.cfg.tenantId))`). `app_user` holds `SELECT` (not `INSERT`)
  on `tenants` deliberately (CLAUDE.md §3); no grant is widened.

**The DR303 file is our OUTPUT to AEAT — reasoning about that boundary.** A modelo 303 is an aggregate
tax **return** the obligado files periodically; it is a wholly separate artefact from the Veri\*Factu
per-invoice `registros_facturacion` records. This item *reads* the filed desglose that already entered
the huella and *derives* a downstream return file that a human uploads to the AEAT sede. The data flow
is strictly one-directional (filed record → aggregate → file → human → AEAT); nothing flows back into
the chain, no record is re-hashed, no invoice number is minted. Producing a return is downstream of
filing, never a second filing.

**The whole-branch fiscal-safety review MUST re-confirm this boundary** on the final base-to-tip diff
(the standing H2 rule). Drift into any fiscal write ⇒ leave the PR `needs-owner-review`, do NOT land
(§7 guardrail).

---

## 3. Migration — there is NONE (confirmed, not assumed)

This item adds **no `packages/db/drizzle/*.sql`**, touches no schema, and creates no `tenant_id`-bearing
table, so the FORCE-RLS + tenant-isolation-policy + grants recipe has nothing to apply and the
`fiscal-verifactu` `inmutabilidad` guard has no new table to scan. Reasons, each checked:

- **The DR303 route is a pure read** over tables that already exist — `sales.vat_breakdown` (migration
  0032, #66), `purchase_invoices` / `purchase_invoice_vat` (migrations 0041/0042, #91), and `tenants`.
  All `app_user` `SELECT` grants already exist (the #76/#91 reads already run as `app_user`).
- **The quarter/annual generalization is pure TypeScript** over the same reads — a different civil-date
  bound, no new data.
- **The `report.export` permission is CODE, not schema.** The permission catalog is a TypeScript array
  (`packages/identity/src/permissions.ts:7`), with the roles→permissions map beside it; a future
  data-driven RBAC "would replace exactly these two declarations" (that file's own doc). Adding a
  permission is a one-line array edit, not a DB migration.

The `inmutabilidad` guard is still run as a belt-and-suspenders regression check in the finish step,
but it is **unaffected by construction**. Saying so plainly is the honest form of "call out every
migration": there is none.

---

## 4. Decisions

### D1 — Period model: a `LiquidationPeriod` discriminated union, generalized in `period.ts`

Replace the monthly-only `month: number` with an explicit discriminated union, so a quarter/year is
represented honestly (a quarter is **not** a month) and the DR303 writer can stay correct:

```ts
// packages/reporting/src/period.ts
export type LiquidationPeriod =
  | { readonly kind: "month"; readonly month: number }   // 1..12
  | { readonly kind: "quarter"; readonly quarter: number } // 1..4 (1T..4T)
  | { readonly kind: "year" };                             // the whole civil year
```

- **Validation** generalizes `validateLiquidationPeriod` (`period.ts:17`): year integer 1000..9999
  (unchanged bound + rationale — a typo year makes an empty period, the quiet-wrong direction);
  `month` 1..12; `quarter` 1..4; `year` needs nothing further. A bad value stays a **plain `Error`**
  (a caller precondition, matching `period.ts`'s existing posture — no registered code; `reporting.*`
  is forbidden because it names the package, and no domain condition a till surfaces exists here).
- **Bounds** generalize `calendarMonthFilter` (`period.ts:31`) into `periodDateFilter(dateExpr, year,
  period)`, a half-open `[firstDay, upper)` civil-date bound — pure calendar dates, no DST subtlety
  (the same property the monthly bound has):
  - month `m`: `[make_date(y,m,1), + interval '1 month')`
  - quarter `q`: firstDay `make_date(y, 3*(q-1)+1, 1)`, upper `+ interval '3 months'`
    (Q1→[Jan,Apr), Q2→[Apr,Jul), Q3→[Jul,Oct), Q4→[Oct, next-Jan)).
  - year: `[make_date(y,1,1), + interval '1 year')`.
- **Why a union and not additive functions.** `computeVatReturn`/`computeInputVat` differ across
  periods only in this date bound; one generalized filter keeps ONE code path (the codebase's
  "extract one shared core" value — D3 of #76). The union also lets the DR303 writer distinguish
  month/quarter/year (D5). There is no deployed consumer (CLAUDE.md §3), so the only cost of the
  signature change is a mechanical update of the #76/#91 tests + the demo from `{ month: 8 }` to
  `{ period: { kind: "month", month: 8 } }` — the ASSERTIONS (byRate/totals/box values) are preserved,
  which is what the behaviour-preserving rule protects.

### D2 — `computeVatReturn` sums a quarter/year exactly, by summing filed cuotas

`computeVatReturn(tx, { tenantId, year, period })` and `computeInputVat(tx, { tenantId, year, period })`
use `periodDateFilter` for their date bound and otherwise are unchanged: the output side is
`Σ` of the filed per-rate `tax` from `sales.vat_breakdown` grouped by rate over the period's civil-date
range; the input side is `Σ round(filed cuota × deductible_proportion/100)` per line, grouped by
(rate, kind), over the same range. **A quarter/year is byte-identical to summing its constituent
months** — the summation set is merely partitioned differently, and decimal addition is associative, so
`Σ_{lines∈quarter} = Σ_month Σ_{lines∈month}`. This is the "a quarter = the sum of its three months"
requirement, satisfied by one range query rather than three sub-queries, and pinned by a
property test (§6, plan Task 1d). Exactness is thus **inherited, never re-derived**: no monthly base is
re-rounded.

`VatReturn`, `InputVatReturn`, and `Modelo303` carry `period: LiquidationPeriod` in place of
`month: number`; the byRate/baseTotal/taxTotal/deductible/result fields are UNCHANGED (the #76/#91
tests pin those).

### D3 — DR303 período value mapping: `1T`–`4T` confirmed; annual has NO modelo-303 código

- **Monthly:** período string `"01".."12"`. Confirmed — `formatPeriod` (`dr303.ts:132-141`) accepts it
  and the monthly envelope cross-check is tested (`dr303.test.ts:277`).
- **Quarterly:** período string `"1T".."4T"`. **Confirmed against the tree** — `formatPeriod`'s regex
  `^(?:0[1-9]|1[0-2]|[1-4]T)$` (`dr303.ts:135`) accepts `1T`–`4T`, and `dr303.test.ts:234-237` pins that
  `"4t"` produces the envelope `<T303020264T0000>`. A quarterly aggregate maps a quarter `q` →
  período `"${q}T"`.
- **Annual:** **there is NO annual período código for modelo 303**, so the DR303 route does NOT emit an
  annual file. Receipts: (a) `formatPeriod`'s regex accepts only `01`–`12` and `1T`–`4T` — no `0A` /
  no annual token (`dr303.ts:135`); (b) the modelo-303 annual **resumen** is a *separate form, modelo
  390*, referenced by the DR303 layout itself (`dr303-layout.ts:310-320`, común field: "Sujeto pasivo
  exonerado de la Declaración-resumen anual del IVA, **modelo 390**"). So: `computeVatReturn` supports an
  annual **aggregate** (useful for year-end reconciliation / a future modelo-390 export), but
  `toDr303Record` **refuses** an annual aggregate (throws — there is no modelo-303 file to write) and
  the download route accepts month|quarter only. The first draft's temptation to invent `"0A"` is
  refused per CLAUDE.md §1 ("if uncertain, flag — do not invent"). Owner-review note in §7.

### D4 — `toDr303Record` becomes period-aware; the monthly cross-check stays, annual is refused, quarterly stays exempt

The landed envelope cross-check (`dr303.ts:249-264`) uses `modelo303.month`. With `month → period`:

- **year** cross-check unchanged (`options.year === modelo303.year`).
- **monthly** cross-check unchanged in spirit — when `modelo303.period.kind === "month"`, require a
  two-digit `options.period` to equal `monthlyPeriod(period.month)` (reads `period.month` now).
- **annual** (`kind === "year"`): **throw** — "an annual aggregate has no modelo 303 período (the
  annual return is modelo 390)". This is the new refusal that makes the union safe.
- **quarterly** (`kind === "quarter"`): **left exempt**, exactly as #91 designed and as the brief
  expects ("deliberately leaves the período cross-check-exempt"). The real guard is the ROUTE: it
  derives `options.period` from the SAME `LiquidationPeriod` it computed the aggregate for (D6), so
  envelope-vs-aggregate can never disagree at the route. Keeping the writer's quarterly exemption
  avoids re-litigating #91's carefully-reasoned guard and keeps this item's dr303.ts change minimal
  (the fixture flips `month:8` → `period:{kind:"month",month:8}`; one new annual-refusal test; one new
  quarterly-file test). `Dr303Options` is UNCHANGED (still `{ taxId, name, year, period, declarationType }`).

### D5 — The download route: path, gate, headers, obligado identity

- **Module & mount.** New `apps/server/src/report-api.ts` exporting `mountReportApi(app, deps, log)`,
  the sibling of `mountPurchasingApi`; mounted on the SAME Hono app in `boot.ts` with the identical
  deps shape `{ db, cfg: { tenantId } }` (`boot.ts:347` is the template).
- **Path & method.** `GET /management-api/reports/modelo-303` — a new `/management-api/reports/…`
  group (none exists today). Query params:
  - `year` — integer `1000..9999` (screened → `management.request_invalid` `{ field: "year" }`).
  - `period` — `"01".."12"` (→ `{kind:"month", month}`) or `"1T".."4T"` (→ `{kind:"quarter", quarter}`);
    anything else, including an annual token, is `management.request_invalid` `{ field: "period" }`.
  - `declarationType` — the AEAT *tipo de declaración* single char (I/D/C/…). Required; screened as a
    length-1 string. The allowed SET is an AEAT/asesor detail (§7 owner-review); the route accepts any
    single character and passes it to `Dr303Options.declarationType`.
- **Gate — a NEW `report.export` permission (manager + admin).** No `report.*` permission exists today
  (`permissions.ts:7-35` lists sale.\*, person.manage, till.configure, schedule.manage, swap.approve,
  absence.decide, purchase.manage — no reporting/report gate; `report.*` namespace grep-free). Decision
  and rationale in D7. The route funnels every DB touch through a `gated(sessionId, fn)` helper that
  opens `withTenant(db, cfg.tenantId)` + `asAppUser` + `authorizeManager(tx, { managementSessionId,
  permission: REPORT_EXPORT_PERMISSION })` then runs `fn` — byte-for-byte the `purchasing-api.ts:198-206`
  shape. `requireManagementSession(c)` (→ 401) runs before any DB work.
- **The obligado identity comes from the DB, not the client.** Inside `gated`, read
  `select legal_name, tax_id from tenants where id = cfg.tenantId` (the `till-api.ts:210-213` idiom).
  `taxId` → `Dr303Options.taxId`, `legalName` → `Dr303Options.name`. Using the authoritative tenant
  record (not a forgeable query param) is both cleaner and safer.
- **The pipeline** (all landed): `computeVatReturn(tx, { tenantId, year, period })` →
  `mapModelo303(vatReturn)` → `toDr303Record(modelo, { taxId, name, year, period: <the normalized
  string>, declarationType })`. The normalized período string is `monthlyPeriod(month)` or
  `"${quarter}T"` — the SAME period the aggregate was computed for (D4's route-is-the-guard property).
- **Response headers (ISO-8859-1 binary).** `toDr303Record` returns a `Buffer` already `latin1`-encoded;
  return it via `c.body(new Uint8Array(record), 200, headers)` (the `media-api.ts:95` idiom for a
  `Uint8Array<ArrayBuffer>`), with:
  - `Content-Type: text/plain; charset=ISO-8859-1` — the honest type: it IS latin1 fixed-layout text,
    and the charset declares the byte encoding the buffer already carries.
  - `Content-Disposition: attachment; filename="modelo-303-{year}-{period}.txt"` — a download (not
    inline); e.g. `modelo-303-2026-08.txt`, `modelo-303-2026-2T.txt`. Pure-ASCII filename, no encoding
    subtlety. The extension/name is cosmetic — the sede uploader does not validate it.
  - `Cache-Control: no-store` — a per-request fiscal document behind auth; never cache.
- **Errors.** `run = createErrorBoundary(STATUS, "report.failed")` (log tag only, not a registered
  code — mirrors `purchasing-api.ts:76`). `STATUS` maps `management_session.required`/`.expired` → 401,
  `person.suspended` → 403, `authorization.not_permitted` → 403, `management.request_invalid` → 400.
  **No new error code** is needed: the only client faults are request-shape (`management.request_invalid`,
  declared in `apps/server/src/errors.ts:381`, kept reachable by a `import "./errors.js"` line) and the
  auth codes (declared in `@waitron/identity`, reachable via the `authorizeManager`/
  `requireManagementSession` value imports). An empty period is NOT an error — `computeVatReturn`
  returns zeros and `toDr303Record` produces a valid all-zeros 2944-byte nil return.

### D6 — No dashboard UI in this item (headless route; UI deferred)

The dashboard has no reports screen (`apps/dashboard/src/screens/` has purchases/staff/roster/… but no
reporting screen), and a DR303 export is a fiscal-return concern, not purchase-invoice authoring, so it
does not belong on `purchases-screen.ts`. Following the module-headless-first precedent (catalogue and
purchasing both shipped headless before a separate UI fast-follow — #91/#93), the DR303 export ships as
a **headless route** here; a dashboard reports screen (period picker + tipo selector + download button,
mirroring the existing screen/widget patterns) is a deferred parallel track (§8). The route is fully
usable and testable over HTTP without it.

### D7 — `report.export` permission (new seam) vs. reusing `purchase.manage`

**Decision: add a new domain-named `report.export` permission, mapped to `manager` + `admin`.**

The brief delegated this choice ("decide reuse of an existing manager gate vs. a new `report.export`
seam … justify"). Reasoning:

- **Semantics.** `purchase.manage` gates *authoring received supplier invoices* (the commercial data
  entry). Downloading a **fiscal return to file with AEAT** is a distinct capability. Gating the export
  on `purchase.manage` would conflate "can key in a supplier invoice" with "can export the tax return";
  a future RBAC that wants an accountant role able to export but not author (or vice-versa) would then
  need a permission rename — and permissions, like error codes, are not cheaply renamed once call sites
  bind to them.
- **House pattern.** The catalog is deliberately fine-grained and domain-named — `sale.void`,
  `till.configure`, `schedule.manage`, `swap.approve`, `absence.decide`, `purchase.manage` are each a
  single capability. `report.export` (concept = the report; verb = export) fits that `<concept>.<verb>`
  convention (grepped: no sibling uses `reports.` or `report_`; namespace free). Mapped to
  `manager` + `admin` — the same roles the other write/config gates use — matching the dashboard's
  audience.
- **Cost is one line in the catalog + one line in the `MANAGER` set + one `permissions.test.ts` block**,
  and the seam is additive (no rename risk). `report.view` is NOT added (YAGNI — the only action here is
  export).

This is a RECORDED product decision (a new permission in the fixed catalog), made under the brief's
delegation — low-risk and pattern-following, but a reviewer should sanity-check the manager+admin
mapping (§7).

### D8 — No backwards-compat / backfill (CLAUDE.md §3)

Nothing is deployed; the signature change is a straight edit with the tests/demo updated in the same
change. No data migration, no compatibility shim.

---

## 5. Public API summary

New / changed exports from `@waitron/reporting` (`packages/reporting/src/index.ts`):

```ts
export type { LiquidationPeriod } from "./period.js";        // NEW
export { computeVatReturn } from "./vat-return.js";          // input.period, output.period (changed)
export { computeInputVat } from "./input-vat.js";            // input.period (changed)
export { mapModelo303 } from "./modelo-303.js";              // Modelo303.period (changed)
export { toDr303Record } from "./dr303.js";                  // period-aware cross-check (changed)
export type { InputVatInput } from "./input-vat.js";         // { tenantId, year, period } (changed)
export type { Modelo303, Dr303Options } from ...;            // Modelo303.period (changed); Options same
export type { InputVatReturn, VatReturn, VatReturnInput } from "./types.js"; // .period (changed)
```

New in `apps/server`: `mountReportApi` (`report-api.ts`), mounted in `boot.ts`.
New in `@waitron/identity`: the `report.export` permission (`permissions.ts`).

`computeVatSummaryForPeriod` / `PeriodVatInput` (the operational **business-day range** roll-up, scope
3 of #76) is a DIFFERENT concept — a cutover-shifted business-day span, not a fiscal
`LiquidationPeriod` — and is **untouched**. This spec's "period" is always the civil fiscal
liquidation period.

---

## 6. Testing strategy

`@waitron/reporting` runs PGlite by default (`usePgliteDb` + `CORE_MIGRATIONS`) with a real-PG harness
for RLS; `apps/server` route suites run PGlite in-process for mechanics + a real-PG suite for the RLS
differential (CLAUDE.md §4). Coverage `98/98/98/95` on both packages; CI gates on `test:coverage`; run
each changed package UNFILTERED (tree-wide guards); real-PG needs `TESTCONTAINERS_RYUK_DISABLED=true`.

- **Period generalization (PGlite, `@waitron/reporting`):**
  - **Quarterly = Σ its three months** — seed sales+purchases across Jan/Feb/Mar; assert a Q1
    `computeVatReturn` equals the merged sum of the three monthly `computeVatReturn`s (byRate, totals,
    deductible, result). This is the exactness-inherited receipt (D2).
  - **Annual = Σ twelve months** — a coarser version of the same.
  - **Boundary cases** — a sale/purchase on `2026-03-31` lands in Q1 and one on `2026-04-01` in Q2; a
    `2026-12-31` vs `2027-01-01` split proves the year bound. Prove-by-deletion on the quarter/year
    upper bound.
  - **Difference-method preserved** — a catalogue-method invoice whose filed cuota ≠ `round(base×rate)`
    sums verbatim across a quarter (swap to re-rounding → red).
  - **Existing #76/#91 monthly assertions stay green** under the new input shape (behaviour-preserving).
  - **DR303 annual refusal** — `toDr303Record` on a `{kind:"year"}` aggregate throws (`dr303.test.ts`).
  - **DR303 quarterly file** — a `{kind:"quarter", quarter:1}` aggregate + `"1T"` produces a valid
    2944-byte file with the `<T30302026 1T 0000>` envelope.
- **Download route mechanics (PGlite, `apps/server/report-api.test.ts`):** seed a tenant + a month of
  sales + purchases + a manager and a staff management session (the `purchasing-api.test.ts:26-56`
  harness). Assert: manager GET → 200 with `Content-Type: text/plain; charset=ISO-8859-1`,
  `Content-Disposition: attachment; filename="modelo-303-2026-08.txt"`, `Cache-Control: no-store`, body
  length 2944, a known casilla at its documented byte offset carrying the expected packed value; a
  quarterly `"1T"` request → 200 with the `1T` envelope + the right filename; an **empty** period → 200
  with a valid all-zeros file; bad `year` / bad `period` / annual `period` / missing `declarationType`
  → 400 `management.request_invalid`; **staff** cookie → 403 `authorization.not_permitted`; **no**
  cookie → 401 `management_session.required`.
- **Download route RLS (REAL Postgres, `apps/server/report-api.rls.test.ts`):** two provisioned venues
  (the `purchasing-api.rls.test.ts:55-110` harness). Tenant A's DR303 file reflects ONLY A's sales +
  purchases and carries A's NIF/razón social, never B's — proven by comparing a box value and the
  identity bytes. **Prove-by-deletion** of `asAppUser` in `gated` (→ the file leaks B's figures) and of
  the `authorizeManager(… report.export)` line (→ a staff cookie gets 200). This is the suite that
  matters because the route drops any explicit node/tenant filter — RLS + the tenant predicate are the
  only scoping, and PGlite (superuser) cannot show that half.
- **Permission (`packages/identity/permissions.test.ts`):** a `report.export → manager+admin only`
  block mirroring the `purchase.manage` block (`:55-63`), plus the existing `for (const p of
  PERMISSIONS)` manager/admin loops that auto-cover it. Prove-by-deletion: drop `report.export` from
  the `MANAGER` set → the new manager assertion flips red.
- **Guard suites (belt-and-suspenders — unaffected, no schema change):**
  `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`; the tree-wide `english-only` +
  reachability guards via the root project; `pnpm --filter @waitron/reporting test:coverage` and
  `pnpm --filter @waitron/server test:coverage`.
- **Demo:** extend `apps/server/scripts/modelo-303-demo.ts` to also reconcile a **quarter** (Q3 2026 =
  its three months) and print the annual aggregate, and to self-validate a **quarterly** DR303 file
  (envelope `…3T…`).

---

## 7. Owner-review assumptions (flag, do NOT land on drift)

An executor must leave the PR `needs-owner-review` (and NOT land) on any of these rather than guessing:

1. **`report.export` permission seam (D7).** A new permission in the fixed catalog is a product
   decision. It was made under the brief's delegation and follows the house pattern (manager+admin,
   domain-named), so it is RECORDED, not blocking — but a reviewer should confirm the manager+admin
   mapping is the intended audience. If the owner wants reporting granted to a distinct role, that is a
   trivial map edit but should be an explicit call.
2. **`declarationType` allowed set (D5).** The AEAT *tipo de declaración* code set (I ingreso / D
   devolución / C compensación / N sin actividad / …) and whether the field may be blank is an
   AEAT/asesor detail this session did not pin to a primary source. The route accepts any single
   character and passes it through. Do NOT hardcode a tipo enum without the asesor. This rides on #91
   pre-filing caveat #1 (validate the produced file against the real sede once).
3. **No annual modelo-303 file (D3).** The evidence that modelo 303 has no annual período (annual =
   modelo 390) is strong (the writer's own regex + the layout's modelo-390 reference), so the DECISION
   to refuse an annual DR303 file is recorded. But confirm with the owner/asesor that no annual
   modelo-303 filing is expected; an annual **modelo 390** export is a separate form and a separate
   spec (out of scope here).
4. **The two open #91 PRE-FILING CAVEATS (§1) are NOT resolved by this item** — validate once against
   the real AEAT sede uploader; asesor to confirm the prorrata base-unscaled treatment. The route
   produces a CANDIDATE file; its doc comment and the PR must repeat both.

**Guardrail:** on drift into the fiscal core (any write to `registros_facturacion` / `computeHuella` /
the hash chain / `invoice_series`) or any unrecorded product decision beyond the four above, leave the
PR `needs-owner-review` and do NOT land.

---

## 8. Scope out / deferred

- The three EXCLUDED advisor-blocked pieces (§1): prorrata rule, rectificativas de facturas recibidas
  (40/41), intra-community/import boxes (32–39).
- A **dashboard reports screen** with a DR303 download trigger (D6) — a parallel UI track.
- An **annual modelo 390** resumen export (a separate form — D3).
- The result-cascade boxes the current `mapModelo303` proves ZERO for a monthly deli (68/77/78/108/109/70,
  43/44) remain deferred (#91 §11); a quarter/year aggregate does not change which are in scope.
- The sargable index rewrite for the civil-date predicate (gated on scale, #76 §6).

---

## 9. Provenance (tree receipts — re-confirm each while implementing, CLAUDE.md §1)

| Claim | Receipt |
| --- | --- |
| `computeVatReturn`/`computeInputVat` are monthly; validate + month bound in `period.ts` | `packages/reporting/src/vat-return.ts:32`, `input-vat.ts:39`, `period.ts:17,31` |
| `toDr303Record` accepts `1T`–`4T`; monthly cross-check on `modelo303.month`; quarterly exempt | `packages/reporting/src/dr303.ts:132-141,249-264`; test `dr303.test.ts:234-237,277-285` |
| No annual período código; annual resumen = modelo 390 | `dr303.ts:135` (regex, no `0A`); `dr303-layout.ts:310-320` (modelo 390 reference) |
| Reporting reads issue only SELECT (no writes) | `grep -rniE "insert into\|update \|delete from" packages/reporting/src/{vat-return,input-vat,vat-summary,period}.ts` → 0 matches; `vat-summary.ts:37-49`, `input-vat.ts:53-70` |
| `mapModelo303`/`toDr303Record` are pure (no `tx`/DB) | `modelo-303.ts:59`, `dr303.ts:249` |
| DR303 pipeline: computeVatReturn → mapModelo303 → toDr303Record; file is 2944 bytes ISO-8859-1 | `apps/server/scripts/modelo-303-demo.ts:671-691`; `packages/reporting/reference/README.md` |
| `no report.* permission today`; catalog is code | `packages/identity/src/permissions.ts:7-35`; `report.*` grep-free |
| Management route gate pattern (`gated` = withTenant+asAppUser+authorizeManager) | `apps/server/src/purchasing-api.ts:194-206`; `manager-login.ts:43-52` |
| Binary response idiom (`c.body(Uint8Array, 200, headers)`) | `apps/server/src/media-api.ts:95-99` |
| Obligado identity read as app_user (`select legal_name, tax_id from tenants`) | `apps/server/src/till-api.ts:210-213`; `tenants` cols `tax_id`/`legal_name` at `packages/db/src/schema/tenants.ts:32-33` |
| `app_user` holds SELECT (not INSERT) on tenants | CLAUDE.md §3; the two reads above run as `app_user` |
| Route boot wiring template | `apps/server/src/boot.ts:347` (`mountPurchasingApi`) |
| `management.request_invalid` declared in the server host | `apps/server/src/errors.ts:381` |
| Route test harnesses (PGlite in-process + real-PG RLS) | `apps/server/src/purchasing-api.test.ts:26-106`, `purchasing-api.rls.test.ts:55-267` |
| Permission test pattern (prove-by-deletion of the role map) | `packages/identity/src/permissions.test.ts:55-63` |
| No migration — reads over existing tables; permission is code | §3 above |
