# A1515 set-menu ordering scope check

Use the [ordering plan](2026-11-18-a1515-set-menu-ordering.md) for interfaces, exact file paths
and test cases. Its current outline has 24 task headings at 0301de48f3. The published-copy
reader (#3809), per-offer courses (#3762), old feature removal (#3703) and order-line changes
(#3741) are on main. The dashboard editor can proceed independently.

You can add set menus by type on a seated table, takeaway or delivery bill, then order
from their folders and see where each dish will go. Send saves its place and price. You
can resolve a dish with no place, remove an empty set menu and move dishes or set menus
to another bill. Payment, comps, discounts, fiscal documents and demo data remain in
their existing pieces.

| PR and tasks | Files and existing code to reuse | What the focused checks show | Est. code / tests |
| --- | --- | --- | --- |
| 1 · 1–3 | Shared `set-menu-bill`, export and tests. Convert served copies and reuse `fitSetMenus` for suggested moves. | Course and price come from the landing copy. Placement honours reservations and order, and moves keep other dishes fixed. | 350 / 500 |
| 2 · 4 | DB schemas, core triggers, classification, baseline and the server's draft and carve writers. | Real DB inserts, deletes and updates enforce the role rules. Run the schema and fiscal guards named in Task 4. | 180 / 260 |
| 3 · 5, 10 | Server `set-menu-bill` and `set-menu-offers`, working-order, payments and adjustments. Reuse `serveRecordedSetMenus`, existing issuance pricing and the party-venue fixture. Seed menu rows here for PRs 3–7. | Recorded copies survive republishing. A new payment or ticket is refused, and the path that records an existing capture still works. Reuse loaded line rows for the refusal where available. | 380 / 610 |
| 4 · 12a–c | Server kitchen, pass, service, allergy and order readers. | Seed real set-menu and dish rows. Tickets and screens include dishes without treating the menu itself as one. | 270 / 460 |
| 5 · 7a–c | Draft merge, server drafts, order groups, working-order and venue-service line context. Reuse the existing draft and send transactions. | Draft keeps each unit. Send places or rolls back the whole batch, and a recorded copy still works after its period ends. Skip placement reads on ordinary sends. PR 8 tests the race with the real removal route. | 470 / 530 |
| 6 · 8–9 | Server `set-menu-moves`, till API, edits and cancels. Reuse `checkMoves` and the send placement step. | An explicit move writes the new price in one transaction. Editing keeps the first dish's place. Test that cancelling frees a place here and that removal then succeeds in PR 8. | 350 / 450 |
| 7 · 11a–b | Server bill actions, move-bill, working-order, table and draft splits. | Moving a menu keeps its dishes and copy. A loose dish needs a place on the target, and splitting clears source reservations. | 400 / 490 |
| 8 · 6 | Server `set-menu-count`, party reads and till routes. Reuse the party revision, session and zone checks. | Counts save on an eligible bill, preserve its recorded copy and refuse to leave a draft dish without a place. Test removal after cancellation and − racing Send with real routes. Menu creation follows the money, kitchen and move checks. | 390 / 650 |
| 9 · 13, 16b | Till API and live updates, draft state, refresh and bilingual refusals. | The client picks the bill's copy and sees sold-out changes. Refusals name the dishes and the available next step. | 260 / 390 |
| 10 · 14–15 | Build the folder, count and summary widgets with the shared stepper. Add basket and sent-line tags and total logic. | Widget checks cover prices, draft places and accessibility. PR 12 takes the menu-browser and screen wiring and their browser tests. | 440 / 480 |
| 11 · 17 | Connect set-menu bill moves in the till's move screen. Reuse the target bill read and placement preview. | Browser checks cover moving a menu with its dishes, a loose dish's price on the target and a refused move. | 250 / 310 |
| 12 · 16a | Mount folders and counts (14–15). Wire `product-pick.ts`, `canSelectProduct`, screen totals and the no-place dialog. Land the help tooltip and `GUIDE_LINKS` with both guides, and update the backlog. | Run the browser wiring tests and the live checks from Tasks 14, 15b and 17. Check the folder, totals before and after Send, the no-place choices, moves and payment refusal. | 500 / 530 |

Estimated total is 4,240 lines of code and 5,660 of tests. PR 2 also regenerates the baseline at
350–500 changed lines (for comparison, #3763 changed 355 generated lines). Run each
PR's focused tests and required CI. PR 12 first shows the ordering controls. Piece 4 enables
payment, comps and discounts. Confirm when the ordering controls should reach a live
venue with the watcher before publishing them to one.
