# A692. Keep a sent extra’s “made here” choice

When staff change a sent dish from another till, an extra the kitchen already received still goes to the kitchen. A reissued extra keeps its original sent order number when the dish has moved bills. The [settled answer](../../backlog/till.md#settled-small-small-answers-the-owner-gave-that-are-not-built-yet) applies the owner’s A1416 “Keep what was sent” rule to extras, as recorded by the watcher in desk group B.

## Prove the change at the order edit

1. In `apps/server/src/sent-order-number.test.ts`, update the case in which a moved dish’s Cheese was originally sent to the kitchen and the editing device makes Cheese on the spot. Keep the assertion that Cheese was originally sent and verify that after the edit both items are still kitchen work and carry the original order number. The existing case explicitly expects the opposite for Cheese. Run `pnpm --filter @waitron/server exec vitest run src/sent-order-number.test.ts` and confirm the changed assertion fails because Cheese becomes “made here”.
2. Use the same fixture to check a newly selected Cheese on an edited sent dish. It takes the editing till’s “made here” choice. The original dish keeps its own choice. The kitchen edit already refuses changes when any part is ready, so an existing “made here” extra cannot be edited through that path. Keep that refusal.

## Keep the stored choice when reissuing an extra

3. In `apps/server/src/working-order-line-edits.ts`, record the kept extra’s `madeHere` and station in the existing `keepMadeHere` map before deleting its old ticket item. Key it by its existing line id, as for the dish. This gives newly added extras their usual device-based choice.
4. In `apps/server/src/working-order-kitchen-fire.ts`, pass that map to `insertSplitExtras` through the existing options object and apply the dish’s rule. A saved “made here” choice applies at the saved station, and a saved kitchen choice stays kitchen work. Use the sender’s setting for an extra with no saved choice. Keep the existing station resolution, held and requested handling, and restoration of the sent order number. Extra selection, changes to station routing and the extras picker are outside this slice.
5. Run the full `sent-order-number.test.ts`, `made-here.test.ts`, `made-here.routes.test.ts`, and the existing split-extra edit and print tests. Record the changed check in the PR. Remove the completed A692 entry in `docs/backlog.md` and `docs/backlog/till.md`, keeping the picker entry.

Expected size is about 20 added product lines and 35 added test lines, with a small backlog edit.
