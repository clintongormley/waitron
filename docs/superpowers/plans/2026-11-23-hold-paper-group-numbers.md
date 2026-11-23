# HOLD paper group numbers

The queue asks for a correction when reordering held groups or combining parties changes
the `GROUP n` printed on a HOLD ticket. The watcher selected that scope at 19:11 on
23 November 2026. A773-1 (#1897) assigned permanent group numbers. Today
`reorderHeldGroups` changes the firing position, and `moveGroupsToParty` changes the
party and position. Both keep the assigned number. A join keeps the order number on
the original HOLD header. When both parties bring a group with the same number, later
paper adds table labels that can overlap. Use the order number to tell those papers
apart after the join.

- Run the permanent-number cases in `apps/server/src/order-group-numbers.test.ts`
  and `apps/server/src/order-groups.test.ts`. Check that changing firing order
  preserves the numbers on FIRE, HOLD corrections and reprints. Check that a join
  preserves both origins and that later paper distinguishes the two groups.
- Run the join case in `apps/server/src/move-merge.test.ts` to check that both
  orders keep their numbers. The checked cases do not establish what a MOVED slip
  shows when staff separately merge bills with held work after a party join.
- After watcher clearance, delete the first Task 6 bullet from
  `docs/backlog/kitchen.md`. Keep the printer replacement bullet. Leave the current
  ticket words in place. English uses `HOLD`, `HOLD CHANGED` and `GROUP n`.
  Spanish uses `EN ESPERA`, `EN ESPERA CAMBIADO` and `GRUPO n`.
  The overlap in table labels is a separate finding for the watcher.

Expected change is this plan and two deleted backlog lines, with zero production,
test or test-support changes. The kitchen can keep using the number on its original paper.
