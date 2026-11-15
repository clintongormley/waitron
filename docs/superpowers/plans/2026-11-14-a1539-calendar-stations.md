# A1539: Calendar prep stations

_2026-11-15, A1546 slice 1 changes the Calendar presentation described below: default-station
reads now carry dated demand, station comparisons retain separate sending departments, and
Calendar uses Closed. The Staffing guide-band wording is unchanged. See
[the current Calendar contract](../../developers/design-system.md#calendar)._

**Finish line:** One PR: compare stations in Month/Week; departments then stations in Week; identify stations and reach Periods. Authority: owner’s request in `docs/backlog.md` A1539; watcher queued it 2026-11-14 19:32 (Lane D questions/queue). Separate Sol-high author; driver checked paths. Claude’s completed 379-second review is incorporated below; the watcher cleared reviewed head e3195b3dc0 on 2026-11-14 at22:56 (Lane D questions.md), inside the owner’s request. Publish after #3234 lands; build after A1537. No owner plan approval claimed.

**Scope:** Read-only, no migration. Build after A1537; reuse its merged-hours/bar-click work. Exclude A1538 chrome and new infrastructure. Preserve existing manager-only station admission and passive reads.

**Paths:** D = `packages/venue-service/src/dashboard`, S = its parent; U = `packages/ui/src/components`, C = `packages/country-es`.

- [ ] **Choices/address.** D/`calendar-show.ts`: pickable Show all (Week only), All departments, indented departments, All prep stations, indented stations. Keep existing all/empty department meaning. Separate `/show/stations|all` from station IDs; precedence station, valid show, department. Picking a station/department clears show. Trace screen registration, direct/Back loads, selection and navigation; show never triggers `namesWeek`. Year retains keys but ignores them; Month reads show/all as All departments without rewriting, so returning to Week restores Show all. Viewers ignore combined keys without station reads.
- [ ] **One read/rows.** S/`station-service-times.ts` adds one all-active-stations read using one `readPlannedServiceGuides` batch, retaining current date/42-day checks and default-always behavior. Add `/management-api/venue-service/stations/service-times` in `routes.ts` with existing viewed/session admission. D/`opening-hours-client.ts` adds one passive watch with existing station-times dependencies plus station-list dependencies; screen uses one `MonthWatch`, existing key checks and one loading/error state. Keep the individual read. Repurpose `stationShowModel`’s station branch to force one station row even with multiple sending departments; preserve individual-station sender breakdown. Reuse `activeStationsInOrder`, `monthWeeks`, `week-rows.ts`, `opening-hours-{month,week}.ts`; remove test-only Month `stationMode`. Show all appends station rows after departments. No orders applies per station, never hides department rows; loading/failure never means No orders.
- [ ] **Pop-ups/identity.** Individual station: its sender rows, name/icon beside the date. All stations: one row each. Show all: departments then stations, retaining department edit actions. Keep the season line and Open this week. Station-only pop-ups replace editing actions with the explanation; mixed pop-ups add it. Reuse D/`calendar-day-box.ts` optional title/row content. Add an attributed station icon in `apps/dashboard/src/icons.ts`, on rows, pop-up titles and picked options. U/`wt-combobox.ts` always draws the picked icon in normal/link triggers; optional `iconLabel` names it in trigger/options. No opt-in flag. D/`strings.ts` supplies EN/ES explanation beneath Show only when stations are offered: hours follow painted period times, menus, routing and sending zones’ closures; default is always open. Link to A1536’s Periods page when landed; otherwise `openWindow("periods")` on the current path, noted in PR.
- [ ] **Names/docs.** C/`src/demo/casa-delgado-es.ts`: Downstairs bar prep, Upstairs bar prep, Deli prep, translated in all five locales; preserve IDs and Lane C A1541 changes. Update C/`test-fixtures/demo/plain-name-changes.{en,es}.json`; never alter hash-pinned madrid-before-move captures. Update design-system, EN/ES opening-hours guides with shared IDs; delete delivered backlog entry.

**TDD/verification:** Existing tests own behavior: D/`station-show.test.ts` aggregation with two senders/order/default/empty; `calendar-station-month.test.ts` one read/recovery/address; `opening-hours-screen.week.test.ts` picker/admission/mixed actions/link; Month/Week/day-box tests render rows/icons; U combobox tests name/draw picked icons. Extend existing a11y suites in both themes. C demo data/regional tests retain assertions and check station/zone distinction in every locale. Server demo consumers retain assertions with renamed expected values.

Run focused files, requiring Tests counts:

```sh
pnpm --filter @waitron/venue-service exec vitest run src/station-service-times.test.ts src/routes.test.ts src/dashboard/{station-show,calendar-station-month,opening-hours-screen.week,opening-hours-month,opening-hours-week,calendar-day-box}.test.ts src/dashboard/{opening-hours-screen,opening-hours-month,opening-hours-week,calendar-day-box}.a11y.test.ts
pnpm --filter @waitron/ui exec vitest run src/components/wt-combobox{,.a11y}.test.ts
pnpm --filter @waitron/country-es exec vitest run src/demo/{data,regional}.test.ts
pnpm --filter @waitron/server exec vitest run scripts/demo-seed/{seed,seed-menus,seed-floor,seed.madrid-baseline}.test.ts scripts/dev-setup.test.ts src/guide-content.test.ts
```

Inspect EN/ES, both themes, 390/1280px: open/closed picker, identical zone/station names, combined ordering, pop-up/link/focus. No new support library. Finish-branch, hook and current-head scoped CI follow; no whole-package local run.

**Added/removed forecast:** production +330/−110; tests +300/−100; test records +20/−15; docs including plan +110/−40: **1,025 changed lines**, outside-opinion stop about **1,538**.
