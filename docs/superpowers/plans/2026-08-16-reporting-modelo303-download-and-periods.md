# Modelo 303 — DR303 Download Route & Quarterly/Annual Periods — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) add **quarterly** and **annual** aggregation to `computeVatReturn` / `computeInputVat`
(a quarter = the sum of its three months; exactness inherited, never re-rounded), threading the período
into the landed DR303 writer; and (2) wire the landed byte-exact DR303 writer to an authenticated
**download route** (`GET /management-api/reports/modelo-303`) that returns the ISO-8859-1 modelo-303
file for a period.

**Architecture:** Pure reads over the already-filed commercial record — `sales.vat_breakdown` (#66),
`purchase_invoices`/`purchase_invoice_vat` (#91) — plus the pure `mapModelo303` → `toDr303Record`
pipeline. The period is generalized to a `LiquidationPeriod` discriminated union in
`packages/reporting/src/period.ts`. The route mirrors `apps/server/src/purchasing-api.ts` (Hono, the
`gated` = `withTenant`+`asAppUser`+`authorizeManager` helper, `createErrorBoundary`), gated on a NEW
`report.export` permission. NO migration, NO schema change, NO fiscal-core write.

**Tech Stack:** TypeScript (ESM), Drizzle (`sql`), Hono, Vitest (PGlite + Testcontainers real Postgres),
`@waitron/shared` `Decimal` codec.

**Spec:** docs/superpowers/specs/2026-08-16-reporting-modelo303-download-and-periods-design.md

## Global Constraints

- **Coverage `98/98/98/95`** on every changed package (`@waitron/reporting`, `@waitron/identity`,
  `@waitron/server`); CI gates on `test:coverage`. Run each changed package **UNFILTERED** (tree-wide
  guards, CLAUDE.md §2/§4). Real-PG suites need `TESTCONTAINERS_RYUK_DISABLED=true`.
- **Error codes name the DOMAIN CONCEPT, never the package; never renamed once shipped.** This item
  adds **no new error code** (request-shape faults reuse `management.request_invalid`). It adds one new
  **permission** `report.export` (permissions are code, same "grep the siblings / domain-named"
  discipline — spec D7).
- **English identifiers; Spanish only in comments/UI.** `@waitron/reporting` is a `GENERIC_PACKAGE`.
  `LiquidationPeriod`, `period`, `quarter`, `year`, `month` are English → **no `SPANISH_WORDS` change**;
  `devengado`/`deducible`/`modelo 303` stay in doc comments only, as #76/#91 established.
- **Exactness inherited, not re-derived.** A quarter/year SUMS the filed per-invoice cuotas over a
  wider civil-date range; never `round(Σ base × rate)`. Pinned by a "quarter == Σ its three months"
  property test (Task 1e) and a difference-method test (Task 1f).
- **No backwards-compat / backfill** (CLAUDE.md §3): nothing deployed. The `month → period` signature
  change is a straight edit; update the #76/#91 tests + the demo in the same change, PRESERVING their
  assertions (only the input construction changes).
- **Fiscal boundary (H2) is HARD (spec §2).** This is READ-ONLY over the commercial lane. Touch NOTHING
  in `packages/verifactu`/`packages/fiscal-verifactu`; no `computeHuella`, no `registros_facturacion`,
  no hash chain, no `invoice_series`. A whole-branch fiscal-safety review MUST confirm this.
- **Every commit `-s`.** Create the worktree with `worktree.py new waitron feat/reporting-modelo303-download-and-periods` (NOT a plain `git worktree add`). Commit per task.
- **Prove every guard by deletion; confirm negative controls.**

## Resolved facts (verified 2026-08-16 against the tree)

1. **The old period helpers are consumed ONLY by `vat-return.ts` + `input-vat.ts`** (grep:
   `validateLiquidationPeriod|calendarMonthFilter` → those two files + their definitions in `period.ts`;
   no test imports them). Safe to replace in place.
2. **`tenants`, `Database`, `Transaction`, `asAppUser`, `withTenant` are exported from the `@waitron/db`
   barrel**; `eq` from `drizzle-orm`. Import idiom: `import { asAppUser, tenants, withTenant, type
   Database, type Transaction } from "@waitron/db"` (see `till-api.ts:5`, `purchasing-api.ts:15`).
   Tenant columns: `tenants.taxId` (`tax_id`), `tenants.legalName` (`legal_name`).
3. **`@waitron/reporting` is already a dependency of `apps/server`** (`apps/server/package.json`), so no
   manifest change to consume `computeVatReturn`/`mapModelo303`/`toDr303Record`.
4. **The DR303 file is 2944 bytes** (común 328 + página1 1581 + página3 1017 + envelope-close 18),
   ISO-8859-1 (`packages/reporting/reference/README.md`; self-validated in the demo).
5. **`report.*` permission/error namespace is grep-free**; the catalog is a code array
   (`permissions.ts:7`).
6. **Route auth codes** (`management_session.required`/`.expired`, `person.suspended`,
   `authorization.not_permitted`) are thrown by `requireManagementSession` / `resolveManagementSession`
   / `authorizeManager` and declared in `@waitron/identity` (`management-session.ts:57-62`,
   `manager-login.ts:49`); `management.request_invalid` is declared in `apps/server/src/errors.ts:381`.

---

## Slice 1 — Quarterly & annual periods (`@waitron/reporting` + demo)

### Task 1a — `LiquidationPeriod` + generalized validate + `periodDateFilter` in `period.ts`

**Files:** `packages/reporting/src/period.ts` (rewrite the two helpers), `packages/reporting/src/period.test.ts` (NEW — pure unit tests for validation; the SQL bounds are proven through the aggregate in Task 1c–1e).

**Interfaces:**
- **Produces:** `LiquidationPeriod` (union); `validatePeriod(year: number, period: LiquidationPeriod): void`; `periodDateFilter(dateExpr: SQL, year: number, period: LiquidationPeriod): SQL`.
- **Removes:** `validateLiquidationPeriod(year, month)`, `calendarMonthFilter(dateExpr, year, month)` (only consumers are updated in 1b).

**Steps:**

1. [ ] **Failing test** — create `packages/reporting/src/period.test.ts`:
   ```ts
   import { describe, expect, it } from "vitest";
   import { validatePeriod, type LiquidationPeriod } from "./period.js";

   describe("validatePeriod", () => {
     it("accepts a valid month, quarter and year", () => {
       expect(() => validatePeriod(2026, { kind: "month", month: 8 })).not.toThrow();
       expect(() => validatePeriod(2026, { kind: "quarter", quarter: 2 })).not.toThrow();
       expect(() => validatePeriod(2026, { kind: "year" })).not.toThrow();
     });
     it("rejects a non-four-digit year in every period kind", () => {
       for (const p of [
         { kind: "month", month: 8 },
         { kind: "quarter", quarter: 1 },
         { kind: "year" },
       ] as LiquidationPeriod[]) {
         expect(() => validatePeriod(226, p)).toThrow(/year/);
         expect(() => validatePeriod(10000, p)).toThrow(/year/);
       }
     });
     it("rejects an out-of-range month and quarter", () => {
       expect(() => validatePeriod(2026, { kind: "month", month: 0 })).toThrow(/month/);
       expect(() => validatePeriod(2026, { kind: "month", month: 13 })).toThrow(/month/);
       expect(() => validatePeriod(2026, { kind: "quarter", quarter: 0 })).toThrow(/quarter/);
       expect(() => validatePeriod(2026, { kind: "quarter", quarter: 5 })).toThrow(/quarter/);
     });
   });
   ```
   Run `pnpm --filter @waitron/reporting test period` → **RED** (no `validatePeriod` export).

2. [ ] **Minimal impl** — rewrite `packages/reporting/src/period.ts`:
   ```ts
   import { sql } from "drizzle-orm";
   import type { SQL } from "drizzle-orm";

   /**
    * The modelo 303 liquidation PERIOD — a civil fiscal period, shared by the output side
    * (`computeVatReturn`) and the input side (`computeInputVat`), so the two cannot drift. A month, a
    * quarter (trimestre, "1T".."4T"), or the whole civil year. NOTE this is the FISCAL period; the
    * operational business-day range of `computeVatSummaryForPeriod` is a different concept.
    */
   export type LiquidationPeriod =
     | { readonly kind: "month"; readonly month: number } // 1..12
     | { readonly kind: "quarter"; readonly quarter: number } // 1..4 (1T..4T)
     | { readonly kind: "year" };

   /**
    * A bad year/period is a caller precondition — a plain Error (matching business-day.ts's validators,
    * no registered code), thrown BEFORE any query. The year is bounded to four digits for the reason
    * the monthly note recorded: a typo year make_date still accepts (226 AD) matches no rows and returns
    * a plausible-but-EMPTY period (the quiet, worse direction for a fiscal filing).
    */
   export function validatePeriod(year: number, period: LiquidationPeriod): void {
     if (!Number.isInteger(year) || year < 1000 || year > 9999) {
       throw new Error(`reporting: year must be an integer in 1000..9999: ${JSON.stringify(year)}`);
     }
     switch (period.kind) {
       case "month":
         if (!Number.isInteger(period.month) || period.month < 1 || period.month > 12) {
           throw new Error(
             `reporting: month must be an integer in 1..12: ${JSON.stringify(period.month)}`,
           );
         }
         return;
       case "quarter":
         if (!Number.isInteger(period.quarter) || period.quarter < 1 || period.quarter > 4) {
           throw new Error(
             `reporting: quarter must be an integer in 1..4: ${JSON.stringify(period.quarter)}`,
           );
         }
         return;
       case "year":
         return;
     }
   }

   /**
    * The half-open civil-date bound `[firstDay, upper)` on a date-valued SQL expression for a
    * `LiquidationPeriod` — pure calendar dates, no DST subtlety. The output side passes the filed
    * *fecha de expedición* expression; the input side passes `received_on`. A quarter is the three
    * calendar months of the trimestre; the whole year is Jan 1 → next Jan 1. Because it is a wider
    * range over the SAME rows, a quarter/year total is exactly the sum of its constituent months
    * (decimal addition is associative) — exactness inherited, never re-derived.
    */
   export function periodDateFilter(dateExpr: SQL, year: number, period: LiquidationPeriod): SQL {
     switch (period.kind) {
       case "month": {
         const firstDay = sql`make_date(${year}, ${period.month}, 1)`;
         return sql`${dateExpr} >= ${firstDay} and ${dateExpr} < (${firstDay} + interval '1 month')`;
       }
       case "quarter": {
         const firstMonth = 3 * (period.quarter - 1) + 1; // Q1→1, Q2→4, Q3→7, Q4→10
         const firstDay = sql`make_date(${year}, ${firstMonth}, 1)`;
         return sql`${dateExpr} >= ${firstDay} and ${dateExpr} < (${firstDay} + interval '3 months')`;
       }
       case "year": {
         const firstDay = sql`make_date(${year}, 1, 1)`;
         return sql`${dateExpr} >= ${firstDay} and ${dateExpr} < (${firstDay} + interval '1 year')`;
       }
     }
   }
   ```
   Run `pnpm --filter @waitron/reporting test period` → **GREEN**.

3. [ ] **Commit** `-s`: `feat(reporting): LiquidationPeriod (month/quarter/year) + periodDateFilter`.

### Task 1b — thread `period` through the types + the two aggregates

**Files:** `packages/reporting/src/types.ts`, `packages/reporting/src/input-vat.ts`, `packages/reporting/src/vat-return.ts`, `packages/reporting/src/index.ts`. This is one atomic refactor (a shared-type change); the tree is briefly non-compiling until every consumer is updated in this task.

**Interfaces (exact signatures after this task):**
- `VatReturnInput = { tenantId: TenantId; year: number; period: LiquidationPeriod }`
- `computeVatReturn(tx, VatReturnInput): Promise<VatReturn>` where `VatReturn` carries `period` (not `month`).
- `InputVatInput = { tenantId: TenantId; year: number; period: LiquidationPeriod }`
- `computeInputVat(tx, InputVatInput): Promise<InputVatReturn>` where `InputVatReturn` carries `period`.

**Steps:**

1. [ ] **`types.ts`** — replace `month: number` with `period: LiquidationPeriod` on `VatReturnInput`, `VatReturn`, and `InputVatReturn`; add the import. Concretely: `import type { LiquidationPeriod } from "./period.js";` at the top, and in each of the three interfaces swap the `/** Civil calendar month … */ month: number;` line for `/** The liquidation period (month/quarter/year). */ period: LiquidationPeriod;`. Leave `byRate`/`baseTotal`/`taxTotal`/`deductible`/`result`/`tenantId`/`year` UNCHANGED.

2. [ ] **`input-vat.ts`** — `import { periodDateFilter, validatePeriod, type LiquidationPeriod } from "./period.js";` (drop the old two). Change `InputVatInput`:
   ```ts
   export interface InputVatInput {
     tenantId: TenantId;
     year: number;
     /** The liquidation period (month/quarter/year); the deduction window over `received_on`. */
     period: LiquidationPeriod;
   }
   ```
   Body: `validatePeriod(input.year, input.period);` and `const dateFilter = periodDateFilter(sql\`p.received_on\`, input.year, input.period);`. Return `period: input.period` instead of `month: input.month`. (The SQL `select … group by (v.rate)…, v.kind` is unchanged — only the `where … and ${dateFilter}` bound widens.)

3. [ ] **`vat-return.ts`** — `import { periodDateFilter, validatePeriod } from "./period.js";`. Body: `validatePeriod(input.year, input.period);`, `const dateFilter = periodDateFilter(filedDate, input.year, input.period);`, pass `period: input.period` to `computeInputVat`, and return `period: input.period` (drop `month: input.month`). Update the doc comment's "one calendar month" phrasing to "one liquidation period (month/quarter/year)".

4. [ ] **`index.ts`** — add `export type { LiquidationPeriod } from "./period.js";` beside the existing reporting exports.

5. [ ] **Update the existing #76/#91 tests to the new input shape (behaviour-preserving).** In ALL FOUR call sites — `vat-return.test.ts`, `vat-return.rls.test.ts`, `input-vat.test.ts`, `input-vat.rls.test.ts` (grep `computeVatReturn(`/`computeInputVat(` to find every one) — every `{ tenantId, year: Y, month: M }` becomes `{ tenantId, year: Y, period: { kind: "month", month: M } }`; every assertion on a result's `.month` becomes `.period` (e.g. `expect(r.period).toEqual({ kind: "month", month: 8 })`). Do NOT change any byRate/base/tax/total/result expectation — those are the preserved assertions. Run `pnpm --filter @waitron/reporting test:coverage` UNFILTERED (the `.rls.test.ts` need `TESTCONTAINERS_RYUK_DISABLED=true`) → **GREEN** (same numbers, new input shape).

6. [ ] **Commit** `-s`: `refactor(reporting): thread LiquidationPeriod through computeVatReturn/computeInputVat`.

### Task 1c — quarterly aggregation (TDD, PGlite)

**Files:** `packages/reporting/src/vat-return.test.ts` (add a `describe`).

**Steps:**

1. [ ] **Failing test** — add a quarterly case that seeds three months and asserts the quarter aggregates them. Follow the existing PGlite seed helper in `vat-return.test.ts` (a `usePgliteDb` suite that inserts sales with a `vat_breakdown` and reads via `withTenant`+`asAppUser`). Concretely (adapt to the file's existing seed helper names):
   ```ts
   describe("computeVatReturn — quarterly", () => {
     it("Q1 sums January, February and March (byRate + totals + result)", async () => {
       // seed: a 21% sale on 2026-01-15, a 10% sale on 2026-02-15, a 21% sale on 2026-03-31,
       //       and a general purchase invoice received 2026-02-20 (kind ordinary, 21%).
       await seedSale({ day: "2026-01-15", rate: "21.00", base: "100.00", tax: "21.00" });
       await seedSale({ day: "2026-02-15", rate: "10.00", base: "50.00", tax: "5.00" });
       await seedSale({ day: "2026-03-31", rate: "21.00", base: "200.00", tax: "42.00" });
       await seedPurchase({ received: "2026-02-20", rate: "21.00", base: "80.00", tax: "16.80", kind: "ordinary" });
       const q1 = await read((tx) =>
         computeVatReturn(tx, { tenantId, year: 2026, period: { kind: "quarter", quarter: 1 } }),
       );
       expect(q1.period).toEqual({ kind: "quarter", quarter: 1 });
       // devengado: 21% base 300.00 cuota 63.00 ; 10% base 50.00 cuota 5.00 ; total cuota 68.00
       expect(q1.taxTotal).toBe("68.00");
       expect(q1.baseTotal).toBe("350.00");
       // deducible: 21% ordinary cuota 16.80 ; result = 68.00 − 16.80 = 51.20
       expect(q1.deductible.taxTotal).toBe("16.80");
       expect(q1.result).toBe("51.20");
     });
   });
   ```
   Run → **GREEN immediately** if 1b is correct (the generalization already covers a quarter). If it is not green, fix the `periodDateFilter` quarter bound. (This test is also the regression lock for the quarter bound.)

2. [ ] **Commit** `-s`: `test(reporting): computeVatReturn quarterly aggregation`.

### Task 1d — annual aggregation + period boundaries (TDD, PGlite)

**Files:** `packages/reporting/src/vat-return.test.ts`.

**Steps:**

1. [ ] **Failing/locking test** — add:
   ```ts
   describe("computeVatReturn — annual + period boundaries", () => {
     it("the annual period sums the whole civil year and excludes adjacent years", async () => {
       await seedSale({ day: "2026-01-01", rate: "21.00", base: "100.00", tax: "21.00" });
       await seedSale({ day: "2026-12-31", rate: "21.00", base: "100.00", tax: "21.00" });
       await seedSale({ day: "2027-01-01", rate: "21.00", base: "999.00", tax: "209.79" }); // next year
       await seedSale({ day: "2025-12-31", rate: "21.00", base: "999.00", tax: "209.79" }); // prior year
       const y = await read((tx) =>
         computeVatReturn(tx, { tenantId, year: 2026, period: { kind: "year" } }),
       );
       expect(y.period).toEqual({ kind: "year" });
       expect(y.taxTotal).toBe("42.00"); // only the two 2026 sales; 2025/2027 excluded
     });
     it("the Q1/Q2 boundary buckets 31 Mar into Q1 and 1 Apr into Q2", async () => {
       await seedSale({ day: "2026-03-31", rate: "21.00", base: "100.00", tax: "21.00" });
       await seedSale({ day: "2026-04-01", rate: "21.00", base: "100.00", tax: "21.00" });
       const q1 = await read((tx) => computeVatReturn(tx, { tenantId, year: 2026, period: { kind: "quarter", quarter: 1 } }));
       const q2 = await read((tx) => computeVatReturn(tx, { tenantId, year: 2026, period: { kind: "quarter", quarter: 2 } }));
       expect(q1.taxTotal).toBe("21.00");
       expect(q2.taxTotal).toBe("21.00");
     });
   });
   ```
   Run → GREEN (locks the year + quarter-boundary bounds).

2. [ ] **Prove the quarter/year upper bound by deletion** — temporarily change `periodDateFilter`'s quarter `interval '3 months'` to `interval '1 month'`; confirm the Q1 boundary test goes RED (31 Mar would still be in a 1-month Q1 starting Jan → actually widen instead: change `'3 months'` to `'4 months'` so `2026-04-01` leaks into Q1 → the Q1/Q2 boundary test's `q1.taxTotal` becomes `42.00` → RED). Restore; GREEN. Record the run in a comment.

3. [ ] **Commit** `-s`: `test(reporting): computeVatReturn annual + period-boundary bounds (proven by deletion)`.

### Task 1e — "a quarter = the sum of its three months" (exactness-inherited property)

**Files:** `packages/reporting/src/vat-return.test.ts`.

**Steps:**

1. [ ] **Property test** — seed a spread of sales + purchases across Apr/May/Jun (mixed rates + a difference-method invoice whose filed cuota ≠ `round(base×rate)`, e.g. a purchase `base 200.00 @ 21% tax 41.99`), then assert the Q2 aggregate equals the merged sum of the three monthly aggregates:
   ```ts
   it("Q2 equals the merged sum of April, May and June (exactness inherited)", async () => {
     // …seed across 2026-04..2026-06, including a difference-method purchase (tax 41.99, not 42.00)…
     const apr = await read((tx) => computeVatReturn(tx, { tenantId, year: 2026, period: { kind: "month", month: 4 } }));
     const may = await read((tx) => computeVatReturn(tx, { tenantId, year: 2026, period: { kind: "month", month: 5 } }));
     const jun = await read((tx) => computeVatReturn(tx, { tenantId, year: 2026, period: { kind: "month", month: 6 } }));
     const q2 = await read((tx) => computeVatReturn(tx, { tenantId, year: 2026, period: { kind: "quarter", quarter: 2 } }));
     // Σ of the three months' cuota totals (addDecimal, exact) == the quarter's cuota total, byte-for-byte
     const sumTax = addDecimal(addDecimal(apr.taxTotal, may.taxTotal), jun.taxTotal);
     expect(q2.taxTotal).toBe(sumTax);
     const sumDed = addDecimal(addDecimal(apr.deductible.taxTotal, may.deductible.taxTotal), jun.deductible.taxTotal);
     expect(q2.deductible.taxTotal).toBe(sumDed);
     expect(q2.result).toBe(subtractDecimal(sumTax, sumDed));
   });
   ```
   (`addDecimal`/`subtractDecimal` from `@waitron/shared`.) Run → GREEN. This is the receipt for "a quarter = the sum of its three months" AND for the difference-method-cuota being summed verbatim across a quarter.

2. [ ] **Commit** `-s`: `test(reporting): quarter equals sum of its three months (exactness inherited)`.

### Task 1f — `mapModelo303` carries `period`

**Files:** `packages/reporting/src/modelo-303.ts`, `packages/reporting/src/modelo-303.test.ts`.

**Steps:**

1. [ ] **Impl** — in `modelo-303.ts`: `import type { LiquidationPeriod } from "./period.js";`, change `Modelo303`'s `month: number` to `/** The liquidation period the boxes are FOR (month/quarter/year). */ period: LiquidationPeriod;`, and the `return` line's `month: vatReturn.month` to `period: vatReturn.period`. The box arithmetic is period-agnostic and UNCHANGED.

2. [ ] **Test** — in `modelo-303.test.ts`, update the existing fixtures' `.month`→`.period` (input `VatReturn`s and the asserted `Modelo303.period`); ADD one case: a quarterly `VatReturn` (`period: { kind: "quarter", quarter: 1 }`) maps to the SAME box values a monthly one with identical figures would (boxes carry no period), and `modelo.period` is the quarter. Run `pnpm --filter @waitron/reporting test modelo-303` → GREEN.

3. [ ] **Commit** `-s`: `refactor(reporting): Modelo303 carries the LiquidationPeriod`.

### Task 1g — `toDr303Record` period-aware (monthly cross-check kept, annual refused, quarterly exempt)

**Files:** `packages/reporting/src/dr303.ts`, `packages/reporting/src/dr303.test.ts`.

**Steps:**

1. [ ] **Failing test** — in `dr303.test.ts`, first flip the `deliMonth()` fixture from `month: 8` to `period: { kind: "month", month: 8 }` (so the file compiles), then add:
   ```ts
   it("refuses an annual aggregate — there is no modelo 303 annual período (annual is modelo 390)", () => {
     const annual = { ...deliMonth(), period: { kind: "year" as const } };
     expect(() => toDr303Record(annual, { ...OPTIONS, period: "01" })).toThrow(/annual|390/);
   });
   it("emits a quarterly file for a quarterly aggregate (envelope carries the trimestre)", () => {
     const q1 = { ...deliMonth(), period: { kind: "quarter" as const, quarter: 1 } };
     const file = toDr303Record(q1, { ...OPTIONS, period: "1T" });
     expect(file.length).toBe(2944);
     expect(at(file, 0, 17)).toBe("<T303020261T0000>"); // <T 3030 2026 1T 0000>
   });
   ```
   Run `pnpm --filter @waitron/reporting test dr303` → **RED** on the annual case (no refusal yet).

2. [ ] **Minimal impl** — in `dr303.ts`'s `toDr303Record`, replace the monthly-only cross-check block (currently reading `modelo303.month`) with the period-aware form, and update the doc comment (retire the "single-month aggregate cannot be pinned to a quarter" framing — the aggregate is now period-typed; the ROUTE derives `options.period` from the SAME period, so quarterly stays exempt while monthly is cross-checked and annual is refused):
   ```ts
   const p = modelo303.period;
   if (p.kind === "year") {
     // There is no annual modelo 303 file — the annual VAT resumen is a SEPARATE form (modelo 390).
     // Refuse rather than emit a file with a fabricated período (spec D3; dr303-layout.ts:310 names 390).
     throw new Error(
       "dr303: an annual aggregate has no modelo 303 período (the annual return is modelo 390); no file is emitted",
     );
   }
   if (p.kind === "month" && /^\d{2}$/.test(period) && period !== monthlyPeriod(p.month)) {
     throw new Error(
       `dr303: envelope period ${period} does not match the aggregate's liquidation month ${monthlyPeriod(p.month)}`,
     );
   }
   // A quarterly aggregate's período ("1T".."4T") is NOT cross-checked here: the download route derives
   // options.period from the SAME LiquidationPeriod it computed the aggregate for, so the two cannot
   // disagree at the caller (spec D4). (The year cross-check above still applies to every kind.)
   ```
   Keep the existing `options.year !== modelo303.year` check above it, and the `unplaceable` boxes check below it, unchanged. Run `pnpm --filter @waitron/reporting test dr303` → GREEN.

3. [ ] **Prove the annual refusal by deletion** — delete the `p.kind === "year"` throw; confirm the annual test goes RED (a `{kind:"year"}` aggregate + `"01"` now produces a misleading January-stamped file). Restore; GREEN.

4. [ ] **Commit** `-s`: `feat(reporting): toDr303Record is period-aware (annual refused, quarterly threaded)`.

### Task 1h — reporting green + demo extension

**Files:** `apps/server/scripts/modelo-303-demo.ts` (extend), plus a full package run.

**Steps:**

1. [ ] Extend `modelo-303-demo.ts`: change the existing monthly `computeVatReturn(tx, { tenantId, year: YEAR, month: MONTH })` call to `{ …, period: { kind: "month", month: MONTH } }`; ADD a **quarterly** reconciliation for the quarter containing `MONTH` (compute the three months and assert their merged sum equals the quarter's `computeVatReturn`, using the demo's existing `addDecimal`/`reconcile` helpers) and print the **annual** aggregate; self-validate a **quarterly** DR303 file (`period: { kind: "quarter", quarter: qOf(MONTH) }` → `toDr303Record(modelo, { …, period: \`${qOf(MONTH)}T\` })`, envelope `…{q}T…`). Run `pnpm --filter @waitron/server demo:modelo-303` → prints OK, exits 0.

2. [ ] **Verify the whole package UNFILTERED** (tree-wide guards, difference-method suites): `pnpm --filter @waitron/reporting test:coverage` → GREEN at `98/98/98/95`. If `periodDateFilter`'s `year` branch or a `switch` arm is uncovered, add a targeted PGlite case.

3. [ ] **Commit** `-s`: `test(server): modelo-303 demo reconciles a quarter + annual; quarterly DR303 file`.

---

## Slice 2 — DR303 download route (`report.export` permission + server route)

### Task 2a — the `report.export` permission

**Files:** `packages/identity/src/permissions.ts`, `packages/identity/src/permissions.test.ts`.

**Interfaces:** `report.export` added to `PERMISSIONS` and to the `MANAGER` set (→ manager + admin).

**Steps:**

1. [ ] **Failing test** — add to `permissions.test.ts` (mirroring the `purchase.manage` block `:55-63`):
   ```ts
   it("grants report.export to manager and admin only (modelo 303 DR303 export)", () => {
     // A domain-named reporting permission (exporting the modelo 303 fiscal file), granted to exactly
     // the roles that hold the other manager write gates — manager and admin — and NEVER to staff or
     // supervisor. A distinct seam from purchase.manage: exporting the tax return is not authoring
     // supplier invoices (spec D7).
     expect(roleHasPermission("manager", "report.export")).toBe(true);
     expect(roleHasPermission("admin", "report.export")).toBe(true);
     expect(roleHasPermission("staff", "report.export")).toBe(false);
     expect(roleHasPermission("supervisor", "report.export")).toBe(false);
   });
   ```
   Run `pnpm --filter @waitron/identity test permissions` → **RED** (`"report.export"` is not assignable to `Permission`; the type errors and the test fails).

2. [ ] **Minimal impl** — in `permissions.ts`, append to the `PERMISSIONS` array (with the domain-named doc comment, following the `purchase.manage` comment `:29-34`):
   ```ts
     // Exporting the modelo 303 fiscal autoliquidación as the AEAT DR303 fixed-layout file from the
     // management dashboard / API (@waitron/reporting toDr303Record). A domain-named REPORTING permission
     // — exporting the tax return is a distinct capability from authoring supplier invoices
     // (purchase.manage) or staff admin (person.manage); granted to manager + admin, the dashboard's
     // audience (spec D7). Codes/permissions are never renamed once shipped.
     "report.export",
   ```
   and add `"report.export"` to the `MANAGER` set (`ALL` already spreads `PERMISSIONS`, so admin gets it automatically). Run → GREEN.

3. [ ] **Prove by deletion** — remove `"report.export"` from the `MANAGER` set; confirm the new block's `manager` assertion (and the existing `for (const p of PERMISSIONS) expect(roleHasPermission("manager", p)).toBe(true)` loop at `:21`) go RED. Restore; GREEN.

4. [ ] **Verify** `pnpm --filter @waitron/identity test:coverage` → GREEN. **Commit** `-s`: `feat(identity): report.export permission (manager+admin) for modelo 303 export`.

### Task 2b — `report-api.ts` route + boot wiring

**Files:** `apps/server/src/report-api.ts` (NEW), `apps/server/src/boot.ts` (mount).

**Interfaces:**
- **Consumes:** `computeVatReturn`, `mapModelo303`, `toDr303Record`, `LiquidationPeriod` (`@waitron/reporting`); `authorizeManager` (`@waitron/identity`); `tenants`, `withTenant`, `asAppUser`, `Database`, `Transaction` (`@waitron/db`); `createErrorBoundary`, `requireManagementSession`.
- **Produces:** `mountReportApi(app: Hono, deps: ReportApiDeps, log: Logger): void`; route `GET /management-api/reports/modelo-303?year&period&declarationType`.

**Steps (the route is written first as a failing test in Task 2c; here is the impl it must satisfy):**

1. [ ] **Create `apps/server/src/report-api.ts`:**
   ```ts
   // Side-effect: loads this host's `management.request_invalid` augmentation (the query screens below
   // throw it directly), under the "every file that throws one imports ./errors.js" convention. The auth
   // codes (`management_session.*`, `person.suspended`, `authorization.not_permitted`) are declared in
   // @waitron/identity and load via the `authorizeManager`/`requireManagementSession` value imports.
   import "./errors.js";
   import type { Hono } from "hono";
   import type { ContentfulStatusCode } from "hono/utils/http-status";
   import { eq } from "drizzle-orm";
   import { AppError } from "@waitron/shared";
   import { asAppUser, tenants, withTenant, type Database, type Transaction } from "@waitron/db";
   import {
     computeVatReturn,
     mapModelo303,
     toDr303Record,
     type LiquidationPeriod,
   } from "@waitron/reporting";
   import { authorizeManager, type Permission } from "@waitron/identity";
   import { createErrorBoundary } from "./error-boundary.js";
   import { requireManagementSession } from "./management-session.js";
   import type { Logger } from "./logger.js";

   /** Deps for the reporting/export routes: `db` + this venue's `cfg.tenantId` scope every read via
    * `withTenant` (RLS confines it to this server's one tenant). Same minimal shape as PurchasingApiDeps
    * — no nodeId, no card provider, no clock: the routes are pure reads over the filed record. */
   export interface ReportApiDeps {
     db: Database;
     cfg: { tenantId: string };
   }

   /** The ONE permission gating the modelo 303 export — a NEW domain-named reporting seam (spec D7),
    * mapped to manager + admin. One constant, referenced at the route, so a future re-map is a one-line
    * swap here. */
   const REPORT_EXPORT_PERMISSION: Permission = "report.export";

   /** Every AppError CODE these routes answer + its HTTP status (the purchasing-api STATUS parallel).
    * CLIENT faults only; a genuine SERVER fault reaches `run` as a non-AppError → an opaque 500. No new
    * code is introduced: request-shape faults reuse `management.request_invalid`. */
   const STATUS: Record<string, ContentfulStatusCode> = {
     "management_session.required": 401,
     "management_session.expired": 401,
     "person.suspended": 403,
     "authorization.not_permitted": 403,
     "management.request_invalid": 400,
   };

   const run = createErrorBoundary(STATUS, "report.failed");

   /** Screen the `year` query param: a 4-digit integer, else `management.request_invalid` {field:"year"}
    * (never a downstream make_date error). */
   function requireYear(raw: string | undefined): number {
     if (raw === undefined || !/^\d{4}$/.test(raw)) {
       throw new AppError("management.request_invalid", { field: "year" });
     }
     return Number(raw);
   }

   /** Screen the `period` query param into a LiquidationPeriod. Accepts "01".."12" (month) and
    * "1T".."4T" (quarter). ANNUAL is deliberately NOT accepted here: there is no annual modelo 303 file
    * (the annual resumen is modelo 390, out of scope — spec D3). Anything else →
    * `management.request_invalid` {field:"period"}. Returns both the union and the normalized string the
    * envelope must carry (they are derived from ONE source, so they cannot disagree — spec D4). */
   function requirePeriod(raw: string | undefined): { period: LiquidationPeriod; token: string } {
     if (raw !== undefined) {
       const p = raw.trim().toUpperCase();
       const month = /^(0[1-9]|1[0-2])$/.exec(p);
       if (month) return { period: { kind: "month", month: Number(p) }, token: p };
       const quarter = /^([1-4])T$/.exec(p);
       if (quarter) return { period: { kind: "quarter", quarter: Number(quarter[1]) }, token: p };
     }
     throw new AppError("management.request_invalid", { field: "period" });
   }

   /** Screen the AEAT tipo de declaración: a single character (the DR303 field is length 1). The exact
    * allowed SET (I/D/C/N/…) is an AEAT/asesor detail (spec §7 owner-review), so any single char passes;
    * absent/multi-char → `management.request_invalid` {field:"declarationType"}. */
   function requireDeclarationType(raw: string | undefined): string {
     if (raw === undefined || Array.from(raw).length !== 1) {
       throw new AppError("management.request_invalid", { field: "declarationType" });
     }
     return raw;
   }

   /**
    * Mounts the gated modelo 303 export route on an existing Hono app — `mountPurchasingApi`'s sibling,
    * attached to the SAME app. `GET /management-api/reports/modelo-303?year&period&declarationType`
    * returns the AEAT DR303 fixed-layout file (ISO-8859-1) for the period. Every DB touch funnels
    * through `gated` (withTenant + asAppUser + authorizeManager(report.export)), so RLS scopes the read
    * to this server's one tenant and the gate runs in one place.
    *
    * PRE-FILING CAVEATS (unchanged from dr303.ts §29-38): the produced file is a CANDIDATE, not a proven
    * submission-ready one — página 2 is omitted (validate once against the real sede uploader), and under
    * prorrata the base is emitted unscaled pending an asesor confirmation.
    */
   export function mountReportApi(app: Hono, deps: ReportApiDeps, log: Logger): void {
     const gated = <T>(sessionId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> =>
       withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
         await asAppUser(tx);
         await authorizeManager(tx, {
           managementSessionId: sessionId,
           permission: REPORT_EXPORT_PERMISSION,
         });
         return fn(tx);
       });

     app.get("/management-api/reports/modelo-303", (c) =>
       run(c, log, async () => {
         const sessionId = requireManagementSession(c);
         const year = requireYear(c.req.query("year"));
         const { period, token } = requirePeriod(c.req.query("period"));
         const declarationType = requireDeclarationType(c.req.query("declarationType"));

         const record = await gated(sessionId, async (tx) => {
           // The obligado identity comes from the authoritative tenant row (RLS-scoped), not a client
           // param — the till-api whoami idiom. Structurally present: cfg.tenantId is this server's own.
           const [issuer] = await tx
             .select({ taxId: tenants.taxId, name: tenants.legalName })
             .from(tenants)
             .where(eq(tenants.id, deps.cfg.tenantId));
           /* v8 ignore start */
           if (issuer === undefined) {
             // Unreachable: this server's own tenant row always exists and RLS returns it (mirrors
             // till-api.ts's whoami guard). A misconfigured tenant becomes an opaque 500 via `run`.
             throw new Error(`report-api: no tenant row for ${deps.cfg.tenantId}`);
           }
           /* v8 ignore stop */
           const vatReturn = await computeVatReturn(tx, {
             tenantId: deps.cfg.tenantId,
             year,
             period,
           });
           const modelo = mapModelo303(vatReturn);
           // options.period === the SAME period token parsed above, so the writer's envelope cross-check
           // (monthly) can never mismatch the aggregate (spec D4).
           return toDr303Record(modelo, {
             taxId: issuer.taxId,
             name: issuer.name,
             year,
             period: token,
             declarationType,
           });
         });

         // ISO-8859-1 fixed-layout file: `record` is a latin1-encoded Buffer; `new Uint8Array` narrows it
         // to Uint8Array<ArrayBuffer> for `c.body` (the media-api idiom). It is a per-request fiscal
         // document behind auth → never cached; a download → Content-Disposition attachment.
         return c.body(new Uint8Array(record), 200, {
           "Content-Type": "text/plain; charset=ISO-8859-1",
           "Content-Disposition": `attachment; filename="modelo-303-${year}-${token}.txt"`,
           "Cache-Control": "no-store",
         });
       }),
     );
   }
   ```
   Note `tenantId: deps.cfg.tenantId` is passed to `computeVatReturn` as a plain `string`; if `VatReturnInput.tenantId` is the branded `TenantId`, brand it exactly as `purchasing-api.ts`/`till-api.ts` do (they pass `deps.cfg.tenantId` into `withTenant` untyped and into ops that accept `string`; confirm `computeVatReturn`'s `tenantId` accepts the config string — if it is branded `TenantId`, wrap with the `@waitron/shared` `tenantId(...)` brand, matching how the demo brands it).

2. [ ] **Wire into `boot.ts`** — beside `mountPurchasingApi(app, { db, cfg: { tenantId: till.tenantId } }, log);` (`:347`), add `mountReportApi(app, { db, cfg: { tenantId: till.tenantId } }, log);` with the import `import { mountReportApi } from "./report-api.js";` in the mount-imports block (`:43` area). One-line, reusing the EXACT `db`/tenant the siblings receive.

3. [ ] (No commit yet — the impl is committed with its test in Task 2c.)

### Task 2c — route mechanics (PGlite, in-process)

**Files:** `apps/server/src/report-api.test.ts` (NEW).

**Steps:**

1. [ ] **Failing test** — create `report-api.test.ts` on the `purchasing-api.test.ts:1-106` harness
   (`usePgliteDb` with `[CORE_MIGRATIONS, IDENTITY_MIGRATIONS]`, `seedTenant`, a `manager` + `staff`
   management session minted directly, a `send()` helper). Seed a **known month + quarter** of sales +
   purchases directly as the PGlite superuser (the `modelo-303-demo.ts:275-377` seed idioms), then:
   ```ts
   describe("mountReportApi — modelo 303 DR303 export", () => {
     it("GET …/reports/modelo-303?year&period=08 → 200 ISO-8859-1 attachment of 2944 bytes", async () => {
       const res = await send(mountApp(), "GET", "/management-api/reports/modelo-303?year=2026&period=08&declarationType=I");
       expect(res.status).toBe(200);
       expect(res.headers.get("content-type")).toBe("text/plain; charset=ISO-8859-1");
       expect(res.headers.get("content-disposition")).toBe('attachment; filename="modelo-303-2026-08.txt"');
       expect(res.headers.get("cache-control")).toBe("no-store");
       const bytes = new Uint8Array(await res.arrayBuffer());
       expect(bytes.length).toBe(2944);
       // a known casilla at its documented offset (the demo pins box 27 @ 1023, box 46 @ 1346): assert
       // the packed value of box 27 (Σ devengado cuota for the seeded month) using latin1 decode.
       const box27 = Buffer.from(bytes).toString("latin1", 1023, 1023 + 17);
       expect(box27).toBe(/* packed expected total, e.g. */ "00000000000006300");
     });
     it("accepts a quarterly período (period=1T) → 200 with the trimestre envelope + filename", async () => {
       const res = await send(mountApp(), "GET", "/management-api/reports/modelo-303?year=2026&period=1T&declarationType=I");
       expect(res.status).toBe(200);
       expect(res.headers.get("content-disposition")).toBe('attachment; filename="modelo-303-2026-1T.txt"');
       const env = Buffer.from(new Uint8Array(await res.arrayBuffer())).toString("latin1", 0, 17);
       expect(env).toBe("<T303020261T0000>");
     });
     it("produces a valid all-zeros nil return for an empty period → 200, 2944 bytes", async () => {
       const res = await send(mountApp(), "GET", "/management-api/reports/modelo-303?year=2099&period=01&declarationType=N");
       expect(res.status).toBe(200);
       expect(new Uint8Array(await res.arrayBuffer()).length).toBe(2944);
     });
   });

   describe("mountReportApi — request screens + auth", () => {
     it.each([
       ["missing year", "?period=08&declarationType=I", "year"],
       ["bad year", "?year=20&period=08&declarationType=I", "year"],
       ["bad period", "?year=2026&period=13&declarationType=I", "period"],
       ["annual period (no modelo 303 annual file)", "?year=2026&period=0A&declarationType=I", "period"],
       ["missing declarationType", "?year=2026&period=08", "declarationType"],
     ])("400 management.request_invalid: %s", async (_label, qs, field) => {
       const res = await send(mountApp(), "GET", `/management-api/reports/modelo-303${qs}`);
       expect(res.status).toBe(400);
       expect((await res.json()) as { error: { code: string; params: { field: string } } }).toMatchObject({
         error: { code: "management.request_invalid", params: { field } },
       });
     });
     it("401 with no session cookie", async () => {
       const res = await send(mountApp(), "GET", "/management-api/reports/modelo-303?year=2026&period=08&declarationType=I", { cookie: null });
       expect(res.status).toBe(401);
     });
     it("403 for a staff-role session (holds no report.export)", async () => {
       const res = await send(mountApp(), "GET", "/management-api/reports/modelo-303?year=2026&period=08&declarationType=I", { cookie: staffCookie });
       expect(res.status).toBe(403);
       expect((await res.json()) as { error: { code: string } }).toMatchObject({ error: { code: "authorization.not_permitted" } });
     });
   });
   ```
   (Compute the expected packed box-27 value from the seeded month with `addDecimal` + the demo's
   `packAeatNumeric` idiom — do NOT hardcode a guessed string; derive it so a formatter bug can't
   self-mask.) Run `pnpm --filter @waitron/server test report-api` → **RED** (no route until 2b is
   present).

2. [ ] **Make it pass** — with Task 2b's `report-api.ts` + boot wiring in place, run → GREEN. Fix any
   `tenantId` branding mismatch surfaced by `tsc`.

3. [ ] **Commit** `-s`: `feat(server): modelo 303 DR303 download route (report.export gate, ISO-8859-1)`.

### Task 2d — route RLS differential (REAL Postgres)

**Files:** `apps/server/src/report-api.rls.test.ts` (NEW).

**Steps:**

1. [ ] **Failing/locking test** — create on the `purchasing-api.rls.test.ts:1-118` harness
   (`useRealPostgres` + `startRealPostgres`, `applyVenue`/`planVenue`, a `nextNif()` counter, a `manager`
   + `staff` session per venue). Two provisioned venues A and B; seed a month of sales + purchases for
   EACH (as `app_user` under each tenant, via `withTenant`+`asAppUser`, or as the admin superuser like
   the demo — but the READ under test must go through the route's `asAppUser`). Assert:
   ```ts
   it("a tenant's DR303 file reflects only its OWN sales/purchases and its OWN NIF (RLS)", async () => {
     // GUARD-BY-DELETION (asAppUser): removing `await asAppUser(tx)` from report-api.ts's `gated` makes
     // the read run on the admin superuser (bypasses FORCE RLS) → A's file would sum B's figures and
     // carry no isolation; the box-value and NIF assertions below flip green→red. Run + record here.
     const a = await setupVenue(); const b = await setupVenue();
     await seedMonth(a, /* A's figures */); await seedMonth(b, /* different B figures */);
     const fileA = await download(mountApp(a.tenantId), a.managerCookie, "2026", "08", "I");
     expect(fileA.status).toBe(200);
     const bytesA = Buffer.from(new Uint8Array(await fileA.arrayBuffer()));
     // A's box 27 == A's own Σ cuota (not A+B); and A's NIF (from tenants) appears, never B's.
     expect(bytesA.toString("latin1", 1023, 1040)).toBe(packAeatNumeric(aExpectedCuota, 17));
     expect(bytesA.toString("latin1")).toContain(a.taxId);
     expect(bytesA.toString("latin1")).not.toContain(b.taxId);
   });
   it("refuses the export to a staff-role session — 403 (gate by deletion)", async () => {
     // GUARD-BY-DELETION (authorizeManager): removing the authorizeManager(report.export) call from
     // `gated` makes a staff cookie 200 instead of 403 — the assertion below flips. Run + record.
     const v = await setupVenue();
     const res = await download(mountApp(v.tenantId), v.staffCookie, "2026", "08", "I");
     expect(res.status).toBe(403);
   });
   ```
   Run with `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test report-api.rls` → GREEN.

2. [ ] **Execute both guard-by-deletion proofs** against `postgres:18` and record the exact result + the
   `git diff report-api.ts` clean-afterward line in the test comments (the `purchasing-api.rls.test.ts:172-176,225-231`
   convention). The `asAppUser` deletion must flip the RLS assertion; the `authorizeManager` deletion
   must flip the 403 assertion.

3. [ ] **Commit** `-s`: `test(server): modelo 303 export RLS + gate proven by deletion (real Postgres)`.

### Task 2e — finish

**Steps:**

1. [ ] **Four-command gate + coverage per changed package** (unfiltered):
   `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`, then
   `pnpm --filter @waitron/reporting test:coverage`, `pnpm --filter @waitron/identity test:coverage`,
   `pnpm --filter @waitron/server test:coverage` (98/98/98/95). `pnpm install` (no dep change expected —
   `@waitron/reporting` is already a server dep — but run `--frozen-lockfile` mentally / the pre-push
   hook does).
2. [ ] **Belt-and-suspenders guards** (unaffected — no schema change, spec §3): `pnpm --filter
   @waitron/fiscal-verifactu test inmutabilidad`; the root-project `english-only` + reachability guards
   (they run from the `lint` job / pre-push).
3. [ ] **Fiscal boundary (H2) grep-confirmed on the base-to-tip diff** (spec §2): no
   `@waitron/verifactu`/`@waitron/fiscal-verifactu` source touched; no `computeHuella`/
   `registros_facturacion`/`invoice_series` write; the reporting reads + the new route are SELECT-only
   (`grep -rniE "insert into|update |delete from"` over the changed reporting/server source → 0 in the
   read/route paths).
4. [ ] **finish-branch:** whole-branch review (incl. a fiscal-correctness lens: the period bounds, the
   quarter=Σ-months exactness, the annual refusal, RLS on the export). Address findings → fix wave →
   simplify → Copilot → PR. **Do NOT merge** — the owner lands via `/land-branch`.
5. [ ] **Owner-review flags (spec §7)** surfaced in the PR body: the `report.export` seam (D7,
   sanity-check the manager+admin mapping); the `declarationType` allowed set + the two open #91
   pre-filing caveats; the no-annual-modelo-303-file decision (annual = modelo 390, out of scope). On
   drift into the fiscal core or any unrecorded product decision → leave `needs-owner-review`, do NOT
   land.

**Deferred (spec §8):** the prorrata rule, rectificativas de facturas recibidas (40/41),
intra-community/import boxes (32–39), a dashboard reports screen with a download trigger, an annual
modelo-390 export.

---

## Self-review (plan vs. spec)

- **Coverage of the spec's decisions:** D1 (period union + `periodDateFilter`) → 1a–1b; D2 (quarter/year
  exact sum) → 1c–1e; D3 (1T–4T mapping, annual refusal) → 1g + 2c; D4 (period-aware cross-check) → 1g;
  D5 (route path/gate/headers/identity) → 2b–2c; D6 (headless, no UI) → no UI task by design; D7
  (report.export) → 2a; D8 (no bwc) → the refactor updates tests in place. §2 H2 → 2e step 3. §3 (no
  migration) → no migration task, asserted. §7 owner-review → 2e step 5.
- **Placeholders:** none — every task carries runnable test + impl code. The two "derive the expected
  packed value" notes (Task 2c/2d) are deliberate (do not hardcode a guessed byte string; compute it),
  not placeholders.
- **Type consistency:** `LiquidationPeriod` is defined once (`period.ts`) and imported by `types.ts`,
  `input-vat.ts`, `modelo-303.ts`, the route. `Modelo303.period`/`VatReturn.period`/`InputVatReturn.period`
  all change together in 1b/1f so the tree compiles atomically. The route passes `token` (the normalized
  período string) to `Dr303Options.period`, matching the aggregate's `period`, so the writer's monthly
  cross-check cannot mismatch (D4). The one open type question — whether `computeVatReturn`'s `tenantId`
  is a branded `TenantId` — is called out in Task 2b step 1 with the brand-it-like-the-demo remedy.
- **Guards proven by deletion:** the quarter/year bound (1d), the annual refusal (1g), the `report.export`
  role map (2a), the route's `asAppUser` RLS + `authorizeManager` gate (2d). Each has an explicit
  restore-and-green step.
