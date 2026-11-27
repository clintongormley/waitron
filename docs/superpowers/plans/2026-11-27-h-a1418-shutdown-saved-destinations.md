# A1418 6B — Checked shutdown to saved destinations

[Design §4](../specs/2026-11-07-a1418-box-stop-intent-design.md#4-shut-down-this-box) · [Slice map, item 6](2026-11-26-h-a1418-box-stop-intent.md) · [Checked download](2026-11-27-h-a1418-shutdown-destinations.md)

The watcher assigned this slice in Lane H `questions.md` on 27 November 2026 at 04:47.
“6A landed. Plan the next PR of plan item 6 (saved destinations, then pairs: controlled handover as the paired primary's second choice), one page, Claude read, PLAN FOR APPROVAL.”

On a standalone main box with streaming and Cloud off, **Shut down this box** pauses work, saves
one full encrypted backup to every enabled archive destination and checks every copy before saving
the next-start hold. A failure keeps the existing Retry, Cancel and Shut down anyway choices and
pause reasons. Naming the failed readback destination on Box status would need a change to its
response. Defer that detail, pairs and handover, Cloud, stream catch-up, disabled or unreadable
backup settings, stalled uploads and physical power-off.

## Build

- In `apps/server/src/admin-shutdown-duties.ts` and `apps/server/src/backup-supervisor.ts`, let
  the saved backup path accept at least one backend. Keep the other eligibility checks, the download
  fallback for absent settings, the wait for the active backup and the combined cancellation signal.
- In `apps/server/src/backup-sweep.ts`, give `SavedArchive` the full backend list with the shared
  key, hash and sizes. Wait for the existing fan-out uploads to settle and pass the list to the
  check only when every upload succeeds. Propagate the first upload failure in destination order.
  Keep per-destination reporting and skip pruning and reclaiming space from older archives.
  Retry can leave extra copies on a working destination and eventually reach the existing low-space refusal.
- In `apps/server/src/admin-shutdown-backup.ts`, use `getFile` with the existing destination timeout
  and compare the byte count and SHA-256 against the original ciphertext for each saved copy.
  Stop on any mismatch. Once the first copy matches, run `checkAndPlace` on it for validation,
  SQLite checks and private placement. Every later match supplies the same restore input. Read
  serially in `scratch/restore`, checking cancellation and cleaning each folder before the next
  read. Keep the full space budget for the first copy and the free-space floor plus ciphertext for later ones.
- Update eligibility and check wording in `apps/dashboard/src/i18n/codes.ts`,
  `apps/dashboard/src/i18n/strings.ts`, `apps/server/src/guide/en/box-status.md` and
  `apps/server/src/guide/es/box-status.md`. Record the result in `docs/backlog.md`.

## Focused checks

Write these cases first under `multi-destination shutdown`. Surface early refusals before waiting for a held read.

- `apps/server/src/backup-supervisor.test.ts` — **Checks both saved copies with one rehearsal**
  checks the shared key and bytes, serial cleanup and one real rehearsal. **Refuses a failed
  destination and keeps earlier copies** covers a second upload refusal and same-length corruption
  on either readback. Repeat the upload refusal and check the working destination keeps all its
  copies. **Cancels during the second read** checks settlement and scratch cleanup.
- `apps/server/src/boot.stop-mark.test.ts` — **Offers checked shutdown with a saved folder and bucket**
  uses a local dummy bucket endpoint, a held schedule and a stubbed supervisor check. Assert health
  availability, authenticated HTTPS start and that the mark waits for the check.
- In `apps/dashboard/src/i18n/codes.test.ts`, update the existing exact-text unavailability case.

Run `pnpm --filter @waitron/server exec vitest run src/backup-supervisor.test.ts src/boot.stop-mark.test.ts -t 'multi-destination shutdown'`
before production edits. Expect the supervisor’s `backup.not_enabled` and the route’s unavailable
response on base. Rerun after the fix, then run both files in full plus `src/admin-shutdown.test.ts`
and `src/backup-supervisor.download.test.ts`. Run the Dashboard codes test and Lane H’s fiscal and menu gates.

Estimate **40–65 added production lines and 130–195 added test lines** in one PR.
