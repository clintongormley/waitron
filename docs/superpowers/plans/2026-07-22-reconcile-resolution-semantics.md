# Reconcile Resolution Semantics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `reconcile`'s per-sweep incident-raising for the two non-converging cases with real resolution semantics — recognize a voided sale's `Anulada` (no incident), auto-remediate a `noTrace` record by re-submitting it (bounded, self-healing), and de-dup the rare residual incidents — so a future periodic scheduler cannot flood `incidents`.

**Architecture:** `reconcile`'s T2 classification loop (packages/fiscal-verifactu/src/reconcile.ts) gains: (a) a sibling-anulación check that treats an AEAT `Anulada` as clean when we hold the local anulación; (b) a `noTrace` lifecycle driven by a new `envios.reconciled_resubmit_at` marker — reset-to-`pendiente` on first detection (drainer re-submits, idempotent via error-3000), escalate to an incident only if still missing after remediation, clear the marker when AEAT has a trace again; (c) a shared `recordIncidentOnce` (`@waitron/core`) that raises only if no unacknowledged incident already exists for `(tenant_id, till_id, code, sale_id)`.

**Tech Stack:** TypeScript (ESM, `.js` specifiers), Drizzle ORM + drizzle-kit migrations, PostgreSQL (PGlite for unit logic; real Postgres for RLS/migration), Vitest.

**Design spec:** [`docs/superpowers/specs/2026-07-22-reconcile-resolution-semantics-design.md`](../specs/2026-07-22-reconcile-resolution-semantics-design.md). Read it first. Section refs (§N) point there.

**Prerequisite:** plan 3b landed (`main` at/after `b179177`). `reconcile(tenantId, period)`, the three audit cases, `acks` + `writeAck`, and the ack↔estado invariant are on `main`.

## Global Constraints

