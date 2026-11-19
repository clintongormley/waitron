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
| 3 · 5, 10 | Server `set-menu-bill` and `set-menu-offers`, working-order, payments and adjustments. Reuse `serveRecordedSetMenus` and existing issuance pricing. | Recorded copies survive republishing. A new payment or ticket is refused, and the path that records an existing capture still works. | 380 / 530 |
| 4 · 12a–c | Server kitchen, pass, service, allergy and order readers. | Seed real set-menu and dish rows. Tickets and screens include dishes without treating the menu itself as one. | 270 / 460 |
| 5 · 7a–c | Draft merge, server drafts, order groups, working-order and venue-service line context. Reuse the existing draft and send transactions. | Draft keeps each unit. Send places or rolls back the whole batch, and a recorded copy still works after its period ends. | 470 / 530 |
| 6 · 8–9 | Server `set-menu-moves`, till API, edits and cancels. Reuse `checkMoves` and the send placement step. | An explicit move writes the new price in one transaction. Editing keeps the first dish's place and cancelling frees it. | 350 / 450 |
| 7 · 11a–b | Server bill actions, move-bill, working-order, table and draft splits. | Moving a menu keeps its dishes and copy. A loose dish needs a place on the target, and splitting clears source reservations. | 400 / 490 |
| 8 · 6 | Server `set-menu-count`, party reads and till routes. Reuse the party revision, session and zone checks. | Counts save on an eligible bill, preserve its recorded copy and refuse to leave a draft dish without a place. First public writer of a set-menu parent comes after the money, kitchen and move checks. | 390 / 510 |
| 9 · 13, 16b | Till API and live updates, draft state, refresh and bilingual refusals. | The client picks the bill's copy and sees sold-out changes. Refusals name the dishes and the available next step. | 260 / 390 |
| 10 · 14–15 | Till folder, counts, summary and total, using the menu browser, shared stepper and draft placements. Defer mounting ordering controls to PR 11. | Widget and browser checks cover folders, totals, moves, count refusals and accessibility. | 500 / 550 |
| 11 · 16a, 17 | Till no-place dialog and bill moves, mount the controls, both guides and the A1515 backlog entry. | Browser checks and the plan's live till walkthrough cover adding, sending, moving and payment refusal. | 470 / 520 |

The estimates are hand-written lines. PR 2 also regenerates the baseline SQL and snapshot.
Each PR runs its named test files and required CI. Review payment, schema, permissions,
concurrency and shared contracts through the lane's full review path. Update backlog
progress with each usable milestone. The till guide ships in both languages with the controls.
