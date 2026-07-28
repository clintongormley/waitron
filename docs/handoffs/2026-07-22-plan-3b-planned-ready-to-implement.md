# Handoff — plan 3b: planned, ready to implement

**Date:** 2026-07-22
**Main:** `7ff11f3` — "feat: Veri*Factu submission drainer (plan 3a) (#15)", squash-merged. **Plan 3a is landed.**
**This session:** built + landed plan 3a (the drainer); then brainstormed → spec'd → planned plan 3b. **3b is fully planned but not implemented.**
**Branch:** `plan-3b-reconciliation` (off `main`) carries the two 3b docs — commits `b69c941` (spec), `0e8e9b2` (plan). Nothing else on it yet. Not pushed.

---

## Where we are

**Plan 3a (submission drainer) — DONE, on `main`.** PR #15 squash-merged. It shipped: `parseEnvio`/`parseConsulta` request-parsers, a stateful fake AEAT (`packages/verifactu/src/testing/fake-aeat.ts`), the `envio_flujo` flow-control table, the drainer (`packages/fiscal-verifactu/src/drain.ts`), `drain(now): DrainResult` on `FiscalBackend`, and a `SECURITY DEFINER` cross-tenant enumeration seam (`envios_tenants_with_work`, migration `0004_envios_drainer_seam.sql`). Verified by 10 task reviews + an opus whole-branch review + CI + Copilot. `RefExterna = registro id` is stamped on submission; `envios.estado` transitions are live.

**Plan 3b (reconciliation + acks) — PLANNED.** Read these two, in order, before implementing:

1. [`docs/superpowers/specs/2026-07-22-plan-3b-reconciliation-design.md`](../superpowers/specs/2026-07-22-plan-3b-reconciliation-design.md) — the design. Framing, the three audit cases, the four mechanics (all primary-source-verified this session), the ack contract, the `acks` outbox, the interface change, testing, carried risks.
2. [`docs/superpowers/plans/2026-07-22-plan-3b-reconciliation.md`](../superpowers/plans/2026-07-22-plan-3b-reconciliation.md) — the 5-task TDD implementation plan.

The pre-planning handoff [`2026-07-21-plan-3b-reconciliation.md`](2026-07-21-plan-3b-reconciliation.md) is now superseded by the spec (its open decisions are resolved below), but still useful for the regulatory framing.

---

## Decisions made this session (3b brainstorming)

| # | Decision | Answer | Why it matters |
| --- | --- | --- | --- |
| Scope | reconcile + acks together, or split? | **Together** (deliverable 2 as designed). | One PR; likely well under the Copilot 20k cap. |
| `period` | signature | **`{ ejercicio, periodo }`** (the `PeriodoImputacion` pair), passed to `reconcile(tenantId, period)`. | AEAT queries by period, not date range. |
| `PeriodoImputacion` derivation | verify the medium-confidence rule | **VERIFIED against the primary AEAT PDF** — see below. | Was the biggest carried risk; now resolved. |
| Ack transport | in-memory queue vs durable table | **Durable local-table outbox** (`acks` table, envios-sidecar style). | Survives restart; testable on real Postgres. |
| `reconcile` tenant arg | interface shape | **`reconcile(tenantId, period)`** — explicit `tenantId` per `pendingCount(tenantId, tillId)`'s precedent (runs outside any sale tx; no `tillId` — reconciliation is per obligado). | Resolved in both docs. |

### The PeriodoImputacion verification (do not re-litigate — it's done)

