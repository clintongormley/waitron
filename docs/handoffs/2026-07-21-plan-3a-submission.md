# Handoff — plan 3a: submission (the drainer)

**Date:** 2026-07-21
**Main:** `411ec7b` — "Write-path hardening: tenantId on FiscalBackend, pendingCount RLS fix, SIF dedup (#13)", squash-merged. This is deliverable 0 of plan 3 (the prep PR), done. Plan 3a is deliverable 1.
**Next work:** transport wiring, the faithful fake AEAT, and the outbox drainer against `envios` (spec §7, shaped further by the plan-3 design's §3).
**Sibling document:** [`2026-07-21-plan-3b-reconciliation.md`](2026-07-21-plan-3b-reconciliation.md) — deliverable 2, sequenced strictly after this one (`0 → 1 → 2`). 3a stamps `RefExterna`; 3b consumes it. Read that document too before locking the estado/`RefExterna` contract this plan hands it.

This handoff is self-contained for brainstorming and planning 3a specifically. It does not duplicate §7's regulatory content at length — it points to it and records what's open, what's already built, and what a fresh session would otherwise have to re-derive from code.

---

## Read these first, in this order

1. [`docs/superpowers/specs/2026-07-21-submission-and-reconciliation-design.md`](../superpowers/specs/2026-07-21-submission-and-reconciliation-design.md) §§1-3, 5-8 — **shapes how 3a is built**: the deliverable split, the transport boundary, the fake-AEAT approach, `drain(now)`'s shape, the `FiscalBackend` interface change, cross-plan seams, testing posture. Where this and §7 disagree on *code shape* (not regulation), this document wins — it says so explicitly.
2. [`docs/superpowers/specs/2026-07-19-sales-spine-and-fiscal-layer-design.md`](../superpowers/specs/2026-07-19-sales-spine-and-fiscal-layer-design.md) §7 — the primary design: batching, flow control, CSV persistence, error 3000, rejections, `Incidencia`. Verified against primary AEAT sources (cited at the top of §7: the XSDs/WSDL, `Descripcion_SWeb` v1.0.3, `Validaciones_Errores` v1.2.2, `FAQs-Desarrolladores` v1.3, Orden HAC/1177/2024 Anexo 2.2).
3. [`docs/compliance/verifactu-findings.md`](../compliance/verifactu-findings.md) §2 (no submission deadline, but real duties: hourly retry, chronological order on recovery, `Incidencia="S"`, persistent on-screen unsent count, justification on demand) and §5.4 (which of these are not yet built — this plan builds most of the list).
4. [`docs/handoffs/2026-07-21-sales-spine-landed-next-submission.md`](2026-07-21-sales-spine-landed-next-submission.md) — voice/density reference for this document, and the origin of the `tenantId` gap that PR #13 (below) already closed.

---

## What PR #13 already fixed (the prerequisite this plan builds on)

The prep PR landed on `main` at `411ec7b`. `FiscalBackend`'s signatures are now:

| Method | Signature now on `main` |
| --- | --- |
| `checkIntegrity` | `checkIntegrity(tx: Transaction, tenantId: TenantId, tillId: TillId): Promise<IntegrityReport>` |
| `pendingCount` | `pendingCount(tenantId: TenantId, tillId: TillId): Promise<number>` — no `tx`; runs inside `withTenant(this.db, tenantId, …)` so `app.tenant_id` is set and the art. 16.4 unsent-count read is correct under real RLS as `app_user` (previously silently returned 0). |

Both live in `packages/fiscal/src/backend.ts`. `VerifactuBackend` (`packages/fiscal-verifactu/src/backend.ts`) implements the corrected signatures already. The within-module SIF-row dedup (`appendToChain`/`attemptAppend` now accept a pre-fetched `SifRegistration`) also landed — nothing further to do there for 3a.

**`drain` and `reconcile` are still reserved-but-absent** on `FiscalBackend`. The interface's own doc comment (`packages/fiscal/src/backend.ts`) says why: "An interface method with no caller and no meaningful fake is dead surface that mutation testing cannot reach... Do not introduce `flush`, `sync` or `push` in their place." Plan 3a fills `drain`; 3b fills `reconcile`.

**`VerifactuBackend` holds no verifactu client today.** `VerifactuBackendOptions` is `{ clock, db, environment?, systemInfo? }` — no `client`, no `fetch`. Submission is entirely unwired. This is the first thing 3a's plan changes.

---

## Open decisions to brainstorm (with a recommendation for each)

### 1. Transport boundary: inject `VerifactuClient` into `VerifactuBackend`

**Recommend:** add `client: VerifactuClient` to `VerifactuBackendOptions`, alongside the existing `clock`/`db`/`environment`/`systemInfo`. No new abstraction — `packages/fiscal-verifactu` already depends on `packages/verifactu`, and `packages/verifactu/src/client.ts` already exports exactly the narrow interface needed:

```ts
export interface VerifactuClient {
  submit(cabecera: Cabecera, registros: EnvioRegistro[]): Promise<RespuestaSuministro>;
  consultar(cabecera: Cabecera, filtro: ConsultaFiltro): Promise<RespuestaConsulta>;
}
```

`createClient({ endpoint, fetch })` builds one. **mTLS cert/key and the endpoint stay exactly where they already live** — inside the caller-supplied `fetch` (a Node `Agent`/`Dispatcher` carrying the client certificate) plus the `endpoint` string. The app wires a real client over a real `fetch`; tests wire a client over the fake `fetch` (below). This is precisely the "submitter is an interface, not a location" property findings §5.1/§5.2 rely on — moving submission onto tills later is a provisioning change, not a redesign.

### 2. The faithful fake AEAT — build it at the `fetch` layer

**No fake AEAT server exists today.** Current tests (per the design docs) inject a bare `fetch` mock returning hardcoded XML — it never exercises `serializeEnvio`/`parseRespuestaSuministro` against a plausible round trip. Plan 3a must build a **stateful in-memory AEAT modelled on `Validaciones_Errores_Veri-Factu.pdf`**, installed as the injected `fetch: typeof globalThis.fetch`. It needs to:

- **Parse the inbound SOAP body** (the real `serializeEnvio`/`serializeConsulta` output) to know what was submitted — record identities, whether this is a resubmit (triggers 3000), whether a record is future-dated (triggers 2004), etc. This is new work: nothing in `packages/verifactu` today parses its own *request* XML (only responses, via `parse-suministro.ts`/`parse-consulta.ts`). Recommend either exporting a minimal request-parser from `packages/verifactu` for the fake to use, or giving the fake its own small tolerant XML read (it only needs a handful of fields: `IDFactura`, `NombreRazon`/`NIF` off `Cabecera`, and enough of `RegistroAlta`/`RegistroAnulacion` to track identity and content for the duplicate/huella-compare logic). Either way this is a real design decision to make explicitly, not an incidental detail — brainstorm it early since the rest of the fake's shape depends on it.
- **Produce real response XML** that the *unmodified* `parseRespuestaSuministro`/`parseRespuestaConsulta` parse — so drainer tests exercise real serialize→fake-transport→real-parse end to end, the same "don't mock the boundary you are testing" reasoning as the DB layer's real-Postgres rule.
- **Model:** issuing CSVs; a decreasing `TiempoEsperaEnvio` (start 60s, AEAT updates it every response); error 3000 with a `RegistroDuplicado` block on resubmit (state `Correcta`/`AceptadaConErrores`/`Anulada` per what it actually holds); error 2004 on future-dating (non-rejecting); per-record rejections; and, for 3b, consulta responses with `ClavePaginacion` and stored `Huella`/`Encadenamiento`.

**Recommend placement:** `packages/verifactu/src/testing/fake-aeat.ts`, mirroring the existing `packages/fiscal/src/testing/fake-backend.ts` convention (a `testing` subpath export, not a production dependency). This keeps it in the library both consuming packages already depend on, and the design doc explicitly says it's "reused by plan 3b's consulta path" — so it needs a home reachable from both the drainer's tests (3a) and the reconciliation sweep's tests (3b) without creating a package cycle. Since `packages/fiscal-verifactu` already depends on `packages/verifactu`, this direction is free.

This fake is a plan-3a deliverable in its own right — budget real time for it, not just for the drainer.

### 3. `drain(now) → DrainResult` is one pass; the scheduler lives outside this plan

**Recommend:** `drain(now: Date): Promise<DrainResult>` becomes the new `FiscalBackend` method. One call drains everything currently due (`estado = 'pendiente' AND proximo_intento_en <= now`, per-tenant batching, ≤1000/envío — see below) and returns the next-due time (or `null`/similar if nothing is pending) so a caller can schedule the next invocation. **`DrainResult`'s exact shape is undesigned — brainstorm it now**; it likely needs at minimum a next-due timestamp and enough of a summary (records sent, records rejected/halted) to log or surface.

The repeating cadence — the flow-control race and the art. 16.4 hourly floor — is the **caller** re-invoking `drain` on the returned schedule, driven by `proximo_intento_en` in the DB (never an in-memory timer, per findings §5.4 — this is what makes the hourly duty survive a restart or a week offline). **The scheduler is an app concern** (`apps/*` is out of scope for this whole sub-project, per the 2026-07-19 design §1) — 3a ships the callable `drain` plus a test harness that drives it directly (e.g. calling it repeatedly with advancing fake time), **not** a long-running loop or cron. Recommend being explicit in the plan about exactly where the line falls, since "the drainer" colloquially suggests an always-running process and this plan does not build one.

### 4. `RefExterna = our registro id`, stamped by the drainer at submission time — not at write time

The design's plan-3b dependency: *"The drainer stamps `RefExterna = our registro id` at submission... the retrieval key plan 3b depends on."* Two things worth confirming precisely for whoever writes the code, both verified this session:

- **`RefExterna` is NOT a huella input.** `packages/verifactu/src/huella.ts`'s `CadenaAltaInput`/`CadenaAnulacionInput` list exactly 8 and 5 fields respectively (`IDEmisorFactura`/`NumSerieFactura`/`FechaExpedicionFactura`/`TipoFactura`/`CuotaTotal`/`ImporteTotal`/predecessor `Huella`/`FechaHoraHusoGenRegistro` for alta; the anulación equivalents plus `Huella`/`FechaHoraHusoGenRegistro` for anulación) — `RefExterna` is not among either list. So it is safe to set **after** the huella is already computed and the row already inserted, with zero risk of it perturbing a value that's already been hashed and stored.
- **It is not currently persisted as a column.** `packages/fiscal-verifactu/src/schema/registros.ts` has no `ref_externa` column, and `registro-row.ts`'s `toRegistroRow`/`RegistroRowInsert` never populate one. That's fine — it doesn't need one: `RefExterna` is deterministically `= registros_facturacion.id` (a UUID minted by Postgres on insert), so the drainer can derive it at serialization time rather than needing a stored, redundant copy. Concretely: the drainer reads the row, calls the existing `fromRegistroRow(row)` (`packages/fiscal-verifactu/src/registro-row.ts`, already used by `VerifactuBackend`'s own `qrPayloadFor`) to rebuild the `RegistroAlta`/`RegistroAnulacion`, then spreads `{ ...record, RefExterna: row.id }` before handing it to `serializeEnvio`. **No migration needed.**

