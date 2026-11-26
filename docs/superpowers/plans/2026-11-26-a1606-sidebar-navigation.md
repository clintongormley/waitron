# A1606 PR 1: Dashboard navigation

Use the [approved spec](../specs/2026-11-26-dashboard-sidebar-and-account-menu-design.md), decisions 1–4.
Staff see the specified section and page order in both languages, open Bookings directly below
Overview, and open Rota from Team while Calendar stays under Venue setup. PR 2 owns the full
sidebar styling and icon refresh. PR 3 owns the banner and account menu.

1. In `apps/dashboard/src/dashboard-app.ts`, reorder `NAV_GROUPS` and sort core and module rows by
   one numeric order per section. Keep the surviving group ids and remove `itemsAfterModules` and
   Service. Preserve access and fallback by choosing Overview for `venue.view`, then checking the
   existing priority of restricted core destinations before the current module and schedule fallbacks.
   Set page order in `packages/{adjustments,bookings,fiscal-verifactu,media,staffing,venue-service,workforce}/src/dashboard/index.ts`.
   Bookings declares its event icon in the existing pinned group. Add the glyph to `icons.ts` and
   retain `section-service` for department settings. Give Overview and Bookings direct folded buttons
   with the existing icon treatment. The staff-only Overview strip button still opens its two-row panel.
   In `i18n/strings.ts` and `screens/payments-screen.ts`, apply the new section names and use Card readers
   for the sidebar and page heading. Drop the duplicate subheading and keep the table's accessible name.
2. In `packages/dashboard-kit/src/contract.ts`, add optional pinned-page icons and Calendar sidebar
   placement (`group`, `order`). Staffing declares Team placement on the existing view and reuses its
   Rota label. Derive the row from readable Calendar views and require access to the parent. Give the
   row its own key. Open `/opening-hours/view/rota` with the existing draft guard. Calendar from Rota
   opens Opening hours with a fresh path. In `#onHistory`, update the current row and open its group
   when the accepted Calendar view changes between rows, including on Back. Keep manual collapse on
   same-row changes and a single `aria-current="page"` in the expanded nav and folded panel. In
   `nav-destinations.ts`, drop duplicate direct matches for Rota and Card readers, keeping deeper
   Calendar and reader-settings matches.
3. Write and run the failing checks first. In `dashboard-app.test.ts` assert the shipped order and
   labels in both languages and preserve Handover intervals as the fallback for `report.view` plus
   `system.manage` without `venue.view`. In `dashboard-app.module-order.test.ts` test interleaving and
   stable ties. In `dashboard-app.search-destinations.test.ts` cover Rota's access, draft prompt, current
   row, Calendar return and Back. In `dashboard-app.sidebar-fold.test.ts` cover the direct Bookings
   button and its visibility. Adjust assertions the spec changes in `dashboard-app.module-screens.test.ts`,
   `nav-destinations.test.ts`, `screens/payments-screen.tabs.test.ts`, `packages/dashboard-modules/src/registry.test.ts`
   and the dashboard `index.test.ts` files in adjustments, bookings, staffing, venue-service and workforce.
   Keep the other assertions and run all changed Vitest files again.
4. Grep both server guide languages for the old headings and moved page names. Follow those matches,
   including Appearance, Content languages and the Rota instructions in `opening-hours.md`. Keep
   section anchors and run `guide-content.test.ts` and `scripts/guide-links.test.ts`. Amend the pinned
   rows' description in `docs/developers/design-system.md` and record the remaining slices in
   `docs/backlog/dashboard.md`. Check EN and ES in both themes at 1440 and 390 px, the strip at 1024 px
   and the account menu with many languages. Send pictures to the watcher for the owner's decision.

Estimate 230 production additions and 105 removals, 180 test additions and 100 removals, plus guide
wording. The change spans the dashboard contribution contract and permission filtering, so use two
Claude run-it reviews at finish-branch.
