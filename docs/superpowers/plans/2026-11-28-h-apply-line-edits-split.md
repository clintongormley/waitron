# Split Server line edits into named steps

Lane H's `APPLY-LINE-EDITS` item asks for a smaller `applyLineEdits` with the same caller
signature, behaviour and test assertions. At `5c888f08c8`, the file is 1,213 lines. After
this PR, developers can find how the Server validates and prices edits in its own file, and
follow the edits, kitchen corrections and bill checks in a file under the standard 1,000-line
limit. This is a TypeScript refactor of the existing Server transaction. Order and bill rules,
routes, database schema, VAT and fiscal records are outside its scope.

## One PR

- [ ] In `scripts/product-file-size-limits.json`, remove the exception for
  `apps/server/src/working-order-line-edits.ts`. Run
  `pnpm exec vitest run scripts/product-file-size.test.ts` and see it refuse that file at
  1,213 lines against the 1,000-line limit on the starting tree.
- [ ] In `apps/server/src/working-order-line-edit-pricing.ts`, extract `prepareLineEdits` from
  `readStationChanges` through `priceOrderLines`. Pass the existing transaction, trading config,
  order id, order, edit plan, zone id, routing snapshot and confirmations. Move the existing
  inline `LineEditPlan` parameter shape and the shape of one prepared edit here as named types.
  Return `changes`, `priced`, `pricedAs`, `extrasChangedIds` and `chargesUnchanged`.
  Reuse the reads and pricing helpers already called by the block. Keep the shared offer read,
  priority of kitchen refusals and the order of requests passed to pricing. Leave the two callers in
  `working-order-held-write.ts` and the parameter and return types they use intact.
- [ ] In `working-order-line-edits.ts`, call `prepareLineEdits` after the existing bill totals,
  routing and order-context reads. Extract the block from `planHeldCorrections` through
  `reduceLine` into a local `correctKitchenBeforeLineEdits`, returning `held` for the later
  additions. Keep group creation before it. The correction slips read the old rows, and the
  later additions read the edited rows. Preserve the existing await order, line numbering,
  kitchen dispatch, discount ending, regrouping, excess-payment check and final bill limit.
  Add the pricing file to the existing order-path list in `scripts/menu-engine-neutral.test.ts`.
- [ ] Stage the new product file and run the file-size and engine-neutral guards. Compare the
  moved statements and call order to the base, check the two files for an import cycle, and run
  `pnpm --filter @waitron/server typecheck`. Keep comparison receipts in the PR. On any overlap,
  map changes in the original pricing block to the new file and replay other edits at their
  original call sites. VAT-RATES B5 and A1621 may touch this path.
- [ ] Run unchanged Server suites with `pnpm --filter @waitron/server exec vitest run`, naming
  `src/working-order-held-write.test.ts`, `src/working-order.test.ts`,
  `src/working-order.late-send.test.ts`, `src/changes-after-sending.test.ts`,
  `src/dish-discount-ending.test.ts`, `src/set-menu-edits.test.ts`,
  `src/set-menu-regroup-paths.test.ts`, `src/order-group-edits.test.ts`,
  `src/kitchen-request.hold-paper.test.ts` and `src/order-portions.adjustments.test.ts`.
  They cover stored and new prices, kitchen refusals and paper, portion copies, discount ending
  and excess payment after regrouping. Run the queue's unchanged Server and Till menu gates
  (`till-api.sell-published`, `till-app-menu-refresh`) and the VeriFactu `write-path.e2e` and
  `inmutabilidad` suites. Keep every existing assertion. Sign off and run both Claude branch
  reviews, the normal push hook and the selected checks on the exact PR head.

Budget about 510 moved product lines and 40–65 lines of imports, calls and helper signatures.
The existing guard gains one path. Behavioural tests change by zero lines. One pull request
fits the three-hour build window.
