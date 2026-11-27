# A1418 slice 6, PR 1 — Checked shutdown by download

An administrator with **Manage boxes** can use **Shut down this box** on a standalone main box
with no saved backup destination and streaming off. Waitron pauses work, checks a full encrypted
backup and offers it for download. Once the administrator confirms the file is saved, Waitron
records the hold and shows **Safe to switch off**. The next start asks an administrator whether
to carry on. This extends #4461 under the watcher's 27 November 02:19 assignment in Lane H
`questions.md`.
[Approved design §4](../specs/2026-11-07-a1418-box-stop-intent-design.md#4-shut-down-this-box) · [Slice map, item 6](2026-11-26-h-a1418-box-stop-intent.md) · [Slice 5](2026-11-26-h-a1418-admin-shutdown.md)

## Build

- In `admin-shutdown-duties.ts`, keep the main-role, pair, membership and stream checks. Offer
  download only when `readArchiveSettingsWithMeta` confirms no saved record and `loadBackupKey`
  finds a usable numbered key. `boot.ts` passes the existing box-environment reader. Recheck after
  draining work. Keep the one-destination path and the staff list and recovery pack before the pause.
  The pack keeps its own permission.
- In `backup-supervisor.ts`, pass normal capture inputs to `backup-sweep.ts`'s `runOnce`. Let
  the existing full capture also encrypt to a caller-owned file, without a schedule or upload.
  Budget room for ciphertext and keep the staging turn through shared cleanup. In
  `admin-shutdown-backup.ts`, reuse the saved-backup check on the exact download file. Use the
  existing space reserve, validation, SQLite integrity and foreign-key checks, and private
  placement rehearsal. Delete rehearsal files before offering the ciphertext from its unique
  `scratch/restore` folder, outside shared backup staging.
- Keep the file on the current attempt in `admin-shutdown.ts`. In `box-status.ts`, serve it via
  `GET /api/box/shutdown/download/:name` as a no-store attachment with the generated name and
  byte length. Use `tax-office-api.ts`'s lazy reader pattern and close on end, error, stream
  cancel or request abort. Require the full byte count and the Node response’s `finish` event
  before enabling **I saved the backup**. `restart-after-response.ts` shows the response binding.
  An interrupted transfer leaves the file available to download again. Confirm via the existing
  shutdown PATCH with `decision: "backup-saved"` and that same name. Require HTTPS and
  `node.manage` for both, the existing same-page check for confirmation and fresh password proof
  at start.
- Cancel aborts capture or transfer and waits for cleanup before lifting the pause without a
  shutdown mark. Remove the folder on check failure, successful hold save, Cancel or server close.
  Boot clears scratch after a power cut. Keep Retry, **Shut down anyway** and the existing alert
  for failed checks. The checked path shows **Safe to switch off** after the mark write succeeds.
- In `servers-api.ts` and `box-status-screen.ts`, use the current health read and a same-origin
  download link. HTTP `finish` means the response was handed to the operating system for sending.
  Ask the administrator to check the named file in their browser's Downloads before confirming.
  Keep Cancel visible. Update dashboard `i18n/strings.ts` and
  both `apps/server/src/guide/{en,es}/box-status.md` guides.

## Focused behavioral tests

Write each case first and watch it fail before implementing its behavior.

- `backup-supervisor.test.ts` restores the exact download file and checks the last sale, fiscal
  record and box-local data. Low space or a damaged file leaves no downloadable copy. Keep the
  saved-destination cases.
- `admin-shutdown.test.ts` checks that waiting for download or confirmation still holds writers,
  Cancel waits for cleanup and resumes work, and a stale confirmation cannot save the mark.
- `box-status.route.test.ts` checks HTTPS, permissions and fresh password proof at start, with
  download and confirmation refused without authority. `boot.stop-mark.test.ts` checks eligibility
  with a held key and no saved record, an interrupted HTTPS transfer and retry, and the mark absent
  until confirmation. Exercise the next-start hold through the same boot fixture.
- `box-status-screen.test.ts` checks the download, confirmation and Cancel states without showing
  **Safe to switch off** early. Run Lane H's fiscal and menu gates unedited.

Estimate 300–350 production and 320–430 test lines. Open the PR within three active hours. Claude
reads the plan first, then the watcher clears it before implementation. Later PRs cover multiple
saved destinations, stream catch-up and paired shutdown, handover and spare reseeding. Slice 5's
stalled-upload choices and appliance power-off remain separate. Cloud's startup answer waits for A1188.
