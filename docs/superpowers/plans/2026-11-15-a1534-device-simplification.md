# A1534: Plain devices and profile-owned station screens

**Authority:** `docs/backlog.md` A1534 at `9881fd30e6`, owner commit `2864b8cc51`; Lane F queue. Codex draft, source-traced only; Claude review and RUNNER watcher clearance pending. No owner plan/design approval claimed.

**Finish/reuse:** devices inherit profile scope; kitchen profiles choose one Station, Pass or Pass display under **Station screens**. Reuse scope/equipment readers, combobox empty styling, draft scopes and search declarations. Preserve action/person/device gates, switching, routing, replay and live revisions. No framework, compatibility/data migration or fiscal changes.

Prefixes: D=`apps/dashboard/src`, S=`apps/server/src`, T=`apps/till/src`, V=`packages/venue-service/src`, B=`packages/db/src`, U=`packages/ui/src`. Each slice targets one usable PR within three working hours.

## 1. Calm focus after editing

First reproduce mouse-open row A, type, save/cancel/close, pointer over B. Record focus, outline/background and hover states; distinguish any separate two-row fault before fixing. Change `U/components/wt-data-table.ts`, `wt-modal.ts` and its inherited return-focus code in `wt-dialog.ts`. Keep opener focus without mouse-origin return decoration; keyboard opening/navigation stays visibly focused. Preserve hover/selection. Shared browser tests own opening methods, typing and closure.

`pnpm --filter @waitron/ui exec vitest run src/components/wt-modal.test.ts src/components/wt-data-table.test.ts`

## 2. One kitchen profile, one working display

In `D/screens/device-profiles-screen.ts`, replace KDS switches with one required selector and existing scopes; retain error-field tabs, marks and drafts. Hide kitchen printer/drawer fields and empty equipment tab; table cells empty. `V/kitchen-screens.ts` resolves KDS from its single profile view; Pair/Edit choose only profiles. Update `S/management-api.ts`, `device.ts`, `join-requests.ts`, import/copy checks, `S/testing/enrol.ts` and `apps/server/scripts/dev-setup.ts`. Demo/test displays needing different views need different profiles. Ordering profiles keep their screens.

Service tests own count/scope/copy; dashboard owns controls/tab errors; server owns pairing/session effects.

`pnpm --filter @waitron/venue-service exec vitest run src/kitchen-screens.test.ts`

`pnpm --filter @waitron/dashboard exec vitest run src/screens/device-profiles-screen.test.ts src/screens/devices-screen.test.ts`

`pnpm --filter @waitron/server exec vitest run src/management-api.device-profiles.test.ts src/device-api.test.ts scripts/dev-setup.test.ts`

## 3. Tills and handhelds inherit kitchen scope too

Remove kitchen overrides, including `T/screens/till-pass-screen.ts`'s Columns override/API write. Keep profile screen flags, unbounded Station/Pass fallbacks and ordering profiles' multiple views. Drop Shows, four `device_kitchen_screen*` tables from `B/schema/venue-service/kitchen-screens.ts`, narrowing/removal machinery and obsolete module contracts.

Consumers: `S/device-api.ts`, `device-levers.ts`, `station-today-api.ts`, `pass-release.ts`, `pass-coverage.ts`, `station-outputs-down.ts`; `V/station-delete-settings.ts`, `service-delete-settings.ts`, configuration-transfer/classification; `B/index.ts`, live dependencies, start/identity, search, `S/testing/kitchen-screen-device.ts` and bench/demo. Preserve gates, off-station handling and deletion refusals against inherited bindings.

Service owns resolution; server gates/deletion/coverage; till live views; dashboard surviving search entry points.

`pnpm --filter @waitron/server exec vitest run src/device-api.pass.test.ts src/till-api.profile-actions.test.ts src/till-api.profile-zones.test.ts src/station-delete.test.ts src/pass-coverage.test.ts src/station-outputs-down.test.ts src/configuration-transfer.floor-kitchen.test.ts`

`pnpm --filter @waitron/till exec vitest run src/screens/till-station-screen.test.ts src/screens/till-pass-screen.test.ts`

`pnpm --filter @waitron/dashboard exec vitest run src/screens/devices-screen.search.test.ts src/device-setting-search.test.ts src/dashboard-app.search-device-settings.test.ts src/api/live-queries.test.ts`

