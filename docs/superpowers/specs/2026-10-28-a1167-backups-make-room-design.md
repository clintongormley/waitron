# A1167: backups make room for themselves

_2026-10-28: slice 1 is built by [the slice 1 plan](../plans/2026-10-28-a1167-1-room-before-backup.md).
The owner's answers replace §5's words, and the plan's "Deviations from the design" list
where the build differs from this design. Slice 2 and the start-time slice (Q4) are not built._

_2026-10-29: slice 2 is built by [the slice 2 plan](../plans/2026-10-29-a1167-2-watch-deletes-backups.md).
§1's "never deletes toward a goal it cannot reach" binds a backup run's room step only: as §2 says,
the watch deletes every backup §1 allows when they cannot reach 2.5 GiB._

The owner, 2026-10-28 ~08:35 CET (`~/waitron-campaign/questions.md`, "WATCHER … A1167 queued for
you"):

> our backup policy needs to delete old backups automatically when we're running out of disk space,
> plus alert the administrator, plus refuse to do a backup if there still isn't enough space, and
> alert the manager.

So: (1) when the box's disk runs short, it deletes its oldest backups by itself; (2) it tells an
administrator it did; (3) when even that leaves too little room for a backup, the backup is refused
before it starts; (4) a manager is told. This design is docs only; nothing is built until the owner
answers the questions below.

It sits beside A1127's full-disk design
([2026-10-28-a1127-full-boot-and-old-backups-design.md](2026-10-28-a1127-full-boot-and-old-backups-design.md),
"A1127" below), whose slices 2–3 the owner approved on 2026-10-28 ~08:20 and which are not built yet.
It uses A1127's rules for which backups may be deleted, unchanged, and changes what A1127's slice 3
and the full-disk page's button are for (§6, Q3, Q4).

Every "measured" below was run on 2026-10-28 on macOS 26.6.2 (arm64), Node v26.11.1, on the full-disk
harness's 32 MiB HFS+ image (`openSmallDisk`, `apps/server/src/testing/full-disk.ts`). The probe, the
command and the raw output are in `~/waitron-campaign/a1167-measure/` (`README.txt`). The failing
outcome was written down before the probe ran. Everything else is marked "read".

## What happens today

- **Backups kept on the box** are archives in a backup folder: one set on the dashboard's Backups
  screen (any path typed there, `archive-settings.ts:414-421`, stored sealed in the venue database), or
  several named by the environment (A1127 "What happens today" has the detail, read). The box mounts a
  `backups` volume beside the `state` and `logs` volumes (`deploy/compose.yml:42-45`), the folder
  `.env.example` suggests; volumes on one machine share its disk unless the operator moved them (read).
- **Each backup run** (`runOnce`, `apps/server/src/backup-sweep.ts`) copies the database into the
  state folder's `backup-staging` (`VACUUM INTO`, `packages/store/src/archive.ts`), encrypts the copy
  beside it, then copies the encrypted file to each destination. A folder destination writes a whole
  new file and renames it into place (`copyAtomic`, `apps/server/src/local-fs-backend.ts:124-140`).
  Neither step compresses (read: no compression call in `backup-archive-file.ts` or
  `artifact-cipher-file.ts`). The staging copy and the encrypted file are removed only after every
  destination has finished (`backup-sweep.ts`, the `finally` of `runOnce`). So a run to a folder on the
  box's own disk holds about **three** copies of the database at its peak.
- **The space check counts two of them.** Before the copy the run refuses with
  `backup.staging_space_low` when the staging folder's disk has less than twice the database file's size
  free, and after the copy when it has less than the copy's size (`checkStagingSpace`, read). It does
  not count the folder's copy. **Measured:** with a 6 MiB copy and 15 MiB free (between two and three
  copies), both checks passed, 3 MiB was left before the folder copy, and that copy failed `ENOSPC`
  (logged `backup.destination_failed`, error code `unknown`, errno `ENOSPC`); nothing was stored. With
  22 MiB free the archive was stored; with 10 MiB the run was refused `backup.staging_space_low` before
  copying. Not measured: the free space while the copy ran (the copy wrote until the system refused it,
  which on this probe means a full disk), and what a till sale does at that moment (A798's full-disk
  stop answers `storage.disk_full` under 16 MiB, read). The room check reads the database file's size
  without its change log (`venueStagingEstimate`, `apps/server/src/backup-supervisor.ts:151-160`), so
  it is an estimate of the copy's size, not a bound either way.
