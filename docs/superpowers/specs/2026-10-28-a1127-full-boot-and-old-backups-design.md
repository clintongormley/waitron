# A1127 slices 2–4: on a full disk, start fully from the spare file, then offer to delete old backups

**2026-10-28, owner answers:** Q1 A as corrected (`questions.md`, "CORRECTION to the A1127 Q1 answer"); Q2 A, Q3 A, Q4 A (keep «Tell a manager» as a stated exception; no slice 4), Q5 A; the 08:25 wording answer replaces §5's proposed sentences (built in slice 2); A1167 Q3 A drops §3's dialog and Box status button, and A1167 Q4 A replaces the full-disk page's button with the box deleting old backups by itself ([A1167's design](2026-10-28-a1167-backups-make-room-design.md)); slice 2's plan narrows §2: the running box writes the spare back only while the marker exists (its decision 9). Slice 2 measured that the bucket stream does not use the spare's room on an idle box (`conventions-data.md`, "The box's spare file").

**2026-10-29:** slice 3 is built by [its plan](../plans/2026-10-29-a1127-3-full-disk-bar.md) as the bar only (A1167 Q3 A): no deletion dialog and no **Delete old backups…** button on Box status; the bar's own button opens Box status.

The owner's answer to A1127 Q1, 2026-10-28 ~03:10 CET (`~/waitron-campaign/questions.md`, "OWNER
ANSWER … A1127 Q1"):

> I approved a previous change of keeping a blocking file on disk that can be removed when the disk is
> full to make space to allow a full boot. After that we should prompt the user to delete old backups.
> If the user doesn't follow these prompts then A.

So, in order: (1) on a full disk the box deletes its spare file and starts normally; (2) once it is up,
it prompts the person to delete old backups kept on the box, oldest first, saying what each choice
does, with a safe way out; (3) the explain-only full-disk page (option A, shipped by #2175) applies only
where the box cannot start at all. In this design a running box whose people do nothing keeps its
prompt and its stopped tills; option A's page appears only at a later start that cannot even write its
start count (§5). The owner asked the design to say where the prompt appears and when the spare file is
written back (§2, §3). This design is docs only; nothing is built until the owner approves it.

Slice 1 (#2175, main 0523d5e42) built the spare file: `<state>/spare-space`, 8 MiB of random bytes,
deleted only to free a backup recovery's copy, written back by a start with 24 MiB free
([conventions-data.md, "The box's spare file"](../../developers/conventions-data.md#the-boxs-spare-file);
[its design](2026-10-28-a1127-full-disk-spare-file-design.md)). It reverses A798's "no reserve" (A798
design §4.6 item 5, owner answer 2026-10-19), by the owner's own later choice (2026-10-26 and
2026-10-28).

Every "measured" below was run on 2026-10-28 on macOS 26.6.2 (arm64), Node v26.11.1, on the full-disk
harness's 32 MiB HFS+ image (`openSmallDisk`, `apps/server/src/testing/full-disk.ts`), with a venue
migrated and seeded by `setupVenue` and a real `startServer` through `ephemeralServerFixture` (only the
listening port mocked; `runEntry` was not run). The failing outcomes were written down before each
probe. Probes, commands and raw output: `~/waitron-campaign/a1127-measure/full-boot/README.txt`. A
fresh-context review (`design-review.md` in the same folder; read, not run) is folded into this
revision. Everything else is marked "read".

## What happens today

- **A start on a full disk.** Below 256 MiB free (`START_FREE_SPACE_FLOOR`,
  `apps/server/src/start-space.ts:11`) the start deletes rotated logs, old crash reports and backup and
  restore staging leftovers (`freeSpaceAtStart`). If it then cannot write its failure count, it serves
  the full-disk page (`apps/server/src/node-entry.ts:396-414`); if it can, it boots
  (`start-full-disk.e2e.test.ts`, "a start whose leftovers free enough counts itself and boots"). A boot
  that then fails for lack of space is recorded with `lastErrorCode: "storage.disk_full"` in
  `recovery.json` when that file can still be written (`node-entry.ts:651-680`; `persistState` swallows a
  failed write, `:164-177`, leaving `server.boot_incomplete`), and after three failed starts the box
  serves the page with the recorded code (`node-entry.ts:551-585`). The spare file is
  deleted at a start only when a discarded recovery's copy is waiting (`emptyDiscardedRecovery`,
  `apps/server/src/first-setup-entry.ts`). Read.
