# Fire a grouped row and group its Finish table slips

**Finish line.** Choose **Fire now** on a held row of three portions. All three and their extras
leave the held course in one fire. Each station prints one line of three or three lines of one
according to **Identical dishes on a station ticket**. **Finish table** follows that choice on
the cancellation slip as well.

**Source.** Lane F’s GROUPED-ROW queue entry (A1193/A1194) and the owner’s 24 November 21:57
answer, recorded in the watcher’s small-questions list, item 5. Keep per-portion storage,
per-dish cancellation choices and refund links. Scope the cancel-slip change to Finish table.
Use the current commands and station setting. No migration or invoice changes.

1. **Fire the row.** The existing `fire-held-line` event and `fireHeldLine` client carry an optional
   `lineIds` alongside the first `lineId`, from the till screen’s resolved row in
   `screens/till-table-order-screen.ts` through `till-app.ts` and `api/client.ts`. The write
   (`till-api.ts`) and allergy preview (`party-allergy-api.ts`, shared target in
   `packages/module/src/party-allergy.ts`) accept the same member list. The route and
   `order-group-release.ts` require unique top-level active members of the same bill and held
   group in the party, with the first id included. `party-allergy.ts` previews the same dishes
   that the write checks. Include all members in the replay identity and set-menu late-send check.
   Move members and extras into one group and call the existing `fireOrderLines` once with the
   row. Use the existing held-paper correction with all the moved items.
2. **Group the cancellation paper.** In `finish-party-service.ts`, use a print batch for the
   existing per-line `cancelItem` calls. In `line-cancel.ts`, `line-service-cancel.ts` and
   `kitchen-ticket-corrections.ts`, keep the current kitchen notice and eligibility checks and
   collect the print items with their kitchen details before the ticket rows are removed. Flush
   in the same transaction before closing the table. Fold identical whole portions only within
   the same bill, station, and correction, using the existing print equivalence key. In
   `kitchen-ticket.ts`, let a correction slip render several entries so the Finish table batch can
   use the station’s current grouping choice. Separate paper can show the three entries under
   one header. Keep HOLD paper routing and separate slips for different corrections.
3. **Prove and document.** Start with failing cases. The till’s `sent-portions.test.ts` pins the
   clicked row’s three ids. The client and allergy tests pin the same selection in preview and
   write. `till-api.groups.test.ts` pins invalid membership and a replay with no repeat writes.
   `order-group-release.test.ts` pins one group, all extras, the unrelated held dish and paper
   in both station modes. `order-portions.adjustments.test.ts` pins both ways of printing the
   three cancelled portions and preserves the assertions on each keep-charge record. Record
   the changed assertions in the PR. Update both `table-service.md` guide twins and remove
   A1193/A1194 from `docs/backlog.md` and `docs/backlog/till.md`.

Expected added or replaced lines are about 240 product and 150 test lines, plus the guide edits.
