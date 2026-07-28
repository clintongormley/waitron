# Handoff — payment Mode 2b Cycle A (offline store-and-forward) landed; next: Cycle B (on-device Stripe binding)

**Date:** 2026-07-24
**Main:** `af86987` — "test(payments): guard every schema table's extraConfig callback (#24)", on top of `a938d75` "feat(payments): Mode 2b Cycle A … (#23)". On `main`, up to date with origin, working tree clean, `pnpm install` refreshed (the old stale-`node_modules` caveat is cleared). **No open PRs, no worktrees, no dangling branches.**
**This session:** one full sub-project cycle, **Mode 2b Cycle A**, brainstorm → design → plan → SDD (7 tasks) → finish-branch → land as **PR #23** (squash `a938d754`). Plus a small follow-up **PR #24** (coverage guard — **LANDED**, squash `af869879`), a new **currency/localisation** project memory, and the coverage-gate lessons folded into memory.

`main` history (most recent first): `af86987` (#24 coverage guard) → `a938d75` (#23 Mode 2b Cycle A) → `ffe6018` (#22 Mode 2a) → `0bcfc03` (#21 Mode 1) → `7aa0a57` (#20 4a seam) → `89ad886` (#18 reconcile-resolution).

---

## Follow-up PR #24 — LANDED

`payments-schema-config-coverage-guard` merged (squash `af869879`). A one-file, test-only iterating guard in `packages/payments/src/index.test.ts` that forces every schema-barrel table's lazy drizzle `extraConfig` callback, so a newly-added table can't silently drop package coverage (the exact thing that failed #23's CI). CI green, no Copilot threads, nothing outstanding.

---

## What landed this session: Mode 2b Cycle A (PR #23)

The **provider-neutral offline store-and-forward layer**, entirely inside `@waitron/payments`, proven with the `FakePaymentProvider` + real-Postgres tests. **No device SDK, no webhooks** — those are Cycle B.

- **Enum states:** `payment_state` gained `accepted_offline` → (`forward`) → `settled` | `declined`. `network_unavailable` is a **return-only** `PaymentResult` state (never persisted — nothing durable is written when offline is refused).
- **Policy + gate:** new per-tenant `payment_policy` table (`offline_mode` text + `offline_amount_cap numeric(12,2)`) + RLS; a **fail-safe** gate (`getPaymentPolicy` + pure `resolveOfflineDecision` in `packages/payments/src/policy.ts`): missing policy row / `cash_only` / over-cap / no per-transaction `allowOffline` consent **all refuse**. Nothing goes offline silently (policy `accept_offline` **and** explicit `allowOffline` **and** `amount ≤ cap` — three independent gates).
- **`accepted_offline` sets `settled_at`** (the acceptance time), so the sale chains immediately (the offline card is a real, valid tender).
- **`forward(now)`** — the drain analogue on the fake: claims `accepted_offline` rows `FOR UPDATE SKIP LOCKED` (so concurrent forwards partition the queue) and advances each to `settled`/`declined`. A **decline raises one idempotent incident** (`payment.offline_forward_declined`, uncollected receivable) and makes **no** fiscal change — the sale is immutable; a correction is the existing deliberate `recordVoid` path.
- **Store helpers** (`store.ts`): `insertAcceptedOffline`, `claimAcceptedOffline` (SKIP LOCKED), `settleForwarded`/`declineForwarded` (state-guarded → idempotent, via a shared private `advanceAcceptedOffline`).
- **Tests:** extended `FakePaymentProvider` (offline `collect` + `forward`), real-PG RLS (`payment-policy.rls.test.ts`) + SKIP-LOCKED concurrency (`forward.concurrency.test.ts`), and a **capstone** (`offline.wiring.test.ts`) proving an offline-accepted tender chains a real sale via `recordSale` and a later forward-decline raises an incident **without un-chaining the immutable sale**.

## Load-bearing decisions (Cycle A)

- **`forward` is deliberately NOT on the `PaymentProvider` interface** this cycle. A required method would break `StripeTerminalProvider` (which doesn't implement it), forcing an out-of-scope change to `payments-stripe`. It's a concrete method on the fake; it **joins the interface in Cycle B** when a real adapter implements it — the exact `drain`/`reconcile`-were-absent-until-implemented precedent. `ForwardResult` type IS defined + exported.
- **The neutral runtime package stays free of `@waitron/core`.** Incident-raising lives in the `forward` *implementation* (the fake now, the adapter in Cycle B) — mirroring how fiscal's `drain` raises incidents in `fiscal-verifactu`, not in neutral `packages/fiscal`. `@waitron/core` stays a **devDependency**.
- **"Offline" = internet-offline with an on-site local server holding Postgres** (architecture §5 L447–450 / §6 SIF-fallback). Cloud-direct-with-no-local-server has no offline. So the `payments` store stays Postgres-backed as built — **no new local/IndexedDB persistence path.** Stripe's on-device SDK owns the card-forward queue on the device (Cycle B); our rows own the lifecycle; `forward()` reconciles.
- **Decision ① — no `till_id` column on `payments`:** `forward`'s decline-incident needs a `till_id`; it's derived via join on `working_orders` (denormalising is a later reconcile convenience).
- **Decision ② — missing `payment_policy` row → fail-safe refuse** (treated as `cash_only`); onboarding/SP7 inserts the row to *enable* offline.

---

## THE NEXT TASK — Mode 2b Cycle B: the real on-device Stripe binding

Its own spec→plan→SDD→finish→land cycle, in `@waitron/payments-stripe` (mostly), sharing the umbrella design (`docs/superpowers/specs/2026-07-22-payment-layer-design.md`, the "Mode 2b — Cycle B" bullets in §10.3 + the "Out of scope for this cycle" list). It plugs into everything Cycle A built:

- **On-device SDK reader** (the waiter's handheld all-in-one; Tap-to-Pay / Stripe handheld): the app drives the reader **built into the same device**, reports the outcome back, and the store records the lifecycle. Unlike 2a's server-driven remote reader, the on-device SDK **cannot run in a Node/vitest suite** — so it's an injected+faked seam with the real binding **coverage-excluded** (exactly like `payments-stripe`'s `stripe-client.ts` + `testing/**` + `*.sandbox.test.ts`).
- **Connection tokens** (`stripe.terminal.connectionTokens.create`) — a server SDK call the device fetches to init its on-device SDK.
- **Device-side `collect`** producing `accepted_offline` from the device SDK's **offline mode** (Stripe Terminal stores-and-forwards on the device), returning a settled tender synchronously; and **`forward()`** driving the **device-local offline queue** (the real analogue of the fake's `forward`), raising the same `payment.offline_forward_declined` incident.
- **`forward` joins the `PaymentProvider` interface** here (a real adapter now implements it; `StripeTerminalProvider` — the 2a server-driven adapter — also gains a correct all-zeros `forward`, since it has no device-local offline queue, or the interface method is added with both implementers).
- **Nightly sandbox** suite (real Stripe test-mode + simulated reader), gated like 2a's — needs the `STRIPE_SANDBOX_SECRET_KEY` repo secret (still not added; see below).

**Cycle B carry-over found in the Cycle A whole-branch review (MUST handle when a real concurrent `forward` lands):** `recordIncidentOnce` keys on `(tenant, till, code, sale_id)` with `sale_id IS NOT DISTINCT FROM null`, and it is *not* race-free (`incidents.ts` says a concurrent same-key caller must add a **partial unique index** `(tenant_id, till_id, code, sale_id) WHERE acknowledged_at IS NULL` + switch to `ON CONFLICT DO NOTHING`). Cycle A's single-threaded fake never hits it, but a real concurrent forward will: (1) two distinct **orphan** declines (`sale_id = null`) on one till collapse to one incident, and (2) two same-`sale_id` (split-tender) declines racing double-insert. Recorded in the design doc's Cycle B out-of-scope section.

**Alternative next tasks (if Cycle B isn't the priority):** Mode 3 (async/hosted — QR pay-at-table, links, online; the `initiate() + webhook` shape); or cross-cutting `reconcile()` (old "4d"). See memory `payment-layer-4b-followups` for the full remaining sequence and the deferred items (webhooks + untenanted `(provider, external_ref)` resolution, reversal retry-safety, the STRIPE_SANDBOX_SECRET_KEY secret).

---

## Process lessons from THIS session (carry them)

- **The coverage gate is CI-only — the pre-push hook does NOT run it.** `.husky/pre-push` runs `test` (`vitest run`), lint, format, typecheck; the CI `test` job runs `test:coverage` (98% stmts/lines, 95% branches). Coverage is **deliberately excluded** from the hook ("too slow for a hook that runs on every push"). So a coverage regression passes every local/pre-push/SDD gate and **only surfaces in CI** — it bit #23 (96.45% < 98%, everything else green). **When you add code, run `pnpm --filter <pkg> test:coverage` locally before pushing.** Do NOT "fix" this by putting coverage in the hook — that overrides a documented maintainer decision and slows every push (PR #24 is the right fix instead).
- **Every new drizzle table needs its `extraConfig` callback exercised.** A table's `(t) => [...]` FK/check/index callback is **lazy** — a plain import never runs it, so its lines report uncovered until a `getTableConfig(table)` test forces it. Task 1 added `payment_policy` without a `getTableConfig` block → that + an untested `recordFailedRefund` not-found branch sank #23 to 96.45%. Both fixed in #23; **PR #24 adds the iterating guard so future tables are auto-covered.**
- **Verify a Copilot defensive-check suggestion against the coverage gate before applying.** Copilot on #23 asked for `if (wo === undefined) throw` on an FK-guaranteed lookup — but that branch is **untestable** (the FK forbids reaching it) and would **fail the 95%-branch gate**. Correct response: reply-and-resolve (no code change), not blind implementation. (Other #23 Copilot nit — `seedPaymentPolicy` upsert — was YAGNI + inconsistent with insert-only seed helpers; also resolved without change.)
- **SDD reviews run `test`, not `test:coverage`** — so every per-task + whole-branch review was green on coverage-blind runs; the gap only appeared at `gh pr checks`. Factor a `test:coverage` run into the finish-branch flow when new code/tables land.
- Repeat-from-before, still true: **`format:check` (prettier) is a pre-push + CI gate, not part of per-package `lint`** (docs are `.prettierignore`d, so design/plan/handoff `.md` are exempt). **Copilot COMMENTED reviews don't block; unresolved threads do** (`required_review_thread_resolution`) — resolve trivial ones with a REPLY (no push re-triggers the loop). **Transient CI Docker outages** clear on `gh run rerun <id> --failed` (this session had none).

## Workflow that worked (repeat it)

`superpowers:brainstorming` → revise umbrella design (new "Mode N" section + re-sequence §10) → `superpowers:writing-plans` → `superpowers:subagent-driven-development` (fresh implementer per task from `scripts/task-brief`; **sonnet** for complete-code tasks, **opus** for the concurrency + capstone; task reviewer after each via `scripts/review-package`; fix loop for Critical/Important, Minors → ledger for the final review) → `/simplify` → whole-branch review (opus) → `/finish-branch` → `/land-branch`. The SDD ledger + briefs lived under the (now-removed) worktree's git-ignored `.superpowers/sdd/` — this handoff is the durable record. **The controller owns plan bugs:** this session's plan had 4 caught-and-fixed warts (migration split that wouldn't split, `PaymentState` union sync, a vacuous concurrency assertion, three `git add`/import omissions the implementers self-corrected).

## Pointers

- **Umbrella design:** `docs/superpowers/specs/2026-07-22-payment-layer-design.md` — §0 taxonomy, §5 offline semantics, §10.3 the 2b Cycle A/B split, the "Mode 2b — Cycle A" design section (+ its Cycle B out-of-scope carry-over note).
- **Plan:** `docs/superpowers/plans/2026-07-23-payment-mode-2b-cycle-a-offline-layer.md` (the SDD shape to mirror for Cycle B).
- **Landed code:** `packages/payments/src/` — `policy.ts` (gate), `store.ts` (offline helpers), `schema/payment-policy.ts`, `provider.ts` (`ForwardResult`, `PaymentResultState`, `offline`, `allowOffline`), `testing/fake-provider.ts` (offline `collect` + `forward`); `drizzle/0004_payment_offline.sql` + `0005_payment_policy_rls.sql`.
- **The precedent Cycle B mirrors:** `packages/payments-stripe` (Mode 2a — injected `StripeClient` + `FakeStripe`, nightly sandbox) and `fiscal-verifactu` (adapter raising incidents; `drain`/`reconcile`).
- **Memory to read before Cycle B:** `payment-layer-4b-followups` (state + deferred items + all coverage/CI lessons), `currency-and-localisation-requirements` (single-currency-per-tenant, structured-error localisation), `verifactu-mode-separate-modules` (explicit-per-tenant-config precedent).
