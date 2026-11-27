# A1418 failed destination wording

When a saved copy fails during checked shutdown, Box status names the folder or bucket beside the
reason. An administrator can identify which copy to fix, then use the existing retry, cancel or
unchecked shutdown choice. The watcher assigned this slice on 27 November at 15:05, after direct
bucket catch-up (#4510). The [approved design](../specs/2026-11-07-a1418-box-stop-intent-design.md#4-shut-down-this-box)
requires the screen to say what happened when a backup cannot finish.

1. **Keep the failed destination with this run.** `apps/server/src/backup-sweep.ts` already associates
   upload results with `backend.id`, but checked shutdown currently throws just the first rejected
   upload in configuration order. Pass a shutdown-only `onDestinationFailure(id)` observer through
   `start` and `runOnce`. Call it for that selected upload and from `admin-shutdown-backup.ts` for a
   failed read-back or digest mismatch. Scratch space, restore rehearsal and other shared failures
   keep their existing reason without a destination. In `backup-supervisor.ts`, resolve the id against
   the config captured by `runForShutdown`. Report the same location Backups shows (`dir` or
   `bucket/namespace`, using `destinationView`), without passing backend settings or error text.
2. **Show the location in Box status.** `admin-shutdown-duties.ts` passes the observer from the
   check context. `admin-shutdown.ts` collects `failedDestination` inside that run and attaches it
   to the paused `view()` only. A retry gets a fresh value. The health read is already protected by
   `system.manage`, like backup settings. Keep the `node.manage` action replies and the incident and
   email payloads as they are. Extend the health type in `apps/dashboard/src/api/servers-api.ts`.
   Add a translated “Backup destination: {destination}.” sentence in `screens/box-status-screen.ts`
   and `i18n/strings.ts`, within the current status region alongside the existing reason. Render it
   as text. Update both server `guide/{en,es}/box-status.md` guides and the A1418 entry in
   `docs/backlog.md`. Stalled uploads, downloads, replica checks and appliance power-off are outside
   this slice.
3. **Prove the wrong and right results.** Extend `apps/server/src/backup-supervisor.test.ts` so the
   existing two-destination upload and corruption cases expect the selected location as well as the
   original reason. The space case observes no destination. In `boot.stop-mark.test.ts`, extend the
   failed-backup case so the health reply names the destination and a later failure without one omits
   it, keeping the existing email and no-mark assertions. In the dashboard
   `screens/box-status-screen.test.ts`, extend the existing paused case to see the location and
   reason beside the three choices. Run those changed files first with the expected missing location
   failures, then after the changes with `pnpm --filter @waitron/server exec vitest run
   src/backup-supervisor.test.ts src/boot.stop-mark.test.ts` and `pnpm --filter @waitron/dashboard
   exec vitest run src/screens/box-status-screen.test.ts`. Look at the existing screen with a long
   location in both languages and themes at phone and desktop widths.

Expected additions are 45–75 product lines and 25–50 test lines, plus the guides and backlog edit.
