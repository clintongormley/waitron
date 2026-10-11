# A475 Money Write Session Implementation Plan

> **For agentic workers:** Execute inline with `superpowers:executing-plans`; read `superpowers:test-driven-development` before writing code. Follow the FULL review path below. Execution, finish and land are already authorized; no approval checkpoint.

**Goal:** Refuse a new till money request when its device or sign-in changed after the initial request check, before any money effect.

**Architecture:** Require `{ personId, sessionId }` at the three till sale entry points. Reuse `assertStillSignedIn` FIRST inside the existing write transaction, including integrated payment preparation before reader collection. Keep trusted business orchestration separately named so captured-payment recovery needs no till session and already-started reader attempts can finish.

**Tech Stack:** TypeScript, Hono, Drizzle/SQLite, Vitest, real venue databases and the existing fiscal backend.

**Spec:** Lane D `~/waitron-campaign-d/queue.md` → A475; `docs/backlog.md` → Payments and card readers; `docs/backlog/payments.md` → “The counter sale, `/api/pay`, collecting a placed order and bill refunds do not re-check the device inside their write”.

## Execution choices

Use one HTTP race suite for all four paths. A controlled request-body read pauses after the route’s initial sign-in check, then revocation commits before the money transaction. Existing business suites retain their assertions and use explicitly named trusted orchestration imports. Commit the three implementation tasks together after their per-task reviews.

## Scope and receipts

- Queue requirement: “pass `{ personId, sessionId }` and call `assertStillSignedIn` FIRST inside each write's transaction”. Backlog requirement: “the fix is A471's: pass `{ personId, sessionId }`”.
- Read against local `main` `f4096b959`: `till-sale.ts:495,887,929,1759,1879`; `till-session.ts:137`; `bill-refunds.ts:537,554`; `payments-api.ts:959,1018` (all under `apps/server/src/`). Recheck these sites on current main when executing; no reproduction was run while planning.
- Historical A471 probe, quoted from the payments detail: sale “sale written, invoice issued”; integrated pay “reader asked once, payment captured, sale written”; collect “invoice issued, order settled”; cash refund “refund completed”. Session-ended refund already answered `session.not_open` through `authorize`.
- Implement only the request checks, required argument plumbing, small shared-body extractions and tests. No schema, fiscal algorithm, provider protocol, permission/profile redesign or UI changes; reuse `assertStillSignedIn` unchanged.
- Preserve one transaction per existing atomic write, sequential awaited queries and the existing integrated preparation/reader/completion split. Keep PIN derivation outside the refund write lock.
- Files: modify `apps/server/src/{till-sale,till-api,bill-refunds,payments-api}.ts`; add `apps/server/src/till-money.write-session.test.ts`; extend `apps/server/src/payments-api.stuck.test.ts` for trusted recovery. Touch existing business test imports/call targets only as needed; remove the completed entry from both backlog files at completion.

## Interfaces and test contract

- In `till-sale.ts`, define `TillMoneyOperator = { personId: string; sessionId: string }`. Keep existing deps/config/request and return types; replace the optional fourth person-id argument of `recordTillSale`, `collectOrder`, `payWorkingOrderIntegrated` with mandatory `operator: TillMoneyOperator`.
- `refundBillPayment` keeps its existing required operator including `attempts`; derive the device id from `cfg.origin.deviceId` in all four paths. Call `assertStillSignedIn(tx, { deviceId, ...operatorIds })` before order/replay reads, authorization, attempt marks or writes.
- Expose lower-level `recordTillSaleOrchestration`, `collectOrderOrchestration`, `payWorkingOrderIntegratedOrchestration` with the corresponding old signatures and return types, retaining `operatorId?: string` for attribution. Existing `payWorkingOrder` remains business orchestration; it is not a route entry point.
- Share private transaction bodies. Where a shared runner owns transactions, require an internal transaction-body callback: the guarded caller checks first then runs the body; the trusted caller runs the same body directly. No optional identity, default no-op guard, `skipAuthorization` flag or authorization bypass argument on HTTP entry functions. Guard cash duplicate-conflict replay's fresh transaction too.
- Three `till-api.ts` routes pass both ids from `requireSession`; no till HTTP route calls an orchestration helper. The management stuck-payment route calls `payWorkingOrderIntegratedOrchestration`, preserving manager authorization, stored device origin, manager attribution and `withoutCollect`.
- Business-only suites may switch to explicitly named orchestration helpers without changing any behavioral assertion or attribution argument. New race, legitimate, retry and completion tests must start through the guarded entry points; dashboard recovery tests use the real management route.
- Use `useVenueDb` with product migrations/triggers, real `VerifactuBackend`, session/device fixtures and a controlled reader seam. Do not mock the guard or transaction. Catch refusals around the entire call and assert the exact domain code.
- For every rejection, snapshot after the revocation commits and compare after refusal: orders/status/lines/attempt marks, sales/settlements/tenders, invoice-series next number, fiscal records/outbox, payments, bill payments/refunds, print/drawer jobs and relevant attribution. Assert reader collect/refund-send counts remain zero and no live attempt remains. Compare relevant row contents as well as counts, including an unrelated control order.
- Deterministically obtain valid request identity, commit device/session change, then call the entry point; also cover a write queued behind the revoking transaction using explicit promises, never sleeps. State expected old behavior before each red run; verify failure is the unwanted effect or missing refusal, not a broken fixture/type error.
- Reproduce against current signatures with the existing person-id attribution argument; after observing red, migrate those calls mechanically to the required operator object alongside the interface change. Keep refusal and no-effects assertions intact. Completion/recovery controls may already pass; retain them through the extraction.
- Across all four paths test disabled device and active-but-soft-deleted device → `device.unauthorized`; ended/missing session, wrong person and session belonging to another device → `session.required`. Active device/open matching session must complete with unchanged amounts, attribution and drawer rules.
- Retry matrix: active matching session replays original facts with no duplicate invoice/payment/refund or drawer job; disabled/deleted/ended/mismatched caller is refused even for an already-completed id. Authentication precedes replay; retain existing retry-body behavior after successful authentication.

