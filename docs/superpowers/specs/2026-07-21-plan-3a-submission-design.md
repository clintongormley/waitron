# Plan 3a — Submission (the drainer) — Design

**Date:** 2026-07-21
**Status:** Draft — brainstorming complete, pending user review
**Covers:** Deliverable 1 (plan 3a) of architecture sub-project 3 (the fiscal layer). This is the
detailed, code-shaped design for the drainer, the transport wiring, the request-parsers and the
faithful fake AEAT.

**Relationship to the other design docs.** This document sits *below* two it does not restate:

- [`2026-07-19-sales-spine-and-fiscal-layer-design.md`](2026-07-19-sales-spine-and-fiscal-layer-design.md)
  §7 owns the **regulation** — batching, flow control, the CSV-persistence rule, error 3000, the
  two routes, rejections, `Incidencia="S"`, reconciliation. Verified against primary AEAT sources
  (the XSDs/WSDL, `Descripcion_SWeb` v1.0.3, `Validaciones_Errores` v1.2.2, `FAQs-Desarrolladores`
  v1.3, Orden HAC/1177/2024 Anexo 2.2). **Where this and §7 disagree on regulation, §7 wins.**
- [`2026-07-21-submission-and-reconciliation-design.md`](2026-07-21-submission-and-reconciliation-design.md)
  shapes *how* §7 is built — the deliverable split (0 → 1 → 2), the transport boundary, the
  fake-AEAT approach, the `FiscalBackend` interface changes, the cross-plan seams. **Where it and
  §7 disagree on code shape, it wins.**

This document records what those two leave open for 3a specifically: the resolved decisions, the new
schema, the module boundaries, the transaction structure of `drain`, the estado transition table,
and the concrete `DrainResult` and interface shapes. It is self-contained for writing the
implementation plan.

Prerequisite already landed: PR #13 (`411ec7b`) — `tenantId` on `checkIntegrity`/`pendingCount`,
the `pendingCount` RLS fix, the within-module SIF dedup. `drain` and `reconcile` remain
reserved-but-absent on `FiscalBackend`; this plan fills `drain`.

---

## 1. Scope of 3a

**In:**

- Inject `VerifactuClient` into `VerifactuBackend` (transport wiring).
- New public request-parsers `parseEnvio` / `parseConsulta` in `packages/verifactu`.
- The faithful, stateful, in-memory fake AEAT at the `fetch` layer.
- `drain(now): Promise<DrainResult>` on `FiscalBackend` and `VerifactuBackend`: per-tenant batching,
  flow control, the claim/persist transaction split, retry backoff, CSV persistence, the estado
  transitions, `Incidencia="S"`, chain-halting, and incident-raising.
- **Route B** in full — for a `duplicate_unknown` line, a targeted consulta and a stored-vs-local
  `Huella` comparison.
- `RefExterna = registro id` stamping at submission.
- `FiscalBackend.drain` on the interface and a meaningful `FakeFiscalBackend.drain`.

**Out:**

- `formatAmountExact` (deliverable 0b) — its own PR. The drainer only re-emits amounts **already
  stored** on the registro row (via `fromRegistroRow`), so it is order-independent with 0b: nothing
  here changes whether 0b lands before or after.
- The periodic reconciliation **sweep** and the **ack contract / state machine** — both plan 3b.
- Any scheduler, cron, or long-running loop — `apps/*` is out of the whole sub-project
  (2026-07-19 §1). 3a ships the callable `drain` plus a test harness that drives it with advancing
  fake time.
- Real-AEAT submission — gated on a certificate + preproduction access (§11). Everything here is
  built and tested against the faithful fake.

**A note on Route B's period, which does *not* inherit 3b's caveat.** 3b's reconciliation sweep must
derive `PeriodoImputacion` from *fecha de operación* with a fallback to *fecha de expedición*, a
derivation flagged medium-confidence (2026-07-19 §7; 2026-07-21 §4.1). 3a's Route B issues only a
*targeted, single-record* consulta, and our own records never populate `FechaOperacion`
(`VerifactuBackend.recordSale` sets no `FechaOperacion`), so for our records operation month ≡
expedition month and the ambiguity cannot bite. Route B derives its period from the record's own
`FechaExpedicionFactura`.

---

## 2. Resolved decisions

