# A1131b and A1131c: a recovery from backup replaces the failed setup, and the recovered venue lives where every venue lives

Two owner directions from 2026-10-28 (`~/waitron-campaign/questions.md`), designed together because both
are about what a recovery from backup does to the box's normal venue folder. Revised the same day after
a fresh review (`~/waitron-campaign/item-a1131bc-design-review.md`: 3 critical, 10 important, minors;
all folded in), then after a round-3 claim check (`item-a1131bc-design-review-3.md`: 2 critical,
5 important, minors), which changed when the setup is deleted. See "Review rounds" at the end.

**A1131c** (owner, ~13:45, "OWNER ANSWER — A1131: #2190 LANDED …"):

> Can't we identify that this was a failed restore from backup, which means that nothing new was added
> because we shouldn't stay after a failed restore, so nothing is lost
>
> Similarly after a failed setup we shouldn't start the service so there is nothing to lose (that can't
> be typed again). And if we then start a restore, we wipe what was there from the setup.

So: (1) starting a recovery from backup deletes what the interrupted setup left, after writing every
invoice series name that setup used into the box's "never use again" note; the refusals #2190 built stay;
(2) Start again's page stops counting items and says "Start again deletes what was entered in the setup
that stopped part way. Nothing was sent to AEAT."

**A1131b** (owner, ~08:10, "OWNER ANSWER … A1131 place 2"):

> Wait, when we recover from a backup we use the database from the backup folder? But that could damage
> the backup. We should copy it to the standard database path before writing anything.

So: once a recovery is chosen, the recovered database and its settings go to the box's normal venue and
state folders, and from then on the box starts from there like any other box. A damaged recovery record
must never again be able to hide the venue the box sells from.

This design is docs only. Nothing is built until the owner answers the questions at the end.

### Words used here

- **Setup**: the first setup of a box, done in the browser. **Interrupted setup**: one that stopped part
  way; the box then shows the **repair page** ("First setup was interrupted") instead of selling. Its
  **attempt record** is `<state>/first-setup.json` (it holds the administrator password's hash,
  `packages/provisioning/src/first-setup-state.ts:373,414`) and `<venue>/first-setup-claim.json`.
- **Setup database**: `<venue>/venue.db` of that interrupted setup.
- **Recovery** (the code says "backup recovery" or "backup repair"): on the repair page, **Recover from
  backup** → choose a backup → **Open backup** (proves its key, shows what is in it) → **Recover** (copies
  it onto the box and makes it ready to sell). **Finish saved recovery** continues one that stopped.
- **Recovery folder**: `<state>/first-setup-resolutions/backup-recovery/<id>/`. It holds the recovery's
  **journal** (its step-by-step record, `000001.json`, `000002.json`, …), copies of the box's small files
  (`evidence/`, `originals.json`), and today also the **recovered copy** (`target/venue`, `target/state`).
- **Journal steps** today: `prepared` (backup opened), `placement-started` (Recover pressed), `restored`
  (copy made ready), `selected` (the box will use it), `abandoned` (Start again discarded it)
  (`packages/provisioning/src/first-setup-backup-workspace.ts:30`). This design adds `placed`.
- **Fingerprint of the box's own files** (the code's "originals"): a list of every file in the standard
  folders with its size and hash, taken at `prepared` and compared again at every later step and every
  start; any difference makes the recovery "uncertain" (`first-setup-backup-workspace.ts:292-411`, compared
  at `:528-557` and `:645-646`).
- **Pointers**: two small files, `current.json`, one in the normal venue folder and one in the normal
  state folder, that tell a start "a recovery exists, read its journal".
- **Standard folders**: the box's normal venue folder and state folder. On a box the image sets only
  `WAITRON_STATE_DIR=/var/lib/waitron/state` (`deploy/Dockerfile:269`), so the venue folder is
  `<state>/venue` (`apps/server/src/config.ts:517`), on the `state` volume (`deploy/compose.yml:43`).
- **Installation name**: the five symbols from the minute the name was taken, ending every invoice series
  name of a box (`A-0CNNY`). A name may never be used twice. **The note** is the box's file of "never use
  a name from before this minute": `first-setup-start-again.json` in the state folder (CLAUDE.md §5).
- **Change log**: SQLite's `venue.db-wal`, where recent writes sit before they are copied into `venue.db`;
  `venue.db-shm` is its index.

### How this was checked

"Run" means I ran it on 2026-10-28 (macOS 26.6.2 arm64, Node v26.11.1, SQLite 3.54.0); probes and raw
output are in `~/waitron-campaign/a1131bc-measure/` (`README.txt`). Before each probe I wrote down what
the failing case would print. "Read" means I followed the code and did not run it. "Read by the review"
means the review's reading, which I checked only where I say so.

- **Probe 1, moving a database whose change log holds unsaved rows** (`wal-rename-probe.mjs`). A child
  process wrote 1,000 rows in change-log mode with automatic saving off, then was **killed** (not a power
  cut: a power cut can also lose a rename the disk had not yet saved, which is why §2 saves the folders
  before writing `placed`). It left `venue.db` (4,096 bytes), `venue.db-wal` (28,872) and `venue.db-shm`.
  Failing case: fewer than 1,000 rows after a move that carries every file. Results: renaming the folder
  → 1,000 rows; moving the three files one by one, then opening → 1,000 rows. Controls, which must lose
  rows: `venue.db` alone → "no such table"; `venue.db` alone, **opened**, then the change log moved in →
  still "no such table". So nothing may open the database until every file has moved.
- **Probe 2, a rename across two filesystems** (a 4 MB `hdiutil` image, detached and deleted after).
  Failing case: "ok". Result: `EXDEV`, refused.
- **Probe 3, a real recovery to `selected`, and the fiscal link after a move** (`folders-probe.test.ts.txt`,
  run once in `apps/server/src` on the recovery test host, `selectedRepair` in
  `apps/server/test/first-setup-backup-resume-fixture.ts`, then removed). At `selected`:
  - the standard venue folder held `first-setup-claim.json`, the pointer and `venue.lock`; the standard
    state folder held the interrupted setup's `first-setup.json` and `module-preparation-state.json`, and
    the recovery folder;
  - `target/venue` held `venue.db` (3.5 MB), `node.db`, `venue.lock`, `migrations.lock` and a
    `backlink.json`; `target/state` held `trading.env`, `credentials.key`, `node-key.enc`, `cluster-id`,
    `modules.json`, `module-preparation-state.json`, `module-evidence/`, `rebuild-first-start.json` and a
    `backlink.json`;
  - this host keeps the venue and state folders side by side (not one inside the other); the copy's
    folders were on the same filesystem as both;
  - I moved `venue.db` and `node.db` to a new folder and ran `assertFiscalRestoreCommitted` on the moved
    database with the journal's link. Failing case: refused. Result: accepted. Control, a different event
    id: refused `sif.allocation_invalid`.
- **Probe 4, a lock-free open of a missing database** (`create-probe.mjs`). Failing case: no file. Result:
  a plain open created a 4,096-byte `venue.db`; control, a read-only open: refused, no file.
