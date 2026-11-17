# WT-TABLE-NARROW — readable dashboard tables

**Authority and finish line.** Watcher queued WT-TABLE-NARROW at 2026-11-17 01:20 in
`/Users/clintongormley/waitron-campaign-d/queue.md`: measure its table bundle, fix actual defects,
and delete settled points. Managers can read long names and availability before pinned Actions at
phone/narrow widths. Separate Sol-high draft, checked by the driver; Claude review and watcher
clearance precede implementation. No owner design approval claimed.

**Measured on f6fbaac3d0.** Temporary browser probes at 390/600/700 px, EN/ES, preserved outside
Git in lane D's `receipts/wt-table-narrow/`, then restored: Structure long root/product text and
availability headings lie beyond Actions (six failing cases); Menus' spaced name makes its box
20 px EN / 29 px ES wider at 600/700 (four failures; 390 passes). Products' page remains exactly
the viewport width with long product names in all six probes. Its count uses BODY at narrow width,
but this did not produce overflow; that positioning alone is not a defect. Initial Products probe
missed the collapsed row; corrected probes opened Drinks and waited for the narrow attribute.

**Reuse and scope.** Reuse `wt-data-table.wrapToFit`, existing tree cell parts, Products' `#fitNames`
and Structure's deferred width measurement. Keep existing layouts, scrollable indivisible controls,
column choices and Actions. No new widget, breakpoint redesign, observer, API or stored state.
Owner choices (W85e keep/undo, colour square, indent and A292 look), plain-HTML report choosers and
seating/floor-plan/table screens remain outside this item.

- [ ] Complete measurements before choosing each fix: spaced, hyphenated and unbroken names;
  category rename, heading and live-time visibility; Products Filters with the actual sidebar;
  Price overrides at actual content width with single prices/ranges. Use 390/600/700 EN/ES.
  Retain a point without a specific reproduction instead of widening into unrelated flaky tests.
- [ ] For each reproduced defect, write a failing behavioral assertion and observe the failure,
  then implement minimally. `apps/dashboard/src/widgets/menu-structure-table.ts` opts into existing
  wrapping and styles affected names through parts; extend its existing measurement only if needed.
  `apps/dashboard/src/screens/menus-screen.ts` uses wrapping/current width reservations to fit the
  middle list. `product-list.ts` changes only for a reproduced defect; no speculative root fix.
  Change `packages/ui/src/components/wt-data-table.ts` only if a focused primitive case reproduces
  shared heading/tree sizing failure; preserve default scrolling and opt-in behavior.
- [ ] Tests belong to their behavior: `menu-structure-table.test.ts` measures actual name line
  rectangles and Disponible against Actions, with root/section/product names and reachable menus;
  `menus-screen.test.ts` checks all columns/time and Actions at narrow/middle widths; existing
  `product-list.test.ts` covers fitted names/rename/counts, adding only a missing reproduced case.
  Shared sizing, if changed, belongs in `wt-data-table.head-and-cells.test.ts`. Retain behavioral
  assertions; replace only expectations explicitly requiring the overflow this item removes.
- [ ] Run each changed browser file; focused existing price/filter/shell cases support measurements.
  Inspect EN/ES, light/dark, phone/desktop; screenshots stay local. Update necessary current contract
  prose in `docs/developers/design-system.md` and screen guides only where staff instructions change.
  Delete settled detail/duplicate points in `docs/backlog/menu.md`; correct its bundle/index count in
  `docs/backlog.md`, retaining unresolved observations and exclusions. PR records each measurement,
  including non-defects. Finish-branch reviews, normal hook and current-head CI precede landing.

**Size and responsibility.** One PR, forecast production +50/−30, tests +140/−35, docs +70/−45:
about 370 changed lines (outside-opinion threshold 555), about 60–100 build minutes. Driver owns
inline implementation; no delegation. Fewer defects mean less code, not extra scope.
