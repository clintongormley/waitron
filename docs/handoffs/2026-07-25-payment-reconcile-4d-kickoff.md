# Kickoff handoff — payment `reconcile()` (the "4d"): where to start

**Date:** 2026-07-25
**Type:** *Forward-looking* kickoff — a starting brief so a fresh session can begin `reconcile()`'s brainstorm cold. It frames the deliverable, records the verified starting state, and lists the open design questions **to resolve in the brainstorm** (it does NOT pre-decide them).
**Main at handoff:** `a77a52d`. **Mode 3 is now complete** — Slice A neutral async layer (PR #26, `66b9c20`) + Slice B Stripe Checkout adapter (PR #27, `a77a52d`). All prior payment modes landed: 4a seam (#20) · Mode 1 (#21) · Mode 2a (#22) · Mode 2b Cycle A (#23) · Cycle B (#25) · Mode 3 A+B (#26/#27).

> **Before starting: run `superpowers:brainstorming` first** (per the repo workflow). §6 of the payment-layer spec already designs `reconcile()`, so this can go closer to straight-to-plan than a cold brainstorm — but the brainstorm still confirms §6 holds and resolves the async-specific open questions below. Then `superpowers:writing-plans`, `superpowers:subagent-driven-development`, `/finish-branch`, `/land-branch` — the exact cycle that shipped #21–#27.

---

## What `reconcile()` is

The payment layer's **read-side backstop**, designed in **§6** of `docs/superpowers/specs/2026-07-22-payment-layer-design.md`, structurally the **twin of the fiscal `FiscalBackend.reconcile` that already shipped**. `reconcile(tenantId, period)` audits our `payments` rows against **what the processor's settlement / payout report says actually cleared** (Stripe's payout / balance data for the adapter; the neutral interface never names it). Same T1/T2 split (read + processor-fetch first, corrections in a separate write tx) and the same idempotent-incident discipline as `forward`.

**It is now load-bearing, not optional — because Mode 3 landed.** Async/hosted payments are the mode that can *silently lose money*: a **missed/late webhook** (money cleared at Stripe, no local settled tender) or an **`initiate` crash-window orphan** (a Checkout Session minted, no `initiated` row) has **no safety net** until `reconcile()` exists. It is the *designed backstop* for exactly these.

### The four mismatch classes (§6)

- **`unsettled`** — we hold a `captured`/`forwarded`/`settled` payment the processor's report shows no settlement for *yet*. A recently-captured payment not yet in the report is ordinary in-flight state (the same tolerance window fiscal §4.3 uses); only past the window → one idempotent incident.
- **`orphan`** — a `captured` payment with null `sale_id` on a **settled/abandoned** working order (money taken, no invoice, §4's window). **Self-heals:** auto-refund/void + one idempotent incident, bounded by a new `reconcile_remediated_at` marker so it is not re-refunded every sweep.
- **`missingLocal`** — the processor reports a settlement we have **no local `payments` row** for (the fiscal `lostAck` analogue; silent data loss if uncaught). **This is the Mode 3 missed-webhook / initiate-crash case.**
- **`drift`** — the processor settled a **different amount** than we captured. One incident; not auto-corrected — a human decides.

Result: `PaymentReconcileResult { period, checked, unsettled[], orphan[], missingLocal[], drift[], incidentsRaised }`, shaped like fiscal's `ReconcileResult`.

## Verified starting state (2026-07-25)

- **`reconcile()` is NOT on the `PaymentProvider` interface yet** — `provider.ts:108` explicitly says it's "a later plan." This plan **adds it**, exactly as `forward` was added in Cycle B: every implementer gains it (`FakePaymentProvider`, `StripeTerminalProvider`, `StripeOnDeviceProvider`, `StripeHostedProvider`); **manual mode has none** (its audit is external — the bank's settlement report; § Mode 1 "Reconciliation is external").
- **`reconcile_remediated_at` is ABSENT** from the `payments` schema — this plan adds it via migration (bounds orphan remediation, exactly as `envios.reconciled_resubmit_at` bounds the fiscal self-heal).
- **`PaymentReconcileResult` + the mismatch-class types are NOT typed yet** (§6 design only). `store.ts:458` already anticipates "the `missingLocal` case reconcile audits per-tenant."
- **Tenant-scoped, so NO untenanted resolver needed** — unlike the Mode 3 webhook, `reconcile(tenantId, …)` is always called inside a tenant scope (like fiscal reconcile), so the SECURITY DEFINER seam Mode 3 built is not reused here.

## Open design questions for the brainstorm (resolve these; don't assume)

1. **Slice it?** Like Mode 3, this is neutral-machinery + vendor-adapter. A natural slice: **(A)** the neutral reconcile machinery — the `reconcile_remediated_at` marker, `PaymentReconcileResult` + mismatch-class types, the store queries that find `orphan`/`unsettled` rows, idempotent incident raising, and the orphan self-heal — proven with a fake against a *simulated processor report*; **(B)** the real Stripe reconcile adapter (fetch payouts / balance transactions for the period, diff). Decide first.
2. **Where does `reconcile` live?** On `PaymentProvider` (like `forward`)? It audits **all** of a provider's payments (sync *and* async) against the processor report, so it's provider-level, not mode-level — even though its most urgent job is the Mode 3 case. Confirm it goes on `PaymentProvider` (not `AsyncPaymentProvider`), and that `StripeHostedProvider`'s hosted payments are covered by the same `stripe` reconcile pass.
3. **Async coverage.** Confirm the neutral machinery covers `initiated`/`captured` async rows and the initiate-crash orphan (a Stripe session the payout shows but we have no row for → `missingLocal`).
4. **The in-flight tolerance window.** Mirror fiscal §4.3: a recently-settled payment not yet in the report is not a mismatch until past the window. Decide the window + where it's configured.
5. **Orphan self-heal touches the reversal path.** Auto-refund/void an orphan calls into `reverseViaStripe` (payments-stripe). Decide how reconcile triggers a reversal, and the `reconcile_remediated_at` bound so it fires once.
6. **Idempotent incidents.** `recordIncidentOnce` + the single-sweep-per-tenant invariant + the incidents dedup index (landed #25). **Finally use `recordIncidentOnce`'s did-it-insert return** to count real inserts (the deferred #25 item — see the follow-ups memory).
7. **Scheduler deferred.** The cadence/scheduler is an `apps/*` concern (out of scope), exactly as the fiscal reconcile scheduler + the `forward` scheduler are deferred. The `reconcile()` *function* is built + tested here; the period is passed in.
8. **Emit codes, not English.** New incident codes (e.g. `payment.reconcile_unsettled`, `payment.reconcile_drift`) are structured `code` + `params`, never user-facing prose (the localisation rule).

## Precedents to mirror

- **Fiscal `reconcile`** — the structural twin. `packages/fiscal/src/backend.ts` (the `reconcile(tenantId, period)` interface method + `ReconcileResult` with `lostAck`/`noTrace`/`drift`) and `packages/fiscal-verifactu/src/reconcile.ts` (the impl). Design: `docs/superpowers/specs/2026-07-22-plan-3b-reconciliation-design.md` + `2026-07-22-reconcile-resolution-semantics-design.md` + `2026-07-21-submission-and-reconciliation-design.md`.
- **`forward` (Mode 2b Cycle B)** — the precedent for *adding a method to the `PaymentProvider` interface* once an implementer exists (2a got an all-zeros `forward`; the fake already had it). `reconcile` follows the same "join the interface" pattern.
- **The neutral store** — `recordIncidentOnce` (the dedup index + `ON CONFLICT` landed #25), `settleForwarded`/`claimAcceptedOffline` (state-is-the-queue), the `reconcile_remediated_at` marker mirroring `envios.reconciled_resubmit_at`.
- **`packages/payments-stripe`** — the injected-client-seam + coverage-excluded-real-binding + nightly-`*.sandbox.test.ts` pattern, for the Stripe reconcile adapter (fetch payouts/balance).

## Carry the process (from #21–#27)

- **The cycle:** brainstorm → writing-plans → subagent-driven-development (per-task spec+quality reviews + a fresh-context whole-branch review) → `/finish-branch` → `/land-branch`.
- **`/finish-branch` after SDD:** skip its steps 1–3 (simplify + parallel re-review) — redundant after the SDD reviews (see the `finish-branch-skip-rereview-after-sdd` memory); go straight to rebase/push/PR/CI/Copilot.
- **Lessons:** before any shared-index change grep every writer (the #25 table-wide-index landmine); coverage is CI-only — run `pnpm --filter <pkg> test:coverage` locally, one task owns it; `format:check` (prettier) ≠ `lint`; Copilot resolve-with-reply for trivia (a push re-triggers the loop); real-PG suites need Docker (throw-not-skip); each new table needs a `getTableConfig` test.

## Pointers

- **Umbrella design:** `docs/superpowers/specs/2026-07-22-payment-layer-design.md` — **§6 (reconcile — the mismatch classes)**, §3 (the interface + the `reconcile` method signature), §7 (the `reconcile_remediated_at` marker + idempotency), §4 (the orphan window).
- **The Stripe reconcile data source:** Stripe payouts / balance transactions for the period — the real adapter's processor report (the neutral interface never names it).
- **Memories to read first:** `payment-layer-4b-followups` (full state + all deferred items incl this + the `recordIncidentOnce→bool` deferred item), `currency-and-localisation-requirements` (structured incident codes), `finish-branch-skip-rereview-after-sdd`, `whats-left-summary-after-each-step`.
