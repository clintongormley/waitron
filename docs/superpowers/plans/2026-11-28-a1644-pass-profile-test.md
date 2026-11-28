# A1644 Pass-profile handheld test plan

The till test can read two different layouts at the browser's default width. The isolated case failed at the header-button presence assertion on `036b5781ef`. The 333 px failure picture shows the Floor's bottom controls. `TillShell.#observe` switches to those controls after it measures a width under 800 px. The wide layout renders Pass in More, while the narrow layout renders it in the Floor zone chooser. Waiting for the observer at 333 px would leave the header selector looking for Pass in the narrow layout. The existing narrow keyboard case in `till-shell.device-zones.test.ts` exercises the zone chooser.

- [ ] Keep the Pass-profile case in `apps/till/src/till-app.test.ts`. Reuse `page.viewport` and the file's `try`/`finally` pattern to set 1280 × 900 before `signIn` and restore the previous viewport afterward. Keep the existing profile, affordance, Station absence, and Pass, Schedule and Find a bill presence assertions. The case owns the wide layout check.
- [ ] From `apps/till`, run `pnpm exec vitest run src/till-app.test.ts -t 'gives a handheld with a Pass profile only Pass and Schedule'` in 30 fresh processes. Each must run and pass exactly one case. The unedited case has already failed in one fresh process with `expected null not to be null`.
- [ ] Delete the Pass-profile incident paragraph from `docs/backlog/ci.md` in the same PR. Commit with sign-off and follow the normal branch review, push and CI checks.

Expected size is zero product lines, under 20 added test lines and one backlog paragraph removed. Scope is the existing test fixture and backlog entry. A fixed wide viewport keeps the observer from switching the layout during the assertions.
