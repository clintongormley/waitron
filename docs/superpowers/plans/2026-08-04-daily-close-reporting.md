# Daily Close (Reporting) — First Slice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only `@waitron/reporting` package with one `computeDailyClose(tx, input)` function that produces a per-`(tenant, node, business-day)` daily close — a VAT summary (base + cuota per rate, corrections netted) anchored on issuance, and an operational cash-up (by till and tender method) anchored on settlement.

**Architecture:** A new package that mirrors `@waitron/core`'s read-model conventions (`listOutstandingSales`): raw `tx.execute(sql\`…\`)` aggregates over the commercial tables in `@waitron/db`, `Decimal` string money throughout, a belt-and-suspenders `tenant_id`/`node_id` predicate on every query on top of RLS. Business-day bucketing is done in SQL, DST-aware, via `AT TIME ZONE`. No new tables, **no migration**. The function is a pure, deterministic read over immutable records — a future frozen *cierre Z* would snapshot its result.

**Tech Stack:** TypeScript (ESM), drizzle-orm `sql` templates, PGlite for tests (`usePgliteDb`), Vitest. Money via `@waitron/shared`'s `Decimal` BigInt codec.

## Global Constraints

Copied verbatim from the design ([2026-08-04-daily-close-reporting-design.md](../specs/2026-08-04-daily-close-reporting-design.md)). Every task's requirements implicitly include these:

- **Read-only. No migration, no new table.** The package depends only on `@waitron/db`, `@waitron/shared`, `drizzle-orm`.
- **Money is always `Decimal` (a branded string), never a JS `number`.** Sum with `sumDecimals`/`addDecimal`; in SQL cast aggregates `::numeric(12,2)::text` and re-parse with `decimal()`. There is deliberately no `toNumber`.
- **Grain: one close per `(tenant, node, business-day)`.** Every query carries `s.tenant_id = ${tenantId}` AND `s.node_id = ${nodeId}` predicates (belt-and-suspenders over RLS — mirrors `listOutstandingSales`).
- **Two anchors.** VAT counts a sale by `sales.issued_at`; cash counts a tender by `tenders.settled_at`.
- **Business day = venue-local, DST-aware, cutover-shifted:** `(ts AT TIME ZONE ${timeZone} - ${dayCutover}::interval)::date = ${businessDay}::date`. `timeZone` is an explicit IANA name — never UTC, never a numeric offset.
- **VAT cuota is derived at the per-invoice grain** — `Σ_sales cuotaOf(base_of_that_sale_at_that_rate, rate)`, never `cuotaOf(daily_Σbase, rate)` — so daily totals reconcile to the sum of filed per-invoice cuotas.
- **Exclusions (VAT + `counts.sales`):** voided sales (`sale_voids`) and F3-canje substitutes (`sale_substitutions.substitution_sale_id`). Corrections (`corrects_sale_id` set, negative lines) are **included** and net per rate.
- **Coverage thresholds: statements 98 / lines 98 / functions 98 / branches 95.** Every branch (incl. empty-day) must be exercised.
- **English-only, regime-neutral package** (like `@waitron/core`/`@waitron/db`) — no Spanish tokens in `src/`.
- **Tests use `usePgliteDb({ migrations: [CORE_MIGRATIONS] })` and run reads inside `withTenant` + `asAppUser`** so RLS is exercised as the app role. No manual DB teardown (the helper owns it).

**Two refinements of the spec, both recorded here (a plan may refine a spec):**