| # | Decision | Choice |
| --- | --- | --- |
| 1 | `formatAmountExact` in 3a? | **No** — separate PR (0b). |
| 2 | How the fake AEAT reads inbound envío XML | **Export request-parsers from `packages/verifactu`** (`parseEnvio`/`parseConsulta`), symmetric with the response parsers, under the package's 90% mutation gate. |
| 3 | Concurrency posture of `drain` | **Claim `pendiente → enviando` under `FOR UPDATE SKIP LOCKED`, persist the response in a second transaction, recover stale `enviando`.** |
| 4 | Where flow-control state lives | **A new per-tenant table** `envio_flujo` (see §6). `proximo_intento_en` is per-record and cannot enforce a minimum interval between envíos. One migration; greenfield, no live data. |
| 5 | `DrainResult` shape | Summary + `nextDueAt` (§9). No per-record detail. |

---

## 3. Transport boundary

`VerifactuBackendOptions` gains one field:

```ts
export interface VerifactuBackendOptions {
  clock: TrustedClock;
  db: Database;
  environment?: Environment;
  systemInfo?: Partial<SystemInfoDefaults>;
  client: VerifactuClient; // new — the narrow submit/consultar interface from @waitron/verifactu
}
```

No new abstraction: `packages/fiscal-verifactu` already depends on `packages/verifactu`, which
already exports `VerifactuClient` and `createClient({ endpoint, fetch })`. **mTLS cert/key and the
endpoint stay exactly where they already live** — inside the caller-supplied `fetch` (a Node
`Agent`/`Dispatcher` carrying the client certificate) plus the `endpoint` string. The app wires a
real client over a real `fetch`; tests wire a client over the fake AEAT `fetch`. This is the
"submitter is an interface, not a location" property (findings §5.1/§5.2): moving submission onto
tills later is a provisioning change, not a redesign.

`recordSale`/`recordVoid`/`registerTill`/`checkIntegrity`/`pendingCount` are untouched by the new
field.

---

## 4. Request-parsers in `packages/verifactu` (new public API)

Nothing in `packages/verifactu` parses its own *request* XML today; it parses only responses
(`parse-suministro.ts`, `parse-consulta.ts`). Decision 2 adds the inverse.

**New file** `packages/verifactu/src/xml/parse-request.ts`, exporting:

```ts
export function parseEnvio(xml: string): { cabecera: Cabecera; registros: EnvioRegistro[] };
export function parseConsulta(xml: string): { cabecera: Cabecera; filtro: ConsultaFiltro };
```

- Named to sit cleanly beside the response parsers: `parseEnvio`/`parseConsulta` are **requests**,
  `parseRespuestaSuministro`/`parseRespuestaConsulta` are **responses**. No name collides.
- **Full-fidelity reconstruction.** By the time a record reaches `serializeEnvio` every leaf is
  already a string (`buildAltaRecord` has formatted the amounts, dates are `DD-MM-YYYY` strings,
  the huella is a hex string), so `parseEnvio` returns exactly the `EnvioRegistro[]` that was
  serialised, losslessly.
- **Mutation gate satisfied by a round-trip property.** The primary test is
  `parseEnvio(serializeEnvio(c, regs))` deep-equals `{ cabecera: c, registros: regs }` over a
  fixture matrix: alta, anulación, multi-record, records from several SIFs of one obligado, and the
  optional blocks (`RefExterna`, rectification, `Representante`). Symmetric for consulta. A
  round-trip property is a strong mutation killer — a serializer or parser mutation breaks the
  identity.
- Added to the barrel (`index.ts`) and to `index.test.ts`'s reachability list.

The narrower alternative (a tolerant read living only inside the fake) was considered and rejected
in favour of a real, typed, gated library API — the fake then depends on the same parser the rest of
the ecosystem can reuse, and 3b's consulta path reuses `parseConsulta` for its own fake-AEAT tests.

---

## 5. The faithful fake AEAT

**New file** `packages/verifactu/src/testing/fake-aeat.ts` — mirrors the
`@waitron/fiscal/src/testing/fake-backend.ts` convention (a `testing/` module deep-imported as
`@waitron/verifactu/src/testing/fake-aeat.js`; these packages carry no `exports` map, and the fake
is never re-exported from the production barrel). It lives in `packages/verifactu` because both
consuming packages already depend on it, and 3b's consulta path reuses it — no package cycle.

