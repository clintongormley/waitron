# Handoff — payment Mode 1 (manual) + Mode 2a (Stripe) landed; next: Mode 2b / 3 / reconcile-4d

**Date:** 2026-07-23
**Main:** `ffe6018` — "feat(payments): Mode 2a — Stripe Terminal adapter (#22)". On `main`, up to date with origin.
**This session:** two full sub-projects, each brainstorm → design → plan → SDD → finish-branch → land: **Mode 1 (manual/unintegrated tender)** landed as PR #21, and **Mode 2a (Stripe Terminal adapter)** landed as PR #22. Along the way the payment-layer umbrella design was re-derived around a **capture-mode taxonomy** (the load-bearing reframe below).

`main` history (most recent first): `ffe6018` (#22 Mode 2a) → `0bcfc03` (#21 Mode 1) → `7aa0a57` (#20 4a seam) → `7a972e0` (#19 roadmap docs) → `89ad886` (#18 reconcile-resolution) → `b179177` (#17 plan 3b).

> **⚠️ Do this first in the main checkout:** `cd ~/workspace/repos/waitron && pnpm install`. Its `node_modules` predates the newly-merged `packages/payments-stripe`, so the pre-push hook's repo-wide `pnpm -r test`/`typecheck` can't resolve the new package until you refresh deps. New worktrees are fine — `worktree.py new` installs fresh.

> **⚠️ Repo secret needed:** the nightly Stripe sandbox job (`.github/workflows/stripe-sandbox.yml`) reads `secrets.STRIPE_SANDBOX_SECRET_KEY` (a Stripe **test-mode** key). Until that repo secret is added, the job runs nightly and **self-skips green** — it never actually exercises Stripe. Add it via GitHub → repo settings → secrets.

---

## The reframe that shapes everything: the capture-mode taxonomy

The original payment design assumed the whole layer was one integrated `PaymentProvider`. It isn't. The design doc (`docs/superpowers/specs/2026-07-22-payment-layer-design.md`, **§0**) now organizes sub-project 4 around a **taxonomy of capture modes**. The universal join: every mode ultimately produces the one thing the sales spine needs — a **settled tender** (`method`, `amount`, `settledAt`, optional `externalRef`) flowing into `recordSale`. Modes differ only in *how* that tender comes to exist.

**Settlement axis (what core sees):**
1. **Manual / unintegrated** — staff key the total into a *separate* bank datáfono; the POS records a staff-asserted card tender. **NOT a `PaymentProvider`** — a sibling of cash. (= Mode 1, landed.)
2. **Synchronous integrated** — we drive a reader, the settled outcome comes back synchronously; we own void/refund/reconcile. (= `PaymentProvider`; Mode 2a Stripe is the first.)
3. **Asynchronous integrated** — customer pays out-of-band (QR/link/online); we `initiate()` and a **webhook** later settles. A *different method shape*, not `collect(): Promise<PaymentResult>`.

**Mechanism axis (inside the integrated modes, behind the SAME seam):** **2a** server-driven remote reader (fixed counter) vs **2b** on-device SDK reader (the waiter's handheld; offline store-and-forward lives here). The seam is defined by the *settlement shape core sees*, never the mechanism.

---

## What landed this session

### Mode 1 — manual / unintegrated tender (PR #21)
A staff-asserted card tender that reuses the payment store with a **sentinel `provider = "manual"`** — no adapter, no network. **Atomic capture** (no orphan window, because there's no network step between capture and sale). Added a nullable `external_ref` column; manual refunds via the existing `recordRefund`. Design: the "Mode 1" section of the umbrella doc; plan: `docs/superpowers/plans/2026-07-23-payment-mode-1-manual-tender.md`.

### Mode 2a — Stripe Terminal adapter (PR #22)
The first real integrated `PaymentProvider`. Plan: `docs/superpowers/plans/2026-07-23-payment-mode-2a-stripe.md`; design: the "Mode 2a" section of the umbrella doc.

- **Neutral `@waitron/payments`** gained: the transient **`attempting`** state (`ALTER TYPE`, migration `0003`) + T1/T2 helpers `insertAttempting`/`captureAttempting`/`failAttempting`; **`PaymentRow.externalRef`** on read-back; `recordRefund`'s prior-sum filtered to `state='succeeded'` + **`recordFailedRefund`**; **`assertReversible`** (read-only reversibility pre-check); the fake's `partialRefund` amount fix; a real-PG reversal-concurrency test.
- **New `@waitron/payments-stripe`** (adapter): a **narrow injected `StripeClient`** interface (real impl wraps the `stripe` SDK, coverage-excluded; `FakeStripe` for the hermetic suite) + `StripeTerminalProvider implements PaymentProvider`. `collect` is **server-driven, poll-to-completion, T1/T2**: a committed `attempting` row (`payment_ref` = a minted idempotency **uuid**) *before* the network, the outcome *after*, with the Stripe **PaymentIntent id in `external_ref`**. Reversals via `stripe.refunds`. A wiring capstone, a real-PG RLS test, and a **nightly env-gated Stripe test-mode sandbox** suite + workflow.

### Mode 2a design decisions worth remembering
- **Standalone merchant accounts** (each merchant's own Stripe account — **no Connect**, no connected-account context on calls). User decision.
- **Config-agnostic adapter**: constructed `{ client, resolveReader, db }` — an injected client + an injected `resolveReader(tenantId, tillId)`. Per-tenant provisioning (keys, reader ids, webhook secrets) is **NOT** owned here (deferred), exactly as SIF registration is separate from `VerifactuBackend`. `payments-stripe` owns **no schema** (no `drizzle/`).
- **Testing seam**: inject a narrow `StripeClient` + hand `FakeStripe` (hermetic PR gate) **PLUS** a real Stripe test-mode **sandbox** suite gated to a **nightly** GitHub Action (real-API fidelity on a cadence). The sandbox self-skips without `STRIPE_SECRET_KEY`.
- **`StripeTerminalProviderOptions.db` must be a TENANT-SCOPED handle** (sets `app.tenant_id`) — `collect`/`reverse` open their own transactions and rely on RLS scoping from it. Documented on the type.
- **`payments-stripe` is in NEITHER `GENERIC_PACKAGES` nor `EXEMPT_PACKAGES`** — its vocabulary is English (Stripe/Reader/PaymentIntent), the Spanish guard scans only `GENERIC_PACKAGES`, and adding it would break the pinned-list tests in `english-only.test.ts` + `vocabulary-scope.test.ts` for no benefit. Do not classify it.
- **Reversal money-path** (found + fixed under review): the idempotency key is a **fresh `randomUUID()` per reversal call** (so two independent equal partial refunds each issue a real refund — a stable `(ref,amount)` key would make Stripe replay one and diverge the local ledger); and `reverse()` runs `assertReversible` **before** the Stripe call so an invalid/over-refunding local state fails fast without moving money. `recordVoid`/`recordRefund` stay the authoritative locked checks; the residual concurrent-reversal race is bounded by that lock and is **reconcile-4d's** job.

---

## THE NEXT TASK — pick one of three (all share the umbrella design)

Each is its own spec→plan→SDD→finish→land cycle. The deferred items below (also in memory `payment-layer-4b-followups`) fold into whichever you pick.

1. **Mode 2b — on-device SDK integrated + offline** *(the waiter's handheld; = old "4c")*. A second mechanism behind the SAME neutral seam: the app runs *on* a handheld and drives its built-in reader via an on-device SDK, reports the outcome back, **and offline store-and-forward lives here** (`accepted_offline`, `forward()`, `payment_policy`, the amount cap — see the umbrella §5). Bigger and more architecturally novel (device-side collect, connection tokens, webhooks for outcomes). Good if handheld/table-service is the priority.

2. **Mode 3 — asynchronous / hosted** *(QR pay-at-table, payment links, online)*. The `initiate() → { ref, url/qr }` + **webhook** shape (a *different* interface from `collect`). Restaurants want pay-at-table. Introduces the webhook infra + the **untenanted tenant-resolution** the deferred items keep flagging.

3. **`reconcile()` (old "4d")** *(cross-cutting)*. The read-side auditor that closes the reversal/settlement money-path loop 2a deliberately left open — audits our `payments` rows against Stripe's payout/settlement report, self-heals orphans, raises idempotent incidents. **This is where the deferred reversal-idempotency retry-safety and the concurrent-reversal race actually get backstopped.** Structurally the twin of `FiscalBackend.reconcile` (see umbrella §6). Strong candidate if you want to harden the money path before adding more capture surface.

**Deferred items (fold into 2b / 3 / reconcile as relevant):**
- **Webhooks + the untenanted tenant-resolution** — an RLS-exempt resolver keyed by `(provider, external_ref)` = the PI id, plus that index. Needed by Mode 3 (async) and by any real Stripe webhook (async refund confirmation, disputes, reader-disconnect, cleaning stuck `attempting` rows).
- **Reversal retry-safety** for the *same* logical reversal needs a **persisted per-reversal id** threaded from the caller (the interface has none today).
- Small guarded gaps: `failAttempting`/`recordFailedRefund` not-found tests (the latter keeps `@waitron/payments` coverage at ~98.58% stmts — cover it for headroom).

---

## Workflow + mechanics (what worked; repeat it)

- **Process:** `superpowers:brainstorming` → revise the umbrella design doc (a new "Mode N" section + re-sequence §10) → `superpowers:writing-plans` (a per-mode plan doc) → `superpowers:subagent-driven-development` → `/finish-branch` → `/land-branch`. Design + plan commit on the feature branch and land with the implementation PR.
- **Worktree:** `python3 ~/workspace/tools/worktree.py new waitron <branch>` (does `pnpm install`). Commit inside the worktree; the SDD ledger + briefs live under its git-ignored `.superpowers/sdd/` (gone once the worktree is torn down — this handoff is the durable record).
- **SDD dispatch discipline:** fresh general-purpose implementer per task from a `scripts/task-brief`; **haiku** for pure-transcription/mechanical tasks, **sonnet** when the plan carries complete code, **opus** for the subtle ones (concurrency test, the `collect` poll capstone, RLS shape) and the final whole-branch review. A task reviewer (spec + quality) after each via `scripts/review-package`; fix loop for Critical/Important; **record Minors in the ledger for the final review to triage**. Every dispatch: `git add` ONLY the task's explicit paths, name the worktree path, and pass artifacts as files (brief/report/diff), not pasted text.
- **The controller owns plan bugs.** My Mode 2a brief used `provider: "stripe"` in the *neutral* package's test fixtures (violates its own no-vendor-vocabulary rule) — caught by the Task-1 reviewer; I fixed the plan AND the code. Fix the plan when a wart will recur in later tasks.

---

## Hard lessons from this session (carry them)

- **Transient CI Docker outage.** `REQUIRE_DOCKER=1` but the runner's Docker daemon was absent → three `@waitron/db` real-Postgres Testcontainers files THREW (the harness never skips). **Clears on `gh run rerun <run-id> --failed`** — not a code issue. (Our own RLS/concurrency tests share the same requirement.)
- **`format:check` (prettier) is a pre-push + CI gate, NOT part of per-package `lint` (eslint only).** It failed on **11 files** this session (and bit Mode 1 too). Run `pnpm format:check` or `prettier --write` before pushing — per-task subagents won't catch it.
- **Copilot iterates — converge deliberately.** #22 took **4 Copilot rounds**, diminishing from a real bug (a mid-poll `readerOutcome` throw left the row `attempting`, breaking the T1/T2 "every attempt resolves" guarantee) → contract/doc nits → a wording nit. Every unresolved thread **blocks merge** (`required_review_thread_resolution`); a COMMENTED review does not. **Fix real findings (push); resolve trivial/subjective threads with a REPLY (no push)** — a push re-triggers the loop, a resolve does not. The substantive Copilot finds were all **reversal money-path** edge cases.
- **A brand-new branchless file can fail the CI branch-coverage gate under Linux V8** even with `singleFork` (Mode 1's `manual.ts`: 100% local / 66.66% CI). Fix by excluding it in `vitest.config.ts` `coverage.exclude`. In `payments-stripe`, the real-SDK boundary (`stripe-client.ts`) + `testing/**` + `*.sandbox.test.ts` are coverage-excluded.
- **The reversal design's inherent limitation:** money moves at the processor before the local write commits, and T1/T2 forbids holding a lock across the network — so a read-only pre-check (`assertReversible`) catches *avoidable* over-refunds, but the residual is genuinely **`reconcile`'s** job. Don't try to make reversals fully atomic; build reconcile.

---

## Pointers

- **Umbrella design (shared by every mode):** `docs/superpowers/specs/2026-07-22-payment-layer-design.md` — §0 taxonomy, §3 the `PaymentProvider` integrated-mode contract, §4 orphan window + associate-back, §5 offline (Mode 2b), §6 reconcile (4d), §7 data model, §10 re-derived decomposition, plus the "Mode 1" and "Mode 2a" design sections.
- **Plans:** `docs/superpowers/plans/2026-07-23-payment-mode-1-manual-tender.md`, `docs/superpowers/plans/2026-07-23-payment-mode-2a-stripe.md` (the SDD shape to mirror).
- **Landed code:** `packages/payments/` (neutral seam + store + `attempting`/`assertReversible`), `packages/payments-stripe/` (adapter: `src/provider.ts`, `src/client.ts` + `src/stripe-client.ts`, `src/testing/fake-stripe.ts`, `src/collect.sandbox.test.ts`, `vitest.sandbox.config.ts`), `.github/workflows/stripe-sandbox.yml`.
- **The precedent the whole layer mirrors:** `packages/fiscal` + `fiscal-verifactu` (+ `verifactu`'s injected `VerifactuClient`/`createFakeAeat`). Wherever the payment design is terse, that layer is the worked example.
- **Memory worth reading before the next mode:** `payment-layer-4b-followups` (current deferred items + lessons), `verifactu-mode-separate-modules` (the per-tenant-mode-is-explicit-config precedent the offline policy mirrors), `plan-3b-followups`.
