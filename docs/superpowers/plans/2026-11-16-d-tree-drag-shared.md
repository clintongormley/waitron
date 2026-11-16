# TREE-DRAG-SHARED

**Result.** One pointer lifecycle serves Products and Menus Structure; programmatic table expansion reports a shared event. All existing drag, Escape, keyboard-move and focus assertions remain unchanged. Source: `/Users/clintongormley/waitron-campaign-d/queue.md:26`, TREE-DRAG-SHARED; both entries and bundle in `docs/backlog/menu.md`. This is a reading-based plan, not a reproduction or test receipt.

**Reading.** `product-list.ts:443–660` and `menu-structure-table.ts:515–830` duplicate pointer handling. `wt-data-table.ts:2515–2539` separates user toggles from silent `setExpanded`. Structure's controller (`menu-structure-table.ts:391–398`) checks current-path visibility alongside fitting, focus and painting. Its search-exit assertion (`menu-structure-table.test.ts:4454`) also relies on that check.

## 1. Share the pointer lifecycle

Production files: `apps/dashboard/src/widgets/{tree-drag,product-list,menu-structure-table}.ts`. Extend existing `tree-drag.ts` with `TreePointerDrag<D, T extends { key: string }>`, exposing `start(event, key)`, `finish()`, and `refresh(recheck = false)`. Inputs are host/table access and four callbacks: `activate(key): D | undefined`, `targetFor(drag, over, point): T | undefined`, `paint(snapshot | null): void`, `drop(drag, target): void`. Snapshot carries pressed key, active flag, pointer, target and activated selection `D`; null clears presentation. Capture `D` before cleanup so drop retains its keys. Products wraps its folder target as `{key}`. Keep selection/ghost preparation in `activate`, and widget-specific gaps/hover/cleanup in `paint`; no drag platform or controller.

The helper owns pointer identity, primary-button/control-click checks, 5 px threshold, document listeners, hit testing, cursor, existing `DragEdgeScroll`, Escape, release revalidation, cleanup-before-drop and click suppression. Reuse all existing ghost/mark helpers. Products retains mouse-row/touch-grip admission, visible selection, `drag-items` timing, 600 ms hover-opening and redraw revalidation. Structure retains grip-only press prevention, repeated-membership selection, geometry/duplicate/cycle checks, busy-at-release checks and sibling/into/beside drops. Keep existing edge-origin timing, keyboard handlers, announcements and focus restoration.

## 2. Notify programmatic branch changes

Production: `packages/ui/src/components/wt-data-table.ts`. Add `wt-branches-change`, detail `{keys: string[], expanded: boolean}`, bubbling and composed. Programmatic `setExpanded` and `revealRow` notify once after state/persistence changes, synchronously before returning/awaiting redraw; keys name effective changes, including cascade closures. Refused/idempotent changes emit nothing. Keep user toggle/bulk paths excluded from this notification and preserve existing `wt-expand-change` ordering and payload.

Structure listens, stops propagation and runs `#checkCurrentShown` for closures only, retaining search, revealing and duplicate-report guards. Programmatic openings must never select an editor. Remove only the controller's visibility check; keep fitting, focus and drag painting. After search clears, reconcile once after `table.updateComplete`, retaining the existing search-closure assertion. Products continues consuming only the existing user event.

## 3. Prove and finish

Tests: extend `apps/dashboard/src/widgets/{tree-drag,product-list,menu-structure-table}.test.ts` and `packages/ui/src/components/wt-data-table.test.ts`. Use failing tests first, then minimal implementation. Add helper threshold/pointer-identity, drop revalidation and cancellation/cleanup assertions; event state-before-delivery, shadow-boundary, cascade/no-op and user-exclusion assertions; programmatic closure/opening navigation checks. Preserve every existing assertion. Run:

```sh
pnpm --filter @waitron/dashboard exec vitest run src/widgets/tree-drag.test.ts src/widgets/product-list.test.ts src/widgets/menu-structure-table.test.ts
pnpm --filter @waitron/ui exec vitest run src/components/wt-data-table.test.ts src/components/wt-data-table.tree-keys.test.ts
```

Run sequentially with browser headroom. In disposable candidate checkouts, disable helper move handling, then event dispatch, separately; rerun these commands and require the corresponding activation/event/navigation assertion failures, not import errors. Restore and rerun green.

Update `docs/developers/design-system.md`'s “no event” contract; delete both backlog entries, bundle and `docs/backlog.md` index line. Exclude screen redesigns, guides with unchanged staff instructions, dependencies and campaign state.

**Forecast:** production +210/−240 lines; tests +95/−0; support +0/−0; docs +55/−30; approximately 630 touched lines. **Review discrepancy:** queue says no risk trigger, but the UI-to-dashboard event is a cross-package contract under the standing two-reviewer rule. Driver/watcher must settle review classification; no scope expansion is proposed. Driver inspects, commits, obtains Claude approach review and watcher clearance before building.
