# Handoff — reconcile-resolution landed; next: sub-project 4 (Payment layer)

**Date:** 2026-07-22
**Main:** `89ad886` — "feat: reconcile resolution semantics (plan 3b follow-up) (#18)". Tree clean, on `main`, up to date with origin.
**This session:** executed + landed **plan 3b** (reconciliation + acks, PR #17), then brainstormed → spec'd → planned → executed + landed the **plan-3b follow-up "reconcile resolution semantics"** (PR #18), including root-causing and fixing a real CI test hang. **Both are on `main`.** We were about to start brainstorming **sub-project 4 (Payment layer)** — nothing done on it yet.

`main` history (most recent first): `89ad886` (#18 reconcile-resolution) → `b179177` (#17 plan 3b) → `dc490b1` (#16 workforce docs) → `7ff11f3` (#15 plan 3a drainer).

---

## What landed this session

### PR #17 — plan 3b (Veri*Factu reconciliation + acks), squash `b179177`
`reconcile(tenantId, period)` — a periodic AEAT-consulta audit (three cases lostAck / noTrace / drift, diffing on `EstadoRegistro` not presence, with the §4.3 in-flight tolerance); the ack contract + durable `acks` outbox (tenant-isolated RLS) + in-process consumer/state-machine; acks written **atomically with the estado** that produces them (drainer persist tx + reconcile correction tx), so an ack never disagrees with the committed `envios.estado`. Guard-clean regime-neutral names on `packages/fiscal` (`{ year, month }`, `recordId/localState/reportedState`, `AckState`); the AEAT `Ejercicio`/`Periodo` mapping + `IDFactura` triple live only in the exempt `packages/fiscal-verifactu`. Design/plan: `docs/superpowers/specs/2026-07-22-plan-3b-reconciliation-design.md`, `docs/superpowers/plans/2026-07-22-plan-3b-reconciliation.md`.

### PR #18 — reconcile resolution semantics (plan-3b follow-up), squash `89ad886`
Reframed the deferred "incident idempotency" blocker: instead of de-duping per-sweep alarms, **resolve the conditions** so they stop being standing incidents. Design/plan: `docs/superpowers/specs/2026-07-22-reconcile-resolution-semantics-design.md`, `docs/superpowers/plans/2026-07-22-reconcile-resolution-semantics.md`.
- **drift-`Anulada` is recognized as the expected post-void state** — a voided sale leaves the alta's envío `aceptado` while AEAT marks the alta `Anulada`; reconcile checks for the local sibling anulación (`sale_id` + `tipo_registro='anulacion'`) → clean, no incident. Anomalous (no local anulación) → one *idempotent* error incident.
- **noTrace self-heals** — reset the record to `pendiente` on first detection (the drainer re-submits, idempotent via error-3000), bounded by a new `envios.reconciled_resubmit_at` marker; escalate to one idempotent incident only if *still* missing after remediation; clear the marker when AEAT has a trace again. The reset **deletes the stale `accepted` ack** in the same tx (the ack↔estado invariant) — which needed a new `GRANT DELETE ON acks TO app_user` (`0008_acks_delete_grant.sql`), caught live under real RLS.
- **`recordIncidentOnce`** (`@waitron/core`) — a guarded, idempotent-per-open-condition incident raise, the net for the rare residuals. **NOT race-free without a unique index** — it relies on reconcile's single-sweep-per-tenant invocation (documented in its doc comment).
- **A periodic-sweep scheduler is now UNBLOCKED** (it was gated on this).

### The CI hang — root-caused and fixed (do not skip this lesson)
`chain.concurrency.test.ts > "blocks a second appender"` (a **pre-existing** test we did not touch) **hung 120s on CI** while passing in ~3s locally. Root cause: the test started the holder's lock-holding transaction **without awaiting confirmation the lock was held** before racing the waiter; under CI load the waiter won the race and *succeeded*, so the `55P03` assertion threw **before** `release()` — leaving the head-lock transaction open forever, so `finally`'s `holder.close()` blocked on it. Reproduced deterministically by delaying the holder; fixed by (1) an acquired-signal the test awaits before racing, and (2) moving `release()`/settle-`holding` into `finally`. Both contention tests hardened. The user explicitly pushed back on "just retry it" — **a 120s hang is a real bug, not a flake.** Fixed in `c3a41ed`.

Copilot review on #18 (4 threads over 3 pushes, all legit): the `recordIncidentOnce` concurrency doc; a test-helper tenant-scoping gap; and **two** wall-clock `Date.now()+60_000` drain times → fixed to fixed instants (`reconcile.test.ts`, `reconcile.rls.test.ts`).

---

## THE NEXT TASK — sub-project 4: the Payment layer

Roadmap (`docs/superpowers/specs/2026-07-18-pos-architecture-design.md` §2, row 4):
> **4 | Payment layer — `PaymentProvider` interface + Stripe Terminal adapter + offline store-and-forward | Deli**

**Status: not started.** We had just invoked `superpowers:brainstorming` and set up to explore context — no questions asked, no design yet. Start fresh with brainstorming.

**What to do first (brainstorming step 1 — explore context), before asking the user anything:**
- **Mirror the `FiscalBackend` pattern.** `packages/fiscal/src/backend.ts` is the reference: a regime-/vendor-neutral interface in a generic package, with a concrete adapter (`VerifactuBackend` in the exempt `packages/fiscal-verifactu`) behind it. The Payment layer almost certainly wants the same shape — a generic `PaymentProvider` interface (likely in a new `packages/payments` or in `packages/core`) + a `StripeTerminalProvider` adapter in its own package. Confirm where it belongs and whether the same english-only/regime-neutral guard discipline applies (it's a `GENERIC_PACKAGES` question — see `packages/db/src/english-only.ts`).
- **Understand how payments attach to a sale.** The sales spine (plan 2, `packages/db/src/schema/`) already has a **`tenders`** table (settlement records — see `tenders.settledAt`, referenced in `packages/core/src/incidents.test.ts` and the sales schema) and `sale_voids`. A payment is a tender; the Payment layer records/settles tenders. Read the sales/tenders schema and `packages/core/src/record-sale.ts` to see the write path a payment would hook into.
- **Read the fuller framing** in `pos-architecture-design.md` (grep for "payment", "tender", "Stripe", "store-and-forward", "offline") — the phasing table row is terse; the body + sequencing notes have more.
- **Offline store-and-forward** is the hard/interesting part: a till must take payment and record the sale *while offline*, then reconcile with the processor when connectivity returns — analogous in spirit to the fiscal drainer's "record locally, submit later, never block the sale." Expect the design to reuse that "immutable local record + durable outbox + drainer" shape.

**Then brainstorm normally:** confirm scope with the user (it's a big subsystem — likely decompose: the interface + a fake first, the Stripe adapter, the offline outbox, refunds/voids, reconciliation), one question at a time → propose approaches → present design → write spec to `docs/superpowers/specs/YYYY-MM-DD-*-design.md` → user review → `superpowers:writing-plans` → execute via `superpowers:subagent-driven-development`.

---

## The workflow + mechanics (repeat what worked for 3a/3b/reconcile-resolution)

- **Process:** `superpowers:brainstorming` → spec (commit) → `superpowers:writing-plans` → plan (commit) → `superpowers:subagent-driven-development` → `superpowers:finishing-a-development-branch` → land. Both docs go on the feature branch and land with the implementation PR.
- **SDD mechanics** (scripts under the skill dir; git-ignored ledger + briefs/reports under `.superpowers/sdd/`):
  - `scripts/task-brief PLAN N` → brief file; dispatch a fresh **general-purpose** implementer subagent (model per task — **sonnet** when the plan carries complete code; **opus** for the subtle/compliance-critical ones and the final whole-branch review); implementer reports DONE; `scripts/review-package BASE HEAD` → diff file; dispatch a task reviewer; fix loop for Critical/Important; record Minors.
  - **The ledger** (`.superpowers/sdd/progress.md`) is the recovery map — it now holds 3a + 3b + reconcile-resolution sections. Start a fresh section for the payment layer.
  - **Model explicitly on every dispatch.** Reviewers routinely catch real gaps (e.g. this session a reviewer *missed* a missing barrel export — the next implementer caught it; and opus reviewers caught the ack-invariant + the deleteAck-grant issues). Reproduce that rigor.
- **Guardrails observed this session (carry them):**
  - **Implementers in the shared checkout will sweep the user's uncommitted working-tree changes into their commits** unless told not to — early 3b implementers committed the user's parallel workforce docs twice. **Every dispatch must say: `git add` ONLY the task's explicit paths, never `-A`/`.`; leave unrelated working-tree changes alone.** (The user landed those docs properly as #16; we extracted the stray commits off the 3b branch before its PR.)
  - **`packages/fiscal` (and `db`/`core`/`shared`) are english-only + regime-neutral** — two guards (`@waitron/db`'s `english-only.ts` tokenizes camelCase and bans Spanish; `packages/fiscal`'s `no-regime-vocabulary.test.ts` bans chain/hash/sif/csv/aeat/registro/…). Plan sample code that uses Spanish field names WILL fail CI — resolve to genuine English up front. `packages/verifactu`/`fiscal-verifactu` are exempt.
  - **Real Postgres catches what PGlite can't** — PGlite's superuser bypasses RLS + table privileges, so a missing GRANT (like the `acks` DELETE) only surfaces under a real, non-superuser role (`reconcile.rls.test.ts` uses a `PROBE_ROLE`). Keep RLS-behavioral tests on real PG.
  - **T1/T2 discipline** — never hold a DB transaction across a network call; the drainer and reconcile both split (read tx → network → write tx).
- **Landing (guarded `main`):** push → `gh pr create` → request Copilot (`gh api .../requested_reviewers -f 'reviewers[]=copilot-pull-request-reviewer[bot]'`) → watch CI (`gh pr checks N --watch`; required checks `test`/`typecheck`/`static-analysis`/`mutation-verifactu`/`mutation-shared`, `strict`, squash/rebase only, **`required_review_thread_resolution`**, 0 approvals) → **resolve every Copilot thread** (`resolveReviewThread` GraphQL; reply first) → `gh pr merge N --squash --delete-branch` (user authorizes the final merge). **A husky pre-push hook runs `pnpm format:check`** — run `pnpm format` before pushing. Every push re-triggers Copilot, which surfaces new nits — fix the legit ones; declining pure-efficiency nits with rationale + resolve is fine.

---

## Remaining minor follow-ups (tracked, not blocking; NOT in the code)

From plan 3b / reconcile-resolution — all deferred to when those paths run at scale (memory: `plan-3b-followups`):
- A partial index on `acks` — `(tenant_id, submitted_at, registro_id) where delivered_at is null` — for `pendingAcks`.
- A sargable `[start, end)` date-range reconcile period filter (currently `to_char(fecha_expedicion_factura, …)`, non-index-friendly) + a supporting index.
- A direct test for the claim-time-halt (`haltOpenChainClaims`) ack path (the `haltSuccessors` path is tested; the T1 path is structurally identical).
- **Before wiring an actual periodic-sweep scheduler for `reconcile`:** the incident-idempotency work (now landed) unblocks it, but the scheduler itself is an `apps/*` concern still out of scope.

---

## Pointers

- Roadmap / phasing + payment framing: `docs/superpowers/specs/2026-07-18-pos-architecture-design.md`.
- `FiscalBackend` interface (the pattern to mirror): `packages/fiscal/src/backend.ts`.
- Sales spine / tenders / write path: `packages/db/src/schema/` (`tenders`, `sales`, `sale_voids`), `packages/core/src/record-sale.ts`.
- english-only / regime-neutral guards: `packages/db/src/english-only.ts`, `packages/fiscal/src/no-regime-vocabulary.test.ts`.
- Memory index entries worth reading: `plan-3b-followups`, `verifactu-mode-separate-modules`, `verifactu-series-per-till`, `verifactu-submission-delay-tolerance`.
