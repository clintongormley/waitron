# A1418 slice 3 — keep a replaced box stopped

When a box serving a venue on its own verifies that a restored copy has taken over, it stops taking sales and sending new filing batches. It stays stopped across an offline restart, tells staff why, and emails managers. The waiting page directs an administrator to switch off the replacement and recover from its latest backup.
[Approved design §§3, 6, 8](../specs/2026-11-07-a1418-box-stop-intent-design.md) · [Slice boundaries](2026-11-26-h-a1418-box-stop-intent.md) · [Landed backup ordering](2026-11-26-h-a1418-restore-bucket-term.md)

## Prove what a restored box publishes

- Run `stream-loop.e2e.test.ts` with pinned Litestream and versitygw. `testing/stream-loop-scenario.ts` checks the restored key and verifies the newer pointer against the original key, stream ID and node ID.
- Extend `restore-command.archive.test.ts` to restore a real encrypted archive containing `node.dump`, stream settings and vault secrets. Use the real first start and stream publisher. A pointer above the original term must verify with the original public key and fail verification with a different key. Take a failed proof to the watcher before enabling this trust.

## Recognize the replacement and stay stopped

- In `stream-host.ts`, add a same-identity verdict checked with the local public key, the configured stream ID, this node ID and a strictly newer term than the held chart. Keep the enrolled-peer reader and its existing carry-on refusal. Use one observer in `boot.ts` for the applicable check. Ask alongside service on solo, unfenced primaries after successful first-start completion. Defer the same-identity check while a restore is unfinished. A silent bucket adds no startup wait.
- Share the admission gate, stop signals and bounded drain from `handover-stepdown.ts`. Close admission and stop new filing batches before awaiting disk. `/api/node` reports no sales and venue advertising stops. Already admitted work and claimed batches follow existing drain rules.
- Save `replaced.json` using `writeFileDurable`, with the stream ID, node ID and verified term. Schedule restart outside the callback that `StreamHost.stop()` joins, and only after the save. The existing A1342 stepdown restarts on write failure. Here, retain the verified evidence in memory, keep admission closed and retry the write even if the bucket goes offline. A forced stop before the save can leave no local evidence.
- Use `packages/store/src/state-layout.ts` to exclude the file from backups and delete it on reset. In `restore.ts`, clear it durably under the venue lock after database and secret placement succeeds. Refused placements keep the stop.

## Serve the stopped box

- In `boot.ts`, keep the A1342 restriction and verified peer supersession ahead of this hold. A peer that says proceed or stays silent cannot release the saved stop. Read it before mounting commerce, filing or ordinary peer carry-on. Reuse the waiting page and health response, with no carry-on form for this stop. Give the recovery steps in English and Spanish in the page and `guide/*/backup-recovery.md` using the existing backup restore path.
- Record one `start.replaced` incident per stop with an area and English and Spanish words. Reuse the `boot.ts` mail-only repair path and `box-alert-email.ts`/`box-alert-mail.ts`. The guide explains that detection starts when the replacement publishes a full copy and this box verifies its next answer. The old box may still trade before then. Update `docs/backlog.md` and the data conventions receipt for the stop.
- **Decision for the watcher.** Direct carry-on could start trading with the replacement's sales and records absent. Build this stop with current-backup recovery, and settle direct carry-on separately. Power-cut waiting, administrator shutdown, signed early claims, equal terms, changed identities and Cloud are later work.

## Focused checks and size

- Start with failing tests. `stream-host.test.ts` checks a valid local signature, a wrong key and equal term. `boot.restore.test.ts` checks that a finished restore observes later evidence and an unfinished restore defers. Re-run `boot.start-check.test.ts` for the existing enrolled-peer path.
- `boot.stop-mark.test.ts` supplies a late pointer and stalls or refuses the marker write. Assert that admissions and new filing batches stop before the write, that a failed write keeps the gate closed and schedules no restart, and that a successful retry holds across an offline reboot. Assert that even a peer's proceed reply leaves a saved stop in force.
- Check waiting-page recovery and no ordinary carry-on on the held boot. Exercise the one email in `box-alert-email.test.ts`, reset and backup exclusion in `scripts/state-layout.test.ts`, and successful and refused placement in `restore-durability.test.ts`. Run Lane H's gates unedited. Include the restore proofs and stop in one PR, around 190–290 product lines and 220–340 test lines.
