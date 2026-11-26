# A1606 PR 1: Dashboard navigation

Use the [approved spec](../specs/2026-11-26-dashboard-sidebar-and-account-menu-design.md), decisions 1–4.
Staff see the specified section and page order in both languages, open Bookings directly below
Overview, and open Rota from Team while Calendar stays under Venue setup. PR 2 owns the full
sidebar styling and icon refresh. PR 3 owns the banner and account menu.

1. In `apps/dashboard/src/dashboard-app.ts`, give core rows a numeric order and sort them with the
   module rows once per section. Remove `itemsAfterModules` and Service. Keep the access checks and
   existing default-screen priority independent of the new display order. Set module order where
   each page is declared in `packages/{adjustments,bookings,fiscal-verifactu,media,staffing,venue-service,workforce}/src/dashboard/index.ts`.
   In `packages/dashboard-kit/src/contract.ts`, allow an unheaded module page to supply an icon.
   Bookings declares its own event icon and uses the pinned group with Overview. The folded strip
   gives each pinned page its own direct button with the page's accessible name. Use the current
   icon rendering and tokens, adding the Bookings glyph in `apps/dashboard/src/icons.ts`.
   Rename the sections and `/payments` page in `apps/dashboard/src/i18n/strings.ts`.
2. Add optional sidebar placement (`group`, `order`, `labelKey`) to `DashboardCalendarView`.
   Staffing declares Team's Rota link on its existing `rota` view. Build the row from the same
   enabled, readable Calendar views and require access to the parent Calendar. Keep a row's
   identity distinct from the mounted screen. Use the guarded navigation path with the full
   `/opening-hours/view/rota` destination. Clicking Calendar from Rota opens Opening hours and
   clears Rota's address fields. Reuse the existing Calendar parser, screen and draft prompt.
   Expanded and folded navigation follow the permitted view in the accepted URL, including tab
   changes and Back. Only the active row has `aria-current="page"`. Changes within one row leave
   manual collapse alone. In `apps/dashboard/src/nav-destinations.ts`, keep deeper Calendar search
   destinations and show a direct page match only once. Keep the reader-settings search working.
3. Write the failing browser assertions first. In `dashboard-app.test.ts` assert the shipped
   ordered groups and rows in both languages and keep the limited-role defaults and access checks.
   In `dashboard-app.module-order.test.ts` assert interleaving with core while keeping module ties
   stable. In `dashboard-app.search-destinations.test.ts` cover Rota's permission, guarded open,
   active row, Calendar return and Back. In `dashboard-app.sidebar-fold.test.ts` check the direct
   Bookings button and its absence without access. Adjust old placement assertions in those files,
   `dashboard-app.module-screens.test.ts`, `nav-destinations.test.ts` and
   `packages/dashboard-modules/src/registry.test.ts` where the spec moves the rows. Keep the other
   assertions. Run the changed Vitest files before and after the change.
4. Update the English and Spanish server guides that name the moved pages or old headings. Start
   with `opening-hours`, `staffing`, `bookings`, `servers`, `printers`, `modules`, `table-service`,
   `invoices`, `backup-recovery` and `fiscal-filing`. Keep section anchors and run `guide-content.test.ts`
   and `scripts/guide-links.test.ts`. Record the two remaining slices in `docs/backlog/dashboard.md`.
   Check EN and ES in both themes at 1440 and 390 px, the folded strip at 1024 px and the account
   menu with many languages. Send pictures to the watcher for the owner's decision before landing.

Estimate 220 production additions and 100 removals, 170 test additions and 90 removals, plus guide
wording. The change spans the dashboard contribution contract and permission filtering, so use two
Claude run-it reviews at finish-branch.
