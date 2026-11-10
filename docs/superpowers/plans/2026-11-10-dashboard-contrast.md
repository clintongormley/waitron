# Dashboard contrast

**Proposed; no build approval.** Make an enabled off switch visible inside a dark dialog and keep Products badge outlines visible on a hovered dark row. One queued PR, no new token, helper, dependency or state mechanism. Preserve checked, disabled, focus and keyboard behavior; leave general separators unchanged.
**Authority:** RUNNER §0: “The watcher is your manager: it chooses what you work on and approves how.” Watcher queue, 2026-11-10 03:16: “Fix in the shared primitive or its tokens, never per screen; measure contrast before and after.” Claude's first read supplies the smaller route below; the watcher must approve its badge-owner exception before implementation.

## Smallest route and exact files

- `packages/ui/src/components/wt-switch.ts`: paint only the off track with existing `--wt-color-field-line`.
- **Watcher choice:** `apps/dashboard/src/widgets/product-list.ts` is the sole bordered-badge owner. Keep its whole border declaration together and use existing `--wt-color-text-muted`. Approve that owner instead of adding a shared-table badge contract solely to move one colour declaration. No `wt-data-table` edit.
- `packages/ui-core/src/theme/contrast-rules.ts`: include `surface-raised` among the existing field-line group's 3:1 backgrounds, so the token's new dialog use is covered by theme validation. Existing text-muted rules already cover page/surface/raised/lifted backgrounds above the badge product target of 3:1.
- Tests changed: `packages/ui/src/components/wt-switch.test.ts` owns off-track token wiring; `apps/dashboard/src/widgets/product-list.test.ts` owns its actual badge border wiring. `packages/ui-core/src/theme/contrast-rules.test.ts` retains behavioral assertions and updates existing rule-count expectations. No duplicate per-screen contrast calculator or shared-table tests.
- Docs: `docs/developers/design-system.md` adds the off switch to field-line's Paints row. `docs/backlog.md` and `docs/backlog/dashboard.md` remove only delivered contrast entries. No guide workflow changes.
- Forecast added/removed: production +3/−2, tests +12/−3, support 0/0, docs +3/−20, excluding this plan. Under three active hours to open; stop for watcher direction at 1.5× growth or an unlisted mechanism/file.

## Build and prove

- [ ] Check memory headroom and other browser tests. Before production, use `wa-wt demo waitron-fix-dashboard-contrast` and measure the actual theme-name dialog's off switch and actual hovered Products status/allergen badges. Read `.track.backgroundColor`, dialog `backgroundColor`, badge `borderTopColor`, and its hovered cell's `backgroundColor`; confirm ancestor opacity is 1. A hidden phone badge needs no forced rendering.
- [ ] Source calculations are only the reason to reject the first badge proposal: field-line on dark lifted is 2.96:1; text-muted is 4.74:1. They are not rendered measurements. If runtime reveals alpha or a different backing, stop for the smallest revised proposal instead of adding a general compositor.
- [ ] Read TDD skill; add the two token-wiring regressions and observe expected failures against old border/track paint. Make the minimal changes and observe passes. Existing core token/theme tests own numerical rules, including venue-derived themes; preserve their behavioral checks. Inspect all changed test files before checkpoints.
- [ ] Focused UI: `pnpm --filter @waitron/ui exec vitest run src/components/wt-switch.test.ts src/components/wt-switch.a11y.test.ts`. Dashboard: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/product-list.test.ts src/widgets/product-list.a11y.test.ts`. Core: `pnpm --filter @waitron/ui-core exec vitest run src/tokens/colors.test.ts src/theme/contrast-rules.test.ts src/theme/derive.test.ts`. Sequential browser runs, no whole-package suite.
- [ ] Repeat the same actual-element measurements after changes. Keep RUNNER's light/dark × EN/ES × desktop/390px inspections for changed visuals, including checked/disabled/focus in the dialog; do not add a matrix of every row state. Capture locally and show review evidence, never commit screenshots. No staff-guide filler.

**Finish:** actual off-track and hovered-badge readings meet the target, inspected visuals and focused checks pass, backlog matches delivered behavior, normal finish-branch/push hook/current-head CI and applicable shared-UI publication checks complete. The watcher approves the sole-owner exception and build before any code changes.
