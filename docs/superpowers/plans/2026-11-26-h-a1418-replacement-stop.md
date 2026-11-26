# A1418 slice 3 — keep a replaced box stopped

A box that verifies its replacement stops selling and filing, even mid-service. It stays stopped offline until an administrator confirms the replacement is off and saves a higher term, the number that orders changes of main box.
[Approved design §§3, 6, 8](../specs/2026-11-07-a1418-box-stop-intent-design.md) · [Slice boundaries](2026-11-26-h-a1418-box-stop-intent.md) · [Landed term floor](2026-11-26-h-a1418-restore-bucket-term.md)

## Prove the key before trusting it

- Run `stream-loop.e2e.test.ts` with pinned Litestream and versitygw. `testing/stream-loop-scenario.ts` checks the restored key and a newer pointer signed by it, with the original stream and node IDs.
- In `restore-command.archive.test.ts`, restore an encrypted archive with the source's `node.dump` and vault secrets into a fresh folder. Use the real first start and stream publisher. On both paths, verify the pointer with the key captured from the source before backup, with a different-key control. Take a failed proof to the watcher before building the reader.

## Stop and remember

- In `stream-host.ts`, give `readNewerBucketMain` a separate same-identity answer. Read the configured stream's pointer, require this node ID and a strictly newer term than the held chart, and verify with the public key derived from `readNodeIdentityKey`.
- In `boot.ts`, run one `observeNewerMain` poller alongside unfenced primary service. Keep A1342's endorsed-peer check before peer carry-on and its live stop only after `carriedOnWithoutPeer`.
  Capture `restore-flow.ts`'s `firstStartPending` before `runFirstStart` can clear it. Exempt that whole boot from the same-identity check and keep the exemption while a failed rebuild leaves the marker. Bucket silence adds no wait.
- Reuse `handover-stepdown.ts`'s gate, `background-duties.ts` and bounded drain. Close admission and signal duties before awaiting disk. `/api/node` reports no sales and venue advertising stops. Already admitted work and claimed filing batches follow existing drain rules.
- Write `replaced.json` with stream ID, node ID and verified term using `writeFileDurable` before `restartProcess`. On write failure, keep admission closed and retry saving the evidence already held.
  Schedule close outside the callback that `StreamHost.stop()` joins. A1342 keeps its own restriction row.
- Add `replaced.json` to `packages/store/src/state-layout.ts`, excluded from backups and deleted on reset. In `restore.ts`, clear it durably under the venue lock only after successful database and secret placement.

## Start stopped and let an administrator carry on

- In `boot.ts`, honor the local record before sales or duties, even after a clean restart or with the bucket offline. Use `waiting-start.ts` and `waiting-page.ts` with a replacement reason and no automatic release. Run normal signed-peer admission before raising the term. A known A1342 handover still wins.
- In `carry-on.ts`, reuse HTTPS, own-page checks, fresh `node.manage` sign-in and the serialized turn. Require confirmation that the replacement is shut down. Use `membership-mint.ts` and `persistNodeMembershipIfNewer` to save a signed chart above both the held and replacement terms.
  Confirm the higher safe-integer term is committed before durably clearing the stop and releasing the wait. If the record survives a crash between save and clear, the next start still waits. The stream publishes after a full copy.
- Record one `start.replaced` incident per stop, with an area and English/Spanish words. Use `box-alert-email.ts` and `box-alert-mail.ts` while held, following `boot.ts`'s mail-only repair start. Update both `guide/*/backup-recovery.md` copies.
- **Watcher decision.** May an administrator carry on with the saved term if the bucket is offline? Recommend a bounded `readBucketTerm` for carry-on so it orders above later visible generations, and staying stopped if that read fails. Only signature-checked pointers can trigger a stop.

## Focused checks and size

- Watch the new behavior tests fail before the fix, then pass. `stream-host.test.ts` checks a valid signature, forgery and equal term. `boot.restore.test.ts` checks first-start success and failure. Re-run A1342's refusal and late-peer restriction in `boot.start-check.test.ts`.
- In `boot.stop-mark.test.ts`, deliver the pointer after trading starts and stall the marker write. Prove new sales and filing batches stop before the write, restart follows the write, and an offline reboot still holds.
- `waiting-start.test.ts` checks HTTPS, authorization, the confirmation, save-before-clear and save failure. `box-alert-email.test.ts` and the held boot check notification while stopped. Check backup/reset in `scripts/state-layout.test.ts` and restore success/rollback in `restore-durability.test.ts`.

One PR, about 250–350 product lines and 280–400 test lines. Run Lane H's applicable gates unedited.
Power-cut waiting, administrator shutdown, early claims, equal terms, changed identity, Cloud, and all fiscal chain and invoice paths are outside this slice.