A **stateful in-memory AEAT** modelled on `Validaciones_Errores_Veri-Factu.pdf`, exposed as a
`fetch: typeof globalThis.fetch` to hand to `createClient`. It:

- **Parses the inbound SOAP body** with `parseEnvio`/`parseConsulta` (§4) to know what was
  submitted — record identities, whether this is a resubmit, whether a record is future-dated, and
  each record's `Huella` (for the Route B compare).
- **Emits real response XML** that the *unmodified* `parseRespuestaSuministro` /
  `parseRespuestaConsulta` parse — real `serialize → fake transport → real parse`, end to end. This
  is the "don't mock the boundary you are testing" rule (the same reasoning as §10's real-Postgres
  rule for the DB layer).
- **Models the behaviours the drainer must handle:**
  - issuing a `CSV` on any non-rejected envío;
  - a **decreasing `TiempoEsperaEnvio`** (start 60s, updated on every response) so the drainer's
    flow-control scheduling is exercised, including a `t = 9999` round-trip;
  - **error 3000 with a `RegistroDuplicado` block** on resubmit, whose `EstadoRegistroDuplicado` is
    configurable to `Correcta` / `AceptadaConErrores` / `Anulada` / *absent* (the last drives
    `duplicate_unknown` → Route B);
  - **error 2004** on future-dating (non-rejecting);
  - **per-record rejections** (a configurable reject list);
  - **consulta responses** carrying `ClavePaginacion` and a stored `Huella`/`Encadenamiento`, so
    Route B (3a) and the sweep (3b) both have a real consulta to exercise.
- Is **driven by an injected clock** for "server now" (future-date detection) and for
  `TimestampPresentacion`, so tests control time deterministically.

The fake is a plan-3a deliverable in its own right — budget real time for it, not just for the
drainer.

---

## 6. New schema — `envio_flujo` (per-tenant flow control)

The "send when `t` has elapsed **or** 1,000 records have accumulated, whichever first" race
(2026-07-19 §7) needs a **per-tenant** fact: when this obligado's next envío may go, and the current
`t`. `envios.proximo_intento_en` is **per record**, and the already-landed write path defaults new
rows to `now()` (immediately due). A new sale's row is therefore indistinguishable from a row that
has "waited `t`", so `proximo_intento_en` alone cannot enforce a minimum interval between envíos in
exactly the light-load case `t` exists for. Hence a small per-tenant table.

```ts
export const envioFlujo = pgTable(
  "envio_flujo",
  {
    tenantId: uuid("tenant_id").primaryKey().references(() => tenants.id),
    // When this obligado's next envío may be sent. The flow-control gate reads this.
    proximoEnvioEn: timestamp("proximo_envio_en", { withTimezone: true }).notNull(),
    // The last TiempoEsperaEnvio AEAT returned (init 60). \d{0,4} in the schema → up to 9999.
    tiempoEsperaSeg: integer("tiempo_espera_seg").notNull(),
  },
).enableRLS();
```

- **RLS tenant-scoped**, like every other tenant-owned table; the drainer reads/writes it inside
  `withTenant` (see §7).
- **Lazily created per tenant.** No row need pre-exist: on a tenant's first drain there is no flow
  row, which reads as "may send now", and the drainer upserts one after the first response
  (`insert … on conflict (tenant_id) do update`).
- `tiempo_espera_seg` cleanly round-trips `t = 9999` (the teeth-test value), where baking `t` into a
  `timestamptz` would not make the raw seconds re-readable.

No change to `envios` itself — every column the drainer writes (`estado`, `intentos`,
`proximo_intento_en`, `incidencia`, `csv`, `codigo_error`, `mensaje_error`, `enviado_en`,
`confirmado_en`) and its access-path index `envios_drenaje_idx` already exist. No change to
`registros_facturacion`, and no `ref_externa` column — `RefExterna` is derived (§8).

---

## 7. `drain(now) → DrainResult`

`drain` is **one pass**: it drains everything currently due and returns when to call it again. The
repeating cadence is the **caller** re-invoking `drain` on the returned `nextDueAt`, driven entirely
by the database (`proximo_intento_en`, `proximo_envio_en`), never an in-memory timer — this is what
makes the art. 16.4 hourly duty survive a restart or a week offline (findings §5.4). The scheduler
is an app concern and out of scope; 3a ships the callable plus a harness that drives it.

