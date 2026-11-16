# Remaining contrast-theme repairs

Codex authorship. Source: `~/waitron-campaign-d/queue.md`, CONTRAST-THEME-REMAINING (watcher, 2026-11-16 00:53), and `docs/backlog/dashboard.md:347`. Driver checks/commits; Claude reviews the approach; watcher clears building. One PR; no owner design approval is claimed.

Finish line: staff using Windows contrast themes can distinguish help on/off, the combobox's open/focused list, chosen colours and the table states below. Normal-browser rendering and interactions stay unchanged.

- [ ] Work only in `packages/ui/src/components/`: modify `wt-help-switch.ts`, `wt-combobox.ts`, `wt-colour-chooser.ts`, `wt-data-table.ts`; create corresponding `wt-help-switch.forced-colors.test.ts`, `wt-combobox.forced-colors.test.ts`, `wt-colour-chooser.forced-colors.test.ts`, `wt-data-table.forced-colors.test.ts`.

  Reuse `fieldStyles`, `baseStyles`, existing rendered attributes and fixtures, and unchanged `packages/ui/src/test-helpers.ts` (`mount`, `cleanup`, `emulateForcedColours`, `elementPixels`) with `packages/ui/vitest.config.ts`'s existing command. Follow `wt-tabs.forced-colors.test.ts`, `wt-switch.forced-colors.test.ts` and ui-core's `wt-input.forced-colors.test.ts`.

- [ ] For each piece, write focused screenshot-pixel tests first; watch their specified assertions fail before CSS changes. Add minimal rules exclusively inside `@media (forced-colors: active)`, then rerun to passing:

  | Piece | Repair and assertion that fails when removed |
  | --- | --- |
  | Help switch | Give the pressed icon an additional system-colour outline; off retains its thin circle. Pixels outside that circle differ only when pressed; keyboard focus remains separately visible. |
  | Combobox | Replace the non-search open-field shadow with a thicker bottom line; retain the ordinary line with search. Outline search focus and option hover; separate search/list with a border. Compare line thickness open/closed and search/non-search; sample separator/focus/hover pixels. Check active-option outline, selected tick and multiple-selection check against unselected controls. |
  | Colour chooser | Replace the checked tile's inset shadow with a system-colour border/ring distinct from its outer focus outline. Checked/unselected edge pixels differ even while checked is focused. Preserve actual swatch fills, both trigger and panel: two swatch-centre pixels retain their supplied different colours. |
  | Data table | CSS risks: `th[data-filtered]` shadow, `.table-search:focus-visible` border-only change, `.filters-count` fill, `.column-choice[data-dragging]` lift, `tr.joined td` band and clickable hover/focus fills. Use a thicker header underline, search outline, badge border, dragged-column outline, joined-row side rule and row outline respectively. Pixel assertions compare each with its resting counterpart. Also check header/pinned separators remain visible after scrolling, including hovered/focused joined rows with a pinned cell. Native checkboxes and existing borders need no redesign. |

  Use Canvas/CanvasText, Highlight/HighlightText and GrayText as appropriate. Limit `forced-color-adjust: none` to essential swatches; reset any opted-out element's focus ring. Sample actual pixels away from text, never computed shadows. Restore emulation, help state, language and viewport after cases. Remove each repair temporarily to confirm its assertion fails.

- [ ] Run red/green with `pnpm --filter @waitron/ui exec vitest run src/components/wt-{help-switch,combobox,colour-chooser,data-table}.forced-colors.test.ts`. Then run existing functional/a11y suites using the same four filename prefixes without `.forced-colors.test.ts`, plus `src/no-hardcoded-chrome.test.ts`; require reported test counts. These retain interaction/accessibility responsibilities; new suites own painting. Include forced-colours-off token/geometry checks. Inspect representative phone/desktop (390/1280), English/Spanish, light/dark renders with emulation on/off; no exhaustive state Cartesian product. Keep screenshots local, no snapshots/binaries.

- [ ] Update stale Forced colours claims in `docs/developers/design-system.md`; remove only these four pieces from `docs/backlog/dashboard.md`. Leave lane C's floor map/rings; change `docs/backlog.md` only if its index becomes stale. Exclude global tokens, public APIs, interaction changes, frameworks, servers and unrelated guide prose.

Estimate added/removed lines: production +110/−0; tests +360/−0; support +0/−0; docs (including this plan) +65/−10: 545 changed lines. Stop at 1.5× (818 lines) for a watcher outside opinion, not a ceiling. Driver completes normal finish-branch review, pre-push checks and current-head CI.