Recommend the plan states this explicitly rather than reopening it — it's a one-line implementation once known, but easy to get wrong by reaching for a new column.

---

## The high-consequence rules, each with its consequence

All from spec §7, restated with what breaks if missed:

| Rule | If missed |
| --- | --- |
| **CSV persisted in the same transaction as the submission response** (`envios.csv`) | Unrecoverable — no CSV element exists anywhere in the consulta response schema (`RespuestaConsultaLR.xsd`), and resubmission never returns it either. **The single highest-consequence line in the whole outbox.** §10's teeth-test (drop the write → a test must fail) protects it; carry that test into 3a. |
| **Error 3000 resolved via both Route A and Route B** | Route A alone (the `RegistroDuplicado` block) leaves `duplicate_unknown` cases unresolved. Assuming acceptance on `duplicate_unknown` without comparing huella would silently swallow a genuine divergence — the one thing worth catching. `resolveEstadoEfectivo` (below) already implements the inversion; 3a's job is calling consulta for the `"duplicate_unknown"` case and comparing the returned `Huella` against the stored one. |
| **Batch per obligado tributario (tenant), ≤1000 records/envío, ordered by chain sequence within each SIF** | The batching key is the *tenant*, not the till — several tills' records may ride one envío. A 1001-record backlog must be *split*, never rejected outright with 4113/4114 (`serializeEnvio` already throws if handed >1000 — see gotchas below, it does not chunk for you). |
| **Flow control is a race: send on `t` elapsed (server-supplied, init 60s) OR 1000 records accumulated, whichever first** | Under load, waiting the full `t` caps throughput at one envío per interval — untenable for a till. `t` is persisted into `proximo_intento_en`, never an in-memory timer. |
| **A genuine rejection halts that chain's queue (`estado = 'detenido'`) and raises an `incidents` row** | Otherwise successors submit over an unresolvable gap in a chronologically-ordered stream. Should be near-unreachable in practice: `validate()` runs pre-flight before a record is ever enqueued. |
| **`Incidencia="S"`** on any record with a failed attempt, and on any record enqueued while an incident is open | Art. 16.4's flagging duty on affected messages. |
| **Retry backoff exponential, capped at 3600s** | Art. 16.4 sets a *ceiling* (retry at least hourly), not a floor — faster is always compliant, slower never is. A fixed 60s-forever retry would also be compliant but wastes a request; capped exponential is the sane middle. |
| **The drainer stamps `RefExterna = our registro id`** | Plan 3b's retrieval-by-our-id depends on it; see decision 4 above. |

