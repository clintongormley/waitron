# Check the Prep stations Actions heading after the icon change

After #4135, the two existing 390 px browser cases count the visually hidden Actions
label when measuring visible text. Restore those tests so they can catch wrapping and
unreachable menu buttons again. Lane H’s watcher assigned this single-file fix on
23 November at 20:18.

Change only `packages/venue-service/src/dashboard/station-table.test.ts`. Keep both
languages and the existing fixture, width, wrapping, read-out and menu-reach assertions.
In the 390 px cases, use the scheduled menu publications test's browser accessible-name
assertion on `th[data-actions]` with `VENUE_SERVICE_STRINGS[locale]["prep.actions"]`.
When measuring text rectangles, skip nodes whose parent is inside `.visually-hidden`.
No production markup, CSS, dependencies or CI changes.

Run `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/station-table.test.ts`.
The current code fails the English and Spanish 390 px cases. The adjusted test must pass
all 23 cases. In the disposable run-it checkout, remove the hidden label and check that
the accessible-name assertion fails. Force the visible heading text to overflow and check
that the geometry assertion catches it. The package's pull request CI runs the other
Venue service suites.

Production +0/−0. Expected test change about +8/−1 lines. Review and land this fix separately,
then rebase the receipt package PR #4159 on the fixed main.
