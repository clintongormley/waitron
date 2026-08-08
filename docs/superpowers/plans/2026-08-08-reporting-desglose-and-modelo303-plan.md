# Reporting — date-range VAT + modelo 303 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax. TDD throughout: failing test first → watch it fail → minimal implementation → the exact
> verify command → commit `-s`.

**Goal:** Add two read-only functions to `@waitron/reporting`, both over the already-persisted
`sales.vat_breakdown`: `computeVatSummaryForPeriod` (date-range VAT summary, scope 3) and
`computeVatReturn` (modelo 303 output-VAT aggregate for one obligado/month, scope 4).

**Architecture:** Extract one shared `aggregateVatByRate` core (jsonb-unnest + per-rate `Σ` +
`activeSalesClause` + tenant predicate, optional node); the three callers differ only in their
issuance-date predicate and node scoping. **No migration, no new table, no schema change** — the
queryable store (`sales.vat_breakdown`, migration 0032, #66) already exists. The daily-close
`computeVatSummary` delegates to the shared core, so its existing suite is the behaviour-preserving
guard.

**Design:** `docs/superpowers/specs/2026-08-08-reporting-desglose-and-modelo303-spec.md`.

**Tech Stack:** TypeScript (ESM), drizzle-orm `sql` templates, PGlite (`usePgliteDb`) + real Postgres
(`useRealPostgres`) via Vitest. Money via `@waitron/shared`'s `Decimal` codec.

## Global Constraints

- **TDD, one commit per task, `-s` every commit** (`git commit -s`). Feature branch, never `main`
  (`CLAUDE.md` §6); use a worktree (`worktree.py new waitron feat/reporting-vat-range-and-303`).
- **No migration, no schema change, no new `tenant_id`-bearing table.** If a step wants one, STOP —
  the design is that both functions are pure reads over `sales.vat_breakdown` (spec §2, D2).
- **Money is `Decimal` (branded string), never a JS `number`.** SQL casts aggregates
  `::numeric(12,2)::text`, re-parsed with `decimal()`; sum with `addDecimal`. No `toNumber`.
- **English identifiers only** (`@waitron/reporting` is in the `english-only` guard). Use
  `tax`/`year`/`month`/`return`/`byRate`/`baseTotal`/`taxTotal`; never `cuota`/`iva`/`periodo`/
  `ejercicio` (they are in `SPANISH_WORDS`). "modelo 303" appears only in comments. No new schema
  tokens → nothing added to `SPANISH_WORDS`.
- **Belt-and-suspenders tenant predicate on every query** (`s.tenant_id = ${tenantId}`), on top of
  RLS, mirroring `listOutstandingSales` / `computeVatSummary`. The node predicate is conditional.
- **Invalid input throws a plain `Error`** (caller precondition), matching `business-day.ts`'s
  validators. No registered error code (a `reporting.*` code is forbidden; the concept `close.*` does
  not apply).
- **Coverage 98/98/98/95** — run `pnpm --filter @waitron/reporting test:coverage`. Exercise every
  branch, including empty-range/empty-month and the `nodeId` present/absent branch.
- **The full gate** (`CLAUDE.md` §2): `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`,
  plus `pnpm --filter @waitron/reporting test:coverage` (CI shards run `test:coverage`, not `test`).

---

### Task 0: Re-verify 8a's persistence + exactness are in place (run, don't reason)

The brief's scopes 1–2 are already landed (spec §Context). Ground that claim by **running** the two
existing tests before building on them (`CLAUDE.md` §1 — reading is not verification). No code change.

- [ ] **Step 1:** `pnpm --filter @waitron/core test record-sale` → the equality-to-filed test
  (`record-sale.test.ts:362-412`, asserts `sales.vat_breakdown` == filed desglose, `1.74` not `1.73`)
  is GREEN. If it is not, STOP — the foundation is not what the spec claims.
- [ ] **Step 2:** `pnpm --filter @waitron/reporting test vat-summary` → the catalogue-exactness test
  (`vat-summary.test.ts:201-225`, `20.99`/`5.01`) is GREEN.
- [ ] **Step 3:** Confirm the column exists as specified: `sales.vat_breakdown jsonb NOT NULL`
  (`packages/db/src/schema/sales.ts:108-113`). No commit for this task.

---

### Task 1: Extract `aggregateVatByRate`; add `computeVatSummaryForPeriod` (scope 3)

**Files:**
- Modify: `packages/reporting/src/vat-summary.ts` (extract the shared core; `computeVatSummary`
  delegates; add `computeVatSummaryForPeriod`)
- Modify: `packages/reporting/src/business-day.ts` (add `businessDayRangeClause`)
- Modify: `packages/reporting/src/types.ts` (add `PeriodVatInput`)
- Modify: `packages/reporting/src/index.ts` (export `computeVatSummaryForPeriod`, `PeriodVatInput`)
- Test: `packages/reporting/src/vat-summary-period.test.ts` (new); `business-day.test.ts` (range clause)

**Interfaces:**
- Produces `computeVatSummaryForPeriod(tx, PeriodVatInput): Promise<VatSummary>` (existing `VatSummary`
  shape). `PeriodVatInput` per spec §3 (`nodeId?` optional).

- [ ] **Step 1 (failing test):** write `vat-summary-period.test.ts` mirroring `vat-summary.test.ts`'s
  fixtures (`seedVenue`/`seedSale`/`seedNodeAndSeries` from `../test/fixtures.js`), asserting:
  - two sales on **different** business days both inside `[from, to]` sum per rate;
  - a sale on a day **outside** `[from, to]` is excluded;
  - per-invoice rounding across the range (two `0.03 @ 21%` invoices on different days → `tax "0.02"`,
    not `"0.01"` — the load-bearing per-invoice-vs-summed-base case, `vat-summary.test.ts:125-141`);
  - the cutover at a range edge (a `2026-08-03T23:30Z` sale, `05:00` cutover, `TZ=Europe/Madrid`
    lands in business day `2026-08-03`, so a `[2026-08-04, 2026-08-05]` range excludes it);
  - **`nodeId` omitted** sums two nodes of one tenant; **`nodeId` present** excludes the other node
    (seed a second node via `seedNodeAndSeries`);
  - an empty range → `{ byRate: [], baseTotal: "0.00", taxTotal: "0.00", grossTotal: "0.00" }`.
- [ ] **Step 2 (watch it fail):** `pnpm --filter @waitron/reporting test vat-summary-period` → FAIL
  (`computeVatSummaryForPeriod` does not exist).
- [ ] **Step 3 (range clause):** in `business-day.ts` add, beside `businessDayClause`:

  ```ts
  export function businessDayRangeClause(column: SQL, input: PeriodVatInput): SQL {
    return sql`(${column} at time zone ${input.timeZone} - ${input.dayCutover}::interval)::date
               between ${input.fromBusinessDay}::date and ${input.toBusinessDay}::date`;
  }
  ```

  Add a `business-day.test.ts` case that a single-day `from == to` range equals the `= businessDay`
  form for a boundary instant (so the range clause provably extends, not replaces, the tested one).
- [ ] **Step 4 (extract the core):** refactor `vat-summary.ts` so the jsonb-unnest + per-rate `Σ` +
  `activeSalesClause` + tenant predicate live in one private helper that takes the issuance-date
  `SQL` and an optional `nodeId`:

  ```ts
  async function aggregateVatByRate(
    tx: Transaction,
    scope: { tenantId: TenantId; nodeId?: NodeId; dateFilter: SQL },
  ): Promise<VatSummary> {
    const nodeClause = scope.nodeId ? sql`and s.node_id = ${scope.nodeId}` : sql``;
    const { rows } = await tx.execute<{ rate: string; base: string; tax: string }>(sql`
      select (b->>'rate')::numeric(5,2)::text as rate,
             sum((b->>'base')::numeric(12,2))::numeric(12,2)::text as base,
             sum((b->>'tax')::numeric(12,2))::numeric(12,2)::text  as tax
      from sales s
      cross join lateral jsonb_array_elements(s.vat_breakdown) as b
      where s.tenant_id = ${scope.tenantId} ${nodeClause}
        and ${scope.dateFilter}
        and ${activeSalesClause({ tenantId: scope.tenantId } as DailyCloseInput)}
      group by (b->>'rate')::numeric(5,2)::text`);
    // ...build VatRateLine[] sorted by compareDecimal; baseTotal/taxTotal/grossTotal exactly as today
  }
  ```

  `computeVatSummary(tx, input)` becomes
  `aggregateVatByRate(tx, { tenantId, nodeId, dateFilter: businessDayClause(sql\`s.issued_at\`, input) })`.
  `computeVatSummaryForPeriod(tx, input)` validates (`validateTimeZone`/`validateCutover`/
  `validateBusinessDay` on both ends; `from <= to`) then
  `aggregateVatByRate(tx, { tenantId, nodeId, dateFilter: businessDayRangeClause(sql\`s.issued_at\`, input) })`.
  > Note: `activeSalesClause` only reads `input.tenantId` (`business-day.ts:75-78`) — pass a minimal
  > object; do not fabricate node/day fields. Confirm the signature and narrow the param type if
  > cleaner than the cast shown.
- [ ] **Step 5 (behaviour-preserving guard):** `pnpm --filter @waitron/reporting test vat-summary`
  (the ORIGINAL daily-close suite) must stay **fully green** after the delegation refactor — it is the
  guard that `computeVatSummary` is byte-unchanged (`CLAUDE.md`: preserve behavioural assertions).
- [ ] **Step 6:** add the exports to `index.ts` and `PeriodVatInput` to `types.ts`; run
  `pnpm --filter @waitron/reporting test vat-summary-period business-day` → PASS.
- [ ] **Step 7 (prove-by-deletion):** temporarily drop the `between` upper bound (or the `nodeClause`);
  confirm the out-of-range / other-node test FAILS; restore.
- [ ] **Step 8:** `pnpm --filter @waitron/reporting test:coverage` → PASS (98/98/98/95). Commit:
  `git commit -s -m "feat(reporting): date-range VAT summary over the filed desglose (scope 3)"`.

---

### Task 2: `computeVatReturn` — modelo 303 output-VAT aggregate (scope 4)

**Files:**
- Create: `packages/reporting/src/vat-return.ts`
- Modify: `packages/reporting/src/types.ts` (`VatReturnInput`, `VatReturn`)
- Modify: `packages/reporting/src/index.ts` (export `computeVatReturn`, the two types)
- Test: `packages/reporting/src/vat-return.test.ts` (PGlite — the arithmetic)

**Interfaces:**
- Produces `computeVatReturn(tx, VatReturnInput): Promise<VatReturn>` per spec §4. Tenant-wide (no
  node), civil-date bucketing keyed on the filed *fecha de expedición*, `byRate`/`baseTotal`/`taxTotal`
  + `year`/`month`, **no** `grossTotal`.

- [ ] **Step 1 (failing test):** `vat-return.test.ts` asserting:
  - a month of mixed-rate **catalogue** (difference-method — pass explicit `vatBreakdown` overrides in
    `seedSale`, as `vat-summary.test.ts:201-225` does) sales across **two nodes** (`seedNodeAndSeries`)
    → `byRate` sums the **filed** `base`/`tax` per rate and aggregates across the nodes; `taxTotal`
    equals the summed filed cuotas (**not** `round(Σ base × rate)`);
  - a rectificativa (negative filed breakdown) nets its rate down; a voided sale and an F3 substitute
    are excluded;
  - **civil-vs-operational**: a sale issued `2026-08-01T00:30` local (Madrid) with `issuedOffsetMinutes`
    matching — i.e. just after civil midnight — lands in **August**'s return even though a `05:00`
    business-day cutover would put it in July's operational business day. Its mirror at
    `2026-07-31T23:30` local lands in **July**. (This is the test that proves the 303 buckets on the
    filed civil date, not the cutover — spec §4.)
  - `month` out of `1..12` or a non-integer `year` → a plain `Error` (assert the throw, not a code).
  - empty month → `{ byRate: [], baseTotal: "0.00", taxTotal: "0.00" }`.
- [ ] **Step 2 (watch it fail):** `pnpm --filter @waitron/reporting test vat-return` → FAIL (no
  `computeVatReturn`).
- [ ] **Step 3 (implement):** in `vat-return.ts`, validate `year`/`month`, then call the Task-1
  `aggregateVatByRate` with **no** `nodeId` and the civil-date month filter (spec §4):

  ```ts
  const firstDay = sql`make_date(${input.year}, ${input.month}, 1)`;
  // Filed FechaExpedicionFactura = civil-local date via the sale's OWN snapshot offset
  // (verifactu/format.ts formatDate = shift(issued_at, issued_offset_minutes) then read date).
  const filedDate = sql`((s.issued_at at time zone 'UTC') + make_interval(mins => s.issued_offset_minutes))::date`;
  const dateFilter = sql`${filedDate} >= ${firstDay} and ${filedDate} < (${firstDay} + interval '1 month')`;
  const summary = await aggregateVatByRate(tx, { tenantId: input.tenantId, dateFilter });
  return { tenantId: input.tenantId, year: input.year, month: input.month,
           byRate: summary.byRate, baseTotal: summary.baseTotal, taxTotal: summary.taxTotal };
  ```

  Export `aggregateVatByRate` from `vat-summary.ts` (internal to the package; keep it out of the public
  barrel). Document in the file header, in a comment, that this is the modelo 303 *IVA devengado*
  (output) side only; the deducible/soportado side, recargo, and the casilla mapping are out of scope
  (spec §4).
- [ ] **Step 4:** add `VatReturnInput`/`VatReturn` to `types.ts` and the exports to `index.ts`. Run
  `pnpm --filter @waitron/reporting test vat-return` → PASS. Confirm the civil-vs-operational test
  proves the boundary (it must FAIL if you swap the filter to `businessDayRangeClause` with a `05:00`
  cutover — try it once to prove the control, then restore).
- [ ] **Step 5 (prove-by-deletion / control):** temporarily change the tax read to `round(base × rate)`
  (or re-round on the summed base); confirm the catalogue difference-method exactness test FAILS;
  restore. This is the period-level analogue of the 8a exactness proof (spec §7).
- [ ] **Step 6:** `pnpm --filter @waitron/reporting test:coverage` → PASS. Commit:
  `git commit -s -m "feat(reporting): modelo 303 output-VAT aggregate over the filed desglose (scope 4)"`.

---

### Task 3: Real-Postgres RLS isolation for `computeVatReturn` (the tenant-wide guard)

**Files:**
- Test: `packages/reporting/src/vat-return.rls.test.ts` (new; real PG)

The 303 drops the node predicate, so RLS + the explicit `tenant_id` predicate are the ONLY scoping
across nodes. PGlite (superuser, single backend) cannot show the RLS half (`CLAUDE.md` §4), so this is
where a real-PG test earns its keep. Mirror `record-daily-close.rls.test.ts:1-45`
(`useRealPostgres` + `startRealPostgres`; `TESTCONTAINERS_RYUK_DISABLED=true` locally).

- [ ] **Step 1 (failing/absent test):** seed **two** tenants (`seedVenue` mints a fresh tenant each),
  a month of sales under each. Run `computeVatReturn` for tenant A inside `withTenant(db, A)` +
  `asAppUser`; assert tenant B's base/tax never appear (A's `byRate` equals only A's sales).
- [ ] **Step 2:** run `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/reporting test vat-return.rls`
  → PASS under the real `app_user` with FORCE RLS.
- [ ] **Step 3 (prove which layer):** temporarily delete the explicit `s.tenant_id = ${tenantId}`
  predicate in `aggregateVatByRate`; the test must STILL pass (RLS alone holds) — this proves RLS is
  live, not that the predicate is redundant. Then, to prove the predicate’s own job, note in a comment
  that under a BYPASSRLS/superuser connection only the predicate scopes (the PGlite suites rely on it).
  Restore the predicate.
- [ ] **Step 4:** ensure `vat-return.rls.test.ts` is not double-counted in coverage (the real-PG
  suites are exercised, not measured — `src/testing/**` is already excluded in `vitest.config.ts`;
  the `.rls.test.ts` itself is a test file, so no config change needed). Commit:
  `git commit -s -m "test(reporting): real-PG cross-tenant isolation for the modelo 303 aggregate"`.

---

### Task 4 (recommended): a runnable demo script

**Files:**
- Create: `apps/server/scripts/modelo-303-demo.ts` (apps/* is exempt from `english-only`, so Spanish
  labels are fine here)
- Modify: `apps/server/package.json` (a `demo:modelo-303` script), mirroring the existing
  daily-close / record-one-sale demos.

- [ ] **Step 1:** seed a month of sales across ≥2 rates and ≥2 nodes plus a rectificativa; print the
  `computeVatSummaryForPeriod` weekly roll-up and the `computeVatReturn` monthly *IVA devengado* table
  (rate, base imponible, cuota) with a header noting it is the output side only.
- [ ] **Step 2:** run it end to end; confirm the printed cuota total equals the summed filed figures.
  Commit: `git commit -s -m "chore(server): modelo 303 output-VAT demo script"`.

---

### Task 5: Guard suites + the full gate

- [ ] **Step 1 — `inmutabilidad` (unaffected, confirm no regression):**
  `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` → GREEN. (No new table; this is
  belt-and-suspenders — spec §2.)
- [ ] **Step 2 — english-only (tree-wide, in the root project):**
  `pnpm vitest run scripts/english-only.test.ts` (or `pnpm --filter @waitron/db test english-only`
  if run per-package) → GREEN. Confirm the new identifiers (`computeVatReturn`, `VatReturn`,
  `PeriodVatInput`, `byRate`, `year`, `month`) tokenise to non-Spanish words. Nothing added to
  `SPANISH_WORDS` (no schema tokens).
- [ ] **Step 3 — coverage:** `pnpm --filter @waitron/reporting test:coverage` → 98/98/98/95, and read
  the per-file table (not just the exit code) to confirm `vat-return.ts` and the new
  `vat-summary.ts`/`business-day.ts` branches are exercised.
- [ ] **Step 4 — the full gate:** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`.
  Then `pnpm install` (no dep change expected; confirm the lockfile is unchanged). Before pushing:
  rebase, run the gate, watch CI + Copilot (`CLAUDE.md` §6). Feature branch → PR (this is code, not a
  docs-only change).

---

## Self-review

- **Spec coverage:** D2/no-migration → Task 0 confirms the store exists, no migration task; D3 shared
  core → Task 1 Step 4; scope 3 range → Task 1; scope 4 civil-date/tenant-wide/output-only → Task 2;
  D5 tenant grain / RLS-only-across-nodes → Task 3; D7 english-only → Task 5 Step 2; D8 no sargable
  rewrite → no task (deliberately absent); D9 plain-Error → Task 2 Step 1.
- **The two brief-mandated tests** (persisted desglose == filed; `computeVatSummary` exact) already
  exist and are re-run in Task 0; their period-level analogue is Task 2 Step 5.
- **Behaviour preservation:** the daily-close `computeVatSummary` suite is the guard that the extract
  refactor changed nothing (Task 1 Step 5).
- **No placeholders:** the SQL in Tasks 1–2 is copied from the current `vat-summary.ts` verbatim for
  the aggregation body; only the date filter and the `nodeClause` are new. `activeSalesClause` is
  reused, not reinvented — confirm its param shape against `business-day.ts:75-78`.
- **Migrations added:** none. **Guard suites:** `inmutabilidad`, `english-only`,
  `reporting test:coverage` (Task 5). **Real-PG:** Task 3 only (where RLS-across-nodes matters).

## Execution handoff

Implement via **superpowers:subagent-driven-development**, linear 0→1→2→3→(4)→5. Task 1's refactor
must keep the existing `vat-summary.test.ts` green at every step. No migration means no
`drizzle/meta/_journal.json` collision with the parallel dashboard/till tracks — this slice cannot
conflict on schema.