---

## The real code surface (report these precisely — they're easy to get subtly wrong from memory)

### `envios` — the sidecar this drainer drains

`packages/fiscal-verifactu/src/schema/envios.ts`. Primary key is `registro_id` itself (1:1, structural not conventional).

| Column | Type | Notes |
| --- | --- | --- |
| `registroId` | `uuid` PK | FK to `registros_facturacion.id` |
| `tenantId` | `uuid` NOT NULL | FK to `tenants.id` |
| `estado` | `text` NOT NULL, default `'pendiente'` | CHECK constrains to the 6-value enum below |
| `intentos` | `integer` NOT NULL, default `0` | |
| `proximoIntentoEn` | `timestamptz` NOT NULL, default `now()` | Persisted, drives everything — never an in-memory timer |
| `incidencia` | `boolean` NOT NULL, default `false` | `Incidencia="S"` flag |
| `csv` | `text`, nullable | Written in the same tx as the response that carried it — see the high-consequence table above |
| `codigoError` | `text`, nullable | |
| `mensajeError` | `text`, nullable | |
| `enviadoEn` | `timestamptz`, nullable | |
| `confirmadoEn` | `timestamptz`, nullable | |

`estado` enum (CHECK `envios_estado_ck`): **`pendiente`, `enviando`, `aceptado`, `aceptado_con_errores`, `rechazado`, `detenido`**. The write path (already landed) only ever inserts `pendiente`; every other transition and every other column is this plan's job.