- **What a boot needs (measured).** A second boot of the seeded venue used 4,194,304 bytes while up,
  almost all of it the database's change log (`venue.db-wal`, 4,120,032 bytes: 1,000 pages; it stayed at
  that size, being copied back into the database and reused), plus two 32 KiB index files, the lock
  journal, the holder file and log lines. The change log is deleted when the server closes, so every boot
  allocates it again. With N bytes free: N = 8, 7, 6, 5, 4.5 and 4.25 MiB booted (4,190,208 bytes left at
  8 MiB); N = 4 and 1 MiB were refused `storage.disk_full` while the boot rewrote its live-update triggers
  (`packages/db/src/change-feed.ts:150`, from `applyMigrations`); N = 0 was refused opening the venue
  database (`boot.ts:961`). The failing outcome, a boot refused at 8 MiB, did not happen.
- **What works once up (measured).** At 8 MiB free, a dashboard sign-in (`POST /management-api/session`)
  answered 200 and the Box status read (`GET /api/box/health`) answered 200 with the full-disk notice on.
  With the disk then filled to 0, both still answered 200 (a new sign-in and the earlier session): their
  small writes went into change-log room the boot had already taken. A write that needs the database
  file to grow was not tried.
- **The running box on a full disk (A798).** A start under 16 MiB free (`FULL_DISK_BYTES`,
  `apps/server/src/boot-failure.ts:47`) notes the full-disk stop (`noteFullAtStart`,
  `apps/server/src/disk-full-state.ts:62-72`, called at `boot.ts:998`). While it holds, the write routes
  of the till, schedule and device APIs answer `507 storage.disk_full` (`disk-full-gate.ts:15-43`), sales
  and payments refuse inside (`refuseForDiskStop`); dashboard writes are not gated. Tills and handhelds
  show the red strip "Nothing can be saved: the box is out of space · Tell a manager", the bell shows the
  `storage.disk_full` alert pointing at Box status, and the managers are emailed
  (`alert-sources.ts:297-332`, `box-alert-email.ts`). The stop lifts when a reading finds 16 MiB free
  (`disk-full-state.ts:41-54`; the 60-second watch re-checks it, `free-space-watch.ts:69-79`). Read.
- **Backups kept on the box.** Only when a backup folder is configured: on the dashboard's Backups
  screen (at most one folder, `archive-settings.ts:445-468`), or by the environment, which may name
  several (`WAITRON_BACKUP_DIR` plus `local-fs` entries in `WAITRON_BACKUP_DESTINATIONS`,
  `backup-config.ts:141-152,171-190`; empty by default on a box, `deploy/compose.yml:37`); while the
  environment manages backups, the dashboard refuses every backup change (`backup-config.ts:108-122`,
  `backup-api.ts:295-298`). Archives are named `waitron-<UTC time>-<uuid>.backup.enc`; the name's time
  orders them and carries no box or installation id (`backup-keys.ts:25-43`). Old ones are pruned (7 kept,
  30 days, by default, `backup-config.ts:42-43`) only right after a successful new backup to the same
  folder (`backup-sweep.ts:187-192`); a backup refuses to run with less than twice the database's size
  free (`backup-sweep.ts:106-116,157-158`), so on a nearly full disk old archives are never pruned.
  Nothing deletes an archive by hand: no route, no button. A backup folder on another disk takes nothing
  from this one (`disk-usage.ts:96-108`). In-app Start again leaves the backup folder alone; only
  `waitron.sh reset` removes the `backups` volume (`deploy/waitron.sh:736`). Read.
