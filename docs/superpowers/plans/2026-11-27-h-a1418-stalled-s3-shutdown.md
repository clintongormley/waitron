# A1418 PR 1C · Keep waiting for a stalled shutdown upload

[Design §§4, 6](../specs/2026-11-07-a1418-box-stop-intent-design.md) · [Shutdown slices 1A and 1B](2026-11-26-h-a1418-admin-shutdown.md)

Box status pauses checked shutdown when an upload to a saved S3 destination stops making progress. **Keep waiting** carries on with that backup. **Cancel and resume work** and confirmed **Shut down anyway** settle any upload before proceeding. The watcher's 27 November 10:22 clearance covers planning. Scheduled and manual backups, other providers, completed-failure choices and the spare check keep their current paths.

## What a timer can see

A timer needs a signal that bytes are still moving. On the spare's paced S3 upload, part acknowledgements went 15.774 seconds apart while bytes continued moving. On Linux Node 26, a plain 20-second socket-idle prompt fired while the receiver was still reading the last 1.3 MiB. The uploader had already handed the whole payload to its socket. Using the kernel transmit queue alone also gave a late false alarm, after TCP had acknowledged the payload and the receiving app still had 32 KiB to read. The narrower signal prompts only when the queue still holds unacknowledged bytes and their acknowledged count has stopped advancing. That version stayed quiet throughout a 58.5-second paced PUT and prompted at 20.4 seconds in a held PUT. Release finished that same PUT with matching bytes. Once the peer has acknowledged the payload, use the existing bounded wait for the reply. The stored archive still needs Waitron's existing readback and restore rehearsal. Lane H's `1c-client-progress.md` records the controls.

## Decide before building

Qualify an actual hold and release of a body request on the spare's saved S3 path, using a throwaway bucket. Hold after bytes begin for at least the proposed 20 seconds plus time for an administrator to act. Record whether the same request survives and finishes with matching readback. Amazon S3 documents `RequestTimeout` without giving an interval. If the provider closes the request, decide whether **Keep waiting** may send the unfinished part again under the same multipart upload ID, or repeat a small single PUT from the same staged archive. The current file store abandons a failed multipart upload, so preserving it while awaiting a choice needs explicit cleanup on Cancel and unchecked shutdown. Bring the result to the watcher before picking the mechanism or interval. [Amazon S3 error responses](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/ErrorResponses.html)

## One PR after that decision

- Keep `s3-file-store.ts` and `s3-client.ts` as the upload boundary. If the live request proves viable, use dedicated agents for opted-in payloads and request-local baselines and cleanup in `s3-upload-progress.ts`. Match the complete IPv4 or IPv6 connection. Retain the hard destination deadline and parent cancellation through `s3-backend.ts`, `backup-sweep.ts` and `backup-supervisor.ts`. Unsupported observation uses the existing bounded path.
- Extend `admin-shutdown.ts`, `admin-shutdown-duties.ts` and `box-status.ts`. A live check has its own cancellable run. The attempt owns the existing one-per-attempt manager email. Keep the mark held until the administrator chooses, even if the check finishes during the prompt. If it has passed, offer **Continue shutdown**. If it fails, show the existing failure choices. Use the existing HTTPS `node.manage` route and dashboard `servers-api.ts`, `box-status-screen.ts`, `strings.ts` and both Box status guides. Update the backlog.
- Start with failing tests. The S3 file-store tests cover healthy slow traffic, resumption and abort cleanup. `backup-supervisor.test.ts` covers mixed destinations and readback. `admin-shutdown.test.ts` checks a single attempt, mark order and cleanup before either exit. Extend `box-status.route.test.ts` for access, `boot.stop-mark.test.ts` for the single alert and `box-status-screen.test.ts` for the choices.

Estimate 250–340 production and 210–300 test lines for the live-request route. Recheck the estimate when the watcher has the hold result.