## Task 1: Counter sale and placed-order collection

- [ ] Add red tests in `till-money.write-session.test.ts` for `recordTillSale` and `collectOrder`: disabled and ended-session races, deletion/mismatch matrix, queued revocation, legitimate request and retries. Old race must issue a sale/invoice or settle the order; post-fix rejection must preserve the snapshots.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/till-money.write-session.test.ts -t 'counter sale|collection'`; retain the expected failure output before implementing.
- [ ] Introduce required operator arguments, share existing cash/collection transaction bodies with the named orchestration helpers, check FIRST in initial and cash conflict-replay transactions, and plumb both ids through `/api/sales` and `/api/working-orders/:id/collect`. Attribute business writes to `operator.personId`.
- [ ] Run the same focused command to PASS with a nonzero test count; run affected cash/collect business and route cases. Preserve all totals, VAT, tender, kitchen, receipt and drawer assertions.
- [ ] Review this task's full diff and findings under the queue's per-task review requirement; fix with red/green checks, then `git commit -s`.

## Task 2: Integrated pay and trusted captured-payment recovery

- [ ] Add red guarded `/api/pay` entry tests to `till-money.write-session.test.ts`: race/mismatch matrix, queued revocation, active legitimate pay and retries. Old disabled/ended case must call the reader once, capture and file; require zero reader calls and unchanged snapshots after the fix, including no walk-up creation or attempt mark.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/till-money.write-session.test.ts -t 'integrated pay'` and retain the expected red output.
- [ ] Extract shared integrated orchestration minimally; guarded preparation calls `assertStillSignedIn` as its first awaited operation in P1, before replay, recovery, zero-due settlement, order creation and reader collection. Wire `/api/pay` with both ids and management recovery to the named lower-level function.
- [ ] Add completion controls starting through the guarded function: pause reader collection after P1, disable/delete the device or end the session, return captured/accepted-offline, and assert P3 still files/settles exactly once without charging again. Cover both new-sale and already-issued-sale completion; do not add a till guard to P3.
- [ ] Extend `payments-api.stuck.test.ts`: a pending attempt becomes captured, then manager recovery files it after original till disable/session end, with no till session supplied, zero collect calls, original origin and unchanged manager attribution. Manager refusal still prevents recovery. Exercise new tests red first before their corresponding edits; reactivation plus guarded retry recovers without another charge.
- [ ] Run both focused suites to PASS; run affected integrated business/route tests without weakening assertions. Preserve live-attempt cleanup and recovery branches; review this task and `git commit -s`.

## Task 3: Bill refund request gate

- [ ] Add red tests in `till-money.write-session.test.ts`: disabled-device cash refund currently completes; assert the new refusal and unchanged snapshots. Cover legitimate cash/card requests, deletion/mismatch, queued revocation and retries. Pin the intentional ended-session entry result as `session.required` before `authorize`.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/till-money.write-session.test.ts`; retain the expected red output.
- [ ] Call `assertStillSignedIn` FIRST inside `refundBillPayment`'s existing initial write transaction, before `authorize` and replay. Keep permission/PIN checks and cash drawer attribution intact; do not guard outcome recording, `resumeCardRefund` or manager/loop recovery with a till session.
- [ ] Add controls: an admitted card refund pauses at its provider, then device/session revocation occurs; completion still records the same refund once. Pending refund recovery still completes after disable via the existing trusted resolver; a new till retry after revocation refuses before sending or resuming.
- [ ] Run the focused suite and affected refund/card/API cases to PASS; review this task and `git commit -s`.

## Task 4: Verification, FULL review, finish and land

- [ ] In a disposable candidate checkout, delete each new path check separately; its race test must fail on the expected unwanted effect. Retain deletion-control receipts and restore that checkout. Legitimate cases must still pass with checks present.
- [ ] Run the shared HTTP race suite and `payments-api.stuck.test.ts`, plus affected existing behavior/route cases. Verify all four HTTP routes reach guarded functions; inventory mechanical helper substitutions separately from changed test checks. No mass assertion rewrites or whole-workspace local run.
- [ ] Run UNEDITED real fiscal gates: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`. Golden huella, filing records, hash chains, invoice allocation and fiscal fixtures remain unchanged; do not replace these checks with fake-backend success.
- [ ] Remove only A475's completed entries from `docs/backlog.md` and `docs/backlog/payments.md`; audit affected prose for stale behavior claims. Record red/green, deletion controls and every changed check with before/after and its authority in the PR.
- [ ] Announce readiness and run `finish-branch` FULL, including its initial rebase and per-task review receipts. Obtain TWO completed Claude whole-branch run-it reviews through `~/workspace/tools/claude-seat.sh review-run`, each in an independent disposable checkout containing the full candidate and installed dependencies. Tell the second reviewer explicitly to test risks and legitimate behavior the checklist does not name. Read completed findings/results, fix findings and rerun focused checks/fiscal gates as needed.
- [ ] Sign off commits, use the normal pre-push hook, verify required coverage/check results belong to the current PR head, and record both review reports. Continue authorized `land-branch` under the campaign landing lock; verify exact-merge CI, update/install main, remove only this managed worktree, verify local/remote branch deletion and post the queue's one-line FYI in local `questions.md`. No approval stop; never create `AGENTS.md`.