Read directly from `Veri-Factu_Descripcion_SWeb.pdf` v1.0.3 §6.4 (fetched from AEAT sede this session; saved locally under the session's tool-results if still present, else re-fetch from `https://sede.agenciatributaria.gob.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Veri-Factu_Descripcion_SWeb.pdf`). Confirmed **verbatim**: consulta filters by *"ejercicio/periodo 'de imputación', dato obtenido a partir de la **fecha de operación o en su defecto de la fecha de expedición**"*. **Consequence:** Waitron's records never populate `FechaOperacion` (3a's `recordSale`), so **our records' period is always the expedition month** — no ambiguity, no false `SinDatos`. Also confirmed from §6.4: 10,000/page, paginate via `ClavePaginacion` **ordered by fecha de presentación**; `RefExterna` is both a filter and echoed in `DatosRegistroFacturacion`; `Mostrar*` flags slow the response (leave unset); CSV is unrecoverable via consulta (so the ack must carry it).

---

## What remains — implement plan 3b (5 tasks)

Straight from the plan. Each is TDD, each ends green, mirroring 3a's rigor.

1. **Fake AEAT extensions** (`packages/verifactu`) — consulta `ClavePaginacion` pagination + echo `RefExterna` in `DatosRegistroFacturacion` + `setConsultaState`/`forget` hooks. Under the 90% mutation gate.
2. **`acks` outbox table + migration** (`packages/fiscal-verifactu`) — 1:1 sidecar; RLS via the `envio_flujo` convention (dedicated policy + grants — see 3a's `0003_envio_flujo_rls.sql`).
3. **The reconcile surface** — `reconcile(tenantId, period)` + `ReconcileResult` + `AckState` on `FiscalBackend` (regime-neutral, English-only), `FakeFiscalBackend.reconcile`, minimal `VerifactuBackend.reconcile`. (Mirrors 3a's Task 5.)
4. **`reconcile.ts`** — the sweep: page consulta, key AEAT's view by `RefExterna`, diff on `EstadoRegistro` → the three cases (`lostAck`/`noTrace`/`drift`) + incidents. `VerifactuBackend.reconcile` delegates.
5. **Acks** — `acks.ts` (`AckState` mapping, durable transport `pendingAcks`/`markDelivered`, in-process consumer + state machine) + write the ack row atomically in `drain.ts`'s persist tx and `reconcile.ts`'s correction tx + the in-process end-to-end test (incl. the cert-expired case).

**Suggested next action:** subagent-driven execution (same as 3a) — or the user reviews the spec+plan first. The plan's self-review flagged that the `reconcile(tenantId, period)` signature must be adopted in Task 3 before Task 4 (already reconciled in the committed docs).

---

## How 3a was executed (repeat this for 3b)

Subagent-driven development (superpowers) with these mechanics — they worked well:

- **Per task:** `scripts/task-brief PLAN N` → brief file; dispatch a fresh **general-purpose** implementer subagent (model per task — `sonnet` for most; **`opus` for the subtle ones** — 3a used opus for the concurrency + halting + RLS-seam reviews); implementer reports DONE/etc; `scripts/review-package BASE HEAD` → diff file; dispatch a task reviewer; fix loop for Critical/Important; record Minors. Scripts live under the SDD skill dir; the git-ignored ledger + briefs/reports live in `.superpowers/sdd/`.
- **The ledger** (`.superpowers/sdd/progress.md`) is the recovery map — one line per completed task with the commit range. (3a's ledger is still there; start a fresh section or file for 3b.)
- **Final whole-branch review on opus**, then land.

### Landing (what PR #15 taught us)

- `main` is guarded by a **ruleset** (not classic branch protection): required checks `test`/`typecheck`/`static-analysis`/`mutation-verifactu`/`mutation-shared`; **`required_review_thread_resolution: true`** (all Copilot threads must be resolved); `copilot_code_review: review_on_push` (every push re-triggers Copilot); **0 approvals required**; squash/rebase only; `strict` (branch must be up to date).
- Flow: push → `gh pr create` → request Copilot (`gh api ... /requested_reviewers -f 'reviewers[]=copilot-pull-request-reviewer[bot]'`) → watch CI (`gh pr checks N --watch`) → **resolve every Copilot thread** (address the legit ones; `resolveReviewThread` GraphQL mutation) → `gh pr merge N --squash --delete-branch`.
- **A husky pre-push hook runs `pnpm format:check`** — Prettier is separate from ESLint, so run `pnpm format` before pushing (3a's implementers ran lint but not format, and the first push was rejected).

---

## Load-bearing lessons from 3a (apply to 3b)

- **`packages/fiscal` is regime-neutral, English-only** — a `@waitron/db english-only` guard tokenizes identifiers and bans Spanish (`envios`, `estado`, …). 3a's `DrainResult.enviosSent` tripped it → renamed `batchesSent`. `ReconcileResult`/`AckState` field names AND doc comments must be English and name no authority/chain/huella (a second guard, `no-regime-vocabulary.test.ts`, and the file's own class doc enforce the comment side too). Run the guard early.
- **The T1/T2 transaction split** — never hold a DB tx across the AEAT network call. `drain` claims in one `withTenant` tx, submits outside any tx, persists in a second. `reconcile` is read-mostly (consulta is outside a tx; the diff + incidents in a `withTenant` tx), so this is simpler, but keep the network call out of the tx.
- **Cross-tenant enumeration under FORCE RLS** — 3a needed a `SECURITY DEFINER` fn owned by a dedicated NOLOGIN role with a permissive `FOR SELECT` policy (pattern from `packages/db/drizzle/0005_sales.sql`'s `sales_coverage_checker`; NOT BYPASSRLS — undeployable under a hardened migration role). **3b's `reconcile(tenantId, period)` does NOT hit this** — it's invoked per known tenant and runs entirely inside one `withTenant`. Don't reintroduce a cross-tenant sweep.
- **Drizzle array binding:** `where x in ${ids}` (bare) — NOT `= any(${ids})` or `in (${ids})`, both of which fail on PG/PGlite.
- **The fake AEAT is the single test double** — extend it (Task 1), never build a second one. Its consulta match is by full identity (NIF+NumSerie+Fecha) after a Copilot fix; its dispatch is by element-tag regex, not substring.
- **Implementers routinely find real bugs in the plan's sample code** — this is expected and good; the sample is a starting point. 3a's implementers caught ~8 (Desglose unwrapping, a `TiempoEsperaEnvio` off-by-one, a same-batch halt-overwrite, the array-binding traps, …). Tell 3b's implementers the same.
- **`drain.test.ts` has accumulating test-isolation debt** (shared PGlite db, no per-test truncation, global-counter assertions, magic timestamps `<00:02:00Z`). 3b's `reconcile.test.ts` should NOT copy that pattern — assert tenant-scoped state, or truncate in `beforeEach`. (Carried Minor from 3a's final review; a good cleanup to fold in when touching that file.)

---

## Carried risks and gated items (unchanged, restated for 3b)

- **Consulta rate limit is undocumented** — *absence of a documented limit, not a documented absence* (verified this session: no rate limit in the consulta spec; `TiempoEsperaEnvio` absent from the consulta response). 3b runs periodic sweeps → discover the limit empirically in preproduction; do NOT encode a guessed number.
- **Real AEAT consulta stays gated** on a certificate + preproduction (spec §11) — 3b is built and tested entirely against the fake.
- **The distributed unsent-count path is contract-only** in 3b — the ack contract + in-process state machine land, but the wire protocol (sub-project 9) and the till screen (sub-project 7) do not. "Acks landed" ≠ "distributed unsent count works end-to-end". Standalone `pendingCount` is already correct off `envios` (prep PR + 3a); acks are not needed for it.
- **`PeriodoImputacion` general derivation** (operación→expedición) is now **verified**, moot for our records (no `FechaOperacion`), and documented for the future — no longer a risk.
