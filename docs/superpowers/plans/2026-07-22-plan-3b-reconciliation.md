# Plan 3b — Reconciliation + Acks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `reconcile(period)` — a periodic independent audit that sweeps AEAT's consulta records for one `PeriodoImputacion`, diffs them against local `envios`, and reports the three cases (lost-ack, no-trace, drift) — plus the ack contract, its state machine, and a durable in-process outbox transport.

**Architecture:** `reconcile` pages AEAT's consulta via `ClavePaginacion`, matches results to our rows by the `RefExterna` (= registro id) 3a stamped, and diffs on `EstadoRegistro` (never mere presence). Acks propagate true AEAT-acceptance state (from `envios.estado`) downstream; 3b delivers the contract + state machine + a durable `acks` table transport, tested in-process — **not** the sub-project-9 wire protocol. Built and tested against 3a's fake AEAT (extended to paginate + echo `RefExterna`).

**Tech Stack:** TypeScript (ESM, `.js` specifiers), Drizzle ORM + drizzle-kit migrations, PostgreSQL (PGlite unit; real Postgres for RLS), Vitest, Stryker (mutation, `@waitron/verifactu` only).

**Design spec:** [`docs/superpowers/specs/2026-07-22-plan-3b-reconciliation-design.md`](../specs/2026-07-22-plan-3b-reconciliation-design.md). Read it first. Section refs (§N) point there.

**Prerequisite:** plan 3a landed (`main` at/after `7ff11f3`). The drainer, `envios` estado transitions, `RefExterna` stamp, and the fake AEAT (with a consulta path) are on `main`. `reconcile(period)` is the reserved-but-absent `FiscalBackend` name.

## Global Constraints