- **Old archives are pruned only after a successful run**, per folder, past the count (7 by default)
  or the age (30 days) (`pruneBackend`, `backup-config.ts:42-43`). A run that is refused prunes
  nothing, so a disk too full for a backup stays full: nothing deletes an archive to make room.
- **Who hears about it.** A refused run raises the `backup.run_stopped` alert with the refusal's code,
  to everyone holding `system.manage` (managers and administrators), on the dashboard's bell only
  (`backupAlertSource`, `apps/server/src/alert-sources.ts:148-222`; it is not among the emailed codes in
  `apps/server/src/i18n/box-emails.ts`). It lives in memory and goes once a later run has encrypted its
  copy (`backup-sweep.ts:179`), even if every destination then fails. The disk
  falling under 2 GiB raises `storage.space_low` (`SPACE_LOW_BYTES`,
  `apps/server/src/free-space-watch.ts:8`, cleared at 2.5 GiB), on the bell and by email to the same
  people (`readManagerEmailRecipients`, `apps/server/src/manager-email-recipients.ts`). No alert goes to
  administrators alone today: every box and backup alert uses `system.manage`, and an administrator
  holds every permission (`packages/identity/src/permissions.ts`, `ROLE_PERMISSIONS`). Read.

## The design

### 1. Which backups the box may delete by itself

