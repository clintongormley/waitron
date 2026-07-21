# Submission and Reconciliation — Design (plan 3 shaping)

**Date:** 2026-07-21
**Status:** Draft — brainstorming complete, pending user approval
**Covers:** §7 (outbox, submission and reconciliation) of
[`2026-07-19-sales-spine-and-fiscal-layer-design.md`](2026-07-19-sales-spine-and-fiscal-layer-design.md)
— the submission slice of architecture sub-project 3 (fiscal layer). This is **plan 3**, the third
implementation increment (plan 1 = the `verifactu` library, plan 2 = the sales spine, which landed
on `main` at `7e8054b`).

**This document shapes *how* §7 is built, not *what* §7 requires.** The regulation and the design
of the outbox, submission, error-3000 resolution and reconciliation live in §7 and in
[`docs/compliance/verifactu-findings.md`](../../compliance/verifactu-findings.md) (§2, §5.4). This
document records only what §7 leaves open: the split into deliverables, the code boundaries, the
transport and test approach, and the interface changes. **Where this and §7/the findings disagree,
they win.**

---

## 1. The split — one prep PR, then two feature plans

§7 is a large but cohesive design. Building it as one PR would repeat the PR #12 problem: a diff
past Copilot's 20,000-line review cap (so no automated review), and the longest single adversarial
review loop. It is carved into three deliverables, each its own land cycle, each inside the cap.

| # | Deliverable | Character |
| --- | --- | --- |
| 0 | **Write-path hardening** (prep PR) | `tenantId` interface change + the within-module SIF dedup. Concurrency-critical, no submission feature. Lands first, alone. |
| 0b | **Exact-decimal amounts** (own PR) | `formatAmountExact` through the huella — a `verifactu`-library API refactor, independent of everything else. Do right after 0, or fold into 3a. |
| 1 | **Submission** (plan 3a) | Transport wiring + faithful fake AEAT + the drainer. The meaty feature plan. |
| 2 | **Reconciliation + acks** (plan 3b) | Periodic consulta audit + the ack contract/state machine. |

The prep PR is separated deliberately: it changes `FiscalBackend` signatures and touches the
concurrency-critical chain layer (`chain.ts`), so it must re-verify the Testcontainers concurrency
suite. Isolating it keeps that risk out of the feature PRs and unblocks the corrected interface for
both. Sequencing is strict: **0 → 1 → 2.**

---

## 2. Deliverable 0 — write-path hardening (prep PR)

Two coupled changes to the already-landed write path — handoff follow-ups #2 and #1 — done together
because they touch the same code (the `FiscalBackend` interface and the chain layer). Follow-up #3
(`formatAmountExact`) was originally bundled here but is split into its own PR (§2.3): it is a
`verifactu`-library API refactor, independent of these two, in a different, mutation-gated package.

### 2.1 `tenantId` onto the interface

Both are one considered interface change; both re-verify RLS behaviour.

- **`checkIntegrity(tx, tenantId, tillId)`** — the caller is always inside `withTenant`, so it
  already holds `tenantId`. Passing it drops the internal `tenantIdForTill` round trip in
  `VerifactuBackend.checkIntegrity` (`packages/fiscal-verifactu/src/backend.ts`).
- **`pendingCount(tenantId, tillId)`** — the art. 16.4 compliance fix. It keeps **no `tx`** (§6:
  the unsent-count read happens outside any sale transaction), but now runs its query **inside
  `withTenant(this.db, tenantId, …)`** so `app.tenant_id` is set. Today the method runs on a bare
  `this.db` with no GUC, so under real RLS as `app_user` it silently returns **0** — the code's own
  comment flags this as unverified. After the fix the query carries both an explicit
  `WHERE tenant_id` and the RLS policy, which must agree.

> This is the compliance item the handoff called *"the most important thing for the next session."*
> It is latent, not live — there is no caller yet — but plan 3 is the first real consumer, so it is
> fixed here rather than tracked separately.

### 2.2 Round-trip dedup — within-module SIF only

The per-sale duplicate reads split by layer, and only one is safely dedupable:

- **Chain-head lock + predecessor registro** — read by `verifyChain` (reached via `checkIntegrity`,
  which *core* calls) and again by `attemptAppend` (reached via `recordSale`). Deduping these would
  route chain-ordering state out through the generic layer, which §2 and the `no-regime-vocabulary`
  guard forbid ("the chain concept never appears in the generic layer"); the head re-lock is also
  already free (reentrant within the transaction). **Left as-is** — the layering cost is not worth
  ~1ms.
