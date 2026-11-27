# A1418 slice 6, PR 1 — Checked shutdown by download

An administrator with **Manage boxes** can use **Shut down this box** on a standalone main box with
no saved archive settings and streaming off. The box pauses work, checks a full encrypted archive
and offers it as a download. The administrator confirms they saved the named file and have its
keys. The box then records the next-start hold and shows **Safe to switch off**. This gives a box
with no destination a copy the administrator can take away when retiring it. A folder on the box
serves a move if that same box will be available later.
[Approved design §4](../specs/2026-11-07-a1418-box-stop-intent-design.md#4-shut-down-this-box) · [Slice map, item 6](2026-11-26-h-a1418-box-stop-intent.md)

## Build

- `admin-shutdown-duties.ts` keeps the main role, pair, membership and stream checks. Offer download
  when `readArchiveSettingsWithMeta` finds no record and `loadBackupKey` finds a usable numbered key.
  `boot.ts` supplies the existing box-environment reader. Recheck after draining work. Before the
  pause, show that restore needs this backup's encryption key and master key. Keep the staff list
  and the existing recovery-pack offer under its own permission.
- `backup-supervisor.ts` opens and closes a one-run venue handle through its existing opener. Share
  the normal capture inputs and staging turn with `backup-sweep.ts`'s `runOnce`. Keep the archive
  destination options with delivery. The download run encrypts to a private caller-owned file
  without a schedule, upload or pruning. Register its abort and settle with the supervisor before
  opening the handle so both stop and reload can drain it, even before capture begins. Budget
  ciphertext space and use the setup upload's `MAX_ARCHIVE_UPLOAD_BYTES` limit before offering it.
  `admin-shutdown-backup.ts` checks the exact file using the read-back rehearsal's validation,
  SQLite checks and private placement. Remove the rehearsal files and keep the ciphertext in its
  own folder under `scratch/restore` for delivery.
- `admin-shutdown.ts` adds a `download` phase to the current attempt. In `box-status.ts`, stream
  `GET /api/box/shutdown/download/:name` as a no-store attachment with the attempt's generated
  name and length. Follow `tax-office-api.ts` for closing the reader on end, error, cancellation
  and request abort. A full byte count and Node's response `finish` enable confirmation. An
  interrupted transfer can retry the same file. The existing shutdown PATCH accepts `backup-saved`
  only for the current download name with a completed response. Keep HTTPS and `node.manage` on
  both routes, the same-page write check and fresh password proof at start.
- Cancel aborts capture or transfer and waits for cleanup before resuming work. Remove the folder
  on capture failure, successful hold save, Cancel or server close. A failed hold save retains the
  checked file for retry. Keep checked ready behind the durable mark, and reuse the existing
  shutdown failure choices and notice.
- `servers-api.ts` and `box-status-screen.ts` use the existing health read and a download link.
  Show the file name and byte count at **I saved the backup**. Ask the administrator to check it in
  Downloads and confirm they have both keys. Explain that Waitron checks its copy on the box.
  Update dashboard `i18n/strings.ts` and both languages of `guide/**/box-status.md`.

## Focused checks

Write the failing cases first. In `backup-supervisor.test.ts`, restore the exported bytes with the
held keys through the setup upload and ordinary file-restore path. Check the last sale, fiscal
record and box-local data. Low space or bad bytes must leave no downloadable file. In
`admin-shutdown.test.ts`, check the pause, stale confirmation and Cancel cleanup.
`box-status.route.test.ts` checks authority. `boot.stop-mark.test.ts` uses a retained HTTPS listener
to interrupt and retry delivery, then checks the durable mark and held next start.
`box-status-screen.test.ts` checks the download and confirmation choices. Run Lane H's unchanged
fiscal and menu gates.

Estimate 300–350 production and 350–430 test lines. Open within three active hours. Later work
covers disabled or unreadable archive settings, multiple or Cloud destinations, stream catch-up,
paired boxes, the stalled-upload choice and appliance power-off.
