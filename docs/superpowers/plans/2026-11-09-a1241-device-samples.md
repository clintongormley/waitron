# A1241: English device-profile test samples

**Outcome.** Finish the complete device-profile sample-name area: loading, departments, accessibility and unsaved changes. Choose this smaller complete area first; devices mix many more names into translated sentences and need separate qualification. Staff-facing behaviour stays the same.

**Authority.** The current user authorises Lane J queue work, finish-branch and land-branch. Watcher 2026-11-09 20:08 in `/Users/clintongormley/waitron-campaign-j/questions.md` approved this corrected device-profile plan, retaining baseline and guard. Watcher 2026-11-10 00:55 unblocked it: “Build the device-profile slice once A974's PR is open.” A974 is PR #2681; no cleanup scope is inferred beyond this approved area.

**Paths.** Under `apps/dashboard/src/screens/`, change only `device-profiles-screen.test.ts`, `device-profiles-screen.a11y.test.ts` and `device-profiles-screen.unsaved.test.ts`. Documentation: `docs/superpowers/plans/2026-11-09-a1241-device-samples.md`, `docs/backlog.md` and `docs/backlog/architecture.md`. In index A1241, replace “Continue the dashboard test sample-name cleanup” with “Finish the remaining dashboard test sample names”; delete detail lines 1161–1162 about outstanding profile samples. Keep A1241's remaining work. Save-state and clock siblings have no matching sample replacements. No production, helper, identifier, comment, guard or translation changes.

**Replacements.** Exact original lines: main suite 82, 1863, 1869, 1883, 2310, 2404, 3349; accessibility suite 48, 50, 51, 91–94, 273, 288, 295, 304, 333, 514, 518; unsaved suite 280. Keep the Spanish UI at main 408, 411 and 1495. Use the qualified line inventory at `/Users/clintongormley/waitron-campaign-j/receipts/a1241-devices-20261109/inventory.md`. Base: `604fdde31ac8a8ba13fb3bdea4fd95ddc9a5401f`.

| Existing sample | English sample |
| --- | --- |
| `Restaurante`; `Restaurante $&` | `Restaurant`; `Restaurant $&` |
| `Comedor`; `Terraza` | `Dining room`; `Terrace` |
| `Barra`; `Cocina`; `Vieja` | `Bar`; `Kitchen`; `Old` |
| `Caja`; `Mostrador` | `Till`; `Counter` |
| `Pantalla Pase de la terraza`; `Pantalla Pase` | `Pass screen near the terrace`; `Pass screen` |

Change 22 lines: 19 inputs, three expectations. Preserve `$&`, distinguishable fixtures, IDs, whitespace tests, amounts, permissions and matchers. The accessibility name grows from 27 to 28 characters, still five words; preserve its long-device-name role and wrapping checks; the already-English long station name stays unchanged. Keep Spanish UI, existing translation reads and locale-subject text; no unrelated hardcoded-UI cleanup.

**Build and finish, only after approval.**

1. Driver: commit the plan signed off; obtain one completed Claude `claude-seat.sh review-branch` read, fix findings, post PLAN FOR APPROVAL and await the watcher. At most one reread for fixes; no working seat means no build. This writer runs neither reviews nor tests.
2. After approval, check live paths/browser headroom. Run `pnpm --filter @waitron/dashboard exec vitest run src/screens/device-profiles-screen.test.ts src/screens/device-profiles-screen.a11y.test.ts src/screens/device-profiles-screen.unsaved.test.ts`. Record baseline pass/skip/fail counts per file. Static counts predict **183 + 44 + 46 = 273** cases, not observed passes. Investigate failures/count discrepancies before editing.
3. Change only nineteen inputs; rerun. Predict **three failures, 270 passes**: replacement-pattern department hint, new-profile department hint and every-zone description still expect `Restaurante`. Other changed samples lack direct name-equality assertions; add none. Stop if red differs.
4. Align only expectations at Main:1869, :1883, :2404; rerun. Require final passing counts equal to baseline, no new skips. Run `pnpm exec vitest run scripts/english-only.test.ts` as the queue explicitly requires, while treating it as no evidence for app samples at this base; check the mapped residuals and complete diff independently. No whole-package local tests.
5. Update named backlog entries; list three before/after checks in PR/lane FYI. Run `finish-branch`, including one required Claude run-it after initial rebase (RUNNER H8 and global direct-Codex rules; older repository Claude-driver seat wording does not govern this entry path) in an installed disposable checkout. Sign off commits; require normal hook and selected current-head CI before `land-branch` under the shared lock. Re-read queue/questions before finish/land; record merge CI.

**Size/limits.** Tests **+22/−22 = 44**; production **+0/−0**; generated zero. Docs **+30/−3 = 33** (29-line plan, index +1/−1, detail −2); total **77** added-plus-removed lines; stop above **116**. Three active hours to open PR after approval, excluding recorded external waits. Stop for watcher deviation approval before unlisted paths, changed assertion meaning or excess growth. The brief reports A977 #2660 open, guard/helper/list/docs only, no chosen tests. Watcher 20:08 pre-approved deleting only these three paths and the pinned count from A977's `scripts/english-only-still-to-clean.ts` list if it lands first and confirms the files fully clean.
