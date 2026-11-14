# A1538: Calendar selections and quieter painters

**Request:** `docs/backlog.md`, A1538 (owner, 2026-11-14); Lane K queue. **One PR:** gather dates in Year/Month, see/clear the selection and open Make a special day with exactly those dates; quieter painters. Separate Sol-high draft, checked/condensed by the driver; implementation awaits Claude review and watcher clearance. No owner design approval is claimed.

`D` below means `packages/venue-service/src/dashboard/`. Reuse DayPicker, URL state, existing painter drafts, period dialogs and date formatting. No migration, server policy, automatic merging of stored special days, new store or staffing changes.

## Build inline, test first

- [ ] **Selection:** extend `D/day-picking.ts` with opt-in exact-date selection for `D/opening-hours-{year,month}.ts`. Sorted unique dates; Shift extends the anchored run; Cmd/Ctrl toggles independent dates. Double-click/Enter on a picked date retains every selection despite preceding clicks. Touch taps toggle while 2+ dates are selected. Preserve long press/drag, cancellation, focus, read-only/station restrictions and existing navigation resets. Trace all consumers; `D/add-dates-calendar.ts` keeps its contiguous run/ranged behavior.
- [ ] **Bar:** shared rendering/styles in `D/calendar-selection.ts`, below Year/Month: live localized count and date summary, Clear, Make a special day for 2+ dates. Show gaps as separate groups; wrap at phone width. Clear restores date focus. Change `CalendarDaysOpen` in Month to carry `{date, dates}`; bar and gesture use the same screen handler.
- [ ] **Route/draft:** adapt `D/opening-hours-{paths,screen}.ts` and `D/special-day-painter.ts`. Keep contiguous date/to and stored-id links; use a dates/comma-separated-ISO-list part for disjoint dates. Validate the whole list, sort/deduplicate, retain the existing `HOURS_RANGE_MAX_DAYS` bound; invalid lists open an empty draft. Add value-compared `initialDates` to existing seeding/seedKey so rereads preserve paint. Trace `period-dialog.ts`/`periods-list.ts` path consumers; reuse Back, close, discard and existing save input.
- [ ] **Quiet painters:** replace special.explain/paint hint with one special-day help-mode bubble; give `D/season-painter.ts` its own bubble, EN/ES, written from underlay/replacement/Closed behavior with guide links. `D/paint-row.ts` keeps pencil only, localized accessible name and hover title. Remove painter Periods links and unused `D/period-editing.ts` helper; retain inline edit/+New period. New words in `D/strings.ts`; keep staffing's shared painter.hint unchanged.

## Diagnosis and watcher decision

Driver baseline on `3e3198bab6`: `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/opening-hours-screen.special-day.test.ts -t 'a double-click on'`, four passed in an isolated temporary checkout. Ordinary Year/Month ranges open whole; stored-date cases explicitly open that saved record, ignoring the run (`opening-hours-screen.ts:1160`). This verifies one selection-ignoring path, not the owner's exact sequence. Retain ordinary-range checks; reproduce any remaining loss with real gestures before fixing it.

**Recommend for clearance:** multi-date actions always start a new exact-date draft, including a stored trigger; single-date opens still edit the stored day. Keep existing occupied-date refusal/draft retention, no reassignment (`special-days.ts:696,927`; `special-day-painter.ts:973`).

## Tests and verification

- [ ] Picker behavior belongs in `D/day-picking.test.ts`; run existing `add-dates-calendar.test.ts` unchanged. Bar/action/phone/gating checks belong in `opening-hours-month.test.ts`; Year checks only its wiring/reset. Reuse month fixture and existing gesture commands.
- [ ] `opening-hours-paths.test.ts` owns encoding; `opening-hours-screen.special-day.test.ts` owns one disjoint selection/address/direct-load/Back flow and stored-trigger policy. `special-day-painter{,.save,.unsaved}.test.ts` owns exact seeds, value-based refresh, submitted dates and retained refusal/draft. Reuse special-day painter fixture.
- [ ] Existing season/special painter tests own help/pencil/inline-edit behavior; extend their and Year/Month `.a11y.test.ts` suites. Replace obsolete Periods-link checks in both `opening-hours-screen.{painter,special-day}.test.ts` and dashboard `dashboard-app.search-modules.test.ts`, preserving independent window/history and draft assertions through remaining entry points. Document changed checks in PR.
- [ ] Run named changed files with `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/<file>`; dashboard test through its package. Observe red before implementation, then green. Sequential browsers with >15% free memory; no whole-package local suite. Inspect EN/ES, light/dark, phone/desktop and help off/on; screenshots local only.
- [ ] Update EN/ES `apps/server/src/guide/*/opening-hours.md`, `docs/developers/design-system.md`'s painter-link claims and A1538 backlog entry. Run guide-content, guide-links and help-tooltip-mode guards. Then finish-branch, normal hook and current-head scoped CI. Lane D overlaps are resolved on rebase, never waited on.

**Estimate:** production +260/−90, tests +280/−260, support +10/−0: 900 changed lines plus prose; outside opinion at 1,350. Three active hours to PR, excluding recorded watcher/outage waits. Run changed tests before a size checkpoint; no build before watcher clearance.
