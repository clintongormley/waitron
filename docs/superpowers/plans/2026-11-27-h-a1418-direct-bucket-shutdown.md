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
restore had `[1,2]`. See Lane H `receipts/a1418-direct-bucket/qualification.log`.

1. **Check the running copy.** In `apps/server/src/stream-host.ts`, enable the same private sync
   socket per direct child. Keep its launch settings and membership term with the supervisor until
   retirement. `checkDirectShutdownUpload(settings, signal)` matches the shutdown, launch and fresh
   settings, including credentials. Before and after sync, require a lone primary with the same term,
   no pair link and the same supervisor. Reuse the supervisor’s child and generation checks and its
   30-second CLI deadline per attempt. Generalise the socket comment in `packages/stream/src/supervisor.ts`.
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
   check**. Update `apps/dashboard/src/i18n/{codes,strings}.ts` in English and Spanish, including
   the refusal that says to turn streaming off. Update `apps/server/src/guide/{en,es}/box-status.md`
   at `#shutdown` and the A1418 entry in `docs/backlog.md`.
4. **Run the tests red before building, then green.** Add `apps/server/src/direct-bucket-shutdown.e2e.test.ts`
   to `test-server-stream` in `.github/workflows/ci.yml`, its ordinary-shard exclusions and the
   file list in `scripts/ci-workflow.test.mjs`. Reuse `apps/server/src/testing/{stream-box,s3-test-server,recovery-key}.ts`
   and extract the PUT hold from `apps/server/src/testing/paired-shutdown-scenario.ts` to its sibling
   `stream-upload-gate.ts`. Use the retained HTTPS listener and real download routes. After a final
   change, observe its held PUT and confirm the download. Assert pause with the normal deadline and
   no mark, and restore the older copy. Release, retry, assert ready with the mark and restore the
   change. Expect `409 box.shutdown_unavailable` on base. Require both binaries in CI.
   Replace the old streaming refusal in `apps/server/src/boot.stop-mark.test.ts` with saved-path
   admission and a mark held until the late check succeeds. Extend `apps/server/src/stream-host.test.ts`
   for matching and changed direct settings and a replaced supervisor. Reuse `supervisor.test.ts`
   for the command and `admin-shutdown.test.ts` for download order, Retry, Cancel and the unchecked
   mark. Test progress and Retry wording in `apps/dashboard/src/screens/box-status-screen.test.ts`
   and run the size guard. Run the unchanged fiscal `write-path.e2e.test.ts`, `inmutabilidad.test.ts`
   and the Server and Till menu gates.

Estimate 85–125 added product lines and 250–350 added test lines. Cloud backup, spare shutdown and
return, and appliance power-off are later slices.
