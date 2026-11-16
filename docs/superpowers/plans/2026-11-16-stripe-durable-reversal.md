# Stripe durable reconciler reversal

Draft only: Claude plan review, then watcher clearance precede building. No owner design approval is claimed. Root owns checks and commits.

**Request:** STRIPE-DURABLE-REVERSAL, `/Users/clintongormley/waitron-campaign-f/queue.md:63–64`: “Record the attempt before sending, reuse its key on a retry, and settle an uncertain outcome from Stripe's own record rather than a new refund”.

**Smallest outcome:** an abandoned capture is refunded once; a later public reconciler sweep after process restart records a refund whose reply/local write was lost.

## Approach and boundaries

Reuse the committed `payments.reconcile_remediated_at` claim as the durable attempt reservation, with the payment's existing ID determining `sr_<paymentId>` and refund metadata `reconcile_payment_id`. No new column/table or migration. `reconcile.ts:386–428` already commits the claim before calling reverse; its permanent gate prevents recovery today. Preserve its abandoned/captured/hold/drift gates and concurrent claim assertions.

Reuse `store.ts:731`'s period-independent marked-row read pattern, existing `getPaymentByRef`, `recordRefund`, and `recordFailedRefund`; follow SumUp's recovery-before-audit pattern (`reconciler.ts:112–120`). Keep `payment_refunds` terminal-only. Reuse Stripe's existing `createRefund`/paginated `listRefunds` and metadata support (`stripe-client.ts:87–122`), rather than extending `report-client.ts`. Follow tender refunds' reservation/network/outcome transaction split (`apps/server/src/tender-refund-sends.ts:300–327`).

Leave ordinary terminal/on-device `reverseViaStripe` callers (`provider.ts:630`, `device-provider.ts:125`), bill/tender refunds, SumUp, fiscal hashes/invoices/write paths, UI and generic refund protocols untouched.

## Build, test first by owning layer

For each step, root writes the regression, observes the intended failure, implements minimally, then reruns it.

- [ ] **Payments storage:** modify `packages/payments/src/store.ts` and `index.ts`; test in `store.test.ts`. Add/export `listPendingReconcileReversals(tx, provider)`, returning payment ID/ref, external ref, decimal amount and claim time across all periods. Select claimed abandoned captured payments without sale/hold or terminal refund rows. Assert provider isolation, inclusion outside the audit window, and exclusion after success/failure. Existing claim behavior stays unchanged.
- [ ] **Stripe orchestration:** create `packages/payments-stripe/src/reconcile-reversal.ts`; modify `reconciler.ts`. Narrow the account refund seat to `Pick<StripeClient, "createRefund" | "listRefunds">`. Fresh reversals use the already-committed claim and explicit full captured amount; retain hosted-session resolution. Every sweep first recovers stored attempts independently of its period/report. Match provider evidence by metadata; succeeded records the provider refund ID once, failed/canceled records terminal failure, pending/unknown or unreadable evidence stays unconfirmed. Recheck local terminal state inside the outcome transaction. Lookup precedes retry; never mint another key. Permit same-key resend only within the verified retention window; older uncertainty is lookup-only. Return recovery counts/failures/unconfirmed refs and `resweepAfter` while pending.
- [ ] **Stripe behavior:** extend `reconciler.test.ts` for committed reservation/key at send, same-key retry, pending-to-success, terminal failure, unreadable evidence, and expired-key no-resend. Preserve hosted/terminal, unpaid-session no-send, held/drift assertions. Adapt `stripe-report-client.test.ts` assertions to `createRefundCalls`. Do not repeat SDK failure/pagination matrices already in `stripe-client.test.ts`.
- [ ] **Restart proof:** create `reconciler.restart.test.ts` and `testing/reconcile-reversal-child.ts`. Seed with `useVenueDb`, archive to a disposable venue folder, retain fake provider evidence in the parent, and terminate the child after provider acceptance before local recording. A fresh child runs public `reconcile` for a later period: assert one provider refund and one successful ledger row. Bound children and clean up only owned resources.

## Completion

Root verifies Stripe's authoritative idempotency documentation before adopting the existing 24-hour policy (`provider.ts:77–81`); no unlimited-retention claim or provider calls. Reuse existing scheduler forwarding/enqueue tests. Narrow permanent-marker prose in `reconcile.ts` and `schema/payments.ts`; delete the completed entry and stale W44 references in `docs/backlog.md` and `docs/backlog/payments.md`.

Estimated handwritten lines: production +150–180/−20–35; tests +230–280/−10–20; support +60–80/−0. Generated schema lines: zero. Focused checks belong to root; none run during drafting.

Root's focused commands: `pnpm --filter @waitron/payments exec vitest run src/store.test.ts src/reconcile.concurrency.test.ts`; `pnpm --filter @waitron/payments-stripe exec vitest run src/reconciler.test.ts src/reconciler.restart.test.ts src/stripe-report-client.test.ts src/stripe-client.test.ts`.