1. **Input validation throws a plain `Error`, not a registered `AppError`/error-code.** The spec §2 said "a new `reporting.*` code". That is wrong twice over: `reporting.*` is the *package* name, which the error-code convention forbids (codes name the domain concept, never the throwing package — `CLAUDE.md` §3), and a malformed timezone/cutover is a **caller precondition**, not a domain condition a till surfaces to staff — the same class `recordSubstitution` rejects with a plain `Error` (see `packages/core/src/errors.ts`'s note on duplicate-id rejection). So reporting registers **no** error codes, has **no** `errors.ts`, and needs **no** `errors.reachability.test.ts`. If timezone/cutover later become user-set Locations config, a registered `close.*` code can be added then.
2. **`percentOf` is not lifted; reporting uses a local one-line `cuotaOf`.** The spec D6 offered "depend on `@waitron/core`" or "lift `percentOf` into `@waitron/shared`". A third, better option for a self-contained slice: reporting composes the same shared primitives locally — `divideDecimal(multiplyDecimal(base, rate), "100", MONEY_SCALE)`, *identical* to `@waitron/core`'s `percentOf` (`packages/core/src/vat.ts:12-14`). The half-away-from-zero rounding lives in shared's `divideDecimal`, so there is no rounding-divergence hazard, and reporting stays off the write layer with zero cross-package churn (which also means zero collision risk with the parallel till track).

---

## File Structure

All paths under `packages/reporting/` unless noted.

| File | Responsibility |
| --- | --- |
| `package.json` | `@waitron/reporting` manifest; deps `@waitron/db`, `@waitron/shared`, `drizzle-orm` |
| `tsconfig.json` | extends `../../tsconfig.base.json`; `include: ["src","test"]` |
| `vitest.config.ts` | PGlite timeouts; coverage thresholds 98/98/98/95; exclude `src/index.ts` |
| `src/types.ts` | Public interfaces: `DailyCloseInput`, `DailyClose`, `VatSummary`, `VatRateLine`, `CashUp`, `TillCashUp`, `TenderMethodLine`, `CloseCounts` (types only, no runtime) |
| `src/business-day.ts` | Input validation (`validateTimeZone`, `validateCutover`, `validateBusinessDay`) + the shared `businessDayClause` SQL fragment |
| `src/vat-summary.ts` | `computeVatSummary(tx, input)` → `VatSummary`; the local `cuotaOf` helper |
| `src/cash-up.ts` | `computeCashUp(tx, input)` → `CashUp` |
| `src/counts.ts` | `computeCloseCounts(tx, input)` → `CloseCounts` |
| `src/daily-close.ts` | `computeDailyClose(tx, input)` → `DailyClose` (validates, then orchestrates the three) |
| `src/index.ts` | Barrel: re-exports `computeDailyClose` + all types |
| `test/fixtures.ts` | Seed helpers: `seedVenue`, `seedTill`, `seedSale` (sale + lines), `seedTender`, `seedVoid`, `seedSubstitution` |
| `src/*.test.ts` | One suite per computation module + a `daily-close.test.ts` integration/RLS suite |
| `apps/server/scripts/daily-close-demo.ts` | Runnable human-checkable artifact (Task 7) |

**Consumed signatures (from the codebase, verified):**
- `@waitron/db`: `Transaction`, `Database`, `withTenant`, `asAppUser`, `CORE_MIGRATIONS`, and table objects `sales`, `saleLines`, `tenders`, `saleVoids`, `saleSubstitutions`. `usePgliteDb` from `@waitron/db/testing/lifecycle.js`.
- `@waitron/shared`: types `Decimal`, `TenantId`, `NodeId`, `TillId`, `SaleId`; brand fns `tenantId`, `nodeId`, `tillId`, `saleId`; money `decimal`, `addDecimal`, `sumDecimals`, `multiplyDecimal`, `divideDecimal`, `compareDecimal`, `MONEY_SCALE`.
- Schema columns (from `packages/db/src/schema/sales.ts`): `sales(id, tenant_id, till_id, node_id, invoice_number, issued_at, total, corrects_sale_id)`, `sale_lines(sale_id, tenant_id, vat_rate numeric(5,2), line_total numeric(12,2))`, `tenders(sale_id, tenant_id, method, amount, tip_amount, settled_at)`, `sale_voids(sale_id, tenant_id, voided_at)`, `sale_substitutions(tenant_id, substitution_sale_id, substituted_sale_id)`.

---

### Task 1: Package scaffolding + input validation

**Files:**
- Create: `packages/reporting/package.json`, `packages/reporting/tsconfig.json`, `packages/reporting/vitest.config.ts`
- Create: `packages/reporting/src/types.ts`
- Create: `packages/reporting/src/business-day.ts`
- Create: `packages/reporting/src/index.ts`
- Test: `packages/reporting/src/business-day.test.ts`

**Interfaces:**
- Produces: `DailyCloseInput` (consumed by every later task); `validateTimeZone(tz: string): void`, `validateCutover(cutover: string): void`, `validateBusinessDay(day: string): void`, and `businessDayClause(column: SQL, input: DailyCloseInput): SQL` (a drizzle `sql` fragment reused by Tasks 3–5).

- [ ] **Step 1: Create the manifest, tsconfig, and vitest config**

`packages/reporting/package.json`:
```json
{
  "name": "@waitron/reporting",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit",
    "lint": "eslint ."
  },
  "dependencies": {
    "@waitron/db": "workspace:*",
    "@waitron/shared": "workspace:*",
    "drizzle-orm": "^0.45.2"
  },
  "devDependencies": {
    "@electric-sql/pglite": "^0.5.4",
    "@types/node": "^24.0.0",
    "@vitest/coverage-v8": "^3.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`packages/reporting/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "types": ["vitest/globals"]
  },
  "include": ["src", "test"]
}
```

`packages/reporting/vitest.config.ts` (copy of `packages/core/vitest.config.ts`):
```ts
import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      exclude: [...coverageConfigDefaults.exclude, "src/index.ts"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
```

- [ ] **Step 2: Define the public types**

`packages/reporting/src/types.ts`:
```ts
import type { Decimal, NodeId, TenantId, TillId } from "@waitron/shared";

/** A tender method, mirroring `tender_method` in packages/db/src/schema/sales.ts. */
export type TenderMethod = "cash" | "card" | "voucher" | "transfer" | "other";

export interface DailyCloseInput {
  tenantId: TenantId;
  nodeId: NodeId;
  /** Local calendar date of the business day, "YYYY-MM-DD". */
  businessDay: string;
  /** IANA timezone, e.g. "Europe/Madrid". Required; never defaulted to UTC. */
  timeZone: string;
  /** "HH:MM" time-of-day in `timeZone` at which the business day starts, e.g. "05:00". */
  dayCutover: string;
}

export interface VatRateLine {
  /** Percentage literal as stored, e.g. "21.00". */
  rate: Decimal;
  /** Net taxable base at this rate (corrections netted). */
  base: Decimal;
  /** Net tax at this rate. */
  cuota: Decimal;
}
export interface VatSummary {
  byRate: VatRateLine[];
  baseTotal: Decimal;
  cuotaTotal: Decimal;
  grossTotal: Decimal;
}

export interface TenderMethodLine {
  method: TenderMethod;
  /** Total collected via this method (includes its tip portion). */
  amount: Decimal;
  /** Tip portion collected via this method. */
  tip: Decimal;
}
export interface TillCashUp {
  tillId: TillId;
  byMethod: TenderMethodLine[];
  /** Σ cash-method amount at this till (cash revenue + cash tips). */
  cashTakings: Decimal;
}
export interface CashUp {
  byTill: TillCashUp[];
  tenderTotal: Decimal;
  tipTotal: Decimal;
}

export interface CloseCounts {
  /** Ordinary altas issued in the business day (corrects_sale_id NULL), excl. voided + F3 substitutes. */
  sales: number;
  /** Rectificativas issued in the business day (corrects_sale_id set), excl. voided. */
  corrections: number;
  /** Void events (`sale_voids`) whose voided_at falls in the business day, for this node. */
  voids: number;
}

export interface DailyClose {
  tenantId: TenantId;
  nodeId: NodeId;
  businessDay: string;
  timeZone: string;
  vat: VatSummary;
  cash: CashUp;
  counts: CloseCounts;
}
```

- [ ] **Step 3: Write the failing test for input validation**

`packages/reporting/src/business-day.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { validateBusinessDay, validateCutover, validateTimeZone } from "./business-day.js";

describe("validateTimeZone", () => {
  it("accepts a valid IANA zone", () => {
    expect(() => validateTimeZone("Europe/Madrid")).not.toThrow();
  });
  it("rejects a non-existent zone", () => {
    expect(() => validateTimeZone("Mars/Olympus")).toThrow(/time zone/i);
  });
  it("rejects UTC-offset shorthand (must be a named zone)", () => {
    expect(() => validateTimeZone("+02:00")).toThrow(/time zone/i);
  });
});

describe("validateCutover", () => {
  it("accepts a zero-padded HH:MM", () => {
    expect(() => validateCutover("05:00")).not.toThrow();
    expect(() => validateCutover("00:00")).not.toThrow();
    expect(() => validateCutover("23:59")).not.toThrow();
  });
  it.each(["5:00", "24:00", "23:60", "05:0", "0500", "05:00:00"])("rejects %s", (bad) => {
    expect(() => validateCutover(bad)).toThrow(/cutover/i);
  });
});

describe("validateBusinessDay", () => {
  it("accepts YYYY-MM-DD", () => {
    expect(() => validateBusinessDay("2026-08-04")).not.toThrow();
  });
  it.each(["2026-8-4", "04-08-2026", "2026/08/04", "garbage"])("rejects %s", (bad) => {
    expect(() => validateBusinessDay(bad)).toThrow(/business day/i);
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `pnpm --filter @waitron/reporting test business-day`
Expected: FAIL — `business-day.js` / the validators are not defined.

- [ ] **Step 5: Implement `business-day.ts`**

`packages/reporting/src/business-day.ts`:
```ts
import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { DailyCloseInput } from "./types.js";

const CUTOVER_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Throws a plain Error (a caller precondition — see the plan's spec-refinement note) if `tz` is not a
 * resolvable IANA zone. `Intl.DateTimeFormat` throws a RangeError for an unknown or non-IANA value
 * (including UTC-offset shorthand like "+02:00"), which is exactly the set we must reject.
 */
export function validateTimeZone(tz: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    throw new Error(`reporting: invalid IANA time zone: ${JSON.stringify(tz)}`);
  }
}

export function validateCutover(cutover: string): void {
  if (!CUTOVER_RE.test(cutover)) {
    throw new Error(`reporting: invalid cutover, expected "HH:MM": ${JSON.stringify(cutover)}`);
  }
}

export function validateBusinessDay(day: string): void {
  if (!DATE_RE.test(day)) {
    throw new Error(`reporting: invalid business day, expected "YYYY-MM-DD": ${JSON.stringify(day)}`);
  }
}

/**
 * The DST-aware business-day predicate, reused by every aggregate. `column` is a `timestamptz`
 * (`sales.issued_at` or `tenders.settled_at`); a row belongs to `businessDay` when its venue-local
 * wall-clock, shifted back by the cutover, lands on that date. Never UTC — `AT TIME ZONE` with an
 * IANA name is DST-correct; a fixed offset would not be.
 */
export function businessDayClause(column: SQL, input: DailyCloseInput): SQL {
  return sql`(${column} at time zone ${input.timeZone} - ${input.dayCutover}::interval)::date = ${input.businessDay}::date`;
}
```

- [ ] **Step 6: Create the barrel**

`packages/reporting/src/index.ts` (start it now; later tasks add exports):
```ts
export type {
  CashUp,
  CloseCounts,
  DailyClose,
  DailyCloseInput,
  TenderMethod,
  TenderMethodLine,
  TillCashUp,
  VatRateLine,
  VatSummary,
} from "./types.js";
```

- [ ] **Step 7: Run tests and typecheck**

Run: `pnpm --filter @waitron/reporting test business-day && pnpm --filter @waitron/reporting typecheck`
Expected: PASS. Also run `pnpm install` at the repo root so pnpm links the new workspace package (its `workspace:*` deps).

- [ ] **Step 8: Commit**

```bash
git add packages/reporting pnpm-lock.yaml
git commit -s -m "feat(reporting): scaffold @waitron/reporting + business-day input validation"
```

---

### Task 2: Test fixtures

**Files:**
- Create: `packages/reporting/test/fixtures.ts`
- Test: `packages/reporting/test/fixtures.test.ts`

**Interfaces:**
- Consumes: `@waitron/db` tables + `Database`; `@waitron/shared` brands.
- Produces (used by Tasks 3–6):
  - `seedVenue(db): Promise<SeededVenue>` where `SeededVenue = { tenantId, locationId, tillId, nodeId, seriesId }`
  - `seedTill(db, tenantId, locationId): Promise<TillId>`
  - `seedSale(db, seed, opts): Promise<SaleId>` — `seed: { tenantId, tillId, nodeId, seriesId }`, `opts: { invoiceNumber: number; issuedAt: string; total: string; lines: Array<{ vatRate: string; lineTotal: string }>; correctsSaleId?: SaleId }`
  - `seedTender(db, ref, opts): Promise<void>` — `ref: { tenantId, saleId }`, `opts: { method: TenderMethod; amount: string; tipAmount?: string; settledAt: string }`
  - `seedVoid(db, ref, voidedAt): Promise<void>`
  - `seedSubstitution(db, ref): Promise<void>` — `ref: { tenantId, substitutionSaleId, substitutedSaleId }`

- [ ] **Step 1: Write the fixtures**

`packages/reporting/test/fixtures.ts` — modelled on `packages/core/test/fixtures.ts` (raw SQL as the PGlite superuser, which bypasses RLS, so no `withTenant` needed for setup):
```ts
import { sql } from "drizzle-orm";
import {
  nodeId as brandNodeId,
  saleId as brandSaleId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { NodeId, SaleId, SeriesId, TenantId, TillId } from "@waitron/shared";
import { saleLines, saleSubstitutions, saleVoids, sales, tenders } from "@waitron/db";
import type { Database } from "@waitron/db";
import type { TenderMethod } from "../src/types.js";

export interface SeededVenue {
  tenantId: TenantId;
  locationId: string;
  tillId: TillId;
  nodeId: NodeId;
  seriesId: SeriesId;
}

// Off every other generator's base (see packages/db/src/testing/seed.ts's note) to avoid a
// tenants_nif_key collision if a suite ever seeds through two generators.
let nifCounter = 0;
function freshNif(): string {
  nifCounter += 1;
  return `${String(50_000_000 + nifCounter).padStart(8, "0")}K`;
}

export async function seedVenue(db: Database): Promise<SeededVenue> {
  const t = await db.execute<{ id: string }>(
    sql`insert into tenants (nif, legal_name) values (${freshNif()}, 'Test SL') returning id`,
  );
  const tenantId = brandTenantId(t.rows[0]!.id);
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Main', array['es-ES'], 'Test op') returning id`);
  const locationId = loc.rows[0]!.id;
  const till = await db.execute<{ id: string }>(
    sql`insert into tills (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'Till 1') returning id`,
  );
  const tillId = brandTillId(till.rows[0]!.id);
  const node = await db.execute<{ id: string }>(
    sql`insert into nodes (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'Node 1') returning id`,
  );
  const nodeId = brandNodeId(node.rows[0]!.id);
  const series = await db.execute<{ id: string }>(
    sql`insert into invoice_series (tenant_id, node_id, code) values (${tenantId}, ${nodeId}, 'A') returning id`,
  );
  const seriesId = brandSeriesId(series.rows[0]!.id);
  return { tenantId, locationId, tillId, nodeId, seriesId };
}

export async function seedTill(db: Database, tenantId: TenantId, locationId: string): Promise<TillId> {
  const till = await db.execute<{ id: string }>(
    sql`insert into tills (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'Till 2') returning id`,
  );
  return brandTillId(till.rows[0]!.id);
}

export async function seedSale(
  db: Database,
  seed: { tenantId: TenantId; tillId: TillId; nodeId: NodeId; seriesId: SeriesId },
  opts: {
    invoiceNumber: number;
    issuedAt: string;
    total: string;
    lines: Array<{ vatRate: string; lineTotal: string }>;
    correctsSaleId?: SaleId;
  },
): Promise<SaleId> {
  const [row] = await db
    .insert(sales)
    .values({
      tenantId: seed.tenantId,
      tillId: seed.tillId,
      nodeId: seed.nodeId,
      seriesId: seed.seriesId,
      invoiceNumber: opts.invoiceNumber,
      issuedAt: opts.issuedAt,
      issuedOffsetMinutes: 0,
      total: opts.total,
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      fiscalBackend: "fake",
      fiscalState: "recorded",
      correctsSaleId: opts.correctsSaleId,
    })
    .returning({ id: sales.id });
  const saleId = brandSaleId(row!.id);
  await db.insert(saleLines).values(
    opts.lines.map((line, i) => ({
      tenantId: seed.tenantId,
      saleId,
      lineNo: i + 1,
      descriptions: { "es-ES": "Item" },
      quantity: "1.000",
      unitPrice: line.lineTotal,
      vatRate: line.vatRate,
      lineTotal: line.lineTotal,
    })),
  );
  return saleId;
}

export async function seedTender(
  db: Database,
  ref: { tenantId: TenantId; saleId: SaleId },
  opts: { method: TenderMethod; amount: string; tipAmount?: string; settledAt: string },
): Promise<void> {
  await db.insert(tenders).values({
    tenantId: ref.tenantId,
    saleId: ref.saleId,
    method: opts.method,
    amount: opts.amount,
    tipAmount: opts.tipAmount ?? "0.00",
    settledAt: opts.settledAt,
  });
}

export async function seedVoid(
  db: Database,
  ref: { tenantId: TenantId; saleId: SaleId },
  voidedAt: string,
): Promise<void> {
  await db.insert(saleVoids).values({
    tenantId: ref.tenantId,
    saleId: ref.saleId,
    reason: "test void",
    voidedAt,
  });
}

export async function seedSubstitution(
  db: Database,
  ref: { tenantId: TenantId; substitutionSaleId: SaleId; substitutedSaleId: SaleId },
): Promise<void> {
  await db.insert(saleSubstitutions).values({
    tenantId: ref.tenantId,
    substitutionSaleId: ref.substitutionSaleId,
    substitutedSaleId: ref.substitutedSaleId,
  });
}
```

- [ ] **Step 2: Write a smoke test proving the fixtures insert what's expected**

`packages/reporting/test/fixtures.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedSale, seedVenue } from "./fixtures.js";

const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });

