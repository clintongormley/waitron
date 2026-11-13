# D-PHONE-WIDTH — conditional implementation plan

**Status:** Plan-only checkpoint; separate Sol-high author; driver checked source paths, the 140 px width token and diagnostic receipts; Claude approach review follows; watcher clearance is pending. No implementation starts before clearance. The request authorizes its scope; this is not an owner-approved plan.
**Request, verbatim:** “Three screens at phone width: Prep stations headings, Seasons month picker, menu Preview change list”. Recorded in `/Users/clintongormley/waitron-campaign-d/queue.md`, D-PHONE-WIDTH.
**Goal:** After clearance, add usable per-column heading wrapping and apply it to Prep stations; leave Seasons and Preview production unchanged pending concrete failure/full-screen reproduction or watcher decision.
**Reuse:** Lit/Chromium, `DataTableColumn`, existing heading/sort/help rendering, table tokens, station fixtures and EN/ES translations. No new dependency, framework, storage, table layout mode or broad redesign.

## Evidence and scope decision

Receipt root: `/Users/clintongormley/waitron-campaign-d/receipts/phone-width-before/`; read `README.md`, `venue-measurements.json`, `menu-measurements.json`. Base `7fb59b4e84`, after #3022; EN/ES × light/dark × 390/1280.
Prep: 388 px client, 646/724 px content at 390; pass heading 130/109 px including cell padding. Columns belong to `packages/venue-service/src/dashboard/station-table.ts`, not `prep-stations-screen.ts`.
Seasons: 356 px client, 577/565 px content. Month initially under the pinned bin/off screen, then fully reachable after scrolling 221/209 px; the actual opened popover stays inside the viewport. Reachability failure was not reproduced; scrolling is intentional in the current design contract.
Preview: 18 actual live rename changes, success and final-row Undo refusal; at maximum scroll the whole final row ends at pane bottom y584 in every capture. Bottom clipping was not reproduced in this fixture.
These isolated widgets omit dashboard shell padding; they neither disprove historical reports nor qualify the full screen. Diagnostic sentinel failures are measurements, not passing regression tests. Removed temporary probes stay removed.
**Watcher scope question:** Do you clear the narrower Prep-heading build while keeping Seasons/Preview backlog entries open, and accept the existing Seasons sideways-scroll behavior, or require a full-screen reproduction/decision before clearing it? Recommendation: clear Prep only; accept scrolling provisionally and retain both reports.
Unavailable in this proposal: zero sideways scrolling for station body text, a Seasons layout correction, or a Preview clipping correction. Do not invent spacing fixes or add passing tests to manufacture work; keep Seasons rows, colour-name truncation and the owner's silent Save choice unchanged.

## Exact change surface and policy

Production: `packages/ui/src/components/wt-data-table.ts`; `packages/venue-service/src/dashboard/station-table.ts` only.
Tests: `packages/ui/src/components/wt-data-table.head-and-cells.test.ts`, `packages/ui/src/components/wt-data-table.a11y.test.ts`, `packages/venue-service/src/dashboard/station-table.test.ts`; reuse existing `wt-data-table.test.ts` token checks and `station-table.a11y.test.ts` unchanged.
Docs: this plan; `docs/developers/design-system.md` (table contract); `docs/backlog/catalogue.md` (A1318 partial completion, retain body-width limit and A1376); `apps/server/src/guide/en/kitchen-service.md` and `apps/server/src/guide/es/kitchen-service.md` (`{#station-waits}`, one useful phone-scroll instruction each).
Keep `docs/backlog/service-periods.md`'s month-picker report; leave `packages/venue-service/src/dashboard/seasons-window.ts`, `apps/dashboard/src/widgets/menu-preview.ts` and their suites unchanged under this clearance.
Add `DataTableColumn<Row>.headingWrap?: boolean`, absent/false preserving current sizing. True caps only the heading's text wrapper at `calc(var(--wt-cell-name-max-width) / 2)` and wraps at spaces, including at desktop widths; preserve the full label and accessible name.
Use an intrinsically constrained inline-block label, including inside a sort button; keep its indicator and help badge usable. `table { min-width: max-content }` stays: whitespace alone cannot constrain that preferred width. Do not cap the `th`, body cells or whole column, or enable table-wide `wrapToFit`.
Opt in `printedOn`, `shownOn`, `waitsForPass` in `StationTable.#columns()`; Name and pinned Actions retain their current policy. Existing body content may still require scrolling.
Estimate from the existing column/rendering and fixture helpers: production +25–40/−2–6 lines; tests +95–135/−0–5 lines (about 122–186 code/test lines changed). Docs separately ~15–25 lines beyond this plan. Material growth returns to the watcher before building.