Index `envios_drenaje_idx` on `(tenant_id, estado, proximo_intento_en)` already exists — it's the drainer's exact access path (per-obligado-tributario, oldest due first) and needs no migration.

`registros_facturacion.secuencia` (per `(tenant_id, till_id)`) is the chain-order key the design means by "ordered by chain sequence within each SIF" — join `envios` to `registros_facturacion` on `registro_id` to get it; `envios` itself carries no ordering column.

### `resolveEstadoEfectivo` — already built, in `packages/verifactu/src/xml/parse-suministro.ts`

```ts
export type EstadoEfectivo =
  "accepted" | "accepted_with_errors" | "rejected" | "duplicate_annulled" | "duplicate_unknown";

export function resolveEstadoEfectivo(linea: RespuestaLinea): EstadoEfectivo
```

Already encodes the error-3000/`RegistroDuplicado` inversion: if `CodigoErrorRegistro === 3000`, it reads `RegistroDuplicado.EstadoRegistroDuplicado` (`Correcta`→`accepted`, `AceptadaConErrores`→`accepted_with_errors`, `Anulada`→`duplicate_annulled`, anything else→`duplicate_unknown`); otherwise it reads the outer `EstadoRegistro` (`Correcto`→`accepted`, `AceptadoConErrores`→`accepted_with_errors`, else→`rejected`). **3a's job is mapping these five `EstadoEfectivo` values onto `envios.estado` transitions and, for `duplicate_unknown` only, calling consulta and comparing huella** (Route B) before deciding `accepted` vs. halt.

### The client and serialization surface

