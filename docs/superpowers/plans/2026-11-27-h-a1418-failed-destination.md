# A1418 failed destination wording

When a saved copy fails during checked shutdown, Box status names the folder or bucket beside the
reason. An administrator can identify which copy to fix, then use the existing retry, cancel or
unchecked shutdown choice. Lane H proposed this slice at 15:00 on 27 November. At 15:05 the watcher
assigned “(2) failed destination wording (small)” after direct bucket catch-up (#4510). The
[approved design](../specs/2026-11-07-a1418-box-stop-intent-design.md#4-shut-down-this-box) requires
the screen to say what happened when a backup cannot finish.

1. **Use the backup’s own results.** In `apps/server/src/backup-supervisor.ts`, collect existing
   `onDestinationResult` failures inside `runForShutdown`. In `backup-sweep.ts`, group the checked
   run’s existing `start` arguments into one options object with room for that observer. Compose it
   with the usual destination recorder for this invocation of `runOnce`. When the upload fails, use
   the first failed result in the captured config order if its upload error code matches the refusal.
   In `admin-shutdown-backup.ts`, report the destination id for a failed read-back or digest mismatch.
   Leave cancellations, shared scratch space and restore rehearsal failures without a location.
   Resolve the id against the captured supervisor config and pass only the Backups display location
   (`dir` or `bucket/namespace`, from `destinationView`). Preserve the original rejection.
2. **Show the location in Box status.** In `admin-shutdown-duties.ts`, pass the check context’s
   observer. In `admin-shutdown.ts`, collect the location afresh for each run. Store it beside the
   paused state and add `failedDestination` only in `view()`. The health read requires `system.manage`,
   like backup settings. Keep `status()` action replies, incidents and email as they are. Extend the
   paused health type in `apps/dashboard/src/api/servers-api.ts`. In `screens/box-status-screen.ts`
   and `i18n/strings.ts`, add “The affected backup destination is {destination}.” as plain text in
   the current status region alongside the reason. Update both server `guide/{en,es}/box-status.md`
   guides and the A1418 entry in `docs/backlog.md`. Stalled uploads, downloads, replica checks and
   appliance power-off are outside this slice.
3. **Prove the wrong and right results.** In `apps/server/src/backup-supervisor.test.ts`, extend
   the two-destination upload and corruption cases to check the selected location and original reason.
   The space case checks that it gets no location. In `boot.stop-mark.test.ts`, have the failed backup
   mock report the configured folder path and assert that it reaches health. The retry fails without
   a location and health drops the old one. Keep the email and no-mark assertions. In Dashboard’s
   `screens/box-status-screen.test.ts`, the health reply supplies the location beside the reason and
   existing choices. Run those changed files first with the expected missing location failures, then
   after the changes with `pnpm --filter @waitron/server exec vitest run src/backup-supervisor.test.ts
   src/boot.stop-mark.test.ts` and `pnpm --filter @waitron/dashboard exec vitest run
   src/screens/box-status-screen.test.ts`. Look at a long location in both languages and themes at
   phone and desktop widths.

Expected additions are 45–75 product lines and 25–50 test lines, plus the guides and backlog edit.