- **Box status** (`apps/dashboard/src/screens/box-status-screen.ts`, permission `system.manage`, held by
  managers and administrators, `packages/identity/src/permissions.ts:58-84`): the disk row shows free
  space and what fills it (database, backups on this box, logs, the rest); **Free** deletes only what can
  be made again, and never a backup (`free-space-now.ts:26-28`). Its routes are mounted outside the
  full-disk gate (`boot.ts:2441`). On sign-in the dashboard pops up nothing for an alert that is already
  open (`apps/dashboard/src/state/alert-arrivals.ts:1-10`). Read.

## The flow

### 1. The start deletes the spare file only when it could not start otherwise (slice 2)

After `freeSpaceAtStart` and before first-setup resolution, as `emptyDiscardedRecovery` already tests
free space before it releases (`first-setup-entry.ts:233-235`), the start deletes the spare file
(`releaseSpare`, `apps/server/src/spare-space.ts`) when the lower free space of the folders the start
reads (the configured state and venue folders, and a selected recovery's, as the clean-up reads them) is:

- **under `SPARE_SPACE_BYTES` (8 MiB)**, below which a boot is close to its measured need (4.25 MiB booted,
  4 MiB did not); or
- **under `FULL_DISK_BYTES` (16 MiB) when the previous start failed for lack of space**: `recovery.json`'s
  `lastErrorCode` is `storage.disk_full` (read from the selected recovery's state folder when one is
  selected, otherwise the configured one), so a boot that needed more than the measured figure gets the
  room this time. A failed boot whose record could not be written keeps `server.boot_incomplete`; that
  start's next attempt meets the first case only if free space is under 8 MiB.

Before resolution, because resolution decides the start's path before the count is written: a finished
setup's inspection that fails on a full disk serves resolution (`node-entry.ts:289-292`, item 7, and
`first-setup-entry.ts:283,292`; the inspection's failure on a full disk is that comment's claim, not
measured here). So a release after resolution could not turn that start into a boot.

A box that would boot without it keeps it: a start with 12 MiB free boots today and keeps its spare. The
spare is always the one in the configured state folder, as in slice 1. A start at the repair stage of a
backup recovery keeps slice 1's rule (the repair host releases before the Start-again steps). The
emptying's own release stays; after this one it finds no spare and logs nothing. A start that then serves a
page rather than booting has still released the spare; that is accepted (it is a full-disk start), and the
marker below holds the stop at the next boot.

### 2. Sales stay stopped until the spare file is back (slice 2; Q3)

Once the box has started on its spare's room, that room is the person's way out: it lets them sign in and
delete backups. Till writes would otherwise use it up. So:

- **The fact is kept on disk, in its own file.** Straight after a release that deleted bytes, the start
  writes a small marker, `<state>/spare-space.released` (in the room the release just gave), beside the
  spare. It is deleted only by whoever has just written the spare back whole. A restart therefore keeps
  it: free space alone never lifts it. Not `recovery.json`: its reader keeps only the fields it knows
  (`recovery-state.ts:90-112`) and several writers rebuild the record (`failureRecord`, `cleared`, the
  stayed-up clear after every good start, `:51-71,163-180`), which would erase it. The backup recovery's
  originals walk leaves the marker out, as it leaves out `spare-space`.
- **While it is there, the stop holds.** Boot's `noteFullAtStart` notes the stop whatever its reading, and
  `full()` lifts it only when 16 MiB is free and the marker is gone. A box whose spare was never
  deleted lifts at 16 MiB, as today.
- **The running box writes the spare file back** (new: today only a start does). The 60-second free-space
  watch tops it up with slice 1's rule (appending random bytes, only with 24 MiB free, never thrown), and
  deletes the marker once the file is whole; the old-backups deletion asks for a reading at once, so
  the stop can lift without waiting a minute. A start still tops it up and clears the record too.
