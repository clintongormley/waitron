# Split the working-order server file

Once this lands, a developer can go straight to the file named for the order operation they need to change. The 24 November Lane H queue assigns `working-order.ts` first and requires one repeatable move that other lanes can run on their own branches. Keep this split inside `apps/server/src/`. The script is shared by H, D and K. The other server files each get their own plan.

## Move in dependency order

| Files under `apps/server/src/` | Declarations that belong together |
| --- | --- |
| `working-order-context.ts`, `order-line-quantities.ts` | Order dependencies, attendance, revision and open checks. Shared line totals and extras quantities. |
| `stored-order-lines.ts`, `working-order-serving.ts` | Stored and bill line readers. Released and served dish state and writes. |
| `working-order-kitchen-fire.ts`, `working-order-late-send.ts`, `working-order-pricing.ts` | Station routing and ticket creation. Late-dish checks. Basket offers, modifiers and line pricing. |
| `working-order-open.ts`, `working-order-kitchen-service.ts`, `working-order-removal.ts` | Open and park orders and add rounds. Request, release, advance tickets and set courses. Remove, reduce and correct dishes. |
| `working-order-transfer.ts`, `working-order-edit-state.ts`, `working-order-line-edits.ts`, `working-order-held-write.ts` | Move and split existing lines. Read editable state and guard edits during payment. Apply line edits. Save and abandon held orders. |
| `working-order-invoice.ts`, `working-order-counter.ts`, `working-order-held-read.ts` | Invoice choice, language, pricing and issuance. Place, cancel, collect and hand over counter orders. Held and placed basket reads. |
| `working-order-station-queue.ts`, `working-order-pass.ts`, `working-order-table-state.ts` | Station queues and their shared read shapes. Pass rows and group-station lookup. Seated and occupied table reads. |

Move independent declarations before their callers. Use the actual imports to settle the order, and check for direct cycles and for paths back through `order-groups.ts`, `kitchen-print.ts`, `bill-payments.ts` and `till-sale.ts`. Put shared declarations such as the pass group lookup below both callers if the graph requires it. Move overloads and their implementation together. `applyLineEdits` spans 1,013 lines even before imports. Ask the watcher to clear a 1,250-line cap for its new file and remove the old cap in `scripts/product-file-size-limits.json`. Move its body whole.

## Script and proof

- Start `scripts/move-ts-declarations.test.mjs` with a failing move of a named function whose consumer uses an aliased import. Assert the body bytes, updated import and removal of the old declaration. Add a refusal case for a missing name that leaves the files intact. Implement `scripts/move-ts-declarations.mjs` using the installed TypeScript `Move to file` operation to find edits. Carry the original body text across and compare it before writing. The map lives in `scripts/working-order-split.json`. Remove `working-order.ts`, route re-exported imports straight to their defining modules and update named guards and live documentation pointers at their new homes.
- On open PR #4238 at `658c747d12ae413c611d860c6fc8a5f91f7a0aec`, an in-memory TypeScript 6.0.3 move found `carveLines` but changed its body from 10,846 to 10,631 bytes. Before opening the split PR, run the finished script in disposable copies at that branch's fork point and tip, then apply the resulting branch diff to the split base. Check that the branch's edited `carveLines` and `applyLineEdits` bodies came across exactly. List overlapping open branches in the PR and tell D and K where the shared script lives when it is committed.
- Move the 301 cases discovered from `working-order.test.ts` by their existing subject groups to matching `working-order-*.test.ts` files. Keep their original assertions, names and hooks. Share existing fixture inputs through `working-order.test-support.ts` where needed. Compare discovered names and assertion text and run every moved suite plus `till-api.sell-published.test.ts`, Till's `till-app-menu-refresh.test.ts`, fiscal `write-path.e2e.test.ts` and `inmutabilidad.test.ts`. Run the file-size and affected root guards and Server typecheck. Check the new test paths in CI's duration packing.

One product split PR is the target. If two are needed, land the shared tool first and the complete split in the second PR the same day. Allow about 9,800 product and 11,900 test lines moved, up to 600 new code or import lines and up to 150 new test or test-support lines, with moves counted separately. The test changes preserve what the existing cases prove. Fiscal builders, database schema, route behaviour and new order or sale features are outside this split.
