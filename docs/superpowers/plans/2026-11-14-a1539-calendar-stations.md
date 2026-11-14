# A1539: Calendar prep stations

**Finish line:** One PR: compare stations in Month/Week; departments then stations in Week; identify stations everywhere; reach Periods. Authority: `docs/backlog.md:708–727`, owner 2026-11-14, watcher queued 19:32. Sol-high proposal: Claude review and watcher clearance required; no owner plan approval claimed.

**Scope:** Read-only, no migration. Build after A1537 without reproducing its merged-hours/bar-click work. Exclude A1538 chrome and new infrastructure; preserve permissions/passive reads.

Below, **D** = `packages/venue-service/src/dashboard`, **U** = `packages/ui/src/components`, **C** = `packages/country-es/src/demo`. Braces enumerate files.

- [ ] **Choices and consumers.** Change D/`calendar-show.ts`: pickable “Show all” (Week only), “All departments”, indented departments, “All prep stations”, indented stations; default remains All departments. Reuse combobox `depth`, `fixed` and option `icon`, removing non-pickable headings. Keep picker `all`/empty department meaning; add `show:stations`/`show:all`, stored as `/show/stations|all`, separately from station IDs. Trace D/opening-hours-screen.ts consumers: URL registration/read/write, Back/direct load, view/date navigation, selection, watches/errors, pop-up actions and reconnection. Week→Month maps Show all to All prep stations; Year clears combined choices. Viewers ignore them without station reads. Never send combined values to station endpoints.
- [ ] **Rows and reads.** Extend D/`station-show.ts`, `week-rows.ts`, `opening-hours-{month,week}.ts` and screen. Reuse `activeStationsInOrder`, `monthWeeks`, `stationShowModel`, `MonthWatch` and existing `OpeningHoursApi.watchStationTimes`, following each active station only while needed. Dispose obsolete watches; reject stale callbacks. Aggregate sending ranges into one row per station; retain period detail and individual-station sender rows. Combined Week appends station rows after departments. Keep empty stations as “No orders”; default gets an Always open row. Never label loading/failed reads as No orders.
- [ ] **Identity and explanation.** Add a prep-station icon in `apps/dashboard/src/icons.ts`; use it on station rows, selected options and station pop-up titles in the views and D/`calendar-day-box.ts`. U/`wt-combobox.ts` gains opt-in selected-icon rendering. Give spoken names localized station context. D/`strings.ts` owns EN/ES wording: permanently beneath Show; repeated instead of special-day/week editing actions in station-containing pop-ups. Preserve Open this week. Derive wording from `stationServiceTimes` → `readPlannedServiceGuides`: menus, routing and open sending zones determine planned times; default is always open. Link to A1536's exported Periods page path when landed, otherwise existing `periodsWindowPath`/Calendar window; reuse D/`opening-hours-paths.ts` and close-before-navigation.
- [ ] **Demo and docs.** Change only translated station-name values in C/`casa-delgado-es.ts`: name them Downstairs bar prep, Upstairs bar prep and Deli prep, translated in en/es/ca/ca-ES-valencia/gl; regional demos inherit them. Preserve IDs, routing, menus and Lane C A1541 seed edits on rebase; never touch its checkout. Update `docs/developers/design-system.md`, `apps/server/src/guide/{en,es}/opening-hours.md` with shared IDs, and remove delivered A1539 from `docs/backlog.md`. Keep general code English; translations in declared homes.

**Tests (TDD):** D/`station-show.test.ts` owns aggregation/order/default/empty; `calendar-station-month.test.ts` owns multiple passive watches, stale/removal/failure recovery and address round-trips; `opening-hours-screen.week.test.ts` owns exact picker order/default/indent, Week-only combined mode, viewer gating and station pop-up explanation/actions/link. D/`opening-hours-{month,week}.test.ts` own rendered station rows/icons and phone layout; `calendar-day-box.test.ts` owns optional title/row icons. U/`wt-combobox.test.ts` owns selected-icon changes; C/`data.test.ts` owns every-language station/zone distinction, retaining existing data assertions. Extend existing component/screen a11y suites in both themes. Reuse existing month/station fixtures; no new support library.

**Focused commands** (require Tests counts):

```sh
pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/{station-show,calendar-station-month,opening-hours-screen.week,opening-hours-month,opening-hours-week,calendar-day-box}.test.ts src/dashboard/{opening-hours-screen,opening-hours-month,opening-hours-week,calendar-day-box}.a11y.test.ts
pnpm --filter @waitron/ui exec vitest run src/components/wt-combobox{,.a11y}.test.ts
pnpm --filter @waitron/country-es exec vitest run src/demo/{data,regional}.test.ts
pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts
```

Inspect EN/ES, light/dark, 390/1280px: picker open/closed, identical zone/station names, combined ordering, pop-up/link/focus. Finish-branch, hook and current-head scoped CI follow; no whole-package local run.

**Added/removed forecast:** production **+280/−85**; tests **+250/−75**; test support **+0/−0**; docs including this plan **+110/−40**. Stop for outside opinion at1,260lines.
