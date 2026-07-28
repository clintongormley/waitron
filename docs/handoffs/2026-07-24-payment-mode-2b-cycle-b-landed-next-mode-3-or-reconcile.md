# Handoff — payment Mode 2b Cycle B (on-device Stripe binding) landed; next: Mode 3 / reconcile / tab-tip

**Date:** 2026-07-24
**Main:** `5dc20a2` — "feat(payments): Mode 2b Cycle B — on-device Stripe binding + forward interface + race-safe incident dedup (#25)". On `main`, up to date with origin. Worktree torn down, local branch deleted.
**This session:** one full sub-project cycle, **Mode 2b Cycle B**, brainstorm → design (new umbrella-spec section) → plan (10 tasks) → SDD → `/finish-branch` → `/land-branch` as **PR #25** (squash `5dc20a2`). Plus: the **`STRIPE_SANDBOX_SECRET_KEY` repo secret was added** (nightly sandbox now runs), and the `payment-layer-4b-followups` memory updated.

`main` history (most recent first): `5dc20a2` (#25 Mode 2b Cycle B) → `af86987` (#24 coverage guard) → `a938d75` (#23 Mode 2b Cycle A) → `ffe6018` (#22 Mode 2a) → `0bcfc03` (#21 Mode 1) → `7aa0a57` (#20 4a seam).

**Nothing is left open** — no follow-up PR this time (unlike #24 after Cycle A). CI green, Copilot clean.

---

## What landed this session: Mode 2b Cycle B (PR #25)

The real on-device Stripe binding behind Cycle A's offline layer, `forward` promoted to a first-class provider method, and the shared `incidents` dedup made race-safe. **13 commits** (design+plan docs → 10 tasks → 1 final-review fix → prettier fixups).

### Neutral (`@waitron/core` / `@waitron/db` / `@waitron/payments`)
- **Race-safe `incidents` dedup:** hand-written migration `0009_incidents_open_dedup.sql` — a **partial unique index** `(tenant_id, till_id, code, sale_id) NULLS NOT DISTINCT WHERE acknowledged_at IS NULL` (PG 18; drizzle 0.45's index builder can't express `NULLS NOT DISTINCT`, so it's a `--custom` migration + a journal `entries[]` idx-9 entry, NOT in the drizzle schema — so drizzle-kit never diffs/drops it, same as the RLS/GRANT migrations). Both `recordIncident` **and** `recordIncidentOnce` → `ON CONFLICT DO NOTHING`. Proven race-safe by a real-PG acquired-signal concurrency test (`packages/payments/src/incident-dedup.concurrency.test.ts`).
- **`chain.verification_failed` aggregation (the final-review fix — see decisions):** `record-sale.ts` / `record-void.ts` now emit **one** incident carrying **all** `IntegrityIssue`s in `params.issues: Array<{issueCode, recordId, issueParams}>` (was one row per issue).
- **`forward` joins the `PaymentProvider` interface**; `StripeTerminalProvider` (2a) gained an all-zeros `forward`. `listAcceptedOffline` (non-locking T1 read) added to the store + barrel.

### Adapter (`@waitron/payments-stripe`)
- **`StripeOnDeviceProvider`** (`device-provider.ts`) — gate-up-front `collect` (four outcomes; `network_unavailable` persists nothing; **no `attempting`-first**), a T1/T2 `forward` (`listAcceptedOffline` → `syncOfflineQueue` → idempotent `settleForwarded`/`declineForwarded` + the race-safe incident), reversals **delegating to the shared `reverseViaStripe`** (`reverse.ts`, `StripeRefunder` structural type — both Stripe providers share one reversal path).
- **`StripeDeviceClient`** (`device-client.ts`) narrow seam — a **scenario-based** `FakeStripeDevice` (`nextCollect("online"|"offline"|"declined")`; the offline scenario yields `accepted_offline` only when `offlineAllowed`, so the policy gate is **load-bearing** in tests), plus a coverage-excluded real `stripeDeviceClient` (`createConnectionToken` + `refund` real; device-side ops throw — they run in the device SDK, SP7/SP9). Connection tokens live entirely here (neutral pkg bans `connectiontoken`).
- **Server-side nightly sandbox** (`connection-token.sandbox.test.ts`), self-skips without `STRIPE_SECRET_KEY`; the `STRIPE_SANDBOX_SECRET_KEY` secret is now set, so it runs nightly. `payments-stripe` gained a direct `drizzle-orm` dependency (forward's `workingOrders` till-join).
- **Provider id is `"stripe"` for BOTH** Stripe adapters (one settlement identity for a future reconcile; only the on-device provider writes `accepted_offline`, so forward's scoping is unambiguous).

Tests: real-PG RLS (`device.rls.test.ts`) + the incident-race concurrency proof, a capstone (`device.wiring.test.ts`: offline device tender chains a sale, forward-decline raises the incident **without un-chaining**), the aggregation regression test. Coverage: core/payments 100%, payments-stripe 99.25%. Monorepo `pnpm -r test` green incl. fiscal-verifactu 177 (the incidents change is behavior-preserving).

## Load-bearing decisions (Cycle B)

- **Table-wide incident invariant** (chosen over a payments-local advisory lock): "at most one open incident per `(tenant, till, code, sale)`", enforced by the partial unique index. Matches the codebase's "shared primitive, done once" discipline.
- **⚠️ The invariant conflicted with an existing core behavior — caught by the whole-branch review, fixed by aggregation.** `record-sale`/`record-void` emitted one `chain.verification_failed` incident **per** verification issue, all same `(sale, code)`; `verifyChain` (`packages/fiscal-verifactu/src/verify.ts:69-108`) can return **two** issues at once (a doubly-corrupted predecessor — the hash-mismatch push does NOT early-return, falls through to link-mismatch/predecessor-missing). The new index silently dropped the 2nd. **Resolution (user-chosen): aggregate** all issues into one incident (`params.issues[]`), completing the invariant with zero detail loss. The `errors.ts` `chain.verification_failed` param shape changed from a single flattened issue to `{ tillId, issues: [...] }`. **Lesson: a table-wide unique index is incompatible with any caller that intentionally writes N distinct same-key rows — audit every writer before adding one.**
- **`provider = "stripe"` shared** with 2a (one settlement identity).
- **No `attempting`-first pre-write for 2b** — the device owns its PI/offline queue locally, so a crash never loses the device's record (the gap is reconcile's `missingLocal`), and this is what lets `network_unavailable` persist nothing.
- **No new `forwarding` enum state** — the idempotent state-guarded `settleForwarded`/`declineForwarded` advances + the race-safe incident give concurrency safety without an in-flight marker.
- **Scenario-based fake** (not literal-outcome scripting) — makes the policy gate wiring load-bearing.
- **Reversals shared, not re-implemented** — `reverseViaStripe` extracted; both providers delegate.

---

## THE NEXT TASK — Mode 3 / reconcile / tab-tip (pick one; its own spec→plan→SDD→land cycle)

Cycle B completes the on-device mechanism. Per the umbrella design §10 sequence, the remaining payment-layer work (priority order, but the choice is open):

1. **Mode 3 — Asynchronous / hosted** (QR pay-at-table, payment links, online orders). A **distinct interface shape** — `initiate() → { ref, url/qr }` + a **webhook** that writes the settled tender later (not returned synchronously). This is where the long-deferred **webhooks + untenanted `(provider, external_ref)` tenant-resolution** (an RLS-exempt resolver + index) finally land. Biggest new surface.
2. **`reconcile()` (the old "4d")** — the read-side backstop per integrated mode: audit our `payments` rows against the processor's settlement/payout report; the `unsettled`/`orphan`/`missingLocal`/`drift` mismatch classes (design §6). The designed home for the `attempting`-stuck-state recovery and 2b's "device stored offline but we crashed before writing" (`missingLocal`) gap. Twin of `FiscalBackend.reconcile`.
3. **Tab/tip lifecycle (the old "4e")** — `preAuth`/`incrementalAuth`/`tipAdjust`/`capture` (two-phase), built+faked+tested now; UI later (SP10 tabs / SP13 tips).
4. Cross-cutting: the refund/void **role-gate** (rides with identity, SP5).

## Deferred follow-ups found in Cycle B's reviews (small; fold into a future cycle or a cleanup PR)

- **Void two-issue test:** the `chain.verification_failed` aggregation on the `record-void` path is tested only single-issue (the sale path has the two-issue regression test); its code is symmetric to the tested sale path. Add a symmetric two-issue void test.
- **`drain`/`reconcile` `incidentsRaised` over-count:** those callers increment the counter unconditionally after the now-`ON CONFLICT`-able `recordIncident`; on a reconcile `drift_errores` re-detect (same open key), the counter over-counts (log-line only). Minimal fix: make `recordIncident` return whether it inserted, and count real inserts (mirrors `recordIncidentOnce`).
- **Shared `tillForWorkingOrder(tx, tenantId, workingOrderId)` store helper:** the `select tillId from workingOrders` join is duplicated in `device-provider.ts` (`forward`) and `fake-provider.ts` (`forward`); neither guards `const [wo]` being `undefined`. Extract a helper that throws a clear domain error if the working order is missing.
- **Forward "still pending on device" branch:** `device-provider.ts` `forward`'s loop fall-through (a ref in neither `settled` nor `declined`) is uncovered (gate passes at 98.66% branches). A `syncOfflineQueue` returning `{settled:[], declined:[]}` for a pending ref closes it.
- **`device-client.ts` coverage phantom:** a pure types file reporting 0/0/0/0; consider adding to the payments-stripe `coverage.exclude` like the `index.ts` barrel.
- **`CURRENCY = "eur"` hardcoded** in both Stripe providers (inherited from 2a; consistent with single-currency-per-tenant, but a non-EUR tenant would present the wrong currency — a real follow-up when multi-currency lands).
- **`externalRef` money-path guard:** hardened this cycle (a `captured`/`accepted_offline` device outcome without a PI id now throws; `/* v8 ignore */` since unreachable with current bindings — the fake always supplies one and the real device stub throws). Revisit when the real device bridge (SP7/SP9) lands.

---

## Process lessons from THIS session (carry them)

- **A table-wide unique index conflicts with any "N distinct same-key rows" caller.** The incidents dedup index broke `record-sale`/`record-void`'s per-verification-issue incidents. The per-task reviews (payments-scoped) could not see it; the **whole-branch opus review caught it**. Lesson: before a cross-cutting shared-primitive change, grep every writer and confirm none intentionally writes multiple same-key rows. And: **the final whole-branch review earns its keep on cross-cutting changes** — it found the one real bug that 10 clean per-task reviews missed.
- **The transient CI Docker-outage flake recurred** (memory: `payment-layer-4b-followups`). CI `test` job failed with `REQUIRE_DOCKER is set but Docker is not available` in `packages/db`'s `describeEachTarget` real-PG tests (they THROW, never skip). Cleared immediately on `gh run rerun <id> --failed`. **Not a code issue** — recognise it by the `harness.ts:162 resolveTargets` error, don't debug it.
- **Defer the coverage gate to one task, run it there.** Tasks 5-8 added device code but deliberately deferred the `stripe-device-client.ts` coverage-exclude + the first `test:coverage` to Task 9. That first coverage run correctly surfaced 3 uncovered `StripeOnDeviceProvider` methods (`void`/`partialRefund`/`connectionToken`) — the #23-class gap — which a fix wave closed. Per-task reviews ran `test`, not `test:coverage`, so the gate only fired at Task 9; that's fine as long as one task owns it. (The implementer correctly refused to paper over the gap with excludes.)
- **`db:generate:custom -- --name X` leaks the `--` to drizzle-kit** under this pnpm; use `pnpm --filter @waitron/db exec drizzle-kit generate --custom --name X` instead (same result).
- **The controller owns plan bugs — pre-flight caught two.** Before dispatching, the SDD pre-flight review caught (a) the plan re-implementing `reverse()` instead of sharing it (design said "shared, not re-implemented") → extracted `reverseViaStripe`; (b) the fake ignoring `offlineAllowed` (gate untested) → made it scenario-based. Both fixed **in the plan** before any implementer ran.
- Repeat-from-before, still true: **`format:check` (prettier) is a pre-push + CI gate, not part of per-package `lint`** (run `pnpm format` before pushing — the pre-push hook caught it here via Task 10's fixup commit). **Copilot COMMENTED reviews don't block** (this one had zero findings). **Coverage is CI-only, not the pre-push hook.**

## Workflow that worked (repeat it)

`superpowers:brainstorming` → revise umbrella design (new "Mode N — Cycle B" section + re-sequence §10 status) → **3 decision questions** (slicing / incident-fix scope / sandbox scope) → `superpowers:writing-plans` (10 code-complete tasks) → **SDD pre-flight review** (2 plan warts fixed in the plan) → `superpowers:subagent-driven-development` (fresh implementer per task — **sonnet** for complete-code tasks, **haiku** for trivial 3/9, **opus** for the final whole-branch review + the fiscal-path fix wave; per-task reviewer after each; single fix wave for the final review's one Important + two Minors) → `/finish-branch` (skipped the redundant simplify/re-review — whole-branch review already done) → `/land-branch`. The SDD ledger + briefs lived under the (now-removed) worktree's git-ignored `.superpowers/sdd/` — **this handoff is the durable record.**

## Pointers

- **Umbrella design:** `docs/superpowers/specs/2026-07-22-payment-layer-design.md` — the **"Mode 2b — Cycle B"** section (Decisions ⓪/①/②), §5/§6 offline+reconcile semantics, §10.3 the 2b split, §0 taxonomy. §10 status now marks 2a/2b-A/2b-B all landed.
- **Plan:** `docs/superpowers/plans/2026-07-24-payment-mode-2b-cycle-b-on-device-stripe.md` (10 tasks; the SDD shape to mirror).
- **Landed code:** `packages/payments-stripe/src/` — `device-provider.ts`, `device-client.ts`, `stripe-device-client.ts`, `reverse.ts`, `testing/fake-stripe-device.ts`, `connection-token.sandbox.test.ts`; `packages/payments/src/store.ts` (`listAcceptedOffline`), `provider.ts` (`forward` on interface); `packages/core/src/incidents.ts` + `record-sale.ts`/`record-void.ts` + `errors.ts` (aggregation); `packages/db/drizzle/0009_incidents_open_dedup.sql`.
- **The precedent the next adapter mirrors:** `payments-stripe` (2a server-driven + 2b on-device — two provider classes, one shared reversal helper, injected client seams) and `fiscal-verifactu` (adapter raising incidents; `drain`/`reconcile`).
- **Memory to read before the next cycle:** `payment-layer-4b-followups` (state + deferred items + all coverage/CI lessons), `currency-and-localisation-requirements`, `verifactu-mode-separate-modules`.
