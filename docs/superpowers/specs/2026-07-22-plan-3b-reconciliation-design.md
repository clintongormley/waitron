# Plan 3b — Reconciliation + Acks — Design

**Date:** 2026-07-22
**Status:** Draft — brainstorming complete, pending user review
**Covers:** Deliverable 2 (plan 3b) of architecture sub-project 3 (the fiscal layer): the
`reconcile(period)` periodic audit against consulta, plus the ack contract / state machine and its
in-process transport.

**Relationship to the other design docs** (not restated here):

- [`2026-07-19-sales-spine-and-fiscal-layer-design.md`](2026-07-19-sales-spine-and-fiscal-layer-design.md)
  §7 ("Reconciliation", "Acks flow downstream") owns the **regulation**; §6 is where
  `reconcile(period)` is the reserved-but-absent `FiscalBackend` name.
- [`2026-07-21-submission-and-reconciliation-design.md`](2026-07-21-submission-and-reconciliation-design.md)
  §4 shapes *how* this deliverable is built (the independent-audit framing, the four mechanics, acks
  downstream, the honest unsent-count scope). **Where it and §7 disagree on code shape, it wins;
  where either disagrees with the primary AEAT source verified in §2 below, the source wins.**
- [`2026-07-21-plan-3a-submission-design.md`](2026-07-21-plan-3a-submission-design.md) — the landed
  deliverable this consumes: the `RefExterna` stamp, the `envios.estado` transitions, and the fake
  AEAT this plan's consulta path extends.