- **Consulta and submission enums are NEVER shared.** Reconcile reads `EstadoRegistroConsulta` (`"Correcta" | "AceptadaConErrores" | "Anulada"` — no `Incorrecta`); it must NOT route consulta results through 3a's `resolveEstadoEfectivo` (submission-scoped).
- **`PeriodoImputacion` is the query unit** — `{ ejercicio: string; periodo: string }`, derived from the record's expedition month (our records carry no `FechaOperacion`; verified against `Descripcion_SWeb` v1.0.3 §6.4, §2).
- **Diff on `EstadoRegistro`, not presence** — an `AceptadaConErrores`/`Anulada` record still appears in results; presence is not proof of a live clean record.
- **Presentation-date ordering** — results order by fecha de presentación; a sweep concurrent with the drainer can page past new records. `noTrace` is asserted ONLY for records we believe **accepted**, never `pendiente` (may be unpaged/in-flight).
- **The ack carries the CSV** — consulta can never return it (§2); the ack row is written **atomically with the estado that produces it** (drainer persist tx / reconcile correction tx).
- **`packages/fiscal` stays regime-neutral** (English-only guard; `@waitron/db` english-only test) — `ReconcileResult`/`AckState` field names + doc comments name no Spanish token or authority. (3a's `enviosSent`→`batchesSent` lesson.)
- **`@waitron/verifactu` 90% mutation gate** — the fake-AEAT changes must keep it ≥90%.
- **Real Postgres, not PGlite, for RLS** (superuser bypasses RLS); PGlite for unit logic. Per-test red phase. **Never a production NIF.** ESM `.js` specifiers.
- **Out of scope:** the scheduler (`apps/*`); the wire protocol (sub-project 9); a wired-up till client. The distributed unsent-count is contract-only here.

---

## File Structure

**`packages/verifactu`:** modify `src/testing/fake-aeat.ts` (+ its test) — consulta pagination, `RefExterna` echo, stored-state hooks.

**`packages/fiscal-verifactu`:**
- Create `src/schema/acks.ts` + migration — the `acks` outbox table.
- Create `src/reconcile.ts` (+ `reconcile.test.ts`) — the sweep.
- Create `src/acks.ts` (+ `acks.test.ts`) — the ack contract, durable transport, in-process consumer.
- Modify `src/drain.ts` — write the ack row in the persist tx.
- Modify `src/backend.ts` — `reconcile` delegating to `reconcile.ts`.

**`packages/fiscal`:** modify `src/backend.ts` (`reconcile` + `ReconcileResult` + `AckState`), `src/index.ts` (exports), `src/testing/fake-backend.ts` (`FakeFiscalBackend.reconcile`).

---

## Task 1: Fake AEAT — consulta pagination + RefExterna echo + stored-state hooks

`reconcile`'s tests need the fake to actually paginate, echo `RefExterna`, and expose stored records in each consulta state. All in `packages/verifactu/src/testing/fake-aeat.ts` (extended, not a second fake).

**Files:** Modify `packages/verifactu/src/testing/fake-aeat.ts`, `packages/verifactu/src/testing/fake-aeat.test.ts`.

**Interfaces:**
- Consumes: existing `createFakeAeat`, `StoredRecord` (has `refExterna`, `estado`, `huella`, `key`), `keyOfIdentity`, `parseConsulta` (`../xml/parse-request.js`).
- Produces: `handleConsulta` now paginates + echoes `RefExterna`; new hooks `setConsultaState(key, estado: "Correcta"|"AceptadaConErrores"|"Anulada")` and `forget(key)` (evict a stored record → drives `noTrace`); a `consultaPageSize?: number` option (default a small N, e.g. 2, so multi-page fixtures are cheap).

- [ ] **Step 1: Write the failing tests — pagination + RefExterna echo + state hooks**

```ts
// in fake-aeat.test.ts
it("paginates consulta results via ClavePaginacion, ordered by insertion (presentation-date stand-in)", async () => {
  const aeat = createFakeAeat({ consultaPageSize: 2 });
  for (const n of ["A/1", "A/2", "A/3"]) {
    await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture(n) }]); // altaFixture sets RefExterna via record? see note
  }
  const page1 = await aeat.client().consultar(cabecera, { Ejercicio: "2026", Periodo: "07" });
  expect(page1.registros).toHaveLength(2);
  expect(page1.IndicadorPaginacion).toBe("S");
  expect(page1.ClavePaginacion).toBeDefined();
  const page2 = await aeat.client().consultar(cabecera, { Ejercicio: "2026", Periodo: "07", ClavePaginacion: page1.ClavePaginacion });
  expect(page2.registros).toHaveLength(1);
  expect(page2.IndicadorPaginacion).toBe("N");
});

it("echoes RefExterna in the consulta DatosRegistroFacturacion", async () => {
  const aeat = createFakeAeat();
  const alta = altaFixture("A/1"); alta.RefExterna = "reg-uuid-1";
  await aeat.client().submit(cabecera, [{ RegistroAlta: alta }]);
  const r = await aeat.client().consultar(cabecera, { Ejercicio: "2026", Periodo: "07", NumSerieFactura: "A/1" });
  expect((r.registros[0].DatosRegistroFacturacion as { RefExterna?: string }).RefExterna).toBe("reg-uuid-1");
});

it("setConsultaState/forget drive the drift and no-trace cases", async () => {
  const aeat = createFakeAeat();
  const alta = altaFixture("A/1"); alta.RefExterna = "reg-uuid-1";
  await aeat.client().submit(cabecera, [{ RegistroAlta: alta }]);
  aeat.setConsultaState(keyOf(alta), "AceptadaConErrores");
  let r = await aeat.client().consultar(cabecera, { Ejercicio: "2026", Periodo: "07", NumSerieFactura: "A/1" });
  expect(r.registros[0].EstadoRegistro).toBe("AceptadaConErrores");
  aeat.forget(keyOf(alta));
  r = await aeat.client().consultar(cabecera, { Ejercicio: "2026", Periodo: "07", NumSerieFactura: "A/1" });
  expect(r.ResultadoConsulta).toBe("SinDatos");
});
```

> Note: confirm how `altaFixture`/`RefExterna` is set in the existing fake tests; the fake stores `refExterna` off the submitted record, so submit with `RegistroAlta.RefExterna` populated. Reuse the file's existing `cabecera`/`altaFixture` helpers.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/verifactu test -- fake-aeat`
Expected: FAIL — no pagination (`IndicadorPaginacion` hardcoded `N`), no `RefExterna` in consulta `DatosRegistroFacturacion`, no `setConsultaState`/`forget`.

- [ ] **Step 3: Implement**

In `fake-aeat.ts`: add a per-instance `consultaPageSize` (from options, default 2 or a chosen small N); track stored records in insertion order (the `store` Map already preserves insertion order — rely on it). Rework `handleConsulta`:

```ts
function handleConsulta(xml: string): string {
  const { filtro } = parseConsulta(xml);
  // Apply the optional filters the reconcile sweep uses (period is the mandatory unit; NumSerie is a
  // narrowing filter for single-record probes). All stored records are in-period for the fake's
  // fixtures, so the period is not re-derived here — the fixtures control which records exist.
  let all = [...store.values()];
  if (filtro.NumSerieFactura !== undefined) all = all.filter((s) => s.key.split("|")[1] === filtro.NumSerieFactura);
  // Continue after ClavePaginacion (match by the last-returned identity), ordered by insertion.
  if (filtro.ClavePaginacion !== undefined) {
    const afterKey = `${filtro.ClavePaginacion.IDEmisorFactura}|${filtro.ClavePaginacion.NumSerieFactura}|${filtro.ClavePaginacion.FechaExpedicionFactura}`;
    const idx = all.findIndex((s) => s.key === afterKey);
    all = idx >= 0 ? all.slice(idx + 1) : all;
  }
  const page = all.slice(0, consultaPageSize);
  const more = all.length > consultaPageSize;
  return consultaEnvelope(page, more);
}
```

Extend `consultaEnvelope(matches, more)` to: set `IndicadorPaginacion` `S`/`N` from `more`; when `more`, emit `<sfRC:ClavePaginacion>` from the last record's identity; and add `<sf:RefExterna>` inside `DatosRegistroFacturacion` when the record has one. Use `s.estado` (the `EstadoRegistroConsulta` value) for `<sf:EstadoRegistro>` — driven by `setConsultaState`. Add the hooks:

```ts
setConsultaState: (key, estado) => { const s = store.get(key); if (s) s.estado = estado; },
forget: (key) => { store.delete(key); },
```

(`StoredRecord.estado` is already the `"Correcta" | "AceptadaConErrores" | "Anulada"` union — `setConsultaState` reuses it; `annul` from 3a is the `Anulada` special case.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @waitron/verifactu test -- fake-aeat` → PASS.

- [ ] **Step 5: Full suite + mutation gate**

Run: `pnpm --filter @waitron/verifactu test`, `typecheck`, `lint`, `pnpm format`, and **`pnpm --filter @waitron/verifactu mutation`** (≥90% — the new pagination/echo branches need the tests above to kill their mutants).

- [ ] **Step 6: Commit**

```bash
git add packages/verifactu/src/testing/fake-aeat.ts packages/verifactu/src/testing/fake-aeat.test.ts
git commit -m "feat(verifactu): fake AEAT — consulta pagination + RefExterna echo + state hooks"
```

---

## Task 2: `acks` outbox table + migration

The durable transport backing (§8). Mirrors the `envios`/`envio_flujo` sidecar + RLS convention.

**Files:** Create `packages/fiscal-verifactu/src/schema/acks.ts`; modify `src/schema/index.ts`; create `drizzle/NNNN_*.sql` (generated) + custom RLS migration; test in `migrations.test.ts`.

**Interfaces:** Produces `acks` table — `registroId` (uuid PK, FK `registros_facturacion.id`), `tenantId` (uuid NOT NULL, FK `tenants.id`), `submittedAt` (timestamptz NOT NULL), `csv` (text nullable), `state` (text NOT NULL, CHECK `accepted|accepted_with_errors|rejected|halted`), `deliveredAt` (timestamptz nullable). RLS enabled + tenant policy.

- [ ] **Step 1: Write the schema**

```ts
// packages/fiscal-verifactu/src/schema/acks.ts
import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "@waitron/db";
import { registrosFacturacion } from "./registros.js";

/**
 * The ack OUTBOX — 1:1 with a registro, holding the AEAT-acceptance state to propagate downstream
 * (the till counts records not yet accepted by AEAT). Written atomically with the estado that
 * produces it (the drainer's persist tx / reconcile's correction tx), so an ack never disagrees
 * with the committed envios.estado/csv it reflects. `csv` rides here because consulta can never
 * return it. In-process transport only — the wire protocol is sub-project 9.
 */
export const acks = pgTable(
  "acks",
  {
    registroId: uuid("registro_id").primaryKey().references(() => registrosFacturacion.id),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
    csv: text("csv"),
    state: text("state").notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (t) => [
    check("acks_state_ck", sql`${t.state} in ('accepted', 'accepted_with_errors', 'rejected', 'halted')`),
  ],
).enableRLS();
```

- [ ] **Step 2: Export + generate migration + RLS policy**

Export `acks` from `src/schema/index.ts`. Run `pnpm --filter @waitron/fiscal-verifactu db:generate`. Add the tenant-isolation RLS policy + grants via a custom migration, **replicating the exact convention Task 4 of plan 3a used for `envio_flujo`** (read `drizzle/0003_envio_flujo_rls.sql` / `0001_registros_inmutables.sql`: FORCE RLS + `CREATE POLICY … USING (tenant_id = current_tenant_id())` + `REVOKE ALL … GRANT SELECT, INSERT, UPDATE … TO app_user`). The drainer/consumer read+write acks as `app_user` inside `withTenant`.

- [ ] **Step 3: Migration test**

```ts
it("creates acks with tenant PK-less state CHECK and RLS", async () => {
  const db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS); await runMigrations(db, FISCAL_MIGRATIONS);
  const cols = await db.execute<{ column_name: string; is_nullable: string }>(sql`
    select column_name, is_nullable from information_schema.columns where table_name = 'acks'`);
  const by = Object.fromEntries(cols.rows.map((c) => [c.column_name, c.is_nullable]));
  expect(by).toMatchObject({ registro_id: "NO", tenant_id: "NO", submitted_at: "NO", state: "NO", delivered_at: "YES", csv: "YES" });
  await db.close();
});
```
Mirror plan-3a Task 4's by-value RLS-policy assertion (predicate + FORCE flags) and update `schema-ownership.test.ts` / `inmutabilidad.test.ts` guard lists for the new table.

- [ ] **Step 4: Run RED→GREEN, typecheck; Step 5: Commit**

```bash
git add packages/fiscal-verifactu/src/schema/acks.ts packages/fiscal-verifactu/src/schema/index.ts packages/fiscal-verifactu/drizzle packages/fiscal-verifactu/src/migrations.test.ts packages/fiscal-verifactu/src/schema-ownership.test.ts packages/fiscal-verifactu/src/inmutabilidad.test.ts
git commit -m "feat(fiscal-verifactu): acks outbox table + migration"
```

---

## Task 3: The reconcile surface — interface, `ReconcileResult`, `AckState`, both fakes

Adds `reconcile` to `FiscalBackend` with compiling minimal impls, so the real logic (Tasks 4-5) has a stable surface. Mirrors plan-3a's Task 5.

**Files:** Modify `packages/fiscal/src/backend.ts`, `src/index.ts`, `src/testing/fake-backend.ts` (+ test); modify `packages/fiscal-verifactu/src/backend.ts` (minimal `reconcile`).

**Interfaces:** Produces on `FiscalBackend`:
```ts
export type AckState = "accepted" | "accepted_with_errors" | "rejected" | "halted";
export interface ReconcileMismatch {
  registroId: string;
  idFactura: { emisor: string; numSerie: string; fechaExpedicion: string };
  localState: string;                 // our envios.estado, read as an opaque string here
  authorityState: string | null;      // EstadoRegistroConsulta value, or null = no trace
}
export interface ReconcileResult {
  ejercicio: string; periodo: string;
  checked: number;
  lostAck: ReconcileMismatch[];
  noTrace: ReconcileMismatch[];
  drift: ReconcileMismatch[];
  incidentsRaised: number;
}
// on FiscalBackend (explicit tenantId, per pendingCount's precedent — reconcile runs outside any
// sale tx and establishes its own withTenant scope; no tillId — reconciliation is per obligado):
reconcile(tenantId: TenantId, period: { ejercicio: string; periodo: string }): Promise<ReconcileResult>;
```
> **Regime-neutrality:** field names are English (`localState`/`authorityState`, not `estado`; `idFactura` uses `emisor`/`numSerie`/`fechaExpedicion`, not the Spanish `IDEmisorFactura`); doc comments name no authority. Run the `@waitron/db english-only` guard after (as 3a's rename lesson requires).

- [ ] **Step 1: Failing test** — `FakeFiscalBackend.reconcile` returns a clean audit (empty lists) for a period with matching records; a seeded mismatch appears in the right list. (Follow the fake-backend test setup; the fake reconciles its `fake_fiscal_records` against an injectable authority view — see Step 4.)
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3:** Add `AckState`/`ReconcileMismatch`/`ReconcileResult` + `reconcile` to `FiscalBackend` (fill the reserved name; update the doc comment — reconcile now filled, no reserved names left). Export the types from `index.ts`.
- [ ] **Step 4:** `FakeFiscalBackend.reconcile` — a genuine fake: it takes an injected "authority view" (a `Map<recordId, AckState|null>` set via a test hook like `breakIntegrity`), diffs its own `fake_fiscal_records.state` against it into the three cases, returns a `ReconcileResult`. Not a stub.
- [ ] **Step 5:** `VerifactuBackend.reconcile` minimal body returning `{ ejercicio, periodo, checked: 0, lostAck: [], noTrace: [], drift: [], incidentsRaised: 0 }` (Task 4 replaces it).
- [ ] **Step 6:** Run BOTH packages' suites + typecheck + lint + the english-only guard. Commit.

```bash
git commit -m "feat(fiscal): reconcile + ReconcileResult + AckState on FiscalBackend; minimal impls"
```

---

## Task 4: `reconcile.ts` — the sweep

The real audit: page the consulta, key AEAT's view by `RefExterna`, diff against our `envios`, produce the three cases + incidents.

**Files:** Create `packages/fiscal-verifactu/src/reconcile.ts` + `reconcile.test.ts`; modify `src/backend.ts` (delegate).

**Interfaces:**
- Consumes: `client.consultar`, `RespuestaConsulta`, `EstadoRegistroConsulta`, `Cabecera`, `ConsultaFiltro` (`@waitron/verifactu`); `withTenant`, `Database` (`@waitron/db`); `recordIncident` (`@waitron/core`); `ReconcileResult`, `ReconcileMismatch` (`@waitron/fiscal`); the fake AEAT (tests).
- Produces: `reconcile(deps: { db, client, clock }, tenantId, period): Promise<ReconcileResult>`.

- [ ] **Step 1: Failing tests — the three cases + a genuine multi-page sweep**

```ts
it("clean audit: our records all match AEAT — empty lists", async () => { /* seed accepted envios + fake stores same, reconcile → all empty, checked = N */ });

it("lostAck: we believe pendiente, AEAT holds it (Correcta) → lostAck", async () => { /* ... */ });

it("noTrace: we believe aceptado, AEAT has no trace (forget) → noTrace + error incident", async () => { /* ... */ });

it("drift: we believe aceptado, AEAT holds AceptadaConErrores → drift + warning incident", async () => { /* setConsultaState ... */ });

it("pages across ≥2 pages (presentation-date order) without missing records", async () => { /* seed >pageSize records, reconcile pages via ClavePaginacion, checked covers all */ });

it("does NOT flag a pendiente record as noTrace (in-flight tolerance)", async () => { /* a pendiente record absent from AEAT is not a mismatch */ });
```

Seed via `seedPendingEnvios` (3a's fixture) + set the estados; drive AEAT state via the fake's `setConsultaState`/`forget`; build the fake with `consultaPageSize: 2` for the paging test.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement `reconcile.ts`**

```ts
export interface ReconcileDeps { db: Database; client: VerifactuClient; clock: TrustedClock; }

export async function reconcile(deps: ReconcileDeps, tenantId: string, period: { ejercicio: string; periodo: string }): Promise<ReconcileResult> {
  return withTenant(deps.db, tenantId, async (tx) => {
    // 1. Page AEAT's view, keyed by RefExterna (= our registro id).
    const authority = new Map<string, EstadoRegistroConsulta>();
    const cabecera = await cabeceraFor(tx, tenantId); // ObligadoEmision from tenants (nif/legalName)
    let clave: ConsultaFiltro["ClavePaginacion"];
    do {
      const resp = await deps.client.consultar(cabecera, { Ejercicio: period.ejercicio, Periodo: period.periodo, ClavePaginacion: clave });
      for (const r of resp.registros) {
        const ref = (r.DatosRegistroFacturacion as { RefExterna?: string }).RefExterna;
        if (ref !== undefined) authority.set(ref, r.EstadoRegistro);
      }
      clave = resp.IndicadorPaginacion === "S" ? resp.ClavePaginacion : undefined;
    } while (clave !== undefined);

    // 2. Read our records for the period (expedition-month = period; our records carry no FechaOperacion).
    const rows = await ourRecordsForPeriod(tx, tenantId, period); // registro id + IDFactura triple + envios.estado

    // 3. Diff on EstadoRegistro, not presence.
    const result: ReconcileResult = { ejercicio: period.ejercicio, periodo: period.periodo, checked: rows.length, lostAck: [], noTrace: [], drift: [], incidentsRaised: 0 };
    for (const row of rows) {
      const aeat = authority.get(row.id) ?? null;
      const m = mismatchOf(row, aeat);
      if (isPending(row.estado)) {
        if (aeat !== null) result.lostAck.push(m); // believed pending, AEAT holds it
        // absent + pending → in-flight/unpaged, NOT noTrace (§4.3)
      } else if (isAccepted(row.estado)) {
        if (aeat === null) { result.noTrace.push(m); await raise(tx, deps, row, "error", "fiscal.reconcile_no_trace"); result.incidentsRaised++; }
        else if (aeat === "AceptadaConErrores") { result.drift.push(m); await raise(tx, deps, row, "warning", "fiscal.reconcile_drift_errores"); result.incidentsRaised++; }
        else if (aeat === "Anulada") { result.drift.push(m); await raise(tx, deps, row, "error", "fiscal.reconcile_drift_anulada"); result.incidentsRaised++; }
      }
    }
    return result;
  });
}
```

Helpers: `cabeceraFor` (read `tenants.nif`/`legalName`); `ourRecordsForPeriod` (join `envios`+`registros_facturacion` where the expedition month = period — `to_char(fecha_expedicion_factura, 'MM')` = periodo and year = ejercicio); `isPending`/`isAccepted` (map `envios.estado`); `mismatchOf`; `raise` (via `recordIncident`, structured code+params, `detectedAt = deps.clock.now()`). Register the three `fiscal.reconcile_*` codes in `errors.ts`. `VerifactuBackend.reconcile` delegates: `return reconcile({ db: this.db, client: this.client, clock: this.clock }, tenantId, period)` — but note `reconcile`'s signature: `FiscalBackend.reconcile(period)` has no tenantId. Resolve at implementation: `reconcile` runs for the backend's single configured tenant context — confirm how the caller supplies the tenant (the interface takes only `period`; the fake takes none either). **If a tenant is needed, thread it the same way `pendingCount(tenantId, tillId)` does** — i.e., the interface method likely needs `reconcile(tenantId, period)`. Pin this in Step 3: match `pendingCount`'s precedent (explicit `tenantId` param, since reconcile runs outside a sale tx). Update Task 3's interface accordingly if so.

- [ ] **Step 4: Run to verify it passes; Step 5: Commit.**

```bash
git commit -m "feat(fiscal-verifactu): reconcile sweep — the three audit cases"
```

> **Interface note to resolve in Task 3/4:** `reconcile` needs the tenant. Follow `pendingCount(tenantId, tillId)`'s precedent and make it `reconcile(tenantId, period)` on `FiscalBackend` (no `tx` — it runs outside any sale transaction, establishing its own `withTenant` scope). Update Task 3's signature + both fakes to match before Task 4 lands.

---

## Task 5: Acks — contract, durable transport, in-process consumer + state machine

Produce acks atomically with terminal estados (drainer + reconcile), deliver them via the `acks` table, and prove the state machine + unsent-count projection in-process (incl. the cert-expired case).

**Files:** Create `packages/fiscal-verifactu/src/acks.ts` + `acks.test.ts`; modify `src/drain.ts` (write ack in persist tx) and `src/reconcile.ts` (write ack on correction).

**Interfaces:**
- Produces: `ackStateOf(estado: string): AckState | null` (terminal estados → AckState; non-terminal → null); `writeAck(tx, row, estado, csv, submittedAt)` (upsert into `acks`); `pendingAcks(db, tenantId): Promise<Ack[]>` (undelivered); `markDelivered(db, tenantId, recordId)`; an in-process consumer `applyAck(projection, ack)` driving the state machine + an unsent-count view for the test.
- `interface Ack { recordId: string; submittedAt: Date; csv: string | null; state: AckState; }`

- [ ] **Step 1: Failing tests — production atomicity + delivery + state machine + cert-expired**

```ts
it("writes an ack atomically when the drainer sets a terminal estado", async () => { /* drain accepts a record → an acks row exists with state=accepted, csv, submitted_at, delivered_at=null */ });
it("reconcile writes/updates an ack when it corrects a state (lostAck → accepted)", async () => { /* ... */ });
it("pendingAcks returns undelivered; markDelivered clears them", async () => { /* ... */ });
it("state machine: accepted/accepted_with_errors decrement the unsent count; rejected/halted keep it counted+flagged", async () => { /* applyAck over a projection */ });
it("cert-expired: a record with no ack keeps the unsent count non-zero", async () => { /* no ack produced → count stays */ });
```

- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement `acks.ts`** (`ackStateOf`, `writeAck`, `pendingAcks`, `markDelivered`, `applyAck` + the projection); **wire `drain.ts`** to `writeAck` inside `persistResponse`'s T2 tx alongside each terminal-estado write (accepted/accepted_with_errors/rejected/halted → the matching `AckState`); **wire `reconcile.ts`** to `writeAck` on `lostAck` (accepted) and `drift` corrections. Ack write is idempotent (upsert on `registro_id`) so a re-drain/reconcile doesn't duplicate.
- [ ] **Step 4: Run to verify it passes.** Real Postgres for the `acks` RLS path (the ack read/write runs as `app_user` inside `withTenant`).
- [ ] **Step 5: Full suite + typecheck + lint + format; Commit.**

```bash
git commit -m "feat(fiscal-verifactu): ack contract, durable transport, in-process state machine"
```

---

## Final verification (before the PR)

- [ ] `pnpm -r test` green (Docker up for real-Postgres suites), `pnpm -r typecheck && pnpm -r lint`, `pnpm format:check` clean.
- [ ] `@waitron/verifactu` mutation ≥90%.
- [ ] `@waitron/db english-only` guard green (regime-neutral `ReconcileResult`/`AckState`).
- [ ] Teeth: the three reconcile cases each proven; a genuine multi-page sweep; `noTrace` NOT flagged for a `pendiente` record; the ack carries the CSV; enum-sharing regression (an `Anulada` consulta parses; reconcile never routes through `resolveEstadoEfectivo`).
- [ ] Diff within the Copilot 20k cap.

## Self-Review

- **Spec coverage:** §4 reconcile → Tasks 3-4; §6 fake extensions → Task 1; §7 acks → Task 5; §8 acks table → Task 2; §9 interface → Task 3. All covered.
- **The one open interface detail** — `reconcile`'s tenant param — is flagged in Task 4 to resolve as `reconcile(tenantId, period)` per `pendingCount`'s precedent; Task 3 must adopt that signature. (Carry this into execution as the first thing to settle.)
- **Types consistent:** `AckState`, `ReconcileResult`, `ReconcileMismatch`, `Ack` used consistently across Tasks 3/4/5.
