# A594: Move a bill to a free joined table

**Goal.** When staff move a bill to a free table in a joined group, the receiving party
holds the whole group and keeps its name for today. For dishes already sent, the usual
MOVED slip gives the kitchen that name as the destination.

**Approach.** `openParty` currently seats only the chosen table in
`apps/server/src/move-bill.ts`. Reuse the helper that seating already calls,
`seatMergeMembers(tx, partyId, tableId)`, immediately after opening the receiving
party. It adds the other seats in table-number order and applies the same checks for
occupied tables, clearing and moving. Run it inside the existing move transaction,
before adopting the bill or queuing slips. The existing slip path reads the new
party's tables and their name for today. Keep `openParty` as the one-table operation
that Split tables also calls.

**Scope.** One server fix. Separate work covers Move guests, Split tables, the floor
reset rules (A565, A566 and A860), and any repair of old partial groups.

- [ ] In `apps/server/src/party-move-bill.test.ts` under MOVED notices, add
  “seats the whole free joined group and prints its today's name”. Use the live
  floor fixture, `writeMerge` and `nameToday` to prepare a named group whose
  individual table labels differ. Move a bill with a fired dish and an attached
  printer to one member. Assert that the receiving party holds every member and that
  the printer has exactly one MOVED slip naming the source and the group's today name.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/party-move-bill.test.ts -t 'seats the whole free joined group'`.
  Expect the membership assertion to receive just the selected table. Then add the
  helper call in `apps/server/src/move-bill.ts` and run the same test to green.
- [ ] Run the full `party-move-bill.test.ts` and `till-api.today-joins.test.ts`
  files for the other move paths and the seating helper. Run the lane's unchanged
  fiscal and published-menu gates. Remove A594's closed entries from
  `docs/backlog.md` and `docs/backlog/till.md` in this pull request.

**Expected size.** About 2 production lines and 30–40 test lines added, plus the
backlog deletions.
