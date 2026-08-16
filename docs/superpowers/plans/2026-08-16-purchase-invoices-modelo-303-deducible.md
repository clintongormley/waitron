# Purchase Invoices + Modelo 303 Deducible — Implementation Plan (Slices A–C, D conditional)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (or executing-plans). Steps use `- [ ]`.

**Spec:** `docs/superpowers/specs/2026-08-16-purchase-invoices-and-modelo-303-deducible-design.md` — **APPROVED 2026-08-16**. Read it first; it holds the design, the decisions (D1–D7), the casilla map (§7, with cited sources), and the provenance table (§13). This plan is the task breakdown.

**Owner directive (2026-08-16):** build slices A–D; asesor-fiscal approval afterwards. **Caveat that binds:** the asesor sign-off covers *fiscal judgments* (recargo, prorrata, deducibility %); it does NOT license fabricating the **DR303 byte layout** (Slice D), which is a factual artefact that must be transcribed from the official record-design — never guessed. Slice D is therefore GATED on a research agent obtaining that layout; if it cannot be verified, Slice D ships its serializer with the layout as a flagged, unverified input and is called out, not silently shipped as submittable.

**Goal:** capture received supplier invoices (`@waitron/purchasing` + tables in `packages/db`), compute IVA **deducible**, extend `computeVatReturn` to the **net**, and map the AEAT **casillas** — the input-VAT counterpart to #76's output side.

## Global constraints

