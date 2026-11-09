# A1241: English device-profile test samples

**Outcome.** Finish the complete device-profile sample-name area: loading, departments, accessibility and unsaved changes. Choose this smaller complete area first; devices mix many more names into translated sentences and need separate qualification. Staff-facing behaviour stays the same.

**Authority.** The owner authorizes following `/Users/clintongormley/waitron-campaign-j/RUNNER.md`, advancing an eligible item, finish-branch and land-branch. Its §0 requires “Plan, then approval, then build”. Queue A1241 and WATCHER 2026-11-09 18:16 assign this work “between A1018 slices, never part-way through one.” A1018 awaits approval at 19:50; watcher 19:53 still says “No build until the answer is here.” A1342 storage is held at 19:39; #2654 is owner-only ready. A976 AdjustmentVenue landed as #2639, `ff2132c0977857ba9d8016cd585c061c6bdcc2d8`; BillVenue stays held under watcher 14:23. This plan has no build approval.

**Paths.** Under `apps/dashboard/src/screens/`, change only `device-profiles-screen.test.ts`, `device-profiles-screen.a11y.test.ts` and `device-profiles-screen.unsaved.test.ts`. Documentation: `docs/superpowers/plans/2026-11-09-a1241-device-samples.md`, `docs/backlog.md` and `docs/backlog/architecture.md`. Add “Device, catalogue and floor-plan samples remain.” to index A1241; delete detail lines 1161–1162 about outstanding profile samples. Keep A1241's remaining work. Save-state and clock siblings have no matching sample replacements. No production, helper, identifier, comment, guard or translation changes.

**Replacements.** Use the qualified line inventory at `/Users/clintongormley/waitron-campaign-j/receipts/a1241-devices-20261109/inventory.md`. Base: `604fdde31ac8a8ba13fb3bdea4fd95ddc9a5401f`.

| Existing sample | English sample |
| --- | --- |
| `Restaurante`; `Restaurante $&` | `Restaurant`; `Restaurant $&` |
| `Comedor`; `Terraza` | `Dining room`; `Terrace` |
| `Barra`; `Cocina`; `Vieja` | `Bar`; `Kitchen`; `Old` |
| `Caja`; `Mostrador` | `Till`; `Counter` |
| `Pantalla Pase de la terraza`; `Pantalla Pase` | `Pass screen near the terrace`; `Pass screen` |

Change 22 lines: 19 inputs, three expectations. Preserve `$&`, distinguishable fixtures, IDs, whitespace tests, amounts, permissions and matchers. The accessibility name grows from 27 to 28 characters, still five words; preserve the long station name and wrapping checks. Keep Spanish UI, existing translation reads and locale-subject text; no unrelated hardcoded-UI cleanup.

**Build and finish, only after approval.**

1. Driver: commit the plan signed off; obtain one completed Claude `claude-seat.sh review-branch` read, fix findings, post PLAN FOR APPROVAL and await the watcher. At most one reread for fixes; no working seat means no build. This writer runs neither reviews nor tests.
2. After approval, check live paths/browser headroom. Run `pnpm --filter @waitron/dashboard exec vitest run src/screens/device-profiles-screen.test.ts src/screens/device-profiles-screen.a11y.test.ts src/screens/device-profiles-screen.unsaved.test.ts`. Record baseline pass/skip/fail counts per file. Static counts predict **183 + 44 + 46 = 273** cases, not observed passes. Investigate failures/count discrepancies before editing.
3. Change only nineteen inputs; rerun. Predict **three failures, 270 passes**: replacement-pattern department hint, new-profile department hint and every-zone description still expect `Restaurante`. Other changed samples lack direct name-equality assertions; add none. Stop if red differs.
4. Align only expectations at Main:1869, :1883, :2404; rerun. Require final passing counts equal to baseline, no new skips. Run `pnpm exec vitest run scripts/english-only.test.ts`; its current package-only scan needs the inventory residual search and diff inspection beside it. No whole-package local tests.
5. Update named backlog entries; list three before/after checks in PR/lane FYI. Run `finish-branch`, including one required Claude run-it after initial rebase in an installed disposable checkout. Sign off commits; require normal hook and selected current-head CI before `land-branch` under the shared lock. Re-read queue/questions before finish/land; record merge CI.

**Size/limits.** Tests **+22/−22 = 44**; production **+0/−0**; generated zero. Docs **+30/−2 = 32** (29-line plan, index +1, detail −2); total **76** added-plus-removed lines; stop above **114**. Three active hours to open PR after approval, excluding recorded external waits. Stop for watcher deviation approval before unlisted paths, changed assertion meaning or excess growth. The brief reports A977 #2660 open, guard/helper/list/docs only, no chosen tests. If it lands and requires deleting cleaned paths from `scripts/english-only-still-to-clean.ts`, stop for watcher deviation approval.
