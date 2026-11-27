# Split Server bill payments by job

Lane H’s `SPLIT-SERVER-FILES` asks “**Remaining file:** `apps/server/src/bill-payments.ts`. Write a
one-page plan for this file.” The owner wants “these enormous files should be broken down into
smaller bites” and “a typical rule is no more than 1000 lines”. Ship the whole split in one PR.
Cloud has its own plan. Before building, get the Lane H plan review and watcher clearance,
recheck the earlier `OVERPAID-BILLS` hold with the watcher (the item is still in `docs/backlog.md`),
and check this map again on the resulting main.

## Declaration map

Ranges are in `apps/server/src/bill-payments.ts` at `5cc7bf033a`. Take every declaration starting in each range, with its comments and overloads. Estimates include room for imports.

| File under `apps/server/src/` | Job and source lines | Lines |
| --- | --- | ---: |
| `bill-payment-rows.ts` | Read payments, refunds and money held, check excess, link cards to invoices. 320–674, 739–777, 794–833, 1326–1335. | ~520 |
| `bill-balance.ts` | Build the bill balance and payment/refund views. 233–298, 676–732, 781–791, 839–959, 2708–2713. | ~325 |
| `bill-payment-types.ts` | Shared payment requests, dependencies and results. 173–232, 300–314. | ~85 |
| `bill-payment-settlement.ts` | Issue advances and invoices, record or fail payment, return items after a failed charge. 966–1319, 2121–2411. | ~750 |
| `bill-payment-failures.ts` | Classify clock and charged-but-unrecorded failures. 2027–2095. | ~90 |
| `bill-payments.ts` | Prepare and replay payments, take cash and hand-keyed cards, close zero bills. 316–318, 1337–2015. | ~780 |
| `bill-reader-payment.ts` | Track live reader payments, reserve, collect and finish. 2019–2024, 2098–2118, 2414–2705. | ~370 |

The declaration check gives 74–685 lines per file before imports. Keep every function whole,
including `issueOrSettleWhenFullyPaid` (1072–1272). Reuse `bill-payment-money`, `bill-advances`,
`bill-payment-fingerprint` and `payment-slip-print`. `working-order-invoice` and `advance-taken-off`
import card links and issued-bill money from rows. `close-of-day` imports clock refusal from
failures. Check for cycles among the pieces, including type imports. Record the existing round
trip through `bill-advances`, `receipt-guests` and `parties` that returns to the rows file.

## Move and verify

- Run `node scripts/move-ts-declarations.mjs scripts/bill-payments-split.json` with
  `apps/server/tsconfig.json`, following `scripts/working-order-split.json`. Verify identical
  bodies and comments and the same signatures after formatting. Preserve transaction boundaries,
  fiscal code, schema, contracts and assertions. Fix type markers and `./errors.js` imports.
  Replace the `retryShapeOf` re-export with a direct import at its caller. Repoint the dynamic
  import in `bill-refunds.card.test.ts` and audit mocks and spies. `boot.disk-full-wiring.test.ts`
  and `handover-stepdown.real.test.ts` mock the API and loop respectively. Move the `movedItemsBack`
  savepoint allowance to settlement in `scripts/no-bare-transaction.test.ts`. Remove the old cap
  from `scripts/product-file-size-limits.json` and run `scripts/product-file-size.test.ts` with
  new files staged.
- Move the five whole test groups at lines 591–873 of `bill-payments.test.ts`. The groups at 743
  and 783 go to `bill-payment-settlement.test.ts`, the other three to `bill-payment-rows.test.ts`.
  Move the setup from `afterEach` through `take` (except `tillInvoicePrinter`) and `codeOf` through
  `insertPayment` to `testing/bill-payments.test-support.ts`. Keep one `useVenueDb` and the timer
  hook per suite, and keep receipt and full-payment integration cases in place. Give only the shared
  fixture a counted English guard entry in `packages/db/src/english-only.ts` for its moved literals.
  Compare discovered names and assertion text. Budget ~1,850 product lines moved plus ~250–400
  import lines, ~280 test and ~250 setup lines moved plus test import edits, and ~160–200 map lines.
  Use the existing mover as shipped.
- The #4238 rehearsal moved `working-order` declarations. Replay the bill-payment map on #4423’s
  parent `76f6a98c8b` and tip `c4b842bd3d` in disposable checkouts, matching names to each revision.
  Apply the moved-tree delta and verify the edited `readBillBalance` and `movedItemsBack` bodies
  against the tip. Typecheck and run `pay-for-items.sent.test.ts`. Recheck open branches before the
  PR and name any overlap. [Replay procedure](2026-11-24-working-order-file-split.md#carry-an-open-branch-across-the-split)
- Run Server typecheck, the changed guards and suites, `bill-payments*.test.ts`,
  `counter-bill-payments.test.ts`, `pay-for-items*.test.ts`, `card-charged-not-recorded.test.ts`,
  `close-of-day.test.ts`, `clock-unconfirmed-gate.test.ts` and `till-api.fiscal-sale-paths.test.ts`.
  Run the unchanged menu checks `till-api.sell-published.test.ts` (Server) and
  `till-app-menu-refresh.test.ts` (Till), and fiscal `write-path.e2e.test.ts` (golden huella) and
  `inmutabilidad.test.ts` in `@waitron/fiscal-verifactu`. Require current-head CI.