- **TDD, always; every guard proven by deletion; negative controls confirmed** (CLAUDE.md §4).
- **Exactness is inherited, never re-derived** (the #76/#66 rule): aggregates SUM the filed per-invoice cuotas, never `round(Σ base × rate)`. Pin it with a difference-method test (Slice B).
- **Fiscal boundary (H2) is HARD.** This is the commercial/accounting lane. Touch NOTHING in `packages/verifactu` / `packages/fiscal-verifactu` beyond the sanctioned `vocabulary-scope` test pin. A received invoice gets **no huella, no `registros_facturacion` row, no hash chain, no invoice number from our `invoice_series`**. A whole-branch fiscal-safety review MUST confirm this.
- **English identifiers + Spanish-only-in-comments** (the `reporting` precedent — `devengado`/`deducible` are NOT in `SPANISH_WORDS`, they appear only in doc comments). Keep every column, enum value, function, and string literal English; put the Spanish fiscal term in the doc comment. So **`SPANISH_WORDS` needs NO change**; only add `"purchasing"` to `GENERIC_PACKAGES` (`packages/db/src/english-only.ts`) and to the `fiscal-verifactu` `vocabulary-scope` test pin. (Enum values: `kind` = `ordinary` | `capital` for *corriente* / *bienes de inversión*; `regime` = `general` | `equivalence_surcharge` for *recargo de equivalencia* — comments give the Spanish. If a genuine fiscal token must be a value, add it to `SPANISH_WORDS` with a justification instead — but prefer English.)
- **No backwards-compat / backfill** (CLAUDE.md §3): nothing deployed; new tables start empty.
- **Coverage 98/98/98/95** on every new/changed package; CI gates on `test:coverage`. Run each changed package UNFILTERED (tree-wide guards). Real-PG suites need `TESTCONTAINERS_RYUK_DISABLED=true`.
- **A new tenant-scoped table needs ENABLE + FORCE RLS + a tenant-isolation policy + `app_user` grants** (the recipes `0038` auto-ENABLE / `0039` custom FORCE+policy+grant pattern), or the `fiscal-verifactu` `inmutabilidad` guard goes red. Run `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` after adding the tables.
- **Every commit `-s`.** Worktree already exists (`waitron-feat-purchase-invoices-modelo-303`); do NOT create one. Commit per task, slice-separated.

## Resolved facts

1. **Next migration numbers: `0041` (auto CREATE+ENABLE) + `0042` (custom FORCE+policy+grant).** Latest is `0040` (recipes index). Generate `0041` with `drizzle-kit generate` (it emits CREATE TABLE + `ENABLE ROW LEVEL SECURITY` from `.enableRLS()` + FKs/indexes), then hand-write `0042` with `--custom` for FORCE + `CREATE POLICY … USING/WITH CHECK (tenant_id = current_tenant_id())` + `REVOKE ALL … FROM app_user` + `GRANT SELECT, INSERT, UPDATE, DELETE … TO app_user` (both tables are MUTABLE, so DELETE is granted — unlike sales). Template: `packages/db/drizzle/0039_recipes_rls.sql`.
2. **Package scaffold mirrors `@waitron/recipes`:** `packages/purchasing/package.json` (`@waitron/purchasing`, private, type module, `main ./src/index.ts`, deps `@waitron/db`+`@waitron/shared`+`drizzle-orm`, the standard scripts + PGlite/testcontainers/vitest devDeps). `src/index.ts` barrel ending in `import "./errors.js"`. `src/errors.ts` declaring `purchase.*` codes. The root `scripts/errors-reachable.test.ts` guard AUTO-discovers the new package (index.ts + errors.ts) — no per-package reachability test.
3. **Error codes `purchase.*`** (the entity is the purchase invoice) — grep the registry first; never `purchasing.*` (package) or `invoice.*` (collides with our issued invoices). Likely `purchase.not_found`, `purchase.duplicate`, `purchase.invalid` (reasons: e.g. an inverted/degenerate desglose, a non-positive base). Each file that throws imports `./errors.js`.
4. **Money = `Decimal` strings via `@waitron/shared` `money.ts`** (`percentOf` for cuota, `sumDecimals`/`addDecimal` for totals); `numeric(12,2)` money, `numeric(5,2)` rate, `numeric(5,2)` for `deductible_proportion`. Single currency per tenant — no currency column.
5. **Deduction period = `received_on`** (spec D3, primary-source-backed). `computeInputVat` buckets by `received_on` civil date over the calendar month, the same half-open `make_date(year,month,1) ≤ d < +1 month` bound `computeVatReturn` uses.

---

## Slice A — the purchase-invoice module

- [ ] **A1 — schema** (`packages/db/src/schema/purchase-invoices.ts`, registered in `schema/index.ts`). Two tables per spec §4, both `.enableRLS()`, `tenant_id uuid NOT NULL` FK→tenants:
  - `purchase_invoices`: `id`, `tenant_id`, `supplier_tax_id text`, `supplier_name text`, `supplier_invoice_number text`, `issued_on date`, `received_on date`, `total numeric(12,2)`, `regime` enum(`general`|`equivalence_surcharge`) default `general`, `deductible_proportion numeric(5,2)` default `100.00` (check 0–100), `note text null`, `created_at`/`updated_at`. A UNIQUE index on `(tenant_id, supplier_tax_id, supplier_invoice_number)` — the conservative "refuse a duplicate supplier invoice" default (spec §9 flags per-year-vs-forever as an asesor question; document that on the index).
  - `purchase_invoice_vat`: `id`, `tenant_id`, `purchase_invoice_id` FK (cascade), `rate numeric(5,2)` (check 0–100), `base numeric(12,2)`, `cuota numeric(12,2)`, `kind` enum(`ordinary`|`capital`) default `ordinary`. Index on `(tenant_id, purchase_invoice_id)`.
- [ ] **A2 — migrations** `0041` (drizzle-kit generate) + `0042` (custom RLS, fact 1). Verify by applying to PGlite + real PG.
- [ ] **A3 — package scaffold** (`packages/purchasing/`): package.json, `src/index.ts`, `src/errors.ts` (`purchase.*`). Add `"purchasing"` to `GENERIC_PACKAGES` + the `fiscal-verifactu` `vocabulary-scope` pin. `pnpm install` so the workspace links it.
- [ ] **A4 — CRUD ops** (`src/operations.ts` or split): `createPurchaseInvoice(tx, {header, lines})` (inserts header + desglose rows in one tx; validates ≥1 line, base/cuota non-negative, rate 0–100, else `purchase.invalid`; maps a `23505` on the unique index to `purchase.duplicate`), `updatePurchaseInvoice`, `deletePurchaseInvoice`, `getPurchaseInvoice` (header + lines), `listPurchaseInvoices(tx, {tenantId, from?, to?})`. All tenant-scoped, `tx`-based. Export from the barrel.
- [ ] **A5 — tests.** PGlite unit tests for the ops (create/read/update/delete round-trips, the validation `purchase.invalid`/`purchase.duplicate` cases proven by deletion). **Real-PG `purchase-invoices.rls.test.ts`** (`useRealPostgres`, ryuk): cross-tenant isolation (a tenant-A session cannot read tenant-B invoices) + the `app_user` grant, both proven by deletion, under FORCE RLS. Run `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` — the two new tables must pass (ENABLE+FORCE).
- [ ] **A6 — verify:** `@waitron/db` + `@waitron/purchasing` + `@waitron/fiscal-verifactu` `test:coverage` green (unfiltered).

## Slice B — deducible aggregate + net 303

- [ ] **B1 — `computeInputVat`** (`packages/reporting/src/input-vat.ts`): reads `purchase_invoice_vat` ⋈ `purchase_invoices`, `regime = 'general'` (D4 — `equivalence_surcharge` excluded), bucketed by `received_on` in the calendar month, grouped by `rate` (and `kind`), summing `base` and `cuota × deductible_proportion / 100`. Reuse `aggregateVatByRate`'s shape if it generalises cleanly; else a sibling core — do NOT force a bad reuse. Return per-rate + per-kind (ordinary vs capital) so Slice C can split casilla 28/29 vs 30/31.
- [ ] **B2 — extend `computeVatReturn`** to return `{ devengado, deducible, resultado }` (`resultado` = régimen-general result, casilla 46 = 27 − 45). ADD fields; do not rename the existing ones (#76's tests pin the shape). Update `types.ts`.
- [ ] **B3 — exactness test** (difference-method): a catalogue of invoices whose per-rate cuota is the filed value (not `round(base×rate)`) and assert the aggregate sums those exactly, at month level. Prove by deletion (swap to re-rounding → red).
- [ ] **B4 — demo:** extend `apps/server/scripts/modelo-303-demo.ts` (or a sibling) to seed purchase invoices and reconcile `devengado − deducible = resultado` end-to-end.
- [ ] **B5 — verify:** `@waitron/reporting` `test:coverage` green; the existing #76 `computeVatReturn` suite stays green (behaviour-preserving extension).

## Slice C — the modelo 303 casilla map

- [ ] **C1 — `Modelo303` structure** (`packages/reporting/src/modelo-303.ts`): a function mapping the `computeVatReturn` result onto the official boxes per spec §7 — devengado 01–09 + 150/151/152; deducible 28/29 (`kind=ordinary`) + 30/31 (`kind=capital`); totals 27, 45; result 46, 64, 65 (=100 for a common-territory deli), 66, 69, 71. **USE ONLY THE VERIFIED CASILLA NUMBERS** from spec §7 / the DR303 research (see below). The `[UNVERIFIED]` items — casilla 27 & 45 exact summation box-lists, casilla 67's status — MUST be resolved from the DR303 research artefact before they are hardcoded; if still unresolved, leave a clearly-marked TODO with the verified subset and do NOT invent them.
- [ ] **C2 — tests:** a worked example (base/cuota per rate → expected box values), the 46 = 27 − 45 arithmetic, the `kind`→box split. No `[UNVERIFIED]` number asserted as fact.
- [ ] **C3 — verify:** `@waitron/reporting` `test:coverage` green.

## Slice D — DR303 file writer (CONDITIONAL — gated on the record-design)

A research agent is fetching the official **DR303 diseño de registro** (field positions/lengths). **Do NOT start D until that returns.**
- **If the byte layout is VERIFIED:** `packages/reporting/src/dr303.ts` — a `Modelo303 → DR303 record` serializer (ISO-8859-1, fixed positions transcribed verbatim from the record-design, cited), with a fixture round-trip test. The layout constant carries a provenance comment citing the DR303 source.
- **If the layout could NOT be verified:** do NOT fabricate positions. Ship the serializer *framework* with the layout table as an explicitly-flagged `UNVERIFIED` constant (or defer D entirely), and say so plainly in the PR — the file is NOT submission-ready until a human transcribes the DR303 record-design.

## Finish

- [ ] Four-command gate + `test:coverage` per changed package; `inmutabilidad` green; fiscal boundary (H2) grep-confirmed; no `verifactu`/`fiscal-verifactu` source touched (only the vocabulary-scope pin).
- [ ] finish-branch: whole-branch review (incl. a **fiscal-correctness** lens: casilla numbers vs the cited sources, exactness, RLS/immutability) → fix wave → simplify → Copilot → PR. Do NOT merge (owner's `/land-branch`).
- **Deferred (spec §11):** intra-community/import boxes (32–39), rectificación de deducciones (40/41) beyond the schema seam, bienes-de-inversión regularización (43), prorrata (44), recargo output boxes, quarterly/annual, the 4-year carry-forward + compensation (78), the purchase-invoice authoring UI, OCR/supplier-feed capture.
