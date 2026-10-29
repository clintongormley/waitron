# A1131b and A1131c: Recover from backup first deletes the failed setup, then restores into the box's usual folders

**Revised 2026-10-29 on the owner's answers of 2026-10-28 (15:25, 15:35, 15:40).** The first design
(34bb22c6f) kept the failed setup beside the recovery and moved the recovered venue into place
afterwards; the owner sent it back. This version deletes the failed setup first and then uses the
restore a new box already has, which writes straight into the usual folders. The move step, the
"one disk" rule, the copies of small files and five of the eight questions are gone. Git holds the
old version.

This design is docs only. Nothing is built until the owner answers the questions at the end.

## What the owner asked for

From `~/waitron-campaign/questions.md`:

> **13:45** … after a failed setup we shouldn't start the service so there is nothing to lose (that
> can't be typed again). And if we then start a restore, we wipe what was there from the setup.
>
> **08:10** … when we recover from a backup we use the database from the backup folder? But that could
> damage the backup. We should copy it to the standard database path before writing anything.
>
> **15:25** Why would Marta do a setup … then after it fails, she [restores] from backup? Why wouldn't
> she just restore from backup in the beginning? And when she restores from backup, why does she need
> to keep the failed setup in place? Surely she'd just wipe the failed setup before starting the backup?
>
> **15:35** If you have access to the box you can reinstall it. But you can only restore a backup with
> the appropriate secrets.
>
> **15:40** (keep recording the failed setup's series names before the wipe, as one small step.)

## Words used here

- **Repair page**: what the box shows when its first setup stopped part way ("First setup was
  interrupted"). It offers Continue (with the setup password), Start again and Recover from backup.
- **The wipe**: deleting what a failed setup left on the box. Start again does it today.
- **The never-reuse note**: the box's file `first-setup-start-again.json` in its state folder. It says
  "use no invoice series name from before this minute". A name may never be used twice (CLAUDE.md §5).
- **Usual folders**: the box's own venue folder and state folder. On a box both live on the `state`
  volume (`deploy/Dockerfile:269` sets only `WAITRON_STATE_DIR`; the venue folder defaults to
  `<state>/venue`, `apps/server/src/config.ts:517`).
- **Recovery folder**: `<state>/first-setup-resolutions/backup-recovery/<id>/`, which today's repair
  page recovery creates. It holds a step-by-step record of the recovery (its "journal") and, today, the
  recovered venue itself (`target/venue`, `target/state`).
- **Fresh-box restore**: the "Join or recover an existing restaurant" → "Restore from backup" (or "from
  my bucket", or "from Waitron Cloud") path a brand-new box offers. It saves the request, restarts, and
  the start writes the backup into the usual folders (`runStagedRestore`,
  `apps/server/src/restore-request.ts:341`, called at `apps/server/src/node-entry.ts:628`).

## How this was checked

Probes ran on 2026-10-29 on main 9f5cf9648 in a throwaway copy of the repository, since removed. Each
file, its full output and the failing case written before it ran are in
`~/waitron-campaign/a1131bc-redesign-measure/` (`README.txt`). "Read" below means I followed the code
and did not run it.

Probe file `where-restore-writes.test.ts.txt`, run with `env -u AI_AGENT -u CLAUDECODE
TESTCONTAINERS_RYUK_DISABLED=true pnpm exec vitest run src/zz-a1131bc-redesign-probe.test.ts
--reporter=verbose` in `apps/server`: "Tests 5 passed (5)".

- **P1, today's repair-page Recover.** After a real Recover to the end (`selectedRepair` fixture), the
  usual venue folder held the setup's claim file, a pointer and a lock file, and **no `venue.db`**. The
  recovered `venue.db` (3,526,656 bytes) and `trading.env` were inside
  `first-setup-resolutions/backup-recovery/<id>/target/`, and the start's resolver answered "selected",
  pointing there. The box sells from inside the recovery folder.
- **P2, today's fresh-box restore.** `POST /setup-api/restore` answered 202 and saved the request; the
  start's `runStagedRestore` then wrote `venue.db` (same size) into the **usual venue folder** and
  `trading.env` into the usual state folder. No `first-setup-resolutions` folder appeared anywhere, the
  start's resolver answered "absent", and the live series were `A-0CNQT`, `FF-0CNQT`, `R-0CNQT`, a new
  installation name.
- **P3, the control.** The same saved request beside an unfinished setup (a real claim) was refused
  `setup.attempt_conflict` and placed nothing. After deleting only the setup's two record files
  (`first-setup.json`, `first-setup-claim.json`), the same request ran and wrote `venue.db` into the
  usual venue folder. So an unfinished setup is what keeps today's repair page from using this path.
- **P4, Start again's own deletion code as the wipe, before the backup is opened.** Note raised, then
  Start again's marker, deletion and clean-up functions. Afterwards the venue folder was empty and the
  state folder held only the note. The fresh-box restore then wrote into the usual folders, series
  `A-0CNQT`; the note was still there, unchanged.
- **P5, the order control.** The same wipe after the backup's hour had been chosen also deleted the
  module's preparation record, which by then held the restore's own choice; the restore was refused
  `sif.allocation_invalid` (`reservation_missing`). The wipe has to come before the backup is opened,
  as the owner ordered it.
- **Existing tests, run:** `hour-recovery-host.test.ts -t "the start-again note"` (2 passed): the restore
  preparation both paths share refuses a name earlier than the note. `first-setup-resolution.boot.test.ts
  -t "direct entry still boots a normal unclaimed workspace"` (1 passed): a start with no setup claim
  boots normally rather than showing the repair page.
- **Not shown by a probe:** wiping a setup database that holds rows. Today's code offers that wipe only
  beside a stopped recovery (`assertHeldStartAgainOffered`, `apps/server/src/first-setup-resolution.ts:95`),
  so it needs slice 2 first; slice 2's test is P4 with such a database.

## What happens today

- **Two restore paths exist.** A new box uses the fresh-box restore (P2). The repair page's Recover
  from backup uses its own recovery (`apps/server/src/first-setup-backup-recovery.ts`), which builds the
  venue inside a recovery folder (P1), takes a fingerprint of the box's files when the backup is first
  prepared (`packages/provisioning/src/first-setup-backup-workspace.ts:298`), compares it at every step
  and every start, and at the end makes every start run the box from inside that folder
  (`node-entry.ts:408`, `apps/server/src/first-setup-launch.ts:102`). The fresh-box path refuses beside an
  unfinished setup (P3), so the repair page cannot use it today.
- **Start again** (`startAgainFirstSetup`, `first-setup-resolution.ts:497`) checks, writes the setup's
  series names into the note (`:675`), writes a deletion marker, deletes a fixed list of the setup's
  files and clears the marker. A start that finds the marker finishes the deletion, or deletes nothing
  if a listed file changed (`finishStartAgainDeletion`, `packages/provisioning/src/first-setup-start-again-deletion.ts:615`).
  It asks for the setup password in several cases (`first-setup-resolution.ts:468,562,577,610`), and offers
  the case "the setup database holds rows" only beside a stopped recovery (`:95-109`).
- **The refusals A1131 part 1 built** (#2190): no Start again when the setup database holds an invoice or
  another record Waitron never deletes, when the setup saved `trading.env`, or when it finished.
- **A setup database the box cannot read** blocks both buttons today (read, not run): Start again
  is not offered, because only a database it can read as holding rows qualifies
  (`first-setup-resolution.ts:100-103`), and
  the repair-page recovery refuses `module.operation_invalid` when it cannot open it
  (`apps/server/src/first-setup-backup-history.ts:38-51`). Question 1 asks what the wipe does instead.

## The design

### 1. One wipe behind both buttons

Start again and Recover from backup do the same thing on the box: the wipe. They differ only in where
the person goes next.

1. The person presses either button. The page asks the box what a wipe would delete; the box answers
   with the confirmation (pictures 1 and 2) or a refusal (picture 3). Nothing is written yet.
2. On confirming, the box runs Start again's existing action. Slice 2 changes it in three ways only:
   no password (§3); the case "the setup database holds rows" is offered with no stopped recovery
   beside it; and question 1's rule for a database it cannot read. The rest is as today:
   - **its checks**, each a refusal that changes nothing: the setup finished; it saved `trading.env`; its
     database holds an invoice or another record Waitron never deletes (a fault in Waitron); a backup
     restore is already waiting to run; and the rest of Start again's existing checks;
   - **before the wipe, the box adds the setup's series names to its never-reuse note**, as Start again
     does today;
   - **the wipe**: its deletion marker, the deletion, and the marker cleared.
3. The box restarts. With no setup left it shows the ordinary setup page (the boot test above).
   - after **Start again**: the page's first screen, as today;
   - after **Recover from backup**: the "Join or recover an existing restaurant" screen, where the person
     picks Restore from backup, from their bucket, or from Waitron Cloud.

Someone who presses Recover from backup only to look at a backup has still deleted the setup. The
owner accepted that (15:25).

### 2. After the wipe: the box's ordinary restore

The restore is the fresh-box restore, unchanged: choose the backup and give its key, the node recovery
key and the two ticks, wait for the clocks, press Restore; the box saves the request and restarts, and
the start writes the backup into the usual folders (P2, P4). No recovery folder is made, so nothing
later moves the venue and nothing reads a journal to find it.

A restore that stops part way is "finished or discarded like any other", in the fresh-box path's
existing ways (read, not run by me; its crash tests are in `apps/server/src/restore-emergency-crash.e2e.test.ts`):

- stopped before Restore was pressed: nothing was saved but the preparation record; the person starts
  the restore again;
- stopped after the request was saved: the next start runs it;
- stopped while the start was writing it: the request is marked "placement started" before writing
  (`restore-request.ts:598-608`), and every later start runs it again as a resumed placement
  (`restore-request.ts:463`).

### 3. Who may

- **Deleting a failed setup needs no proof beyond reaching the repair page** (owner, 15:35). This removes
  every setup-password step from Start again too, since both buttons run the same wipe: a password that
  Recover from backup does not ask for would protect nothing. Continue keeps its password: it carries
  the setup on rather than deleting it.
- **Restoring needs the backup's own secrets** (its key and the node recovery key), as the fresh-box
  restore asks today.

### 4. The fiscal facts

- A restore starts a new chain under a new installation name (CLAUDE.md §5). The fresh-box path does
  this today (P2: the live series became `A-0CNQT`, `FF-0CNQT`, `R-0CNQT`).
- The note is written only by Start again (`first-setup-resolution.ts:675`) and by A1098's Move
  (`packages/provisioning/src/first-setup-start-again-set-aside.ts:238`); `deploy/waitron.sh` keeps it
  except under `reset --all`. This design adds no writer: Recover from backup calls the same Start again
  action. `scripts/start-again-note-writers.test.ts` needs no change until slice 4 removes
  `first-setup-backup-workspace.ts` from its allowed list.
- The restore's new name is chosen no earlier than the note (`recovery-preparation.ts:211`, and the two
  tests run above), so it comes after every name the failed setup used.
- **No slice touches the fiscal core**: `computeHuella`, the chain, invoice numbering,
  `registros_facturacion` and the alta builders are not changed, and no file in
  `packages/fiscal-verifactu` is edited. Its golden hash test and `inmutabilidad.test.ts` must pass
  unedited in every slice.
- **No slice adds a database migration.**

### 5. Power cut at each step

| Cut after… | The next start finds | It does |
| --- | --- | --- |
| the confirmation was shown, before confirming | the setup untouched | the repair page |
| the checks, before the note | the setup untouched | the repair page |
| the note, before the deletion marker | the setup untouched, the note later | the repair page; pressing again raises the note to the same minute and goes on |
| the marker, part of the deletion done | the marker | finishes the deletion, or, if a listed file changed, deletes nothing and shows the existing "files found" page (Keep or Move) |
| the wipe, before the person reaches the restore | no setup | the ordinary setup page; the person picks "Join or recover" again |
| choosing the backup, before Restore is pressed | no setup, a preparation record | the ordinary setup page; the restore is begun again |
| Restore pressed, request saved | the saved request | runs it |
| part of the restore written | the request marked "placement started" | replays it, as today |
| the restore written | an ordinary box | starts and sells |

Nothing can be filed twice: there is never more than one venue database, and before the restore is
written nothing sells.

### 6. Every reader of the recovery folder, and what changes

The redesign never makes a recovery folder, and a start that finds none in either usual folder stops
looking at once (`resolveFirstSetupBackupEntry`, `apps/server/src/first-setup-backup-entry.ts:77-93`;
P2 and P4: "absent"). So on a box set up after slices 2 and 3, every reader below finds nothing. Slice 4
deletes them, and a box that still has the folder then shows the existing "reinstall Waitron" page
(`setup.workspace_unsupported`, as older setup workspaces do today, `packages/provisioning/src/first-setup-workspace.ts:40`),
or keeps working until go-live under answer B to question 2.

| Reader | What it does with the folder today | After |
| --- | --- | --- |
| the start (`node-entry.ts:343-372`, `first-setup-entry.ts:74,117`) | decides repair page, or "selected" | finds none; ordinary start |
| the folder switch (`node-entry.ts:408-421`, `first-setup-launch.ts:102`) | runs the box from `target/venue` and `target/state` | gone; the box always runs from the usual folders |
| the selling path (`boot.ts:896`, `assertFirstSetupBackupBootTarget`) | refuses the usual folders while a recovery exists | gone |
| the note's reader (`packages/provisioning/src/box-folders.ts:12-29`) | maps the copy back to the box's own state folder | reads the usual state folder directly |
| Start again (`first-setup-resolution.ts:335-410`, `:681-690`; the deletion list's layout check, `first-setup-start-again-deletion.ts:307`) | finds a stopped recovery, discards it, refuses an unexpected one | no recovery to find; that code goes |
| discarding (`packages/provisioning/src/first-setup-backup-discard.ts`) and the start's emptying of a discarded copy (`first-setup-entry.ts:248-270`) | empty a discarded recovery's copy | gone |
| the spare file (`apps/server/src/spare-space.ts:253-256`) and A1127's full-disk page (`apps/server/src/discarded-copy.ts:14-19`, `node-entry.ts:427`) | count a discarded copy as space to free | gone; the full-disk page no longer counts it |
| the start's clean-up (`node-entry.ts:344`) | cleans the copy's folders at "selected" | cleans the usual folders, as on any box |
| the fingerprint (`first-setup-backup-workspace.ts:298-411`) | compared at every step and start | gone |
| the setup page's recovery screens and "Finish saved recovery" (`apps/setup/src/screens/first-setup-backup-screen.ts`) | open, resume and finish a repair-page recovery | gone; the fresh-box restore screens are used |
| `waitron.sh`'s production check (`deploy/waitron.sh:498-548`), the break-glass and credentials commands, `apps/server/scripts/record-one-sale.ts:100` | look in the usual folders, so miss a venue in a recovery folder | find the venue, because it is always there |

### 7. What the redesign cannot remove

- **The repair page itself**, for any setup that stops part way.
- **Start again's deletion marker** (`first-setup-deleting.json`) and its finishing at start: that is
  what makes the wipe safe across a power cut.
- **The note and the files A1042 and A1098 keep**: the never-reuse note, the confirmation records, the
  Keep-or-Move records and the set-aside folder.
- **The fresh-box restore's own files** while a restore is under way: the saved request
  (`restore-request.*`) and `restore-staging/` in the state folder (P2), cleared when it succeeds.
- **Boxes that already have a recovery folder**: no code converts them (question 2).

### 8. Pages and words

Repair page strings: `apps/setup/src/screens/initial-owner-strings.ts`. Pictures in
`docs/backlog/mockups/a1131bc-restore/`. Each message is short (owner, A1167 words, 2026-10-28).

**a. Start again's confirmation** (picture 1). No password and no counts. `heldLost` replaces `heldRows`,
`heldRowsOne`, `heldNoInvoices`, `heldNoInvoicesOne` and the old `heldLost`: EN "Start again deletes what
was entered in the setup that stopped part way. Nothing was sent to AEAT." ES «Empezar de nuevo borra lo
que se introdujo en la configuración que se detuvo a medias. No se envió nada a la AEAT.» Shown only once
the box has read the database and found no invoice. With the database missing, the existing
missing-database words and tick ("Nothing was filed to AEAT and nothing was sold.") stay instead.

**b. Recover from backup's confirmation** (picture 2). `recoverDeletes`: EN "Recover from backup first
deletes what was entered in the setup that stopped part way. Nothing was sent to AEAT. Then you choose
the backup." ES «Recuperar desde una copia primero borra lo que se introdujo en la configuración que se
detuvo a medias. No se envió nada a la AEAT. Después eliges la copia.» Tick `retireRecover`: EN "Delete
the old attempt and recover from a backup." ES «Borrar el intento anterior y recuperar desde una copia.»
"Nothing was sent to AEAT." follows the same rule as (a). The help line under both: EN "This box will not
use this setup's invoice series names again." ES «Este equipo no volverá a usar los nombres de serie de
facturas de esta configuración.»

**c. Refusals, shared by both buttons** (picture 3); neither button is offered.

- `keptFault` (replaces `heldKept`, `heldKeptOne`, `heldInvoices`, `heldInvoiceOne`, `heldFault`): EN "The
  setup database holds records that Waitron never deletes. An unfinished setup should hold none, so this
  is a fault in Waitron. Deleting this setup is not offered. Reconnect keeps everything as it is." ES «La
  base de datos de configuración guarda registros que Waitron nunca borra. Una configuración sin terminar
  no debería tener ninguno, así que es un fallo de Waitron. No se ofrece borrar esta configuración.
  Reconectar lo deja todo como está.» The counts go to the log line.
- `tradingSaved`: EN "This setup already saved the settings the box sells with, so deleting it is not
  offered. To finish it, continue with your setup password." ES «Esta configuración ya guardó los ajustes
  con los que vende el equipo, así que no se ofrece borrarla. Para terminarla, continúa con tu contraseña
  de configuración.»
- `setupFinished`: EN "This setup already finished, so deleting it is not offered. Reconnect to check the
  saved result." ES «Esta configuración ya terminó, así que no se ofrece borrarla. Reconecta para
  comprobar el resultado guardado.»
- `heldChanged`: EN "The setup changed after this page read it. Try again." ES «La configuración cambió
  después de que esta página la leyera. Inténtalo otra vez.»

**d. A setup database the box cannot read** (picture 4; only with answer A to question 1). EN "This box
cannot read the setup database, so it cannot list the invoice series names that setup used." ES «Este
equipo no puede leer la base de datos de configuración, así que no puede saber qué nombres de serie de
facturas usó esa configuración.» Then the existing `namesFrom` line ("New series names can start from
{date}, {time}.").

**e. Strings that change or go.** `startUnavailable`, `startUnavailableOccupied` and
`damagedRecordPassword` go in slice 2, which makes each false. `uncheckable` ("… Keep its files for
recovery.") becomes EN "This box cannot check the original setup password, so Continue is not offered."
ES «Este equipo no puede comprobar la contraseña original de configuración, así que no se ofrece
Continuar.» The repair-page recovery strings (`recoveryRunning` … `recoveryDetailsUnread`, and
`apps/setup/src/i18n/backup-repair.ts`) go in slice 4. `tradingSavedPassword` belongs to Continue and
stays.

### 9. What is NOT changed

- The fresh-box restore: its screens, checks, power-cut handling and where it writes.
- Start again's checks other than the password, its note, its deletion list and its finishing at start.
- Continue and its password.
- The fiscal module (§4) and the database's structure.
- The never-reuse note's lifetime: only `waitron.sh reset --all` removes it.

## Slices

Each is one pull request, smallest first; no slice adds a migration, none edits the fiscal core.

1. **Start again's words without counts** (§8a, `heldLost`; the summary and confirmation stop carrying
   counts; the user guide's count lines). Light review. Picture 1's words.
2. **One wipe, no password** (server). Start again's password steps go (§3); the "database holds rows"
   case is offered with or without a stopped recovery; the refusal words of §8c; Question 1's rule.
   Tests: P4 with a setup database holding rows and series names, ending in the fresh-box restore writing
   into the usual folders, and the note's minute later than every name that database held (control:
   with the note step removed, a name from the setup database is accepted); each refusal deletes nothing;
   a cut after the marker is finished at start. **Fiscal-adjacent** (it decides what enters the
   never-reuse note): full review.
3. **Recover from backup becomes the wipe** (setup page). The confirmation of §8b; after the restart the
   setup page opens on "Join or recover"; the repair page stops opening the old recovery for new
   recoveries. Pictures 2 and 3. User guide `apps/server/src/guide/{en,es}/backup-recovery.md`.
   **Fiscal-adjacent** (it changes which restore the repair page leads to): full review.
4. **The old recovery folder code goes** (server, provisioning, setup page), under question 2's answer:
   every reader in §6, Finish saved recovery and its routes, the folder switch, `boxFolders`, the
   discarded-copy code in the spare-file and full-disk paths; a box that still has the folder shows the
   reinstall page. CLAUDE.md's spare-file entry ("its emptying of a discarded recovery") and
   `scripts/spare-space.test.ts`; `first-setup-backup-workspace.ts` leaves
   `scripts/start-again-note-writers.test.ts`'s allowed list; `docs/operations/hour-recovery.md`,
   `backups-and-support.md`, `first-live-fiscal-setup.md`, `docs/developers/conventions-data.md`. Closes
   A1131 place 2: a box never sells from inside a recovery folder again. The fiscal module keeps any seat
   only the old path called; deleting one is a later, separate decision. Mostly deletion; split it in two
   (server and provisioning, then setup page and docs) if it passes about 100 tool calls.
   **Fiscal-adjacent** (it removes a restore path that writes the new installation name): full review.

## Open, not measured

- **A setup database holding rows, wiped this way**: needs slice 2's code; slice 2's first test.
- **The fresh-box restore after a power cut** on a real box: covered by its existing crash tests, which
  I did not run.
- **Carrying "go to Join or recover" across the restart**: the page holds the choice; how it survives the
  reconnect is slice 3's to settle and test.
- **Whether any box sells from a recovery folder today**: only the owner knows (question 2).

## Questions for the owner

**Q1 of 2 — A failed setup whose database the box cannot read.** Before deleting a failed setup,
the box notes the invoice series names it used, so none is used again. If the setup's database is
damaged, the box cannot read those names. Example: Marta's setup stops when the power goes and its
database is damaged. Today she can neither start again nor recover from backup; only a reinstall helps.
- **A (recommended):** delete it anyway, and block every name from before the setup's newest file plus
  2½ minutes. The box already uses this rule for files it cannot read. Marta goes on to her backup.
- **B:** keep the damaged database in a folder on the box instead of deleting it, with the same block.
  Only a full reset removes the folder.
- **C:** refuse, as today, and say on the page that only reinstalling Waitron clears it.

**Q2 of 2 — Boxes that already used the old Recover from backup.** Until now, Recover from backup put
the recovered venue in a separate folder, and the box sells from there. The new way never makes that
folder, and the old code can then go. Example: a test box was recovered from backup in September and
has sold from that folder since.
- **A (recommended):** after the update, such a box shows the existing "reinstall Waitron" page.
  Reinstall it and restore the backup again (before go-live any box may be reset).
- **B:** keep the old code until go-live so those boxes keep selling, and delete it then. Until then
  they keep today's risk: if the folder's own records are damaged, the box shows the repair page instead
  of selling.