**Placement.** A new module `packages/fiscal-verifactu/src/drain.ts` holds the logic;
`VerifactuBackend.drain` delegates to it, exactly as `checkIntegrity` delegates to `verifyChain`.

### 7.1 Per-tenant loop and RLS

`drain(now)` has no tenant parameter — it drains all due work across tenants. It enumerates the
tenants with due `pendiente` (or stale `enviando`) rows, then processes **each tenant inside
`withTenant(this.db, tenantId, …)`** so `app.tenant_id` is set and the RLS tenant-isolation policy
matches — the same discipline `pendingCount` follows.

> **Detail the plan must pin (and test on real Postgres):** the cross-tenant *enumeration* of
> tenants-with-work cannot itself run under a single tenant's RLS scope. It runs under the system
> connection's cross-tenant read capability (a role grant or policy the plan establishes), after
> which all per-tenant work runs inside `withTenant`. This is an RLS-sensitive seam: it must be
> proven on real Postgres as `app_user`/the system role, never on PGlite (superuser bypasses RLS
> and would prove nothing — §10).

### 7.2 The four steps, per tenant

1. **Recover stale claims.** Any `enviando` row whose claim is older than a recovery threshold
   (`enviado_en < now − RECOVERY`) → back to `pendiente`, `incidencia = true`. A drainer that
   crashed between claim and persist may or may not have reached AEAT; resubmission is always safe
   (uncertain in-flight state resolves via error 3000), and marking the attempt as an incidence
   satisfies art. 16.4's flag on a message with a failed attempt.
2. **Claim a batch (T1, short transaction).** Select up to `MAX_REGISTROS_POR_ENVIO` (1000) due
   `pendiente` rows for this tenant, ordered by chain sequence within each SIF
   (`registros_facturacion.secuencia`, joined on `registro_id`), `FOR UPDATE SKIP LOCKED`. Set them
   `estado = 'enviando'`, `enviado_en = now`, `intentos = intentos + 1`. Commit. `SKIP LOCKED` +
   the claimed `enviando` state make two concurrent drainers disjoint rather than double-submitting.
3. **Submit (network, outside any transaction).** Rebuild each record with `fromRegistroRow(row)`,
   spread `{ …record, RefExterna: row.id }` (§8), and call `client.submit(cabecera, registros)`.
   Never hold a DB transaction open across this call.
4. **Persist the response (T2, one atomic transaction).** Write, together: the `CSV` onto the
   batch's rows; each record's estado transition (§8, via `resolveEstadoEfectivo`); `confirmado_en`
   for accepted records; `codigo_error`/`mensaje_error` and `incidencia` where set; the retry
   `proximo_intento_en` for anything to re-attempt; and any `incidents` rows. Update `envio_flujo`:
   `proximo_envio_en = now + t`, `tiempo_espera_seg = t`. Commit.
   - **The CSV-in-the-same-transaction-as-the-response rule is exactly this T2.** No CSV element
     exists anywhere in the consulta response and resubmission never returns it, so a CSV split
     across two commits and lost to a crash is unrecoverable — the single highest-consequence line
     in the outbox. §10's teeth-test (drop the CSV write → a test must fail) protects it; it is
     carried into 3a verbatim.

### 7.3 Flow control — the "whichever first" race

Per tenant, the drainer may send an envío when **`now ≥ proximo_envio_en`** (the `t` has elapsed)
**or** **`due_count ≥ 1000`** (a full envío has accumulated), whichever first:

- The **1000 branch overrides the gate**: after step 4, if ≥1000 rows remain due, loop immediately
  to step 2 — back-to-back envíos, no wait. Under load the drainer never waits.
- Otherwise the tenant's next envío waits until `proximo_envio_en` (= previous response's
  `now + t`). The 60s only bites when there is almost nothing to send — by which point the customer
  left with the receipt long ago.

Flow control (per-tenant, `envio_flujo`) and retry backoff (per-record, `envios.proximo_intento_en`)
are **separate axes**. A record that failed retries on its own exponential backoff; the tenant's
next envío is governed by the flow gate. `nextDueAt` (§9) is the earliest instant across all tenants
at which `drain` would do useful work, i.e. the min over tenants of
`max(proximo_envio_en, earliest-pending proximo_intento_en)` — the exact computation is an
implementation detail; the contract is "call `drain` again at `nextDueAt`."

