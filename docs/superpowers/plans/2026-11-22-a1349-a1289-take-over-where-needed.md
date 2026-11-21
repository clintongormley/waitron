# Take over unsent orders during joins and moves

**Finish line.** Join a table, Move guests, Move this bill and Move dishes show the bills holding
up the action. Staff can take over the named unsent orders one at a time, then review and retry.
This includes Join with and drag-to-join on the floor and Move to table from Held orders on the
counter. Move dishes keeps the selected dishes and destination for review. The watcher assigned
A1349/A1289 at 00:42 on 22 November 2026 in the Lane H queue.
[A773 §6](../specs/2026-10-17-a773-one-editor-design.md#6-joinmove-conflicts-and-the-floor)
documents the existing ownership rule; git records the design decision in `fed95a2faa`.

**Reuse the refusal and takeover.** Read the client's flattened `draft.taken_over` conflicts in
`apps/till/src/state/bill-edit-conflicts.ts`. Keep source and destination groups from the draft
reads before sorting the combined observations for the action. Label rows using current bill
labels or the floor party's unsent bill numbers and table names. A missing number uses the
existing unnumbered bill label and its table. Extract the holder row from
`widgets/split-picker.ts` for both callers. In `widgets/bill-edit-conflicts-dialog.ts`, use
one `wt-dialog` for the list and confirmation step. Reuse the Take over copy, offer Cancel, and
show a refused takeover in the dialog. A row whose draft or revision is missing asks for review.

Confirming sends only the chosen row. For the open bill, use `DraftSync.takeOver` so it keeps
local edits. For another bill in the same party, use `takeOverOn`. Check that the observed edit
still identifies the row before sending. For the other party or the floor, call the existing
`takeOverDraft` with the row's party and refused edit. A changed draft uses the existing refusal
and requires another review. Closing the panel, leaving the visit or changing sign-in retires it.

**Return to the action.** In `till-app.ts` and the table order screen, handle conflicts before
ordinary recovery. Restore Move dishes picks and destination against the latest eligible rows.
For a floor join, Review prepares the original drop again from the current floor and opens the
seats prompt if needed. A join without a seats prompt still needs a new press. In the counter's
held-order move, handle conflicts from both the allergy preview and the move write. Reopen the
target choice for review and run the current draft and allergy checks on a fresh press. The
party-scoped endpoint can take over destination drafts. If the refusal names the counter bill
itself, explain the limit and let staff choose another table or stop. Each retry uses fresh
observations. Merge bills, server changes and a new counter takeover endpoint are outside
this item. A1289 refers to Move dishes.

**Proposed words for the watcher** in `apps/till/src/i18n/strings.ts`.

| Where | English | Spanish |
| --- | --- | --- |
| Join or whole move | Unsent orders are holding up this change. Take over the orders below, then review the change. | Hay pedidos sin enviar que impiden el cambio. Toma los pedidos de abajo y luego revisa el cambio. |
| Move dishes | The dishes haven't moved. Take over the orders below, then review the move. | Los platos siguen en su cuenta. Toma los pedidos de abajo y luego revisa el traslado. |
| Counter bill without a party | This counter order has unsent dishes you can't take over here. Choose another table or leave the order where it is. | Este pedido de barra tiene platos sin enviar que no puedes tomar aquí. Elige otra mesa o deja el pedido donde está. |

**Checks and size.** Test first. In `src/till-app-parties.test.ts` cover the three table actions
and check the off-screen bill goes to its own party. In `src/till-app-move-dishes.test.ts` show
the chosen dishes and destination survive the refusal, Cancel sends no takeover, and a new
press uses fresh edits. In `src/screens/till-floor-screen.today-joins.test.ts` check the join
waits for a new press. In `src/till-app-allergy.move.test.ts` check the counter's preview and
write refusals and the message for a counter bill without a party. Keep the split-picker and
server ownership tests. Open the refusal in EN/ES, light and dark, at phone and desktop widths.
Update both till guides and remove both backlog entries, their detail and stale A803 links from
`docs/backlog.md` and `docs/backlog/till.md`. Expect about 470 production lines and 320 test lines.
