# Handoff — payment layer 4a landed; next: plan 4b (Stripe Terminal adapter)

**Date:** 2026-07-23
**Main:** `7aa0a57` — "feat: payment layer — provider-neutral PaymentProvider seam (plan 4a) (#20)". On `main`, up to date with origin.
**This session:** brainstormed → spec'd → planned → executed (SDD) → finished → **landed plan 4a** (PR #20), the neutral `@waitron/payments` seam of architecture sub-project 4 (the Payment layer). One mid-session complication: `origin/main` advanced (#19 docs) during finish-branch, so the branch was rebased before landing.

`main` history (most recent first): `7aa0a57` (#20 payment 4a) → `7a972e0` (#19 roadmap docs 18–20) → `89ad886` (#18 reconcile-resolution) → `b179177` (#17 plan 3b).

> **⚠️ Do this first in the main checkout:** `cd ~/workspace/repos/waitron && pnpm install`. Its `node_modules` predates the newly-merged `packages/payments`, so the pre-push hook's repo-wide `pnpm test`/`typecheck` can't resolve the new package until you refresh deps (a plain `git push` from the main checkout will otherwise fail the hook). New worktrees are fine — `worktree.py new` installs fresh.

---

## What landed this session (PR #20, squash `7aa0a57`)

A new package **`@waitron/payments`** — the provider-neutral payment seam — mirroring the `packages/fiscal` / `fiscal-verifactu` split. Design/plan (both on `main` now): `docs/superpowers/specs/2026-07-22-payment-layer-design.md`, `docs/superpowers/plans/2026-07-22-payment-layer-4a.md`.

- **`PaymentProvider` interface** (`packages/payments/src/provider.ts`): `collect` / `void` / `refund` / `partialRefund` + `provider` / `capabilities`. **No `tx` parameter** — the deliberate opposite of `FiscalBackend.recordSale(tx)`: every method makes a network call and T1/T2 forbids holding a DB transaction across one, so the provider does its own short-tx bookkeeping and the result flows into `recordSale` as data.
- **Payment-lifecycle store** (`src/store.ts`) over module-owned `payments` / `payment_refunds` tables (`src/schema/`, generated migration `drizzle/0000_payments.sql` + hand-written RLS/grants `0001_payments_rls.sql`, `PAYMENTS_MIGRATIONS`). `numeric(12,2)` exact decimals; grants SELECT/INSERT/UPDATE only (no DELETE); FORCE RLS + tenant-isolation on both tables. Store fns: `insertCapturedPayment`, `insertFailedPayment`, `recordVoid`, `recordRefund`, `associatePaymentWithSale`, `getPaymentByRef`, `findPaymentByRef` (+ `requireRowForUpdate`).
- **Option B sale linkage**: the payment row carries a nullable `sale_id` FK → core `sales` (module→core, like `registros_facturacion.sale_id`); core stays payment-ignorant. `associatePaymentWithSale` runs inside the sale tx so the link commits atomically with the sale, and is **write-once** (`UPDATE … WHERE sale_id IS NULL`; a re-associate throws `payment.already_associated`).
- **`FakePaymentProvider`** (`src/testing/fake-provider.ts`) — DB-backed test double, own short transactions, NOT barrel-exported.
- **Guards**: `no-provider-vocabulary.test.ts` (bans stripe/reader/terminal/… from the seam; matcher is a case-insensitive substring test after a review caught the cloned matcher missing acronym-adjacent compounds like `NFCReader`), `schema-ownership`, `monetary-columns`, `errors.reachability`.
- **Real-Postgres RLS test** (`payments.rls.test.ts`, Testcontainers, non-superuser `rls_probe`) proving grants + tenant isolation (airtight-non-vacuous: same key returns the row under tenant A, `undefined` under B).
- **End-to-end wiring test** (`wiring.test.ts`): `collect → recordSale → associate`, atomic; and failed-collect → `sale.tender_unsettled`.
- `test:coverage` **100%** across the board (146 tests).

### Design decisions worth remembering
- **Full-surface scope** = full *capability* across sub-project 4 (plans 4a–4e), NOT dead stubs; 4a is the online subset only (see the spec's §10 decomposition).
- **accept-offline is an explicit per-transaction opt-in**, never automatic — the user's steer: when the network is down, prompt for cash first; offline is a deliberate staff action gated by per-tenant policy + an amount cap (all built in 4c, not 4a).
- **`void` in 4a** = a same-day full reversal of a **captured** payment (collect is atomic auth+capture, so there is no uncaptured state); distinct from a refund. This corrected a bug in the plan's rough store draft.
- The fiscal↔payment symmetry: fiscal `drain`+`reconcile`; payments `forward`+`reconcile` (the latter two are 4c/4d).

---

## THE NEXT TASK — plan 4b: the Stripe Terminal adapter

**Status: not started.** Start with `superpowers:brainstorming` (a new `packages/payments-stripe` package, EXEMPT from the neutral-vocabulary guard, depends on `@waitron/payments` + the Stripe SDK), then spec → plan → SDD → finish → land, same as 4a.

**Deferred items to fold into 4b** (surfaced by reviewers on PR #20; full detail in memory `payment-layer-4b-followups`):
- **Webhook tenant-resolution for ref-only reversals.** `void/refund/partialRefund(ref)` take only a ref; `findPaymentByRef` (untenanted) returns nothing under real RLS with no `app.tenant_id`. Fine in 4a (no production reversal caller; fake is PGlite/superuser only) — but the real adapter's **Stripe webhook** must resolve tenant from the ref (an RLS-exempt reconciliation role, or a ref→tenant map). Flagged by Copilot ×2 + the simplify altitude pass.
- **`findPaymentByRef` needs a `(provider, payment_ref)` index** (migration) — the existing unique leads with `tenant_id`, so the untenanted webhook lookup can't seek.
- **`recordRefund` prior-sum** should filter `state='succeeded'` once a failed-refund path exists (inert today).
- **`PaymentResult.amount` for a partial refund** returns the captured total, not the refunded amount — settle the reversal-result contract when 4b wires refund receipts.
- **A dedicated real-PG reversal-concurrency test** (the `FOR UPDATE` locks added in 4a are correct but unexercised by a racing test — follow `chain.concurrency.test.ts`'s acquired-signal pattern to avoid the 120s CI hang).
- Negative-path rollback atomicity test; refund **role-gate** rides with identity (sub-project 5).

Later plans: **4c** offline store-and-forward (`forward()`, `payment_policy`, `allowOffline`) · **4d** `reconcile()` · **4e** preAuth/authorize/capture/incrementalAuth/tipAdjust.

---

## Workflow + mechanics (what worked; repeat for 4b)

- **Process:** `superpowers:brainstorming` → spec (commit on the feature branch) → `superpowers:writing-plans` → plan (commit) → `superpowers:subagent-driven-development` → `/finish-branch` → `/land-branch`. Design + plan land with the implementation PR.
- **Worktree:** `python3 ~/workspace/tools/worktree.py new waitron <branch>` (does `pnpm install`). Work + commit inside the worktree; the SDD ledger + briefs live under its git-ignored `.superpowers/sdd/`.
- **SDD dispatch discipline:** fresh general-purpose implementer per task; **sonnet** when the plan carries complete code, **opus** for the subtle/compliance-critical ones (schema, RLS, store, the wiring capstone) and the final whole-branch review. Task reviewer after each (spec + quality); fix loop for Critical/Important. **Every dispatch: `git add` ONLY the task's explicit paths, never `-A`/`.`, and always name the worktree path** (the subagent's cwd is otherwise the main checkout).
- **The controller resolves ambiguity in the plan** — the store's `void`/refund state-machine and the fake's tenant lookup were corrected via controller "corrections" files, overriding the plan's rough draft. Do that rather than let implementers transcribe a known-imperfect plan.

### Hard lessons from this session (carry them)
- **Changing a shared constant needs a repo-wide grep for assertions of it.** Adding `payments` to `GENERIC_PACKAGES` (`packages/db/src/english-only.ts`) broke `packages/fiscal-verifactu/src/vocabulary-scope.test.ts`, which pins the exact list — a cross-package test the per-package SDD suites never ran. **The pre-push hook (`pnpm -r test`) caught it**, not the per-package runs. Grep the whole repo before landing a shared-constant change.
- **`@vitest/coverage-v8` under-merges BRANCH coverage across fork workers on a SMALL package.** With the Testcontainers tests in the suite, `store.ts` showed 83.78% branch in the parallel run but **100% alone**. Fix (in `packages/payments/vitest.config.ts`): `poolOptions.forks.singleFork: true` + exclude the two pure re-export barrels (`src/index.ts`, `src/schema/index.ts`) from coverage. fiscal-verifactu dilutes the same artifact with thousands of real branches; a small package can't. **CI's `test` job runs `pnpm -r test:coverage` with `REQUIRE_DOCKER=1` and enforces each package's thresholds** — this is a real merge gate, not just a local check.
- **GitHub Actions "cleanup orphan processes" post-job wedge**: `typecheck`/`static-analysis` showed every step green (incl. "Complete job") but the job never finalized. Transient GHA infra, self-resolves or clears on a re-run — not a code issue. Don't chase it as a bug.
- **Copilot iterates.** Five review rounds on PR #20 (each push re-triggers it), findings diminishing from real (two concurrency TOCTOUs → `FOR UPDATE`; write-once association) to doc/grammar/spec-wording nits. Every unresolved thread blocks merge (`required_review_thread_resolution`), but a COMMENTED review does not. Converge by **resolving trivial/subjective threads with a reply (no push)** — a push re-triggers the loop; a resolve does not.
- **`/finish-branch` rebases in the worktree; `/land-branch` from the main checkout.** If `main` advances mid-finish, rebase + force-push + re-poll (it happened here with #19). `gh pr merge --delete-branch` can't delete the local branch while the worktree holds it — that's expected; `/land-branch`'s teardown handles it. If a `git push --delete` of the remote branch trips the pre-push hook, delete the remote ref via `gh api -X DELETE repos/:owner/:repo/git/refs/heads/<branch>`.

---

## Pointers

- Payment layer design / phasing: `docs/superpowers/specs/2026-07-22-payment-layer-design.md` (esp. §2 package split, §5 offline, §7 data model, §10 plan decomposition 4a–4e).
- Plan 4a (reference for the SDD shape): `docs/superpowers/plans/2026-07-22-payment-layer-4a.md`.
- The landed code: `packages/payments/` (interface `src/provider.ts`, store `src/store.ts`, fake `src/testing/fake-provider.ts`, schema `src/schema/`, migrations `drizzle/`, coverage config note in `vitest.config.ts`).
- Roadmap / architecture: `docs/superpowers/specs/2026-07-18-pos-architecture-design.md` (§8 repo shape names `packages/payments`; §2 row 4 is this sub-project).
- Memory worth reading before 4b: `payment-layer-4b-followups`, `verifactu-mode-separate-modules` (the per-tenant-mode precedent the offline policy mirrors), `plan-3b-followups`.
