# Handoff — plan 3b: reconciliation + acks

**Date:** 2026-07-21
**Main:** `411ec7b` — "Write-path hardening: tenantId on FiscalBackend, pendingCount RLS fix, SIF dedup (#13)", squash-merged. This is deliverable 0 of plan 3 (the prep PR), done.
**Next work:** the `reconcile(period)` periodic audit against consulta, plus the ack contract/state machine and its in-process transport (spec §7 "Reconciliation" + "Acks flow downstream", shaped further by the plan-3 design's §4).
**Sequencing:** strictly after plan 3a (`0 → 1 → 2`). This plan **consumes** the `RefExterna` stamp and the `envios.estado` transitions plan 3a produces — read [`2026-07-21-plan-3a-submission.md`](2026-07-21-plan-3a-submission.md) first, or at minimum its "RefExterna" and "real code surface" sections, before brainstorming this one. In particular: the fake AEAT plan 3a builds is reused here for the consulta path, so if 3a hasn't landed, this plan has no test infrastructure to run against yet.

This handoff is self-contained for brainstorming and planning 3b specifically. It does not duplicate §7's regulatory content at length — it points to it and records what's open, what's already built, and what a fresh session would otherwise have to re-derive from code.

---

## Read these first, in this order

1. [`docs/superpowers/specs/2026-07-21-submission-and-reconciliation-design.md`](../superpowers/specs/2026-07-21-submission-and-reconciliation-design.md) §4 — the shaping for this exact deliverable: `reconcile(period)` as an independent audit, the four mechanics, acks downstream, and the honest scope note on the unsent count. Also skim §§6-8 for the interface change and cross-plan seams.
2. [`docs/superpowers/specs/2026-07-19-sales-spine-and-fiscal-layer-design.md`](../superpowers/specs/2026-07-19-sales-spine-and-fiscal-layer-design.md) §7's "Reconciliation" and "Acks flow downstream" subsections, plus §6 (`FiscalBackend`, where `reconcile(period)` is the reserved-but-absent name).
3. [`docs/compliance/verifactu-findings.md`](../compliance/verifactu-findings.md) §2 — specifically the justification-on-demand duty (*"deberán ser debidamente justificadas por el remitente si así se lo requiere la AEAT"*), which reconciliation is the concrete answer to. §5.4 lists the persistent unsent-count UI requirement, which this plan does not build (see the honest-scope section below) but should not contradict.
4. [`2026-07-21-plan-3a-submission.md`](2026-07-21-plan-3a-submission.md) (sibling document) — the `RefExterna`/estado contract this plan depends on, and the fake AEAT this plan's consulta tests reuse.

---

## `reconcile(period)` is a periodic *independent audit* — not an ack fallback

This is the one framing point most worth getting right before touching code, because "reconciliation" reads naturally as a safety net for missed acks, and that reading is wrong.

**Consulta *is* the reconciliation mechanism** — there is no bulk export; the *servicio de cotejo* is a per-invoice tool for the invoice recipient, not the issuer. So a periodic sweep per `PeriodoImputacion`, diffing AEAT's stored truth against local `envios`, is the only automatable reconciliation surface that exists. Crucially: **it runs on a schedule even when every ack arrived cleanly.** It is an audit, not a liveness check and not a retry mechanism.

The relationship to acks, stated precisely because the two are easy to conflate:

| | What it is | What it catches |
| --- | --- | --- |
| **Acks** (§4.2 below) | The normal-path submission *result*, propagated per-record | A record whose ack was **lost** — believed pending, but AEAT already holds it. This is the one case that looks like a safety net for acks. |
| **Reconciliation** | A periodic, unconditional sweep | The lost-ack case above, **plus** two an ack structurally cannot catch: a record believed **accepted** that AEAT has **no trace of** (§7: *"undetectable without this — the system would believe itself compliant"*), and state **drift** (AEAT holds `AceptadaConErrores` on a record we believe clean). |

An ack cannot detect its own failure to have been sent correctly, or a record that silently never made a legible envío in the first place. That is precisely why reconciliation is unconditional rather than gated on "did we get an ack for everything." **What healthy acks buy is cadence** — the sweep can run less often when no incident is open — never *whether* it runs at all. This is also the concrete, auditable answer to art. 16.4's justification-on-demand duty: when AEAT asks, the sweep's own diff record is the evidence.

---

## The four mechanics — each with the wrong answer it exists to prevent

All four are from spec §7/§4.1 verbatim; restated here with the failure each guards against, because each one produces a plausible-looking wrong answer if skipped.

| Mechanic | Wrong answer if missed |
| --- | --- |
| **Diff on `EstadoRegistro`, not on mere presence.** A record appearing in the consulta results is not proof it's live and clean. | `AceptadaConErrores` records stay flagged **forever** — presence would read as "fine." `Anulada` records still appear in results — presence would read as "still a live invoice." Both need the actual enum value compared, not just "did AEAT return something for this id." |
| **`PeriodoImputacion` derived from fecha de operación**, falling back to fecha de expedición. **⚠️ Medium-confidence** — re-verify against `Descripcion_SWeb` §6.4 before encoding; this derivation is read from that PDF at one remove and is explicitly flagged unverified in both source documents. | Querying the wrong month (e.g. the expedition month for a cross-month operation) returns `SinDatos` for a record that genuinely exists — a false "AEAT has no trace of this," which is exactly the alarming, action-triggering case §4.1 exists to detect correctly. Getting the period wrong manufactures false positives of the worst kind. |
| **Results ordered by fecha de presentación, not invoice date.** | A sweep running while submissions are still in flight can page **past** newly-arriving records — the ordering key is presentation time, so an in-progress submission reorders what "next page" means mid-sweep. The sweep must tolerate this (e.g. by not assuming a single pass is atomic against concurrent drainer activity), not assume a stable total order by invoice identity. |
| **Leave `MostrarNombreRazonEmisor`/`MostrarSistemaInformatico` unset.** | Both slow the response, and neither is needed to diff (`EstadoRegistro` + `Huella` + `TimestampUltimaModificacion` are the fields that matter). Setting them "just in case" is a pure cost with no corresponding benefit for this use case. |

**Because rejected records are never stored by AEAT at all, absence is unambiguous** — a genuine "AEAT has no trace of this record we believe accepted" is a real, detectable, alarming state, not an artifact of paging or timing (once the period-derivation and ordering caveats above are respected).

---

## Paging, retrieval, and the residual risk

- **Paging via `ClavePaginacion`, capped at 10,000 records/page.** `packages/verifactu/src/xml/parse-consulta.ts`'s `RespuestaConsulta` already carries `IndicadorPaginacion: "S" | "N"` and an optional `ClavePaginacion: IDFactura` — echo it verbatim into the next request's `ConsultaFiltro.ClavePaginacion` (`packages/verifactu/src/xml/serialize.ts`) to continue. `ConsultaFiltro` is `{ Ejercicio, Periodo, NumSerieFactura?, FechaExpedicionFactura?, ClavePaginacion? }` — `Ejercicio`/`Periodo` (the `PeriodoImputacion`) are mandatory even for a single-invoice query.
- **`RefExterna` retrieval.** Plan 3a stamps `RefExterna = our registro id` at submission time (see its handoff). `RegistroConsultado.DatosRegistroFacturacion` (`parse-consulta.ts`) is typed `Record<string, unknown> & { Huella?: string; TipoHuella?: string }` — a loosely-typed grab-bag by design, since the consulta response echoes back a large, mostly-unused chunk of the original record. **Confirm at implementation time whether `RefExterna` is actually retrievable off this bag** (AEAT's spec treats it as "both a filter and a stored field" per the design doc, so it should round-trip) — this narrows the effort of matching a consulta result back to our own row without reconstructing AEAT's triple (`IDEmisorFactura`/`NumSerieFactura`/`FechaExpedicionFactura`).
- **Consulta rate-limit risk, carried, not solved.** No rate limit is documented for consulta at all — `TiempoEsperaEnvio` doesn't even appear in the consulta response schema. This is *absence of a documented limit*, not a documented absence of one. Since this plan runs periodic sweeps, **budget to discover the real limit empirically in preproduction** — it is not buildable against now, and the plan should say so rather than guess a number.

---

## Acks downstream — contract, state machine, in-process transport only

This is the piece of spec §1's deferred boundary ("sync transport is deferred... the wire protocol is sub-project 9") that belongs to plan 3b. Scope precisely:

- **This plan builds:** the ack contract (payload = record id, submitted-at, CSV, state), the state machine those payloads drive, and an **in-process transport interface** satisfying that contract, tested in-process (no real network, no real till-to-upstream sync).
- **This plan does not build:** the wire protocol itself — that's sub-project 9 — or a wired-up till client consuming acks over a real connection.

**Why acks carry true AEAT state rather than local sync backlog:** a till that is syncing happily to its upstream node, whose certificate has silently expired, must still show a **non-zero** unsent count. If acks just meant "synced to the upstream node" the count would read zero while nothing had actually reached AEAT — precisely the art. 16.4 gap the duty exists to prevent. So the ack payload's `state` needs to reflect AEAT's own acceptance, sourced ultimately from `envios.estado` as plan 3a's drainer sets it (or from this plan's own reconciliation sweep, in the drift/lost-ack cases above) — not from "the till's local copy is up to date with the submitting node."

### The unsent count — an honest scope note, worth stating plainly in the plan

In the **standalone (single-node)** deployment, the submitting node *is* the till, so `FiscalBackend.pendingCount` reads `envios` directly and **is already correct** once the prep PR (`tenantId` fix, done at `411ec7b`) and plan 3a (the drainer's estado transitions) both exist. **Nothing about acks is needed for the standalone count to be right.**

The downstream-ack path only matters in the **distributed** topology — several tills, one node holding the certificate and submitting on their behalf. There, "unsent" has to mean "not yet acked by AEAT via the submitting node," and that live consumer is a sub-project-9 concern (the wire protocol) plus the till-side screen (sub-project 7). So **3b delivers the ack contract and its in-process test — not a wired-up till client** — and should say this explicitly rather than let "acks" sound like it closes the distributed unsent-count gap on its own.

---

## Open decisions to brainstorm (with a recommendation for each)

### 1. `reconcile(period) → ReconcileResult` — signature and result shape

Neither exists yet; `reconcile` is currently only a reserved name on `FiscalBackend` (`packages/fiscal/src/backend.ts`, doc comment: *"deliberately absent until that plan designs flow control, error-3000 resolution and the file-export persistence rule"* — that comment is slightly stale in referring to 3a's concerns, but the absence itself is real and deliberate). Recommend shaping `period` as the `PeriodoImputacion` pair (`{ ejercicio: string; periodo: string }`, matching `ConsultaFiltro`'s own `Ejercicio`/`Periodo` fields) rather than a generic date range, since that's the unit AEAT actually queries by. `ReconcileResult` needs at least: counts or lists for each of the three cases in the table above (lost-ack, no-trace, drift), plus enough identity per mismatch (registro id, `IDFactura` triple) to act on. This is genuinely open — brainstorm the exact shape rather than guessing it here.

### 2. Where the sweep's scheduler lives

Same answer as plan 3a's `drain(now)`: **out of scope for this plan.** `reconcile` should be one callable pass over one period, driven by whatever cadence a caller chooses (art. 16.4's "less often when healthy" framing is a caller policy, not something baked into `reconcile` itself). `apps/*` is out of scope for the whole sub-project (2026-07-19 design §1) — 3b ships the callable plus a test harness, not a cron.

### 3. `PeriodoImputacion` derivation — re-verify before encoding

Flagged medium-confidence in both source documents (verifactu-findings.md doesn't independently confirm it; the sales-spine design cites `Descripcion_SWeb` §6.4 at one remove). **Recommend this is the first thing checked against the primary PDF when 3b starts**, before any code encodes "fecha de operación, falling back to fecha de expedición" as fact — a wrong derivation manufactures false `SinDatos` results, which is the worst kind of reconciliation bug (an alarm that fires on healthy records).

### 4. The ack contract's concrete shape and the in-process transport interface

Genuinely undesigned yet. Recommend starting from the payload spec §7 already names (record id, submitted-at, CSV, state) and designing the transport as a plain interface (e.g. `send(ack): Promise<void>` / `receive(): AsyncIterable<Ack>` or similar) with an in-process implementation (a queue in memory, or writing to and reading from a local table) good enough to prove the state machine end-to-end in tests, explicitly documented as **not** the sub-project-9 wire protocol so nobody mistakes the in-process version for a finished distributed feature.

---

## Testing posture (inherits spec §10, applied to reconciliation specifically)

- **Reuse plan 3a's fake AEAT** for the consulta path — it's built to be reused here (per the plan-3a handoff); don't build a second one.
- **Regression tests for the enum-sharing trap, from the reconciliation side too:** a consulta response carrying `Anulada` must parse (`parse-consulta.ts`'s `EstadoRegistroConsulta` already includes it); make sure nothing 3b adds tries to funnel a consulta result through submission's `EstadoRegistroSuministro`/`resolveEstadoEfectivo` — they are different questions over different enums, and 3a's own function is scoped to the submission response only.
- **Test the three reconciliation cases as three separate, explicit scenarios** against the fake (lost-ack, no-trace, drift) — not just "the happy path where everything matches," since the entire point of this plan is the three cases where it doesn't.
- **`ClavePaginacion` continuation must be tested with a genuine multi-page fixture** (the fake AEAT needs to actually paginate, not just accept the parameter and ignore it), given the ordering caveat above (presentation-date order, not invoice order) is exactly the kind of thing a single-page test would never exercise.
- **Never a production NIF; fixtures and, later, preproduction only** — same constraint as everywhere else in this sub-project.

---

## Carried risks and gated items

- **Consulta rate limit undocumented** — discover empirically in preproduction; do not encode a guessed number now.
- **`PeriodoImputacion` derivation is medium-confidence** — re-verify against `Descripcion_SWeb` §6.4 before encoding (decision 3 above).
- **Real AEAT submission/consulta stays gated** on a certificate + preproduction access (spec §11) — 3b is built and tested entirely against the fake, same as 3a.
- **The distributed unsent-count path is contract-only in this plan** — the honest-scope note above. Don't let "acks landed" read as "the distributed unsent count works end-to-end"; it doesn't, until sub-project 9 and sub-project 7 both exist.