Exactly A1127 §4's set, nothing wider: an archive in a configured backup folder on the box's own disk,
a regular file named as a backup archive, **taken after the current installation began** (so never one
from before the box's last restore, re-registration or Start again, which can hold sales the live
database does not have), and **never the newest in its folder**. A backup in a bucket is never
deleted by this. A box whose installation start cannot be read offers nothing (A1127 §4: the no-regime
fiscal module has no such row; A1127's plan finds the stored fact or offers nothing). Whichever of
A1127 slice 3 and A1167 slice 1 is built first builds this reader; the other reuses it.

"The box's disk" below is the disk holding the venue folder, which the free-space watch reads
(`boot.ts:2294`); on a box the staging folder and the `backups` volume are on it too. A backup folder
on another disk is never deleted from, and a run that fills that other disk still fails `ENOSPC` there
without being refused first (a deliberate limit).

The box deletes the **oldest first**, one archive at a time, reading free space afresh after each
(`statfs`, never a sum of sizes), and stops as soon as it has the room it was after. **It never deletes
toward a goal it cannot reach**: before the first deletion it adds the sizes of every archive it may
delete to the free space, and if even that falls short, it deletes nothing for that goal (§3's refusal
then deletes nothing; §2's watch still works toward its own, smaller goal). Each deletion is logged
`backup.archive_deleted` with the name, the size and why (`space_low` or `backup_room`), and no person
id (A1127's dialog logs the person; nobody pressed anything here).

It deletes only where backups still run. Today no backup run starts when backups are switched off,
the recovery key is missing, or the box is not the primary (`backup-supervisor.ts:208-219` returns
before `runBackupSweep`); there nothing would replace what it deletes, so by this design the watch
deletes nothing there either, a standby or mirror box included.

### 2. When the disk runs short (slice 2)

The free-space watch (every 60 seconds, `startFreeSpaceWatch`) reads the disk. When a reading is under
**2 GiB** (`SPACE_LOW_BYTES`, the line where the box warns today), it deletes old backups under §1
until the disk has **2.5 GiB** free (`SPACE_OK_BYTES`), before it records the reading. So when old
backups can cover it, the low-space warning never comes on and managers get no low-space email; the
administrator alert (§4) says what was deleted. When they cannot, it deletes every one §1 allows and
the warning comes on as today.

It takes the backup staging turn's `ifNoBackup`, as Box status's **Free** does
(`apps/server/src/backup-staging-turn.ts`): while a run holds the turn it deletes nothing and tries
again at the next reading. A folder restore is the `waitron-restore` command, a separate process
(`restore-command.ts:90-103`) the watch cannot see, and the archive download
(`archive-download.ts:44-80`) runs only inside that command (`restore-command.ts:570`) and reads a
bucket. So a deletion can race a folder restore before the
restore has opened the file (on Linux an open file stays readable after it is deleted; not measured).
A deliberate limit, as for A1127's dialog.

**Every start runs a backup at once** (`runBackupSweep` calls `tick` first, `backup-sweep.ts:273`),
started before the watch (`boot.ts:2237` before `:2293`), so at a start the watch finds the turn
taken and deletes nothing; the start's run makes room under §3 instead, up to the run's own goal. Its
room step comes first in the turn, before the manifest and the copy, so the room is made within
seconds. The low-space warning can still come on at a start under 2 GiB if the watch's first reading
lands before that step; accepted.

### 3. Before each backup run (slice 1)

Inside the staging turn the run already holds, before it copies anything, the run works out the room
it needs on the box's disk: **twice the database file's size** (the staging copy and the encrypted
file, as today) **plus the database file's size once more for each backup folder on this disk** (the
measured gap). Then:

- **Refuse.** If the free space plus every archive §1 may delete is less than the room needed plus
  **256 MiB** (`START_FREE_SPACE_FLOOR`, `apps/server/src/start-space.ts:11`, the start's own floor,
  so the tills keep room to sell through the run), the run deletes nothing and is refused before it
  copies anything, with `backup.staging_space_low` and the sizes, and the manager alert (§4) goes out.
  A run that cannot happen never costs a restore point.
- **Make room.** Otherwise, if the disk has less than the room needed plus **2 GiB**, it deletes old
  backups under §1 toward that much, so the run itself does not push the box under the low-space line
  (if it did, the watch could not delete during the run, and managers would get a low-space email
  every night). When it cannot reach the 2 GiB line, it deletes only what the 256 MiB line needs.
- **Then it runs**, and prunes after, as today.
- **A second check before the folder copy.** The first check uses the database file's size, an
  estimate (above). Once the encrypted file exists, the run takes its real size once for each backup
  folder on this disk, and makes room or refuses by the same two rules before the copy, so the measured
  `ENOSPC` cannot come back through a copy larger than the estimate (a change log holding growth, or
  sales during the run). It runs before any destination is tried, refuses the whole run (a bucket
  destination included) and sets the refusal alert; the clearing of that alert at `backup-sweep.ts:179`
  moves after it. Today's after-copy check, which protects the encryption step, stays.

A bucket-only box has no folder to delete from: its run needs twice the database file's size, and is
refused as today when that is missing, with the 256 MiB margin added. That changes the three
before-copy cases in `backup-sweep-staging.test.ts` (the refusal's pinned `neededBytes: 2000`,
"proceeds when free space covers twice" and "exactly twice"); slice 1 lists them in its pull request as
deliberate changes.

Worked numbers are in "Elena's box" below.

### 4. Who is told, and how (Q1, Q2)

- **The box deleted old backups by itself:** a recorded alert, `backup.archives_deleted` (a new code, in
  the `backup` area), on the dashboard's bell, emailed while it stays open, as the clock alerts are
  (`CLOCK_INCIDENT_EMAIL_CODES`, `apps/server/src/box-alert-email.ts`). One is open at a time
  (`recordIncidentOnce`); it names the first deletion, not a running count. Once
  someone marks it handled, the next automatic deletion raises a new one. Who receives it: **Q1**.
- **A backup was refused:** the existing `backup.run_stopped` alert with `backup.staging_space_low`,
  to managers and administrators (`system.manage`) on the bell as today, with new words (below) and the
  sizes; whether it is also emailed: **Q2**.
- **What the deletion alert costs to build** (read):
  - A recorded alert names its source, and the database allows only the sources in `SOURCES`
    (`packages/shared/src/origin.ts:9-18`, checked by `packages/db/src/schema/origin.ts:14-16`); none
    is a box job. A new source, `backup`, changes that check on every table whose column takes all
    sources (`incidents`, `working_orders`, `order_amendments`, `unpaid_departures`, and workforce's
    `time_entries`): a migration that rebuilds those five tables in two migration sets, meeting both
    rebuild traps (CLAUDE.md §3: the expression index in `incidents.ts`, and foreign keys on during
    `DROP TABLE`). The last such addition was `0095_operator_script_source.sql`. Before go-live that is
    acceptable.
  - Every incident claim comes from a module's descriptor (`apps/server/src/modules.ts:52-54`), and no
    module claims `backup.`; the server adds its own claim for `backup.archives_deleted`, in the
    `backup` area with the permission Q1 chooses. `scripts/alert-codes.test.ts` reads `ALL_MODULES`
    only (`:121`), so it must be taught that claim, and the new code's file added to
    `INCIDENT_CODE_SOURCES`. The code needs English and Spanish words (CLAUDE.md §3).
  - The email duty mails one recipient list, everyone holding `system.manage`
    (`manager-email-recipients.ts:11-33`, `box-alert-email.ts:137-156`), and reads only the disk state,
    staff notices and clock incidents (`box-alert-email.ts:275-310`). Q1's answer A needs recipients
    chosen per alert; Q2's answer A needs the refusal read from the backup run's memory.
  - Email episodes live in memory (`box-alert-email.ts:193`) and every start runs a backup at once, so
    a box that keeps refusing emails again after each restart, as is an open deletion alert.

### 5. Words (English and Spanish, for the owner's approval)

- **Deleted, bell.** EN: "On {date} the box deleted its oldest backup to make room on its disk, and it
  deletes more whenever it runs short, so it may keep fewer than the Backups page asks for. To make room
  it never deletes the newest, nor any from before its last restore or reinstall. To keep more, keep
  backups in a bucket instead, or fit a bigger disk." ES: «El {date} el equipo borró su copia de
  seguridad más antigua para hacer sitio en su disco, y borrará más cuando le falte espacio, así que
  puede guardar menos de las que pide la página de Copias. Para hacer sitio nunca borra la más reciente
  ni las anteriores a su última restauración o reinstalación. Para guardar más, guarda las copias en un
  bucket o instala un disco más grande.» (With more than one deleted at the first deletion: "deleted its
  {n} oldest backups" / «borró sus {n} copias más antiguas».)
- **Deleted, email subject.** EN "The box deleted old backups to make room" / ES «El equipo ha borrado
  copias de seguridad antiguas para hacer sitio». Body: the bell's words.
- **Refused** (the `backup.staging_space_low` sentence inside `backup.run_stopped`, which already says
  that no new copy was saved and that sales continue). EN: "A backup needs about {needed} free on the
  box's disk and the disk has {available}. Deleting the old backups the box may delete would not make
  enough room, so it deleted none (to make room it never deletes the newest, nor any from before its
  last restore or reinstall). On Box status, Free deletes leftover working files, old logs and crash reports. Backups
  kept in a bucket instead of on the box need less room." ES: «Una copia de seguridad necesita unos
  {needed} libres en el disco del equipo y el disco tiene {available}. Borrar las copias antiguas que el
  equipo puede borrar no dejaría sitio suficiente, así que no ha borrado ninguna (para hacer sitio nunca
  borra la más reciente ni las anteriores a su última restauración o reinstalación). En Estado del equipo, Liberar borra
  archivos de trabajo sobrantes, registros antiguos e informes de fallos. Las copias guardadas en un
  bucket en lugar de en el equipo necesitan menos espacio.»
- **Refused, where the environment manages backups** (the dashboard cannot change them,
  `backup-config.ts:108-122`): the same, without the bucket sentence, which the person could not act
  on from the dashboard. The deletion alert likewise drops "so it may keep fewer than the Backups page
  asks for" and the bucket sentence there: the count is set by the environment.
- **Refused, email subject (if Q2 is A).** EN "A backup was not made: the box's disk is short of room" /
  ES «No se ha hecho una copia de seguridad: falta espacio en el disco del equipo».

Sizes are drawn as the dashboard draws sizes today. `backup.run_stopped` carries only the refusal's
code today; slice 1 adds the two sizes to it.

### 6. How this changes A1127 (Q3, Q4)

- **A1127 slice 2 (start from the spare file, tills stopped until it is back): unchanged, and better
  for it.** A box that started on its spare's room runs a backup at once, whose room step (§3) deletes
  old backups toward the run's goal, and the watch then writes the spare back and the tills sell again
  with nobody signing in, whenever §1 allows a deletion. Where the run can happen it deletes as many
  as the run needs, more than the stop alone needs. Where it cannot, it deletes nothing (§1), and the
  watch's next reading deletes toward 2.5 GiB instead: in A1127's example (a 9 GB database, six older
  2.9 GB backups on a 32 GB disk) a run needs about 27 GB, which deleting all six cannot give, so the
  run is refused and the watch deletes the oldest backup.
- **A1127 slice 3 (the dashboard bar and the "Delete old backups…" dialog).** The dialog offers the
  same set §1 deletes automatically, so by the time anyone opens it the box has already deleted
  everything it would offer. It would show nothing in nearly every case, the exception being a box
  with backups switched off or a standby, where §1 deletes nothing. **Q3** asks whether slice 3 keeps
  only the bar (with its "none can be deleted" words, plus a line naming what the box already
  deleted) or is built as approved.
- **The full-disk page's no-sign-in button (approved 2026-10-28 ~06:57, its own slice, measure
  first).** That page is served when the server could not start, so the watch never runs there. The
  owner's "automatically" points to the start itself deleting old backups under §1 before it releases
  the spare file, rather than a button. That needs the installation's start readable without opening
  the venue database (for example a small file in the state folder, written in the same step that
  starts a new chain), and the list of backup folders, which the dashboard stores sealed in the venue
  database (`archive-settings.ts:250-259`, read at `boot.ts:2212-2217`); the button slice needs both
  too. **Q4.**

## Elena's box (worked example for every question)

Elena's box has a 32 GB disk. The database is 3 GB; each nightly backup kept on the box is about 3 GB;
the Backups page keeps 7. With the system, the images and the logs (6 GB), 30 GB is used and 2 GB is
free.

**Today.** One afternoon the database grows past the 2 GB line: the low-space alert comes on and the
managers are emailed. That night the backup needs 6 GB to prepare and has under 2: it is refused, so
nothing is pruned, and it is refused every night after. The disk keeps filling until the tills stop
(A798). Had there been 7 GB free, the run would have passed its check and then failed copying into the
folder, with the disk full for a moment (the measured gap).

**With this design.**

1. *Afternoon.* Free space falls to 1.9 GB. Within a minute the box deletes the oldest backup
   (21 Oct): 4.9 GB free. The low-space alert never comes on. The administrator alert appears: "On
   28 Oct the box deleted its oldest backup to make room on its disk…".
2. *Night.* The run needs 6 GB (staging) + 3 GB (the copy into the box's folder) = 9 GB, and makes room
   for 9 + 2 = 11 GB. It deletes the three oldest of the six left: 13.9 GB free. The backup is made;
   4 backups are on the box, 10.9 GB free.
3. *Each night after,* the database grows a little, the run deletes one old backup and makes one new
   one: the box keeps 4, not 7, and says so in the open alert.
4. *If the database outgrows the disk* (say 8 GB, so a run needs 8 × 3 = 24 GB plus 256 MB, more than
   the 32 GB disk can give beside everything else), the run sees that deleting every backup but the
   newest would still fall short, deletes none of them, and is refused before copying anything: the
   managers and administrators see "A backup needs about 24 GB free…", and the backups on the box stay
   (the watch still deletes the oldest whenever the disk falls under 2 GB).

## OPEN QUESTIONS (for the owner)

### Q1 of 4. Who is told when the box deletes backups by itself (default: A)

- **A (recommended), as you wrote: administrators only**, on the bell and by email. Cost: no box alert
  goes to administrators alone today. The bell needs an administrator-only permission: one of the four
  that exist (`person.admin`, `personal_data.export`, `mirror.create`, `node.promote`) would mean
  something else, so slice 1 adds one, named as the pending permissions review would. The email needs
  recipients chosen per alert, where today there is one list. Managers do not see it.
- **B: managers and administrators**, like every other backup and disk alert. Cost: the manager is told
  about something they need not act on.

### Q2 of 4. Is a refused backup also emailed? (default: A)

- **A (recommended): yes, to managers and administrators**, like the low-space alert. In Elena's case
  step 4, Marta gets an email the first night a backup is refused, not only a bell she may not open.
  Cost: the email duty learns to read the backup run's refusal, and a box that keeps refusing emails
  again after every restart (its memory of what it sent is lost, and each start runs a backup at once).
- **B: the bell only, as today.**

### Q3 of 4. A1127 slice 3's "Delete old backups…" dialog (default: A)

- **A (recommended): drop the dialog and its Box status button; keep the bar**, which then says the disk
  is full, that the box has already deleted every old backup it may delete, and what Box status can
  still free. Cost: a box with backups switched off, or a standby, can no longer delete old backups from
  the dashboard (§1 deletes nothing there, and the dialog would have offered them); and until this
  design's slices land, nothing deletes old backups on a full disk.
- **B: build it as approved.** Once this design is built it would offer nothing in nearly every case, except on a box with
  backups switched off or a standby.

### Q4 of 4. The full-disk page's no-sign-in button (default: A)

- **A (recommended): replace it by the start deleting old backups by itself**, under the same rules,
  before it releases the spare file; measured first, and only if the installation's start can be read
  without opening the venue database. In Elena's case, a box that filled overnight deletes its oldest
  backup as it starts and boots with room to spare, with no button pressed. Cost: a start that deletes
  files the person never saw listed, and new small files in the state folder kept in step with the
  database (when the installation began, which backup folders the dashboard set, and whether backups are
  on); the button needs the same.
- **B: keep the button as approved** (anyone who can reach the box's address on the venue network can
  press it).

Reply "A1167: Q1 A, Q2 A, Q3 A, Q4 A", or name the letters you want.

## Decisions this design makes

- **A run that cannot happen deletes nothing** (§1, §3). Deleting every old backup and then refusing
  anyway would lose restore points for nothing; the watch's 2.5 GiB goal still applies.
- **No setting to switch automatic deletion off.** The owner asked for it as the policy. A box whose
  operator wants every backup kept on the box gets refused backups instead, and the alert says why.
- **The run makes room for itself plus 2 GiB, and refuses only under 256 MiB** of margin. Making room
  to the low-space line keeps a nightly run from setting off the low-space email; refusing only at the
  start's own floor means a backup still runs on a nearly full disk when old backups cannot be deleted.
- **The count and age settings stay**: pruning after a good run is unchanged. Automatic deletion only
  ever keeps fewer than they say, never more.
- **Folders the environment names are included** (as A1127 decided for its dialog).
- **The refusal keeps its code**, `backup.staging_space_low`: before go-live it could be renamed freely,
  but the code is not what anyone reads; the words are new.

## What it costs, and what it does not change

- **How far back the box can go.** An older backup is the only way back to data changed or deleted
  since (a menu removed by mistake two weeks ago). Automatic deletion shortens that window on the box;
  a bucket copy is untouched.
- **Fiscal records and chains.** Only archives of the current installation are deleted, and never the
  newest; the live database holds every fiscal record such an archive holds, because those records are
  never updated or deleted (CLAUDE.md §5). That is A1127's argument, and it holds only with §1's
  installation rule.
- **A clock that ran ahead.** A backup from before a restore, stamped while the old box's clock read
  ahead, can look newer than the current installation's start and so be deleted; A1127's §4 rule has
  the same limit.
- **A folder two boxes share** holds names with no box id, so one box's automatic deletion can delete
  the other's archives, as its pruning can today (`pruneBackend`; A1127's deliberate limits).
- **Free on Box status** still never deletes a backup.
- **A1089's "exhausted cleanup" backlog entry** asks for a disk-recovery choice that preserves saved
  backups. This design keeps the newest and every pre-installation backup; that entry's other points
  stand.

## Slices

Both FULL review (deleting data, concurrency with the backup run, alert permissions, fiscal history in
old archives). Slice 1 adds a migration (the `backup` incident source), so it does not start while
lane A has a pull request parked (RUNNER H1).

- **Slice 1: before each run.** §1's reader (unless A1127 slice 3 built it), §3's room check and
  deletion, the refusal's sizes and words, the deletion alert with its claim, words and email, and Q1's
  permission. Failing tests first, on the small real disk: with a folder on the same disk and 2.5
  copies' worth free, the run today fails `ENOSPC` (the measured case); afterwards it deletes the oldest
  backup and stores. A run whose need even every deletable backup cannot meet deletes nothing and is
  refused before copying. A copy larger than the estimate is caught by the second check before the
  folder copy. Also: the newest in each
  folder is never deleted; an archive from before the current installation is never deleted (taken
  between a restore's source and the restore); a bucket-only run deletes nothing; a second deletion
  while the alert is open raises nothing new; a link named like an archive is not deleted.
- **Slice 2: when the disk runs short.** §2's watch deletion. Failing tests first: a reading under
  2 GiB with a deletable backup deletes the oldest, reaches 2.5 GiB and raises no low-space alert
  (control: with only the newest backup, the warning comes on as today); a run holding the turn makes
  the watch delete nothing. With A1127 slice 2 built: a box started on its spare deletes, writes the
  spare back and lifts the stop with nobody signed in.
- **Guides.** The Backups and Box status guides, English and Spanish, say that the box deletes its
  oldest backups when its disk runs short, and what it never deletes.

## Open, not measured

- **Linux, and real sizes.** Every figure above is from a 6 MiB copy on HFS+; the real disk is ext4 on a
  box, and the slice 1 test runs on CI's Linux tmpfs as the other full-disk tests do.
- **What a till does during the measured gap**: not tried; A798's stop is read, not run.
- **The `VACUUM INTO` copy's size against the database file's.** Not measured; §3's second check uses
  the encrypted file's real size, so the estimate decides only the first check.