describe("fixtures", () => {
  it("seedVenue + seedSale insert a sale with its lines", async () => {
    const venue = await seedVenue(suite.db);
    const saleId = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: new Date("2026-08-04T10:00:00Z").toISOString(),
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
    });
    const { rows } = await suite.db.execute<{ n: number }>(
      sql`select count(*)::int as n from sale_lines where sale_id = ${saleId}`,
    );
    expect(rows[0]!.n).toBe(1);
  });
});
```

- [ ] **Step 3: Run and verify** — `pnpm --filter @waitron/reporting test fixtures` → PASS.

- [ ] **Step 4: Commit**
```bash
git add packages/reporting/test
git commit -s -m "test(reporting): seed fixtures for daily-close suites"
```

---

### Task 3: VAT summary

**Files:**
- Create: `packages/reporting/src/vat-summary.ts`
- Test: `packages/reporting/src/vat-summary.test.ts`

**Interfaces:**
- Consumes: `businessDayClause` (Task 1), `DailyCloseInput`/`VatSummary` (Task 1), fixtures (Task 2).
- Produces: `computeVatSummary(tx: Transaction, input: DailyCloseInput): Promise<VatSummary>`.

- [ ] **Step 1: Write the failing tests**

`packages/reporting/src/vat-summary.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import type { NodeId, SaleId, SeriesId, TenantId, TillId } from "@waitron/shared";
import { seedSale, seedSubstitution, seedVenue, seedVoid } from "../test/fixtures.js";
import type { SeededVenue } from "../test/fixtures.js";
import { computeVatSummary } from "./vat-summary.js";
import type { DailyCloseInput } from "./types.js";

