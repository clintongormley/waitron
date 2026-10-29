# A1131b and A1131c: Recover from backup first deletes the failed setup, then restores into the box's usual folders

**Revised 2026-10-29 on the owner's answers of 2026-10-28 (15:25, 15:35, 15:40), then on its first
review the same day** (`~/waitron-campaign/item-a1131bc-redesign-review-1.md`: 0 critical, 5 important,
9 minor, all folded), then on a claim check of that fold (`item-a1131bc-redesign-review-3.md`: 0
critical, 4 important, 8 minor, all folded). How each finding was folded is in the commit messages. The first design (34bb22c6f) kept
the failed setup beside the recovery and moved the recovered venue into place afterwards; the owner
sent it back. This version deletes the failed setup first and then uses the restore a new box already
has, which writes straight into the usual folders. The move step, the "one disk" rule and the copies
of small files are gone. Git holds the old version.

This design is docs only. Nothing is built until the owner answers the questions at the end.

## What the owner asked for

From `~/waitron-campaign/questions.md`. The owner's own words:

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

The watcher's summaries of the owner's answers, not the owner's words: at 15:25, that someone who only
opens a backup to look has still chosen to discard the setup, and that this is accepted; at 15:40, keep
recording the failed setup's series names in the never-reuse note before the wipe, as one small step,
and keep the note's mechanics out of the owner's questions.

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
- **"Files found" page**: what a start shows when an interrupted Start again finds a listed file
  changed. It offers Keep or "Move these files aside" (A1098), behind the setup password
  (`apps/server/src/recovery-start-again.ts:264-272`; checked at
  `packages/provisioning/src/first-setup-start-again-choose.ts:106`).

## How this was checked

Probes ran on 2026-10-29 on main 9f5cf9648 in throwaway copies of the repository, since removed. Each
file, its full output and the failing case written before it ran are in
`~/waitron-campaign/a1131bc-redesign-measure/` (`README.txt`). "Read" below means I followed the code
and did not run it. "Run by the review" means review 1 ran it; its probes are in
`~/waitron-campaign/a1131bc-redesign-review-1-probes/`.

My probe file `where-restore-writes.test.ts.txt` asserts each failing case (23 `expect` calls), run with
`env -u AI_AGENT -u CLAUDECODE TESTCONTAINERS_RYUK_DISABLED=true pnpm exec vitest run
src/zz-a1131bc-redesign-probe.test.ts --reporter=verbose` in `apps/server`: **"Tests 5 passed | 1
expected fail (6)"**. The expected fail is T6, the control the other way: T2's claim inverted, which must
fail; run as an ordinary test it fails at the "no `venue.db` in the usual folder" assertion ("expected
true to be false", "Tests 1 failed | 5 skipped (6)"). The first version of this probe asserted nothing
(review 1, M1); it is kept beside the new one.

- **T1, today's repair-page Recover.** After a real Recover to the end (`selectedRepair` fixture), the
  usual venue folder held the setup's claim file, a pointer and a lock file, and **no `venue.db`**. The
  recovered `venue.db` (3,526,656 bytes) and `trading.env` were inside
  `first-setup-resolutions/backup-recovery/<id>/target/`, and `resolveFirstSetupBackupWorkspace`
  answered "selected", pointing there. The box sells from inside the recovery folder.
- **T2, today's fresh-box restore.** `POST /setup-api/restore` answered 202 and saved the request;
  `runStagedRestore`, called directly rather than through a start, then wrote `venue.db` into the
  **usual venue folder** and `trading.env` into the usual state folder. No `first-setup-resolutions`
  folder appeared, `resolveFirstSetupBackupWorkspace` answered "absent", and the live series were
  `A-0CNQT`, `FF-0CNQT`, `R-0CNQT`, a new installation name.
- **T3, control.** The same saved request beside an unfinished setup (a real claim, with no `venue.db`)
  was refused `setup.attempt_conflict` and placed nothing. After deleting only the setup's two record
  files, the same request ran and wrote into the usual folders. Review 1's R1c, beside a setup that had
  chosen a series name, was refused `setup.attempt_uncertain` instead: the refusal code depends on the
  setup's state.
- **T4, Start again's own deletion code as the wipe, before the backup is opened.** A hand-written note
  (a fixed floor, not produced by Start again), then Start again's marker, deletion and clean-up
  functions on that two-file setup. Asserted: the setup's two record files were gone, the fresh-box
  restore then wrote into the usual folders, and the note's bytes were unchanged. Printed, not
  asserted: the venue folder was otherwise empty and the state folder held only the note.
- **T5, the order control.** The same wipe after the backup's hour had been chosen also deleted the
  module's preparation record, which then held the restore's own choice; the restore was refused
  `sif.allocation_invalid` (`reservation_missing`). The wipe has to come before the backup is opened.
- **Run by the review:** R1, a real fiscal setup that had chosen the name `0CNNY`, wiped by the real
  `startAgainFirstSetup` action (its existing no-password path for an unused setup): the note held that
  name's minute plus one, and a saved fresh-box restore was then accepted ("Tests 2 passed (2)" with
  R1c). R4/R4c: after the wipe, the files A1042 and A1098 keep came through a real fresh-box restore
  unchanged, and a note later than the restore's minute made it refuse `minute_not_later`. R2: Start
  again beside a `venue.db` of junk bytes was refused `setup.not_ready`. R3: the A1099 file-time rule
  (`attemptLastWriteMs`) ignored `venue.db`'s own file time; the control, `first-setup.json`'s, moved it.
  R5: today no confirmation record is written without the setup password.
