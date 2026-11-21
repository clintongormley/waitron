# A594: Move a bill to a free joined table

**Goal.** When staff move a bill to a free table in a joined group, the receiving party
holds the whole group and keeps its name for today. For a dish already sent, the usual
MOVED slip gives the kitchen that name as the destination. Lane H's watcher queued
this outcome on 2026-11-21 at 20:43.

**Approach.** `openParty` seats only the chosen table in `apps/server/src/move-bill.ts`.
Call the same `seatMergeMembers(tx, partyId, tableId)` helper that seating uses, right
after opening the receiving party and before adopting the bill. The helper adds the
other seats in table-number order. The move refuses if another member is occupied,
needs clearing or needs moving, and names that table. The transaction rolls back the
whole move on refusal. The allergy preview still previews the selected table. The
move itself checks the group when staff submit it.

**Scope.** One server fix. The floor reset rules and repair of old partial groups
stay outside A594. Move guests is covered by a follow-on test of the receiving group.

- [ ] In `apps/server/src/party-move-bill.test.ts`, add “seats the whole free joined
  group and prints its name”. Use `plannedZone`, `writeMerge` and `nameToday` to make a
  named group with distinct table labels. Move a bill with one fired Burger and a
  kitchen printer to one member. Assert the chosen table first and the other members
  in table-number order. Assert one decoded MOVED slip from the source to the named
  group. Then use Move guests to send the original party's remaining sent dish to
  another member. Check the receiving party, its full membership and the group name
  on the MOVED slip. This covers the named-group follow-on in the A803 plan.
- [ ] Add “refuses a move into a partly held joined group” in the same file.
  Prepare a group with one member already occupied. Move a bill to the free member
  and assert `tab.already_open` names the occupied member. Check that the bill, its
  original party revision and both destination memberships still match the start.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/party-move-bill.test.ts -t 'seats the whole free joined group|refuses a move into a partly held joined group'`.
  Expect only the chosen table at the membership assertion and a successful move
  where the second case expects refusal. The old label reader already gives the
  first slip the group name. Add the helper call and run the cases to green.
- [ ] Run both `party-move-bill.test.ts` and `till-api.today-joins.test.ts`, plus the
  lane's unchanged fiscal and published-menu gates. Remove A594 and its empty
  bundle from `docs/backlog.md` and `docs/backlog/till.md`.

**Expected size.** About 2 production lines and 60–80 test lines added, plus backlog
deletions.