const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });

let venue: SeededVenue;
const DAY = "2026-08-04";
const TZ = "Europe/Madrid";

// Two instants that both fall on 2026-08-04 local (Madrid is UTC+2 in August). 10:00Z = 12:00 local.
const noonUtc = new Date("2026-08-04T10:00:00Z").toISOString();

beforeEach(async () => {
  venue = await seedVenue(suite.db);
});

function run(overrides: Partial<DailyCloseInput> = {}): Promise<import("./types.js").VatSummary> {
  const input: DailyCloseInput = {
    tenantId: venue.tenantId,
    nodeId: venue.nodeId,
    businessDay: DAY,
    timeZone: TZ,
    dayCutover: "05:00",
    ...overrides,
  };
  return withTenant(suite.db, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    return computeVatSummary(tx, input);
  });
}

describe("computeVatSummary", () => {
  it("sums one rate", async () => {
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
    });
    const vat = await run();
    expect(vat.byRate).toEqual([{ rate: "21.00", base: "100.00", cuota: "21.00" }]);
    expect(vat).toMatchObject({ baseTotal: "100.00", cuotaTotal: "21.00", grossTotal: "121.00" });
  });

  it("groups multiple rates, one line each", async () => {
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "231.00",
      lines: [
        { vatRate: "21.00", lineTotal: "100.00" },
        { vatRate: "10.00", lineTotal: "100.00" },
      ],
    });
    const vat = await run();
    expect(vat.byRate).toEqual([
      { rate: "10.00", base: "100.00", cuota: "10.00" },
      { rate: "21.00", base: "100.00", cuota: "21.00" },
    ]);
    expect(vat).toMatchObject({ baseTotal: "200.00", cuotaTotal: "31.00", grossTotal: "231.00" });
  });

  it("nets a rectificativa's negative lines into the rate", async () => {
    const original = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
    });
    await seedSale(suite.db, venue, {
      invoiceNumber: 2,
      issuedAt: noonUtc,
      total: "-6.05",
      correctsSaleId: original,
      lines: [{ vatRate: "21.00", lineTotal: "-5.00" }],
    });
    const vat = await run();
    expect(vat.byRate).toEqual([{ rate: "21.00", base: "95.00", cuota: "19.95" }]);
  });

  it("excludes a voided sale", async () => {
    const s = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
    });
    await seedVoid(suite.db, { tenantId: venue.tenantId, saleId: s }, noonUtc);
    expect((await run()).byRate).toEqual([]);
  });

  it("excludes an F3-canje substitute but keeps the substituted ticket", async () => {
    const ticket = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
    });
    const f3 = await seedSale(suite.db, venue, {
      invoiceNumber: 2,
      issuedAt: noonUtc,
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
    });
    await seedSubstitution(suite.db, {
      tenantId: venue.tenantId,
      substitutionSaleId: f3,
      substitutedSaleId: ticket,
    });
    // Only the ticket's 100.00 base, not doubled by the F3.
    expect((await run()).byRate).toEqual([{ rate: "21.00", base: "100.00", cuota: "21.00" }]);
  });

  it("rounds cuota per invoice, not on the summed base", async () => {
    // Two sales, base 0.05 each at 21%: per-invoice 0.0105 → 0.01 each → 0.02 total. On the summed
    // base (0.10 → 0.021 → 0.02) it happens to agree; use 2.38 where it does NOT: per invoice
    // 2.38*21% = 0.4998 → 0.50 each → 1.00; summed 4.76*21% = 0.9996 → 1.00. Choose 2.62: per
    // invoice 0.5502 → 0.55 each → 1.10; summed 5.24 → 1.1004 → 1.10 (agrees). The divergent case:
    // base 0.024-style needs 3dp; with 2dp bases the max per-line divergence is bounded, so assert
    // the per-invoice contract directly with a base that rounds up: 0.05 at 21% = 0.0105 → 0.01.
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "0.06",
      lines: [{ vatRate: "21.00", lineTotal: "0.05" }],
    });
    const vat = await run();
    expect(vat.byRate).toEqual([{ rate: "21.00", base: "0.05", cuota: "0.01" }]);
  });

  it("buckets by issuance and the cutover: 01:30 local belongs to the prior business day", async () => {
    // 2026-08-04 01:30 Madrid = 2026-08-03T23:30Z. With a 05:00 cutover it is business day 08-03.
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: new Date("2026-08-03T23:30:00Z").toISOString(),
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
    });
    expect((await run({ businessDay: "2026-08-04" })).byRate).toEqual([]);
    expect((await run({ businessDay: "2026-08-03" })).byRate).toEqual([
      { rate: "21.00", base: "100.00", cuota: "21.00" },
    ]);
  });

  it("returns zeros for an empty day", async () => {
    expect(await run()).toEqual({ byRate: [], baseTotal: "0.00", cuotaTotal: "0.00", grossTotal: "0.00" });
  });

  it("excludes another node's sales", async () => {
    const other = await seedVenue(suite.db); // different tenant+node
    await seedSale(suite.db, other, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
    });
    expect((await run()).byRate).toEqual([]); // our node has nothing
  });
});
```

- [ ] **Step 2: Run and watch fail** — `pnpm --filter @waitron/reporting test vat-summary` → FAIL (`computeVatSummary` undefined).

- [ ] **Step 3: Implement `vat-summary.ts`**

```ts
import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { MONEY_SCALE, addDecimal, compareDecimal, decimal, divideDecimal, multiplyDecimal } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import { businessDayClause } from "./business-day.js";
import type { DailyCloseInput, VatSummary } from "./types.js";

/**
 * `ratePercent`% of `base`, exact, half away from zero at money scale. Identical composition to
 * `@waitron/core`'s `percentOf` (packages/core/src/vat.ts) — kept local so reporting depends only on
 * db + shared, not the write layer. The rounding is shared's `divideDecimal`, so this cannot diverge
 * from what `buildVatBreakdown` filed per invoice.
 */