- **Probe 5, what a start reads after the box's files change at `selected`** (`chain-probe.test.ts.txt`, run
  once in `apps/server/src` on the same fixture after a real Recover to `selected`, then removed; output
  `chain-probe.out`). Results: the full read
  (`resolveFirstSetupBackupWorkspace`, what every start uses today) answered `selected` untouched, then
  `setup.attempt_uncertain` once a note file was written, and again once `first-setup.json` and
  `first-setup-claim.json` were deleted. That half discriminates: it shows today's start refuses what §1
  does after `selected`. The other half does not: the chain-only read (`readChain`) answered `selected` in
  both cases, but it never compares the fingerprint (`first-setup-backup-workspace.ts:531`), so it could
  not have refused; and this fixture's setup had no `venue.db` (Probe 3). The probe called `readChain()`,
  not a start's resolver; §2 makes the resolver and `readRecords` take that read from `selected` on.
- **Run by the reviews** (not re-run by me): `first-setup-backup-recovery-opening.test.ts -t "unreadable
  retained history"` (1 passed); a throwaway call of `finishStartAgainDeletion` with a deletion marker beside
  a recovery's venue-side pointer: refused "refused artifact present: venue/first-setup-resolutions" (control
  with no pointer finished); and `first-setup-backup-workspace.test.ts`'s "abandons after Start
  again has written the series-name note…" and "keeps an abandoned journal readable…" (5 passed): writing
  the note makes the next ordinary journal step fail `setup.attempt_conflict`, and deleting
  `first-setup.json` makes the start "uncertain".

## What happens today

### A recovery leaves the interrupted setup in place

- The first step after **Open backup** reads every installation name the setup database holds, from a
  private copy, so the recovery's own new name comes later than all of them (`readFirstSetupBackupHistory`,
  `apps/server/src/first-setup-backup-history.ts:23-89`, called at
  `apps/server/src/first-setup-backup-recovery.ts:581`). If the setup database cannot be opened, that step
  is refused `module.operation_invalid` and nothing is written (`first-setup-backup-history.ts:38-51`,
  read). The test the reviews ran (`first-setup-backup-recovery-opening.test.ts:231`) shows the same refusal
  for an unreadable `first-setup.json`, not for an unreadable database.
