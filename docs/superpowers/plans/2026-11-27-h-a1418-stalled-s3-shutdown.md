# A1418 PR 1C · Keep waiting for a stalled shutdown upload

[Design §§4, 6](../specs/2026-11-07-a1418-box-stop-intent-design.md) · [Shutdown slices 1A and 1B](2026-11-26-h-a1418-admin-shutdown.md)

Box status tells the administrator when a saved S3 backup upload times out during a checked
shutdown and emails managers once per shutdown attempt. **Keep waiting** resumes that backup.
**Cancel and resume work** or confirmed **Shut down anyway** settles the upload and cleans up
before acting. Claude suggested reusing the staged upload in the plan review. The watcher cleared
this route at 11:13 on 27 November under the design approved on 7 November.

An early idle timer fired on loopback HTTPS while a healthy receiver still had 1.3 MiB to read
(`1c-client-progress.md` in Lane H's receipts). Prompt after the existing request retries end on a
timeout. A premature prompt costs one email and a click and keeps accepted parts. Open-request
tracking, Linux socket inspection and the extra spare-box measurement are out of scope. Other
providers, scheduled and manual backups, and ordinary completed-failure choices follow their existing
paths.

- In `packages/stream/src/s3-file-store.ts`, give file uploads an optional wait callback after the
  last body request ends on a timeout. Keep the 30-second idle timer and three attempts per request.
  Continue with the same multipart upload ID and unfinished part, or resend the same saved file
  for a single PUT. The existing cleanup owns abort and uncertain-object deletion.
  `s3-file-store.upload.test.ts` uses the S3 loopback fixture to prove the same ID and bytes, unchanged
  ordinary retries and cleanup when the caller stops.
- Pass the callback through `apps/server/src/backup-supervisor.ts` and `backup-sweep.ts` to the file
  upload. Keep the existing 15-minute default for each destination, including time spent paused.
  `backup-supervisor.test.ts` checks that the same staged backup reaches the existing readback and
  restore rehearsal. `admin-shutdown.ts` owns cancellation per check and the decision before writing
  the mark. If checks pass while the prompt is visible, offer **Continue shutdown**.
  `admin-shutdown-duties.ts` uses one attempt identity for the email across all check runs.
  `admin-shutdown.test.ts` covers mark order and cleanup before either exit.
- Extend the existing HTTPS `node.manage` route in `apps/server/src/box-status.ts` and its route
  test. Register a stalled-upload incident in `errors.ts`, `stop-alert.ts` and `box-alert-email.ts`
  with English and Spanish wording on the dashboard and in email. Check delivery in
  `boot.stop-mark.test.ts`. Update the dashboard's `servers-api.ts`, `box-status-screen.ts`,
  its pause actions and tests, both Box status guides and the backlog.

Estimate 220–300 production lines and 180–250 test lines in one PR.