function cuotaOf(base: Decimal, ratePercent: Decimal): Decimal {
  return divideDecimal(multiplyDecimal(base, ratePercent), "100" as Decimal, MONEY_SCALE);
}

/**
 * VAT summary for one (tenant, node) over one business day, anchored on issuance. Reads `sale_lines`
 * joined to `sales`; groups by (sale, rate) so cuota is rounded PER INVOICE and then summed (design
 * §4). Corrections (negative lines) net in for free; voided sales and F3-canje substitutes are
 * excluded. The explicit tenant/node predicates are belt-and-suspenders over RLS (mirrors
 * listOutstandingSales).
 */
export async function computeVatSummary(tx: Transaction, input: DailyCloseInput): Promise<VatSummary> {
  const { rows } = await tx.execute<{ rate: string; base: string }>(sql`
    select
      sl.vat_rate::text as rate,
      sum(sl.line_total)::numeric(12, 2)::text as base
    from sales s
    join sale_lines sl on sl.sale_id = s.id and sl.tenant_id = ${input.tenantId}
    where s.tenant_id = ${input.tenantId}
      and s.node_id = ${input.nodeId}
      and ${businessDayClause(sql`s.issued_at`, input)}
      and not exists (select 1 from sale_voids sv where sv.sale_id = s.id and sv.tenant_id = ${input.tenantId})
      and not exists (select 1 from sale_substitutions sub where sub.substitution_sale_id = s.id and sub.tenant_id = ${input.tenantId})
    group by s.id, sl.vat_rate
  `);

  // Per (sale, rate) rows → cuota per row (per-invoice rounding) → accumulate by rate.
  const byRate = new Map<string, { rate: Decimal; base: Decimal; cuota: Decimal }>();
  let baseTotal = decimal("0.00");
  let cuotaTotal = decimal("0.00");
  for (const r of rows) {
    const rate = decimal(r.rate);
    const base = decimal(r.base);
    const cuota = cuotaOf(base, rate);
    const acc = byRate.get(r.rate);
    if (acc === undefined) {
      byRate.set(r.rate, { rate, base, cuota });
    } else {
      acc.base = addDecimal(acc.base, base);
      acc.cuota = addDecimal(acc.cuota, cuota);
    }
    baseTotal = addDecimal(baseTotal, base);
    cuotaTotal = addDecimal(cuotaTotal, cuota);
  }

  const lines = [...byRate.values()].sort((a, b) => compareDecimal(a.rate, b.rate));
  return {
    byRate: lines.map((l) => ({ rate: l.rate, base: l.base, cuota: l.cuota })),
    baseTotal,
    cuotaTotal,
    grossTotal: addDecimal(baseTotal, cuotaTotal),
  };
}
```

- [ ] **Step 4: Run and verify PASS** — `pnpm --filter @waitron/reporting test vat-summary`.

- [ ] **Step 5: Prove the exclusions by deletion.** Temporarily delete the `sale_voids` `not exists` line; run the "excludes a voided sale" test and confirm it now FAILS (the voided base appears). Restore. Repeat for the `sale_substitutions` line against the F3 test. (Do not commit the deletions — this step only confirms the guards are load-bearing.)

- [ ] **Step 6: Commit**
```bash
git add packages/reporting/src/vat-summary.ts packages/reporting/src/vat-summary.test.ts
git commit -s -m "feat(reporting): VAT summary half (issuance-anchored, per-invoice cuota, corrections netted)"
```

---

### Task 4: Cash-up

**Files:**
- Create: `packages/reporting/src/cash-up.ts`
- Test: `packages/reporting/src/cash-up.test.ts`

**Interfaces:**
- Produces: `computeCashUp(tx: Transaction, input: DailyCloseInput): Promise<CashUp>`.

- [ ] **Step 1: Write the failing tests**

`packages/reporting/src/cash-up.test.ts` (same harness/`run` shape as Task 3, calling `computeCashUp`):
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedSale, seedTender, seedTill, seedVenue } from "../test/fixtures.js";
import type { SeededVenue } from "../test/fixtures.js";
import { computeCashUp } from "./cash-up.js";
import type { CashUp, DailyCloseInput } from "./types.js";

const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
let venue: SeededVenue;
const DAY = "2026-08-04";
const settledNoon = new Date("2026-08-04T10:00:00Z").toISOString();

beforeEach(async () => {
  venue = await seedVenue(suite.db);
});
function run(overrides: Partial<DailyCloseInput> = {}): Promise<CashUp> {
  const input: DailyCloseInput = {
    tenantId: venue.tenantId, nodeId: venue.nodeId, businessDay: DAY,
    timeZone: "Europe/Madrid", dayCutover: "05:00", ...overrides,
  };
  return withTenant(suite.db, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    return computeCashUp(tx, input);
  });
}
// Helper: a settled sale with tenders. Returns nothing; each test seeds its own.
async function saleWithTenders(
  inv: number,
  tenders: Array<{ method: DailyCloseInput extends never ? never : "cash" | "card" | "voucher" | "transfer" | "other"; amount: string; tipAmount?: string; settledAt: string }>,
): Promise<void> {
  const saleId = await seedSale(suite.db, venue, {
    invoiceNumber: inv, issuedAt: settledNoon, total: "100.00",
    lines: [{ vatRate: "21.00", lineTotal: "82.64" }],
  });
  for (const t of tenders) await seedTender(suite.db, { tenantId: venue.tenantId, saleId }, t);
}

describe("computeCashUp", () => {
  it("cashTakings counts only cash-method amounts, incl. cash tips", async () => {
    await saleWithTenders(1, [
      { method: "cash", amount: "50.00", tipAmount: "5.00", settledAt: settledNoon },
      { method: "card", amount: "70.00", tipAmount: "0.00", settledAt: settledNoon },
    ]);
    const cash = await run();
    expect(cash.byTill).toHaveLength(1);
    expect(cash.byTill[0]!.cashTakings).toBe("50.00");
    expect(cash.byTill[0]!.byMethod).toEqual([
      { method: "card", amount: "70.00", tip: "0.00" },
      { method: "cash", amount: "50.00", tip: "5.00" },
    ]);
    expect(cash).toMatchObject({ tenderTotal: "120.00", tipTotal: "5.00" });
  });

  it("breaks down by till", async () => {
    const till2 = await seedTill(suite.db, venue.tenantId, venue.locationId);
    await saleWithTenders(1, [{ method: "cash", amount: "30.00", settledAt: settledNoon }]);
    const s2 = await seedSale(
      suite.db,
      { ...venue, tillId: till2 },
      { invoiceNumber: 2, issuedAt: settledNoon, total: "40.00", lines: [{ vatRate: "10.00", lineTotal: "36.36" }] },
    );
    await seedTender(suite.db, { tenantId: venue.tenantId, saleId: s2 }, { method: "card", amount: "40.00", settledAt: settledNoon });
    const cash = await run();
    expect(cash.byTill.map((t) => t.tillId).sort()).toEqual([venue.tillId, till2].sort());
    expect(cash).toMatchObject({ tenderTotal: "70.00", tipTotal: "0.00" });
  });

  it("buckets by settlement day + cutover: a 01:30-local tender belongs to the prior day", async () => {
    await saleWithTenders(1, [
      { method: "cash", amount: "10.00", settledAt: new Date("2026-08-03T23:30:00Z").toISOString() },
    ]);
    expect((await run({ businessDay: "2026-08-04" })).byTill).toEqual([]);
    expect((await run({ businessDay: "2026-08-03" })).byTill).toHaveLength(1);
  });

  it("returns zeros for an empty day", async () => {
    expect(await run()).toEqual({ byTill: [], tenderTotal: "0.00", tipTotal: "0.00" });
  });

  it("excludes another node's tenders", async () => {
    const other = await seedVenue(suite.db);
    const s = await seedSale(suite.db, other, {
      invoiceNumber: 1, issuedAt: settledNoon, total: "10.00", lines: [{ vatRate: "21.00", lineTotal: "8.26" }],
    });
    await seedTender(suite.db, { tenantId: other.tenantId, saleId: s }, { method: "cash", amount: "10.00", settledAt: settledNoon });
    expect((await run()).byTill).toEqual([]);
  });
});
```