- The fingerprint of the box's own files leaves out only the recovery's own folder, the pointers, lock
  journals and holder files, the set-aside folder and the spare file (`first-setup-backup-workspace.ts:298-327`,
  read). **The note, Start again's records and its deletion marker are in it.** So the interrupted
  setup's files stay beside the recovery for good (Probe 3), and writing the note or deleting a setup file
  during a recovery makes it "uncertain" (the review's run above).
- The recovery page says so: "The old attempt and its files are kept separately."
  (`apps/setup/src/i18n/backup-repair.ts:25`).

### Start again beside a stopped recovery counts the setup's items (A1131 part 1, #2190)

- When a recovery stopped part way and the setup database holds rows, Start again asks for the
  administrator password, then shows the counts ("The setup database already holds 105 saved items. None of
  them is an invoice, so no invoice was sent to AEAT. …", `apps/setup/src/screens/initial-owner-strings.ts:56-61`,
  Spanish `:148-153`).
- It refuses (`setup.start_again_refused`) when the database holds an invoice or another row Waitron never
  deletes (said to be a fault in Waitron), when `<state>/trading.env` exists, or when the setup finished
  (`assertHeldStartAgainOffered`, `apps/server/src/first-setup-resolution.ts:95-109`; the count check
  `:567`). It needs the attempt record: with none it answers unavailable (`:518`), and it checks the password
  at `:562`, `:577` and `:608-611` (read by the review).
- Before deleting, it writes the names into the note: `readSetupDatabaseHoldings`
  (`apps/server/src/first-setup-database-holdings.ts:44-98`) asks the fiscal module, which reads
  `registro_sif`, `invoice_series`, `fiscal_allocations` and `fiscal_reservations`
  (`packages/fiscal-verifactu/src/start-again-holdings.ts:48-93`); `gatherStartAgainFloor`
  (`first-setup-resolution.ts:140-276`) adds the attempt's own names and a stopped recovery's own floor
  (`:263`); `raiseStartAgainNote` writes it (`:675`). Then a deletion marker (`first-setup-deleting.json`,
  `:711`) and a fixed list (`itemsOnDisk`, `packages/provisioning/src/first-setup-start-again-deletion.ts:274-329`).
  A start finding the marker finishes, and deletes nothing if a listed file changed
  (`finishStartAgainDeletion`, `:615-635`). Read.
- The list walks `first-setup-resolutions/` and throws "layout unexpected" on a `backup-recovery/` that is
  neither abandoned nor being discarded (`:301-306`), and the disk check refuses a venue-side
  `first-setup-resolutions/` holding anything but a discarded recovery's pointer (`:51`, `:256-271`). Read
  by the review.
- When names cannot be read: A1099 takes the floor from the attempt's newest file time **other than its
  databases**, plus 150 seconds, to the next minute (`attemptLastWriteMs`, `:335-354`;
  `packages/fiscal-verifactu/src/initial-hour-setup.ts:141,202-208`), and is used only when the database
  is missing. A1098's Move takes it from **every** moved file's newest time
  (`startAgainSetAsideFloorMs`, `packages/provisioning/src/first-setup-start-again-leftovers.ts:47-48,88-100`).
  Read.

### The box sells from inside the recovery folder, found only through the journal

- **Recover** places the copy in `target/venue` and `target/state` (`first-setup-backup-recovery.ts:603-616`;
  the journal refuses any other place, `first-setup-backup-workspace.ts:127-143`). The backup file itself is
  not written: the copy comes from a checked copy in a temporary folder (`writeValidated`,
  `apps/server/src/restore.ts:346-410`). Read.
- Inside the copy, before `selected`, the fiscal module records the new installation name and its link to
  this recovery: a `fiscal_allocations` row keyed by the journal's event id
  (`packages/fiscal-verifactu/src/restore-committed.ts:8-25`), checked at the end of placement
  (`first-setup-backup-recovery.ts:1430-1440`; `:1410` for a Waitron Cloud copy). Then `restored`, then
  `selected` (`:1444-1451`), then, for a Waitron Cloud recovery, the report to Cloud and
  `target/state/cloud-recovery.json` (`:1452-1460`).
- Each start reads both pointers, the journal and the fingerprint, and only at `selected` runs the server on
  the copy (`resolveFirstSetupBackupWorkspace`, `first-setup-backup-workspace.ts:743-781`;
  `apps/server/src/first-setup-backup-entry.ts:77-106`), rewriting `WAITRON_VENUE_DIR` and
  `WAITRON_STATE_DIR` (`apps/server/src/node-entry.ts:376-385`; `first-setup-launch.ts:102-113`). Read.
- **If the journal cannot be read, the start shows the repair page** (`first-setup-backup-entry.ts:96-99`,
  `first-setup-entry.ts:75-80`), even after months of selling from the copy. Lane A ran this for the A1131
  place-2 question: "The setup database is missing." and "This box found a recovery from backup whose
  records cannot be read.", Reconnect only. That is A1131 place 2.
- **Tools that miss a recovered venue today** (read): `waitron.sh`'s production check reads
  `$WAITRON_STATE_DIR/trading.env` and the environment stamp in `<state>/venue/venue.db`
  (`deploy/waitron.sh:498-501,548`); on a recovered box neither is the venue's (with a setup database
  left there, it reads that database's stamp). The break-glass and credentials commands and
  `apps/server/scripts/record-one-sale.ts:100` open the standard folder lock-free (`exclusive: false`, which takes no lock, `packages/store/src/index.ts:231`), and Probe 4
  shows such an open of a missing file creates one.

## The design

### 1. The setup is deleted once the recovery is chosen, after its names are kept (A1131c)

**The shape, and why it is not "at Recover".** The owner's words put the deletion when the recovery
starts. The reviews showed what that costs (Q3 B lists it): every check the recovery makes of the box
between Recover and `selected` assumes the setup is still there. This design deletes the setup's files at
`selected`, the moment the copy is complete and chosen, as the first part of the move (§2). From that
moment the journal is read as a chain only, which Probe 5 shows accepts deleted setup files. Until then
nothing of the setup is deleted, so every way forward that exists today for a stopped recovery still
works. Q3 asks the owner to choose.

**At Recover** (before `placement-started`, under the venue locks the commit already holds):

1. **Checks.** Each refusal changes nothing and is said on the recovery page (§4e):
   - the setup finished (kept as a defence, as in #2190);
   - `<state>/trading.env` exists (the setup saved the settings the box sells with);
   - the setup database holds an invoice or another never-deleted row (a fault in Waitron; counts to the
     log line);
   - the setup database is missing and its public record, its documents file or its record of series picks
     cannot be read: refused as Q2's refusal is, nothing written. In that case the note's floor would come
     from file times (A1099), which throws beside a recovery in progress (the round-4 review's probe:
     `attemptLastWriteMs` answered `setup.start_again_incomplete`, "layout unexpected:
     first-setup-resolutions/backup-recovery"; control with no recovery folder returned a time), and a
     file-time floor could land after the name the recovery already chose at `prepared`, which placement
     would then refuse (`minute_not_later`, `first-setup-backup-recovery-preparation.test.ts:620`, read by the
     review).
   An unreadable setup database never gets here (§"What happens today"; Q2).
2. **Names into the note**, just before `placement-started` is written (`first-setup-backup-recovery.ts:1323`),
   after placement's own refusals, so a refused Recover raises nothing. `gatherStartAgainFloor` (today
   private to `first-setup-resolution.ts:140`) is exported and called with no recovery floor, then
   `raiseStartAgainNote`: every name in the setup database and the attempt's own names. For this the
   fingerprint of the box's own files leaves out one more file, the note `first-setup-start-again.json`,
   beside the set-aside folder and the spare file it already leaves out
   (`first-setup-backup-workspace.ts:298-327`). Without that, the next step and every start would call the
   recovery uncertain (Probe 5, "full read, note written"). Start again's confirmation records stay in the
   fingerprint, so a recovery still cannot carry on past a Start again that has begun: Start again writes
   its confirmation (`first-setup-resolution.ts:666`) before its note (`:675`). Read.
3. **Placement**, as today.

**Which server checks change.** Only the fingerprint's walk, by that one file. The server's `recheck`
(`first-setup-backup-recovery.ts:444-451`, read by the review) refuses while a Start again marker exists
(none is written), compares the setup snapshot from `first-setup.json` (unchanged until `selected`) and the
fingerprint (`inspect()`, the same walk, so the note is left out). Resume (`:1036-1046`) and reopen
(`:826-835`, `:913`) compare the same snapshot and re-read the box's history (`:959` → `:581`), both
unchanged until `selected`. Nothing checks them after `selected`: the commit's last steps are `select`, the
Cloud report and clean-up (`:1444-1466`), and a start reads only the journal (§2).

**At `selected`** (§2, step 3a): the setup's files are **renamed** out of the standard folders into the
recovery folder's `setup-leftovers/venue/` and `setup-leftovers/state/`, matched by name with Start again's
own rule for a held Start again (`listed`, `first-setup-start-again-deletion.ts:108-125`): `venue.db`,
`node.db` and their side files, `first-setup-claim.json`; `module-preparation-state.json`,
`first-setup-node-key.json`, `module-operation-public.json`, `modules.json`, `first-setup.json`,
`first-fiscal-documents/` and the attempt's `first-setup-resolutions/<attempt-id>/` folders, never
`backup-recovery/`. They are deleted when the recovery folder is retired (§2 step 8). A rename, not Start
again's deletion, because Start again's finisher refuses beside a recovery's pointer (the review's probe),
its marker needs the attempt id (`first-setup-resolution.ts:589`), and a rename leaves each item in exactly
one of two places, which a start can finish from with no marker.

**No second fingerprint, no Start again marker.** This shape needs neither. The only new file is the
finishing record of §2 (`first-setup-recovery-finished.json`: `{ "version": 1, "recoveryId": "<id>" }`).

**Not measured.** Probe 3's standard state folder at `selected` held only `first-setup.json` and
`module-preparation-state.json`, but its setup had only been claimed. A setup stopped after activation may
leave other files that are not on the list; any whose name the copy also has stops the move on §4g's page,
deleting nothing. Slice 3 measures the folders after an interrupted activation
(`first-fiscal-interruption.test.ts`'s fixture) before writing the move.

### 1b. Finish saved recovery beside any stopped recovery

#2190's point 4 (Start again where the setup password cannot be checked) needs a way forward. The setup page
hides **Recover from backup** once a recovery has stopped (`apps/setup/src/setup-app.ts:2860`, read by the
review), and **Finish saved recovery** shows only at `placement-started` and `restored`
(`apps/setup/src/screens/first-setup-backup-screen.ts:815`). The change: the setup page shows **Finish saved
recovery** beside any stopped recovery, `prepared` included, through the existing reopen
(`first-setup-backup-recovery.ts:826-835`, `:913`). Read, not run: that a reopened recovery at `prepared`
reaches Recover (the commit accepts a session that is not a resume at `prepared`, `:1273-1276`; a resume's own
check is `:1037`). Slice 7 checks this first; if it does not hold, point 4 keeps today's words.

### 2. The recovered venue moves to the standard folders once chosen (A1131b)

**Where the copy is made (Q1).** Still in the recovery folder; it moves once complete and chosen, before the
box first sells from it. The standard venue folder then only ever holds the interrupted setup (before
`selected`) or a complete, chosen venue. The recovery's own preparation (schema updates, the new installation
name and its `fiscal_allocations` link) is written into the copy before it moves; none of it is a sale or
anything sent to AEAT, and the backup file is never written.

**One filesystem, checked at Open backup (Q8).** A rename is all-or-nothing only within one filesystem (Probe
2). Open backup refuses, before writing anything, when the standard venue folder is not on the same
filesystem as the state folder (§4i). On a box both are on the `state` volume.

**From `selected` on, the journal is read as a chain only** (`checkedRecords(…, chainOnly)`,
`first-setup-backup-workspace.ts:531`): its records in order, each linking to the one before, without the
fingerprint, as abandoning already does. `readRecords` itself returns after the chain check from `selected`
on, as it does for `abandoned`, so the server's `status()`, `liveRecords` (`first-setup-backup-recovery.ts:696-697`)
and `readTombstone` (`:258-259`) take the same read as a start. Probe 5: today's full read answers "uncertain"
once the note is written or setup files are deleted.

**A move that fails inside the running process** (a rename refused, not a power cut) leaves the server
holding the venue lock, so nothing in that process opens the standard `venue.db` without its change log (an
inspection would, `first-setup-resolution-inspection.ts:86`, read by the review). The Recover request answers
`recoveryMoveRestart` (§4g) and the next start finishes the move.

**What moves in.** Every entry of `target/venue` and `target/state` except the lock files (`venue.lock`,
`venue.lock-journal`, `venue.holder.json`, `migrations.lock`, `recovery.lock`; CLAUDE.md §3) and the copy's
`first-setup-resolutions/` (its backlinks). A Waitron Cloud recovery adds `cloud-recovery.json`, which the
trading side reads from the state folder (`node-entry.ts:614,645`, read by the review). If any of these names
is still at the standard folders after step 3a, the move does not go on (§4g); nothing is deleted.

**The order** (one new journal step, `placed`):

1. `selected`; for a Waitron Cloud recovery the report to Cloud and `cloud-recovery.json` follow, as today
   (`first-setup-backup-recovery.ts:1451-1460`). The move comes after them.
2. The box takes the venue lock on the standard venue folder and on the copy's.
3. Renames, opening no database (Probe 1): **a.** the setup's files out (§1), `venue.db` last; **b.** the
   copy in: `venue.db`, `venue.db-wal`, `venue.db-shm`, `node.db` and its side files, then the state entries,
   **`trading.env` last**. So `trading.env` at the standard folders means the move is complete. **3b has
   begun if and only if `target/venue/venue.db` is gone.** A start renames setup items out only while that
   file is still there: `venue.db`, `node.db`, `modules.json` and `module-preparation-state.json` are names on
   both lists (Probe 3), and renaming the copy's out would put the venue where step 8 deletes it.
4. Both standard folders and the recovery folder's are saved to disk (`firstSetupDirectory(dir, true)`), so a
   power cut cannot lose a rename that `placed` will say happened.
5. The locks are released.
6. `placed`.
7. The finishing record.
8. Retiring: every **other** recovery folder in `backup-recovery/` (earlier recoveries Start again discarded,
   which stay there emptied with their records and lock files, `first-setup-backup-discard.ts:129-133`, read by
   the review) is renamed to `<state>/first-setup-finished-recoveries/` first; then both pointers are deleted
   (the state folder's first); then this recovery's folder is renamed there too; then `setup-leftovers/` is
   deleted, and with Q6's default `evidence/` and `originals.json`; then the empty `backup-recovery/` and
   `first-setup-resolutions/` folders in both standard folders are removed. All of it must go: a start that
   finds `backup-recovery/` with no pointer calls the recovery uncertain (`witness`,
   `first-setup-backup-workspace.ts:263-275`). Lock files travel inside renamed folders and are never
   unlinked; nothing locks those paths after step 5.
9. The finishing record is deleted. From then on no start reads any journal.

Recover's own request does all of it, then answers "Recovery saved. Reconnect to the box." **Every start
finishes whatever is unfinished first**, before opening any database. The start already resolves the
recovery without opening a database (`first-setup-entry.ts:142-201`, read by the review); from step 7 on it
follows the finishing record and never needs the journal. If the disk is nearly full it first releases the
spare file, as `first-setup-entry.ts:232-235` does for a discarded copy, because steps 6–9 write.
A start that finds a pointer at `selected` whose copy shows signs of having sold (§4f's third
condition: a box from before this change, §7) moves nothing and shows §4g's page.

**From then on the box is an ordinary box**: no pointer, no journal read, no folder rewrite.

**The rule behind A1131 place 2: a box with a recovery pointer never sells.** A pointer at `selected` or
`placed` is finished first; any other pointer means the repair page. So no database in a recovery folder, and
none beside a pointer, has been sold from (for boxes built after this change: §7).

**Lock-free tools.** The break-glass and credentials commands and `apps/server/scripts/record-one-sale.ts`
refuse while a recovery pointer exists (visible from the venue folder) and refuse a missing `venue.db` instead
of creating one (Probe 4). A gap remains between their check and their open: a recovery that reaches step 3 in
that moment can still meet an open. (`scripts/cloud-backup-fixture.ts` accepts only temporary test folders,
`:15-17`, read by the review, and is left alone.)

### 3. Power cut at each step

| Cut after… | The next start finds | It does |
| --- | --- | --- |
| Recover pressed, checks done | `prepared`, setup untouched | the repair page as today: the held Start again (§4a), or **Finish saved recovery** (§1b) |
| note written | the same, note later | the same (the fingerprint leaves the note out) |
| `placement-started` or `restored` | setup untouched, copy partial or complete | the same as today |
| `selected` (and the Cloud report) | setup and copy where they were | reads the journal as a chain; steps 2–9; starts normally |
| between setup renames (3a) | `target/venue/venue.db` still there; each setup item in one place | renames the rest out, then 3b–9 |
| between copy renames (3b) | `target/venue/venue.db` gone; each copy entry in one place | renames the rest in, never anything out, then 4–9 |
| a rename refused inside the running process | the server still running, holding the venue lock | answers `recoveryMoveRestart`; opens nothing; the next start continues from the row that matches the files |
| renames done, before step 4 | as above, or (power cut) a rename lost | redoes whatever rename is missing, then 4–9 |
| folders saved, before `placed` | everything in place | 6–9 |
| `placed`, before the finishing record | pointers, journal at `placed` | 7–9 |
| finishing record, part of step 8 done | the finishing record | finishes step 8 from it alone (no journal), then 9 |
| finishing record deleted | no pointer, no `backup-recovery/` | an ordinary start |

**No record can be filed twice**: the move opens no database, so no outbox runs; afterwards there is one
database at one path with one outbox, and "every start puts each sale left 'being sent' back to waiting
before its first filing pass" (CLAUDE.md §5) runs on it as on any box. Before `placed` nothing sells.

### 4. Pages and words

Setup pages: `apps/setup/src/screens/initial-owner-strings.ts`; recovery pages:
`apps/setup/src/i18n/backup-repair.ts`. Pictures in `docs/backlog/mockups/a1131bc-restore/`.

**a. Held Start again (a recovery stopped before `selected`, beside the setup), after the password.** The
counts go. `heldLost` replaces `heldRows`, `heldRowsOne`, `heldNoInvoices`, `heldNoInvoicesOne` and the old
`heldLost`. EN: "Start again deletes what was entered in the setup that stopped part way. Nothing was sent to
AEAT." ES: «Empezar de nuevo borra lo que se introdujo en la configuración que se detuvo a medias. No se envió
nada a la AEAT.» True because it shows only after the invoice check (`first-setup-resolution.ts:567`). The
summary and the confirmation stop carrying counts (`shownHeld`, `apps/server/src/setup-first-fiscal-api.ts:128-141`).
Picture 1.

**b. The fault refusal.** `heldKept`, `heldKeptOne`, `heldInvoices`, `heldInvoiceOne` become `heldKeptFault`.
EN: "The setup database holds records that Waitron never deletes." ES: «La base de datos de configuración
guarda registros que Waitron nunca borra.» Then the unchanged `heldFault`. Counts go to the log line.

**c. #2190's wording points.** Point 3 is dropped ((b) replaces that text). The others:

- Point 1, `setupFinished`. EN: "This setup already finished. Start again would delete a finished setup, so it
  is not offered. Reconnect keeps everything as it is." ES: «Esta configuración ya terminó. Empezar de nuevo
  borraría una configuración terminada, así que no se ofrece. Reconectar lo deja todo como está.»
- Point 2, `tradingSavedPassword`. EN: "Enter the administrator password you chose during setup to see what is
  left to do." ES: «Introduce la contraseña de administrador que elegiste al configurar para ver qué falta.»
- Point 4, new `startUnavailableUncheckable` (with §1b). EN: "Start again needs the administrator password
  chosen during setup, and this box cannot check it. To go on, choose Finish saved recovery and open the same
  backup again: when the recovery finishes, it deletes what was entered in the setup that stopped part way."
  ES: «Empezar de nuevo necesita la contraseña de administrador elegida al configurar, y este equipo no puede
  comprobarla. Para seguir, elige «Finalizar recuperación guardada» y vuelve a abrir la misma copia: cuando la
  recuperación termine, borrará lo que se introdujo en la configuración que se detuvo a medias.»
- `uncheckable` (`setup-app.ts:2737`, "… Keep its files for recovery." becomes false). EN: "This box cannot
  check the original setup password. To go on, choose Recover from backup: when the recovery finishes, it
  deletes what was entered in this setup." ES: «Este equipo no puede comprobar la contraseña original de
  configuración. Para seguir, elige «Recuperar desde una copia»: cuando la recuperación termine, borrará lo que
  se introdujo en esta configuración.» Shown only when that button is on the page: beside a stopped recovery
  it is hidden (`setup-app.ts:2860`), and point 4's line applies instead.

**d. The recovery page before Recover.** `retained` ("The old attempt and its files are kept separately.")
goes, in the slice that makes it false (slice 6a). In its place:

- setup database present: `replacesSetup`. EN: "When the recovery finishes, it deletes what was entered in the
  setup that stopped part way. Nothing was sent to AEAT. This box will not use that setup's invoice series
  names again." ES: «Cuando la recuperación termine, borrará lo que se introdujo en la configuración que se
  detuvo a medias. No se envió nada a la AEAT. Este equipo no volverá a usar los nombres de serie de facturas
  de esa configuración.» The AEAT sentence shows only once Open backup's answer carries the invoice check of
  §1 step 1. Picture 2.
- setup database missing: `replacesMissingSetup`. EN: "When the recovery finishes, it deletes what is left of
  the setup that stopped part way. This box will not use that setup's invoice series names again." ES:
  «Cuando la recuperación termine, borrará lo que queda de la configuración que se detuvo a medias. Este equipo
  no volverá a usar los nombres de serie de facturas de esa configuración.»
- only with Q2 B, setup database unreadable: `setsAsideSetup`. EN: "This box cannot read the setup database, so
  the recovery sets it aside in a folder on this box instead of deleting it. This box will not use that
  setup's invoice series names again." ES: «Este equipo no puede leer la base de datos de configuración, así
  que la recuperación la aparta en una carpeta de este equipo en lugar de borrarla. Este equipo no volverá a
  usar los nombres de serie de facturas de esa configuración.»

**e. The recovery page's refusals, at Recover.** The view after Open backup has **Back** and **Recover**;
Back stays on the recovery page (`first-setup-backup-screen.ts:667-676`, read by the review).

- `refusedTradingSaved`. EN: "This setup already saved the settings the box sells with, so a recovery would
  replace a setup that is ready to sell. It is not offered. To finish that setup instead, choose Back twice,
  then Continue with your setup password." ES: «Esta configuración ya guardó los ajustes con los que vende el
  equipo, así que una recuperación sustituiría una configuración lista para vender. No se ofrece. Para terminar
  esa configuración, elige Atrás dos veces y luego «Continuar con tu contraseña de configuración».» Read, not
  run: that the second Back reaches the setup page; slice 6a checks it.
- `refusedFault`. EN: "The setup database holds records that Waitron never deletes. An unfinished setup should
  hold none, so this is a fault in Waitron. A recovery would delete them, so it is not offered. Back keeps
  everything as it is." ES: «La base de datos de configuración guarda registros que Waitron nunca borra. Una
  configuración sin terminar no debería tener ninguno, así que es un fallo de Waitron. Una recuperación los
  borraría, así que no se ofrece. Atrás lo deja todo como está.»
- `refusedFinished`. EN: "This setup already finished, so a recovery would replace a finished setup. It is not
  offered. Back keeps everything as it is." ES: «Esta configuración ya terminó, así que una recuperación
  sustituiría una configuración terminada. No se ofrece. Atrás lo deja todo como está.»

**f. Start again beside a recovery whose journal cannot be read (A1131 place 2).** Offered only when all of
these hold; otherwise the page stays as today (Reconnect only):

- the setup is there and the held rules of (a) and (b) pass for its database (a Start again with no setup
  record left needs the attempt record, `first-setup-resolution.ts:518`, `:589`; that is Q3 B's cost, so this
  design does not offer it);
- no entry the move would carry in (`venue.db` and side files, `node.db`, `trading.env`, `credentials.key`,
  `node-key.enc`, `cluster-id`, `modules.json`, `module-evidence/`, `rebuild-first-start.json`,
  `cloud-recovery.json`) is at the standard folders, other than the setup's own under (a);
- the copy shows no sign of having sold: no `.venue.db-litestream/` or `stream/`, and not `trading.env`
  without `rebuild-first-start.json` (the first trading start deletes that marker,
  `apps/server/src/rebuild-first-start.ts:139`). This covers boxes that sold from a recovery folder before
  this change.

Then `recoveryUnreadableSafe`. EN: "This box never sold from it: a recovered venue is used only once it is in
the box's usual place. Start again deletes the recovery's copy. The backup itself is not changed." ES: «Este
equipo nunca vendió desde ella: un local recuperado solo se usa cuando ya está en el sitio habitual del equipo.
Empezar de nuevo borra la copia que hizo la recuperación. La copia de seguridad no cambia.» Then `namesFrom`
with the floor: every name in the copy's database if it can be read, otherwise A1098's rule over every file
in the recovery folder, databases included (`startAgainSetAsideFloorMs`). A1099's rule leaves databases out,
so it is not used here. When the setup is there, Start again asks its password as (a) does. Picture 3.

**g. A move that cannot finish** (a name still at the destination, or part of the copy missing). Repair page,
Reconnect only. `recoveryMoveStuck`. EN: "A recovery from backup finished, but this box could not move the
recovered venue into its usual place. Nothing was deleted. This is a fault in Waitron. Reconnect to try
again." ES: «Una recuperación desde una copia terminó, pero este equipo no pudo mover el local recuperado a su
sitio habitual. No se borró nada. Es un fallo de Waitron. Reconecta para intentarlo otra vez.» The log line
names the entry. In the running process after a refused rename, `recoveryMoveRestart`. EN: "A recovery from
backup finished, but this box could not move the recovered venue into its usual place. Nothing was deleted.
Restart the box to finish it." ES: «Una recuperación desde una copia terminó, pero este equipo no pudo mover el
local recuperado a su sitio habitual. No se borró nada. Reinicia el equipo para terminarlo.» With the lock-free tools refusing, only a fault, a hand edit, the tools' remaining gap (§2) or
§1's unmeasured leftovers reach it. Picture 4.

**i. Open backup on a box whose venue folder is on another disk** (Q8 A). `otherDisk`. EN: "This box keeps
its venue folder on a different disk from its other files, so a recovered venue could not be moved into place
safely. Recover from backup is not offered on this box. Install the box with the venue folder in its usual
place to recover here." ES: «Este equipo guarda la carpeta del local en un disco distinto del resto de sus
archivos, así que un local recuperado no se podría mover a su sitio con seguridad. Recuperar desde una copia no
se ofrece en este equipo. Instala el equipo con la carpeta del local en su sitio habitual para recuperar aquí.»

(The first revision's §4h, a stopped recovery with no setup left, exists only under Q3 B.)

### 5. The fiscal link after the move

- The link is a `fiscal_allocations` row keyed by the journal's event id, whose node and source must match the
  journal's binding (`restore-committed.ts:13-24`). It is a row in the database and moves with it. Probe 3:
  accepted on the moved database; a wrong event id refused.
- It is checked at the end of placement (`first-setup-backup-recovery.ts:1430-1440`, `:1410`), on a resume or
  reopen (`:1119`, `:1151`, `:1343`) and in the fiscal module's recovery-state read
  (`packages/fiscal-verifactu/src/hour-recovery-state.ts:75-76`), all before `selected`, on the copy. Nothing
  after `selected` reads the binding. Read.
- The new installation name is chosen during the copy's preparation, later than every name in the recovery's
  history (which includes the setup's) and no earlier than the note. The design does not move that step.
- **Unchanged:** `computeHuella`, the chain, invoice-number allocation, `registros_facturacion` and the alta
  builders. The move renames whole files, so every row, hash and number is what the preparation wrote. The
  setup's files that §1 removes hold no invoice (refused otherwise). No fiscal module code changes; the golden
  hash test and `packages/fiscal-verifactu/src/inmutabilidad.test.ts` must pass unedited in every slice.

### 6. Everything that finds the venue today, and what changes

| Where | Today | After |
| --- | --- | --- |
| `node-entry.ts:318-319,374-386`, `first-setup-launch.ts:102-113` | read the journal, rewrite the folder settings to the copy | finish an unfinished move, then use the standard folders; the rewrite goes in slice 8 |
| `boot.ts:889`, `assertFirstSetupBackupBootTarget` (`first-setup-backup-workspace.ts:783-814`) | refuses the standard folders while a recovery exists | refuses them while an unfinished pointer exists |
| `resolveFirstSetupBackupWorkspace` (`:743-781`) | `selected` → run the copy | `selected`/`placed` → finish the move, chain only; others as today |
| fingerprint walk and compare (`:298-327`, `:528-557`, `:645-646`, `:767`) | every step and start | leaves out the note; not compared from `selected` on |
| server `recheck`, `inspect()`, resume, reopen (`first-setup-backup-recovery.ts:444-451,826-835,913,1036-1046`) | compare setup snapshot and fingerprint | unchanged (the setup is untouched until `selected`) |
| setup page and recovery screen (`setup-app.ts:2860`, `first-setup-backup-screen.ts:815`) | Finish saved recovery at two steps only | beside any stopped recovery (§1b) |
| `boxFolders` (`packages/provisioning/src/box-folders.ts:12-23`) and callers | map the copy back to the box | identity; removed in slice 8 |
| abandoned-copy readers (`first-setup-entry.ts:227-236`, `discarded-copy.ts:19`, `spare-space.ts:147`, `first-setup-resolution.ts:344,681`, `first-setup-start-again-deletion.ts:239`, `first-setup-backup-discard.ts:141-147`) | find an abandoned copy to empty | unchanged; retired ones move with step 8 |
| placement (`first-setup-backup-recovery.ts:509-540,1291-1460`) | places into the copy | plus the note at Recover and the move at the end |
| `freeSpaceAtStart` (`node-entry.ts:337-341`, `start-space.ts:64`) | the copy's folders | the standard folders |
| `recovery.json`, `recovery.lock` (`node-entry.ts:400,447,549`, read by the review) | in the copy's state | in the standard state folder; the copy's lock is never unlinked |
| TLS and landing page (`node-entry.ts:352-362`) | the copy's state | the standard state |
| spare file (`node-entry.ts:418-427`) | the box's own state | unchanged; the finishing start releases it first when nearly full |
| in `boot.ts`: open and migrate (`:961,987-993`), full-disk check (`:995`), health (`:1035`), backups (`:2219`), sealed state (`:2244`), bucket stream (`:2258`), free-space watch (`:2294`), disk usage (`:2471,2489`), `firstSetupBackupRecoveryFor` (`:1159`) | the rewritten folders | the standard folders; no code change |
| Waitron Cloud (`first-setup-backup-recovery.ts:1451-1460`, `node-entry.ts:614,645`) | `cloud-recovery.json` in the copy's state | written before the move, moved with it |
| `restore-command.ts:298-310` | standard folders | unchanged; now sees the recovered venue |
| lock-free tools: `break-glass-command.ts:27,88`, `packages/credentials/src/bin.ts:24-36`, `apps/server/scripts/record-one-sale.ts:100` | open the standard folder, create a missing database | refuse while a pointer exists or `venue.db` is missing |
| `rejoin-command.ts:79-90` | wipes the standard venue folder | unchanged code; now the recovered venue. No fiscal-record check (read by the review) |
| `deploy/waitron.sh:498-501,548,749` | reads the setup's stamp or nothing | reads the venue's |
| note writers (`first-setup-resolution.ts:666,675`, `packages/provisioning/src/first-setup-start-again-set-aside.ts:236-238`) | Start again | plus Recover; `scripts/start-again-note-writers.test.ts` matches files by name only and `raiseStartAgainNote` names neither the file nor its constant, so the guard needs no change unless Recover's file names the note |

### 7. Boxes that already sell from a recovery folder

Pre-live, so no conversion code (CLAUDE.md §3; Q7). Such a box's journal says `selected` and its standard
folders still hold the setup's files. Under §1 the new start would rename those out and move the copy in, but
the copy has sold since, so its `stream/` and `.venue.db-litestream/` travel too; whether that is safe was not
traced. The design therefore treats them as Q7 says. If such a box's journal is damaged, §4f's "signs of having
sold" keep Start again off.

### 8. How the two fit together

- **Open backup to Recover** (`prepared`): nothing changes on the box; a stop leaves the held case (§4a) and
  Finish saved recovery (§1b).
- **Recover to `restored`**: the note holds the setup's names; the setup is untouched; the copy is partial or
  complete. A stop: as today, with §4a's words.
- **`selected` to the finishing record**: the setup's files out, the copy in, finished by any start, the journal
  read as a chain.
- **After**: an ordinary box.
- Deleting at Recover (Q3 B) would make the second phase a setup-less one, with every mechanism Q3 B lists.
  Copying straight into the standard folders (Q1 B) is possible only with Q3 B, since until `selected` the
  setup is still there.

### 9. Guides and docs that become false (the build updates them)

User guides, English and Spanish: `apps/server/src/guide/en/backup-recovery.md:7-8` / `es:7-8`; `en:27-28` /
`es:29`; `en:33-35` / `es:35-37` (the counts); `en:36-38` / `es:38-40` (the invoice refusal, now also at
Recover); `en:61-62` / `es:66`; `en:120-121` / `es:130-131`; `en:128` / `es:139`.

Operator and developer docs: `docs/operations/hour-recovery.md:33-34,51-52,69-72`;
`docs/operations/backups-and-support.md:25-27`; `docs/operations/first-live-fiscal-setup.md:92-94,146-153,159`;
`deploy/README.md:281-283,301-302,310-314,378-380`; `apps/server/README.md:58-61`;
`docs/developers/conventions-data.md:3041-3045,3104-3106,3296,3303-3309,3326,4761-4762`;
`docs/developers/conventions-ui.md:1109-1110,1112,1114-1115,1123-1124,1227-1228`; `docs/backlog/box.md:872-874`;
CLAUDE.md's spare-file entry and its §5 note entry's A1131 clause. Read; ranges as of this worktree's base.

## Deliberate limits

- **A stopped recovery leaves the setup beside it** (Q3 A). Start again (§4a) deletes both, with the setup's
  password.
- **A journal damaged between `selected` and the finishing record** (milliseconds, or one start after a power
  cut): the repair page, Reconnect only.
- **The recovery's preparation writes into the copy before it is chosen** (§2, Q1).
- **The lock-free tools' gap** between their check and their open (§2).
- **A finished recovery's folder stays** in `first-setup-finished-recoveries/` (journal, lock files; `evidence/`
  only with Q6 B).

## Owner questions

Shared example. Marta's first setup on a new box stops part way: the power went while she was entering the
menu. The setup database holds 105 items and the series names `A-0CNNY`, `FF-0CNNY`, `R-0CNNY`. Her old box's
backup is from 20 October. She chooses **Recover from backup**, the file, its key, ticks both boxes, **Open
backup**; the page shows the backup and "When the recovery finishes, it deletes what was entered in the setup
that stopped part way. …". She presses **Recover**. The box writes "nothing before 0CNNZ" into its note, copies
the backup, takes the new name `0CNQW`, chooses the copy, renames the setup's files out and the copy in, retires
the recovery folder and restarts. The tills sell from `<state>/venue`. Three months later the recovery's
journal is damaged: nothing reads it.

### Q1 of 8. Where the copy is made (default A)

Example: Marta presses Recover and the power goes when the copy is half made. With A, the box's usual venue
folder still holds only her interrupted setup; the half-made copy sits in the recovery folder. With B, the
half-made copy sits in the usual venue folder itself.

- **A (recommended).** In the recovery folder, moved once complete and chosen. Matches the watcher's working
  reading of your 08:10 words; the one write after choosing is a Waitron Cloud recovery's report. Cost: the move
  is its own machinery (two slices, Q8's one-disk rule, eight rows of §3), and the recovery's preparation is
  written into the copy before it moves.
- **B.** Straight into the standard folders. Only possible if the setup is deleted at Recover (Q3 B). Cost: Q3
  B's whole list, plus reworking the copy-placing, resume and discard code; a stopped recovery leaves a partial
  database at the venue's own path, where Start again beside a damaged journal meets the backup's invoices and
  is refused.

### Q2 of 8. A setup database the box cannot read (default A)

Example: Marta's setup database is damaged by the power cut. She opens the backup, and the next step answers
"Recovery could not continue". Today nothing is written.

- **A (recommended).** Keep that refusal, with words naming the cause and a way forward. Cost: the way forward
  is not designed here; the build must find what lets her clear the damaged setup first (Start again's existing
  paths), and test it.
- **B.** Let the recovery go ahead: at `selected` the damaged database is set aside, not deleted, and the note's
  floor comes from every set-aside file's time, databases included (A1098's rule). Cost: the recovery's history
  must be built without that database's names; a file nobody reads stays until a full reset.

(The relayed 08:10 bullets said "set aside, never deleted"; that phrase was the watcher's, not your words.)

### Q3 of 8. When the setup is deleted (default A)

Example: Marta presses Recover; the power goes during the copy. With A, the box shows Start again and Finish
saved recovery; her setup's 105 items, her name and email stay on the box until she chooses one. With B, they
are already gone, and the page offers Finish saved recovery and a Start again that needs no setup password.

- **A (recommended).** At `selected`, once the copy is complete and chosen; its names go into the note at
  Recover. Cost: a recovery that stops part way leaves the setup beside it, and Start again then needs the
  setup's password (as today, with your new words). This is later than your words ("if we then start a restore,
  we wipe what was there").
- **B.** At **Recover**, as you wrote. Cost, from the reviews, each a change to recovery code that works today:
  a second fingerprint in its own file (`cleared-originals.json`) with the check reading the newest one; the
  server's `recheck`, `inspect()`, resume and reopen no longer comparing the setup, and reopen no longer
  re-reading its history; Start again's marker recording the recovery it must keep, and its finisher accepting
  it; `abandoned` allowed from the new step; a new Start again for a box with no setup record (it now needs the
  attempt id, the setup record and its floor); and Q5. About three more slices, all on the full review path.
- **C.** At **Open backup**. Cost: B's list, and a person who opens a backup only to look loses the setup.

### Q4 of 8. What proves Marta may have the setup deleted (default A)

Example: Marta's business partner Luis has the backup file and its key but not the setup password Marta chose.
With A he can recover the venue, and the recovery deletes Marta's interrupted setup. With B he cannot recover
until Marta types her password.

- **A (recommended).** The backup's key and the two ticks Recover already needs. Cost: whoever holds the
  backup's key can have an interrupted setup deleted without its password; they could recover the venue anyway.
- **B.** Also the setup's administrator password when the database holds items. Cost: someone who forgot it
  cannot recover over the interrupted setup, and §4c point 4's way forward goes.

### Q5 of 8. Only if Q3 is B or C: who may press Start again once the setup is gone (default A)

Example: under Q3 B, Marta's recovery stops at 40%; her setup is already deleted. A waiter on the venue's
network opens the box's page. With A he can press Start again, and Marta must recover again from her backup.
With B he cannot without the backup's key.

- **A (recommended).** Anyone who reaches the page, with the tick. Cost: someone on the venue network can throw away a stopped
  recovery, which Marta then repeats.
- **B.** The stopped recovery's backup key. Cost: without the key the box cannot start afresh.

### Q6 of 8. The setup's files and the recovery's copies of them, once the move finishes (default A)

Example: Marta's recovery finishes. The recovery folder holds the setup's renamed files (`setup-leftovers/`) and
copies the recovery took of the box's small files when it began (`evidence/`), among them `first-setup.json`
with her name and email as administrator.

- **A (recommended).** Delete both when the move finishes; keep the journal. Cost: no later look at what the
  interrupted setup held.
- **B.** Keep them with the finished recovery until a full reset. Cost: the setup's details, personal ones
  included, stay on the box after the page told her they were deleted.

### Q7 of 8. Boxes that already sell from a recovery folder (default A)

Example: the owner's test box was set up in September by a recovery and has sold from
`<state>/first-setup-resolutions/backup-recovery/<id>/target/venue` since.

- **A (recommended).** Reset it (the pre-live rule). Until then the new start finds a pointer at `selected` and
  the setup's files at the standard folders; slice 6a makes that start stop on §4g's page instead of moving a
  copy that has sold. Cost: its test data is lost unless recovered again; and without §4f's "signs of having
  sold", a damaged journal there would let Start again delete the venue it sold from, so that check is required.
- **B.** The start converts it. Cost: conversion code the pre-live rule forbids, for test data.

### Q8 of 8. A box whose venue folder is on another disk (default A)

Example: an installer sets `WAITRON_VENUE_DIR` to a separate fast disk on Pedro's box. His setup stops; he
opens a backup.

- **A (recommended).** Open backup refuses with §4i's words. Cost: such a box cannot recover through the setup
  page at all; Pedro must reinstall with the usual layout first.
- **B.** Copy the copy's venue files across to a temporary folder inside the venue folder, save them, then
  rename. Cost: the venue's size again in free space on that disk, a copy step with its own power-cut rows and
  tests, and one more slice.

## Slices

Each its own pull request, FULL review. **No slice adds a database migration.** Slices 2 and 3 change what the
recovery journal and fingerprint expect: a box part way through a recovery when they land needs a reset
(pre-live). Each leaves main working; every page sentence lands in the slice that makes it true.

1. **Start again's words.** §4a, §4b, §4c points 1–2, summary and confirmation without counts, guide lines
   `en:33-38`/`es:35-40`. Picture 1.
2. **The note at Recover.** The fingerprint leaves out the note; the note written just before
   `placement-started` with `gatherStartAgainFloor` exported; Open backup's answer carries the invoice check.
   Tests: the note's floor passes every series name the setup held (control: without the step it is
   unchanged); the next step and a start still read the recovery (control, as Probe 5: without the exclusion
   they answer "uncertain"); a refused Recover raises nothing.
3. **The move, unused** (provisioning). Measure an interrupted activation's leftovers first; then `readRecords`
   chain-only from `selected`, renames out and in with the `target/venue/venue.db` rule, saving the folders,
   `placed`, the finishing record, retiring (other recovery folders first), Q6. Tests: a cut after each §3 row
   from `selected` down, with a change log present as in Probe 1, ends complete; a cut in 3b never renames the
   copy's `venue.db` out (control: without the rule it does); a name already at the destination stops it; one
   earlier discarded recovery is retired too. Split 3a (renames and finisher) / 3b (retiring) if it passes ~100
   calls.
4. **The other-disk refusal** (§4i, Q8), before anything calls the move.
5. **Lock-free tools.** The three refuse; `waitron.sh`'s production check on a recovered box.
6a. **The move wired in.** Recover calls it after the Cloud report; node-entry, `first-setup-launch` and boot
   finish it at start; `boot.ts:889`'s check; Recover's refusals with §4e's words (all four checks of §1);
   §4d's words; §4g's two pages and the held venue lock after a failed rename; Q7's stop. Tests: a damaged
   journal after the move does not stop the start (control: before this slice it shows the repair page); the
   fiscal link check passes on the moved database. Pictures 2 and 4.
6b. **The rest of the wiring.** The spare released first by the finishing start, with CLAUDE.md's spare-file
   rule and `scripts/spare-space.test.ts`; the backup-recovery guides' "kept separately" lines and
   `docs/operations/*`.
7. **Finish saved recovery beside any stopped recovery** (§1b), §4c point 4, `uncheckable`.
8. **A1131 place 2 and the rest.** §4f; the folder rewrite and `boxFolders` removed; §9's remaining docs and
   CLAUDE.md §5's clause; the backlog entry deleted. Picture 3.

With Q3 B, slice 2 becomes two (the second fingerprint and the server's checks; Start again without a setup
record, resume and reopen without a setup, and its page), and slice 7 grows.

## Open, not measured

- **An interrupted activation's leftovers** (§1): slice 3 measures them first.
- **Reopen at `prepared`** (§1b) and **where the second Back leads** (§4e).
- **Linux and a real power cut.** Probes 1–2 ran on macOS and killed a process; §2 step 4 answers lost renames,
  not measured.
- **The way forward for an unreadable setup database** under Q2 A.
- **The size of a finished recovery folder** on a real venue.
- Closed by the reviews' reading: nothing the bucket stream keeps between starts depends on the database's path;
  the rejoin command has no fiscal-record check.

## Review rounds

**Round 1** (`item-a1131bc-design-review.md`): C1–C3, I1–I10 and the minors, folded into the first revision.
Of that revision, round 3 replaced the `setup-cleared` step, §1b's no-setup Start again and §4h.

**Round 3** (`item-a1131bc-design-review-3.md`). 1 and 2 (the deletion at Recover breaks the server's checks,
resume, reopen and Start again): rather than redesign each, the deletion moves to `selected` (§1), where Probe 5
shows the chain-only read accepts it; deletion at Recover stays as Q3 B with those costs listed. 3 confirmed. 4:
other recovery folders retired first (§2 step 8). 5: `cloud-backup-fixture.ts` dropped; the gap stated. 6: Cloud
order kept; the unreadable-database sentence corrected. 7: line references corrected. 8: §1b, "Back twice",
§4h dropped, Spanish `uncheckable`. 9: worked examples for Q2, Q6 and Q7; Q8 added; slices re-split.

**Round 4** (`item-a1131bc-design-review-4.md`, 0 critical, 5 important, 5 minor). The missing-database
damaged-record case refused at Recover, with the review's probe; the note written just before
`placement-started`, `gatherStartAgainFloor` exported; the `target/venue/venue.db` rule for 3a and 3b;
`readRecords` chain-only from `selected` and the held lock after a failed rename, with §3 rows and
`recoveryMoveRestart`; §4f's "or the setup is gone" dropped; Probe 5 narrowed; worked examples for Q1, Q3, Q4,
Q5 and Q5 A marked recommended; `uncheckable` words and where they show; the guard row corrected; slices
reordered (other disk and lock-free tools before the wiring, refusals in 6a, 6a/6b split). One correction to
the review's text: `gatherStartAgainFloor` is not exported today (`first-setup-resolution.ts:140`), so the
design says it becomes exported.
