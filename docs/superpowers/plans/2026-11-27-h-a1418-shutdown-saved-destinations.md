# A1418 6B — Checked shutdown to saved destinations

[Design §4](../specs/2026-11-07-a1418-box-stop-intent-design.md#4-shut-down-this-box) · [Slice map, item 6](2026-11-26-h-a1418-box-stop-intent.md) · [Checked download](2026-11-27-h-a1418-shutdown-destinations.md)

On a standalone main box with streaming and Cloud off and regular archive backups enabled,
**Shut down this box** pauses work, saves one full encrypted backup to every saved destination,
and checks every copy. The box records the next-start hold before showing **Safe to switch off**.
A failed copy pauses shutdown and keeps the existing notice and choices. **Retry backup** makes a
fresh copy, **Cancel and resume work** waits for cleanup and reopens work without a hold, and **Shut
down anyway** records an unchecked stop. Keep the single-destination and checked-download paths.
Defer pairs and controlled handover, Cloud, stream catch-up, stalled-upload measurements and
physical power-off. Use the current settings, storage backends and shutdown API.

## Build

- In `apps/server/src/admin-shutdown-duties.ts`, require enabled archive backups and at least one
  regular destination. This check serves the staff preview, start route, health view used by Box status,
  and the check after work drains. Keep the role, membership, pair and stream gates, and the
  numbered-key download fallback for absent archive settings. In `apps/server/src/backup-supervisor.ts`,
  allow any nonempty backend list in `runForShutdown`. Keep its role, lifecycle and Cloud checks,
  its wait for the active sweep, and the combined shutdown and supervisor cancellation signal.
- In `apps/server/src/backup-sweep.ts`, give `SavedArchive` the full backend list with the shared
  key, hash and sizes. Wait for the existing fan-out uploads to settle and pass the list to the
  check only when every upload succeeds. Propagate the first upload failure in destination order.
  Keep per-destination reporting, fresh archive names and both protections for earlier copies
  during shutdown runs, skipping retention pruning and excluding old copies from space reclamation.
  Leave successful uploads in place if another copy fails.
- In `apps/server/src/admin-shutdown-backup.ts`, use `getFile` with the existing destination timeout
  and compare the byte count and SHA-256 against the original ciphertext for each saved copy.
  Reuse `checkAndPlace` on the first matching readback. It validates, runs SQLite integrity and
  foreign-key checks, and places a private copy. Every later match supplies the same restore input,
  so one completed rehearsal suffices per run. Read serially in private `scratch/restore`, check
  cancellation between reads, and clean each folder before starting the next. Keep the full
  rehearsal space check for the first read and budget the free-space floor plus ciphertext for later ones.
- In `apps/dashboard/src/i18n/codes.ts` and `apps/dashboard/src/i18n/strings.ts`, explain the
  current eligibility and that Waitron checks every saved copy. Update the English and Spanish
  Box status guides in `apps/server/src/guide/en/box-status.md` and
  `apps/server/src/guide/es/box-status.md`, and record the result in `docs/backlog.md`.

## Focused checks

Write these cases first under `multi-destination shutdown`. Let early refusals fail the test before
it waits for a held read.

- `apps/server/src/backup-supervisor.test.ts` — **Checks both saved copies with one rehearsal**
  gates the second read and checks the shared key and bytes, serial cleanup and one real rehearsal.
  **Refuses a failed second destination and keeps earlier copies** covers an upload refusal and a
  same-length corrupt readback. **Cancels during the second read** checks settlement and scratch cleanup.
- `apps/server/src/boot.stop-mark.test.ts` — **Offers checked shutdown with a saved folder and bucket**
  uses the existing boot and saved-settings fixtures. It checks health availability and authenticated
  HTTPS start, and holds the supervisor check to show the mark is written only after it completes.
- In `apps/dashboard/src/i18n/codes.test.ts`, update the existing exact-text unavailability case.

Run `pnpm --filter @waitron/server exec vitest run src/backup-supervisor.test.ts src/boot.stop-mark.test.ts -t 'multi-destination shutdown'`
before production edits. Expect the supervisor’s `backup.not_enabled` and the route’s unavailable
response on base. Rerun after the fix, then run both files in full plus `src/admin-shutdown.test.ts`
and `src/backup-supervisor.download.test.ts`. Run the Dashboard codes test and Lane H’s fiscal and menu gates.

Estimate **40–65 added production lines and 125–185 added test lines** in one PR.
