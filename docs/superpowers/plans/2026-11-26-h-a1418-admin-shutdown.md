# A1418 slice 5 — Shut down this box

[Approved design §§2–6](../specs/2026-11-07-a1418-box-stop-intent-design.md) · [Slice map](2026-11-26-h-a1418-box-stop-intent.md)

A standalone main box with one saved archive destination and streaming off gets a checked shutdown and waits for an administrator at the next start. Download-only, multiple destinations, streaming, pairs and Cloud follow in later slices.

## Qualify the check before building

Measure a real ordinary archive from `backup-sweep.ts` (`runOnce`), read back by its exact key with `StorageBackend.getFile`. Extend the existing scheduled capture and restore experiment in `restore-artifact-file.test.ts` in a disposable checkout. Validate with `validateArtifactFile`, check SQLite through `checkCopyIntegrity`, and use `placeBackupData` on private scratch. Prove real sale, fiscal and node state open, and prove damaged bytes and a wrong key fail. On representative full fiscal history, measure peak scratch, time by stage and the longest progress gap. Induce a stall and verify cancellation and cleanup. Record the results in the plan and add a dated design note.

Recommend the ordinary restore rehearsal. The Cloud verifier also runs per-module data checks and requires Cloud request fields and a versioned key. Its current internal limits include five minutes, 16 GiB scratch and 2 GiB encrypted input (`backup-verification.ts`). The 30 seconds and 256 MiB in the design match the [earlier Cloud worker budget](2026-10-20-a850-backup-verification.md). Get clearance for the local check, a measured no-progress limit and the space needed before building. This measurement needs no production code or pull request.

## PR 1 — Checked shutdown and a hold at the next start

- Add one Box status action through `box-status.ts`, `servers-api.ts` and `box-status-screen.ts`. Reuse handover’s fresh HTTPS sign-in and `node.manage` check. The design names the retired `node.promote` permission. Offer the existing recovery pack with its own permission and the backup’s key. Show working and on-break staff before confirmation. Update the English and Spanish Box status guides.
- In `admin-shutdown.ts` and `boot.ts`, count admitted work as `handover-gate.ts` does. Use the job and background-duty inventories to pause new sales, payment and refund work, filing, attendance and other captured-data writers. Drain admitted requests and jobs, including provider outcomes or their recoverable pending records. Keep backup and sealed-state jobs paused through shutdown or Cancel. Sessions and shutdown notices can be newer than the archive. The handover stop remains one-way.
- Reuse the supervisor and sweep’s active run and staging turn. Read the freshly saved object back and compare its digest to the uploaded bytes before rehearsing restore within the measured limits. Skip pruning in this run to keep the previous backup. On failure, offer wait, retry or Cancel and record and email the pause. Retry captures again. Cancel settles and resumes work. The design’s explicit **Shut down anyway** needs the watcher’s decision.
- Write a separate durable shutdown mark before showing **Safe to switch off**. Include it in `state-layout.ts` so reset removes it and backups exclude it. Clear it on restore. The signal path’s restart mark must leave it intact. Extend the existing startup wait and carry-on page after the replacement and handover checks, before sales and filing start. Fresh HTTPS administrator carry-on clears the mark. **Keep it stopped** retains it across boots.
- Test failed upload with an older backup present, changed read-back bytes and successful placement in `backup-supervisor.test.ts`. Test a held writer, cancellation and permission refusals in `admin-shutdown.test.ts` and `box-status.route.test.ts`. Test the shutdown screen and two-start hold in `box-status-screen.test.ts` and `boot.stop-mark.test.ts`. Estimate 350–500 production and 280–420 test lines.

## PR 2 — Power off on the appliance

After the mark is durable, send the host power-off request through `box-host-client.ts` and `deploy/box/waitron-box.sh`. Keep the manual instruction for a known hostless box. A failed or ambiguous host reply keeps the box paused. Test the call order and refusal, including `waitron-box-sh.test.mjs`. Use a dedicated test appliance to check power-off, the next boot and the existing stop deadline. Estimate 55–95 production and 70–120 test lines.
