# A1418 — Checked shutdown with a direct bucket copy

On a standalone main box with Cloud off, an administrator can use **Shut down this box** in
**Box status** over HTTPS. Waitron drains work and makes a checked backup. After saving the archive
or confirming the download, it checks the bucket copy before writing the shutdown mark and showing
**Safe to switch off**. If the bucket check fails, the administrator can retry with the same backup,
cancel and resume work, or explicitly shut down anyway. The next start uses the existing HTTPS
administrator hold.

**Basis.** A1418 in Lane H’s queue and the watcher’s 27 November 15:05 direction to qualify
the paired check for direct streaming. The watcher clears the reviewed plan before building.
[Shutdown design §4](../specs/2026-11-07-a1418-box-stop-intent-design.md#4-shut-down-this-box) · [Paired shutdown 6C](2026-11-27-h-a1418-paired-shutdown.md)

**Qualification.** On `7647fe0bab`, Litestream 0.5.18 and versitygw 1.8.0 synced row 1 to an
encrypted loopback bucket. A gate held the upload of row 2. The three-second probe check timed
out and a fresh restore still had `[1]`. After release, the CLI reported positions 2/2 and another
restore had `[1,2]`. This qualifies replication on loopback. The shutdown test below covers the
full flow. See Lane H `receipts/a1418-direct-bucket/qualification.log`.

1. **Check the running copy.** In `apps/server/src/stream-host.ts`, enable the same private sync
   socket per direct child. Keep the launch settings and term with the supervisor, clearing them on
   retirement and failed start. `checkDirectShutdownUpload(settings, signal)` checks the target
   before calling the supervisor and again in `sameTarget` after sync. Both reads match launch,
   requested and current settings, including credentials, and require the same supervisor and term,
   primary role, no stored pair link and no non-evicted peers. Reuse the child and generation checks
   and 30-second CLI deadline per attempt. Update the socket comment in `packages/stream/src/supervisor.ts`.
2. **Reuse the paired finish step.** In `apps/server/src/admin-shutdown-duties.ts`, move the
   streaming refusal into the paired branch. Keep saved destinations or, with no saved settings,
   the numbered-key download. Capture direct settings after work drains. In
   `apps/server/src/admin-shutdown.ts`, rename `checkSpare` and `spareCheckPending` to `checkReplica`
   and `replicaCheckPending` and use the same late check. A configured bucket that is offline,
   changed or unconfirmed pauses before the mark with `box.shutdown_bucket_unchecked`
   (`apps/server/src/errors.ts`) and the existing alert and choices.
3. **Show progress.** Carry `directBucket` in the shutdown mode through `apps/server/src/box-health.ts`
   and `apps/dashboard/src/api/servers-api.ts`. In `apps/dashboard/src/screens/box-status-screen.ts`,
   keep it across action replies, explain the bucket check and leave the existing Bucket copy lag
   visible through `box-status-rows.ts`. The shutdown phase determines readiness. In
   `apps/dashboard/src/screens/box-shutdown-actions.ts`, label the bucket failure’s action **Retry
   check**. Update English and Spanish in `apps/dashboard/src/i18n/{codes,strings}.ts` and remove
   the obsolete standalone instruction to turn off the bucket copy (`codes.test.ts` pins it).
   Update both `apps/server/src/guide/{en,es}/box-status.md` guides and the A1418 backlog entry.
4. **Run the tests red before building, then green.** Add `apps/server/src/direct-bucket-shutdown.e2e.test.ts`
   to `test-server-stream` in `.github/workflows/ci.yml`, its ordinary-shard exclusions and the
   file list in `scripts/ci-workflow.test.mjs`. Reuse `apps/server/src/testing/{stream-box,s3-test-server,recovery-key}.ts`
   and extract only the PUT hold from `apps/server/src/testing/paired-shutdown-scenario.ts`.
   Configure its endpoint in `switchOnStreaming`. Over retained HTTPS, hold every `.ltx` PUT for the
   live generation before the final write. Confirm the download and observe a held PUT, then assert
   `box.shutdown_bucket_unchecked`, no mark and an older restore while still held. Release, Retry,
   then assert ready, the mark and a restore with the write. On base expect `409 box.shutdown_unavailable`.
   In scratch, force the direct check to succeed and watch the pause/no-mark assertion fail.
   Budget 210 seconds (60 for startup, 25 for the download, 70 for two syncs, 40 for two restores,
   15 for Retry and cleanup). Require both binaries. Compare stream-job time before and after in
   healthy CI. Run `stream-loop` and `stream-pause`.
   In `apps/server/src/boot.stop-mark.test.ts`, replace the refusal with saved-path admission and
   pause without a mark. In `apps/server/src/stream-host.test.ts`, cover matching and changed direct
   settings, missing supervisor and a replaced one. Keep `supervisor.test.ts` for the command and
   `admin-shutdown.test.ts` for download order and decisions. Cover the copy in `box-status-screen.test.ts`
   and run the size guard. Run the unchanged fiscal goldens, `inmutabilidad` and the menu gates.

Estimate 110–160 added product lines and 250–350 added test lines. Cloud backup, spare shutdown and
return, and appliance power-off are later slices.