- **Existing tests I ran:** `hour-recovery-host.test.ts -t "the start-again note"` (2 passed): the restore
  preparation both paths share refuses a name earlier than the note. `first-setup-resolution.boot.test.ts
  -t "direct entry still boots a normal unclaimed workspace"` (1 passed): a start with no setup claim
  boots normally. `scripts/waitron-sh.test.mjs -t "removes the transient volumes"` (1 passed): a plain
  `waitron.sh reset` removes the box's `backups` volume.
- **A database's side file holds its newest write** (`wal-mtime.mjs`, a scratch `node:sqlite` script
  outside the repository, in WAL mode with automatic checkpoints off; the failing case written first
  was `dbMtimeMovedOnCommit: true`). Output: `{"dbMtimeMovedOnCommit":false,"walNewerThanDb":true,"gapMs":1503}`:
  a committed write moved only `venue.db-wal`'s file time. Review 3 ran the same check, same result.
- **Stand-ins and gaps.** Only the backup-file restore was probed, not the bucket or Waitron Cloud
  paths. Nobody has yet wiped a setup database that holds rows: today's code offers that wipe only
  beside a stopped recovery (`assertHeldStartAgainOffered`, `apps/server/src/first-setup-resolution.ts:95`),
  so it is slice 2's first test.

## What happens today

- **Two restore paths exist.** A new box uses the fresh-box restore (T2). The repair page's Recover
  from backup uses its own recovery (`apps/server/src/first-setup-backup-recovery.ts`), which builds the
  venue inside a recovery folder (T1), takes a fingerprint of the box's files when the backup is first
  prepared (`originals`, `packages/provisioning/src/first-setup-backup-workspace.ts:300`), compares it at
  every step and every start, and at the end makes every start run the box from inside that folder
  (`node-entry.ts:408`, `apps/server/src/first-setup-launch.ts:102`). The fresh-box path refuses beside an
  unfinished setup (T3), so the repair page cannot use it today.
- **Recover from backup is offered today whenever no recovery has stopped, is running, or has
  unreadable activity** (`apps/setup/src/setup-app.ts:2851,2867`, inside the condition at `:2801`),
  including beside an occupied setup database and saved trading settings (run by the review:
  `first-setup-backup-recovery.test.ts` "valid backup proof discloses only that backup…").
- **Start again** (`startAgainFirstSetup`, `first-setup-resolution.ts:497`) checks, writes a
  confirmation record in some cases (`:664-673`), writes the setup's series names into the note
  (`:675`), writes a deletion marker, deletes a fixed list of the setup's files and clears the marker. A
  start that finds the marker finishes the deletion, or, if a listed file changed, deletes nothing and
  shows the "files found" page (`finishStartAgainDeletion`,
  `packages/provisioning/src/first-setup-start-again-deletion.ts:615`). It asks for the setup password
  in several cases (`first-setup-resolution.ts:468,562,577,610`), and offers the case "the setup database
  holds rows" only beside a stopped recovery (`:95-109`).
