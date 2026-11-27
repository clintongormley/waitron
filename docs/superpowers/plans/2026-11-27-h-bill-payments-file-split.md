# Split Server bill payments by job

Give each payment job a file under 1,000 lines in one PR. Lane H’s `SPLIT-SERVER-FILES`
assigns `bill-payments.ts` under the owner’s 24 November file-size request. Keep the pieces in
Server with their existing dependencies. Cloud has a separate plan. The watcher cleared this
build at 23:15 on 27 November and removed the wait for `OVERPAID-BILLS`. If work overlaps, the
branch landing second carries its edits across with the same mover.

## Declaration map

Each range is in `apps/server/src/bill-payments.ts` at `5cc7bf033a`. Move whole declarations with their comments and overloads. The estimates include imports.

| File under `apps/server/src/` | Job and source lines | Lines |
| --- | --- | ---: |
| `bill-payment-rows.ts` | Read payment and refund rows, guard held money, link cards to invoices. 320–674, 739–777, 794–833, 1326–1335. | ~520 |
| `bill-balance.ts` | Build balances and payment/refund views. 233–298, 676–732, 781–791, 839–959, 2708–2713. | ~325 |
| `bill-payment-types.ts` | Shared requests, dependencies and results. 173–232, 300–314. | ~85 |
| `bill-payment-settlement.ts` | Issue advances and invoices, record or fail payments, return dishes after a failed charge. 966–1319, 2121–2411. | ~750 |
| `bill-payment-failures.ts` | Classify clock and recording failures. 2027–2095. | ~90 |
| `bill-payments.ts` | Prepare and replay payments, take cash and hand-keyed cards, close zero bills. 316–318, 1337–2015. | ~780 |
| `bill-reader-payment.ts` | Track, reserve, collect and finish live reader payments. 2019–2024, 2098–2118, 2414–2705. | ~370 |

Reuse `bill-payment-money`, `bill-advances`, `bill-payment-fingerprint` and `payment-slip-print`.
`issueOrSettleWhenFullyPaid` (1072–1272) and its transaction boundaries move whole. Keep fiscal
code, schema, public signatures, behavior and assertions as they are.

Keep failures in Server because their only callers are these payment paths and the classifier
uses Server’s logger type. Keep the `bill-payment-rows` name for the stored rows and their
checks and links. `bill-payment-money` keeps the arithmetic.

## Move and verify

- Run `node scripts/move-ts-declarations.mjs scripts/bill-payments-split.json` with the Server
  tsconfig and the `scripts/working-order-split.json` pattern. Repoint imports, including
  `retryShapeOf` to its definition and the dynamic import in `bill-refunds.card.test.ts`.
  Remove `testing/bill-payment-fixture.ts`’s wildcard re-export. Keep its own wrappers and
  import `closeZeroBill` and `getBillBalance` directly in the five fixture consumers that
  use the forwarded names. Keep `bill-payments.test.ts` together because it tests payment
  flows across pieces. Scan mocks, update live source pointers in Till and the data guide,
  fix type imports and add `./errors.js` at throwing sites. List newly exported helpers in the PR.
- After all edits, use a one-off TypeScript parse of the base and final files to compare every
  declaration’s body bytes and signature tokens, allowing export modifiers. Walk relative
  imports, including type imports, and reject cycles among the seven pieces. Put both one-off
  check results in the PR body. Record the existing
  path from rows through `bill-advances`, `receipt-guests` and `parties` back to rows. Move the
  `movedItemsBack` savepoint entry in `scripts/no-bare-transaction.test.ts` and remove the old
  cap in `scripts/product-file-size-limits.json`. Run both guards with new files staged. Budget
  ~1,850 product lines moved, ~250–400 import lines, ~160–200 map lines, and test import edits
  with zero moved test bodies or new test cases. Estimate about 100 files and one PR within
  three hours of the build starting.
- The existing mover preserved the edited bodies of `readBillBalance` and `movedItemsBack`
  byte for byte from #4423’s original fork `c2f1ded67e0` and PR head `a38ed89723` into their
  proposed files. At PR time, if an open branch touches the file, run the map on it once and
  report the result. Otherwise cite Lane H’s `receipts/bill-payments-split-plan/replay.log` for
  those two bodies. [Replay steps](2026-11-24-working-order-file-split.md#carry-an-open-branch-across-the-split)
  After running the mover, carry the branch’s edits onto the landed split, keeping main’s
  direct imports and guard paths. Check the five error registry imports, `Logger` from
  `./logger.js`, the type-only imports, fixture and dynamic imports, and removed forwarding
  exports against main. Use the landed source pointers and run the overlapping tests.
- Run Server typecheck, the changed guards and suites, `bill-payments*.test.ts`,
  `counter-bill-payments.test.ts`, `pay-for-items*.test.ts`, `card-charged-not-recorded.test.ts`,
  `close-of-day.test.ts`, `clock-unconfirmed-gate.test.ts` and `till-api.fiscal-sale-paths.test.ts`.
  Run the unchanged `till-api.sell-published.test.ts`, `till-app-menu-refresh.test.ts`, fiscal
  `write-path.e2e.test.ts` and `inmutabilidad.test.ts`. Require current-head CI.
