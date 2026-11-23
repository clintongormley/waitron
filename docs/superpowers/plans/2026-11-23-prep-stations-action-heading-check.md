# Check the Prep stations Actions heading after the icon change

After #4135, the two existing 390 px browser cases count the visually hidden Actions
label when measuring visible text. Restore those tests so they can catch wrapping and
unreachable menu buttons again. Lane H’s watcher assigned this single-file fix on
23 November at 20:18.

Change only `packages/venue-service/src/dashboard/station-table.test.ts`. Keep both
languages and the existing fixture, width, wrapping, read-out and menu-reach assertions.
Use the same browser accessible-name assertion as the scheduled menu publications test
to check the action column’s localized name. Check the rendered heading icon using
the same browser visibility assertion. Skip visually hidden text when measuring
text rectangles. No production markup, CSS, dependencies or CI changes.

Run `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/station-table.test.ts`.
The current code fails the English and Spanish 390 px cases. The adjusted test must pass
all 23 cases. In the disposable run-it checkout, remove the hidden label and check that
the accessible-name assertion fails. Keep the full visible-text and menu geometry checks.
The package’s pull request CI runs the other Venue service suites.

Production +0/−0. Expected test change about +9/−1 lines. Review and land this fix separately,
then rebase the receipt package PR #4159 on the fixed main.
