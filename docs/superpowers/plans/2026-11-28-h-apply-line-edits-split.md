# Split Server line edits into named steps

Lane H's `APPLY-LINE-EDITS` item asks for a smaller `applyLineEdits` with the same caller
signature, behaviour and test assertions. At `5c888f08c8`, the file is 1,213 lines. After
this PR, developers can find how the Server validates and prices edits in its own file, and
follow the edits, kitchen corrections and bill checks in a file under the standard 1,000-line
limit. This is a TypeScript refactor of the existing Server transaction. Order and bill rules,
routes, database schema, VAT and fiscal records are outside its scope. The watcher wrote in
Lane H’s questions at 02:00 on 28 November 2026, “yes, unblocked; plan the split on current main.”

The write loop and inserts (about 480 lines, originally lines 736–1213) stay inside
`applyLineEdits`, which ends up at about 540 lines. They share about 15 working lists and
lookups declared together in the original function (lines 737–765).

## One PR

- [ ] In `scripts/product-file-size-limits.json`, remove the exception for
  `apps/server/src/working-order-line-edits.ts`. Run
  `pnpm exec vitest run scripts/product-file-size.test.ts` and see it refuse that file at
  1,213 lines against the 1,000-line limit on the starting tree.
- [ ] In `apps/server/src/working-order-line-edit-plan.ts`, extract `prepareLineEdits` from
  `readStationChanges` through `priceOrderLines`. Pass the existing transaction, trading config,
  order id, order, edit plan, zone id, routing snapshot and confirmations. Move the existing
  inline `LineEditPlan` parameter shape and the shape of one prepared edit here as named types.
  Return `changes`, `priced`, `pricedAs`, `extrasChangedIds` and `chargesUnchanged`. Import
  `./errors.js` in the new throwing file.
  Reuse the reads and pricing helpers already called by the block. Keep the shared offer read,
  priority of kitchen refusals and the order of requests passed to pricing. Leave the two callers in
  `working-order-held-write.ts` and the parameter and return types they use intact.
- [ ] In `working-order-line-edits.ts`, call `prepareLineEdits` after the existing bill totals,
  routing and order-context reads. Extract the block from `planHeldCorrections` through
  `reduceLine` into an unexported top-level `correctKitchenBeforeLineEdits(tx, cfg, orderId,
  changes, removed)`. Return `held` for the later additions. Keep group creation before this
  call. The correction slips read the old rows, and later additions read the edited rows.
  Preserve the existing await order, line numbering,
  kitchen dispatch, discount ending, regrouping, excess-payment check and final bill limit.
  Add the new file to the existing order-path list in `scripts/menu-engine-neutral.test.ts`.
- [ ] Stage the new product file and run the file-size and engine-neutral guards. Compare the
  moved bodies with `git diff --color-moved=zebra --color-moved-ws=allow-indentation-change <base>..HEAD`.
  Check that the only new lines are the new signatures, return values, calls, types and imports.
  Put the output in the PR and check the original call order. Check for an import cycle between the
  pieces and run `pnpm --filter @waitron/server typecheck`. Keep the receipts in the PR. Record
  where A1621 PR 5 can find `addedApart` and the rest of the pricing block. On overlap, replay
  changes to those statements in the new file and other edits at their original call sites.
- [ ] Run unchanged Server suites with `pnpm --filter @waitron/server exec vitest run`, naming
  `src/working-order-held-write.test.ts`, `src/working-order.test.ts`,
  `src/working-order.late-send.test.ts`, `src/changes-after-sending.test.ts`,
  `src/dish-discount-ending.test.ts`, `src/set-menu-edits.test.ts`,
  `src/set-menu-regroup-paths.test.ts`, `src/order-group-edits.test.ts`,
  `src/kitchen-request.hold-paper.test.ts`, `src/order-portions.adjustments.test.ts`,
  `src/working-order-removal.test.ts`, `src/sent-dish-change.test.ts`,
  `src/kitchen-request.edit.test.ts`, `src/kitchen-request.extras.test.ts`,
  `src/split-off-extras.edit.test.ts`, `src/kitchen-allergy.capture.test.ts`, `src/tabs.test.ts`,
  `src/till-sale.test.ts`, `src/working-order-pricing.test.ts`,
  `src/set-menu-discount-cancel.test.ts` and `src/adjustments-apply.test.ts`. These pin the edit
  routes and their prices, refusals, slips, kitchen state, portions and discount effects.
- [ ] Run the unchanged Server and Till menu gates (`till-api.sell-published`,
  `till-app-menu-refresh`) and the VeriFactu `write-path.e2e` and `inmutabilidad` suites. Keep
  every existing assertion. Sign off and run Codex's `finish-branch` for Lane H with two Claude
  run-it reviews side by side because this code handles money. Run the normal push hook and
  check the selected Server jobs on the exact PR head.

Budget about 450 product lines moved to the new file, 65 moved within the original file and
40–65 lines of imports and wiring. The existing guard gains one path. Behavioural tests change
by zero lines. One pull request fits the three-hour build window.
