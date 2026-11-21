# Take over unsent orders during joins and moves

**Finish line.** From Join a table, Move guests, Move this bill or Move dishes, staff can see which
bills blocked the change, take over the named unsent orders one at a time, and review and retry the
original action. The floor's Join with and drag-to-join use the same rows. For Move dishes, keep the
selected dishes and destination available for review. The watcher assigned A1349/A1289 on 22 November
2026 at 00:42 in Lane H's queue. [A773 §6](../specs/2026-10-17-a773-one-editor-design.md#6-joinmove-conflicts-and-the-floor)
sets the ownership rule.

**Reuse the refusal and takeover.** In `apps/till/src/state/bill-edit-conflicts.ts`, read the
client's flattened `draft.taken_over` conflicts with a draft id and revision. Pair each bill with
the source or destination party from the observations sent with the action. Use known bill labels and
table names to distinguish two Bill 1s. Extract the holder row from `widgets/split-picker.ts` and reuse
its button and existing confirmation copy in `widgets/bill-edit-conflicts-dialog.ts`, using the
shared `wt-dialog`. Show one row per refused bill. Confirming sends only that row's takeover.
Use `DraftSync.takeOver` for the open bill so it retains any local edits, and `takeOverOn` for
another bill in the same party. Check that the observation still matches the row before sending.
For another party or a floor join, send the refused edit as the expectation through the existing
party-scoped `takeOverDraft` request. A changed or missing draft uses the existing takeover refusals.

**Wire the actions.** Handle these conflicts where `till-app.ts` receives the table relocation
and Move dishes refusals, before their ordinary error recovery. In
`screens/till-table-order-screen.ts`, return staff to the chosen action for review. In
`screens/till-floor-screen.ts`, handle the same refusal from the shared floor join path. Offer
review when the listed takeovers finish, and let staff cancel. A retry fetches fresh observations
and needs a separate press. A late answer belongs to the same panel visit, party and sign-in.
This slice uses the server's existing rules for whole-bill moves and dish transfers. Merge bills,
the counter's separate held-order/allergy flow, and changes to server rules or stored data are
outside the proposed slice.

**Proposed panel words for the watcher** in `apps/till/src/i18n/strings.ts`.

| Where | English | Spanish |
| --- | --- | --- |
| Join and whole moves | Unsent orders are holding up this change. Take over the orders below, then review the change. | Hay pedidos sin enviar que impiden el cambio. Toma los pedidos de abajo y luego revisa el cambio. |
| Move dishes | The dishes haven't moved. Take over the orders below, then review the move. | Los platos siguen en su cuenta. Toma los pedidos de abajo y luego revisa el traslado. |
| Row and confirmation | Reuse Take over draft and its confirmation. | Reutilizar Tomar el pedido y su confirmación. |

**Checks and size.** Test first. In `src/till-app-parties.test.ts` cover Join, Move guests and
Move this bill with real-shaped conflicts and check that the chosen off-screen bill goes to its
own party. In `src/till-app-move-dishes.test.ts` a refused destination keeps the chosen dishes and
destination, Cancel sends no takeover, and the explicit retry uses fresh edits. In
`src/screens/till-floor-screen.today-joins.test.ts` confirm one conflicting bill and verify the
join waits for a new press. Keep `src/widgets/split-picker.test.ts` and the existing server ownership
checks as controls. Open the refusal in English and Spanish, light and dark, at phone and desktop
widths. Update both `apps/server/src/guide/{en,es}/table-service.md` guides and remove the two
backlog entries and their summary links. Expect about 330 production lines and 240 test lines.