**Prerequisite landed:** plan 3a (PR #15, squash-merged as `7ff11f3`). The drainer, the `envios`
estado transitions, the `RefExterna = registro id` stamp, and the fake AEAT (with a consulta path)
are all on `main`. `reconcile(period)` is still the reserved-but-absent name on `FiscalBackend`
(`packages/fiscal/src/backend.ts`: *"reconcile(period) remains reserved, still pending plan 3b …
Do NOT introduce sync/push in reconcile's place"*).

---

## 1. Scope of 3b

**In:**

- `reconcile(period): Promise<ReconcileResult>` on `FiscalBackend` and `VerifactuBackend`: one
  consulta sweep of one `PeriodoImputacion`, paging via `ClavePaginacion`, matching AEAT's records
  to our `envios` by `RefExterna`, diffing on `EstadoRegistro`, producing the three audit cases.
- Extending the fake AEAT (`packages/verifactu/src/testing/fake-aeat.ts`) with real
  `ClavePaginacion` pagination, `RefExterna` echoed in the consulta `DatosRegistroFacturacion`, and
  configurable stored state to drive the three cases.
- The **ack contract** (payload `{ recordId, submittedAt, csv, state }`), the ack **state machine**,
  and a **durable local-table outbox** as the in-process transport.
- `FiscalBackend.reconcile` on the interface + a meaningful `FakeFiscalBackend.reconcile`.

**Out:**

- The **scheduler** that invokes `reconcile` on a cadence — an `apps/*` concern, out of the whole
  sub-project (2026-07-19 §1). 3b ships the callable plus a harness that drives it.
- The **wire protocol** for acks — sub-project 9. 3b builds the contract + state machine + an
  in-process transport only; the **distributed unsent-count is contract-only** here (see §7.3).
- Real-AEAT consulta — gated on a certificate + preproduction (§11). Everything is built and tested
  against the fake, exactly as 3a.

---

## 2. Primary-source verification (`Descripcion_SWeb` v1.0.3 §6.4)

The `PeriodoImputacion` derivation was flagged **medium-confidence** in every prior document. It was
read directly from the primary AEAT PDF this session and is now **confirmed**. The load-bearing
facts, quoted:

- **Period derivation:** *"Las consultas de registros de facturación informados se realizan por
  ejercicio/periodo 'de imputación', dato obtenido a partir de la **fecha de operación o en su
  defecto de la fecha de expedición**."* `Ejercicio` = `Numérico(4)` YYYY, `Periodo` = `Alfanumérico(2)`
  (month). **Consequence for us:** Waitron's records never populate `FechaOperacion` (3a's
  `recordSale` sets none), so **our records' period is always the expedition month** — no
  cross-month ambiguity, no false `SinDatos`. The general operación→expedición rule is verified for
  whenever `FechaOperacion` is ever populated.
- **Paging:** *"Las consultas responderán con un máximo de 10.000 registros … habrá que invocar al
  servicio de forma paginada … ordenados por **fecha de presentación**."* Continuation via
  `ClavePaginacion` (IDEmisorFactura / NumSerieFactura / FechaExpedicionFactura of the last record).
  The presentation-date ordering is real — a sweep concurrent with the drainer can page past
  newly-arriving records (§4).
- **`RefExterna`:** confirmed as **both** an optional query filter *and* a stored field echoed back
  — §6.4.1 lists `RefExterna` (`Alfanumérico(60)`, *"se pueda asociar opcionalmente información
  interna del sistema informático de facturación al registro"*) in `FiltroConsulta`, and the v1.0.0
  revision log reads *"Consulta ampliada por identificador RefExterna."* So matching a consulta
  result to our row **by our registro id** is clean (off `DatosRegistroFacturacion`, or as a direct
  filter for a single-record probe).
- **`MostrarNombreRazonEmisor` / `MostrarSistemaInformatico`:** *"Si el Valor es S aumenta el tiempo
  de respuesta."* Leave unset — neither is needed to diff.
- **CSV:** §6.4.4 restates *"El CSV … no podrá ser recuperado a través de consultas posteriores."*
  This is exactly why the **ack payload must carry the CSV** (from `envios.csv`, stored by 3a) — the
  consulta can never return it.
- **Response shape:** each `RespuestaConsultaFactuSistemaFacturacion` block carries `IDFactura`,
  `DatosRegistroFacturacion` (the stored record, incl. `Huella` and the echoed `RefExterna`),
  `DatosPresentacion` (`NIFPresentador` / `TimestampPresentacion` / `IdPeticion`), and `EstadoRegistro`
  (`TimestampUltimaModificacion` / `EstadoRegistro` / `CodigoErrorRegistro` / `DescripcionErrorRegistro`).
  `ResultadoConsulta` is `"ConDatos" | "SinDatos"`; `IndicadorPaginacion` is `"S" | "N"`.

`packages/verifactu/src/xml/parse-consulta.ts` already models this response
(`RespuestaConsulta`, `RegistroConsultado`, `EstadoRegistroConsulta = "Correcta" | "AceptadaConErrores"
| "Anulada"`, `ClavePaginacion?: IDFactura`), with `DatosRegistroFacturacion` typed as the loose
`Record<string, unknown> & { Huella?, TipoHuella? }` grab-bag — so `datos.RefExterna` is readable
off it once the fake echoes it. No parser change needed beyond confirming that read.

---

## 3. Resolved decisions

| # | Decision | Choice |
| --- | --- | --- |
| 1 | 3b scope | **Reconcile + acks together** — deliverable 2 as the plan-3 design §4 defines it. |
| 2 | `period` shape | The `PeriodoImputacion` pair `{ ejercicio: string; periodo: string }`, matching `ConsultaFiltro.Ejercicio`/`Periodo` — the unit AEAT queries by, not a generic date range. |
| 3 | `PeriodoImputacion` derivation | **Verified** (§2). Encode period = the record's **expedition month** for our records (exact, no `FechaOperacion`); document the general operación→expedición rule for the future. No longer a gated risk. |
| 4 | Ack in-process transport | A **durable local-table outbox** (envios-sidecar style), not an in-memory queue — survives restart, testable on real Postgres. Explicitly **not** sub-project 9's wire protocol. |
| 5 | Scheduler | **Out of scope** — `reconcile` is one callable pass; cadence is a caller policy. |

---

## 4. `reconcile(period) → ReconcileResult`

A **periodic independent audit**, not an ack fallback. Consulta *is* the reconciliation mechanism
(no bulk export exists), so this is the only automatable reconciliation surface. It runs on a
schedule **even when every ack arrived cleanly** — it catches two things an ack structurally cannot
(a believed-**accepted** record AEAT has **no trace** of; silent **drift** to `AceptadaConErrores`/
`Anulada`), plus the lost-ack case. It is also the concrete, auditable answer to art. 16.4's
justification-on-demand duty.

### 4.1 One pass, per period

`reconcile(period)` sweeps one `PeriodoImputacion`:

1. Query consulta for the tenant, `FiltroConsulta = { Ejercicio, Periodo }` (obligado on the
   `Cabecera.ObligadoEmision`); leave `Mostrar*` unset.
2. Page through all records via `ClavePaginacion` until `IndicadorPaginacion = "N"` (≤10,000/page,
   ordered by fecha de presentación).
3. Build AEAT's view: a map keyed by `RefExterna` (= our registro id, read off
   `DatosRegistroFacturacion`) → `{ EstadoRegistro, Huella }`. Records with no `RefExterna` (not
   ours) are ignored.
4. Read our `envios` for the period (join `registros_facturacion` on `fecha_expedicion_factura`'s
   month = period, per §2) and **diff on `EstadoRegistro`, not presence**, producing the three
   cases (§4.2).
5. Raise `incidents` (via `@waitron/core`'s `recordIncident`, as 3a does) for the alarming cases
   (`noTrace`, and `drift` to a divergent state) and return the `ReconcileResult`.

**Placement:** a new module `packages/fiscal-verifactu/src/reconcile.ts`; `VerifactuBackend.reconcile`
delegates to it (as `checkIntegrity`→`verifyChain` and `drain`→`drain.ts`). Runs inside `withTenant`
per tenant — same RLS discipline as `drain`. The cross-tenant enumeration question `drain` faced
does **not** recur: `reconcile(period)` is invoked per already-known tenant/period by its caller (it
takes no cross-tenant sweep), so it runs entirely inside one `withTenant` scope.

### 4.2 The three cases and `ReconcileResult`

Diffing our `envios.estado` against AEAT's `EstadoRegistroConsulta`:

| Case | Condition | Meaning / action |
| --- | --- | --- |
| **`lostAck`** | we believe `pendiente`/`enviando`; AEAT holds it (`Correcta`/`AceptadaConErrores`) | The one ack-safety-net case — reconcile it to the AEAT state (and emit an ack). |
| **`noTrace`** | we believe `aceptado`/`aceptado_con_errores`; AEAT returns nothing for this `RefExterna` in the period | *"undetectable without this — the system would believe itself compliant."* Alarming → error incident. Because rejected records are never stored, **absence is unambiguous** (once §2's period + ordering caveats hold). |
| **`drift`** | we believe clean (`aceptado`); AEAT holds `AceptadaConErrores` or `Anulada` | Silent state drift → warning (`AceptadaConErrores`) / error (`Anulada`) incident; update local state. |

```ts
interface ReconcileMismatch {
  registroId: string;
  idFactura: { IDEmisorFactura: string; NumSerieFactura: string; FechaExpedicionFactura: string };
  localEstado: string;              // our envios.estado
  aeatEstado: EstadoRegistroConsulta | null; // null = no trace
}
interface ReconcileResult {
  period: { ejercicio: string; periodo: string };
  checked: number;                  // our records examined for the period
  lostAck: ReconcileMismatch[];
  noTrace: ReconcileMismatch[];
  drift: ReconcileMismatch[];
  incidentsRaised: number;
}
```

`checked` with all-empty lists is a true, normal "clean audit" answer (mirrors `IntegrityReport`'s
`ok`/`checked` reasoning). The lists carry enough identity (registro id + `IDFactura` triple) to act
on each mismatch.

### 4.3 Presentation-date ordering tolerance

Because results are ordered by fecha de presentación (§2), a sweep running while the drainer is
still submitting can page **past** newly-arriving records — the "next page" boundary moves. So
reconcile must **not** assume a single pass is a consistent snapshot: a record we believe pending
that simply hasn't been paged yet is not a mismatch. Concretely, `noTrace` is only asserted for a
record we believe **accepted** (a state it only reaches *after* AEAT accepted it, so it should
already be present), never for a `pendiente` record (which may just be mid-submission or unpaged).
This makes the audit tolerant of concurrent drainer activity without a lock.

---

## 5. The enum-sharing guard, from the reconciliation side

Consulta uses `EstadoRegistroConsulta` (`"Correcta" | "AceptadaConErrores" | "Anulada"` — no
`Incorrecta`, because rejected records are never stored); submission uses
`EstadoRegistroSuministro`. They are **different questions over different enums** and must never be
funnelled through each other. `reconcile` must **not** route a consulta result through 3a's
`resolveEstadoEfectivo` (scoped to the submission response only). A regression test asserts an
`Anulada` consulta parses and that reconcile's own diff logic reads `EstadoRegistroConsulta`, not the
submission enum.

---

## 6. The fake AEAT extensions

`reconcile`'s tests reuse 3a's fake AEAT (`packages/verifactu/src/testing/fake-aeat.ts`); three
additions, all in that file:

- **Real `ClavePaginacion` pagination.** Today `handleConsulta` returns a single page with
  `IndicadorPaginacion: "N"`. Extend it to return ≤N records/page (a small test cap, not 10,000),
  set `IndicadorPaginacion: "S"` + a `ClavePaginacion` (the last record's `IDFactura`) when more
  remain, and continue from a passed `filtro.ClavePaginacion` — ordered by insertion (a stand-in for
  fecha de presentación) so a multi-page fixture genuinely paginates.
- **Echo `RefExterna`** in the consulta `DatosRegistroFacturacion` (the fake already stores
  `refExterna` on each record; the submit-response echoes it, the consulta response does not yet).
- **Configurable stored state to drive the three cases:** a test hook to set a stored record's
  `EstadoRegistroConsulta` (`AceptadaConErrores`/`Anulada`) for drift, and the existing store's
  absence for `noTrace` (submit a record, then don't store it / evict it). `annul(key)` already
  exists (3a) for the `Anulada` path.

This keeps a single fake AEAT (no second one), as the plan-3 design intends.

---

## 7. Acks — contract, state machine, durable-table transport

### 7.1 Why acks carry true AEAT state

A till syncing happily to an upstream node whose certificate silently expired must still show a
**non-zero** unsent count (the art. 16.4 gap). So the ack payload's `state` reflects **AEAT's own
acceptance** — sourced from `envios.estado` as 3a's drainer sets it, or from this plan's own
reconcile sweep (the drift/lost-ack corrections) — never "the till's local copy is up to date with
the submitting node."

### 7.2 The contract, state machine, and durable transport

- **Payload:** `{ recordId: string; submittedAt: Date; csv: string | null; state: AckState }`, where
  `AckState` is the regime-neutral English projection of the AEAT outcome —
  `"accepted" | "accepted_with_errors" | "rejected" | "halted"` — mapped from `envios.estado`
  (`aceptado`→accepted, `aceptado_con_errores`→accepted_with_errors, `rechazado`→rejected,
  `detenido`→halted). The `csv` rides the ack because consulta can never retrieve it (§2).
- **Durable-table outbox transport (decision 4):** a new table `acks` (envios-sidecar style) holds
  acks to deliver. **The ack row is written atomically with the estado that produces it** — in the
  drainer's persist transaction (a minimal, additive change to 3a's `drain.ts`: alongside each
  terminal-estado write, insert/upsert the matching ack) and in reconcile's correction transaction —
  so an ack can never disagree with the committed `envios.estado`/`csv` it reflects. An in-process
  consumer reads undelivered acks (`delivered_at IS NULL`) and applies them. The transport interface
  is `pendingAcks(): Promise<Ack[]>` / `markDelivered(recordId)` over the table (deliberately **not**
  named `drain*`, to avoid confusion with the submission drainer) — good enough to prove the state
  machine end-to-end, **explicitly not** sub-project 9's wire protocol.
- **State machine:** a record's ack lifecycle is `pending → delivered(accepted | accepted_with_errors
  | rejected | halted)`. On the consumer side, `accepted`/`accepted_with_errors` decrement the
  unsent count; `rejected`/`halted` keep the record counted **and** flagged. The in-process test
  drives the whole path: drainer sets `envios.estado` → ack enqueued → consumer applies → the
  consumer's projection matches; plus the cert-expired scenario (no ack for a record) keeping the
  count non-zero.

### 7.3 The unsent count — honest scope

In the **standalone (single-node)** deployment the submitting node *is* the till, so
`FiscalBackend.pendingCount` reads `envios` directly and is **already correct** after the prep PR +
3a. **Nothing about acks is needed for the standalone count.** The downstream-ack path only bites in
the **distributed** topology (several tills, one submitting node), where the live consumer is a
sub-project-9 (wire) + sub-project-7 (screen) concern. So **3b delivers the ack contract and its
in-process test — not a wired-up till client** — and the plan says so plainly: "acks landed" does
**not** mean the distributed unsent count works end-to-end.

---

## 8. New schema — the `acks` outbox

A durable sidecar for the ack transport (decision 4), mirroring the `envios` split (immutable fact /
mutable delivery state). Sketch (final columns pinned in the plan):

| Column | Type | Notes |
| --- | --- | --- |
| `registro_id` | uuid PK | FK to `registros_facturacion.id` (1:1, like `envios`) |
| `tenant_id` | uuid NOT NULL | FK to `tenants.id` |
| `submitted_at` | timestamptz NOT NULL | from `envios.enviado_en` |
| `csv` | text, nullable | copied off `envios.csv` — the unrecoverable value |
| `state` | text NOT NULL | CHECK-constrained `AckState` enum |
| `delivered_at` | timestamptz, nullable | when the in-process consumer applied it (null = pending) |

RLS tenant-scoped, following the `envio_flujo`/`envios` convention (dedicated role + permissive read
only if a cross-tenant enumeration is ever needed — it is **not** here, since acks are produced and
consumed per-tenant inside `withTenant`). One migration.

---

## 9. Interface changes

`FiscalBackend` gains `reconcile`, filling the last reserved name (the doc comment forbids
`sync`/`push` in its place). It takes an explicit `tenantId` — following `pendingCount(tenantId,
tillId)`'s precedent, since reconcile runs **outside** any sale transaction and establishes its own
`withTenant` scope (no `tx` to inherit the tenant from). No `tillId`: reconciliation is per obligado
tributario (tenant), not per till — the consulta queries by `ObligadoEmision`.

```ts
reconcile(tenantId: TenantId, period: { ejercicio: string; periodo: string }): Promise<ReconcileResult>;
```

`ReconcileResult` is exported from `packages/fiscal/src/index.ts`. **Regime-neutrality watch:** as
with `DrainResult`, `ReconcileResult` and the `AckState` contract live in `packages/fiscal` (the
generic layer) and must stay English-only — no `estado`/Spanish tokens or authority names in field
names or doc comments (the `no-regime-vocabulary` guard + the `@waitron/db` english-only test
enforce it; 3a's `enviosSent`→`batchesSent` lesson applies). `ReconcileMismatch.localEstado` is a
value read from a Spanish column but the field name is English; keep the doc comments regime-neutral.

`FakeFiscalBackend.reconcile` ships in the same PR — a meaningful fake (not a stub): it reconciles
its own fake records against an injectable "authority view", returning a `ReconcileResult`, so the
method has a real fake per the interface's own dead-surface rule.

---

## 10. Testing posture (inherits 2026-07-19 §10)

- **Reuse 3a's fake AEAT** for the consulta path — extended per §6, never a second fake.
- **Three explicit scenarios, not just the happy path:** `lostAck`, `noTrace`, `drift` — the whole
  point of this plan is the cases where local and AEAT disagree.
- **Genuine multi-page fixture:** the fake must actually paginate (`IndicadorPaginacion: "S"` +
  `ClavePaginacion` continuation), and a test must page across ≥2 pages — a single-page test would
  never exercise the presentation-date ordering tolerance (§4.3).
- **Enum-sharing regression (from the consulta side):** an `Anulada` consulta parses; reconcile
  reads `EstadoRegistroConsulta`, never the submission enum / `resolveEstadoEfectivo` (§5).
- **Ack state machine end-to-end in-process:** drainer estado → ack enqueued → consumer applies →
  projection correct; plus the cert-expired (no-ack) case keeping the count non-zero.
- **Real Postgres** for the `acks` table RLS + the `reconcile` withTenant path; PGlite for unit
  logic. Per-test red phase. **Never a production NIF** — fixtures / preproduction only.

---

## 11. Carried risks and gated items

- **Consulta rate limit undocumented** — *absence of a documented limit, not a documented absence*
  (§2 found no rate limit in the consulta spec; `TiempoEsperaEnvio` is absent from the consulta
  response). Since 3b runs periodic sweeps, budget to discover it empirically in preproduction; do
  **not** encode a guessed number.
- **Real AEAT consulta stays gated** on a certificate + preproduction (§11) — built/tested against
  the fake, same as 3a.
- **The distributed unsent-count path is contract-only** (§7.3) — don't let "acks landed" read as
  "the distributed unsent count works"; it needs sub-project 9 (wire) + sub-project 7 (screen).
- **`PeriodoImputacion` general derivation** (operación→expedición) is now **verified** (§2); it is
  moot for our records (no `FechaOperacion`) and a documented, correct rule for the future — no
  longer a risk.

---

## 12. New / changed files (orientation for the plan)

| Path | Change |
| --- | --- |
| `packages/verifactu/src/testing/fake-aeat.ts` | pagination + `RefExterna` echo + stored-state hooks (§6) |
| `packages/fiscal-verifactu/src/reconcile.ts` | **new** — the sweep + diff + the three cases |
| `packages/fiscal-verifactu/src/schema/acks.ts` | **new** — the `acks` outbox table + migration |
| `packages/fiscal-verifactu/src/acks.ts` | **new** — the ack contract + durable transport (`pendingAcks`/`markDelivered`) + in-process consumer |
| `packages/fiscal-verifactu/src/drain.ts` | **additive** — write the ack row in the persist tx, atomic with each terminal-estado write |
| `packages/fiscal-verifactu/src/backend.ts` | `reconcile` delegating to `reconcile.ts` |
| `packages/fiscal/src/backend.ts` | `reconcile(period)` + `ReconcileResult` + `AckState` on the interface |
| `packages/fiscal/src/testing/fake-backend.ts` | `FakeFiscalBackend.reconcile` |