- **The refusals A1131 part 1 built** (#2190): no Start again when the setup database holds an invoice or
  another record Waitron never deletes, when the setup saved `trading.env`, or when it finished.
- **A setup database the box cannot read** blocks Start again (run by the review, R2: `setup.not_ready`)
  and, by reading, the repair-page recovery too (`module.operation_invalid`,
  `apps/server/src/first-setup-backup-history.ts:38-51`). Question 2 asks what the wipe does instead.
- **Both Start again routes refuse plain HTTP** (`assertHttps`, `apps/server/src/setup-first-fiscal-api.ts:1022`,
  used at `:1031` and `:1060`). Only the summary route's refusal is tested ("the summary route refuses
  over plain HTTP"); the Start again route's is read, untested: review 3 commented it out and 213 tests
  across the six Start again suites still passed. The box's own
  certificate is all that takes; anyone on the venue's network can open the page over it.

## The design

### 1. One wipe behind both buttons

Start again and Recover from backup do the same thing on the box: the wipe. They differ only in where
the person goes next.

1. The person presses either button. The page asks the box what a wipe would delete; the box answers
   with the confirmation (pictures 1 and 2) or a refusal (picture 3). Nothing is written yet.
2. On confirming, the box runs Start again's existing action. Slice 2 changes it in four ways only: no
   password for the wipe (§3); the case "the setup database holds rows" is offered with no stopped
   recovery beside it; confirmation records say what was actually proved (§4); and question 2's rule
   for a database it cannot read. The rest is as today: its checks (§1a), then, **before the wipe, the
   box adds the setup's series names to its never-reuse note**, then the deletion marker, the deletion,
   and the marker cleared.
3. The box restarts. With no setup left it shows the ordinary setup page (the boot test above).
   - after **Start again**: the page's first screen, as today;
   - after **Recover from backup**: the "Join or recover an existing restaurant" screen, where the person
     picks Restore from backup, from their bucket, or from Waitron Cloud.

Someone who presses Recover from backup only to look at a backup has still deleted the setup (the
watcher's summary of the owner's 15:25 answer says this is accepted).

#### 1a. What the wipe does in each case

Read, not run, except where marked; slice 2 makes each row a test. **Recover from backup is no longer
offered beside saved trading settings, a finished setup, or any other row marked "refused"; today it
is.** Every refusal has words (§9).

| What the box finds | The wipe | What the person sees |
| --- | --- | --- |
| the setup finished | refused | `setupFinished`; Reconnect |
| the setup saved `trading.env` | refused | `tradingSaved`; Continue with the setup password |
| the setup database holds an invoice or another record Waitron never deletes | refused | `keptFault` (a fault in Waitron); Reconnect |
| the setup database holds other rows | offered (new: with or without a stopped recovery) | the confirmation |
| the setup database is empty, and the setup is unused | offered, as today | the confirmation |
| the setup database is empty, but the setup went past being claimed (its status is not claimed, consumption-intent or abandoned, `first-setup-resolution.ts:296-300`, refused at `:103`), or the box cannot show the setup is unused (`:579`) | refused, as today | `wipeUnavailable`, plus the existing `consumed` line where the setup recorded it may have used its series assignment (`setup-app.ts:2887`) |
| the setup database is missing | offered, with the existing missing-database tick ("Nothing was filed to AEAT and nothing was sold.") | the missing-database confirmation |
| the setup database cannot be read (run by the review: R2) | question 2 | picture 4 under answer A |
| the box keeps public fiscal records outside its folders (`first-setup-resolution.ts:582`) | refused, as today | `wipeUnavailable` |
| a restore is already waiting (`restore-request.json`, refused at `:585`), the files are not laid out as the deletion list expects, or the deletion marker would be too large (`:586-598`) | refused, as today | `wipeUnavailable`; the reason goes to the log |
| a deletion is already marked (`assertNoStartAgainDeletion`, `first-setup-start-again-deletion.ts:424-426`) | not refused: the box restarts and the start finishes that deletion, as today (`setup-first-fiscal-api.ts:1115-1119`) | the ordinary setup page after the restart |
| the folders hold an earlier Waitron's setup layout, or sit inside one (`first-setup-start-again-deletion.ts:466-475`) | refused, as today (`setup.workspace_unsupported`) | the existing "reinstall Waitron" page |

**Who can no longer recover from a backup through the repair page**: everyone in a "refused" row. What
they can do instead is what each row's words say: Continue with the setup password where the settings
were saved, or Reconnect. The other way out is a reinstall (`waitron.sh reset`), after which the box
offers the fresh-box restore; a reinstall adds nothing to the never-reuse note, so it keeps no safety
margin for the failed setup's names. Whether those people could recover from a backup today is
unmeasured: review 1 ran today's Recover only beside an occupied database with saved settings.

### 2. After the wipe: the box's ordinary restore

The restore is the fresh-box restore, unchanged: choose the backup and give its key, the node recovery
key and the two ticks, wait for the clocks, press Restore; the box saves the request and restarts, and
the start writes the backup into the usual folders (T2, T4). No recovery folder is made, so nothing
later moves the venue and nothing reads a journal to find it.

A restore that stops part way is "finished or discarded like any other", in the fresh-box path's
existing ways (read, not run by me; its crash tests are in `apps/server/src/restore-emergency-crash.e2e.test.ts`):

- stopped before Restore was pressed: nothing was saved but the preparation record; the person starts
  the restore again;
- stopped after the request was saved: the next start runs it;
- stopped while the start was writing it: the request is marked "placement started" before writing
  (`restore-request.ts:598-608`), and every later start runs it again as a resumed placement
  (`restore-request.ts:463`).

**One check the old recovery made that the fresh-box restore does not** (review 1, M9; read). Before
choosing a name, the old recovery also read the setup database's names, the setup's records and series
picks, and `<state>/module-evidence/<module>/` (`first-setup-backup-history.ts:60-82`). The wipe puts
the first three into the note. The fourth is written into a state folder only by a restore (the
backup's own `secrets/module-evidence/…`) or into the old recovery's own copy; first setup does not
write it, so beside a failed setup it exists only on a box restored earlier and not reset since. The
note does not cover it.

The default expectation is that it cannot exist beside a failed setup: the only code that writes it is a
restore (`restore.ts:273-274`, every `secrets/` entry into the state folder) and the old recovery's own
copy (`first-setup-backup-recovery.ts:562`; `rg module-evidence`, confirmed by review 3), and every way
`waitron.sh` takes a box back to first setup empties the state folder apart from the kept files
(`deploy/waitron.sh:741-749`). Slice 2 checks this first. If it finds the folder can exist there,
reading it into the wipe's floor would need a new input to the fiscal module's floor rule
(`packages/module/src/initial-setup.ts:81-94`, `packages/fiscal-verifactu/src/initial-hour-setup.ts:142-200`),
which is a change in `packages/fiscal-verifactu`. Slice 2 then stops and asks the owner, with a worked
example, before making it.

### 3. Who may

- **Deleting a failed setup needs no proof beyond reaching the repair page** (owner, 15:35). Slice 2
  removes every setup-password step that guards the wipe of the failed setup itself
  (`first-setup-resolution.ts:468,562,577,610`). Recover from backup and Start again run the same wipe,
  so a password on one and not the other would protect nothing.
- **The "files found" page keeps its password** (`recovery-start-again.ts`, A1098). "Move these files
  aside" sets aside files the box did not expect to find, which is not the wipe of a failed setup; the
  owner approved that choice behind the administrator password (A1098). The cost: if a wipe is cut off
  by a power cut that also changed a listed file, a person who pressed the button without knowing the
  setup password then meets a page that asks for it. Without it, Keep and Move are both closed (the one
  form needs the password for either), and only a reinstall clears the box.
- **Continue keeps its password**: it carries the setup on rather than deleting it.
- **Restoring needs the backup's own secrets** (its key and the node recovery key), as the fresh-box
  restore asks today.
- **Cost: the repair page can be reached from the venue's network, not only at the box.** After slice 2:
  - anyone who can open the box's page on the venue's network (a guest on the café's Wi-Fi, A1098's
    own example) can press Start again or Recover from backup and delete a failed setup. Whoever was
    setting the box up then types the setup in again;
  - that person can also make the box read and copy the setup database, which the confirmation step
    does to look for invoices (`first-setup-resolution.ts:474-477`);
  - the refusals in §1a still stop the wipe of anything that holds an invoice, a never-deleted record,
    saved trading settings or a finished setup, so nothing filed or sold can be deleted this way.
- **Both routes stay secure-connection-only**, today and in this design: the box keeps `assertHttps` on
  them. That protects what travels over the network, not who may press the button.
- The owner's 15:35 answer was about someone with access to the box. The network angle is new, so it is
  question 1.

### 4. The confirmation records

Today Start again keeps a small record naming the setup's administrator in three cases: the database
is missing, a stopped recovery is being discarded, or the database is present and the record of
chosen series names is damaged (`first-setup-resolution.ts:631-632,664-673`; `deploy/README.md:385-388`
lists the same three). Under answer A or B to question 2, a database the box cannot read is a fourth.
Each is written only after the setup password was checked (run by the review for the missing
database, R5; read for the other two, `:605-612`); `deploy/waitron.sh:742-744` calls them the records
"of who confirmed a Start again". With no password, nobody proves who pressed the button.

The smallest honest change (slice 2): a record written without a password keeps the setup's
administrator only as **whose setup this was** (the field is renamed to say so; pre-live, no
compatibility code, CLAUDE.md §3) and adds that it was **confirmed on the repair page with nobody signed
in**. The descriptions of these records change with it: the `waitron.sh` comment, `deploy/README.md:385-388`
and `docs/operations/first-live-fiscal-setup.md:106` ("the box records who confirmed").

### 5. The fiscal facts

- A restore starts a new chain under a new installation name (CLAUDE.md §5). The fresh-box path does
  this today (T2: the live series became `A-0CNQT`, `FF-0CNQT`, `R-0CNQT`).
- The note is written only by Start again (`first-setup-resolution.ts:675`) and by A1098's Move
  (`packages/provisioning/src/first-setup-start-again-set-aside.ts:238`); `deploy/waitron.sh` keeps it
  except under `reset --all`. This design adds no writer: Recover from backup calls the same Start again
  action. `scripts/start-again-note-writers.test.ts` needs no change until slice 4 removes
  `first-setup-backup-workspace.ts` from its allowed list.
- The restore's new name is chosen no earlier than the note (`recovery-preparation.ts:211`; the two
  tests run above; R4c), so it comes after every name the failed setup used, with the one gap §2 names.
- Under answer A or B to question 2, the floor for a database the box cannot read counts **every** file
  the setup left: its databases (`venue.db`, `node.db`) and their side files (`-wal`, `-shm`,
  `-journal`) included. A committed write can move only the `-wal` file's time (the side-file check
  above). The A1099 rule as built leaves `venue.db` and `node.db` out
  (`attemptLastWriteMs`, `first-setup-start-again-deletion.ts:335-354`; run by the review, R3), and a
  setup database can hold a name later than anything else the setup recorded (the held test "the note's
  floor follows a later installation the setup database holds", run by the review). Slice 2 tests it with
  two controls on their own: a later `venue.db` time must move the floor, and a `venue.db-wal` newer
  than every other file, with `venue.db` itself left older, must move it too. The rule delivers this
  much and no more: no name from before the setup's last saved write, plus the margin, is used again.
- **No slice touches the fiscal core**: `computeHuella`, the chain, invoice numbering,
  `registros_facturacion` and the alta builders are not changed, and no file in
  `packages/fiscal-verifactu` is edited, with one possible exception that goes to the owner first: the
  `module-evidence/` case of §2. Its golden hash test and `inmutabilidad.test.ts` must pass
  unedited in every slice.
- **No slice adds a database migration.**

### 6. Power cut at each step

| Cut after… | The next start finds | It does |
| --- | --- | --- |
| the confirmation was shown, before confirming | the setup untouched | the repair page |
| the checks, before anything is written | the setup untouched | the repair page |
| a confirmation record (the three cases of §4, and an unreadable database under question 2 A or B), before the note | a record with no note change; the setup untouched | the repair page; the record is harmless and pressing again writes another |
| the note, before the deletion marker | the setup untouched, the note later | the repair page; pressing again raises the note to the same minute and goes on |
| the marker, part of the deletion done | the marker | finishes the deletion and shows the setup page's **first** screen (the choice of Recover is lost; the person picks "Join or recover"); or, if a listed file changed, deletes nothing and shows the "files found" page, which needs the setup password (§3) |
| the wipe, before the person reaches the restore | no setup | the ordinary setup page's first screen; the person picks "Join or recover" |
| choosing the backup, before Restore is pressed | no setup, a preparation record | the ordinary setup page; the restore is begun again |
| Restore pressed, request saved | the saved request | runs it |
| part of the restore written | the request marked "placement started" | runs it again as a resumed placement |
| the restore written | an ordinary box | starts and sells |

Nothing can be filed twice: there is never more than one venue database, and before the restore is
written nothing sells.

### 7. Every reader of the recovery folder, and what changes

The redesign never makes a recovery folder, and a start that finds none in either usual folder stops
looking at once (`resolveFirstSetupBackupEntry`, `apps/server/src/first-setup-backup-entry.ts:77-93`).
The probe checked the function behind it, `resolveFirstSetupBackupWorkspace`, which answered "absent"
(T2, T4). So on a box set up after slices 2 and 3, every reader below finds nothing. Slice 4 deletes
them, and a box that still has the folder then shows the existing "reinstall Waitron" page
(`setup.workspace_unsupported`, as older setup workspaces do today,
`packages/provisioning/src/first-setup-workspace.ts:40`).

| Reader | What it does with the folder today | After |
| --- | --- | --- |
| the start (`node-entry.ts:343-372`, `first-setup-entry.ts:74,117`) | decides repair page, or "selected" | finds none; ordinary start |
| the folder switch (`node-entry.ts:408-421`, `first-setup-launch.ts:102`) | runs the box from `target/venue` and `target/state` | gone; the box always runs from the usual folders |
| the selling path (`boot.ts:896`, `assertFirstSetupBackupBootTarget`) | refuses the usual folders while a recovery exists | gone |
| the note's reader (`packages/provisioning/src/box-folders.ts:12-29`) | maps the copy back to the box's own state folder | reads the usual state folder directly |
| Start again (`first-setup-resolution.ts:335-410`, `:681-690`) and its deletion list (`first-setup-start-again-deletion.ts:239` `backupRecoveryKept`, `:307` layout check, `:476` `insideBackupRepairTarget`) | finds a stopped recovery, discards it, refuses an unexpected one | no recovery to find; that code goes |
| discarding (`packages/provisioning/src/first-setup-backup-discard.ts`) and the start's emptying of a discarded copy (`first-setup-entry.ts:248-270`) | empty a discarded recovery's copy | gone |
| the spare file (`apps/server/src/spare-space.ts:253-256`) and A1127's full-disk page (`apps/server/src/discarded-copy.ts:14-19`, `node-entry.ts:427`, `recovery-surface.ts:619`) | count a discarded copy as space to free | gone; the full-disk page no longer counts it |
| the start's clean-up (`node-entry.ts:344`) | cleans the copy's folders at "selected" | cleans the usual folders, as on any box |
| the fingerprint (`first-setup-backup-workspace.ts:300-427`) | compared at every step and start | gone |
| the old recovery's routes (`apps/server/src/setup-first-backup-api.ts`) and the setup page's recovery screens and "Finish saved recovery" (`apps/setup/src/screens/first-setup-backup-screen.ts`) | open, resume and finish a repair-page recovery | gone; the fresh-box restore screens are used |
| the user guide page `backup-recovery` (`guide-catalogue.ts:19`, `guide-pages.ts:85,107`) | describes the repair-page recovery | rewritten for the new flow (slices 2–3) |
| `apps/server/test-durations.json` | rows for the old recovery's test files | rows removed with the files (slice 4) |
| `waitron.sh`'s production check (`deploy/waitron.sh:498-548`), the break-glass and credentials commands, `apps/server/scripts/record-one-sale.ts:100` | look in the usual folders, so miss a venue in a recovery folder | find the venue, because it is always there |

### 8. What the redesign cannot remove

- **The repair page itself**, for any setup that stops part way.
- **Start again's deletion marker** (`first-setup-deleting.json`) and its finishing at start: that is
  what makes the wipe safe across a power cut.
- **The "files found" page and its password** (§3).
- **The note and the files A1042 and A1098 keep**: the never-reuse note, the confirmation records, the
  Keep-or-Move records and the set-aside folder.
- **The fresh-box restore's own files** while a restore is under way: the saved request
  (`restore-request.*`) and `restore-staging/` in the state folder (T2), cleared when it succeeds.
- **Boxes that already have a recovery folder**: no code converts them (the decision below).

### 9. Pages and words

Repair page strings: `apps/setup/src/screens/initial-owner-strings.ts`. Pictures in
`docs/backlog/mockups/a1131bc-restore/`. Each message is short (owner, A1167 words, 2026-10-28).

The box checks only that the setup database holds no invoice record, so the words say "No invoice was
sent to AEAT", not "Nothing was sent". An invoice reaches AEAT only after its record is in the database,
and a record found there refuses the wipe (`keptFault`).

**a. Start again's confirmation** (picture 1). No password and no counts. `heldLost` replaces `heldRows`,
`heldRowsOne`, `heldNoInvoices`, `heldNoInvoicesOne` and the old `heldLost`: EN "Start again deletes what
was entered in the setup that stopped part way. No invoice was sent to AEAT." ES «Empezar de nuevo borra
lo que se introdujo en la configuración que se detuvo a medias. No se envió ninguna factura a la AEAT.»
The second sentence shows only once the box has read the database and found no invoice. With the
database missing, the existing missing-database words and tick stay instead.

**b. Recover from backup's confirmation** (picture 2). `recoverDeletes`: EN "Recover from backup first
deletes what was entered in the setup that stopped part way. No invoice was sent to AEAT. Then you choose
the backup." ES «Recuperar desde una copia primero borra lo que se introdujo en la configuración que se
detuvo a medias. No se envió ninguna factura a la AEAT. Después eliges la copia.» Tick `retireRecover`:
EN "Delete the old attempt and recover from a backup." ES «Borrar el intento anterior y recuperar desde
una copia.» The middle sentence follows (a)'s rule. The help line under both: EN "This box will not use
this setup's invoice series names again." ES «Este equipo no volverá a usar los nombres de serie de
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
- `wipeUnavailable` (replaces `startUnavailable` and `startUnavailableOccupied`, for the rows of §1a that
  have no words of their own): EN "This box cannot confirm that deleting this setup is safe, so it is not
  offered. Reconnect keeps everything as it is." ES «Este equipo no puede confirmar que borrar esta
  configuración sea seguro, así que no se ofrece. Reconectar lo deja todo como está.» The exact cause
  goes to the log line.
- `consumed` stays as it is.
- `heldChanged`: EN "The setup changed after this page read it. Try again." ES «La configuración cambió
  después de que esta página la leyera. Inténtalo otra vez.»

**d. A setup database the box cannot read** (picture 4; only with answer A to question 2). EN "This box
cannot read the setup database, so it cannot list the invoice series names that setup used." ES «Este
equipo no puede leer la base de datos de configuración, así que no puede saber qué nombres de serie de
facturas usó esa configuración.» Then the existing `namesFrom` line ("New series names can start from
{date}, {time}.").

**e. Strings that change or go.** `damagedRecordPassword` goes in slice 2, which makes it false.
`uncheckable` ("… Keep its files for recovery.") becomes EN "This box cannot check the original setup
password, so Continue is not offered." ES «Este equipo no puede comprobar la contraseña original de
configuración, así que no se ofrece Continuar.» The repair-page recovery strings (`recoveryRunning` …
`recoveryDetailsUnread`, and `apps/setup/src/i18n/backup-repair.ts`) go in slice 4.
`tradingSavedPassword` belongs to Continue and stays. The "files found" page's words do not change.

### 10. What is NOT changed

- The fresh-box restore: its screens, checks, power-cut handling and where it writes.
- Start again's checks, its note, its deletion list and its finishing at start; only the password steps
  that guard the wipe of the failed setup go (§3).
- The "files found" page, its Keep and Move choices and its password (§3).
- Continue and its password.
- Both routes' secure-connection-only rule.
- The fiscal module (§5) and the database's structure.
- The never-reuse note's lifetime: only `waitron.sh reset --all` removes it.

## Decision recorded, not asked

**Boxes that already used the old Recover from backup** (the first revision's question 2, dropped).
The standing pre-live rule settles it: "No backwards-compatibility or data-migration code until Waitron
is in production. Until then any installation may be reset at any time instead of carrying its data
forward" (CLAUDE.md §3, the last data bullet; owner, 2026-10-03). So after slice 4 such a box shows the
existing "reinstall Waitron" page, and is reinstalled and restored again. A reinstall also deletes the
box's own backups (`waitron.sh` removes the `backups` volume; the reset test above), so the backup to
restore from must be kept off the box; a test box's sales since its recovery are lost without one.

## Slices

Each is one pull request, smallest first; no slice adds a migration. None edits the fiscal core; the
one possible exception, in slice 2, goes to the owner first (§2).

1. **Start again's words without counts** (§9a, `heldLost`; the summary and confirmation stop carrying
   counts; the user guide's count lines). Light review. Picture 1's words.
2. **One wipe, no password** (server, plus the words and docs that would otherwise be false). Start
   again's wipe-guarding password steps go (§3), the "files found" page's stays; the "database holds
   rows" case is offered with or without a stopped recovery; every row of §1a as a test, with §9c's
   words; the confirmation records of §4; question 2's rule; the `module-evidence/` check of §2 (which
   stops for the owner if it finds a fiscal-module change is needed). Docs: every sentence in the user
   guide pair (`apps/server/src/guide/{en,es}/backup-recovery.md`), `docs/operations/first-live-fiscal-setup.md`,
   `deploy/README.md` and `deploy/waitron.sh` that says Start again asks for the setup password, times
   something from the password step, or says who confirmed; found again by search when the slice is
   built. Read on 2026-10-29: the English guide's lines 29-31, 32-33, 37, 45-47 and 50 (the Spanish
   guide's 31, 34, 40, 48-50 and 53); `first-live-fiscal-setup.md` lines 97-98, 102, 106, 116-117,
   129-131, 148 and 151; `deploy/README.md:385-388`; `deploy/waitron.sh:742-744`. Tests: a setup database holding rows and
   series names, wiped, then the fresh-box restore writing into the usual folders, with the note's minute
   later than every name that database held (control: with the note step removed, a name from the setup
   database is accepted); each refusal deletes nothing; a cut after the marker is finished at start;
   a plain-HTTP request to the Start again route is refused (only the summary route's is tested today);
   under question 2 A or B, the two floor controls of §5, the `-wal` one on its own. **Fiscal-adjacent** (it decides what
   enters the never-reuse note): full review.
3. **Recover from backup becomes the wipe** (setup page). The confirmation of §9b; after the restart the
   setup page opens on "Join or recover"; the repair page stops opening the old recovery for new
   recoveries. Pictures 2 and 3. User guide `apps/server/src/guide/{en,es}/backup-recovery.md`.
   **Fiscal-adjacent** (it changes which restore the repair page leads to): full review.
4. **The old recovery folder code goes** (server, provisioning, setup page), under the decision above:
   every reader in §7, Finish saved recovery and its routes, the folder switch, `boxFolders`, the
   discarded-copy code in the spare-file and full-disk paths; a box that still has the folder shows the
   reinstall page. CLAUDE.md's spare-file entry ("its emptying of a discarded recovery") and
   `scripts/spare-space.test.ts`; `first-setup-backup-workspace.ts` leaves
   `scripts/start-again-note-writers.test.ts`'s allowed list; `apps/server/test-durations.json`'s rows for
   the deleted test files; `docs/operations/hour-recovery.md`, `backups-and-support.md`,
   `first-live-fiscal-setup.md`, `docs/developers/conventions-data.md`. Closes A1131 place 2: a box never
   sells from inside a recovery folder again. The fiscal module keeps any seat only the old path called;
   deleting one is a later, separate decision. Mostly deletion; split it in two (server and
   provisioning, then setup page and docs) if it passes about 100 tool calls. **Fiscal-adjacent** (it
   removes a restore path that writes the new installation name): full review.

## Open, not measured

- **A setup database holding rows, wiped this way**: needs slice 2's code; slice 2's first test.
- **The bucket and Waitron Cloud restores after a wipe**: only the backup-file restore was probed.
- **The fresh-box restore after a power cut** on a real box: covered by its existing crash tests, which
  I did not run.
- **The box's own `module-evidence/` beside a failed setup** (§2): read only; slice 2 settles it.
- **The rows of §1a**: read, except the unreadable database (R2).
- **Carrying "go to Join or recover" across the restart**: the page holds the choice; how it survives the
  reconnect is slice 3's to settle and test.

## Questions for the owner

**Q1 of 2 — Who may delete a failed setup.** You said anyone with access to the box may delete a
failed setup, because they could reinstall it anyway. The repair page can also be opened by anyone on
the venue's network, not only at the box. Deleting a failed setup loses only what was typed into it: if
the setup holds an invoice, or saved its selling settings, the box refuses. Example: Marta's setup
stops when the power goes. Before she is back, a guest on the café's Wi-Fi opens the box's page and
presses Start again. Marta types her setup in again.
- **A (recommended):** anyone who can open the repair page may delete it. The cost is the example
  above. Also, rarely: if the power goes again during the deletion, the box may then ask for the setup
  password before it can finish, which the person who pressed the button may not know.
- **B:** ask for the setup password before deleting, for both Start again and Recover from backup. The
  cost: someone who has forgotten it can neither start again nor recover from a backup; only a
  reinstall helps.

**Q2 of 2 — A failed setup whose database is damaged.** The box must never reuse an invoice series name
a failed setup used, and the setup's database can hold names the box keeps nowhere else. Example: Marta's setup stops
when the power goes and its database is damaged, so the box cannot read which names the setup used.
Today she can neither start again nor recover from a backup.
- **A (recommended):** the box may still delete it, with a safety margin taken from when the setup last
  saved anything, so it does not reuse a name that setup may have used. The cost: the damaged setup is
  gone for good, and a new setup or restore may have to wait a few minutes for the margin to pass.
- **B:** the box moves the damaged setup into a folder instead of deleting it, with the same margin. The
  gain: someone could later try to read it. The cost: the folder stays on the box until a full reset.
- **C:** the box refuses. Then only a reinstall clears it, and a reinstall keeps no such margin.

**For your information** (no answer needed):
- Start again stops asking for the setup password too, because it deletes the same failed setup as
  Recover from backup (your 15:35 rule). Continue, and the page that lets you move unexpected files
  aside, keep theirs.
- Recover from backup is no longer offered where Start again is refused: beside saved selling
  settings, a finished setup, a setup database holding an invoice, or a setup the box cannot show is
  safe to delete. There the
  way out is Continue with the setup password, or a reinstall, which keeps no safety margin for the
  failed setup's invoice series names.
- Boxes that already sell from the old recovery folder must be reinstalled and restored again (the
  before-go-live rule). A reinstall also deletes the box's own backups, so the backup must be kept
  off the box.