- `packages/verifactu/src/client.ts` — `VerifactuClient { submit, consultar }`, `createClient({ endpoint, fetch })`. `fetch: typeof globalThis.fetch` injected; `post()` sends `SOAPAction: '""'` on every call (dispatch is by body, not header) and throws on non-2xx.
- `packages/verifactu/src/xml/serialize.ts` — `serializeEnvio(cabecera: Cabecera, registros: EnvioRegistro[])`, `serializeConsulta(cabecera, filtro: ConsultaFiltro)`. `EnvioRegistro = { RegistroAlta } | { RegistroAnulacion }`. **`MAX_REGISTROS_POR_ENVIO = 1000` is exported**, and `serializeEnvio` **throws** (does not silently truncate) if handed more — the drainer must do its own ≤1000 chunking before calling it, never rely on this as a safety net for an unbounded batch.
- `packages/verifactu/src/xml/parse-suministro.ts` — `EstadoEnvio`/`EstadoRegistroSuministro`/`EstadoRegistroDuplicado` (three *separate* enums, deliberately not shared with consulta's), `RespuestaSuministro { CSV?, EstadoEnvio, TiempoEsperaEnvio, RespuestaLinea[] }`. `TiempoEsperaEnvio` is typed as a real number (schema's `\d{0,4}`, up to 9999s) — never narrow it.
- `packages/verifactu/src/xml/parse-consulta.ts` — separate `EstadoRegistroConsulta` (`"Correcta" | "AceptadaConErrores" | "Anulada"`, no `Incorrecta` — rejected records are never stored, so a query can never return one), `RespuestaConsulta { ResultadoConsulta, IndicadorPaginacion, ClavePaginacion?, registros }`. Primarily 3b's territory but 3a needs this for the Route-B huella compare on `duplicate_unknown`.

### `incidents` table — already anticipates this plan

`packages/db/src/schema/incidents.ts` has `saleId: uuid("sale_id").references(() => sales.id)` **nullable**, with the comment *"plan 3's drainer raises incidents with no sale attached"* already in place. `code`/`params` are structured (never prose — the Global Constraint on translatable errors), `severity` is `warning | error`. **No schema change needed here** — this table is ready for the halt-a-chain incident the rejection rule requires.

---

## Testing posture (inherits spec §10, applied to submission specifically)

- **Fake AEAT at the fetch layer** (decision 2) so real `serializeEnvio`/`parseRespuestaSuministro` run end-to-end in drainer tests — never mock the parse/serialize boundary itself.
- **Teeth checks to carry forward, verbatim from the design docs:**
  - Drop the CSV write from the submission-response path → a test must fail.
  - A 3000 with `EstadoRegistroDuplicado: Correcta` must resolve to *accepted*, not rejected, despite the outer `Incorrecto`.
  - The consulta and submission enums must not be shared — an `Anulada` consulta response must parse; the submission parser must not accept it as a value (already true today: they're separate exported types — a regression test should assert this stays true as the drainer's own types are added).
  - `TiempoEsperaEnvio = 9999` must round-trip through whatever storage the drainer uses for `proximo_intento_en` scheduling.
  - A batch of 1,001 records must be split before calling `serializeEnvio`, never handed to it whole (which would throw) and never rejected with 4113/4114.
- **Real Postgres, not PGlite, for anything touching lock contention** — none of this plan's core logic obviously needs a new lock (unlike the chain-append path), but re-check against §10's two PGlite traps (superuser bypasses RLS; PGlite cannot serialise concurrent backends) before assuming a test proves what it claims.
- **Never a production NIF.** Fixtures and, later, AEAT preproduction only.

---

## Carried risks and gated items (unchanged from the design docs, restated for this plan specifically)

- **Real AEAT submission stays gated** on a certificate + preproduction access (spec §11). 3a is built and tested entirely against the faithful fake.
- **`formatAmountExact`** (the exact-decimal-amounts-through-the-huella fix for `VerifactuBackend.recordSale`'s current `Number(sale.total)`/`Number(cuotaTotal)`) is being planned in parallel, in the same session that produced this handoff — its plan lands at `docs/superpowers/plans/`. Not this plan's problem to solve, but the drainer serializes these same amounts (`CuotaTotal`/`ImporteTotal` on the already-stored row, via `fromRegistroRow`), so if `formatAmountExact` lands first, nothing here changes; if it lands after, nothing here needs revisiting either, since the drainer only ever re-emits what's already stored.
- **`borjamrd/verifactu-conformance`** stays a separate, pinned, source-verified tracked follow-up — out of scope here.
