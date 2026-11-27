# Lane F · 2b · Till floor clock status

**PLAN FOR APPROVAL.** On #4462 at `3bb441144eadc306658d99ed6c1e391ccb746e78`, using #4449’s shared actions. The watcher’s 26 November 20:45 note clears the pass-2 split and names the approved frame `aj` 1. The 27 November 03:07 note says “Plan 2b next (one page, Claude read, PLAN FOR APPROVAL), building on #4462's branch until it lands.” This clears planning. [Split](2026-11-26-till-handheld-redesign-pass-1.md) · [Design §§9.9 and 14.3](../specs/2026-11-26-till-handheld-redesign-design.md).

## Read the start of the open shift

Add `shiftStart` to `TillClockState` in `apps/server/src/till-clock-state.ts` and `apps/till/src/api/attendance-api.ts`. It carries `eventAt` and `offsetMinutes`, or `null`. For a working or break state, move the existing `readLatestLiveEntry(tx, personId, { kind: "in" })` call into the state read. Return the filtered instant beside the state inside the server. `apps/server/src/attendance-discovery.ts` uses that instant to reconcile the same business day as before. `apps/server/src/till-clock-api.ts` sends only the state on GET and after each POST. Keep the existing first-clock-in and latest-entry checks, transactions, writes and permissions.

If the latest live entry is an `in`, display its time. After a break starts or ends, display the filtered start only when it precedes that entry in the same box’s record sequence, or has an earlier instant if it came from another box. Otherwise leave the line blank. This keeps a later-dated clock-in from a previous shift off the new shift’s display. Leave the workforce lookup unchanged. The proposed label follows the live shift’s recorded time. My hours applies approved retimes. The watcher will settle which time to show and whether the label needs a date for an overnight shift before the build starts.

## Show it in narrow floor More

Use the existing till state and refresh path. Pass the available start into `floorOperatorLine` on the existing template line in `apps/till/src/widgets/till-shell.ts` to stay within its 1,750-line cap. In `apps/till/src/widgets/floor-bar.ts`, put the muted 13 px time below the name in narrow floor More. Use `storedAttendanceTime` in `attendance-history.ts` for the stored offset. Keep the outlined **Clock out** and its action. Use `apps/till/src/i18n/strings.ts` and the `withHourArticle` pattern for “Clocked in at 17:02”, “Entrada fichada a la 01:02” and “Entrada fichada a las 17:02”. Update `{#unsent-tables}` in `apps/server/src/guide/{en,es}/table-service.md` and the redesign entry in `docs/backlog.md`. Wide More stays for the wide floor slice. Compare with `aj` 1 at 390 px in both themes for Lane P and the owner before landing.

## Checks and size

Run the new assertions first and confirm they fail for the missing time. Rerun after implementation.

- In `apps/server/src/till-clock-state.test.ts`, check the approved missing clock-in’s instant and offset, the watcher’s retime decision, and the start after an old later-dated approved clock-in, clock-out and a new start on a different box. Cover out and a break with no reliable start. In `till-clock-api.test.ts`, update “allows admitted staff with only clock-in and no service-zone access” to expect the same start through both break actions, `null` after clock-out, and a matching GET after each POST. Update both files’ exact whole-state expectations. Run `till-clock-step.test.ts` (business day after the backward step, later-dated approved clock-in, two chain-head reads on ordinary and break GETs) and `till-clock-attendance.test.ts` (cutover).
- In `apps/till/src/widgets/till-shell.device-zones.test.ts`, open bottom-bar More at 390 × 844. Use `16:02Z` with `+60` minutes to expect `17:02` beneath the name, with one Clock out button that emits its existing action. In Spanish also check `01:02`. Check the same text on a break and its absence when out, signed out, unavailable or missing the start. Restore locale and viewport.
- Update the round-trip fixture in `apps/till/src/api/client.clock.test.ts`, the state fixtures in `apps/till/test/clock-app.ts` and `apps/till/src/state/clocking.test.ts`, and the `apps/till/src/widgets/` fixtures in `till-shell.test.ts` and its `a11y`, `counter-cleanup`, `device-zones`, `handheld-bar`, `help.a11y` and `menu-help` sibling suites. Run focused tests, server and till typechecks, `apps/server/src/guide-content.test.ts` and `scripts/guide-links.test.ts`.

Allow roughly 60–85 product lines and 85–120 test lines, plus the guide and backlog edits.
