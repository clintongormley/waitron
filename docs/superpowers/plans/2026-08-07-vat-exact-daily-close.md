# VAT-exact daily close (slice 8a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `computeDailyClose`'s VAT summary exact (match the filed difference-method desglose) by storing each sale's filed `vatBreakdown` on the immutable `sales` row and reading it in `computeVatSummary`.

**Architecture:** One additive `sales.vat_breakdown jsonb NOT NULL` column, written from the *same* `vatBreakdown` variable each sale-creating backend already files (one source, two sinks, same transaction → cannot diverge from the huella). `computeVatSummary` reads it instead of the multiplicative recompute from `sale_lines`.

**Tech Stack:** TypeScript, Drizzle ORM (Postgres/PGlite), Vitest.

**Design:** `docs/superpowers/specs/2026-08-07-vat-exact-daily-close-design.md`.

## Global Constraints

- **TDD, commit per task, `-s` every commit.** Coverage: `packages/*` = 98/98/98/95; run `pnpm --filter <pkg> test:coverage`.
- **No huella change, no new error codes.** `vat_breakdown` is a queryable copy of already-filed data; nothing hashed moves.
- **`sales` is immutable** (append-only trigger; app role holds INSERT, not UPDATE): the column is written once at INSERT and never updated.
- **Single source of truth:** the value stored MUST be the exact `vatBreakdown` variable passed to the fiscal backend in the same call — never a recompute. Do not build a second computation.
- **`NOT NULL` is the forcing function:** with no default, Drizzle makes `vat_breakdown` a required insert field, so `pnpm typecheck` flags every `sales` INSERT site until it is set. Fix them all; a path that forgets fails to compile.
- **No backfill** (pre-production; CI builds fresh, dev DBs recreated — `CLAUDE.md` §3).
- **Migration sequencing:** this adds `packages/db/drizzle/0032_*.sql`. It **sequences after** the allergens migration (`0031`). If allergens has not landed when this generates, it may take `0031`; if both are in flight, whichever lands second rebases its migration number. `drizzle/meta/_journal.json` collides — expect a rebase.
- **Gate:** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`, plus `pnpm --filter @waitron/db test:coverage`, `pnpm --filter @waitron/core test:coverage`, `pnpm --filter @waitron/reporting test:coverage`, and `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` (must stay green — no new tenant-scoped table, but the column is on one).

---

### Task 1: `sales.vat_breakdown` column + populate all sale-creating paths (`packages/db`, `packages/core`)

**Files:**
- Modify: `packages/db/src/schema/sales.ts` (add the column to the `sales` table)
- Create: `packages/db/drizzle/0032_*.sql` + `meta/_journal.json` + snapshot (generated)
- Modify: `packages/core/src/record-sale.ts` (the `sales` INSERT), `packages/core/src/record-correction.ts`, `packages/core/src/record-substitution.ts`
- Test: `packages/core/src/record-sale.test.ts` (or the fiscal round-trip test) — equality-to-filed; plus the schema column assertion in `packages/db`.

**Interfaces:**
- Produces: `sales.vat_breakdown` — a NOT NULL jsonb column typed `{ rate: string; base: string; tax: string }[]`, holding the filed per-rate desglose.

- [ ] **Step 1: Write the failing equality-to-filed test** — file a **catalogue** sale (mixed rate) via the normal path, then read back both the `sales.vat_breakdown` and the filed `registros_facturacion.desglose` for that sale, and assert they carry the same per-rate `base` and `tax`:

```ts
it("stores the filed vatBreakdown on sales, equal to the filed desglose", async () => {
  // ...file a catalogue sale with lines at 21% and 10% (difference-method)...
  const [saleRow] = await tx.select({ vb: sales.vatBreakdown }).from(sales).where(eq(sales.id, saleId));
  const filed = await backend.filedReceiptFor(tx, saleId); // returns { vatBreakdown } inverted from the registro
  // same rates, same base, same tax (the difference-method cuota, NOT round(base*rate))
  expect(sortByRate(saleRow!.vb)).toEqual(sortByRate(filed!.vatBreakdown));
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @waitron/core test record-sale` → FAIL (no `vatBreakdown` column).

- [ ] **Step 3: Add the column** to the `sales` `pgTable` in `packages/db/src/schema/sales.ts`, near `total`:

```ts
    // The filed per-rate VAT desglose ({rate, base, tax}[]) — the SAME breakdown written into the
    // hash-chained registro, stored here queryably for reporting. Written once at INSERT (sales is
    // immutable); NOT a recompute. Reporting reads this for an exact VAT summary (spec 8a).
    vatBreakdown: jsonb("vat_breakdown")
      .$type<{ rate: string; base: string; tax: string }[]>()
      .notNull(),
```

- [ ] **Step 4: Generate + verify the migration** — `pnpm --filter @waitron/db db:generate`; the new `0032_*.sql` MUST be only `ALTER TABLE "sales" ADD COLUMN "vat_breakdown" jsonb NOT NULL;`. If it contains anything else, STOP.

- [ ] **Step 5: Populate every sale INSERT** — `pnpm typecheck` now errors at each `sales` INSERT missing `vatBreakdown`. In each of `record-sale.ts`, `record-correction.ts`, `record-substitution.ts`, add `vatBreakdown` to the `sales` `.values({...})` using the **same variable already passed to the fiscal backend** in that function:
  - `record-sale.ts`: `const vatBreakdown = input.vatBreakdown ?? buildVatBreakdown(input.lines);` — hoist it above both the `sales` insert and the `backend.recordSale(... vatBreakdown ...)` call so ONE variable feeds both.
  - `record-correction.ts` / `record-substitution.ts`: likewise hoist `buildVatBreakdown(input.lines)` so the insert and the backend call share it.

- [ ] **Step 6: Add the db schema column assertion** — in `packages/db`'s catalogue/sales schema test (mirror the allergens/other column checks): assert `information_schema` shows `sales.vat_breakdown` `jsonb`, `is_nullable = NO`.

- [ ] **Step 7: Run** — `pnpm --filter @waitron/core test:coverage && pnpm --filter @waitron/db test:coverage` → PASS. Then `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` → still green.

- [ ] **Step 8: Prove single-source by mutation** — temporarily change one of the three inserts to pass a **hand-built different** breakdown (e.g. drop the second rate); confirm the equality-to-filed test FAILS; restore.

- [ ] **Step 9: Commit** — `git add -A && git commit -s -m "feat(core,db): store filed vatBreakdown on sales.vat_breakdown (0032)"`

---

### Task 2: `computeVatSummary` reads the filed breakdown (`packages/reporting`)

**Files:**
- Modify: `packages/reporting/src/vat-summary.ts`
- Test: `packages/reporting/src/vat-summary.test.ts` (or `daily-close.test.ts`)

**Interfaces:**
- Consumes: `sales.vat_breakdown` (Task 1). Return shape of `computeVatSummary` / `VatSummary` is unchanged.

- [ ] **Step 1: Write the failing exactness test** — a mixed-rate **catalogue** sale whose difference-method cuota differs from `round(base × rate/100)`; assert `computeVatSummary` returns the filed `tax` per rate (not the multiplicative value). Add a regression: a non-catalogue (`buildVatBreakdown`) sale still matches; and a rectificativa's negative breakdown nets in.

```ts
it("reports the filed difference-method cuota exactly for catalogue sales", async () => {
  // file a catalogue sale where Σgross − Σbase ≠ round(Σbase × rate) for at least one rate
  const summary = await computeVatSummary(tx, closeInput);
  const line = summary.byRate.find((r) => r.rate === "21.00")!;
  expect(line.tax).toBe(filedTaxAt21); // the difference-method figure, exact
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @waitron/reporting test vat-summary` → FAIL (still multiplicative).

- [ ] **Step 3: Rewrite the query** to read `sales.vat_breakdown` instead of `sale_lines`. Unnest the jsonb array and aggregate per rate, keeping the existing `WHERE` (business-day bucketing on `sales.issued_at`, `activeSalesClause`, tenant/node predicates):

```ts
const { rows } = await tx.execute<{ rate: string; base: string; tax: string }>(sql`
  select
    b->>'rate' as rate,
    sum((b->>'base')::numeric(12,2))::numeric(12,2)::text as base,
    sum((b->>'tax')::numeric(12,2))::numeric(12,2)::text  as tax
  from sales s
  cross join lateral jsonb_array_elements(s.vat_breakdown) as b
  where ${businessDayClause(sales.issuedAt, input)}
    and ${activeSalesClause(...)}                      -- keep the exact existing predicates
    and s.tenant_id = ${input.tenantId} and s.node_id = ${input.nodeId}
  group by b->>'rate'
  order by b->>'rate'`);
```

Then build `VatRateLine[]` directly from `rows` (`rate`, `base`, `tax` — no `taxOf` recompute); `baseTotal = Σ base`, `taxTotal = Σ tax`, `grossTotal = Σ (base+tax)`. Delete `taxOf` if now unused.

- [ ] **Step 4: Remove the stale CAVEAT** — delete the `vat-summary.ts` comment block documenting the multiplicative divergence (it no longer applies); replace with a one-line note that the summary reads the filed `sales.vat_breakdown`.

- [ ] **Step 5: Run** — `pnpm --filter @waitron/reporting test:coverage` → PASS. Confirm the previously-divergent case now equals the filed figure.

- [ ] **Step 6: Prove the guard by deletion** — temporarily revert Step 3 to the old `taxOf(base, rate)` multiplicative tax; confirm the catalogue-exactness test FAILS; restore.

- [ ] **Step 7: Commit** — `git add -A && git commit -s -m "feat(reporting): read filed sales.vat_breakdown for an exact VAT summary"`

---

## Self-review

- **Spec coverage:** D1 store-on-sales→Task 1; D2 single-source→Task 1 Step 5 (hoisted variable) + Step 8 (mutation proof); D3 NOT NULL→Task 1 Step 3; D4 no-huella / D5 immutable→Global Constraints + column comment; reporting read→Task 2; CAVEAT removal→Task 2 Step 4.
- **Placeholder scan:** the `activeSalesClause(...)` / business-day predicates in Task 2 Step 3 are "keep the EXACT existing predicates from the current `computeVatSummary`" — the implementer copies them verbatim from the file, not invents them. No other placeholders.
- **Type consistency:** `{ rate, base, tax }[]` identical across the db `$type` (Task 1), the stored variable (`VatBreakdownLine` from core), and the query row (Task 2). `VatSummary`/`VatRateLine` return shape unchanged.

## Execution handoff

Implement via **superpowers:subagent-driven-development**. Linear (1→2). Task 1's migration number rebases against allergens per the Global Constraints.