- **The SIF row** — `VerifactuBackend.recordSale`/`recordVoid` already fetch it (`currentSif`) to
  build the registro input, and `attemptAppend` fetches it again for `sifId`. Both fetches are
  inside the module, so the already-fetched `SifRegistration` is **threaded into `appendToChain` →
  `attemptAppend`**. It is stable across the append retry loop (SIF identity does not change
  mid-append), so there is no re-fetch-on-retry subtlety. Plus removing `tenantIdForTill` (§2.1)
  drops a fourth duplicate.

**Concurrency:** this changes the `appendToChain`/`attemptAppend` signatures (a new pre-fetched-SIF
parameter), so the Testcontainers concurrency suite is re-verified even though the retry *logic* is
untouched. The larger cross-interface dedup from handoff follow-up #1 is not done — see the layering
reason above.

### 2.3 `formatAmountExact(string)` (follow-up #3) — its own PR

Split out of the prep PR (a bigger, different-package change than it first looked). **Planned** at
[`docs/superpowers/plans/2026-07-21-exact-decimal-amounts.md`](../plans/2026-07-21-exact-decimal-amounts.md).
`VerifactuBackend.recordSale` does `Number(sale.total)`/`Number(cuotaTotal)` into `AltaInput`'s
`number`-typed amount fields — safe today within `numeric(12,2)` range, but a latent float-boundary
coupling of the plan-1 one-cent-divergence class; `CuotaTotal`/`ImporteTotal` are direct huella
inputs.

Decisions taken during the brainstorm (2026-07-21):

- **Scope: all amount and rate fields, not just the two huella-critical ones.** The financial
  standard is that no monetary value (nor an exact-decimal VAT rate) round-trips through binary
  floating point. So `AltaInput.CuotaTotal`/`ImporteTotal`, the `DetalleDesgloseInput` amounts and
  rates (`BaseImponibleOimporteNoSujeto`, `CuotaRepercutida`, `TipoImpositivo` [`Tipo2.2Type`, also
  2dp], the recargo fields), and the `DesgloseRectificacionInput` amounts all move `number → string`.
  `buildAltaRecord` formats every one via `formatAmountExact`, and `formatAmount(number)` is
  **removed** so the float path cannot be reintroduced.
- **`formatAmountExact` is self-contained in `packages/verifactu`.** That package has **zero in-repo
  dependencies** (a lint boundary), so it cannot import `@waitron/shared`'s codec — it carries its
  own BigInt string→2dp codec, matching `formatAmount`'s output guarantees exactly.
- **Retire the `vat.ts` codec now (not optionally), on the core side.** Add the exact `divideDecimal`
  primitive `@waitron/shared` was missing, and route `packages/core/src/vat.ts`'s `percentOf` through
  `multiplyDecimal` + `divideDecimal`, deleting its duplicate `partsOf`/`fromParts`. This is a
  `@waitron/shared` public-surface addition; it does **not** help `formatAmountExact` (zero-dep
  boundary), only the core-side duplication.
- The **AEAT conformance vectors are unaffected** — they use `CadenaAltaInput`, whose amounts are
  already `string`. What ripples is the `AltaInput` fixtures/constructors (`ALTA_INPUT`, `seed.ts`'s
  `altaFor`, a handful of test files), re-expressed with exact strings — same huellas, under the 90%
  mutation gate.

Independent of §2.1/§2.2. Sequenced right after the prep PR, or folded into plan 3a where submission
serialises these amounts anyway.

---

## 3. Deliverable 1 — submission (plan 3a)

The drainer, built against the `envios` sidecar (already written `pendiente` by the write path,
drained by nobody). Everything regulatory is §7; this records the code shape.

### 3.1 Transport boundary

`VerifactuBackend` gains a `client: VerifactuClient` in its options — the existing narrow
`submit`/`consultar` interface from `packages/verifactu`. No new abstraction is introduced:
`packages/fiscal-verifactu` already depends on `packages/verifactu`. **mTLS cert/key and endpoint
stay where they already live** — in the caller-supplied `fetch` (a Node `Agent`/dispatcher) plus
`environment`. The app wires a real client; tests wire a client built over a fake `fetch`.

### 3.2 The faithful fake AEAT, at the `fetch` layer

There is no fake AEAT server today (tests inject a bare `fetch` mock returning hardcoded XML). Plan
3a builds one: a **stateful in-memory AEAT modelled on `Validaciones_Errores_Veri-Factu.pdf`**,
installed as the injected `fetch`. It parses the real envío XML and returns real response XML, so
the drainer tests exercise the actual `serializeEnvio`/`parseRespuestaSuministro` end-to-end — the
same "don't mock the boundary you are testing" reasoning as §10's real-Postgres rule. It must model:
issuing CSVs, a decreasing `TiempoEsperaEnvio`, **error 3000 with a `RegistroDuplicado` block** on
resubmit, error 2004 on future-dating, and per-record rejections. This fake is a plan-3a deliverable
in its own right, reused by plan 3b's consulta path.