- **The bucket stream.** It starts after the trigger rewrite (`boot.ts:1681` before `:2258-2274`, read)
  and reads no free space (`stream-host.ts`), so it may copy the change log into `.venue.db-litestream/`
  and take the room the boot left. Slice 2 first runs a real-disk case with the stream configured (CI
  already installs Litestream and versitygw for the stream tests); if the stream uses the room, it waits
  while the marker is there, since nothing is being saved for it to copy.

Worked example: after the clean-up the disk has 1 MiB free; the spare is deleted (9 MiB free) and the
marker written; the box boots (about 5 MiB left); the stop is on, so the tills show the red strip and refuse every save. Someone restarts the box: the marker is
still there, so the stop is on again. A manager signs in and deletes one old backup (2.9 GB back); the
watch writes the spare back, deletes the marker, and the stop lifts; the tills sell again.

### 3. The prompt (slice 3; Q1, Q4)

- **A bar at the top of every dashboard page, under the banner**, while the full-disk stop holds, for
  everyone signed in to the dashboard. It is there at sign-in (it does not wait for the bell). It sits in
  the update bar's slot, above it when both show. With old backups this box can delete (§4), its button
  is **Review old backups**, which opens Box status with the deletion dialog open; for a person without
  `system.manage` the button first offers the manager or administrator sign-in in place. Without any, it
  says what Box status can still do, and its button is **Go to Box status**.
- **The Box status disk row** gains **Delete old backups…** beside **Free**, while the disk row is amber
  or red and this box can delete at least one backup. It opens the same dialog.
- **The till and handheld** keep A798's red strip, "… · Tell a manager", in slices 2–3. That sends the
  person to somebody else, which the owner's 2026-10-25 rule forbids for a refusal unless only a bug can
  cause it; A798's words were approved on 2026-10-19, before that rule. Q4 asks whether slice 4 gives the
  till the same choice behind a manager's sign-in.

### 4. The deletion (slice 3; Q2, Q5)

- **What can be offered:** an archive in a configured backup folder (set on the dashboard or by the
  environment) that is a regular file (`lstat`, never followed through a link), on the same disk as the
  venue folder (the disk-usage walk's own test, `disk-usage.ts:96-108,128`), named as a backup archive
  (`parseBackupArchiveKey`), and **taken after the current installation began**: on a Veri\*Factu box
  the node's live `registro_sif` row (`revocado_en` null; `packages/fiscal-verifactu/src/schema/sif.ts:11-40`,
  `allocation.ts:80`) holds `registrado_en` and an installation name that `decodeMinuteIdentity` turns back
  into its minute (`hour-identity.ts:3-34`; a name not in that format is not decoded), and a restore, a
  re-registration and a Start again each start a new chain under a new name (CLAUDE.md §5). A box running
  the no-regime fiscal module has no such row (`packages/fiscal-none/src/slot.ts:16`); the plan's first
  task finds the stored fact that marks when its database began, and if there is none, such a box offers
  nothing. So an archive from before the box's last
  restore, from an earlier installation, or from the stretch between a restore's source and the restore
  (which can hold sales the live database does not have) is never offered. The plan's first task finds
  where the current installation's start is read and proves this rule with a failing test ("an archive
  taken between the restore's source and the restore is never offered").
- **Never the newest, in each folder.** With two folders on this disk, each keeps its own newest.
- **What the box proposes:** the oldest offered first, as many as it takes to reach 2.5 GiB free
  (`SPACE_OK_BYTES`, where the low-space warning clears), or every offered one when even that is not
  enough. The dialog lists each with its date and size, says what remains, and says plainly when backups
  on this box still cannot run afterwards (they need about twice the database's size free). **Cancel**
  is the safe choice; **Delete N backups** is in the danger colour.
- **Who:** `system.manage` (managers and administrators), the people who see the disk alert, the email
  and Box status, and who may already switch backups off where the dashboard manages them (Q5).
- **How:** the dialog sends the archive names it showed. The server re-reads each folder and deletes,
  oldest first, only names still there, still offered and still not the newest, through the backup
  staging turn's `ifNoBackup` as **Free** does (`apps/server/src/backup-staging-turn.ts`; a backup run
  holds that turn for the whole of `runOnce`, upload and pruning included, `backup-sweep.ts:306-315`).
  A run holding or waiting for the turn answers "A backup is being made" with nothing deleted. It answers
  with what it deleted, the free space read afresh (`statfs`, not a sum of sizes) and whether saving has
  started again (read from the stop after the reading and top-up). Each deletion is logged
  `backup.archive_deleted` with the person's id, the name and the size.

