# TREE-DRAG-SHARED

**Finish line.** Products and Menus Structure keep their existing pointer drag, Escape, keyboard-move and focus behaviour, with one shared pointer lifecycle. The watcher cleared the drag-only result on 2026-11-16 at 11:54: drop the shared programmatic-expansion event and retain the current-path check. Source: Lane D’s `TREE-DRAG-SHARED` queue item and `docs/backlog/menu.md:94–110`.

**Review and clearance.** Separate Sol-high author; driver checked source; Claude’s 176-second approach read recommends dropping the UI event. Production `setExpanded` callers only open branches; Structure’s wrapper is closed only by tests. Its existing redraw check also handles search exit and newly collapsed rows. An event would cover less and leave the controller running. Driver confirmed those call sites with `rg` and read the controller/wrapper; this is source evidence, not a runtime measurement. The watcher accepted the recommendation: share the drag, retain that one current-path check, and delete the second backlog entry with the review’s reason. The clearance is recorded in Lane D’s questions.md at 11:54; it is the watcher’s decision, not owner design approval.

## Share the drag

Modify `apps/dashboard/src/widgets/{tree-drag,product-list,menu-structure-table}.ts`. Extend existing `tree-drag.ts`; reuse its ghost, marks, cursor, click-suppression and `DragEdgeScroll` helpers. Share pointer identity, primary-button/control-click admission, the 5 px start, document listeners, hit testing, Escape, release revalidation and cleanup-before-drop.

Use `TreePointerDrag<D,T>` with `start(event,key)`, `finish(): boolean` (returns whether it was active), `revalidate()` and `repaint()`. Hooks: `activate(key): D | undefined`, `targetFor(data,over,point): T | undefined`, `sameTarget(a,b): boolean`, `moved(snapshot): void`, `ended(wasActive): void`, and `drop(data,target): void`. Snapshot includes the raw row `over`, pointer, target and activated selection. Keep Products’ string target and Structure’s existing target object/comparator; do not wrap strings. Capture selection before `ended` clears widget state.

Keep widget-specific hover timers and edge-scroll start/update/stop in `moved`/`ended`, preserving Products’ retry-until-origin and Structure’s single start attempt. The common helper does not need another option for that difference. Products retains row/mouse versus touch/grip admission, visible selection, `drag-items` timing including empty reports after an inactive press, and 600 ms hover-opening. Structure retains grip prevention, repeated-membership selection, geometry/duplicate/cycle and busy-at-release checks. Existing keyboard handlers, announcements and focus restoration stay.

## Tests and finish

Extend `apps/dashboard/src/widgets/tree-drag.test.ts` for threshold/pointer identity, final target revalidation and cleanup. Keep every existing assertion in `product-list.test.ts` and `menu-structure-table.test.ts`; add only missing helper-level coverage after tracing their existing hover, cancellation, selection and focus cases. Start with failing tests; move code without changing its observed behaviour.

Run `pnpm --filter @waitron/dashboard exec vitest run src/widgets/tree-drag.test.ts src/widgets/product-list.test.ts src/widgets/menu-structure-table.test.ts`. In a disposable candidate, remove helper move handling and show the activation assertion fails, then restore and run green. Inspect both trees in both languages/themes and at phone/desktop widths.

Delete the two resolved entries, their bundle and `docs/backlog.md` index; no guide or design-system edit unless the selected result changes its contract. Exclude screen redesigns, dependencies and campaign state. Forecast for the recommended drag-only result: production +210/−240, tests +140/−0, support0/0, docs+35/−30: about655 changed lines; outside-opinion stop982. The cleared dashboard-only change gets one run-it review. No owner design approval is claimed.