*(Note for the implementer: simplify the `saleWithTenders` `method` type to `TenderMethod` imported from `../src/types.js`; the inline conditional above is shorthand.)*

- [ ] **Step 2: Run and watch fail.**

- [ ] **Step 3: Implement `cash-up.ts`**

```ts
import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { addDecimal, decimal, tillId as brandTillId } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import { businessDayClause } from "./business-day.js";
import type { CashUp, DailyCloseInput, TenderMethod, TenderMethodLine, TillCashUp } from "./types.js";

/**
 * Operational cash-up for one (tenant, node) over one business day, anchored on settlement. Reads
 * `tenders` joined to `sales` (for node scoping and till_id); groups by (till, method). `cashTakings`
 * per till is Σ cash-method amount (design §5). Post-settlement refunds are out of scope (tenders are
 * always positive). Belt-and-suspenders tenant/node predicates over RLS.
 */
export async function computeCashUp(tx: Transaction, input: DailyCloseInput): Promise<CashUp> {
  const { rows } = await tx.execute<{ till_id: string; method: TenderMethod; amount: string; tip: string }>(sql`
    select
      s.till_id::text as till_id,
      t.method as method,
      sum(t.amount)::numeric(12, 2)::text as amount,
      sum(t.tip_amount)::numeric(12, 2)::text as tip
    from tenders t
    join sales s on s.id = t.sale_id and s.tenant_id = ${input.tenantId}
    where t.tenant_id = ${input.tenantId}
      and s.node_id = ${input.nodeId}
      and ${businessDayClause(sql`t.settled_at`, input)}
    group by s.till_id, t.method
    order by s.till_id, t.method
  `);

  const tills = new Map<string, TenderMethodLine[]>();
  let tenderTotal = decimal("0.00");
  let tipTotal = decimal("0.00");
  for (const r of rows) {
    const line: TenderMethodLine = { method: r.method, amount: decimal(r.amount), tip: decimal(r.tip) };
    const existing = tills.get(r.till_id);
    if (existing === undefined) tills.set(r.till_id, [line]);
    else existing.push(line);
    tenderTotal = addDecimal(tenderTotal, line.amount);
    tipTotal = addDecimal(tipTotal, line.tip);
  }

  const byTill: TillCashUp[] = [...tills.entries()].map(([tid, byMethod]) => {
    let cashTakings: Decimal = decimal("0.00");
    for (const m of byMethod) if (m.method === "cash") cashTakings = addDecimal(cashTakings, m.amount);
    return { tillId: brandTillId(tid), byMethod, cashTakings };
  });

  return { byTill, tenderTotal, tipTotal };
}
```

- [ ] **Step 4: Run and verify PASS.**

- [ ] **Step 5: Prove the cash-only filter by deletion** — change `if (m.method === "cash")` to include all methods; confirm the "cashTakings counts only cash" test fails; restore.

- [ ] **Step 6: Commit**
```bash
git add packages/reporting/src/cash-up.ts packages/reporting/src/cash-up.test.ts
git commit -s -m "feat(reporting): operational cash-up half (settlement-anchored, per-till, cash takings)"
```

---

### Task 5: Counts

**Files:**
- Create: `packages/reporting/src/counts.ts`
- Test: `packages/reporting/src/counts.test.ts`

**Interfaces:**
- Produces: `computeCloseCounts(tx: Transaction, input: DailyCloseInput): Promise<CloseCounts>`.

- [ ] **Step 1: Write the failing tests** (`packages/reporting/src/counts.test.ts`, same harness shape):
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedSale, seedSubstitution, seedVenue, seedVoid } from "../test/fixtures.js";
import type { SeededVenue } from "../test/fixtures.js";
import { computeCloseCounts } from "./counts.js";
import type { CloseCounts, DailyCloseInput } from "./types.js";

const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
let venue: SeededVenue;
const noon = new Date("2026-08-04T10:00:00Z").toISOString();
beforeEach(async () => { venue = await seedVenue(suite.db); });
function run(): Promise<CloseCounts> {
  const input: DailyCloseInput = {
    tenantId: venue.tenantId, nodeId: venue.nodeId, businessDay: "2026-08-04",
    timeZone: "Europe/Madrid", dayCutover: "05:00",
  };
  return withTenant(suite.db, venue.tenantId, async (tx) => { await asAppUser(tx); return computeCloseCounts(tx, input); });
}
const line = { vatRate: "21.00", lineTotal: "10.00" };

describe("computeCloseCounts", () => {
  it("counts sales, corrections and voids", async () => {
    const s1 = await seedSale(suite.db, venue, { invoiceNumber: 1, issuedAt: noon, total: "12.10", lines: [line] });
    await seedSale(suite.db, venue, { invoiceNumber: 2, issuedAt: noon, total: "12.10", lines: [line] });
    await seedSale(suite.db, venue, { invoiceNumber: 3, issuedAt: noon, total: "-1.21", correctsSaleId: s1, lines: [{ vatRate: "21.00", lineTotal: "-1.00" }] });
    await seedVoid(suite.db, { tenantId: venue.tenantId, saleId: s1 }, noon);
    // s1 is voided → not in sales count; s2 remains; the corrective counts; one void.
    expect(await run()).toEqual({ sales: 1, corrections: 1, voids: 1 });
  });

  it("excludes an F3 substitute from the sales count", async () => {
    const ticket = await seedSale(suite.db, venue, { invoiceNumber: 1, issuedAt: noon, total: "12.10", lines: [line] });
    const f3 = await seedSale(suite.db, venue, { invoiceNumber: 2, issuedAt: noon, total: "12.10", lines: [line] });
    await seedSubstitution(suite.db, { tenantId: venue.tenantId, substitutionSaleId: f3, substitutedSaleId: ticket });
    expect(await run()).toEqual({ sales: 1, corrections: 0, voids: 0 });
  });

  it("returns zeros for an empty day", async () => {
    expect(await run()).toEqual({ sales: 0, corrections: 0, voids: 0 });
  });
});
```

- [ ] **Step 2: Run and watch fail.**

- [ ] **Step 3: Implement `counts.ts`**
```ts
import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { businessDayClause } from "./business-day.js";
import type { CloseCounts, DailyCloseInput } from "./types.js";

/**
 * Operational record counts for one (tenant, node) over one business day. `sales` and `corrections`
 * are issued-in-day (excluding voided; `sales` also excludes F3-canje substitutes — same exclusions
 * as the VAT half). `voids` counts void EVENTS whose voided_at falls in the day, for this node's
 * sales. Belt-and-suspenders tenant/node predicates over RLS.
 */
