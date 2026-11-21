# A1308 first shared piece — seed a bill venue without the till

The watcher requested this design at 19:56 on 21 November in Lane H’s `questions.md`.
Build the split with the first part of the package move that takes these two suites. That part
also gives the seed a package home and resolves its remaining server imports. The watcher
clears the work. [19 November direction](2026-11-08-a1308-build-order.md#batch-2--area-slices)

## Inventory on main

At `0beeb11be3`, after os13 and pa5, the [os1 selection](2026-11-08-a1308-os1-order-numbers.md#area-files-for-the-package-move)
contains 105 production files (38,590 lines), 146 tests (135,603 lines) and five helpers (1,412 lines).
Production imports 88 distinct server files outside the selection. Tests and helpers bring the
total to 178. Of the selected suites, 67 import `testing/bill-venue.ts`. The TypeScript scan counts
direct relative imports, exports, import types and literal dynamic imports from tracked files.

A source scan for route and fixture helper names left six candidates. Three use only `inTx`;
`order-portions.counter.test.ts` still reaches the till through `serve-line.ts`. The other two
can switch with this split. They passed five tests in 6.21 s. V8 attributed about 9 ms to route
registration in that run. Loading `till-api.ts` with Node and tsx took 102–197 ms in three
processes that preloaded shared dependencies. The split’s elapsed saving in Vitest remains
unmeasured. Lane H kept both measurements and the scan in `receipts/orders-sales-first-shared-piece/`.

## First slice

Add `apps/server/src/testing/bill-venue-seed.ts` with
`seedBillVenue(db: Database, options?: BillVenueSeedOptions): Promise<BillVenueSeed>`.
Keep options `{ apply?: typeof applyVenue; identity?: SoftwareIdentity }`. Move the existing data
fields of `BillVenue` into `BillVenueSeed`, along with the menu, provisioning, device enrolment,
fake provider pool and real sign-in from `testing/bill-venue.ts:68,132,315`. Reuse the same
`useVenueDb` setup, historical provisioning, device profiles and published offers.

Keep `provisionBillVenue` and the route helpers in `testing/bill-venue.ts`. Call the seed and add
`app`, `appAt`, `appWith` and `appTipsOff` through the current mount factory. Keep the
`appDatabases` map and request-body helpers alongside `send`. Declare `BillVenue extends BillVenueSeed`.
Switch `order-preview.test.ts` and `working-order.customer-fallback.test.ts` to the seed and its type.
The seed uses the server’s join, session and menu setup. Keep the seed’s imports clear of
`bill-venue`, `serve-line`, `cancel-line`, `order-writer-fixture` and `grouped-counter-order`.
The order helpers reach the HTTP sender through `testing/cancel-line.ts:22`.

## Acceptance for the future build

1. In both direct suites, make a hoisted `vi.mock("./till-api.js", …)` throw
   `Error("till must not load")` if the suite loads the route module. Observe both failures
   before extraction. Keep both guards and the existing query, item, fiscal and receipt assertions.
2. Run `receipt-device-evidence.test.ts`, `till-api.disk-full-gate.test.ts` and
   `bill-payments.card.test.ts` for invoice evidence and the fixture’s disk and tip settings. Use
   `pnpm --filter @waitron/server exec vitest run src/<file>` for each named server test,
   `pnpm --filter @waitron/server typecheck`, and `pnpm exec vitest run scripts/workspace-cycles.test.ts`.
3. Keep the queue gates unedited and run them in their packages. These are
   `write-path.e2e.test.ts`, `inmutabilidad.test.ts`, `till-api.sell-published.test.ts`
   (Review Focus 1/2), and `till-app-menu-refresh.test.ts`.

## Expected protection-list difference

Expect `EQUAL` across both compositions, all phases and both databases. Run the before and after
comparison in the [slice rules](2026-11-08-a1308-slice-rules.md#3-the-protection-list-predicted-then-checked).
Budget three hours. Production is 0 lines, test support +270/−230 (165 moved menu and body lines,
plus fields and imports), tests +20/−10. The lane finishes and lands after review, the normal push
hook and current-head CI. [Earlier package decision](2026-11-17-a1308-orders-sales-package-move.md)
