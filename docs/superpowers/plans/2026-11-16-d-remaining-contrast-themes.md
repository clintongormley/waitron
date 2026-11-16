# Remaining contrast-theme repairs

Codex authorship. Source: `~/waitron-campaign-d/queue.md`, CONTRAST-THEME-REMAINING (watcher, 2026-11-16 00:53), and `docs/backlog/dashboard.md:347`. Driver checks/commits; Claude reviews the approach; watcher clears building. One PR; no owner design approval is claimed.

Finish line: staff using Windows contrast themes can distinguish help on/off, the combobox's open/focused list, chosen colours and the table states below. Normal-browser rendering and interactions stay unchanged.

- [ ] Work only in `packages/ui/src/components/`: modify `wt-help-switch.ts`, `wt-combobox.ts`, `wt-colour-chooser.ts`, `wt-data-table.ts`; create corresponding `wt-help-switch.forced-colors.test.ts`, `wt-combobox.forced-colors.test.ts`, `wt-colour-chooser.forced-colors.test.ts`, `wt-data-table.forced-colors.test.ts`.

  Reuse `fieldStyles`, `baseStyles`, existing rendered attributes and fixtures, and unchanged `packages/ui/src/test-helpers.ts` (`mount`, `cleanup`, `emulateForcedColours`, `elementPixels`) with `packages/ui/vitest.config.ts`'s existing command. Follow `wt-tabs.forced-colors.test.ts`, `wt-switch.forced-colors.test.ts` and ui-core's `wt-input.forced-colors.test.ts`.

- [ ] For each piece, write focused screenshot-pixel tests first; watch their specified assertions fail before CSS changes. Add minimal rules exclusively inside `@media (forced-colors: active)`, then rerun to passing:

  | Piece | Repair and assertion that fails when removed |
  | --- | --- |
  | Help switch | Give the pressed icon an additional system-colour outline; off retains its thin circle. Pixels outside that circle differ only when pressed; keyboard focus remains separately visible. |
  | Combobox | Keep the shared Highlight focus outline while a non-search list is open: `.field[data-open]:not([data-search],[data-invalid],[data-disabled])` uses the shared outline width/negative offset. Sample its edge open versus closed/unfocused; preserve the thicker invalid line. Give `.search:focus-visible` an outline and sample its focus edge. The shared ordinary line already covers searchable lists. |
  | Colour chooser | Replace the checked tile's shadow with an inset Highlight ring on its `::after`, positioned over a relative tile without changing its existing border. Compare checked/unselected edge pixels and unchanged tile size; check the outer focus ring separately while checked. Preserve trigger/panel swatches with exact supplied fill pixels and a CanvasText border. |
  | Data table | Replace `th[data-filtered]`'s shadow with a thicker Highlight line on the existing `th::after`; outline `.table-search:focus-visible`; mark joined rows with an overlaid side rule on `tbody tr.joined td:first-child::after`, positioned relative to that cell. Compare each repaired mark's pixels with its resting counterpart and keep geometry unchanged. Do not reuse the pinned cell's `::before`. |

  Use Canvas/CanvasText, Highlight/HighlightText and GrayText as appropriate. Limit `forced-color-adjust: none` to essential swatches; reset any opted-out element's focus ring. Sample actual pixels away from text, never computed shadows. Restore emulation, help state, language and viewport after cases. Remove each repair temporarily to confirm its assertion fails.

- [ ] Run red/green with `pnpm --filter @waitron/ui exec vitest run src/components/wt-{help-switch,combobox,colour-chooser,data-table}.forced-colors.test.ts`. Then run existing functional/a11y suites using the same four filename prefixes without `.forced-colors.test.ts`, plus `src/no-hardcoded-chrome.test.ts`; require reported test counts. Existing suites own interactions/accessibility; new suites own repaired painting and forced-colours-off token/geometry checks. Keep the runbook-required representative phone/desktop (390/1280), English/Spanish, light/dark inspection, with emulation on/off; no state matrix. Screenshots stay local.

- [ ] Update stale Forced colours claims in `docs/developers/design-system.md`; remove only these four pieces from `docs/backlog/dashboard.md` and narrow `docs/backlog.md`'s index to lane C's remaining floor map/rings. Exclude global tokens, APIs, interactions, frameworks, servers, unrelated guides, hover repairs, badge/drag decoration and tests of unchanged ticks/separators.

Estimate added/removed lines: production +80/−0; tests +240/−0; support +0/−0; docs (including this plan) +65/−10: 395 changed lines. Stop above 1.5× (593 lines) for a watcher outside opinion. Driver completes finish-branch review, pre-push checks and current-head CI.