### 3.3 `drain(now) → DrainResult` is one pass; the scheduler is external

One `drain(now)` call drains everything currently due
(`estado = 'pendiente' AND proximo_intento_en <= now`) and returns the next-due time. The repeating
cadence — the flow-control race and the art. 16.4 hourly floor — is the **caller** re-invoking
`drain` on the returned schedule. The scheduler is an app concern (`apps/*` is out of scope, §1), so
3a ships the callable plus a harness that drives it, **not** a long-running loop. Driving it from the
DB (`proximo_intento_en`), never an in-memory timer, is what makes the hourly duty survive restarts
(findings §5.4).

### 3.4 What the drainer does to `envios`

All from §7, mapped to the existing columns and the existing `resolveEstadoEfectivo`:

- **Batch per obligado tributario (tenant), ≤1000 records/envío, ordered by chain sequence within
  each SIF.** The batching key is the *tenant*, not the till — one envío may carry several SIFs of
  one obligado. A 1001-record backlog is split, never rejected with 4113/4114.
- **Flow control is a race:** send when `t` (server-supplied, init 60s) has elapsed **or** 1000
  records have accumulated, whichever first. `t` is persisted into `proximo_intento_en`.
- **Retry backoff exponential, capped at 3600s** — art. 16.4 sets a ceiling (retry *at least*
  hourly), not a floor; faster is always compliant.
- **The CSV is written in the same transaction as the submission response.** It is unrecoverable
  afterward — no CSV element exists in the consulta response. This is the single highest-consequence
  line in the outbox; §10's teeth-test (drop the CSV write → a test must fail) protects it.
- **Per-record status via `resolveEstadoEfectivo`** (already built): applies the estado transitions
  `enviando → aceptado / aceptado_con_errores / rechazado / detenido`.
- **Error 3000 uses both routes.** Route A (the `RegistroDuplicado` block) establishes state for
  free; where it is `duplicate_unknown`, Route B calls consulta and **compares the stored `Huella`
  against ours** — matching huella → accepted, differing → halt that chain and alert.
- **A genuine rejection halts that chain's queue** (`estado = 'detenido'`) and raises an `incidents`
  row, rather than submitting successors over an unresolvable gap. `validate()` runs pre-flight, so
  this should be near-unreachable.
- **`Incidencia="S"`** on any record with a failed attempt and on any record enqueued while an
  incident is open.
- **The drainer stamps `RefExterna = our registro id`** at submission — the retrieval key plan 3b
  depends on. (Cross-plan seam; see §6.)

---

## 4. Deliverable 2 — reconciliation + acks (plan 3b)

### 4.1 `reconcile(period) → ReconcileResult` — a periodic *independent audit*, not an ack fallback

Consulta **is** the reconciliation mechanism (no bulk export exists). It is a periodic sweep per
`PeriodoImputacion` that diffs AEAT's stored truth against local `envios`, and **it runs on a
schedule even when every ack arrived** — it is an audit, not a liveness or retry mechanism.

The relationship to acks, stated precisely because it is easy to get wrong:

- Acks are the normal-path submission *result* propagated per-record (§4.2). Reconciliation catches
  the case where an ack was **lost** (a record believed pending that AEAT already holds) —
  the safety-net reading — but that is only one of three cases.
- It also catches cases an ack **cannot**, because an ack cannot detect its own error: a record
  believed **accepted that AEAT has no trace of** (§7: *"undetectable without this — the system
  would believe itself compliant"*), and state **drift** (a record AEAT holds `AceptadaConErrores`
  that we believe clean).
- Therefore reconciliation is **not gated on a missing ack.** What healthy acks buy is *cadence* —
  the sweep can run less often when no incident is open — not conditionality. It is also the concrete
  answer to art. 16.4's *"deberán ser debidamente justificadas por el remitente si así se lo requiere
  la AEAT."*

Four mechanics, each of which produces a wrong answer if missed (§7):

- **Diff on `EstadoRegistro`, not presence.** `AceptadaConErrores` stays flagged forever; `Anulada`
  still appears in results. Presence is not proof of a live, clean record.
