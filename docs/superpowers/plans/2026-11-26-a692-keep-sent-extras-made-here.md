# A692. Keep a sent extra’s “made here” choice

When staff change a sent dish from another till, an extra the kitchen already received still goes to the kitchen. A reissued extra keeps its original sent order number when the dish has moved bills. The [settled answer](../../backlog/till.md#decisions-and-deliberate-limits) records the watcher extending the owner’s A1416 “Keep what was sent” answer about options to this extras case.

## Prove the change at the order edit

1. In `apps/server/src/sent-order-number.test.ts`, change the check for a moved dish whose Cheese was originally sent to the kitchen and whose editing till makes Cheese on the spot. Keep the assertion that Cheese was originally sent. Check that after the edit both items are still kitchen work and carry the original order number. On the current code the Cheese changes to “made here” and loses that number.
2. Pin today’s behaviour for a newly selected Cheese using the same fixture. It takes the editing till’s “made here” choice while the dish keeps its own. Keep the existing refusal for editing a dish with a ready part, which includes extras already made here (`firedWork` and `isStarted`).

## Keep the stored kitchen choice when reissuing an extra

3. In `apps/server/src/working-order-line-edits.ts`, put the kept extra’s ticket choice in the existing `keepMadeHere` map before deleting its ticket item in the `change` path. Key it by its existing line id, as for the dish.
4. In `apps/server/src/working-order-kitchen-fire.ts`, move `keepMadeHere` into the shared options type currently called `KeptPhase`. `fireLines` already passes its options as the last argument of `insertSplitExtras`. When the map records `madeHere: false` for an extra, reissue it as kitchen work. For new extras, use the existing device setting. The existing ready-item refusal handles extras previously made here. Keep station resolution, hold and request handling, and the existing order-number restoration. Additional portions and the picker are outside this slice. The copied extras on those additional portions are new work.
5. Run `sent-order-number.test.ts`, `split-off-extras.edit.test.ts`, `kitchen-request.edit.test.ts`, `made-here.test.ts`, and `made-here.routes.test.ts` in `@waitron/server`. These cover bill numbers, station slips, request timing, and made-here responses. Record the changed check in the PR. Remove the completed A692 bullet from `docs/backlog/till.md` and shorten the combined entry in `docs/backlog.md` to the picker.

Expected size is about 15 added product lines and 25 added test lines, plus the backlog edit.