## Task 1 — table option, failing rendered proof first

- [ ] After clearance, read the TDD skill before writing any code. Beside `wrapToFit` in `wt-data-table.head-and-cells.test.ts`, add `headingWrap constrains only opted-in heading text`: a 160 px host, short body values and a long multiword label whose opt-out table overflows; exercise plain and sortable labels, with a help badge on the sortable variant.
- [ ] Assert actual text has multiple line rectangles, stays within its wrapper, and the heading/total table width decreases against the identical opt-out fixture; assert the ordinary body text and unmarked heading keep their line count and preferred width. Check full sort accessible name, click result and help availability.
- [ ] Add `headingWrap follows text and width tokens` in the same file: both themes, override heading colour and width token, assert computed colour and measured cap follow them. Add the opted-in sortable/help heading to the existing themed axe cases in `wt-data-table.a11y.test.ts`, keeping names and semantics checked.
- [ ] Run `pnpm --filter @waitron/ui exec vitest run src/components/wt-data-table.head-and-cells.test.ts -t 'headingWrap'`; observe the rendered wrapping/width assertion fail for the missing policy, not a setup/type failure. Then implement only the option/wrapper styles above and rerun to green.

## Task 2 — station adoption and phone qualification

- [ ] In `station-table.test.ts`, add `Prep headings wrap without changing body policies`: two active stations with printers/screens and Yes/No pass values, EN/ES × light/dark × 390/1280. Reuse current helpers and resolved theme fonts; wait for rendering and restore viewport/locale/theme afterward. No font loader or new test support.
- [ ] Assert measured `window.innerWidth`, pass-label text occupies multiple lines and is narrower than the same fixture with the opt-in disabled; preserve full printer/screen content, existing body wrapping, Yes/No values and reachable pinned Actions. Do not substitute host containment or zero scrolling for those assertions.
- [ ] Run `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/station-table.test.ts -t 'Prep headings wrap'`; observe red before adding the three column flags, then green after. Do not restore measurement probes.
- [ ] Run `pnpm --filter @waitron/ui exec vitest run src/components/wt-data-table.head-and-cells.test.ts src/components/wt-data-table.head-and-cells.test.ts src/components/wt-data-table.a11y.test.ts` and `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/station-table.test.ts src/dashboard/station-table.a11y.test.ts src/dashboard/prep-stations-screen.test.ts`; require real nonzero Tests counts, token checks and axe in both themes.
- [ ] Check browser headroom first (`memory_pressure | grep free`); run sequentially beside other lanes and never beside whole-workspace coverage. Inspect the real Prep screen at 390/1280, both locales/themes, using `wa-wt demo waitron-fix-d-phone-width`; record heading/body widths and screenshots outside Git, including dashboard shell padding.
- [ ] Update the named docs from those results: explain the optional cap and remaining body scrolling, remove only A1318's delivered heading-option claim; retain unresolved reports. Keep guide instructions action-oriented and shared section IDs intact.

## Deferred reports and delivery

If Seasons/Preview need more work, reproduce the concrete full-screen failure first with the current row layout/live Preview and final refusal. A later production change requires an observed red behavioral test and watcher clearance covering that fix; otherwise stop at this checkpoint for those reports.
One PR for the cleared build. Driver uses `finish-branch`: initial rebase, two Claude run-it whole-branch reviews for the UI/venue contract, triage/fix findings and a fresh Claude read of fixes; plan review does not replace these built-work reviews.
Use signed-off commits, the normal pre-push hook and required CI on the current head; no whole-workspace local run solely for finishing. Report precise remaining scope and current-head checks. The owner already authorizes finish-branch and land-branch; watcher clearance of this plan is the prerequisite, not another owner approval.