- **`PeriodoImputacion` from fecha de operación, falling back to fecha de expedición.** Query the
  *operation* month or a cross-month record returns `SinDatos`. ⚠️ §11 marks this derivation
  **medium-confidence** — re-verify against `Descripcion_SWeb` §6.4 before encoding.
- **Results are ordered by fecha de presentación**, not invoice date — a sweep running while
  submissions are in flight can page past newly-arriving records; the sweep must tolerate that.
- **Leave `MostrarNombreRazonEmisor`/`MostrarSistemaInformatico` unset** — both slow the response and
  neither is needed to diff.

It pages at 10,000 via `ClavePaginacion`, and retrieves our records via the `RefExterna` stamped by
3a. Because rejected records are never stored, **absence is unambiguous** — the believed-accepted
case is genuinely detectable.

**Carried risk (§11):** no consulta rate limit is documented — *absence of a documented limit, not a
documented absence*. Budget to discover it empirically in preproduction; it is not buildable now.

### 4.2 Acks downstream — contract, state machine, in-process transport

This is spec §1's "sync transport is deferred" piece, scoped exactly: plan 3b implements the **ack
contract + state machine + an in-process transport interface** (payload = record id, submitted-at,
CSV, state), tested in-process. The **wire protocol is sub-project 9.** Acks carry *true AEAT state*
rather than local sync backlog because a till syncing happily to an upstream node whose certificate
expired must still show a non-zero unsent count — the art. 16.4 case.

### 4.3 The unsent count — honest scope

In the **standalone (single-node)** deployment the submitting node *is* the till, so `pendingCount`
reads `envios` directly and is already correct after the prep PR (the `tenantId` fix) plus 3a (the
drainer's estado transitions). The downstream-ack path only bites in the **distributed** topology,
where the live consumer is a sub-project-9 concern. So 3b delivers the ack contract and its
in-process test, **not** a wired-up till client, and the screen that displays the count is
sub-project 7.

---

## 5. Interface changes to `FiscalBackend`

The current interface is five methods. The reserved-but-absent names `drain` and `reconcile` are
filled here (the doc comment forbids `flush`/`sync`/`push` in their place).

| Method | Change | Deliverable |
| --- | --- | --- |
| `checkIntegrity(tx, tillId)` | → `checkIntegrity(tx, tenantId, tillId)` | 0 |
| `pendingCount(tillId)` | → `pendingCount(tenantId, tillId)`, runs inside `withTenant` | 0 |
| `drain(now)` | **new** → `DrainResult` | 1 |
| `reconcile(period)` | **new** → `ReconcileResult` | 2 |

`FakeFiscalBackend` (the test double) tracks each signature change in the same PR.

---

## 6. Cross-plan seams and sequencing

- **Prep PR (0) before 3a:** the corrected `checkIntegrity`/`pendingCount` signatures and the
  round-trip dedup are foundations both feature plans build on.
- **3a stamps `RefExterna`; 3b consumes it.** Called out in both plans so 3a does not forget the
  stamp — a record submitted without it is not retrievable by our id during reconciliation.
- **3a's estado transitions are what `pendingCount` reads.** The standalone unsent count is correct
  once 0 and 1 land; the distributed path waits on 3b's ack contract and, ultimately, sub-project 9.

---

## 7. Testing posture (inherits §10)

- **Fake AEAT at the `fetch` layer** (§3.2) so real serialize/parse run end-to-end.
- **Teeth checks carried forward:** drop the CSV write → a test must fail; a 3000 with
  `EstadoRegistroDuplicado: Correcta` resolves to *accepted* despite the outer `Incorrecto`; the
  consulta/submission enums must not be shared (an `Anulada` consulta parses, the submission parser
  rejects it); `TiempoEsperaEnvio = 9999` round-trips; a batch of 1,001 is split, never rejected.
- **Concurrency suite re-verified** for the prep PR's `chain.ts` change (Testcontainers, real
  Postgres — PGlite cannot test lock contention, §10).
- **Per-test red phase** (observe each new test fail individually) and **real Postgres from the
  first commit** — both global constraints from §10.
- **Never a production NIF**; fixtures and (later) preproduction only.

---

## 8. Carried risks and gated items

- **Real AEAT submission stays gated** on a certificate + preproduction access (§11). 3a and 3b are
  built and tested against the faithful fake, exactly as `packages/verifactu`'s client already is.
- **`PeriodoImputacion` derivation** is medium-confidence (§4.1) — re-verify before encoding.
- **Consulta rate limit** undocumented (§4.1) — discover in preproduction.
- **`borjamrd/verifactu-conformance`** is a separate tracked follow-up on its own branch, pinned
  (not floated), source verified before wiring — out of scope for these three deliverables.