### 7.4 Retry backoff

On a transient failure (network error, envío-level `Incorrecto` that is not a per-record decision),
the batch's rows return to `pendiente` with `incidencia = true` and
`proximo_intento_en = now + backoff(intentos)`, where `backoff` is exponential **capped at 3600s**.
Art. 16.4 sets a *ceiling* on the retry interval (retry *at least* hourly), not a floor — faster is
always compliant, slower never is; capped exponential is the sane middle. `intentos` was already
incremented at claim (step 2), so an attempt that reached the wire but failed counts.

---

## 8. Per-record outcome — estado transitions, Route B, incidents

Each response line is resolved with the **already-built** `resolveEstadoEfectivo` (which encodes the
error-3000 / `RegistroDuplicado` inversion) and mapped to an `envios.estado` transition:

| `EstadoEfectivo` | `envios.estado` | Other columns / effects |
| --- | --- | --- |
| `accepted` | `aceptado` | `confirmado_en = now`. Drops out of `pendingCount`. |
| `accepted_with_errors` | `aceptado_con_errores` | `confirmado_en = now`; **warning** incident (AEAT keeps it flagged forever, §7). Drops out of `pendingCount`. |
| `rejected` | `rechazado` | `incidencia = true`; `codigo_error`/`mensaje_error`; **error** incident; **halt successors** (below). |
| `duplicate_annulled` | `detenido` | **error** incident. The number is permanently burned; a retry cannot help — needs a human. |
| `duplicate_unknown` | Route B → | consulta + `Huella` compare (below): **match** → `aceptado` (`confirmado_en = now`); **differ** → `detenido` + **error** incident. |

**Route B.** For a `duplicate_unknown` line, call `client.consultar(cabecera, filtro)` targeting
this single record (`Ejercicio`/`Periodo` derived from its `FechaExpedicionFactura` per §1, plus
`NumSerieFactura` + `FechaExpedicionFactura`), find the matching `RegistroConsultado`, and compare
its `DatosRegistroFacturacion.Huella` against our stored `registros_facturacion.huella` — a
single-field comparison equivalent to diffing every hashed field. Matching huella → the record is
correctly stored → `aceptado`. Differing huella → a genuine divergence, the one thing most worth
catching → `detenido` + alert. Assuming a match without comparing would silently swallow that
divergence; Route A alone is not enough.

**Halting a chain.** On a genuine `rejected` (or a Route-B mismatch, or `duplicate_annulled`), the
record itself takes its terminal estado and its still-`pendiente` **chain successors** — same
`sif_id`, higher `secuencia` — transition to `detenido`, so nothing submits over an unresolvable gap
in a chronologically-ordered stream. This should be near-unreachable in practice: `validate()` runs
pre-flight before a record is ever enqueued, so rejections are caught locally where they are
fixable.

**`Incidencia="S"`.** Set (`incidencia = true`) on any record with a failed attempt, and on any
record enqueued while an incident is open for its chain — art. 16.4's flagging duty on affected
messages.

**Incidents** use the ready `incidents` table: nullable `saleId` (the drainer raises incidents with
no sale attached — the column comment already anticipates this), structured `code`/`params` (never
prose — the translatable-errors constraint), `severity` `warning | error`. No schema change.

---

## 9. `DrainResult` and interface changes

`FiscalBackend` gains `drain`, filling one of the two reserved-but-absent names (the interface's own
doc comment forbids `flush`/`sync`/`push` in their place):

```ts
drain(now: Date): Promise<DrainResult>;

interface DrainResult {
  nextDueAt: Date | null;   // when the caller should invoke drain again; null = nothing pending
  batchesSent: number;
  recordsSubmitted: number;
  recordsAccepted: number;  // includes accepted_with_errors
  recordsHalted: number;    // rechazado + detenido
  incidentsRaised: number;
}
```

Summary + `nextDueAt` only — the scheduler needs `nextDueAt`; the counts are for a log line and for
observability. No per-record detail crosses the interface (a caller that needs it reads the tables).

