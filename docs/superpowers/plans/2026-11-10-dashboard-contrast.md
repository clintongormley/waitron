# Dashboard contrast implementation plan

**Outcome:** Make an enabled, off switch visible inside a dark dialog and retain Products status/allergen badge outlines when its dark row is hovered. One queued PR; no eligible small bundle to combine.
**Authority:** Lane D `RUNNER.md` §0: “The watcher is your manager: it chooses what you work on and approves how.” Watcher queue, 2026-11-10 03:16: “Fix in the shared primitive or its tokens, never per screen; measure contrast before and after.” Outcome authorized; mechanism awaits parent checks, Claude plan review and watcher approval before code.
**Boundary:** No visual redesign, global separator change, observers, controllers, state changes, new dependencies or new tokens. Preserve checked, disabled, focus, event and keyboard behavior.

## Owners and files

- Production: `packages/ui/src/components/wt-switch.ts` changes only the off track to existing `--wt-color-field-line`; `packages/ui/src/components/wt-data-table.ts` owns badge border colour via `[part~="badge"]`; `apps/dashboard/src/widgets/product-list.ts` removes its competing border colour, retaining width/style, layout and radius. Reuse `--wt-color-field-line` for both, subject to rendered measurements; leave `--wt-color-border` unchanged.
- Tests: extend `packages/ui/src/components/wt-switch.a11y.test.ts` and `packages/ui/src/components/wt-data-table.test.ts`; retain `apps/dashboard/src/widgets/product-list.test.ts` assertions; correct its ownership title.
- Support, only for the missing alpha calculation: extend `packages/ui/src/test-helpers.ts` and `packages/ui/src/test-helpers.test.ts` for computed RGB(A) contrast/compositing. Existing mounts suffice; local ratio helpers discard alpha; theme `contrastRatio` accepts hex only.
- Docs: update `docs/developers/design-system.md` with shared outline ownership; delete completed bundle/detail from `docs/backlog/dashboard.md`; change `docs/backlog.md` only if its index becomes stale. No staff-guide workflow changes.
- Forecast additions/removals: production +8/−3 lines; behavior tests +60/−0; support and its calculation controls +45/−0; docs roughly +8/−20, excluding this plan. Estimates only.

## Build and prove

- [ ] Before code, read the TDD skill. Check `memory_pressure | grep free` and `ps -axo pid,ppid,command` for competing browser/coverage runs; follow the repository's headroom rule.
- [ ] Establish runtime baseline using `wa-wt demo waitron-fix-dashboard-contrast`: open the actual theme-name dialog with `inUse` off and Products with status and own/inherited allergen badges; hover the clickable row (lifted cells override raised-row hover). Record computed track/border colours, alpha, ancestor opacity, effective composited backing and ratios before changes. Historical backlog ratios are not rendered measurements.
- [ ] First add failing contrast assertions: switch suite owns off-track versus dialog surface in both themes (plus page/surface contexts); table suite owns bordered badge cells at rest and real `userEvent.hover`, including clickable/pinned/joined backing. Use the documented 3:1 component-boundary contract (design-system Forms); adopt 3:1 for badge visibility as a product target, not an asserted decorative-badge accessibility requirement. Watch these fail below the target before changing production.
- [ ] First test transparent, partly transparent and opaque calculation controls; reuse themed mounts and existing luminance approach. Composite real backing. Make minimal shared changes, then observe passes. Shared suites own colour once; Products retains integration/layout assertions.
- [ ] Preserve switch interaction/focus/disabled assertions and full axe checks. Check `packages/venue-service/src/dashboard/station-table.ts`: its default badge must gain no border width/style.
- [ ] Focused commands: `pnpm --filter @waitron/ui exec vitest run src/test-helpers.test.ts src/components/wt-switch.test.ts src/components/wt-switch.a11y.test.ts src/components/wt-data-table.test.ts`; `pnpm --filter @waitron/dashboard exec vitest run src/widgets/product-list.test.ts src/widgets/product-list.a11y.test.ts`. No whole-package runs.
- [ ] Repeat actual-dialog/hovered-Products measurements after changes, including alpha/backing. Inspect screenshots in light/dark × EN/ES × desktop/390px; inspect checked, disabled and keyboard focus too. Keep screenshots uncommitted (package-relative capture in Vitest); attach ratios/images to review evidence.

**Finish line:** The off dialog switch and hovered dark Products badge outlines are visible; ratios pass and screenshot matrix is inspected. Normal finish-branch, push hook and current-head CI follow. If measurements reject this bounded fix, seek watcher approval before expanding files/tokens.

**Read receipts (not runtime verification):** `docs/backlog/dashboard.md:602,1014`; `docs/developers/design-system.md:147,450,4686`; `wt-switch.ts:76`; `wt-dialog.ts:68`; `wt-data-table.ts:297,824`; `product-list.ts:251,1196,1631`; `product-list.test.ts:1506`; `station-table.ts:56`; `packages/ui-core/src/theme/colour.ts:16,80`; `wt-slider.a11y.test.ts:11`; `docs/developers/testing-guide.md:76`. Component basenames here are under `packages/ui/src/components/`, Products under `apps/dashboard/src/widgets/`, station under `packages/venue-service/src/dashboard/`.
