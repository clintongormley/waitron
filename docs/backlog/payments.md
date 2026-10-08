# Payments and card readers — detail

The open entries are listed in [the backlog](../backlog.md), under "Payments and card readers". This file holds
their full text.

## The two `provider.test.ts` cases named "throws payment.not_found" assert only `rejects.toThrow()`, not the code

- `packages/payments-stripe`, found by #570 and not changed (each a code or config change, not a
  comment): the two `provider.test.ts` cases named "throws payment.not_found" assert only
  `rejects.toThrow()`, not the code (CLAUDE.md §4); `tenant-scoping.test.ts` is named for tenant
  scoping but now guards that no source file opens a bare `.transaction(`; and `vitest.config.ts`
  leaves `src/stripe-client.ts` out of coverage although #570's review made that wrapper throw and
  two tests in the normal suite failed, so the normal run does reach it — CLAUDE.md §2 says a gap
  is never closed by an exclude over code a test could reach. Reversal retry-safety (one persisted
  id per reversal) is still deferred: #570's review showed two identical `reverseViaStripe` calls
  get different idempotency keys, so a retried reversal sends a second real refund; the comment
  at `reverse.ts` says so.

## The Stripe webhook endpoint still has to be repointed by hand, at Stripe

**Names left behind by the tenant-column removal (#378, 2026-09-16):**

- **The Stripe webhook endpoint still has to be repointed by hand, at Stripe.** #378 shortened the
  address from `/webhooks/stripe/<an id>` to `/webhooks/stripe`; the endpoint registered in the
  Stripe dashboard is outside this repository and will keep sending to the old one until somebody
  changes it there. **Next action:** change it in the Stripe dashboard before any card payment is
  taken through a Stripe webhook.
