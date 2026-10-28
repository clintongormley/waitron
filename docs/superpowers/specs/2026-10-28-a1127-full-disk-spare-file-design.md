# A1127: on a full disk, the box frees a recovery's copy with the help of a spare file

**2026-10-28, A1127 slice 2:** the start also releases the spare on a nearly full disk; a release writes `spare-space.released`, which holds the till stop until a start, the free-space watch or Box status's Free button writes the spare back (`conventions-data.md`, "The box's spare file").

The owner chose this on 2026-10-26 at 01:15 CET ("A1042 full disk: A", `~/waitron-campaign/questions.md`,
heading "OWNER ANSWER — A1042 full disk: A", answering "A1042 build — a full disk while a discarded
recovery's copy still fills it" with its Examples 1 and 2):

> The box keeps a small spare file of a few MB; on a full disk it deletes that first, takes the folder
> lock, deletes the discarded recovery copy, and writes the spare file back. The lock rule stays
> intact. The same item gives the repair page a full-disk answer the person can act on (so a stopped
> recovery that filled the disk can still be discarded), and stops the full-disk page referring the
> person elsewhere while the box still holds something it can free.

This document settles the spare file's name, place and size, who deletes it and who writes it back,
the two examples' paths, and the words of both pages. It changes no fiscal record, chain or series
name (see "What this does not change").

Every "measured" below was run on 2026-10-28 on macOS 26.6.2 (arm64), Node v26.11.1, Vitest 4.1.12, on
the full-disk harness's own 32 MiB HFS+ image (`openSmallDisk`, `apps/server/src/testing/full-disk.ts`,
4096-byte blocks), filled to `ENOSPC` and then given back the number of bytes named. The probes, their
commands and their outputs are in `~/waitron-campaign/a1127-measure/` (index: `README.txt`). Before each
probe the failing outcome was written down; it is quoted with each result. Linux was not measured
(Docker was not running on the machine); every Linux difference is listed under "Open, not measured".

## What happens today

- **A lock writes to the disk.** Taking a venue folder's lock opens `venue.lock` and leaves
  `begin immediate` open (`packages/store/src/venue-lock.ts:55-67`), which writes `venue.lock-journal`,
  and then writes the holder file `venue.holder.json` through `venue.holder.json.partial`
  (`beginHolding`, `packages/store/src/venue-liveness.ts:279-287`). Measured (M1, folder already holding
  `venue.lock`; failing case: a lock taken at 0 bytes free): 0 and 512 bytes left, refused, errcode 14
  "unable to open database file"; 4096 left, refused, `ENOSPC` opening `venue.holder.json.partial`;
  8192 left, taken, with 0 bytes free while held. Control M1b, disk not filled: taken.
