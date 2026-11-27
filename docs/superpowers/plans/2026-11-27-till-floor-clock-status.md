# Lane F · 2b · Till floor clock status

**PLAN FOR APPROVAL.** Stacked on #4462 at `3bb441144eadc306658d99ed6c1e391ccb746e78`, using the shared actions from #4449. The watcher’s 27 November 03:07 note clears planning. Build after Claude’s plan review and watcher clearance. [Pass 1 split](2026-11-26-till-handheld-redesign-pass-1.md), [approved design §§9.9 and 14.3](../specs/2026-11-26-till-handheld-redesign-design.md).

## Read the start of the open shift

Add `shiftStart` to `TillClockState` in `apps/server/src/till-clock-state.ts` and `apps/till/src/api/attendance-api.ts`. It carries just `eventAt` and `offsetMinutes` from workforce’s `TimeEntryRecord`, or `null` when out or when there is no start. Keep the latest entry and first-clock-in checks for their existing purposes. For working and break states, move the existing `readLatestLiveEntry(tx, personId, { kind: "in" })` call into the state read. In `apps/server/src/attendance-discovery.ts`, use `state.shiftStart.eventAt` to choose the day to reconcile. Keep the filtered lookup even if the latest entry is an `in`. In `packages/workforce/src/record-reads.ts`, the filter changes the candidates across nodes and which approved missing-entry corrections qualify.

`apps/server/src/till-clock-api.ts` already returns that state on GET, rereads it after reconciliation when required, and reads it after each of the four POST actions. The attendance inbox and command routes in `apps/server/src/till-attendance-api.ts` also call reconciliation. Keep the existing transactions, attendance writes, signed-in person and permission checks. `apps/till/src/state/clocking.ts` passes initial, refreshed and post-action snapshots to `apps/till/src/till-app.ts`, which passes the state to the shell. Use that path and its existing refreshes.

## Show it in narrow floor More

In `apps/till/src/widgets/till-shell.ts`, pass the available state to `floorOperatorLine` only in narrow floor More. Keep the shell within its 1,750-line cap by putting the display logic and styles in `apps/till/src/widgets/floor-bar.ts`. Under the signed-in name, show the muted 24-hour time using the `HH:mm` portion of `storedAttendanceTime` from `apps/till/src/widgets/attendance-history.ts`. Use the stored offset. Keep the existing outlined **Clock out** at the right and its current action. Only show the time for a signed-in operator with an available working or break state and a recorded start. Add `clock.clocked_in_at` in `apps/till/src/i18n/strings.ts` with “Clocked in at {time}” and “Entrada fichada a las {time}”. Mention where to see it and clock out under `{#unsent-tables}` in both `apps/server/src/guide/en/table-service.md` and `apps/server/src/guide/es/table-service.md`.

## Checks and size

Run the new assertions first and confirm they fail for the missing time. Rerun after implementation.

- In `apps/server/src/till-clock-state.test.ts`, pin the approved missing clock-in’s instant and offset through a targeted retime. Cover `null` for out and a live break with no start. In `apps/server/src/till-clock-api.test.ts`, update “allows admitted staff with only clock-in and no service-zone access” to expect the same start through both break actions, `null` after clock-out, and a fresh GET matching each POST. In `apps/server/src/till-clock-step.test.ts`, keep the ordinary GET at two chain-head reads and check the same count on a break. Run `apps/server/src/till-clock-attendance.test.ts` for reconciliation at cutover.
- In `apps/till/src/widgets/till-shell.device-zones.test.ts`, open bottom-bar More at 390 × 844 in English and Spanish. Use `16:02Z` with `+60` minutes to expect `17:02` beneath the name, with one Clock out button that emits its existing action. Check the same text on a break and its absence when out, signed out, unavailable or missing the start. Restore locale and viewport.
- Update the round-trip fixture in `apps/till/src/api/client.clock.test.ts`, the state fixtures in `apps/till/test/clock-app.ts` and `apps/till/src/state/clocking.test.ts`, and the `apps/till/src/widgets/` fixtures in `till-shell.test.ts` and its `a11y`, `counter-cleanup`, `device-zones`, `handheld-bar`, `help.a11y` and `menu-help` sibling suites. Run focused tests, server and till typechecks, `apps/server/src/guide-content.test.ts` and `scripts/guide-links.test.ts`.

Allow roughly 40–60 product lines and 65–95 test lines, plus two guide edits.