export async function computeCloseCounts(tx: Transaction, input: DailyCloseInput): Promise<CloseCounts> {
  const issued = await tx.execute<{ sales: number; corrections: number }>(sql`
    select
      count(*) filter (where s.corrects_sale_id is null)::int as sales,
      count(*) filter (where s.corrects_sale_id is not null)::int as corrections
    from sales s
    where s.tenant_id = ${input.tenantId}
      and s.node_id = ${input.nodeId}
      and ${businessDayClause(sql`s.issued_at`, input)}
      and not exists (select 1 from sale_voids sv where sv.sale_id = s.id and sv.tenant_id = ${input.tenantId})
      and not exists (select 1 from sale_substitutions sub where sub.substitution_sale_id = s.id and sub.tenant_id = ${input.tenantId})
  `);

  const voided = await tx.execute<{ voids: number }>(sql`
    select count(*)::int as voids
    from sale_voids sv
    join sales s on s.id = sv.sale_id and s.tenant_id = ${input.tenantId}
    where sv.tenant_id = ${input.tenantId}
      and s.node_id = ${input.nodeId}
      and ${businessDayClause(sql`sv.voided_at`, input)}
  `);

  return {
    sales: issued.rows[0]!.sales,
    corrections: issued.rows[0]!.corrections,
    voids: voided.rows[0]!.voids,
  };
}
```

*(Note: the `sales` count excludes F3 substitutes to match the VAT half. A substitute IS excluded from `sales` and is not a correction, so an F3-canje issuance is deliberately uncounted in this first slice — a documented minor edge, consistent with the VAT exclusion; a dedicated `canje` count is a later refinement.)*

- [ ] **Step 4: Run and verify PASS.**

- [ ] **Step 5: Commit**
```bash
git add packages/reporting/src/counts.ts packages/reporting/src/counts.test.ts
git commit -s -m "feat(reporting): close record counts (sales, corrections, voids)"
```

---

### Task 6: Orchestrator + barrel

**Files:**
- Create: `packages/reporting/src/daily-close.ts`
- Modify: `packages/reporting/src/index.ts` (add `computeDailyClose` export)
- Test: `packages/reporting/src/daily-close.test.ts`

**Interfaces:**
- Consumes: `validateTimeZone`/`validateCutover`/`validateBusinessDay` (Task 1), `computeVatSummary` (Task 3), `computeCashUp` (Task 4), `computeCloseCounts` (Task 5).
- Produces: `computeDailyClose(tx: Transaction, input: DailyCloseInput): Promise<DailyClose>`.

- [ ] **Step 1: Write the failing tests** — the integration behaviours the sub-functions can't show alone:

`packages/reporting/src/daily-close.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedSale, seedTender, seedVenue } from "../test/fixtures.js";
import type { SeededVenue } from "../test/fixtures.js";
import { computeDailyClose } from "./daily-close.js";
import type { DailyCloseInput } from "./types.js";

const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
let venue: SeededVenue;
beforeEach(async () => { venue = await seedVenue(suite.db); });
function input(overrides: Partial<DailyCloseInput> = {}): DailyCloseInput {
  return { tenantId: venue.tenantId, nodeId: venue.nodeId, businessDay: "2026-08-04", timeZone: "Europe/Madrid", dayCutover: "05:00", ...overrides };
}
function run(i: DailyCloseInput) {
  return withTenant(suite.db, venue.tenantId, async (tx) => { await asAppUser(tx); return computeDailyClose(tx, i); });
}

describe("computeDailyClose", () => {
  it("validates inputs before touching the database", async () => {
    await expect(run(input({ timeZone: "Nowhere/Nope" }))).rejects.toThrow(/time zone/i);
    await expect(run(input({ dayCutover: "5:00" }))).rejects.toThrow(/cutover/i);
    await expect(run(input({ businessDay: "04/08/2026" }))).rejects.toThrow(/business day/i);
  });

  it("splits an invoice-first sale: VAT on the issuance day, cash on the settlement day", async () => {
    // Issued 2026-08-04 noon local; settled 2026-08-05 noon local.
    const issued = new Date("2026-08-04T10:00:00Z").toISOString();
    const settled = new Date("2026-08-05T10:00:00Z").toISOString();
    const saleId = await seedSale(suite.db, venue, { invoiceNumber: 1, issuedAt: issued, total: "121.00", lines: [{ vatRate: "21.00", lineTotal: "100.00" }] });
    await seedTender(suite.db, { tenantId: venue.tenantId, saleId }, { method: "card", amount: "121.00", settledAt: settled });

    const day4 = await run(input({ businessDay: "2026-08-04" }));
    expect(day4.vat.byRate).toEqual([{ rate: "21.00", base: "100.00", cuota: "21.00" }]);
    expect(day4.cash.byTill).toEqual([]); // not settled on the 4th

    const day5 = await run(input({ businessDay: "2026-08-05" }));
    expect(day5.vat.byRate).toEqual([]); // not issued on the 5th
    expect(day5.cash.byTill).toHaveLength(1);
    expect(day5.cash.tenderTotal).toBe("121.00");
  });

  it("assembles all three sections and echoes the request identity", async () => {
    const issued = new Date("2026-08-04T10:00:00Z").toISOString();
    const saleId = await seedSale(suite.db, venue, { invoiceNumber: 1, issuedAt: issued, total: "121.00", lines: [{ vatRate: "21.00", lineTotal: "100.00" }] });
    await seedTender(suite.db, { tenantId: venue.tenantId, saleId }, { method: "cash", amount: "121.00", tipAmount: "0.00", settledAt: issued });
    const close = await run(input());
    expect(close).toMatchObject({
      tenantId: venue.tenantId, nodeId: venue.nodeId, businessDay: "2026-08-04", timeZone: "Europe/Madrid",
      counts: { sales: 1, corrections: 0, voids: 0 },
    });
    expect(close.vat.grossTotal).toBe("121.00");
    expect(close.cash.byTill[0]!.cashTakings).toBe("121.00");
  });

  it("does not leak another tenant's data (RLS + explicit predicate)", async () => {
    // Our tenant: nothing. A DIFFERENT tenant with a sale on the same day/node-of-its-own.
    const other = await seedVenue(suite.db);
    const issued = new Date("2026-08-04T10:00:00Z").toISOString();
    await seedSale(suite.db, other, { invoiceNumber: 1, issuedAt: issued, total: "121.00", lines: [{ vatRate: "21.00", lineTotal: "100.00" }] });
    const close = await run(input());
    expect(close.vat.byRate).toEqual([]);
    expect(close.counts).toEqual({ sales: 0, corrections: 0, voids: 0 });
  });

  it("handles the spring-forward DST day without shifting the bucket", async () => {
    // 2026-03-29 is the EU spring-forward (02:00→03:00). A 12:00-local sale is unambiguous.
    const issued = new Date("2026-03-29T10:00:00Z").toISOString(); // 12:00 CEST after the jump
    await seedSale(suite.db, venue, { invoiceNumber: 1, issuedAt: issued, total: "121.00", lines: [{ vatRate: "21.00", lineTotal: "100.00" }] });
    const close = await run(input({ businessDay: "2026-03-29" }));
    expect(close.vat.byRate).toEqual([{ rate: "21.00", base: "100.00", cuota: "21.00" }]);
  });
});
```

- [ ] **Step 2: Run and watch fail.**

- [ ] **Step 3: Implement `daily-close.ts`**
```ts
import type { Transaction } from "@waitron/db";
import { validateBusinessDay, validateCutover, validateTimeZone } from "./business-day.js";
import { computeCashUp } from "./cash-up.js";
import { computeCloseCounts } from "./counts.js";
import { computeVatSummary } from "./vat-summary.js";
import type { DailyClose, DailyCloseInput } from "./types.js";