- **`packages/fiscal-verifactu` is guard-EXEMPT** (Spanish identifiers fine); `packages/core` is generic (English-only — but this plan adds no Spanish there).
- **The ack↔estado invariant is load-bearing:** an ack must never disagree with the committed `envios.estado`. Resetting an `aceptado` record to `pendiente` therefore **deletes** its `accepted` ack in the same tx (`ackStateOf('pendiente')` is `null`).
- **Diff on `EstadoRegistro`, not presence; `noTrace` only for accepted records** (§4.3 in-flight tolerance — unchanged from 3b).
- **The consulta network call stays OUTSIDE any DB tx** (unchanged T1/T2 split).
- **TDD, per-test RED phase; ESM `.js` specifiers.** Real Postgres for the migration + reconcile `withTenant`/RLS path; PGlite for unit logic. Per-test isolation (fresh tenants / truncation) — do NOT copy `drain.test.ts`'s shared-db debt.
- **`recordIncidentOnce` assumes no concurrent same-tenant reconcile sweep** (reconcile is invoked once per tenant/period — no SKIP-LOCKED contention like the drainer). A single-statement guarded insert is used; a partial unique index is deliberately NOT added (it would change every incident insert, incl. the drainer's — out of scope, §6).

---

## File Structure

- `packages/fiscal-verifactu/src/schema/envios.ts` — **add** column `reconciledResubmitAt`.
- `packages/fiscal-verifactu/drizzle/0007_*.sql` (generated) + `meta/*` — the column migration.
- `packages/fiscal-verifactu/src/migrations.test.ts` — assert the new column.
- `packages/core/src/incidents.ts` — **add** `recordIncidentOnce`.
- `packages/core/src/incidents.test.ts` — its tests.
- `packages/fiscal-verifactu/src/acks.ts` — **add** `deleteAck`.
- `packages/fiscal-verifactu/src/reconcile.ts` — drift-`Anulada` recognition; the `noTrace` lifecycle; marker clear; residual incidents via `recordIncidentOnce`.
- `packages/fiscal-verifactu/src/reconcile.test.ts` — the scenarios.

---

## Task 1: `envios.reconciled_resubmit_at` column + migration

**Files:**
- Modify: `packages/fiscal-verifactu/src/schema/envios.ts`
- Create (generated): `packages/fiscal-verifactu/drizzle/0007_*.sql` + `drizzle/meta/*`
- Test: `packages/fiscal-verifactu/src/migrations.test.ts`

**Interfaces:**
- Produces: `envios.reconciledResubmitAt` — nullable `timestamptz`, snake_case column `reconciled_resubmit_at`. Read by reconcile's `rowsForPeriod`; written by reconcile's remediation/marker-clear.

- [ ] **Step 1: Add the column to the schema**

In `packages/fiscal-verifactu/src/schema/envios.ts`, inside the `pgTable("envios", { ... })` column block, after `confirmadoEn`, add:

```ts
    // Set by reconcile when it re-submits a `noTrace` record (reset to `pendiente`), so a later
    // sweep can tell "already remediated once, still missing → escalate to an incident" from a
    // first detection. Cleared once AEAT has a trace of the record again. NULL for every record
    // reconcile has never had to remediate. See reconcile.ts's noTrace lifecycle.
    reconciledResubmitAt: timestamp("reconciled_resubmit_at", { withTimezone: true }),
```

(`timestamp` is already imported in this file.)

- [ ] **Step 2: Write the failing migration test**

In `packages/fiscal-verifactu/src/migrations.test.ts`, add (follow the file's existing `createPgliteDb`/`runMigrations`/`CORE_MIGRATIONS`/`FISCAL_MIGRATIONS` helpers — reuse whatever names the file actually uses):

```ts
it("adds envios.reconciled_resubmit_at (nullable)", async () => {
  const db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, FISCAL_MIGRATIONS);
  const cols = await db.execute<{ column_name: string; is_nullable: string }>(sql`
    select column_name, is_nullable from information_schema.columns
    where table_name = 'envios' and column_name = 'reconciled_resubmit_at'`);
  expect(cols.rows).toEqual([{ column_name: "reconciled_resubmit_at", is_nullable: "YES" }]);
  await db.close();
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @waitron/fiscal-verifactu test -- migrations`
Expected: FAIL — the column does not exist yet (empty `cols.rows`).

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @waitron/fiscal-verifactu db:generate`
This emits `drizzle/0007_<name>.sql` containing `ALTER TABLE "envios" ADD COLUMN "reconciled_resubmit_at" timestamp with time zone;` plus the `meta/0007_snapshot.json` + `_journal.json` update. **No custom migration is needed:** confirm `envios` already has a TABLE-level `GRANT ... UPDATE ON envios TO app_user` (read `drizzle/0001_registros_inmutables.sql` — the drainer updates many envios columns, so the grant is table-level, which covers a new column). If — and only if — that grant turns out to be column-restricted, add a one-line custom migration granting UPDATE on the new column; otherwise add nothing.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @waitron/fiscal-verifactu test -- migrations` → PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @waitron/fiscal-verifactu typecheck` → clean.

```bash
git add packages/fiscal-verifactu/src/schema/envios.ts packages/fiscal-verifactu/drizzle packages/fiscal-verifactu/src/migrations.test.ts
git commit -m "feat(fiscal-verifactu): envios.reconciled_resubmit_at column"
```

---

## Task 2: `recordIncidentOnce` — idempotent incident raise

**Files:**
- Modify: `packages/core/src/incidents.ts`
- Test: `packages/core/src/incidents.test.ts`

**Interfaces:**
- Consumes: existing `RecordIncidentInput`, `recordIncident`, the `incidents` table (`@waitron/db`).
- Produces: `recordIncidentOnce(tx: Transaction, input: RecordIncidentInput): Promise<boolean>` — inserts one incident unless an **unacknowledged** incident already exists for `(tenant_id, till_id, code, sale_id)`; returns `true` if it inserted, `false` if it de-duped.

- [ ] **Step 1: Write the failing tests**

In `packages/core/src/incidents.test.ts` (follow the file's existing setup — a real/PGlite db, a tenant+till fixture, and how it builds an `AppError`; mirror the existing `recordIncident` tests):

```ts
describe("recordIncidentOnce", () => {
  it("inserts the first time and returns true", async () => {
    await db.transaction(async (tx) => {
      const inserted = await recordIncidentOnce(tx, {
        tenantId, tillId, saleId, error: new AppError("fiscal.reconcile_no_trace", { registroId: "r1" }),
        severity: "error", detectedAt: new Date("2026-07-22T10:00:00Z"),
      });
      expect(inserted).toBe(true);
      const open = await openIncidents(tx, tillId);
      expect(open).toHaveLength(1);
    });
  });

  it("de-dups a second raise for the same open (till, code, sale) and returns false", async () => {
    await db.transaction(async (tx) => {
      const input = {
        tenantId, tillId, saleId, error: new AppError("fiscal.reconcile_no_trace", { registroId: "r1" }),
        severity: "error" as const, detectedAt: new Date("2026-07-22T10:00:00Z"),
      };
      await recordIncidentOnce(tx, input);
      const second = await recordIncidentOnce(tx, { ...input, detectedAt: new Date("2026-07-22T11:00:00Z") });
      expect(second).toBe(false);
      expect(await openIncidents(tx, tillId)).toHaveLength(1);
    });
  });

  it("raises a fresh one after the prior incident is acknowledged", async () => {
    await db.transaction(async (tx) => {
      const input = {
        tenantId, tillId, saleId, error: new AppError("fiscal.reconcile_no_trace", { registroId: "r1" }),
        severity: "error" as const, detectedAt: new Date("2026-07-22T10:00:00Z"),
      };
      await recordIncidentOnce(tx, input);
      await tx.execute(sql`update incidents set acknowledged_at = now() where till_id = ${tillId}`);
      const again = await recordIncidentOnce(tx, { ...input, detectedAt: new Date("2026-07-22T12:00:00Z") });
      expect(again).toBe(true);
    });
  });

  it("does not de-dup a different code or a different sale", async () => {
    await db.transaction(async (tx) => {
      const base = { tenantId, tillId, saleId, severity: "error" as const, detectedAt: new Date("2026-07-22T10:00:00Z") };
      await recordIncidentOnce(tx, { ...base, error: new AppError("fiscal.reconcile_no_trace", { registroId: "r1" }) });
      const otherCode = await recordIncidentOnce(tx, { ...base, error: new AppError("fiscal.reconcile_drift_anulada", { registroId: "r1" }) });
      expect(otherCode).toBe(true);
      const otherSale = await recordIncidentOnce(tx, { ...base, saleId: otherSaleId, error: new AppError("fiscal.reconcile_no_trace", { registroId: "r2" }) });
      expect(otherSale).toBe(true);
    });
  });
});
```

> Reuse the file's existing `tenantId`/`tillId`/`saleId` fixtures; add an `otherSaleId` if the file doesn't already seed a second sale. Import `recordIncidentOnce`, `openIncidents`, `sql`, `AppError` as the file's other tests do.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/core test -- incidents`
Expected: FAIL — `recordIncidentOnce` is not exported.

- [ ] **Step 3: Implement `recordIncidentOnce`**

In `packages/core/src/incidents.ts`, add after `recordIncident` (the `sql` import from `drizzle-orm` is needed — add it to the existing `drizzle-orm` import if not present):

```ts
/**
 * Like `recordIncident`, but raises AT MOST ONE open incident per `(tenant_id, till_id, code,
 * sale_id)`: a guarded insert that no-ops when an UNACKNOWLEDGED incident for that key already
 * exists, so a periodic caller (reconcile's sweep) that re-detects a still-open condition each pass
 * does not accumulate a duplicate row every time. Returns whether it inserted (`true`) or de-duped
 * (`false`) — the caller counts only real raises. Once the prior incident is acknowledged, the key
 * is free again and the next detection raises afresh (a genuinely-unresolved condition resurfaces).
 *
 * Single-statement `insert … where not exists`: reconcile is invoked once per tenant/period with no
 * concurrent same-tenant sweep (unlike the drainer's SKIP-LOCKED contention), so no partial unique
 * index is needed here — and adding one would change every `recordIncident` insert, the drainer's
 * included. `recordIncident` (the unconditional insert) stays for callers that intend one row per
 * event.
 */
export async function recordIncidentOnce(
  tx: Transaction,
  input: RecordIncidentInput,
): Promise<boolean> {
  const saleId = input.saleId ?? null;
  const { rows } = await tx.execute<{ id: string }>(sql`
    insert into incidents (tenant_id, till_id, sale_id, code, params, severity, detected_at)
    select ${input.tenantId}, ${input.tillId}, ${saleId}, ${input.error.code},
           ${JSON.stringify(input.error.params)}::jsonb, ${input.severity},
           ${input.detectedAt.toISOString()}
    where not exists (
      select 1 from incidents
      where tenant_id = ${input.tenantId} and till_id = ${input.tillId}
        and code = ${input.error.code} and sale_id is not distinct from ${saleId}
        and acknowledged_at is null
    )
    returning id
  `);
  return rows.length > 0;
}
```

> `sale_id is not distinct from ${saleId}` matches a NULL sale to a NULL sale (plain `=` would not) — correct even though reconcile always supplies a non-null `sale_id`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @waitron/core test -- incidents` → PASS.

- [ ] **Step 5: Full core suite + typecheck + lint + commit**

Run: `pnpm --filter @waitron/core test`, `pnpm --filter @waitron/core typecheck`, `pnpm --filter @waitron/core lint`, `pnpm format`.

```bash
git add packages/core/src/incidents.ts packages/core/src/incidents.test.ts
git commit -m "feat(core): recordIncidentOnce — idempotent per-open-condition incident raise"
```

---

## Task 3: reconcile drift-`Anulada` recognition

**Files:**
- Modify: `packages/fiscal-verifactu/src/reconcile.ts`
- Test: `packages/fiscal-verifactu/src/reconcile.test.ts`

**Interfaces:**
- Consumes: `recordIncidentOnce` (`@waitron/core`, Task 2); the existing `PeriodRow`, `REPORTED_DRIFT`, `isDrift`, `mismatchOf`, `correct`, the T2 loop.
- Produces: an AEAT `Anulada` on an alta with a local anulación is treated as **clean** (no drift entry, no incident); an `Anulada` with NO local anulación raises ONE idempotent error incident. A `raiseOnce` helper (wraps `recordIncidentOnce`) and a `hasSiblingAnulacion` helper.

- [ ] **Step 1: Write the failing tests**

In `packages/fiscal-verifactu/src/reconcile.test.ts` (reuse the file's seeding helpers + the fake AEAT's `setConsultaState`; a voided sale = seed an alta accepted, then a sibling anulación via `seedSale`/`altaFor`/`anulacionFor` or the drainer, however the file already creates an anulación registro sharing the alta's `sale_id`):

```ts
it("drift-Anulada with a local anulacion is clean — no drift entry, no incident", async () => {
  // Seed an alta (aceptado) and a sibling anulacion for the SAME sale; AEAT reports the alta Anulada.
  // reconcile -> the alta is NOT in result.drift, and no incident row exists.
  // (assert result.drift is empty for the alta, result.incidentsRaised === 0, and openIncidents empty)
});

it("drift-Anulada with NO local anulacion raises one error incident (anomalous path)", async () => {
  // Seed an alta (aceptado) with NO anulacion; force AEAT to report it Anulada (setConsultaState).
  // reconcile -> alta in result.drift, one error incident (fiscal.reconcile_drift_anulada).
  // Second reconcile sweep -> still one incident row (idempotent, not two).
});
```

> Fill the bodies against the file's real fixtures. The first test needs a genuine sibling anulación registro (same `sale_id`, `tipo_registro='anulacion'`) — create it the way `void-path` / `recordVoid` tests in this package do, or by a direct seed. The second test asserts idempotency across two sweeps (this is why it uses `recordIncidentOnce`).

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/fiscal-verifactu test -- reconcile`
Expected: FAIL — the alta-with-anulación is currently flagged drift-Anulada + incident; the anomalous path currently uses `raise` (would insert twice across two sweeps).

- [ ] **Step 3: Add the helpers**

In `packages/fiscal-verifactu/src/reconcile.ts`, add `recordIncidentOnce` to the `@waitron/core` import, then add these helpers (near `raise`):

```ts
/** True when a local anulación registro exists for this record's sale — the expected state after a
 * `recordVoid` (the anulación shares the alta's `sale_id`, `tipo_registro='anulacion'`). Not
 * period-scoped: an anulación's expedition date may differ from its alta's. */
async function hasSiblingAnulacion(tx: Transaction, row: PeriodRow): Promise<boolean> {
  const { rows } = await tx.execute<{ one: number }>(sql`
    select 1 as one from registros_facturacion
    where sale_id = ${row.sale_id} and tenant_id = ${row.tenant_id} and tipo_registro = 'anulacion'
    limit 1
  `);
  return rows.length > 0;
}

/** `raise`, but idempotent per open `(till, code, sale)` via `recordIncidentOnce`. Returns whether a
 * new incident was actually inserted, so the caller only counts real raises. Used for the two
 * residual reconcile incidents (anomalous drift-`Anulada`, persistent `noTrace`) that a sweep can
 * re-detect while still open. */
async function raiseOnce(
  tx: Transaction,
  row: PeriodRow,
  severity: IncidentSeverity,
  code: "fiscal.reconcile_no_trace" | "fiscal.reconcile_drift_anulada",
  detectedAt: Date,
): Promise<boolean> {
  return recordIncidentOnce(tx, {
    tenantId: row.tenant_id as TenantId,
    tillId: row.till_id as TillId,
    saleId: row.sale_id as SaleId,
    error: new AppError(code, {
      registroId: row.id,
      idEmisorFactura: row.id_emisor_factura,
      numSerieFactura: row.num_serie_factura,
      fechaExpedicionFactura: row.fecha_expedicion_factura,
    }),
    severity,
    detectedAt,
  });
}
```

- [ ] **Step 4: Rework the drift branch of the T2 loop**

In `reconcile.ts`, replace the current drift block (the `const drift = REPORTED_DRIFT[reported]; if (drift !== undefined && isDrift(...)) { push; raise; correct }` at ~lines 215-223) with:

```ts
      const drift = REPORTED_DRIFT[reported];
      if (drift !== undefined && isDrift(row.estado, reported)) {
        if (reported === "Anulada" && (await hasSiblingAnulacion(tx, row))) {
          // The expected state of a voided sale: AEAT marks the alta Anulada once it accepts the
          // anulación we submitted, while the alta's own envío stays `aceptado`. We hold the local
          // anulación, so this is agreement, not drift — no entry, no incident, no correction.
          continue;
        }
        result.drift.push(mismatchOf(row, reported));
        if (reported === "Anulada") {
          // Anomalous: AEAT reports Anulada with NO local anulación (near-impossible — AEAT never
          // annuls on its own). Idempotent, since a persistent Anulada would re-detect each sweep.
          if (await raiseOnce(tx, row, drift.severity, "fiscal.reconcile_drift_anulada", detectedAt)) {
            result.incidentsRaised += 1;
          }
        } else {
          // drift-AceptadaConErrores: converges (isDrift makes it agree after correction), so it is
          // raised at most once per genuine clean→errors transition — the unconditional `raise`.
          await raise(tx, row, drift.severity, drift.code, detectedAt);
          result.incidentsRaised += 1;
          await correct(tx, row, reported, detectedAt);
        }
      }
```

> Note: `Anulada` never runs `correct` (it is not in `CORRECTION`), so dropping the `correct` call from the Anulada branch changes nothing. drift-`AceptadaConErrores` keeps its `correct`.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @waitron/fiscal-verifactu test -- reconcile` → PASS (incl. the existing drift-AceptadaConErrores + two-sweep-convergence tests, unchanged).

- [ ] **Step 6: Full package + typecheck + lint + commit**

Run: `pnpm --filter @waitron/fiscal-verifactu test`, `typecheck`, `lint`, `pnpm format`.

```bash
git add packages/fiscal-verifactu/src/reconcile.ts packages/fiscal-verifactu/src/reconcile.test.ts
git commit -m "feat(fiscal-verifactu): reconcile recognizes a voided sale's Anulada as clean"
```

---

## Task 4: reconcile `noTrace` remediation lifecycle

**Files:**
- Modify: `packages/fiscal-verifactu/src/acks.ts` (add `deleteAck`), `packages/fiscal-verifactu/src/reconcile.ts`
- Test: `packages/fiscal-verifactu/src/reconcile.test.ts`

**Interfaces:**
- Consumes: `envios.reconciledResubmitAt` (Task 1); `raiseOnce` (Task 3); `writeAck` + new `deleteAck` (acks.ts).
- Produces: on `noTrace`, first detection resets the record to `pendiente` (clears delivery cols, sets `reconciled_resubmit_at=now`, deletes the stale ack) — no incident; a subsequent `noTrace` with the marker set raises one idempotent error incident and does NOT reset again; an accepted record AEAT has a trace of clears the marker. `deleteAck(tx, registroId)`; `remediateNoTrace`, `clearReconciledMarker` helpers.

- [ ] **Step 1: Add `deleteAck` to acks.ts + its test**

In `packages/fiscal-verifactu/src/acks.ts`, add (near `writeAck`):

```ts
/** Removes a record's ack row. Used when reconcile resets an `aceptado` record to `pendiente` (a
 * `noTrace` remediation): `ackStateOf('pendiente')` is null, so the record must carry NO ack, or the
 * committed ack would disagree with the estado (the acks invariant). The drainer writes a fresh ack
 * when it re-accepts the record. Idempotent — deleting an absent ack is a no-op. */
export async function deleteAck(tx: Transaction, registroId: string): Promise<void> {
  await tx.execute(sql`delete from acks where registro_id = ${registroId}`);
}
```

- [ ] **Step 2: Extend `PeriodRow` + `rowsForPeriod` to read the marker**

In `reconcile.ts`, add to the `PeriodRow` type: `reconciled_resubmit_at: string | null;`. In `rowsForPeriod`'s SQL `select`, add `e.reconciled_resubmit_at` (alongside `e.estado`):

```ts
    select
      r.id, r.tenant_id, r.till_id, r.sale_id,
      e.estado, e.reconciled_resubmit_at,
      r.id_emisor_factura, r.nombre_razon_emisor, r.num_serie_factura,
      to_char(r.fecha_expedicion_factura, 'DD-MM-YYYY') as fecha_expedicion_factura
```

- [ ] **Step 3: Write the failing tests**

In `reconcile.test.ts`:

```ts
it("noTrace first detection: resets to pendiente, deletes the ack, sets the marker, no incident", async () => {
  // Seed an accepted record with an `accepted` ack; AEAT reports NO trace (forget/never-store).
  // reconcile -> envios.estado='pendiente', reconciled_resubmit_at set, NO acks row, NO incident,
  //   and result.noTrace contains it.
});

it("noTrace already remediated (marker set) and still missing: raises one idempotent error incident, no re-reset", async () => {
  // Seed an accepted record whose reconciled_resubmit_at is already set; AEAT no trace.
  // reconcile -> one fiscal.reconcile_no_trace incident; estado stays as-is (not reset again).
  // Second sweep -> still one incident (idempotent).
});

it("ack↔estado invariant holds across a noTrace reset", async () => {
  // After the first-detection reset: assert there is no `accepted` acks row for a `pendiente` row
  // (i.e. no ack disagreeing with the estado at the committed point).
});

it("a record AEAT has a trace of clears a set marker", async () => {
  // Seed an accepted record with reconciled_resubmit_at set; AEAT reports it Correcta (present).
  // reconcile -> reconciled_resubmit_at is now NULL (marker cleared); no incident.
});
```

> Fill against the file's fixtures. Drive AEAT's no-trace with the fake's `forget`/never-store; drive Correcta with a normal stored record. Set `reconciled_resubmit_at` directly via a `tx.execute(sql\`update envios set reconciled_resubmit_at = ...\`)` seed where a test needs the "already remediated" precondition.

- [ ] **Step 4: Run to verify it fails**

Run: `pnpm --filter @waitron/fiscal-verifactu test -- reconcile`
Expected: FAIL — noTrace currently always raises an incident and never resets/deletes-ack/clears-marker.

- [ ] **Step 5: Add the reconcile helpers**

In `reconcile.ts`, import `deleteAck` from `./acks.js` (alongside `writeAck`), and add:

```ts
/** First-detection `noTrace` remediation: reset the record to `pendiente` so the drainer re-submits
 * it (idempotent via error-3000 — see design §2.2), clearing the delivery columns and stamping
 * `reconciled_resubmit_at` so a later sweep can tell this from a first detection. Deletes the stale
 * `accepted` ack in the same tx (the acks invariant — a `pendiente` row carries no ack). No incident:
 * a first `noTrace` is usually just consulta lag, and this self-heals silently. */
async function remediateNoTrace(tx: Transaction, row: PeriodRow, now: Date): Promise<void> {
  await tx.execute(sql`
    update envios set
      estado = 'pendiente',
      csv = null,
      confirmado_en = null,
      codigo_error = null,
      mensaje_error = null,
      proximo_intento_en = ${now.toISOString()},
      reconciled_resubmit_at = ${now.toISOString()}
    where registro_id = ${row.id} and tenant_id = ${row.tenant_id}
  `);
  await deleteAck(tx, row.id);
}

/** Clears the `noTrace` remediation marker once AEAT has a trace of the record again — the
 * re-submission worked, so a FUTURE recurrence should remediate afresh rather than escalate. Guarded
 * by the caller on `reconciled_resubmit_at !== null`, so this only runs on a record that was
 * remediated. */
async function clearReconciledMarker(tx: Transaction, row: PeriodRow): Promise<void> {
  await tx.execute(sql`
    update envios set reconciled_resubmit_at = null
    where registro_id = ${row.id} and tenant_id = ${row.tenant_id}
  `);
}
```

- [ ] **Step 6: Rework the noTrace branch + add the marker clear**

In the T2 loop, replace the current `noTrace` block (the `if (reported === null) { push; raise; incidentsRaised++; continue; }` at ~lines 209-213) with:

```ts
      // We believe accepted.
      if (reported === null) {
        result.noTrace.push(mismatchOf(row, null));
        if (row.reconciled_resubmit_at === null) {
          // First detection — remediate silently: re-submit (reset to pendiente) and drop the stale
          // ack. Usually just consulta lag; self-heals on the next drain. No incident yet.
          await remediateNoTrace(tx, row, detectedAt);
        } else {
          // Already re-submitted once and STILL absent → a genuine, un-self-healing gap → escalate
          // to an idempotent error incident; do NOT reset again (no loop).
          if (await raiseOnce(tx, row, "error", "fiscal.reconcile_no_trace", detectedAt)) {
            result.incidentsRaised += 1;
          }
        }
        continue;
      }

      // reported !== null: AEAT has a trace of this record, so any prior noTrace remediation
      // succeeded — clear the marker so a future recurrence remediates afresh.
      if (row.reconciled_resubmit_at !== null) {
        await clearReconciledMarker(tx, row);
      }
```

> This sits between the `if (!ACEPTADO.has(row.estado)) continue;` guard and the drift block (Task 3's). The marker clear runs for every accepted row AEAT has a trace of — clean OR drift — because in both cases the `noTrace` condition is resolved.

- [ ] **Step 7: Run to verify it passes**

Run: `pnpm --filter @waitron/fiscal-verifactu test -- reconcile` → PASS.

- [ ] **Step 8: Full package (Docker up for real-PG) + typecheck + lint + format + commit**

Run: `pnpm --filter @waitron/fiscal-verifactu test`, `typecheck`, `lint`, `pnpm format`.

```bash
git add packages/fiscal-verifactu/src/acks.ts packages/fiscal-verifactu/src/reconcile.ts packages/fiscal-verifactu/src/reconcile.test.ts
git commit -m "feat(fiscal-verifactu): reconcile noTrace auto-remediation lifecycle"
```

---

## Final verification (before the PR)

- [ ] `pnpm -r test` green (Docker up for real-Postgres suites), `pnpm -r typecheck && pnpm -r lint`, `pnpm format:check` clean.
- [ ] Teeth: drift-Anulada-with-anulación → clean (no incident); drift-Anulada-without → one incident, idempotent across two sweeps; noTrace first detection → reset + ack deleted + marker set + no incident; noTrace already-remediated → one idempotent incident, no re-reset; a record AEAT has a trace of clears the marker; the ack↔estado invariant holds across a reset.
- [ ] `@waitron/verifactu` mutation unaffected (this plan does not touch `packages/verifactu`).
- [ ] Diff within the Copilot 20k cap.

## Self-Review

- **Spec coverage:** §4.1 per-case → Tasks 3 (drift-Anulada) + 4 (noTrace); §4.2 noTrace lifecycle → Tasks 1 (column) + 4; §4.3 recordIncidentOnce → Task 2 (+ used in 3/4); §5 schema → Task 1; §7 testing → each task's tests. All covered.
- **Type consistency:** `recordIncidentOnce(tx, RecordIncidentInput): Promise<boolean>` used identically in Task 2 (def), Task 3 (`raiseOnce`), Task 4 (noTrace escalate). `reconciledResubmitAt`/`reconciled_resubmit_at` consistent across Tasks 1/4. `deleteAck(tx, registroId)` def + use in Task 4. `PeriodRow.reconciled_resubmit_at` added in Task 4 Step 2, read in Step 6.
- **No placeholders:** every code step carries real code; the two reconcile.test.ts test bodies in Tasks 3/4 are described with exact assertions to fill against the file's real fixtures (the fixtures are file-specific, so the plan names them rather than guessing their signatures).