## 4. Eight ordinary fields and one made-here station

`D/screens/devices-screen.ts`: headed name/profile, Printers, Card reader, Made here sections. Inherited names alone use muted italics, including table parts; explicit values normal. Retain equipment/refusal/reader/loading behavior.

**This device stands at**: **Nowhere** default or one station; hint **Items for that station are made here: no ticket, not on kitchen screens.** Tills only. `B/schema/device-made-here-stations.ts`: device-only primary key, existing zero/one-element array. Update `S/made-here.ts`, `device-api.ts`, deletion/search. Database owns uniqueness; server replacement, independent tills, final routing and ticket/screen suppression; dashboard presentation/save state. Retain replay assertions. Retire A270 only when delivered; dated historical notes.

`pnpm --filter @waitron/db exec vitest run src/schema/device-made-here-stations.test.ts`

`pnpm --filter @waitron/server exec vitest run src/made-here.test.ts src/made-here.routes.test.ts`

`pnpm --filter @waitron/dashboard exec vitest run src/screens/devices-screen.test.ts src/screens/devices-screen.save-state.test.ts src/screens/device-edit.unsaved.test.ts src/screens/devices-screen.a11y.test.ts`

## 5. Service-zone interpretation for watcher clearance

`V/device-zone-selection.ts`, `/api/device/zones`, `T/state/device-zones.ts` and `till-app.ts` separately narrow navigation, not server authority. Does “no device narrows” retire this subset too? Recommend yes: retain starting-zone preference/form-factor navigation, remove `device_zone_selection_zones` and subset controls/writes. Preserve snapshots, live profile changes and open-order reconciliation.

Service/server/till tests own preference validation, request gates and navigation/reconciliation respectively.

`pnpm --filter @waitron/venue-service exec vitest run src/device-zone-selection.test.ts`

`pnpm --filter @waitron/server exec vitest run src/device-zones-api.test.ts`

`pnpm --filter @waitron/till exec vitest run src/state/device-zones.test.ts src/till-app-device-zones.test.ts src/widgets/device-zones-dialog.test.ts`

**Watcher judgement:** `approvedProfileIds` adds a ninth control. Recommend a separate dialog beside Profile retaining switching permissions. Confirm placement before slice 4; never silently drop it.

## Delivery and size

Build with observed red→green TDD; retain assertions, explain changed expectations. Run changed files; hooks/current-head CI own broader checks, never full local suites. Require actual EN/ES × light/dark × desktop/phone inspection; screenshots outside worktrees at `~/waitron-campaign-f/receipts/a1534/`, never committed; retain until watcher confirms shown.

Per slice update affected EN/ES `S/guide/{en,es}/{staff,kitchen-service,printers,table-service}.md`, retaining anchors; developer claims/backlog too. Date delivery at `docs/superpowers/specs/2026-10-07-service-times-departments-and-stations-design.md` §9.4.

Migration PR first line: **Every venue resets.** Venue-service is hosted in core (`packages/migrations/migrations.manifest.json`). TypeScript schema then `pnpm --filter @waitron/server migration-baseline rebuild --set core`; never hand-edit generated files.

`pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/starting-migrations.test.ts`

`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts`

Near RUNNER H2 invariants, stop for watcher judgement; run unedited golden huella: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts`.

Forecast physical additions/removals, unmeasured:

| Slice | Production | Tests | Test support | Generated | Prose | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | +55/−10 | +75/−0 | 0/0 | 0/0 | +10/−0 | 150 |
| 2 | +220/−160 | +190/−95 | +35/−20 | 0/0 | +35/−25 | 780 |
| 3 | +160/−1500 | +220/−1400 | +45/−130 | +25/−820 | +65/−95 | 4460 |
| 4 | +280/−260 | +180/−120 | +20/−15 | +25/−45 | +35/−30 | 1010 |
| 5, proposed | +90/−450 | +200/−750 | +20/−30 | +15/−150 | +35/−45 | 1785 |

Slice 3 removes substantial obsolete code/tests; generated counts include baseline SQL/snapshot/journal/epoch. At 1.5× size or three working hours, stop and refer growth/splitting to watcher; never weaken tests. Driver arranges Claude review, at most one corrections read, RUNNER clearance before publication/build, then finish-branch per slice.
