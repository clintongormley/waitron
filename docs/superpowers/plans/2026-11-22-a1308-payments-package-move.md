# A1308 payments and adjustments package move

The shared work remains unsized on `eecedba3c158edb5d36e5fe7b0ada058c179536e`. Stop at this
assessment under the watcher's 22 November 19:43 direction. The watcher's 19:32 note assigns
env3 to lane F and ends its wait on the payments-area slices after pa5 landed in #3975.
[Build order](2026-11-08-a1308-build-order.md#batch-2--area-slices)

## Candidate files and their dependencies

Reuse `@waitron/payments` for provider-neutral code, `@waitron/payments-stripe` for Stripe code
and `@waitron/adjustments` for adjustment rules and records. The server keeps HTTP registration,
middleware order and whole-app tests. Generic HTTP helpers and the `Logger` type already live in
`@waitron/server-kit`. [Payments](../../../packages/payments/package.json) ·
[Stripe](../../../packages/payments-stripe/package.json) ·
[Adjustments](../../../packages/adjustments/src/index.ts) ·
[Server kit](../../../packages/server-kit/src/index.ts)

- `payments-api.ts` and `card-reader-delete.ts` are candidates once their shared dependencies
  have a home. The payments routes join bill payments, refunds, printing and device equipment.
  `reconcile-duty.ts` stays with the server, which owns the reconciliation schedule and applies
  trading admission and refund rules.
  [Payments imports](../../../apps/server/src/payments-api.ts#L104) ·
  [Reconciliation imports](../../../apps/server/src/reconcile-duty.ts#L1)
- `adjustments-api.ts` and `till-api.ts` import each other. `adjustments-apply.ts` uses bill and
  kitchen rules, and `receipt-adjustments.ts` serves bill payments, till sales and invoice and
  receipt readers. The adjustment and payment-zone fixtures mount the till or use its bill fixture.
  Which order and device operations these packages can call, and which test fixtures can move,
  are still open. The watcher kept the bill-fixture split with the orders-and-sales move on
  21 November at 20:11. [Adjustment routes](../../../apps/server/src/adjustments-api.ts#L24) ·
  [Bill fixture design](https://github.com/clintongormley/waitron/blob/f8d93fd328/docs/superpowers/plans/2026-11-21-a1308-orders-sales-first-shared-piece.md)

## Size and the smaller option

`git ls-files` and `wc -l` counted **8 production files / 4,743 lines, 29 tests / 24,540 lines
and 2 helpers / 977 lines** in pa1's surviving named files, including suites that stay in the
server. #3952 retired the old pending-card recovery source and whole-payment fixture. The
pending-card loop test now exercises bill recovery. #2879 retired
`draft-recall-adjustments.test.ts` when Cancel item took over sent-dish removal. The shared code
and fixture changes still need sizing.
[Pa1 inventory](https://github.com/clintongormley/waitron/blob/f8d93fd328/docs/superpowers/plans/2026-11-08-a1308-pa1-card-follow-ups.md#area-files-for-the-package-move) ·
[Bill recovery suite](../../../apps/server/src/pending-card-loop.test.ts#L2)

`stripe-account.ts` (93 lines) still uses the server's credential reader and errors.
`card-provider-pool.ts` (56 lines) could use the deployment type from `@waitron/db`. Its real-provider
tests would stay in the server because Stripe and SumUp both depend on payments. The two existing
suites passed 17 cases in 1.08 seconds at today's paths. The original build order modelled about
140 seconds per pull request for the whole area. Defer the provider-only move as well. There is
no measured standalone CI benefit.
[Stripe account](../../../apps/server/src/stripe-account.ts#L5) ·
[Provider pool test](../../../apps/server/src/card-provider-pool.test.ts#L9)

A future slice needs its own size estimate, preserved assertions and independent coverage
qualification. [Slice rules](2026-11-08-a1308-slice-rules.md)
