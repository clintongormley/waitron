# A1418 slice 5 — Shut down this box

[Approved design §§2–6](../specs/2026-11-07-a1418-box-stop-intent-design.md) · [Slice map](2026-11-26-h-a1418-box-stop-intent.md)

A standalone main box with one saved archive destination and streaming off gets a checked shutdown and waits for an administrator at the next start. Download-only, multiple destinations, streaming, pairs and Cloud follow in later slices.

## Qualify the check before building

Capture with `runOnce`, read the exact saved key with `StorageBackend.getFile`, compare ciphertext digests, validate with `validateArtifactFile`, run `checkCopyIntegrity` and rehearse with `placeBackupData` in private scratch. Check that sale, fiscal and box-local records open. Refuse damaged bytes and the wrong key.

On 26 November, four local-folder runs on an arm64 Mac used a synthetic venue with 90,000 fiscal records. The archive was 25.4 MiB. Peak extra allocation after the saved copy was about 398 MiB. Capture and upload took at most 5.95 seconds, and validation and extraction took at most 3.54 seconds. The full stage timings and controls are in Lane H's `receipts/a1418-admin-shutdown/qualification.md`.

Progress means bytes read back and each stage finishing. Use the existing cancel signals for the read-back and SQLite check. The local measurements support checking for Cancel between validation and placement stages. Bring the watcher the timings and space needs before building 1A. The appliance and bucket timings remain to be measured before choosing a time limit.

## PR 1A — Checked shutdown and a hold at the next start

- Add the Box status action through `box-status.ts`, `servers-api.ts` and `box-status-screen.ts`. Reuse handover’s fresh HTTPS sign-in and `node.manage` check. Update the English and Spanish Box status guides.
- Put the new reversible pause in `admin-shutdown.ts` and its wiring in `admin-shutdown-duties.ts`. Count admitted work using the pattern in `handover-gate.ts`. Shutdown needs its own pause because `HandoverGate.close` is one-way. Use the job and background-duty inventories to pause and drain sales, payments and refunds, filing, attendance and other writers whose data goes in the backup. Drain provider outcomes or their recoverable pending records. Keep the backup and sealed-state writers paused until shutdown or Cancel. Sessions and shutdown notices can be newer than the archive.
- Reuse the supervisor and sweep’s active run and staging turn. Read and rehearse the exact saved archive. Retain the previous backup by skipping pruning for this run. Cancel settles the check before re-opening admission. `backup-supervisor.test.ts` checks the older backup survives a failed upload, changed read-back bytes are refused and successful bytes can be placed. `admin-shutdown.test.ts` covers a held writer and Cancel. `box-status.route.test.ts` covers authority, and `box-status-screen.test.ts` covers the staff-visible outcome.
- Put the durable mark and next-start hold in `admin-shutdown-hold.ts` and call it from `boot.ts` after the replacement and handover checks. Declare the mark in `state-layout.ts` for reset and backup exclusion, and clear it on restore. Write it before showing **Safe to switch off**. Reuse the startup wait and carry-on page. Fresh HTTPS **Carry on** clears it and **Keep it stopped** preserves it across boots. In `boot.stop-mark.test.ts`, check the two-start hold and that a stop signal during the reversible pause writes only the restart mark.

Estimate 300–420 production and 220–320 test lines. Open within three active hours.

## PR 1B — Choices when the check pauses

Offer **Keep waiting**, **Retry**, **Shut down anyway** and **Cancel**. Retry captures again. **Shut down anyway** saves the same hold before the administrator can switch off. Record and email the pause. Offer the existing recovery pack under its own permission with the backup’s key, and show working and on-break staff before confirmation. Extend the route, screen, guide and incident email tests for these choices and the recorded outcome. Estimate 130–220 production and 110–180 test lines. Open within three active hours.

## PR 2 — Power off on the appliance

Only the `node.manage` shutdown operation can request host power-off. After the mark is durable, pass who asked through `box-host-client.ts` to `deploy/box/waitron-box.sh`, following `clock.set`’s requester pattern. A hostless box shows the manual instruction. A failed or ambiguous host reply keeps the box paused. Test authority, call order and host refusal, including `waitron-box-sh.test.mjs`. On a dedicated test appliance, check power-off, the next boot and the existing stop deadline. Estimate 55–95 production and 70–120 test lines. Open within three active hours.