### 5. The fallback: the full-disk page (unchanged)

When a start cannot write its count even after deleting the spare, or the spare is already gone, it serves
the full-disk page with option A's words (#2175), which already name "the backups kept on this box" among
what fills the disk. Those words stay, for the owner's approval in #2175.

The repair page's full-disk words (`shell.first_setup.disk_full`, `apps/setup/src/i18n/strings/shell.ts`)
have two known gaps (backlog `docs/backlog/setup.md`, "The repair page's full-disk words wait for the owner,
with two known gaps"). Slice 2 settles them by matching the full-disk page:

- "Restart the box: as it starts, it removes old logs and crash reports to make room." becomes "Restart
  the box: as it starts, it frees what space it safely can." / «Reinicia el equipo: al arrancar, libera el
  espacio que puede liberar sin riesgo.» (true also where the logs are inside the state folder and it frees
  nothing).
- "…but everything on it is lost." gains ", sales included, unless a backup is restored afterwards." /
  «…pero se pierde todo lo que contiene» gains «, ventas incluidas, salvo que después se restaure una copia
  de seguridad».

## Words (English and Spanish, for the owner's approval)

Sizes are drawn as the dashboard draws sizes today. Singular forms where n = 1.

- **Bar, old backups can be deleted.** EN: "The box's disk is full, so the tills cannot save anything: no
  sales, orders or clock-ins. Deleting the oldest backups kept on this box would free {size}." Button
  "Review old backups". ES: "El disco del equipo está lleno, así que las cajas no pueden guardar nada: ni
  ventas, ni pedidos, ni fichajes. Borrar las copias de seguridad más antiguas que se guardan en este
  equipo liberaría {size}." Botón «Revisar copias antiguas».
- **Bar, none can be deleted.** EN: "The box's disk is full, so the tills cannot save anything: no sales,
  orders or clock-ins. Box status shows what fills the disk and frees what Waitron can make again." Button
  "Go to Box status". ES: "El disco del equipo está lleno, así que las cajas no pueden guardar nada: ni
  ventas, ni pedidos, ni fichajes. En Estado del equipo se ve qué ocupa el disco y se libera lo que
  Waitron puede volver a crear." Botón «Ir a Estado del equipo».
- **Dialog title.** EN "Delete old backups?" / ES «¿Borrar copias de seguridad antiguas?»
- **Dialog body, enough.** EN: "Deleting the {n} oldest backups kept on this box would free {size}, enough
  for the tills to save again. The newest backup, from {date}, is kept. Afterwards the backups on this box
  go back only to {oldest kept}." ES: "Borrar las {n} copias de seguridad más antiguas que se guardan en
  este equipo liberaría {size}, suficiente para que las cajas puedan volver a guardar. Se conserva la más
  reciente, del {date}. Después, las copias de este equipo solo se remontan al {oldest kept}."
- **Dialog body, enough to save, not to clear the warning.** EN: "Deleting every backup this box can delete
  would free {size}: enough for the tills to save again, but the disk stays nearly full." ES: "Borrar todas
  las copias que este equipo puede borrar liberaría {size}: suficiente para que las cajas puedan volver a
  guardar, pero el disco sigue casi lleno."
- **Dialog body, not enough to save.** EN: "Deleting every backup this box can delete would free {size}.
  That is not enough for the tills to save again: the rest of the disk holds the venue's data, the newest
  backup and files that are not Waitron's." ES: "Borrar todas las copias que este equipo puede borrar
  liberaría {size}. No basta para que las cajas puedan volver a guardar: el resto del disco guarda los datos
  del local, la copia más reciente y archivos que no son de Waitron."
- **Dialog line, backups still cannot run.** EN: "Backups on this box need about {need} free to run, so
  they stay paused after this." ES: "Las copias de seguridad de este equipo necesitan unos {need} libres
  para hacerse, así que seguirán en pausa."
- **Buttons.** EN "Cancel" / "Delete {n} backups"; ES «Cancelar» / «Borrar {n} copias».
- **Done.** EN: "{n} backups deleted; {size} freed. The tills can save again." or "… The tills still
  cannot save." ES: "{n} copias borradas; {size} liberados. Las cajas ya pueden guardar." o «… Las cajas
  todavía no pueden guardar.»
- **Busy.** EN: "A backup is being made. Nothing was deleted; try again in a minute." ES: "Se está haciendo
  una copia de seguridad. No se ha borrado nada; vuelve a intentarlo en un minuto."

The full-disk page's tests refuse "delete" and «borra» in its action text (`recovery-surface.test.ts`);
these words are on the dashboard, which that test does not read.

## OPEN QUESTIONS (for the owner)

Worked example for all five. Elena's box has a 32 GB disk: the database is 9 GB and the backup folder on
the box holds seven nightly backups of about 2.9 GB. One night the disk fills. The box restarts, deletes
300 MB of old logs (not enough), cannot write its start count, deletes its spare file and starts. In the
morning the tills show the red strip. Marta, the manager, opens the dashboard.

### Q1. Where the prompt appears (default: A)

- **A (recommended):** on the dashboard: the bar at sign-in for everyone, and **Delete old backups…** on
  Box status. Marta deletes the oldest backup; 2.9 GB comes back and the tills sell. If nobody acts and
  the box later cannot start at all, it shows the full-disk page (your fallback A), which offers nothing to
  press.
- **B:** also on the full-disk page, behind an administrator's password, with Cancel. Cost: a password
  check on a page served when the box cannot write a small file; whether it can still open the venue
  database to check the password there is not measured. Its own slice.

### Q2. How many backups the box proposes (default: A)

- **A (recommended):** oldest first, as many as it takes to reach 2.5 GB free (where the low-space warning
  clears), never the newest, and never one from before the box's last restore or reinstall. In Elena's
  case: one backup. The dialog says backups stay paused (they need about 18 GB free).
- **B:** as A, but enough for backups to run again (about twice the database). In Elena's case: all six
  older backups (17.4 GB), which is still not quite enough.
- **C:** a list with a tick box per backup, A's choice ticked; Marta can tick more or fewer.

### Q3. Do the tills stay stopped until the spare file is back? (default: A)

- **A (recommended):** yes, also across restarts. After a start that used the spare file, the tills save
  nothing until 24 MB is free and the spare file is written back, so its room stays free for the sign-in
  and the deletion. Cost: a box that started on its spare with 20 MB free does not sell until someone frees
  space.
- **B:** they sell again at 16 MB free, as today. Cost: the tills can use the spare's room before anyone has
  signed in, and a later start may then land on the full-disk page.

### Q4. What the tills say (default: B)

- **A:** keep A798's red strip, "Nothing can be saved: the box is out of space · Tell a manager", as a
  stated exception to your 2026-10-25 rule. Cost: a waiter is sent to somebody else.
- **B (recommended):** slice 4: the strip offers the manager sign-in in place on the till, which opens the
  same deletion dialog. Until slice 4 lands, the tills keep A's words. Cost: a fourth slice, and the
  deletion becomes possible from a till as well as the dashboard.

### Q5. Who may delete backups (default: A)

- **A (recommended):** managers and administrators (`system.manage`), who already see the disk alert, the
  email and Box status, and may switch backups off where the dashboard manages them.
- **B:** administrators only; a manager pressing the button gets the administrator sign-in in place.

Reply "A1127 slices 2–4: Q1 A, Q2 A, Q3 A, Q4 B, Q5 A", or name the letters you want.

## Decisions this design makes

- **Environment-managed folders are offered too.** The space problem is the same; the deletion route is
  then the one dashboard write into a folder the environment manages. "Newest" is per folder.
- **Deliberate limits** (as `pruneBackend` has today, `backup-sweep.ts:236-262`): a folder two boxes share
  holds names with no box id, so "the newest" may be the other box's; a name stamped while the clock read
  ahead stays "newest" after the clock is fixed. A restore reading an archive (`archive-download.ts:59-69`)
  does not take the staging turn, so a deletion can race it; the plan leaves out an archive a restore is
  reading.

## What this does not change

- **Fiscal records and chains.** An archive the box offers is a copy of the current installation's
  database taken before a newer copy of the same installation, so the venue database, which keeps every
  record, holds everything in it. That is the reason for §4's installation rule; without it, the claim is
  false (an archive from before a restore can hold sales the live database does not have). The newest
  backup is always kept. The start's new release deletes one file, `<state>/spare-space`, and opens no
  database.
- **What Free deletes.** Unchanged: never a backup.
- **The backup schedule and retention settings.** Unchanged; pruning still happens only after a successful
  backup, which on a disk with too little room may not come (the dialog says so).
- **The lock rules.** No lock file is unlinked; the spare file is outside the venue folder and backup
  staging, as in slice 1.

## Slices

All FULL review (risk triggers: concurrency with the backup run, deleting data, permissions, fiscal
history in old archives).

- **Slice 2: the start, the stop, the write-back.** The two release cases; the marker; the stop
  noted and held by it; the free-space watch writing the spare back; the stream case; the repair page's
  two wording gaps. Failing tests first, on the real small disk: a full disk with nothing to delete but the
  spare boots a real `startServer` (control: with `spareBytes: 0` the same disk serves the full-disk page);
  a start with 12 MiB free keeps its spare and one with 6 MiB deletes it; after a release a till sale is refused `storage.disk_full`, and
  still is after a restart with 20 MiB free (control: a start that released nothing lifts at 16 MiB); the
  watch writes the spare back once 24 MiB is free and the stop lifts. `scripts/spare-space.test.ts` names
  the new files allowed to release or write the spare.
- **Slice 3: the prompt and the deletion.** The box health read gains what can be deleted and the proposal;
  a `system.manage` route deletes named archives through the staging turn; the dashboard bar (with the
  in-place sign-in), the Box status action and the dialog (a `*.a11y.test.ts` for the dialog's states, and
  the look check in both themes and at phone width); the Box status and backup guides in English and
  Spanish. Failing tests first: an archive from before the current installation is never offered; the
  newest in each folder is never deleted; a name that changed since the dialog read is not deleted; a link
  named like an archive is not offered; a run in progress deletes nothing; a folder on another disk offers
  nothing; a person without `system.manage` is refused.
- **Slice 4 (if Q4 is B): the till.** The red strip's in-place manager sign-in and the same dialog.

## Open, not measured

- **Linux.** The box runs Linux; every byte figure above is from HFS+ on macOS. The slice-2 real-disk cases
  also run on CI's 32 MiB Linux tmpfs, as slice 1's do, which is not ext4.
- **The start before the boot.** The probes called `startServer` directly; the count, resolution, the
  admission lock, a staged restore and `assertNotAhead` in `runEntry` were not measured on the small disk.
- **An upgrade.** A boot that applies new migrations (`boot.ts:989`) can write far more than 4 MiB; the
  fallback page covers it.
- **A large real venue.** What a boot writes follows the schema (it drops and re-creates its live-update
  triggers, about 3,634 pages in all, measured with copy-back held off), not the rows; a large database was
  not booted. With copy-back held off by an open read, a boot used up to 15.0 MB and still started on the
  roomy image; a boot in that state with only the spare's 8 MiB was not tried.
- **The bucket stream** (§2) and **other background writers** while the stop holds (the AEAT outbox, log
  lines): how fast they use the room the spare gave was not measured.
