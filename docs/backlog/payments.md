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