/**
 * The daily close for one (tenant, node) over one business day: a VAT summary (issuance-anchored) and
 * an operational cash-up (settlement-anchored), plus record counts. A pure, deterministic read over
 * immutable commercial records — recomputes identically once the day has passed (design §6). Inputs
 * are validated up front so a bad timezone/cutover fails before any query runs.
 */
export async function computeDailyClose(tx: Transaction, input: DailyCloseInput): Promise<DailyClose> {
  validateTimeZone(input.timeZone);
  validateCutover(input.dayCutover);
  validateBusinessDay(input.businessDay);

  const [vat, cash, counts] = await Promise.all([
    computeVatSummary(tx, input),
    computeCashUp(tx, input),
    computeCloseCounts(tx, input),
  ]);

  return {
    tenantId: input.tenantId,
    nodeId: input.nodeId,
    businessDay: input.businessDay,
    timeZone: input.timeZone,
    vat,
    cash,
    counts,
  };
}
```

- [ ] **Step 4: Add the export to `src/index.ts`**
```ts
export { computeDailyClose } from "./daily-close.js";
```

- [ ] **Step 5: Run the whole package unfiltered + coverage + typecheck**

Run: `pnpm --filter @waitron/reporting test:coverage && pnpm --filter @waitron/reporting typecheck`
Expected: PASS, all thresholds met (98/98/98/95). If a branch is uncovered, add the missing case (e.g. an unreached method arm). Run **unfiltered** (`test:coverage`, not a name filter) so any package-wide guard suites load (`CLAUDE.md` §2/§4).

- [ ] **Step 6: Commit**
```bash
git add packages/reporting/src/daily-close.ts packages/reporting/src/daily-close.test.ts packages/reporting/src/index.ts
git commit -s -m "feat(reporting): computeDailyClose orchestrator (two anchors, validation, RLS-safe)"
```

---

### Task 7: Runnable demo script

**Files:**
- Create: `apps/server/scripts/daily-close-demo.ts`
- Modify: `apps/server/package.json` (add `@waitron/reporting` dependency)
- Modify: `apps/server/package.json` scripts (add a `demo:daily-close` entry, mirroring any existing script-runner convention)

**Interfaces:**
- Consumes: `computeDailyClose` (Task 6); the real `recordSale`/`settleSale`/`recordCorrection` from `@waitron/core`; the fake `FiscalBackend` from `@waitron/fiscal`.

**Rationale:** the human-checkable artifact (spec D9), modelled on `apps/server/scripts/record-one-sale.ts`. It is **self-contained**: PGlite + `CORE_MIGRATIONS` + the fake fiscal backend, so it runs with no external Postgres and no SIF registration. It rings up real sales through the real write path, then prints a `DailyClose`. Because `computeDailyClose` reads only commercial tables, `CORE_MIGRATIONS` alone suffices.

- [ ] **Step 1: Add the dependency**

In `apps/server/package.json` `dependencies`, add `"@waitron/reporting": "workspace:*"`, then run `pnpm install`.

- [ ] **Step 2: Write the demo**

`apps/server/scripts/daily-close-demo.ts` — read `record-one-sale.ts` first to match how it constructs the DB, backend, tenant/node/series, and a `RecordSaleInput`, then adapt to: seed a venue; `recordSale` two sales (one `settlement:{kind:"immediate"}` cash, one `settlement:{kind:"deferred"}`); `settleSale` the deferred one; `recordCorrection` a −€5 rectificativa against one (needs a `purpose:'rectificative'` series — seed one, as `packages/core/test/fixtures.ts`'s `seedRectificativeSeries` does); then:
```ts
import { computeDailyClose } from "@waitron/reporting";
// … after writing sales/tenders on `db`, all under one tenant/node …
const close = await withTenant(db, tenantId, async (tx) => {
  await asAppUser(tx);
  return computeDailyClose(tx, {
    tenantId,
    nodeId,
    businessDay: "2026-08-04",
    timeZone: "Europe/Madrid",
    dayCutover: "05:00",
  });
});
console.log(JSON.stringify(close, null, 2));
```
Keep every seeded `issued_at`/`settled_at` inside 2026-08-04 local so the demo's numbers are self-evidently the day's.

- [ ] **Step 3: Run it and read the output**

Run: `pnpm --filter @waitron/server exec tsx scripts/daily-close-demo.ts` (or the runner `record-one-sale.ts` uses — match it).
Expected: a printed `DailyClose` whose `vat.grossTotal` equals the sum of the sales' totals net of the correction, and whose `cash.byTill[].cashTakings` equals the cash collected. Eyeball that they reconcile.

- [ ] **Step 4: Commit**
```bash
git add apps/server/scripts/daily-close-demo.ts apps/server/package.json pnpm-lock.yaml
git commit -s -m "feat(reporting): runnable self-contained daily-close demo script"
```

---

## Post-implementation checks (before opening the PR)

- [ ] **English-only guard.** `@waitron/reporting` is a new generic package. Check whether the tree-wide `english-only` guard (`scripts/english-only.test.ts` / `packages/db/src/english-only.ts`) scans `packages/reporting/src` automatically (glob) or via an explicit package list; if the latter, add `packages/reporting`. Reporting `src/` must contain no Spanish tokens (any Spanish labels belong only to the `apps/server` demo, which is out of the guard's scope).
- [ ] **CI scope.** Confirm `scripts/changed-scope.mjs` / `scripts/changed-packages.mjs` attribute `packages/reporting/**` to `@waitron/reporting` with no special-casing needed (a new package under `packages/` is auto-attributed). `@waitron/reporting` declares `test:coverage`, so it is not a `PACKAGES_WITHOUT_TESTS` member.
- [ ] **Run the four-command gate** (`CLAUDE.md` §2): `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`, plus `pnpm --filter @waitron/reporting test:coverage` for the thresholds.
- [ ] **Fiscal guard is not triggered.** Reporting adds no `tenant_id`-bearing table, so `packages/fiscal-verifactu`'s `inmutabilidad` FORCE-RLS scan is unaffected — no new migration to run it against.

## Self-Review (completed while writing)

- **Spec coverage:** VAT half (§4) → Task 3; cash-up (§5) → Task 4; counts (§3 `CloseCounts`) → Task 5; two anchors + day mechanics (§6) → the `businessDayClause` (Task 1) used by 3–5, split-anchor proven in Task 6; validation (§2) → Task 1; determinism/frozen-seam (§6/§7) → no code (a pure function is the seam; documented in `daily-close.ts`); demo (§9/D9) → Task 7; the `percentOf`/`cuotaOf` decision (D6) and the plain-`Error` decision (§2) → recorded as spec refinements above. Recargo de equivalencia and the frozen close are explicitly out of scope (§9) → no tasks, correctly.
- **Placeholder scan:** none. Every code step carries real code; the one shorthand (`saleWithTenders`'s inline method type) is called out for the implementer to replace with the `TenderMethod` import.
- **Type consistency:** `DailyCloseInput`, `VatSummary`/`VatRateLine`, `CashUp`/`TillCashUp`/`TenderMethodLine`, `CloseCounts`, `DailyClose` are defined once in `types.ts` (Task 1) and consumed unchanged in Tasks 3–6; `computeVatSummary`/`computeCashUp`/`computeCloseCounts`/`computeDailyClose` signatures all take `(tx, input)` and are referenced identically by the orchestrator; `businessDayClause`/`cuotaOf` names are consistent across their definition and uses.