`FakeFiscalBackend.drain` ships in the same PR (TypeScript requires every implementor to have the
method). It is minimal but **honest, not a stub**: it transitions its own `pending` fake records to
`acknowledged` and returns a summary with `nextDueAt: null`. This gives the method a meaningful fake
— the property the interface doc comment demands before a method is added — so a `packages/core`
test could drive "drain acknowledges pending records → `pendingCount` drops" if it wants one, while
the *real* submission behaviour is proven by `VerifactuBackend.drain` against the fake AEAT.

`reconcile` stays absent — plan 3b.

---

## 10. `RefExterna` stamping

The drainer stamps `RefExterna = our registro id` at submission — plan 3b's retrieval-by-our-id
key. It is **derived, not stored**: `RefExterna` is deterministically `registros_facturacion.id`
(a UUID Postgres mints on insert), and it is **not a huella input**
(`CadenaAltaInput`/`CadenaAnulacionInput` list 8 and 5 fields respectively; `RefExterna` is in
neither), so it is safe to attach after the huella is computed and the row stored, with zero risk of
perturbing an already-hashed value. Concretely: `serializeEnvio` receives
`{ …fromRegistroRow(row), RefExterna: row.id }`. **No `ref_externa` column, no migration** — called
out explicitly so it is not reopened by reaching for a new column.

---

## 11. Testing posture (inherits 2026-07-19 §10)

- **Fake AEAT at the `fetch` layer** (§5) so real `serializeEnvio`/`parseRespuestaSuministro` run
  end-to-end in drainer tests — never mock the parse/serialize boundary itself.
- **Teeth checks carried forward verbatim:**
  - Drop the CSV write from T2 → a test must fail.
  - A 3000 with `EstadoRegistroDuplicado: Correcta` resolves to *accepted*, not rejected, despite
    the outer `Incorrecto`.
  - The consulta and submission enums must not be shared — an `Anulada` consulta response parses;
    the submission parser must not accept it (a regression test asserting this stays true as the
    drainer's own types are added).
  - `TiempoEsperaEnvio = 9999` round-trips through `envio_flujo.tiempo_espera_seg` and the
    scheduling.
  - A batch of 1,001 records is **split** before `serializeEnvio` (which throws above 1000 — it does
    not chunk for you), never handed whole and never rejected with 4113/4114.
- **`parseEnvio`/`parseConsulta` round-trip property** as the mutation-gate test (§4), plus the
  fake AEAT's own behaviour tests.
- **Real Postgres, not PGlite**, for the `SKIP LOCKED` claim contention and every RLS-sensitive path
  (the cross-tenant enumeration seam, §7.1). PGlite's two traps apply: superuser bypasses RLS, and
  PGlite cannot serialise concurrent backends.
- **Per-test red phase** (observe each new test fail individually) and **real Postgres from the
  first commit** — both global constraints from §10.
- **Never a production NIF** — fixtures, and later AEAT preproduction, only.

---

## 12. Carried risks and gated items

- **Real AEAT submission stays gated** on a certificate + preproduction access (§11). 3a is built
  and tested entirely against the faithful fake.
- **`formatAmountExact`** (0b) is a parallel PR. The drainer only re-emits amounts already stored on
  the row, so it needs no revisiting whichever order they land.
- **Consulta rate limit** is undocumented — *absence of a documented limit, not a documented
  absence* (§11). It bites 3b's sweep, not 3a's targeted Route-B consulta; budget to discover it
  empirically in preproduction.
- **`borjamrd/verifactu-conformance`** stays a separate, pinned, source-verified follow-up — out of
  scope here.

---

## 13. New / changed files (orientation for the plan)

| Path | Change |
| --- | --- |
| `packages/verifactu/src/xml/parse-request.ts` | **new** — `parseEnvio` / `parseConsulta` |
| `packages/verifactu/src/index.ts` | export the two parsers (+ `index.test.ts` reachability) |
| `packages/verifactu/src/testing/fake-aeat.ts` | **new** — the stateful fake AEAT |
| `packages/fiscal-verifactu/src/schema/envio-flujo.ts` | **new** — the `envio_flujo` table + migration |
| `packages/fiscal-verifactu/src/drain.ts` | **new** — the drainer logic |
| `packages/fiscal-verifactu/src/backend.ts` | `client` option; `drain` delegating to `drain.ts` |
| `packages/fiscal/src/backend.ts` | `drain(now): Promise<DrainResult>` + `DrainResult` on the interface |
| `packages/fiscal/src/testing/fake-backend.ts` | `FakeFiscalBackend.drain` |
