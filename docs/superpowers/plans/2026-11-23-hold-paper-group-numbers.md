# HOLD paper group numbers

The queue asks for a correction when reordering held groups or combining parties changes
the `GROUP n` printed on a HOLD ticket. The watcher selected that scope at 19:11 on
23 November 2026. A773-1 (#1897) assigned permanent group numbers. Today
`reorderHeldGroups` changes the firing position, and `moveGroupsToParty` changes the
party and position. Both keep the assigned number. When two parties each bring a
group with the same number, the till and newly printed tickets can distinguish them
with table labels. Each original HOLD already carries its order number and table.

- Run the permanent-number cases in `apps/server/src/order-group-numbers.test.ts`
  and `apps/server/src/order-groups.test.ts`. Check that changing firing order
  preserves the numbers on FIRE, HOLD corrections and reprints. Check that a join
  preserves both origins and that later paper distinguishes the two groups.
- Run the HOLD paper and table-join cases in `apps/server/src/move-merge.test.ts`
  to check what the existing MOVED slip prints when paper has to follow a move.
- After watcher clearance, delete the first Task 6 bullet from
  `docs/backlog/kitchen.md`. Keep the printer replacement bullet. Leave the current
  ticket words in place. English uses `HOLD`, `HOLD CHANGED` and `GROUP n`.
  Spanish uses `EN ESPERA`, `EN ESPERA CAMBIADO` and `GRUPO n`.
  A request to send new table labels to kitchens after a join would need its own scope.

Expected change is this plan and two deleted backlog lines, with zero production,
test or test-support changes. The kitchen can keep using the number on its original paper.