- **Emptying a discarded recovery takes two locks first** (`emptyAbandonedBackupRecovery`,
  `packages/provisioning/src/first-setup-backup-discard.ts:122-159`: the box's venue folder, then the
  copy's). Measured (M2, a discarded recovery with a 4 MiB copy; failing case: refused at 0 bytes): 0,
  4096 and 8192 bytes left, refused (errcode 14, `ENOSPC`, errcode 14), the copy still 4194304 bytes;
  16384 left, emptied, 4227072 bytes free afterwards.
- **Example 2 at the start.** A start deletes only rotated logs, old crash reports and the backup and
  restore staging leftovers (`freeSpaceAtStart`, `apps/server/src/start-space.ts:62-156`), then
  `emptyDiscardedRecovery` (`apps/server/src/first-setup-entry.ts:204-231`) tries the emptying and, on
  a full disk, logs `setup.recovery_cleanup_refused` and goes on to the full-disk page. The existing
  real-disk case "a discarded recovery on a full disk with nothing to delete: …"
  (`apps/server/src/start-full-disk.e2e.test.ts:778`) pins exactly that.
- **Example 1 on the repair page.** Every step of the repair host takes the venue lock first
  (`withVenueExclusion`, `packages/provisioning/src/first-setup-resolution-inspection.ts:251-259`; the
  recovery's `turn`, `apps/server/src/first-setup-backup-recovery.ts:426-427`; Start again and its
  summary, `apps/server/src/first-setup-resolution.ts:402-403,447-448`). Measured (M4, a stopped
  recovery from the A731 fixture `selectedRepair`, the password step, the summary and Start again
  driven through `createFirstSetupResolutionActions`; failing case: refused at 0 bytes):
  - filled before the password step: 0 left, refused at the password step, errcode 14; 16384 left,
    refused at the password step, `setup.attempt_invalid`; 65536, 262144 and 1048576 left, the whole
    flow finished (the password step took 24576 bytes; Start again then freed what the recovery held).
  - filled after the summary, before Start again: 0 left, refused, errcode 14; 16384 left, refused,
    `setup.attempt_invalid`; 32768 left and more, finished.
  - control, disk not filled: finished.
  So a full disk reaches the person in two shapes: an engine error (errcode 14 on HFS+), which the
  route boundary answers `500 server.internal` (`packages/server-kit/src/error-boundary.ts:24-48`, read),
  and a durable record write refused part-way, which `writeDurableHostJson` turns into
  `setup.attempt_invalid` with no cause (`packages/provisioning/src/durable-host-json.ts:15`, read). The
  setup app draws the first as "Reconnect to check the saved result. Do not repeat activation." and
  the second as "The saved setup cannot be read. Contact support." (`apps/setup/src/setup-app.ts:226-235,
  1278-1282`; `apps/setup/src/i18n/strings/shell.ts:8`; read, not run). On Linux ext4 and tmpfs the
  lock's refusal is result code 13 ([conventions-data.md](../../developers/conventions-data.md#a-full-disk-is-not-one-error-code)),
  which the boundary already answers `507 storage.disk_full`; the setup app has no words for that code
  either, so it draws the same "Reconnect…" line (read, not run).
- **The repair page's reads.** Measured (M6, M6b; failing case: the read refused at 0 bytes): with no
  setup database, the inspection and the recovery's activity read both answered at 0 and 16384 bytes
  left. With a setup database present, the inspection answered `database: "unknown"` at 0 and 16384
  bytes left (it used the 16384 bytes), and answered properly at 65536. The page offers Start again
  beside a stopped recovery only after the inspection has checked the database
  (`presentStartAgainAllowed`, `apps/setup/src/setup-app.ts:238-243`, read). So with the database
  present, a full disk also hides Start again.
- **The full-disk page** says "The box has deleted what it could make again, and that was not enough.
  Ask whoever installed this box to free some space (old backups, earlier versions of Waitron) or fit
  a bigger disk. Your sales are not touched." (`apps/server/src/recovery-surface.ts:319-330`). It sends
  the person to somebody else, and its first sentence is untrue while a discarded copy is still there.

## The spare file

| Decision        | What                                                                                                                                                                                                                                                                                       | Receipt                                                                                                                                                                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name and folder | `spare-space`, directly in the box's configured state folder (`WAITRON_STATE_DIR`, `/var/lib/waitron/state` on a box). The name is a constant, `SPARE_SPACE_FILE`, exported by `@waitron/provisioning` because the recovery's originals walk there must leave it out (below).               | The venue folder is `<state>/venue` unless configured otherwise (`apps/server/src/config.ts:517`, `apps/server/src/node-entry.ts:672`); the image sets only the state and log folders (`deploy/Dockerfile:269-271`). So the state folder, the venue folder and every recovery's copy (`<state>/first-setup-resolutions/backup-recovery/<id>/target/`) are on one volume on a box. |
| Size            | 8 MiB (`SPARE_SPACE_BYTES = 8 * 1024 * 1024`).                                                                                                                                                                                                                                             | Measured needs on HFS+: one lock 8 KiB (M1), the emptying 16 KiB (M2), a spare of 16 KiB released on a full disk enough for the emptying and 4 KiB not (M3), the whole Start-again flow 64 KiB (M4). 8 MiB is 128 times the largest. It stays under `FULL_DISK_BYTES` (16 MiB, `apps/server/src/boot-failure.ts:47`), so a disk whose spare was just released still reads as full to `fullDiskFailure`, and "a few MB" is the owner's own figure. |
| Contents        | Random bytes (`crypto.randomBytes`), written chunk by chunk with `write`, then `fsync` of the file and of the state folder. Never made by `truncate` or `fallocate`.                                                                                                                       | M5b: on a fresh 32 MiB APFS image, a file made by `truncate` to 4 MiB took 4096 bytes; writing 4 MiB took 4194304. On HFS+ both took 4194304. Random rather than a fill pattern so a compressing filesystem cannot store it in less (btrfs and zfs not measured). M7: 8 MiB of random bytes with both `fsync`s took 8–21 ms here.                                                                                                                                       |
| Opened as       | `O_WRONLY \| O_APPEND \| O_CREAT \| O_NOFOLLOW`. Anything at the path that is not a regular file is left alone and logged `storage.spare_unusable`.                                                                                                                                        | A link would otherwise send the bytes, or the deletion, to its target, the shape `start-space.ts:167-187` and `free-space-now.ts` already refuse for their folders.                                                                                                                                         |
| Never data      | Never backed up, exported or streamed. Counted under "Other" in Box status's Disk space.                                                                                                                                                                                                   | A backup takes only named state files (`RECOVERY_FILES`, `apps/server/src/state-secrets.ts:16`) and the database dump; Litestream streams `venue.db` only ([conventions-data.md](../../developers/conventions-data.md#one-process-per-venue-folder)); "Other" is the disk's used space less the venue folder, the backups and the logs (`apps/server/src/disk-usage.ts:38-110`). All read, not run. |

**Which walks see it.** A file in the state folder is seen only by code that lists the folder:

- The backup recovery's originals walk lists both roots whole (`originals`,
  `packages/provisioning/src/first-setup-backup-workspace.ts:294-340`), and a stopped recovery is resumed
  only when the digest still matches (`apps/server/src/first-setup-backup-recovery.ts:838-839`). A spare
  written or deleted in between would refuse that resume. **The walk leaves `spare-space` out**, as it
  already leaves out the lock journal and the holder file (`:315-323`, "carry no setup or recovery
  authority"). This lands before anything writes the file.
- Start again's deletion list, its leftovers survey and its series-name time floor read named entries
  only (`listed` and `itemsOnDisk`, `packages/provisioning/src/first-setup-start-again-deletion.ts:99-117,
  264-310`; the floor "among the attempt's own items", `:321-336`), so the spare is never a found file,
  never deleted by Start again, and its time never moves a series-name floor (read, not run).
- The V1 inspection fingerprints named artifacts only
  (`packages/provisioning/src/first-setup-resolution-inspection.ts:280-294`, read).
- The A731 target check lists a recovery's own target state folder, not the box's
  (`apps/server/src/first-setup-backup-recovery.ts:529-541`, read).
- `grep -rn "readdir(.*[sS]tate" apps/server/src packages/*/src` outside tests finds only that target
  check; `readdirSync` finds no state-folder listing.

## Who writes it, who deletes it

**Written back (topped up) by the start, and only by the start.** Every start through the box's entry
point (`runEntry`, `apps/server/src/node-entry.ts:293`) that gets past the full-disk check (`:374`)
tops the spare up to `SPARE_SPACE_BYTES`, by appending, when the lower free space of the state and
venue folders is at least `SPARE_SPACE_BYTES + FULL_DISK_BYTES` (24 MiB). So a spare is never written
onto a disk that would then read as nearly full, and a disk that fills slowly gets its spare while
24 MiB is still free. A short spare (a cut write, an earlier release) is topped up the same way.

- A write the system refuses is logged `storage.spare_write_failed` with its `errno` and never thrown:
  whatever was written stays (a smaller spare still helps), and the next start with room tops it up.
- The spare is always the one in the box's configured state folder, `deps.stateDir` in `runEntry`, never
  `rooted.stateDir`: for a box running from a selected recovery that is the recovery's target folder
  (`node-entry.ts:352-372`), which is inside the configured one.
- The start's wiring passes the size as `EntryDeps.spareBytes` (default `SPARE_SPACE_BYTES`); `0`
  keeps no spare, which the control cases use. Only `runEntry` writes it: a server already running holds
  its own venue lock and never needs room to take it.

**Deleted (released) only by the two paths that free a recovery's copy, and only on a nearly full disk**
— the lower free space of the state and venue folders under `FULL_DISK_BYTES`:

1. **The start's emptying of a discarded recovery** (`emptyDiscardedRecovery`): when the journal's last
   record is `abandoned` and the folder is not yet an emptied tombstone — so there is a copy to free —
   it releases the spare, then empties as today. The start's top-up later in the same `runEntry` writes
   it back only when the emptying left the spare plus 16 MiB free; otherwise the box runs without a
   spare until a start with that much room. This is Example 2.
2. **The repair host, before the four requests of the Start-again flow**: `GET /resolution` (the
   inspection), `POST /resolution/recover` (the password step), `POST /resolution/start-again/summary`
   and `POST /resolution/start-again`, when no recovery is running in this process
   (`runningInMemory()` false) and the journal names one Start again would discard: its last record is
   `prepared`, `placement-started` or `restored` (a stopped recovery), or `abandoned` and not yet
   emptied. This is Example 1. Nothing writes the spare back in the repair host: Start again restarts
   the box (`requestRestart`), and that start tops the spare up, now with room.

   The release step is mounted in `resolutionApp` (`apps/server/src/first-setup-entry.ts:297-362`) before
   `mountFirstSetupResolutionFence` (`:312`), whose `fenceWrite` calls `sealLapsed()` and can write.
   `resolutionApp` is reached from four places, and every one passes the spare option: the backup
   recovery's repair branch (`:71-76`) and the three in `resolveLegacyFirstSetupEntry` (`:251-277`), which
   serves the repair page of a box that started with no recovery folder. That last case is how Example 1
   happens without a restart: a recovery opened on that page whose placement fails is marked failed
   (`apps/server/src/first-setup-backup-recovery.ts:1465-1471`), so `runningInMemory()` turns false and
   the next request of the flow releases the spare.

A release that deleted bytes logs `storage.spare_released` with the bytes
released; finding no spare logs nothing. No other
path releases it: not the recovery's own steps under `/resolution/backup/`, not the start's log
clean-up, not Box status's **Free** (`apps/server/src/free-space-now.ts`), not the running server.
Guard: `scripts/spare-space.test.ts` (Task 8 of the plan), weaker than its name: it reads text, and
names the files allowed to import the release.

**Why no lock is taken to delete or write it.** The spare is not in a venue folder and not in
`<state>/backup-staging`, the two places CLAUDE.md §3 puts under a lock or a turn ("One process owns a
venue folder at a time"; "Anything that writes or deletes in `<state>/backup-staging` does it inside the
staging turn"). Taking a lock to delete it would need the room it exists to give. Both operations
are safe to repeat and to race: a release is an `unlink` that treats `ENOENT` as done, and a top-up
appends only while the file is shorter than the cap, so two processes (a start beside a running
server, which the venue lock then refuses) at worst leave a file a chunk over the cap. The lock rule
itself is unchanged: the emptying and every Start-again step still take the venue locks; the spare
only gives them room to.

**Accepted limits** (read, not run):

- After a release on the repair host, a resume of the stopped recovery could use the room. The page
  does not offer **Recover from backup** beside a stopped recovery
  (`apps/server/src/guide/en/backup-recovery.md:28`), but the server's `open` accepts that
  recovery's id (`apps/server/src/first-setup-backup-recovery.ts:827-839`).
- A box upgraded onto this change with its disk already under 24 MiB free has no spare until a start
  finds room. Before go-live any box may be reset instead (CLAUDE.md §3, "No backwards-compatibility
  or data-migration code until Waitron is in production").

## Example 2: a discarded recovery's copy fills the disk at the start

1. `freeSpaceAtStart` runs as today (logs, crash reports, staging leftovers).
2. `resolveFirstSetupEntry` → `refusedAtStart` → `emptyDiscardedRecovery`: the journal's last record
   is `abandoned`, the folder is not a tombstone, the free space is under 16 MiB, so it releases the
   spare (8 MiB free), takes the box's venue lock and the copy's lock (16 KiB, M2), deletes the copy,
   releases both locks.
3. `runEntry`'s full-disk check writes `recovery.json` back (`countWritable`, `node-entry.ts:462-477`):
   with the copy gone it succeeds, so no full-disk page.
4. The top-up writes the spare back only when the emptying left at least the spare plus 16 MiB free.
   On the 32 MiB test image it does not: the emptying frees about 4 MiB, so the spare comes back at
   the next start with room (pinned by the real-disk case "…but the box's spare file"). M3 measured,
   by hand, 4210688 bytes free after the emptying with the spare written back regardless.
5. The start carries on as it would on a roomy disk.

When the spare is missing or too small, step 2 fails as today and the start serves the full-disk page,
which now says what is still there (below).

## Example 1: a stopped recovery filled the disk, and the person presses Start again

1. The recovery's placement fails on the full disk; the recovery stops (no restart is needed).
2. The person reloads the repair page. `GET /resolution` arrives: a stopped recovery, under 16 MiB free
   → the repair host releases the spare. The inspection now has room, so with the setup database
   present it can check the database (M6b) and the page offers Start again.
3. Password step, summary, Start again: each takes its lock and writes its records in the released
   room (the whole flow needs 64 KiB, M4). Start again deletes the copy (gigabytes back), records the
   discard, and restarts the box.
4. The next start tops the spare up.

**The repair page's full-disk answer.** If the spare was already used or never written, a request of
the Start-again flow can still fail for lack of room. The three POST routes of that flow (not the
activation routes, whose "Do not repeat activation" caution stays) then answer
**`507 storage.disk_full`** in two cases, judged on the lower free space of the state and venue folders
read after the failure:

- an error that is not an `AppError`, when `fullDiskFailure(error, free)` holds
  (`apps/server/src/boot-failure.ts:71-77`): the house's own test, so a plain bug is not called a full
  disk just because the released spare left the disk under 16 MiB;
- `setup.attempt_invalid` with under `FULL_DISK_BYTES` free, because a refused record write arrives with
  no cause (`durable-host-json.ts:15`). That is A1098's rule for its own form
  (`apps/server/src/recovery-start-again.ts:397-401`). Weaker than its name: an `attempt_invalid` from a
  damaged record on a nearly full disk is reported as a full disk; the real refusal shows once there is
  room.

A refusal with any other code keeps its code (a wrong password stays a wrong password).

**The page's first read says so too.** With the setup database present and no spare left, the
inspection answers `database: "unknown"` on a full disk (M6b), which hides Start again
(`presentStartAgainAllowed`, `apps/setup/src/setup-app.ts:238-243`) with no word about the disk. So
`GET /resolution` answers `507 storage.disk_full` when the inspection says `"unknown"` and under
`FULL_DISK_BYTES` is free. With room, an `"unknown"` answer is unchanged.

**The setup app draws these words only on the repair page's own steps.** `FIRST_SETUP_ERROR_MESSAGES`
(`setup-app.ts:226-235`) is copied into the adoption, reset, bucket and Cloud maps (`:251`, `:259`,
`:375`, `:406`), is what `#recordConnectionFailure` (`:819-826`) uses to send a code to the first-owner
screen, and backs `#describeFirstError`, which the activation steps use with the fallback "Reconnect to
check the saved result. Do not repeat activation." (`apps/setup/src/screens/initial-owner-strings.ts:63`).
On Linux a full disk already answers `507 storage.disk_full` (`packages/server-kit/src/error-boundary.ts:34-40`),
so adding the code to that shared map would make an activation step say "Then try again". The words
therefore get their own key, `shell.first_setup.disk_full`, drawn by a repair-page helper used only by
the repair page's inspection reads, the password step, the Start-again summary (`#presentReadsFailed`),
Start again, and the claim of a replacement setup from the repair page (`#claimFirstSetup`, whose one
error handler also covers the inspection read it opens with). Every other caller keeps its words; a test pins that an activation step refused
`storage.disk_full` still draws "Do not repeat activation".

- EN: "The box's disk is full, so Waitron cannot save anything. Restart the box: as it starts, it
  removes old logs and crash reports to make room. Then try again. If the disk is still full, Waitron
  cannot free more space by itself. If you reinstall Waitron, the box starts fresh, but everything on
  it is lost."
- ES: "El disco del equipo está lleno, así que Waitron no puede guardar nada. Reinicia el equipo: al
  arrancar, quita registros y avisos de fallo antiguos para hacer sitio. Después, vuelve a intentarlo.
  Si el disco sigue lleno, Waitron no puede liberar más espacio por sí solo. Si reinstalas Waitron, el
  equipo empieza de cero, pero se pierde todo lo que contiene."

The first sentence is the full-disk page's title, because the look check (Task 9) found the earlier
"this step could not be saved" false where only the page's first read was refused. The last sentence follows OPEN QUESTION Q1's default and changes with it. "Restart the box" is already
used on these pages (`apps/server/src/guide/en/backup-recovery.md:85`; `apps/setup/src/i18n/backup-repair.ts:27`).

**The repair start runs the log clean-up too.** Today a start that finds a recovery at its repair stage
skips all clean-up (`node-entry.ts:316-317`, from #2043), because the A731 plan forbids running "normal
boot cleanup against their directories" (`docs/superpowers/plans/2026-10-24-a731-repair-backup.md:31`):
the originals walk covers the state and venue folders whole, and deleting a staging leftover there
would refuse the recovery's resume (above). Rotated logs and crash reports are outside both folders on a
box (`WAITRON_LOG_DIR=/var/lib/waitron/logs`, its own volume, `deploy/Dockerfile:271`,
`deploy/compose.yml:42-45`). So the repair start now runs the log and crash-report part of
`freeSpaceAtStart` when the log folder's real path lies outside both roots, and still never the
staging part. This is what makes "Restart the box" above a step the person can take. When the log
folder is inside either root (a development layout), the repair start deletes nothing, as today.

**The repair start must never show the full-disk page.** Today it uses `belowFloor: false` there
(`node-entry.ts:314-325`), but `:367-372` recomputes it whenever the folders the start runs from
differ as text from the configured ones (`moved`). A repair taken from a recorded journal returns
`selected.target.source` (`first-setup-backup-entry.ts:102`), stored resolved through symbolic links
(`first-setup-backup-workspace.ts:114-118`), and `deps.stateDir` is not resolved, so on a configured
path through a link (macOS `/var` → `/private/var`) a repair start can serve the full-disk page in
place of the repair page today (read, not run; round-3 check, 2026-10-28). The repair start keeps
`belowFloor: false` whatever the clean-up finds, and skips that recomputation at the repair stage;
the clean-up is used only for its deletions.

**A decision beyond the three approved items.** The owner approved the spare file, the repair page's
answer and the full-disk page's words. The repair-stage log clean-up is this design's own addition, made
because the item's brief asked whether today's repair entry path should run the space clean-up too;
the PR lists it for approval.

## The full-disk page

The start's full-disk page (`storage.disk_full` in `OPERATOR_TEXT`) is shown only after the box has
deleted what it can by itself and released its spare where a copy was waiting. Its words must be true
in both cases that remain: nothing more the box can free, or a discarded copy it could not delete.

- **Title** (unchanged): "The box's disk is full, so Waitron cannot save anything." / "El disco del
  equipo está lleno, así que Waitron no puede guardar nada."
- **Action** (OPEN QUESTION Q1's default, option A):
  - EN: "The box has deleted the temporary copies, old logs and crash reports it can make again, and the
    disk is still full. Your sales and the venue's database are not touched. Waitron cannot free more
    space by itself: the rest of the disk holds the venue's data, the backups kept on this box and files
    that are not Waitron's. Once more space is free, press “Retry a normal boot”. If you reinstall
    Waitron instead, the box starts fresh, but everything on it is lost, sales included, unless a backup
    is restored afterwards."
  - ES: "El equipo ha quitado las copias temporales, los registros y los avisos de fallo antiguos que
    puede volver a crear, y el disco sigue lleno. Tus ventas y la base de datos del local no se tocan.
    Waitron no puede liberar más espacio por sí solo: el resto del disco guarda los datos del local, las
    copias de seguridad que se guardan en este equipo y archivos que no son de Waitron. Cuando haya más
    espacio libre, pulsa «Reintentar un arranque normal». Si en cambio reinstalas Waitron, el equipo
    empieza de cero, pero se pierde todo lo que contiene, ventas incluidas, salvo que después se
    restaure una copia de seguridad."
- **One more line, only while a discarded recovery's copy is still there** (the journal's last record is
  `abandoned` and the folder is not an emptied tombstone, checked when the page is drawn, with the copy's
  size summed over its regular files):
  - EN: "This disk also still holds {size} left by a recovery from backup that Start again discarded. The
    box removes it as it starts, but it needs a little free space to do that safely, and has none."
  - ES: "Este disco también guarda todavía {size} de una recuperación desde copia de seguridad que
    «Empezar de nuevo» descartó. El equipo la quita al arrancar, pero necesita un poco de espacio libre
    para hacerlo con seguridad, y no lo tiene."

**These words pass the page's own checks.** `recovery-surface.test.ts` refuses any action that suggests
wiping: "wipe", "erase", "delete", "reset" in English and `NEVER_WIPE_ES` (`:198`, applied at `:402-409`)
in Spanish, which matches "borra" and so would refuse "ha borrado" and "pero borra todo". The Spanish
therefore says «ha quitado» and «se pierde todo», and the reinstall sentence follows the owner-approved
A1098 line «…pero se pierde todo lo que contiene…» (`recovery-surface.test.ts:1191-1198`). The button is
named as drawn, “Retry a normal boot” (`recovery-surface.ts:184`). Measured: the patterns copied from the
test, run over these four texts, match none of them, and match the earlier draft's Spanish (control):
`~/waitron-campaign/a1127-measure/wording-guard-check.txt`.

**Existing tests that pin the old words** change with them: `recovery-surface.test.ts` "names a full disk
in both languages" and "says the box has already deleted what it could, in both languages"
(`:495-527`), `DELETED` in `node-entry.full-disk.test.ts:92-94` and in
`start-full-disk.e2e.test.ts:107-109`, and the prose in `docs/developers/conventions-ui.md:1112-1122`.
They pin wording, which is what this item changes; their other assertions stay.

The status and free-space lines stay. The "For whoever installed this box" heading (`PAGE_TEXT`) is a
separate label for the installer detail below the action and is not touched here.

## OPEN QUESTIONS (for the owner)

The build proceeds on each default; the PR lists them for approval.

### Q1. What the box says when it has nothing more it can free (default: A)

*Worked example.* Elena's box has a 32 GB disk. Over a year the database has grown to 9 GB, and the
local backup folder keeps 20 GB of archives. One evening the disk fills; the till shows "Nothing can be
saved". Overnight the box restarts. The start deletes 300 MB of old logs, which is not enough, and shows
the full-disk page. No discarded recovery is involved. Today the page tells Elena to ask whoever
installed the box. Under the 2026-10-25 rule it must not, but nothing she can press on the page frees
space.

- **A (recommended, the build's default):** explain only. The page says what the box deleted, that her
  sales are safe, what fills the rest of the disk (the venue's data, the backups kept on the box, files
  that are not Waitron's), that Waitron cannot free more by itself, and what reinstalling costs. It names
  nobody. Cost: Elena still needs someone with access to the box, but the page no longer says so.
- **B:** a separate item: behind the administrator password, the page offers "Delete the oldest backups
  kept on this box" with a safe Stop beside it, deleting archives oldest first until there is room.
  Cost: the first page action that deletes a finished backup; it needs its own design (which archives,
  how many, what if the backup folder is elsewhere).
- **C:** a separate item: when nothing else can be freed, the start boots into a limited mode using the
  spare's room, so Box status (Disk space, Free, the backup settings) can be reached from the dashboard.
  Cost: a start that boots on a full disk, which the start was built never to do; its own design.

Reply "A1127 Q1: A", "B" or "C" (B and C would be new items; A1127 ships A meanwhile).

## What this does not change

- **Fiscal records and chains.** The spare module writes and deletes one file, `<state>/spare-space`,
  and opens no database. The two release points run before code that exists today and that this item
  does not change: the emptying deletes a discarded recovery's folder except its records and lock files
  (`KEPT_IN_TARGET`, `first-setup-backup-discard.ts:20-21`), and Start again writes the same
  confirmation record, note and abandon record it writes today (`first-setup-resolution.ts:596-648`).
  The copy being deleted was never the box's database: it is a stopped or discarded recovery, which
  the owner ruled disposable on 2026-10-25 (A1042). `registros_facturacion` and the hour chain are not
  touched.
- **Series names: protected as today, now also on a full disk.** Start again over a stopped recovery
  takes a time floor from that recovery's series names (`gatherStartAgainFloor` with the stopped
  recovery's floor, `first-setup-resolution.ts:551-558`) and raises the start-again note to it
  (`:605`) before it abandons, empties or deletes anything (`:606-640`). `raiseStartAgainNote` only
  ever raises the floor (`packages/provisioning/src/first-setup-start-again-note.ts:57-71`). This item
  makes that path reachable on a full disk; it does not change it. So the plan proves two things: after
  a Start again on a full disk the note carries the stopped recovery's series name, and when the note
  cannot be written, nothing is abandoned, emptied or deleted. The spare's own time never enters the
  floor, which reads only the attempt's listed files (above). The plan's last task checks the branch's
  added lines for fiscal names and stops to ask the owner on any hit.
- **The lock rules.** No lock file is ever unlinked; every lock is still taken before a venue folder
  changes. `recovery.json` is still changed only through `updateRecoveryState`.
- **What free-space deletion deletes**, at the start or from Box status: unchanged, and it never
  deletes the spare.
- **A1098's Keep or Move page** on a full disk keeps its own `diskFull` words.
- **A running server on a full disk** (A798-B's degraded mode) does not use the spare.

## Guides, docs and backlog

- `apps/server/src/guide/en/backup-recovery.md` and `es/backup-recovery.md`: after the Start-again
  paragraphs, one paragraph: on a full disk Start again still works, because the box keeps a little
  space spare for it; if even that has been used, the page says the disk is full, and restarting the box
  deletes old logs and crash reports first.
- `apps/server/src/guide/en/box-status.md` and `es/box-status.md`, the **Disk space** line: the rest of
  the disk includes 8 MB the box keeps spare so that, on a full disk, it can still delete what it no
  longer needs.
- `deploy/README.md`, "When the page names `storage.disk_full`": the spare, the repair start's log
  clean-up, the new words.
- `docs/developers/conventions-data.md`: a section "The box's spare file" beside "One process per venue
  folder", the receipts above; "What free-space deletion deletes" says it never deletes the spare.
- `docs/developers/testing-guide.md`, "The full-disk start tests run on a small filesystem": the new
  cases, `spareBytes`, and the second real-disk file with its own small filesystem
  (`WAITRON_FULL_DISK_DIR_START_AGAIN`; two files filling one filesystem would fail each other).
- `docs/developers/conventions-ui.md:1112-1122`, which quotes the full-disk page's old first sentence.
- `CLAUDE.md` §3 (Data): one line for the rule and its guard, weaker than its name.
- `docs/backlog/setup.md`: the entry "A full disk while a backup recovery fills it is a dead end for the
  person" and its line in `docs/backlog.md` are deleted. What stays open becomes short entries: Q1's B
  and C if the owner picks them; the resume limit above; and "the spare's sufficiency on ext4, and on a
  copy-on-write filesystem" (below).

## Open, not measured

- **Linux ext4** (the box's likely filesystem): bytes for a lock and for the emptying (ext4's 4 KiB
  blocks and its journal), and whether the root-reserved blocks matter. The server runs as `waitron`
  (uid 10001, `deploy/Dockerfile:186,283`) with only `cap_net_bind_service` (`:179`), so it cannot write
  into the reserved blocks, and `freeBytes` reads `bavail`, the unprivileged figure
  (`apps/server/src/free-bytes.ts:5-12`); both read, not run. CI's `test-server-stream` job runs the
  new real-disk cases on 32 MiB Linux tmpfs mounts, which gives a Linux tmpfs reading, not ext4.
- **Copy-on-write filesystems with snapshots** (btrfs, zfs): deleting a file may free nothing while a
  snapshot holds it, and compression could store a fill pattern in less space. Not the box's setup as
  far as `deploy/` says; not measured.
- **Whether Docker's volumes share the host's root filesystem** on every box, including the `logs`
  volume, whose rotated logs the repair-stage clean-up deletes to make room for the state folder: true
  for the default local volume driver (believed, not run here). If `logs` were on another filesystem,
  that clean-up would free nothing for the state folder. If the state volume were on its own filesystem, the
  spare still sits beside what it frees, since it lives in the state folder.
