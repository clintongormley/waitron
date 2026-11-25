# Fire a grouped row and group its Finish table slips

**Finish line.** Choose **Fire now** on a held row of three portions. All three and their extras
leave the held course in one fire. Each station prints one line of three or three lines of one
according to **Identical dishes on a station ticket**. **Finish table** follows that choice on
the cancellation slip as well.

**Source.** Lane F’s GROUPED-ROW queue entry (A1193/A1194) and the owner’s 24 November 21:57
answer, recorded in the watcher’s small-questions list, item 5. Keep per-portion storage,
per-dish cancellation choices and refund links. Scope the cancel-slip change to Finish table.
The watcher confirmed the Finish table scope and cleared the plan on 25 November at 03:23.
Use the current commands and station setting. No migration or invoice changes.

1. **Fire the row.** Carry optional `lineIds` alongside `lineId` from the resolved row in the till’s
   `screens/till-table-order-screen.ts`, through `till-app.ts` and the `api/client.ts` command body. Offer and send Fire only when
   every row member passes the existing fire check. Extend the write in `till-group-routes.ts` and the held-line preview in `party-allergy-api.ts` and
   `packages/module/src/party-allergy.ts`. Both `order-group-release.ts` and `party-allergy.ts`
   must refuse a batch unless its unique top-level members include the first id and are active in
   one bill and held group of that party. Preview and late-send check the whole selection.
   Use sorted member ids in the replay fingerprint and event for a batch. Preserve the single-line
   form. Correct the source HOLD paper before moving members and extras, then call the existing
   `fireOrderLines` once for the new group. HOLD CHANGED prints the summed correction in both modes.
2. **Group the cancellation paper.** Once Finish table validates the choices, use the existing
   `serviceCancellationFamilies` and `dishKitchenItems` before any cancel deletes ticket details.
   Extract the VOID and HOLD CANCELLED enqueue logic from `line-cancel.ts` into
   `line-service-cancel.ts` and call it with all the validated families for each bill from
   `finish-party-service.ts`. Carry each dish's preparation-started answer into the batched enqueue,
   keep the existing notice folding and HOLD routing checks, and tell the subsequent `cancelItem` calls that corrections are already queued. Keep
   the enqueue and cancellation writes in the existing transaction. In `kitchen-ticket-corrections.ts`,
   pass the station setting to the Finish table slip. In `kitchen-ticket.ts`, reuse
   `arrangeTicketItems` to print the folded whole portion as one entry of three or three
   entries of one under one header. Keep different print keys and correction kinds on separate slips. Other Void and HOLD
   correction paths keep their current layout.
3. **Prove and document.** Start with failing cases. The till’s `sent-portions.test.ts` pins the
   clicked row’s three ids. `api/client.test.ts` and the allergy tests pin the selection through
   preview and write. `till-api.groups.test.ts` pins invalid membership and replay.
   `order-group-release.test.ts` pins one group, all extras, the unrelated held dish and one ticket per station.
   `order-portions.adjustments.test.ts` checks VOID in both slip layouts and a printed held row
   for HOLD CANCELLED. Keep the three per-dish keep-charge assertions and name them in the PR. Check existing HOLD routing and refund tests. Record changed
   assertions in the PR. Update the English and Spanish `table-service.md` and `kitchen-service.md`
   guides, `docs/developers/design-system.md` and the station setting hint and test. Remove A1193/A1194 from the two backlog entries.

Expected added or replaced lines are about 240 product and 150 test lines, plus the guide edits.
